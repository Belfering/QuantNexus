// server/jobs/prewarm-indicators.mjs
// Pre-compute common indicators and cache them in Redis
// Indicators are extracted from existing bot payloads to ensure we cache what's actually used

import { storeIndicatorInCache, getCandlesFromCache, invalidateIndicatorCache } from '../features/cache/redis-cache.mjs'
import { isRedisAvailable } from '../lib/redis.mjs'

/**
 * Pre-warm indicators used in existing bots
 * This job:
 * 1. Scans all bot payloads to find (ticker, indicator, period) combinations
 * 2. Computes each indicator using cached candle data
 * 3. Stores results in Redis for fast backtest access
 *
 * @param {object} options
 * @param {import('drizzle-orm/better-sqlite3').BetterSQLite3Database} options.database - Database instance
 * @param {boolean} [options.clearFirst] - Clear existing indicator cache first (default: true)
 * @returns {Promise<{cached: number, failed: number, duration: number}>}
 */
export async function prewarmIndicators(options = {}) {
  const { database, clearFirst = true } = options

  if (!isRedisAvailable()) {
    console.log('[prewarm-indicators] Redis not available, skipping')
    return { cached: 0, failed: 0, duration: 0, skipped: true }
  }

  if (!database) {
    console.error('[prewarm-indicators] Database not provided')
    return { cached: 0, failed: 0, duration: 0, error: 'Database not provided' }
  }

  console.log('[prewarm-indicators] Starting...')
  const startTime = Date.now()

  // Clear old indicator cache if requested
  if (clearFirst) {
    const deleted = await invalidateIndicatorCache()
    console.log(`[prewarm-indicators] Cleared ${deleted} existing cache entries`)
  }

  try {
    // 1. Get all bots from database
    const { bots } = await import('../db/schema.mjs')
    const allBots = await database.db.select().from(bots)

    console.log(`[prewarm-indicators] Scanning ${allBots.length} bots for indicators...`)

    // 2. Extract unique (ticker, indicator, period) combinations
    const combos = new Set()

    for (const bot of allBots) {
      try {
        const payload = typeof bot.payload === 'string' ? JSON.parse(bot.payload) : bot.payload
        extractIndicatorCombos(payload, combos)
      } catch {
        // Skip malformed bots
      }
    }

    console.log(`[prewarm-indicators] Found ${combos.size} unique indicator combinations`)

    // 3. Compute and cache each indicator
    let cached = 0
    let failed = 0

    for (const comboStr of combos) {
      const { ticker, indicator, period } = JSON.parse(comboStr)

      try {
        // Get candles from Redis cache (pre-warmed in previous step)
        const candles = await getCandlesFromCache(ticker)
        if (!candles || candles.length === 0) {
          failed++
          continue
        }

        // Compute indicator (simple implementations for common indicators)
        const values = computeSimpleIndicator(candles, indicator, period)
        if (values) {
          await storeIndicatorInCache(ticker, indicator, period, values)
          cached++
        } else {
          failed++
        }

        // Progress log
        if ((cached + failed) % 100 === 0) {
          console.log(`[prewarm-indicators] Progress: ${cached + failed}/${combos.size}`)
        }
      } catch (e) {
        failed++
        if (failed <= 5) {
          console.warn(`[prewarm-indicators] Error ${ticker}/${indicator}/${period}:`, e.message)
        }
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000)
    console.log(`[prewarm-indicators] Done: ${cached} cached, ${failed} failed in ${duration}s`)

    return { cached, failed, duration }
  } catch (e) {
    console.error('[prewarm-indicators] Error:', e)
    return { cached: 0, failed: 0, duration: 0, error: e.message }
  }
}

/**
 * Extract indicator combinations from bot payload recursively
 * @param {object} node - FlowNode
 * @param {Set<string>} combos - Set to accumulate JSON-stringified combos
 */
function extractIndicatorCombos(node, combos) {
  if (!node) return

  // Extract from conditions (indicator nodes)
  if (node.conditions && Array.isArray(node.conditions)) {
    for (const cond of node.conditions) {
      // Conditions have format: { ticker, metric, window, comparison, value }
      if (cond.ticker && cond.metric && cond.window) {
        combos.add(
          JSON.stringify({
            ticker: cond.ticker,
            indicator: cond.metric,
            period: cond.window,
          })
        )
      }
    }
  }

  // Extract from position tickers (always cache close prices)
  if (node.positions && Array.isArray(node.positions)) {
    for (const pos of node.positions) {
      if (pos.ticker && pos.ticker !== 'Empty') {
        combos.add(
          JSON.stringify({
            ticker: pos.ticker,
            indicator: 'close',
            period: 1,
          })
        )
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

/**
 * Compute simple indicator values
 * This is a simplified version - the full backtest engine has more sophisticated implementations
 * @param {Array} candles - Array of {date, open, high, low, close, volume, adjClose}
 * @param {string} indicator - Indicator type
 * @param {number} period - Lookback period
 * @returns {number[]|null} Array of indicator values or null if not supported
 */
function computeSimpleIndicator(candles, indicator, period) {
  if (!candles || candles.length === 0) return null

  const closes = candles.map((c) => c.adjClose || c.close)

  switch (indicator) {
    case 'close':
    case 'Close':
      return closes

    case 'SMA':
    case 'Simple Moving Average':
      return computeSMA(closes, period)

    case 'EMA':
    case 'Exponential Moving Average':
      return computeEMA(closes, period)

    case 'RSI':
    case 'Relative Strength Index':
      return computeRSI(closes, period)

    case 'Returns':
    case 'Daily Return':
      return computeReturns(closes)

    case 'Volatility':
      return computeVolatility(closes, period)

    default:
      // For unsupported indicators, return null (they'll be computed on-demand)
      return null
  }
}

// ============================================
// INDICATOR CALCULATIONS
// ============================================

function computeSMA(data, period) {
  const result = new Array(data.length).fill(null)
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0
    for (let j = 0; j < period; j++) {
      sum += data[i - j]
    }
    result[i] = sum / period
  }
  return result
}

function computeEMA(data, period) {
  const result = new Array(data.length).fill(null)
  const multiplier = 2 / (period + 1)

  // Start with SMA
  let sum = 0
  for (let i = 0; i < period; i++) {
    sum += data[i]
  }
  result[period - 1] = sum / period

  // Then EMA
  for (let i = period; i < data.length; i++) {
    result[i] = (data[i] - result[i - 1]) * multiplier + result[i - 1]
  }
  return result
}

function computeRSI(data, period) {
  const result = new Array(data.length).fill(null)

  // Calculate price changes
  const changes = []
  for (let i = 1; i < data.length; i++) {
    changes.push(data[i] - data[i - 1])
  }

  // Initial average gain/loss
  let avgGain = 0
  let avgLoss = 0

  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) {
      avgGain += changes[i]
    } else {
      avgLoss += Math.abs(changes[i])
    }
  }

  avgGain /= period
  avgLoss /= period

  // First RSI value
  if (avgLoss === 0) {
    result[period] = 100
  } else {
    const rs = avgGain / avgLoss
    result[period] = 100 - 100 / (1 + rs)
  }

  // Subsequent RSI values using Wilder smoothing
  for (let i = period; i < changes.length; i++) {
    const change = changes[i]
    const gain = change > 0 ? change : 0
    const loss = change < 0 ? Math.abs(change) : 0

    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period

    if (avgLoss === 0) {
      result[i + 1] = 100
    } else {
      const rs = avgGain / avgLoss
      result[i + 1] = 100 - 100 / (1 + rs)
    }
  }

  return result
}

function computeReturns(data) {
  const result = [null]
  for (let i = 1; i < data.length; i++) {
    result.push((data[i] - data[i - 1]) / data[i - 1])
  }
  return result
}

function computeVolatility(data, period) {
  const returns = computeReturns(data)
  const result = new Array(data.length).fill(null)

  for (let i = period; i < data.length; i++) {
    const slice = returns.slice(i - period + 1, i + 1).filter((r) => r !== null)
    if (slice.length === 0) continue

    const mean = slice.reduce((a, b) => a + b, 0) / slice.length
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / slice.length
    result[i] = Math.sqrt(variance * 252) // Annualized
  }

  return result
}

export default prewarmIndicators
