// server/lib/config.mjs
// Centralized environment configuration

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Determine environment
export const isProduction = process.env.NODE_ENV === 'production'
export const isDevelopment = !isProduction

// Paths
const DEFAULT_ROOT = path.resolve(__dirname, '..', '..', 'ticker-data')
export const TICKER_DATA_ROOT = process.env.SYSTEM_TICKER_DATA_ROOT || process.env.TICKER_DATA_MINI_ROOT || DEFAULT_ROOT
export const TICKERS_PATH = process.env.TICKERS_PATH || path.join(TICKER_DATA_ROOT, 'tickers.txt')
export const PARQUET_DIR = process.env.PARQUET_DIR || path.join(TICKER_DATA_ROOT, 'data', 'ticker_data_parquet')
export const DIST_PATH = path.resolve(__dirname, '..', '..', 'dist')

// Server
export const PORT = process.env.PORT || 8787
export const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:5173', 'http://localhost:8787']

// Python
export const PYTHON = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')

// Security
export const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production'
export const REFRESH_SECRET = process.env.REFRESH_SECRET || 'dev-refresh-secret-change-in-production'
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL

// Database
export const DATABASE_URL = process.env.DATABASE_URL

// Redis (optional)
export const REDIS_URL = process.env.REDIS_URL

// Tiingo API
export const TIINGO_API_KEY = process.env.TIINGO_API_KEY

// DuckDB connection pool size
export const DUCKDB_POOL_SIZE = parseInt(process.env.DUCKDB_POOL_SIZE || '8', 10)

// Validate production config
export function validateProductionConfig() {
  if (!isProduction) return true

  const errors = []

  if (!JWT_SECRET || JWT_SECRET.includes('dev-') || JWT_SECRET.length < 32) {
    errors.push('JWT_SECRET must be set to a secure value (min 32 chars) in production')
  }

  if (!REFRESH_SECRET || REFRESH_SECRET.includes('dev-') || REFRESH_SECRET.length < 32) {
    errors.push('REFRESH_SECRET must be set to a secure value (min 32 chars) in production')
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`FATAL: ${error}`)
    }
    return false
  }

  console.log('[config] Production security checks passed')
  return true
}
