"""
Core backtesting engine for Atlas Forge.
Ported from RSI System "3 - Generate Branches.py"
"""

import sys
import json
import pandas as pd
import numpy as np
from pathlib import Path
from indicators import calculate_indicator
from metrics import compute_metrics

def split_is_oos(df: pd.DataFrame, strategy: str = 'even_odd_month', oos_start_date: str = None):
    """
    Split data into IS (in-sample) and OOS (out-of-sample).

    Args:
        df: DataFrame with Date column
        strategy: 'even_odd_month', 'even_odd_year', or 'chronological'
        oos_start_date: For chronological split (YYYY-MM-DD)

    Returns:
        tuple: (is_df, oos_df)
    """
    df = df.copy()
    df['Date'] = pd.to_datetime(df['Date'])
    df['Month'] = df['Date'].dt.month
    df['Year'] = df['Date'].dt.year

    if strategy == 'even_odd_month':
        is_df = df[df['Month'] % 2 == 1]  # Odd months
        oos_df = df[df['Month'] % 2 == 0]  # Even months

    elif strategy == 'even_odd_year':
        is_df = df[df['Year'] % 2 == 1]  # Odd years
        oos_df = df[df['Year'] % 2 == 0]  # Even years

    elif strategy == 'chronological':
        if oos_start_date is None:
            # Default: 70/30 split
            split_idx = int(len(df) * 0.7)
            is_df = df.iloc[:split_idx]
            oos_df = df.iloc[split_idx:]
        else:
            split_date = pd.to_datetime(oos_start_date)
            is_df = df[df['Date'] < split_date]
            oos_df = df[df['Date'] >= split_date]

    else:
        raise ValueError(f"Unknown split strategy: {strategy}")

    return is_df.reset_index(drop=True), oos_df.reset_index(drop=True)


def generate_signals(df: pd.DataFrame, indicator_series: pd.Series, comparator: str, threshold: float):
    """
    Generate buy/sell signals based on indicator condition.

    Args:
        df: DataFrame
        indicator_series: Calculated indicator values
        comparator: 'GT' or 'LT'
        threshold: Threshold value

    Returns:
        pd.Series: Boolean signals (True = buy signal)
    """
    if comparator == 'LT':
        return indicator_series < threshold
    elif comparator == 'GT':
        return indicator_series > threshold
    else:
        raise ValueError(f"Unknown comparator: {comparator}")


def backtest_branch(df: pd.DataFrame, signals: pd.Series):
    """
    Run backtest given signals and calculate returns.

    Args:
        df: DataFrame with Date, Close, Adj Close
        signals: Boolean series (True = buy signal)

    Returns:
        pd.DataFrame: Trade log with Date, Signal, Position, Returns, Equity
    """
    df = df.copy()
    df['Signal'] = signals.values
    df['Position'] = df['Signal'].shift(1).fillna(False).astype(int)  # Buy at close, hold next day

    # Calculate daily returns
    df['DailyReturn'] = df['Adj Close'].pct_change()
    df['StrategyReturn'] = df['DailyReturn'] * df['Position']

    # Calculate equity curve
    df['Equity'] = (1 + df['StrategyReturn']).cumprod()

    return df


def first_pass_ok(metrics: dict, config: dict):
    """
    First pass filter: Hard requirements.

    Args:
        metrics: Computed metrics dictionary
        config: Pass/fail criteria

    Returns:
        bool: True if passes first filter
    """
    min_tim = config.get('minTIM', 5)
    min_timar = config.get('minTIMAR', 30)
    max_dd = config.get('maxDD', 20)
    min_trades = config.get('minTrades', 50)

    if metrics.get('TIM', 0) < min_tim:
        return False
    if metrics.get('TIMAR', 0) < min_timar:
        return False
    if abs(metrics.get('MaxDD', 0)) > max_dd:  # MaxDD is negative
        return False
    if metrics.get('Trades', 0) < min_trades:
        return False

    return True


def second_pass_ok(metrics: dict, config: dict):
    """
    Second pass filter: Quality metrics.

    Args:
        metrics: Computed metrics dictionary
        config: Pass/fail criteria

    Returns:
        bool: True if passes second filter
    """
    min_timardd = config.get('minTIMARDD', 4)

    timar = metrics.get('TIMAR', 0)
    maxdd = abs(metrics.get('MaxDD', 1))  # Avoid division by zero

    if maxdd == 0:
        return False

    timardd = timar / maxdd

    if timardd < min_timardd:
        return False

    return True


def process_branch(params: dict):
    """
    Process a single branch: calculate indicator, generate signals, backtest, compute metrics.

    Args:
        params: Dictionary with:
            - data_path: Path to parquet file
            - signal_ticker: Ticker symbol
            - invest_ticker: Ticker to invest in (same or different)
            - indicator: Indicator ID
            - period: Indicator period
            - comparator: 'GT' or 'LT'
            - threshold: Threshold value
            - split_strategy: IS/OOS split method
            - oos_start_date: For chronological split
            - config: Pass/fail criteria

    Returns:
        dict: Branch result if passing, None if filtered out
    """
    try:
        # Load data
        data_path = params['data_path']
        df = pd.read_parquet(data_path)

        # Calculate indicator
        indicator_series = calculate_indicator(
            df,
            params['indicator'],
            params.get('period')
        )

        # Generate signals
        signals = generate_signals(
            df,
            indicator_series,
            params['comparator'],
            params['threshold']
        )

        # Split IS/OOS
        is_df, oos_df = split_is_oos(
            df,
            strategy=params.get('split_strategy', 'even_odd_month'),
            oos_start_date=params.get('oos_start_date')
        )

        # Get IS and OOS signals
        is_signals = signals.loc[is_df.index]
        oos_signals = signals.loc[oos_df.index]

        # Backtest IS
        is_result = backtest_branch(is_df, is_signals)
        is_metrics = compute_metrics(is_result, metric_set='core')

        # Check first pass
        if not first_pass_ok(is_metrics, params.get('config', {})):
            return None

        # Check second pass
        if not second_pass_ok(is_metrics, params.get('config', {})):
            return None

        # Backtest OOS
        oos_result = backtest_branch(oos_df, oos_signals)
        oos_metrics = compute_metrics(oos_result, metric_set='core')

        # Return passing branch
        return {
            'signal_ticker': params['signal_ticker'],
            'invest_ticker': params['invest_ticker'],
            'indicator': params['indicator'],
            'period': params.get('period'),
            'comparator': params['comparator'],
            'threshold': params['threshold'],
            'is_metrics': is_metrics,
            'oos_metrics': oos_metrics,
            'passing': True
        }

    except Exception as e:
        return {
            'error': str(e),
            'passing': False
        }


def process_batch(branches: list):
    """
    Process a batch of branches.

    Args:
        branches: List of branch parameter dictionaries

    Returns:
        list: Passing branches
    """
    results = []
    for branch_params in branches:
        result = process_branch(branch_params)
        if result and result.get('passing'):
            results.append(result)

    return results


if __name__ == '__main__':
    # CLI interface for Node.js worker pool
    # Usage: python backtester.py '{"branches": [...]}'

    if len(sys.argv) > 1:
        input_data = json.loads(sys.argv[1])

        if 'branches' in input_data:
            # Process batch
            results = process_batch(input_data['branches'])
            print(json.dumps({'results': results}))
        elif 'branch' in input_data:
            # Process single
            result = process_branch(input_data['branch'])
            print(json.dumps(result))
        else:
            print(json.dumps({'error': 'Invalid input'}))
    else:
        print("Usage: python backtester.py '{\"branch\": {...}}'")
