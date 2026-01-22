/**
 * Live Trading Routes
 *
 * Handles broker credentials, connection testing, and dry run simulation
 * for the Trading Control admin panel.
 */

import { Router } from 'express'
import crypto from 'crypto'
import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import { createAlpacaClient, testConnection, getAccountInfo, getPositions, getLatestPrices, getPortfolioHistory, submitMarketSell } from '../live/broker-alpaca.mjs'
import { executeDryRun, executeLiveTrades } from '../live/trade-executor.mjs'
import { computeFinalAllocations } from '../live/backtest-allocator.mjs'
import { authenticate, requireMainAdmin } from '../middleware/auth.mjs'
import { runBacktest } from '../backtest.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const router = Router()

// All routes require authentication
router.use(authenticate)

// Database connection
const dbPath = process.env.ATLAS_DB_PATH
  ? path.join(path.dirname(process.env.ATLAS_DB_PATH), 'atlas.db')
  : path.join(__dirname, '../data/atlas.db')
const sqlite = new Database(dbPath)

// Encryption key for broker credentials (should be in env in production)
const ENCRYPTION_KEY = process.env.BROKER_ENCRYPTION_KEY || 'dev-encryption-key-32-chars-long!'
const ENCRYPTION_ALGORITHM = 'aes-256-gcm'

// Migration: Handle schema changes for broker_credentials table
// The table may exist with old schema (user_id as primary key) or not exist at all
try {
  // Check if table exists
  const tableExists = sqlite.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='broker_credentials'
  `).get()

  if (tableExists) {
    // Table exists - check if it has the credential_type column
    const tableInfo = sqlite.prepare(`PRAGMA table_info(broker_credentials)`).all()
    const hasCredentialType = tableInfo.some(col => col.name === 'credential_type')

    if (!hasCredentialType) {
      console.log('[live] Migrating broker_credentials to new schema with credential_type...')
      // Old schema - need to migrate
      // 1. Rename old table
      sqlite.exec(`ALTER TABLE broker_credentials RENAME TO broker_credentials_old`)

      // 2. Create new table with proper schema
      sqlite.exec(`
        CREATE TABLE broker_credentials (
          user_id TEXT NOT NULL,
          credential_type TEXT NOT NULL DEFAULT 'paper',
          encrypted_api_key TEXT NOT NULL,
          encrypted_api_secret TEXT NOT NULL,
          iv TEXT NOT NULL,
          auth_tag TEXT NOT NULL,
          base_url TEXT,
          created_at INTEGER DEFAULT (unixepoch()),
          updated_at INTEGER DEFAULT (unixepoch()),
          PRIMARY KEY (user_id, credential_type)
        )
      `)

      // 3. Check if old table has is_paper column
      const oldTableInfo = sqlite.prepare(`PRAGMA table_info(broker_credentials_old)`).all()
      const hasIsPaper = oldTableInfo.some(col => col.name === 'is_paper')

      // 4. Copy data from old table to new table
      if (hasIsPaper) {
        sqlite.exec(`
          INSERT INTO broker_credentials (user_id, credential_type, encrypted_api_key, encrypted_api_secret, iv, auth_tag, base_url, created_at, updated_at)
          SELECT user_id, CASE WHEN is_paper = 1 THEN 'paper' ELSE 'live' END, encrypted_api_key, encrypted_api_secret, iv, auth_tag, base_url, created_at, updated_at
          FROM broker_credentials_old
        `)
      } else {
        // No is_paper column, assume all are paper
        sqlite.exec(`
          INSERT INTO broker_credentials (user_id, credential_type, encrypted_api_key, encrypted_api_secret, iv, auth_tag, base_url, created_at, updated_at)
          SELECT user_id, 'paper', encrypted_api_key, encrypted_api_secret, iv, auth_tag, base_url, created_at, updated_at
          FROM broker_credentials_old
        `)
      }

      // 5. Drop old table
      sqlite.exec(`DROP TABLE broker_credentials_old`)
      console.log('[live] Migration complete')
    }
  } else {
    // Table doesn't exist - create fresh
    sqlite.exec(`
      CREATE TABLE broker_credentials (
        user_id TEXT NOT NULL,
        credential_type TEXT NOT NULL DEFAULT 'paper',
        encrypted_api_key TEXT NOT NULL,
        encrypted_api_secret TEXT NOT NULL,
        iv TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        base_url TEXT,
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch()),
        PRIMARY KEY (user_id, credential_type)
      )
    `)
    console.log('[live] Created broker_credentials table')
  }
} catch (err) {
  console.error('[live] Error during broker_credentials migration:', err)
}

// Create trading tables if they don't exist
try {
  // user_bot_investments - tracks which bots a user has "invested" in
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS user_bot_investments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      credential_type TEXT NOT NULL DEFAULT 'paper',
      bot_id TEXT NOT NULL,
      investment_amount REAL NOT NULL,
      weight_mode TEXT DEFAULT 'dollars',
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(user_id, credential_type, bot_id)
    )
  `)

  // bot_position_ledger - tracks exact shares attributed to each bot
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS bot_position_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      credential_type TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      shares REAL NOT NULL,
      avg_price REAL NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(user_id, credential_type, bot_id, symbol)
    )
  `)

  // trading_settings - global trading settings per user
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS trading_settings (
      user_id TEXT PRIMARY KEY,
      order_type TEXT DEFAULT 'limit',
      limit_percent REAL DEFAULT 1.0,
      max_allocation_percent REAL DEFAULT 99.0,
      fallback_ticker TEXT DEFAULT 'SGOV',
      cash_reserve_mode TEXT DEFAULT 'dollars',
      cash_reserve_amount REAL DEFAULT 0,
      minutes_before_close INTEGER DEFAULT 10,
      paired_tickers TEXT DEFAULT '',
      enabled INTEGER DEFAULT 0
    )
  `)

  // trade_executions - log of all trade execution runs
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS trade_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      credential_type TEXT NOT NULL,
      execution_date TEXT NOT NULL,
      status TEXT NOT NULL,
      target_allocations TEXT,
      executed_orders TEXT,
      errors TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    )
  `)

  // trade_orders - individual orders from each execution
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS trade_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      execution_id INTEGER REFERENCES trade_executions(id),
      side TEXT NOT NULL,
      symbol TEXT NOT NULL,
      qty INTEGER NOT NULL,
      price REAL,
      order_type TEXT,
      status TEXT,
      alpaca_order_id TEXT,
      error TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    )
  `)

  console.log('[live] Trading tables initialized')
} catch (err) {
  console.error('[live] Error creating trading tables:', err)
}

/**
 * Encrypt sensitive data
 */
function encrypt(text) {
  const iv = crypto.randomBytes(16)
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32)
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv)
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag()
  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
  }
}

/**
 * Decrypt sensitive data
 */
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
 * GET /api/admin/broker/credentials
 * Get broker credentials status for both paper and live (not the actual credentials)
 */
router.get('/broker/credentials', (req, res) => {
  try {
    const userId = req.user?.id
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const rows = sqlite.prepare(`
      SELECT credential_type, base_url, updated_at
      FROM broker_credentials
      WHERE user_id = ?
    `).all(userId)

    const paperRow = rows.find(r => r.credential_type === 'paper')
    const liveRow = rows.find(r => r.credential_type === 'live')

    res.json({
      paper: {
        hasCredentials: !!paperRow,
        baseUrl: paperRow?.base_url || 'https://paper-api.alpaca.markets',
        updatedAt: paperRow?.updated_at,
      },
      live: {
        hasCredentials: !!liveRow,
        baseUrl: liveRow?.base_url || 'https://api.alpaca.markets',
        updatedAt: liveRow?.updated_at,
      },
      // Legacy fields for backwards compatibility
      hasCredentials: !!paperRow || !!liveRow,
      isPaper: !!paperRow,
      baseUrl: paperRow?.base_url || liveRow?.base_url || 'https://paper-api.alpaca.markets',
    })
  } catch (error) {
    console.error('[live] Error getting broker credentials:', error)
    res.status(500).json({ error: 'Failed to get broker credentials' })
  }
})

/**
 * POST /api/admin/broker/credentials
 * Save broker credentials (encrypted)
 * Body: { apiKey, apiSecret, credentialType: 'paper' | 'live' }
 */
router.post('/broker/credentials', (req, res) => {
  try {
    const userId = req.user?.id
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { apiKey, apiSecret, credentialType, isPaper } = req.body
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: 'API Key and Secret are required' })
    }

    // Determine credential type (support new and legacy format)
    const type = credentialType || (isPaper !== false ? 'paper' : 'live')
    const baseUrl = type === 'paper' ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets'

    // Encrypt credentials
    const encryptedKey = encrypt(apiKey)
    const encryptedSecret = encrypt(apiSecret)

    // Upsert credentials for this type
    sqlite.prepare(`
      INSERT INTO broker_credentials (user_id, credential_type, encrypted_api_key, encrypted_api_secret, iv, auth_tag, base_url, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(user_id, credential_type) DO UPDATE SET
        encrypted_api_key = excluded.encrypted_api_key,
        encrypted_api_secret = excluded.encrypted_api_secret,
        iv = excluded.iv,
        auth_tag = excluded.auth_tag,
        base_url = excluded.base_url,
        updated_at = unixepoch()
    `).run(
      userId,
      type,
      encryptedKey.encrypted,
      encryptedSecret.encrypted,
      encryptedKey.iv + ':' + encryptedSecret.iv,
      encryptedKey.authTag + ':' + encryptedSecret.authTag,
      baseUrl
    )

    res.json({ success: true, credentialType: type })
  } catch (error) {
    console.error('[live] Error saving broker credentials:', error)
    res.status(500).json({ error: 'Failed to save broker credentials' })
  }
})

/**
 * Get decrypted credentials for a user
 * @param {string} userId - User ID
 * @param {string} credentialType - 'paper' or 'live' (defaults to 'paper')
 */
function getDecryptedCredentials(userId, credentialType = 'paper') {
  const row = sqlite.prepare(`
    SELECT encrypted_api_key, encrypted_api_secret, iv, auth_tag, credential_type, base_url
    FROM broker_credentials
    WHERE user_id = ? AND credential_type = ?
  `).get(userId, credentialType)

  if (!row) return null

  const [ivKey, ivSecret] = row.iv.split(':')
  const [authTagKey, authTagSecret] = row.auth_tag.split(':')

  return {
    apiKey: decrypt(row.encrypted_api_key, ivKey, authTagKey),
    apiSecret: decrypt(row.encrypted_api_secret, ivSecret, authTagSecret),
    isPaper: row.credential_type === 'paper',
    baseUrl: row.base_url,
  }
}

/**
 * POST /api/admin/broker/test
 * Test broker connection
 * Body: { credentialType: 'paper' | 'live' }
 */
router.post('/broker/test', async (req, res) => {
  try {
    const userId = req.user?.id
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { credentialType = 'paper' } = req.body
    const credentials = getDecryptedCredentials(userId, credentialType)
    if (!credentials) {
      return res.status(400).json({ error: `No ${credentialType} trading credentials saved` })
    }

    const client = createAlpacaClient(credentials)
    const result = await testConnection(client)

    if (!result.success) {
      return res.status(400).json({ error: result.error })
    }

    res.json({
      success: true,
      credentialType,
      account: {
        equity: result.account.equity,
        cash: result.account.cash,
        buyingPower: result.account.buyingPower,
        status: result.account.status,
      },
    })
  } catch (error) {
    console.error('[live] Error testing broker connection:', error)
    res.status(500).json({ error: error.message || 'Connection test failed' })
  }
})

/**
 * POST /api/admin/live/dry-run
 * Executes trades immediately on Live or Paper account using current bot allocations.
 * Despite the endpoint name (kept for backwards compatibility), this now actually executes trades.
 * @param {string} mode - 'execute-live' or 'execute-paper'
 * @param {number} cashReserve - Cash reserve amount
 * @param {string} cashMode - 'dollars' or 'percent'
 */
router.post('/live/dry-run', async (req, res) => {
  try {
    const userId = req.user?.id
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { cashReserve = 0, cashMode = 'dollars', mode = 'execute-paper' } = req.body

    // Validate mode
    if (mode !== 'execute-live' && mode !== 'execute-paper') {
      return res.status(400).json({ error: 'Invalid mode. Must be "execute-live" or "execute-paper"' })
    }

    // Get credentials based on execution mode
    const credentialType = mode === 'execute-live' ? 'live' : 'paper'
    const credentials = getDecryptedCredentials(userId, credentialType)
    if (!credentials) {
      return res.status(400).json({ error: `No ${credentialType} trading credentials configured` })
    }

    // Safety check for live execution
    if (mode === 'execute-live') {
      // Ensure credentials are actually live (not paper)
      if (credentials.apiKey && credentials.apiKey.includes('paper')) {
        return res.status(400).json({
          error: 'Invalid live credentials - appears to be paper account'
        })
      }

      // Log live execution start
      console.log('[live] ⚠️  LIVE EXECUTION STARTED', {
        userId,
        timestamp: new Date().toISOString(),
        cashReserve,
        cashMode,
      })

      // Market hours warning (non-blocking)
      const now = new Date()
      const hours = now.getUTCHours()
      const day = now.getUTCDay()
      const isWeekend = day === 0 || day === 6
      const outsideMarketHours = hours < 14 || hours >= 21

      if (isWeekend || outsideMarketHours) {
        console.warn('[live] ⚠️  Executing outside market hours:', {
          day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day],
          hourUTC: hours,
          isWeekend,
          outsideMarketHours
        })
      }
    }

    // Get user's fund slot bots (investments)
    const investments = sqlite.prepare(`
      SELECT fund_slot, bot_id, investment_amount
      FROM user_fund_slots
      WHERE user_id = ? AND bot_id IS NOT NULL AND investment_amount > 0
    `).all(userId)

    if (investments.length === 0) {
      return res.status(400).json({ error: 'No investments configured in Dashboard. Add bots to fund slots first.' })
    }

    // Get account info from broker
    const client = createAlpacaClient(credentials)
    const account = await getAccountInfo(client)

    // Calculate cash reserve
    let reservedCash = 0
    if (cashReserve) {
      if (cashMode === 'percent') {
        reservedCash = account.equity * (cashReserve / 100)
      } else {
        reservedCash = cashReserve
      }
    }
    const adjustedEquity = Math.max(0, account.equity - reservedCash)

    // Run backtest for each bot to get current allocations
    const botBreakdown = []
    const mergedAllocations = {}
    let totalInvested = 0

    for (const inv of investments) {
      const bot = sqlite.prepare(`
        SELECT id, name, payload FROM bots WHERE id = ?
      `).get(inv.bot_id)

      if (!bot || !bot.payload) {
        console.warn(`[live] Bot ${inv.bot_id} not found or has no payload`)
        botBreakdown.push({
          botId: inv.bot_id,
          botName: 'Unknown',
          investment: inv.investment_amount,
          error: 'Bot not found or has no payload',
          allocations: {},
        })
        continue
      }

      totalInvested += inv.investment_amount

      try {
        // Parse payload and run backtest
        const payload = typeof bot.payload === 'string' ? JSON.parse(bot.payload) : bot.payload
        const backtestResult = await runBacktest(payload, { mode: 'CC' })

        // Get the most recent allocation
        const allocations = backtestResult.allocations || []
        const latestAllocation = allocations.length > 0 ? allocations[allocations.length - 1] : null
        const currentAlloc = latestAllocation?.alloc || {}

        // Filter out "Empty" positions and normalize
        const filteredAlloc = {}
        for (const [ticker, weight] of Object.entries(currentAlloc)) {
          if (ticker !== 'Empty' && weight > 0) {
            filteredAlloc[ticker] = weight
          }
        }

        botBreakdown.push({
          botId: bot.id,
          botName: bot.name,
          investment: inv.investment_amount,
          date: latestAllocation?.date || new Date().toISOString().split('T')[0],
          allocations: filteredAlloc,
        })

        console.log(`[live] Bot ${bot.name} allocations:`, filteredAlloc)
      } catch (err) {
        console.error(`[live] Failed to backtest bot ${bot.name}:`, err.message)
        botBreakdown.push({
          botId: bot.id,
          botName: bot.name,
          investment: inv.investment_amount,
          error: err.message,
          allocations: {},
        })
      }
    }

    // Merge allocations weighted by investment amounts
    if (totalInvested > 0) {
      for (const bot of botBreakdown) {
        if (bot.error) continue
        const botWeight = bot.investment / totalInvested

        for (const [ticker, weight] of Object.entries(bot.allocations)) {
          // weight is already 0-1, multiply by bot's investment weight
          const contribution = weight * botWeight * 100 // Convert to percentage
          mergedAllocations[ticker] = (mergedAllocations[ticker] || 0) + contribution
        }
      }
    }

    // Execute live trades with merged allocations
    let executionResult = null
    const allTickers = Object.keys(mergedAllocations)

    if (allTickers.length > 0) {
      try {
        executionResult = await executeLiveTrades(credentials, mergedAllocations, adjustedEquity)

        // Log successful execution
        if (mode === 'execute-live') {
          console.log('[live] ✅ LIVE EXECUTION COMPLETED', {
            positionsExecuted: executionResult.positions?.length || 0,
            totalAllocated: executionResult.summary?.totalAllocated || 0,
          })
        } else {
          console.log('[live] ✅ Paper execution completed', {
            positionsExecuted: executionResult.positions?.length || 0,
          })
        }
      } catch (err) {
        console.error(`[live] executeLiveTrades (${mode}) failed:`, err.message)
        if (mode === 'execute-live') {
          console.error('[live] ❌ LIVE EXECUTION FAILED:', err)
        }
        throw err // Re-throw to be caught by outer try-catch
      }
    }

    // Build response
    const positions = executionResult?.positions || []
    const validPositions = positions.filter(p => p.shares > 0)

    res.json({
      mode: mode, // 'execute-live' or 'execute-paper'
      executionMode: mode, // For clarity in frontend
      executedAt: new Date().toISOString(),
      timestamp: new Date().toISOString(),
      usedLivePrices: true,
      account: {
        equity: account.equity,
        cash: account.cash,
        buyingPower: account.buyingPower,
        reservedCash,
        adjustedEquity,
      },
      botBreakdown,
      mergedAllocations,
      totalInvested,
      positions: positions.map(p => ({
        ticker: p.ticker,
        targetPercent: p.targetPercent,
        price: p.price,
        limitPrice: p.limitPrice,
        shares: p.shares,
        value: p.value,
        skipped: p.skipped,
        reason: p.reason,
        error: p.error,
        orderId: p.orderId, // Include actual order ID from Alpaca
        status: p.status, // Include order status
      })),
      summary: {
        totalAllocated: executionResult?.summary?.totalAllocated || 0,
        unallocated: executionResult?.summary?.unallocated || adjustedEquity,
        allocationPercent: executionResult?.summary?.allocationPercent || 0,
        positionCount: validPositions.length,
      },
    })
  } catch (error) {
    console.error('[live] Error executing dry run:', error)
    res.status(500).json({ error: error.message || 'Dry run failed' })
  }
})

// ============================================
// Dashboard Broker Endpoints (for Portfolio tab)
// These endpoints are accessible from the Dashboard, not just Admin
// Query param: mode=paper|live (defaults to 'paper')
// ============================================

/**
 * GET /api/dashboard/broker/status
 * Check if user has Alpaca credentials and connection status
 * Query params: mode (paper|live)
 */
router.get('/dashboard/broker/status', async (req, res) => {
  try {
    const userId = req.user?.id
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const mode = req.query.mode || 'paper'
    const credentialType = mode === 'live' ? 'live' : 'paper'

    const row = sqlite.prepare(`
      SELECT credential_type, base_url, updated_at
      FROM broker_credentials
      WHERE user_id = ? AND credential_type = ?
    `).get(userId, credentialType)

    if (!row) {
      return res.json({
        hasCredentials: false,
        isPaper: credentialType === 'paper',
        isConnected: false,
        mode: credentialType,
      })
    }

    // Try to verify connection
    let isConnected = false
    try {
      const credentials = getDecryptedCredentials(userId, credentialType)
      if (credentials) {
        const client = createAlpacaClient(credentials)
        const result = await testConnection(client)
        isConnected = result.success
      }
    } catch {
      isConnected = false
    }

    res.json({
      hasCredentials: true,
      isPaper: credentialType === 'paper',
      isConnected,
      mode: credentialType,
      updatedAt: row.updated_at,
    })
  } catch (error) {
    console.error('[live] Error getting dashboard broker status:', error)
    res.status(500).json({ error: 'Failed to get broker status' })
  }
})

/**
 * GET /api/dashboard/broker/account
 * Get Alpaca account info (equity, cash, buyingPower)
 * Query params: mode (paper|live)
 */
router.get('/dashboard/broker/account', async (req, res) => {
  try {
    const userId = req.user?.id
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const mode = req.query.mode || 'paper'
    const credentialType = mode === 'live' ? 'live' : 'paper'

    const credentials = getDecryptedCredentials(userId, credentialType)
    if (!credentials) {
      return res.status(400).json({ error: `No ${credentialType} trading credentials configured` })
    }

    const client = createAlpacaClient(credentials)
    const account = await getAccountInfo(client)

    res.json({
      equity: account.equity,
      cash: account.cash,
      buyingPower: account.buyingPower,
      portfolioValue: account.portfolioValue,
      status: account.status,
      mode: credentialType,
    })
  } catch (error) {
    console.error('[live] Error getting dashboard broker account:', error)
    res.status(500).json({ error: error.message || 'Failed to get account info' })
  }
})

/**
 * GET /api/dashboard/broker/positions
 * Get current Alpaca positions with P&L
 * Query params: mode (paper|live)
 */
router.get('/dashboard/broker/positions', async (req, res) => {
  try {
    const userId = req.user?.id
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const mode = req.query.mode || 'paper'
    const credentialType = mode === 'live' ? 'live' : 'paper'

    const credentials = getDecryptedCredentials(userId, credentialType)
    if (!credentials) {
      return res.status(400).json({ error: `No ${credentialType} trading credentials configured` })
    }

    const client = createAlpacaClient(credentials)
    const positions = await getPositions(client)

    res.json({
      positions: positions.map(p => ({
        symbol: p.symbol,
        qty: p.qty,
        avgEntryPrice: p.avgEntryPrice,
        marketValue: p.marketValue,
        costBasis: p.costBasis,
        unrealizedPl: p.unrealizedPl,
        unrealizedPlPc: p.unrealizedPlPc,
        currentPrice: p.currentPrice,
        side: p.side,
      })),
      mode: credentialType,
    })
  } catch (error) {
    console.error('[live] Error getting dashboard broker positions:', error)
    res.status(500).json({ error: error.message || 'Failed to get positions' })
  }
})

/**
 * GET /api/dashboard/broker/history
 * Get portfolio value history for equity chart
 * Query params: period (1D, 1W, 1M, 3M, 6M, 1Y, ALL), mode (paper|live)
 */
router.get('/dashboard/broker/history', async (req, res) => {
  try {
    const userId = req.user?.id
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const mode = req.query.mode || 'paper'
    const credentialType = mode === 'live' ? 'live' : 'paper'

    const credentials = getDecryptedCredentials(userId, credentialType)
    if (!credentials) {
      return res.status(400).json({ error: `No ${credentialType} trading credentials configured` })
    }

    const period = req.query.period || '1M'
    const client = createAlpacaClient(credentials)
    const history = await getPortfolioHistory(client, period)

    res.json({
      history: history.map(h => ({
        timestamp: h.timestamp,
        equity: h.equity,
        profitLoss: h.profitLoss,
        profitLossPct: h.profitLossPct,
      })),
      mode: credentialType,
    })
  } catch (error) {
    console.error('[live] Error getting dashboard broker history:', error)
    res.status(500).json({ error: error.message || 'Failed to get portfolio history' })
  }
})

/**
 * POST /api/dashboard/broker/sell-unallocated
 * Sell unallocated positions
 * Body: { credentialType: 'live' | 'paper', orders: Array<{ symbol: string, qty: number }> }
 */
router.post('/dashboard/broker/sell-unallocated', async (req, res) => {
  try {
    const userId = req.user?.id
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { credentialType, orders } = req.body

    if (!credentialType || !['live', 'paper'].includes(credentialType)) {
      return res.status(400).json({ error: 'Invalid credentialType' })
    }

    if (!Array.isArray(orders) || orders.length === 0) {
      return res.status(400).json({ error: 'No orders provided' })
    }

    const credentials = getDecryptedCredentials(userId, credentialType)
    if (!credentials) {
      return res.status(400).json({ error: `No ${credentialType} trading credentials configured` })
    }

    const client = createAlpacaClient(credentials)
    const results = []
    const errors = []

    for (const order of orders) {
      const { symbol, qty } = order
      if (!symbol || !qty || qty <= 0) {
        errors.push({ symbol, error: 'Invalid order parameters' })
        continue
      }

      try {
        const result = await submitMarketSell(client, symbol, qty)
        results.push(result)
      } catch (err) {
        console.error(`[live] Failed to sell ${symbol}:`, err)
        errors.push({ symbol, error: err.message })
      }
    }

    res.json({
      success: errors.length === 0,
      orders: results,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (error) {
    console.error('[live] Error selling unallocated positions:', error)
    res.status(500).json({ error: error.message || 'Failed to sell positions' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Trading Investments API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/trading/investments
 * Get user's bot investments for a mode (paper|live)
 */
router.get('/trading/investments', (req, res) => {
  try {
    const userId = req.user?.id
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const mode = req.query.mode || 'paper'
    const credentialType = mode === 'live' ? 'live' : 'paper'

    const investments = sqlite.prepare(`
      SELECT id, bot_id, investment_amount, weight_mode, created_at, updated_at
      FROM user_bot_investments
      WHERE user_id = ? AND credential_type = ?
      ORDER BY created_at DESC
    `).all(userId, credentialType)

    // Transform snake_case to camelCase for frontend
    const investmentsFormatted = investments.map(inv => ({
      id: inv.id,
      botId: inv.bot_id,
      investmentAmount: inv.investment_amount,
      weightMode: inv.weight_mode,
      createdAt: inv.created_at,
      updatedAt: inv.updated_at,
    }))

    res.json({ investments: investmentsFormatted, mode: credentialType })
  } catch (error) {
    console.error('[live] Error getting investments:', error)
    res.status(500).json({ error: error.message || 'Failed to get investments' })
  }
})

/**
 * POST /api/admin/trading/investments
 * Add or update a bot investment
 */
router.post('/trading/investments', (req, res) => {
  try {
    const userId = req.user?.id
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { botId, investmentAmount, weightMode, mode } = req.body
    if (!botId || investmentAmount === undefined) {
      return res.status(400).json({ error: 'botId and investmentAmount are required' })
    }

    const credentialType = mode === 'live' ? 'live' : 'paper'
    const wMode = weightMode || 'dollars'

    // Upsert - insert or update on conflict
    sqlite.prepare(`
      INSERT INTO user_bot_investments (user_id, credential_type, bot_id, investment_amount, weight_mode, updated_at)
      VALUES (?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(user_id, credential_type, bot_id) DO UPDATE SET
        investment_amount = excluded.investment_amount,
        weight_mode = excluded.weight_mode,
        updated_at = unixepoch()
    `).run(userId, credentialType, botId, investmentAmount, wMode)

    res.json({ success: true, botId, investmentAmount, weightMode: wMode, mode: credentialType })
  } catch (error) {
    console.error('[live] Error saving investment:', error)
    res.status(500).json({ error: error.message || 'Failed to save investment' })
  }
})

/**
 * DELETE /api/admin/trading/investments/:botId
 * Remove a bot investment
 */
router.delete('/trading/investments/:botId', (req, res) => {
  try {
    const userId = req.user?.id
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { botId } = req.params
    const mode = req.query.mode || 'paper'
    const credentialType = mode === 'live' ? 'live' : 'paper'

    const result = sqlite.prepare(`
      DELETE FROM user_bot_investments
      WHERE user_id = ? AND credential_type = ? AND bot_id = ?
    `).run(userId, credentialType, botId)

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Investment not found' })
    }

    res.json({ success: true, botId, mode: credentialType })
  } catch (error) {
    console.error('[live] Error deleting investment:', error)
    res.status(500).json({ error: error.message || 'Failed to delete investment' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Position Ledger API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/trading/ledger
 * Get position ledger for a mode (paper|live)
 */
router.get('/trading/ledger', (req, res) => {
  try {
    const userId = req.user?.id
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const mode = req.query.mode || 'paper'
    const credentialType = mode === 'live' ? 'live' : 'paper'

    const ledger = sqlite.prepare(`
      SELECT id, bot_id, symbol, shares, avg_price, created_at, updated_at
      FROM bot_position_ledger
      WHERE user_id = ? AND credential_type = ?
      ORDER BY bot_id, symbol
    `).all(userId, credentialType)

    res.json({ ledger, mode: credentialType })
  } catch (error) {
    console.error('[live] Error getting position ledger:', error)
    res.status(500).json({ error: error.message || 'Failed to get position ledger' })
  }
})

/**
 * GET /api/admin/trading/unallocated
 * Get unallocated positions (Alpaca positions minus ledger-attributed positions)
 */
router.get('/trading/unallocated', async (req, res) => {
  try {
    const userId = req.user?.id
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const mode = req.query.mode || 'paper'
    const credentialType = mode === 'live' ? 'live' : 'paper'

    // Get Alpaca credentials
    const credentials = getDecryptedCredentials(userId, credentialType)
    if (!credentials) {
      return res.status(400).json({ error: `No ${credentialType} trading credentials configured` })
    }

    // Get Alpaca positions
    const client = createAlpacaClient(credentials)
    const alpacaPositions = await getPositions(client)

    // Get ledger totals by symbol
    const ledger = sqlite.prepare(`
      SELECT symbol, SUM(shares) as total_shares
      FROM bot_position_ledger
      WHERE user_id = ? AND credential_type = ?
      GROUP BY symbol
    `).all(userId, credentialType)

    const ledgerBySymbol = {}
    for (const row of ledger) {
      ledgerBySymbol[row.symbol] = row.total_shares
    }

    // Calculate unallocated positions
    const unallocated = []
    for (const pos of alpacaPositions) {
      const attributedShares = ledgerBySymbol[pos.symbol] || 0
      const unallocatedShares = pos.qty - attributedShares

      if (unallocatedShares > 0.0001) {  // Small threshold for floating point
        unallocated.push({
          symbol: pos.symbol,
          unallocatedQty: unallocatedShares,
          avgEntryPrice: pos.avgEntryPrice,
          marketValue: pos.marketValue * (unallocatedShares / pos.qty),
          costBasis: pos.costBasis * (unallocatedShares / pos.qty),
          unrealizedPl: pos.unrealizedPl * (unallocatedShares / pos.qty),
          unrealizedPlPc: pos.unrealizedPlPc,
          currentPrice: pos.currentPrice,
          side: pos.side,
        })
      }
    }

    res.json({ unallocated, mode: credentialType })
  } catch (error) {
    console.error('[live] Error getting unallocated positions:', error)
    res.status(500).json({ error: error.message || 'Failed to get unallocated positions' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Trading Settings API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/trading/settings
 * Get trading settings for user
 */
router.get('/trading/settings', (req, res) => {
  try {
    const userId = req.user?.id
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    let settings = sqlite.prepare(`
      SELECT * FROM trading_settings WHERE user_id = ?
    `).get(userId)

    // Return defaults if no settings exist
    if (!settings) {
      settings = {
        user_id: userId,
        order_type: 'limit',
        limit_percent: 1.0,
        max_allocation_percent: 99.0,
        fallback_ticker: 'SGOV',
        cash_reserve_mode: 'dollars',
        cash_reserve_amount: 0,
        minutes_before_close: 10,
        paired_tickers: '',
        enabled: 0,
      }
    }

    // Parse paired_tickers JSON if present
    let pairedTickers = []
    if (settings.paired_tickers) {
      try {
        pairedTickers = JSON.parse(settings.paired_tickers)
      } catch (e) {
        pairedTickers = []
      }
    }

    res.json({
      orderType: settings.order_type,
      limitPercent: settings.limit_percent,
      maxAllocationPercent: settings.max_allocation_percent,
      fallbackTicker: settings.fallback_ticker,
      cashReserveMode: settings.cash_reserve_mode,
      cashReserveAmount: settings.cash_reserve_amount,
      minutesBeforeClose: settings.minutes_before_close,
      pairedTickers,
      enabled: !!settings.enabled,
    })
  } catch (error) {
    console.error('[live] Error getting trading settings:', error)
    res.status(500).json({ error: error.message || 'Failed to get trading settings' })
  }
})

/**
 * POST /api/admin/trading/settings
 * Update trading settings
 */
router.post('/trading/settings', (req, res) => {
  try {
    const userId = req.user?.id
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const {
      orderType,
      limitPercent,
      maxAllocationPercent,
      fallbackTicker,
      cashReserveMode,
      cashReserveAmount,
      minutesBeforeClose,
      pairedTickers,
      enabled,
    } = req.body

    // Serialize paired tickers to JSON
    const pairedTickersJson = pairedTickers ? JSON.stringify(pairedTickers) : ''

    sqlite.prepare(`
      INSERT INTO trading_settings (
        user_id, order_type, limit_percent, max_allocation_percent, fallback_ticker,
        cash_reserve_mode, cash_reserve_amount, minutes_before_close, paired_tickers, enabled
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        order_type = excluded.order_type,
        limit_percent = excluded.limit_percent,
        max_allocation_percent = excluded.max_allocation_percent,
        fallback_ticker = excluded.fallback_ticker,
        cash_reserve_mode = excluded.cash_reserve_mode,
        cash_reserve_amount = excluded.cash_reserve_amount,
        minutes_before_close = excluded.minutes_before_close,
        paired_tickers = excluded.paired_tickers,
        enabled = excluded.enabled
    `).run(
      userId,
      orderType || 'limit',
      limitPercent ?? 1.0,
      maxAllocationPercent ?? 99.0,
      fallbackTicker || 'SGOV',
      cashReserveMode || 'dollars',
      cashReserveAmount ?? 0,
      minutesBeforeClose ?? 10,
      pairedTickersJson,
      enabled ? 1 : 0
    )

    res.json({ success: true })
  } catch (error) {
    console.error('[live] Error saving trading settings:', error)
    res.status(500).json({ error: error.message || 'Failed to save trading settings' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Trade Execution API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/admin/trading/execute
 * Execute trades for all invested bots (or dry run)
 * Body: { mode: 'paper'|'live', dryRun: boolean }
 */
router.post('/trading/execute', async (req, res) => {
  try {
    const userId = req.user?.id
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { mode = 'paper', dryRun = true } = req.body
    const credentialType = mode === 'live' ? 'live' : 'paper'

    console.log(`[live] Executing trades for user ${userId}, mode=${credentialType}, dryRun=${dryRun}`)

    // Get credentials
    const credentials = getDecryptedCredentials(userId, credentialType)
    if (!credentials) {
      return res.status(400).json({ error: `No ${credentialType} trading credentials configured` })
    }

    // Get trading settings
    let settings = sqlite.prepare(`
      SELECT * FROM trading_settings WHERE user_id = ?
    `).get(userId)

    if (!settings) {
      settings = {
        order_type: 'limit',
        limit_percent: 1.0,
        max_allocation_percent: 99.0,
        fallback_ticker: 'SGOV',
        cash_reserve_mode: 'dollars',
        cash_reserve_amount: 0,
        paired_tickers: '',
      }
    }

    // Parse paired tickers
    let pairedTickers = []
    if (settings.paired_tickers) {
      try {
        pairedTickers = JSON.parse(settings.paired_tickers)
      } catch (e) {
        pairedTickers = []
      }
    }

    // Get investments for this mode
    const investmentRows = sqlite.prepare(`
      SELECT i.*, b.name as bot_name, b.payload as bot_payload
      FROM user_bot_investments i
      LEFT JOIN bots b ON i.bot_id = b.id
      WHERE i.user_id = ? AND i.credential_type = ?
    `).all(userId, credentialType)

    if (investmentRows.length === 0) {
      return res.json({
        success: true,
        message: 'No investments to execute',
        allocations: {},
        dryRun,
      })
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

    // Get account info for total equity
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

    // Compute final allocations from all bot backtests
    const allocations = await computeFinalAllocations(
      investments,
      adjustedEquity,
      {
        fallbackTicker: settings.fallback_ticker,
        pairedTickers,
        maxAllocationPercent: settings.max_allocation_percent,
      }
    )

    const executionDate = new Date().toISOString().split('T')[0]
    let result

    if (dryRun) {
      // Dry run - calculate what would happen
      result = await executeDryRun(credentials, allocations, {
        cashReserve: reservedCash,
        cashMode: 'dollars',
      })
      result.dryRun = true
    } else {
      // Live execution
      result = await executeLiveTrades(credentials, allocations, {
        cashReserve: reservedCash,
        cashMode: 'dollars',
        orderType: settings.order_type,
        limitPercent: settings.limit_percent,
      })
      result.dryRun = false

      // Log the execution
      const execResult = sqlite.prepare(`
        INSERT INTO trade_executions (user_id, credential_type, execution_date, status, target_allocations, executed_orders, errors)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        credentialType,
        executionDate,
        result.summary.errorCount > 0 ? 'partial' : 'success',
        JSON.stringify(allocations),
        JSON.stringify([...(result.sells || []), ...(result.buys || [])]),
        JSON.stringify(result.errors || [])
      )

      // Log individual orders
      const executionId = execResult.lastInsertRowid
      for (const order of [...(result.sells || []), ...(result.buys || [])]) {
        sqlite.prepare(`
          INSERT INTO trade_orders (execution_id, side, symbol, qty, price, order_type, status, alpaca_order_id, error)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          executionId,
          order.side,
          order.symbol,
          order.qty || 0,
          order.limitPrice || order.price || null,
          order.type || settings.order_type,
          order.success ? 'filled' : 'failed',
          order.id || null,
          order.error || null
        )
      }

      // Update position ledger based on executed orders
      // (This would need more logic to track shares per bot)
    }

    res.json({
      success: true,
      mode: credentialType,
      dryRun,
      account: {
        equity: totalEquity,
        cash: account.cash,
        reservedCash,
        adjustedEquity,
      },
      allocations,
      result,
    })
  } catch (error) {
    console.error('[live] Error executing trades:', error)
    res.status(500).json({ error: error.message || 'Failed to execute trades' })
  }
})

/**
 * GET /api/admin/trading/executions
 * Get trade execution history
 */
router.get('/trading/executions', (req, res) => {
  try {
    const userId = req.user?.id
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const mode = req.query.mode || 'paper'
    const credentialType = mode === 'live' ? 'live' : 'paper'
    const limit = Math.min(parseInt(req.query.limit) || 20, 100)

    const executions = sqlite.prepare(`
      SELECT *
      FROM trade_executions
      WHERE user_id = ? AND credential_type = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(userId, credentialType, limit)

    // Parse JSON fields
    const parsed = executions.map(exec => ({
      id: exec.id,
      executionDate: exec.execution_date,
      status: exec.status,
      targetAllocations: JSON.parse(exec.target_allocations || '{}'),
      executedOrders: JSON.parse(exec.executed_orders || '[]'),
      errors: JSON.parse(exec.errors || '[]'),
      createdAt: exec.created_at,
    }))

    res.json({ executions: parsed, mode: credentialType })
  } catch (error) {
    console.error('[live] Error getting executions:', error)
    res.status(500).json({ error: error.message || 'Failed to get executions' })
  }
})

/**
 * GET /api/admin/trading/orders
 * Get individual order history for an execution
 */
router.get('/trading/orders/:executionId', (req, res) => {
  try {
    const userId = req.user?.id
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { executionId } = req.params

    // Verify the execution belongs to this user
    const execution = sqlite.prepare(`
      SELECT id FROM trade_executions WHERE id = ? AND user_id = ?
    `).get(executionId, userId)

    if (!execution) {
      return res.status(404).json({ error: 'Execution not found' })
    }

    const orders = sqlite.prepare(`
      SELECT *
      FROM trade_orders
      WHERE execution_id = ?
      ORDER BY created_at
    `).all(executionId)

    res.json({ orders, executionId: parseInt(executionId) })
  } catch (error) {
    console.error('[live] Error getting orders:', error)
    res.status(500).json({ error: error.message || 'Failed to get orders' })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Trading Scheduler Endpoints
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/trading/scheduler/status
 * Get trading scheduler status
 */
router.get('/trading/scheduler/status', (req, res) => {
  try {
    const userId = req.user?.id
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // Import trading scheduler dynamically to avoid circular dependencies
    import('../live/trading-scheduler.mjs').then(({ getTradingSchedulerStatus }) => {
      const status = getTradingSchedulerStatus()
      res.json(status)
    }).catch(error => {
      console.error('[live] Error getting scheduler status:', error)
      res.status(500).json({ error: 'Failed to get scheduler status' })
    })
  } catch (error) {
    console.error('[live] Error getting scheduler status:', error)
    res.status(500).json({ error: error.message || 'Failed to get scheduler status' })
  }
})

/**
 * POST /api/admin/trading/scheduler/trigger
 * Manually trigger trading execution
 */
router.post('/trading/scheduler/trigger', async (req, res) => {
  try {
    const userId = req.user?.id
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // Import trading scheduler dynamically
    const { triggerManualExecution } = await import('../live/trading-scheduler.mjs')
    const result = await triggerManualExecution()
    res.json(result)
  } catch (error) {
    console.error('[live] Error triggering manual execution:', error)
    res.status(500).json({ error: error.message || 'Failed to trigger execution' })
  }
})

export default router
