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
import { createAlpacaClient, testConnection, getAccountInfo, getLatestPrices } from '../live/broker-alpaca.mjs'
import { executeDryRun } from '../live/trade-executor.mjs'
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

// Ensure broker_credentials table exists
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS broker_credentials (
    user_id TEXT PRIMARY KEY,
    encrypted_api_key TEXT NOT NULL,
    encrypted_api_secret TEXT NOT NULL,
    iv TEXT NOT NULL,
    auth_tag TEXT NOT NULL,
    is_paper INTEGER DEFAULT 1,
    base_url TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  )
`)

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
 * Get broker credentials status (not the actual credentials)
 */
router.get('/broker/credentials', (req, res) => {
  try {
    const userId = req.user?.id
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const row = sqlite.prepare(`
      SELECT is_paper, base_url, updated_at
      FROM broker_credentials
      WHERE user_id = ?
    `).get(userId)

    if (!row) {
      return res.json({
        hasCredentials: false,
        isPaper: true,
        baseUrl: 'https://paper-api.alpaca.markets',
      })
    }

    res.json({
      hasCredentials: true,
      isPaper: row.is_paper === 1,
      baseUrl: row.base_url || (row.is_paper === 1 ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets'),
      updatedAt: row.updated_at,
    })
  } catch (error) {
    console.error('[live] Error getting broker credentials:', error)
    res.status(500).json({ error: 'Failed to get broker credentials' })
  }
})

/**
 * POST /api/admin/broker/credentials
 * Save broker credentials (encrypted)
 */
router.post('/broker/credentials', (req, res) => {
  try {
    const userId = req.user?.id
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { apiKey, apiSecret, isPaper } = req.body
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: 'API Key and Secret are required' })
    }

    // Encrypt credentials
    const encryptedKey = encrypt(apiKey)
    const encryptedSecret = encrypt(apiSecret)
    const baseUrl = isPaper !== false ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets'

    // Upsert credentials
    sqlite.prepare(`
      INSERT INTO broker_credentials (user_id, encrypted_api_key, encrypted_api_secret, iv, auth_tag, is_paper, base_url, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(user_id) DO UPDATE SET
        encrypted_api_key = excluded.encrypted_api_key,
        encrypted_api_secret = excluded.encrypted_api_secret,
        iv = excluded.iv,
        auth_tag = excluded.auth_tag,
        is_paper = excluded.is_paper,
        base_url = excluded.base_url,
        updated_at = unixepoch()
    `).run(
      userId,
      encryptedKey.encrypted,
      encryptedSecret.encrypted,
      encryptedKey.iv + ':' + encryptedSecret.iv,  // Store both IVs
      encryptedKey.authTag + ':' + encryptedSecret.authTag,  // Store both auth tags
      isPaper !== false ? 1 : 0,
      baseUrl
    )

    res.json({ success: true })
  } catch (error) {
    console.error('[live] Error saving broker credentials:', error)
    res.status(500).json({ error: 'Failed to save broker credentials' })
  }
})

/**
 * Get decrypted credentials for a user
 */
function getDecryptedCredentials(userId) {
  const row = sqlite.prepare(`
    SELECT encrypted_api_key, encrypted_api_secret, iv, auth_tag, is_paper, base_url
    FROM broker_credentials
    WHERE user_id = ?
  `).get(userId)

  if (!row) return null

  const [ivKey, ivSecret] = row.iv.split(':')
  const [authTagKey, authTagSecret] = row.auth_tag.split(':')

  return {
    apiKey: decrypt(row.encrypted_api_key, ivKey, authTagKey),
    apiSecret: decrypt(row.encrypted_api_secret, ivSecret, authTagSecret),
    isPaper: row.is_paper === 1,
    baseUrl: row.base_url,
  }
}

/**
 * POST /api/admin/broker/test
 * Test broker connection
 */
router.post('/broker/test', async (req, res) => {
  try {
    const userId = req.user?.id
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const credentials = getDecryptedCredentials(userId)
    if (!credentials) {
      return res.status(400).json({ error: 'No broker credentials saved' })
    }

    const client = createAlpacaClient(credentials)
    const result = await testConnection(client)

    if (!result.success) {
      return res.status(400).json({ error: result.error })
    }

    res.json({
      success: true,
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
 * Execute a dry run simulation using current fund allocations
 * Runs backtest on each fund slot bot to get current-day allocations,
 * merges them weighted by investment amounts, then simulates trades.
 */
router.post('/live/dry-run', async (req, res) => {
  try {
    const userId = req.user?.id
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { cashReserve = 0, cashMode = 'dollars' } = req.body

    // Get broker credentials
    const credentials = getDecryptedCredentials(userId)
    if (!credentials) {
      return res.status(400).json({ error: 'No broker credentials saved' })
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

    // Execute dry run with merged allocations
    let dryRunResult = null
    const allTickers = Object.keys(mergedAllocations)

    if (allTickers.length > 0) {
      try {
        dryRunResult = await executeDryRun(credentials, mergedAllocations, {
          cashReserve: reservedCash,
          cashMode: 'dollars', // Already converted
        })
      } catch (err) {
        console.error('[live] executeDryRun failed:', err.message)
      }
    }

    // Build response
    const positions = dryRunResult?.positions || []
    const validPositions = positions.filter(p => p.shares > 0)

    res.json({
      mode: 'dry_run',
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
      })),
      summary: {
        totalAllocated: dryRunResult?.summary?.totalAllocated || 0,
        unallocated: dryRunResult?.summary?.unallocated || adjustedEquity,
        allocationPercent: dryRunResult?.summary?.allocationPercent || 0,
        positionCount: validPositions.length,
      },
    })
  } catch (error) {
    console.error('[live] Error executing dry run:', error)
    res.status(500).json({ error: error.message || 'Dry run failed' })
  }
})

export default router
