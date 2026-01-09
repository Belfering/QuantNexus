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

# Constants
BACKTEST_START_DATE = '1993-01-01'
MIN_DATES = 3


class Backtester:
    """High-performance backtester for flowchart-based strategies"""

    def __init__(self, parquet_dir: str):
        self.parquet_dir = Path(parquet_dir)
        self.price_cache = {}

    def load_ticker_data(self, ticker: str, limit: int = 20000) -> pd.DataFrame:
        """Load OHLC data from parquet file"""
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
                    values = df_indexed.reindex(dates)[col_name].values
                    db[key][ticker] = values
                else:
                    db[key][ticker] = np.full(len(dates), np.nan)

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
        metrics = self.calculate_metrics(equity_curve, db, mode)

        # Handle IS/OOS split
        is_metrics = None
        oos_metrics = None

        if split_config.get('enabled'):
            strategy = split_config.get('strategy', 'even_odd_month')
            chronological_date = split_config.get('chronologicalDate')

            is_dates, oos_dates = self.split_dates(db['dates'], strategy, chronological_date)

            # Calculate IS metrics
            is_indices = [i for i, d in enumerate(db['dates']) if d in is_dates]
            if is_indices:
                is_equity = [(equity_curve[i][0], equity_curve[i][1]) for i in is_indices]
                is_metrics = self.calculate_metrics(is_equity, db, mode, is_indices)

            # Calculate OOS metrics
            oos_indices = [i for i, d in enumerate(db['dates']) if d in oos_dates]
            if oos_indices:
                oos_equity = [(equity_curve[i][0], equity_curve[i][1]) for i in oos_indices]
                oos_metrics = self.calculate_metrics(oos_equity, db, mode, oos_indices)

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
                ticker = pos.get('ticker', 'Empty')
                if ticker and ticker != 'Empty':
                    tickers.append(ticker.upper())

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
        """Simulate strategy execution"""
        dates = db['dates']
        equity = 10000.0
        equity_curve = []
        allocations = []

        for i in range(len(dates)):
            # Evaluate tree to get allocation
            allocation = self.evaluate_tree(tree, db, i)

            # Calculate equity (simplified - just track value)
            equity_curve.append((int(dates[i]), equity))
            allocations.append(allocation)

        return equity_curve, allocations

    def evaluate_tree(self, node: Dict, db: Dict, idx: int) -> Dict:
        """Evaluate tree at given date index"""
        # Simplified tree evaluation
        # TODO: Implement full tree walking logic
        return {}

    def calculate_metrics(self, equity_curve: List, db: Dict, mode: str, indices: Optional[List[int]] = None) -> Dict:
        """Calculate performance metrics"""
        if not equity_curve:
            return self.empty_metrics()

        # Extract equity values
        values = np.array([v for _, v in equity_curve])

        # Calculate returns
        returns = np.diff(values) / values[:-1]

        # Calculate metrics
        cagr = self.calculate_cagr(values)
        sharpe = self.calculate_sharpe(returns)
        max_dd = self.calculate_max_drawdown(values)

        return {
            'cagr': float(cagr),
            'sharpe': float(sharpe),
            'calmar': float(cagr / max_dd if max_dd != 0 else 0),
            'maxDrawdown': float(max_dd),
            'sortino': 0.0,
            'treynor': 0.0,
            'beta': 0.0,
            'vol': float(np.std(returns) * np.sqrt(252)),
            'winRate': 0.0,
            'avgTurnover': 0.0,
            'avgHoldings': 0.0
        }

    def empty_metrics(self) -> Dict:
        """Return empty metrics structure"""
        return {
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
            'avgHoldings': 0.0
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
