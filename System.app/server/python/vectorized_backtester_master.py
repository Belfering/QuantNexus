"""
Vectorized Backtester with Indicator Pre-Computation

This module provides ultra-fast backtesting using:
- Pre-computed indicator values for ALL periods (cached)
- Vectorized threshold comparisons (NumPy boolean indexing)
- Numba-JIT metrics calculation
- Batch processing of branches

Performance target: 100-500 branches/second (10-50x faster than naive approach)
"""

import numpy as np
import pandas as pd
from ta.momentum import RSIIndicator
from ta.trend import SMAIndicator, EMAIndicator
from typing import Dict, List, Tuple
import sys

from optimized_dataloader import load_price_data_fast
from optimized_metrics import calculate_metrics_fast


class IndicatorCache:
    """
    Pre-compute and cache indicator values for all periods.

    This is the key optimization - calculate RSI(5), RSI(6), ..., RSI(200) once
    and reuse for all threshold tests.
    """

    def __init__(self):
        self._cache = {}  # Key: (ticker, indicator, period) -> NumPy array

    def get_indicator(self, ticker, indicator_name, period, price_data):
        """
        Get indicator values (cached).

        Args:
            ticker: Ticker symbol
            indicator_name: Indicator name (e.g., 'RSI', 'SMA')
            period: Period/length parameter
            price_data: Price data dictionary from dataloader

        Returns:
            NumPy array of indicator values
        """
        cache_key = (ticker, indicator_name, period)

        if cache_key in self._cache:
            return self._cache[cache_key]

        # Compute indicator
        indicator_values = self._compute_indicator(indicator_name, period, price_data)

        # Cache result
        self._cache[cache_key] = indicator_values

        return indicator_values

    def _compute_indicator(self, indicator_name, period, price_data):
        """
        Compute indicator using ta library.

        Args:
            indicator_name: Indicator name
            period: Period parameter
            price_data: Price data dictionary

        Returns:
            NumPy array of indicator values
        """
        # Convert NumPy arrays to pandas Series for ta library
        close = pd.Series(price_data['close'])
        high = pd.Series(price_data['high'])
        low = pd.Series(price_data['low'])
        volume = pd.Series(price_data['volume'])

        # Calculate indicator based on name using ta library
        if indicator_name == 'RSI':
            indicator = RSIIndicator(close, window=period).rsi()
        elif indicator_name == 'SMA':
            indicator = SMAIndicator(close, window=period).sma_indicator()
        elif indicator_name == 'EMA':
            indicator = EMAIndicator(close, window=period).ema_indicator()
        else:
            raise ValueError(f"Indicator {indicator_name} not implemented yet. Only RSI, SMA, EMA supported for now.")

        # Convert to NumPy array, fill NaN with 0
        return indicator.fillna(0).values.astype(np.float64)

    def precompute_all_periods(self, ticker, indicator_name, period_range, price_data):
        """
        Pre-compute indicator for all periods in range.

        This is called once per ticker/indicator to populate the cache.

        Args:
            ticker: Ticker symbol
            indicator_name: Indicator name
            period_range: List of periods (e.g., [5, 6, 7, ..., 200])
            price_data: Price data dictionary
        """
        for period in period_range:
            self.get_indicator(ticker, indicator_name, period, price_data)

    def clear_cache(self):
        """Clear indicator cache."""
        self._cache.clear()

    def get_cache_size(self):
        """Get number of cached indicators."""
        return len(self._cache)


def vectorized_backtest_single_branch(
    indicator_values,
    comparator,
    threshold,
    prices,
    returns,
):
    """
    Run a single branch backtest using vectorized operations.

    Args:
        indicator_values: NumPy array of indicator values
        comparator: 'LT' or 'GT'
        threshold: Threshold value
        prices: NumPy array of close prices
        returns: NumPy array of daily returns

    Returns:
        Dictionary of metrics
    """
    # Generate signals using vectorized comparison (VERY FAST)
    if comparator == 'LT':
        signals = (indicator_values < threshold).astype(np.int32)
    elif comparator == 'GT':
        signals = (indicator_values > threshold).astype(np.int32)
    else:
        raise ValueError(f"Unknown comparator: {comparator}")

    # Calculate metrics using Numba-JIT (VERY FAST)
    metrics = calculate_metrics_fast(signals, prices, returns)

    return metrics


def batch_backtest_branches(
    ticker,
    indicator_name,
    period_range,
    comparator_list,
    threshold_range,
    data_dir='../data/parquet',
    min_tim=5.0,
    min_timar=30.0,
    max_dd=20.0,
    min_trades=50,
):
    """
    Batch backtest all branches for a ticker/indicator combination.

    This is the main optimization - pre-compute indicators once, then
    vectorize all threshold tests.

    Args:
        ticker: Ticker symbol
        indicator_name: Indicator name (e.g., 'RSI')
        period_range: List of periods (e.g., [5, 10, 14, 20])
        comparator_list: List of comparators (e.g., ['LT', 'GT'])
        threshold_range: List of thresholds (e.g., [20, 25, 30, ..., 80])
        data_dir: Parquet data directory
        min_tim: Minimum TIM filter
        min_timar: Minimum TIMAR filter
        max_dd: Maximum MaxDD filter
        min_trades: Minimum trades filter

    Returns:
        List of passing branch results
    """
    # Load price data (cached)
    price_data = load_price_data_fast(ticker, data_dir)
    prices = price_data['close']
    returns = price_data['returns']

    # Initialize indicator cache
    indicator_cache = IndicatorCache()

    # Pre-compute all indicators for all periods (KEY OPTIMIZATION)
    print(f"Pre-computing {indicator_name} for periods {period_range[0]}-{period_range[-1]}...", file=sys.stderr)
    indicator_cache.precompute_all_periods(ticker, indicator_name, period_range, price_data)
    print(f"Indicator cache size: {indicator_cache.get_cache_size()}", file=sys.stderr)

    passing_branches = []
    total_branches = 0

    # Iterate through all combinations
    for period in period_range:
        # Get pre-computed indicator (from cache, instant)
        indicator_values = indicator_cache.get_indicator(ticker, indicator_name, period, price_data)

        for comparator in comparator_list:
            for threshold in threshold_range:
                total_branches += 1

                # Run vectorized backtest (VERY FAST - all NumPy/Numba)
                metrics = vectorized_backtest_single_branch(
                    indicator_values,
                    comparator,
                    threshold,
                    prices,
                    returns,
                )

                # Apply filters
                if (
                    metrics['TIM'] >= min_tim and
                    metrics['TIMAR'] >= min_timar and
                    metrics['MaxDD'] <= max_dd and
                    metrics['Trades'] >= min_trades
                ):
                    # This branch passes!
                    branch_result = {
                        'ticker': ticker,
                        'indicator': indicator_name,
                        'period': period,
                        'comparator': comparator,
                        'threshold': threshold,
                        **metrics,
                    }
                    passing_branches.append(branch_result)

    print(f"Tested {total_branches} branches, {len(passing_branches)} passing ({len(passing_branches)/total_branches*100:.1f}%)", file=sys.stderr)

    return passing_branches


if __name__ == '__main__':
    # Benchmark test
    print("Benchmarking vectorized backtester...", file=sys.stderr)

    import time

    ticker = 'SPY'
    indicator = 'RSI'
    periods = list(range(5, 21))  # 16 periods
    comparators = ['LT', 'GT']  # 2 comparators
    thresholds = list(range(20, 81, 5))  # 13 thresholds

    total_branches = len(periods) * len(comparators) * len(thresholds)
    print(f"Testing {total_branches} branches...", file=sys.stderr)

    start = time.perf_counter()

    results = batch_backtest_branches(
        ticker=ticker,
        indicator_name=indicator,
        period_range=periods,
        comparator_list=comparators,
        threshold_range=thresholds,
        data_dir='../data/parquet',
    )

    elapsed = time.perf_counter() - start

    print(f"\n=== PERFORMANCE RESULTS ===", file=sys.stderr)
    print(f"Total branches: {total_branches}", file=sys.stderr)
    print(f"Total time: {elapsed:.2f} seconds", file=sys.stderr)
    print(f"Branches per second: {total_branches / elapsed:.1f}", file=sys.stderr)
    print(f"Time per branch: {elapsed / total_branches * 1000:.2f} ms", file=sys.stderr)
    print(f"Passing branches: {len(results)}", file=sys.stderr)
