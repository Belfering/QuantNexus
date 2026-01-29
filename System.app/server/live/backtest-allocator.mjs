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
  console.log(`[backtest-allocator] Getting allocations for bot ${bot?.id || 'unknown'}`)
  console.log(`[backtest-allocator] Payload type: ${typeof bot?.payload}`)
  console.log(`[backtest-allocator] Payload is object: ${typeof bot?.payload === 'object'}`)
  console.log(`[backtest-allocator] Payload keys: ${bot?.payload ? Object.keys(bot.payload).join(', ') : 'none'}`)
  console.log(`[backtest-allocator] Payload kind: ${bot?.payload?.kind}`)
  console.log(`[backtest-allocator] Payload has positions: ${!!bot?.payload?.positions}`)
  console.log(`[backtest-allocator] Payload has children: ${!!bot?.payload?.children}`)

  if (!bot?.payload) {
    console.warn(`[backtest-allocator] Bot ${bot?.id || 'unknown'} has no payload`)
    return null
  }

  try {
    // Run backtest to get allocations up to today
    const today = new Date().toISOString().split('T')[0]
    console.log(`[backtest-allocator] Running backtest to ${today}`)

    // Note: runBacktest signature is (payload, options)
    // It does NOT support startDate/endDate/startingCapital/rebalanceFrequency - it runs on all available data
    const result = await runBacktest(bot.payload, {
      mode: 'CC',  // Close-to-close pricing
      benchmarkTicker: backtestParams.benchmark || 'SPY',
    })

    // console.log(`[DEBUG] → Backtest complete, ${result?.allocations?.length || 0} allocation periods`)

    if (!result || !result.allocations) {
      // console.log(`[DEBUG] ✗ No allocations returned`)
      console.warn(`[backtest-allocator] No allocations returned for bot ${bot.id}`)
      return null
    }

    // Get the LAST day's allocation (today's positions)
    const lastAllocation = result.allocations[result.allocations.length - 1]
    console.log(`[backtest-allocator] Last allocation date: ${lastAllocation?.date || 'N/A'}`)
    console.log(`[backtest-allocator] Last allocation entries count: ${lastAllocation?.entries?.length || 0}`)

    if (!lastAllocation || !lastAllocation.entries || lastAllocation.entries.length === 0) {
      console.warn(`[backtest-allocator] Empty allocation for bot ${bot.id}`)
      return null
    }

    // Convert to { ticker: percent } format
    // Note: backtest returns entries as [{ ticker, weight }] where weight is 0-1 range
    const allocations = {}
    for (const entry of lastAllocation.entries) {
      if (entry.weight > 0) {
        allocations[entry.ticker.toUpperCase()] = entry.weight * 100  // Convert 0.5 -> 50%
        console.log(`[backtest-allocator]   ${entry.ticker.toUpperCase()}: ${(entry.weight * 100).toFixed(2)}%`)
      }
    }

    console.log(`[backtest-allocator] Bot ${bot.id} allocations:`, allocations)
    return allocations
  } catch (error) {
    // console.log(`[DEBUG] ✗ Backtest FAILED: ${error.message}`)
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
  // console.log(`[DEBUG] ─────────────────────────────────────────────────────────────`)
  // console.log(`[DEBUG] MERGING ALLOCATIONS FROM ${investments.length} BOTS`)
  // console.log(`[DEBUG] → Total equity: $${totalEquity.toFixed(2)}`)

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

  // console.log(`[DEBUG] → Total investment: $${totalDollars.toFixed(2)}`)
  // console.log(`[DEBUG] → Investment weights:`)
  for (const inv of investmentWeights) {
    const weightPct = totalDollars > 0 ? (inv.dollarAmount / totalDollars * 100) : 0
    // console.log(`[DEBUG]   Bot ${inv.botId}: $${inv.dollarAmount.toFixed(2)} (${weightPct.toFixed(2)}% weight)`)
  }

  if (totalDollars === 0) {
    // console.log(`[DEBUG] ✗ No investments to allocate`)
    console.warn('[backtest-allocator] No investments to allocate')
    return {}
  }

  // Get allocations for each bot and merge
  const mergedAlloc = {}

  for (const inv of investmentWeights) {
    const weight = inv.dollarAmount / totalDollars  // Fraction of total

    // Get bot's allocations from backtest
    // console.log(`[DEBUG] → Processing bot ${inv.botId} (${(weight * 100).toFixed(2)}% weight)...`)
    const botAlloc = await getAllocationsForBot(inv.bot, backtestParams)

    if (!botAlloc || Object.keys(botAlloc).length === 0) {
      // Backtest failed - assign weight to fallback ticker
      // console.log(`[DEBUG]   Using fallback ticker ${fallbackTicker} for bot ${inv.botId}`)
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

  // console.log(`[DEBUG] → Merged allocations (before filters):`)
  for (const [ticker, pct] of Object.entries(mergedAlloc)) {
    // console.log(`[DEBUG]   ${ticker}: ${pct.toFixed(2)}%`)
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
  // console.log(`[DEBUG] ─────────────────────────────────────────────────────────────`)
  // console.log(`[DEBUG] APPLYING PAIRED TICKER FILTER`)
  // console.log(`[DEBUG] → Pairs to process: ${pairedTickers?.length || 0}`)

  if (!pairedTickers || pairedTickers.length === 0) {
    // console.log(`[DEBUG] → No pairs configured - skipping filter`)
    return allocations
  }

  const result = { ...allocations }
  let totalRemoved = 0

  for (const pair of pairedTickers) {
    if (!Array.isArray(pair) || pair.length !== 2) continue

    const [t1, t2] = pair.map(t => t.toUpperCase())
    const v1 = result[t1] || 0
    const v2 = result[t2] || 0

    // console.log(`[DEBUG] → Processing pair: ${t1}/${t2}`)
    // console.log(`[DEBUG]   ${t1}: ${v1.toFixed(2)}%, ${t2}: ${v2.toFixed(2)}%`)

    if (v1 === 0 && v2 === 0) {
      // console.log(`[DEBUG]   Both zero - skipping`)
      continue
    }

    if (v1 > v2) {
      result[t1] = v1 - v2
      totalRemoved += v2
      delete result[t2]
      // console.log(`[DEBUG]   Winner: ${t1} with ${(v1 - v2).toFixed(2)}% (removed ${t2})`)
      console.log(`[backtest-allocator] Paired filter: ${t1} wins (${v1}% vs ${v2}%), removed ${t2}`)
    } else if (v2 > v1) {
      result[t2] = v2 - v1
      totalRemoved += v1
      delete result[t1]
      // console.log(`[DEBUG]   Winner: ${t2} with ${(v2 - v1).toFixed(2)}% (removed ${t1})`)
      console.log(`[backtest-allocator] Paired filter: ${t2} wins (${v2}% vs ${v1}%), removed ${t1}`)
    } else {
      // Equal - remove both
      totalRemoved += v1 + v2
      delete result[t1]
      delete result[t2]
      // console.log(`[DEBUG]   Equal - removed both`)
      console.log(`[backtest-allocator] Paired filter: ${t1}/${t2} equal (${v1}%), removed both`)
    }
  }

  // Redistribute removed percentage across remaining positions
  if (totalRemoved > 0 && Object.keys(result).length > 0) {
    // console.log(`[DEBUG] → Redistributing ${totalRemoved.toFixed(2)}% across remaining positions`)
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

  // console.log(`[DEBUG] ─────────────────────────────────────────────────────────────`)
  // console.log(`[DEBUG] NORMALIZING ALLOCATIONS`)
  // console.log(`[DEBUG] → Current total: ${total.toFixed(2)}%`)
  // console.log(`[DEBUG] → Max allowed: ${maxPercent}%`)

  if (total <= maxPercent) {
    // console.log(`[DEBUG] → Within limits - no normalization needed`)
    return allocations
  }

  // console.log(`[DEBUG] → Scaling down from ${total.toFixed(2)}% to ${maxPercent}%`)
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
  // console.log(`[DEBUG] ═══════════════════════════════════════════════════════════`)
  // console.log(`[DEBUG] COMPUTING FINAL ALLOCATIONS`)
  // console.log(`[DEBUG] ═══════════════════════════════════════════════════════════`)

  const {
    fallbackTicker = 'SGOV',
    pairedTickers = [],
    maxAllocationPercent = 99.0,
  } = settings

  // console.log(`[DEBUG] → Fallback ticker: ${fallbackTicker}`)
  // console.log(`[DEBUG] → Max allocation: ${maxAllocationPercent}%`)
  // console.log(`[DEBUG] → Paired tickers: ${pairedTickers.length} pairs`)
  // console.log(`[DEBUG] → Investments: ${investments.length}`)
  // console.log(`[DEBUG] → Total equity: $${totalEquity.toFixed(2)}`)

  // Step 1: Merge bot allocations by investment weight
  // console.log(`[DEBUG] ═══════════════════════════════════════════════════════════`)
  // console.log(`[DEBUG] STEP 1: Merge bot allocations`)
  let allocations = await mergeMultipleBotAllocations(
    investments,
    totalEquity,
    fallbackTicker,
    backtestParams
  )
  // console.log(`[DEBUG] STEP 1 COMPLETE - ${Object.keys(allocations).length} tickers`)

  // Step 2: Apply paired ticker filter
  // console.log(`[DEBUG] ═══════════════════════════════════════════════════════════`)
  // console.log(`[DEBUG] STEP 2: Apply paired ticker filter`)
  allocations = filterPairedTickers(allocations, pairedTickers)
  // console.log(`[DEBUG] STEP 2 COMPLETE - ${Object.keys(allocations).length} tickers`)

  // Step 3: Normalize to max allocation cap
  // console.log(`[DEBUG] ═══════════════════════════════════════════════════════════`)
  // console.log(`[DEBUG] STEP 3: Normalize to max cap`)
  allocations = normalizeAllocations(allocations, maxAllocationPercent)
  // console.log(`[DEBUG] STEP 3 COMPLETE`)

  // console.log(`[DEBUG] ═══════════════════════════════════════════════════════════`)
  // console.log(`[DEBUG] FINAL ALLOCATIONS:`)
  for (const [ticker, pct] of Object.entries(allocations)) {
    // console.log(`[DEBUG]   ${ticker}: ${pct.toFixed(2)}%`)
  }
  const totalPct = Object.values(allocations).reduce((a, b) => a + b, 0)
  // console.log(`[DEBUG] → Total: ${totalPct.toFixed(2)}%`)
  // console.log(`[DEBUG] ═══════════════════════════════════════════════════════════`)

  console.log('[backtest-allocator] Final allocations:', allocations)
  return allocations
}
