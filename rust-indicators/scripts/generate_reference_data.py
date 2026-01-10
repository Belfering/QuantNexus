#!/usr/bin/env python3
"""
Generate reference data from TA-Lib and pandas-ta for validating Rust implementations.

Usage:
    pip install TA-Lib numpy pandas pandas-ta
    python generate_reference_data.py

Outputs JSON files in ../test_data/ directory.
"""

import json
import numpy as np
from pathlib import Path

try:
    import talib
except ImportError:
    print("TA-Lib not installed. Install with: pip install TA-Lib")
    print("Note: You may need to install the C library first:")
    print("  macOS: brew install ta-lib")
    print("  Ubuntu: apt-get install libta-lib-dev")
    exit(1)

# Try to import pandas-ta for independent validation
try:
    import pandas as pd
    import pandas_ta as pta
    HAS_PANDAS_TA = True
except ImportError:
    print("Warning: pandas-ta not installed. Using manual formula implementations.")
    HAS_PANDAS_TA = False

def calc_rolling_vwap(highs, lows, closes, volumes, period):
    """Rolling VWAP - manual implementation (pandas-ta VWAP is session-based)."""
    n = len(closes)
    typical_price = (highs + lows + closes) / 3
    result = np.full(n, np.nan)

    for i in range(period - 1, n):
        window_tp = typical_price[i - period + 1:i + 1]
        window_vol = volumes[i - period + 1:i + 1]
        vol_sum = np.sum(window_vol)
        if vol_sum > 0:
            result[i] = np.sum(window_tp * window_vol) / vol_sum
    return result

# Output directory
OUTPUT_DIR = Path(__file__).parent.parent / "test_data"
OUTPUT_DIR.mkdir(exist_ok=True)

def to_list(arr):
    """Convert numpy array to list, replacing NaN with None for JSON."""
    return [None if np.isnan(x) else float(x) for x in arr]

def generate_price_data():
    """Generate realistic price data for testing."""
    np.random.seed(42)  # Reproducible

    # Trending up
    trend_up = 100 + np.cumsum(np.random.randn(500) * 0.5 + 0.1)

    # Trending down
    trend_down = 150 + np.cumsum(np.random.randn(500) * 0.5 - 0.1)

    # Sideways/choppy
    sideways = 100 + np.cumsum(np.random.randn(500) * 0.8)

    # Volatile (like meme stocks)
    volatile = 50 + np.cumsum(np.random.randn(500) * 2.0)

    # Combined realistic data
    combined = np.concatenate([trend_up, trend_down, sideways, volatile])

    return {
        "trend_up": trend_up,
        "trend_down": trend_down,
        "sideways": sideways,
        "volatile": volatile,
        "combined": combined,
    }

def generate_ohlcv_data(closes):
    """Generate OHLCV data from closes."""
    n = len(closes)
    np.random.seed(123)

    # Generate high/low around close
    spread = np.abs(closes) * 0.02  # 2% typical spread
    highs = closes + np.random.uniform(0, 1, n) * spread
    lows = closes - np.random.uniform(0, 1, n) * spread
    opens = closes + np.random.uniform(-0.5, 0.5, n) * spread

    # Ensure OHLC consistency
    highs = np.maximum(highs, np.maximum(opens, closes))
    lows = np.minimum(lows, np.minimum(opens, closes))

    # Volume
    volumes = np.random.uniform(1e6, 1e7, n)

    return opens, highs, lows, closes, volumes

def generate_moving_averages(prices):
    """Generate MA reference data."""
    results = {}

    for name, data in prices.items():
        closes = data.astype(np.float64)

        results[name] = {
            "input": to_list(closes),
            "sma_10": to_list(talib.SMA(closes, 10)),
            "sma_20": to_list(talib.SMA(closes, 20)),
            "sma_50": to_list(talib.SMA(closes, 50)),
            "ema_10": to_list(talib.EMA(closes, 10)),
            "ema_20": to_list(talib.EMA(closes, 20)),
            "ema_50": to_list(talib.EMA(closes, 50)),
            "wma_10": to_list(talib.WMA(closes, 10)),
            "wma_20": to_list(talib.WMA(closes, 20)),
            "dema_10": to_list(talib.DEMA(closes, 10)),
            "dema_20": to_list(talib.DEMA(closes, 20)),
            "tema_10": to_list(talib.TEMA(closes, 10)),
            "tema_20": to_list(talib.TEMA(closes, 20)),
            "kama_10": to_list(talib.KAMA(closes, 10)),
            "kama_30": to_list(talib.KAMA(closes, 30)),
            "trima_10": to_list(talib.TRIMA(closes, 10)),
            "trima_20": to_list(talib.TRIMA(closes, 20)),
            "t3_10": to_list(talib.T3(closes, 10)),
        }

    return results

def generate_oscillators(prices):
    """Generate oscillator reference data."""
    results = {}

    for name, data in prices.items():
        closes = data.astype(np.float64)
        opens, highs, lows, closes, volumes = generate_ohlcv_data(closes)

        # Stochastic RSI
        stochrsi_k, stochrsi_d = talib.STOCHRSI(closes, 14, 5, 3, 0)

        results[name] = {
            "closes": to_list(closes),
            "highs": to_list(highs),
            "lows": to_list(lows),
            "volumes": to_list(volumes),
            "rsi_14": to_list(talib.RSI(closes, 14)),
            "rsi_7": to_list(talib.RSI(closes, 7)),
            "rsi_21": to_list(talib.RSI(closes, 21)),
            # Use STOCHF for fast/raw stochastic (not smoothed STOCH)
            "stoch_k_14": to_list(talib.STOCHF(highs, lows, closes, 14, 3, 0)[0]),
            "stoch_d_14": to_list(talib.STOCHF(highs, lows, closes, 14, 3, 0)[1]),
            "willr_14": to_list(talib.WILLR(highs, lows, closes, 14)),
            "cci_14": to_list(talib.CCI(highs, lows, closes, 14)),
            "cci_20": to_list(talib.CCI(highs, lows, closes, 20)),
            "mfi_14": to_list(talib.MFI(highs, lows, closes, volumes, 14)),
            "mfi_20": to_list(talib.MFI(highs, lows, closes, volumes, 20)),
            # Stochastic RSI
            "stochrsi_k_14": to_list(stochrsi_k),
            "stochrsi_d_14": to_list(stochrsi_d),
            # CMO - Chande Momentum Oscillator
            "cmo_14": to_list(talib.CMO(closes, 14)),
            # Ultimate Oscillator
            "ultosc": to_list(talib.ULTOSC(highs, lows, closes, 7, 14, 28)),
        }

    return results

def generate_momentum(prices):
    """Generate momentum indicator reference data."""
    results = {}

    for name, data in prices.items():
        closes = data.astype(np.float64)
        opens, highs, lows, closes, volumes = generate_ohlcv_data(closes)

        macd, macd_signal, macd_hist = talib.MACD(closes, 12, 26, 9)
        aroon_down, aroon_up = talib.AROON(highs, lows, 14)

        results[name] = {
            "closes": to_list(closes),
            "highs": to_list(highs),
            "lows": to_list(lows),
            "macd_line": to_list(macd),
            "macd_signal": to_list(macd_signal),
            "macd_hist": to_list(macd_hist),
            "ppo": to_list(talib.PPO(closes, 12, 26)),
            "apo": to_list(talib.APO(closes, 12, 26)),
            "roc_10": to_list(talib.ROC(closes, 10)),
            "roc_20": to_list(talib.ROC(closes, 20)),
            "rocp_10": to_list(talib.ROCP(closes, 10)),
            "mom_10": to_list(talib.MOM(closes, 10)),
            "mom_20": to_list(talib.MOM(closes, 20)),
            "aroon_up_14": to_list(aroon_up),
            "aroon_down_14": to_list(aroon_down),
            "aroon_osc_14": to_list(talib.AROONOSC(highs, lows, 14)),
            "adx_14": to_list(talib.ADX(highs, lows, closes, 14)),
            "adxr_14": to_list(talib.ADXR(highs, lows, closes, 14)),
            "dx_14": to_list(talib.DX(highs, lows, closes, 14)),
            "plus_di_14": to_list(talib.PLUS_DI(highs, lows, closes, 14)),
            "minus_di_14": to_list(talib.MINUS_DI(highs, lows, closes, 14)),
            "linreg_slope_14": to_list(talib.LINEARREG_SLOPE(closes, 14)),
            "linreg_14": to_list(talib.LINEARREG(closes, 14)),
            "linreg_intercept_14": to_list(talib.LINEARREG_INTERCEPT(closes, 14)),
            "linreg_angle_14": to_list(talib.LINEARREG_ANGLE(closes, 14)),
            "trix_14": to_list(talib.TRIX(closes, 14)),
        }

    return results

def generate_volatility(prices):
    """Generate volatility indicator reference data."""
    results = {}

    for name, data in prices.items():
        closes = data.astype(np.float64)
        opens, highs, lows, closes, volumes = generate_ohlcv_data(closes)

        upper, middle, lower = talib.BBANDS(closes, 20, 2, 2)

        results[name] = {
            "closes": to_list(closes),
            "highs": to_list(highs),
            "lows": to_list(lows),
            "atr_14": to_list(talib.ATR(highs, lows, closes, 14)),
            "atr_20": to_list(talib.ATR(highs, lows, closes, 20)),
            "natr_14": to_list(talib.NATR(highs, lows, closes, 14)),
            "trange": to_list(talib.TRANGE(highs, lows, closes)),
            "stddev_20": to_list(talib.STDDEV(closes, 20)),
            "stddev_10": to_list(talib.STDDEV(closes, 10)),
            "var_20": to_list(talib.VAR(closes, 20)),
            "bbands_upper_20": to_list(upper),
            "bbands_middle_20": to_list(middle),
            "bbands_lower_20": to_list(lower),
        }

    return results

def generate_volume_indicators(prices):
    """Generate volume indicator reference data."""
    results = {}

    for name, data in prices.items():
        closes = data.astype(np.float64)
        opens, highs, lows, closes, volumes = generate_ohlcv_data(closes)

        results[name] = {
            "closes": to_list(closes),
            "highs": to_list(highs),
            "lows": to_list(lows),
            "volumes": to_list(volumes),
            "obv": to_list(talib.OBV(closes, volumes)),
            "ad": to_list(talib.AD(highs, lows, closes, volumes)),
            "adosc": to_list(talib.ADOSC(highs, lows, closes, volumes, 3, 10)),
        }

    return results

def generate_derived_indicators(prices):
    """Generate derived indicators that can be validated mathematically."""
    results = {}

    for name, data in prices.items():
        closes = data.astype(np.float64)
        opens, highs, lows, closes, volumes = generate_ohlcv_data(closes)

        # Bollinger %B = (close - lower) / (upper - lower)
        upper, middle, lower = talib.BBANDS(closes, 20, 2, 2)
        bbpctb = (closes - lower) / (upper - lower)

        # Bollinger Bandwidth = (upper - lower) / middle * 100
        bbwidth = (upper - lower) / middle * 100

        # NATR is ATR% essentially (ATR / close * 100)
        atr = talib.ATR(highs, lows, closes, 14)
        atr_pct = atr / closes * 100

        # Cumulative return
        cumret_10 = np.full(len(closes), np.nan)
        for i in range(10, len(closes)):
            cumret_10[i] = (closes[i] / closes[i - 10] - 1) * 100

        # Price vs SMA
        sma_20 = talib.SMA(closes, 20)
        price_vs_sma = closes / sma_20

        results[name] = {
            "closes": to_list(closes),
            "highs": to_list(highs),
            "lows": to_list(lows),
            "bbpctb_20": to_list(bbpctb),
            "bbwidth_20": to_list(bbwidth),
            "atr_pct_14": to_list(atr_pct),
            "cumret_10": to_list(cumret_10),
            "price_vs_sma_20": to_list(price_vs_sma),
        }

    return results

def generate_custom_indicators(prices):
    """Generate reference data for custom indicators using pandas-ta (independent library)."""
    if not HAS_PANDAS_TA:
        print("    Skipping pandas-ta indicators (not installed)")
        return {}

    results = {}

    for name, data in prices.items():
        closes = data.astype(np.float64)
        opens, highs, lows, closes, volumes = generate_ohlcv_data(closes)

        # Create DataFrame for pandas-ta
        df = pd.DataFrame({
            'open': opens,
            'high': highs,
            'low': lows,
            'close': closes,
            'volume': volumes
        })

        # Hull Moving Average - pandas-ta
        hma_10 = pta.hma(df['close'], length=10)
        hma_20 = pta.hma(df['close'], length=20)

        # Choppiness Index - pandas-ta
        chop_14 = pta.chop(df['high'], df['low'], df['close'], length=14)

        # Ulcer Index - pandas-ta
        ui_14 = pta.ui(df['close'], length=14)

        # Efficiency Ratio - pandas-ta
        er_10 = pta.er(df['close'], length=10)

        # Rolling VWAP (manual - pandas-ta VWAP is session-based, not rolling)
        vwap_20 = calc_rolling_vwap(highs, lows, closes, volumes, 20)

        # Super Smoother Filter - pandas-ta (John Ehlers)
        ssf_10 = pta.ssf(df['close'], length=10)

        # PPO - pandas-ta
        ppo_df = pta.ppo(df['close'], fast=12, slow=26, signal=9)
        ppo_line = ppo_df.iloc[:, 0]  # PPO line
        ppo_hist = ppo_df.iloc[:, 1]  # PPO histogram
        ppo_signal = ppo_df.iloc[:, 2]  # PPO signal

        # StochRSI - pandas-ta
        stochrsi_df = pta.stochrsi(df['close'], length=14, rsi_length=14, k=3, d=3)
        stochrsi_k = stochrsi_df.iloc[:, 0]
        stochrsi_d = stochrsi_df.iloc[:, 1]

        # Drawdown - pandas-ta
        # Note: pandas-ta returns drawdown as ratio (0-1), our Rust returns percentage (0-100)
        dd_df = pta.drawdown(df['close'])
        drawdown_pct_raw = dd_df['DD_PCT'] if 'DD_PCT' in dd_df.columns else dd_df.iloc[:, 1]
        drawdown_pct = drawdown_pct_raw * 100  # Convert to percentage to match Rust

        results[name] = {
            "closes": to_list(closes),
            "highs": to_list(highs),
            "lows": to_list(lows),
            "volumes": to_list(volumes),
            "hma_10": to_list(hma_10.values),
            "hma_20": to_list(hma_20.values),
            "chop_14": to_list(chop_14.values),
            "ui_14": to_list(ui_14.values),
            "er_10": to_list(er_10.values),
            "vwap_20": to_list(vwap_20),
            "ssf_10": to_list(ssf_10.values),
            "ppo_line": to_list(ppo_line.values),
            "ppo_hist": to_list(ppo_hist.values),
            "ppo_signal": to_list(ppo_signal.values),
            "stochrsi_k": to_list(stochrsi_k.values),
            "stochrsi_d": to_list(stochrsi_d.values),
            "drawdown_pct": to_list(drawdown_pct.values),
        }

    return results


def main():
    print("Generating reference data from TA-Lib...")

    # Generate test price data
    prices = generate_price_data()

    # Generate reference data for each category
    print("  Moving averages...")
    ma_data = generate_moving_averages(prices)
    with open(OUTPUT_DIR / "moving_averages.json", "w") as f:
        json.dump(ma_data, f, indent=2)

    print("  Oscillators...")
    osc_data = generate_oscillators(prices)
    with open(OUTPUT_DIR / "oscillators.json", "w") as f:
        json.dump(osc_data, f, indent=2)

    print("  Momentum...")
    mom_data = generate_momentum(prices)
    with open(OUTPUT_DIR / "momentum.json", "w") as f:
        json.dump(mom_data, f, indent=2)

    print("  Volatility...")
    vol_data = generate_volatility(prices)
    with open(OUTPUT_DIR / "volatility.json", "w") as f:
        json.dump(vol_data, f, indent=2)

    print("  Volume...")
    volume_data = generate_volume_indicators(prices)
    with open(OUTPUT_DIR / "volume.json", "w") as f:
        json.dump(volume_data, f, indent=2)

    print("  Derived indicators...")
    derived_data = generate_derived_indicators(prices)
    with open(OUTPUT_DIR / "derived.json", "w") as f:
        json.dump(derived_data, f, indent=2)

    # Generate reference data for custom indicators (using documented formulas)
    print("  Custom indicators (documented formulas)...")
    custom_data = generate_custom_indicators(prices)
    with open(OUTPUT_DIR / "custom.json", "w") as f:
        json.dump(custom_data, f, indent=2)

    print(f"\nReference data written to: {OUTPUT_DIR}")
    print("\nIndicators validated against TA-Lib:")
    print("  Moving Averages: SMA, EMA, WMA, DEMA, TEMA, KAMA, TRIMA, T3")
    print("  Oscillators: RSI, Stoch K/D, Williams %R, CCI, MFI, StochRSI, CMO, ULTOSC")
    print("  Momentum: MACD, PPO, APO, ROC, MOM, Aroon, ADX, DX, +DI/-DI, LinReg, TRIX")
    print("  Volatility: ATR, NATR, True Range, StdDev, Variance, Bollinger Bands")
    print("  Volume: OBV, AD, ADOSC")
    print("  Derived: Bollinger %B, Bollinger Width, ATR%, Cumulative Return, Price vs SMA")
    if HAS_PANDAS_TA:
        print("\nCustom indicators validated against pandas-ta library:")
        print("  HMA, Choppiness Index, Ulcer Index, Efficiency Ratio (all from pandas-ta)")
        print("  Rolling VWAP (manual formula - pandas-ta VWAP is session-based)")
    print("\nNext: Run `cargo test --release` to validate Rust implementations")

if __name__ == "__main__":
    main()
