/**
 * Returns Calculator
 *
 * Calculates daily and cumulative returns for live trades.
 * Called daily after market close to update the live_trades table.
 */

import { getLatestPrices } from './broker-alpaca.mjs'

/**
 * Calculate the daily return for a set of allocations
 * Uses price change from previous close to current close
 *
 * @param {Object} allocations - { ticker: percent } e.g., { SPY: 40, QQQ: 30, BIL: 30 }
 * @param {Object} priceChanges - { ticker: percentChange } e.g., { SPY: 0.5, QQQ: -0.3, BIL: 0.01 }
 * @returns {number} - Weighted daily return as percentage
 */
export function calculateWeightedReturn(allocations, priceChanges) {
  let totalReturn = 0
  let totalWeight = 0

  for (const [ticker, weight] of Object.entries(allocations)) {
    const change = priceChanges[ticker]
    if (change !== undefined && change !== null) {
      totalReturn += (weight / 100) * change
      totalWeight += weight
    }
  }

  // If we couldn't get prices for some tickers, scale up the return
  // to account for the missing weight (assumes cash-like 0% return for missing)
  if (totalWeight > 0 && totalWeight < 100) {
    // Missing tickers are treated as 0% return (like cash)
    // No scaling needed - just use what we have
  }

  return totalReturn
}

/**
 * Calculate cumulative return from previous cumulative and new daily return
 * Uses compound return formula: (1 + prev) * (1 + daily) - 1
 *
 * @param {number} previousCumulative - Previous cumulative return as percentage (e.g., 5.5 for 5.5%)
 * @param {number} dailyReturn - Today's return as percentage (e.g., 0.5 for 0.5%)
 * @returns {number} - New cumulative return as percentage
 */
export function compoundReturns(previousCumulative, dailyReturn) {
  const prevFactor = 1 + (previousCumulative || 0) / 100
  const dailyFactor = 1 + dailyReturn / 100
  return (prevFactor * dailyFactor - 1) * 100
}

/**
 * Get price changes for tickers between two dates
 *
 * @param {Object} db - Database instance
 * @param {Array<string>} tickers - List of tickers
 * @param {string} fromDate - Start date (YYYY-MM-DD)
 * @param {string} toDate - End date (YYYY-MM-DD)
 * @returns {Promise<Object>} - { ticker: percentChange }
 */
export async function getPriceChanges(db, tickers, fromDate, toDate) {
  // Query parquet files for price data
  // This uses the existing ticker data infrastructure
  const changes = {}

  for (const ticker of tickers) {
    try {
      // Use DuckDB to query the parquet file
      const query = `
        SELECT date, close
        FROM read_parquet('ticker-data/data/ticker_data_parquet/${ticker}.parquet')
        WHERE date >= '${fromDate}' AND date <= '${toDate}'
        ORDER BY date
      `

      const result = await db.all(query)

      if (result.length >= 2) {
        const startPrice = result[0].close
        const endPrice = result[result.length - 1].close
        changes[ticker] = ((endPrice - startPrice) / startPrice) * 100
      } else if (result.length === 1) {
        // Only one day of data, assume 0% change
        changes[ticker] = 0
      }
    } catch (error) {
      console.warn(`[returns-calculator] Could not get price change for ${ticker}:`, error.message)
      // Missing ticker - will be handled as 0% return
    }
  }

  return changes
}

/**
 * Calculate returns for all trades on a specific date
 * Should be called after market close
 *
 * @param {Object} db - Drizzle database instance
 * @param {Object} duckdb - DuckDB connection for price queries
 * @param {string} tradeDate - Date to calculate returns for (YYYY-MM-DD)
 */
export async function calculateDailyReturns(db, duckdb, tradeDate) {
  const { liveTrades } = await import('../db/schema.mjs')
  const { eq, and, lt, desc } = await import('drizzle-orm')

  // Get all trades for this date
  const trades = await db.select().from(liveTrades)
    .where(eq(liveTrades.tradeDate, tradeDate))

  if (trades.length === 0) {
    console.log(`[returns-calculator] No trades found for ${tradeDate}`)
    return
  }

  // Get the next trading day to calculate returns
  // For now, we'll calculate returns from trade date to the next available date
  const nextDate = getNextTradingDay(tradeDate)

  for (const trade of trades) {
    try {
      const allocations = JSON.parse(trade.allocations)
      const tickers = Object.keys(allocations)

      // Get price changes
      const priceChanges = await getPriceChanges(duckdb, tickers, tradeDate, nextDate)

      // Calculate daily return
      const dailyReturn = calculateWeightedReturn(allocations, priceChanges)

      // Get previous trade to calculate cumulative return
      const prevTrade = await db.select().from(liveTrades)
        .where(and(
          eq(liveTrades.userId, trade.userId),
          eq(liveTrades.botId, trade.botId),
          lt(liveTrades.tradeDate, tradeDate)
        ))
        .orderBy(desc(liveTrades.tradeDate))
        .limit(1)

      const previousCumulative = prevTrade[0]?.cumulativeReturn || 0
      const cumulativeReturn = compoundReturns(previousCumulative, dailyReturn)

      // Update the trade record
      await db.update(liveTrades)
        .set({
          dailyReturn: Math.round(dailyReturn * 10000) / 10000,  // 4 decimal places
          cumulativeReturn: Math.round(cumulativeReturn * 10000) / 10000,
        })
        .where(eq(liveTrades.id, trade.id))

      console.log(`[returns-calculator] Updated trade ${trade.id}: daily=${dailyReturn.toFixed(4)}%, cumulative=${cumulativeReturn.toFixed(4)}%`)
    } catch (error) {
      console.error(`[returns-calculator] Error calculating returns for trade ${trade.id}:`, error)
    }
  }
}

/**
 * Get the next trading day after a given date
 * Simple implementation - just adds 1 day
 * TODO: Add proper market calendar support
 *
 * @param {string} date - Date string (YYYY-MM-DD)
 * @returns {string} - Next trading day (YYYY-MM-DD)
 */
function getNextTradingDay(date) {
  const d = new Date(date)
  d.setDate(d.getDate() + 1)

  // Skip weekends
  const day = d.getDay()
  if (day === 0) d.setDate(d.getDate() + 1)  // Sunday -> Monday
  if (day === 6) d.setDate(d.getDate() + 2)  // Saturday -> Monday

  return d.toISOString().split('T')[0]
}

/**
 * Get live trading statistics for a bot
 *
 * @param {Object} db - Database instance
 * @param {string} userId - User ID
 * @param {string} botId - Bot ID
 * @returns {Promise<Object>} - Live stats object
 */
export async function getLiveStats(db, userId, botId) {
  const { liveTrades } = await import('../db/schema.mjs')
  const { eq, and, desc } = await import('drizzle-orm')

  const trades = await db.select().from(liveTrades)
    .where(and(
      eq(liveTrades.userId, userId),
      eq(liveTrades.botId, botId)
    ))
    .orderBy(desc(liveTrades.tradeDate))

  if (trades.length === 0) {
    return {
      hasLiveData: false,
    }
  }

  const latest = trades[0]
  const oldest = trades[trades.length - 1]

  // Calculate statistics
  const dailyReturns = trades
    .filter(t => t.dailyReturn !== null)
    .map(t => t.dailyReturn)

  const avgDailyReturn = dailyReturns.length > 0
    ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
    : null

  const maxDrawdown = calculateMaxDrawdown(trades)

  return {
    hasLiveData: true,
    firstTradeDate: oldest.tradeDate,
    latestTradeDate: latest.tradeDate,
    currentAllocations: JSON.parse(latest.allocations),
    portfolioValue: latest.portfolioValue,
    cumulativeReturn: latest.cumulativeReturn,
    tradingDays: trades.length,
    avgDailyReturn,
    maxDrawdown,
    history: trades.map(t => ({
      date: t.tradeDate,
      dailyReturn: t.dailyReturn,
      cumulativeReturn: t.cumulativeReturn,
      portfolioValue: t.portfolioValue,
    })),
  }
}

/**
 * Calculate maximum drawdown from trade history
 *
 * @param {Array} trades - Array of trade objects with cumulativeReturn
 * @returns {number} - Maximum drawdown as percentage
 */
function calculateMaxDrawdown(trades) {
  if (trades.length === 0) return 0

  // Sort by date ascending
  const sorted = [...trades].sort((a, b) =>
    new Date(a.tradeDate) - new Date(b.tradeDate)
  )

  let peak = 0
  let maxDrawdown = 0

  for (const trade of sorted) {
    const cumReturn = trade.cumulativeReturn || 0
    if (cumReturn > peak) {
      peak = cumReturn
    }
    const drawdown = peak - cumReturn
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown
    }
  }

  return maxDrawdown
}

/**
 * Get trade history for a bot within a date range
 *
 * @param {Object} db - Database instance
 * @param {string} userId - User ID
 * @param {string} botId - Bot ID
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Promise<Array>} - Array of trade objects
 */
export async function getTradeHistory(db, userId, botId, startDate, endDate) {
  const { liveTrades } = await import('../db/schema.mjs')
  const { eq, and, gte, lte, asc } = await import('drizzle-orm')

  const conditions = [
    eq(liveTrades.userId, userId),
    eq(liveTrades.botId, botId),
  ]

  if (startDate) {
    conditions.push(gte(liveTrades.tradeDate, startDate))
  }

  if (endDate) {
    conditions.push(lte(liveTrades.tradeDate, endDate))
  }

  return db.select().from(liveTrades)
    .where(and(...conditions))
    .orderBy(asc(liveTrades.tradeDate))
}
