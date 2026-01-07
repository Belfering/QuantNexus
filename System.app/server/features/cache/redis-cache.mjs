// server/features/cache/redis-cache.mjs
// Multi-tier caching: Redis (shared) -> SQLite (local fallback) -> Compute fresh

import {
  redisGet,
  redisSet,
  redisDelete,
  redisGetMulti,
  redisSetMulti,
  isRedisAvailable,
} from '../../lib/redis.mjs'

import {
  getCachedBacktest,
  setCachedBacktest,
  getCachedSanityReport,
  setCachedSanityReport,
  getCachedBenchmarkMetrics,
  setCachedBenchmarkMetrics,
} from '../../db/cache.mjs'

// ============================================
// BACKTEST CACHE (Redis + SQLite fallback)
// ============================================

/**
 * Get cached backtest - tries Redis first, falls back to SQLite
 * @param {string} botId - Bot ID
 * @param {string} payloadHash - Hash of current payload
 * @param {string} dataDate - Current ticker data date (YYYY-MM-DD)
 * @returns {Promise<object|null>} Cached result or null if cache miss
 */
export async function getBacktestFromCache(botId, payloadHash, dataDate) {
  // Try Redis first (shared across instances)
  if (isRedisAvailable()) {
    const redisKey = `backtest:${botId}:${payloadHash}:${dataDate}`
    const cached = await redisGet(redisKey)
    if (cached) {
      console.log(`[cache] Redis HIT for backtest ${botId}`)
      return { ...cached, cached: true, source: 'redis' }
    }
  }

  // Fall back to SQLite (local)
  const sqliteCached = getCachedBacktest(botId, payloadHash, dataDate)
  if (sqliteCached) {
    console.log(`[cache] SQLite HIT for backtest ${botId}`)

    // Backfill Redis for other instances
    if (isRedisAvailable()) {
      const redisKey = `backtest:${botId}:${payloadHash}:${dataDate}`
      await redisSet(redisKey, sqliteCached, 86400)
    }

    return { ...sqliteCached, source: 'sqlite' }
  }

  return null
}

/**
 * Store backtest in cache - writes to both Redis and SQLite
 * @param {string} botId - Bot ID
 * @param {string} payloadHash - Hash of payload
 * @param {string} dataDate - Ticker data date (YYYY-MM-DD)
 * @param {object} results - Backtest results to cache
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

// ============================================
// SANITY REPORT CACHE (Redis + SQLite fallback)
// ============================================

/**
 * Get cached sanity report
 */
export async function getSanityReportFromCache(botId, payloadHash, dataDate) {
  if (isRedisAvailable()) {
    const redisKey = `sanity:${botId}:${payloadHash}:${dataDate}`
    const cached = await redisGet(redisKey)
    if (cached) {
      console.log(`[cache] Redis HIT for sanity ${botId}`)
      return { ...cached, cached: true, source: 'redis' }
    }
  }

  const sqliteCached = getCachedSanityReport(botId, payloadHash, dataDate)
  if (sqliteCached) {
    if (isRedisAvailable()) {
      const redisKey = `sanity:${botId}:${payloadHash}:${dataDate}`
      await redisSet(redisKey, sqliteCached, 86400)
    }
    return { ...sqliteCached, source: 'sqlite' }
  }

  return null
}

/**
 * Store sanity report in cache
 */
export async function storeSanityReportInCache(botId, payloadHash, dataDate, report) {
  if (isRedisAvailable()) {
    const redisKey = `sanity:${botId}:${payloadHash}:${dataDate}`
    await redisSet(redisKey, report, 86400)
  }

  setCachedSanityReport(botId, payloadHash, dataDate, report)
}

// ============================================
// BENCHMARK CACHE (Redis + SQLite fallback)
// ============================================

/**
 * Get cached benchmark metrics
 */
export async function getBenchmarkFromCache(ticker, dataDate) {
  if (isRedisAvailable()) {
    const redisKey = `benchmark:${ticker}:${dataDate}`
    const cached = await redisGet(redisKey)
    if (cached) {
      return { metrics: cached, cached: true, source: 'redis' }
    }
  }

  const sqliteCached = getCachedBenchmarkMetrics(ticker, dataDate)
  if (sqliteCached) {
    if (isRedisAvailable()) {
      const redisKey = `benchmark:${ticker}:${dataDate}`
      await redisSet(redisKey, sqliteCached.metrics, 86400)
    }
    return { ...sqliteCached, source: 'sqlite' }
  }

  return null
}

/**
 * Store benchmark metrics in cache
 */
export async function storeBenchmarkInCache(ticker, dataDate, metrics) {
  if (isRedisAvailable()) {
    const redisKey = `benchmark:${ticker}:${dataDate}`
    await redisSet(redisKey, metrics, 86400)
  }

  setCachedBenchmarkMetrics(ticker, dataDate, metrics)
}

// ============================================
// INDICATOR CACHE (Redis only - computed data)
// ============================================

/**
 * Get cached indicator series
 * @param {string} ticker - Ticker symbol
 * @param {string} indicator - Indicator type (e.g., 'RSI', 'SMA')
 * @param {number} period - Indicator period
 * @returns {Promise<number[]|null>} Array of indicator values or null
 */
export async function getIndicatorFromCache(ticker, indicator, period) {
  if (!isRedisAvailable()) return null

  const key = `indicator:${ticker}:${indicator}:${period}`
  return await redisGet(key)
}

/**
 * Store indicator series in cache
 * @param {string} ticker - Ticker symbol
 * @param {string} indicator - Indicator type
 * @param {number} period - Indicator period
 * @param {number[]} values - Array of indicator values
 */
export async function storeIndicatorInCache(ticker, indicator, period, values) {
  if (!isRedisAvailable()) return false

  const key = `indicator:${ticker}:${indicator}:${period}`
  return await redisSet(key, values, 86400)
}

/**
 * Get multiple indicators from cache at once
 * @param {Array<{ticker: string, indicator: string, period: number}>} requests
 * @returns {Promise<Map<string, number[]>>} Map of "ticker:indicator:period" -> values
 */
export async function getIndicatorsFromCache(requests) {
  if (!isRedisAvailable() || requests.length === 0) return new Map()

  const keys = requests.map(
    ({ ticker, indicator, period }) => `indicator:${ticker}:${indicator}:${period}`
  )

  return await redisGetMulti(keys)
}

// ============================================
// CANDLE CACHE (Redis only - raw data)
// ============================================

/**
 * Get cached candle data for a ticker
 * @param {string} ticker - Ticker symbol
 * @returns {Promise<Array|null>} Array of OHLC data or null
 */
export async function getCandlesFromCache(ticker) {
  if (!isRedisAvailable()) return null

  const key = `candles:${ticker}`
  return await redisGet(key)
}

/**
 * Store candle data in cache
 * @param {string} ticker - Ticker symbol
 * @param {Array} candles - Array of OHLC data
 */
export async function storeCandlesInCache(ticker, candles) {
  if (!isRedisAvailable()) return false

  const key = `candles:${ticker}`
  return await redisSet(key, candles, 86400)
}

/**
 * Get multiple tickers' candles from cache
 * @param {string[]} tickers - Array of ticker symbols
 * @returns {Promise<Map<string, Array>>} Map of ticker -> candles
 */
export async function getMultipleCandlesFromCache(tickers) {
  if (!isRedisAvailable() || tickers.length === 0) return new Map()

  const keys = tickers.map((t) => `candles:${t}`)
  const results = await redisGetMulti(keys)

  // Re-key from "candles:TICKER" to just "TICKER"
  const tickerMap = new Map()
  for (const [key, value] of results) {
    const ticker = key.replace('candles:', '')
    tickerMap.set(ticker, value)
  }

  return tickerMap
}

// ============================================
// CORRELATION CACHE (Redis only)
// ============================================

/**
 * Get cached correlation between two bots
 * @param {string} bot1Id - First bot ID
 * @param {string} bot2Id - Second bot ID
 * @returns {Promise<number|null>} Correlation value or null
 */
export async function getCorrelationFromCache(bot1Id, bot2Id) {
  if (!isRedisAvailable()) return null

  // Normalize key order for consistency
  const [a, b] = [bot1Id, bot2Id].sort()
  const key = `correlation:${a}:${b}`
  return await redisGet(key)
}

/**
 * Store correlation in cache
 * @param {string} bot1Id - First bot ID
 * @param {string} bot2Id - Second bot ID
 * @param {number} correlation - Correlation value
 */
export async function storeCorrelationInCache(bot1Id, bot2Id, correlation) {
  if (!isRedisAvailable()) return false

  const [a, b] = [bot1Id, bot2Id].sort()
  const key = `correlation:${a}:${b}`
  return await redisSet(key, correlation, 86400)
}

// ============================================
// CACHE INVALIDATION
// ============================================

/**
 * Invalidate all candle caches (call after data sync)
 */
export async function invalidateCandleCache() {
  if (!isRedisAvailable()) return 0
  return await redisDelete('candles:*')
}

/**
 * Invalidate all indicator caches
 */
export async function invalidateIndicatorCache() {
  if (!isRedisAvailable()) return 0
  return await redisDelete('indicator:*')
}

/**
 * Invalidate all correlation caches
 */
export async function invalidateCorrelationCache() {
  if (!isRedisAvailable()) return 0
  return await redisDelete('correlation:*')
}

/**
 * Invalidate all backtest caches for a specific bot
 * @param {string} botId - Bot ID to invalidate
 */
export async function invalidateBotBacktestCache(botId) {
  if (!isRedisAvailable()) return 0
  return await redisDelete(`backtest:${botId}:*`)
}

/**
 * Invalidate all Redis caches (full reset)
 */
export async function invalidateAllRedisCache() {
  if (!isRedisAvailable()) return 0

  let total = 0
  total += await redisDelete('candles:*')
  total += await redisDelete('indicator:*')
  total += await redisDelete('correlation:*')
  total += await redisDelete('backtest:*')
  total += await redisDelete('sanity:*')
  total += await redisDelete('benchmark:*')

  console.log(`[cache] Invalidated ${total} Redis keys`)
  return total
}
