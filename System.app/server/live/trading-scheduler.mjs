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
  console.log(`[trading-scheduler] Executing ${credentialType} trades for user ${userId}`)

  const credentials = getDecryptedCredentials(userId, credentialType)
  if (!credentials) {
    console.warn(`[trading-scheduler] No ${credentialType} credentials for user ${userId}`)
    return { success: false, error: 'No credentials' }
  }

  // Get investments
  const investmentRows = db.prepare(`
    SELECT i.*, b.name as bot_name, b.payload as bot_payload
    FROM user_bot_investments i
    LEFT JOIN bots b ON i.bot_id = b.id
    WHERE i.user_id = ? AND i.credential_type = ?
  `).all(userId, credentialType)

  if (investmentRows.length === 0) {
    console.log(`[trading-scheduler] No ${credentialType} investments for user ${userId}`)
    return { success: true, message: 'No investments' }
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
    const client = createAlpacaClient(credentials)
    const account = await getAccountInfo(client)
    const totalEquity = account.equity

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

    // Compute allocations from backtests
    const allocations = await computeFinalAllocations(
      investments,
      adjustedEquity,
      {
        fallbackTicker: settings.fallback_ticker || 'SGOV',
        pairedTickers,
        maxAllocationPercent: settings.max_allocation_percent || 99.0,
      }
    )

    // Fetch bot's current ledger positions for sell calculations
    // This isolates bot positions from unallocated Alpaca positions
    const botId = investments[0].botId
    const ledgerPositions = db.prepare(`
      SELECT symbol, shares, avg_price as avgPrice
      FROM bot_position_ledger
      WHERE user_id = ? AND credential_type = ? AND bot_id = ?
        AND shares > 0.0001
    `).all(userId, credentialType, botId)

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

    // DEBUG: Calculate total Alpaca positions and identify unallocated positions
    const totalAlpacaValue = alpacaPositions.reduce((sum, p) => sum + parseFloat(p.marketValue), 0)
    const botLedgerSymbols = new Set(ledgerPositions.map(p => p.symbol))
    const unallocatedPositions = alpacaPositions.filter(p => !botLedgerSymbols.has(p.symbol))
    const unallocatedValue = unallocatedPositions.reduce((sum, p) => sum + parseFloat(p.marketValue), 0)
    const botLedgerValue = botPositions.reduce((sum, p) => sum + p.marketValue, 0)

    // Calculate total invested for this execution
    const totalInvested = investments.reduce((sum, inv) => sum + inv.investmentAmount, 0)

    // Print clear trade summary with complete state
    const botName = investments[0].bot?.name || investments[0].botId
    console.log(`\n[TRADE] ════════════════════════════════════════════════════════════════`)
    console.log(`[TRADE] INITIAL STATE - START OF TRADING CYCLE`)
    console.log(`[TRADE] ════════════════════════════════════════════════════════════════`)
    console.log(`[TRADE] BOT: ${botName}`)
    console.log(`[TRADE] Mode: ${credentialType}`)
    console.log(`[TRADE] ────────────────────────────────────────────────────────────────`)
    console.log(`[TRADE] ACCOUNT SUMMARY:`)
    console.log(`[TRADE]   Total Equity: $${totalEquity.toFixed(2)}`)
    console.log(`[TRADE]   Reserved Cash: $${reservedCash.toFixed(2)}`)
    console.log(`[TRADE]   Adjusted Equity: $${adjustedEquity.toFixed(2)}`)
    console.log(`[TRADE]   Bot Investment Amount: $${totalInvested.toFixed(2)}`)
    console.log(`[TRADE] ────────────────────────────────────────────────────────────────`)
    console.log(`[TRADE] ALL ALPACA POSITIONS:`)
    console.log(`[TRADE]   Total Positions: ${alpacaPositions.length}`)
    console.log(`[TRADE]   Total Market Value: $${totalAlpacaValue.toFixed(2)}`)
    if (alpacaPositions.length === 0) {
      console.log(`[TRADE]   (none)`)
    } else {
      for (const pos of alpacaPositions) {
        const allocated = botLedgerSymbols.has(pos.symbol) ? '✓ ALLOCATED TO BOT' : '✗ UNALLOCATED'
        console.log(`[TRADE]   ${pos.symbol}: ${parseFloat(pos.qty).toFixed(4)} shares @ $${parseFloat(pos.currentPrice).toFixed(2)} = $${parseFloat(pos.marketValue).toFixed(2)} ${allocated}`)
      }
    }
    console.log(`[TRADE] ────────────────────────────────────────────────────────────────`)
    console.log(`[TRADE] BOT LEDGER POSITIONS (${botName}):`)
    console.log(`[TRADE]   Total Value: $${botLedgerValue.toFixed(2)}`)
    if (botPositions.length === 0) {
      console.log(`[TRADE]   (none - this is the first trade)`)
    } else {
      for (const pos of botPositions) {
        console.log(`[TRADE]   ${pos.symbol}: ${pos.qty.toFixed(4)} shares @ $${pos.currentPrice.toFixed(2)} = $${pos.marketValue.toFixed(2)}`)
      }
    }
    console.log(`[TRADE] ────────────────────────────────────────────────────────────────`)
    console.log(`[TRADE] UNALLOCATED POSITIONS (not attributed to any bot):`)
    console.log(`[TRADE]   Count: ${unallocatedPositions.length}`)
    console.log(`[TRADE]   Total Value: $${unallocatedValue.toFixed(2)}`)
    if (unallocatedPositions.length === 0) {
      console.log(`[TRADE]   (none)`)
    } else {
      for (const pos of unallocatedPositions) {
        console.log(`[TRADE]   ${pos.symbol}: ${parseFloat(pos.qty).toFixed(4)} shares @ $${parseFloat(pos.currentPrice).toFixed(2)} = $${parseFloat(pos.marketValue).toFixed(2)}`)
      }
    }
    console.log(`[TRADE] ────────────────────────────────────────────────────────────────`)
    console.log(`[TRADE] TARGET ALLOCATIONS (from backtest):`)
    console.log(`[TRADE]   Based on Investment: $${totalInvested.toFixed(2)}`)
    if (Object.keys(allocations).length === 0) {
      console.log(`[TRADE]   (none - bot returned no positions)`)
    } else {
      let totalTargetValue = 0
      for (const [ticker, pct] of Object.entries(allocations)) {
        const targetValue = totalInvested * (pct / 100)
        totalTargetValue += targetValue
        console.log(`[TRADE]   ${ticker}: ${pct.toFixed(2)}% = $${targetValue.toFixed(2)}`)
      }
      console.log(`[TRADE]   Total Target Value: $${totalTargetValue.toFixed(2)}`)
    }
    console.log(`[TRADE] ────────────────────────────────────────────────────────────────`)
    console.log(`[TRADE] PROJECTED END STATE (after trades execute):`)
    console.log(`[TRADE]   Unallocated positions: Will be SOLD (if scheduled)`)
    console.log(`[TRADE]   Bot current positions: Will be SOLD`)
    console.log(`[TRADE]   Bot target positions: Will be BOUGHT`)
    console.log(`[TRADE]   Expected ${botName} value after trades: $${totalInvested.toFixed(2)}`)
    console.log(`[TRADE] ════════════════════════════════════════════════════════════════\n`)

    // Execute live trades
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
            }
          } catch (err) {
            console.warn(`[ledger] Failed to update ledger for buy ${buy.symbol}: ${err.message}`)
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
            }
          } catch (err) {
            console.warn(`[ledger] Failed to update ledger for sell ${sell.symbol}: ${err.message}`)
          }
        }
      }
    } catch (ledgerErr) {
      console.error(`[ledger] Ledger update failed: ${ledgerErr.message}`)
      // Don't fail the execution if ledger update fails - just log it
    }

    // Print execution summary
    console.log(`[TRADE] EXECUTION COMPLETE: ${result.summary?.sellCount || 0} sells, ${result.summary?.buyCount || 0} buys, ${result.summary?.errorCount || 0} errors`)
    console.log(`[trading-scheduler] Completed ${credentialType} execution for user ${userId}:`, result.summary)

    return {
      success: true,
      mode: credentialType,
      equity: totalEquity,
      allocations,
      result,
    }
  } catch (error) {
    console.error(`[TRADE] EXECUTION FAILED: ${error.message}`)
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
  const pendingSells = db.prepare(`
    SELECT id, symbol, qty
    FROM pending_manual_sells
    WHERE user_id = ? AND credential_type = ? AND status = 'pending'
  `).all(userId, credentialType)

  if (pendingSells.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0 }
  }

  console.log(`\n[TRADE] ════════════════════════════════════════`)
  console.log(`[TRADE] PENDING MANUAL SELLS (${credentialType})`)
  console.log(`[TRADE] ────────────────────────────────────────`)
  for (const sell of pendingSells) {
    console.log(`[TRADE]   SELL ${sell.symbol}: ${sell.qty} shares`)
  }
  console.log(`[TRADE] ════════════════════════════════════════\n`)

  const client = createAlpacaClient(credentials)
  let succeeded = 0
  let failed = 0

  for (const sell of pendingSells) {
    try {
      await submitMarketSell(client, sell.symbol, sell.qty)

      // Mark as executed
      db.prepare(`
        UPDATE pending_manual_sells
        SET status = 'executed', executed_at = unixepoch()
        WHERE id = ?
      `).run(sell.id)

      console.log(`[TRADE] ✓ SELL ${sell.symbol} x ${sell.qty} shares - SUCCESS`)
      succeeded++
    } catch (error) {
      console.log(`[TRADE] ✗ SELL ${sell.symbol} x ${sell.qty} shares - FAILED: ${error.message}`)

      // Mark as failed with error message
      db.prepare(`
        UPDATE pending_manual_sells
        SET status = 'failed', executed_at = unixepoch(), error_message = ?
        WHERE id = ?
      `).run(error.message || 'Unknown error', sell.id)

      failed++
    }
  }

  console.log(`[TRADE] Manual sells: ${succeeded}/${pendingSells.length} succeeded, ${failed} failed`)
  return { processed: pendingSells.length, succeeded, failed }
}

/**
 * Show complete portfolio summary before trading
 * Includes all positions, breakdown by system, and pending trades
 */
async function showPortfolioSummary(userId, credentialType, credentials) {
  try {
    const client = createAlpacaClient(credentials)
    const account = await getAccountInfo(client)
    const alpacaPositions = await getPositions(client)

    // Get all bot investments
    const investmentRows = db.prepare(`
      SELECT i.bot_id, i.investment_amount, b.name as bot_name
      FROM user_bot_investments i
      LEFT JOIN bots b ON i.bot_id = b.id
      WHERE i.user_id = ? AND i.credential_type = ?
    `).all(userId, credentialType)

    // Get all bot ledger positions
    const allLedgerPositions = db.prepare(`
      SELECT bot_id, symbol, shares, avg_price
      FROM bot_position_ledger
      WHERE user_id = ? AND credential_type = ? AND shares > 0.0001
    `).all(userId, credentialType)

    // Get pending manual sells (unallocated sells)
    const pendingSells = db.prepare(`
      SELECT symbol, qty
      FROM pending_manual_sells
      WHERE user_id = ? AND credential_type = ? AND status = 'pending'
    `).all(userId, credentialType)

    // Calculate totals
    const totalEquity = account.equity
    const totalCash = account.cash
    const totalPositionValue = alpacaPositions.reduce((sum, p) => sum + parseFloat(p.marketValue), 0)

    // Build position attribution map
    const ledgerBySymbol = new Map()
    const positionsByBot = new Map()

    for (const pos of allLedgerPositions) {
      if (!ledgerBySymbol.has(pos.symbol)) {
        ledgerBySymbol.set(pos.symbol, [])
      }
      ledgerBySymbol.get(pos.symbol).push(pos)

      if (!positionsByBot.has(pos.bot_id)) {
        positionsByBot.set(pos.bot_id, [])
      }
      positionsByBot.get(pos.bot_id).push(pos)
    }

    // Identify unallocated positions
    const unallocatedPositions = []
    for (const alpacaPos of alpacaPositions) {
      const ledgerEntries = ledgerBySymbol.get(alpacaPos.symbol) || []
      const totalLedgerShares = ledgerEntries.reduce((sum, e) => sum + e.shares, 0)
      const alpacaQty = parseFloat(alpacaPos.qty)
      const unallocatedQty = alpacaQty - totalLedgerShares

      if (unallocatedQty > 0.0001) {
        const unallocatedValue = unallocatedQty * parseFloat(alpacaPos.currentPrice)
        unallocatedPositions.push({
          symbol: alpacaPos.symbol,
          qty: unallocatedQty,
          price: parseFloat(alpacaPos.currentPrice),
          value: unallocatedValue,
        })
      }
    }

    const unallocatedValue = unallocatedPositions.reduce((sum, p) => sum + p.value, 0)

    // Print portfolio summary
    console.log(`\n[PORTFOLIO] ════════════════════════════════════════════════════════════════`)
    console.log(`[PORTFOLIO] COMPLETE PORTFOLIO STATE (${credentialType.toUpperCase()})`)
    console.log(`[PORTFOLIO] User: ${userId}`)
    console.log(`[PORTFOLIO] ════════════════════════════════════════════════════════════════`)
    console.log(`[PORTFOLIO] ACCOUNT OVERVIEW:`)
    console.log(`[PORTFOLIO]   Total Equity: $${totalEquity.toFixed(2)}`)
    console.log(`[PORTFOLIO]   Cash: $${totalCash.toFixed(2)}`)
    console.log(`[PORTFOLIO]   Total Position Value: $${totalPositionValue.toFixed(2)}`)
    console.log(`[PORTFOLIO] ────────────────────────────────────────────────────────────────`)
    console.log(`[PORTFOLIO] BREAKDOWN BY SYSTEM:`)

    // Unallocated system
    console.log(`[PORTFOLIO]`)
    console.log(`[PORTFOLIO]   ┌─ UNALLOCATED POSITIONS`)
    console.log(`[PORTFOLIO]   │  Total Value: $${unallocatedValue.toFixed(2)}`)
    console.log(`[PORTFOLIO]   │  Position Count: ${unallocatedPositions.length}`)
    console.log(`[PORTFOLIO]   │  Pending Sells: ${pendingSells.length}`)
    if (unallocatedPositions.length > 0) {
      console.log(`[PORTFOLIO]   │  Positions:`)
      for (const pos of unallocatedPositions) {
        const hasPendingSell = pendingSells.some(s => s.symbol === pos.symbol)
        const sellIndicator = hasPendingSell ? ' [SELL SCHEDULED]' : ''
        console.log(`[PORTFOLIO]   │    • ${pos.symbol}: ${pos.qty.toFixed(4)} shares @ $${pos.price.toFixed(2)} = $${pos.value.toFixed(2)}${sellIndicator}`)
      }
    }
    console.log(`[PORTFOLIO]   │  Projected After Sells: $0.00 (all positions scheduled to sell)`)
    console.log(`[PORTFOLIO]   └──────────────────────────────────────`)

    // Bot systems
    for (const inv of investmentRows) {
      const botPositions = positionsByBot.get(inv.bot_id) || []
      let botValue = 0

      // Calculate current market value
      for (const pos of botPositions) {
        const alpacaPos = alpacaPositions.find(p => p.symbol === pos.symbol)
        const currentPrice = alpacaPos ? parseFloat(alpacaPos.currentPrice) : pos.avg_price
        botValue += pos.shares * currentPrice
      }

      console.log(`[PORTFOLIO]`)
      console.log(`[PORTFOLIO]   ┌─ ${inv.bot_name || inv.bot_id}`)
      console.log(`[PORTFOLIO]   │  Investment Amount: $${inv.investment_amount.toFixed(2)}`)
      console.log(`[PORTFOLIO]   │  Current Value: $${botValue.toFixed(2)}`)
      console.log(`[PORTFOLIO]   │  P&L: $${(botValue - inv.investment_amount).toFixed(2)} (${((botValue / inv.investment_amount - 1) * 100).toFixed(2)}%)`)
      console.log(`[PORTFOLIO]   │  Position Count: ${botPositions.length}`)
      if (botPositions.length > 0) {
        console.log(`[PORTFOLIO]   │  Positions:`)
        for (const pos of botPositions) {
          const alpacaPos = alpacaPositions.find(p => p.symbol === pos.symbol)
          const currentPrice = alpacaPos ? parseFloat(alpacaPos.currentPrice) : pos.avg_price
          const posValue = pos.shares * currentPrice
          console.log(`[PORTFOLIO]   │    • ${pos.symbol}: ${pos.shares.toFixed(4)} shares @ $${currentPrice.toFixed(2)} = $${posValue.toFixed(2)}`)
        }
      }
      console.log(`[PORTFOLIO]   │  Projected After Rebalance: $${inv.investment_amount.toFixed(2)} (will sell current and buy new positions)`)
      console.log(`[PORTFOLIO]   └──────────────────────────────────────`)
    }

    console.log(`[PORTFOLIO] ════════════════════════════════════════════════════════════════\n`)

  } catch (error) {
    console.error(`[PORTFOLIO] Error generating portfolio summary: ${error.message}`)
  }
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

  console.log(`\n[trading-scheduler] ════════════════════════════════════════════════════════`)
  console.log(`[trading-scheduler] STARTING SCHEDULED TRADE EXECUTION`)
  console.log(`[trading-scheduler] Time: ${new Date().toISOString()}`)
  console.log(`[trading-scheduler] ════════════════════════════════════════════════════════\n`)

  try {
    const users = getUsersWithTradingEnabled()
    console.log(`[trading-scheduler] Found ${users.length} users with trading enabled`)

    for (const userSettings of users) {
      const userId = userSettings.user_id
      currentExecution.currentUser = userId

      // Get portfolio-wide state for this user before executing any trades
      // Show summaries for both modes if credentials exist
      const paperCredsForSummary = getDecryptedCredentials(userId, 'paper')
      if (paperCredsForSummary) {
        await showPortfolioSummary(userId, 'paper', paperCredsForSummary)
      }

      const liveCredsForSummary = getDecryptedCredentials(userId, 'live')
      if (liveCredsForSummary) {
        await showPortfolioSummary(userId, 'live', liveCredsForSummary)
      }

      // Execute paper trades if credentials exist
      const paperCreds = getDecryptedCredentials(userId, 'paper')
      if (paperCreds) {
        // Process pending manual sells first (before rebalancing)
        const paperManualSells = await processPendingManualSells(userId, 'paper', paperCreds)

        const paperResult = await executeForUser(userId, 'paper', userSettings)
        currentExecution.users.push({
          userId,
          mode: 'paper',
          manualSells: paperManualSells,
          ...paperResult,
        })
      }

      // Execute live trades if credentials exist
      const liveCreds = getDecryptedCredentials(userId, 'live')
      if (liveCreds) {
        // Process pending manual sells first (before rebalancing)
        const liveManualSells = await processPendingManualSells(userId, 'live', liveCreds)

        const liveResult = await executeForUser(userId, 'live', userSettings)
        currentExecution.users.push({
          userId,
          mode: 'live',
          manualSells: liveManualSells,
          ...liveResult,
        })
      }
    }

    currentExecution.status = 'completed'
    currentExecution.completedAt = Date.now()
    currentExecution.duration = currentExecution.completedAt - currentExecution.startedAt

    console.log(`\n[trading-scheduler] ════════════════════════════════════════════════════════`)
    console.log(`[trading-scheduler] EXECUTION COMPLETE - Duration: ${currentExecution.duration}ms`)
    console.log(`[trading-scheduler] ════════════════════════════════════════════════════════\n`)

    // Update last execution date
    lastExecutionDate = getEasternDate()

  } catch (error) {
    console.error('[trading-scheduler] Scheduled execution FAILED:', error)
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
