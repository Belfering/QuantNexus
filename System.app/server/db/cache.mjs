/**
 * FRD-014: Backtest Cache Database
 * Separate SQLite database for caching backtest results
 *
 * Cache invalidation triggers:
 * - Payload hash mismatch (bot payload changed)
 * - Data date mismatch (new ticker data downloaded)
 * - First-user-login-of-day (daily refresh for all bots)
 */

import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import crypto from 'crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Separate database file for cache (user specified separate DB)
const CACHE_DB_PATH = process.env.CACHE_DATABASE_PATH || path.join(__dirname, '..', 'data', 'backtest_cache.db')

// Ensure data directory exists
const dataDir = path.dirname(CACHE_DB_PATH)
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

// Create SQLite connection for cache
const cacheDb = new Database(CACHE_DB_PATH)
cacheDb.pragma('journal_mode = WAL')

// ============================================
// INITIALIZATION - Create cache tables
// ============================================
export function initializeCacheDatabase() {
  cacheDb.exec(`
    -- Backtest results cache
    CREATE TABLE IF NOT EXISTS backtest_cache (
      bot_id TEXT PRIMARY KEY,
      payload_hash TEXT NOT NULL,
      data_date TEXT NOT NULL,
      results TEXT NOT NULL,
      computed_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
    );

    -- Sanity report cache (separate from backtest, same invalidation logic)
    CREATE TABLE IF NOT EXISTS sanity_report_cache (
      bot_id TEXT PRIMARY KEY,
      payload_hash TEXT NOT NULL,
      data_date TEXT NOT NULL,
      report TEXT NOT NULL,
      computed_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
    );

    -- Track last refresh date for daily refresh logic
    CREATE TABLE IF NOT EXISTS cache_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
    );

    -- Benchmark metrics cache (keyed by ticker, invalidated when data date changes)
    CREATE TABLE IF NOT EXISTS benchmark_metrics_cache (
      ticker TEXT PRIMARY KEY,
      data_date TEXT NOT NULL,
      metrics TEXT NOT NULL,
      computed_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
    );

    -- Index for efficient lookups
    CREATE INDEX IF NOT EXISTS idx_cache_payload_hash ON backtest_cache(payload_hash);
    CREATE INDEX IF NOT EXISTS idx_cache_data_date ON backtest_cache(data_date);
    CREATE INDEX IF NOT EXISTS idx_cache_computed_at ON backtest_cache(computed_at);
    CREATE INDEX IF NOT EXISTS idx_sanity_payload_hash ON sanity_report_cache(payload_hash);
    CREATE INDEX IF NOT EXISTS idx_sanity_data_date ON sanity_report_cache(data_date);
    CREATE INDEX IF NOT EXISTS idx_benchmark_data_date ON benchmark_metrics_cache(data_date);
  `)

  console.log('[Cache] Backtest cache database initialized')
}

// ============================================
// HASH FUNCTIONS
// ============================================

/**
 * Generate SHA-256 hash of payload for change detection
 * @param {object|string} payload - Bot payload
 * @param {object} [options] - Optional backtest settings to include in hash
 * @param {string} [options.mode] - Backtest mode (OC, CC, OO, CO)
 * @param {number} [options.costBps] - Transaction cost in basis points
 */
export function hashPayload(payload, options = {}) {
  const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload)
  // Include mode and costBps in hash so different settings create different cache entries
  // Default to CC/5 to match frontend defaults
  const optionsStr = options.mode || options.costBps !== undefined
    ? `|mode=${options.mode || 'CC'}|cost=${options.costBps ?? 5}`
    : ''
  return crypto.createHash('sha256').update(payloadStr + optionsStr).digest('hex')
}

// ============================================
// CACHE OPERATIONS
// ============================================

/**
 * Get cached backtest result for a bot
 * @param {string} botId - Bot ID
 * @param {string} currentPayloadHash - Hash of current payload
 * @param {string} currentDataDate - Current ticker data date (YYYY-MM-DD)
 * @returns {object|null} Cached result or null if cache miss/invalid
 */
export function getCachedBacktest(botId, currentPayloadHash, currentDataDate) {
  const row = cacheDb.prepare(`
    SELECT bot_id, payload_hash, data_date, results, computed_at
    FROM backtest_cache
    WHERE bot_id = ?
  `).get(botId)

  if (!row) {
    return null // Cache miss - no entry
  }

  // Validate cache - payload hash must match
  if (row.payload_hash !== currentPayloadHash) {
    console.log(`[Cache] Miss for ${botId}: payload changed`)
    return null
  }

  // Validate cache - data date must match (new ticker data invalidates)
  if (row.data_date !== currentDataDate) {
    console.log(`[Cache] Miss for ${botId}: data date changed (${row.data_date} -> ${currentDataDate})`)
    return null
  }

  try {
    const results = JSON.parse(row.results)
    console.log(`[Cache] Hit for ${botId} (computed ${new Date(row.computed_at).toISOString()})`)
    return {
      ...results,
      cached: true,
      cachedAt: row.computed_at,
    }
  } catch (e) {
    console.error(`[Cache] Failed to parse cached results for ${botId}:`, e)
    return null
  }
}

/**
 * Store backtest result in cache
 * @param {string} botId - Bot ID
 * @param {string} payloadHash - Hash of payload
 * @param {string} dataDate - Ticker data date (YYYY-MM-DD)
 * @param {object} results - Backtest results to cache
 */
export function setCachedBacktest(botId, payloadHash, dataDate, results) {
  const now = Date.now()
  const resultsJson = JSON.stringify(results)

  cacheDb.prepare(`
    INSERT INTO backtest_cache (bot_id, payload_hash, data_date, results, computed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(bot_id) DO UPDATE SET
      payload_hash = excluded.payload_hash,
      data_date = excluded.data_date,
      results = excluded.results,
      computed_at = excluded.computed_at,
      updated_at = excluded.updated_at
  `).run(botId, payloadHash, dataDate, resultsJson, now, now, now)

  console.log(`[Cache] Stored backtest for ${botId} (payload hash: ${payloadHash.substring(0, 8)}..., data: ${dataDate})`)
}

// ============================================
// SANITY REPORT CACHE OPERATIONS
// ============================================

/**
 * Get cached sanity report for a bot
 * @param {string} botId - Bot ID
 * @param {string} currentPayloadHash - Hash of current payload
 * @param {string} currentDataDate - Current ticker data date (YYYY-MM-DD)
 * @returns {object|null} Cached report or null if cache miss/invalid
 */
export function getCachedSanityReport(botId, currentPayloadHash, currentDataDate) {
  const row = cacheDb.prepare(`
    SELECT bot_id, payload_hash, data_date, report, computed_at
    FROM sanity_report_cache
    WHERE bot_id = ?
  `).get(botId)

  if (!row) {
    return null // Cache miss - no entry
  }

  // Validate cache - payload hash must match
  if (row.payload_hash !== currentPayloadHash) {
    console.log(`[Cache] Sanity report miss for ${botId}: payload changed`)
    return null
  }

  // Validate cache - data date must match (new ticker data invalidates)
  if (row.data_date !== currentDataDate) {
    console.log(`[Cache] Sanity report miss for ${botId}: data date changed (${row.data_date} -> ${currentDataDate})`)
    return null
  }

  try {
    const report = JSON.parse(row.report)
    console.log(`[Cache] Sanity report hit for ${botId} (computed ${new Date(row.computed_at).toISOString()})`)
    return {
      report,
      cached: true,
      cachedAt: row.computed_at,
    }
  } catch (e) {
    console.error(`[Cache] Failed to parse cached sanity report for ${botId}:`, e)
    return null
  }
}

/**
 * Store sanity report in cache
 * @param {string} botId - Bot ID
 * @param {string} payloadHash - Hash of payload
 * @param {string} dataDate - Ticker data date (YYYY-MM-DD)
 * @param {object} report - Sanity report to cache
 */
export function setCachedSanityReport(botId, payloadHash, dataDate, report) {
  const now = Date.now()
  const reportJson = JSON.stringify(report)

  cacheDb.prepare(`
    INSERT INTO sanity_report_cache (bot_id, payload_hash, data_date, report, computed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(bot_id) DO UPDATE SET
      payload_hash = excluded.payload_hash,
      data_date = excluded.data_date,
      report = excluded.report,
      computed_at = excluded.computed_at,
      updated_at = excluded.updated_at
  `).run(botId, payloadHash, dataDate, reportJson, now, now, now)

  console.log(`[Cache] Stored sanity report for ${botId} (payload hash: ${payloadHash.substring(0, 8)}..., data: ${dataDate})`)
}

/**
 * Invalidate cache for a specific bot
 */
export function invalidateBotCache(botId) {
  const result1 = cacheDb.prepare('DELETE FROM backtest_cache WHERE bot_id = ?').run(botId)
  const result2 = cacheDb.prepare('DELETE FROM sanity_report_cache WHERE bot_id = ?').run(botId)
  const total = result1.changes + result2.changes
  if (total > 0) {
    console.log(`[Cache] Invalidated cache for ${botId} (backtest: ${result1.changes}, sanity: ${result2.changes})`)
  }
  return total > 0
}

/**
 * Invalidate ALL cache entries (for daily refresh)
 */
export function invalidateAllCache() {
  const result1 = cacheDb.prepare('DELETE FROM backtest_cache').run()
  const result2 = cacheDb.prepare('DELETE FROM sanity_report_cache').run()
  const total = result1.changes + result2.changes
  console.log(`[Cache] Invalidated all cache entries (backtest: ${result1.changes}, sanity: ${result2.changes})`)
  return total
}

// ============================================
// DAILY REFRESH LOGIC
// ============================================

/**
 * Get the last refresh date
 * @returns {string|null} Date string (YYYY-MM-DD) or null
 */
export function getLastRefreshDate() {
  const row = cacheDb.prepare(`
    SELECT value FROM cache_metadata WHERE key = 'last_refresh_date'
  `).get()
  return row?.value || null
}

/**
 * Set the last refresh date to today
 */
export function setLastRefreshDate() {
  const today = new Date().toISOString().split('T')[0]
  const now = Date.now()

  cacheDb.prepare(`
    INSERT INTO cache_metadata (key, value, updated_at)
    VALUES ('last_refresh_date', ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run(today, now)

  console.log(`[Cache] Set last refresh date to ${today}`)
  return today
}

/**
 * Check if daily refresh is needed (first login of the day)
 * If needed, invalidates all cache and updates the refresh date
 * @returns {boolean} True if refresh was triggered
 */
export function checkAndTriggerDailyRefresh() {
  const today = new Date().toISOString().split('T')[0]
  const lastRefresh = getLastRefreshDate()

  if (lastRefresh === today) {
    // Already refreshed today
    return false
  }

  console.log(`[Cache] Daily refresh triggered (last: ${lastRefresh || 'never'}, today: ${today})`)

  // Invalidate all cache entries
  invalidateAllCache()

  // Update last refresh date
  setLastRefreshDate()

  return true
}

// ============================================
// CACHE STATISTICS
// ============================================

/**
 * Get cache statistics
 */
export function getCacheStats() {
  const countRow = cacheDb.prepare('SELECT COUNT(*) as count FROM backtest_cache').get()
  const sizeRow = cacheDb.prepare(`
    SELECT SUM(LENGTH(results)) as total_size FROM backtest_cache
  `).get()
  const oldestRow = cacheDb.prepare(`
    SELECT MIN(computed_at) as oldest FROM backtest_cache
  `).get()
  const newestRow = cacheDb.prepare(`
    SELECT MAX(computed_at) as newest FROM backtest_cache
  `).get()

  return {
    entryCount: countRow?.count || 0,
    totalSizeBytes: sizeRow?.total_size || 0,
    oldestEntry: oldestRow?.oldest ? new Date(oldestRow.oldest).toISOString() : null,
    newestEntry: newestRow?.newest ? new Date(newestRow.newest).toISOString() : null,
    lastRefreshDate: getLastRefreshDate(),
  }
}

// ============================================
// BENCHMARK METRICS CACHE OPERATIONS
// ============================================

/**
 * Get cached benchmark metrics for a ticker
 * @param {string} ticker - Ticker symbol (e.g., 'SPY')
 * @param {string} currentDataDate - Current ticker data date (YYYY-MM-DD)
 * @returns {object|null} Cached metrics or null if cache miss/invalid
 */
export function getCachedBenchmarkMetrics(ticker, currentDataDate) {
  const row = cacheDb.prepare(`
    SELECT ticker, data_date, metrics, computed_at
    FROM benchmark_metrics_cache
    WHERE ticker = ?
  `).get(ticker)

  if (!row) {
    return null // Cache miss - no entry
  }

  // Validate cache - data date must match (new ticker data invalidates)
  if (row.data_date !== currentDataDate) {
    console.log(`[Cache] Benchmark miss for ${ticker}: data date changed (${row.data_date} -> ${currentDataDate})`)
    return null
  }

  try {
    const metrics = JSON.parse(row.metrics)
    console.log(`[Cache] Benchmark hit for ${ticker} (computed ${new Date(row.computed_at).toISOString()})`)
    return {
      metrics,
      cached: true,
      cachedAt: row.computed_at,
    }
  } catch (e) {
    console.error(`[Cache] Failed to parse cached benchmark metrics for ${ticker}:`, e)
    return null
  }
}

/**
 * Store benchmark metrics in cache
 * @param {string} ticker - Ticker symbol
 * @param {string} dataDate - Ticker data date (YYYY-MM-DD)
 * @param {object} metrics - Benchmark metrics to cache
 */
export function setCachedBenchmarkMetrics(ticker, dataDate, metrics) {
  const now = Date.now()
  const metricsJson = JSON.stringify(metrics)

  cacheDb.prepare(`
    INSERT INTO benchmark_metrics_cache (ticker, data_date, metrics, computed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(ticker) DO UPDATE SET
      data_date = excluded.data_date,
      metrics = excluded.metrics,
      computed_at = excluded.computed_at,
      updated_at = excluded.updated_at
  `).run(ticker, dataDate, metricsJson, now, now, now)

  console.log(`[Cache] Stored benchmark metrics for ${ticker} (data: ${dataDate})`)
}

/**
 * Get all cached benchmark metrics (for bulk retrieval)
 * @param {string} currentDataDate - Current ticker data date
 * @returns {Object} Object keyed by ticker with metrics
 */
export function getAllCachedBenchmarkMetrics(currentDataDate) {
  const rows = cacheDb.prepare(`
    SELECT ticker, data_date, metrics, computed_at
    FROM benchmark_metrics_cache
    WHERE data_date = ?
  `).all(currentDataDate)

  const result = {}
  for (const row of rows) {
    try {
      result[row.ticker] = JSON.parse(row.metrics)
    } catch (e) {
      // Skip invalid entries
    }
  }
  return result
}

/**
 * Invalidate all benchmark cache entries
 */
export function invalidateAllBenchmarkCache() {
  const result = cacheDb.prepare('DELETE FROM benchmark_metrics_cache').run()
  console.log(`[Cache] Invalidated all benchmark cache entries (${result.changes})`)
  return result.changes
}

// Export the raw cache database for advanced queries if needed
export { cacheDb }
