// server/jobs/prewarm-candles.mjs
// Pre-warm candle data from parquet files into Redis cache

import fs from 'fs/promises'
import path from 'path'
import { query, getConnection } from '../lib/duckdb.mjs'
import { PARQUET_DIR } from '../lib/config.mjs'
import { storeCandlesInCache, invalidateCandleCache } from '../features/cache/redis-cache.mjs'
import { isRedisAvailable } from '../lib/redis.mjs'

/**
 * Pre-warm all ticker candle data into Redis
 * Called after nightly data sync to populate cache
 *
 * @param {object} options - Options
 * @param {string[]} [options.tickers] - Specific tickers to prewarm (default: all parquet files)
 * @param {boolean} [options.clearFirst] - Clear existing cache first (default: true)
 * @returns {Promise<{cached: number, failed: number, duration: number}>}
 */
export async function prewarmCandles(options = {}) {
  const { tickers: specificTickers, clearFirst = true } = options

  if (!isRedisAvailable()) {
    console.log('[prewarm-candles] Redis not available, skipping')
    return { cached: 0, failed: 0, duration: 0, skipped: true }
  }

  console.log('[prewarm-candles] Starting...')
  const startTime = Date.now()

  // Clear old candle cache if requested
  if (clearFirst) {
    const deleted = await invalidateCandleCache()
    console.log(`[prewarm-candles] Cleared ${deleted} existing cache entries`)
  }

  // Get list of tickers to process
  let tickers = specificTickers
  if (!tickers) {
    try {
      const files = await fs.readdir(PARQUET_DIR)
      tickers = files
        .filter((f) => f.endsWith('.parquet'))
        .map((f) => path.basename(f, '.parquet'))
    } catch (e) {
      console.error('[prewarm-candles] Error reading parquet directory:', e.message)
      return { cached: 0, failed: 0, duration: 0, error: e.message }
    }
  }

  console.log(`[prewarm-candles] Processing ${tickers.length} tickers...`)

  let cached = 0
  let failed = 0
  const batchSize = 50 // Process in batches to avoid overwhelming Redis

  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize)
    const promises = batch.map(async (ticker) => {
      try {
        const parquetPath = path.join(PARQUET_DIR, `${ticker}.parquet`)
        const fileForDuckdb = parquetPath.replace(/\\/g, '/').replace(/'/g, "''")

        // Query parquet file directly
        const result = await query(`
          SELECT date, open, high, low, close, volume, adjClose
          FROM read_parquet('${fileForDuckdb}')
          ORDER BY date ASC
        `)

        if (result && result.length > 0) {
          await storeCandlesInCache(ticker, result)
          return { success: true, ticker }
        } else {
          return { success: false, ticker, error: 'No data' }
        }
      } catch (e) {
        return { success: false, ticker, error: e.message }
      }
    })

    const results = await Promise.all(promises)

    for (const r of results) {
      if (r.success) {
        cached++
      } else {
        failed++
        if (failed <= 5) {
          // Only log first 5 failures
          console.warn(`[prewarm-candles] Failed ${r.ticker}: ${r.error}`)
        }
      }
    }

    // Progress log every 200 tickers
    if ((i + batchSize) % 200 === 0 || i + batchSize >= tickers.length) {
      console.log(`[prewarm-candles] Progress: ${Math.min(i + batchSize, tickers.length)}/${tickers.length}`)
    }
  }

  const duration = Math.round((Date.now() - startTime) / 1000)
  console.log(`[prewarm-candles] Done: ${cached} cached, ${failed} failed in ${duration}s`)

  return { cached, failed, duration }
}

/**
 * Pre-warm specific tickers (for incremental updates)
 * @param {string[]} tickers - Array of ticker symbols
 */
export async function prewarmSpecificCandles(tickers) {
  return prewarmCandles({ tickers, clearFirst: false })
}

export default prewarmCandles
