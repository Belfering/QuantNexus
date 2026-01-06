# Phase 3: Redis Integration 🔄 IN PROGRESS

**Timeline**: Days 8-10
**Status**: 🔄 IN PROGRESS (Code Complete, Needs Deployment)

---

## Current State Analysis

### Existing Caching (`server/db/cache.mjs`)
- **SQLite-based** backtest cache (per-instance, not shared)
- `backtest_cache` table - keyed by bot_id + payload_hash + data_date
- `sanity_report_cache` table - same pattern
- `benchmark_metrics_cache` table - keyed by ticker + data_date
- Daily refresh logic via `checkAndTriggerDailyRefresh()`
- Payload hash invalidation

### Existing Scheduler (`server/scheduler.mjs`)
- Runs at 6 PM ET daily (configurable)
- Downloads ticker data from Tiingo/yFinance
- Syncs ticker registry
- Already has job tracking infrastructure

### Config (`server/lib/config.mjs`)
- `REDIS_URL` placeholder already exists (line 39)

### What's Missing
1. **Shared cache** - Each server instance has its own SQLite cache
2. **Indicator caching** - Computed fresh for each backtest
3. **Candle caching** - Loaded from parquet each time
4. **Correlation pre-computation** - Computed on-demand for Nexus

---

## Goals

1. **Share cache across Railway replicas** - All instances use same Redis
2. **Pre-warm indicators** - Compute once nightly, cache for 24h
3. **Pre-warm candle data** - Load from parquet once, cache in Redis
4. **Pre-compute correlations** - Run after data sync, store for fast Nexus access
5. **Graceful fallback** - If Redis unavailable, fall back to SQLite cache

---

## Tasks

- [ ] Add Redis to Railway (~$5/month) ← **User action required**
- [x] Create `server/lib/redis.mjs` client wrapper ✅
- [x] Create `server/features/cache/redis-cache.mjs` Redis cache layer ✅
- [x] Create `server/jobs/prewarm-candles.mjs` ✅
- [x] Create `server/jobs/prewarm-indicators.mjs` ✅
- [x] Create `server/jobs/prewarm-correlations.mjs` ✅
- [x] Add `nexusCorrelations` table to schema ✅
- [x] Integrate prewarm jobs into existing scheduler ✅
- [ ] Update `backtest.mjs` to use Redis cache (optional optimization)
- [ ] Update correlation endpoints to use pre-computed data (optional optimization)

---

## Architecture

### Cache Layer Strategy

```
┌────────────────────────────────────────────────────────────┐
│                    REQUEST FLOW                             │
│  backtest.mjs → redis-cache.mjs → Redis (shared)           │
│                        ↓ (miss)                             │
│                   SQLite cache (local fallback)             │
│                        ↓ (miss)                             │
│                   Compute fresh                              │
└────────────────────────────────────────────────────────────┘
```

### Pre-warm Flow (integrated into existing scheduler)

```
scheduler.mjs (6 PM ET)
    │
    ├── 1. Sync ticker registry from Tiingo ✅ (existing)
    ├── 2. Download ticker data (Tiingo/yFinance) ✅ (existing)
    │
    └── 3. NEW: Post-sync prewarm jobs
            ├── prewarm-candles.mjs (load parquet → Redis)
            ├── prewarm-indicators.mjs (compute indicators → Redis)
            └── prewarm-correlations.mjs (compute correlations → DB)
```

---

## Implementation Details

### 1. Redis Client Wrapper

```javascript
// server/lib/redis.mjs
import Redis from 'ioredis'
import { REDIS_URL } from './config.mjs'

let redis = null
let isConnected = false

export function getRedisClient() {
  if (!REDIS_URL) return null

  if (!redis) {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      lazyConnect: true,
    })

    redis.on('connect', () => {
      isConnected = true
      console.log('[redis] Connected')
    })

    redis.on('error', (err) => {
      isConnected = false
      console.error('[redis] Connection error:', err.message)
    })
  }

  return redis
}

export function isRedisAvailable() {
  return isConnected
}

// Graceful helpers
export async function redisGet(key) {
  const client = getRedisClient()
  if (!client || !isConnected) return null
  try {
    const data = await client.get(key)
    return data ? JSON.parse(data) : null
  } catch (e) {
    console.error('[redis] GET error:', e.message)
    return null
  }
}

export async function redisSet(key, value, ttlSeconds = 86400) {
  const client = getRedisClient()
  if (!client || !isConnected) return false
  try {
    await client.set(key, JSON.stringify(value), 'EX', ttlSeconds)
    return true
  } catch (e) {
    console.error('[redis] SET error:', e.message)
    return false
  }
}

export async function redisDelete(pattern) {
  const client = getRedisClient()
  if (!client || !isConnected) return 0
  try {
    const keys = await client.keys(pattern)
    if (keys.length > 0) {
      return await client.del(...keys)
    }
    return 0
  } catch (e) {
    console.error('[redis] DELETE error:', e.message)
    return 0
  }
}
```

### 2. Redis Cache Layer

```javascript
// server/features/cache/redis-cache.mjs
import { redisGet, redisSet, isRedisAvailable } from '../../lib/redis.mjs'
import { getCachedBacktest, setCachedBacktest } from '../../db/cache.mjs'

/**
 * Get cached backtest - tries Redis first, falls back to SQLite
 */
export async function getBacktestFromCache(botId, payloadHash, dataDate) {
  // Try Redis first (shared across instances)
  if (isRedisAvailable()) {
    const redisKey = `backtest:${botId}:${payloadHash}:${dataDate}`
    const cached = await redisGet(redisKey)
    if (cached) {
      console.log(`[cache] Redis HIT for ${botId}`)
      return { ...cached, cached: true, source: 'redis' }
    }
  }

  // Fall back to SQLite (local)
  const sqliteCached = getCachedBacktest(botId, payloadHash, dataDate)
  if (sqliteCached) {
    return { ...sqliteCached, source: 'sqlite' }
  }

  return null
}

/**
 * Store backtest in cache - writes to both Redis and SQLite
 */
export async function storeBacktestInCache(botId, payloadHash, dataDate, results) {
  // Write to Redis (shared)
  if (isRedisAvailable()) {
    const redisKey = `backtest:${botId}:${payloadHash}:${dataDate}`
    await redisSet(redisKey, results, 86400) // 24h TTL
  }

  // Also write to SQLite (local fallback)
  setCachedBacktest(botId, payloadHash, dataDate, results)
}

/**
 * Get cached indicator series
 */
export async function getIndicatorFromCache(ticker, indicator, period) {
  if (!isRedisAvailable()) return null

  const key = `indicator:${ticker}:${indicator}:${period}`
  return await redisGet(key)
}

/**
 * Store indicator series
 */
export async function storeIndicatorInCache(ticker, indicator, period, values) {
  if (!isRedisAvailable()) return false

  const key = `indicator:${ticker}:${indicator}:${period}`
  return await redisSet(key, values, 86400)
}

/**
 * Get cached candle data
 */
export async function getCandlesFromCache(ticker) {
  if (!isRedisAvailable()) return null

  const key = `candles:${ticker}`
  return await redisGet(key)
}

/**
 * Store candle data
 */
export async function storeCandlesInCache(ticker, candles) {
  if (!isRedisAvailable()) return false

  const key = `candles:${ticker}`
  return await redisSet(key, candles, 86400)
}
```

### 3. Pre-warm Candles Job

```javascript
// server/jobs/prewarm-candles.mjs
import { storeCandlesInCache, redisDelete } from '../features/cache/redis-cache.mjs'
import { createDuckDBConnection } from '../lib/duckdb.mjs'
import { PARQUET_DIR } from '../lib/config.mjs'
import fs from 'fs/promises'
import path from 'path'

export async function prewarmCandles() {
  console.log('[prewarm-candles] Starting...')
  const startTime = Date.now()

  // Clear old candle cache
  await redisDelete('candles:*')

  // Get all parquet files
  const files = await fs.readdir(PARQUET_DIR)
  const parquetFiles = files.filter(f => f.endsWith('.parquet'))

  let cached = 0
  const db = createDuckDBConnection()

  for (const file of parquetFiles) {
    const ticker = path.basename(file, '.parquet')
    try {
      const filePath = path.join(PARQUET_DIR, file)
      const result = await db.all(`
        SELECT date, open, high, low, close, volume, adjClose
        FROM read_parquet('${filePath}')
        ORDER BY date ASC
      `)

      await storeCandlesInCache(ticker, result)
      cached++

      if (cached % 100 === 0) {
        console.log(`[prewarm-candles] Cached ${cached}/${parquetFiles.length}`)
      }
    } catch (e) {
      console.error(`[prewarm-candles] Error caching ${ticker}:`, e.message)
    }
  }

  db.close()

  const duration = Math.round((Date.now() - startTime) / 1000)
  console.log(`[prewarm-candles] Done: ${cached} tickers in ${duration}s`)

  return { cached, duration }
}
```

### 4. Pre-warm Indicators Job

```javascript
// server/jobs/prewarm-indicators.mjs
import { storeIndicatorInCache, getCandlesFromCache, redisDelete } from '../features/cache/redis-cache.mjs'
import { db } from '../db/index.mjs'
import { bots } from '../db/schema.mjs'
import { computeIndicator } from '../backtest.mjs' // or extract to separate module

export async function prewarmIndicators() {
  console.log('[prewarm-indicators] Starting...')
  const startTime = Date.now()

  // Clear old indicator cache
  await redisDelete('indicator:*')

  // 1. Get all bots from database
  const allBots = await db.select().from(bots)

  // 2. Extract unique (ticker, indicator, period) combinations
  const combos = new Set()

  for (const bot of allBots) {
    try {
      const payload = typeof bot.payload === 'string'
        ? JSON.parse(bot.payload)
        : bot.payload
      extractIndicatorCombos(payload, combos)
    } catch (e) {
      // Skip malformed bots
    }
  }

  console.log(`[prewarm-indicators] Found ${combos.size} unique indicator combinations`)

  // 3. Compute and cache each indicator
  let cached = 0
  for (const combo of combos) {
    const { ticker, indicator, period } = JSON.parse(combo)
    try {
      // Get candles from Redis cache (pre-warmed in previous step)
      const candles = await getCandlesFromCache(ticker)
      if (!candles) continue

      // Compute indicator
      const values = computeIndicator(candles, indicator, period)

      // Store in Redis
      await storeIndicatorInCache(ticker, indicator, period, values)
      cached++

      if (cached % 100 === 0) {
        console.log(`[prewarm-indicators] Cached ${cached}/${combos.size}`)
      }
    } catch (e) {
      console.error(`[prewarm-indicators] Error computing ${ticker}/${indicator}/${period}:`, e.message)
    }
  }

  const duration = Math.round((Date.now() - startTime) / 1000)
  console.log(`[prewarm-indicators] Done: ${cached} indicators in ${duration}s`)

  return { cached, duration }
}

/**
 * Extract indicator combos from bot payload recursively
 */
function extractIndicatorCombos(node, combos) {
  if (!node) return

  // Extract from conditions
  if (node.conditions) {
    for (const cond of node.conditions) {
      if (cond.ticker && cond.metric && cond.window) {
        combos.add(JSON.stringify({
          ticker: cond.ticker,
          indicator: cond.metric,
          period: cond.window
        }))
      }
    }
  }

  // Extract from position tickers
  if (node.positions) {
    for (const pos of node.positions) {
      if (pos.ticker) {
        // Always cache basic price data for position tickers
        combos.add(JSON.stringify({
          ticker: pos.ticker,
          indicator: 'close',
          period: 1
        }))
      }
    }
  }

  // Recurse into children
  if (node.children) {
    for (const slot of Object.values(node.children)) {
      if (Array.isArray(slot)) {
        for (const child of slot) {
          extractIndicatorCombos(child, combos)
        }
      }
    }
  }
}
```

### 5. Pre-warm Correlations Job

```javascript
// server/jobs/prewarm-correlations.mjs
import { db } from '../db/index.mjs'
import { bots, nexusCorrelations } from '../db/schema.mjs'
import { eq } from 'drizzle-orm'
import { computeCorrelation } from '../correlation.mjs'

export async function prewarmCorrelations() {
  console.log('[prewarm-correlations] Starting...')
  const startTime = Date.now()

  // 1. Get all Nexus bots (public bots)
  const nexusBots = await db.select()
    .from(bots)
    .where(eq(bots.visibility, 'nexus'))

  console.log(`[prewarm-correlations] Computing correlations for ${nexusBots.length} Nexus bots`)

  // 2. Compute pairwise correlations
  let computed = 0
  const pairs = []

  for (let i = 0; i < nexusBots.length; i++) {
    for (let j = i + 1; j < nexusBots.length; j++) {
      const bot1 = nexusBots[i]
      const bot2 = nexusBots[j]

      try {
        // Get equity curves from latest backtest results
        const corr = await computeCorrelation(bot1.id, bot2.id)

        pairs.push({
          bot1Id: bot1.id,
          bot2Id: bot2.id,
          correlation: corr,
          computedAt: new Date()
        })
        computed++

        if (computed % 100 === 0) {
          console.log(`[prewarm-correlations] Computed ${computed} pairs`)
        }
      } catch (e) {
        // Skip failed pairs
      }
    }
  }

  // 3. Bulk insert/update correlations table
  if (pairs.length > 0) {
    // Clear old correlations
    await db.delete(nexusCorrelations)

    // Insert new ones in batches
    const batchSize = 500
    for (let i = 0; i < pairs.length; i += batchSize) {
      const batch = pairs.slice(i, i + batchSize)
      await db.insert(nexusCorrelations).values(batch)
    }
  }

  const duration = Math.round((Date.now() - startTime) / 1000)
  console.log(`[prewarm-correlations] Done: ${computed} pairs in ${duration}s`)

  return { computed, duration }
}
```

### 6. Scheduler Integration

Update `scheduler.mjs` to run prewarm jobs after data sync:

```javascript
// Add to runTickerSync() after successful download

child.on('close', async (code) => {
  // ... existing code ...

  if (code === 0) {
    console.log(`[scheduler] Sync completed successfully in ${duration}s`)

    // NEW: Run prewarm jobs after successful data sync
    if (isRedisAvailable()) {
      console.log('[scheduler] Starting post-sync prewarm jobs...')

      try {
        const { prewarmCandles } = await import('./jobs/prewarm-candles.mjs')
        const { prewarmIndicators } = await import('./jobs/prewarm-indicators.mjs')
        const { prewarmCorrelations } = await import('./jobs/prewarm-correlations.mjs')

        // Run in sequence (indicators depend on candles)
        await prewarmCandles()
        await prewarmIndicators()
        await prewarmCorrelations()

        console.log('[scheduler] Post-sync prewarm complete')
      } catch (e) {
        console.error('[scheduler] Prewarm error:', e)
        // Don't fail the whole sync if prewarm fails
      }
    }

    // ... rest of existing code ...
  }
})
```

---

## Redis Cache Schema

| Key Pattern | Value | TTL | Purpose |
|-------------|-------|-----|---------|
| `candles:{ticker}` | JSON array of OHLC | 24h | Pre-warmed ticker data |
| `indicator:{ticker}:{type}:{period}` | JSON array of values | 24h | Pre-warmed indicators |
| `backtest:{botId}:{hash}:{date}` | JSON backtest result | 24h | Cached backtest results |

---

## Database Schema Addition

```sql
-- Add to schema.mjs for correlation pre-computation
CREATE TABLE nexus_correlations (
  id SERIAL PRIMARY KEY,
  bot1_id TEXT NOT NULL,
  bot2_id TEXT NOT NULL,
  correlation REAL NOT NULL,
  computed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(bot1_id, bot2_id)
);

CREATE INDEX idx_corr_lookup ON nexus_correlations(bot1_id, bot2_id);
```

---

## Environment Variables

```bash
# Railway production
REDIS_URL=redis://default:password@hostname:6379

# Local development (optional - falls back to SQLite)
# REDIS_URL=redis://localhost:6379
```

---

## Server Startup Integration

Add to `server/index.mjs` to initialize Redis on startup:

```javascript
// Near the top of the file, with other imports
import { initRedis } from './lib/redis.mjs'

// In the startup sequence (after database init, before starting scheduler)
const redisConnected = await initRedis()
if (redisConnected) {
  console.log('[server] Redis connected - shared cache enabled')
} else {
  console.log('[server] Redis not available - using SQLite cache only')
}
```

The `runPrewarmJobs()` function is exported from `scheduler.mjs` and can be called manually from admin panel if needed.

---

## Success Criteria

- [ ] Redis instance running on Railway (~$5/month) ← **User action required**
- [x] Graceful fallback to SQLite when Redis unavailable ✅
- [x] Candles pre-warmed nightly after data sync ✅ (scheduler integration done)
- [x] Indicators pre-warmed for all bot combinations ✅ (scheduler integration done)
- [x] Correlations pre-computed for Nexus bots ✅ (scheduler integration done)
- [ ] Cache hit rate > 80% for repeat backtests (verify after deployment)
- [ ] Backtest time (cache hit): < 100ms (verify after deployment)
- [ ] Backtest time (cache miss): < 500ms (verify after deployment)
- [ ] All Railway replicas share the same cache (verify after deployment)

---

## Rollback Plan

If Redis causes issues:
1. Set `REDIS_URL` to empty string in Railway
2. System automatically falls back to SQLite cache
3. Remove Redis add-on from Railway
