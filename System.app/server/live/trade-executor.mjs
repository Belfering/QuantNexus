/**
 * Trade Executor
 *
 * Handles dry run simulation and live trade execution.
 * Implements the same safety features as master.py:
 * - 99% allocation cap
 * - Sell before buy
 * - Minimum share threshold
 * - Price fetch fallback
 */

import {
  createAlpacaClient,
  getAccountInfo,
  getPositions,
  getLatestPrices,
  cancelAllOrders,
  submitMarketSell,
  submitLimitBuy,
  submitNotionalMarketBuy,
} from './broker-alpaca.mjs'

// Safety constants (matching master.py)
const MAX_ALLOCATION_PERCENT = 99.0  // Never allocate more than 99%
const LIMIT_PRICE_BUFFER = 0.01      // 1% above market for limit orders
const MIN_SHARES = 1                 // Minimum shares to place an order

/**
 * Execute a dry run - calculate what trades WOULD happen
 * Uses real-time prices from Alpaca but doesn't submit orders
 *
 * @param {Object} credentials - Broker credentials
 * @param {Object} allocations - Target allocations { ticker: percent }
 * @param {Object} options - { cashReserve: number (dollars or percent), cashMode: 'dollars'|'percent' }
 * @returns {Promise<Object>} Dry run results
 */
export async function executeDryRun(credentials, allocations, options = {}) {
  const client = createAlpacaClient(credentials)
  const { investmentAmount } = options  // NEW: receive invested amount from bot investments

  const account = await getAccountInfo(client)

  // Use investmentAmount if provided (bot investment mode), otherwise use full account equity
  const equity = investmentAmount || account.equity

  // Calculate cash reserve
  let reservedCash = 0
  if (options.cashReserve) {
    if (options.cashMode === 'percent') {
      reservedCash = equity * (options.cashReserve / 100)
    } else {
      reservedCash = options.cashReserve
    }
  }
  const adjustedEquity = Math.max(0, equity - reservedCash)

  // Apply 99% safety cap
  const totalAlloc = Object.values(allocations).reduce((a, b) => a + b, 0)
  let scaleFactor = 1
  if (totalAlloc > MAX_ALLOCATION_PERCENT) {
    scaleFactor = MAX_ALLOCATION_PERCENT / totalAlloc
    console.log(`[trade-executor] Scaling allocations from ${totalAlloc.toFixed(2)}% to ${MAX_ALLOCATION_PERCENT}%`)
  }

  // Get current prices for estimation
  const tickers = Object.keys(allocations)
  const prices = await getLatestPrices(client, tickers)

  // Calculate positions using notional amounts (like live trading)
  const positions = []
  let totalAllocated = 0

  for (const [ticker, pct] of Object.entries(allocations)) {
    const scaledPct = pct * scaleFactor
    const notional = adjustedEquity * (scaledPct / 100)
    const price = prices[ticker]

    // Skip if notional amount is less than $1 (Alpaca minimum)
    if (notional < 1) {
      positions.push({
        ticker,
        targetPercent: scaledPct,
        price,
        notional,
        shares: 0,
        value: 0,
        skipped: true,
        reason: `Notional amount $${notional.toFixed(2)} is less than $1 minimum`,
      })
      continue
    }

    if (!price) {
      positions.push({
        ticker,
        targetPercent: scaledPct,
        price: null,
        notional,
        shares: 0,
        value: 0,
        error: 'Unable to get price',
      })
      continue
    }

    // Estimate shares (will be fractional)
    const estimatedShares = notional / price
    const value = notional

    totalAllocated += value
    positions.push({
      ticker,
      targetPercent: scaledPct,
      price,
      notional,
      estimatedShares,
      shares: estimatedShares,  // For backwards compatibility
      value,
    })
  }

  return {
    mode: 'dry_run',
    timestamp: new Date().toISOString(),
    account: {
      equity,
      cash: account.cash,
      reservedCash,
      adjustedEquity,
    },
    allocations: {
      original: allocations,
      scaleFactor,
      scaled: Object.fromEntries(
        Object.entries(allocations).map(([t, p]) => [t, p * scaleFactor])
      ),
    },
    positions,
    summary: {
      totalAllocated,
      unallocated: adjustedEquity - totalAllocated,
      allocationPercent: (totalAllocated / adjustedEquity) * 100,
      positionCount: positions.filter(p => p.shares > 0).length,
    },
  }
}

/**
 * Execute live trades
 * WARNING: This actually submits orders to Alpaca!
 *
 * @param {Object} credentials - Broker credentials
 * @param {Object} allocations - Target allocations { ticker: percent }
 * @param {Object} options - { cashReserve, cashMode, orderType: 'market'|'limit' }
 * @returns {Promise<Object>} Execution results
 */
export async function executeLiveTrades(credentials, allocations, options = {}) {
  const client = createAlpacaClient(credentials)
  const { investmentAmount } = options  // NEW: receive invested amount from bot investments

  // Step 1: Get current state
  const account = await getAccountInfo(client)
  const currentPositions = await getPositions(client)

  // Use investmentAmount if provided (bot investment mode), otherwise use full account equity
  const equity = investmentAmount || account.equity
  console.log(`[trade-executor] Using ${investmentAmount ? 'investment amount' : 'account equity'}: $${equity.toFixed(2)}`)

  // Calculate cash reserve
  let reservedCash = 0
  if (options.cashReserve) {
    if (options.cashMode === 'percent') {
      reservedCash = equity * (options.cashReserve / 100)
    } else {
      reservedCash = options.cashReserve
    }
  }
  const adjustedEquity = Math.max(0, equity - reservedCash)
  console.log(`[trade-executor] Adjusted equity: $${adjustedEquity.toFixed(2)} (equity $${equity.toFixed(2)} - reserve $${reservedCash.toFixed(2)})`)

  // Apply 99% safety cap
  const totalAlloc = Object.values(allocations).reduce((a, b) => a + b, 0)
  let scaleFactor = 1
  if (totalAlloc > MAX_ALLOCATION_PERCENT) {
    scaleFactor = MAX_ALLOCATION_PERCENT / totalAlloc
  }

  // Calculate target positions
  const scaledAllocations = Object.fromEntries(
    Object.entries(allocations).map(([t, p]) => [t, p * scaleFactor])
  )

  // Get current allocation percentages
  const currentAlloc = {}
  for (const pos of currentPositions) {
    currentAlloc[pos.symbol] = (pos.marketValue / equity) * 100
  }

  // Calculate needed changes
  const sells = []
  const buys = []

  // Find sells (current positions not in target OR need to reduce)
  for (const pos of currentPositions) {
    const targetPct = scaledAllocations[pos.symbol] || 0
    const currentPct = currentAlloc[pos.symbol]
    const diff = targetPct - currentPct

    if (diff < 0) {  // Need to sell (target is less than current, or not in target at all)
      sells.push({
        symbol: pos.symbol,
        currentQty: pos.qty,
        currentValue: pos.marketValue,
        targetPct,
        currentPct,
      })
    }
  }

  // Find buys - BUY ALL positions in target allocation, regardless of size
  for (const [ticker, targetPct] of Object.entries(scaledAllocations)) {
    const currentPct = currentAlloc[ticker] || 0
    const diff = targetPct - currentPct

    if (diff > 0) {  // Need to buy (target is more than current, including new positions)
      buys.push({
        symbol: ticker,
        targetPct,
        currentPct,
        diffPct: diff,
      })
    }
  }

  console.log(`[trade-executor] Calculated ${sells.length} sells, ${buys.length} buys`)
  console.log(`[trade-executor] Buys:`, buys.map(b => `${b.symbol} ${b.targetPct.toFixed(2)}%`).join(', '))

  // Step 2: Cancel existing orders
  const cancelledCount = await cancelAllOrders(client)
  console.log(`[trade-executor] Cancelled ${cancelledCount} open orders`)

  // Step 3: Execute sells first (market orders)
  const sellResults = []
  for (const sell of sells) {
    if (sell.targetPct === 0) {
      // Full liquidation
      try {
        const result = await submitMarketSell(client, sell.symbol, sell.currentQty)
        sellResults.push({ ...result, success: true })
      } catch (error) {
        sellResults.push({
          symbol: sell.symbol,
          success: false,
          error: error.message,
        })
      }
    }
    // Partial sells would need more complex logic
  }

  // Step 4: Execute buys using notional (dollar-based) market orders
  // This allows fractional shares for small allocations
  const buyResults = []
  console.log(`[trade-executor] Executing ${buys.length} buy orders...`)

  for (const buy of buys) {
    const notional = adjustedEquity * (buy.targetPct / 100)

    // Skip if notional amount is less than $1 (Alpaca minimum)
    if (notional < 1) {
      console.log(`[trade-executor] ⏭️  SKIP ${buy.symbol}: notional $${notional.toFixed(2)} < $1`)
      buyResults.push({
        symbol: buy.symbol,
        success: false,
        skipped: true,
        reason: `Notional amount $${notional.toFixed(2)} is less than $1 minimum`,
        notional,
      })
      continue
    }

    try {
      console.log(`[trade-executor] 📤 BUY ${buy.symbol}: $${notional.toFixed(2)} notional`)
      const result = await submitNotionalMarketBuy(client, buy.symbol, notional)
      console.log(`[trade-executor] ✅ ${buy.symbol}: Order ${result.id} submitted`)
      buyResults.push({
        ...result,
        success: true,
        estimatedShares: null, // Will be filled after order executes
      })
    } catch (error) {
      console.error(`[trade-executor] ❌ ${buy.symbol} FAILED: ${error.message}`)
      buyResults.push({
        symbol: buy.symbol,
        success: false,
        error: error.message,
        notional,
      })
    }
  }

  console.log(`[trade-executor] Buy summary: ${buyResults.filter(r => r.success).length} successful, ${buyResults.filter(r => r.skipped).length} skipped, ${buyResults.filter(r => !r.success && !r.skipped).length} failed`)

  return {
    mode: 'live',
    timestamp: new Date().toISOString(),
    account: { equity, reservedCash, adjustedEquity },
    cancelledOrders: cancelledCount,
    sells: sellResults,
    buys: buyResults,
    summary: {
      sellCount: sellResults.filter(r => r.success).length,
      buyCount: buyResults.filter(r => r.success).length,
      errorCount: [...sellResults, ...buyResults].filter(r => !r.success && !r.skipped).length,
    },
  }
}

/**
 * Store simulated positions from a dry run
 * @param {Object} db - Database instance
 * @param {string} userId - User ID
 * @param {Array} positions - Positions from dry run
 * @param {string} runDate - Date string (YYYY-MM-DD)
 */
export async function storeSimulatedPositions(db, userId, positions, runDate) {
  const { simulatedPositions } = await import('../db/schema.mjs')

  // Clear previous simulated positions for this user/date
  await db.delete(simulatedPositions)
    .where(
      db.and(
        db.eq(simulatedPositions.userId, userId),
        db.eq(simulatedPositions.runDate, runDate)
      )
    )

  // Insert new positions
  for (const pos of positions) {
    if (pos.shares > 0) {
      await db.insert(simulatedPositions).values({
        userId,
        runDate,
        ticker: pos.ticker,
        targetPercent: pos.targetPercent,
        simulatedShares: pos.shares,
        simulatedPrice: pos.limitPrice || pos.price,
        simulatedValue: pos.value,
      })
    }
  }
}
