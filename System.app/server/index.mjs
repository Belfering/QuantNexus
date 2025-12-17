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
  })
})

function newJobId() {
  return `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

app.post('/api/download', async (req, res) => {
  const jobId = newJobId()
  const startedAt = Date.now()

  const batchSize = Math.max(1, Math.min(500, Number(req.body?.batchSize ?? 100)))
  const sleepSeconds = Math.max(0, Math.min(60, Number(req.body?.sleepSeconds ?? 2)))
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

app.get('/api/candles/:ticker', async (req, res) => {
  const ticker = normalizeTicker(req.params.ticker)
  const limit = Math.max(50, Math.min(20000, Number(req.query.limit || 1500)))
  if (!ticker) {
    res.status(400).json({ error: 'Missing ticker' })
    return
  }

  const parquetPath = path.join(PARQUET_DIR, `${ticker}.parquet`)
  try {
    await fs.access(parquetPath)
  } catch {
    res.status(404).json({ error: `Missing Parquet file: ${parquetPath}` })
    return
  }

  const fileForDuckdb = parquetPath.replace(/\\/g, '/').replace(/'/g, "''")
  const sql = `
    SELECT
      epoch_ms("Date") AS ts_ms,
      "Open"  AS open,
      "High"  AS high,
      "Low"   AS low,
      "Close" AS close
    FROM read_parquet('${fileForDuckdb}')
    WHERE "Open" IS NOT NULL AND "High" IS NOT NULL AND "Low" IS NOT NULL AND "Close" IS NOT NULL
    ORDER BY "Date" DESC
    LIMIT ${limit};
  `

  conn.all(sql, (err, rows) => {
    if (err) {
      res.status(500).json({ error: String(err?.message || err) })
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

const PORT = Number(process.env.PORT || 8787)
app.listen(PORT, () => {
  console.log(`[api] listening on http://localhost:${PORT}`)
  console.log(`[api] tickers: ${TICKERS_PATH}`)
  console.log(`[api] parquet:  ${PARQUET_DIR}`)
})
