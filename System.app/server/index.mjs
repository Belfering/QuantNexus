import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import duckdb from 'duckdb'
import { encrypt, decrypt } from './utils/crypto.mjs'
import { seedAdminUser } from './seed-admin.mjs'
import * as scheduler from './scheduler.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ============================================================================
// Production Security Validation
// ============================================================================
const isProduction = process.env.NODE_ENV === 'production'
if (isProduction) {
  const jwtSecret = process.env.JWT_SECRET
  if (!jwtSecret || jwtSecret.includes('dev-') || jwtSecret.length < 32) {
    console.error('FATAL: JWT_SECRET must be set to a secure value (min 32 chars) in production')
    process.exit(1)
  }
  const refreshSecret = process.env.REFRESH_SECRET
  if (!refreshSecret || refreshSecret.includes('dev-') || refreshSecret.length < 32) {
    console.error('FATAL: REFRESH_SECRET must be set to a secure value (min 32 chars) in production')
    process.exit(1)
  }
  console.log('[api] Production security checks passed')
}

const app = express()

// Trust proxy for Railway/reverse proxy environments (required for rate limiting)
if (isProduction) {
  app.set('trust proxy', 1)
}

// ============================================================================
// Security Middleware
// ============================================================================

// Helmet for security headers (CSP configured for SPA)
app.use(helmet({
  contentSecurityPolicy: isProduction ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  } : false
}))

// CORS configuration
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : ['http://localhost:5173', 'http://localhost:8787'],
  credentials: true
}
app.use(cors(corsOptions))

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requests per window
  message: { error: 'Too many authentication attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
})

// General API rate limiter
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: { error: 'Too many requests, please slow down' },
  standardHeaders: true,
  legacyHeaders: false
})

// Apply rate limiters
app.use('/api/auth/login', authLimiter)
app.use('/api/auth/register', authLimiter)
app.use('/api/', apiLimiter)

app.use(express.json({ limit: '1mb' }))

// Serve static frontend in production
if (isProduction) {
  const distPath = path.resolve(__dirname, '..', 'dist')
  app.use(express.static(distPath))
}
const DEFAULT_ROOT = path.resolve(__dirname, '..', 'ticker-data')
const TICKER_DATA_ROOT = process.env.SYSTEM_TICKER_DATA_ROOT || process.env.TICKER_DATA_MINI_ROOT || DEFAULT_ROOT
const TICKERS_PATH = process.env.TICKERS_PATH || path.join(TICKER_DATA_ROOT, 'tickers.txt')
const PARQUET_DIR = process.env.PARQUET_DIR || path.join(TICKER_DATA_ROOT, 'data', 'ticker_data_parquet')
const PYTHON = process.env.PYTHON || 'python3'

const db = new duckdb.Database(':memory:')
const conn = db.connect()

const jobs = new Map()
const loadedTickers = new Set() // Track which tickers are loaded into memory

// ============================================================================
// TEMPORARY: Pre-load parquet files into memory for fast development/testing
// TODO: Remove this in production - queries should read from disk on-demand
// ============================================================================
async function preloadParquetData() {
  console.log('[api] Pre-loading parquet data into memory...')
  const startTime = Date.now()

  try {
    const tickers = await listParquetTickers()
    console.log(`[api] Found ${tickers.length} parquet files to load`)

    let loaded = 0
    let failed = 0

    for (const ticker of tickers) {
      try {
        const parquetPath = path.join(PARQUET_DIR, `${ticker}.parquet`)
        const fileForDuckdb = parquetPath.replace(/\\/g, '/').replace(/'/g, "''")

        // Create a table for this ticker and load data from parquet
        // Sanitize ticker name for table (same as Python sanitizer)
        const tableName = `ticker_${ticker.replace(/[^A-Z0-9]/g, '_')}`

        // Skip if already loaded (handles BC/PC vs BC_PC collision)
        if (loadedTickers.has(ticker)) {
          continue
        }

        // Check if table already exists (from another ticker with same sanitized name)
        const tableExists = await new Promise((resolve) => {
          conn.all(`SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}'`, (err, rows) => {
            resolve(!err && rows && rows.length > 0)
          })
        })

        if (tableExists) {
          // Table already created by another ticker variant, skip
          loadedTickers.add(ticker)
          loaded++
          continue
        }

        const createSql = `
          CREATE TABLE ${tableName} AS
          SELECT * FROM read_parquet('${fileForDuckdb}')
        `

        await new Promise((resolve, reject) => {
          conn.run(createSql, (err) => {
            if (err) reject(err)
            else resolve()
          })
        })

        loadedTickers.add(ticker)
        loaded++

        if (loaded % 10 === 0) {
          console.log(`[api] Loaded ${loaded}/${tickers.length} tickers...`)
        }
      } catch (err) {
        console.warn(`[api] Failed to load ${ticker}:`, err.message)
        failed++
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
    console.log(`[api] Pre-load complete: ${loaded} loaded, ${failed} failed in ${elapsed}s`)
  } catch (err) {
    console.error('[api] Pre-load failed:', err.message)
  }
}
// ============================================================================

function normalizeTicker(ticker) {
  return String(ticker || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.=^-]/g, '')
}

async function readTickersFile() {
  const raw = await fs.readFile(TICKERS_PATH, 'utf-8')
  const out = []
  const seen = new Set()
  for (const line of raw.split(/\r?\n/)) {
    const t = normalizeTicker(line.replace('\uFEFF', ''))
    if (!t) continue
    if (!seen.has(t)) {
      seen.add(t)
      out.push(t)
    }
  }
  return out
}

async function writeTickersFile(input) {
  const raw = Array.isArray(input) ? input.join('\n') : String(input ?? '')
  const out = []
  const seen = new Set()
  for (const line of raw.split(/\r?\n/)) {
    const t = normalizeTicker(line.replace('\uFEFF', ''))
    if (!t) continue
    if (!seen.has(t)) {
      seen.add(t)
      out.push(t)
    }
  }
  if (out.length === 0) throw new Error('No tickers provided.')
  await fs.mkdir(path.dirname(TICKERS_PATH), { recursive: true })
  await fs.writeFile(TICKERS_PATH, `${out.join('\n')}\n`, 'utf-8')
  return out
}

async function listParquetTickers() {
  let entries = []
  try {
    entries = await fs.readdir(PARQUET_DIR, { withFileTypes: true })
  } catch (e) {
    if (String(e?.code || '') === 'ENOENT') return []
    throw e
  }
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.parquet'))
    .map((e) => e.name.replace(/\.parquet$/i, ''))
    .map((t) => normalizeTicker(t))
    .filter(Boolean)
    .sort()
}

app.get('/api/status', async (_req, res) => {
  const exists = async (p) => {
    try {
      await fs.access(p)
      return true
    } catch {
      return false
    }
  }
  res.json({
    root: TICKER_DATA_ROOT,
    tickersPath: TICKERS_PATH,
    parquetDir: PARQUET_DIR,
    tickersExists: await exists(TICKERS_PATH),
    parquetDirExists: await exists(PARQUET_DIR),
    loadedTickersCount: loadedTickers.size,
  })
})

function newJobId() {
  return `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

app.post('/api/download', async (req, res) => {
  const jobId = newJobId()
  const startedAt = Date.now()

  const source = String(req.body?.source || 'tiingo')  // 'tiingo' | 'yfinance' (default to tiingo)
  const batchSize = Math.max(1, Math.min(500, Number(req.body?.batchSize ?? (source === 'tiingo' ? 50 : 100))))
  const sleepSeconds = Math.max(0, Math.min(60, Number(req.body?.sleepSeconds ?? (source === 'tiingo' ? 0.2 : 3))))
  const maxRetries = Math.max(0, Math.min(10, Number(req.body?.maxRetries ?? 3)))
  const threads = Boolean(req.body?.threads ?? true)
  const limit = Math.max(0, Math.min(100000, Number(req.body?.limit ?? 0)))

  const scriptName = source === 'tiingo' ? 'tiingo_download.py' : 'download.py'
  const scriptPath = path.join(TICKER_DATA_ROOT, scriptName)
  const args = [
    '-u',
    scriptPath,
    '--tickers-file',
    TICKERS_PATH,
    '--out-dir',
    PARQUET_DIR,
    '--batch-size',
    String(batchSize),
    '--sleep-seconds',
    String(sleepSeconds),
    '--max-retries',
    String(maxRetries),
    '--threads',
    threads ? '1' : '0',
    '--limit',
    String(limit),
  ]

  // Add Tiingo API key if using Tiingo source
  if (source === 'tiingo') {
    const tiingoApiKey = await getTiingoApiKey(req.body?.tiingoApiKey)
    if (tiingoApiKey) {
      args.push('--api-key', String(tiingoApiKey))
    }
  }

  const job = {
    id: jobId,
    status: 'running',
    startedAt,
    finishedAt: null,
    error: null,
    config: { source, batchSize, sleepSeconds, maxRetries, threads, limit },
    events: [],
    logs: [],
  }
  jobs.set(jobId, job)

  const child = spawn(PYTHON, args, { windowsHide: true })
  job.pid = child.pid

  const pushLog = (line) => {
    const s = String(line || '').trimEnd()
    if (!s) return
    job.logs.push(s)
    if (job.logs.length > 400) job.logs.splice(0, job.logs.length - 400)
    try {
      const ev = JSON.parse(s)
      if (ev && typeof ev === 'object') {
        job.events.push(ev)
        if (job.events.length > 400) job.events.splice(0, job.events.length - 400)
      }
    } catch {
      // ignore non-JSON lines
    }
  }

  child.stdout.on('data', (buf) => {
    for (const line of String(buf).split(/\r?\n/)) pushLog(line)
  })
  child.stderr.on('data', (buf) => {
    for (const line of String(buf).split(/\r?\n/)) pushLog(line)
  })
  child.on('error', (err) => {
    job.finishedAt = Date.now()
    job.status = 'error'
    job.error = String(err?.message || err)
  })

  child.on('close', (code) => {
    job.finishedAt = Date.now()
    if (code === 0) {
      job.status = 'done'
    } else {
      job.status = 'error'
      job.error = `Downloader exited with code ${code}`
    }
  })

  res.json({ jobId })
})

app.get('/api/download/:jobId', async (req, res) => {
  const job = jobs.get(String(req.params.jobId || ''))
  if (!job) {
    res.status(404).json({ error: 'Job not found' })
    return
  }
  res.json(job)
})

app.get('/api/tickers', async (_req, res) => {
  try {
    let tickers = []
    try {
      tickers = await readTickersFile()
    } catch (e) {
      if (String(e?.code || '') !== 'ENOENT') throw e
    }
    if (tickers.length === 0) tickers = await listParquetTickers()
    res.json({ tickers })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

app.get('/api/tickers/raw', async (_req, res) => {
  try {
    const text = await fs.readFile(TICKERS_PATH, 'utf-8')
    res.json({ text })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

app.put('/api/tickers', async (req, res) => {
  try {
    const text = req.body?.text
    const tickers = req.body?.tickers
    const next = await writeTickersFile(text ?? tickers ?? '')
    res.json({ tickers: next })
  } catch (e) {
    res.status(400).json({ error: String(e?.message || e) })
  }
})

app.get('/api/parquet-tickers', async (_req, res) => {
  try {
    res.json({ tickers: await listParquetTickers() })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// ============================================
// TICKER REGISTRY ENDPOINTS
// ============================================
import * as tickerRegistry from './db/ticker-registry.mjs'

// Get registry statistics
app.get('/api/tickers/registry/stats', async (_req, res) => {
  try {
    await tickerRegistry.ensureTickerRegistryTable()
    const stats = await tickerRegistry.getRegistryStats()
    res.json(stats)
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// Sync ticker list from Tiingo
app.post('/api/tickers/registry/sync', async (req, res) => {
  const jobId = newJobId()
  const startedAt = Date.now()

  try {
    await tickerRegistry.ensureTickerRegistryTable()

    // Run sync_tickers.py to download Tiingo master list
    const syncScript = path.join(TICKER_DATA_ROOT, 'sync_tickers.py')
    const tickersJsonPath = path.join(TICKER_DATA_ROOT, 'tiingo_tickers.json')

    const job = {
      id: jobId,
      type: 'registry_sync',
      status: 'running',
      phase: 'downloading_master_list',
      startedAt,
      finishedAt: null,
      error: null,
      progress: { downloaded: 0, imported: 0, total: 0 },
      events: [],
      logs: [],
    }
    jobs.set(jobId, job)

    // Start the sync process
    const syncArgs = ['-u', syncScript, '--output', tickersJsonPath, '--us-only', '--active-only']
    const syncChild = spawn(PYTHON, syncArgs, { windowsHide: true })

    syncChild.stdout.on('data', (buf) => {
      const lines = String(buf).split(/\r?\n/).filter(Boolean)
      for (const line of lines) {
        job.logs.push(line)
        if (job.logs.length > 400) job.logs.splice(0, job.logs.length - 400)
      }
    })

    syncChild.stderr.on('data', (buf) => {
      const lines = String(buf).split(/\r?\n/).filter(Boolean)
      for (const line of lines) {
        job.logs.push('[stderr] ' + line)
      }
    })

    syncChild.on('close', async (code) => {
      if (code !== 0) {
        job.status = 'error'
        job.error = `sync_tickers.py exited with code ${code}`
        job.finishedAt = Date.now()
        return
      }

      // Import the downloaded tickers into the database
      job.phase = 'importing_to_database'
      try {
        const tickersData = JSON.parse(await fs.readFile(tickersJsonPath, 'utf-8'))
        job.progress.downloaded = tickersData.length

        const result = await tickerRegistry.importTickers(tickersData, { usOnly: true })
        job.progress.imported = result.imported
        job.progress.total = result.total

        job.status = 'done'
        job.phase = 'complete'
        job.finishedAt = Date.now()
      } catch (e) {
        job.status = 'error'
        job.error = String(e?.message || e)
        job.finishedAt = Date.now()
      }
    })

    res.json({ jobId })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// Start downloading OHLCV data for all registered tickers
app.post('/api/tickers/registry/download', async (req, res) => {
  const jobId = newJobId()
  const startedAt = Date.now()
  const today = new Date().toISOString().slice(0, 10)

  try {
    await tickerRegistry.ensureTickerRegistryTable()

    // Get tickers needing sync
    const incrementalOnly = req.body?.incrementalOnly !== false
    const tickers = incrementalOnly
      ? await tickerRegistry.getTickersNeedingSync(today)
      : await tickerRegistry.getActiveUSTickers()

    if (tickers.length === 0) {
      res.json({ jobId: null, message: 'All tickers are already synced for today', synced: 0 })
      return
    }

    // Write tickers to a temp JSON file for the download script
    const tempTickersPath = path.join(TICKER_DATA_ROOT, '_pending_tickers.json')
    await fs.writeFile(tempTickersPath, JSON.stringify(tickers), 'utf-8')

    // Get tickers that already have metadata (to skip redundant API calls)
    const tickersWithMetadata = await tickerRegistry.getTickersWithMetadata()
    const skipMetadataPath = path.join(TICKER_DATA_ROOT, '_skip_metadata.json')
    await fs.writeFile(skipMetadataPath, JSON.stringify(tickersWithMetadata), 'utf-8')

    const batchSize = Math.max(1, Math.min(500, Number(req.body?.batchSize ?? 50)))
    const sleepSeconds = Math.max(0, Math.min(60, Number(req.body?.sleepSeconds ?? 0.2)))
    const limit = Math.max(0, Number(req.body?.limit ?? 0))

    const scriptPath = path.join(TICKER_DATA_ROOT, 'tiingo_download.py')
    const args = [
      '-u',
      scriptPath,
      '--tickers-json',
      tempTickersPath,
      '--out-dir',
      PARQUET_DIR,
      '--batch-size',
      String(batchSize),
      '--sleep-seconds',
      String(sleepSeconds),
      '--max-retries',
      '3',
    ]

    if (limit > 0) {
      args.push('--limit', String(limit))
    }

    // Pass skip-metadata list to avoid redundant API calls
    args.push('--skip-metadata-json', skipMetadataPath)

    // For bulk downloads (>100 tickers), skip metadata entirely for speed
    // Metadata can be fetched separately later
    if (tickers.length > 100) {
      args.push('--no-metadata')
      console.log(`[api] Bulk download mode: skipping metadata for ${tickers.length} tickers`)
    }

    // Add Tiingo API key if available
    const tiingoApiKey = await getTiingoApiKey(req.body?.tiingoApiKey)
    if (tiingoApiKey) {
      args.push('--api-key', String(tiingoApiKey))
    }

    const job = {
      id: jobId,
      type: 'registry_download',
      status: 'running',
      startedAt,
      finishedAt: null,
      error: null,
      config: { batchSize, sleepSeconds, limit, incrementalOnly, tickerCount: tickers.length },
      events: [],
      logs: [],
      syncedTickers: [],
    }
    jobs.set(jobId, job)

    // Log the command for debugging
    console.log(`[api] Download job ${jobId}: ${PYTHON} ${args.join(' ')}`)
    console.log(`[api] PARQUET_DIR: ${PARQUET_DIR}`)

    const child = spawn(PYTHON, args, { windowsHide: true })
    job.pid = child.pid

    child.stdout.on('data', (buf) => {
      // Log to console as well for debugging
      console.log('[api] download stdout:', String(buf).trim())
      for (const line of String(buf).split(/\r?\n/)) {
        const s = line.trimEnd()
        if (!s) continue
        job.logs.push(s)
        if (job.logs.length > 400) job.logs.splice(0, job.logs.length - 400)
        try {
          const ev = JSON.parse(s)
          if (ev && typeof ev === 'object') {
            job.events.push(ev)
            if (job.events.length > 400) job.events.splice(0, job.events.length - 400)
            // Track synced tickers
            if (ev.type === 'ticker_saved' && ev.ticker) {
              job.syncedTickers.push(ev.ticker)
              // Mark as synced in database
              tickerRegistry.markTickerSynced(ev.ticker, today).catch(() => {})
              // Update ticker metadata (name, description) if provided
              if (ev.name || ev.description) {
                tickerRegistry.updateTickerMetadata(ev.ticker, {
                  name: ev.name,
                  description: ev.description
                }).catch(() => {})
              }
            }
          }
        } catch {
          // ignore non-JSON lines
        }
      }
    })

    child.stderr.on('data', (buf) => {
      for (const line of String(buf).split(/\r?\n/)) {
        const s = line.trimEnd()
        if (s) job.logs.push('[stderr] ' + s)
      }
    })

    child.on('error', (err) => {
      job.finishedAt = Date.now()
      job.status = 'error'
      job.error = String(err?.message || err)
    })

    child.on('close', (code) => {
      job.finishedAt = Date.now()
      if (code === 0) {
        job.status = 'done'
      } else {
        job.status = 'error'
        job.error = `Downloader exited with code ${code}`
      }
    })

    res.json({ jobId, tickerCount: tickers.length })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// Search tickers in the registry
app.get('/api/tickers/registry/search', async (req, res) => {
  try {
    await tickerRegistry.ensureTickerRegistryTable()
    const query = String(req.query.q || '').trim()
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20))
    const assetType = req.query.assetType || null  // 'Stock', 'ETF', or null for all
    const results = await tickerRegistry.searchTickers(query, { limit, assetType })
    res.json({ results })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// Get all ticker metadata (for ETFs Only mode filtering)
app.get('/api/tickers/registry/metadata', async (req, res) => {
  try {
    await tickerRegistry.ensureTickerRegistryTable()
    const allTickers = await tickerRegistry.getAllTickerMetadata()
    res.json({ tickers: allTickers })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

app.get('/api/debug/:ticker', async (req, res) => {
  const ticker = normalizeTicker(req.params.ticker)
  if (!ticker) {
    res.status(400).json({ error: 'Missing ticker' })
    return
  }

  const tableName = `ticker_${ticker.replace(/[^A-Z0-9]/g, '_')}`

  if (!loadedTickers.has(ticker)) {
    res.status(404).json({ error: `Ticker ${ticker} not loaded`, loadedTickers: Array.from(loadedTickers).slice(0, 10) })
    return
  }

  // Get raw data sample
  const sampleSql = `SELECT * FROM ${tableName} LIMIT 5`
  conn.all(sampleSql, (err, rows) => {
    if (err) {
      res.status(500).json({ error: String(err?.message || err), tableName })
      return
    }
    res.json({ ticker, tableName, rowCount: rows?.length || 0, sampleRows: rows })
  })
})

app.get('/api/candles/:ticker', async (req, res) => {
  const ticker = normalizeTicker(req.params.ticker)
  const limit = Math.max(50, Math.min(20000, Number(req.query.limit || 1500)))
  if (!ticker) {
    res.status(400).json({ error: 'Missing ticker' })
    return
  }

  // TEMPORARY: Query from pre-loaded in-memory table for fast development
  // TODO: In production, query directly from parquet files on disk
  const tableName = `ticker_${ticker.replace(/[^A-Z0-9]/g, '_')}`

  // Check if ticker is loaded in memory
  if (!loadedTickers.has(ticker)) {
    res.status(404).json({ error: `Ticker ${ticker} not loaded in memory` })
    return
  }

  // First, get a sample row to debug column structure
  const sampleSql = `SELECT * FROM ${tableName} WHERE "Open" IS NOT NULL LIMIT 1`
  conn.all(sampleSql, (sampleErr, sampleRows) => {
    if (sampleErr) {
      res.status(500).json({ error: `Sample query failed: ${String(sampleErr?.message || sampleErr)}` })
      return
    }

    // If no rows, data might be empty
    if (!sampleRows || sampleRows.length === 0) {
      res.status(404).json({ error: `No data in table ${tableName}. The parquet file may be empty or corrupted. Try re-downloading ticker data from the Admin tab.` })
      return
    }

    // Check if data is all nulls
    const firstRow = sampleRows[0]
    if (firstRow.Open === null && firstRow.High === null && firstRow.Low === null && firstRow.Close === null) {
      res.status(404).json({ error: `Ticker ${ticker} has no price data (all null values). Please re-download ticker data from the Admin tab.` })
      return
    }

    // Check what columns exist
    const availableColumns = Object.keys(sampleRows[0])

    const sql = `
      SELECT
        epoch_ms("Date") AS ts_ms,
        "Open"  AS open,
        "High"  AS high,
        "Low"   AS low,
        "Close" AS close,
        "Adj Close" AS adjClose
      FROM ${tableName}
      WHERE "Open" IS NOT NULL AND "High" IS NOT NULL AND "Low" IS NOT NULL AND "Close" IS NOT NULL
      ORDER BY "Date" DESC
      LIMIT ${limit};
    `

    conn.all(sql, (err, rows) => {
      if (err) {
        res.status(500).json({
          error: String(err?.message || err),
          availableColumns,
          sampleRow: sampleRows[0]
        })
        return
      }
      const ordered = (rows || []).slice().reverse()
      const candles = ordered.map((r) => ({
        time: Math.floor(Number(r.ts_ms) / 1000),
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        adjClose: Number(r.adjClose),
      }))
      const preview = ordered.slice(-50).map((r) => ({
        Date: new Date(Number(r.ts_ms)).toISOString(),
        Open: Number(r.open),
        High: Number(r.high),
        Low: Number(r.low),
        Close: Number(r.close),
      }))
      res.json({ ticker, candles, preview })
    })
  })
})

// ============================================================================
// Admin Data Storage
// ============================================================================
const ADMIN_DATA_PATH = path.join(TICKER_DATA_ROOT, 'admin-data.json')

async function readAdminData() {
  try {
    const raw = await fs.readFile(ADMIN_DATA_PATH, 'utf-8')
    const data = JSON.parse(raw)
    // Ensure eligibilityRequirements exists (migration for older data)
    if (!data.config.eligibilityRequirements) {
      data.config.eligibilityRequirements = []
    }
    // Ensure atlasFundSlots exists (for Atlas Sponsored systems)
    if (!data.config.atlasFundSlots) {
      data.config.atlasFundSlots = []
    }
    return data
  } catch (e) {
    if (e.code === 'ENOENT') {
      return {
        config: { atlasFeePercent: 0, partnerProgramSharePercent: 0, eligibilityRequirements: [], atlasFundSlots: [] },
        treasury: { balance: 100000, entries: [] },
        userSummaries: {}
      }
    }
    throw e
  }
}

async function writeAdminData(data) {
  await fs.writeFile(ADMIN_DATA_PATH, JSON.stringify(data, null, 2), 'utf-8')
}

// GET /api/admin/config - Get admin configuration
app.get('/api/admin/config', async (req, res) => {
  try {
    const data = await readAdminData()
    res.json({ config: data.config })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// PUT /api/admin/config - Update admin configuration
app.put('/api/admin/config', async (req, res) => {
  try {
    const data = await readAdminData()
    const { atlasFeePercent, partnerProgramSharePercent, atlasFundSlots } = req.body
    if (typeof atlasFeePercent === 'number') {
      data.config.atlasFeePercent = Math.max(0, Math.min(100, atlasFeePercent))
    }
    if (typeof partnerProgramSharePercent === 'number') {
      data.config.partnerProgramSharePercent = Math.max(0, Math.min(100, partnerProgramSharePercent))
    }
    // Update Atlas Fund Slots (array of bot IDs)
    if (Array.isArray(atlasFundSlots)) {
      data.config.atlasFundSlots = atlasFundSlots.filter(id => typeof id === 'string' && id.length > 0)
    }
    await writeAdminData(data)
    res.json({ config: data.config })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// ============================================
// TIINGO API KEY MANAGEMENT
// ============================================

// GET /api/admin/tiingo-key - Check if Tiingo API key is configured
app.get('/api/admin/tiingo-key', async (req, res) => {
  try {
    const data = await readAdminData()
    const hasKey = Boolean(data.tiingoApiKey)
    res.json({ hasKey })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// POST /api/admin/tiingo-key - Save Tiingo API key (encrypted)
app.post('/api/admin/tiingo-key', async (req, res) => {
  try {
    const { key } = req.body
    if (!key || typeof key !== 'string') {
      return res.status(400).json({ error: 'API key is required' })
    }

    const data = await readAdminData()
    data.tiingoApiKey = encrypt(key)
    await writeAdminData(data)

    res.json({ success: true, hasKey: true })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// DELETE /api/admin/tiingo-key - Clear saved Tiingo API key
app.delete('/api/admin/tiingo-key', async (req, res) => {
  try {
    const data = await readAdminData()
    delete data.tiingoApiKey
    await writeAdminData(data)

    res.json({ success: true, hasKey: false })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

/**
 * Get the Tiingo API key from various sources (priority order)
 * 1. Request body (if provided)
 * 2. Stored encrypted key in admin data
 * 3. Environment variable
 */
async function getTiingoApiKey(requestKey) {
  // Use request-provided key if available
  if (requestKey) return requestKey

  // Try to get stored encrypted key
  try {
    const data = await readAdminData()
    if (data.tiingoApiKey) {
      const decrypted = decrypt(data.tiingoApiKey)
      if (decrypted) return decrypted
    }
  } catch {
    // Ignore errors, fall through to env var
  }

  // Fallback to environment variable
  return process.env.TIINGO_API_KEY || ''
}

// POST /api/user/:userId/portfolio-summary - Update user's portfolio summary
app.post('/api/user/:userId/portfolio-summary', async (req, res) => {
  try {
    const userId = req.params.userId
    const { totalValue, totalInvested, investmentCount, investedAtlas, investedNexus, investedPrivate } = req.body

    const data = await readAdminData()
    data.userSummaries = data.userSummaries || {}
    data.userSummaries[userId] = {
      userId,
      totalValue: Number(totalValue) || 0,
      totalInvested: Number(totalInvested) || 0,
      investmentCount: Number(investmentCount) || 0,
      investedAtlas: Number(investedAtlas) || 0,
      investedNexus: Number(investedNexus) || 0,
      investedPrivate: Number(investedPrivate) || 0,
      lastUpdated: Date.now()
    }
    await writeAdminData(data)
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// GET /api/admin/aggregated-stats - Get aggregated stats across all users
app.get('/api/admin/aggregated-stats', async (req, res) => {
  try {
    const data = await readAdminData()
    const summaries = Object.values(data.userSummaries || {})

    const totalPortfolioValue = summaries.reduce((sum, s) => sum + (s.totalValue || 0), 0)
    const totalInvested = summaries.reduce((sum, s) => sum + (s.totalInvested || 0), 0)
    const totalInvestedAtlas = summaries.reduce((sum, s) => sum + (s.investedAtlas || 0), 0)
    const totalInvestedNexus = summaries.reduce((sum, s) => sum + (s.investedNexus || 0), 0)
    const totalInvestedPrivate = summaries.reduce((sum, s) => sum + (s.investedPrivate || 0), 0)

    // Calculate fee breakdowns based on invested amounts and fee percentages
    const atlasFeeRate = (data.config.atlasFeePercent || 0) / 100
    const partnerShareRate = (data.config.partnerProgramSharePercent || 0) / 100

    const feeBreakdown = {
      atlasFeesTotal: totalInvestedAtlas * atlasFeeRate,
      privateFeesTotal: totalInvestedPrivate * atlasFeeRate,
      nexusFeesTotal: totalInvestedNexus * atlasFeeRate,
      nexusPartnerPaymentsTotal: totalInvestedNexus * atlasFeeRate * partnerShareRate
    }

    const stats = {
      totalDollarsInAccounts: totalPortfolioValue,
      totalDollarsInvested: totalInvested,
      totalPortfolioValue,
      totalInvestedAtlas,
      totalInvestedNexus,
      totalInvestedPrivate,
      userCount: summaries.length,
      lastUpdated: Date.now()
    }

    res.json({ stats, config: data.config, feeBreakdown })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// GET /api/admin/treasury - Get treasury state
app.get('/api/admin/treasury', async (req, res) => {
  try {
    const data = await readAdminData()
    res.json({ treasury: data.treasury })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// POST /api/admin/treasury/entry - Add treasury entry
app.post('/api/admin/treasury/entry', async (req, res) => {
  try {
    const data = await readAdminData()
    const { type, amount, description } = req.body

    const entry = {
      id: `treasury-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      date: Date.now(),
      type: type || 'fee_deposit',
      amount: Number(amount) || 0,
      description: description || ''
    }

    data.treasury.entries.push(entry)
    data.treasury.balance += entry.amount

    await writeAdminData(data)
    res.json({ treasury: data.treasury })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// GET /api/admin/eligibility - Get eligibility requirements
app.get('/api/admin/eligibility', async (req, res) => {
  try {
    const data = await readAdminData()
    res.json({ eligibilityRequirements: data.config.eligibilityRequirements || [] })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// PUT /api/admin/eligibility - Save eligibility requirements
app.put('/api/admin/eligibility', async (req, res) => {
  try {
    const data = await readAdminData()
    const { eligibilityRequirements } = req.body

    if (Array.isArray(eligibilityRequirements)) {
      data.config.eligibilityRequirements = eligibilityRequirements
    }

    await writeAdminData(data)
    res.json({ eligibilityRequirements: data.config.eligibilityRequirements })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// ============================================================================
// Waitlist API (Phase 1: Landing Page)
// ============================================================================
import crypto from 'node:crypto'

// POST /api/waitlist/join - Join the waitlist
app.post('/api/waitlist/join', async (req, res) => {
  try {
    // Lazy-load database module to avoid circular imports
    const database = await import('./db/index.mjs')
    database.initializeDatabase()

    const { email, source } = req.body

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email required' })
    }

    const normalizedEmail = email.toLowerCase().trim()

    // Check if already on waitlist
    const existing = database.sqlite.prepare(
      'SELECT id, position, status FROM waitlist_entries WHERE email = ?'
    ).get(normalizedEmail)

    if (existing) {
      return res.status(409).json({
        error: 'Already on waitlist',
        position: existing.position,
        status: existing.status,
      })
    }

    // Get next position
    const maxResult = database.sqlite.prepare(
      'SELECT COALESCE(MAX(position), 0) as max_pos FROM waitlist_entries'
    ).get()
    const position = (maxResult?.max_pos || 0) + 1

    // Generate referral code
    const referralCode = crypto.randomBytes(4).toString('hex').toUpperCase()

    // Insert
    const now = Date.now()
    database.sqlite.prepare(`
      INSERT INTO waitlist_entries (email, position, referral_code, status, source, created_at)
      VALUES (?, ?, ?, 'pending', ?, ?)
    `).run(normalizedEmail, position, referralCode, source || 'direct', now)

    console.log(`[Waitlist] New signup: ${normalizedEmail} (#${position})`)

    res.json({
      success: true,
      position,
      referralCode,
    })
  } catch (e) {
    console.error('[Waitlist] Join error:', e)
    res.status(500).json({ error: 'Failed to join waitlist' })
  }
})

// GET /api/waitlist/stats - Get waitlist count (public)
app.get('/api/waitlist/stats', async (req, res) => {
  try {
    const database = await import('./db/index.mjs')
    database.initializeDatabase()

    const result = database.sqlite.prepare(
      'SELECT COUNT(*) as count FROM waitlist_entries'
    ).get()

    res.json({ count: result?.count || 0 })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// GET /api/waitlist/position/:email - Check position by email
app.get('/api/waitlist/position/:email', async (req, res) => {
  try {
    const database = await import('./db/index.mjs')
    database.initializeDatabase()

    const email = req.params.email.toLowerCase().trim()

    const entry = database.sqlite.prepare(
      'SELECT position, status, created_at FROM waitlist_entries WHERE email = ?'
    ).get(email)

    if (!entry) {
      return res.status(404).json({ error: 'Not found on waitlist' })
    }

    res.json({
      position: entry.position,
      status: entry.status,
      joinedAt: entry.created_at,
    })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// ============================================================================
// Database-Backed API (Scalable Architecture)
// ============================================================================
import * as database from './db/index.mjs'
import { runBacktest } from './backtest.mjs'
import { generateSanityReport, computeBenchmarkMetrics, computeBeta } from './sanity-report.mjs'
import * as backtestCache from './db/cache.mjs'
import authRoutes from './routes/auth.mjs'
import passwordResetRoutes from './routes/password-reset.mjs'
import adminInviteRoutes from './routes/admin-invites.mjs'

// Register auth routes
app.use('/api/auth', authRoutes)
app.use('/api/auth', passwordResetRoutes)
app.use('/api/admin/invites', adminInviteRoutes)

// Initialize database on startup
let dbInitialized = false
let cacheInitialized = false

async function ensureDbInitialized() {
  if (!dbInitialized) {
    database.initializeDatabase()
    // FRD-008: Migrate any existing plain-text passwords to bcrypt hashes
    await database.migratePasswordsToBcrypt()
    dbInitialized = true
  }
  if (!cacheInitialized) {
    backtestCache.initializeCacheDatabase()
    cacheInitialized = true
  }
}

// ============================================================================
// FRD-014: Helper to get latest ticker data date for cache invalidation
// ============================================================================
let cachedDataDate = null
let dataDateCacheTime = 0
const DATA_DATE_CACHE_TTL = 60 * 1000 // 1 minute TTL

async function getLatestTickerDataDate() {
  // Return cached value if still fresh
  if (cachedDataDate && Date.now() - dataDateCacheTime < DATA_DATE_CACHE_TTL) {
    return cachedDataDate
  }

  try {
    // Get a sample ticker to check latest date
    const parquetTickers = await listParquetTickers()
    if (parquetTickers.length === 0) {
      return new Date().toISOString().split('T')[0]
    }

    // Query the first available ticker for max date
    const sampleTicker = parquetTickers[0]
    const parquetPath = path.join(PARQUET_DIR, `${sampleTicker}.parquet`)
    const fileForDuckdb = parquetPath.replace(/\\/g, '/').replace(/'/g, "''")

    const result = await new Promise((resolve, reject) => {
      conn.all(`SELECT MAX(Date) as max_date FROM read_parquet('${fileForDuckdb}')`, (err, rows) => {
        if (err) reject(err)
        else resolve(rows)
      })
    })

    if (result && result[0]?.max_date) {
      // DuckDB returns Date as epoch or string - handle both
      const maxDate = result[0].max_date
      const dateStr = typeof maxDate === 'number'
        ? new Date(maxDate * 1000).toISOString().split('T')[0]
        : String(maxDate).split('T')[0]

      cachedDataDate = dateStr
      dataDateCacheTime = Date.now()
      return dateStr
    }
  } catch (e) {
    console.warn('[Cache] Failed to get ticker data date:', e.message)
  }

  // Fallback to today
  return new Date().toISOString().split('T')[0]
}

// ============================================================================
// Authentication Endpoints
// ============================================================================

// POST /api/auth/login - Validate credentials and return user
app.post('/api/auth/login', async (req, res) => {
  try {
    await ensureDbInitialized()
    const { username, password } = req.body
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' })
    }
    const user = await database.validateUser(username, password)
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    // FRD-014: Check and trigger daily refresh on first login of the day
    const dailyRefreshTriggered = backtestCache.checkAndTriggerDailyRefresh()

    // Return user without password
    const { passwordHash, ...safeUser } = user
    res.json({
      user: safeUser,
      dailyRefreshTriggered, // Let client know if cache was cleared
    })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// GET /api/auth/user/:userId - Get user by ID
app.get('/api/auth/user/:userId', async (req, res) => {
  try {
    await ensureDbInitialized()
    const user = await database.getUserById(req.params.userId)
    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }
    const { passwordHash, ...safeUser } = user
    res.json({ user: safeUser })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// ============================================================================
// Bot Endpoints
// ============================================================================

// GET /api/bots - List user's bots
app.get('/api/bots', async (req, res) => {
  try {
    await ensureDbInitialized()
    const userId = req.query.userId
    if (!userId) {
      return res.status(400).json({ error: 'userId query parameter required' })
    }
    const bots = await database.getBotsByOwner(userId)
    res.json({ bots })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// GET /api/bots/:id - Get a single bot
app.get('/api/bots/:id', async (req, res) => {
  try {
    await ensureDbInitialized()
    const userId = req.query.userId
    const bot = await database.getBotById(req.params.id, true) // include payload
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' })
    }
    // Only return payload if user owns the bot
    if (bot.ownerId !== userId && bot.visibility === 'nexus') {
      const { payload, ...publicBot } = bot
      return res.json({ bot: publicBot })
    }
    res.json({ bot })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// POST /api/bots - Create a new bot
app.post('/api/bots', async (req, res) => {
  try {
    await ensureDbInitialized()
    const { ownerId, name, payload, visibility, tags, fundSlot, id: clientId } = req.body
    if (!ownerId || !name || !payload) {
      return res.status(400).json({ error: 'ownerId, name, and payload are required' })
    }
    const id = await database.createBot({
      id: clientId,  // Use client-provided ID if present
      ownerId,
      name,
      payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
      visibility,
      tags,
      fundSlot,
    })
    res.json({ id })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// PUT /api/bots/:id - Update a bot
app.put('/api/bots/:id', async (req, res) => {
  try {
    await ensureDbInitialized()
    const { ownerId, name, payload, visibility, tags, fundSlot } = req.body
    if (!ownerId) {
      return res.status(400).json({ error: 'ownerId is required' })
    }
    const result = await database.updateBot(req.params.id, ownerId, {
      name,
      payload: payload ? (typeof payload === 'string' ? payload : JSON.stringify(payload)) : undefined,
      visibility,
      tags,
      fundSlot,
    })
    if (!result) {
      return res.status(404).json({ error: 'Bot not found or not owned by user' })
    }
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// DELETE /api/bots/:id - Delete a bot (soft delete)
app.delete('/api/bots/:id', async (req, res) => {
  try {
    await ensureDbInitialized()
    const ownerId = req.query.ownerId
    if (!ownerId) {
      return res.status(400).json({ error: 'ownerId query parameter required' })
    }
    const result = await database.deleteBot(req.params.id, ownerId)
    if (!result) {
      return res.status(404).json({ error: 'Bot not found or not owned by user' })
    }
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// PUT /api/bots/:id/metrics - Update bot metrics after backtest
app.put('/api/bots/:id/metrics', async (req, res) => {
  try {
    await ensureDbInitialized()
    const metrics = req.body
    await database.updateBotMetrics(req.params.id, metrics)
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// ============================================================================
// Nexus (Community) Bot Endpoints - PUBLIC, NO PAYLOAD
// ============================================================================

// GET /api/nexus/bots - List all Nexus bots (NO payload)
app.get('/api/nexus/bots', async (req, res) => {
  try {
    await ensureDbInitialized()
    const bots = await database.getNexusBots()
    res.json({ bots })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// GET /api/nexus/top/cagr - Top 10 Nexus bots by CAGR
app.get('/api/nexus/top/cagr', async (req, res) => {
  try {
    await ensureDbInitialized()
    const limit = parseInt(req.query.limit) || 10
    const bots = await database.getTopNexusBotsByCagr(limit)
    res.json({ bots })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// GET /api/nexus/top/calmar - Top 10 Nexus bots by Calmar
app.get('/api/nexus/top/calmar', async (req, res) => {
  try {
    await ensureDbInitialized()
    const limit = parseInt(req.query.limit) || 10
    const bots = await database.getTopNexusBotsByCalmar(limit)
    res.json({ bots })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// GET /api/nexus/top/sharpe - Top 10 Nexus bots by Sharpe
app.get('/api/nexus/top/sharpe', async (req, res) => {
  try {
    await ensureDbInitialized()
    const limit = parseInt(req.query.limit) || 10
    const bots = await database.getTopNexusBotsBySharpe(limit)
    res.json({ bots })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// ============================================================================
// Watchlist Endpoints
// ============================================================================

// GET /api/watchlists - Get user's watchlists
app.get('/api/watchlists', async (req, res) => {
  try {
    await ensureDbInitialized()
    const userId = req.query.userId
    if (!userId) {
      return res.status(400).json({ error: 'userId query parameter required' })
    }
    const watchlists = await database.getWatchlistsByOwner(userId)
    res.json({ watchlists })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// POST /api/watchlists/:id/bots - Add bot to watchlist
app.post('/api/watchlists/:id/bots', async (req, res) => {
  try {
    await ensureDbInitialized()
    const { botId } = req.body
    if (!botId) {
      return res.status(400).json({ error: 'botId is required' })
    }
    const success = await database.addBotToWatchlist(req.params.id, botId)
    res.json({ success })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// DELETE /api/watchlists/:id/bots/:botId - Remove bot from watchlist
app.delete('/api/watchlists/:id/bots/:botId', async (req, res) => {
  try {
    await ensureDbInitialized()
    const success = await database.removeBotFromWatchlist(req.params.id, req.params.botId)
    res.json({ success })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// POST /api/watchlists - Create a new watchlist
app.post('/api/watchlists', async (req, res) => {
  try {
    await ensureDbInitialized()
    const { userId, name } = req.body
    if (!userId || !name) {
      return res.status(400).json({ error: 'userId and name are required' })
    }
    const watchlist = await database.createWatchlist(userId, name)
    res.json({ watchlist })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// PUT /api/watchlists/:id - Update a watchlist
app.put('/api/watchlists/:id', async (req, res) => {
  try {
    await ensureDbInitialized()
    const { name } = req.body
    if (!name) {
      return res.status(400).json({ error: 'name is required' })
    }
    await database.updateWatchlist(req.params.id, { name })
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// DELETE /api/watchlists/:id - Delete a watchlist
app.delete('/api/watchlists/:id', async (req, res) => {
  try {
    await ensureDbInitialized()
    await database.deleteWatchlist(req.params.id)
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// ============================================================================
// Call Chain Endpoints
// ============================================================================

// GET /api/call-chains - Get user's call chains
app.get('/api/call-chains', async (req, res) => {
  try {
    await ensureDbInitialized()
    const userId = req.query.userId
    if (!userId) {
      return res.status(400).json({ error: 'userId query parameter required' })
    }
    const callChains = await database.getCallChainsByOwner(userId)
    res.json({ callChains })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// POST /api/call-chains - Create a new call chain
app.post('/api/call-chains', async (req, res) => {
  try {
    await ensureDbInitialized()
    const { userId, name, root } = req.body
    if (!userId || !name || !root) {
      return res.status(400).json({ error: 'userId, name, and root are required' })
    }
    const callChain = await database.createCallChain(userId, name, root)
    res.json({ callChain })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// PUT /api/call-chains/:id - Update a call chain
app.put('/api/call-chains/:id', async (req, res) => {
  try {
    await ensureDbInitialized()
    const { userId, name, root, collapsed } = req.body
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' })
    }
    const result = await database.updateCallChain(req.params.id, userId, { name, root, collapsed })
    if (!result) {
      return res.status(404).json({ error: 'Call chain not found or not owned by user' })
    }
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// DELETE /api/call-chains/:id - Delete a call chain
app.delete('/api/call-chains/:id', async (req, res) => {
  try {
    await ensureDbInitialized()
    const userId = req.query.userId
    if (!userId) {
      return res.status(400).json({ error: 'userId query parameter required' })
    }
    const success = await database.deleteCallChain(req.params.id, userId)
    if (!success) {
      return res.status(404).json({ error: 'Call chain not found or not owned by user' })
    }
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// ============================================================================
// Portfolio Endpoints
// ============================================================================

// GET /api/portfolio - Get user's portfolio
app.get('/api/portfolio', async (req, res) => {
  try {
    await ensureDbInitialized()
    const userId = req.query.userId
    if (!userId) {
      return res.status(400).json({ error: 'userId query parameter required' })
    }
    const portfolio = await database.getPortfolio(userId)
    res.json({ portfolio })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// POST /api/portfolio/buy - Buy shares of a bot
app.post('/api/portfolio/buy', async (req, res) => {
  try {
    await ensureDbInitialized()
    const { userId, botId, amount } = req.body
    if (!userId || !botId || !amount) {
      return res.status(400).json({ error: 'userId, botId, and amount are required' })
    }
    await database.buyBot(userId, botId, amount)
    res.json({ success: true })
  } catch (e) {
    res.status(400).json({ error: String(e?.message || e) })
  }
})

// POST /api/portfolio/sell - Sell shares of a bot
app.post('/api/portfolio/sell', async (req, res) => {
  try {
    await ensureDbInitialized()
    const { userId, botId, amount } = req.body
    if (!userId || !botId || !amount) {
      return res.status(400).json({ error: 'userId, botId, and amount are required' })
    }
    await database.sellBot(userId, botId, amount)
    res.json({ success: true })
  } catch (e) {
    res.status(400).json({ error: String(e?.message || e) })
  }
})

// ============================================================================
// User Preferences Endpoints
// ============================================================================

// GET /api/preferences - Get user preferences
app.get('/api/preferences', async (req, res) => {
  try {
    await ensureDbInitialized()
    const userId = req.query.userId
    if (!userId) {
      return res.status(400).json({ error: 'userId query parameter required' })
    }
    const preferences = await database.getUserPreferences(userId)
    res.json({ preferences })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// PUT /api/preferences - Update user preferences
app.put('/api/preferences', async (req, res) => {
  try {
    await ensureDbInitialized()
    const { userId, theme, colorScheme, uiState } = req.body
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' })
    }
    await database.updateUserPreferences(userId, {
      theme,
      colorScheme,
      uiState: uiState ? JSON.stringify(uiState) : undefined,
    })
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// ============================================================================
// Database Admin Stats (uses new DB instead of file-based aggregation)
// ============================================================================

// GET /api/db/admin/stats - Get aggregated stats from database
app.get('/api/db/admin/stats', async (req, res) => {
  try {
    await ensureDbInitialized()
    const stats = await database.getAggregatedStats()
    res.json({ stats })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// ============================================================================
// Data Migration Endpoint (import localStorage data to database)
// ============================================================================

// POST /api/migrate/user-data - Import user data from localStorage format
app.post('/api/migrate/user-data', async (req, res) => {
  try {
    await ensureDbInitialized()
    const { userId, savedBots, watchlists, dashboardPortfolio, uiState } = req.body

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' })
    }

    let botsImported = 0
    let watchlistsImported = 0

    // Import bots
    if (Array.isArray(savedBots)) {
      for (const bot of savedBots) {
        try {
          // Check if bot already exists
          const existing = await database.getBotById(bot.id, false)
          if (!existing) {
            await database.createBot({
              ownerId: bot.builderId || userId,
              name: bot.name || 'Untitled',
              payload: typeof bot.payload === 'string' ? bot.payload : JSON.stringify(bot.payload),
              visibility: bot.visibility || 'private',
              tags: bot.tags,
              fundSlot: bot.fundSlot,
            })
            botsImported++
          }
        } catch (err) {
          console.warn(`Failed to import bot ${bot.id}:`, err.message)
        }
      }
    }

    // Import watchlists
    if (Array.isArray(watchlists)) {
      for (const wl of watchlists) {
        // Watchlists are created by default, just add bots
        for (const botId of (wl.botIds || [])) {
          try {
            await database.addBotToWatchlist(wl.id, botId)
            watchlistsImported++
          } catch (err) {
            // Ignore - bot may not exist or already in watchlist
          }
        }
      }
    }

    // Import UI preferences
    if (uiState) {
      await database.updateUserPreferences(userId, {
        theme: uiState.themeMode,
        colorScheme: uiState.colorTheme,
        uiState: JSON.stringify(uiState),
      })
    }

    res.json({
      success: true,
      imported: {
        bots: botsImported,
        watchlistBots: watchlistsImported,
      },
    })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// ============================================================================
// Server-Side Backtest (IP Protection - payload never sent to non-owners)
// ============================================================================

// POST /api/bots/:id/run-backtest - Run backtest on server and save metrics
// FRD-014: Supports caching - checks cache first, only runs backtest on miss
app.post('/api/bots/:id/run-backtest', async (req, res) => {
  try {
    await ensureDbInitialized()
    const botId = req.params.id
    const forceRefresh = req.body.forceRefresh === true

    // Get bot with payload (only works for bots in database)
    const bot = await database.getBotById(botId, true) // includePayload = true
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' })
    }

    if (!bot.payload) {
      return res.status(400).json({ error: 'Bot has no payload' })
    }

    // FRD-014: Calculate payload hash and get current data date
    // Include mode and costBps in hash so different settings create different cache entries
    const mode = req.body.mode || 'CC'
    const costBps = req.body.costBps ?? 5
    const payloadHash = backtestCache.hashPayload(bot.payload, { mode, costBps })
    const dataDate = await getLatestTickerDataDate()

    // FRD-014: Check cache first (unless force refresh requested)
    if (!forceRefresh) {
      const cached = backtestCache.getCachedBacktest(botId, payloadHash, dataDate)
      if (cached) {
        console.log(`[Backtest] Cache hit for bot ${botId} (${bot.name}) mode=${mode} costBps=${costBps}`)

        // Still update metrics in main DB (in case they were cleared)
        await database.updateBotMetrics(botId, cached.metrics)

        return res.json({
          success: true,
          cached: true,
          cachedAt: cached.cachedAt,
          metrics: cached.metrics,
          equityCurve: cached.equityCurve,
          benchmarkCurve: cached.benchmarkCurve,
          allocations: cached.allocations,
        })
      }
    }

    console.log(`[Backtest] Running backtest for bot ${botId} (${bot.name}) mode=${mode} costBps=${costBps}${forceRefresh ? ' (force refresh)' : ''}...`)
    const startTime = Date.now()

    // Run backtest on server
    const result = await runBacktest(bot.payload, { mode, costBps })

    const elapsed = Date.now() - startTime
    console.log(`[Backtest] Completed in ${elapsed}ms - CAGR: ${(result.metrics.cagr * 100).toFixed(2)}%`)

    // Save metrics to database
    await database.updateBotMetrics(botId, result.metrics)

    // FRD-014: Store result in cache (only for completed runs - errors don't reach here)
    backtestCache.setCachedBacktest(botId, payloadHash, dataDate, {
      metrics: result.metrics,
      equityCurve: result.equityCurve,
      benchmarkCurve: result.benchmarkCurve,
      allocations: result.allocations,
    })

    // Return metrics (never the payload)
    res.json({
      success: true,
      cached: false,
      metrics: result.metrics,
      equityCurve: result.equityCurve,
      benchmarkCurve: result.benchmarkCurve,
      allocations: result.allocations,
    })
  } catch (e) {
    console.error('[Backtest] Error:', e)
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// ============================================================================
// Helper: Get daily returns for a ticker from parquet data
// ============================================================================
async function getTickerReturns(ticker) {
  const tableName = `ticker_${ticker.replace(/[^A-Z0-9]/g, '_')}`

  if (!loadedTickers.has(ticker)) {
    return null // Ticker not loaded
  }

  return new Promise((resolve, reject) => {
    const sql = `
      SELECT "Date", "Adj Close" as adjClose
      FROM ${tableName}
      WHERE "Adj Close" IS NOT NULL
      ORDER BY "Date" ASC
    `
    conn.all(sql, (err, rows) => {
      if (err) {
        reject(err)
        return
      }
      if (!rows || rows.length < 2) {
        resolve(null)
        return
      }

      // Compute daily returns from adjusted close prices
      const returns = []
      for (let i = 1; i < rows.length; i++) {
        const prev = rows[i - 1].adjClose
        const curr = rows[i].adjClose
        if (prev > 0 && curr > 0) {
          returns.push((curr - prev) / prev)
        }
      }
      resolve(returns)
    })
  })
}

// Helper: Get daily returns WITH dates for a ticker (for beta alignment)
async function getTickerReturnsWithDates(ticker) {
  const tableName = `ticker_${ticker.replace(/[^A-Z0-9]/g, '_')}`

  if (!loadedTickers.has(ticker)) {
    return null // Ticker not loaded
  }

  return new Promise((resolve, reject) => {
    const sql = `
      SELECT "Date", "Adj Close" as adjClose
      FROM ${tableName}
      WHERE "Adj Close" IS NOT NULL
      ORDER BY "Date" ASC
    `
    conn.all(sql, (err, rows) => {
      if (err) {
        reject(err)
        return
      }
      if (!rows || rows.length < 2) {
        resolve(null)
        return
      }

      // Compute daily returns with dates
      // Convert Date objects to YYYY-MM-DD strings to match equity curve format
      const returns = []
      for (let i = 1; i < rows.length; i++) {
        const prev = rows[i - 1].adjClose
        const curr = rows[i].adjClose
        if (prev > 0 && curr > 0) {
          // Convert Date object to YYYY-MM-DD string format
          const dateObj = rows[i].Date
          const dateStr = dateObj instanceof Date
            ? dateObj.toISOString().split('T')[0]
            : String(dateObj).split('T')[0]
          returns.push({ date: dateStr, return: (curr - prev) / prev })
        }
      }
      resolve(returns)
    })
  })
}

// POST /api/bots/:id/sanity-report - Generate sanity & risk report
// Runs Monte Carlo and K-Fold analysis on daily returns
// Results are cached and invalidated on payload/data changes
app.post('/api/bots/:id/sanity-report', async (req, res) => {
  try {
    await ensureDbInitialized()
    const botId = req.params.id

    // Get bot with payload and stored backtest settings
    const botRow = database.sqlite.prepare(`
      SELECT id, name, payload, backtest_mode, backtest_cost_bps
      FROM bots WHERE id = ? AND deleted_at IS NULL
    `).get(botId)

    if (!botRow) {
      return res.status(404).json({ error: 'Bot not found' })
    }

    if (!botRow.payload) {
      return res.status(400).json({ error: 'Bot has no payload' })
    }

    // Use bot's stored settings or defaults
    const botMode = botRow.backtest_mode || 'CC'
    const botCostBps = botRow.backtest_cost_bps ?? 5

    // Check cache first - include mode/costBps in hash since daily returns depend on them
    const payloadHash = backtestCache.hashPayload(botRow.payload, { mode: botMode, costBps: botCostBps })
    const dataDate = await getLatestTickerDataDate()

    const cached = backtestCache.getCachedSanityReport(botId, payloadHash, dataDate)
    if (cached) {
      console.log(`[SanityReport] Cache hit for bot ${botId}`)
      return res.json({
        success: true,
        report: cached.report,
        cached: true,
        cachedAt: cached.cachedAt,
      })
    }

    // Run backtest to get daily returns using bot's stored settings
    console.log(`[SanityReport] Running backtest for bot ${botId} (${botRow.name}) with mode=${botMode}, costBps=${botCostBps}...`)
    const startTime = Date.now()

    const backtestResult = await runBacktest(botRow.payload, {
      mode: botMode,
      costBps: botCostBps,
    })

    if (!backtestResult.dailyReturns || backtestResult.dailyReturns.length < 50) {
      return res.status(400).json({
        error: `Insufficient data: need at least 50 trading days, got ${backtestResult.dailyReturns?.length || 0}`
      })
    }

    // Get SPY returns for beta/treynor calculation
    let spyReturns = null
    if (loadedTickers.has('SPY')) {
      try {
        spyReturns = await getTickerReturns('SPY')
      } catch (e) {
        console.warn('[SanityReport] Failed to get SPY returns:', e.message)
      }
    }

    // Generate sanity report (uses default 200 iterations from sanity-report.mjs)
    const report = generateSanityReport(backtestResult.dailyReturns, {
      years: req.body.years || 5,
      blockSize: req.body.blockSize || 7,
      shards: req.body.shards || 10,
      seed: req.body.seed || 42,
    }, spyReturns)

    // Compute strategy beta vs each benchmark ticker with proper date alignment
    const benchmarkTickers = ['VTI', 'SPY', 'QQQ', 'DIA', 'DBC', 'DBO', 'GLD', 'BND', 'TLT', 'GBTC']
    const strategyBetas = {}

    // Build strategy returns map keyed by date
    // equityCurve has dates, dailyReturns is the return for each day
    // Note: equityCurve[0] is day 0, equityCurve[1] is day 1, etc.
    // dailyReturns[i] is the return from day i to day i+1
    const strategyDates = backtestResult.equityCurve.map(p => p.date)
    const strategyReturnsMap = new Map()
    for (let i = 0; i < backtestResult.dailyReturns.length; i++) {
      // The return at index i corresponds to the transition from strategyDates[i] to strategyDates[i+1]
      // We associate it with strategyDates[i+1] (the end date of the return period)
      if (i + 1 < strategyDates.length) {
        strategyReturnsMap.set(strategyDates[i + 1], backtestResult.dailyReturns[i])
      }
    }

    for (const ticker of benchmarkTickers) {
      if (loadedTickers.has(ticker)) {
        try {
          const benchWithDates = await getTickerReturnsWithDates(ticker)
          if (benchWithDates && benchWithDates.length > 0) {
            // Build benchmark returns map keyed by date
            const benchMap = new Map(benchWithDates.map(r => [r.date, r.return]))

            // Find intersection of dates and build aligned arrays
            const alignedStrategy = []
            const alignedBench = []
            for (const [date, stratReturn] of strategyReturnsMap) {
              if (benchMap.has(date)) {
                alignedStrategy.push(stratReturn)
                alignedBench.push(benchMap.get(date))
              }
            }

            // Compute beta with properly aligned data
            if (alignedStrategy.length >= 50) {
              strategyBetas[ticker] = computeBeta(alignedStrategy, alignedBench)
            }
          }
        } catch (e) {
          // Skip this ticker if we can't get returns
        }
      }
    }
    report.strategyBetas = strategyBetas

    // Store in cache
    backtestCache.setCachedSanityReport(botId, payloadHash, dataDate, report)

    const elapsed = Date.now() - startTime
    console.log(`[SanityReport] Completed for bot ${botId} in ${elapsed}ms (200 MC + 200 K-Fold iterations)`)

    res.json({
      success: true,
      report,
      cached: false,
    })
  } catch (e) {
    console.error('[SanityReport] Error:', e)
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// ============================================================================
// Benchmark Metrics Endpoint
// ============================================================================

// GET /api/benchmarks/metrics - Get metrics for benchmark tickers
// Returns cached results when available, computes and caches on miss
app.get('/api/benchmarks/metrics', async (req, res) => {
  try {
    await ensureDbInitialized()

    // Default benchmark tickers
    const defaultTickers = ['VTI', 'SPY', 'QQQ', 'DIA', 'DBC', 'DBO', 'GLD', 'BND', 'TLT', 'GBTC']
    const requestedTickers = req.query.tickers
      ? String(req.query.tickers).split(',').map(t => t.trim().toUpperCase()).filter(Boolean)
      : defaultTickers

    const dataDate = await getLatestTickerDataDate()

    // First, get SPY returns WITH DATES (needed for beta/treynor calculation with proper alignment)
    let spyReturnsWithDates = null
    let spyReturnsMap = null
    if (loadedTickers.has('SPY')) {
      spyReturnsWithDates = await getTickerReturnsWithDates('SPY')
      if (spyReturnsWithDates) {
        spyReturnsMap = new Map(spyReturnsWithDates.map(r => [r.date, r.return]))
      }
    }

    const results = {}
    const errors = []

    for (const ticker of requestedTickers) {
      try {
        // Check cache first
        const cached = backtestCache.getCachedBenchmarkMetrics(ticker, dataDate)
        if (cached) {
          results[ticker] = cached.metrics
          continue
        }

        // Cache miss - compute metrics with date-aligned returns
        const tickerWithDates = await getTickerReturnsWithDates(ticker)
        if (!tickerWithDates || tickerWithDates.length < 50) {
          errors.push(`${ticker}: insufficient data (${tickerWithDates?.length || 0} days)`)
          continue
        }

        // Build aligned arrays for beta computation
        let alignedTickerReturns = tickerWithDates.map(r => r.return)
        let alignedSpyReturns = null

        if (ticker !== 'SPY' && spyReturnsMap) {
          // Align this ticker's returns with SPY by date
          const alignedTicker = []
          const alignedSpy = []
          for (const r of tickerWithDates) {
            if (spyReturnsMap.has(r.date)) {
              alignedTicker.push(r.return)
              alignedSpy.push(spyReturnsMap.get(r.date))
            }
          }
          if (alignedTicker.length >= 50) {
            alignedTickerReturns = alignedTicker
            alignedSpyReturns = alignedSpy
          }
        }

        // Compute metrics with aligned SPY returns
        const metrics = computeBenchmarkMetrics(alignedTickerReturns, alignedSpyReturns)

        if (metrics) {
          // Cache the result
          backtestCache.setCachedBenchmarkMetrics(ticker, dataDate, metrics)
          results[ticker] = metrics
        } else {
          errors.push(`${ticker}: failed to compute metrics`)
        }
      } catch (err) {
        errors.push(`${ticker}: ${err.message}`)
      }
    }

    res.json({
      success: true,
      dataDate,
      benchmarks: results,
      errors: errors.length > 0 ? errors : undefined
    })
  } catch (e) {
    console.error('[Benchmarks] Error:', e)
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// POST /api/indicator-series - Get indicator time series for chart overlay
// Takes conditions and returns indicator values for each date
app.post('/api/indicator-series', async (req, res) => {
  try {
    const { conditions, mode = 'OC' } = req.body

    if (!conditions || !Array.isArray(conditions) || conditions.length === 0) {
      return res.json({ indicatorOverlays: [] })
    }

    // Collect all tickers from conditions
    const tickers = new Set()
    conditions.forEach(cond => {
      if (cond.ticker) tickers.add(cond.ticker)
      if (cond.rightTicker) tickers.add(cond.rightTicker)
    })

    // Always include SPY as reference
    tickers.add('SPY')

    // Create a minimal payload with just a position node for SPY
    // This is needed to run the backtest infrastructure
    const dummyPayload = {
      id: 'dummy-root',
      kind: 'position',
      title: 'Dummy',
      positions: ['SPY'],
      weighting: 'equal',
      children: {}
    }

    // Run backtest with indicator overlays
    const result = await runBacktest(dummyPayload, {
      mode,
      costBps: 0,
      indicatorOverlays: conditions
    })

    res.json({
      indicatorOverlays: result.indicatorOverlays || []
    })
  } catch (e) {
    console.error('[Indicator Series] Error:', e)
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// GET /api/bots/:id/metrics - Get cached metrics for a bot
app.get('/api/bots/:id/metrics', async (req, res) => {
  try {
    await ensureDbInitialized()
    const botId = req.params.id

    const bot = await database.getBotById(botId, false)
    if (!bot) {
      return res.status(404).json({ error: 'Bot not found' })
    }

    res.json({
      botId,
      metrics: bot.metrics || null,
    })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// ============================================================================
// FRD-014: Backtest Cache Admin Endpoints
// ============================================================================

// GET /api/admin/cache/stats - Get cache statistics
app.get('/api/admin/cache/stats', async (req, res) => {
  try {
    await ensureDbInitialized()
    const stats = backtestCache.getCacheStats()
    const dataDate = await getLatestTickerDataDate()
    res.json({
      ...stats,
      currentDataDate: dataDate,
    })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// POST /api/admin/cache/invalidate - Invalidate cache (all or specific bot)
app.post('/api/admin/cache/invalidate', async (req, res) => {
  try {
    await ensureDbInitialized()
    const { botId } = req.body

    if (botId) {
      // Invalidate specific bot
      const invalidated = backtestCache.invalidateBotCache(botId)
      res.json({ success: true, botId, invalidated })
    } else {
      // Invalidate all
      const count = backtestCache.invalidateAllCache()
      res.json({ success: true, invalidatedCount: count })
    }
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// POST /api/admin/cache/refresh - Force daily refresh (clears all cache)
app.post('/api/admin/cache/refresh', async (req, res) => {
  try {
    await ensureDbInitialized()
    const count = backtestCache.invalidateAllCache()
    backtestCache.setLastRefreshDate()
    res.json({
      success: true,
      invalidatedCount: count,
      newRefreshDate: backtestCache.getLastRefreshDate(),
    })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// POST /api/admin/cache/prewarm - Run backtests and sanity reports for all systems to pre-warm cache
app.post('/api/admin/cache/prewarm', async (req, res) => {
  try {
    await ensureDbInitialized()

    // Option to include sanity reports (expensive, so opt-in)
    const includeSanity = req.body.includeSanity === true

    // Get all bots from database (including backtest settings)
    const allBots = database.sqlite.prepare(`
      SELECT id, name, payload, backtest_mode, backtest_cost_bps
      FROM bots WHERE deleted_at IS NULL AND payload IS NOT NULL
    `).all()

    if (allBots.length === 0) {
      return res.json({ success: true, processed: 0, cached: 0, sanity: 0, errors: 0, message: 'No systems found' })
    }

    console.log(`[Cache Prewarm] Starting pre-warm for ${allBots.length} systems (sanity: ${includeSanity})...`)

    const dataDate = await getLatestTickerDataDate()
    let processed = 0
    let cached = 0
    let sanityCached = 0
    let errors = 0
    const errorList = []

    for (const bot of allBots) {
      processed++
      try {
        // Use bot's stored backtest settings (defaults to CC/5 if not set)
        const botMode = bot.backtest_mode || 'CC'
        const botCostBps = bot.backtest_cost_bps ?? 5
        const payloadHash = backtestCache.hashPayload(bot.payload, { mode: botMode, costBps: botCostBps })

        // Check if backtest already cached
        const existingBacktest = backtestCache.getCachedBacktest(bot.id, payloadHash, dataDate)
        let result

        if (existingBacktest) {
          cached++
          console.log(`[Cache Prewarm] ${processed}/${allBots.length} - ${bot.name}: Backtest already cached (mode=${botMode}, cost=${botCostBps}bps)`)
        } else {
          // Run backtest with bot's stored settings
          console.log(`[Cache Prewarm] ${processed}/${allBots.length} - ${bot.name}: Running backtest (mode=${botMode}, cost=${botCostBps}bps)...`)
          result = await runBacktest(bot.payload, { mode: botMode, costBps: botCostBps })

          // Store in cache
          backtestCache.setCachedBacktest(bot.id, payloadHash, dataDate, {
            metrics: result.metrics,
            equityCurve: result.equityCurve,
            benchmarkCurve: result.benchmarkCurve,
            allocations: result.allocations,
          })

          // Also update metrics in main DB
          await database.updateBotMetrics(bot.id, result.metrics)

          cached++
          console.log(`[Cache Prewarm] ${processed}/${allBots.length} - ${bot.name}: Backtest cached (CAGR: ${(result.metrics.cagr * 100).toFixed(2)}%)`)
        }

        // Sanity report (if requested) - uses same payload hash WITH mode/costBps since daily returns depend on them
        if (includeSanity) {
          // Sanity reports DO depend on mode/costBps because the backtest daily returns change with different settings
          const existingSanity = backtestCache.getCachedSanityReport(bot.id, payloadHash, dataDate)
          if (existingSanity) {
            sanityCached++
            console.log(`[Cache Prewarm] ${processed}/${allBots.length} - ${bot.name}: Sanity report already cached`)
          } else {
            // Need backtest result for daily returns
            if (!result) {
              result = await runBacktest(bot.payload, { mode: botMode, costBps: botCostBps })
            }

            if (result.dailyReturns && result.dailyReturns.length >= 50) {
              console.log(`[Cache Prewarm] ${processed}/${allBots.length} - ${bot.name}: Running sanity report (200 MC + 200 K-Fold)...`)

              // Get SPY returns for beta/treynor calculation
              let spyReturns = null
              if (loadedTickers.has('SPY')) {
                try {
                  spyReturns = await getTickerReturns('SPY')
                } catch (e) {
                  // Continue without SPY
                }
              }

              const report = generateSanityReport(result.dailyReturns, {}, spyReturns)

              // Compute strategy beta vs each benchmark ticker
              const benchmarkTickers = ['VTI', 'SPY', 'QQQ', 'DIA', 'DBC', 'DBO', 'GLD', 'BND', 'TLT', 'GBTC']
              const strategyBetas = {}
              for (const ticker of benchmarkTickers) {
                if (loadedTickers.has(ticker)) {
                  try {
                    const benchReturns = await getTickerReturns(ticker)
                    if (benchReturns && benchReturns.length > 0) {
                      strategyBetas[ticker] = computeBeta(result.dailyReturns, benchReturns)
                    }
                  } catch (e) {
                    // Skip this ticker
                  }
                }
              }
              report.strategyBetas = strategyBetas

              backtestCache.setCachedSanityReport(bot.id, payloadHash, dataDate, report)
              sanityCached++
              console.log(`[Cache Prewarm] ${processed}/${allBots.length} - ${bot.name}: Sanity report cached`)
            } else {
              console.log(`[Cache Prewarm] ${processed}/${allBots.length} - ${bot.name}: Skipping sanity (insufficient data)`)
            }
          }
        }
      } catch (err) {
        errors++
        const errorMsg = `${bot.name}: ${err.message || err}`
        errorList.push(errorMsg)
        console.error(`[Cache Prewarm] ${processed}/${allBots.length} - ${bot.name}: ERROR - ${err.message || err}`)
      }
    }

    console.log(`[Cache Prewarm] Complete: ${cached} backtests, ${sanityCached} sanity reports, ${errors} errors out of ${processed} systems`)

    res.json({
      success: true,
      processed,
      cached,
      sanityCached,
      errors,
      errorList: errorList.slice(0, 10), // Only return first 10 errors
    })
  } catch (e) {
    console.error('[Cache Prewarm] Fatal error:', e)
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// ============================================
// SCHEDULER ENDPOINTS
// ============================================

// GET /api/admin/sync-schedule - Get schedule configuration
app.get('/api/admin/sync-schedule', async (req, res) => {
  try {
    await ensureDbInitialized()
    const config = await scheduler.getScheduleConfig(database)
    const lastSync = await scheduler.getLastSyncInfo(database)
    const status = scheduler.getSchedulerStatus()

    res.json({
      config,
      lastSync,
      status: {
        isRunning: status.isRunning,
        schedulerActive: status.schedulerActive,
        currentJob: status.currentJob,
      },
    })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// PUT /api/admin/sync-schedule - Update schedule configuration
app.put('/api/admin/sync-schedule', async (req, res) => {
  try {
    await ensureDbInitialized()
    const { enabled, updateTime, batchSize, sleepSeconds } = req.body

    const currentConfig = await scheduler.getScheduleConfig(database)
    const newConfig = {
      ...currentConfig,
      ...(enabled !== undefined && { enabled }),
      ...(updateTime !== undefined && { updateTime }),
      ...(batchSize !== undefined && { batchSize: Math.max(10, Math.min(500, Number(batchSize))) }),
      ...(sleepSeconds !== undefined && { sleepSeconds: Math.max(0.5, Math.min(30, Number(sleepSeconds))) }),
    }

    const success = await scheduler.saveScheduleConfig(database, newConfig)
    if (success) {
      res.json({ success: true, config: newConfig })
    } else {
      res.status(500).json({ error: 'Failed to save schedule config' })
    }
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// POST /api/admin/sync-schedule/run-now - Trigger immediate sync
app.post('/api/admin/sync-schedule/run-now', async (req, res) => {
  try {
    await ensureDbInitialized()

    const result = await scheduler.triggerManualSync({
      database,
      tickerRegistry,
      tickerDataRoot: TICKER_DATA_ROOT,
      parquetDir: PARQUET_DIR,
      pythonCmd: PYTHON,
    })

    res.json(result)
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// ============================================
// DATABASE VIEWER ENDPOINTS
// ============================================

// GET /api/admin/db/:table - Get all rows from a table
app.get('/api/admin/db/:table', async (req, res) => {
  try {
    await ensureDbInitialized()

    const { table } = req.params

    // Define allowed tables and their queries
    const tableQueries = {
      'users': {
        query: `SELECT id, username, display_name, role, is_partner_eligible, created_at, updated_at, last_login_at FROM users ORDER BY created_at DESC`,
        columns: ['id', 'username', 'display_name', 'role', 'is_partner_eligible', 'created_at', 'updated_at', 'last_login_at']
      },
      'bots': {
        query: `SELECT b.id, b.owner_id, b.name, b.visibility, b.tags, b.fund_slot,
                ROUND(m.cagr * 100, 2) as cagr_pct,
                ROUND(m.sharpe_ratio, 2) as sharpe,
                ROUND(m.max_drawdown * 100, 2) as maxdd_pct,
                ROUND(m.sortino_ratio, 2) as sortino,
                b.created_at, b.deleted_at
                FROM bots b
                LEFT JOIN bot_metrics m ON b.id = m.bot_id
                ORDER BY m.cagr DESC NULLS LAST
                LIMIT 500`,
        columns: ['id', 'owner_id', 'name', 'visibility', 'tags', 'fund_slot', 'cagr_pct', 'sharpe', 'maxdd_pct', 'sortino', 'created_at', 'deleted_at']
      },
      'bot_metrics': {
        query: `SELECT * FROM bot_metrics ORDER BY cagr DESC LIMIT 500`,
        columns: ['bot_id', 'cagr', 'max_drawdown', 'calmar_ratio', 'sharpe_ratio', 'sortino_ratio', 'treynor_ratio', 'volatility', 'win_rate', 'avg_turnover', 'avg_holdings', 'trading_days', 'backtest_start_date', 'backtest_end_date', 'last_backtest_at']
      },
      'portfolios': {
        query: `SELECT p.*,
                (SELECT COUNT(*) FROM portfolio_positions pp WHERE pp.portfolio_id = p.id AND pp.exit_date IS NULL) as active_positions
                FROM portfolios p ORDER BY p.created_at DESC`,
        columns: ['id', 'owner_id', 'cash_balance', 'created_at', 'updated_at', 'active_positions']
      },
      'portfolio_positions': {
        query: `SELECT pp.*, b.name as bot_name FROM portfolio_positions pp LEFT JOIN bots b ON pp.bot_id = b.id ORDER BY pp.entry_date DESC LIMIT 500`,
        columns: ['id', 'portfolio_id', 'bot_id', 'bot_name', 'cost_basis', 'shares', 'entry_date', 'exit_date', 'exit_value']
      },
      'watchlists': {
        query: `SELECT w.*, (SELECT COUNT(*) FROM watchlist_bots wb WHERE wb.watchlist_id = w.id) as bot_count FROM watchlists w ORDER BY w.created_at DESC`,
        columns: ['id', 'owner_id', 'name', 'is_default', 'created_at', 'updated_at', 'bot_count']
      },
      'cache': {
        query: `SELECT bot_id, payload_hash, data_date, computed_at, created_at, updated_at, LENGTH(results) as results_size FROM backtest_cache ORDER BY computed_at DESC LIMIT 500`,
        columns: ['bot_id', 'payload_hash', 'data_date', 'computed_at', 'created_at', 'updated_at', 'results_size'],
        db: 'cache'
      },
      'admin_config': {
        query: `SELECT * FROM admin_config ORDER BY key`,
        columns: ['key', 'value', 'updated_at', 'updated_by']
      },
      'eligibility_requirements': {
        query: `SELECT * FROM eligibility_requirements ORDER BY created_at DESC`,
        columns: ['id', 'metric', 'comparison', 'value', 'is_active', 'created_at']
      },
      'user_preferences': {
        query: `SELECT user_id, theme, color_scheme, updated_at FROM user_preferences ORDER BY updated_at DESC`,
        columns: ['user_id', 'theme', 'color_scheme', 'updated_at']
      }
    }

    const tableConfig = tableQueries[table]
    if (!tableConfig) {
      return res.status(400).json({ error: `Unknown table: ${table}. Available: ${Object.keys(tableQueries).join(', ')}` })
    }

    let rows
    if (tableConfig.db === 'cache') {
      // Query from cache database
      rows = backtestCache.cacheDb.prepare(tableConfig.query).all()
    } else {
      // Query from main database
      rows = database.sqlite.prepare(tableConfig.query).all()
    }

    // Format timestamps
    const formatRow = (row) => {
      const formatted = { ...row }
      for (const key of Object.keys(formatted)) {
        if (key.endsWith('_at') && formatted[key]) {
          // Convert timestamp to readable format
          const ts = formatted[key]
          if (typeof ts === 'number') {
            formatted[key] = new Date(ts).toISOString().replace('T', ' ').substring(0, 19)
          }
        }
      }
      return formatted
    }

    res.json({
      table,
      columns: tableConfig.columns,
      rows: rows.map(formatRow),
      count: rows.length
    })
  } catch (e) {
    console.error(`[DB Viewer] Error fetching ${req.params.table}:`, e)
    res.status(500).json({ error: String(e?.message || e) })
  }
})

// SPA fallback - serve index.html for any non-API routes in production
if (isProduction) {
  const indexPath = path.resolve(__dirname, '..', 'dist', 'index.html')
  app.get('*', (req, res) => {
    res.sendFile(indexPath)
  })
}

const PORT = Number(process.env.PORT || 8787)
app.listen(PORT, async () => {
  console.log(`[api] listening on http://localhost:${PORT}`)
  console.log(`[api] tickers: ${TICKERS_PATH}`)
  console.log(`[api] parquet:  ${PARQUET_DIR}`)

  // Seed admin user if ADMIN_EMAIL and ADMIN_PASSWORD are set
  await seedAdminUser()

  // TEMPORARY: Pre-load all parquet data for fast development
  await preloadParquetData()

  // Start the ticker sync scheduler (default: 6pm EST daily)
  await ensureDbInitialized()
  scheduler.startScheduler({
    database,
    tickerRegistry,
    tickerDataRoot: TICKER_DATA_ROOT,
    parquetDir: PARQUET_DIR,
    pythonCmd: PYTHON,
  })
})
