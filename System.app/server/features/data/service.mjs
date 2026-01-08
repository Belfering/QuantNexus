// server/features/data/service.mjs
// Ticker data management service

import fs from 'node:fs/promises'
import path from 'node:path'
import { TICKERS_PATH, PARQUET_DIR } from '../../lib/config.mjs'
import { getConnection, getPooledConnection } from '../../lib/duckdb.mjs'

/**
 * Normalize a ticker symbol
 * - Uppercase
 * - Remove invalid characters
 */
export function normalizeTicker(ticker) {
  return String(ticker || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.=^-]/g, '')
}

/**
 * Read tickers from the tickers.txt file
 * Returns deduplicated, normalized list
 */
export async function readTickersFile() {
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

/**
 * Write tickers to the tickers.txt file
 * Normalizes and deduplicates input
 */
export async function writeTickersFile(input) {
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

/**
 * List all ticker symbols from parquet files
 */
export async function listParquetTickers() {
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

/**
 * Check if a parquet file exists for a ticker
 */
export async function parquetFileExists(ticker) {
  const parquetPath = path.join(PARQUET_DIR, `${ticker}.parquet`)
  try {
    await fs.access(parquetPath)
    return true
  } catch {
    return false
  }
}

/**
 * Get parquet file path for a ticker
 */
export function getParquetPath(ticker) {
  return path.join(PARQUET_DIR, `${ticker}.parquet`)
}

/**
 * Format parquet path for DuckDB (handle backslashes and quotes)
 */
export function formatPathForDuckDB(parquetPath) {
  return parquetPath.replace(/\\/g, '/').replace(/'/g, "''")
}

// Server-side memory cache for ticker data
const serverTickerCache = new Map()
const SERVER_CACHE_TTL = 30 * 60 * 1000 // 30 minutes

/**
 * Get cached ticker data or null if not cached/expired
 */
export function getCachedTickerData(ticker, limit) {
  const cached = serverTickerCache.get(ticker)
  if (cached && cached.limit >= limit && Date.now() - cached.timestamp < SERVER_CACHE_TTL) {
    return limit < cached.data.length ? cached.data.slice(-limit) : cached.data
  }
  return null
}

/**
 * Cache ticker data
 */
export function cacheTickerData(ticker, data, limit) {
  serverTickerCache.set(ticker, { data, limit, timestamp: Date.now() })
}

/**
 * Query candles from a parquet file
 * @param {string} ticker - Ticker symbol
 * @param {number} limit - Max rows to return
 * @returns {Promise<Array>} Array of candle objects
 */
export async function queryCandles(ticker, limit = 1500) {
  const parquetPath = getParquetPath(ticker)
  const fileForDuckdb = formatPathForDuckDB(parquetPath)

  const sql = `
    SELECT
      epoch_ms("Date") AS ts_ms,
      "Open"  AS open,
      "High"  AS high,
      "Low"   AS low,
      "Close" AS close,
      "Adj Close" AS adjClose
    FROM read_parquet('${fileForDuckdb}')
    WHERE "Open" IS NOT NULL AND "High" IS NOT NULL AND "Low" IS NOT NULL AND "Close" IS NOT NULL
    ORDER BY "Date" DESC
    LIMIT ${limit};
  `

  const conn = getConnection()
  const rows = await new Promise((resolve, reject) => {
    conn.all(sql, (err, rows) => {
      if (err) reject(err)
      else resolve(rows)
    })
  })

  if (!rows || rows.length === 0) {
    return null
  }

  return rows.slice().reverse().map((r) => ({
    time: Math.floor(Number(r.ts_ms) / 1000),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    adjClose: Number(r.adjClose),
  }))
}

/**
 * Query candles using pooled connection (for parallel queries)
 */
export async function queryCandlesPooled(ticker, limit, poolIndex) {
  const parquetPath = getParquetPath(ticker)
  const fileForDuckdb = formatPathForDuckDB(parquetPath)
  const pooledConn = getPooledConnection()

  const sql = `
    SELECT
      epoch_ms("Date") AS ts_ms,
      "Open"  AS open,
      "High"  AS high,
      "Low"   AS low,
      "Close" AS close,
      "Adj Close" AS adjClose
    FROM read_parquet('${fileForDuckdb}')
    WHERE "Open" IS NOT NULL AND "High" IS NOT NULL AND "Low" IS NOT NULL AND "Close" IS NOT NULL
    ORDER BY "Date" DESC
    LIMIT ${limit}
  `

  const rows = await new Promise((resolve, reject) => {
    pooledConn.all(sql, (err, rows) => {
      if (err) reject(err)
      else resolve(rows)
    })
  })

  if (!rows || rows.length === 0) {
    return null
  }

  return rows.slice().reverse().map((r) => ({
    time: Math.floor(Number(r.ts_ms) / 1000),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    adjClose: Number(r.adjClose),
  }))
}

export { serverTickerCache }
