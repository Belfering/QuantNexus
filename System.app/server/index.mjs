import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import express from 'express'
import cors from 'cors'
import duckdb from 'duckdb'

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DEFAULT_ROOT = path.resolve(__dirname, '..', 'ticker-data')
const TICKER_DATA_ROOT = process.env.SYSTEM_TICKER_DATA_ROOT || process.env.TICKER_DATA_MINI_ROOT || DEFAULT_ROOT
const TICKERS_PATH = process.env.TICKERS_PATH || path.join(TICKER_DATA_ROOT, 'tickers.txt')
const PARQUET_DIR = process.env.PARQUET_DIR || path.join(TICKER_DATA_ROOT, 'data', 'ticker_data_parquet')
const PYTHON = process.env.PYTHON || 'python'

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
        const tableName = `ticker_${ticker.replace(/[^A-Z0-9]/g, '_')}`
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

  const batchSize = Math.max(1, Math.min(500, Number(req.body?.batchSize ?? 100)))
  const sleepSeconds = Math.max(0, Math.min(60, Number(req.body?.sleepSeconds ?? 3)))
  const maxRetries = Math.max(0, Math.min(10, Number(req.body?.maxRetries ?? 3)))
  const threads = Boolean(req.body?.threads ?? true)
  const limit = Math.max(0, Math.min(100000, Number(req.body?.limit ?? 0)))

  const scriptPath = path.join(TICKER_DATA_ROOT, 'download.py')
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

  const job = {
    id: jobId,
    status: 'running',
    startedAt,
    finishedAt: null,
    error: null,
    config: { batchSize, sleepSeconds, maxRetries, threads, limit },
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
        "Close" AS close
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
    return data
  } catch (e) {
    if (e.code === 'ENOENT') {
      return {
        config: { atlasFeePercent: 0, partnerProgramSharePercent: 0, eligibilityRequirements: [] },
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
    const { atlasFeePercent, partnerProgramSharePercent } = req.body
    if (typeof atlasFeePercent === 'number') {
      data.config.atlasFeePercent = Math.max(0, Math.min(100, atlasFeePercent))
    }
    if (typeof partnerProgramSharePercent === 'number') {
      data.config.partnerProgramSharePercent = Math.max(0, Math.min(100, partnerProgramSharePercent))
    }
    await writeAdminData(data)
    res.json({ config: data.config })
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) })
  }
})

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

const PORT = Number(process.env.PORT || 8787)
app.listen(PORT, async () => {
  console.log(`[api] listening on http://localhost:${PORT}`)
  console.log(`[api] tickers: ${TICKERS_PATH}`)
  console.log(`[api] parquet:  ${PARQUET_DIR}`)

  // TEMPORARY: Pre-load all parquet data for fast development
  await preloadParquetData()
})
