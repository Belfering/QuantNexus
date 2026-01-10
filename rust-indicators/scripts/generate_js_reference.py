#!/usr/bin/env python3
"""
Generate reference data using the EXACT same formulas as backtest.mjs.

This validates that Rust implementations match the JavaScript behavior exactly.
For standard indicators, use generate_reference_data.py (TA-Lib validation).

Usage:
    python generate_js_reference.py
"""

import json
import numpy as np
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent.parent / "test_data"
OUTPUT_DIR.mkdir(exist_ok=True)


def to_list(arr):
    """Convert numpy array to list, replacing NaN with None for JSON."""
    return [None if np.isnan(x) else float(x) for x in arr]


def generate_price_data():
    """Generate the same test data as generate_reference_data.py."""
    np.random.seed(42)
    trend_up = 100 + np.cumsum(np.random.randn(500) * 0.5 + 0.1)
    trend_down = 150 + np.cumsum(np.random.randn(500) * 0.5 - 0.1)
    sideways = 100 + np.cumsum(np.random.randn(500) * 0.8)
    volatile = 50 + np.cumsum(np.random.randn(500) * 2.0)

    return {
        "trend_up": trend_up,
        "trend_down": trend_down,
        "sideways": sideways,
        "volatile": volatile,
    }


def generate_ohlcv_data(closes):
    """Generate OHLCV data from closes (same as generate_reference_data.py)."""
    n = len(closes)
    np.random.seed(123)
    spread = np.abs(closes) * 0.02
    highs = closes + np.random.uniform(0, 1, n) * spread
    lows = closes - np.random.uniform(0, 1, n) * spread
    opens = closes + np.random.uniform(-0.5, 0.5, n) * spread
    highs = np.maximum(highs, np.maximum(opens, closes))
    lows = np.minimum(lows, np.minimum(opens, closes))
    volumes = np.random.uniform(1e6, 1e7, n)
    return opens, highs, lows, closes, volumes


# ============================================
# JS FORMULA IMPLEMENTATIONS
# These match backtest.mjs exactly
# ============================================

def js_rolling_drawdown(closes):
    """
    JavaScript: rollingDrawdown
    Returns RATIO (0.05 = 5% down from peak)
    """
    n = len(closes)
    out = np.full(n, np.nan)
    peak = None

    for i in range(n):
        v = closes[i]
        if np.isnan(v):
            continue
        if peak is None or v > peak:
            peak = v
        if peak > 0:
            out[i] = (peak - v) / peak  # Returns ratio
    return out


def js_rolling_ultimate_smoother(values, period):
    """
    JavaScript: rollingUltimateSmoother (actually SuperSmoother)
    Formula: c1 * values[i] + c2 * prev1 + c3 * prev2
    """
    n = len(values)
    out = np.full(n, np.nan)

    # 2-pole Butterworth coefficients (same as JS)
    f = 1.414 * np.pi / period
    a1 = np.exp(-f)
    b1 = 2 * a1 * np.cos(f)
    c2 = b1
    c3 = -a1 * a1
    c1 = 1 - c2 - c3

    for i in range(n):
        if i < 2 or i < period:
            out[i] = values[i]
            continue
        if np.isnan(values[i]) or np.isnan(values[i-1]) or np.isnan(values[i-2]):
            continue
        prev1 = out[i-1] if not np.isnan(out[i-1]) else values[i-1]
        prev2 = out[i-2] if not np.isnan(out[i-2]) else values[i-2]
        # JS uses: c1 * values[i] + c2 * prev1 + c3 * prev2
        out[i] = c1 * values[i] + c2 * prev1 + c3 * prev2
    return out


def js_rolling_trend_clarity(closes, period):
    """
    JavaScript: rollingTrendClarity
    Actually computes R-squared (coefficient of determination)
    """
    n = len(closes)
    out = np.full(n, np.nan)

    for i in range(period - 1, n):
        window_start = i - period + 1
        valid = True
        sum_x = 0
        sum_y = 0
        sum_xy = 0
        sum_x2 = 0
        sum_y2 = 0

        for j in range(period):
            y = closes[window_start + j]
            if np.isnan(y):
                valid = False
                break
            sum_x += j
            sum_y += y
            sum_xy += j * y
            sum_x2 += j * j
            sum_y2 += y * y

        if valid:
            num = period * sum_xy - sum_x * sum_y
            den = np.sqrt((period * sum_x2 - sum_x * sum_x) * (period * sum_y2 - sum_y * sum_y))
            r = 0 if den == 0 else num / den
            out[i] = r * r * 100  # R² as percentage
    return out


def js_rolling_stoch_rsi(closes, rsi_period, stoch_period):
    """
    JavaScript: rollingStochRsi
    Raw stochastic of RSI without smoothing
    """
    n = len(closes)

    # First calculate RSI (Wilder's method)
    rsi = js_rolling_rsi(closes, rsi_period)

    # Then calculate stochastic of RSI
    out = np.full(n, np.nan)
    for i in range(stoch_period - 1, n):
        window = rsi[i - stoch_period + 1:i + 1]
        valid = [v for v in window if not np.isnan(v)]
        if len(valid) == stoch_period:
            low = min(valid)
            high = max(valid)
            if high > low:
                out[i] = ((rsi[i] - low) / (high - low)) * 100
    return out


def js_rolling_rsi(closes, period):
    """
    JavaScript: rollingRsi
    Wilder's smoothing method
    """
    n = len(closes)
    out = np.full(n, np.nan)

    avg_gain = 0
    avg_loss = 0

    for i in range(1, n):
        change = closes[i] - closes[i-1]
        gain = max(0, change)
        loss = max(0, -change)

        if i == period:
            # Initial average
            gains = []
            losses = []
            for j in range(1, period + 1):
                c = closes[j] - closes[j-1]
                gains.append(max(0, c))
                losses.append(max(0, -c))
            avg_gain = np.mean(gains)
            avg_loss = np.mean(losses)
            if avg_loss == 0:
                out[i] = 100
            else:
                rs = avg_gain / avg_loss
                out[i] = 100 - (100 / (1 + rs))
        elif i > period:
            # Wilder's smoothing
            avg_gain = (avg_gain * (period - 1) + gain) / period
            avg_loss = (avg_loss * (period - 1) + loss) / period
            if avg_loss == 0:
                out[i] = 100
            else:
                rs = avg_gain / avg_loss
                out[i] = 100 - (100 / (1 + rs))
    return out


def js_rolling_laguerre_rsi(closes, gamma):
    """
    JavaScript: rollingLaguerreRsi
    Uses 4-element Laguerre filter
    """
    n = len(closes)
    out = np.full(n, np.nan)

    L0, L1, L2, L3 = 0, 0, 0, 0

    for i in range(n):
        if np.isnan(closes[i]):
            continue

        L0_1, L1_1, L2_1, L3_1 = L0, L1, L2, L3
        L0 = (1 - gamma) * closes[i] + gamma * L0_1
        L1 = -gamma * L0 + L0_1 + gamma * L1_1
        L2 = -gamma * L1 + L1_1 + gamma * L2_1
        L3 = -gamma * L2 + L2_1 + gamma * L3_1

        cu = 0
        cd = 0
        if L0 >= L1:
            cu += L0 - L1
        else:
            cd += L1 - L0
        if L1 >= L2:
            cu += L1 - L2
        else:
            cd += L2 - L1
        if L2 >= L3:
            cu += L2 - L3
        else:
            cd += L3 - L2

        if cu + cd != 0:
            out[i] = cu / (cu + cd) * 100
    return out


def js_rolling_ppo_histogram(closes, fast=12, slow=26, signal=9):
    """
    JavaScript: rollingPPO
    Returns the histogram (PPO line - signal line)
    """
    n = len(closes)

    # Calculate EMAs
    ema_fast = js_rolling_ema(closes, fast)
    ema_slow = js_rolling_ema(closes, slow)

    # PPO line
    ppo_line = np.full(n, np.nan)
    for i in range(n):
        if not np.isnan(ema_fast[i]) and not np.isnan(ema_slow[i]) and ema_slow[i] != 0:
            ppo_line[i] = ((ema_fast[i] - ema_slow[i]) / ema_slow[i]) * 100

    # Signal line (EMA of PPO)
    signal_line = js_rolling_ema(ppo_line, signal)

    # Histogram
    histogram = np.full(n, np.nan)
    for i in range(n):
        if not np.isnan(ppo_line[i]) and not np.isnan(signal_line[i]):
            histogram[i] = ppo_line[i] - signal_line[i]

    return ppo_line, signal_line, histogram


def js_rolling_ema(values, period):
    """
    JavaScript: rollingEma
    """
    n = len(values)
    out = np.full(n, np.nan)
    mult = 2 / (period + 1)

    # Find first valid value for SMA seed
    first_valid = None
    for i in range(n):
        if not np.isnan(values[i]):
            if first_valid is None:
                first_valid = i
            if i >= first_valid + period - 1:
                # Calculate initial SMA
                sma = np.mean(values[first_valid:first_valid + period])
                out[i] = sma
                # Continue with EMA
                for j in range(i + 1, n):
                    if np.isnan(values[j]):
                        continue
                    out[j] = (values[j] - out[j-1]) * mult + out[j-1]
                break
    return out


def js_rolling_ulcer_index(closes, period):
    """
    JavaScript: rollingUlcerIndex
    Progressive max within window (Peter Martin's original method)
    """
    n = len(closes)
    out = np.full(n, np.nan)

    for i in range(period - 1, n):
        window_start = i - period + 1
        max_close = -np.inf
        sum_sq = 0
        valid = True

        for j in range(period):
            v = closes[window_start + j]
            if np.isnan(v):
                valid = False
                break
            if v > max_close:
                max_close = v
            pct_drawdown = ((v - max_close) / max_close) * 100
            sum_sq += pct_drawdown * pct_drawdown

        if valid:
            out[i] = np.sqrt(sum_sq / period)

    return out


def js_rolling_price_vs_sma(closes, period):
    """
    JavaScript: rollingPriceVsSma
    Returns percentage difference from SMA: ((Close / SMA) - 1) * 100
    """
    n = len(closes)
    out = np.full(n, np.nan)

    # Calculate SMA
    sma = np.full(n, np.nan)
    for i in range(period - 1, n):
        sma[i] = np.mean(closes[i - period + 1:i + 1])

    # Calculate percentage difference
    for i in range(n):
        if not np.isnan(sma[i]) and sma[i] != 0:
            out[i] = ((closes[i] / sma[i]) - 1) * 100

    return out


def js_rolling_linreg_slope(values, period):
    """
    JavaScript: rollingLinRegSlope
    Returns percentage slope: (slope / avgPrice) * 100
    """
    n = len(values)
    out = np.full(n, np.nan)

    # Pre-calculate sum of x and sum of x^2
    x_vals = np.arange(period)
    sum_x = np.sum(x_vals)
    sum_x2 = np.sum(x_vals ** 2)

    for i in range(period - 1, n):
        window = values[i - period + 1:i + 1]

        # Sum of y and x*y
        sum_y = np.sum(window)
        sum_xy = np.sum(x_vals * window)

        # Slope = (n * sum_xy - sum_x * sum_y) / (n * sum_x2 - sum_x^2)
        num = period * sum_xy - sum_x * sum_y
        den = period * sum_x2 - sum_x * sum_x

        if den != 0:
            slope = num / den
            avg_price = np.mean(window)
            if avg_price != 0:
                out[i] = (slope / avg_price) * 100

    return out


def js_rolling_max_drawdown(closes):
    """
    JavaScript: rollingMaxDrawdown
    Returns max drawdown as RATIO (0.0 to 1.0)
    """
    n = len(closes)
    out = np.full(n, np.nan)
    peak = closes[0]
    max_dd = 0.0

    for i in range(n):
        if closes[i] > peak:
            peak = closes[i]
        dd = (peak - closes[i]) / peak
        if dd > max_dd:
            max_dd = dd
        out[i] = max_dd  # Returns ratio (not percentage)

    return out


def generate_js_indicators(prices):
    """Generate reference data using exact JS formulas."""
    results = {}

    for name, data in prices.items():
        closes = data.astype(np.float64)
        opens, highs, lows, closes, volumes = generate_ohlcv_data(closes)

        # Drawdown (JS returns ratio, not percentage)
        drawdown = js_rolling_drawdown(closes)

        # Ultimate Smoother / SuperSmoother (JS formula)
        ultsmooth_10 = js_rolling_ultimate_smoother(closes, 10)
        ultsmooth_20 = js_rolling_ultimate_smoother(closes, 20)

        # Trend Clarity (R-squared) - different from Rust trend_clarity!
        # JS: R-squared, Rust: net_change / total_movement
        trend_clarity_r2_14 = js_rolling_trend_clarity(closes, 14)
        trend_clarity_r2_20 = js_rolling_trend_clarity(closes, 20)

        # StochRSI (raw, no smoothing)
        stochrsi_14 = js_rolling_stoch_rsi(closes, 14, 14)

        # Laguerre RSI
        laguerre_rsi_08 = js_rolling_laguerre_rsi(closes, 0.8)
        laguerre_rsi_05 = js_rolling_laguerre_rsi(closes, 0.5)

        # PPO
        ppo_line, ppo_signal, ppo_hist = js_rolling_ppo_histogram(closes)

        # Ulcer Index (JS formula - progressive max within window)
        ulcer_index_14 = js_rolling_ulcer_index(closes, 14)

        # Price vs SMA (JS returns percentage, not ratio)
        price_vs_sma_20 = js_rolling_price_vs_sma(closes, 20)
        price_vs_sma_50 = js_rolling_price_vs_sma(closes, 50)

        # LinReg Slope (JS returns normalized percentage slope)
        linreg_slope_14 = js_rolling_linreg_slope(closes, 14)
        linreg_slope_20 = js_rolling_linreg_slope(closes, 20)

        # Max Drawdown (JS returns ratio, not percentage)
        max_drawdown = js_rolling_max_drawdown(closes)

        results[name] = {
            "closes": to_list(closes),
            "highs": to_list(highs),
            "lows": to_list(lows),
            "volumes": to_list(volumes),
            # Drawdown (JS ratio 0-1)
            "drawdown_js": to_list(drawdown),
            # Ultimate Smoother (JS formula)
            "ultsmooth_10": to_list(ultsmooth_10),
            "ultsmooth_20": to_list(ultsmooth_20),
            # Trend Clarity R² (JS) - note: different from Rust trend_clarity!
            "trend_clarity_r2_14": to_list(trend_clarity_r2_14),
            "trend_clarity_r2_20": to_list(trend_clarity_r2_20),
            # StochRSI (raw)
            "stochrsi_14": to_list(stochrsi_14),
            # Laguerre RSI
            "laguerre_rsi_08": to_list(laguerre_rsi_08),
            "laguerre_rsi_05": to_list(laguerre_rsi_05),
            # PPO
            "ppo_line": to_list(ppo_line),
            "ppo_signal": to_list(ppo_signal),
            "ppo_hist": to_list(ppo_hist),
            # Ulcer Index (JS formula)
            "ulcer_index_js_14": to_list(ulcer_index_14),
            # Price vs SMA (JS percentage)
            "price_vs_sma_js_20": to_list(price_vs_sma_20),
            "price_vs_sma_js_50": to_list(price_vs_sma_50),
            # LinReg Slope (JS normalized percentage)
            "linreg_slope_js_14": to_list(linreg_slope_14),
            "linreg_slope_js_20": to_list(linreg_slope_20),
            # Max Drawdown (JS ratio)
            "max_drawdown_js": to_list(max_drawdown),
        }

    return results


def main():
    print("Generating reference data from JavaScript formulas...")

    prices = generate_price_data()

    print("  JS custom indicators...")
    js_data = generate_js_indicators(prices)
    with open(OUTPUT_DIR / "js_reference.json", "w") as f:
        json.dump(js_data, f, indent=2)

    print(f"\nJS reference data written to: {OUTPUT_DIR / 'js_reference.json'}")
    print("\nIndicators validated against JS formulas:")
    print("  - drawdown_js: Current drawdown from ATH (returns ratio 0-1)")
    print("  - ultsmooth_*: Ultimate Smoother (JS SuperSmoother variant)")
    print("  - trend_clarity_r2_*: R-squared (different from Rust trend_clarity!)")
    print("  - stochrsi_*: Raw StochRSI (no smoothing)")
    print("  - laguerre_rsi_*: Laguerre RSI")
    print("  - ppo_*: PPO line, signal, histogram")
    print("  - ulcer_index_js_*: Ulcer Index (progressive max within window)")
    print("  - price_vs_sma_js_*: Price vs SMA (percentage difference)")
    print("  - linreg_slope_js_*: LinReg Slope (normalized by avg price)")
    print("  - max_drawdown_js: Max drawdown (ratio 0-1)")
    print("\nIMPORTANT DIFFERENCES:")
    print("  - drawdown: JS=ratio (0.05), Rust=percentage (5.0)")
    print("  - max_drawdown: JS=ratio (0.05), Rust=percentage (5.0)")
    print("  - trend_clarity: JS=R², Rust=net_change/total_movement")
    print("  - ultimateSmoother: JS uses c1*x, Rust uses c1*(x+x[1])/2")
    print("  - price_vs_sma: JS=percentage (5.0), Rust=ratio (1.05)")
    print("  - linreg_slope: JS=normalized %, Rust=raw slope")


if __name__ == "__main__":
    main()
