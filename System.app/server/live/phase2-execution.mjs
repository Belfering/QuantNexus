/**
 * Phase 2: Execution - Price Fetch → Backtest → Trade → Attribute
 *
 * Fetches prices once for all tickers, runs deduplicated backtests,
 * executes net trades per user, and attributes positions to systems.
 *
 * Steps:
 * 1. Fetch current prices for all tickers (once)
 * 2. Calculate allocations for deduplicated systems (once per system)
 * 3. Execute trades for each user in queue order
 * 4. Attribute positions back to systems
 * 5. Calculate P&L per system
 */

import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'
import { fetchCurrentPrices } from './price-authority.mjs'
import { getAllocationsForBot } from './backtest-allocator.mjs'
import { createAlpacaClient, getAccountInfo, getPositions, submitMarketSell, submitNotionalMarketBuy } from './broker-alpaca.mjs'
import { getCurrentPortfolio, calculateFinalPortfolio, calculateNetTrades, calculateShareAttribution } from './net-trade-calculator.mjs'
import { calculateUnrealizedPnL } from './pnl-calculator.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'atlas.db')
const sqlite = new Database(DB_PATH)

// ============================================
// ENCRYPTION (for credential decryption)
// ============================================
const ENCRYPTION_KEY = process.env.BROKER_ENCRYPTION_KEY || 'dev-encryption-key-32-chars-long!'
const ENCRYPTION_ALGORITHM = 'aes-256-gcm'

function decrypt(encrypted, ivHex, authTagHex) {
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32)
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

/**
 * Get decrypted Alpaca credentials for a user
 */
function getDecryptedCredentials(userId, credentialType) {
  const row = sqlite.prepare(`
    SELECT encrypted_api_key, encrypted_api_secret, iv, auth_tag, base_url
    FROM broker_credentials
    WHERE user_id = ? AND credential_type = ?
  `).get(userId, credentialType)

  if (!row) return null

  try {
    // IV and auth_tag are stored as "key:secret" format
    const [ivKey, ivSecret] = row.iv.split(':')
    const [authTagKey, authTagSecret] = row.auth_tag.split(':')

    return {
      apiKey: decrypt(row.encrypted_api_key, ivKey, authTagKey),
      apiSecret: decrypt(row.encrypted_api_secret, ivSecret, authTagSecret),
      baseUrl: row.base_url || (credentialType === 'live'
        ? 'https://api.alpaca.markets'
        : 'https://paper-api.alpaca.markets'),
      isPaper: credentialType === 'paper',
    }
  } catch (error) {
    console.error(`[execution] Error decrypting credentials for user ${userId}:`, error)
    return null
  }
}

/**
 * Execute Phase 2 - Complete execution pipeline
 *
 * @param {string} executionId - UUID for this execution run
 * @param {Object} warmupResult - Output from Phase 1
 * @param {Object} options - Execution options
 * @returns {Promise<Object>} Execution results
 */
export async function executePhase2(executionId, warmupResult, options = {}) {
  const { uniqueSystems, allTickers, executionQueue } = warmupResult

  console.log(`[EXECUTION] Starting Phase 2: Execution Pipeline`)
  console.log(`[EXECUTION] - Systems to backtest: ${uniqueSystems.length}`)
  console.log(`[EXECUTION] - Tickers to price: ${allTickers.length}`)
  console.log(`[EXECUTION] - Users to execute: ${executionQueue.length}`)

  // ============================================
  // STEP 1: Fetch Current Prices (Once)
  // ============================================
  console.log(`\n[EXECUTION] Step 1: Fetching current prices...`)
  const pricesStart = Date.now()

  let priceMap = new Map()
  let priceMetadata = new Map()

  if (allTickers.length > 0) {
    try {
      const { prices, metadata } = await fetchCurrentPrices(allTickers, {
        alpacaClient: null, // TODO: Get Alpaca client from credentials
        enableAlpacaFallback: true,
        tiingoMaxConcurrent: 5,
        tiingoBatchDelay: 100,
      })

      priceMap = prices
      priceMetadata = metadata

      const successCount = Array.from(metadata.values()).filter(m => m.price != null).length
      const failCount = allTickers.length - successCount

      console.log(`[EXECUTION] - Price fetch complete: ${successCount} succeeded, ${failCount} failed`)
    } catch (error) {
      console.error(`[EXECUTION] Price fetch failed:`, error)
      // Continue with empty price map - positions will be skipped
    }
  } else {
    console.log(`[EXECUTION] - No tickers to price (unallocated only)`)
  }

  const pricesDuration = Date.now() - pricesStart
  console.log(`[EXECUTION] - Price fetch took ${(pricesDuration / 1000).toFixed(2)}s`)

  // ============================================
  // STEP 2: Calculate Allocations for Deduplicated Systems (Once per System)
  // ============================================
  console.log(`\n[EXECUTION] Step 2: Running backtests for deduplicated systems...`)
  const backtestStart = Date.now()

  const systemAllocations = new Map() // systemId -> { ticker: percent }

  for (const system of uniqueSystems) {
    if (system.isUnallocated) {
      // Unallocated doesn't need backtest - it just holds existing positions
      console.log(`[EXECUTION] - System ${system.systemId}: Unallocated (skip backtest)`)
      systemAllocations.set(system.systemId, {})
      continue
    }

    try {
      console.log(`[EXECUTION] - System ${system.systemId}: Running backtest for ${system.userAccounts.length} user(s)...`)

      const allocations = await getAllocationsForBot(
        { id: system.systemId, payload: system.payload },
        {
          startDate: '2020-01-01',
          benchmark: 'SPY',
          startingCapital: 100000,
          rebalanceFrequency: 'daily',
        }
      )

      if (allocations && Object.keys(allocations).length > 0) {
        systemAllocations.set(system.systemId, allocations)
        console.log(`[EXECUTION]   ✓ Allocations: ${Object.keys(allocations).join(', ')}`)
      } else {
        systemAllocations.set(system.systemId, {})
        console.log(`[EXECUTION]   ✗ No allocations returned (backtest failed)`)
      }

      // Update system_deduplication table with allocations
      sqlite.prepare(`
        UPDATE system_deduplication
        SET last_allocation = ?, last_updated = ?
        WHERE system_id = ?
      `).run(JSON.stringify(allocations || {}), Date.now(), system.systemId)

    } catch (error) {
      console.error(`[EXECUTION] - System ${system.systemId}: Backtest failed:`, error.message)
      systemAllocations.set(system.systemId, {})
    }
  }

  const backtestDuration = Date.now() - backtestStart
  console.log(`[EXECUTION] - Backtest execution took ${(backtestDuration / 1000).toFixed(2)}s`)
  console.log(`[EXECUTION] - Successfully backtested ${Array.from(systemAllocations.values()).filter(a => Object.keys(a).length > 0).length}/${uniqueSystems.length} systems`)

  // ============================================
  // STEP 3: Execute Trades for Each User (In Queue Order)
  // ============================================
  console.log(`\n[EXECUTION] Step 3: Executing trades for users...`)

  let successfulUsers = 0
  let failedUsers = 0
  let totalTradesExecuted = 0
  const allErrors = []

  for (let i = 0; i < executionQueue.length; i++) {
    const { userId, credentialType } = executionQueue[i]
    const queuePosition = i + 1

    console.log(`\n[EXECUTION] ─────────────────────────────────────────────────────────`)
    console.log(`[EXECUTION] User ${queuePosition}/${executionQueue.length}: ${userId} (${credentialType})`)

    // Update execution_queue status
    sqlite.prepare(`
      UPDATE execution_queue
      SET status = 'executing', started_at = ?
      WHERE execution_id = ? AND user_id = ? AND credential_type = ?
    `).run(Date.now(), executionId, userId, credentialType)

    try {
      const result = await executeForUser(userId, credentialType, systemAllocations, priceMap, options)

      // Store user execution results
      sqlite.prepare(`
        INSERT INTO user_execution_results (
          execution_id, user_id, credential_type, queue_position,
          net_trades, orders_executed, attribution_results, pnl_results,
          status, started_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)
      `).run(
        executionId,
        userId,
        credentialType,
        queuePosition,
        JSON.stringify(result.netTrades),
        JSON.stringify(result.orders),
        JSON.stringify(result.attributions),
        JSON.stringify(result.pnl),
        Date.now() - 1000, // started_at (approximate)
        Date.now()
      )

      // Update execution_queue status
      sqlite.prepare(`
        UPDATE execution_queue
        SET status = 'completed', completed_at = ?
        WHERE execution_id = ? AND user_id = ? AND credential_type = ?
      `).run(Date.now(), executionId, userId, credentialType)

      successfulUsers++
      totalTradesExecuted += result.tradesExecuted

      console.log(`[EXECUTION] ✓ User ${userId}: ${result.tradesExecuted} trades executed`)

    } catch (error) {
      console.error(`[EXECUTION] ✗ User ${userId}: Execution failed:`, error.message)

      // Store error in user_execution_results
      sqlite.prepare(`
        INSERT INTO user_execution_results (
          execution_id, user_id, credential_type, queue_position,
          status, errors, started_at, completed_at
        ) VALUES (?, ?, ?, ?, 'failed', ?, ?, ?)
      `).run(
        executionId,
        userId,
        credentialType,
        queuePosition,
        JSON.stringify([{ message: error.message, stack: error.stack }]),
        Date.now() - 1000,
        Date.now()
      )

      // Update execution_queue status
      sqlite.prepare(`
        UPDATE execution_queue
        SET status = 'failed', completed_at = ?
        WHERE execution_id = ? AND user_id = ? AND credential_type = ?
      `).run(Date.now(), executionId, userId, credentialType)

      failedUsers++
      allErrors.push({ userId, credentialType, error: error.message })
    }
  }

  console.log(`\n[EXECUTION] ═════════════════════════════════════════════════════════`)
  console.log(`[EXECUTION] Phase 2 Complete`)
  console.log(`[EXECUTION] - Users: ${successfulUsers} succeeded, ${failedUsers} failed`)
  console.log(`[EXECUTION] - Total trades executed: ${totalTradesExecuted}`)
  console.log(`[EXECUTION] ═════════════════════════════════════════════════════════`)

  return {
    totalTradesExecuted,
    successfulUsers,
    failedUsers,
    errors: allErrors,
    priceMetadata: Array.from(priceMetadata.entries()).map(([ticker, meta]) => ({
      ticker,
      ...meta,
    })),
  }
}

/**
 * Execute trades for a single user
 *
 * @param {string} userId - User ID
 * @param {string} credentialType - 'paper' or 'live'
 * @param {Map} systemAllocations - Map of systemId -> allocations
 * @param {Map} priceMap - Map of ticker -> price
 * @param {Object} options - Execution options
 * @returns {Promise<Object>} Execution result
 */
async function executeForUser(userId, credentialType, systemAllocations, priceMap, options) {
  console.log(`[EXECUTION] Starting execution for user ${userId} (${credentialType})`)

  // ============================================
  // STEP 1: Get Alpaca Credentials and Client
  // ============================================
  const credentials = getDecryptedCredentials(userId, credentialType)
  if (!credentials) {
    throw new Error(`No Alpaca credentials found for user ${userId} (${credentialType})`)
  }

  const alpacaClient = createAlpacaClient(credentials)

  // ============================================
  // STEP 2: Get Account Info and Current Portfolio
  // ============================================
  console.log(`[EXECUTION] - Fetching account info and positions...`)

  const accountInfo = await getAccountInfo(alpacaClient)
  const totalEquity = accountInfo.equity

  console.log(`[EXECUTION]   Account equity: $${totalEquity.toFixed(2)}`)

  const currentPortfolio = await getCurrentPortfolio(alpacaClient, userId, credentialType)

  const currentTickers = Object.keys(currentPortfolio)
  console.log(`[EXECUTION]   Current positions: ${currentTickers.length} tickers`)
  if (currentTickers.length > 0) {
    console.log(`[EXECUTION]   Sample: ${currentTickers.slice(0, 5).join(', ')}${currentTickers.length > 5 ? '...' : ''}`)
  }

  // ============================================
  // STEP 2.5: Display Current State (All Systems + Unallocated)
  // ============================================
  console.log(`[EXECUTION] `)
  console.log(`[EXECUTION] ═══════════════════════════════════════════════════════════`)
  console.log(`[EXECUTION] CURRENT STATE (from ledger and Alpaca)`)
  console.log(`[EXECUTION] ═══════════════════════════════════════════════════════════`)

  // Get ALL systems user is invested in (not just ones with allocations)
  const investments = sqlite.prepare(`
    SELECT bot_id, investment_amount
    FROM user_bot_investments
    WHERE user_id = ? AND credential_type = ? AND investment_amount > 0
  `).all(userId, credentialType)

  // Calculate UNALLOCATED starting state FIRST (always show, even if empty)
  let unallocatedStartingValue = 0
  const unallocatedStartingPositions = {}

  for (const [ticker, portfolio] of Object.entries(currentPortfolio)) {
    const unallocatedShares = portfolio.unallocatedShares
    if (unallocatedShares > 0) {
      const price = priceMap.get(ticker)
      if (price && price > 0) {
        const value = unallocatedShares * price
        unallocatedStartingValue += value
        unallocatedStartingPositions[ticker] = unallocatedShares
      }
    }
  }

  console.log(`[EXECUTION] `)
  console.log(`[EXECUTION] UNALLOCATED:`)
  console.log(`[EXECUTION]   Value: $${unallocatedStartingValue.toFixed(2)}`)
  console.log(`[EXECUTION]   Positions: ${Object.keys(unallocatedStartingPositions).length} tickers`)
  if (Object.keys(unallocatedStartingPositions).length > 0) {
    for (const [ticker, shares] of Object.entries(unallocatedStartingPositions)) {
      const price = priceMap.get(ticker) || 0
      const value = shares * price
      console.log(`[EXECUTION]     ${ticker}: ${shares.toFixed(4)} shares @ $${price.toFixed(2)} = $${value.toFixed(2)}`)
    }
  } else {
    console.log(`[EXECUTION]     (empty)`)
  }

  // Calculate SYSTEM starting states for ALL invested systems
  const systemStartingStates = {}

  for (const inv of investments) {
    const systemId = inv.bot_id

    const ledgerEntries = sqlite.prepare(`
      SELECT symbol, shares
      FROM bot_position_ledger
      WHERE user_id = ? AND credential_type = ? AND bot_id = ? AND shares > 0
    `).all(userId, credentialType, systemId)

    let systemStartingValue = 0
    const systemStartingPositions = {}

    for (const entry of ledgerEntries) {
      const ticker = entry.symbol.toUpperCase()
      const shares = entry.shares
      const price = priceMap.get(ticker)

      if (price && price > 0) {
        const value = shares * price
        systemStartingValue += value
        systemStartingPositions[ticker] = shares
      }
    }

    systemStartingStates[systemId] = {
      value: systemStartingValue,
      positions: systemStartingPositions,
    }

    console.log(`[EXECUTION] `)
    console.log(`[EXECUTION] SYSTEM ${systemId}:`)
    console.log(`[EXECUTION]   Value: $${systemStartingValue.toFixed(2)}`)
    console.log(`[EXECUTION]   Positions: ${Object.keys(systemStartingPositions).length} tickers`)
    if (Object.keys(systemStartingPositions).length > 0) {
      for (const [ticker, shares] of Object.entries(systemStartingPositions)) {
        const price = priceMap.get(ticker) || 0
        const value = shares * price
        console.log(`[EXECUTION]     ${ticker}: ${shares.toFixed(4)} shares @ $${price.toFixed(2)} = $${value.toFixed(2)}`)
      }
    } else {
      console.log(`[EXECUTION]     (empty)`)
    }
  }

  console.log(`[EXECUTION] `)
  console.log(`[EXECUTION] ═══════════════════════════════════════════════════════════`)

  // ============================================
  // STEP 3: Calculate Final Portfolio (Merge Allocations by Investment)
  // ============================================
  console.log(`[EXECUTION] - Calculating final portfolio composition...`)

  const finalPortfolio = calculateFinalPortfolio(userId, credentialType, systemAllocations, priceMap, {
    usePnlRollover: true,
    totalEquity,  // Pass real equity instead of placeholder
  })

  const targetTickers = Object.keys(finalPortfolio)
  console.log(`[EXECUTION]   Target positions: ${targetTickers.length} tickers`)
  if (targetTickers.length > 0) {
    console.log(`[EXECUTION]   Sample: ${targetTickers.slice(0, 5).join(', ')}${targetTickers.length > 5 ? '...' : ''}`)
  }

  // ============================================
  // STEP 4: Calculate Net Position Changes
  // ============================================
  console.log(`[EXECUTION] - Calculating net position changes...`)

  const netTrades = calculateNetTrades(currentPortfolio, finalPortfolio)

  const netTradesCount = Object.keys(netTrades).length
  console.log(`[EXECUTION]   Net trades required: ${netTradesCount}`)

  if (netTradesCount === 0) {
    console.log(`[EXECUTION]   No trades needed - portfolio already at target`)
    return {
      success: true,
      tradesExecuted: 0,
      netTrades: {},
      orders: [],
      attributions: {},
      pnl: {},
    }
  }

  // Log net trades
  for (const [ticker, netChange] of Object.entries(netTrades)) {
    const action = netChange > 0 ? 'BUY' : 'SELL'
    const absChange = Math.abs(netChange)
    console.log(`[EXECUTION]     ${action} ${absChange.toFixed(4)} ${ticker}`)
  }

  // ============================================
  // STEP 5: Execute Net Trades (Simulate mode check)
  // ============================================
  if (options.mode === 'simulate') {
    console.log(`[EXECUTION] - SIMULATION MODE: Skipping actual trade execution`)
    return {
      success: true,
      tradesExecuted: netTradesCount,
      netTrades,
      orders: [],
      attributions: {},
      pnl: {},
    }
  }

  console.log(`[EXECUTION] - Executing net trades via Alpaca...`)

  const orders = []
  let successfulTrades = 0
  let failedTrades = 0

  // STEP 5a: Execute SELLS first (to free up capital)
  console.log(`[EXECUTION]   Executing sells...`)
  const sells = Object.entries(netTrades).filter(([_, change]) => change < 0)

  for (const [ticker, netChange] of sells) {
    const sharesToSell = Math.abs(netChange)
    try {
      console.log(`[EXECUTION]     Selling ${sharesToSell.toFixed(4)} ${ticker}`)
      const order = await submitMarketSell(alpacaClient, ticker, sharesToSell)
      orders.push({ ...order, netChange })
      successfulTrades++
      console.log(`[EXECUTION]     ✓ Sell order submitted: ${order.id}`)
    } catch (error) {
      console.error(`[EXECUTION]     ✗ Sell order failed for ${ticker}:`, error.message)
      orders.push({ ticker, side: 'sell', qty: sharesToSell, status: 'failed', error: error.message })
      failedTrades++
    }
  }

  // STEP 5b: Execute BUYS (notional orders for fractional share support)
  console.log(`[EXECUTION]   Executing buys...`)
  const buys = Object.entries(netTrades).filter(([_, change]) => change > 0)

  for (const [ticker, netChange] of buys) {
    const sharesToBuy = netChange
    const price = priceMap.get(ticker)

    if (!price || price <= 0) {
      console.warn(`[EXECUTION]     ✗ No price for ${ticker}, skipping buy`)
      orders.push({ ticker, side: 'buy', notional: 0, status: 'failed', error: 'No price available' })
      failedTrades++
      continue
    }

    const notionalAmount = sharesToBuy * price

    try {
      console.log(`[EXECUTION]     Buying $${notionalAmount.toFixed(2)} of ${ticker} (~${sharesToBuy.toFixed(4)} shares @ $${price.toFixed(2)})`)
      const order = await submitNotionalMarketBuy(alpacaClient, ticker, notionalAmount)
      orders.push({ ...order, netChange })
      successfulTrades++
      console.log(`[EXECUTION]     ✓ Buy order submitted: ${order.id}`)
    } catch (error) {
      console.error(`[EXECUTION]     ✗ Buy order failed for ${ticker}:`, error.message)
      orders.push({ ticker, side: 'buy', notional: notionalAmount, status: 'failed', error: error.message })
      failedTrades++
    }
  }

  console.log(`[EXECUTION]   Trade execution complete: ${successfulTrades} succeeded, ${failedTrades} failed`)

  // ============================================
  // STEP 6: Wait for Orders to Fill (TODO: implement polling)
  // ============================================
  // For now, assume orders fill immediately (market orders)
  // In production, poll Alpaca API to confirm fills

  // ============================================
  // STEP 7: Get Actual Filled Positions
  // ============================================
  console.log(`[EXECUTION] - Fetching updated positions...`)

  // Wait a moment for orders to settle
  await new Promise(resolve => setTimeout(resolve, 2000))

  const updatedPositions = await getPositions(alpacaClient)
  const executedPositions = {}

  for (const position of updatedPositions) {
    executedPositions[position.symbol.toUpperCase()] = position.qty
  }

  console.log(`[EXECUTION]   Updated positions: ${Object.keys(executedPositions).length} tickers`)

  // ============================================
  // STEP 8: Attribute Positions to Systems
  // ============================================
  console.log(`[EXECUTION] - Attributing positions to systems...`)

  const attributions = calculateShareAttribution(userId, credentialType, executedPositions, systemAllocations)

  // Update bot_position_ledger with new attributions
  const updateLedger = sqlite.prepare(`
    INSERT INTO bot_position_ledger (user_id, credential_type, bot_id, symbol, shares, avg_price)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, credential_type, bot_id, symbol) DO UPDATE SET
      shares = excluded.shares
  `)

  for (const [botId, tickers] of Object.entries(attributions)) {
    for (const [ticker, shares] of Object.entries(tickers)) {
      const price = priceMap.get(ticker) || 0
      updateLedger.run(userId, credentialType, botId, ticker, shares, price)
    }
  }

  console.log(`[EXECUTION]   Attributed positions to ${Object.keys(attributions).length} systems`)

  // ============================================
  // STEP 9: Calculate P&L Per System
  // ============================================
  console.log(`[EXECUTION] - Calculating P&L per system...`)

  const pnl = calculateUnrealizedPnL(userId, credentialType, priceMap)

  console.log(`[EXECUTION]   P&L calculated for ${Object.keys(pnl).length} systems`)
  for (const [botId, systemPnl] of Object.entries(pnl)) {
    console.log(`[EXECUTION]     ${botId}: $${systemPnl.totalUnrealizedPnl.toFixed(2)} (${systemPnl.totalUnrealizedPnlPct.toFixed(2)}%)`)
  }

  console.log(`[EXECUTION] ✓ Execution complete for user ${userId}`)

  return {
    success: true,
    tradesExecuted: successfulTrades,
    netTrades,
    orders,
    attributions,
    pnl,
  }
}
