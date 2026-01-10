"""
Benchmark: Rust vs Pandas indicator calculations
"""
import time
import json
import subprocess
import pandas as pd
import numpy as np
from pathlib import Path

PARQUET_DIR = Path("../System.app/ticker-data/data/ticker_data_parquet")

# ============================================================================
# Pandas indicator implementations
# ============================================================================

def pandas_sma(closes, period):
    return closes.rolling(window=period).mean()

def pandas_ema(closes, period):
    return closes.ewm(span=period, adjust=False).mean()

def pandas_rsi(closes, period=14):
    delta = closes.diff()
    gain = delta.where(delta > 0, 0)
    loss = (-delta).where(delta < 0, 0)

    avg_gain = gain.ewm(alpha=1/period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1/period, min_periods=period, adjust=False).mean()

    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))

def pandas_roc(closes, period):
    return ((closes / closes.shift(period)) - 1) * 100

def pandas_atr(highs, lows, closes, period=14):
    tr1 = highs - lows
    tr2 = abs(highs - closes.shift())
    tr3 = abs(lows - closes.shift())
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    return tr.ewm(alpha=1/period, min_periods=period, adjust=False).mean()

def pandas_max_drawdown(closes):
    peak = closes.expanding().max()
    dd = (peak - closes) / peak
    return dd.expanding().max()

def pandas_price_vs_sma(closes, period):
    sma = closes.rolling(window=period).mean()
    return ((closes / sma) - 1) * 100

# ============================================================================
# Benchmark
# ============================================================================

def process_ticker_pandas(filepath):
    """Process one ticker with pandas"""
    df = pd.read_parquet(filepath)
    closes = df['Close']
    highs = df['High']
    lows = df['Low']

    # Compute indicators
    sma_20 = pandas_sma(closes, 20)
    sma_50 = pandas_sma(closes, 50)
    ema_12 = pandas_ema(closes, 12)
    rsi_14 = pandas_rsi(closes, 14)
    roc_10 = pandas_roc(closes, 10)
    atr_14 = pandas_atr(highs, lows, closes, 14)
    max_dd = pandas_max_drawdown(closes)
    price_vs_sma = pandas_price_vs_sma(closes, 50)

    return {
        'ticker': filepath.stem,
        'bars': len(closes),
        'rsi_14': rsi_14.iloc[-1] if not rsi_14.empty else None,
        'sma_50': sma_50.iloc[-1] if not sma_50.empty else None,
    }

def main():
    # Get list of parquet files
    files = sorted(PARQUET_DIR.glob("*.parquet"))
    total_files = len(files)

    print("=" * 60)
    print("Pandas vs Rust Indicator Benchmark")
    print("=" * 60)

    # Test on subset first
    for num_tickers in [100, 500, 1000]:
        test_files = files[:num_tickers]

        # Pandas benchmark
        print(f"\n--- {num_tickers} tickers ---")

        start = time.perf_counter()
        pandas_results = []
        for f in test_files:
            try:
                pandas_results.append(process_ticker_pandas(f))
            except Exception as e:
                pass
        pandas_time = time.perf_counter() - start

        print(f"Pandas:  {pandas_time*1000:.1f}ms ({pandas_time*1000/num_tickers:.3f}ms/ticker)")

        # Rust benchmark
        tickers = ",".join([f.stem for f in test_files])
        start = time.perf_counter()
        result = subprocess.run(
            ["./target/release/backtest", str(PARQUET_DIR), tickers],
            capture_output=True,
            text=True
        )
        rust_time = time.perf_counter() - start

        print(f"Rust:    {rust_time*1000:.1f}ms ({rust_time*1000/num_tickers:.3f}ms/ticker)")
        print(f"Speedup: {pandas_time/rust_time:.1f}x")

    # Full benchmark
    print(f"\n--- ALL {total_files} tickers ---")

    start = time.perf_counter()
    pandas_results = []
    for f in files:
        try:
            pandas_results.append(process_ticker_pandas(f))
        except:
            pass
    pandas_time = time.perf_counter() - start

    print(f"Pandas:  {pandas_time*1000:.1f}ms ({pandas_time*1000/total_files:.3f}ms/ticker)")

    start = time.perf_counter()
    result = subprocess.run(
        ["./target/release/backtest", str(PARQUET_DIR)],
        capture_output=True,
        text=True
    )
    rust_time = time.perf_counter() - start

    print(f"Rust:    {rust_time*1000:.1f}ms ({rust_time*1000/total_files:.3f}ms/ticker)")
    print(f"Speedup: {pandas_time/rust_time:.1f}x")

    print("\n" + "=" * 60)

if __name__ == "__main__":
    main()
