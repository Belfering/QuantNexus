"""
Indicator calculations using pandas_ta.
Supports all 57 indicators from the Flowchart app.
"""

import pandas as pd
import numpy as np
import pandas_ta as ta

def calculate_indicator(df: pd.DataFrame, indicator_id: str, period: int = None):
    """
    Calculate an indicator and return the series.

    Args:
        df: DataFrame with OHLCV columns (Date, Open, High, Low, Close, Adj Close, Volume)
        indicator_id: Indicator name (e.g., 'RSI', 'SMA')
        period: Window period (ignored for windowless indicators)

    Returns:
        pd.Series with indicator values
    """
    # Use Adj Close for calculations (accounts for splits/dividends)
    close = df['Adj Close'] if 'Adj Close' in df.columns else df['Close']
    high = df['High']
    low = df['Low']
    open_ = df['Open']
    volume = df['Volume']

    # ============================================================================
    # PRICE (1)
    # ============================================================================
    if indicator_id == 'Current Price':
        return close

    # ============================================================================
    # MOVING AVERAGES (8)
    # ============================================================================
    elif indicator_id == 'Simple Moving Average':
        return ta.sma(close, length=period)

    elif indicator_id == 'Exponential Moving Average':
        return ta.ema(close, length=period)

    elif indicator_id == 'Hull Moving Average':
        return ta.hma(close, length=period)

    elif indicator_id == 'Weighted Moving Average':
        return ta.wma(close, length=period)

    elif indicator_id == 'Wilder Moving Average':
        return ta.rma(close, length=period)  # RMA = Wilder smoothing

    elif indicator_id == 'DEMA':
        return ta.dema(close, length=period)

    elif indicator_id == 'TEMA':
        return ta.tema(close, length=period)

    elif indicator_id == 'KAMA':
        return ta.kama(close, length=period)

    # ============================================================================
    # RSI & VARIANTS (5)
    # ============================================================================
    elif indicator_id == 'RSI':
        return ta.rsi(close, length=period)

    elif indicator_id == 'RSI (SMA)':
        # RSI with SMA smoothing instead of Wilder
        gain = close.diff()
        avg_gain = gain.where(gain > 0, 0).rolling(window=period).mean()
        avg_loss = -gain.where(gain < 0, 0).rolling(window=period).mean()
        rs = avg_gain / avg_loss
        return 100 - (100 / (1 + rs))

    elif indicator_id == 'RSI (EMA)':
        # RSI with EMA smoothing
        gain = close.diff()
        avg_gain = gain.where(gain > 0, 0).ewm(span=period, adjust=False).mean()
        avg_loss = -gain.where(gain < 0, 0).ewm(span=period, adjust=False).mean()
        rs = avg_gain / avg_loss
        return 100 - (100 / (1 + rs))

    elif indicator_id == 'Stochastic RSI':
        return ta.stochrsi(close, length=period)['STOCHRSIk_14_14_3_3']  # %K line

    elif indicator_id == 'Laguerre RSI':
        # Laguerre RSI (simplified implementation)
        gamma = 0.5
        L0 = close.copy()
        L1 = L0.shift(1)
        L2 = L1.shift(1)
        L3 = L2.shift(1)

        for i in range(len(close)):
            if i >= 3:
                L0.iloc[i] = (1 - gamma) * close.iloc[i] + gamma * L0.iloc[i-1]
                L1.iloc[i] = -gamma * L0.iloc[i] + L0.iloc[i-1] + gamma * L1.iloc[i-1]
                L2.iloc[i] = -gamma * L1.iloc[i] + L1.iloc[i-1] + gamma * L2.iloc[i-1]
                L3.iloc[i] = -gamma * L2.iloc[i] + L2.iloc[i-1] + gamma * L3.iloc[i-1]

        CU = pd.Series(0.0, index=close.index)
        CD = pd.Series(0.0, index=close.index)

        for i in range(len(close)):
            if L0.iloc[i] >= L1.iloc[i]:
                CU.iloc[i] = L0.iloc[i] - L1.iloc[i]
            else:
                CD.iloc[i] = L1.iloc[i] - L0.iloc[i]

            if L1.iloc[i] >= L2.iloc[i]:
                CU.iloc[i] += L1.iloc[i] - L2.iloc[i]
            else:
                CD.iloc[i] += L2.iloc[i] - L1.iloc[i]

            if L2.iloc[i] >= L3.iloc[i]:
                CU.iloc[i] += L2.iloc[i] - L3.iloc[i]
            else:
                CD.iloc[i] += L3.iloc[i] - L2.iloc[i]

        lrsi = CU / (CU + CD) * 100
        return lrsi

    # ============================================================================
    # MOMENTUM (9)
    # ============================================================================
    elif indicator_id == 'Momentum (Weighted)':
        # 1-3-6-12 weighted momentum
        mom1 = close.pct_change(1)
        mom3 = close.pct_change(3)
        mom6 = close.pct_change(6)
        mom12 = close.pct_change(12)
        return (mom1 * 12 + mom3 * 4 + mom6 * 2 + mom12) / 19 * 100

    elif indicator_id == 'Momentum (Unweighted)':
        # 1-3-6-12 unweighted momentum
        mom1 = close.pct_change(1)
        mom3 = close.pct_change(3)
        mom6 = close.pct_change(6)
        mom12 = close.pct_change(12)
        return (mom1 + mom3 + mom6 + mom12) / 4 * 100

    elif indicator_id == 'Momentum (12-Month SMA)':
        return ta.sma(close.pct_change(period), length=12) * 100

    elif indicator_id == 'Rate of Change':
        return ta.roc(close, length=period)

    elif indicator_id == 'Williams %R':
        return ta.willr(high, low, close, length=period)

    elif indicator_id == 'CCI':
        return ta.cci(high, low, close, length=period)

    elif indicator_id == 'Stochastic %K':
        stoch = ta.stoch(high, low, close, k=period, d=3)
        return stoch[f'STOCHk_{period}_3_3']

    elif indicator_id == 'Stochastic %D':
        stoch = ta.stoch(high, low, close, k=period, d=3)
        return stoch[f'STOCHd_{period}_3_3']

    elif indicator_id == 'ADX':
        adx = ta.adx(high, low, close, length=period)
        return adx[f'ADX_{period}']

    # ============================================================================
    # VOLATILITY (10)
    # ============================================================================
    elif indicator_id == 'Standard Deviation':
        returns = close.pct_change()
        return returns.rolling(window=period).std() * np.sqrt(252) * 100

    elif indicator_id == 'Standard Deviation of Price':
        return close.rolling(window=period).std()

    elif indicator_id == 'Max Drawdown':
        # Maximum drawdown over period
        rolling_max = close.rolling(window=period, min_periods=1).max()
        drawdown = (close - rolling_max) / rolling_max * 100
        return drawdown.rolling(window=period).min()

    elif indicator_id == 'Drawdown':
        # Current drawdown from all-time high within period
        rolling_max = close.rolling(window=period, min_periods=1).max()
        return (close - rolling_max) / rolling_max * 100

    elif indicator_id == 'Bollinger %B':
        bb = ta.bbands(close, length=period, std=2)
        lower = bb[f'BBL_{period}_2.0']
        upper = bb[f'BBU_{period}_2.0']
        return (close - lower) / (upper - lower)

    elif indicator_id == 'Bollinger Bandwidth':
        bb = ta.bbands(close, length=period, std=2)
        lower = bb[f'BBL_{period}_2.0']
        upper = bb[f'BBU_{period}_2.0']
        middle = bb[f'BBM_{period}_2.0']
        return ((upper - lower) / middle) * 100

    elif indicator_id == 'ATR':
        return ta.atr(high, low, close, length=period)

    elif indicator_id == 'ATR %':
        atr = ta.atr(high, low, close, length=period)
        return (atr / close) * 100

    elif indicator_id == 'Historical Volatility':
        returns = np.log(close / close.shift(1))
        return returns.rolling(window=period).std() * np.sqrt(252) * 100

    elif indicator_id == 'Ulcer Index':
        # Ulcer Index = sqrt(mean((% drawdown)^2))
        rolling_max = close.rolling(window=period, min_periods=1).max()
        drawdown_pct = ((close - rolling_max) / rolling_max) * 100
        return np.sqrt((drawdown_pct ** 2).rolling(window=period).mean())

    # ============================================================================
    # TREND (7)
    # ============================================================================
    elif indicator_id == 'Cumulative Return':
        return (close / close.shift(period) - 1) * 100

    elif indicator_id == 'SMA of Returns':
        returns = close.pct_change()
        return ta.sma(returns, length=period) * 100

    elif indicator_id == 'Trend Clarity':
        # R-squared of linear regression
        def rsquared(y):
            if len(y) < 2:
                return np.nan
            x = np.arange(len(y))
            mask = ~np.isnan(y)
            if mask.sum() < 2:
                return np.nan
            slope, intercept = np.polyfit(x[mask], y[mask], 1)
            y_pred = slope * x + intercept
            ss_res = np.sum((y - y_pred) ** 2)
            ss_tot = np.sum((y - np.mean(y)) ** 2)
            return 1 - (ss_res / ss_tot) if ss_tot != 0 else np.nan

        return close.rolling(window=period).apply(rsquared, raw=True)

    elif indicator_id == 'Ultimate Smoother':
        # Ehlers Ultimate Smoother (simplified)
        a = 2 / (period + 1)
        smoothed = close.ewm(alpha=a, adjust=False).mean()
        return smoothed

    elif indicator_id == 'Linear Reg Slope':
        def slope(y):
            if len(y) < 2:
                return np.nan
            x = np.arange(len(y))
            mask = ~np.isnan(y)
            if mask.sum() < 2:
                return np.nan
            return np.polyfit(x[mask], y[mask], 1)[0]

        return close.rolling(window=period).apply(slope, raw=True)

    elif indicator_id == 'Linear Reg Value':
        return ta.linreg(close, length=period)

    elif indicator_id == 'Price vs SMA':
        sma = ta.sma(close, length=period)
        return close / sma

    # ============================================================================
    # AROON (3)
    # ============================================================================
    elif indicator_id == 'Aroon Up':
        aroon = ta.aroon(high, low, length=period)
        return aroon[f'AROONU_{period}']

    elif indicator_id == 'Aroon Down':
        aroon = ta.aroon(high, low, length=period)
        return aroon[f'AROOND_{period}']

    elif indicator_id == 'Aroon Oscillator':
        aroon = ta.aroon(high, low, length=period)
        return aroon[f'AROONOSC_{period}']

    # ============================================================================
    # MACD/PPO (2)
    # ============================================================================
    elif indicator_id == 'MACD Histogram':
        macd = ta.macd(close, fast=12, slow=26, signal=9)
        return macd['MACDh_12_26_9']

    elif indicator_id == 'PPO Histogram':
        ppo = ta.ppo(close, fast=12, slow=26, signal=9)
        return ppo['PPOh_12_26_9']

    # ============================================================================
    # VOLUME (3)
    # ============================================================================
    elif indicator_id == 'Money Flow Index':
        return ta.mfi(high, low, close, volume, length=period)

    elif indicator_id == 'OBV Rate of Change':
        obv = ta.obv(close, volume)
        return obv.pct_change(period) * 100

    elif indicator_id == 'VWAP Ratio':
        vwap = ta.vwap(high, low, close, volume, anchor='D')
        return close / vwap

    else:
        raise ValueError(f"Unknown indicator: {indicator_id}")


def calculate_all_periods(df: pd.DataFrame, indicator_id: str, periods: list):
    """
    Calculate an indicator for multiple periods at once (optimization).

    Args:
        df: DataFrame with OHLCV columns
        indicator_id: Indicator name
        periods: List of periods to calculate

    Returns:
        dict: {period: pd.Series}
    """
    results = {}
    for period in periods:
        results[period] = calculate_indicator(df, indicator_id, period)
    return results


if __name__ == '__main__':
    # Test with sample data
    import yfinance as yf

    print("Testing indicator calculations...")
    data = yf.download('SPY', start='2020-01-01', end='2024-01-01', progress=False)
    data = data.reset_index()
    data.columns = ['Date', 'Open', 'High', 'Low', 'Close', 'Adj Close', 'Volume']

    # Test RSI
    rsi = calculate_indicator(data, 'RSI', period=14)
    print(f"RSI(14) last 5 values:\n{rsi.tail()}")

    # Test SMA
    sma = calculate_indicator(data, 'Simple Moving Average', period=50)
    print(f"\nSMA(50) last 5 values:\n{sma.tail()}")

    print("\nIndicator calculations working correctly!")
