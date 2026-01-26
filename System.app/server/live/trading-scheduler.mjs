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
import { createAlpacaClient, getAccountInfo, getPositions, getMarketCalendar } from './broker-alpaca.mjs'
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

    // Compute allocations
    const allocations = await computeFinalAllocations(
      investments,
      adjustedEquity,
      {
        fallbackTicker: settings.fallback_ticker || 'SGOV',
        pairedTickers,
        maxAllocationPercent: settings.max_allocation_percent || 99.0,
      }
    )

    // Execute live trades
    const result = await executeLiveTrades(credentials, allocations, {
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

    console.log(`[trading-scheduler] Completed ${credentialType} execution for user ${userId}:`, result.summary)

    return {
      success: true,
      mode: credentialType,
      equity: totalEquity,
      allocations,
      result,
    }
  } catch (error) {
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

  console.log('[trading-scheduler] Starting scheduled trade execution...')

  try {
    const users = getUsersWithTradingEnabled()
    console.log(`[trading-scheduler] Found ${users.length} users with trading enabled`)

    for (const userSettings of users) {
      const userId = userSettings.user_id
      currentExecution.currentUser = userId

      // Execute paper trades if credentials exist
      const paperCreds = getDecryptedCredentials(userId, 'paper')
      if (paperCreds) {
        const paperResult = await executeForUser(userId, 'paper', userSettings)
        currentExecution.users.push({
          userId,
          mode: 'paper',
          ...paperResult,
        })
      }

      // Execute live trades if credentials exist
      const liveCreds = getDecryptedCredentials(userId, 'live')
      if (liveCreds) {
        const liveResult = await executeForUser(userId, 'live', userSettings)
        currentExecution.users.push({
          userId,
          mode: 'live',
          ...liveResult,
        })
      }
    }

    currentExecution.status = 'completed'
    currentExecution.completedAt = Date.now()
    currentExecution.duration = currentExecution.completedAt - currentExecution.startedAt

    console.log(`[trading-scheduler] Completed scheduled execution in ${currentExecution.duration}ms`)

    // Update last execution date
    lastExecutionDate = getEasternDate()

  } catch (error) {
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
