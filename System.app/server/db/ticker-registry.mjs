/**
 * Ticker Registry Module
 *
 * Manages the ticker_registry table that stores metadata from Tiingo's master list.
 * Supports syncing from Tiingo, filtering US stocks/ETFs, and tracking download status.
 */

import { db } from './index.mjs'
import { tickerRegistry } from './schema.mjs'
import { eq, and, isNull, lt, sql, inArray } from 'drizzle-orm'

// US exchanges we want to include
const US_EXCHANGES = ['NYSE', 'NASDAQ', 'AMEX', 'ARCA', 'BATS', 'NYSE ARCA', 'NYSE MKT']

/**
 * Ensure the ticker_registry table exists (for SQLite)
 */
export async function ensureTickerRegistryTable() {
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS ticker_registry (
      ticker TEXT PRIMARY KEY,
      name TEXT,
      description TEXT,
      exchange TEXT,
      asset_type TEXT,
      currency TEXT,
      start_date TEXT,
      end_date TEXT,
      is_active INTEGER DEFAULT 1,
      last_synced TEXT,
      created_at INTEGER,
      updated_at INTEGER
    )
  `)

  // Add name/description columns if they don't exist (migration)
  try {
    await db.run(sql`ALTER TABLE ticker_registry ADD COLUMN name TEXT`)
  } catch { /* column may already exist */ }
  try {
    await db.run(sql`ALTER TABLE ticker_registry ADD COLUMN description TEXT`)
  } catch { /* column may already exist */ }
}

/**
 * Import tickers from Tiingo's supported_tickers.csv
 * @param {Array<{ticker: string, exchange: string, assetType: string, priceCurrency: string, startDate: string, endDate: string}>} tickers
 * @param {Object} options
 * @param {boolean} options.usOnly - Only import US tickers (default: true)
 */
export async function importTickers(tickers, options = { usOnly: true }) {
  const now = new Date()

  // Filter to US exchanges if requested
  let filtered = tickers
  if (options.usOnly) {
    filtered = tickers.filter(t =>
      US_EXCHANGES.some(ex => t.exchange?.toUpperCase()?.includes(ex)) &&
      t.priceCurrency === 'USD'
    )
  }

  // Upsert in batches
  const batchSize = 500
  let imported = 0

  for (let i = 0; i < filtered.length; i += batchSize) {
    const batch = filtered.slice(i, i + batchSize)

    for (const t of batch) {
      await db.insert(tickerRegistry)
        .values({
          ticker: t.ticker.toUpperCase(),
          exchange: t.exchange,
          assetType: t.assetType,
          currency: t.priceCurrency,
          startDate: t.startDate || null,
          endDate: t.endDate || null,
          isActive: t.endDate ? new Date(t.endDate) >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) : true,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: tickerRegistry.ticker,
          set: {
            exchange: t.exchange,
            assetType: t.assetType,
            currency: t.priceCurrency,
            startDate: t.startDate || null,
            endDate: t.endDate || null,
            isActive: t.endDate ? new Date(t.endDate) >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) : true,
            updatedAt: now,
          },
        })
    }

    imported += batch.length
  }

  return { imported, total: filtered.length }
}

/**
 * Get all active US tickers (Stocks and ETFs only, excludes mutual funds)
 */
export async function getActiveUSTickers() {
  const rows = await db.select({ ticker: tickerRegistry.ticker })
    .from(tickerRegistry)
    .where(
      and(
        eq(tickerRegistry.isActive, true),
        eq(tickerRegistry.currency, 'USD'),
        sql`${tickerRegistry.assetType} IN ('Stock', 'ETF')`
      )
    )
  return rows.map(r => r.ticker)
}

/**
 * Get tickers that need syncing (haven't been synced today)
 * Only returns active US Stocks and ETFs (excludes mutual funds)
 * @param {string} today - Today's date in YYYY-MM-DD format
 */
export async function getTickersNeedingSync(today) {
  const rows = await db.select({ ticker: tickerRegistry.ticker })
    .from(tickerRegistry)
    .where(
      and(
        eq(tickerRegistry.isActive, true),
        eq(tickerRegistry.currency, 'USD'),
        sql`${tickerRegistry.assetType} IN ('Stock', 'ETF')`,
        sql`(${tickerRegistry.lastSynced} IS NULL OR ${tickerRegistry.lastSynced} < ${today})`
      )
    )
  return rows.map(r => r.ticker)
}

/**
 * Mark tickers as synced
 * @param {string[]} tickers - Array of ticker symbols
 * @param {string} date - Sync date in YYYY-MM-DD format
 */
export async function markTickersSynced(tickers, date) {
  if (tickers.length === 0) return

  // Update in batches
  const batchSize = 500
  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize)
    await db.update(tickerRegistry)
      .set({ lastSynced: date, updatedAt: new Date() })
      .where(inArray(tickerRegistry.ticker, batch))
  }
}

/**
 * Mark a single ticker as synced
 */
export async function markTickerSynced(ticker, date) {
  await db.update(tickerRegistry)
    .set({ lastSynced: date, updatedAt: new Date() })
    .where(eq(tickerRegistry.ticker, ticker.toUpperCase()))
}

/**
 * Mark a ticker as inactive (e.g., delisted, no data available)
 */
export async function markTickerInactive(ticker) {
  await db.update(tickerRegistry)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(tickerRegistry.ticker, ticker.toUpperCase()))
}

/**
 * Get registry statistics
 */
export async function getRegistryStats() {
  const today = new Date().toISOString().slice(0, 10)

  const [totalResult] = await db.select({ count: sql`count(*)` })
    .from(tickerRegistry)
    .where(eq(tickerRegistry.currency, 'USD'))

  const [activeResult] = await db.select({ count: sql`count(*)` })
    .from(tickerRegistry)
    .where(and(
      eq(tickerRegistry.currency, 'USD'),
      eq(tickerRegistry.isActive, true)
    ))

  const [syncedTodayResult] = await db.select({ count: sql`count(*)` })
    .from(tickerRegistry)
    .where(and(
      eq(tickerRegistry.currency, 'USD'),
      eq(tickerRegistry.lastSynced, today)
    ))

  const [lastSyncResult] = await db.select({ lastSynced: sql`MAX(${tickerRegistry.lastSynced})` })
    .from(tickerRegistry)
    .where(eq(tickerRegistry.currency, 'USD'))

  return {
    total: Number(totalResult?.count || 0),
    active: Number(activeResult?.count || 0),
    syncedToday: Number(syncedTodayResult?.count || 0),
    pending: Number(activeResult?.count || 0) - Number(syncedTodayResult?.count || 0),
    lastSync: lastSyncResult?.lastSynced || null,
  }
}

/**
 * Search tickers by ticker symbol or company name
 * @param {string} query - Search query (matches ticker prefix or name substring)
 * @param {Object} options - Search options
 * @param {number} options.limit - Max results (default: 20)
 * @param {string} options.assetType - Filter by asset type ('Stock', 'ETF', or null for all)
 */
export async function searchTickers(query, options = {}) {
  const { limit = 20, assetType = null } = options
  const upperQuery = query.toUpperCase()
  const lowerQuery = query.toLowerCase()

  // Build conditions
  const conditions = [eq(tickerRegistry.currency, 'USD')]

  // Asset type filter
  if (assetType) {
    conditions.push(eq(tickerRegistry.assetType, assetType))
  }

  // Search by ticker prefix OR name substring OR description substring
  // This allows searches like "ETF gold" to find GLD
  conditions.push(
    sql`(
      ${tickerRegistry.ticker} LIKE ${upperQuery + '%'} OR
      LOWER(${tickerRegistry.name}) LIKE ${'%' + lowerQuery + '%'} OR
      LOWER(${tickerRegistry.description}) LIKE ${'%' + lowerQuery + '%'} OR
      (${tickerRegistry.assetType} = 'ETF' AND LOWER(${tickerRegistry.name}) LIKE ${'%' + lowerQuery + '%'})
    )`
  )

  // Order by exact ticker match first, then by name
  const rows = await db.select()
    .from(tickerRegistry)
    .where(and(...conditions))
    .orderBy(
      sql`CASE WHEN ${tickerRegistry.ticker} = ${upperQuery} THEN 0 WHEN ${tickerRegistry.ticker} LIKE ${upperQuery + '%'} THEN 1 ELSE 2 END`,
      tickerRegistry.ticker
    )
    .limit(limit)

  return rows
}

/**
 * Update ticker metadata (name and description)
 * @param {string} ticker - Ticker symbol
 * @param {Object} metadata - Metadata to update
 * @param {string} metadata.name - Company name
 * @param {string} metadata.description - Company description
 */
export async function updateTickerMetadata(ticker, metadata) {
  const { name, description } = metadata
  const updates = { updatedAt: new Date() }

  if (name !== undefined) updates.name = name
  if (description !== undefined) updates.description = description

  await db.update(tickerRegistry)
    .set(updates)
    .where(eq(tickerRegistry.ticker, ticker.toUpperCase()))
}

/**
 * Get tickers that need metadata (name is NULL)
 * @param {number} limit - Max results
 */
export async function getTickersNeedingMetadata(limit = 100) {
  const rows = await db.select({ ticker: tickerRegistry.ticker })
    .from(tickerRegistry)
    .where(
      and(
        eq(tickerRegistry.currency, 'USD'),
        eq(tickerRegistry.isActive, true),
        sql`${tickerRegistry.name} IS NULL`
      )
    )
    .limit(limit)

  return rows.map(r => r.ticker)
}

/**
 * Get a specific ticker's info
 */
export async function getTickerInfo(ticker) {
  const [row] = await db.select()
    .from(tickerRegistry)
    .where(eq(tickerRegistry.ticker, ticker.toUpperCase()))
    .limit(1)

  return row || null
}

/**
 * Get all ticker metadata (ticker, name, assetType) for UI filtering
 * Returns a lightweight list for the frontend to use for ETFs Only mode
 * Only returns ACTIVE US Stocks and ETFs (excludes mutual funds and inactive tickers)
 */
export async function getAllTickerMetadata() {
  const rows = await db.select({
    ticker: tickerRegistry.ticker,
    name: tickerRegistry.name,
    assetType: tickerRegistry.assetType,
    exchange: tickerRegistry.exchange
  })
    .from(tickerRegistry)
    .where(
      and(
        eq(tickerRegistry.currency, 'USD'),
        eq(tickerRegistry.isActive, true),
        sql`${tickerRegistry.assetType} IN ('Stock', 'ETF')`
      )
    )

  return rows
}

/**
 * Get tickers that already have metadata (name is NOT NULL)
 * Used to skip metadata fetch for tickers we already have info for
 */
export async function getTickersWithMetadata() {
  const rows = await db.select({ ticker: tickerRegistry.ticker })
    .from(tickerRegistry)
    .where(sql`${tickerRegistry.name} IS NOT NULL`)
  return rows.map(r => r.ticker)
}

/**
 * Clear all tickers (for testing/reset)
 */
export async function clearRegistry() {
  await db.delete(tickerRegistry)
}

/**
 * Reset all sync dates (forces re-download of all tickers)
 */
export async function resetAllSyncDates() {
  await db.update(tickerRegistry)
    .set({ lastSynced: null, updatedAt: new Date() })
  return await db.select({ count: sql`count(*)` }).from(tickerRegistry)
}
