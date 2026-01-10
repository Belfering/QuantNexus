"""
Optimized metrics calculations using Numba JIT compilation
Provides 10-100x speedup over pure Python implementations
"""

import numpy as np
from numba import jit
from typing import Dict, Optional


@jit(nopython=True, cache=True, fastmath=True)
def calculate_max_drawdown(equity_curve: np.ndarray) -> float:
    """Calculate maximum drawdown from equity curve"""
    if len(equity_curve) == 0:
        return 0.0

    max_dd = 0.0
    peak = equity_curve[0]

    for value in equity_curve:
        if value > peak:
            peak = value
        dd = (peak - value) / peak if peak > 0 else 0.0
        if dd > max_dd:
            max_dd = dd

    return max_dd


@jit(nopython=True, cache=True, fastmath=True)
def calculate_cagr(equity_curve: np.ndarray, n_years: float) -> float:
    """Calculate Compound Annual Growth Rate"""
    if len(equity_curve) < 2 or n_years <= 0:
        return 0.0

    start_value = equity_curve[0]
    end_value = equity_curve[-1]

    if start_value <= 0:
        return 0.0

    total_return = end_value / start_value
    cagr = (total_return ** (1.0 / n_years)) - 1.0

    return cagr


@jit(nopython=True, cache=True, fastmath=True)
def calculate_sharpe_ratio(returns: np.ndarray, periods_per_year: float = 252.0) -> float:
    """Calculate annualized Sharpe ratio"""
    if len(returns) < 2:
        return 0.0

    mean_return = np.mean(returns)
    std_return = np.std(returns)

    if std_return == 0:
        return 0.0

    sharpe = (mean_return / std_return) * np.sqrt(periods_per_year)
    return sharpe


@jit(nopython=True, cache=True, fastmath=True)
def calculate_sortino_ratio(returns: np.ndarray, periods_per_year: float = 252.0) -> float:
    """Calculate annualized Sortino ratio (penalizes downside volatility only)"""
    if len(returns) < 2:
        return 0.0

    mean_return = np.mean(returns)

    # Calculate downside deviation
    downside_returns = returns[returns < 0]
    if len(downside_returns) == 0:
        return 0.0 if mean_return <= 0 else 100.0

    downside_std = np.std(downside_returns)
    if downside_std == 0:
        return 0.0

    sortino = (mean_return / downside_std) * np.sqrt(periods_per_year)
    return sortino


@jit(nopython=True, cache=True, fastmath=True)
def calculate_calmar_ratio(equity_curve: np.ndarray, n_years: float) -> float:
    """Calculate Calmar ratio (CAGR / Max Drawdown)"""
    if len(equity_curve) < 2 or n_years <= 0:
        return 0.0

    cagr = calculate_cagr(equity_curve, n_years)
    max_dd = calculate_max_drawdown(equity_curve)

    if max_dd == 0:
        return 0.0 if cagr <= 0 else 100.0

    return cagr / max_dd


@jit(nopython=True, cache=True, fastmath=True)
def calculate_tim_ratio(equity_curve: np.ndarray, n_years: float) -> float:
    """
    Calculate TIM ratio (Time In Market ratio)
    Measures CAGR per unit of time spent in risk positions
    """
    if len(equity_curve) < 2 or n_years <= 0:
        return 0.0

    # Count periods where equity increased (simplified proxy for time in market)
    n_periods = len(equity_curve) - 1
    in_market = 0
    for i in range(1, len(equity_curve)):
        if equity_curve[i] > equity_curve[i-1]:
            in_market += 1

    time_in_market = in_market / n_periods if n_periods > 0 else 0.0
    if time_in_market == 0:
        return 0.0

    cagr = calculate_cagr(equity_curve, n_years)
    return cagr / time_in_market


@jit(nopython=True, cache=True, fastmath=True)
def calculate_timar_ratio(equity_curve: np.ndarray, n_years: float) -> float:
    """
    Calculate TIMAR ratio (Time In Market Adjusted Return)
    Combines TIM with risk adjustment
    """
    if len(equity_curve) < 2 or n_years <= 0:
        return 0.0

    tim = calculate_tim_ratio(equity_curve, n_years)
    max_dd = calculate_max_drawdown(equity_curve)

    if max_dd == 0:
        return 0.0 if tim <= 0 else 100.0

    return tim / max_dd


@jit(nopython=True, cache=True, fastmath=True)
def calculate_win_rate(returns: np.ndarray) -> float:
    """Calculate percentage of positive returns"""
    if len(returns) == 0:
        return 0.0

    wins = 0
    for r in returns:
        if r > 0:
            wins += 1

    return wins / len(returns)


@jit(nopython=True, cache=True, fastmath=True)
def calculate_all_metrics_fast(equity_curve: np.ndarray, returns: np.ndarray, n_years: float, periods_per_year: float = 252.0) -> tuple:
    """
    Calculate all metrics in a single pass for maximum efficiency
    Returns: (cagr, sharpe, calmar, max_dd, sortino, tim, timar, win_rate)
    """
    # Handle edge cases
    if len(equity_curve) < 2 or len(returns) < 2 or n_years <= 0:
        return (0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)

    # Calculate CAGR
    start_value = equity_curve[0]
    end_value = equity_curve[-1]
    if start_value <= 0:
        cagr = 0.0
    else:
        total_return = end_value / start_value
        cagr = (total_return ** (1.0 / n_years)) - 1.0

    # Calculate Max Drawdown
    max_dd = 0.0
    peak = equity_curve[0]
    for value in equity_curve:
        if value > peak:
            peak = value
        dd = (peak - value) / peak if peak > 0 else 0.0
        if dd > max_dd:
            max_dd = dd

    # Calculate Sharpe Ratio
    mean_return = np.mean(returns)
    std_return = np.std(returns)
    if std_return == 0:
        sharpe = 0.0
    else:
        sharpe = (mean_return / std_return) * np.sqrt(periods_per_year)

    # Calculate Sortino Ratio
    downside_returns = returns[returns < 0]
    if len(downside_returns) == 0:
        sortino = 0.0 if mean_return <= 0 else 100.0
    else:
        downside_std = np.std(downside_returns)
        if downside_std == 0:
            sortino = 0.0
        else:
            sortino = (mean_return / downside_std) * np.sqrt(periods_per_year)

    # Calculate Calmar Ratio
    if max_dd == 0:
        calmar = 0.0 if cagr <= 0 else 100.0
    else:
        calmar = cagr / max_dd

    # Calculate TIM ratio
    n_periods = len(equity_curve) - 1
    in_market = 0
    for i in range(1, len(equity_curve)):
        if equity_curve[i] > equity_curve[i-1]:
            in_market += 1
    time_in_market = in_market / n_periods if n_periods > 0 else 0.0
    if time_in_market == 0:
        tim = 0.0
    else:
        tim = cagr / time_in_market

    # Calculate TIMAR ratio
    if max_dd == 0:
        timar = 0.0 if tim <= 0 else 100.0
    else:
        timar = tim / max_dd

    # Calculate Win Rate
    wins = 0
    for r in returns:
        if r > 0:
            wins += 1
    win_rate = wins / len(returns) if len(returns) > 0 else 0.0

    return (cagr, sharpe, calmar, max_dd, sortino, tim, timar, win_rate)


def calculate_metrics_fast(equity_curve: np.ndarray, n_years: float, periods_per_year: float = 252.0) -> Dict[str, float]:
    """
    Wrapper function to calculate all metrics and return as dictionary

    Args:
        equity_curve: NumPy array of equity values over time
        n_years: Number of years in the backtest period
        periods_per_year: Trading periods per year (252 for daily, 12 for monthly)

    Returns:
        Dictionary with metric names and values
    """
    if len(equity_curve) < 2:
        return {
            'cagr': 0.0,
            'sharpe': 0.0,
            'calmar': 0.0,
            'maxDrawdown': 0.0,
            'sortino': 0.0,
            'tim': 0.0,
            'timar': 0.0,
            'winRate': 0.0
        }

    # Calculate returns
    returns = np.diff(equity_curve) / equity_curve[:-1]

    # Calculate all metrics
    cagr, sharpe, calmar, max_dd, sortino, tim, timar, win_rate = calculate_all_metrics_fast(
        equity_curve, returns, n_years, periods_per_year
    )

    return {
        'cagr': float(cagr),
        'sharpe': float(sharpe),
        'calmar': float(calmar),
        'maxDrawdown': float(max_dd),
        'sortino': float(sortino),
        'tim': float(tim),
        'timar': float(timar),
        'winRate': float(win_rate)
    }
