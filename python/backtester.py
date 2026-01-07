"""
Real backtester for Atlas Forge
Calculates indicators, generates signals, and computes metrics
"""

import sys
import json
import pandas as pd
import numpy as np
from pathlib import Path

# Import indicator calculation
from indicators import calculate_indicator

# Import individual metric functions
from metrics import (
    compute_cagr,
    compute_max_drawdown,
    compute_time_in_market,
    compute_timar,
    num_trades,
    average_hold_period,
    compute_sharpe,
    compute_dd3,
    compute_dd_percentile
)

def split_is_oos(df, strategy='even_odd_month', oos_start_date=None):
    """Split data into in-sample and out-of-sample"""
    df = df.copy()
    df['Date'] = pd.to_datetime(df['Date'])
    df['Month'] = df['Date'].dt.month
    df['Year'] = df['Date'].dt.year

    if strategy == 'even_odd_month':
        is_df = df[df['Month'] % 2 == 1].copy()  # Odd months
        oos_df = df[df['Month'] % 2 == 0].copy()  # Even months
    elif strategy == 'even_odd_year':
        is_df = df[df['Year'] % 2 == 1].copy()
        oos_df = df[df['Year'] % 2 == 0].copy()
    elif strategy == 'chronological' and oos_start_date:
        split_date = pd.to_datetime(oos_start_date)
        is_df = df[df['Date'] < split_date].copy()
        oos_df = df[df['Date'] >= split_date].copy()
    else:
        # Default: 70/30 split
        split_idx = int(len(df) * 0.7)
        is_df = df.iloc[:split_idx].copy()
        oos_df = df.iloc[split_idx:].copy()

    return is_df, oos_df

def generate_signals(df, indicator_values, comparator, threshold):
    """Generate buy/sell signals based on indicator condition"""
    df = df.copy()
    df['Indicator'] = indicator_values

    if comparator == 'LT':
        df['Signal'] = (df['Indicator'] < threshold).astype(int)
    elif comparator == 'GT':
        df['Signal'] = (df['Indicator'] > threshold).astype(int)
    else:
        df['Signal'] = 0

    return df

def calculate_returns(df):
    """Calculate returns for the strategy"""
    df = df.copy()

    # Calculate daily returns
    df['Close_Ret'] = df['Close'].pct_change()

    # Strategy returns: only when signal is active
    df['Strat_Ret'] = df['Signal'].shift(1) * df['Close_Ret']

    # Cumulative returns column (needed for metrics)
    df['CC'] = df['Strat_Ret']

    return df

def compute_metrics_dict(df):
    """Compute all metrics for a backtest"""
    if len(df) == 0 or df['CC'].isna().all():
        return None

    try:
        # Note: metrics.py functions use specific parameter names from RSI System
        tim = compute_time_in_market(df, ret_cols=['CC'], base_col_for_total='CC')
        timar = compute_timar(df, ret_col='CC', ret_cols_for_tim=['CC'])
        cagr = compute_cagr(df, ret_col='CC')
        maxdd = compute_max_drawdown(df, ret_col='CC')

        # Always scale TIM/TIMAR/CAGR from decimals to percentages
        # metrics.py returns these as decimals (0.05 = 5%, 1.20 = 120%)
        # Note: MaxDD is already returned as a positive percentage from metrics.py
        if tim is not None and not np.isnan(tim):
            tim *= 100.0
        if timar is not None and not np.isnan(timar):
            timar *= 100.0
        if cagr is not None and not np.isnan(cagr):
            cagr *= 100.0

        metrics = {
            'TIM': tim,
            'TIMAR': timar,
            'CAGR': cagr,
            'MaxDD': maxdd,  # Already positive percentage from metrics.py
            'DD3': compute_dd3(df, ret_col='CC'),
            'DD50': compute_dd_percentile(df, ret_col='CC', q=0.50),
            'DD95': compute_dd_percentile(df, ret_col='CC', q=0.95),
            'Trades': num_trades(df, ret_col='CC', ret_cols=['CC']),
            'AvgHold': average_hold_period(df, ret_col='CC', ret_cols=['CC']),
            'Sharpe': compute_sharpe(df, ret_col='CC'),
        }

        # Compute TIMARDD (both TIMAR and MaxDD are in percentage units now)
        if metrics['MaxDD'] is not None and metrics['MaxDD'] > 0.01:
            metrics['TIMARDD'] = metrics['TIMAR'] / metrics['MaxDD']
        else:
            metrics['TIMARDD'] = 0

        return metrics
    except Exception as e:
        print(f"Error computing metrics: {e}", file=sys.stderr)
        return None

def check_pass_fail(is_metrics, config):
    """Check if branch passes criteria (matches RSI System logic)"""
    if not is_metrics:
        print(f"[DEBUG] No metrics provided", file=sys.stderr)
        return False

    # Extract metrics (all in percentage units now)
    tim = is_metrics.get('TIM')
    timar = is_metrics.get('TIMAR')
    maxdd = is_metrics.get('MaxDD')
    trades = is_metrics.get('Trades')
    timardd = is_metrics.get('TIMARDD')

    print(f"[DEBUG] Metrics: TIM={tim}, TIMAR={timar}, MaxDD={maxdd}, Trades={trades}, TIMARDD={timardd}", file=sys.stderr)
    print(f"[DEBUG] Config: minTIM={config.get('minTIM')}, minTIMAR={config.get('minTIMAR')}, maxDD={config.get('maxDD')}, minTrades={config.get('minTrades')}, minTIMARDD={config.get('minTIMARDD')}", file=sys.stderr)

    # Check for None or NaN values
    if any(v is None or (isinstance(v, float) and v != v) for v in (tim, timar, maxdd, trades)):
        print(f"[DEBUG] Failed: None or NaN values detected", file=sys.stderr)
        return False

    # First pass: hard requirements
    # Note: MaxDD is already positive (e.g., 25.0 means -25%), so use <= comparison
    if tim < config.get('minTIM', 5):
        print(f"[DEBUG] Failed: TIM {tim} < minTIM {config.get('minTIM', 5)}", file=sys.stderr)
        return False
    if timar < config.get('minTIMAR', 30):
        print(f"[DEBUG] Failed: TIMAR {timar} < minTIMAR {config.get('minTIMAR', 30)}", file=sys.stderr)
        return False
    if maxdd > config.get('maxDD', 20):
        print(f"[DEBUG] Failed: MaxDD {maxdd} > maxDD {config.get('maxDD', 20)}", file=sys.stderr)
        return False
    if trades < config.get('minTrades', 50):
        print(f"[DEBUG] Failed: Trades {trades} < minTrades {config.get('minTrades', 50)}", file=sys.stderr)
        return False

    # Second pass: quality filter (TIMARDD = TIMAR / MaxDD)
    if timardd < config.get('minTIMARDD', 4):
        print(f"[DEBUG] Failed: TIMARDD {timardd} < minTIMARDD {config.get('minTIMARDD', 4)}", file=sys.stderr)
        return False

    print(f"[DEBUG] PASSED all criteria!", file=sys.stderr)
    return True

def backtest_branch(params):
    """Main backtesting function"""
    try:
        branch = params.get('branch', {})

        # Load data
        data_path = branch.get('data_path')
        if not data_path or not Path(data_path).exists():
            return {
                'passing': False,
                'error': f'Data file not found: {data_path}'
            }

        df = pd.read_parquet(data_path)

        # Extract parameters
        split_strategy = branch.get('split_strategy', 'even_odd_month')
        oos_start_date = branch.get('oos_start_date')
        config = branch.get('config', {})

        # Check if this is a flowchart mode branch
        flowchart = branch.get('flowchart')
        mode = branch.get('mode', 'simple')

        if mode == 'flowchart' and flowchart:
            # Phase 1.5: Flowchart mode
            from flowchart_executor import FlowchartExecutor

            ticker = branch.get('signal_ticker', 'SPY')
            executor = FlowchartExecutor(flowchart, ticker)

            # Split IS/OOS
            is_df, oos_df = split_is_oos(df, split_strategy, oos_start_date)

            # Execute flowchart to generate signals
            is_df = executor.execute(is_df)
            is_df = calculate_returns(is_df)

            oos_df = executor.execute(oos_df)
            oos_df = calculate_returns(oos_df)

            # Extract flowchart summary for display (simplified)
            indicator = "Flowchart"
            period = 0
            comparator = "CUSTOM"
            threshold = 0

        else:
            # Original simple mode
            indicator = branch.get('indicator', 'RSI')
            period = branch.get('period', 14)
            comparator = branch.get('comparator', 'LT')
            threshold = branch.get('threshold', 30)

            # Calculate indicator
            indicator_values = calculate_indicator(df, indicator, period)

            if indicator_values is None or indicator_values.isna().all():
                return {
                    'passing': False,
                    'error': f'Failed to calculate indicator: {indicator}'
                }

            # Split IS/OOS
            is_df, oos_df = split_is_oos(df, split_strategy, oos_start_date)
            is_indicator = indicator_values.loc[is_df.index]
            oos_indicator = indicator_values.loc[oos_df.index]

            # Generate signals and calculate returns
            is_df = generate_signals(is_df, is_indicator, comparator, threshold)
            is_df = calculate_returns(is_df)

            oos_df = generate_signals(oos_df, oos_indicator, comparator, threshold)
            oos_df = calculate_returns(oos_df)

        # Compute metrics
        is_metrics = compute_metrics_dict(is_df)
        oos_metrics = compute_metrics_dict(oos_df)

        if not is_metrics or not oos_metrics:
            return {
                'passing': False,
                'error': 'Failed to compute metrics'
            }

        # Check pass/fail
        passing = check_pass_fail(is_metrics, config)

        # Helper function to handle NaN values (convert to None for JSON compatibility)
        def safe_round(val, decimals=2):
            if val is None or (isinstance(val, float) and val != val):  # NaN check
                return None
            if isinstance(val, (int, float)) and np.isfinite(val):
                return round(val, decimals)
            return None

        # Return branch with metrics (both passing and failing)
        return {
            'passing': passing,
            'signalTicker': branch.get('signal_ticker'),
            'investTicker': branch.get('invest_ticker'),
            'indicator': indicator,
            'period': period,
            'comparator': comparator,
            'threshold': threshold,
            'isTim': safe_round(is_metrics['TIM']),
            'isTimar': safe_round(is_metrics['TIMAR']),
            'isMaxdd': safe_round(is_metrics['MaxDD']),
            'isCagr': safe_round(is_metrics['CAGR']),
            'isTrades': is_metrics['Trades'] if np.isfinite(is_metrics['Trades']) else 0,
            'isAvgHold': safe_round(is_metrics['AvgHold']),
            'isSharpe': safe_round(is_metrics['Sharpe']),
            'isDd3': safe_round(is_metrics['DD3']),
            'isDd50': safe_round(is_metrics['DD50']),
            'isDd95': safe_round(is_metrics['DD95']),
            'isTimardd': safe_round(is_metrics['TIMARDD']),
            'oosTim': safe_round(oos_metrics['TIM']),
            'oosTimar': safe_round(oos_metrics['TIMAR']),
            'oosMaxdd': safe_round(oos_metrics['MaxDD']),
            'oosCagr': safe_round(oos_metrics['CAGR']),
            'oosTrades': oos_metrics['Trades'] if np.isfinite(oos_metrics['Trades']) else 0,
            'oosAvgHold': safe_round(oos_metrics['AvgHold']),
            'oosSharpe': safe_round(oos_metrics['Sharpe']),
            'oosDd3': safe_round(oos_metrics['DD3']),
            'oosDd50': safe_round(oos_metrics['DD50']),
            'oosDd95': safe_round(oos_metrics['DD95']),
            'oosTimardd': safe_round(oos_metrics['TIMARDD']),
        }

    except Exception as e:
        return {
            'passing': False,
            'error': str(e)
        }

if __name__ == '__main__':
    if len(sys.argv) > 1:
        params = json.loads(sys.argv[1])
        result = backtest_branch(params)
        print(json.dumps(result))
    else:
        print(json.dumps({'passing': False, 'error': 'No parameters provided'}))
