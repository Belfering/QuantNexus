import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema.js'
import path from 'path'
import { fileURLToPath } from 'url'
import { eq, desc, and, isNull, sql } from 'drizzle-orm'
import crypto from 'crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Database file path
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'atlas.db')

// Ensure data directory exists
import fs from 'fs'
const dataDir = path.dirname(DB_PATH)
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

// Create SQLite connection
const sqlite = new Database(DB_PATH)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

// Create Drizzle instance
export const db = drizzle(sqlite, { schema })

// ============================================
// INITIALIZATION - Create tables
// ============================================
export function initializeDatabase() {
  // Create tables if they don't exist
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      role TEXT DEFAULT 'user',
      is_partner_eligible INTEGER DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER,
      last_login_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS bots (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      visibility TEXT DEFAULT 'private',
      tags TEXT,
      payload TEXT NOT NULL,
      fund_slot INTEGER,
      created_at INTEGER,
      updated_at INTEGER,
      published_at INTEGER,
      deleted_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS bot_metrics (
      bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
      cagr REAL,
      max_drawdown REAL,
      calmar_ratio REAL,
      sharpe_ratio REAL,
      sortino_ratio REAL,
      treynor_ratio REAL,
      volatility REAL,
      win_rate REAL,
      avg_turnover REAL,
      avg_holdings REAL,
      trading_days INTEGER,
      backtest_start_date TEXT,
      backtest_end_date TEXT,
      last_backtest_at INTEGER,
      cagr_rank INTEGER,
      calmar_rank INTEGER,
      sharpe_rank INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS bot_equity_curves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      equity REAL NOT NULL,
      drawdown REAL
    );

    CREATE TABLE IF NOT EXISTS watchlists (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS watchlist_bots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      watchlist_id TEXT NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      added_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS portfolios (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      cash_balance REAL DEFAULT 100000,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS portfolio_positions (
      id TEXT PRIMARY KEY,
      portfolio_id TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
      bot_id TEXT NOT NULL REFERENCES bots(id),
      cost_basis REAL NOT NULL,
      shares REAL NOT NULL,
      entry_date INTEGER,
      exit_date INTEGER,
      exit_value REAL
    );

    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      theme TEXT DEFAULT 'dark',
      color_scheme TEXT DEFAULT 'sapphire',
      ui_state TEXT,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS eligibility_requirements (
      id TEXT PRIMARY KEY,
      metric TEXT NOT NULL,
      comparison TEXT NOT NULL,
      value REAL NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS admin_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER,
      updated_by TEXT REFERENCES users(id)
    );

    -- Indexes for performance
    CREATE INDEX IF NOT EXISTS idx_bots_owner ON bots(owner_id);
    CREATE INDEX IF NOT EXISTS idx_bots_visibility ON bots(visibility);
    CREATE INDEX IF NOT EXISTS idx_bots_nexus ON bots(visibility, deleted_at) WHERE visibility = 'nexus';
    CREATE INDEX IF NOT EXISTS idx_metrics_cagr ON bot_metrics(cagr DESC);
    CREATE INDEX IF NOT EXISTS idx_metrics_calmar ON bot_metrics(calmar_ratio DESC);
    CREATE INDEX IF NOT EXISTS idx_metrics_sharpe ON bot_metrics(sharpe_ratio DESC);
    CREATE INDEX IF NOT EXISTS idx_watchlists_owner ON watchlists(owner_id);
    CREATE INDEX IF NOT EXISTS idx_positions_portfolio ON portfolio_positions(portfolio_id);
    CREATE INDEX IF NOT EXISTS idx_equity_bot ON bot_equity_curves(bot_id, date);
  `)

  // Seed default admin config
  const existingConfig = sqlite.prepare('SELECT key FROM admin_config WHERE key = ?').get('atlas_fee_percent')
  if (!existingConfig) {
    const now = Date.now()
    sqlite.prepare('INSERT INTO admin_config (key, value, updated_at) VALUES (?, ?, ?)').run('atlas_fee_percent', '1.0', now)
    sqlite.prepare('INSERT INTO admin_config (key, value, updated_at) VALUES (?, ?, ?)').run('partner_share_percent', '1.0', now)
  }

  // Seed default users (1, 3, 5, 7, 9, admin)
  const defaultUsers = [
    { id: '1', username: '1', passwordHash: '1', displayName: 'User 1', role: 'partner' },
    { id: '3', username: '3', passwordHash: '3', displayName: 'User 3', role: 'partner' },
    { id: '5', username: '5', passwordHash: '5', displayName: 'User 5', role: 'partner' },
    { id: '7', username: '7', passwordHash: '7', displayName: 'User 7', role: 'partner' },
    { id: '9', username: '9', passwordHash: '9', displayName: 'User 9', role: 'partner' },
    { id: 'admin', username: 'admin', passwordHash: 'admin', displayName: 'Administrator', role: 'admin' },
  ]

  const insertUser = sqlite.prepare(`
    INSERT OR IGNORE INTO users (id, username, password_hash, display_name, role, is_partner_eligible, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertPortfolio = sqlite.prepare(`
    INSERT OR IGNORE INTO portfolios (id, owner_id, cash_balance, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `)

  const insertWatchlist = sqlite.prepare(`
    INSERT OR IGNORE INTO watchlists (id, owner_id, name, is_default, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  const insertPreferences = sqlite.prepare(`
    INSERT OR IGNORE INTO user_preferences (user_id, theme, color_scheme, ui_state, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `)

  const now = Date.now()
  for (const user of defaultUsers) {
    insertUser.run(user.id, user.username, user.passwordHash, user.displayName, user.role, user.role === 'partner' ? 1 : 0, now, now)
    insertPortfolio.run(`portfolio-${user.id}`, user.id, 100000, now, now)
    insertWatchlist.run(`watchlist-${user.id}-default`, user.id, 'My Watchlist', 1, now, now)
    insertPreferences.run(user.id, 'dark', 'sapphire', '{}', now)
  }

  console.log('[DB] Database initialized')
}

// ============================================
// HELPER FUNCTIONS
// ============================================
export function generateId(): string {
  return crypto.randomUUID()
}

// ============================================
// USER OPERATIONS
// ============================================
export async function getUserById(id: string) {
  return db.query.users.findFirst({
    where: eq(schema.users.id, id),
  })
}

export async function getUserByUsername(username: string) {
  return db.query.users.findFirst({
    where: eq(schema.users.username, username),
  })
}

export async function validateUser(username: string, password: string) {
  const user = await getUserByUsername(username)
  if (!user) return null
  // Simple password check (in production, use bcrypt)
  if (user.passwordHash !== password) return null
  // Update last login
  await db.update(schema.users)
    .set({ lastLoginAt: new Date() })
    .where(eq(schema.users.id, user.id))
  return user
}

// ============================================
// BOT OPERATIONS
// ============================================
export async function getBotById(id: string, includePayload = false) {
  const bot = await db.query.bots.findFirst({
    where: and(eq(schema.bots.id, id), isNull(schema.bots.deletedAt)),
    with: {
      metrics: true,
      owner: true,
    },
  })
  if (!bot) return null
  if (!includePayload) {
    return { ...bot, payload: undefined }
  }
  return bot
}

export async function getBotsByOwner(ownerId: string) {
  return db.query.bots.findMany({
    where: and(eq(schema.bots.ownerId, ownerId), isNull(schema.bots.deletedAt)),
    with: { metrics: true },
    orderBy: desc(schema.bots.createdAt),
  })
}

export async function getNexusBots() {
  // Get all Nexus bots (visibility = 'nexus') - NO payload for security
  const bots = await db.query.bots.findMany({
    where: and(
      eq(schema.bots.visibility, 'nexus'),
      isNull(schema.bots.deletedAt)
    ),
    with: {
      metrics: true,
      owner: {
        columns: {
          id: true,
          displayName: true,
        },
      },
    },
    orderBy: desc(schema.bots.createdAt),
  })

  // Strip payload from all results (IP protection)
  return bots.map(bot => ({
    ...bot,
    payload: undefined,
  }))
}

export async function getTopNexusBotsByCagr(limit = 10) {
  const result = sqlite.prepare(`
    SELECT b.id, b.owner_id, b.name, b.visibility, b.fund_slot, b.tags, b.created_at,
           u.display_name as owner_display_name,
           m.cagr, m.max_drawdown, m.calmar_ratio, m.sharpe_ratio, m.sortino_ratio,
           m.treynor_ratio, m.volatility, m.win_rate, m.trading_days
    FROM bots b
    JOIN users u ON b.owner_id = u.id
    LEFT JOIN bot_metrics m ON b.id = m.bot_id
    WHERE b.visibility = 'nexus' AND b.deleted_at IS NULL
    ORDER BY m.cagr DESC NULLS LAST
    LIMIT ?
  `).all(limit)
  return result
}

export async function getTopNexusBotsByCalmar(limit = 10) {
  const result = sqlite.prepare(`
    SELECT b.id, b.owner_id, b.name, b.visibility, b.fund_slot, b.tags, b.created_at,
           u.display_name as owner_display_name,
           m.cagr, m.max_drawdown, m.calmar_ratio, m.sharpe_ratio, m.sortino_ratio,
           m.treynor_ratio, m.volatility, m.win_rate, m.trading_days
    FROM bots b
    JOIN users u ON b.owner_id = u.id
    LEFT JOIN bot_metrics m ON b.id = m.bot_id
    WHERE b.visibility = 'nexus' AND b.deleted_at IS NULL
    ORDER BY m.calmar_ratio DESC NULLS LAST
    LIMIT ?
  `).all(limit)
  return result
}

export async function getTopNexusBotsBySharpe(limit = 10) {
  const result = sqlite.prepare(`
    SELECT b.id, b.owner_id, b.name, b.visibility, b.fund_slot, b.tags, b.created_at,
           u.display_name as owner_display_name,
           m.cagr, m.max_drawdown, m.calmar_ratio, m.sharpe_ratio, m.sortino_ratio,
           m.treynor_ratio, m.volatility, m.win_rate, m.trading_days
    FROM bots b
    JOIN users u ON b.owner_id = u.id
    LEFT JOIN bot_metrics m ON b.id = m.bot_id
    WHERE b.visibility = 'nexus' AND b.deleted_at IS NULL
    ORDER BY m.sharpe_ratio DESC NULLS LAST
    LIMIT ?
  `).all(limit)
  return result
}

export async function createBot(data: {
  ownerId: string
  name: string
  payload: string
  visibility?: string
  tags?: string[]
  fundSlot?: number
}) {
  const id = generateId()
  const now = new Date()

  await db.insert(schema.bots).values({
    id,
    ownerId: data.ownerId,
    name: data.name,
    payload: data.payload,
    visibility: (data.visibility as 'private' | 'nexus_eligible' | 'nexus' | 'atlas') || 'private',
    tags: data.tags ? JSON.stringify(data.tags) : null,
    fundSlot: data.fundSlot,
    createdAt: now,
    updatedAt: now,
  })

  return id
}

export async function updateBot(id: string, ownerId: string, data: Partial<{
  name: string
  payload: string
  visibility: string
  tags: string[]
  fundSlot: number | null
}>) {
  // Verify ownership
  const bot = await db.query.bots.findFirst({
    where: and(eq(schema.bots.id, id), eq(schema.bots.ownerId, ownerId)),
  })
  if (!bot) return null

  const updateData: Record<string, unknown> = { updatedAt: new Date() }
  if (data.name !== undefined) updateData.name = data.name
  if (data.payload !== undefined) updateData.payload = data.payload
  if (data.visibility !== undefined) updateData.visibility = data.visibility
  if (data.tags !== undefined) updateData.tags = JSON.stringify(data.tags)
  if (data.fundSlot !== undefined) updateData.fundSlot = data.fundSlot

  await db.update(schema.bots)
    .set(updateData)
    .where(eq(schema.bots.id, id))

  return id
}

export async function deleteBot(id: string, ownerId: string) {
  // Soft delete
  const result = await db.update(schema.bots)
    .set({ deletedAt: new Date() })
    .where(and(eq(schema.bots.id, id), eq(schema.bots.ownerId, ownerId)))
  return result.changes > 0
}

export async function updateBotMetrics(botId: string, metrics: {
  cagr?: number
  maxDrawdown?: number
  calmarRatio?: number
  sharpeRatio?: number
  sortinoRatio?: number
  treynorRatio?: number
  volatility?: number
  winRate?: number
  avgTurnover?: number
  avgHoldings?: number
  tradingDays?: number
  backtestStartDate?: string
  backtestEndDate?: string
}) {
  const existing = await db.query.botMetrics.findFirst({
    where: eq(schema.botMetrics.botId, botId),
  })

  const now = new Date()
  if (existing) {
    await db.update(schema.botMetrics)
      .set({ ...metrics, lastBacktestAt: now, updatedAt: now })
      .where(eq(schema.botMetrics.botId, botId))
  } else {
    await db.insert(schema.botMetrics).values({
      botId,
      ...metrics,
      lastBacktestAt: now,
      updatedAt: now,
    })
  }
}

// ============================================
// WATCHLIST OPERATIONS
// ============================================
export async function getWatchlistsByOwner(ownerId: string) {
  return db.query.watchlists.findMany({
    where: eq(schema.watchlists.ownerId, ownerId),
    with: {
      bots: {
        with: {
          bot: {
            with: { metrics: true },
          },
        },
      },
    },
  })
}

export async function addBotToWatchlist(watchlistId: string, botId: string) {
  // Check if already exists
  const existing = sqlite.prepare(
    'SELECT id FROM watchlist_bots WHERE watchlist_id = ? AND bot_id = ?'
  ).get(watchlistId, botId)
  if (existing) return false

  await db.insert(schema.watchlistBots).values({
    watchlistId,
    botId,
    addedAt: new Date(),
  })
  return true
}

export async function removeBotFromWatchlist(watchlistId: string, botId: string) {
  const result = sqlite.prepare(
    'DELETE FROM watchlist_bots WHERE watchlist_id = ? AND bot_id = ?'
  ).run(watchlistId, botId)
  return result.changes > 0
}

// ============================================
// PORTFOLIO OPERATIONS
// ============================================
export async function getPortfolio(ownerId: string) {
  return db.query.portfolios.findFirst({
    where: eq(schema.portfolios.ownerId, ownerId),
    with: {
      positions: {
        where: isNull(schema.portfolioPositions.exitDate),
        with: {
          bot: {
            with: { metrics: true },
          },
        },
      },
    },
  })
}

export async function buyBot(ownerId: string, botId: string, amount: number) {
  const portfolio = await db.query.portfolios.findFirst({
    where: eq(schema.portfolios.ownerId, ownerId),
  })
  if (!portfolio) throw new Error('Portfolio not found')
  if (portfolio.cashBalance! < amount) throw new Error('Insufficient cash')
  if (amount < 100) throw new Error('Minimum investment is $100')

  // Check if already has position
  const existingPosition = sqlite.prepare(`
    SELECT id, cost_basis, shares FROM portfolio_positions
    WHERE portfolio_id = ? AND bot_id = ? AND exit_date IS NULL
  `).get(portfolio.id, botId) as { id: string, cost_basis: number, shares: number } | undefined

  const now = new Date()

  if (existingPosition) {
    // Add to existing position
    await db.update(schema.portfolioPositions)
      .set({
        costBasis: existingPosition.cost_basis + amount,
        shares: existingPosition.shares + amount, // 1:1 for simplicity
        entryDate: now,
      })
      .where(eq(schema.portfolioPositions.id, existingPosition.id))
  } else {
    // Create new position
    await db.insert(schema.portfolioPositions).values({
      id: generateId(),
      portfolioId: portfolio.id,
      botId,
      costBasis: amount,
      shares: amount, // 1:1 for simplicity
      entryDate: now,
    })
  }

  // Deduct cash
  await db.update(schema.portfolios)
    .set({
      cashBalance: portfolio.cashBalance! - amount,
      updatedAt: now,
    })
    .where(eq(schema.portfolios.id, portfolio.id))

  return true
}

export async function sellBot(ownerId: string, botId: string, amount: number) {
  const portfolio = await db.query.portfolios.findFirst({
    where: eq(schema.portfolios.ownerId, ownerId),
  })
  if (!portfolio) throw new Error('Portfolio not found')

  const position = sqlite.prepare(`
    SELECT id, cost_basis, shares FROM portfolio_positions
    WHERE portfolio_id = ? AND bot_id = ? AND exit_date IS NULL
  `).get(portfolio.id, botId) as { id: string, cost_basis: number, shares: number } | undefined

  if (!position) throw new Error('No position found')
  if (amount > position.shares) throw new Error('Insufficient shares')

  const now = new Date()

  if (amount >= position.shares) {
    // Full sell - close position
    await db.update(schema.portfolioPositions)
      .set({
        exitDate: now,
        exitValue: amount,
      })
      .where(eq(schema.portfolioPositions.id, position.id))
  } else {
    // Partial sell
    const remainingShares = position.shares - amount
    const remainingCostBasis = position.cost_basis * (remainingShares / position.shares)
    await db.update(schema.portfolioPositions)
      .set({
        costBasis: remainingCostBasis,
        shares: remainingShares,
      })
      .where(eq(schema.portfolioPositions.id, position.id))
  }

  // Add cash
  await db.update(schema.portfolios)
    .set({
      cashBalance: portfolio.cashBalance! + amount,
      updatedAt: now,
    })
    .where(eq(schema.portfolios.id, portfolio.id))

  return true
}

// ============================================
// USER PREFERENCES
// ============================================
export async function getUserPreferences(userId: string) {
  return db.query.userPreferences.findFirst({
    where: eq(schema.userPreferences.userId, userId),
  })
}

export async function updateUserPreferences(userId: string, data: {
  theme?: string
  colorScheme?: string
  uiState?: string
}) {
  const now = new Date()
  const existing = await getUserPreferences(userId)

  if (existing) {
    await db.update(schema.userPreferences)
      .set({ ...data, updatedAt: now })
      .where(eq(schema.userPreferences.userId, userId))
  } else {
    await db.insert(schema.userPreferences).values({
      userId,
      theme: data.theme || 'dark',
      colorScheme: data.colorScheme || 'sapphire',
      uiState: data.uiState || '{}',
      updatedAt: now,
    })
  }
}

// ============================================
// ADMIN OPERATIONS
// ============================================
export async function getAdminConfig() {
  const configs = await db.query.adminConfig.findMany()
  const result: Record<string, string> = {}
  for (const config of configs) {
    result[config.key] = config.value
  }
  return result
}

export async function setAdminConfig(key: string, value: string, updatedBy?: string) {
  const now = new Date()
  const existing = sqlite.prepare('SELECT key FROM admin_config WHERE key = ?').get(key)

  if (existing) {
    await db.update(schema.adminConfig)
      .set({ value, updatedAt: now, updatedBy })
      .where(eq(schema.adminConfig.key, key))
  } else {
    await db.insert(schema.adminConfig).values({
      key,
      value,
      updatedAt: now,
      updatedBy,
    })
  }
}

export async function getAggregatedStats() {
  const result = sqlite.prepare(`
    SELECT
      COUNT(DISTINCT u.id) as user_count,
      COALESCE(SUM(p.cash_balance), 0) as total_cash,
      COALESCE(SUM(pp.cost_basis), 0) as total_invested,
      COUNT(DISTINCT CASE WHEN b.visibility = 'nexus' THEN b.id END) as nexus_bot_count
    FROM users u
    LEFT JOIN portfolios p ON u.id = p.owner_id
    LEFT JOIN portfolio_positions pp ON p.id = pp.portfolio_id AND pp.exit_date IS NULL
    LEFT JOIN bots b ON u.id = b.owner_id AND b.deleted_at IS NULL
    WHERE u.role != 'admin'
  `).get() as {
    user_count: number
    total_cash: number
    total_invested: number
    nexus_bot_count: number
  }

  return {
    userCount: result.user_count,
    totalCash: result.total_cash,
    totalInvested: result.total_invested,
    totalPortfolioValue: result.total_cash + result.total_invested,
    nexusBotCount: result.nexus_bot_count,
  }
}

// Export the raw sqlite connection for advanced queries
export { sqlite }
