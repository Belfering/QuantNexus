"""
Optimized Price Data Loader with Caching

This module provides high-performance price data loading:
- NumPy arrays (no pandas overhead in hot loops)
- In-memory LRU cache (avoid repeated parquet reads)
- Pre-computed returns arrays
- Memory-efficient data structures

Similar to Java's double[] arrays + Caffeine cache pattern.
"""

import numpy as np
import pandas as pd
from pathlib import Path
from functools import lru_cache
import sys


class PriceDataCache:
    """
    In-memory cache for price data (similar to Caffeine cache).

    Uses Python's built-in LRU cache + manual dict for frequently accessed tickers.
    """

    def __init__(self, data_dir='../data/parquet', cache_size=500):
        self.data_dir = Path(data_dir)
        self.cache_size = cache_size
        self._hot_cache = {}  # Manual cache for most-used tickers

    @lru_cache(maxsize=500)
    def _load_parquet_cached(self, ticker):
        """
        Load parquet file with LRU caching.

        Args:
            ticker: Ticker symbol (sanitized, e.g., BRK-B)

        Returns:
            Pandas DataFrame
        """
        parquet_path = self.data_dir / f"{ticker}.parquet"

        if not parquet_path.exists():
            raise FileNotFoundError(f"Parquet file not found: {parquet_path}")

        # Use pyarrow for fast reading
        df = pd.read_parquet(parquet_path, engine='pyarrow')

        return df

    def get_ticker_data(self, ticker, limit=20000):
        """
        Get ticker data as pandas DataFrame with date filtering and limit.

        Args:
            ticker: Ticker symbol
            limit: Maximum number of rows to return (most recent)

        Returns:
            Pandas DataFrame with OHLC data
        """
        # Load from parquet (LRU cached)
        df = self._load_parquet_cached(ticker)

        # Ensure Date column is datetime
        if 'Date' in df.columns:
            df['Date'] = pd.to_datetime(df['Date'])
        elif df.index.name == 'Date':
            df = df.reset_index()
            df['Date'] = pd.to_datetime(df['Date'])

        # Filter to backtest start date (1993-01-01 minimum)
        df = df[df['Date'] >= '1993-01-01']

        # Sort by date
        df = df.sort_values('Date')

        # Add timestamp column (Unix epoch in seconds)
        df['time'] = df['Date'].astype(np.int64) // 10**9

        # Apply limit
        if limit and limit < len(df):
            df = df.tail(limit)

        return df

    def get_price_arrays(self, ticker):
        """
        Get price data as NumPy arrays (optimized for speed).

        Args:
            ticker: Ticker symbol

        Returns:
            Dictionary with NumPy arrays:
                - 'dates': Array of date strings
                - 'open': Open prices
                - 'high': High prices
                - 'low': Low prices
                - 'close': Close prices
                - 'volume': Volume
                - 'returns': Daily returns (close-to-close)
        """
        # Check hot cache first
        if ticker in self._hot_cache:
            return self._hot_cache[ticker]

        # Load from parquet (LRU cached)
        df = self._load_parquet_cached(ticker)

        # Convert to NumPy arrays (much faster than pandas for calculations)
        price_data = {
            'dates': df.index.astype(str).values,
            'open': df['Open'].values.astype(np.float64),
            'high': df['High'].values.astype(np.float64),
            'low': df['Low'].values.astype(np.float64),
            'close': df['Close'].values.astype(np.float64),
            'volume': df['Volume'].values.astype(np.float64),
        }

        # Pre-compute returns array (avoid recalculating)
        close_prices = price_data['close']
        returns = np.zeros(len(close_prices), dtype=np.float64)
        returns[1:] = (close_prices[1:] - close_prices[:-1]) / close_prices[:-1]

        price_data['returns'] = returns
        price_data['length'] = len(close_prices)

        # Add to hot cache if frequently accessed
        if len(self._hot_cache) < 100:  # Keep top 100 tickers in hot cache
            self._hot_cache[ticker] = price_data

        return price_data

    def clear_cache(self):
        """Clear all caches."""
        self._hot_cache.clear()
        self._load_parquet_cached.cache_clear()

    def get_cache_info(self):
        """Get cache statistics."""
        lru_info = self._load_parquet_cached.cache_info()
        return {
            'hot_cache_size': len(self._hot_cache),
            'lru_hits': lru_info.hits,
            'lru_misses': lru_info.misses,
            'lru_hit_rate': lru_info.hits / (lru_info.hits + lru_info.misses) if (lru_info.hits + lru_info.misses) > 0 else 0,
        }


# Global cache instance (reused across function calls)
_global_cache = None


def get_global_cache(data_dir='../data/parquet'):
    """Get or create global price data cache."""
    global _global_cache
    if _global_cache is None:
        _global_cache = PriceDataCache(data_dir)
    return _global_cache


def load_price_data_fast(ticker, data_dir='../data/parquet'):
    """
    Fast price data loading with caching.

    Args:
        ticker: Ticker symbol
        data_dir: Directory containing parquet files

    Returns:
        Dictionary with NumPy arrays
    """
    cache = get_global_cache(data_dir)
    return cache.get_price_arrays(ticker)


if __name__ == '__main__':
    # Benchmark test
    print("Benchmarking optimized data loader...", file=sys.stderr)

    import time

    # Test ticker (adjust path if needed)
    ticker = 'SPY'
    data_dir = '../data/parquet'

    # Cold load (triggers parquet read)
    start = time.perf_counter()
    data1 = load_price_data_fast(ticker, data_dir)
    cold_time = (time.perf_counter() - start) * 1000

    print(f"Cold load time: {cold_time:.2f} ms", file=sys.stderr)
    print(f"Data shape: {data1['length']} days", file=sys.stderr)

    # Warm load (from cache)
    start = time.perf_counter()
    for _ in range(100):
        data2 = load_price_data_fast(ticker, data_dir)
    warm_time = (time.perf_counter() - start) / 100 * 1000

    print(f"Warm load time (avg of 100): {warm_time:.4f} ms", file=sys.stderr)

    # Cache stats
    cache = get_global_cache()
    stats = cache.get_cache_info()
    print(f"Cache stats: {stats}", file=sys.stderr)

    print(f"\nSpeedup: {cold_time / warm_time:.0f}x faster on cached reads", file=sys.stderr)
