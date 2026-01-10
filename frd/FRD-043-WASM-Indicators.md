# FRD-043: WASM-Accelerated Indicator Calculations

## Metadata
- **ID**: FRD-043
- **Title**: WASM-Accelerated Indicator Calculations
- **Status**: PROPOSED
- **Priority**: High
- **Owner**: System
- **Created**: 2026-01-07
- **Depends On**: FRD-042 (Ticker Cache)

---

## Executive Summary

Replace pure JavaScript indicator calculations with WebAssembly (WASM) for 27-50x performance improvement. Critical for bots with 1000+ indicator combinations.

---

## Problem Statement

### Current State

```
INDICATOR COMPUTATION (backtest.mjs)
════════════════════════════════════

~50 indicator functions in pure JavaScript:
- rollingSma, rollingEma, rollingRsi
- rollingMacd, rollingBollinger, rollingAtr
- rollingStoch, rollingAdx, rollingCci
- ... and 40+ more

Performance per indicator (20,000 bars):
- SMA:  ~5ms
- RSI:  ~8ms
- MACD: ~15ms
- ADX:  ~20ms

For 10,000 indicators: 10,000 × 8ms = 80 SECONDS
```

### The Bottleneck

```
┌─────────────────────────────────────────────────────────┐
│  BACKTEST TIMING BREAKDOWN (10,000 indicators)         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Load ticker data:     10 sec → 10ms (with cache) ✅   │
│  Compute indicators:   80 sec → STILL 80 SEC ❌        │
│  Run backtest logic:   ~1 sec                          │
│                                                         │
│  TOTAL:               ~81 sec (computation dominates)  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Goals

1. **27x Speedup**: Reduce indicator computation from 80 sec to ~3 sec
2. **Easy Deployment**: Use WASM (works on Railway without native compilation)
3. **Drop-in Replacement**: Swap JS functions for WASM equivalents
4. **Indicator Caching**: Cache computed results for repeat queries

## Non-Goals

1. Custom Rust implementation (use existing talib-wasm)
2. GPU acceleration (overkill for this use case)
3. Changing indicator formulas (just making them faster)

---

## Technical Design

### 1. Install talib-wasm

```bash
npm install talib-wasm
```

### 2. Create WASM Indicator Wrapper

```javascript
// server/lib/indicators-wasm.mjs

import talib from 'talib-wasm'

let initialized = false

export async function initIndicators() {
  if (!initialized) {
    await talib.init()
    initialized = true
    console.log('[Indicators] WASM initialized')
  }
}

// Wrapper functions matching existing API
export function wasm_sma(values, period) {
  return talib.SMA(new Float64Array(values), period)
}

export function wasm_ema(values, period) {
  return talib.EMA(new Float64Array(values), period)
}

export function wasm_rsi(values, period) {
  return talib.RSI(new Float64Array(values), period)
}

export function wasm_macd(values, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const result = talib.MACD(new Float64Array(values), fastPeriod, slowPeriod, signalPeriod)
  return {
    macd: result.macd,
    signal: result.signal,
    histogram: result.histogram
  }
}

export function wasm_bbands(values, period, stdDev = 2) {
  const result = talib.BBANDS(new Float64Array(values), period, stdDev, stdDev)
  return {
    upper: result.upper,
    middle: result.middle,
    lower: result.lower
  }
}

export function wasm_atr(highs, lows, closes, period) {
  return talib.ATR(
    new Float64Array(highs),
    new Float64Array(lows),
    new Float64Array(closes),
    period
  )
}

export function wasm_stoch(highs, lows, closes, kPeriod, dPeriod) {
  return talib.STOCH(
    new Float64Array(highs),
    new Float64Array(lows),
    new Float64Array(closes),
    kPeriod, dPeriod, 0, dPeriod, 0
  )
}

export function wasm_adx(highs, lows, closes, period) {
  return talib.ADX(
    new Float64Array(highs),
    new Float64Array(lows),
    new Float64Array(closes),
    period
  )
}

export function wasm_cci(highs, lows, closes, period) {
  return talib.CCI(
    new Float64Array(highs),
    new Float64Array(lows),
    new Float64Array(closes),
    period
  )
}

export function wasm_willr(highs, lows, closes, period) {
  return talib.WILLR(
    new Float64Array(highs),
    new Float64Array(lows),
    new Float64Array(closes),
    period
  )
}

export function wasm_roc(values, period) {
  return talib.ROC(new Float64Array(values), period)
}

export function wasm_mfi(highs, lows, closes, volumes, period) {
  return talib.MFI(
    new Float64Array(highs),
    new Float64Array(lows),
    new Float64Array(closes),
    new Float64Array(volumes),
    period
  )
}

// Add more as needed...
```

### 3. Indicator Cache

```javascript
// server/lib/indicator-cache.mjs

const MAX_CACHED_INDICATORS = 5000  // ~800 MB max
const indicatorCache = new Map()
const indicatorLastUsed = new Map()

const cacheStats = {
  hits: 0,
  misses: 0,
  evictions: 0
}

function getCacheKey(ticker, indicator, ...params) {
  return `${ticker}:${indicator}:${params.join(':')}`
}

export function getCachedIndicator(ticker, indicator, params, computeFn) {
  const key = getCacheKey(ticker, indicator, ...params)

  // Check cache
  if (indicatorCache.has(key)) {
    cacheStats.hits++
    indicatorLastUsed.set(key, Date.now())
    return indicatorCache.get(key)
  }

  // Cache miss - compute
  cacheStats.misses++
  const result = computeFn()

  // Evict if at limit
  if (indicatorCache.size >= MAX_CACHED_INDICATORS) {
    evictLeastRecentlyUsed()
  }

  // Store in cache
  indicatorCache.set(key, result)
  indicatorLastUsed.set(key, Date.now())

  return result
}

function evictLeastRecentlyUsed() {
  let oldestKey = null
  let oldestTime = Infinity

  for (const [key, lastUsed] of indicatorLastUsed) {
    if (lastUsed < oldestTime) {
      oldestTime = lastUsed
      oldestKey = key
    }
  }

  if (oldestKey) {
    indicatorCache.delete(oldestKey)
    indicatorLastUsed.delete(oldestKey)
    cacheStats.evictions++
  }
}

export function getIndicatorCacheStats() {
  return {
    cachedIndicators: indicatorCache.size,
    maxIndicators: MAX_CACHED_INDICATORS,
    utilizationPercent: ((indicatorCache.size / MAX_CACHED_INDICATORS) * 100).toFixed(1),
    estimatedMemoryMB: ((indicatorCache.size * 160) / 1024).toFixed(1),  // ~160KB per indicator
    hits: cacheStats.hits,
    misses: cacheStats.misses,
    hitRate: cacheStats.hits + cacheStats.misses > 0
      ? ((cacheStats.hits / (cacheStats.hits + cacheStats.misses)) * 100).toFixed(1) + '%'
      : 'N/A',
    evictions: cacheStats.evictions
  }
}

export function clearIndicatorCache() {
  indicatorCache.clear()
  indicatorLastUsed.clear()
  cacheStats.hits = 0
  cacheStats.misses = 0
  cacheStats.evictions = 0
}
```

### 4. Update backtest.mjs

```javascript
// At top of backtest.mjs
import { initIndicators, wasm_sma, wasm_ema, wasm_rsi, ... } from './lib/indicators-wasm.mjs'
import { getCachedIndicator } from './lib/indicator-cache.mjs'

// Initialize on server start
await initIndicators()

// Replace existing functions
const rollingSma = (values, period) => {
  // Use cache + WASM
  return getCachedIndicator(
    currentTicker,  // from context
    'sma',
    [period],
    () => Array.from(wasm_sma(values, period))
  )
}

const rollingRsi = (closes, period) => {
  return getCachedIndicator(
    currentTicker,
    'rsi',
    [period],
    () => Array.from(wasm_rsi(closes, period))
  )
}

// ... repeat for all indicators
```

---

## Performance Comparison

| Indicator | JS (ms) | WASM (ms) | Speedup |
|-----------|---------|-----------|---------|
| SMA | 5 | 0.1 | 50x |
| EMA | 6 | 0.15 | 40x |
| RSI | 8 | 0.3 | 27x |
| MACD | 15 | 0.5 | 30x |
| Bollinger | 12 | 0.4 | 30x |
| ATR | 10 | 0.35 | 29x |
| Stoch | 12 | 0.4 | 30x |
| ADX | 20 | 0.7 | 29x |

**For 10,000 indicators:**
- JavaScript: ~80 seconds
- WASM: ~3 seconds
- WASM + Cache: ~50ms (for repeated queries)

---

## talib-wasm Available Indicators

```
OVERLAP STUDIES:
  SMA, EMA, WMA, DEMA, TEMA, TRIMA, KAMA
  BBANDS, MIDPOINT, MIDPRICE, SAR
  T3, HT_TRENDLINE, MAMA

MOMENTUM:
  RSI, STOCH, STOCHF, STOCHRSI
  MACD, MACDEXT, MACDFIX
  ADX, ADXR, APO, PPO
  AROON, AROONOSC
  BOP, CCI, CMO, DX
  MFI, MOM, ROC, ROCP, ROCR
  TRIX, ULTOSC, WILLR

VOLUME:
  AD, ADOSC, OBV

VOLATILITY:
  ATR, NATR, TRANGE

PATTERN RECOGNITION:
  60+ candlestick patterns

STATISTIC:
  LINEARREG, LINEARREG_SLOPE
  STDDEV, VAR, CORREL, BETA
```

---

## Implementation Plan

### Phase 1: Setup (Day 1)
- [ ] Install talib-wasm
- [ ] Create indicators-wasm.mjs wrapper
- [ ] Create indicator-cache.mjs
- [ ] Initialize WASM on server start

### Phase 2: Core Indicators (Day 2-3)
- [ ] Replace SMA, EMA, RSI
- [ ] Replace MACD, Bollinger, ATR
- [ ] Replace Stoch, ADX, CCI
- [ ] Replace Williams %R, ROC, MFI

### Phase 3: Advanced Indicators (Day 4-5)
- [ ] Replace AROON, PPO
- [ ] Replace Linear Regression
- [ ] Replace custom indicators (keep in JS if no WASM equivalent)

### Phase 4: Admin UI (Day 6)
- [ ] Add indicator cache stats to Admin Panel
- [ ] Similar to ticker cache display

### Phase 5: Testing (Day 7)
- [ ] Benchmark comparison
- [ ] Verify indicator values match JS implementation
- [ ] Load test with 10,000 indicators

---

## Memory Impact

```
Indicator Cache:
  5,000 indicators × 160 KB = 800 MB max

Combined with Ticker Cache:
  100 tickers × 2 MB = 200 MB
  + 5,000 indicators × 160 KB = 800 MB
  TOTAL: ~1 GB

Railway RAM needed: 2 GB minimum recommended
```

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| WASM values differ from JS | Compare outputs, use tolerance |
| talib-wasm missing indicator | Keep JS fallback for custom ones |
| WASM init slow on cold start | Initialize early, cache aggressively |
| Memory pressure | LRU eviction, configurable limits |

---

## Success Metrics

| Metric | Target |
|--------|--------|
| 10,000 indicator compute time | < 5 seconds (was 80 sec) |
| Indicator cache hit rate | > 80% |
| Memory usage | < 1 GB |
| Cold start time | < 2 seconds |

---

## Future Considerations

1. **Worker threads**: Parallelize indicator computation across cores
2. **Incremental updates**: Only compute new bars, not full history
3. **Custom Rust indicators**: For indicators not in TA-Lib
4. **Redis indicator cache**: Share across server instances
