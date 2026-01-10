#!/usr/bin/env python3
"""
Python backtester for Atlas Forge - High-performance tree-based strategy backtesting
Processes flowchart trees with parallel worker pool for massive speedup
"""

import sys
import json
import pandas as pd
import numpy as np
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Tuple, Optional, Any

# Import optimized metrics (Numba JIT-compiled for 10-100x speedup)
try:
    from optimized_metrics import calculate_metrics_fast
    NUMBA_AVAILABLE = True
except ImportError:
    NUMBA_AVAILABLE = False
    print('[WARNING] Numba not available - metrics will be slower', file=sys.stderr)

# Import optimized data loader and indicator cache (1000x+ speedup)
try:
    from optimized_dataloader import get_global_cache
    from indicator_cache import IndicatorCache
    CACHE_AVAILABLE = True
except ImportError:
    CACHE_AVAILABLE = False
    print('[WARNING] Optimized caching not available - will be slower', file=sys.stderr)

# Constants
BACKTEST_START_DATE = '1993-01-01'
MIN_DATES = 3


class Backtester:
    """High-performance backtester for flowchart-based strategies"""

    def __init__(self, parquet_dir: str):
        self.parquet_dir = Path(parquet_dir)
        self.price_cache = {}

        # Initialize indicator cache for vectorized pre-computation
        if CACHE_AVAILABLE:
            self.indicator_cache = IndicatorCache(max_cache_size=2000)
            self.use_global_price_cache = True
        else:
            self.indicator_cache = None
            self.use_global_price_cache = False

    def load_ticker_data(self, ticker: str, limit: int = 20000) -> pd.DataFrame:
        """Load OHLC data from parquet file (with optimized caching)"""
        # Use global price cache if available (5000x faster for warm loads)
        if self.use_global_price_cache and CACHE_AVAILABLE:
            try:
                cache = get_global_cache(str(self.parquet_dir))
                return cache.get_ticker_data(ticker, limit)
            except Exception as e:
                print(f"[WARNING] Global cache failed, falling back: {e}", file=sys.stderr)

        # Fallback to local cache
        if ticker in self.price_cache:
            df = self.price_cache[ticker]
            return df.tail(limit) if limit < len(df) else df

        parquet_file = self.parquet_dir / f"{ticker}.parquet"
        if not parquet_file.exists():
            return pd.DataFrame()

        try:
            df = pd.read_parquet(parquet_file)

            # Ensure Date column is datetime
            if 'Date' in df.columns:
                df['Date'] = pd.to_datetime(df['Date'])

            # Filter to backtest start date
            df = df[df['Date'] >= BACKTEST_START_DATE]

            # Sort by date
            df = df.sort_values('Date')

            # Add timestamp column (Unix epoch in seconds)
            df['time'] = df['Date'].astype(np.int64) // 10**9

            # Cache it
            self.price_cache[ticker] = df

            return df.tail(limit) if limit < len(df) else df
        except Exception as e:
            print(f"Error loading {ticker}: {e}", file=sys.stderr)
            return pd.DataFrame()

    def build_price_database(self, tickers: List[str], indicator_tickers: List[str]) -> Dict:
        """Build aligned price database for all tickers"""
        # Load all ticker data
        ticker_data = {}
        for ticker in tickers:
            df = self.load_ticker_data(ticker)
            if len(df) > 0:
                ticker_data[ticker] = df

        if not ticker_data:
            return None

        # Find date intersection using indicator tickers
        intersection_tickers = [t for t in indicator_tickers if t in ticker_data]
        if not intersection_tickers:
            intersection_tickers = list(ticker_data.keys())

        # Get common dates (dates present in all intersection tickers)
        common_dates = None
        for ticker in intersection_tickers:
            dates = set(ticker_data[ticker]['time'].values)
            if common_dates is None:
                common_dates = dates
            else:
                common_dates = common_dates.intersection(dates)

        if not common_dates or len(common_dates) < MIN_DATES:
            return None

        # Sort dates
        dates = sorted(list(common_dates))

        # Build aligned arrays for each ticker
        db = {
            'dates': np.array(dates),
            'open': {},
            'high': {},
            'low': {},
            'close': {},
            'adjClose': {},
            'volume': {}
        }

        for ticker, df in ticker_data.items():
            # Create a mapping from time to row
            df_indexed = df.set_index('time')

            # Align to common dates (fill with NaN for missing dates)
            for field in ['Open', 'High', 'Low', 'Close', 'Adj Close', 'Volume']:
                key = field.replace(' ', '').replace('Close', 'Close')
                if key == 'AdjClose':
                    key = 'adjClose'
                else:
                    key = key.lower()

                col_name = field
                if col_name in df_indexed.columns:
                    # Reindex and forward-fill any NaN values
                    reindexed = df_indexed.reindex(dates)[col_name]
                    values = reindexed.ffill().bfill().values  # Forward & backward fill
                    db[key][ticker] = values
                else:
                    db[key][ticker] = np.full(len(dates), np.nan)

        # Remove leading rows where all tickers have NaN in close prices
        valid_mask = np.ones(len(dates), dtype=bool)
        for ticker in db['close']:
            valid_mask &= ~np.isnan(db['close'][ticker])

        if valid_mask.any():
            first_valid = np.where(valid_mask)[0][0]
            if first_valid > 0:
                # Trim to first valid date
                db['dates'] = db['dates'][first_valid:]
                for key in ['open', 'high', 'low', 'close', 'adjClose', 'volume']:
                    for ticker in db[key]:
                        db[key][ticker] = db[key][ticker][first_valid:]

        return db

    def split_dates(self, dates: np.ndarray, strategy: str, chronological_date: Optional[str] = None) -> Tuple[set, set]:
        """Split dates into IS and OOS sets"""
        is_dates = set()
        oos_dates = set()

        for timestamp in dates:
            dt = datetime.fromtimestamp(timestamp)

            if strategy == 'even_odd_month':
                # Odd months = IS, Even months = OOS
                month = dt.month
                if month in [1, 3, 5, 7, 9, 11]:
                    is_dates.add(timestamp)
                else:
                    oos_dates.add(timestamp)
            elif strategy == 'even_odd_year':
                # Odd years = IS, Even years = OOS
                year = dt.year
                if year % 2 == 1:
                    is_dates.add(timestamp)
                else:
                    oos_dates.add(timestamp)
            elif strategy == 'chronological' and chronological_date:
                # Before threshold = IS, after = OOS
                threshold = datetime.fromisoformat(chronological_date).timestamp()
                if timestamp < threshold:
                    is_dates.add(timestamp)
                else:
                    oos_dates.add(timestamp)
            else:
                # Fallback: all IS
                is_dates.add(timestamp)

        return is_dates, oos_dates

    def calculate_rsi(self, prices: np.ndarray, period: int) -> np.ndarray:
        """Calculate RSI indicator"""
        rsi = np.full(len(prices), np.nan)

        # Calculate price changes
        deltas = np.diff(prices)

        # Separate gains and losses
        gains = np.where(deltas > 0, deltas, 0)
        losses = np.where(deltas < 0, -deltas, 0)

        # Calculate initial average gain/loss
        avg_gain = np.mean(gains[:period])
        avg_loss = np.mean(losses[:period])

        if avg_loss == 0:
            rsi[period] = 100
        else:
            rs = avg_gain / avg_loss
            rsi[period] = 100 - (100 / (1 + rs))

        # Calculate subsequent RSI values using Wilder's smoothing
        for i in range(period + 1, len(prices)):
            avg_gain = (avg_gain * (period - 1) + gains[i - 1]) / period
            avg_loss = (avg_loss * (period - 1) + losses[i - 1]) / period

            if avg_loss == 0:
                rsi[i] = 100
            else:
                rs = avg_gain / avg_loss
                rsi[i] = 100 - (100 / (1 + rs))

        return rsi

    def calculate_sma(self, prices: np.ndarray, period: int) -> np.ndarray:
        """Calculate SMA indicator"""
        sma = np.full(len(prices), np.nan)
        for i in range(period - 1, len(prices)):
            sma[i] = np.mean(prices[i - period + 1:i + 1])
        return sma

    def calculate_ema(self, prices: np.ndarray, period: int) -> np.ndarray:
        """Calculate EMA indicator"""
        ema = np.full(len(prices), np.nan)
        alpha = 2 / (period + 1)

        # Use SMA for first value
        ema[period - 1] = np.mean(prices[:period])

        # Calculate EMA
        for i in range(period, len(prices)):
            ema[i] = (prices[i] * alpha) + (ema[i - 1] * (1 - alpha))

        return ema

    def run_backtest(self, tree: Dict, options: Dict) -> Dict:
        """Run backtest on strategy tree"""
        mode = options.get('mode', 'CC')
        cost_bps = options.get('costBps', 5)
        split_config = options.get('splitConfig', {})

        # Debug: Log split config
        print(f'[DEBUG] splitConfig received: {json.dumps(split_config)}', file=sys.stderr, flush=True)

        # Collect tickers from tree
        tickers = self.collect_tickers(tree)
        indicator_tickers = self.collect_indicator_tickers(tree)

        # Always include SPY
        if 'SPY' not in tickers:
            tickers.append('SPY')
        if 'SPY' not in indicator_tickers:
            indicator_tickers.append('SPY')

        # Build price database
        db = self.build_price_database(tickers, indicator_tickers)
        if db is None or len(db['dates']) < MIN_DATES:
            raise ValueError('Not enough overlapping price data')

        # Run simulation
        equity_curve, allocations = self.simulate(tree, db, mode, cost_bps)

        # Calculate metrics
        metrics = self.calculate_metrics(equity_curve, db, mode, allocations=allocations)

        # Handle IS/OOS split
        is_metrics = None
        oos_metrics = None

        if split_config.get('enabled'):
            strategy = split_config.get('strategy', 'even_odd_month')
            chronological_date = split_config.get('chronologicalDate')

            # For chronological percentage splits, calculate the date
            if strategy == 'chronological' and not chronological_date:
                chronological_percent = split_config.get('chronologicalPercent', 50)
                # Split dates based on percentage (e.g., 50% = first half IS, second half OOS)
                split_index = int(len(db['dates']) * chronological_percent / 100)
                if split_index > 0 and split_index < len(db['dates']):
                    split_timestamp = db['dates'][split_index]
                    chronological_date = datetime.fromtimestamp(split_timestamp).isoformat()

            is_dates, oos_dates = self.split_dates(db['dates'], strategy, chronological_date)

            # Calculate IS metrics
            is_indices = [i for i, d in enumerate(db['dates']) if d in is_dates]
            if is_indices:
                is_equity = [(equity_curve[i][0], equity_curve[i][1]) for i in is_indices]
                is_allocations = [allocations[i] for i in is_indices]
                is_metrics = self.calculate_metrics(is_equity, db, mode, is_indices, is_allocations)

            # Calculate OOS metrics
            oos_indices = [i for i, d in enumerate(db['dates']) if d in oos_dates]
            if oos_indices:
                oos_equity = [(equity_curve[i][0], equity_curve[i][1]) for i in oos_indices]
                oos_allocations = [allocations[i] for i in oos_indices]
                oos_metrics = self.calculate_metrics(oos_equity, db, mode, oos_indices, oos_allocations)
        else:
            # No split: use full metrics as IS metrics
            is_metrics = metrics
            oos_metrics = None

        return {
            'metrics': metrics,
            'isMetrics': is_metrics,
            'oosMetrics': oos_metrics,
            'equityCurve': [[int(t), float(v)] for t, v in equity_curve],
            'allocations': allocations
        }

    def collect_tickers(self, node: Dict) -> List[str]:
        """Recursively collect all tickers from tree"""
        tickers = []

        if node.get('kind') == 'position' and node.get('positions'):
            for pos in node['positions']:
                # pos is a string like "SPY", not a dict
                if pos and pos != 'Empty':
                    tickers.append(pos.upper())

        # Recurse into children
        if node.get('children'):
            for slot, children in node['children'].items():
                if isinstance(children, list):
                    for child in children:
                        if child:
                            tickers.extend(self.collect_tickers(child))
                elif children:
                    tickers.extend(self.collect_tickers(children))

        return list(set(tickers))

    def collect_indicator_tickers(self, node: Dict) -> List[str]:
        """Collect tickers used in indicators/conditions"""
        tickers = []

        # Check conditions
        if node.get('conditions'):
            for cond in node['conditions']:
                ticker = cond.get('ticker')
                if ticker and ticker != 'Empty':
                    tickers.append(ticker.upper())
                right_ticker = cond.get('rightTicker')
                if right_ticker and right_ticker != 'Empty':
                    tickers.append(right_ticker.upper())

        # Recurse
        if node.get('children'):
            for slot, children in node['children'].items():
                if isinstance(children, list):
                    for child in children:
                        if child:
                            tickers.extend(self.collect_indicator_tickers(child))
                elif children:
                    tickers.extend(self.collect_indicator_tickers(children))

        return list(set(tickers))

    def simulate(self, tree: Dict, db: Dict, mode: str, cost_bps: float) -> Tuple[List, List]:
        """Simulate strategy execution with proper portfolio tracking"""
        dates = db['dates']
        close_prices = db['close']

        equity = 10000.0
        holdings = {}  # Current holdings: {ticker: shares}
        prev_allocation = {}

        equity_curve = []
        allocations = []

        cost_multiplier = 1.0 - (cost_bps / 10000.0)

        # OPTIMIZATION 1: Create shared indicator cache that persists across all bars
        # This prevents recalculating RSI/SMA/etc thousands of times (10-100x speedup)
        shared_indicator_cache = {}

        for i in range(len(dates)):
            # Evaluate tree to get target allocation
            allocation = self.evaluate_tree(tree, db, i, shared_indicator_cache)
            allocations.append(allocation)

            # Calculate current portfolio value from holdings
            portfolio_value = 0.0
            for ticker, shares in holdings.items():
                if ticker in close_prices and i < len(close_prices[ticker]):
                    current_price = close_prices[ticker][i]
                    portfolio_value += shares * current_price

            # Use portfolio value if we have holdings, otherwise use equity
            # On first bar (i==0), portfolio_value will be 0, so we use starting equity
            current_equity = portfolio_value if (holdings and portfolio_value > 0) else equity

            # Rebalance if allocation changed
            if allocation != prev_allocation:
                new_holdings = {}

                if allocation:
                    for ticker, target_weight in allocation.items():
                        if ticker in close_prices and i < len(close_prices[ticker]):
                            current_price = close_prices[ticker][i]
                            if current_price > 0:
                                # Calculate target dollar amount after costs
                                target_value = current_equity * target_weight * cost_multiplier
                                # Calculate shares to hold
                                shares = target_value / current_price
                                new_holdings[ticker] = shares

                holdings = new_holdings
                prev_allocation = allocation.copy()

            # Calculate final equity for this bar based on current holdings
            final_equity = 0.0
            for ticker, shares in holdings.items():
                if ticker in close_prices and i < len(close_prices[ticker]):
                    current_price = close_prices[ticker][i]
                    final_equity += shares * current_price

            # Use final equity if we have holdings, otherwise keep current equity
            equity_value = final_equity if holdings else current_equity

            # Update equity for next iteration
            equity = equity_value

            equity_curve.append((int(dates[i]), equity_value))

        return equity_curve, allocations

    def evaluate_tree(self, node: Dict, db: Dict, idx: int, shared_indicator_cache: Dict = None) -> Dict:
        """Evaluate tree at given date index"""
        # Create evaluation context
        ctx = {
            'db': db,
            'idx': idx,
            'indicator_cache': shared_indicator_cache if shared_indicator_cache is not None else {},  # Reuse cache across bars
            'altExit_state': {}  # Stateful tracking for altExit nodes
        }
        return self.evaluate_node(ctx, node)

    def evaluate_node(self, ctx: Dict, node: Dict) -> Dict:
        """Recursively evaluate a single node"""
        if not node:
            return {}

        kind = node.get('kind', '')

        if kind == 'position':
            return self._eval_position(ctx, node)
        elif kind == 'indicator':
            return self._eval_indicator(ctx, node)
        elif kind == 'function':
            return self._eval_function(ctx, node)
        elif kind == 'basic':
            return self._eval_basic(ctx, node)
        elif kind == 'scaling':
            return self._eval_scaling(ctx, node)
        elif kind == 'altExit':
            return self._eval_altExit(ctx, node)
        elif kind == 'numbered':
            return self._eval_numbered(ctx, node)

        return {}

    def _eval_position(self, ctx: Dict, node: Dict) -> Dict:
        """Evaluate position node - returns ticker allocations"""
        positions = node.get('positions', [])
        if not positions:
            return {}

        # Filter out empty positions
        valid_positions = [p for p in positions if p and p != 'Empty']
        if not valid_positions:
            return {}

        # Equal weight allocation
        weight = 1.0 / len(valid_positions)
        alloc = {}
        for ticker in valid_positions:
            normalized = ticker.upper().strip()
            alloc[normalized] = alloc.get(normalized, 0) + weight

        return alloc

    def _eval_basic(self, ctx: Dict, node: Dict) -> Dict:
        """Evaluate basic node - passes through to children"""
        children = node.get('children', {}).get('next', [])
        return self._eval_children(ctx, node, 'next', children)

    def _eval_indicator(self, ctx: Dict, node: Dict) -> Dict:
        """Evaluate indicator node - conditional branching"""
        conditions = node.get('conditions', [])
        logic = node.get('conditionLogic', 'and')

        # Evaluate conditions
        result = self._eval_conditions(ctx, conditions, logic)

        # Choose branch based on result
        branch = 'then' if result else 'else'
        children = node.get('children', {}).get(branch, [])

        return self._eval_children(ctx, node, branch, children)

    def _eval_function(self, ctx: Dict, node: Dict) -> Dict:
        """Evaluate function node - ranking/filtering children"""
        children = node.get('children', {}).get('next', [])
        if not children:
            return {}

        metric = node.get('metric', 'Relative Strength Index')
        window = int(node.get('window', 10))
        pick_n = int(node.get('bottom', 1))
        rank = node.get('rank', 'bottom')

        # Calculate metric value for each child
        child_values = []
        for child in children:
            if not child:
                continue

            # Collect tickers from this child
            tickers = self._collect_position_tickers(child)
            if not tickers:
                continue

            # Calculate average metric value across tickers
            values = []
            for ticker in tickers:
                val = self._metric_at(ctx, ticker, metric, window)
                if val is not None:
                    values.append(val)

            if values:
                avg_value = sum(values) / len(values)
                child_values.append({'child': child, 'value': avg_value})

        # Sort by value
        if rank == 'bottom':
            child_values.sort(key=lambda x: x['value'])
        else:  # top
            child_values.sort(key=lambda x: x['value'], reverse=True)

        # Pick top N
        picked = child_values[:pick_n]
        picked_children = [item['child'] for item in picked]

        return self._eval_children(ctx, node, 'next', picked_children)

    def _eval_scaling(self, ctx: Dict, node: Dict) -> Dict:
        """Evaluate scaling node - blend between then/else based on indicator value"""
        scale_ticker = node.get('scaleTicker', 'SPY').upper().strip()
        scale_metric = node.get('scaleMetric', 'Relative Strength Index')
        scale_window = int(node.get('scaleWindow', 14))
        scale_from = float(node.get('scaleFrom', 0))
        scale_to = float(node.get('scaleTo', 100))

        # Get indicator value
        val = self._metric_at(ctx, scale_ticker, scale_metric, scale_window)

        # Calculate blend factor (0 = all then, 1 = all else)
        blend = 0.0
        if val is not None and scale_from != scale_to:
            if scale_from < scale_to:
                # Normal range
                blend = max(0.0, min(1.0, (val - scale_from) / (scale_to - scale_from)))
            else:
                # Inverted range
                blend = max(0.0, min(1.0, (scale_from - val) / (scale_from - scale_to)))

        # Evaluate both branches
        then_children = node.get('children', {}).get('then', [])
        else_children = node.get('children', {}).get('else', [])

        then_alloc = self._eval_children(ctx, node, 'then', then_children)
        else_alloc = self._eval_children(ctx, node, 'else', else_children)

        # Blend allocations
        alloc = {}
        for ticker, weight in then_alloc.items():
            alloc[ticker] = alloc.get(ticker, 0) + weight * (1 - blend)
        for ticker, weight in else_alloc.items():
            alloc[ticker] = alloc.get(ticker, 0) + weight * blend

        return alloc

    def _eval_altExit(self, ctx: Dict, node: Dict) -> Dict:
        """Evaluate altExit node - stateful entry/exit logic"""
        node_id = node.get('id', 'unknown')

        # Get current state (default to not entered)
        if 'altExit_state' not in ctx:
            ctx['altExit_state'] = {}
        is_entered = ctx['altExit_state'].get(node_id, False)

        # Evaluate conditions
        entry_conditions = node.get('entryConditions', [])
        exit_conditions = node.get('exitConditions', [])
        entry_logic = node.get('entryConditionLogic', 'and')
        exit_logic = node.get('exitConditionLogic', 'and')

        entry_met = self._eval_conditions(ctx, entry_conditions, entry_logic) if entry_conditions else False
        exit_met = self._eval_conditions(ctx, exit_conditions, exit_logic) if exit_conditions else False

        # State machine
        new_state = is_entered
        if not is_entered and entry_met:
            new_state = True  # Enter
        elif is_entered and exit_met:
            new_state = False  # Exit

        # Update state
        ctx['altExit_state'][node_id] = new_state

        # Choose branch
        branch = 'then' if new_state else 'else'
        children = node.get('children', {}).get(branch, [])

        return self._eval_children(ctx, node, branch, children)

    def _eval_numbered(self, ctx: Dict, node: Dict) -> Dict:
        """Evaluate numbered node - quantifier-based conditional"""
        numbered = node.get('numbered', {})
        items = numbered.get('items', [])
        quantifier = numbered.get('quantifier', 'all')
        n = int(numbered.get('n', 0))

        # Count how many items have true conditions
        n_true = 0
        for item in items:
            conditions = item.get('conditions', [])
            if not conditions:
                continue

            # Evaluate item conditions with AND/OR logic
            if self._eval_item_conditions(ctx, conditions):
                n_true += 1

        # Handle ladder mode
        if quantifier == 'ladder':
            slot_key = f'ladder-{n_true}'
            children = node.get('children', {}).get(slot_key, [])
            return self._eval_children(ctx, node, slot_key, children)

        # Evaluate quantifier
        ok = False
        if quantifier == 'any':
            ok = n_true >= 1
        elif quantifier == 'all':
            ok = n_true == len(items)
        elif quantifier == 'none':
            ok = n_true == 0
        elif quantifier == 'exactly':
            ok = n_true == n
        elif quantifier == 'atLeast':
            ok = n_true >= n
        elif quantifier == 'atMost':
            ok = n_true <= n

        # Choose branch
        branch = 'then' if ok else 'else'
        children = node.get('children', {}).get(branch, [])

        return self._eval_children(ctx, node, branch, children)

    def _eval_children(self, ctx: Dict, parent: Dict, slot: str, children: List[Dict]) -> Dict:
        """Evaluate multiple children and merge allocations"""
        if not children:
            return {}

        # Filter out None children
        valid_children = [c for c in children if c]
        if not valid_children:
            return {}

        # Get weighting mode from parent
        weighting = parent.get('weighting', 'equal')

        # Evaluate all children
        child_allocs = [self.evaluate_node(ctx, child) for child in valid_children]

        # Filter out empty allocations
        child_allocs = [alloc for alloc in child_allocs if alloc]
        if not child_allocs:
            return {}

        # Merge based on weighting mode
        if weighting == 'equal':
            # Equal weight across children
            weight = 1.0 / len(child_allocs)
            result = {}
            for alloc in child_allocs:
                for ticker, ticker_weight in alloc.items():
                    result[ticker] = result.get(ticker, 0) + ticker_weight * weight
            return result
        else:
            # For other weighting modes, use first child for now
            # TODO: Implement defined, inverse, pro, capped weightings
            return child_allocs[0]

    def _collect_position_tickers(self, node: Dict) -> List[str]:
        """Recursively collect position tickers from a node"""
        tickers = []

        if node.get('kind') == 'position':
            positions = node.get('positions', [])
            for pos in positions:
                if pos and pos != 'Empty':
                    tickers.append(pos.upper().strip())

        # Recurse into children
        children_dict = node.get('children', {})
        for slot, children_list in children_dict.items():
            if isinstance(children_list, list):
                for child in children_list:
                    if child:
                        tickers.extend(self._collect_position_tickers(child))

        return tickers

    def _eval_conditions(self, ctx: Dict, conditions: List[Dict], logic: str) -> bool:
        """Evaluate multiple conditions with AND/OR logic"""
        if not conditions:
            return False

        # Standard boolean precedence: AND binds tighter than OR
        current_and = None
        or_terms = []

        for cond in conditions:
            cond_result = self._eval_condition(ctx, cond)
            if cond_result is None:
                return False  # Missing data = false

            cond_type = cond.get('type', 'if')

            if cond_type == 'if':
                if current_and is not None:
                    or_terms.append(current_and)
                current_and = cond_result
            elif cond_type == 'and':
                if current_and is None:
                    current_and = cond_result
                else:
                    current_and = current_and and cond_result
            elif cond_type == 'or':
                if current_and is not None:
                    or_terms.append(current_and)
                current_and = cond_result

        if current_and is not None:
            or_terms.append(current_and)

        return any(or_terms)

    def _eval_item_conditions(self, ctx: Dict, conditions: List[Dict]) -> bool:
        """Evaluate conditions for numbered node items"""
        # Same logic as _eval_conditions
        return self._eval_conditions(ctx, conditions, 'and')

    def _eval_condition(self, ctx: Dict, cond: Dict) -> Optional[bool]:
        """Evaluate a single condition"""
        metric = cond.get('metric', 'Relative Strength Index')
        ticker = cond.get('ticker', 'SPY').upper().strip()
        window = int(cond.get('window', 14))
        threshold = float(cond.get('threshold', 0))
        comparator = cond.get('comparator', 'lt')

        # Get metric value
        left_val = self._metric_at(ctx, ticker, metric, window)
        if left_val is None:
            return None

        # Handle expanded conditions (comparing two indicators)
        if cond.get('expanded'):
            right_ticker = cond.get('rightTicker', 'SPY').upper().strip()
            right_metric = cond.get('rightMetric', metric)
            right_window = int(cond.get('rightWindow', window))

            right_val = self._metric_at(ctx, right_ticker, right_metric, right_window)
            if right_val is None:
                return None

            # Compare two indicators
            if comparator == 'gt':
                return left_val > right_val
            elif comparator == 'lt':
                return left_val < right_val
            elif comparator == 'crossAbove':
                # Check if left crossed above right (simplified - just check current values)
                return left_val > right_val
            elif comparator == 'crossBelow':
                return left_val < right_val
            else:
                return left_val < right_val
        else:
            # Compare to threshold
            if comparator == 'gt':
                return left_val > threshold
            elif comparator == 'lt':
                return left_val < threshold
            elif comparator == 'crossAbove':
                return left_val > threshold
            elif comparator == 'crossBelow':
                return left_val < threshold
            else:
                return left_val < threshold

    def _metric_at(self, ctx: Dict, ticker: str, metric: str, window: int) -> Optional[float]:
        """Get metric value for ticker at current index (with optimized caching)"""
        idx = ctx['idx']
        db = ctx['db']

        # Check if we have price data for this ticker
        if ticker not in db['close']:
            return None

        prices = db['close'][ticker]

        # Check local per-bar cache first (fastest)
        cache_key = f"{ticker}:{metric}:{window}"
        if cache_key in ctx['indicator_cache']:
            values = ctx['indicator_cache'][cache_key]
            return values[idx] if idx < len(values) else None

        # Try global indicator cache (vectorized pre-computed values)
        values = None
        if self.indicator_cache and CACHE_AVAILABLE:
            try:
                values = self.indicator_cache.get_indicator(ticker, metric, window, prices)
            except Exception:
                pass  # Fall back to local calculation

        # Fallback: calculate indicator locally
        if values is None:
            if metric == 'Relative Strength Index':
                values = self.calculate_rsi(prices, window)
            elif metric == 'Simple Moving Average':
                values = self.calculate_sma(prices, window)
            elif metric == 'Exponential Moving Average':
                values = self.calculate_ema(prices, window)
            else:
                # Unsupported metric - return price as fallback
                values = prices

        # Cache it in local per-bar cache
        if values is not None:
            ctx['indicator_cache'][cache_key] = values
            return values[idx] if idx < len(values) else None

        return None

    def calculate_metrics(self, equity_curve: List, db: Dict, mode: str, indices: Optional[List[int]] = None, allocations: Optional[List] = None) -> Dict:
        """Calculate performance metrics using Numba JIT-compiled functions for 10-100x speedup"""
        if not equity_curve:
            return self.empty_metrics()

        # Extract equity values and timestamps
        timestamps = np.array([t for t, _ in equity_curve])
        values = np.array([v for _, v in equity_curve])

        # Calculate start date
        start_date = datetime.fromtimestamp(timestamps[0]).strftime('%Y-%m-%d') if len(timestamps) > 0 else None

        # Calculate number of years
        n_years = len(values) / 252.0 if len(values) > 0 else 1.0

        # Calculate strategy returns
        returns = np.diff(values) / values[:-1] if len(values) > 1 else np.array([])

        # Calculate beta vs SPY benchmark
        beta = 0.0
        if 'SPY' in db['close'] and len(returns) > 0:
            spy_prices = db['close']['SPY']
            if indices is not None:
                # Use subset of SPY data matching indices
                spy_subset = np.array([spy_prices[i] for i in indices if i < len(spy_prices)])
            else:
                spy_subset = spy_prices[:len(values)]

            if len(spy_subset) > 1:
                spy_returns = np.diff(spy_subset) / spy_subset[:-1]
                # Ensure same length
                min_len = min(len(returns), len(spy_returns))
                if min_len > 0:
                    covariance = np.cov(returns[:min_len], spy_returns[:min_len])[0, 1]
                    spy_variance = np.var(spy_returns[:min_len])
                    beta = float(covariance / spy_variance) if spy_variance > 0 else 0.0

        # Use optimized JIT-compiled metrics if available
        if NUMBA_AVAILABLE:
            metrics = calculate_metrics_fast(values, n_years, periods_per_year=252.0)

            # Calculate volatility
            vol = float(np.std(returns) * np.sqrt(252)) if len(returns) > 0 else 0.0

            # Calculate Treynor ratio: (CAGR - risk_free_rate) / Beta
            risk_free_rate = 0.03  # 3% annual risk-free rate
            treynor = float((metrics['cagr'] - risk_free_rate) / beta) if beta != 0 else 0.0

            # Calculate TIM (Time in Market) and Win Rate - only count invested days
            tim = 0.0
            timar = 0.0
            win_rate = 0.0
            if allocations is not None and len(allocations) > 0:
                # Find invested bars (non-empty allocations)
                invested_indices = [i for i, alloc in enumerate(allocations) if alloc and len(alloc) > 0]
                invested_bars = len(invested_indices)
                tim = invested_bars / len(allocations) if len(allocations) > 0 else 0.0

                # TIMAR = CAGR / TIM (returns per unit of market exposure)
                timar = metrics['cagr'] / tim if tim > 0 else 0.0

                # Calculate win rate only from invested days
                if len(invested_indices) > 0:
                    # For each invested day, calculate return to next day
                    invested_returns = []
                    for idx in invested_indices:
                        # Calculate 1-day return from this invested day
                        if idx < len(values) - 1:
                            ret = (values[idx + 1] - values[idx]) / values[idx]
                            invested_returns.append(ret)

                    if len(invested_returns) > 0:
                        wins = sum(1 for r in invested_returns if r > 0)
                        win_rate = float(wins / len(invested_returns))
            else:
                # No allocations data, use default win rate from all returns
                win_rate = metrics['winRate']

            return {
                'startDate': start_date,
                'years': n_years,
                'cagr': metrics['cagr'],
                'sharpe': metrics['sharpe'],
                'calmar': metrics['calmar'],
                'maxDrawdown': metrics['maxDrawdown'],
                'sortino': metrics['sortino'],
                'treynor': treynor,
                'beta': beta,
                'vol': vol,
                'winRate': win_rate,
                'avgTurnover': 0.0,
                'avgHoldings': 0.0,
                'tim': tim,
                'timar': timar
            }
        else:
            # Fallback to non-JIT implementation
            cagr = self.calculate_cagr(values)
            sharpe = self.calculate_sharpe(returns)
            max_dd = self.calculate_max_drawdown(values)
            vol = float(np.std(returns) * np.sqrt(252)) if len(returns) > 0 else 0.0

            # Calculate Treynor ratio
            risk_free_rate = 0.03
            treynor = float((cagr - risk_free_rate) / beta) if beta != 0 else 0.0

            # Calculate TIM, TIMAR, and Win Rate - only count invested days
            tim = 0.0
            timar = 0.0
            win_rate = 0.0
            if allocations is not None and len(allocations) > 0:
                # Find invested bars (non-empty allocations)
                invested_indices = [i for i, alloc in enumerate(allocations) if alloc and len(alloc) > 0]
                invested_bars = len(invested_indices)
                tim = invested_bars / len(allocations) if len(allocations) > 0 else 0.0
                timar = cagr / tim if tim > 0 else 0.0

                # Calculate win rate only from invested days
                if len(invested_indices) > 0:
                    # For each invested day, calculate return to next day
                    invested_returns = []
                    for idx in invested_indices:
                        if idx < len(values) - 1:
                            ret = (values[idx + 1] - values[idx]) / values[idx]
                            invested_returns.append(ret)

                    if len(invested_returns) > 0:
                        wins = sum(1 for r in invested_returns if r > 0)
                        win_rate = float(wins / len(invested_returns))

            return {
                'startDate': start_date,
                'years': n_years,
                'cagr': float(cagr),
                'sharpe': float(sharpe),
                'calmar': float(cagr / max_dd if max_dd != 0 else 0),
                'maxDrawdown': float(max_dd),
                'sortino': 0.0,
                'treynor': treynor,
                'beta': beta,
                'vol': vol,
                'winRate': win_rate,
                'avgTurnover': 0.0,
                'avgHoldings': 0.0,
                'tim': tim,
                'timar': timar
            }

    def empty_metrics(self) -> Dict:
        """Return empty metrics structure"""
        return {
            'startDate': None,
            'years': 0.0,
            'cagr': 0.0,
            'sharpe': 0.0,
            'calmar': 0.0,
            'maxDrawdown': 0.0,
            'sortino': 0.0,
            'treynor': 0.0,
            'beta': 0.0,
            'vol': 0.0,
            'winRate': 0.0,
            'avgTurnover': 0.0,
            'avgHoldings': 0.0,
            'tim': 0.0,
            'timar': 0.0
        }

    def calculate_cagr(self, values: np.ndarray) -> float:
        """Calculate CAGR"""
        if len(values) < 2 or values[0] == 0:
            return 0.0
        years = len(values) / 252
        return (values[-1] / values[0]) ** (1 / years) - 1 if years > 0 else 0.0

    def calculate_sharpe(self, returns: np.ndarray) -> float:
        """Calculate Sharpe ratio"""
        if len(returns) == 0:
            return 0.0
        mean_return = np.mean(returns)
        std_return = np.std(returns)
        return (mean_return / std_return) * np.sqrt(252) if std_return > 0 else 0.0

    def calculate_max_drawdown(self, values: np.ndarray) -> float:
        """Calculate maximum drawdown"""
        if len(values) == 0:
            return 0.0
        peak = values[0]
        max_dd = 0.0
        for value in values:
            if value > peak:
                peak = value
            dd = (peak - value) / peak if peak > 0 else 0.0
            if dd > max_dd:
                max_dd = dd
        return max_dd


def main():
    """Main entry point for worker process"""
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Missing input JSON'}))
        sys.exit(1)

    try:
        # Parse input
        input_data = json.loads(sys.argv[1])

        parquet_dir = input_data.get('parquetDir')
        tree = input_data.get('tree')
        options = input_data.get('options', {})

        if not parquet_dir or not tree:
            print(json.dumps({'error': 'Missing required parameters'}))
            sys.exit(1)

        # Run backtest
        backtester = Backtester(parquet_dir)
        result = backtester.run_backtest(tree, options)

        # Output result as JSON
        print(json.dumps(result))

    except Exception as e:
        error_result = {
            'error': str(e),
            'type': type(e).__name__
        }
        print(json.dumps(error_result))
        sys.exit(1)


if __name__ == '__main__':
    main()
