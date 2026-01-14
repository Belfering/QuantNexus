/**
 * Shared ticker data cache
 * Used by both API endpoints (index.mjs) and backtest engine (backtest.mjs)
 */

// Disable cache via env var (set DISABLE_TICKER_CACHE=1 to save RAM)
export const DISABLE_TICKER_CACHE = process.env.DISABLE_TICKER_CACHE === '1' || process.env.DISABLE_TICKER_CACHE === 'true'

// Shared cache - stores ticker -> { data, limit, timestamp }
export const sharedTickerCache = new Map()

// Cache TTL (30 minutes)
export const CACHE_TTL = 30 * 60 * 1000

/**
 * Get ticker data from cache
 * @param {string} ticker
 * @param {number} limit - minimum bars required
 * @returns {Array|null} - cached data or null if not found/expired
 */
export function getCachedTicker(ticker, limit = 1500) {
  if (DISABLE_TICKER_CACHE) return null

  const cached = sharedTickerCache.get(ticker)
  if (!cached) return null

  const now = Date.now()
  if (now - cached.timestamp >= CACHE_TTL) return null
  if (cached.limit < limit) return null

  return cached.data
}

/**
 * Store ticker data in cache
 * @param {string} ticker
 * @param {Array} data
 * @param {number} limit
 */
export function setCachedTicker(ticker, data, limit) {
  if (DISABLE_TICKER_CACHE) return

  sharedTickerCache.set(ticker, {
    data,
    limit,
    timestamp: Date.now()
  })
}

/**
 * Clear all cached tickers
 * @returns {number} - count of cleared tickers
 */
export function clearCache() {
  const count = sharedTickerCache.size
  sharedTickerCache.clear()
  console.log(`[SharedCache] Cleared ${count} cached tickers`)
  return count
}

/**
 * Get cache stats
 */
export function getCacheStats() {
  return {
    size: sharedTickerCache.size,
    tickers: Array.from(sharedTickerCache.keys())
  }
}
