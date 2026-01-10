"""
Numba JIT-compiled indicator calculations for 10-100x speedup
Uses vectorized NumPy operations with Numba's @njit decorator
"""

import numpy as np
from numba import njit

try:
    from numba import njit
    NUMBA_AVAILABLE = True
except ImportError:
    # Fallback: no-op decorator if Numba not available
    def njit(*args, **kwargs):
        def decorator(func):
            return func
        if len(args) == 1 and callable(args[0]):
            return args[0]
        return decorator
    NUMBA_AVAILABLE = False


@njit(cache=True)
def calculate_rsi_fast(prices: np.ndarray, period: int) -> np.ndarray:
    """
    Calculate RSI using Numba JIT compilation (10-50x faster than pandas)

    Args:
        prices: Array of close prices
        period: RSI period (e.g., 14)

    Returns:
        Array of RSI values (0-100)
    """
    n = len(prices)
    if n < period + 1:
        return np.full(n, 50.0)

    rsi = np.full(n, 50.0)

    # Calculate price changes
    deltas = np.zeros(n - 1)
    for i in range(n - 1):
        deltas[i] = prices[i + 1] - prices[i]

    # Separate gains and losses
    gains = np.zeros(n - 1)
    losses = np.zeros(n - 1)
    for i in range(n - 1):
        if deltas[i] > 0:
            gains[i] = deltas[i]
        else:
            losses[i] = -deltas[i]

    # Calculate initial average
    if period <= len(gains):
        avg_gain = 0.0
        avg_loss = 0.0
        for i in range(period):
            avg_gain += gains[i]
            avg_loss += losses[i]
        avg_gain /= period
        avg_loss /= period

        # Calculate RSI for first period
        if avg_loss != 0:
            rs = avg_gain / avg_loss
            rsi[period] = 100.0 - (100.0 / (1.0 + rs))

        # Calculate EMA for subsequent periods
        alpha = 1.0 / period
        for i in range(period, n - 1):
            avg_gain = (gains[i] * alpha) + (avg_gain * (1.0 - alpha))
            avg_loss = (losses[i] * alpha) + (avg_loss * (1.0 - alpha))

            if avg_loss != 0:
                rs = avg_gain / avg_loss
                rsi[i + 1] = 100.0 - (100.0 / (1.0 + rs))
            else:
                rsi[i + 1] = 100.0

    return rsi


@njit(cache=True)
def calculate_sma_fast(prices: np.ndarray, period: int) -> np.ndarray:
    """
    Calculate Simple Moving Average using Numba JIT

    Args:
        prices: Array of close prices
        period: SMA period

    Returns:
        Array of SMA values
    """
    n = len(prices)
    if n < period:
        return prices.copy()

    sma = np.zeros(n)

    # First period: full calculation
    window_sum = 0.0
    for i in range(period):
        window_sum += prices[i]
        sma[i] = prices[i]  # Fill with price until we have enough data

    sma[period - 1] = window_sum / period

    # Subsequent periods: rolling window
    for i in range(period, n):
        window_sum = window_sum - prices[i - period] + prices[i]
        sma[i] = window_sum / period

    return sma


@njit(cache=True)
def calculate_ema_fast(prices: np.ndarray, period: int) -> np.ndarray:
    """
    Calculate Exponential Moving Average using Numba JIT

    Args:
        prices: Array of close prices
        period: EMA period

    Returns:
        Array of EMA values
    """
    n = len(prices)
    if n < 1:
        return prices.copy()

    ema = np.zeros(n)
    alpha = 2.0 / (period + 1.0)

    # First value is the price itself
    ema[0] = prices[0]

    # Calculate EMA
    for i in range(1, n):
        ema[i] = (prices[i] * alpha) + (ema[i - 1] * (1.0 - alpha))

    return ema


@njit(cache=True)
def calculate_stddev_fast(prices: np.ndarray, period: int) -> np.ndarray:
    """
    Calculate rolling standard deviation using Numba JIT

    Args:
        prices: Array of close prices
        period: Window period

    Returns:
        Array of standard deviation values
    """
    n = len(prices)
    if n < period:
        return np.zeros(n)

    stddev = np.zeros(n)

    for i in range(period - 1, n):
        # Calculate mean of window
        window_sum = 0.0
        for j in range(i - period + 1, i + 1):
            window_sum += prices[j]
        mean = window_sum / period

        # Calculate variance
        variance = 0.0
        for j in range(i - period + 1, i + 1):
            diff = prices[j] - mean
            variance += diff * diff
        variance /= period

        stddev[i] = np.sqrt(variance)

    return stddev


@njit(cache=True)
def calculate_roc_fast(prices: np.ndarray, period: int) -> np.ndarray:
    """
    Calculate Rate of Change using Numba JIT

    Args:
        prices: Array of close prices
        period: ROC period

    Returns:
        Array of ROC values (percentage)
    """
    n = len(prices)
    if n < period + 1:
        return np.zeros(n)

    roc = np.zeros(n)

    for i in range(period, n):
        if prices[i - period] != 0:
            roc[i] = ((prices[i] - prices[i - period]) / prices[i - period]) * 100.0

    return roc


@njit(cache=True)
def calculate_atr_fast(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int) -> np.ndarray:
    """
    Calculate Average True Range using Numba JIT

    Args:
        high: Array of high prices
        low: Array of low prices
        close: Array of close prices
        period: ATR period

    Returns:
        Array of ATR values
    """
    n = len(close)
    if n < period + 1:
        return np.zeros(n)

    tr = np.zeros(n)
    atr = np.zeros(n)

    # Calculate True Range
    for i in range(1, n):
        h_l = high[i] - low[i]
        h_cp = abs(high[i] - close[i - 1])
        l_cp = abs(low[i] - close[i - 1])
        tr[i] = max(h_l, h_cp, l_cp)

    # Calculate ATR (EMA of TR)
    if period < n:
        # Initial ATR (SMA of first period)
        atr_sum = 0.0
        for i in range(1, period + 1):
            atr_sum += tr[i]
        atr[period] = atr_sum / period

        # Subsequent ATR (EMA)
        for i in range(period + 1, n):
            atr[i] = ((atr[i - 1] * (period - 1)) + tr[i]) / period

    return atr


def get_indicator_calculator(indicator_name: str):
    """
    Get the fast Numba-compiled calculator for an indicator

    Args:
        indicator_name: Name of indicator (RSI, SMA, EMA, etc.)

    Returns:
        Numba-compiled calculator function or None
    """
    calculators = {
        'RSI': calculate_rsi_fast,
        'Relative Strength Index': calculate_rsi_fast,
        'SMA': calculate_sma_fast,
        'Simple Moving Average': calculate_sma_fast,
        'EMA': calculate_ema_fast,
        'Exponential Moving Average': calculate_ema_fast,
        'StdDev': calculate_stddev_fast,
        'Standard Deviation': calculate_stddev_fast,
        'ROC': calculate_roc_fast,
        'Rate of Change': calculate_roc_fast,
        'ATR': calculate_atr_fast,
        'Average True Range': calculate_atr_fast,
    }

    return calculators.get(indicator_name)


# Test if Numba is working
if __name__ == '__main__':
    import time

    print(f"Numba available: {NUMBA_AVAILABLE}")

    if NUMBA_AVAILABLE:
        # Generate test data
        prices = np.random.randn(10000).cumsum() + 100

        # Warmup JIT compilation
        _ = calculate_rsi_fast(prices[:100], 14)

        # Benchmark RSI
        start = time.perf_counter()
        for _ in range(1000):
            rsi = calculate_rsi_fast(prices, 14)
        elapsed = (time.perf_counter() - start) * 1000

        print(f"RSI calculation (1000 iterations): {elapsed:.2f}ms")
        print(f"Average per call: {elapsed/1000:.4f}ms")
        print(f"Sample RSI values: {rsi[-10:]}")
    else:
        print("Numba not available - optimizations disabled")
