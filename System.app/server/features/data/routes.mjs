// server/features/data/routes.mjs
// Ticker data management routes

import express from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

import { TICKER_DATA_ROOT, TICKERS_PATH, PARQUET_DIR, PYTHON } from '../../lib/config.mjs'
import { createLogger } from '../../lib/logger.mjs'
import { newJobId, getJob, createJob, addJobLog, completeJob } from '../../lib/jobs.mjs'
import { asyncHandler } from '../../middleware/errorHandler.mjs'
import { validate } from '../../middleware/validation.mjs'
import {
  normalizeTicker,
  readTickersFile,
  writeTickersFile,
  listParquetTickers,
  parquetFileExists,
  queryCandles,
  queryCandlesPooled,
  getCachedTickerData,
  cacheTickerData,
} from './service.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const router = express.Router()
const logger = createLogger('data')

// ============================================================================
// Status and Info
// ============================================================================

/**
 * GET /api/status - System status and paths
 */
router.get('/status', asyncHandler(async (_req, res) => {
  const exists = async (p) => {
    try {
      await fs.access(p)
      return true
    } catch {
      return false
    }
  }

  const parquetFiles = await listParquetTickers()

  res.json({
    root: TICKER_DATA_ROOT,
    tickersPath: TICKERS_PATH,
    parquetDir: PARQUET_DIR,
    tickersExists: await exists(TICKERS_PATH),
    parquetDirExists: await exists(PARQUET_DIR),
    parquetFileCount: parquetFiles.length,
  })
}))

/**
 * GET /api/changelog - Serve changelog file
 */
router.get('/changelog', asyncHandler(async (_req, res) => {
  const changelogPath = path.resolve(__dirname, '..', '..', '..', 'CHANGELOG.md')
  const content = await fs.readFile(changelogPath, 'utf-8')
  res.type('text/plain').send(content)
}))

// ============================================================================
// Tickers Management
// ============================================================================

/**
 * GET /api/tickers - Get list of tickers
 */
router.get('/tickers', asyncHandler(async (_req, res) => {
  let tickers = []
  try {
    tickers = await readTickersFile()
  } catch (e) {
    if (String(e?.code || '') !== 'ENOENT') throw e
  }
  if (tickers.length === 0) tickers = await listParquetTickers()
  res.json({ tickers })
}))

/**
 * GET /api/tickers/raw - Get raw tickers file content
 */
router.get('/tickers/raw', asyncHandler(async (_req, res) => {
  const text = await fs.readFile(TICKERS_PATH, 'utf-8')
  res.json({ text })
}))

/**
 * PUT /api/tickers - Update tickers list
 */
router.put('/tickers', asyncHandler(async (req, res) => {
  const text = req.body?.text
  const tickers = req.body?.tickers
  const next = await writeTickersFile(text ?? tickers ?? '')
  res.json({ tickers: next })
}))

/**
 * GET /api/parquet-tickers - List available parquet files
 */
router.get('/parquet-tickers', asyncHandler(async (_req, res) => {
  res.json({ tickers: await listParquetTickers() })
}))

// ============================================================================
// Candle Data
// ============================================================================

const candlesQuerySchema = {
  query: z.object({
    limit: z.coerce.number().int().min(50).max(20000).default(1500),
  }).partial(),
  params: z.object({
    ticker: z.string().min(1).max(20),
  }),
}

/**
 * GET /api/candles/:ticker - Get OHLC candle data for a ticker
 */
router.get('/candles/:ticker', validate(candlesQuerySchema), asyncHandler(async (req, res) => {
  const ticker = normalizeTicker(req.params.ticker)
  const limit = req.query.limit || 1500

  if (!ticker) {
    return res.status(400).json({ error: 'Missing ticker' })
  }

  // Check if parquet file exists
  if (!await parquetFileExists(ticker)) {
    return res.status(404).json({ error: `Ticker ${ticker} not found. No parquet file exists.` })
  }

  const candles = await queryCandles(ticker, limit)

  if (!candles) {
    return res.status(404).json({ error: `No data for ticker ${ticker}. The parquet file may be empty.` })
  }

  // Create preview of last 50 candles
  const preview = candles.slice(-50).map((c) => ({
    Date: new Date(c.time * 1000).toISOString(),
    Open: c.open,
    High: c.high,
    Low: c.low,
    Close: c.close,
  }))

  res.json({ ticker, candles, preview })
}))

const batchCandlesSchema = {
  body: z.object({
    tickers: z.array(z.string().min(1).max(20)).min(1).max(500),
    limit: z.number().int().min(50).max(20000).default(1500),
  }),
}

/**
 * POST /api/candles/batch - Fetch multiple tickers efficiently
 */
router.post('/candles/batch', validate(batchCandlesSchema), asyncHandler(async (req, res) => {
  const { tickers, limit = 1500 } = req.body
  const results = {}
  const errors = []

  // Normalize and validate tickers
  const validTickers = []
  for (const rawTicker of tickers) {
    const ticker = normalizeTicker(rawTicker)
    if (!ticker) {
      errors.push(`Invalid ticker: ${rawTicker}`)
      continue
    }
    if (await parquetFileExists(ticker)) {
      validTickers.push(ticker)
    } else {
      errors.push(`${ticker}: not found`)
    }
  }

  if (validTickers.length === 0) {
    return res.json({ success: true, results: {}, errors })
  }

  const startTime = Date.now()

  // Check server cache first
  const tickersToFetch = []
  for (const ticker of validTickers) {
    const cached = getCachedTickerData(ticker, limit)
    if (cached) {
      results[ticker] = cached
    } else {
      tickersToFetch.push(ticker)
    }
  }

  const cachedCount = validTickers.length - tickersToFetch.length

  // Fetch uncached tickers in parallel
  if (tickersToFetch.length > 0) {
    const promises = tickersToFetch.map(async (ticker, i) => {
      try {
        const data = await queryCandlesPooled(ticker, limit, i)
        if (data) {
          results[ticker] = data
          cacheTickerData(ticker, data, limit)
        } else {
          errors.push(`${ticker}: no data`)
        }
      } catch (err) {
        errors.push(`${ticker}: ${err.message}`)
      }
    })

    await Promise.all(promises)
  }

  const elapsed = Date.now() - startTime

  logger.info('Batch candles request', {
    requested: tickers.length,
    valid: validTickers.length,
    cached: cachedCount,
    fetched: tickersToFetch.length,
    errors: errors.length,
    elapsed,
  })

  res.json({
    success: true,
    results,
    errors,
    meta: {
      requested: tickers.length,
      returned: Object.keys(results).length,
      cached: cachedCount,
      fetched: tickersToFetch.length,
      elapsed,
    }
  })
}))

// ============================================================================
// Download Jobs
// ============================================================================

/**
 * POST /api/download - Start a download job
 * Supports three modes: full (all history), recent (last N days), prices (IEX real-time)
 */
router.post('/download', asyncHandler(async (req, res) => {
  const jobId = newJobId()

  const mode = String(req.body?.mode || 'full') // full, recent, or prices
  const source = String(req.body?.source || 'tiingo')
  const batchSize = Math.max(1, Math.min(500, Number(req.body?.batchSize ?? (source === 'tiingo' ? 50 : 100))))
  const sleepSeconds = Math.max(0, Math.min(60, Number(req.body?.sleepSeconds ?? (source === 'tiingo' ? 0.2 : 3))))
  const maxRetries = Math.max(0, Math.min(10, Number(req.body?.maxRetries ?? 3)))
  const threads = Boolean(req.body?.threads ?? true)
  const maxWorkers = Math.max(1, Math.min(50, Number(req.body?.maxWorkers ?? 20)))
  const recentDays = Math.max(1, Math.min(30, Number(req.body?.recentDays ?? 5)))
  const limit = Math.max(0, Math.min(100000, Number(req.body?.limit ?? 0)))

  const scriptName = source === 'tiingo' ? 'tiingo_download.py' : 'download.py'
  const scriptPath = path.join(TICKER_DATA_ROOT, scriptName)

  // Base args for all modes
  const args = [
    '-u',
    scriptPath,
    '--mode',
    mode,
  ]

  // Add ticker list (prefer tickers array if provided, otherwise use file)
  if (req.body?.tickers && Array.isArray(req.body.tickers)) {
    // Write tickers to temporary JSON file for Python script
    const tickersJsonPath = path.join(TICKER_DATA_ROOT, `temp_tickers_${jobId}.json`)
    await fs.writeFile(tickersJsonPath, JSON.stringify(req.body.tickers))
    args.push('--tickers-json', tickersJsonPath)
  } else {
    args.push('--tickers-file', TICKERS_PATH)
  }

  // Output directory
  args.push('--out-dir', PARQUET_DIR)

  // Mode-specific args
  if (mode === 'recent') {
    args.push('--recent-days', String(recentDays))
    args.push('--max-workers', String(maxWorkers))
  } else if (mode === 'prices') {
    args.push('--max-workers', String(maxWorkers))
  } else {
    // full mode
    args.push('--batch-size', String(batchSize))
    args.push('--sleep-seconds', String(sleepSeconds))
    args.push('--threads', threads ? '1' : '0')
    if (source === 'tiingo') {
      args.push('--tiingo-only')
    }
  }

  // Common args
  args.push('--max-retries', String(maxRetries))
  args.push('--limit', String(limit))

  // Add Tiingo API key if available
  const tiingoApiKey = req.body?.tiingoApiKey || process.env.TIINGO_API_KEY
  if (tiingoApiKey) {
    args.push('--api-key', String(tiingoApiKey))
  }

  const job = createJob(jobId, {
    type: 'download',
    config: { mode, source, batchSize, sleepSeconds, maxRetries, threads, maxWorkers, recentDays, limit },
  })

  const child = spawn(PYTHON, args, { windowsHide: true })
  job.pid = child.pid

  child.stdout.on('data', (buf) => {
    for (const line of String(buf).split(/\r?\n/)) {
      addJobLog(jobId, line)
    }
  })

  child.stderr.on('data', (buf) => {
    for (const line of String(buf).split(/\r?\n/)) {
      addJobLog(jobId, line)
    }
  })

  child.on('error', (err) => {
    completeJob(jobId, err.message)
  })

  child.on('close', (code) => {
    if (code === 0) {
      completeJob(jobId)
    } else {
      completeJob(jobId, `Downloader exited with code ${code}`)
    }
  })

  logger.info('Download job started', { jobId, mode, source, tickerCount: req.body?.tickers?.length || 'file' })
  res.json({ jobId })
}))

/**
 * GET /api/download/:jobId - Get download job status
 */
router.get('/download/:jobId', asyncHandler(async (req, res) => {
  const job = getJob(req.params.jobId)
  if (!job) {
    return res.status(404).json({ error: 'Job not found' })
  }
  res.json(job)
}))

/**
 * DELETE /api/download/:jobId - Cancel a running download job
 */
router.delete('/download/:jobId', asyncHandler(async (req, res) => {
  const { killJob } = await import('../lib/jobs.mjs')
  const result = killJob(req.params.jobId)

  if (result.success) {
    res.json(result)
  } else {
    res.status(400).json(result)
  }
}))

// ============================================================================
// Export router
// ============================================================================

export default router
