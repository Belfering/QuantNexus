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

        # Filter to only enabled ranges and exclude ticker_list type
        enabled_ranges = [r for r in parameter_ranges if r.get('enabled', True) and r.get('type') != 'ticker_list']

        if len(enabled_ranges) == 0:
            # No parameter ranges - return base tree only
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
            self._find_and_update_condition(node, condition_id, field, value)

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
                    cond[field] = value
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

    def _extract_node_structure(self, node: Dict, result: Dict = None) -> Dict:
        """
        Recursively extract node structure for display in results table.
        Returns dict of {nodeId: {kind, indicator, threshold, window, positions, ...}}
        """
        if result is None:
            result = {}

        node_id = node.get('id')
        kind = node.get('kind')

        # Extract nodes with optimized parameters or positions
        if kind == 'indicator' and node.get('conditions'):
            for cond in node['conditions']:
                cond_id = cond.get('id')
                result[cond_id] = {
                    'kind': 'indicator',
                    'indicator': cond.get('metric', ''),  # Frontend uses 'metric'
                    'operator': cond.get('comparator', ''),  # Frontend uses 'comparator'
                    'threshold': cond.get('threshold'),
                    'window': cond.get('window')
                }
        elif kind == 'function':
            result[node_id] = {
                'kind': 'function',
                'rank': node.get('rank', ''),
                'bottom': node.get('bottom'),
                'metric': node.get('metric', ''),
                'window': node.get('window')
            }
        elif kind == 'position' and node.get('positions'):
            result[node_id] = {
                'kind': 'position',
                'positions': node.get('positions', [])
            }

        # Recurse into children
        if node.get('children'):
            for slot_children in node['children'].values():
                if isinstance(slot_children, list):
                    for child in slot_children:
                        if child:
                            self._extract_node_structure(child, result)

        return result

    def run_rolling_optimization(
        self,
        config: Dict
    ) -> Dict:
        """
        Run rolling optimization with "run once and split" algorithm.

        NEW ALGORITHM:
        - Run each branch ONCE across entire time period
        - Split trade log by calendar year
        - Calculate "Rank By" metric for each year
        - Store per-year metrics for ALL branches (not just winners)

        Args:
            config: Configuration dictionary with:
                - tickers: List of ticker symbols
                - splitConfig: Split configuration (minWarmUpYears, rankBy)
                - tree: FlowNode tree structure
                - parameterRanges: List of parameter ranges for optimization

        Returns:
            Dictionary with all branches and their yearly metrics
        """
        start_time = time.perf_counter()

        # Extract configuration
        tickers = config['tickers']
        split_config = config.get('splitConfig', {})
        min_warmup_years = split_config.get('minWarmUpYears', 3)
        rank_by = split_config.get('rankBy', 'CAGR')

        print(f"\n[RollingOptimizer] Starting rolling optimization (run once and split)", file=sys.stderr)
        print(f"  Min Warm-Up Years: {min_warmup_years}", file=sys.stderr)
        print(f"  Rank By: {rank_by}", file=sys.stderr)
        print(f"  Input Tickers: {len(tickers)}", file=sys.stderr)

        # Step 1: Calculate minimum start year
        current_year = datetime.now().year
        min_start_year = current_year - min_warmup_years

        # Step 2: Pre-filter tickers by start date
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

        # Step 3: Calculate start year (earliest ticker + warmup)
        # Enforce 1993 minimum year to avoid unreliable pre-1993 data
        earliest_ticker_date = min(ticker_start_dates.values())
        earliest_ticker_year = max(1993, earliest_ticker_date.year)

        # Check if earliest ticker starts exactly on January 1st
        # If not, we need an extra year to ensure 3 FULL years of warm-up
        is_january_1st = (earliest_ticker_date.month == 1 and earliest_ticker_date.day == 1)
        extra_year = 0 if is_january_1st else 1

        is_start_year = earliest_ticker_year + min_warmup_years + extra_year

        print(f"[RollingOptimizer] Earliest ticker year: {earliest_ticker_year}", file=sys.stderr)
        print(f"[RollingOptimizer] Earliest ticker date: {earliest_ticker_date.strftime('%Y-%m-%d')}", file=sys.stderr)
        print(f"[RollingOptimizer] Starts on Jan 1st: {is_january_1st}", file=sys.stderr)
        print(f"[RollingOptimizer] IS start year: {is_start_year} (warm-up + {'0' if is_january_1st else '1'} overflow year)", file=sys.stderr)
        print(f"[RollingOptimizer] Current year: {current_year}", file=sys.stderr)

        # Step 4: Generate year range for splitting - include ALL years from earliest ticker year
        # This includes both warm-up years AND IS years in the metrics
        year_range = list(range(earliest_ticker_year, current_year + 1))
        print(f"[RollingOptimizer] Will calculate metrics for {len(year_range)} years: {earliest_ticker_year}-{current_year}", file=sys.stderr)

        # Step 5: Generate parameter branches from tree
        tree = config.get('tree')
        parameter_ranges = config.get('parameterRanges', [])

        if not tree:
            return {
                'success': False,
                'error': 'No tree provided in configuration'
            }

        print(f"[RollingOptimizer] Generating branches from {len(parameter_ranges)} parameter ranges...", file=sys.stderr)

        # Generate branches from parameter ranges
        # DEBUG: Log the original tree structure to see what conditions look like
        print(f"\n[DEBUG] Original tree structure (first 2000 chars):", file=sys.stderr)
        tree_str = json.dumps(tree, indent=2)
        print(f"{tree_str[:2000]}...", file=sys.stderr)

        branches = self.generate_branches(tree, parameter_ranges)
        print(f"[RollingOptimizer] Generated {len(branches)} branches", file=sys.stderr)

        # DEBUG: Log first branch's tree after generation
        if len(branches) > 0:
            first_branch_tree = branches[0]['tree']
            print(f"\n[DEBUG] First branch tree after generation (first 2000 chars):", file=sys.stderr)
            branch_str = json.dumps(first_branch_tree, indent=2)
            print(f"{branch_str[:2000]}...", file=sys.stderr)

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
        print(f"[RollingOptimizer] Will rank branches by: {rank_by} (backend key: {metric_key})", file=sys.stderr)

        # Step 6: Run each branch ONCE and split by year
        print(f"\n[RollingOptimizer] Starting branch testing...", file=sys.stderr)

        from backtester import Backtester
        backtester = Backtester(str(self.parquet_dir))

        branch_results = []

        for branch_idx, branch in enumerate(branches):
            print(f"[RollingOptimizer] Testing branch {branch_idx}/{len(branches)}...", file=sys.stderr)

            # DEBUG: Comprehensive branch info
            print(f"\n[DEBUG] Branch {branch_idx} Details:", file=sys.stderr)
            print(f"  Branch Structure: {json.dumps(branch['tree'], indent=2)[:500]}...", file=sys.stderr)
            print(f"  Available Ticker Dates:", file=sys.stderr)
            for ticker, start_date in ticker_start_dates.items():
                print(f"    {ticker}: {start_date.strftime('%Y-%m-%d')} to present", file=sys.stderr)
            print(f"  Backtest Date Range: {is_start_year}-01-01 to {current_year}-12-31", file=sys.stderr)
            print(f"", file=sys.stderr)

            try:
                # Run backtest ONCE across entire time period
                result = backtester.run_backtest(
                    branch['tree'],
                    {
                        'mode': 'CC',
                        'startDate': f"{is_start_year}-01-01",
                        'endDate': f"{current_year}-12-31",
                        'costBps': 1.0,
                        'splitConfig': {
                            'enabled': False,
                            'strategy': 'chronological'
                        }
                    }
                )

                # Backtester returns dict with metrics/equityCurve, no 'success' key
                # Check for error condition (no equity curve or empty)
                if 'error' in result:
                    print(f"[RollingOptimizer]   ✗ Branch {branch_idx} failed: {result.get('error')}", file=sys.stderr)
                    continue

                # Get full equity curve (list of [timestamp, equity] pairs)
                equity_curve = result.get('equityCurve', [])

                # DEBUG: Log equity curve info for first branch
                if branch_idx == 0:
                    print(f"\n[DEBUG] Branch {branch_idx} equity curve info:", file=sys.stderr)
                    print(f"  Equity curve length: {len(equity_curve)}", file=sys.stderr)
                    if len(equity_curve) > 0:
                        print(f"  First point: {equity_curve[0]}", file=sys.stderr)
                        print(f"  Last point: {equity_curve[-1]}", file=sys.stderr)
                    sys.stderr.flush()

                if len(equity_curve) == 0:
                    print(f"[RollingOptimizer]   ✗ Branch {branch_idx} returned empty equity curve", file=sys.stderr)
                    continue

                # Convert equity curve to DataFrame for easier filtering
                equity_df = pd.DataFrame(equity_curve, columns=['timestamp', 'equity'])
                equity_df['date'] = pd.to_datetime(equity_df['timestamp'], unit='s')  # Fixed: timestamps are in seconds, not ms
                equity_df['year'] = equity_df['date'].dt.year

                # DEBUG: Log DataFrame info for first branch
                if branch_idx == 0:
                    print(f"\n[DEBUG] Branch {branch_idx} DataFrame info:", file=sys.stderr)
                    print(f"  DataFrame shape: {equity_df.shape}", file=sys.stderr)
                    print(f"  Unique years: {sorted(equity_df['year'].unique())}", file=sys.stderr)
                    print(f"  Year range to process: {year_range[0]} to {year_range[-1]}", file=sys.stderr)
                    sys.stderr.flush()

                # Split by year and calculate metric for each year
                yearly_metrics = {}

                for year in year_range:
                    year_data = equity_df[equity_df['year'] == year]

                    if len(year_data) == 0:
                        # No data for this year
                        yearly_metrics[str(year)] = None
                        continue

                    # Calculate metric for this year
                    year_equity = year_data[['timestamp', 'equity']].values.tolist()

                    # DEBUG: Log year data for first branch, first year
                    if branch_idx == 0 and year == year_range[0]:
                        print(f"\n[DEBUG] Year {year} processing:", file=sys.stderr)
                        print(f"  Year data shape: {year_data.shape}", file=sys.stderr)
                        print(f"  Year equity length: {len(year_equity)} points", file=sys.stderr)
                        print(f"  First equity point: {year_equity[0] if year_equity else 'None'}", file=sys.stderr)
                        print(f"  Last equity point: {year_equity[-1] if year_equity else 'None'}", file=sys.stderr)

                    # Create minimal db for metric calculation
                    year_timestamps = [int(t) for t, e in year_equity]
                    min_db = {
                        'dates': year_timestamps,
                        'close': {'SPY': [0] * len(year_timestamps)}
                    }

                    try:
                        year_metrics = backtester.calculate_metrics(year_equity, min_db, 'CC')
                        metric_value = year_metrics.get(metric_key)

                        # DEBUG: Log the metrics for first year and first branch
                        if branch_idx == 0 and year == year_range[0]:
                            print(f"[DEBUG] Year {year} calculated metrics:", file=sys.stderr)
                            print(f"  Full metrics dict: {year_metrics}", file=sys.stderr)
                            print(f"  Looking for metric_key: {metric_key}", file=sys.stderr)
                            print(f"  Extracted value: {metric_value}", file=sys.stderr)

                        yearly_metrics[str(year)] = metric_value
                    except Exception as e:
                        print(f"[RollingOptimizer]   Warning: Failed to calculate metrics for year {year}: {e}", file=sys.stderr)
                        import traceback
                        traceback.print_exc(file=sys.stderr)
                        yearly_metrics[str(year)] = None

                # Extract node structure from the branch tree
                parameter_values = self._extract_node_structure(branch['tree'])

                # Store branch result
                branch_results.append({
                    'branchId': branch_idx,
                    'parameterValues': parameter_values,
                    'isStartYear': is_start_year,
                    'yearlyMetrics': yearly_metrics,
                    'rankByMetric': rank_by
                })

                print(f"[RollingOptimizer]   ✓ Branch {branch_idx} complete ({len(yearly_metrics)} years)", file=sys.stderr)

            except Exception as e:
                import traceback
                print(f"[RollingOptimizer]   ✗ Branch {branch_idx} exception: {e}", file=sys.stderr)
                print(f"[RollingOptimizer]     Traceback: {traceback.format_exc()}", file=sys.stderr)
                continue

        elapsed_time = time.perf_counter() - start_time

        print(f"\n[RollingOptimizer] === COMPLETE ===", file=sys.stderr)
        print(f"  Total time: {elapsed_time:.2f}s", file=sys.stderr)
        print(f"  Branches tested: {len(branch_results)}/{len(branches)}", file=sys.stderr)
        print(f"  Years per branch: {len(year_range)}", file=sys.stderr)

        return {
            'success': True,
            'branches': branch_results,
            'jobMetadata': {
                'validTickers': valid_tickers,
                'tickerStartDates': {k: v.strftime('%Y-%m-%d') for k, v in ticker_start_dates.items()},
                'branchCount': len(branches)
            },
            'elapsedSeconds': elapsed_time
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
