/**
 * Trading Scheduler
 *
 * Executes trades at a configurable time before market close.
 * Runs for all users with trading enabled, separately for paper and live modes.
 *
 * Reference: Master.py from C:\Users\Trader\Desktop\Alpaca Trading\Master Script
 */

import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'
import { createAlpacaClient, getAccountInfo, getPositions, getMarketCalendar, submitMarketSell } from './broker-alpaca.mjs'
import { executeDryRun, executeLiveTrades } from './trade-executor.mjs'
import { computeFinalAllocations } from './backtest-allocator.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Constants
const DEFAULT_MINUTES_BEFORE_CLOSE = 10
const NYSE_CLOSE_HOUR = 16  // 4:00 PM Eastern (fallback)
const NYSE_CLOSE_MINUTE = 0
const MARKET_HOURS_CHECK_TIME = 4  // 4 AM Eastern - when to refresh market hours daily

// State
let schedulerInterval = null
let marketHoursCheckInterval = null
let lastExecutionDate = null
let isExecuting = false
let currentExecution = null
let db = null
let cachedMarketHours = null  // Stores today's market open/close times
let lastMarketHoursCheck = null

// Encryption (same as in live.mjs)
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
 * Check if today is a trading day (weekday)
 * In production, this should check NYSE holiday calendar
 */
function isTradingDay() {
  const now = new Date()
  const dayFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
  })
  const dayOfWeek = dayFormatter.format(now)
  return !['Sat', 'Sun'].includes(dayOfWeek)
}

/**
 * Get current time in Eastern timezone
 */
function getEasternTime() {
  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const timeStr = formatter.format(now)
  const [hour, minute] = timeStr.split(':').map(Number)
  return { hour, minute }
}

/**
 * Get current date in Eastern timezone
 */
function getEasternDate() {
  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return formatter.format(now)
}

/**
 * Get current date in ISO format (YYYY-MM-DD) in Eastern timezone
 */
function getEasternDateISO() {
  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = formatter.formatToParts(now)
  const year = parts.find(p => p.type === 'year').value
  const month = parts.find(p => p.type === 'month').value
  const day = parts.find(p => p.type === 'day').value
  return `${year}-${month}-${day}`
}

/**
 * Fetch and cache today's market hours from Alpaca calendar API
 * Returns market open/close times or null if market is closed
 */
async function fetchMarketHours() {
  try {
    const today = getEasternDateISO()
    console.log(`[trading-scheduler] Fetching market calendar for ${today}`)

    // Get any user's paper credentials to make the API call
    const users = getUsersWithTradingEnabled()
    if (users.length === 0) {
      console.warn('[trading-scheduler] No enabled users found for calendar check')
      return null
    }

    const userId = users[0].user_id
    const credentials = getDecryptedCredentials(userId, 'paper')
    if (!credentials) {
      console.warn('[trading-scheduler] No credentials available for calendar check')
      return null
    }

    const client = createAlpacaClient(credentials)
    const calendar = await getMarketCalendar(client, today, today)

    if (!calendar || calendar.length === 0) {
      console.log(`[trading-scheduler] Market is CLOSED on ${today}`)
      cachedMarketHours = null
      lastMarketHoursCheck = today
      return null
    }

    const marketDay = calendar[0]
    const [closeHour, closeMinute] = marketDay.close.split(':').map(Number)

    cachedMarketHours = {
      date: today,
      open: marketDay.open,
      close: marketDay.close,
      closeHour,
      closeMinute,
      isEarlyClose: closeHour < 16,  // Market normally closes at 4:00 PM
    }

    lastMarketHoursCheck = today
    console.log(`[trading-scheduler] Market hours for ${today}:`, {
      open: cachedMarketHours.open,
      close: cachedMarketHours.close,
      isEarlyClose: cachedMarketHours.isEarlyClose,
    })

    return cachedMarketHours
  } catch (error) {
    console.error('[trading-scheduler] Error fetching market calendar:', error)
    // Fall back to default hours on error
    return {
      date: getEasternDateISO(),
      close: '16:00',
      closeHour: NYSE_CLOSE_HOUR,
      closeMinute: NYSE_CLOSE_MINUTE,
      isEarlyClose: false,
      error: error.message,
    }
  }
}

/**
 * Get market close time for today
 * Uses cached value if available and current, otherwise fetches from API
 */
async function getMarketCloseTime() {
  const today = getEasternDateISO()

  // Return cached hours if already fetched today
  if (cachedMarketHours && cachedMarketHours.date === today) {
    return cachedMarketHours
  }

  // Fetch new market hours
  return await fetchMarketHours()
}

/**
 * Check if it's time to execute trades
 * Triggers X minutes before market close (default: 10 minutes = 3:50 PM ET)
 * Now checks actual market hours from Alpaca calendar API
 */
async function isTimeToExecute(minutesBeforeClose = DEFAULT_MINUTES_BEFORE_CLOSE) {
  // Get actual market hours for today
  const marketHours = await getMarketCloseTime()

  // If market is closed today (holiday), don't execute
  if (!marketHours) {
    return false
  }

  const { hour, minute } = getEasternTime()
  const currentDate = getEasternDate()

  // Calculate execution time using actual market close time
  let execHour = marketHours.closeHour
  let execMinute = marketHours.closeMinute - minutesBeforeClose

  // Handle minute underflow
  if (execMinute < 0) {
    execMinute += 60
    execHour -= 1
  }

  // Check if current time matches (within 1 minute window)
  const isRightTime = hour === execHour && minute === execMinute
  const alreadyRanToday = lastExecutionDate === currentDate

  if (isRightTime && !alreadyRanToday && !isExecuting) {
    console.log(`[trading-scheduler] Execution time reached: ${hour}:${String(minute).padStart(2, '0')} ET (${minutesBeforeClose} min before ${marketHours.close})`)
    if (marketHours.isEarlyClose) {
      console.log(`[trading-scheduler] ⚠️  Early close day detected - market closes at ${marketHours.close}`)
    }
  }

  return isRightTime && !alreadyRanToday && !isExecuting
}

/**
 * Get decrypted credentials for a user
 */
function getDecryptedCredentials(userId, credentialType) {
  const row = db.prepare(`
    SELECT encrypted_api_key, encrypted_api_secret, iv, auth_tag, base_url
    FROM broker_credentials
    WHERE user_id = ? AND credential_type = ?
  `).get(userId, credentialType)

  if (!row) return null

  try {
    return {
      apiKey: decrypt(row.encrypted_api_key, row.iv, row.auth_tag),
      apiSecret: decrypt(row.encrypted_api_secret, row.iv, row.auth_tag),
      baseUrl: row.base_url || (credentialType === 'live'
        ? 'https://api.alpaca.markets'
        : 'https://paper-api.alpaca.markets'),
    }
  } catch (error) {
    console.error(`[trading-scheduler] Error decrypting credentials for user ${userId}:`, error)
    return null
  }
}

/**
 * Get users with trading enabled
 */
function getUsersWithTradingEnabled() {
  return db.prepare(`
    SELECT user_id, minutes_before_close, order_type, limit_percent,
           max_allocation_percent, fallback_ticker, cash_reserve_mode,
           cash_reserve_amount, paired_tickers, market_hours_check_hour
    FROM trading_settings
    WHERE enabled = 1
  `).all()
}

/**
 * Execute trades for a single user/mode combination
 */
async function executeForUser(userId, credentialType, settings) {
  console.log(`[DEBUG] ═══════════════════════════════════════════════════════════`)
  console.log(`[DEBUG] EXECUTING FOR USER: ${userId} (${credentialType})`)
  console.log(`[trading-scheduler] Executing ${credentialType} trades for user ${userId}`)

  console.log(`[DEBUG] → Loading credentials...`)
  const credentials = getDecryptedCredentials(userId, credentialType)
  if (!credentials) {
    console.log(`[DEBUG] ✗ No credentials found for ${credentialType}`)
    console.warn(`[trading-scheduler] No ${credentialType} credentials for user ${userId}`)
    return { success: false, error: 'No credentials' }
  }
  console.log(`[DEBUG] ✓ Credentials loaded successfully`)

  // Get investments
  console.log(`[DEBUG] → Loading bot investments...`)
  const investmentRows = db.prepare(`
    SELECT i.*, b.name as bot_name, b.payload as bot_payload
    FROM user_bot_investments i
    LEFT JOIN bots b ON i.bot_id = b.id
    WHERE i.user_id = ? AND i.credential_type = ?
  `).all(userId, credentialType)

  console.log(`[DEBUG] → Found ${investmentRows.length} bot investments`)

  if (investmentRows.length === 0) {
    console.log(`[DEBUG] No investments found - skipping execution`)
    console.log(`[trading-scheduler] No ${credentialType} investments for user ${userId}`)
    return { success: true, message: 'No investments' }
  }

  // Log each investment
  for (const row of investmentRows) {
    console.log(`[DEBUG]   Bot: ${row.bot_name || row.bot_id} - $${row.investment_amount} (${row.weight_mode})`)
  }

  // Build investments with bot objects
  const investments = investmentRows.map(row => ({
    botId: row.bot_id,
    investmentAmount: row.investment_amount,
    weightMode: row.weight_mode,
    bot: row.bot_payload ? {
      id: row.bot_id,
      name: row.bot_name,
      payload: JSON.parse(row.bot_payload),
    } : null,
  }))

  // Parse paired tickers
  let pairedTickers = []
  if (settings.paired_tickers) {
    try {
      pairedTickers = JSON.parse(settings.paired_tickers)
    } catch (e) {
      pairedTickers = []
    }
  }

  try {
    // Get account info
    console.log(`[DEBUG] → Connecting to Alpaca and fetching account info...`)
    const client = createAlpacaClient(credentials)
    const account = await getAccountInfo(client)
    const totalEquity = account.equity

    console.log(`[DEBUG] → Account equity: $${totalEquity.toFixed(2)}`)
    console.log(`[DEBUG] → Account cash: $${account.cash.toFixed(2)}`)

    // Calculate cash reserve
    let reservedCash = 0
    if (settings.cash_reserve_amount) {
      if (settings.cash_reserve_mode === 'percent') {
        reservedCash = totalEquity * (settings.cash_reserve_amount / 100)
      } else {
        reservedCash = settings.cash_reserve_amount
      }
    }
    const adjustedEquity = Math.max(0, totalEquity - reservedCash)

    console.log(`[DEBUG] → Reserved cash: $${reservedCash.toFixed(2)}`)
    console.log(`[DEBUG] → Adjusted equity (for trading): $${adjustedEquity.toFixed(2)}`)

    // Compute allocations
    console.log(`[DEBUG] ─────────────────────────────────────────────────────────────`)
    console.log(`[DEBUG] → Computing allocations from backtests...`)
    const allocations = await computeFinalAllocations(
      investments,
      adjustedEquity,
      {
        fallbackTicker: settings.fallback_ticker || 'SGOV',
        pairedTickers,
        maxAllocationPercent: settings.max_allocation_percent || 99.0,
      }
    )

    console.log(`[DEBUG] → Target allocations:`)
    for (const [ticker, pct] of Object.entries(allocations)) {
      console.log(`[DEBUG]   ${ticker}: ${pct.toFixed(2)}%`)
    }

    // Fetch bot's current ledger positions for sell calculations
    // This isolates bot positions from unallocated Alpaca positions
    console.log(`[DEBUG] ─────────────────────────────────────────────────────────────`)
    console.log(`[DEBUG] → Fetching bot ledger positions...`)
    const botId = investments[0].botId
    const ledgerPositions = db.prepare(`
      SELECT symbol, shares, avg_price as avgPrice
      FROM bot_position_ledger
      WHERE user_id = ? AND credential_type = ? AND bot_id = ?
        AND shares > 0.0001
    `).all(userId, credentialType, botId)

    console.log(`[DEBUG] → Found ${ledgerPositions.length} positions in bot ledger`)

    // Get current prices from Alpaca for market value calculations
    const alpacaPositions = await getPositions(client)
    const priceMap = {}
    for (const pos of alpacaPositions) {
      priceMap[pos.symbol] = parseFloat(pos.currentPrice)
    }

    // Enrich ledger positions with current market data
    const botPositions = ledgerPositions.map(pos => ({
      symbol: pos.symbol,
      qty: pos.shares,
      avgEntryPrice: pos.avgPrice,
      currentPrice: priceMap[pos.symbol] || pos.avgPrice,
      marketValue: pos.shares * (priceMap[pos.symbol] || pos.avgPrice)
    }))

    for (const pos of botPositions) {
      console.log(`[DEBUG]   Bot position: ${pos.symbol} - ${pos.qty} shares @ $${pos.currentPrice.toFixed(2)} ($${pos.marketValue.toFixed(2)})`)
    }

    // Calculate total invested for this execution
    const totalInvested = investments.reduce((sum, inv) => sum + inv.investmentAmount, 0)
    console.log(`[DEBUG] → Total invested: $${totalInvested.toFixed(2)}`)

    // Execute live trades
    console.log(`[DEBUG] ─────────────────────────────────────────────────────────────`)
    console.log(`[DEBUG] → Executing live trades...`)
    const result = await executeLiveTrades(credentials, allocations, {
      investmentAmount: totalInvested,  // Use bot investment amount
      botPositions,  // Pass bot's ledger positions for sell calculations
      cashReserve: reservedCash,
      cashMode: 'dollars',
      orderType: settings.order_type || 'limit',
      limitPercent: settings.limit_percent || 1.0,
    })

    const executionDate = new Date().toISOString().split('T')[0]

    // Log the execution
    console.log(`[DEBUG] → Logging execution to database...`)
    const execResult = db.prepare(`
      INSERT INTO trade_executions (user_id, credential_type, execution_date, status, target_allocations, executed_orders, errors)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      credentialType,
      executionDate,
      result.summary?.errorCount > 0 ? 'partial' : 'success',
      JSON.stringify(allocations),
      JSON.stringify([...(result.sells || []), ...(result.buys || [])]),
      JSON.stringify(result.errors || [])
    )

    // Log individual orders
    const executionId = execResult.lastInsertRowid
    for (const order of [...(result.sells || []), ...(result.buys || [])]) {
      db.prepare(`
        INSERT INTO trade_orders (execution_id, side, symbol, qty, price, order_type, status, alpaca_order_id, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        executionId,
        order.side,
        order.symbol,
        order.qty || 0,
        order.limitPrice || order.price || null,
        order.type || settings.order_type || 'limit',
        order.success ? 'filled' : 'failed',
        order.id || null,
        order.error || null
      )
    }

    // Update bot position ledger after successful execution
    console.log(`[DEBUG] ─────────────────────────────────────────────────────────────`)
    console.log(`[DEBUG] UPDATING BOT POSITION LEDGER`)
    try {
      const client = createAlpacaClient(credentials)

      // Process BUY orders - ADD to ledger
      if (result.buys && Array.isArray(result.buys)) {
        for (const buy of result.buys) {
          if (!buy.success || !buy.id) continue

          try {
            // Fetch actual fill details from Alpaca
            const order = await client.getOrder(buy.id)

            if (order.status === 'filled') {
              const filledShares = parseFloat(order.filled_qty)
              const avgFillPrice = parseFloat(order.filled_avg_price)
              const botId = investments[0].botId  // First bot for now

              console.log(`[DEBUG] → ADD: bot=${botId}, symbol=${buy.symbol}, shares=${filledShares.toFixed(4)}, price=$${avgFillPrice.toFixed(2)}`)

              // Insert or update ledger entry
              db.prepare(`
                INSERT INTO bot_position_ledger
                  (user_id, credential_type, bot_id, symbol, shares, avg_price, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, unixepoch())
                ON CONFLICT(user_id, credential_type, bot_id, symbol) DO UPDATE SET
                  shares = shares + excluded.shares,
                  avg_price = ((bot_position_ledger.shares * bot_position_ledger.avg_price) + (excluded.shares * excluded.avg_price)) / (bot_position_ledger.shares + excluded.shares),
                  updated_at = unixepoch()
              `).run(userId, credentialType, botId, buy.symbol, filledShares, avgFillPrice)

              console.log(`[DEBUG]   ✓ Ledger updated for BUY ${buy.symbol}`)
            }
          } catch (err) {
            console.warn(`[DEBUG]   ✗ Failed to update ledger for buy ${buy.symbol}: ${err.message}`)
          }
        }
      }

      // Process SELL orders - SUBTRACT from ledger
      if (result.sells && Array.isArray(result.sells)) {
        for (const sell of result.sells) {
          if (!sell.success || !sell.id) continue

          try {
            const order = await client.getOrder(sell.id)

            if (order.status === 'filled') {
              const filledShares = parseFloat(order.filled_qty)
              const botId = investments[0].botId  // First bot for now

              console.log(`[DEBUG] → SUBTRACT: bot=${botId}, symbol=${sell.symbol}, shares=${filledShares.toFixed(4)}`)

              // Subtract shares from ledger
              db.prepare(`
                UPDATE bot_position_ledger
                SET shares = shares - ?,
                    updated_at = unixepoch()
                WHERE user_id = ? AND credential_type = ? AND bot_id = ? AND symbol = ?
              `).run(filledShares, userId, credentialType, botId, sell.symbol)

              // Clean up zero-share positions
              db.prepare(`
                DELETE FROM bot_position_ledger
                WHERE user_id = ? AND credential_type = ? AND bot_id = ? AND symbol = ?
                  AND shares < 0.0001
              `).run(userId, credentialType, botId, sell.symbol)

              console.log(`[DEBUG]   ✓ Ledger updated for SELL ${sell.symbol}`)
            }
          } catch (err) {
            console.warn(`[DEBUG]   ✗ Failed to update ledger for sell ${sell.symbol}: ${err.message}`)
          }
        }
      }

      // Show final ledger state
      const botPositions = db.prepare(`
        SELECT bot_id, symbol, shares, avg_price
        FROM bot_position_ledger
        WHERE user_id = ? AND credential_type = ? AND bot_id = ?
        ORDER BY symbol ASC
      `).all(userId, credentialType, investments[0].botId)

      console.log(`[DEBUG] → Final ledger state: ${botPositions.length} positions`)
      for (const pos of botPositions) {
        console.log(`[DEBUG]   ${pos.symbol}: ${pos.shares.toFixed(4)} shares @ $${pos.avg_price.toFixed(2)}`)
      }
    } catch (ledgerErr) {
      console.error(`[DEBUG] ✗ Ledger update failed: ${ledgerErr.message}`)
      // Don't fail the execution if ledger update fails - just log it
    }

    console.log(`[DEBUG] ✓ Execution complete for ${userId} (${credentialType})`)
    console.log(`[DEBUG] Summary: ${result.summary?.sellCount || 0} sells, ${result.summary?.buyCount || 0} buys, ${result.summary?.errorCount || 0} errors`)
    console.log(`[trading-scheduler] Completed ${credentialType} execution for user ${userId}:`, result.summary)

    return {
      success: true,
      mode: credentialType,
      equity: totalEquity,
      allocations,
      result,
    }
  } catch (error) {
    console.log(`[DEBUG] ✗ EXECUTION FAILED: ${error.message}`)
    console.error(`[trading-scheduler] Error executing for user ${userId}:`, error)

    // Log failed execution
    const executionDate = new Date().toISOString().split('T')[0]
    db.prepare(`
      INSERT INTO trade_executions (user_id, credential_type, execution_date, status, errors)
      VALUES (?, ?, ?, 'failed', ?)
    `).run(userId, credentialType, executionDate, JSON.stringify([error.message]))

    return { success: false, error: error.message }
  }
}

/**
 * Process pending manual sell orders for a user
 * These are sells scheduled via the Dashboard for unallocated positions
 */
async function processPendingManualSells(userId, credentialType, credentials) {
  console.log(`[DEBUG] ═══════════════════════════════════════════════════════════`)
  console.log(`[DEBUG] PROCESSING PENDING MANUAL SELLS`)
  console.log(`[DEBUG] User: ${userId}, Mode: ${credentialType}`)

  const pendingSells = db.prepare(`
    SELECT id, symbol, qty
    FROM pending_manual_sells
    WHERE user_id = ? AND credential_type = ? AND status = 'pending'
  `).all(userId, credentialType)

  console.log(`[DEBUG] Found ${pendingSells.length} pending sells to process`)

  if (pendingSells.length === 0) {
    console.log(`[DEBUG] No pending sells - skipping`)
    return { processed: 0, succeeded: 0, failed: 0 }
  }

  console.log(`[trading-scheduler] Processing ${pendingSells.length} pending manual sells for user ${userId} (${credentialType})`)

  const client = createAlpacaClient(credentials)
  let succeeded = 0
  let failed = 0

  for (const sell of pendingSells) {
    console.log(`[DEBUG] → Executing sell: ${sell.symbol} x ${sell.qty} shares`)
    try {
      await submitMarketSell(client, sell.symbol, sell.qty)

      // Mark as executed
      db.prepare(`
        UPDATE pending_manual_sells
        SET status = 'executed', executed_at = unixepoch()
        WHERE id = ?
      `).run(sell.id)

      console.log(`[DEBUG] ✓ Sell executed successfully: ${sell.symbol}`)
      console.log(`[trading-scheduler] Executed pending sell: ${sell.symbol} x ${sell.qty}`)
      succeeded++
    } catch (error) {
      console.log(`[DEBUG] ✗ Sell FAILED: ${sell.symbol} - ${error.message}`)
      console.error(`[trading-scheduler] Failed pending sell ${sell.symbol}:`, error)

      // Mark as failed with error message
      db.prepare(`
        UPDATE pending_manual_sells
        SET status = 'failed', executed_at = unixepoch(), error_message = ?
        WHERE id = ?
      `).run(error.message || 'Unknown error', sell.id)

      failed++
    }
  }

  console.log(`[DEBUG] Pending manual sells complete: ${succeeded}/${pendingSells.length} succeeded, ${failed} failed`)
  return { processed: pendingSells.length, succeeded, failed }
}

/**
 * Run scheduled trade execution for all enabled users
 */
async function runScheduledExecution() {
  if (isExecuting) {
    console.log('[trading-scheduler] Execution already in progress, skipping')
    return
  }

  isExecuting = true
  currentExecution = {
    startedAt: Date.now(),
    users: [],
    status: 'running',
  }

  console.log(`[DEBUG] ═══════════════════════════════════════════════════════════`)
  console.log(`[DEBUG] ═══════════════════════════════════════════════════════════`)
  console.log(`[DEBUG] STARTING SCHEDULED TRADE EXECUTION`)
  console.log(`[DEBUG] Time: ${new Date().toISOString()}`)
  console.log(`[DEBUG] ═══════════════════════════════════════════════════════════`)
  console.log('[trading-scheduler] Starting scheduled trade execution...')

  try {
    const users = getUsersWithTradingEnabled()
    console.log(`[DEBUG] Users with trading enabled: ${users.length}`)
    console.log(`[trading-scheduler] Found ${users.length} users with trading enabled`)

    for (const userSettings of users) {
      const userId = userSettings.user_id
      currentExecution.currentUser = userId

      console.log(`[DEBUG] ═══════════════════════════════════════════════════════════`)
      console.log(`[DEBUG] Processing user: ${userId}`)

      // Execute paper trades if credentials exist
      const paperCreds = getDecryptedCredentials(userId, 'paper')
      if (paperCreds) {
        console.log(`[DEBUG] → Paper credentials found`)

        // Process pending manual sells first (before rebalancing)
        const paperManualSells = await processPendingManualSells(userId, 'paper', paperCreds)
        if (paperManualSells.processed > 0) {
          console.log(`[trading-scheduler] Paper manual sells: ${paperManualSells.succeeded}/${paperManualSells.processed} succeeded`)
        }

        const paperResult = await executeForUser(userId, 'paper', userSettings)
        currentExecution.users.push({
          userId,
          mode: 'paper',
          manualSells: paperManualSells,
          ...paperResult,
        })
      } else {
        console.log(`[DEBUG] → No paper credentials`)
      }

      // Execute live trades if credentials exist
      const liveCreds = getDecryptedCredentials(userId, 'live')
      if (liveCreds) {
        console.log(`[DEBUG] → Live credentials found`)

        // Process pending manual sells first (before rebalancing)
        const liveManualSells = await processPendingManualSells(userId, 'live', liveCreds)
        if (liveManualSells.processed > 0) {
          console.log(`[trading-scheduler] Live manual sells: ${liveManualSells.succeeded}/${liveManualSells.processed} succeeded`)
        }

        const liveResult = await executeForUser(userId, 'live', userSettings)
        currentExecution.users.push({
          userId,
          mode: 'live',
          manualSells: liveManualSells,
          ...liveResult,
        })
      } else {
        console.log(`[DEBUG] → No live credentials`)
      }
    }

    currentExecution.status = 'completed'
    currentExecution.completedAt = Date.now()
    currentExecution.duration = currentExecution.completedAt - currentExecution.startedAt

    console.log(`[DEBUG] ═══════════════════════════════════════════════════════════`)
    console.log(`[DEBUG] EXECUTION COMPLETE`)
    console.log(`[DEBUG] Duration: ${currentExecution.duration}ms`)
    console.log(`[DEBUG] Users processed: ${currentExecution.users.length}`)
    console.log(`[DEBUG] ═══════════════════════════════════════════════════════════`)
    console.log(`[trading-scheduler] Completed scheduled execution in ${currentExecution.duration}ms`)

    // Update last execution date
    lastExecutionDate = getEasternDate()

  } catch (error) {
    console.log(`[DEBUG] ✗ SCHEDULED EXECUTION FAILED: ${error.message}`)
    console.error('[trading-scheduler] Error in scheduled execution:', error)
    currentExecution.status = 'failed'
    currentExecution.error = error.message
  } finally {
    isExecuting = false
  }
}

/**
 * Start the trading scheduler
 * @param {Object} options - { dbPath: string }
 */
export function startTradingScheduler(options = {}) {
  let dbPath
  if (options.dbPath) {
    dbPath = options.dbPath
  } else if (process.env.ATLAS_DB_PATH) {
    dbPath = path.join(path.dirname(process.env.ATLAS_DB_PATH), 'atlas.db')
  } else {
    dbPath = path.join(__dirname, '../data/atlas.db')
  }

  db = new Database(dbPath)

  console.log('[trading-scheduler] Starting trading scheduler...')

  // Fetch initial market hours on startup
  fetchMarketHours().catch(err => {
    console.error('[trading-scheduler] Failed to fetch initial market hours:', err)
  })

  // Check every minute for trade execution and market hours refresh
  schedulerInterval = setInterval(async () => {
    try {
      // Get the minimum minutes_before_close from all enabled users
      // (or use default if none set)
      const users = getUsersWithTradingEnabled()
      if (users.length === 0) return

      // Use the first enabled user's setting (could be improved to run each at their own time)
      const minutesBeforeClose = users[0]?.minutes_before_close || DEFAULT_MINUTES_BEFORE_CLOSE

      if (await isTimeToExecute(minutesBeforeClose)) {
        console.log('[trading-scheduler] Scheduled execution time reached')
        await runScheduledExecution()
      }
    } catch (error) {
      console.error('[trading-scheduler] Error in scheduler loop:', error)
    }
  }, 60 * 1000)  // Check every minute

  // Separate interval for daily market hours refresh at configured time (default 4 AM ET)
  marketHoursCheckInterval = setInterval(async () => {
    try {
      const { hour } = getEasternTime()
      const today = getEasternDateISO()

      // Get configured check time from first enabled user's settings (or use default)
      const users = getUsersWithTradingEnabled()
      const checkHour = users.length > 0 && users[0].market_hours_check_hour != null
        ? users[0].market_hours_check_hour
        : MARKET_HOURS_CHECK_TIME

      // Refresh at configured hour if not already done today
      if (hour === checkHour && lastMarketHoursCheck !== today) {
        console.log(`[trading-scheduler] ${checkHour}:00 ET check: Refreshing market hours for the day`)
        await fetchMarketHours()
      }
    } catch (error) {
      console.error('[trading-scheduler] Error in market hours check:', error)
    }
  }, 60 * 1000)  // Check every minute

  console.log('[trading-scheduler] Trading scheduler started')
}

/**
 * Stop the trading scheduler
 */
export function stopTradingScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval)
    schedulerInterval = null
    console.log('[trading-scheduler] Trading scheduler stopped')
  }

  if (marketHoursCheckInterval) {
    clearInterval(marketHoursCheckInterval)
    marketHoursCheckInterval = null
    console.log('[trading-scheduler] Market hours check interval stopped')
  }

  if (db) {
    db.close()
    db = null
  }
}

/**
 * Get trading scheduler status
 */
export function getTradingSchedulerStatus() {
  const users = db ? getUsersWithTradingEnabled() : []
  const minutesBeforeClose = users[0]?.minutes_before_close || DEFAULT_MINUTES_BEFORE_CLOSE

  // Use cached market hours if available
  let execHour = cachedMarketHours?.closeHour || NYSE_CLOSE_HOUR
  let execMinute = (cachedMarketHours?.closeMinute || NYSE_CLOSE_MINUTE) - minutesBeforeClose

  // Handle minute underflow
  if (execMinute < 0) {
    execMinute += 60
    execHour -= 1
  }

  return {
    isRunning: isExecuting,
    currentExecution,
    lastExecutionDate,
    schedulerActive: schedulerInterval !== null,
    enabledUserCount: users.length,
    nextExecutionTime: `${String(execHour).padStart(2, '0')}:${String(execMinute).padStart(2, '0')} ET`,
    isTradingDay: cachedMarketHours !== null ? true : isTradingDay(),  // Fall back to weekday check if market hours not cached yet
    marketClose: cachedMarketHours?.close,
    isEarlyClose: cachedMarketHours?.isEarlyClose,
  }
}

/**
 * Trigger manual execution (for testing or forced runs)
 */
export async function triggerManualExecution() {
  if (isExecuting) {
    return { success: false, error: 'Execution already in progress' }
  }

  // Reset last execution date to allow running
  lastExecutionDate = null

  await runScheduledExecution()

  return { success: true, message: 'Manual execution completed', result: currentExecution }
}

/**
 * Set database instance (for sharing with live.mjs)
 */
export function setDatabase(database) {
  db = database
}
