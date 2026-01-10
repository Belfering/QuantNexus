"""
Vectorized indicator pre-computation with caching
Calculates indicators across multiple periods in one pass for massive speedup
"""

import numpy as np
import pandas as pd
from typing import Dict, List, Optional, Tuple
from functools import lru_cache

# Import Numba-optimized indicators for 10-100x speedup
try:
    from optimized_indicators import (
        calculate_rsi_fast,
        calculate_sma_fast,
        calculate_ema_fast,
        calculate_stddev_fast,
        calculate_roc_fast,
        NUMBA_AVAILABLE
    )
    USE_NUMBA = NUMBA_AVAILABLE
except ImportError:
    USE_NUMBA = False


class IndicatorCache:
    """
    Pre-computes indicators across multiple periods and caches results
    Example: Calculate RSI(5), RSI(10), ..., RSI(200) in one vectorized operation
    """

    def __init__(self, max_cache_size: int = 1000):
        """
        Initialize indicator cache

        Args:
            max_cache_size: Maximum number of cached indicator arrays
        """
        self.cache: Dict[str, np.ndarray] = {}
        self.max_cache_size = max_cache_size
        self.hit_count = 0
        self.miss_count = 0

    def get_indicator(self, ticker: str, indicator: str, period: int, prices: np.ndarray) -> Optional[np.ndarray]:
        """
        Get indicator values for a specific ticker, indicator type, and period

        Args:
            ticker: Stock ticker symbol
            indicator: Indicator name (e.g., 'RSI', 'SMA', 'EMA')
            period: Period/window for the indicator
            prices: Price data (close prices)

        Returns:
            NumPy array of indicator values, or None if calculation fails
        """
        cache_key = f"{ticker}:{indicator}:{period}"

        # Check cache
        if cache_key in self.cache:
            self.hit_count += 1
            return self.cache[cache_key]

        self.miss_count += 1

        # Calculate indicator
        values = None
        if indicator == 'RSI' or indicator == 'Relative Strength Index':
            values = self._calculate_rsi(prices, period)
        elif indicator == 'SMA' or indicator == 'Simple Moving Average':
            values = self._calculate_sma(prices, period)
        elif indicator == 'EMA' or indicator == 'Exponential Moving Average':
            values = self._calculate_ema(prices, period)
        elif indicator == 'StdDev' or indicator == 'Standard Deviation':
            values = self._calculate_stddev(prices, period)
        elif indicator == 'ROC' or indicator == 'Rate of Change':
            values = self._calculate_roc(prices, period)
        elif indicator == 'ATR' or indicator == 'Average True Range':
            # ATR needs high/low/close, fallback to price range estimate
            values = self._calculate_sma(prices, period)
        else:
            # Unknown indicator - return prices
            values = prices

        # Cache it (with size limit)
        if values is not None and len(self.cache) < self.max_cache_size:
            self.cache[cache_key] = values

        return values

    def precompute_periods(self, ticker: str, indicator: str, periods: List[int], prices: np.ndarray):
        """
        Pre-compute indicator for multiple periods at once (vectorized)

        Args:
            ticker: Stock ticker symbol
            indicator: Indicator name
            periods: List of periods to compute
            prices: Price data
        """
        for period in periods:
            cache_key = f"{ticker}:{indicator}:{period}"
            if cache_key not in self.cache:
                values = self.get_indicator(ticker, indicator, period, prices)
                if values is not None and len(self.cache) < self.max_cache_size:
                    self.cache[cache_key] = values

    def clear(self):
        """Clear the cache"""
        self.cache.clear()
        self.hit_count = 0
        self.miss_count = 0

    def get_stats(self) -> Dict:
        """Get cache statistics"""
        total = self.hit_count + self.miss_count
        hit_rate = (self.hit_count / total * 100) if total > 0 else 0
        return {
            'size': len(self.cache),
            'hits': self.hit_count,
            'misses': self.miss_count,
            'hit_rate': hit_rate
        }

    # Indicator calculation methods (vectorized NumPy operations)

    def _calculate_rsi(self, prices: np.ndarray, period: int) -> np.ndarray:
        """Calculate RSI using vectorized operations (Numba-optimized if available)"""
        # Use Numba-optimized version if available (10-50x faster)
        if USE_NUMBA:
            return calculate_rsi_fast(prices, period)

        # Fallback to pandas implementation
        if len(prices) < period + 1:
            return np.full(len(prices), 50.0)

        # Calculate price changes
        deltas = np.diff(prices)

        # Separate gains and losses
        gains = np.where(deltas > 0, deltas, 0)
        losses = np.where(deltas < 0, -deltas, 0)

        # Calculate average gains and losses using exponential moving average
        avg_gains = np.zeros(len(prices))
        avg_losses = np.zeros(len(prices))

        # Initial average (SMA for first period)
        if period <= len(gains):
            avg_gains[period] = np.mean(gains[:period])
            avg_losses[period] = np.mean(losses[:period])

        # Subsequent values (EMA)
        alpha = 1.0 / period
        for i in range(period + 1, len(prices)):
            avg_gains[i] = (gains[i-1] * alpha) + (avg_gains[i-1] * (1 - alpha))
            avg_losses[i] = (losses[i-1] * alpha) + (avg_losses[i-1] * (1 - alpha))

        # Calculate RS and RSI
        rs = np.where(avg_losses != 0, avg_gains / avg_losses, 0)
        rsi = 100 - (100 / (1 + rs))

        # Fill initial values with 50 (neutral)
        rsi[:period] = 50.0

        return rsi

    def _calculate_sma(self, prices: np.ndarray, period: int) -> np.ndarray:
        """Calculate Simple Moving Average using vectorized operations (Numba-optimized if available)"""
        # Use Numba-optimized version if available (5-20x faster)
        if USE_NUMBA:
            return calculate_sma_fast(prices, period)

        # Fallback to pandas implementation
        if len(prices) < period:
            return np.copy(prices)

        # Use pandas for efficient rolling mean
        sma = pd.Series(prices).rolling(window=period, min_periods=1).mean().values
        return sma

    def _calculate_ema(self, prices: np.ndarray, period: int) -> np.ndarray:
        """Calculate Exponential Moving Average using vectorized operations (Numba-optimized if available)"""
        # Use Numba-optimized version if available (5-20x faster)
        if USE_NUMBA:
            return calculate_ema_fast(prices, period)

        # Fallback to pandas implementation
        if len(prices) < 1:
            return prices

        # Use pandas for efficient EMA
        ema = pd.Series(prices).ewm(span=period, adjust=False).mean().values
        return ema

    def _calculate_stddev(self, prices: np.ndarray, period: int) -> np.ndarray:
        """Calculate rolling standard deviation (Numba-optimized if available)"""
        # Use Numba-optimized version if available (3-10x faster)
        if USE_NUMBA:
            return calculate_stddev_fast(prices, period)

        # Fallback to pandas implementation
        if len(prices) < period:
            return np.zeros(len(prices))

        stddev = pd.Series(prices).rolling(window=period, min_periods=1).std().values
        return stddev

    def _calculate_roc(self, prices: np.ndarray, period: int) -> np.ndarray:
        """Calculate Rate of Change (Numba-optimized if available)"""
        # Use Numba-optimized version if available (5-15x faster)
        if USE_NUMBA:
            return calculate_roc_fast(prices, period)

        # Fallback to Python implementation
        if len(prices) < period + 1:
            return np.zeros(len(prices))

        roc = np.zeros(len(prices))
        for i in range(period, len(prices)):
            if prices[i - period] != 0:
                roc[i] = ((prices[i] - prices[i - period]) / prices[i - period]) * 100

        return roc


class SharedIndicatorCache:
    """
    Shared indicator cache for use across multiple workers
    Pre-computes common indicators before optimization starts
    """

    def __init__(self):
        self.cache = IndicatorCache(max_cache_size=5000)
        self.tickers: List[str] = []
        self.indicators_config: Dict[str, List[int]] = {}

    def precompute_all(self, price_data: Dict[str, np.ndarray], indicators_config: Dict[str, List[int]]):
        """
        Pre-compute all indicators for all tickers

        Args:
            price_data: Dict mapping ticker -> close prices array
            indicators_config: Dict mapping indicator name -> list of periods
                              e.g., {'RSI': [5,10,14,20,50,100,200], 'SMA': [10,20,50,200]}
        """
        self.tickers = list(price_data.keys())
        self.indicators_config = indicators_config

        total_computations = sum(len(periods) for periods in indicators_config.values()) * len(self.tickers)
        computed = 0

        print(f"[IndicatorCache] Pre-computing {total_computations} indicators...")

        for ticker, prices in price_data.items():
            for indicator, periods in indicators_config.items():
                self.cache.precompute_periods(ticker, indicator, periods, prices)
                computed += len(periods)

        stats = self.cache.get_stats()
        print(f"[IndicatorCache] Pre-computation complete: {stats['size']} indicators cached")

    def get_indicator(self, ticker: str, indicator: str, period: int, prices: np.ndarray) -> Optional[np.ndarray]:
        """Get indicator from cache (delegates to internal cache)"""
        return self.cache.get_indicator(ticker, indicator, period, prices)

    def get_stats(self) -> Dict:
        """Get cache statistics"""
        return self.cache.get_stats()
