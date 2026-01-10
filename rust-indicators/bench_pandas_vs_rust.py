"""
Fair benchmark: Pandas vs Rust Server
Both read same parquet file, compute same indicators
"""
import time
import urllib.request
import json
import pandas as pd
import numpy as np
from pathlib import Path

def http_get(url):
    with urllib.request.urlopen(url) as r:
        return json.loads(r.read().decode())

def http_post(url, data):
    req = urllib.request.Request(url,
        data=json.dumps(data).encode(),
        headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode())

PARQUET_DIR = Path("../System.app/ticker-data/data/ticker_data_parquet")
RUST_SERVER = "http://localhost:3030"

# ============================================================================
# Pandas indicator implementations (matching Rust)
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

def pandas_all(filepath):
    """Read parquet + compute all indicators"""
    df = pd.read_parquet(filepath)
    closes = df['Close']
    highs = df['High']
    lows = df['Low']

    sma_20 = pandas_sma(closes, 20)
    sma_50 = pandas_sma(closes, 50)
    ema_12 = pandas_ema(closes, 12)
    ema_26 = pandas_ema(closes, 26)
    rsi_14 = pandas_rsi(closes, 14)
    roc_10 = pandas_roc(closes, 10)
    atr_14 = pandas_atr(highs, lows, closes, 14)

    return {
        'bars': len(closes),
        'rsi_14': rsi_14.iloc[-1] if len(rsi_14) > 0 else None,
    }

# ============================================================================
# Benchmark
# ============================================================================

# Test tickers of different sizes
test_tickers = ['A', 'AAPL', 'SPY', 'MSFT', 'GOOGL']

print("=" * 60)
print("Pandas vs Rust Server: Same Data, Same Indicators")
print("=" * 60)

# Single ticker comparison
for ticker in test_tickers:
    filepath = PARQUET_DIR / f"{ticker}.parquet"
    if not filepath.exists():
        continue

    iterations = 20

    # Pandas: read + compute
    start = time.perf_counter()
    for _ in range(iterations):
        result = pandas_all(filepath)
    pandas_time = (time.perf_counter() - start) / iterations * 1000

    # Rust server: read + compute (via HTTP)
    start = time.perf_counter()
    for _ in range(iterations):
        data = http_get(f"{RUST_SERVER}/indicators/{ticker}")
    rust_time = (time.perf_counter() - start) / iterations * 1000

    bars = result['bars']
    print(f"\n{ticker} ({bars:,} bars):")
    print(f"  Pandas: {pandas_time:.2f}ms (read parquet + compute)")
    print(f"  Rust:   {rust_time:.2f}ms (HTTP + read + compute + serialize)")
    print(f"  Winner: {'Rust' if rust_time < pandas_time else 'Pandas'} ({max(pandas_time,rust_time)/min(pandas_time,rust_time):.1f}x)")

# Batch comparison
print("\n" + "=" * 60)
print("Batch: 100 tickers")
print("=" * 60)

files = sorted(PARQUET_DIR.glob("*.parquet"))[:100]
tickers = [f.stem for f in files]

# Pandas batch
start = time.perf_counter()
for f in files:
    try:
        pandas_all(f)
    except:
        pass
pandas_batch = (time.perf_counter() - start) * 1000

# Rust batch (single HTTP call)
start = time.perf_counter()
data = http_post(f"{RUST_SERVER}/backtest", {"tickers": tickers})
rust_batch = (time.perf_counter() - start) * 1000

print(f"\nPandas (100 separate reads): {pandas_batch:.1f}ms")
print(f"Rust (1 batch call):         {rust_batch:.1f}ms")
print(f"Speedup: {pandas_batch/rust_batch:.1f}x")

print("\n" + "=" * 60)
