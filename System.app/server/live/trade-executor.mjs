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
  console.log(`[DEBUG] ─────────────────────────────────────────────────────────────`)
  console.log(`[DEBUG] DRY RUN EXECUTION`)

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

  console.log(`[DEBUG] → Equity: $${equity.toFixed(2)}`)
  console.log(`[DEBUG] → Reserved cash: $${reservedCash.toFixed(2)}`)
  console.log(`[DEBUG] → Adjusted equity: $${adjustedEquity.toFixed(2)}`)

  // Apply 99% safety cap
  const totalAlloc = Object.values(allocations).reduce((a, b) => a + b, 0)
  let scaleFactor = 1
  if (totalAlloc > MAX_ALLOCATION_PERCENT) {
    scaleFactor = MAX_ALLOCATION_PERCENT / totalAlloc
    console.log(`[trade-executor] Scaling allocations from ${totalAlloc.toFixed(2)}% to ${MAX_ALLOCATION_PERCENT}%`)
  }

  console.log(`[DEBUG] → Total allocation: ${totalAlloc.toFixed(2)}%`)
  console.log(`[DEBUG] → Scale factor: ${scaleFactor}`)

  // Get current prices for estimation
  const tickers = Object.keys(allocations)
  console.log(`[DEBUG] → Fetching prices for ${tickers.length} tickers...`)
  const prices = await getLatestPrices(client, tickers)
  console.log(`[DEBUG] → Prices fetched`)

  // Calculate positions using notional amounts (like live trading)
  console.log(`[DEBUG] → Calculating positions:`)
  const positions = []
  let totalAllocated = 0

  for (const [ticker, pct] of Object.entries(allocations)) {
    const scaledPct = pct * scaleFactor
    const notional = adjustedEquity * (scaledPct / 100)
    const price = prices[ticker]

    // Skip if notional amount is less than $1 (Alpaca minimum)
    if (notional < 1) {
      console.log(`[DEBUG]   ${ticker}: ${scaledPct.toFixed(2)}% → $${notional.toFixed(2)} (SKIP: below $1 minimum)`)
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
      console.log(`[DEBUG]   ${ticker}: ${scaledPct.toFixed(2)}% → ERROR: no price available`)
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

    console.log(`[DEBUG]   ${ticker}: ${scaledPct.toFixed(2)}% → $${notional.toFixed(2)} → ~${estimatedShares.toFixed(4)} shares @ $${price.toFixed(2)}`)

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

  console.log(`[DEBUG] ─────────────────────────────────────────────────────────────`)
  console.log(`[DEBUG] DRY RUN SUMMARY`)
  console.log(`[DEBUG] → Total allocated: $${totalAllocated.toFixed(2)}`)
  console.log(`[DEBUG] → Unallocated: $${(adjustedEquity - totalAllocated).toFixed(2)}`)
  console.log(`[DEBUG] → Positions: ${positions.filter(p => p.shares > 0).length}`)

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
  console.log(`[DEBUG] ─────────────────────────────────────────────────────────────`)
  console.log(`[DEBUG] LIVE TRADE EXECUTION`)
  console.log(`[DEBUG] ─────────────────────────────────────────────────────────────`)

  const client = createAlpacaClient(credentials)
  const { investmentAmount, botPositions } = options

  // Step 1: Get current state
  console.log(`[DEBUG] STEP 1: Get Current State`)
  const account = await getAccountInfo(client)

  // Use bot's ledger positions for sell calculations (not all Alpaca positions)
  // If no botPositions provided, use empty array (first run = buys only)
  const currentPositions = botPositions || []

  // Use investmentAmount if provided (bot investment mode), otherwise use full account equity
  const equity = investmentAmount || account.equity
  console.log(`[DEBUG] → Investment equity: $${equity.toFixed(2)}`)
  console.log(`[DEBUG] → Bot ledger positions: ${currentPositions.length}`)
  console.log(`[trade-executor] Using ${investmentAmount ? 'investment amount' : 'account equity'}: $${equity.toFixed(2)}`)
  console.log(`[trade-executor] Bot has ${currentPositions.length} positions in ledger (${botPositions ? 'from ledger' : 'empty - first run'})`)

  // Log current positions from bot's ledger
  for (const pos of currentPositions) {
    console.log(`[DEBUG]   Bot position: ${pos.symbol} - ${pos.qty} shares ($${pos.marketValue.toFixed(2)})`)
  }

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
  console.log(`[DEBUG] → Reserved cash: $${reservedCash.toFixed(2)}`)
  console.log(`[DEBUG] → Adjusted equity: $${adjustedEquity.toFixed(2)}`)
  console.log(`[trade-executor] Adjusted equity: $${adjustedEquity.toFixed(2)} (equity $${equity.toFixed(2)} - reserve $${reservedCash.toFixed(2)})`)

  // Apply 99% safety cap
  console.log(`[DEBUG] ─────────────────────────────────────────────────────────────`)
  console.log(`[DEBUG] STEP 2: Calculate Target Allocations`)
  const totalAlloc = Object.values(allocations).reduce((a, b) => a + b, 0)
  let scaleFactor = 1
  if (totalAlloc > MAX_ALLOCATION_PERCENT) {
    scaleFactor = MAX_ALLOCATION_PERCENT / totalAlloc
  }
  console.log(`[DEBUG] → Total allocation: ${totalAlloc.toFixed(2)}%`)
  console.log(`[DEBUG] → Scale factor: ${scaleFactor}`)

  // Calculate target positions
  const scaledAllocations = Object.fromEntries(
    Object.entries(allocations).map(([t, p]) => [t, p * scaleFactor])
  )

  console.log(`[DEBUG] → Target allocations:`)
  for (const [ticker, pct] of Object.entries(scaledAllocations)) {
    console.log(`[DEBUG]   Target: ${ticker} → ${pct.toFixed(2)}%`)
  }

  // Get current allocation percentages
  const currentAlloc = {}
  for (const pos of currentPositions) {
    currentAlloc[pos.symbol] = (pos.marketValue / equity) * 100
  }

  // Calculate needed changes
  console.log(`[DEBUG] ─────────────────────────────────────────────────────────────`)
  console.log(`[DEBUG] STEP 3: Determine Sells`)
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

  console.log(`[DEBUG] → Sells needed: ${sells.length}`)
  for (const sell of sells) {
    console.log(`[DEBUG]   SELL: ${sell.symbol} - ${sell.currentQty} shares (${sell.currentPct.toFixed(2)}% → ${sell.targetPct.toFixed(2)}%)`)
  }

  // Find buys - BUY ALL positions in target allocation, regardless of size
  console.log(`[DEBUG] ─────────────────────────────────────────────────────────────`)
  console.log(`[DEBUG] STEP 4: Determine Buys`)
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

  console.log(`[DEBUG] → Buys needed: ${buys.length}`)
  for (const buy of buys) {
    console.log(`[DEBUG]   BUY: ${buy.symbol} - ${buy.currentPct.toFixed(2)}% → ${buy.targetPct.toFixed(2)}% (+${buy.diffPct.toFixed(2)}%)`)
  }

  console.log(`[trade-executor] Calculated ${sells.length} sells, ${buys.length} buys`)
  console.log(`[trade-executor] Buys:`, buys.map(b => `${b.symbol} ${b.targetPct.toFixed(2)}%`).join(', '))

  // Step 2: Cancel existing orders
  console.log(`[DEBUG] ─────────────────────────────────────────────────────────────`)
  console.log(`[DEBUG] STEP 5: Cancel Existing Orders`)
  const cancelledCount = await cancelAllOrders(client)
  console.log(`[DEBUG] → Cancelled ${cancelledCount} orders`)
  console.log(`[trade-executor] Cancelled ${cancelledCount} open orders`)

  // Step 3: Execute sells first (market orders)
  console.log(`[DEBUG] ─────────────────────────────────────────────────────────────`)
  console.log(`[DEBUG] STEP 6: Execute Sells`)
  const sellResults = []
  for (const sell of sells) {
    let qtyToSell

    if (sell.targetPct === 0) {
      // Full liquidation - sell all shares
      qtyToSell = sell.currentQty
      console.log(`[DEBUG] → Full liquidation: ${sell.symbol} x ${qtyToSell}`)
    } else {
      // Partial sell - calculate shares to sell to reach target allocation
      const targetValue = adjustedEquity * (sell.targetPct / 100)
      const currentValue = sell.currentValue
      const valueToSell = currentValue - targetValue

      // Get price per share from current position
      const pricePerShare = sell.currentValue / sell.currentQty
      qtyToSell = valueToSell / pricePerShare

      // Round down to avoid selling more than intended (4 decimal places for fractional shares)
      qtyToSell = Math.floor(qtyToSell * 10000) / 10000

      console.log(`[DEBUG] → Partial sell: ${sell.symbol} - selling ${qtyToSell.toFixed(4)} of ${sell.currentQty} shares`)
      console.log(`[DEBUG]   Target value: $${targetValue.toFixed(2)}, Current: $${currentValue.toFixed(2)}, Selling: $${valueToSell.toFixed(2)}`)
    }

    // Skip if quantity to sell is too small
    if (qtyToSell < 0.0001) {
      console.log(`[DEBUG]   ⏭️ SKIP ${sell.symbol}: sell quantity too small (${qtyToSell})`)
      sellResults.push({
        symbol: sell.symbol,
        success: false,
        skipped: true,
        reason: `Sell quantity ${qtyToSell} too small`,
      })
      continue
    }

    console.log(`[DEBUG] → Submitting sell: ${sell.symbol} x ${qtyToSell}`)
    try {
      const result = await submitMarketSell(client, sell.symbol, qtyToSell)
      console.log(`[DEBUG]   ✓ Sell success: ${sell.symbol}`)
      sellResults.push({ ...result, success: true })
    } catch (error) {
      console.log(`[DEBUG]   ✗ Sell FAILED: ${sell.symbol} - ${error.message}`)
      sellResults.push({
        symbol: sell.symbol,
        success: false,
        error: error.message,
      })
    }
  }

  // Step 4: Execute buys using notional (dollar-based) market orders
  // This allows fractional shares for small allocations
  console.log(`[DEBUG] ─────────────────────────────────────────────────────────────`)
  console.log(`[DEBUG] STEP 7: Execute Buys`)
  const buyResults = []
  console.log(`[trade-executor] Executing ${buys.length} buy orders...`)

  for (const buy of buys) {
    const notional = adjustedEquity * (buy.targetPct / 100)

    // Skip if notional amount is less than $1 (Alpaca minimum)
    if (notional < 1) {
      console.log(`[DEBUG] → SKIP ${buy.symbol}: notional $${notional.toFixed(2)} < $1 minimum`)
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

    console.log(`[DEBUG] → Submitting buy: ${buy.symbol} - $${notional.toFixed(2)} notional`)
    try {
      console.log(`[trade-executor] 📤 BUY ${buy.symbol}: $${notional.toFixed(2)} notional`)
      const result = await submitNotionalMarketBuy(client, buy.symbol, notional)
      console.log(`[DEBUG]   ✓ Buy success: ${buy.symbol} - Order ${result.id}`)
      console.log(`[trade-executor] ✅ ${buy.symbol}: Order ${result.id} submitted`)
      buyResults.push({
        ...result,
        success: true,
        estimatedShares: null, // Will be filled after order executes
      })
    } catch (error) {
      console.log(`[DEBUG]   ✗ Buy FAILED: ${buy.symbol} - ${error.message}`)
      console.error(`[trade-executor] ❌ ${buy.symbol} FAILED: ${error.message}`)
      buyResults.push({
        symbol: buy.symbol,
        success: false,
        error: error.message,
        notional,
      })
    }
  }

  console.log(`[DEBUG] ─────────────────────────────────────────────────────────────`)
  console.log(`[DEBUG] EXECUTION SUMMARY`)
  console.log(`[DEBUG] → Sells: ${sellResults.filter(r => r.success).length}/${sells.length} succeeded`)
  console.log(`[DEBUG] → Buys: ${buyResults.filter(r => r.success).length}/${buys.length} succeeded`)
  console.log(`[DEBUG] → Skipped: ${buyResults.filter(r => r.skipped).length}`)
  console.log(`[DEBUG] → Errors: ${[...sellResults, ...buyResults].filter(r => !r.success && !r.skipped).length}`)
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
