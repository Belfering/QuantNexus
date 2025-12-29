import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.mjs'
import path from 'path'
import { fileURLToPath } from 'url'
import { eq, desc, and, or, isNull, like } from 'drizzle-orm'
import crypto from 'crypto'
import fs from 'fs'
import bcrypt from 'bcrypt'
import zlib from 'zlib'
import { promisify } from 'util'

// Bcrypt configuration
const SALT_ROUNDS = 10

// GZIP compression for large payloads (FRD-017)
const gzip = promisify(zlib.gzip)
const gunzip = promisify(zlib.gunzip)
const COMPRESSION_THRESHOLD = 1024 * 1024 // 1MB
const GZIP_PREFIX = 'GZIP:'

/**
 * Compress payload if it exceeds threshold
 * @param {string|object} payload - Raw payload
 * @returns {Promise<string>} - Compressed (GZIP:base64) or original string
 */
async function compressPayload(payload) {
  const str = typeof payload === 'string' ? payload : JSON.stringify(payload)
  if (str.length < COMPRESSION_THRESHOLD) return str
  try {
    const compressed = await gzip(Buffer.from(str))
    const result = GZIP_PREFIX + compressed.toString('base64')
    console.log(`[DB] Compressed payload: ${str.length} -> ${result.length} bytes (${((result.length/str.length)*100).toFixed(1)}%)`)
    return result
  } catch (e) {
    console.error('[DB] Compression failed, storing uncompressed:', e)
    return str
  }
}

/**
 * Decompress payload if it was compressed
 * @param {string} stored - Stored payload (may be compressed)
 * @returns {Promise<string>} - Decompressed JSON string
 */
async function decompressPayload(stored) {
  if (!stored || !stored.startsWith(GZIP_PREFIX)) return stored
  try {
    const compressed = Buffer.from(stored.slice(GZIP_PREFIX.length), 'base64')
    const decompressed = await gunzip(compressed)
    return decompressed.toString()
  } catch (e) {
    console.error('[DB] Decompression failed:', e)
    return stored
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Database file path
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'atlas.db')

// Ensure data directory exists
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
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      role TEXT DEFAULT 'user',
      is_partner_eligible INTEGER DEFAULT 0,
      email_verified INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      tier TEXT DEFAULT 'free',
      invite_code_used TEXT,
      terms_accepted_at INTEGER,
      privacy_accepted_at INTEGER,
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
      backtest_mode TEXT DEFAULT 'CC',
      backtest_cost_bps INTEGER DEFAULT 5,
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
      added_at INTEGER,
      UNIQUE(watchlist_id, bot_id)
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

    CREATE TABLE IF NOT EXISTS call_chains (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      root TEXT NOT NULL,
      collapsed INTEGER DEFAULT 0,
      created_at INTEGER,
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

    CREATE TABLE IF NOT EXISTS waitlist_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      position INTEGER NOT NULL,
      referral_code TEXT,
      referred_by INTEGER,
      status TEXT DEFAULT 'pending',
      source TEXT,
      created_at INTEGER,
      invited_at INTEGER,
      registered_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS invite_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      waitlist_id INTEGER,
      created_by TEXT,
      max_uses INTEGER DEFAULT 1,
      use_count INTEGER DEFAULT 0,
      expires_at INTEGER,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      refresh_token_hash TEXT NOT NULL,
      device_info TEXT,
      ip_address TEXT,
      expires_at INTEGER NOT NULL,
      created_at INTEGER,
      last_used_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      used_at TEXT
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
    CREATE INDEX IF NOT EXISTS idx_call_chains_owner ON call_chains(owner_id);
    CREATE INDEX IF NOT EXISTS idx_waitlist_status ON waitlist_entries(status);
    CREATE INDEX IF NOT EXISTS idx_waitlist_position ON waitlist_entries(position);
    CREATE INDEX IF NOT EXISTS idx_invite_code ON invite_codes(code);
    CREATE INDEX IF NOT EXISTS idx_session_user ON user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_session_token ON user_sessions(refresh_token_hash);
  `)

  // Migration: Add backtest_mode and backtest_cost_bps columns to bots table
  try {
    const cols = sqlite.prepare("PRAGMA table_info(bots)").all()
    const hasBacktestMode = cols.some(c => c.name === 'backtest_mode')
    if (!hasBacktestMode) {
      console.log('[DB] Migrating bots table: adding backtest_mode and backtest_cost_bps columns...')
      sqlite.exec("ALTER TABLE bots ADD COLUMN backtest_mode TEXT DEFAULT 'CC'")
      sqlite.exec("ALTER TABLE bots ADD COLUMN backtest_cost_bps INTEGER DEFAULT 5")
      console.log('[DB] Migration complete: backtest settings columns added')
    }
  } catch (e) {
    // Columns might already exist
  }

  // Migration: Add auth columns to users table
  try {
    const userCols = sqlite.prepare("PRAGMA table_info(users)").all()
    const hasEmail = userCols.some(c => c.name === 'email')
    if (!hasEmail) {
      console.log('[DB] Migrating users table: adding auth columns...')
      sqlite.exec("ALTER TABLE users ADD COLUMN email TEXT UNIQUE")
      sqlite.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0")
      sqlite.exec("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'")
      sqlite.exec("ALTER TABLE users ADD COLUMN tier TEXT DEFAULT 'free'")
      sqlite.exec("ALTER TABLE users ADD COLUMN invite_code_used TEXT")
      sqlite.exec("ALTER TABLE users ADD COLUMN terms_accepted_at INTEGER")
      sqlite.exec("ALTER TABLE users ADD COLUMN privacy_accepted_at INTEGER")
      console.log('[DB] Migration complete: auth columns added to users table')
    }
  } catch (e) {
    // Columns might already exist
  }

  // Clean up duplicate watchlist_bots entries (keep only the first entry)
  const duplicates = sqlite.prepare(`
    SELECT watchlist_id, bot_id, COUNT(*) as cnt, MIN(id) as keep_id
    FROM watchlist_bots
    GROUP BY watchlist_id, bot_id
    HAVING COUNT(*) > 1
  `).all()

  if (duplicates.length > 0) {
    console.log(`[DB] Found ${duplicates.length} duplicate watchlist_bots entries, cleaning up...`)
    for (const dup of duplicates) {
      sqlite.prepare(`
        DELETE FROM watchlist_bots
        WHERE watchlist_id = ? AND bot_id = ? AND id != ?
      `).run(dup.watchlist_id, dup.bot_id, dup.keep_id)
    }
    console.log('[DB] Duplicate watchlist_bots entries cleaned up')
  }

  // Create unique index if it doesn't exist (prevents future duplicates)
  try {
    sqlite.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlist_bots_unique ON watchlist_bots(watchlist_id, bot_id)')
  } catch (e) {
    // Index may already exist or duplicates remain - that's ok
  }

  // Clean up ALL non-default watchlists named "Default" - these are legacy migration artifacts
  // Also clean up any extra "My Watchlist" that aren't marked as default
  const allRedundantWatchlists = sqlite.prepare(`
    SELECT w.id, w.owner_id, w.name
    FROM watchlists w
    WHERE w.is_default = 0
      AND (w.name = 'Default' OR w.name = 'My Watchlist')
  `).all()

  if (allRedundantWatchlists.length > 0) {
    console.log(`[DB] Found ${allRedundantWatchlists.length} redundant watchlists (non-default named "Default" or "My Watchlist"), cleaning up...`)
    for (const wl of allRedundantWatchlists) {
      // Get the actual default watchlist for this owner (create if missing)
      let defaultWl = sqlite.prepare('SELECT id FROM watchlists WHERE owner_id = ? AND is_default = 1').get(wl.owner_id)
      if (!defaultWl) {
        // Create a proper default watchlist for this owner
        const newId = `watchlist-${wl.owner_id}-default`
        const now = Date.now()
        sqlite.prepare('INSERT OR IGNORE INTO watchlists (id, owner_id, name, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(newId, wl.owner_id, 'My Watchlist', 1, now, now)
        defaultWl = { id: newId }
        console.log(`[DB] Created missing default watchlist for owner: ${wl.owner_id}`)
      }
      // Move bots from redundant watchlist to default (ignore duplicates)
      sqlite.prepare(`
        INSERT OR IGNORE INTO watchlist_bots (watchlist_id, bot_id, added_at)
        SELECT ?, bot_id, added_at FROM watchlist_bots WHERE watchlist_id = ?
      `).run(defaultWl.id, wl.id)
      // Delete bots from redundant watchlist
      sqlite.prepare('DELETE FROM watchlist_bots WHERE watchlist_id = ?').run(wl.id)
      // Delete the redundant watchlist
      sqlite.prepare('DELETE FROM watchlists WHERE id = ?').run(wl.id)
    }
    console.log('[DB] Redundant watchlists merged and deleted')
  }

  // Seed default admin config
  const existingConfig = sqlite.prepare('SELECT key FROM admin_config WHERE key = ?').get('atlas_fee_percent')
  if (!existingConfig) {
    const now = Date.now()
    sqlite.prepare('INSERT INTO admin_config (key, value, updated_at) VALUES (?, ?, ?)').run('atlas_fee_percent', '2.0', now)
    sqlite.prepare('INSERT INTO admin_config (key, value, updated_at) VALUES (?, ?, ?)').run('partner_share_percent', '50.0', now)
  }

  // Seed beta invite code "Bkoz I can" (case-sensitive)
  const existingInviteCode = sqlite.prepare('SELECT id FROM invite_codes WHERE code = ?').get('Bkoz I can')
  if (!existingInviteCode) {
    const now = Date.now()
    sqlite.prepare(`
      INSERT INTO invite_codes (code, max_uses, use_count, created_at)
      VALUES (?, ?, ?, ?)
    `).run('Bkoz I can', 1000, 0, now)
    console.log('[DB] Beta invite code "Bkoz I can" created')
  }

  // Clean up legacy demo users (1, 3, 5, 7, 9 and old admin)
  // Admin is now created via seed-admin.mjs using env vars
  const demoUserIds = ['1', '3', '5', '7', '9', 'admin']
  const deletedDemoUsers = sqlite.prepare(`
    DELETE FROM users WHERE id IN (${demoUserIds.map(() => '?').join(',')})
  `).run(...demoUserIds)
  if (deletedDemoUsers.changes > 0) {
    console.log(`[DB] Cleaned up ${deletedDemoUsers.changes} legacy demo users`)
  }

  console.log('[DB] Database initialized')
}

// ============================================
// HELPER FUNCTIONS
// ============================================
export function generateId() {
  return crypto.randomUUID()
}

/**
 * Hash a password using bcrypt
 * @param {string} plainPassword - Plain text password
 * @returns {Promise<string>} - Bcrypt hash
 */
export async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS)
}

/**
 * Migrate existing plain-text passwords to bcrypt hashes
 * Detects plain-text passwords (not starting with $2b$) and hashes them
 * @returns {Promise<{migrated: number, alreadyHashed: number}>}
 */
export async function migratePasswordsToBcrypt() {
  const users = await db.select().from(schema.users)
  let migrated = 0
  let alreadyHashed = 0

  for (const user of users) {
    // Bcrypt hashes start with $2b$ (or $2a$, $2y$)
    if (user.passwordHash && user.passwordHash.startsWith('$2')) {
      alreadyHashed++
      continue
    }

    // Plain text password - hash it
    // For existing users, their password is their username (1, 3, 5, 7, 9, admin)
    const newHash = await bcrypt.hash(user.passwordHash, SALT_ROUNDS)
    await db.update(schema.users)
      .set({ passwordHash: newHash, updatedAt: new Date() })
      .where(eq(schema.users.id, user.id))
    migrated++
    console.log(`[DB] Migrated password for user: ${user.username}`)
  }

  console.log(`[DB] Password migration complete: ${migrated} migrated, ${alreadyHashed} already hashed`)
  return { migrated, alreadyHashed }
}

// ============================================
// USER OPERATIONS
// ============================================
export async function getUserById(id) {
  return db.query.users.findFirst({
    where: eq(schema.users.id, id),
  })
}

export async function getUserByUsername(username) {
  return db.query.users.findFirst({
    where: eq(schema.users.username, username),
  })
}

export async function validateUser(username, password) {
  const user = await getUserByUsername(username)
  if (!user) return null

  // Compare password with bcrypt hash
  const isValid = await bcrypt.compare(password, user.passwordHash)
  if (!isValid) return null

  // Update last login
  await db.update(schema.users)
    .set({ lastLoginAt: new Date() })
    .where(eq(schema.users.id, user.id))
  return user
}

// ============================================
// BOT OPERATIONS
// ============================================
export async function getBotById(id, includePayload = false) {
  const bot = await db.query.bots.findFirst({
    where: and(eq(schema.bots.id, id), isNull(schema.bots.deletedAt)),
  })
  if (!bot) return null

  // Manually fetch metrics and owner
  const metricsRow = sqlite.prepare('SELECT * FROM bot_metrics WHERE bot_id = ?').get(bot.id)
  const ownerRow = sqlite.prepare('SELECT id, display_name, role FROM users WHERE id = ?').get(bot.ownerId)

  const result = {
    ...bot,
    metrics: metricsRow || null,
    owner: ownerRow ? { id: ownerRow.id, displayName: ownerRow.display_name, role: ownerRow.role } : null,
  }

  if (!includePayload) {
    return { ...result, payload: undefined }
  }

  // Decompress payload if it was compressed (FRD-017)
  if (result.payload) {
    result.payload = await decompressPayload(result.payload)
  }
  return result
}

export async function getBotsByOwner(ownerId) {
  // Get bots without relational query - join metrics separately
  const bots = await db.query.bots.findMany({
    where: and(eq(schema.bots.ownerId, ownerId), isNull(schema.bots.deletedAt)),
    orderBy: desc(schema.bots.createdAt),
  })

  // Manually fetch metrics for each bot, decompress payloads (FRD-017)
  const botsWithMetrics = await Promise.all(bots.map(async (bot) => {
    const metricsRow = sqlite.prepare('SELECT * FROM bot_metrics WHERE bot_id = ?').get(bot.id)
    // Decompress payload if compressed
    const payload = bot.payload ? await decompressPayload(bot.payload) : bot.payload
    return { ...bot, payload, metrics: metricsRow || null }
  }))

  return botsWithMetrics
}

export async function getNexusBots() {
  // Get all Nexus bots (visibility = 'nexus') OR Atlas-tagged bots - NO payload for security
  const bots = await db.query.bots.findMany({
    where: and(
      or(
        eq(schema.bots.visibility, 'nexus'),
        like(schema.bots.tags, '%"Atlas"%')
      ),
      isNull(schema.bots.deletedAt)
    ),
    orderBy: desc(schema.bots.createdAt),
  })

  // Manually fetch metrics and owner for each bot
  const botsWithData = await Promise.all(bots.map(async (bot) => {
    const metricsRow = sqlite.prepare('SELECT * FROM bot_metrics WHERE bot_id = ?').get(bot.id)
    const ownerRow = sqlite.prepare('SELECT id, display_name FROM users WHERE id = ?').get(bot.ownerId)
    return {
      ...bot,
      payload: undefined, // IP protection
      // Transform snake_case DB columns to match frontend expectations (fetchNexusBotsFromApi expects *Ratio names)
      metrics: metricsRow ? {
        cagr: metricsRow.cagr,
        maxDrawdown: metricsRow.max_drawdown,
        calmarRatio: metricsRow.calmar_ratio,
        sharpeRatio: metricsRow.sharpe_ratio,
        sortinoRatio: metricsRow.sortino_ratio,
        treynorRatio: metricsRow.treynor_ratio,
        volatility: metricsRow.volatility,
        winRate: metricsRow.win_rate,
        tradingDays: metricsRow.trading_days,
      } : null,
      owner: ownerRow ? { id: ownerRow.id, displayName: ownerRow.display_name } : null,
    }
  }))

  return botsWithData
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

export async function createBot(data) {
  const id = data.id || generateId()  // Use provided ID or generate new
  const now = new Date()

  // Compress payload if >1MB (FRD-017)
  const storedPayload = await compressPayload(data.payload)

  await db.insert(schema.bots).values({
    id,
    ownerId: data.ownerId,
    name: data.name,
    payload: storedPayload,
    visibility: data.visibility || 'private',
    tags: data.tags ? JSON.stringify(data.tags) : null,
    fundSlot: data.fundSlot,
    backtestMode: data.backtestMode || 'CC',
    backtestCostBps: data.backtestCostBps ?? 5,
    createdAt: now,
    updatedAt: now,
  })

  return id
}

export async function updateBot(id, ownerId, data) {
  // Verify ownership
  const bot = await db.query.bots.findFirst({
    where: and(eq(schema.bots.id, id), eq(schema.bots.ownerId, ownerId)),
  })
  if (!bot) return null

  const updateData = { updatedAt: new Date() }
  if (data.name !== undefined) updateData.name = data.name
  if (data.payload !== undefined) {
    // Compress payload if >1MB (FRD-017)
    updateData.payload = await compressPayload(data.payload)
  }
  if (data.visibility !== undefined) updateData.visibility = data.visibility
  if (data.tags !== undefined) updateData.tags = JSON.stringify(data.tags)
  if (data.fundSlot !== undefined) updateData.fundSlot = data.fundSlot
  if (data.backtestMode !== undefined) updateData.backtestMode = data.backtestMode
  if (data.backtestCostBps !== undefined) updateData.backtestCostBps = data.backtestCostBps

  await db.update(schema.bots)
    .set(updateData)
    .where(eq(schema.bots.id, id))

  return id
}

export async function deleteBot(id, ownerId) {
  // Soft delete
  const result = sqlite.prepare(`
    UPDATE bots SET deleted_at = ? WHERE id = ? AND owner_id = ?
  `).run(Date.now(), id, ownerId)
  return result.changes > 0
}

export async function updateBotMetrics(botId, metrics) {
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
export async function getWatchlistsByOwner(ownerId) {
  // Get watchlists
  const watchlists = await db.query.watchlists.findMany({
    where: eq(schema.watchlists.ownerId, ownerId),
  })

  // For each watchlist, get the bot entries with bot and metrics data
  const watchlistsWithBots = await Promise.all(watchlists.map(async (wl) => {
    const botEntries = sqlite.prepare(`
      SELECT wb.id, wb.watchlist_id, wb.bot_id, wb.added_at,
             b.id as bot_id, b.owner_id, b.name, b.visibility, b.tags, b.created_at,
             m.cagr, m.max_drawdown, m.calmar_ratio, m.sharpe_ratio, m.sortino_ratio
      FROM watchlist_bots wb
      JOIN bots b ON wb.bot_id = b.id
      LEFT JOIN bot_metrics m ON b.id = m.bot_id
      WHERE wb.watchlist_id = ? AND b.deleted_at IS NULL
    `).all(wl.id)

    return {
      ...wl,
      bots: botEntries.map(entry => ({
        id: entry.id,
        watchlistId: entry.watchlist_id,
        botId: entry.bot_id,
        addedAt: entry.added_at,
        bot: {
          id: entry.bot_id,
          ownerId: entry.owner_id,
          name: entry.name,
          visibility: entry.visibility,
          tags: entry.tags,
          metrics: entry.cagr !== null ? {
            cagr: entry.cagr,
            maxDrawdown: entry.max_drawdown,
            calmarRatio: entry.calmar_ratio,
            sharpeRatio: entry.sharpe_ratio,
            sortinoRatio: entry.sortino_ratio,
          } : null,
        },
      })),
    }
  }))

  return watchlistsWithBots
}

export async function addBotToWatchlist(watchlistId, botId) {
  // Use INSERT OR IGNORE with unique constraint to prevent duplicates
  const result = sqlite.prepare(`
    INSERT OR IGNORE INTO watchlist_bots (watchlist_id, bot_id, added_at)
    VALUES (?, ?, ?)
  `).run(watchlistId, botId, Date.now())
  return result.changes > 0
}

export async function removeBotFromWatchlist(watchlistId, botId) {
  const result = sqlite.prepare(
    'DELETE FROM watchlist_bots WHERE watchlist_id = ? AND bot_id = ?'
  ).run(watchlistId, botId)
  return result.changes > 0
}

export async function createWatchlist(ownerId, name) {
  const id = generateId()
  const now = new Date()
  await db.insert(schema.watchlists).values({
    id,
    ownerId,
    name,
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  })
  return { id, ownerId, name, isDefault: false, bots: [] }
}

export async function updateWatchlist(id, data) {
  const now = new Date()
  await db.update(schema.watchlists)
    .set({ ...data, updatedAt: now })
    .where(eq(schema.watchlists.id, id))
}

export async function deleteWatchlist(id) {
  // First delete all bot associations
  sqlite.prepare('DELETE FROM watchlist_bots WHERE watchlist_id = ?').run(id)
  // Then delete the watchlist
  const result = sqlite.prepare('DELETE FROM watchlists WHERE id = ?').run(id)
  return result.changes > 0
}

// ============================================
// PORTFOLIO OPERATIONS
// ============================================
export async function getPortfolio(ownerId) {
  // Get portfolio
  const portfolio = await db.query.portfolios.findFirst({
    where: eq(schema.portfolios.ownerId, ownerId),
  })
  if (!portfolio) return null

  // Get open positions with bot and metrics data
  const positions = sqlite.prepare(`
    SELECT pp.id, pp.portfolio_id, pp.bot_id, pp.cost_basis, pp.shares, pp.entry_date,
           b.id as bot_id, b.owner_id, b.name, b.visibility, b.tags,
           m.cagr, m.max_drawdown, m.calmar_ratio, m.sharpe_ratio, m.sortino_ratio
    FROM portfolio_positions pp
    JOIN bots b ON pp.bot_id = b.id
    LEFT JOIN bot_metrics m ON b.id = m.bot_id
    WHERE pp.portfolio_id = ? AND pp.exit_date IS NULL AND b.deleted_at IS NULL
  `).all(portfolio.id)

  return {
    ...portfolio,
    positions: positions.map(pos => ({
      id: pos.id,
      portfolioId: pos.portfolio_id,
      botId: pos.bot_id,
      costBasis: pos.cost_basis,
      shares: pos.shares,
      entryDate: pos.entry_date,
      bot: {
        id: pos.bot_id,
        ownerId: pos.owner_id,
        name: pos.name,
        visibility: pos.visibility,
        tags: pos.tags,
        metrics: pos.cagr !== null ? {
          cagr: pos.cagr,
          maxDrawdown: pos.max_drawdown,
          calmarRatio: pos.calmar_ratio,
          sharpeRatio: pos.sharpe_ratio,
          sortinoRatio: pos.sortino_ratio,
        } : null,
      },
    })),
  }
}

export async function buyBot(ownerId, botId, amount) {
  const portfolio = await db.query.portfolios.findFirst({
    where: eq(schema.portfolios.ownerId, ownerId),
  })
  if (!portfolio) throw new Error('Portfolio not found')
  if (portfolio.cashBalance < amount) throw new Error('Insufficient cash')
  if (amount < 100) throw new Error('Minimum investment is $100')

  // Check if already has position
  const existingPosition = sqlite.prepare(`
    SELECT id, cost_basis, shares FROM portfolio_positions
    WHERE portfolio_id = ? AND bot_id = ? AND exit_date IS NULL
  `).get(portfolio.id, botId)

  const now = new Date()

  if (existingPosition) {
    // Add to existing position
    await db.update(schema.portfolioPositions)
      .set({
        costBasis: existingPosition.cost_basis + amount,
        shares: existingPosition.shares + amount,
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
      shares: amount,
      entryDate: now,
    })
  }

  // Deduct cash
  await db.update(schema.portfolios)
    .set({
      cashBalance: portfolio.cashBalance - amount,
      updatedAt: now,
    })
    .where(eq(schema.portfolios.id, portfolio.id))

  return true
}

export async function sellBot(ownerId, botId, amount) {
  const portfolio = await db.query.portfolios.findFirst({
    where: eq(schema.portfolios.ownerId, ownerId),
  })
  if (!portfolio) throw new Error('Portfolio not found')

  const position = sqlite.prepare(`
    SELECT id, cost_basis, shares FROM portfolio_positions
    WHERE portfolio_id = ? AND bot_id = ? AND exit_date IS NULL
  `).get(portfolio.id, botId)

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
      cashBalance: portfolio.cashBalance + amount,
      updatedAt: now,
    })
    .where(eq(schema.portfolios.id, portfolio.id))

  return true
}

// ============================================
// USER PREFERENCES
// ============================================
export async function getUserPreferences(userId) {
  return db.query.userPreferences.findFirst({
    where: eq(schema.userPreferences.userId, userId),
  })
}

export async function updateUserPreferences(userId, data) {
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
  const result = {}
  for (const config of configs) {
    result[config.key] = config.value
  }
  return result
}

export async function setAdminConfig(key, value, updatedBy) {
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
  `).get()

  return {
    userCount: result.user_count,
    totalCash: result.total_cash,
    totalInvested: result.total_invested,
    totalPortfolioValue: result.total_cash + result.total_invested,
    nexusBotCount: result.nexus_bot_count,
  }
}

// ============================================
// CALL CHAIN OPERATIONS
// ============================================
export async function getCallChainsByOwner(ownerId) {
  const chains = sqlite.prepare(`
    SELECT id, owner_id, name, root, collapsed, created_at, updated_at
    FROM call_chains
    WHERE owner_id = ?
    ORDER BY created_at DESC
  `).all(ownerId)

  return chains.map(chain => ({
    id: chain.id,
    ownerId: chain.owner_id,
    name: chain.name,
    root: chain.root, // JSON string, frontend will parse
    collapsed: Boolean(chain.collapsed),
    createdAt: chain.created_at,
    updatedAt: chain.updated_at,
  }))
}

export async function createCallChain(ownerId, name, root) {
  const id = generateId()
  const now = Date.now()
  sqlite.prepare(`
    INSERT INTO call_chains (id, owner_id, name, root, collapsed, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, ownerId, name, root, 0, now, now)
  return { id, ownerId, name, root, collapsed: false, createdAt: now, updatedAt: now }
}

export async function updateCallChain(id, ownerId, data) {
  // Verify ownership
  const existing = sqlite.prepare('SELECT id FROM call_chains WHERE id = ? AND owner_id = ?').get(id, ownerId)
  if (!existing) return null

  const updates = []
  const values = []

  if (data.name !== undefined) {
    updates.push('name = ?')
    values.push(data.name)
  }
  if (data.root !== undefined) {
    updates.push('root = ?')
    values.push(data.root)
  }
  if (data.collapsed !== undefined) {
    updates.push('collapsed = ?')
    values.push(data.collapsed ? 1 : 0)
  }

  if (updates.length === 0) return id

  updates.push('updated_at = ?')
  values.push(Date.now())
  values.push(id)

  sqlite.prepare(`UPDATE call_chains SET ${updates.join(', ')} WHERE id = ?`).run(...values)
  return id
}

export async function deleteCallChain(id, ownerId) {
  const result = sqlite.prepare('DELETE FROM call_chains WHERE id = ? AND owner_id = ?').run(id, ownerId)
  return result.changes > 0
}

// Export the raw sqlite connection for advanced queries
export { sqlite }

// Auto-initialize database on module load
initializeDatabase()
