// server/lib/duckdb.mjs
// DuckDB connection pool for parallel queries

import duckdb from 'duckdb'
import path from 'node:path'
import { PARQUET_DIR, DUCKDB_POOL_SIZE } from './config.mjs'

// In-memory DuckDB database
const db = new duckdb.Database(':memory:')

// Primary connection for sequential operations
const conn = db.connect()

// Connection pool for parallel queries
const connectionPool = Array.from({ length: DUCKDB_POOL_SIZE }, () => db.connect())
let poolIndex = 0

/**
 * Get a connection from the pool (round-robin)
 */
export function getPooledConnection() {
  const c = connectionPool[poolIndex]
  poolIndex = (poolIndex + 1) % DUCKDB_POOL_SIZE
  return c
}

/**
 * Get the primary connection for sequential operations
 */
export function getConnection() {
  return conn
}

/**
 * Get the raw database instance
 */
export function getDatabase() {
  return db
}

// Track which tickers are loaded into memory
const loadedTickers = new Set()

/**
 * Check if a ticker is loaded
 */
export function isTickerLoaded(ticker) {
  return loadedTickers.has(ticker)
}

/**
 * Mark a ticker as loaded
 */
export function markTickerLoaded(ticker) {
  loadedTickers.add(ticker)
}

/**
 * Get all loaded tickers
 */
export function getLoadedTickers() {
  return [...loadedTickers]
}

/**
 * Load a single ticker into memory from parquet file
 * @returns {Promise<boolean>} true if loaded successfully
 */
export async function loadTickerIntoMemory(ticker) {
  if (loadedTickers.has(ticker)) {
    return true
  }

  const parquetPath = path.join(PARQUET_DIR, `${ticker}.parquet`)
  const fileForDuckdb = parquetPath.replace(/\\/g, '/').replace(/'/g, "''")
  const tableName = `ticker_${ticker.replace(/[^A-Z0-9]/g, '_')}`

  try {
    // Check if table already exists
    const tableExists = await new Promise((resolve) => {
      conn.all(`SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}'`, (err, rows) => {
        resolve(!err && rows && rows.length > 0)
      })
    })

    if (tableExists) {
      loadedTickers.add(ticker)
      return true
    }

    // Create table from parquet
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
    return true
  } catch (err) {
    console.warn(`[duckdb] Failed to load ${ticker}:`, err.message)
    return false
  }
}

/**
 * Promisified query execution
 */
export function query(sql, connection = conn) {
  return new Promise((resolve, reject) => {
    connection.all(sql, (err, rows) => {
      if (err) reject(err)
      else resolve(rows)
    })
  })
}

/**
 * Promisified run (for INSERT/UPDATE/DELETE)
 */
export function run(sql, connection = conn) {
  return new Promise((resolve, reject) => {
    connection.run(sql, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

export { db, conn, connectionPool, loadedTickers }
