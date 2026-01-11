"""
Rolling Optimization Engine with Expanding Window Walk-Forward

This module implements expanding window walk-forward optimization for adaptive strategy testing.
Unlike fixed rolling windows, this uses an expanding window where the IS period grows over time.

Key Concepts:
- Pre-filter tickers by minimum historical data requirement
- For each OOS period, optimize on all historical data up to that point
- Track which branch/parameters are selected each period
- Concatenate OOS trades for final equity curve
"""

import sys
import json
import time
from datetime import datetime, timedelta
from typing import List, Dict, Tuple, Optional, Set
from pathlib import Path
import pandas as pd
import numpy as np

from optimized_dataloader import get_global_cache


class RollingOptimizer:
    """
    Manages rolling optimization with expanding windows
    """

    def __init__(self, parquet_dir: str):
        self.parquet_dir = Path(parquet_dir)
        self.cache = get_global_cache(str(parquet_dir))

    def get_ticker_start_date(self, ticker: str) -> Optional[datetime]:
        """
        Get the first date available for a ticker.

        Args:
            ticker: Ticker symbol

        Returns:
            First date as datetime, or None if ticker doesn't exist
        """
        try:
            # Load ticker data
            df = self.cache._load_parquet_cached(ticker)
            if len(df) == 0:
                return None

            # Get first date from index
            first_date = pd.to_datetime(df.index[0])
            return first_date

        except Exception as e:
            print(f"[RollingOptimizer] Warning: Could not get start date for {ticker}: {e}", file=sys.stderr)
            return None

    def filter_tickers_by_start_date(
        self,
        tickers: List[str],
        min_start_year: int
    ) -> Tuple[List[str], Dict[str, datetime]]:
        """
        Filter tickers that have data starting on or before min_start_year.

        Args:
            tickers: List of ticker symbols
            min_start_year: Minimum start year (e.g., 1993 for 3 years before 1996)

        Returns:
            Tuple of (valid_tickers, ticker_start_dates)
        """
        print(f"[RollingOptimizer] Filtering {len(tickers)} tickers by start year <= {min_start_year}...", file=sys.stderr)

        valid_tickers = []
        ticker_start_dates = {}
        excluded_count = 0

        min_start_date = datetime(min_start_year, 1, 1)

        for ticker in tickers:
            start_date = self.get_ticker_start_date(ticker)

            if start_date is None:
                print(f"[RollingOptimizer]   ✗ {ticker}: No data available", file=sys.stderr)
                excluded_count += 1
                continue

            if start_date <= min_start_date:
                valid_tickers.append(ticker)
                ticker_start_dates[ticker] = start_date
                print(f"[RollingOptimizer]   ✓ {ticker}: Start date {start_date.strftime('%Y-%m-%d')}", file=sys.stderr)
            else:
                print(f"[RollingOptimizer]   ✗ {ticker}: Start date {start_date.strftime('%Y-%m-%d')} is after {min_start_year}", file=sys.stderr)
                excluded_count += 1

        print(f"[RollingOptimizer] Result: {len(valid_tickers)} valid tickers, {excluded_count} excluded", file=sys.stderr)

        return valid_tickers, ticker_start_dates

    def get_oos_periods(
        self,
        start_year: int,
        rolling_period: str,
        end_year: Optional[int] = None
    ) -> List[Tuple[datetime, datetime]]:
        """
        Calculate OOS periods based on rolling period configuration.

        Args:
            start_year: First OOS year (e.g., 1996)
            rolling_period: 'yearly', 'monthly', or 'daily'
            end_year: Last OOS year (defaults to current year)

        Returns:
            List of (oos_start, oos_end) datetime tuples
        """
        if end_year is None:
            end_year = datetime.now().year

        periods = []

        if rolling_period == 'yearly':
            # Generate yearly periods: Jan 1 - Dec 31 of each year
            for year in range(start_year, end_year + 1):
                oos_start = datetime(year, 1, 1)
                oos_end = datetime(year, 12, 31)
                periods.append((oos_start, oos_end))

        elif rolling_period == 'monthly':
            # Generate monthly periods: 1st - last day of each month
            current_date = datetime(start_year, 1, 1)
            end_date = datetime(end_year, 12, 31)

            while current_date <= end_date:
                oos_start = datetime(current_date.year, current_date.month, 1)

                # Last day of month
                if current_date.month == 12:
                    oos_end = datetime(current_date.year, 12, 31)
                else:
                    next_month = datetime(current_date.year, current_date.month + 1, 1)
                    oos_end = next_month - timedelta(days=1)

                periods.append((oos_start, oos_end))

                # Move to next month
                if current_date.month == 12:
                    current_date = datetime(current_date.year + 1, 1, 1)
                else:
                    current_date = datetime(current_date.year, current_date.month + 1, 1)

        elif rolling_period == 'daily':
            # Generate daily periods (computationally expensive!)
            current_date = datetime(start_year, 1, 1)
            end_date = datetime(end_year, 12, 31)

            while current_date <= end_date:
                periods.append((current_date, current_date))
                current_date += timedelta(days=1)

        else:
            raise ValueError(f"Invalid rolling_period: {rolling_period}")

        print(f"[RollingOptimizer] Generated {len(periods)} OOS periods ({rolling_period})", file=sys.stderr)
        return periods

    def generate_branches(self, tree: Dict, parameter_ranges: List[Dict]) -> List[Dict]:
        """
        Generate branches from parameter ranges (cartesian product).

        Args:
            tree: Base tree structure
            parameter_ranges: List of parameter range dictionaries

        Returns:
            List of branch dictionaries with id, tree, and params
        """
        import copy
        from itertools import product

        print(f"[DEBUG] generate_branches: received {len(parameter_ranges)} parameter ranges", file=sys.stderr, flush=True)

        # Filter to only enabled ranges and exclude ticker_list type
        enabled_ranges = [r for r in parameter_ranges if r.get('enabled', True) and r.get('type') != 'ticker_list']

        print(f"[DEBUG] generate_branches: {len(enabled_ranges)} enabled ranges after filtering", file=sys.stderr, flush=True)
        for i, r in enumerate(enabled_ranges[:3]):  # Log first 3
            print(f"[DEBUG]   Range {i}: type={r.get('type')}, path={r.get('path')}, min={r.get('min')}, max={r.get('max')}, step={r.get('step')}", file=sys.stderr, flush=True)

        if len(enabled_ranges) == 0:
            # No parameter ranges - return base tree only
            print(f"[DEBUG] No enabled ranges, returning single branch with base tree", file=sys.stderr, flush=True)
            return [{'id': 0, 'tree': tree, 'params': {}}]

        # Generate value arrays for each range
        value_arrays = []
        range_info = []

        for r in enabled_ranges:
            values = []
            min_val = r.get('min', 0)
            max_val = r.get('max', 0)
            step = r.get('step', 1)

            # Generate values from min to max by step
            current = min_val
            while current <= max_val:
                values.append(current)
                current += step

            # Ensure max is included
            if len(values) == 0 or values[-1] != max_val:
                values.append(max_val)

            value_arrays.append(values)
            range_info.append({
                'id': r.get('id'),
                'path': r.get('path'),
                'type': r.get('type')
            })

        # Generate cartesian product of all value arrays
        branches = []
        for combo_idx, combo in enumerate(product(*value_arrays)):
            # Create a copy of the tree
            tree_copy = copy.deepcopy(tree)

            # Apply parameter values to tree
            params = {}
            for range_idx, value in enumerate(combo):
                path = range_info[range_idx]['path']
                params[path] = value
                # Apply to tree (traverse path and set value)
                self._apply_param_to_tree(tree_copy, path, value)

            branches.append({
                'id': combo_idx,
                'tree': tree_copy,
                'params': params
            })

        return branches

    def _apply_param_to_tree(self, node: Dict, path: str, value) -> None:
        """
        Apply a parameter value to a tree node using a dot-separated path.

        Path format: "node.conditions.<condition-id>.<field>"
        Since the path starts with "node" but we need to find the actual node with conditions,
        we recursively search the tree for the node with matching condition ID.

        Args:
            node: Root node to start from
            path: Dot-separated path (e.g., "node.conditions.1768083288172.window")
            value: Value to set
        """
        parts = path.split('.')

        # Extract condition ID and field from path
        # Format: node.conditions.<condition-id>.<field>
        if len(parts) >= 4 and parts[1] == 'conditions':
            condition_id = parts[2]
            field = parts[3]

            # Recursively search tree for node with this condition
            found = self._find_and_update_condition(node, condition_id, field, value)
            if not found:
                print(f"[WARNING] Could not find condition {condition_id} to update field '{field}'", file=sys.stderr, flush=True)

    def _find_and_update_condition(self, node: Dict, condition_id: str, field: str, value) -> bool:
        """
        Recursively search tree for a condition with given ID and update its field.

        Returns:
            True if condition was found and updated, False otherwise
        """
        # Check if this node has conditions
        if 'conditions' in node and isinstance(node['conditions'], list):
            for cond in node['conditions']:
                # Use substring matching because parameter paths use shortened IDs
                # e.g., path has "1768083525055" but tree has "node-1768083525055-12-uabpdoja"
                cond_id = cond.get('id', '')
                if condition_id in cond_id or cond_id == condition_id:
                    # Found it! Update the field
                    old_value = cond.get(field, 'N/A')
                    cond[field] = value
                    print(f"[DEBUG] Updated condition {cond_id} field '{field}': {old_value} -> {value}", file=sys.stderr, flush=True)
                    return True

        # Recursively check children
        if 'children' in node:
            for slot_key, slot_children in node['children'].items():
                if isinstance(slot_children, list):
                    for child in slot_children:
                        if child and isinstance(child, dict):
                            if self._find_and_update_condition(child, condition_id, field, value):
                                return True

        return False

    def run_rolling_optimization(
        self,
        config: Dict
    ) -> Dict:
        """
        Run complete rolling optimization with expanding window.

        Args:
            config: Configuration dictionary with:
                - tickers: List of ticker symbols
                - splitConfig: Split configuration (rollingStartYear, minWarmUpYears, rollingWindowPeriod, rankBy)
                - tree: FlowNode tree structure
                - parameterRanges: List of parameter ranges for optimization

        Returns:
            Dictionary with OOS results, metrics, and selected branches
        """
        start_time = time.perf_counter()

        # Extract configuration
        tickers = config['tickers']
        split_config = config.get('splitConfig', {})
        rolling_start_year = split_config.get('rollingStartYear', 1996)
        min_warmup_years = split_config.get('minWarmUpYears', 3)
        rolling_period = split_config.get('rollingWindowPeriod', 'yearly')
        rank_by = split_config.get('rankBy', 'CAGR')

        # Debug: Log parameter ranges received
        parameter_ranges = config.get('parameterRanges', [])

        # Write detailed debug log to file
        import os
        debug_log_path = os.path.join(os.path.dirname(__file__), '..', '..', 'rolling_debug.log')
        with open(debug_log_path, 'w') as debug_file:
            debug_file.write("=== ROLLING OPTIMIZATION DEBUG LOG ===\n\n")
            debug_file.write(f"Rolling Start Year: {rolling_start_year}\n")
            debug_file.write(f"Min Warm-Up Years: {min_warmup_years}\n")
            debug_file.write(f"Rolling Period: {rolling_period}\n")
            debug_file.write(f"Rank By: {rank_by}\n")
            debug_file.write(f"Input Tickers: {len(tickers)}\n")
            debug_file.write(f"\nParameter Ranges Received: {len(parameter_ranges)}\n")
            for i, pr in enumerate(parameter_ranges):
                debug_file.write(f"  [{i}] {pr}\n")

        print(f"\n[RollingOptimizer] Starting rolling optimization", file=sys.stderr)
        print(f"  Debug log: {debug_log_path}", file=sys.stderr)
        print(f"  Rolling Start Year: {rolling_start_year}", file=sys.stderr)
        print(f"  Min Warm-Up Years: {min_warmup_years}", file=sys.stderr)
        print(f"  Rolling Period: {rolling_period}", file=sys.stderr)
        print(f"  Rank By: {rank_by}", file=sys.stderr)
        print(f"  Input Tickers: {len(tickers)}", file=sys.stderr)
        print(f"  Parameter Ranges: {len(parameter_ranges)}", file=sys.stderr)

        # Step 1: Pre-filter tickers by start date
        min_start_year = rolling_start_year - min_warmup_years
        valid_tickers, ticker_start_dates = self.filter_tickers_by_start_date(
            tickers,
            min_start_year
        )

        if len(valid_tickers) == 0:
            return {
                'success': False,
                'error': f'No valid tickers found with data before {min_start_year}',
                'validTickers': [],
                'excludedCount': len(tickers)
            }

        print(f"[RollingOptimizer] Using {len(valid_tickers)} valid tickers", file=sys.stderr)

        # Step 2: Get OOS periods
        oos_periods = self.get_oos_periods(
            rolling_start_year,
            rolling_period
        )

        print(f"[RollingOptimizer] Testing {len(oos_periods)} OOS periods", file=sys.stderr)

        # Step 3: Generate parameter branches from tree
        tree = config.get('tree')
        parameter_ranges = config.get('parameterRanges', [])

        if not tree:
            return {
                'success': False,
                'error': 'No tree provided in configuration'
            }

        print(f"[RollingOptimizer] Generating branches from {len(parameter_ranges)} parameter ranges...", file=sys.stderr)

        # Generate branches from parameter ranges
        branches = self.generate_branches(tree, parameter_ranges)
        print(f"[RollingOptimizer] Generated {len(branches)} branches", file=sys.stderr)

        # Log first 3 branches for debugging
        for i in range(min(3, len(branches))):
            print(f"[RollingOptimizer]   Branch {i} params: {branches[i]['params']}", file=sys.stderr)

        # Append branch info to debug log
        with open(debug_log_path, 'a') as debug_file:
            debug_file.write(f"\n\nBranches Generated: {len(branches)}\n")
            for i in range(min(5, len(branches))):
                debug_file.write(f"\nBranch {i}:\n")
                debug_file.write(f"  Params: {branches[i]['params']}\n")
                # Also check if conditions were actually updated in the tree
                if 'tree' in branches[i]:
                    branch_tree = branches[i]['tree']
                    debug_file.write(f"  Tree ID: {branch_tree.get('id')}\n")
                    # Try to find the first condition to verify it was updated
                    def find_first_condition(node):
                        if 'conditions' in node and len(node['conditions']) > 0:
                            return node['conditions'][0]
                        if 'children' in node:
                            for slot, children in node['children'].items():
                                if children:
                                    for child in children:
                                        if child:
                                            result = find_first_condition(child)
                                            if result:
                                                return result
                        return None
                    first_cond = find_first_condition(branch_tree)
                    if first_cond:
                        debug_file.write(f"  First condition: {first_cond}\n")

        # Step 4: Run expanding window optimization
        print(f"\n[RollingOptimizer] Starting expanding window optimization...", file=sys.stderr)
        print(f"  Periods: {len(oos_periods)}", file=sys.stderr)
        print(f"  Branches per period: {len(branches)}", file=sys.stderr)
        print(f"  Total backtests: {len(oos_periods) * len(branches) * 2}", file=sys.stderr)  # 2x for IS + OOS

        # Emit initial progress
        total_backtests = len(oos_periods) * len(branches)
        print(json.dumps({
            'type': 'progress',
            'completed': 0,
            'total': total_backtests,
            'currentPeriod': 0,
            'totalPeriods': len(oos_periods)
        }), file=sys.stderr, flush=True)

        all_oos_equity = []  # Collect equity curve points from all OOS periods
        selected_branches = []

        # Initialize backtester for running tests
        from backtester import Backtester
        backtester = Backtester(str(self.parquet_dir))

        for period_idx, (oos_start, oos_end) in enumerate(oos_periods):
            print(f"\n[RollingOptimizer] === Period {period_idx + 1}/{len(oos_periods)}: {oos_start.strftime('%Y-%m-%d')} to {oos_end.strftime('%Y-%m-%d')} ===", file=sys.stderr)

            # Emit progress for this period
            print(json.dumps({
                'type': 'progress',
                'completed': period_idx * len(branches),
                'total': total_backtests,
                'currentPeriod': period_idx + 1,
                'totalPeriods': len(oos_periods),
                'periodStart': oos_start.strftime('%Y-%m-%d'),
                'periodEnd': oos_end.strftime('%Y-%m-%d')
            }), file=sys.stderr, flush=True)

            # IS period: ticker_start → day before oos_start
            is_end = oos_start - timedelta(days=1)
            is_end_str = is_end.strftime('%Y-%m-%d')

            print(f"[RollingOptimizer]   IS period: ticker_start → {is_end_str}", file=sys.stderr)

            # Backtest all branches on IS period
            is_results = []
            for branch_idx, branch in enumerate(branches):
                try:
                    # Log first few branches for debugging
                    if branch_idx < 3:
                        print(f"[RollingOptimizer]     Testing branch {branch['id']} with params: {branch['params']}", file=sys.stderr)

                    # Run backtest on IS period
                    result = backtester.run_backtest(
                        branch['tree'],
                        {
                            'mode': 'CC',
                            'endDate': is_end_str,
                            'costBps': 1.0,
                            'splitConfig': {
                                'enabled': False,
                                'strategy': 'chronological'
                            }
                        }
                    )

                    if result.get('success'):
                        is_results.append({
                            'branch_id': branch['id'],
                            'params': branch['params'],
                            'tree': branch['tree'],
                            'metrics': result.get('metrics', {})
                        })
                        # Log first successful branch
                        if len(is_results) == 1:
                            print(f"[RollingOptimizer]     ✓ Branch {branch['id']} passed with metrics: {result.get('metrics', {})}", file=sys.stderr)
                    else:
                        # Log full result for debugging (but only first few failures)
                        error_msg = result.get('error', 'Unknown error')
                        if branch_idx < 3:
                            print(f"[RollingOptimizer]     ✗ Branch {branch['id']} failed on IS: {error_msg}", file=sys.stderr)
                            print(f"[RollingOptimizer]       Full result: {result}", file=sys.stderr)

                except Exception as e:
                    import traceback
                    print(f"[RollingOptimizer]     Branch {branch['id']} exception on IS: {e}", file=sys.stderr)
                    print(f"[RollingOptimizer]       Traceback: {traceback.format_exc()}", file=sys.stderr)

            if len(is_results) == 0:
                print(f"[RollingOptimizer]   WARNING: No branches passed IS period, skipping OOS", file=sys.stderr)
                continue

            # Rank branches by specified metric
            # Map frontend metric names to backend metric keys
            metric_map = {
                'CAGR': 'cagr',
                'Max Drawdown': 'maxDrawdown',
                'Calmar Ratio': 'calmarRatio',
                'Sharpe Ratio': 'sharpe',
                'Sortino Ratio': 'sortino',
                'Treynor Ratio': 'treynor',
                'Beta': 'beta',
                'Volatility': 'volatility',
                'Win Rate': 'winRate',
                'Avg Turnover': 'avgTurnover',
                'Avg Holdings': 'avgHoldings',
                'Time in Market': 'tim',
                'TIM Adjusted Returns': 'timar'
            }

            metric_key = metric_map.get(rank_by, 'timar')

            # Handle inverse metrics (lower is better)
            if metric_key in ['maxDrawdown', 'volatility']:
                # For these metrics, lower is better, so negate for sorting
                best_branch = min(is_results, key=lambda x: x['metrics'].get(metric_key, float('inf')))
            else:
                # Higher is better
                best_branch = max(is_results, key=lambda x: x['metrics'].get(metric_key, float('-inf')))

            is_metric_value = best_branch['metrics'].get(metric_key, None)
            print(f"[RollingOptimizer]   Best branch: #{best_branch['branch_id']}, {rank_by} = {is_metric_value}", file=sys.stderr)

            # Run best branch on OOS period
            try:
                oos_result = backtester.run_backtest(
                    best_branch['tree'],
                    {
                        'mode': 'CC',
                        'startDate': oos_start.strftime('%Y-%m-%d'),
                        'endDate': oos_end.strftime('%Y-%m-%d'),
                        'costBps': 1.0,
                        'splitConfig': {
                            'enabled': False,
                            'strategy': 'chronological'
                        }
                    }
                )

                if oos_result.get('success'):
                    oos_metrics = oos_result.get('metrics', {})
                    oos_equity_curve = oos_result.get('equityCurve', [])

                    # Add equity curve points to cumulative list
                    all_oos_equity.extend(oos_equity_curve)

                    # Record branch selection
                    selected_branches.append({
                        'oosPeriod': [oos_start.strftime('%Y-%m-%d'), oos_end.strftime('%Y-%m-%d')],
                        'branchId': best_branch['branch_id'],
                        'params': best_branch['params'],
                        'isMetric': is_metric_value,
                        'oosMetrics': oos_metrics
                    })

                    print(f"[RollingOptimizer]   OOS: {len(oos_equity_curve)} equity points, {rank_by} = {oos_metrics.get(metric_key, 'N/A')}", file=sys.stderr)
                else:
                    print(f"[RollingOptimizer]   OOS backtest failed: {oos_result.get('error', 'Unknown error')}", file=sys.stderr)

            except Exception as e:
                print(f"[RollingOptimizer]   OOS backtest error: {e}", file=sys.stderr)

        # Step 5: Calculate final OOS metrics from concatenated equity curve
        print(f"\n[RollingOptimizer] Calculating final OOS metrics from {len(all_oos_equity)} equity points...", file=sys.stderr)

        # Calculate metrics from all concatenated OOS equity curve
        if len(all_oos_equity) > 0:
            try:
                # Sort equity curve by timestamp (in case periods are out of order)
                all_oos_equity.sort(key=lambda x: x[0])

                # Use backtester's calculate_metrics with minimal db info
                # Create a minimal db dict just for metric calculation
                timestamps = [point[0] for point in all_oos_equity]
                min_db = {
                    'dates': timestamps,
                    'close': {'SPY': [0] * len(timestamps)}  # Dummy SPY data for TIM calculation
                }

                # Convert equity curve to expected format
                equity_for_metrics = [(point[0], point[1]) for point in all_oos_equity]

                # Calculate metrics
                oos_metrics = backtester.calculate_metrics(equity_for_metrics, min_db, 'CC')

                print(f"[RollingOptimizer] Final OOS metrics calculated: CAGR={oos_metrics.get('cagr', 'N/A')}, Sharpe={oos_metrics.get('sharpe', 'N/A')}", file=sys.stderr)

            except Exception as e:
                import traceback
                print(f"[RollingOptimizer] Exception calculating metrics: {e}", file=sys.stderr)
                print(f"[RollingOptimizer]   Traceback: {traceback.format_exc()}", file=sys.stderr)
                oos_metrics = {
                    'message': f"Metrics calculation error: {str(e)}"
                }
        else:
            oos_metrics = {
                'message': 'No equity curve points generated across all OOS periods'
            }

        elapsed_time = time.perf_counter() - start_time

        print(f"\n[RollingOptimizer] === COMPLETE ===", file=sys.stderr)
        print(f"  Total time: {elapsed_time:.2f}s", file=sys.stderr)
        print(f"  Periods tested: {len(selected_branches)}", file=sys.stderr)
        print(f"  Total OOS equity points: {len(all_oos_equity)}", file=sys.stderr)
        print(f"  Final CAGR: {oos_metrics.get('cagr', 'N/A')}", file=sys.stderr)

        return {
            'success': True,
            'validTickers': valid_tickers,
            'tickerStartDates': {k: v.strftime('%Y-%m-%d') for k, v in ticker_start_dates.items()},
            'oosPeriodCount': len(oos_periods),
            'selectedBranches': selected_branches,
            'oosEquityCurve': all_oos_equity,  # Return full equity curve
            'oosMetrics': oos_metrics,
            'elapsedSeconds': elapsed_time,
            'branchCount': len(branches)  # Add total branches tested per period
        }


def main():
    """
    Main entry point for rolling optimizer (called from Node.js)
    """
    if len(sys.argv) < 2:
        print(json.dumps({
            'success': False,
            'error': 'Usage: rolling_optimizer.py <config_json>'
        }))
        sys.exit(1)

    try:
        # Parse config from JSON argument
        config = json.loads(sys.argv[1])

        # Get data directory from config or use default
        data_dir = config.get('dataDir', '../data/parquet')

        # Create optimizer
        optimizer = RollingOptimizer(data_dir)

        # Run rolling optimization
        result = optimizer.run_rolling_optimization(config)

        # Output results as JSON (flush to ensure it's sent)
        print(json.dumps(result), flush=True)
        sys.stdout.flush()

    except Exception as e:
        import traceback
        error_output = json.dumps({
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc()
        })
        print(error_output, file=sys.stderr, flush=True)
        sys.stderr.flush()
        sys.exit(1)


if __name__ == '__main__':
    main()
