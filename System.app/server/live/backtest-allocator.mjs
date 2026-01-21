/**
 * Backtest-Driven Allocation System
 *
 * Calls the backtest engine to get today's target allocations for each invested bot,
 * then merges them by investment weight to produce a final allocation.
 *
 * Reference: Master.py from C:\Users\Trader\Desktop\Alpaca Trading\Master Script
 */

import { runBacktest } from '../backtest.mjs'

/**
 * Get today's allocations from a bot's backtest
 *
 * @param {Object} bot - Bot object with payload (flowchart)
 * @param {Object} backtestParams - Backtest parameters (startDate, benchmark, etc.)
 * @returns {Promise<Object>} Allocation { ticker: percent } or null on failure
 */
export async function getAllocationsForBot(bot, backtestParams = {}) {
  if (!bot?.payload) {
    console.warn(`[backtest-allocator] Bot ${bot?.id || 'unknown'} has no payload`)
    return null
  }

  try {
    // Run backtest to get allocations up to today
    const today = new Date().toISOString().split('T')[0]

    const result = await runBacktest({
      flowchart: bot.payload,
      startDate: backtestParams.startDate || '2020-01-01',
      endDate: today,
      benchmark: backtestParams.benchmark || 'SPY',
      startingCapital: backtestParams.startingCapital || 100000,
      rebalanceFrequency: backtestParams.rebalanceFrequency || 'daily',
    })

    if (!result || !result.allocations) {
      console.warn(`[backtest-allocator] No allocations returned for bot ${bot.id}`)
      return null
    }

    // Get the LAST day's allocation (today's positions)
    const lastAllocation = result.allocations[result.allocations.length - 1]
    if (!lastAllocation) {
      console.warn(`[backtest-allocator] Empty allocation array for bot ${bot.id}`)
      return null
    }

    // Convert to { ticker: percent } format
    const allocations = {}
    for (const [ticker, weight] of Object.entries(lastAllocation.positions || {})) {
      if (weight > 0) {
        allocations[ticker.toUpperCase()] = weight * 100  // Convert 0.5 -> 50%
      }
    }

    console.log(`[backtest-allocator] Bot ${bot.id} allocations:`, allocations)
    return allocations
  } catch (error) {
    console.error(`[backtest-allocator] Backtest failed for bot ${bot.id}:`, error.message)
    return null
  }
}

/**
 * Merge allocations from multiple bots weighted by investment amount
 *
 * @param {Array} investments - Array of { botId, investmentAmount, weightMode, bot }
 * @param {number} totalEquity - Total portfolio equity for percent mode
 * @param {string} fallbackTicker - Fallback ticker for failed bots (default: SGOV)
 * @param {Object} backtestParams - Backtest parameters
 * @returns {Promise<Object>} Merged allocation { ticker: percent }
 */
export async function mergeMultipleBotAllocations(investments, totalEquity, fallbackTicker = 'SGOV', backtestParams = {}) {
  // Calculate total investment weights
  let totalDollars = 0
  const investmentWeights = []

  for (const inv of investments) {
    let dollarAmount
    if (inv.weightMode === 'percent') {
      dollarAmount = totalEquity * (inv.investmentAmount / 100)
    } else {
      dollarAmount = inv.investmentAmount
    }
    totalDollars += dollarAmount
    investmentWeights.push({ ...inv, dollarAmount })
  }

  if (totalDollars === 0) {
    console.warn('[backtest-allocator] No investments to allocate')
    return {}
  }

  // Get allocations for each bot and merge
  const mergedAlloc = {}

  for (const inv of investmentWeights) {
    const weight = inv.dollarAmount / totalDollars  // Fraction of total

    // Get bot's allocations from backtest
    const botAlloc = await getAllocationsForBot(inv.bot, backtestParams)

    if (!botAlloc || Object.keys(botAlloc).length === 0) {
      // Backtest failed - assign weight to fallback ticker
      console.warn(`[backtest-allocator] Using fallback for bot ${inv.botId}`)
      mergedAlloc[fallbackTicker] = (mergedAlloc[fallbackTicker] || 0) + (weight * 100)
      continue
    }

    // Merge this bot's allocation weighted by investment
    for (const [ticker, pct] of Object.entries(botAlloc)) {
      const weightedPct = pct * weight
      mergedAlloc[ticker] = (mergedAlloc[ticker] || 0) + weightedPct
    }
  }

  console.log('[backtest-allocator] Merged allocations before filters:', mergedAlloc)
  return mergedAlloc
}

/**
 * Apply paired ticker filter (e.g., SPY-SH: keep higher, remove lower)
 *
 * @param {Object} allocations - { ticker: percent }
 * @param {Array} pairedTickers - Array of [ticker1, ticker2] pairs
 * @returns {Object} Filtered allocations
 */
export function filterPairedTickers(allocations, pairedTickers = []) {
  if (!pairedTickers || pairedTickers.length === 0) {
    return allocations
  }

  const result = { ...allocations }
  let totalRemoved = 0

  for (const pair of pairedTickers) {
    if (!Array.isArray(pair) || pair.length !== 2) continue

    const [t1, t2] = pair.map(t => t.toUpperCase())
    const v1 = result[t1] || 0
    const v2 = result[t2] || 0

    if (v1 === 0 && v2 === 0) continue

    if (v1 > v2) {
      result[t1] = v1 - v2
      totalRemoved += v2
      delete result[t2]
      console.log(`[backtest-allocator] Paired filter: ${t1} wins (${v1}% vs ${v2}%), removed ${t2}`)
    } else if (v2 > v1) {
      result[t2] = v2 - v1
      totalRemoved += v1
      delete result[t1]
      console.log(`[backtest-allocator] Paired filter: ${t2} wins (${v2}% vs ${v1}%), removed ${t1}`)
    } else {
      // Equal - remove both
      totalRemoved += v1 + v2
      delete result[t1]
      delete result[t2]
      console.log(`[backtest-allocator] Paired filter: ${t1}/${t2} equal (${v1}%), removed both`)
    }
  }

  // Redistribute removed percentage across remaining positions
  if (totalRemoved > 0 && Object.keys(result).length > 0) {
    const totalRemaining = Object.values(result).reduce((a, b) => a + b, 0)
    if (totalRemaining > 0) {
      for (const ticker of Object.keys(result)) {
        result[ticker] += (result[ticker] / totalRemaining) * totalRemoved
      }
    }
  }

  return result
}

/**
 * Normalize allocations to a maximum percentage (safety cap)
 *
 * @param {Object} allocations - { ticker: percent }
 * @param {number} maxPercent - Maximum total allocation (default: 99%)
 * @returns {Object} Normalized allocations
 */
export function normalizeAllocations(allocations, maxPercent = 99.0) {
  const total = Object.values(allocations).reduce((a, b) => a + b, 0)

  if (total <= maxPercent) {
    return allocations
  }

  console.log(`[backtest-allocator] Normalizing from ${total.toFixed(2)}% to ${maxPercent}%`)
  const scale = maxPercent / total

  return Object.fromEntries(
    Object.entries(allocations).map(([ticker, pct]) => [ticker, pct * scale])
  )
}

/**
 * Full pipeline: Get allocations for all invested bots and apply filters
 *
 * @param {Array} investments - Array of investments with bot objects
 * @param {number} totalEquity - Portfolio equity
 * @param {Object} settings - Trading settings (fallbackTicker, pairedTickers, maxAllocationPercent)
 * @param {Object} backtestParams - Backtest parameters
 * @returns {Promise<Object>} Final allocations { ticker: percent }
 */
export async function computeFinalAllocations(investments, totalEquity, settings = {}, backtestParams = {}) {
  const {
    fallbackTicker = 'SGOV',
    pairedTickers = [],
    maxAllocationPercent = 99.0,
  } = settings

  // Step 1: Merge bot allocations by investment weight
  let allocations = await mergeMultipleBotAllocations(
    investments,
    totalEquity,
    fallbackTicker,
    backtestParams
  )

  // Step 2: Apply paired ticker filter
  allocations = filterPairedTickers(allocations, pairedTickers)

  // Step 3: Normalize to max allocation cap
  allocations = normalizeAllocations(allocations, maxAllocationPercent)

  console.log('[backtest-allocator] Final allocations:', allocations)
  return allocations
}
