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
  const account = await getAccountInfo(client)
  const equity = account.equity

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

  // Get current prices
  const tickers = Object.keys(allocations)
  const prices = await getLatestPrices(client, tickers)

  // Calculate positions
  const positions = []
  let totalAllocated = 0

  for (const [ticker, pct] of Object.entries(allocations)) {
    const scaledPct = pct * scaleFactor
    const price = prices[ticker]

    if (!price) {
      positions.push({
        ticker,
        targetPercent: scaledPct,
        price: null,
        shares: 0,
        value: 0,
        error: 'Unable to get price',
      })
      continue
    }

    const targetValue = adjustedEquity * (scaledPct / 100)
    const limitPrice = Math.round(price * (1 + LIMIT_PRICE_BUFFER) * 100) / 100
    const shares = Math.floor(targetValue / limitPrice)
    const value = shares * limitPrice

    if (shares < MIN_SHARES) {
      positions.push({
        ticker,
        targetPercent: scaledPct,
        price,
        limitPrice,
        shares: 0,
        value: 0,
        skipped: true,
        reason: `Not enough to buy ${MIN_SHARES} share(s) at $${limitPrice.toFixed(2)}`,
      })
      continue
    }

    totalAllocated += value
    positions.push({
      ticker,
      targetPercent: scaledPct,
      price,
      limitPrice,
      shares,
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

  // Step 1: Get current state
  const account = await getAccountInfo(client)
  const currentPositions = await getPositions(client)
  const equity = account.equity

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

  // Step 4: Get fresh prices and execute buys
  const buySymbols = buys.map(b => b.symbol)
  const prices = await getLatestPrices(client, buySymbols)

  const buyResults = []
  for (const buy of buys) {
    const price = prices[buy.symbol]
    if (!price) {
      buyResults.push({
        symbol: buy.symbol,
        success: false,
        error: 'Unable to get price',
      })
      continue
    }

    const targetValue = adjustedEquity * (buy.targetPct / 100)
    const limitPrice = Math.round(price * (1 + LIMIT_PRICE_BUFFER) * 100) / 100
    const shares = Math.floor(targetValue / limitPrice)

    if (shares < MIN_SHARES) {
      buyResults.push({
        symbol: buy.symbol,
        success: false,
        skipped: true,
        reason: `Not enough to buy ${MIN_SHARES} share(s)`,
      })
      continue
    }

    try {
      const result = await submitLimitBuy(client, buy.symbol, shares, limitPrice)
      buyResults.push({ ...result, success: true })
    } catch (error) {
      buyResults.push({
        symbol: buy.symbol,
        success: false,
        error: error.message,
      })
    }
  }

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
