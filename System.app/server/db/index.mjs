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
      last_login_at INTEGER,
      theme TEXT DEFAULT 'dark',
      color_scheme TEXT DEFAULT 'slate'
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

    CREATE TABLE IF NOT EXISTS oauth_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL CHECK(provider IN ('google', 'discord', 'github')),
      provider_account_id TEXT NOT NULL,
      email TEXT,
      display_name TEXT,
      avatar_url TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      UNIQUE(provider, provider_account_id)
    );

    -- FRD-035: Variable Library for documentation
    CREATE TABLE IF NOT EXISTS metric_variables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      variable_name TEXT NOT NULL UNIQUE,
      display_name TEXT,
      description TEXT,
      formula TEXT,
      source_file TEXT,
      category TEXT,
      created_at INTEGER
    );

    -- Optimization Jobs and Results (Branch Generation Persistence)
    CREATE TABLE IF NOT EXISTS optimization_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id TEXT NOT NULL,
      bot_name TEXT NOT NULL,
      status TEXT NOT NULL,
      total_branches INTEGER NOT NULL,
      completed_branches INTEGER NOT NULL,
      passing_branches INTEGER NOT NULL,
      start_time INTEGER NOT NULL,
      end_time INTEGER,
      error_message TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS optimization_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES optimization_jobs(id) ON DELETE CASCADE,
      branch_id TEXT NOT NULL,
      parameter_label TEXT NOT NULL,
      parameter_values TEXT NOT NULL,
      ticker_substitutions TEXT,
      condition_ticker TEXT,
      position_ticker TEXT,
      tree_json TEXT,
      is_cagr REAL,
      is_sharpe REAL,
      is_calmar REAL,
      is_max_drawdown REAL,
      is_sortino REAL,
      is_treynor REAL,
      is_beta REAL,
      is_volatility REAL,
      is_win_rate REAL,
      is_avg_turnover REAL,
      is_avg_holdings REAL,
      oos_cagr REAL,
      oos_sharpe REAL,
      oos_calmar REAL,
      oos_max_drawdown REAL,
      oos_sortino REAL,
      oos_treynor REAL,
      oos_beta REAL,
      oos_volatility REAL,
      oos_win_rate REAL,
      oos_avg_turnover REAL,
      oos_avg_holdings REAL,
      passed INTEGER NOT NULL,
      failed_requirements TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS rolling_optimization_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id TEXT NOT NULL,
      bot_name TEXT NOT NULL,
      split_config TEXT NOT NULL,
      valid_tickers TEXT NOT NULL,
      ticker_start_dates TEXT,
      oos_period_count INTEGER NOT NULL,
      selected_branches TEXT NOT NULL,
      oos_trades TEXT NOT NULL,
      oos_metrics TEXT NOT NULL,
      elapsed_seconds REAL NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );

    -- New rolling optimization structure: per-branch yearly metrics
    CREATE TABLE IF NOT EXISTS rolling_optimization_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id TEXT NOT NULL,
      bot_name TEXT NOT NULL,
      split_config TEXT NOT NULL,
      valid_tickers TEXT NOT NULL,
      ticker_start_dates TEXT,
      branch_count INTEGER NOT NULL,
      elapsed_seconds REAL NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS rolling_optimization_branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES rolling_optimization_jobs(id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL,
      parameter_values TEXT NOT NULL,
      is_start_year INTEGER NOT NULL,
      yearly_metrics TEXT NOT NULL,
      is_oos_metrics TEXT,
      rank_by_metric TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS ticker_lists (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      tags TEXT,
      tickers TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- Saved Shards (Filtered Branch Collections)
    CREATE TABLE IF NOT EXISTS saved_shards (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      source_job_ids TEXT NOT NULL,
      loaded_job_type TEXT NOT NULL,
      branches TEXT NOT NULL,
      branch_count INTEGER NOT NULL,
      filter_summary TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      deleted_at INTEGER
    );

    -- Pending Manual Sells (Scheduled Unallocated Sell Orders)
    CREATE TABLE IF NOT EXISTS pending_manual_sells (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credential_type TEXT NOT NULL,
      symbol TEXT NOT NULL,
      qty REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at INTEGER,
      updated_at INTEGER DEFAULT (unixepoch()),
      executed_at INTEGER,
      error_message TEXT
    );

    -- Indexes for performance
    CREATE INDEX IF NOT EXISTS idx_bots_owner ON bots(owner_id);
    CREATE INDEX IF NOT EXISTS idx_bots_visibility ON bots(visibility);
    CREATE INDEX IF NOT EXISTS idx_rolling_results_bot ON rolling_optimization_results(bot_id);
    CREATE INDEX IF NOT EXISTS idx_rolling_jobs_bot ON rolling_optimization_jobs(bot_id);
    CREATE INDEX IF NOT EXISTS idx_rolling_branches_job ON rolling_optimization_branches(job_id);
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
    CREATE INDEX IF NOT EXISTS idx_oauth_user ON oauth_accounts(user_id);
    CREATE INDEX IF NOT EXISTS idx_ticker_lists_user ON ticker_lists(user_id);
    CREATE INDEX IF NOT EXISTS idx_ticker_lists_name ON ticker_lists(user_id, name);
    CREATE INDEX IF NOT EXISTS idx_saved_shards_owner ON saved_shards(owner_id);
    CREATE INDEX IF NOT EXISTS idx_saved_shards_created ON saved_shards(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_oauth_provider ON oauth_accounts(provider, provider_account_id);
    CREATE INDEX IF NOT EXISTS idx_opt_jobs_bot ON optimization_jobs(bot_id);
    CREATE INDEX IF NOT EXISTS idx_opt_jobs_status ON optimization_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_opt_jobs_created ON optimization_jobs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_opt_results_job ON optimization_results(job_id);
    CREATE INDEX IF NOT EXISTS idx_opt_results_is_cagr ON optimization_results(is_cagr DESC);
    CREATE INDEX IF NOT EXISTS idx_opt_results_oos_cagr ON optimization_results(oos_cagr DESC);
    CREATE INDEX IF NOT EXISTS idx_pending_sells_user ON pending_manual_sells(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_pending_sells_status ON pending_manual_sells(status, credential_type);
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

  // Migration: Add is_draft column to bots table (for auto-save unsaved work feature)
  try {
    const botsCols = sqlite.prepare("PRAGMA table_info(bots)").all()
    const hasIsDraft = botsCols.some(c => c.name === 'is_draft')
    if (!hasIsDraft) {
      console.log('[DB] Migrating bots table: adding is_draft column for unsaved work tracking...')
      sqlite.exec("ALTER TABLE bots ADD COLUMN is_draft INTEGER DEFAULT 0")
      console.log('[DB] Migration complete: is_draft column added')
    }
  } catch (e) {
    // Column might already exist
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

  // Migration: Add theme/colorScheme columns to users table
  try {
    const userCols = sqlite.prepare("PRAGMA table_info(users)").all()
    const hasTheme = userCols.some(c => c.name === 'theme')
    if (!hasTheme) {
      console.log('[DB] Migrating users table: adding theme preference columns...')
      sqlite.exec("ALTER TABLE users ADD COLUMN theme TEXT DEFAULT 'dark'")
      sqlite.exec("ALTER TABLE users ADD COLUMN color_scheme TEXT DEFAULT 'slate'")
      console.log('[DB] Migration complete: theme columns added to users table')
    }
  } catch (e) {
    // Columns might already exist
  }

  // Migration: Add name column to optimization_jobs table
  try {
    const optJobsCols = sqlite.prepare("PRAGMA table_info(optimization_jobs)").all()
    const hasName = optJobsCols.some(c => c.name === 'name')
    if (!hasName) {
      console.log('[DB] Migrating optimization_jobs table: adding name column...')
      sqlite.exec("ALTER TABLE optimization_jobs ADD COLUMN name TEXT")
      console.log('[DB] Migration complete: name column added to optimization_jobs table')
    }
  } catch (e) {
    // Column might already exist
  }

  // Migration: Add TIM, TIMAR, and start date columns to optimization_results table
  try {
    const optResultsCols = sqlite.prepare("PRAGMA table_info(optimization_results)").all()
    const hasIsTim = optResultsCols.some(c => c.name === 'is_tim')
    if (!hasIsTim) {
      console.log('[DB] Migrating optimization_results table: adding TIM/TIMAR/date columns...')
      sqlite.exec("ALTER TABLE optimization_results ADD COLUMN is_start_date TEXT")
      sqlite.exec("ALTER TABLE optimization_results ADD COLUMN is_tim REAL")
      sqlite.exec("ALTER TABLE optimization_results ADD COLUMN is_timar REAL")
      sqlite.exec("ALTER TABLE optimization_results ADD COLUMN oos_start_date TEXT")
      sqlite.exec("ALTER TABLE optimization_results ADD COLUMN oos_tim REAL")
      sqlite.exec("ALTER TABLE optimization_results ADD COLUMN oos_timar REAL")
      console.log('[DB] Migration complete: TIM/TIMAR/date columns added to optimization_results table')
    }
  } catch (e) {
    // Columns might already exist
  }

  // Migration: Add ticker_substitutions column to optimization_results table (Phase 3: Ticker List Optimization)
  try {
    const optResultsCols = sqlite.prepare("PRAGMA table_info(optimization_results)").all()
    const hasTickerSubstitutions = optResultsCols.some(c => c.name === 'ticker_substitutions')
    if (!hasTickerSubstitutions) {
      console.log('[DB] Migrating optimization_results table: adding ticker_substitutions column...')
      sqlite.exec("ALTER TABLE optimization_results ADD COLUMN ticker_substitutions TEXT")
      console.log('[DB] Migration complete: ticker_substitutions column added to optimization_results table')
    }
  } catch (e) {
    // Column might already exist
  }

  // Migration: Add condition_ticker and position_ticker columns
  try {
    const optResultsCols = sqlite.prepare("PRAGMA table_info(optimization_results)").all()
    const hasConditionTicker = optResultsCols.some(c => c.name === 'condition_ticker')
    if (!hasConditionTicker) {
      console.log('[DB] Migrating optimization_results table: adding condition_ticker and position_ticker columns...')
      sqlite.exec("ALTER TABLE optimization_results ADD COLUMN condition_ticker TEXT")
      sqlite.exec("ALTER TABLE optimization_results ADD COLUMN position_ticker TEXT")
      console.log('[DB] Migration complete: condition_ticker and position_ticker columns added to optimization_results table')
    }
  } catch (e) {
    // Columns might already exist
  }

  // Migration: Add tree_json column
  try {
    const optResultsCols = sqlite.prepare("PRAGMA table_info(optimization_results)").all()
    const hasTreeJson = optResultsCols.some(c => c.name === 'tree_json')
    if (!hasTreeJson) {
      console.log('[DB] Migrating optimization_results table: adding tree_json column...')
      sqlite.exec("ALTER TABLE optimization_results ADD COLUMN tree_json TEXT")
      console.log('[DB] Migration complete: tree_json column added to optimization_results table')
    }
  } catch (e) {
    // Column might already exist
  }

  // Migration: Add parameter_values column to rolling_optimization_branches table
  try {
    const rollingBranchesCols = sqlite.prepare("PRAGMA table_info(rolling_optimization_branches)").all()
    const hasParameterValues = rollingBranchesCols.some(c => c.name === 'parameter_values')
    if (!hasParameterValues) {
      console.log('[DB] Migrating rolling_optimization_branches table: adding parameter_values column...')
      sqlite.exec("ALTER TABLE rolling_optimization_branches ADD COLUMN parameter_values TEXT NOT NULL DEFAULT '{}'")
      console.log('[DB] Migration complete: parameter_values column added to rolling_optimization_branches table')
    }
  } catch (e) {
    // Column might already exist
    console.log('[DB] Migration warning for parameter_values:', e.message)
  }

  // Migration: Drop legacy 'parameters' column from rolling_optimization_branches table
  // SQLite doesn't support DROP COLUMN directly, so we need to recreate the table
  try {
    const rollingBranchesCols = sqlite.prepare("PRAGMA table_info(rolling_optimization_branches)").all()
    const hasLegacyParameters = rollingBranchesCols.some(c => c.name === 'parameters')

    if (hasLegacyParameters) {
      console.log('[DB] Migrating rolling_optimization_branches table: dropping legacy parameters column...')

      // Create new table without the legacy 'parameters' column
      sqlite.exec(`
        CREATE TABLE rolling_optimization_branches_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          job_id INTEGER NOT NULL REFERENCES rolling_optimization_jobs(id) ON DELETE CASCADE,
          branch_id INTEGER NOT NULL,
          parameter_values TEXT NOT NULL DEFAULT '{}',
          is_start_year INTEGER NOT NULL,
          yearly_metrics TEXT NOT NULL,
          rank_by_metric TEXT NOT NULL,
          created_at INTEGER DEFAULT (unixepoch())
        )
      `)

      // Copy data from old table to new table
      sqlite.exec(`
        INSERT INTO rolling_optimization_branches_new
          (id, job_id, branch_id, parameter_values, is_start_year, yearly_metrics, rank_by_metric, created_at)
        SELECT
          id, job_id, branch_id, parameter_values, is_start_year, yearly_metrics, rank_by_metric, created_at
        FROM rolling_optimization_branches
      `)

      // Drop old table
      sqlite.exec('DROP TABLE rolling_optimization_branches')

      // Rename new table to original name
      sqlite.exec('ALTER TABLE rolling_optimization_branches_new RENAME TO rolling_optimization_branches')

      // Recreate index
      sqlite.exec('CREATE INDEX IF NOT EXISTS idx_rolling_branches_job ON rolling_optimization_branches(job_id)')

      console.log('[DB] Migration complete: legacy parameters column dropped from rolling_optimization_branches table')
    }
  } catch (e) {
    console.log('[DB] Migration warning for dropping parameters column:', e.message)
  }

  // Migration: Add tree_json column to rolling_optimization_jobs table
  try {
    const rollingJobsCols = sqlite.prepare("PRAGMA table_info(rolling_optimization_jobs)").all()
    const hasTreeJson = rollingJobsCols.some(c => c.name === 'tree_json')
    if (!hasTreeJson) {
      console.log('[DB] Migrating rolling_optimization_jobs table: adding tree_json column...')
      sqlite.exec("ALTER TABLE rolling_optimization_jobs ADD COLUMN tree_json TEXT")
      console.log('[DB] Migration complete: tree_json column added to rolling_optimization_jobs table')
    }
  } catch (e) {
    console.log('[DB] Migration warning for tree_json column:', e.message)
  }

  // Migration: Add is_oos_metrics column to rolling_optimization_branches table
  try {
    const branchesCols = sqlite.prepare("PRAGMA table_info(rolling_optimization_branches)").all()
    const hasIsOosMetrics = branchesCols.some(c => c.name === 'is_oos_metrics')
    if (!hasIsOosMetrics) {
      console.log('[DB] Migrating rolling_optimization_branches table: adding is_oos_metrics column...')
      sqlite.exec("ALTER TABLE rolling_optimization_branches ADD COLUMN is_oos_metrics TEXT")
      console.log('[DB] Migration complete: is_oos_metrics column added to rolling_optimization_branches table')
    }
  } catch (e) {
    console.log('[DB] Migration warning for is_oos_metrics column:', e.message)
  }

  // Migration: Add adaptive_metrics column to rolling_optimization_jobs table
  try {
    const rollingJobsCols2 = sqlite.prepare("PRAGMA table_info(rolling_optimization_jobs)").all()
    const hasAdaptiveMetrics = rollingJobsCols2.some(c => c.name === 'adaptive_metrics')
    if (!hasAdaptiveMetrics) {
      console.log('[DB] Migrating rolling_optimization_jobs table: adding adaptive_metrics column...')
      sqlite.exec("ALTER TABLE rolling_optimization_jobs ADD COLUMN adaptive_metrics TEXT")
      console.log('[DB] Migration complete: adaptive_metrics column added to rolling_optimization_jobs table')
    }
  } catch (e) {
    console.log('[DB] Migration warning for adaptive_metrics column:', e.message)
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
    sqlite.prepare('INSERT INTO admin_config (key, value, updated_at) VALUES (?, ?, ?)').run('atlas_fee_percent', '1.0', now)
    sqlite.prepare('INSERT INTO admin_config (key, value, updated_at) VALUES (?, ?, ?)').run('partner_share_percent', '1.0', now)
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

  // Clean up unverified users (stuck from before email was configured)
  // Delete users who are pending_verification and were created more than 1 hour ago
  const stuckUsers = sqlite.prepare(`
    DELETE FROM users
    WHERE status = 'pending_verification'
      AND email_verified = 0
      AND role != 'admin'
  `).run()
  if (stuckUsers.changes > 0) {
    console.log(`[DB] Cleaned up ${stuckUsers.changes} unverified users`)
  }

  // Force upgrade ADMIN_EMAIL to admin role (synchronous fallback for seed-admin)
  const adminEmail = process.env.ADMIN_EMAIL
  if (adminEmail) {
    const upgraded = sqlite.prepare(`
      UPDATE users SET
        role = 'admin',
        email_verified = 1,
        status = 'active',
        tier = 'premium',
        updated_at = datetime('now')
      WHERE email = ? AND role != 'admin'
    `).run(adminEmail.toLowerCase())
    if (upgraded.changes > 0) {
      console.log(`[DB] Force-upgraded ${adminEmail} to admin role`)
    }
  }

  // Clean up orphaned bots (not in any watchlist)
  // IMPORTANT: Only delete truly temporary bots that were never properly saved
  // Preserve:
  // - Any bot in a watchlist (normal saved bots)
  // - Any bot with non-private visibility (nexus, nexus_eligible, atlas)
  // - Any bot with tags (explicitly configured by user)
  const orphanedBots = sqlite.prepare(`
    DELETE FROM bots
    WHERE id NOT IN (SELECT DISTINCT bot_id FROM watchlist_bots)
      AND visibility = 'private'
      AND (tags IS NULL OR tags = '[]' OR tags = 'null')
  `).run()
  if (orphanedBots.changes > 0) {
    console.log(`[DB] Cleaned up ${orphanedBots.changes} orphaned private bots (not in any watchlist)`)
  }

  // FRD-035: Seed Variable Library with all built-in indicators
  seedVariableLibrary()

  // Create local-user for development (matches auth.mjs mock user)
  const existingLocalUser = sqlite.prepare('SELECT id FROM users WHERE id = ?').get('local-user')
  if (!existingLocalUser) {
    const now = Date.now()
    sqlite.prepare(`
      INSERT INTO users (id, username, email, password_hash, display_name, role, tier, email_verified, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'local-user',
      'local',
      'local@localhost',
      'local-dev-no-password',
      'Local Development User',
      'main_admin',
      'premium',
      1,
      'active',
      now,
      now
    )
    console.log('[DB] Created local-user for development')
  }

  console.log('[DB] Database initialized')
}

/**
 * Seed the Variable Library with all built-in indicators
 * This provides documentation and enables custom indicator formula references
 */
function seedVariableLibrary() {
  const existingCount = sqlite.prepare('SELECT COUNT(*) as count FROM metric_variables').get()
  if (existingCount.count > 0) return // Already seeded

  const now = Date.now()
  const insertStmt = sqlite.prepare(`
    INSERT INTO metric_variables (variable_name, display_name, description, formula, category, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  const variables = [
    // Price
    ['close', 'Current Price', 'The current closing price of the asset', 'Price = Close', 'Price'],
    ['open', 'Open Price', 'The opening price of the current bar', 'Price = Open', 'Price'],
    ['high', 'High Price', 'The highest price of the current bar', 'Price = High', 'Price'],
    ['low', 'Low Price', 'The lowest price of the current bar', 'Price = Low', 'Price'],
    ['volume', 'Volume', 'Trading volume for the current bar', 'Volume', 'Price'],

    // Moving Averages
    ['sma', 'Simple Moving Average', 'Average price over N periods, equal weight to all', 'SMA = Σ(Close) / N', 'Moving Averages'],
    ['ema', 'Exponential Moving Average', 'Weighted average giving more weight to recent prices', 'EMA = α×Close + (1-α)×EMA_prev, α=2/(N+1)', 'Moving Averages'],
    ['hma', 'Hull Moving Average', 'Reduced lag MA using weighted MAs', 'HMA = WMA(2×WMA(N/2) - WMA(N), √N)', 'Moving Averages'],
    ['wma', 'Weighted Moving Average', 'Linear weighted average, recent prices weighted more', 'WMA = Σ(i×Close_i) / Σ(i), i=1..N', 'Moving Averages'],
    ['wilderma', 'Wilder Moving Average', 'Smoothed MA used in RSI, slower response', 'WilderMA = (Prev×(N-1) + Close) / N', 'Moving Averages'],
    ['dema', 'DEMA', 'Double EMA reduces lag vs single EMA', 'DEMA = 2×EMA - EMA(EMA)', 'Moving Averages'],
    ['tema', 'TEMA', 'Triple EMA for even less lag', 'TEMA = 3×EMA - 3×EMA² + EMA³', 'Moving Averages'],
    ['kama', 'KAMA', 'Kaufman Adaptive MA - adapts smoothing based on market noise', 'KAMA = KAMA_prev + SC²×(Close - KAMA_prev)', 'Moving Averages'],

    // RSI & Variants
    ['rsi', 'Relative Strength Index', "Wilder's RSI, momentum oscillator 0-100", 'RSI = 100 - 100/(1 + AvgGain/AvgLoss)', 'RSI & Variants'],
    ['rsi_sma', 'RSI (SMA)', 'RSI using simple moving average smoothing', 'RSI_SMA = 100 - 100/(1 + SMA(Gains)/SMA(Losses))', 'RSI & Variants'],
    ['rsi_ema', 'RSI (EMA)', 'RSI using exponential moving average smoothing', 'RSI_EMA = 100 - 100/(1 + EMA(Gains)/EMA(Losses))', 'RSI & Variants'],
    ['stochrsi', 'Stochastic RSI', 'Stochastic applied to RSI values, more sensitive', 'StochRSI = (RSI - RSI_Low) / (RSI_High - RSI_Low)', 'RSI & Variants'],
    ['laguerrersi', 'Laguerre RSI', "Ehlers' Laguerre filter RSI, smoother", 'Uses 4-element Laguerre filter with gamma', 'RSI & Variants'],

    // Momentum
    ['momentum_w', '13612W Momentum', 'Weighted momentum score using 1/3/6/12 month returns', '12×M1 + 4×M3 + 2×M6 + M12', 'Momentum'],
    ['momentum_u', '13612U Momentum', 'Unweighted momentum score', 'M1 + M3 + M6 + M12 (equal weight)', 'Momentum'],
    ['momentum_sma12', 'SMA12 Momentum', 'SMA of 12-month returns', 'SMA(12-month return, N)', 'Momentum'],
    ['roc', 'Rate of Change', 'Percent change over N periods', 'ROC = (Close - Close_N) / Close_N × 100', 'Momentum'],
    ['willr', 'Williams %R', 'Momentum indicator, inverse of Fast Stochastic', '%R = (High_N - Close) / (High_N - Low_N) × -100', 'Momentum'],
    ['cci', 'CCI', 'Commodity Channel Index - measures price deviation from average', 'CCI = (TP - SMA(TP)) / (0.015 × MeanDev)', 'Momentum'],
    ['stochk', 'Stochastic %K', 'Fast Stochastic, price position in range', '%K = (Close - Low_N) / (High_N - Low_N) × 100', 'Momentum'],
    ['stochd', 'Stochastic %D', 'Slow Stochastic, SMA of %K', '%D = SMA(%K, 3)', 'Momentum'],
    ['adx', 'ADX', 'Average Directional Index - trend strength 0-100', 'ADX = SMA(|+DI - -DI| / (+DI + -DI) × 100)', 'Momentum'],

    // Volatility
    ['stdev', 'Standard Deviation', 'Volatility of returns over N periods', 'StdDev = √(Σ(r - r̄)² / N)', 'Volatility'],
    ['stdev_price', 'Standard Deviation of Price', 'Volatility of price levels (absolute $)', 'StdDev = √(Σ(P - P̄)² / N)', 'Volatility'],
    ['maxdd', 'Max Drawdown', 'Largest peak-to-trough decline over N periods', 'MaxDD = max((Peak - Trough) / Peak)', 'Volatility'],
    ['drawdown', 'Drawdown', 'Current decline from all-time high', 'DD = (Peak - Current) / Peak', 'Volatility'],
    ['bbpctb', 'Bollinger %B', 'Position within Bollinger Bands (0-1)', '%B = (Close - LowerBand) / (UpperBand - LowerBand)', 'Volatility'],
    ['bbwidth', 'Bollinger Bandwidth', 'Width of Bollinger Bands as % of middle', 'BW = (Upper - Lower) / Middle × 100', 'Volatility'],
    ['atr', 'ATR', 'Average True Range, volatility measure', 'ATR = SMA(max(H-L, |H-C_prev|, |L-C_prev|))', 'Volatility'],
    ['atr_pct', 'ATR %', 'ATR as percentage of price', 'ATR% = ATR / Close × 100', 'Volatility'],
    ['hvol', 'Historical Volatility', 'Annualized standard deviation of returns', 'HV = StdDev(returns) × √252', 'Volatility'],
    ['ulcer', 'Ulcer Index', 'Measures downside volatility/drawdown pain', 'UI = √(Σ(DD²) / N)', 'Volatility'],

    // Trend
    ['cumret', 'Cumulative Return', 'Total return over N periods', 'CumRet = (Close / Close_N) - 1', 'Trend'],
    ['sma_ret', 'SMA of Returns', 'Smoothed average of daily returns', 'SMA(daily returns, N)', 'Trend'],
    ['r2', 'Trend Clarity', 'R² of price regression, trend strength 0-1', 'R² = 1 - (SS_res / SS_tot)', 'Trend'],
    ['ultsmooth', 'Ultimate Smoother', "Ehlers' low-lag 3-pole Butterworth filter", '3-pole Butterworth filter', 'Trend'],
    ['linreg_slope', 'Linear Reg Slope', 'Slope of best-fit line through prices', 'Slope = Σ((x-x̄)(y-ȳ)) / Σ(x-x̄)²', 'Trend'],
    ['linreg_value', 'Linear Reg Value', 'Current value on regression line', 'Value = Intercept + Slope × N', 'Trend'],
    ['price_vs_sma', 'Price vs SMA', 'Ratio of price to its moving average', 'Ratio = Close / SMA(Close, N)', 'Trend'],

    // Aroon
    ['aroon_up', 'Aroon Up', 'Days since highest high (0-100)', 'AroonUp = ((N - DaysSinceHigh) / N) × 100', 'Aroon'],
    ['aroon_down', 'Aroon Down', 'Days since lowest low (0-100)', 'AroonDown = ((N - DaysSinceLow) / N) × 100', 'Aroon'],
    ['aroon_osc', 'Aroon Oscillator', 'Difference between Aroon Up and Down', 'AroonOsc = AroonUp - AroonDown', 'Aroon'],

    // MACD/PPO
    ['macd_hist', 'MACD Histogram', 'MACD minus signal line (fixed 12/26/9)', 'Hist = (EMA12 - EMA26) - EMA9(EMA12 - EMA26)', 'MACD/PPO'],
    ['ppo_hist', 'PPO Histogram', 'Percentage Price Oscillator histogram', 'PPO = ((EMA12 - EMA26) / EMA26) × 100', 'MACD/PPO'],

    // Volume-based
    ['mfi', 'Money Flow Index', 'Volume-weighted RSI, measures buying/selling pressure', 'MFI = 100 - 100/(1 + PosMF/NegMF)', 'Volume'],
    ['obv_roc', 'OBV Rate of Change', 'Momentum of cumulative On-Balance Volume', 'OBV ROC = (OBV - OBV_N) / |OBV_N| × 100', 'Volume'],
    ['vwap_ratio', 'VWAP Ratio', 'Price vs Volume-Weighted Avg Price (100 = at VWAP)', 'Ratio = Close / VWAP × 100', 'Volume'],
  ]

  const transaction = sqlite.transaction(() => {
    for (const [varName, displayName, desc, formula, category] of variables) {
      insertStmt.run(varName, displayName, desc, formula, category, now)
    }
  })

  transaction()
  console.log(`[DB] Variable Library seeded with ${variables.length} indicators`)
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
  // Get all Nexus bots (visibility = 'nexus') - NO payload for security
  // Note: Atlas bots are now stored in a separate private database (atlas-db.mjs)
  // and are only accessible to main_admin via /api/atlas/bots endpoints
  const bots = await db.query.bots.findMany({
    where: and(
      eq(schema.bots.visibility, 'nexus'),
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
      owner_display_name: ownerRow?.display_name || null, // Flat field to match other endpoints
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

  const isDraftValue = data.isDraft ? 1 : 0
  console.log('[TRASH-DEBUG] createBot called:', {
    id,
    name: data.name,
    isDraft: data.isDraft,
    isDraftValue,
    ownerId: data.ownerId,
  })

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
    isDraft: isDraftValue, // Support draft bots for auto-save
    createdAt: now,
    updatedAt: now,
  })

  console.log('[TRASH-DEBUG] Bot created successfully with isDraft:', isDraftValue)
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
  if (data.isDraft !== undefined) updateData.isDraft = data.isDraft ? 1 : 0

  await db.update(schema.bots)
    .set(updateData)
    .where(eq(schema.bots.id, id))

  return id
}

export async function deleteBot(id, ownerId) {
  // Soft delete
  console.log('[TRASH-DEBUG] deleteBot called:', { id, ownerId })

  // First check if bot exists and get its info
  const bot = sqlite.prepare(`
    SELECT id, name, is_draft, deleted_at FROM bots WHERE id = ? AND owner_id = ?
  `).get(id, ownerId)

  console.log('[TRASH-DEBUG] Bot before delete:', bot)

  const deletedAt = Date.now()
  const result = sqlite.prepare(`
    UPDATE bots SET deleted_at = ? WHERE id = ? AND owner_id = ?
  `).run(deletedAt, id, ownerId)

  console.log('[TRASH-DEBUG] Delete result:', {
    changes: result.changes,
    deletedAt,
    success: result.changes > 0,
  })

  return result.changes > 0
}

/**
 * Hard delete a Nexus/Atlas bot (immediate permanent deletion)
 * @param {string} id - Bot ID
 * @param {string} ownerId - User ID (for ownership verification)
 * @returns {Promise<boolean>} True if deleted
 */
export async function hardDeleteBot(id, ownerId) {
  // Verify bot has Nexus or Atlas tag before hard delete
  const bot = sqlite.prepare(`
    SELECT tags FROM bots WHERE id = ? AND owner_id = ?
  `).get(id, ownerId)

  if (!bot) return false

  const tags = JSON.parse(bot.tags || '[]')
  const isNexusOrAtlas = tags.includes('Nexus') || tags.includes('Atlas')

  if (!isNexusOrAtlas) {
    throw new Error('Only Nexus/Atlas bots can be hard deleted')
  }

  const result = sqlite.prepare(`
    DELETE FROM bots WHERE id = ? AND owner_id = ?
  `).run(id, ownerId)

  return result.changes > 0
}

/**
 * Get deleted bots for a user (trash view)
 * @param {string} ownerId - User ID
 * @returns {Promise<Array>} Array of deleted user-created bots with deletion timestamp
 */
export async function getDeletedBotsByOwner(ownerId) {
  console.log('[TRASH-DEBUG] getDeletedBotsByOwner called for:', ownerId)

  const bots = sqlite.prepare(`
    SELECT * FROM bots
    WHERE owner_id = ? AND deleted_at IS NOT NULL
    ORDER BY deleted_at DESC
  `).all(ownerId)

  console.log('[TRASH-DEBUG] Raw query returned', bots.length, 'bots')
  console.log('[TRASH-DEBUG] Bot details:', bots.map(b => ({
    id: b.id,
    name: b.name,
    isDraft: b.is_draft,
    deletedAt: b.deleted_at,
    tags: b.tags,
  })))

  // Decompress payloads and attach metrics
  const botsWithMetrics = await Promise.all(bots.map(async (bot) => {
    const metricsRow = sqlite.prepare('SELECT * FROM bot_metrics WHERE bot_id = ?').get(bot.id)
    if (bot.payload) {
      bot.payload = await decompressPayload(bot.payload)
    }
    const tags = bot.tags ? JSON.parse(bot.tags) : []
    return {
      id: bot.id,
      name: bot.name,
      description: bot.description,
      builderId: bot.owner_id,
      payload: bot.payload,
      tags,
      backtestMode: bot.backtest_mode,
      createdAt: bot.created_at,
      updatedAt: bot.updated_at,
      deletedAt: bot.deleted_at,
      isDraft: Boolean(bot.is_draft), // Include draft flag for frontend
      metrics: metricsRow || null,
    }
  }))

  // Filter out Nexus/Atlas bots (they shouldn't be in trash)
  const filtered = botsWithMetrics.filter(b => !b.tags.includes('Nexus') && !b.tags.includes('Atlas'))
  console.log('[TRASH-DEBUG] After filtering Nexus/Atlas:', filtered.length, 'bots')
  return filtered
}

/**
 * Restore a deleted bot (set deleted_at = NULL)
 * @param {string} id - Bot ID
 * @param {string} ownerId - User ID (for ownership verification)
 * @returns {Promise<boolean>} True if restored
 */
export async function restoreBot(id, ownerId) {
  const result = sqlite.prepare(`
    UPDATE bots SET deleted_at = NULL
    WHERE id = ? AND owner_id = ? AND deleted_at IS NOT NULL
  `).run(id, ownerId)
  return result.changes > 0
}

/**
 * Permanently delete a bot (actual DELETE)
 * @param {string} id - Bot ID
 * @param {string} ownerId - User ID (for ownership verification)
 * @returns {Promise<boolean>} True if deleted
 */
export async function permanentlyDeleteBot(id, ownerId) {
  const result = sqlite.prepare(`
    DELETE FROM bots WHERE id = ? AND owner_id = ? AND deleted_at IS NOT NULL
  `).run(id, ownerId)
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

  // Also update the users table theme/color_scheme (for admin view)
  if (data.theme || data.colorScheme) {
    await db.update(schema.users)
      .set({
        ...(data.theme && { theme: data.theme }),
        ...(data.colorScheme && { colorScheme: data.colorScheme }),
        updatedAt: now,
      })
      .where(eq(schema.users.id, userId))
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

// ============================================
// TICKER LIST OPERATIONS
// ============================================

/**
 * Get all ticker lists for a user
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Array of ticker lists
 */
export async function getTickerListsByUser(userId) {
  const lists = sqlite.prepare(`
    SELECT * FROM ticker_lists WHERE user_id = ? ORDER BY created_at DESC
  `).all(userId)

  return lists.map(list => ({
    id: list.id,
    userId: list.user_id,
    name: list.name,
    description: list.description,
    tags: JSON.parse(list.tags || '[]'),
    tickers: JSON.parse(list.tickers),
    metadata: JSON.parse(list.metadata || '{}'),
    createdAt: list.created_at,
    updatedAt: list.updated_at
  }))
}

/**
 * Create a new ticker list
 * @param {Object} data - Ticker list data
 * @returns {Promise<string>} Created ticker list ID
 */
export async function createTickerList(data) {
  const id = generateId()
  const now = Date.now()

  sqlite.prepare(`
    INSERT INTO ticker_lists (id, user_id, name, description, tags, tickers, metadata, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.userId,
    data.name,
    data.description || null,
    JSON.stringify(data.tags || []),
    JSON.stringify(data.tickers),
    JSON.stringify(data.metadata || {}),
    now,
    now
  )

  return id
}

/**
 * Update an existing ticker list
 * @param {string} id - Ticker list ID
 * @param {string} userId - User ID (for ownership verification)
 * @param {Object} data - Updated data
 * @returns {Promise<string|null>} Ticker list ID or null if not found
 */
export async function updateTickerList(id, userId, data) {
  // Verify ownership
  const existing = sqlite.prepare('SELECT id FROM ticker_lists WHERE id = ? AND user_id = ?').get(id, userId)
  if (!existing) return null

  const now = Date.now()
  const updates = []
  const values = []

  if (data.name !== undefined) {
    updates.push('name = ?')
    values.push(data.name)
  }
  if (data.description !== undefined) {
    updates.push('description = ?')
    values.push(data.description)
  }
  if (data.tags !== undefined) {
    updates.push('tags = ?')
    values.push(JSON.stringify(data.tags))
  }
  if (data.tickers !== undefined) {
    updates.push('tickers = ?')
    values.push(JSON.stringify(data.tickers))
  }
  if (data.metadata !== undefined) {
    updates.push('metadata = ?')
    values.push(JSON.stringify(data.metadata))
  }

  updates.push('updated_at = ?')
  values.push(now)
  values.push(id)

  sqlite.prepare(`UPDATE ticker_lists SET ${updates.join(', ')} WHERE id = ?`).run(...values)
  return id
}

/**
 * Delete a ticker list
 * @param {string} id - Ticker list ID
 * @param {string} userId - User ID (for ownership verification)
 * @returns {Promise<boolean>} True if deleted, false if not found
 */
export async function deleteTickerList(id, userId) {
  const result = sqlite.prepare('DELETE FROM ticker_lists WHERE id = ? AND user_id = ?').run(id, userId)
  return result.changes > 0
}

// ============================================
// SAVED SHARDS CRUD
// ============================================

/**
 * Get all saved shards for a user (list view - excludes full branch data)
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Array of shard list items
 */
export async function getShardsByUser(userId) {
  const shards = sqlite.prepare(`
    SELECT id, name, description, source_job_ids, loaded_job_type, branch_count, filter_summary, created_at, updated_at
    FROM saved_shards
    WHERE owner_id = ? AND deleted_at IS NULL
    ORDER BY created_at DESC
  `).all(userId)

  return shards.map(shard => ({
    id: shard.id,
    name: shard.name,
    description: shard.description,
    sourceJobIds: JSON.parse(shard.source_job_ids || '[]'),
    loadedJobType: shard.loaded_job_type,
    branchCount: shard.branch_count,
    filterSummary: shard.filter_summary,
    createdAt: shard.created_at,
    updatedAt: shard.updated_at
  }))
}

/**
 * Get all saved shards (admin view - for admin dashboard)
 * @returns {Promise<Array>} Array of all shards with owner info
 */
export async function getAllShards() {
  const shards = sqlite.prepare(`
    SELECT s.*, u.username as owner_username, u.display_name as owner_display_name
    FROM saved_shards s
    LEFT JOIN users u ON s.owner_id = u.id
    WHERE s.deleted_at IS NULL
    ORDER BY s.created_at DESC
  `).all()

  return shards.map(shard => ({
    id: shard.id,
    ownerId: shard.owner_id,
    ownerUsername: shard.owner_username,
    ownerDisplayName: shard.owner_display_name,
    name: shard.name,
    description: shard.description,
    sourceJobIds: JSON.parse(shard.source_job_ids || '[]'),
    loadedJobType: shard.loaded_job_type,
    branchCount: shard.branch_count,
    filterSummary: shard.filter_summary,
    createdAt: shard.created_at,
    updatedAt: shard.updated_at
  }))
}

/**
 * Get a single shard by ID (includes full branch data)
 * @param {string} id - Shard ID
 * @param {string} userId - User ID (for ownership verification, pass null for admin)
 * @returns {Promise<Object|null>} Shard object or null if not found
 */
export async function getShardById(id, userId = null) {
  const query = userId
    ? 'SELECT * FROM saved_shards WHERE id = ? AND owner_id = ? AND deleted_at IS NULL'
    : 'SELECT * FROM saved_shards WHERE id = ? AND deleted_at IS NULL'

  const params = userId ? [id, userId] : [id]
  const shard = sqlite.prepare(query).get(...params)

  if (!shard) return null

  return {
    id: shard.id,
    ownerId: shard.owner_id,
    name: shard.name,
    description: shard.description,
    sourceJobIds: JSON.parse(shard.source_job_ids || '[]'),
    loadedJobType: shard.loaded_job_type,
    branches: JSON.parse(shard.branches || '[]'),
    branchCount: shard.branch_count,
    filterSummary: shard.filter_summary,
    createdAt: shard.created_at,
    updatedAt: shard.updated_at
  }
}

/**
 * Create a new saved shard
 * @param {Object} data - Shard data
 * @returns {Promise<string>} Created shard ID
 */
export async function createShard(data) {
  const id = data.id || `shard-${Date.now()}`
  const now = Date.now()

  sqlite.prepare(`
    INSERT INTO saved_shards (id, owner_id, name, description, source_job_ids, loaded_job_type, branches, branch_count, filter_summary, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.ownerId,
    data.name,
    data.description || null,
    JSON.stringify(data.sourceJobIds || []),
    data.loadedJobType,
    JSON.stringify(data.branches || []),
    data.branchCount || data.branches?.length || 0,
    data.filterSummary || null,
    now,
    now
  )

  return id
}

/**
 * Update an existing shard
 * @param {string} id - Shard ID
 * @param {string} userId - User ID (for ownership verification)
 * @param {Object} data - Updated data
 * @returns {Promise<string|null>} Shard ID or null if not found
 */
export async function updateShard(id, userId, data) {
  // Verify ownership
  const existing = sqlite.prepare('SELECT id FROM saved_shards WHERE id = ? AND owner_id = ? AND deleted_at IS NULL').get(id, userId)
  if (!existing) return null

  const now = Date.now()
  const updates = []
  const values = []

  if (data.name !== undefined) {
    updates.push('name = ?')
    values.push(data.name)
  }
  if (data.description !== undefined) {
    updates.push('description = ?')
    values.push(data.description)
  }

  updates.push('updated_at = ?')
  values.push(now)
  values.push(id)

  sqlite.prepare(`UPDATE saved_shards SET ${updates.join(', ')} WHERE id = ?`).run(...values)
  return id
}

/**
 * Delete a shard (soft delete)
 * @param {string} id - Shard ID
 * @param {string} userId - User ID (for ownership verification)
 * @returns {Promise<boolean>} True if deleted, false if not found
 */
export async function deleteShard(id, userId) {
  const now = Date.now()
  const result = sqlite.prepare('UPDATE saved_shards SET deleted_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL').run(now, id, userId)
  return result.changes > 0
}

/**
 * Get deleted shards for a user (trash view)
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Array of deleted shards
 */
export async function getDeletedShardsByUser(userId) {
  const shards = sqlite.prepare(`
    SELECT id, name, description, source_job_ids, loaded_job_type,
           branch_count, filter_summary, created_at, updated_at, deleted_at
    FROM saved_shards
    WHERE owner_id = ? AND deleted_at IS NOT NULL
    ORDER BY deleted_at DESC
  `).all(userId)

  return shards.map(shard => ({
    id: shard.id,
    name: shard.name,
    description: shard.description,
    sourceJobIds: JSON.parse(shard.source_job_ids || '[]'),
    loadedJobType: shard.loaded_job_type,
    branchCount: shard.branch_count,
    filterSummary: shard.filter_summary,
    createdAt: shard.created_at,
    updatedAt: shard.updated_at,
    deletedAt: shard.deleted_at,
  }))
}

/**
 * Restore a deleted shard (set deleted_at = NULL)
 * @param {string} id - Shard ID
 * @param {string} userId - User ID (for ownership verification)
 * @returns {Promise<boolean>} True if restored
 */
export async function restoreShard(id, userId) {
  const result = sqlite.prepare(`
    UPDATE saved_shards SET deleted_at = NULL
    WHERE id = ? AND owner_id = ? AND deleted_at IS NOT NULL
  `).run(id, userId)
  return result.changes > 0
}

/**
 * Permanently delete a shard (actual DELETE)
 * @param {string} id - Shard ID
 * @param {string} userId - User ID (for ownership verification)
 * @returns {Promise<boolean>} True if deleted
 */
export async function permanentlyDeleteShard(id, userId) {
  const result = sqlite.prepare(`
    DELETE FROM saved_shards WHERE id = ? AND owner_id = ? AND deleted_at IS NOT NULL
  `).run(id, userId)
  return result.changes > 0
}

/**
 * Auto-cleanup: Delete items older than 90 days
 * @returns {Promise<{deletedBots: number, deletedShards: number}>}
 */
export async function cleanupOldDeletedItems() {
  const ninetyDaysAgo = Date.now() - (90 * 24 * 60 * 60 * 1000)

  const botsResult = sqlite.prepare(`
    DELETE FROM bots WHERE deleted_at IS NOT NULL AND deleted_at < ?
  `).run(ninetyDaysAgo)

  const shardsResult = sqlite.prepare(`
    DELETE FROM saved_shards WHERE deleted_at IS NOT NULL AND deleted_at < ?
  `).run(ninetyDaysAgo)

  return {
    deletedBots: botsResult.changes,
    deletedShards: shardsResult.changes,
  }
}

// Export the raw sqlite connection for advanced queries
export { sqlite, decompressPayload }

// Auto-initialize database on module load
initializeDatabase()
