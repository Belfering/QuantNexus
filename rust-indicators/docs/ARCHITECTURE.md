# Rust Indicators - Architecture & Performance Guide

## Overview

This library provides high-performance technical indicators for financial analysis. It can be used via:
- **WASM** - Import into Node.js/browser
- **CLI** - Command-line batch processing
- **Server** - HTTP API for backtesting

---

## Performance Benchmarks

### Indicator Computation Speed

| Approach | Speedup vs JS | Effort |
|----------|---------------|--------|
| Current JS | 1x | - |
| TypedArrays | 1.5-2x | Low |
| Worker threads | 3-4x | Medium |
| WASM | 2-4x | Done |
| WASM + Workers | 8-12x | Medium |
| **Rust Server** | **10-15x** | Done |
| **Rust Batch (12k tickers)** | **~25x** | Done |

### Real Benchmark Results

| Tickers | JS (estimated) | WASM | Rust Server |
|---------|----------------|------|-------------|
| 100 | ~220ms | ~80ms | **23ms** |
| 1,000 | ~2.2s | ~0.8s | **~0.2s** |
| 12,000 | ~26s | ~8s | **~2s** |

### Per-Ticker Performance

| Method | Time per Ticker |
|--------|-----------------|
| Pure JS | 2.2ms |
| WASM | 0.8ms |
| Rust Server | **0.2ms** |

### Pandas vs Rust

| Scenario | Pandas | Rust | Winner |
|----------|--------|------|--------|
| Single ticker (cached) | 2.7ms | 17ms | Pandas (HTTP overhead) |
| **Batch 100 tickers** | 221ms | 23ms | **Rust 9.4x** |

---

## Architecture Options

### Option 1: Hybrid (Node + Rust) - RECOMMENDED

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (React)                         │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Node.js Server (:8787)                       │
│                                                                 │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐               │
│  │ Auth/JWT    │ │ Users/Admin │ │ Scheduler   │               │
│  └─────────────┘ └─────────────┘ └─────────────┘               │
│                                                                 │
│  ┌─────────────┐ ┌─────────────┐                               │
│  │ SQLite      │ │ Static Files│                               │
│  │ (atlas-db)  │ │ (frontend)  │                               │
│  └─────────────┘ └─────────────┘                               │
│                                                                 │
│         │ Proxy /api/backtest, /api/indicators                 │
└─────────┼───────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Rust Server (:3030)                          │
│                       (internal)                                │
│                                                                 │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐               │
│  │ Read        │ │ Compute     │ │ Return      │               │
│  │ Parquet     │ │ Indicators  │ │ JSON        │               │
│  └─────────────┘ └─────────────┘ └─────────────┘               │
└─────────────────────────────────────────────────────────────────┘
```

**Pros:**
- Keep existing working Node.js code
- Low risk migration
- Fast iteration on business logic (Node)
- Rust only where it matters (compute)
- Can migrate incrementally

**Cons:**
- Two processes to maintain
- ~1ms HTTP overhead per Rust call
- Two languages in codebase

### Option 2: Full Rust

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (React)                         │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Rust Server (:3030)                         │
│                      (single binary)                            │
│                                                                 │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐               │
│  │ Auth/JWT    │ │ Users/Admin │ │ Scheduler   │               │
│  └─────────────┘ └─────────────┘ └─────────────┘               │
│                                                                 │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐               │
│  │ SQLite      │ │ Static Files│ │ Parquet     │               │
│  └─────────────┘ └─────────────┘ └─────────────┘               │
│                                                                 │
│  ┌─────────────┐ ┌─────────────┐                               │
│  │ Indicators  │ │ Backtest    │                               │
│  └─────────────┘ └─────────────┘                               │
└─────────────────────────────────────────────────────────────────┘
```

**Pros:**
- Single binary deployment (~20MB)
- Fastest possible performance
- ~50MB memory vs ~200MB Node
- No inter-service overhead

**Cons:**
- 3-4 days to rewrite
- 30-60s compile times
- Harder to iterate quickly
- Risk of bugs in rewrite

### Side-by-Side Comparison

| | Hybrid | Full Rust |
|---|---|---|
| **Effort** | ~2 hours | ~3-4 days |
| **Risk** | Low | Medium |
| **Backtest speed** | 10x faster | 10x faster |
| **Other endpoints** | Same | 2-3x faster |
| **Memory** | ~200MB | ~50MB |
| **Deployment** | 2 processes | 1 binary |
| **Iteration speed** | Fast (Node) | Slower (compile) |
| **AI tool friendly** | Yes (Node parts) | Slower iteration |

---

## Compile Time Considerations

### Rust Compile Times

| Change Type | Time |
|-------------|------|
| First build / clean | 60-90s |
| Change one file | 3-10s |
| Change dependency | 30-60s |
| Typo fix | 2-5s |

### Impact on AI-Assisted Development

| | Node | Rust |
|---|---|---|
| Save → test | Instant | 3-10s |
| 5 iterations | ~30s | ~2-3min |

**This is why Hybrid is recommended** - keep frequently-changed code in Node for instant feedback.

---

## Data Storage: Parquet vs Database

| | Parquet | Database (Postgres/SQLite) |
|---|---|---|
| Storage | Columnar | Row-based |
| Read pattern | Reads only needed columns | Reads entire rows |
| Compression | 5-10x smaller | Less efficient |
| Read 8K rows | ~1ms | ~5-20ms |

**Parquet is ideal for backtesting** - reading entire columns for time-series analysis.

---

## Available Binaries

### CLI Tool
```bash
# Process specific tickers
./target/release/backtest <parquet_dir> [ticker1,ticker2,...]

# Process all tickers
./target/release/backtest ../System.app/ticker-data/data/ticker_data_parquet
```

### HTTP Server
```bash
# Start server
PARQUET_DIR=../System.app/ticker-data/data/ticker_data_parquet ./target/release/backtest_server

# Endpoints
GET  /tickers              # List all tickers
GET  /candles/:ticker      # OHLCV data
GET  /indicators/:ticker   # All indicators for ticker
POST /backtest             # Batch process tickers
```

### WASM Module
```javascript
const { Indicators } = require('./pkg/flowchart_indicators.js');

const closes = new Float64Array([44, 44.5, 45, 44.5, 45.5]);
const rsi = Indicators.rsi(closes, 14);
const sma = Indicators.sma(closes, 20);
```

---

## Deployment Options

### Hybrid Deployment (Recommended)

```dockerfile
# Single container with both Node and Rust
FROM node:20-slim

# Install Rust binary
COPY rust-indicators/target/release/backtest_server /usr/local/bin/

# Node app
COPY System.app /app
WORKDIR /app
RUN npm ci --production

# Start both
CMD backtest_server & node server/index.mjs
```

### Node Integration (Simplest)

Just proxy to Rust server:
```javascript
// In Node server
app.use('/api/backtest', proxy('http://localhost:3030/backtest'));
app.use('/api/indicators', proxy('http://localhost:3030/indicators'));
```

### WASM Integration (No Rust Server)

```javascript
// Direct import in Node
const { Indicators } = require('./rust-indicators/pkg/flowchart_indicators.js');

// Replace JS indicator calls
const rsi = Indicators.rsi(new Float64Array(closes), 14);
```

---

## Indicators Available

### Moving Averages
- `sma(values, period)` - Simple Moving Average
- `ema(values, period)` - Exponential Moving Average
- `wma(values, period)` - Weighted Moving Average
- `hma(values, period)` - Hull Moving Average

### Oscillators
- `rsi(closes, period)` - Relative Strength Index
- `stoch_rsi(closes, rsi_period, stoch_period)` - Stochastic RSI
- `laguerre_rsi(closes, gamma)` - Laguerre RSI
- `williams_r(highs, lows, closes, period)` - Williams %R
- `cci(highs, lows, closes, period)` - Commodity Channel Index

### Momentum
- `macd_line(closes, fast, slow, signal)` - MACD
- `ppo(closes, fast, slow)` - Percentage Price Oscillator
- `roc(closes, period)` - Rate of Change
- `adx(highs, lows, closes, period)` - Average Directional Index
- `linreg_slope(values, period)` - Linear Regression Slope
- `linreg_slope_js(values, period)` - JS-compatible (normalized %)

### Volatility
- `atr(highs, lows, closes, period)` - Average True Range
- `bollinger_b(closes, period, std_mult)` - Bollinger %B
- `ulcer_index_js(closes, period)` - Ulcer Index (JS-compatible)
- `max_drawdown_ratio(closes)` - Maximum Drawdown (ratio)

### Trend
- `price_vs_sma_js(closes, period)` - Price vs SMA (%)
- `rolling_return(closes, period)` - Rolling Return
- `trend_r_squared(closes, period)` - Trend R-Squared
- `drawdown_ratio(closes)` - Current Drawdown (ratio)

---

## JS-Compatible Functions

Some indicators have `_js` variants that match JavaScript output format:

| Standard | JS-Compatible | Difference |
|----------|---------------|------------|
| `price_vs_sma()` | `price_vs_sma_js()` | Ratio vs Percentage |
| `linreg_slope()` | `linreg_slope_js()` | Raw vs Normalized % |
| `ulcer_index()` | `ulcer_index_js()` | Progressive vs Window max |
| `max_drawdown()` | `max_drawdown_ratio()` | Percentage vs Ratio |

Use the `_js` variants when replacing JS indicator functions to ensure identical output.

---

## Quick Start

### 1. Build Everything
```bash
cd rust-indicators

# Build release binaries
cargo build --release

# Build WASM (optional)
wasm-pack build --target nodejs --features wasm
```

### 2. Test CLI
```bash
./target/release/backtest ../System.app/ticker-data/data/ticker_data_parquet SPY,QQQ,AAPL
```

### 3. Start Server
```bash
PARQUET_DIR=../System.app/ticker-data/data/ticker_data_parquet ./target/release/backtest_server
```

### 4. Test Endpoints
```bash
curl http://localhost:3030/tickers
curl http://localhost:3030/indicators/SPY?limit=5
curl -X POST http://localhost:3030/backtest -H "Content-Type: application/json" -d '{}'
```

---

## Recommendation

**Start with Hybrid architecture:**

1. Keep Node.js for auth, users, admin, scheduler
2. Use Rust server for backtests and indicators
3. Proxy relevant endpoints to Rust

This gives you:
- 10x faster backtests
- Low migration risk
- Fast iteration on business logic
- Option to go full Rust later
