# FRD-042: Ticker Cache Memory Limits & Admin Monitoring

## Metadata
- **ID**: FRD-042
- **Title**: Ticker Cache Memory Limits & Admin Monitoring
- **Status**: IMPLEMENTED
- **Priority**: High
- **Owner**: System
- **Created**: 2026-01-07
- **Depends On**: FRD-030 (Scalable Architecture)

---

## Executive Summary

Add a hard limit of 200 tickers in the in-memory cache to bound RAM usage, with LRU eviction when the limit is reached. Also add admin panel visibility into cache status.

---

## Problem Statement

### Current State

```
CURRENT TICKER CACHE (backtest.mjs)
═══════════════════════════════════

const tickerDataCache = new Map()     // No size limit!
const tickerLastUsed = new Map()      // LRU tracking exists

Per ticker: ~2 MB (20,000 bars × 100 bytes)

RISK:
  100 tickers = 200 MB  ✓ OK
  500 tickers = 1 GB    ⚠️ Warning
  1000 tickers = 2 GB   ❌ Server crash
```

### Problem

1. **Unbounded memory growth** - As more tickers are accessed, cache grows without limit
2. **No visibility** - Admin has no way to see cache status in the UI
3. **Bot marketplace scale** - When creators sell bots that use many tickers, all buyers hit the same cache

---

## Goals

1. **Memory Safety**: Hard cap at 200 tickers (~400 MB max)
2. **Admin Visibility**: Show cache stats in admin panel
3. **LRU Eviction**: Automatically evict least-recently-used tickers when limit reached
4. **Shared Efficiency**: Single cache serves all users (marketplace model)

## Non-Goals

1. Per-user cache limits (shared cache is simpler)
2. Indicator caching (separate FRD)
3. Redis migration (covered in FRD-030)

---

## Technical Design

### 1. Add Cache Limit Constant

```javascript
// backtest.mjs
const MAX_CACHED_TICKERS = 200  // ~400 MB max memory
const tickerDataCache = new Map()
const tickerLastUsed = new Map()
```

### 2. Modify fetchOhlcSeries() for LRU Eviction

```javascript
async function fetchOhlcSeries(ticker, limit = 20000) {
  // Check cache first
  const cached = tickerDataCache.get(ticker)
  if (cached) {
    cacheStats.hits++
    tickerLastUsed.set(ticker, Date.now())
    return limit < cached.length ? cached.slice(-limit) : cached
  }

  // Cache miss - load from parquet
  cacheStats.misses++
  const bars = await fetchOhlcSeriesUncached(ticker, limit)

  if (bars && bars.length > 0) {
    // EVICT if at limit
    if (tickerDataCache.size >= MAX_CACHED_TICKERS) {
      evictLeastRecentlyUsed()
    }

    tickerDataCache.set(ticker, bars)
    tickerLastUsed.set(ticker, Date.now())
  }

  return bars
}

function evictLeastRecentlyUsed() {
  let oldestTicker = null
  let oldestTime = Infinity

  for (const [ticker, lastUsed] of tickerLastUsed) {
    if (lastUsed < oldestTime) {
      oldestTime = lastUsed
      oldestTicker = ticker
    }
  }

  if (oldestTicker) {
    tickerDataCache.delete(oldestTicker)
    tickerLastUsed.delete(oldestTicker)
    console.log(`[Cache] Evicted ${oldestTicker} (LRU, cache at limit)`)
  }
}
```

### 3. Enhanced getCacheStats()

```javascript
function getCacheStats() {
  const now = Date.now()

  return {
    // Counts
    cachedTickers: tickerDataCache.size,
    maxTickers: MAX_CACHED_TICKERS,
    utilizationPercent: ((tickerDataCache.size / MAX_CACHED_TICKERS) * 100).toFixed(1),

    // Memory estimate
    estimatedMemoryMB: ((tickerDataCache.size * 20000 * 100) / 1024 / 1024).toFixed(1),
    maxMemoryMB: ((MAX_CACHED_TICKERS * 20000 * 100) / 1024 / 1024).toFixed(0),

    // Hit rate
    hits: cacheStats.hits,
    misses: cacheStats.misses,
    hitRate: cacheStats.hits + cacheStats.misses > 0
      ? ((cacheStats.hits / (cacheStats.hits + cacheStats.misses)) * 100).toFixed(1) + '%'
      : 'N/A',

    // LRU info
    tickerList: Array.from(tickerDataCache.keys()),
    oldestTickerAge: getOldestTickerAge(),

    // Eviction stats
    evictions: cacheStats.evictions || 0,
  }
}
```

### 4. Admin Panel UI

Add to Admin Panel (AdminPanel.tsx):

```
┌─────────────────────────────────────────────────────────────┐
│  TICKER CACHE                                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Tickers Cached:  142 / 200  (71%)                         │
│  ████████████████████░░░░░░░░                               │
│                                                             │
│  Memory Usage:    284 MB / 400 MB                          │
│                                                             │
│  Hit Rate:        94.2%  (1,247 hits / 77 misses)          │
│                                                             │
│  Evictions:       23 (LRU)                                 │
│                                                             │
│  [Clear Cache]  [View Tickers]                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## API Changes

### Existing Endpoints (no change needed)

```
GET  /api/admin/cache/ticker-stats    → getCacheStats()
POST /api/admin/cache/ticker-clear    → clearTickerCache()
```

### Response Enhancement

```json
{
  "cachedTickers": 142,
  "maxTickers": 200,
  "utilizationPercent": "71.0",
  "estimatedMemoryMB": "284.0",
  "maxMemoryMB": "400",
  "hits": 1247,
  "misses": 77,
  "hitRate": "94.2%",
  "evictions": 23,
  "tickerList": ["SPY", "QQQ", "AAPL", ...]
}
```

---

## Memory Math

```
PER TICKER:
  20,000 bars × 100 bytes = 2 MB

CACHE LIMITS:
  200 tickers × 2 MB = 400 MB max

TYPICAL USAGE:
  10 common tickers pre-loaded = 20 MB
  50 additional on-demand = 100 MB
  Total typical: ~120 MB

WORST CASE:
  200 tickers = 400 MB (acceptable)
```

---

## Implementation Plan

### Phase 1: Backend (backtest.mjs) ✅
- [x] Add MAX_CACHED_TICKERS constant
- [x] Add evictLeastRecentlyUsed() function
- [x] Modify fetchOhlcSeries() to check limit
- [x] Add eviction counter to stats
- [x] Update getCacheStats() with new fields

### Phase 2: Admin UI (AdminPanel.tsx) ✅
- [x] Add ticker cache section to admin panel
- [x] Display utilization bar
- [x] Show hit rate and eviction count
- [x] Add "View Tickers" collapsible to see cached list

### Phase 3: Testing
- [ ] Test eviction triggers at 200 tickers
- [ ] Verify LRU selects correct ticker
- [ ] Load test with many concurrent users

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Max memory usage | < 500 MB |
| Cache hit rate | > 90% |
| Eviction frequency | < 10/hour typical |
| Admin can see stats | Yes |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Evicting frequently-used ticker | LRU ensures least-used is evicted |
| 200 limit too low | Configurable via env var if needed |
| Memory still grows from other sources | Monitor total process memory |

---

## Future Considerations

1. **Per-ticker TTL** - Evict stale data even if under limit
2. **Indicator cache** - Similar pattern for computed indicators (FRD-043?)
3. **Redis migration** - Move to shared Redis cache (FRD-030)
4. **Configurable limit** - ENV var for different deployment sizes
