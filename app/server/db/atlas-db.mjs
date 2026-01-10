/**
 * Atlas Database - Separate private database for main_admin bots
 * These bots are completely hidden from engineers and regular users
 */
import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const ATLAS_DB_PATH = process.env.ATLAS_DB_PATH || path.join(__dirname, '../data/atlas-private.db')

// Initialize Atlas database
const atlasDb = new Database(ATLAS_DB_PATH)
atlasDb.pragma('journal_mode = WAL')

// Create tables if they don't exist
atlasDb.exec(`
  CREATE TABLE IF NOT EXISTS atlas_bots (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    payload TEXT,
    visibility TEXT DEFAULT 'private',
    fund_slot INTEGER,
    tags TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS atlas_bot_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id TEXT NOT NULL UNIQUE REFERENCES atlas_bots(id),
    cagr REAL,
    max_drawdown REAL,
    calmar_ratio REAL,
    sharpe_ratio REAL,
    sortino_ratio REAL,
    treynor_ratio REAL,
    volatility REAL,
    win_rate REAL,
    trading_days INTEGER,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_atlas_bots_owner ON atlas_bots(owner_id);
  CREATE INDEX IF NOT EXISTS idx_atlas_bots_deleted ON atlas_bots(deleted_at);
`)

/**
 * Generate a unique bot ID
 */
function generateBotId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  for (let i = 0; i < 12; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

/**
 * Create a new Atlas bot
 */
export function createAtlasBot({ ownerId, name, description, payload, visibility = 'private', fundSlot, tags = [] }) {
  const id = generateBotId()

  atlasDb.prepare(`
    INSERT INTO atlas_bots (id, owner_id, name, description, payload, visibility, fund_slot, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ownerId, name, description, JSON.stringify(payload), visibility, fundSlot, JSON.stringify(tags))

  return { id, ownerId, name, description, payload, visibility, fundSlot, tags, createdAt: new Date().toISOString() }
}

/**
 * Get all Atlas bots (with optional owner filter)
 */
export function getAtlasBots(ownerId = null) {
  let query = `
    SELECT b.*, m.cagr, m.max_drawdown, m.calmar_ratio, m.sharpe_ratio,
           m.sortino_ratio, m.treynor_ratio, m.volatility, m.win_rate, m.trading_days
    FROM atlas_bots b
    LEFT JOIN atlas_bot_metrics m ON b.id = m.bot_id
    WHERE b.deleted_at IS NULL
  `

  if (ownerId) {
    query += ` AND b.owner_id = ?`
    const rows = atlasDb.prepare(query + ' ORDER BY b.created_at DESC').all(ownerId)
    return rows.map(transformBot)
  }

  const rows = atlasDb.prepare(query + ' ORDER BY b.created_at DESC').all()
  return rows.map(transformBot)
}

/**
 * Get a single Atlas bot by ID
 */
export function getAtlasBotById(botId) {
  const row = atlasDb.prepare(`
    SELECT b.*, m.cagr, m.max_drawdown, m.calmar_ratio, m.sharpe_ratio,
           m.sortino_ratio, m.treynor_ratio, m.volatility, m.win_rate, m.trading_days
    FROM atlas_bots b
    LEFT JOIN atlas_bot_metrics m ON b.id = m.bot_id
    WHERE b.id = ? AND b.deleted_at IS NULL
  `).get(botId)

  return row ? transformBot(row) : null
}

/**
 * Update an Atlas bot
 */
export function updateAtlasBot(botId, updates) {
  const { name, description, payload, visibility, fundSlot, tags } = updates

  const sets = []
  const values = []

  if (name !== undefined) {
    sets.push('name = ?')
    values.push(name)
  }
  if (description !== undefined) {
    sets.push('description = ?')
    values.push(description)
  }
  if (payload !== undefined) {
    sets.push('payload = ?')
    values.push(JSON.stringify(payload))
  }
  if (visibility !== undefined) {
    sets.push('visibility = ?')
    values.push(visibility)
  }
  if (fundSlot !== undefined) {
    sets.push('fund_slot = ?')
    values.push(fundSlot)
  }
  if (tags !== undefined) {
    sets.push('tags = ?')
    values.push(JSON.stringify(tags))
  }

  if (sets.length === 0) {
    return getAtlasBotById(botId)
  }

  sets.push("updated_at = datetime('now')")
  values.push(botId)

  atlasDb.prepare(`UPDATE atlas_bots SET ${sets.join(', ')} WHERE id = ?`).run(...values)

  return getAtlasBotById(botId)
}

/**
 * Soft delete an Atlas bot
 */
export function deleteAtlasBot(botId) {
  atlasDb.prepare(`UPDATE atlas_bots SET deleted_at = datetime('now') WHERE id = ?`).run(botId)
  return { deleted: true }
}

/**
 * Update Atlas bot metrics
 */
export function updateAtlasBotMetrics(botId, metrics) {
  const { cagr, maxDrawdown, calmarRatio, sharpeRatio, sortinoRatio, treynorRatio, volatility, winRate, tradingDays } = metrics

  atlasDb.prepare(`
    INSERT INTO atlas_bot_metrics (bot_id, cagr, max_drawdown, calmar_ratio, sharpe_ratio, sortino_ratio, treynor_ratio, volatility, win_rate, trading_days)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(bot_id) DO UPDATE SET
      cagr = excluded.cagr,
      max_drawdown = excluded.max_drawdown,
      calmar_ratio = excluded.calmar_ratio,
      sharpe_ratio = excluded.sharpe_ratio,
      sortino_ratio = excluded.sortino_ratio,
      treynor_ratio = excluded.treynor_ratio,
      volatility = excluded.volatility,
      win_rate = excluded.win_rate,
      trading_days = excluded.trading_days,
      updated_at = datetime('now')
  `).run(botId, cagr, maxDrawdown, calmarRatio, sharpeRatio, sortinoRatio, treynorRatio, volatility, winRate, tradingDays)

  return { updated: true }
}

/**
 * Transform database row to API response format
 */
function transformBot(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    description: row.description,
    payload: row.payload ? JSON.parse(row.payload) : null,
    visibility: row.visibility,
    fundSlot: row.fund_slot,
    tags: row.tags ? JSON.parse(row.tags) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metrics: row.cagr != null ? {
      cagr: row.cagr,
      maxDrawdown: row.max_drawdown,
      calmarRatio: row.calmar_ratio,
      sharpeRatio: row.sharpe_ratio,
      sortinoRatio: row.sortino_ratio,
      treynorRatio: row.treynor_ratio,
      volatility: row.volatility,
      winRate: row.win_rate,
      tradingDays: row.trading_days,
    } : null,
  }
}

export { atlasDb }
