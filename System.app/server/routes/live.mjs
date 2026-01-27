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
import { decompressPayload } from '../db/index.mjs'

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
      credential_type TEXT NOT NULL CHECK(credential_type IN ('paper', 'live')),
      bot_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      shares REAL NOT NULL CHECK(shares >= 0),
      avg_price REAL NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(user_id, credential_type, bot_id, symbol)
    )
  `)

  // Create index for faster bot position lookups
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_bot_position_ledger_lookup
      ON bot_position_ledger(user_id, credential_type, bot_id)
  `)

  // trading_settings - global trading settings per user
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS trading_settings (
      user_id TEXT PRIMARY KEY,
      order_type TEXT DEFAULT 'market',
      limit_percent REAL DEFAULT 1.0,
      max_allocation_percent REAL DEFAULT 100.0,
      fallback_ticker TEXT DEFAULT 'SGOV',
      cash_reserve_mode TEXT DEFAULT 'dollars',
      cash_reserve_amount REAL DEFAULT 0,
      minutes_before_close INTEGER DEFAULT 10,
      paired_tickers TEXT DEFAULT '',
      enabled INTEGER DEFAULT 0,
      market_hours_check_hour INTEGER DEFAULT 4
    )
  `)

  // Add market_hours_check_hour column if it doesn't exist (migration)
  try {
    const columns = sqlite.prepare(`PRAGMA table_info(trading_settings)`).all()
    const hasMarketHoursCheckHour = columns.some(col => col.name === 'market_hours_check_hour')
    if (!hasMarketHoursCheckHour) {
      sqlite.exec(`ALTER TABLE trading_settings ADD COLUMN market_hours_check_hour INTEGER DEFAULT 4`)
      console.log('[live] Added market_hours_check_hour column to trading_settings')
    }
  } catch (err) {
    console.error('[live] Error adding market_hours_check_hour column:', err)
  }

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

  // Migration: Sync existing portfolio_positions to user_bot_investments
  try {
    console.log('[live] [MIGRATION] Starting portfolio sync migration...')

    // First, check if the required tables exist
    const portfolioTableExists = sqlite.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='portfolio_positions'
    `).get()

    const portfoliosTableExists = sqlite.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='portfolios'
    `).get()

    console.log('[live] [MIGRATION] Table existence check:', {
      portfolio_positions: !!portfolioTableExists,
      portfolios: !!portfoliosTableExists
    })

    if (!portfolioTableExists || !portfoliosTableExists) {
      console.log('[live] [MIGRATION] Portfolio tables do not exist in this database, skipping migration')
      console.log('[live] [MIGRATION] Note: This is expected if portfolio tables are in Drizzle database')
    } else {
      // Tables exist, check if migration is needed
      console.log('[live] [MIGRATION] Portfolio tables found, checking for positions to migrate...')

      const totalPositions = sqlite.prepare(`
        SELECT COUNT(*) as count FROM portfolio_positions WHERE exit_date IS NULL
      `).get()
      console.log('[live] [MIGRATION] Total active portfolio positions:', totalPositions.count)

      const totalInvestments = sqlite.prepare(`
        SELECT COUNT(*) as count FROM user_bot_investments
      `).get()
      console.log('[live] [MIGRATION] Total user_bot_investments:', totalInvestments.count)

      const needsMigration = sqlite.prepare(`
        SELECT COUNT(*) as count FROM portfolio_positions pp
        WHERE pp.exit_date IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM user_bot_investments ubi
            WHERE ubi.user_id = (SELECT owner_id FROM portfolios WHERE id = pp.portfolio_id)
              AND ubi.bot_id = pp.bot_id
              AND ubi.credential_type = 'paper'
          )
      `).get()

      console.log('[live] [MIGRATION] Positions needing migration:', needsMigration.count)

      if (needsMigration.count > 0) {
        console.log(`[live] [MIGRATION] Migrating ${needsMigration.count} portfolio positions to user_bot_investments...`)

        sqlite.prepare(`
          INSERT INTO user_bot_investments (user_id, credential_type, bot_id, investment_amount, weight_mode, created_at, updated_at)
          SELECT
            portfolios.owner_id,
            'paper',
            pp.bot_id,
            pp.cost_basis,
            'dollars',
            pp.entry_date,
            unixepoch()
          FROM portfolio_positions pp
          JOIN portfolios ON pp.portfolio_id = portfolios.id
          WHERE pp.exit_date IS NULL
          ON CONFLICT(user_id, credential_type, bot_id) DO UPDATE SET
            investment_amount = excluded.investment_amount,
            updated_at = unixepoch()
        `).run()

        console.log('[live] [MIGRATION] Migration complete - portfolio positions synced to user_bot_investments')
      } else {
        console.log('[live] [MIGRATION] No positions to migrate (all already synced)')
      }
    }
  } catch (e) {
    console.error('[live] [MIGRATION] Migration error:', e.message)
    console.error('[live] [MIGRATION] Stack trace:', e.stack)
  }

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
  const perfStart = Date.now()
  console.log(`[live] [PERF] ===== EXECUTION START =====`)

  try {
    const userId = req.user?.id
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { cashReserve = 0, cashMode = 'dollars', mode = 'execute-paper' } = req.body

    // Validate mode
    if (mode !== 'execute-live' && mode !== 'execute-paper' && mode !== 'simulate') {
      return res.status(400).json({ error: 'Invalid mode. Must be "execute-live", "execute-paper", or "simulate"' })
    }

    // Get credentials based on execution mode
    // Simulate mode uses paper credentials but doesn't execute trades
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

    // Get user's bot investments for this credential type
    const perfInvestmentsStart = Date.now()
    console.log(`[live] [DEBUG] Fetching investments for user ${userId}, credentialType: ${credentialType}`)
    const investments = sqlite.prepare(`
      SELECT bot_id, investment_amount, weight_mode
      FROM user_bot_investments
      WHERE user_id = ? AND credential_type = ? AND investment_amount > 0
    `).all(userId, credentialType)
    console.log(`[live] [PERF] Investment query: ${Date.now() - perfInvestmentsStart}ms`)

    console.log(`[live] [DEBUG] Found ${investments.length} investments:`, investments.map(inv => ({
      botId: inv.bot_id,
      amount: inv.investment_amount,
      weightMode: inv.weight_mode
    })))

    if (investments.length === 0) {
      console.warn(`[live] [DEBUG] No investments found for ${credentialType} trading`)
      return res.status(400).json({ error: `No ${credentialType} investments configured in Dashboard. Add bots to investments first.` })
    }

    // Get account info from broker
    const perfAccountStart = Date.now()
    console.log(`[live] [DEBUG] Creating Alpaca client for ${credentialType}`)
    const client = createAlpacaClient(credentials)
    console.log(`[live] [DEBUG] Fetching account info from Alpaca`)
    const account = await getAccountInfo(client)
    console.log(`[live] [PERF] Account info fetch: ${Date.now() - perfAccountStart}ms`)
    console.log(`[live] [DEBUG] Account info:`, {
      equity: account.equity,
      cash: account.cash,
      buyingPower: account.buyingPower,
      status: account.status
    })

    // Calculate cash reserve
    let reservedCash = 0
    if (cashReserve) {
      if (cashMode === 'percent') {
        reservedCash = account.equity * (cashReserve / 100)
        console.log(`[live] [DEBUG] Cash reserve: ${cashReserve}% of ${account.equity} = $${reservedCash.toFixed(2)}`)
      } else {
        reservedCash = cashReserve
        console.log(`[live] [DEBUG] Cash reserve: $${reservedCash.toFixed(2)} (fixed amount)`)
      }
    } else {
      console.log(`[live] [DEBUG] No cash reserve configured`)
    }
    const adjustedEquity = Math.max(0, account.equity - reservedCash)
    console.log(`[live] [DEBUG] Adjusted equity for trading: $${adjustedEquity.toFixed(2)} (equity ${account.equity.toFixed(2)} - reserve ${reservedCash.toFixed(2)})`)

    // ============================================================
    // STEP 1: Extract all unique tickers from all bots
    // ============================================================
    console.log(`[live] [DEBUG] ===== STEP 1: Extracting tickers from ${investments.length} bots =====`)
    const perfTickerExtractStart = Date.now()
    const allTickers = new Set()
    const botPayloads = new Map() // Cache decompressed payloads

    for (const inv of investments) {
      const botTickerStart = Date.now()
      console.log(`[live] [DEBUG] ----- Extracting tickers from bot ${inv.bot_id} -----`)
      const bot = sqlite.prepare(`
        SELECT id, name, payload FROM bots WHERE id = ?
      `).get(inv.bot_id)

      if (!bot || !bot.payload) {
        console.warn(`[live] [DEBUG] ❌ Bot ${inv.bot_id} not found or has no payload`)
        continue
      }

      console.log(`[live] [DEBUG] Bot name: "${bot.name}"`)
      console.log(`[live] [DEBUG] Investment: $${inv.investment_amount}`)

      try {
        // Decompress and parse payload
        const decompressStart = Date.now()
        const decompressedPayload = await decompressPayload(bot.payload)
        console.log(`[live] [PERF] Decompression: ${Date.now() - decompressStart}ms`)

        const parseStart = Date.now()
        const payload = typeof decompressedPayload === 'string' ? JSON.parse(decompressedPayload) : decompressedPayload
        console.log(`[live] [PERF] JSON parse: ${Date.now() - parseStart}ms`)

        // Cache payload for later use
        botPayloads.set(inv.bot_id, { bot, payload, investment: inv })

        // Track tickers for this bot
        const botTickers = new Set()

        // Extract tickers from node tree (recursive)
        const extractTickers = (node, depth = 0) => {
          if (!node) return

          const indent = '  '.repeat(depth)

          // Extract from positions
          if (node.positions && Array.isArray(node.positions)) {
            for (const pos of node.positions) {
              if (pos.ticker && pos.ticker !== 'Empty') {
                const ticker = pos.ticker.toUpperCase()
                // Handle ratio tickers (e.g., "QQQ/XLU" positions)
                if (ticker.includes('/')) {
                  const [left, right] = ticker.split('/')
                  if (left) {
                    allTickers.add(left.trim())
                    botTickers.add(left.trim())
                  }
                  if (right) {
                    allTickers.add(right.trim())
                    botTickers.add(right.trim())
                  }
                  console.log(`[live] [DEBUG] ${indent}Found position ratio ticker: ${ticker} -> ${left}, ${right}`)
                } else {
                  allTickers.add(ticker)
                  botTickers.add(ticker)
                  console.log(`[live] [DEBUG] ${indent}Found position ticker: ${ticker}`)
                }
              }
            }
          }

          // Extract from conditions (indicators)
          if (node.conditions && Array.isArray(node.conditions)) {
            for (const cond of node.conditions) {
              if (cond.ticker && cond.ticker !== 'Empty') {
                const ticker = cond.ticker.toUpperCase()
                // Handle ratio tickers (e.g., "QQQ/QQQE" for RSI comparisons)
                if (ticker.includes('/')) {
                  const [left, right] = ticker.split('/')
                  if (left) {
                    allTickers.add(left.trim())
                    botTickers.add(left.trim())
                  }
                  if (right) {
                    allTickers.add(right.trim())
                    botTickers.add(right.trim())
                  }
                  console.log(`[live] [DEBUG] ${indent}Found indicator ratio ticker: ${ticker} -> ${left}, ${right}`)
                } else {
                  allTickers.add(ticker)
                  botTickers.add(ticker)
                  console.log(`[live] [DEBUG] ${indent}Found indicator ticker: ${ticker}`)
                }
              }
              if (cond.rightTicker && cond.rightTicker !== 'Empty') {
                const ticker = cond.rightTicker.toUpperCase()
                // Handle ratio tickers in rightTicker as well
                if (ticker.includes('/')) {
                  const [left, right] = ticker.split('/')
                  if (left) {
                    allTickers.add(left.trim())
                    botTickers.add(left.trim())
                  }
                  if (right) {
                    allTickers.add(right.trim())
                    botTickers.add(right.trim())
                  }
                  console.log(`[live] [DEBUG] ${indent}Found indicator rightTicker ratio: ${ticker} -> ${left}, ${right}`)
                } else {
                  allTickers.add(ticker)
                  botTickers.add(ticker)
                  console.log(`[live] [DEBUG] ${indent}Found indicator rightTicker: ${ticker}`)
                }
              }
            }
          }

          // Recursively process children
          if (node.children) {
            for (const slot of Object.keys(node.children)) {
              const childArray = node.children[slot]
              if (Array.isArray(childArray)) {
                for (const child of childArray) {
                  extractTickers(child, depth + 1)
                }
              }
            }
          }
        }

        const extractStart = Date.now()
        extractTickers(payload)
        console.log(`[live] [PERF] Ticker extraction: ${Date.now() - extractStart}ms`)
        console.log(`[live] [DEBUG] ✓ Bot "${bot.name}": extracted ${botTickers.size} unique tickers`)
        console.log(`[live] [DEBUG] Bot tickers: ${Array.from(botTickers).join(', ')}`)
        console.log(`[live] [PERF] Total bot processing: ${Date.now() - botTickerStart}ms`)
      } catch (err) {
        console.error(`[live] [DEBUG] ❌ Failed to extract tickers from bot ${inv.bot_id}:`, err.message)
        console.error(`[live] [DEBUG] Error stack:`, err.stack)
      }
    }

    console.log(`[live] [PERF] Ticker extraction: ${Date.now() - perfTickerExtractStart}ms`)
    console.log(`[live] [DEBUG] Total unique tickers across all bots: ${allTickers.size}`)
    console.log(`[live] [DEBUG] Tickers: ${Array.from(allTickers).join(', ')}`)

    // ============================================================
    // STEP 2: Fetch current prices with Tiingo + Alpaca fallback
    // ============================================================
    console.log(`[live] [DEBUG] ===== STEP 2: Fetching current prices for ${allTickers.size} tickers =====`)
    const perfPriceFetchStart = Date.now()
    const { fetchCurrentPrices, getMetadataSummary } = await import('../live/price-authority.mjs')
    const { prices: currentPrices, metadata: priceMetadata } = await fetchCurrentPrices(
      Array.from(allTickers),
      {
        alpacaClient: client,
        enableAlpacaFallback: true,
        logDegradedMode: true,
      }
    )
    console.log(`[live] [PERF] Current price fetch: ${Date.now() - perfPriceFetchStart}ms`)
    console.log(`[live] [DEBUG] Fetched ${currentPrices.size} current prices`)

    // Get price metadata summary for API response
    const priceMetadataSummary = getMetadataSummary(priceMetadata)

    // ============================================================
    // STEP 3: Run backtests for each bot with current prices
    // ============================================================
    console.log(`[live] [DEBUG] ===== STEP 3: Running backtests with current prices =====`)
    const perfBacktestStart = Date.now()
    const botBreakdown = []
    const mergedAllocations = {}
    let totalInvested = 0

    for (const inv of investments) {
      const perfBotStart = Date.now()
      console.log(`[live] [DEBUG] Processing bot ${inv.bot_id}, investment: $${inv.investment_amount}`)

      // Get cached payload from Step 1
      const cached = botPayloads.get(inv.bot_id)
      if (!cached) {
        console.warn(`[live] [DEBUG] ❌ Bot ${inv.bot_id} not found or failed in Step 1`)
        botBreakdown.push({
          botId: inv.bot_id,
          botName: 'Unknown',
          investment: inv.investment_amount,
          error: 'Bot not found or failed in Step 1',
          allocations: {},
        })
        continue
      }

      const { bot, payload } = cached
      console.log(`[live] [DEBUG] Found bot: "${bot.name}" (${bot.id})`)
      totalInvested += inv.investment_amount

      try {
        // Run backtest with current prices
        console.log(`[live] [DEBUG] Running backtest for bot ${bot.name} with current prices...`)
        const perfRunBacktestStart = Date.now()
        const backtestResult = await runBacktest(payload, {
          mode: 'CC',
          currentPrices  // Pass current prices to backtest
        })
        console.log(`[live] [PERF]   Backtest execution: ${Date.now() - perfRunBacktestStart}ms`)
        console.log(`[live] [DEBUG] Backtest completed for ${bot.name}`, {
          allocationCount: backtestResult.allocations?.length || 0,
          hasAllocations: !!backtestResult.allocations
        })

        // Get the most recent allocation
        const allocations = backtestResult.allocations || []
        const latestAllocation = allocations.length > 0 ? allocations[allocations.length - 1] : null

        // Debug: Log the structure of the latest allocation
        console.log(`[live] [DEBUG] Backtest result structure:`, {
          hasAllocations: !!backtestResult.allocations,
          allocationsLength: allocations.length,
          latestAllocationKeys: latestAllocation ? Object.keys(latestAllocation) : [],
          sampleEntries: latestAllocation?.entries?.slice(0, 3).map(e => `${e.ticker}:${e.weight.toFixed(4)}`)
        })

        // Convert backtest allocation format to object
        // Backtest returns: { date: "2024-01-27", entries: [{ticker: "SPY", weight: 0.5}, ...] }
        // We need: { SPY: 0.5, QQQ: 0.5, ... }
        let currentAlloc = {}
        if (latestAllocation?.entries && Array.isArray(latestAllocation.entries)) {
          for (const entry of latestAllocation.entries) {
            if (entry.ticker && entry.weight > 0) {
              currentAlloc[entry.ticker] = entry.weight
            }
          }
        } else if (latestAllocation?.alloc) {
          // Fallback for old format (backwards compatibility)
          currentAlloc = latestAllocation.alloc
        }
        console.log(`[live] [DEBUG] Raw allocation for ${bot.name}:`, currentAlloc)

        // Filter out "Empty" positions and normalize
        const filteredAlloc = {}
        for (const [ticker, weight] of Object.entries(currentAlloc)) {
          if (ticker !== 'Empty' && weight > 0) {
            filteredAlloc[ticker] = weight
          }
        }
        console.log(`[live] [DEBUG] Filtered allocation for ${bot.name} (removed Empty):`, filteredAlloc)

        botBreakdown.push({
          botId: bot.id,
          botName: bot.name,
          investment: inv.investment_amount,
          date: latestAllocation?.date || new Date().toISOString().split('T')[0],
          allocations: filteredAlloc,
        })

        console.log(`[live] [DEBUG] ✅ Bot ${bot.name} added to breakdown with $${inv.investment_amount} investment`)
        console.log(`[live] [PERF] Bot ${bot.name} total: ${Date.now() - perfBotStart}ms`)
      } catch (err) {
        console.error(`[live] [DEBUG] ❌ Failed to backtest bot ${bot.name}:`, err.message)
        console.log(`[live] [PERF] Bot ${bot.name} (FAILED): ${Date.now() - perfBotStart}ms`)
        botBreakdown.push({
          botId: bot.id,
          botName: bot.name,
          investment: inv.investment_amount,
          error: err.message,
          allocations: {},
        })
      }
    }

    console.log(`[live] [PERF] All backtests: ${Date.now() - perfBacktestStart}ms`)
    console.log(`[live] [DEBUG] Total invested across all bots: $${totalInvested.toFixed(2)}`)
    console.log(`[live] [DEBUG] Bot breakdown summary:`, botBreakdown.map(b => ({
      name: b.botName,
      investment: b.investment,
      tickers: Object.keys(b.allocations),
      hasError: !!b.error
    })))

    // Merge allocations weighted by investment amounts
    const perfMergeStart = Date.now()
    console.log(`[live] [DEBUG] Starting allocation merge process`)
    if (totalInvested > 0) {
      for (const bot of botBreakdown) {
        if (bot.error) {
          console.log(`[live] [DEBUG] Skipping bot ${bot.botName} due to error`)
          continue
        }
        const botWeight = bot.investment / totalInvested
        console.log(`[live] [DEBUG] Bot ${bot.botName}: investment=$${bot.investment}, weight=${(botWeight * 100).toFixed(2)}% of total`)

        for (const [ticker, weight] of Object.entries(bot.allocations)) {
          // weight is already 0-1, multiply by bot's investment weight
          const contribution = weight * botWeight * 100 // Convert to percentage
          const prevValue = mergedAllocations[ticker] || 0
          mergedAllocations[ticker] = prevValue + contribution
          console.log(`[live] [DEBUG]   ${ticker}: bot weight=${(weight * 100).toFixed(2)}%, contribution=${contribution.toFixed(2)}%, new total=${mergedAllocations[ticker].toFixed(2)}%`)
        }
      }
    }

    console.log(`[live] [PERF] Allocation merge: ${Date.now() - perfMergeStart}ms`)
    console.log(`[live] [DEBUG] Merged allocations (final):`, Object.entries(mergedAllocations).map(([ticker, pct]) =>
      `${ticker}: ${pct.toFixed(2)}%`
    ).join(', '))
    const totalAllocationPercent = Object.values(mergedAllocations).reduce((sum, pct) => sum + pct, 0)
    console.log(`[live] [DEBUG] Total allocation percentage: ${totalAllocationPercent.toFixed(2)}%`)

    // Execute live trades with merged allocations
    let executionResult = null
    const mergedTickers = Object.keys(mergedAllocations)

    if (mergedTickers.length > 0) {
      const perfExecutionStart = Date.now()

      // Extract bot IDs from investments for position filtering
      const botIds = investments.map(inv => inv.bot_id)
      console.log(`[live] [DEBUG] Executing for ${botIds.length} bots: ${botIds.join(', ')}`)

      try {
        // Use executeDryRun for simulation mode, executeLiveTrades for actual execution
        if (mode === 'simulate') {
          console.log(`[live] [DEBUG] Running SIMULATION with ${mergedTickers.length} tickers (no orders will be placed)`)
          executionResult = await executeDryRun(credentials, mergedAllocations, {
            userId,
            credentialType,
            botIds,
            investmentAmount: totalInvested,  // Use bot investment amount, not full equity
            cashReserve: 0,  // Cash reserve handled above in adjustedEquity calculation
            cashMode: 'dollars',
          })
        } else {
          console.log(`[live] [DEBUG] Calling executeLiveTrades with ${mergedTickers.length} tickers, investmentAmount=$${totalInvested.toFixed(2)}`)
          executionResult = await executeLiveTrades(credentials, mergedAllocations, {
            userId,
            credentialType,
            botIds,
            investmentAmount: totalInvested,  // Use bot investment amount, not full equity
            cashReserve: 0,  // Cash reserve handled above in adjustedEquity calculation
            cashMode: 'dollars',
          })
        }
        console.log(`[live] [PERF] Trade execution: ${Date.now() - perfExecutionStart}ms`)
        console.log(`[live] [DEBUG] executeLiveTrades returned:`, {
          hasPositions: !!executionResult.positions,
          positionCount: executionResult.positions?.length || 0,
          hasSummary: !!executionResult.summary
        })

        // Log successful execution
        if (mode === 'execute-live') {
          console.log('[live] ✅ LIVE EXECUTION COMPLETED', {
            positionsExecuted: executionResult.positions?.length || 0,
            totalAllocated: executionResult.summary?.totalAllocated || 0,
          })
        } else if (mode === 'simulate') {
          console.log('[live] ✅ SIMULATION COMPLETED (no orders placed)', {
            positionsCalculated: executionResult.positions?.length || 0,
          })
        } else {
          console.log('[live] ✅ Paper execution completed', {
            positionsExecuted: executionResult.positions?.length || 0,
          })
        }

        // Update bot position ledger after successful execution (skip for simulations)
        if (mode !== 'simulate' && executionResult && (mode === 'execute-paper' || mode === 'execute-live')) {
          try {
            console.log('[ledger] [DEBUG] ===== UPDATING BOT POSITION LEDGER =====')

            // Process BUY orders - ADD to ledger
            if (executionResult.buys && Array.isArray(executionResult.buys)) {
              for (const buy of executionResult.buys) {
                if (!buy.success || !buy.id) continue

                try {
                  // Fetch actual fill details from Alpaca
                  const order = await client.getOrder(buy.id)

                  if (order.status === 'filled') {
                    const filledShares = parseFloat(order.filled_qty)
                    const avgFillPrice = parseFloat(order.filled_avg_price)
                    const botId = investments[0].bot_id

                    console.log(`[ledger] [DEBUG] ADD: bot=${botId}, symbol=${buy.symbol}, shares=${filledShares.toFixed(4)}, price=$${avgFillPrice.toFixed(2)}`)

                    // Insert or update ledger entry
                    sqlite.prepare(`
                      INSERT INTO bot_position_ledger
                        (user_id, credential_type, bot_id, symbol, shares, avg_price, last_updated)
                      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
                      ON CONFLICT(user_id, credential_type, bot_id, symbol) DO UPDATE SET
                        shares = shares + excluded.shares,
                        avg_price = ((bot_position_ledger.shares * bot_position_ledger.avg_price) + (excluded.shares * excluded.avg_price)) / (bot_position_ledger.shares + excluded.shares),
                        last_updated = datetime('now')
                    `).run(userId, credentialType, botId, buy.symbol, filledShares, avgFillPrice)
                  }
                } catch (err) {
                  console.warn(`[ledger] [DEBUG] Failed to update ledger for buy ${buy.symbol}: ${err.message}`)
                }
              }
            }

            // Process SELL orders - SUBTRACT from ledger
            if (executionResult.sells && Array.isArray(executionResult.sells)) {
              for (const sell of executionResult.sells) {
                if (!sell.success || !sell.id) continue

                try {
                  const order = await client.getOrder(sell.id)

                  if (order.status === 'filled') {
                    const filledShares = parseFloat(order.filled_qty)
                    const botId = investments[0].bot_id

                    console.log(`[ledger] [DEBUG] SUBTRACT: bot=${botId}, symbol=${sell.symbol}, shares=${filledShares.toFixed(4)}`)

                    // Subtract shares from ledger
                    sqlite.prepare(`
                      UPDATE bot_position_ledger
                      SET shares = shares - ?,
                          last_updated = datetime('now')
                      WHERE user_id = ? AND credential_type = ? AND bot_id = ? AND symbol = ?
                    `).run(filledShares, userId, credentialType, botId, sell.symbol)

                    // Clean up zero-share positions
                    sqlite.prepare(`
                      DELETE FROM bot_position_ledger
                      WHERE user_id = ? AND credential_type = ? AND bot_id = ? AND symbol = ?
                        AND shares < 0.0001
                    `).run(userId, credentialType, botId, sell.symbol)
                  }
                } catch (err) {
                  console.warn(`[ledger] [DEBUG] Failed to update ledger for sell ${sell.symbol}: ${err.message}`)
                }
              }
            }

            console.log('[ledger] [DEBUG] Bot position ledger updated successfully')
          } catch (ledgerErr) {
            console.error('[ledger] [ERROR] Ledger update failed:', ledgerErr.message)
            // Don't fail the execution if ledger update fails - just log it
          }
        }
      } catch (err) {
        console.error(`[live] executeLiveTrades (${mode}) failed:`, err.message)
        if (mode === 'execute-live') {
          console.error('[live] ❌ LIVE EXECUTION FAILED:', err)
        }
        throw err // Re-throw to be caught by outer try-catch
      }
    }

    // Build response - transform buy/sell results into positions format
    const positions = []

    // Add buy orders to positions
    if (executionResult?.buys) {
      for (const buy of executionResult.buys) {
        const allocation = mergedAllocations[buy.symbol] || 0
        positions.push({
          ticker: buy.symbol,
          targetPercent: allocation,
          price: buy.estimatedPrice || null,
          notional: buy.notional,
          shares: buy.estimatedShares || null,
          value: buy.notional,
          orderId: buy.id,
          status: buy.status || (buy.success ? 'filled' : 'failed'),
          error: buy.error,
          skipped: buy.skipped,
          reason: buy.reason,
        })
      }
    }

    const validPositions = positions.filter(p => p.notional > 0 && !p.error)

    const perfTotal = Date.now() - perfStart
    console.log(`[live] [PERF] ===== TOTAL EXECUTION TIME: ${perfTotal}ms =====`)

    res.json({
      mode: mode, // 'execute-live' or 'execute-paper'
      executionMode: mode, // For clarity in frontend
      executedAt: new Date().toISOString(),
      timestamp: new Date().toISOString(),
      usedLivePrices: false, // Backtests use Tiingo data, only order execution uses Alpaca prices
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
        notional: p.notional, // Dollar amount for notional orders
        shares: p.shares, // Estimated fractional shares (may be null)
        value: p.value || p.notional,
        skipped: p.skipped,
        reason: p.reason,
        error: p.error,
        orderId: p.orderId,
        status: p.status,
      })),
      summary: {
        totalAllocated: executionResult?.summary?.totalAllocated || 0,
        unallocated: executionResult?.summary?.unallocated || adjustedEquity,
        allocationPercent: executionResult?.summary?.allocationPercent || 0,
        positionCount: validPositions.length,
      },
      priceMetadata: priceMetadataSummary, // Price source quality info for frontend indicator
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
    let errorMessage = null
    try {
      const credentials = getDecryptedCredentials(userId, credentialType)
      if (credentials) {
        const client = createAlpacaClient(credentials)
        const result = await testConnection(client)
        isConnected = result.success

        if (!result.success) {
          errorMessage = result.error
          console.warn(`[live] Connection test failed for user ${userId} (${credentialType}):`, result.error)
        } else {
          console.log(`[live] Connection test succeeded for user ${userId} (${credentialType})`)
        }
      } else {
        errorMessage = 'Failed to decrypt credentials'
        console.warn(`[live] Could not decrypt credentials for user ${userId} (${credentialType})`)
      }
    } catch (error) {
      isConnected = false
      errorMessage = error.message || 'Unknown error'
      console.error(`[live] Exception during connection test for user ${userId} (${credentialType}):`, error)
    }

    res.json({
      hasCredentials: true,
      isPaper: credentialType === 'paper',
      isConnected,
      mode: credentialType,
      updatedAt: row.updated_at,
      errorMessage: !isConnected ? errorMessage : undefined,
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

/**
 * GET /api/admin/trading/bot-positions/:botId
 * Get positions owned by a specific bot from the ledger
 */
router.get('/trading/bot-positions/:botId', async (req, res) => {
  try {
    const userId = req.user?.id
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { botId } = req.params
    const { credentialType = 'paper' } = req.query

    if (!botId || isNaN(parseInt(botId))) {
      return res.status(400).json({ error: 'Invalid bot ID' })
    }

    // Fetch ledger positions for this bot
    const positions = sqlite.prepare(`
      SELECT
        bpl.symbol,
        bpl.shares,
        bpl.avg_price as avgPrice,
        bpl.last_updated as lastUpdated
      FROM bot_position_ledger bpl
      WHERE bpl.user_id = ? AND bpl.credential_type = ? AND bpl.bot_id = ?
        AND bpl.shares > 0.0001
      ORDER BY bpl.symbol ASC
    `).all(userId, credentialType, parseInt(botId))

    // Get current prices from Alpaca
    const client = await createAlpacaClient(userId, credentialType)
    const alpacaPositions = await getPositions(client)
    const priceMap = {}
    for (const pos of alpacaPositions) {
      priceMap[pos.symbol] = parseFloat(pos.currentPrice)
    }

    // Enrich with current prices and market values
    const enrichedPositions = positions.map(pos => {
      const currentPrice = priceMap[pos.symbol] || pos.avgPrice
      const marketValue = pos.shares * currentPrice
      const unrealizedPl = pos.shares * (currentPrice - pos.avgPrice)

      return {
        symbol: pos.symbol,
        shares: pos.shares,
        avgPrice: pos.avgPrice,
        currentPrice,
        marketValue,
        unrealizedPl,
        lastUpdated: pos.lastUpdated
      }
    })

    const totalValue = enrichedPositions.reduce((sum, p) => sum + p.marketValue, 0)

    res.json({
      positions: enrichedPositions,
      totalValue
    })
  } catch (error) {
    console.error('[bot-positions] Error fetching bot positions:', error)
    res.status(500).json({ error: error.message || 'Failed to fetch bot positions' })
  }
})

/**
 * POST /api/admin/trading/assign-positions
 * Assign unallocated positions to a bot (one-time migration)
 * Body: { botId: number, positions: [{ symbol: string, shares: number }], credentialType: 'paper' | 'live' }
 */
router.post('/trading/assign-positions', async (req, res) => {
  try {
    const userId = req.user?.id
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { botId, positions, credentialType = 'paper' } = req.body

    if (!botId || isNaN(parseInt(botId))) {
      return res.status(400).json({ error: 'Invalid bot ID' })
    }

    if (!positions || !Array.isArray(positions) || positions.length === 0) {
      return res.status(400).json({ error: 'Positions array required' })
    }

    // Verify bot exists and user has access
    const bot = sqlite.prepare(`
      SELECT id, name FROM bots WHERE id = ? AND user_id = ?
    `).get(parseInt(botId), userId)

    if (!bot) {
      return res.status(404).json({ error: 'Bot not found or access denied' })
    }

    console.log(`[assign-positions] Assigning ${positions.length} positions to bot ${bot.name} (ID: ${botId})`)

    // Get current Alpaca positions to verify shares and get avg prices
    const client = await createAlpacaClient(userId, credentialType)
    const alpacaPositions = await getPositions(client)
    const alpacaBySymbol = {}
    for (const pos of alpacaPositions) {
      alpacaBySymbol[pos.symbol] = pos
    }

    // Insert positions into ledger
    const insertStmt = sqlite.prepare(`
      INSERT INTO bot_position_ledger
        (user_id, credential_type, bot_id, symbol, shares, avg_price, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id, credential_type, bot_id, symbol) DO UPDATE SET
        shares = excluded.shares,
        avg_price = excluded.avg_price,
        last_updated = datetime('now')
    `)

    let assigned = 0
    const errors = []

    for (const pos of positions) {
      const alpacaPos = alpacaBySymbol[pos.symbol]
      if (!alpacaPos) {
        console.warn(`[assign-positions] Position ${pos.symbol} not found in Alpaca account`)
        errors.push(`${pos.symbol}: not found in account`)
        continue
      }

      const shares = parseFloat(pos.shares)
      if (isNaN(shares) || shares <= 0) {
        errors.push(`${pos.symbol}: invalid share count`)
        continue
      }

      // Verify user isn't trying to assign more shares than they own
      if (shares > parseFloat(alpacaPos.qty)) {
        errors.push(`${pos.symbol}: requested ${shares} shares but only ${alpacaPos.qty} available`)
        continue
      }

      const avgPrice = parseFloat(alpacaPos.avgEntryPrice || alpacaPos.currentPrice)

      try {
        insertStmt.run(userId, credentialType, parseInt(botId), pos.symbol, shares, avgPrice)
        console.log(`[assign-positions] ✅ Assigned ${shares.toFixed(4)} shares of ${pos.symbol} to bot ${botId}`)
        assigned++
      } catch (err) {
        console.error(`[assign-positions] Failed to assign ${pos.symbol}:`, err.message)
        errors.push(`${pos.symbol}: ${err.message}`)
      }
    }

    res.json({
      success: true,
      assigned,
      total: positions.length,
      botName: bot.name,
      errors: errors.length > 0 ? errors : undefined,
      message: `Assigned ${assigned}/${positions.length} positions to ${bot.name}`
    })
  } catch (error) {
    console.error('[assign-positions] Error:', error)
    res.status(500).json({ error: error.message || 'Failed to assign positions' })
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
        order_type: 'market',
        limit_percent: 1.0,
        max_allocation_percent: 100.0,
        fallback_ticker: 'SGOV',
        cash_reserve_mode: 'dollars',
        cash_reserve_amount: 0,
        minutes_before_close: 10,
        paired_tickers: '',
        enabled: 0,
        market_hours_check_hour: 4,
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
      marketHoursCheckHour: settings.market_hours_check_hour ?? 4,
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
      marketHoursCheckHour,
    } = req.body

    // Serialize paired tickers to JSON
    const pairedTickersJson = pairedTickers ? JSON.stringify(pairedTickers) : ''

    sqlite.prepare(`
      INSERT INTO trading_settings (
        user_id, order_type, limit_percent, max_allocation_percent, fallback_ticker,
        cash_reserve_mode, cash_reserve_amount, minutes_before_close, paired_tickers, enabled,
        market_hours_check_hour
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        order_type = excluded.order_type,
        limit_percent = excluded.limit_percent,
        max_allocation_percent = excluded.max_allocation_percent,
        fallback_ticker = excluded.fallback_ticker,
        cash_reserve_mode = excluded.cash_reserve_mode,
        cash_reserve_amount = excluded.cash_reserve_amount,
        minutes_before_close = excluded.minutes_before_close,
        paired_tickers = excluded.paired_tickers,
        enabled = excluded.enabled,
        market_hours_check_hour = excluded.market_hours_check_hour
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
      enabled ? 1 : 0,
      marketHoursCheckHour ?? 4
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
        order_type: 'market',
        limit_percent: 1.0,
        max_allocation_percent: 100.0,
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

    // Extract bot IDs for position filtering
    const botIds = investmentRows.map(row => row.bot_id).filter(Boolean)
    console.log(`[live] [DEBUG] Executing for ${botIds.length} bots: ${botIds.join(', ')}`)

    if (dryRun) {
      // Dry run - calculate what would happen
      result = await executeDryRun(credentials, allocations, {
        userId,
        credentialType,
        botIds,
        cashReserve: reservedCash,
        cashMode: 'dollars',
      })
      result.dryRun = true
    } else {
      // Live execution
      result = await executeLiveTrades(credentials, allocations, {
        userId,
        credentialType,
        botIds,
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
