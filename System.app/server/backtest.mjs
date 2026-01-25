/**
 * Server-side backtest engine
 * This module runs backtests on the server to protect IP (payload never sent to non-owners)
 */

import duckdb from 'duckdb'
import { compressTree } from './tree-compressor.mjs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ============================================
// PRICE DATA LOADING
// ============================================

const PARQUET_DIR = process.env.PARQUET_DIR || path.join(__dirname, '..', 'ticker-data', 'data', 'ticker_data_parquet')

// Safe date formatter - avoids "Invalid time value" errors
const safeIsoDate = (ts) => {
  try {
    const ms = Number(ts) * 1000
    if (!Number.isFinite(ms)) return '1970-01-01'
    return new Date(ms).toISOString().split('T')[0]
  } catch {
    return '1970-01-01'
  }
}

// DuckDB connection pool for concurrent query handling
const duckDbPromise = new Promise((resolve, reject) => {
  const db = new duckdb.Database(':memory:')
  db.all('SELECT 1', (err) => {
    if (err) reject(err)
    else resolve(db)
  })
})

// Query queue to serialize DuckDB access (prevents concurrency corruption)
let queryQueue = Promise.resolve()

function runQuery(sql) {
  return new Promise((resolve, reject) => {
    queryQueue = queryQueue.then(async () => {
      const db = await duckDbPromise
      return new Promise((res, rej) => {
        db.all(sql, (err, rows) => {
          if (err) rej(err)
          else res(rows)
        })
      })
    }).then(resolve).catch(reject)
  })
}

// Minimum backtest start date: 1993-01-01 (filters out older, rarely-used data)
const BACKTEST_START_DATE = new Date(1993, 0, 1)
const BACKTEST_START_EPOCH = Math.floor(BACKTEST_START_DATE.getTime() / 1000)

// ============================================
// TICKER DATA CACHE - Pre-cache common tickers for instant access
// ============================================
const COMMON_TICKERS = ['SPY', 'QQQ', 'IWM', 'EEM', 'AGG', 'GLD', 'TLT', 'BIL', 'VTI', 'DIA', 'DBC', 'DBO', 'BND', 'GBTC']
const tickerDataCache = new Map()
let cacheInitialized = false

async function initTickerCache() {
  if (cacheInitialized) return
  console.log('[Backtest] Pre-caching common tickers for instant access...')
  const startTime = Date.now()

  for (const ticker of COMMON_TICKERS) {
    try {
      const bars = await fetchOhlcSeriesUncached(ticker, 20000)
      if (bars && bars.length > 0) {
        tickerDataCache.set(ticker, bars)
      }
    } catch (err) {
      console.warn(`[Backtest] Failed to pre-cache ${ticker}:`, err.message)
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
  console.log(`[Backtest] Pre-cached ${tickerDataCache.size} common tickers in ${elapsed}s`)
  cacheInitialized = true
}

// Internal function without cache check (used for initial loading)
async function fetchOhlcSeriesUncached(ticker, limit = 20000) {
  const filePath = path.join(PARQUET_DIR, `${ticker}.parquet`)
  const sql = `
    SELECT
      epoch(Date) AS time,
      Open AS open,
      High AS high,
      Low AS low,
      Close AS close,
      "Adj Close" AS adjClose,
      Volume AS volume
    FROM read_parquet('${filePath.replace(/\\/g, '/')}')
    WHERE epoch(Date) >= ${BACKTEST_START_EPOCH}
    ORDER BY Date DESC
    LIMIT ${limit}
  `

  const rows = await runQuery(sql)
  return rows
    .map(r => ({
      time: Number(r.time),
      open: r.open == null ? null : Number(r.open),
      high: r.high == null ? null : Number(r.high),
      low: r.low == null ? null : Number(r.low),
      close: r.close == null ? null : Number(r.close),
      adjClose: r.adjClose == null ? null : Number(r.adjClose),
      volume: r.volume == null ? null : Number(r.volume),
    }))
    .sort((a, b) => a.time - b.time)
}

async function fetchOhlcSeries(ticker, limit = 20000) {
  // Check cache first for common tickers (instant access)
  const cached = tickerDataCache.get(ticker)
  if (cached) {
    // Return cached data (may need to slice if limit is smaller)
    return limit < cached.length ? cached.slice(-limit) : cached
  }

  // Not in cache, fetch from parquet
  return fetchOhlcSeriesUncached(ticker, limit)
}

// ============================================
// HELPER FUNCTIONS
// ============================================

const normalizeChoice = (ticker) => {
  if (!ticker || ticker === 'Empty' || ticker === '') return 'Empty'
  return String(ticker).toUpperCase().trim()
}

const getSeriesKey = (ticker) => normalizeChoice(ticker)

// Parse ratio ticker into component tickers
const parseRatioTicker = (ticker) => {
  const norm = normalizeChoice(ticker)
  const parts = norm.split('/')
  if (parts.length !== 2) return null
  const [numerator, denominator] = parts.map((p) => p.trim())
  if (!numerator || !denominator) return null
  return { numerator, denominator }
}

// ============================================
// IS/OOS SPLIT LOGIC
// ============================================

/**
 * Split timestamps into in-sample (IS) and out-of-sample (OOS) sets based on strategy
 * @param {number[]} dates - Array of timestamps (seconds since epoch)
 * @param {string} strategy - Split strategy: 'even_odd_month' | 'even_odd_year' | 'chronological'
 * @param {string} [chronologicalDate] - Threshold date for chronological strategy (YYYY-MM-DD)
 * @returns {{ isDates: Set<number>, oosDates: Set<number> }}
 */
function splitDates(dates, strategy, chronologicalDate) {
  const isDates = new Set()
  const oosDates = new Set()

  for (const timestamp of dates) {
    const date = new Date(timestamp * 1000)

    if (strategy === 'even_odd_month') {
      // Odd months = IS (Jan, Mar, May, Jul, Sep, Nov)
      // Even months = OOS (Feb, Apr, Jun, Aug, Oct, Dec)
      const month = date.getMonth() + 1
      if ([1, 3, 5, 7, 9, 11].includes(month)) {
        isDates.add(timestamp)
      } else {
        oosDates.add(timestamp)
      }
    } else if (strategy === 'even_odd_year') {
      // Odd years = IS (2019, 2021, 2023, etc.)
      // Even years = OOS (2020, 2022, 2024, etc.)
      const year = date.getFullYear()
      if (year % 2 === 1) {
        isDates.add(timestamp)
      } else {
        oosDates.add(timestamp)
      }
    } else if (strategy === 'chronological' && chronologicalDate) {
      // Before threshold = IS, after threshold = OOS
      const threshold = new Date(chronologicalDate).getTime() / 1000
      if (timestamp < threshold) {
        isDates.add(timestamp)
      } else {
        oosDates.add(timestamp)
      }
    } else {
      // Fallback: if strategy is unknown or chronologicalDate missing, put everything in IS
      isDates.add(timestamp)
    }
  }

  return { isDates, oosDates }
}

// ============================================
// INDICATOR CALCULATIONS
// ============================================

const rollingSma = (values, period) => {
  const out = new Array(values.length).fill(null)
  let sum = 0
  let missing = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (Number.isNaN(v)) missing += 1
    else sum += v
    if (i >= period) {
      const prev = values[i - period]
      if (Number.isNaN(prev)) missing -= 1
      else sum -= prev
    }
    if (i >= period - 1 && missing === 0) out[i] = sum / period
  }
  return out
}

const rollingEma = (values, period) => {
  const out = new Array(values.length).fill(null)
  const alpha = 2 / (period + 1)
  let ema = null
  let readyCount = 0
  let seedSum = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (Number.isNaN(v)) {
      ema = null
      readyCount = 0
      seedSum = 0
      continue
    }
    if (ema == null) {
      seedSum += v
      readyCount += 1
      if (readyCount === period) {
        ema = seedSum / period
        out[i] = ema
      }
      continue
    }
    ema = alpha * v + (1 - alpha) * ema
    out[i] = ema
  }
  return out
}

const rollingWilderRsi = (closes, period) => {
  const out = new Array(closes.length).fill(null)
  let avgGain = null
  let avgLoss = null
  let seedG = 0
  let seedL = 0
  let seedCount = 0
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1]
    const cur = closes[i]
    if (Number.isNaN(prev) || Number.isNaN(cur)) {
      avgGain = null
      avgLoss = null
      seedG = 0
      seedL = 0
      seedCount = 0
      continue
    }
    const change = cur - prev
    const gain = change > 0 ? change : 0
    const loss = change < 0 ? -change : 0
    if (avgGain == null || avgLoss == null) {
      seedG += gain
      seedL += loss
      seedCount += 1
      if (seedCount === period) {
        avgGain = seedG / period
        avgLoss = seedL / period
        const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss
        out[i] = 100 - 100 / (1 + rs)
      }
      continue
    }
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss
    out[i] = 100 - 100 / (1 + rs)
  }
  return out
}

const rollingStdDev = (values, period) => {
  const out = new Array(values.length).fill(null)
  let sum = 0
  let sumSq = 0
  let missing = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (Number.isNaN(v)) {
      missing += 1
    } else {
      sum += v
      sumSq += v * v
    }
    if (i >= period) {
      const prev = values[i - period]
      if (Number.isNaN(prev)) missing -= 1
      else {
        sum -= prev
        sumSq -= prev * prev
      }
    }
    if (i >= period - 1 && missing === 0) {
      const mean = sum / period
      const variance = Math.max(0, sumSq / period - mean * mean)
      out[i] = Math.sqrt(variance) * 100 // Return as percentage (e.g., 2.5 = 2.5%)
    }
  }
  return out
}

// Rolling standard deviation of prices (raw absolute $ values)
// Used for "Standard Deviation of Price" indicator - measures price level volatility
const rollingStdDevOfPrices = (values, period) => {
  const out = new Array(values.length).fill(null)
  let sum = 0
  let sumSq = 0
  let missing = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (Number.isNaN(v)) {
      missing += 1
    } else {
      sum += v
      sumSq += v * v
    }
    if (i >= period) {
      const prev = values[i - period]
      if (Number.isNaN(prev)) missing -= 1
      else {
        sum -= prev
        sumSq -= prev * prev
      }
    }
    if (i >= period - 1 && missing === 0) {
      const mean = sum / period
      const variance = Math.max(0, sumSq / period - mean * mean)
      out[i] = Math.sqrt(variance) // Raw stddev in $ terms
    }
  }
  return out
}

// Rolling max drawdown using close prices only
// Calculates the largest peak-to-trough decline within the window using daily closes
// Returns POSITIVE values (e.g., 0.05 for 5% drawdown)
// "Max Drawdown < 0.01" means "drawdown is less than 1%"
const rollingMaxDrawdown = (values, period) => {
  const n = values.length
  const out = new Array(n).fill(null)
  if (period <= 0 || n === 0) return out

  for (let i = period - 1; i < n; i++) {
    const windowStart = i - period + 1
    let valid = true
    let peak = -Infinity
    let maxDd = 0

    // Check each close price in the window
    for (let j = windowStart; j <= i && valid; j++) {
      const v = values[j]
      if (Number.isNaN(v)) {
        valid = false
        break
      }

      // Track peak close and max drawdown from peak
      if (v > peak) peak = v
      if (peak > 0) {
        const dd = v / peak - 1 // negative when below peak
        if (dd < maxDd) maxDd = dd
      }
    }

    if (valid) {
      // Return max drawdown as POSITIVE value (e.g., 0.05 for 5% drawdown)
      out[i] = Math.abs(maxDd)
    }
  }
  return out
}

const rollingCumulativeReturn = (values, period) => {
  const out = new Array(values.length).fill(null)
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) continue
    const startIdx = i - period + 1
    const startVal = values[startIdx]
    const endVal = values[i]
    if (Number.isNaN(startVal) || Number.isNaN(endVal) || startVal === 0) continue
    out[i] = (endVal - startVal) / startVal
  }
  return out
}

const rollingSmaOfReturns = (values, period) => {
  const returns = new Array(values.length).fill(NaN)
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1]
    const cur = values[i]
    if (!Number.isNaN(prev) && !Number.isNaN(cur) && prev !== 0) {
      returns[i] = cur / prev - 1
    }
  }
  return rollingSma(returns, period)
}

// ============================================
// MOMENTUM INDICATORS (13612W, 13612U, SMA12)
// ============================================

// 13612W Weighted Momentum (no window parameter - fixed formula)
// (12*(p0/p1-1) + 4*(p0/p3-1) + 2*(p0/p6-1) + (p0/p12-1)) / 19
// Where pN = price N months ago (~21 trading days per month)
const rolling13612W = (closes) => {
  const out = new Array(closes.length).fill(null)
  const m1 = 21, m3 = 63, m6 = 126, m12 = 252
  for (let i = m12; i < closes.length; i++) {
    const p0 = closes[i]
    const p1 = closes[i - m1]
    const p3 = closes[i - m3]
    const p6 = closes[i - m6]
    const p12 = closes[i - m12]
    if (p1 && p3 && p6 && p12 && !Number.isNaN(p0) && !Number.isNaN(p1) && !Number.isNaN(p3) && !Number.isNaN(p6) && !Number.isNaN(p12)) {
      out[i] = (12 * (p0 / p1 - 1) + 4 * (p0 / p3 - 1) + 2 * (p0 / p6 - 1) + (p0 / p12 - 1)) / 19
    }
  }
  return out
}

// 13612U Unweighted Momentum
// ((p0/p1-1) + (p0/p3-1) + (p0/p6-1) + (p0/p12-1)) / 4
const rolling13612U = (closes) => {
  const out = new Array(closes.length).fill(null)
  const m1 = 21, m3 = 63, m6 = 126, m12 = 252
  for (let i = m12; i < closes.length; i++) {
    const p0 = closes[i]
    const p1 = closes[i - m1]
    const p3 = closes[i - m3]
    const p6 = closes[i - m6]
    const p12 = closes[i - m12]
    if (p1 && p3 && p6 && p12 && !Number.isNaN(p0) && !Number.isNaN(p1) && !Number.isNaN(p3) && !Number.isNaN(p6) && !Number.isNaN(p12)) {
      out[i] = ((p0 / p1 - 1) + (p0 / p3 - 1) + (p0 / p6 - 1) + (p0 / p12 - 1)) / 4
    }
  }
  return out
}

// SMA12 Momentum: 13*P0 / (P0+P1+...+P12) - 1
// Where Pn is price n months ago
const rollingSMA12Momentum = (closes) => {
  const out = new Array(closes.length).fill(null)
  const m = 21 // ~21 trading days per month
  for (let i = 12 * m; i < closes.length; i++) {
    let sum = 0
    let valid = true
    for (let j = 0; j <= 12; j++) {
      const price = closes[i - j * m]
      if (!price || Number.isNaN(price)) {
        valid = false
        break
      }
      sum += price
    }
    if (valid && sum > 0) {
      out[i] = 13 * closes[i] / sum - 1
    }
  }
  return out
}

// ============================================
// DRAWDOWN (current drawdown from ATH)
// ============================================

// Current drawdown from all-time high (no window - uses all history)
const rollingDrawdown = (closes) => {
  const out = new Array(closes.length).fill(null)
  let peak = null
  for (let i = 0; i < closes.length; i++) {
    const v = closes[i]
    if (Number.isNaN(v)) continue
    if (peak === null || v > peak) peak = v
    if (peak > 0) {
      out[i] = (peak - v) / peak // Returns positive value (0.05 = 5% down from peak)
    }
  }
  return out
}

// ============================================
// AROON INDICATORS (need High/Low prices)
// ============================================

// Aroon Up: ((n - days since n-day high) / n) * 100
const rollingAroonUp = (highs, period) => {
  const out = new Array(highs.length).fill(null)
  for (let i = period; i < highs.length; i++) {
    let maxIdx = i - period
    let valid = true
    for (let j = i - period; j <= i; j++) {
      if (Number.isNaN(highs[j])) {
        valid = false
        break
      }
      if (highs[j] >= highs[maxIdx]) maxIdx = j
    }
    if (valid) {
      out[i] = ((period - (i - maxIdx)) / period) * 100
    }
  }
  return out
}

// Aroon Down: ((n - days since n-day low) / n) * 100
const rollingAroonDown = (lows, period) => {
  const out = new Array(lows.length).fill(null)
  for (let i = period; i < lows.length; i++) {
    let minIdx = i - period
    let valid = true
    for (let j = i - period; j <= i; j++) {
      if (Number.isNaN(lows[j])) {
        valid = false
        break
      }
      if (lows[j] <= lows[minIdx]) minIdx = j
    }
    if (valid) {
      out[i] = ((period - (i - minIdx)) / period) * 100
    }
  }
  return out
}

// Aroon Oscillator: Aroon Up - Aroon Down
const rollingAroonOscillator = (highs, lows, period) => {
  const up = rollingAroonUp(highs, period)
  const down = rollingAroonDown(lows, period)
  return up.map((u, i) => u != null && down[i] != null ? u - down[i] : null)
}

// ============================================
// MACD & PPO HISTOGRAMS (fixed 12/26/9)
// ============================================

// MACD Histogram = MACD Line - Signal Line
// MACD Line = 12-day EMA - 26-day EMA
// Signal Line = 9-day EMA of MACD Line
const rollingMACD = (closes) => {
  const ema12 = rollingEma(closes, 12)
  const ema26 = rollingEma(closes, 26)
  const macdLine = ema12.map((v, i) => v != null && ema26[i] != null ? v - ema26[i] : NaN)
  const signal = rollingEma(macdLine, 9)
  return macdLine.map((v, i) => !Number.isNaN(v) && signal[i] != null ? v - signal[i] : null)
}

// PPO Histogram (Percentage Price Oscillator) - like MACD but normalized
// PPO Line = ((12-day EMA - 26-day EMA) / 26-day EMA) * 100
// Signal Line = 9-day EMA of PPO Line
const rollingPPO = (closes) => {
  const ema12 = rollingEma(closes, 12)
  const ema26 = rollingEma(closes, 26)
  const ppoLine = ema12.map((v, i) => {
    if (v == null || ema26[i] == null || ema26[i] === 0) return NaN
    return ((v - ema26[i]) / ema26[i]) * 100
  })
  const signal = rollingEma(ppoLine, 9)
  return ppoLine.map((v, i) => !Number.isNaN(v) && signal[i] != null ? v - signal[i] : null)
}

// ============================================
// TREND CLARITY (R² of linear regression)
// ============================================

// Returns R² * 100 (0-100 scale) - measures how well price fits a straight line
const rollingTrendClarity = (values, period) => {
  const out = new Array(values.length).fill(null)
  for (let i = period - 1; i < values.length; i++) {
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0
    let valid = true
    const n = period

    for (let j = 0; j < n; j++) {
      const y = values[i - n + 1 + j]
      if (Number.isNaN(y)) {
        valid = false
        break
      }
      sumX += j
      sumY += y
      sumXY += j * y
      sumX2 += j * j
      sumY2 += y * y
    }

    if (valid) {
      const num = n * sumXY - sumX * sumY
      const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY))
      const r = den === 0 ? 0 : num / den
      out[i] = r * r * 100 // R² as percentage
    }
  }
  return out
}

// ============================================
// ULTIMATE SMOOTHER (Ehlers filter)
// ============================================

// John Ehlers' SuperSmoother - a more stable alternative to the original Ultimate Smoother
// Uses a 2-pole Butterworth filter which maintains unity DC gain naturally
const rollingUltimateSmoother = (values, period) => {
  const out = new Array(values.length).fill(null)

  // 2-pole Butterworth filter coefficients for SuperSmoother
  const f = 1.414 * Math.PI / period
  const a1 = Math.exp(-f)
  const b1 = 2 * a1 * Math.cos(f)
  const c2 = b1
  const c3 = -a1 * a1
  const c1 = 1 - c2 - c3  // This ensures unity DC gain

  for (let i = 0; i < values.length; i++) {
    if (i < 2 || i < period) {
      out[i] = values[i]
      continue
    }
    if (Number.isNaN(values[i]) || Number.isNaN(values[i - 1]) || Number.isNaN(values[i - 2])) {
      continue
    }
    const prev1 = out[i - 1] ?? values[i - 1]
    const prev2 = out[i - 2] ?? values[i - 2]
    // SuperSmoother: simple weighted average input with recursive feedback
    out[i] = c1 * values[i] + c2 * prev1 + c3 * prev2
  }
  return out
}

// ============================================
// ADDITIONAL MOVING AVERAGES
// ============================================

// Hull Moving Average - reduces lag significantly
// HMA = WMA(2*WMA(n/2) - WMA(n), sqrt(n))
const rollingHma = (values, period) => {
  const halfPeriod = Math.floor(period / 2)
  const sqrtPeriod = Math.floor(Math.sqrt(period))
  const wma1 = rollingWma(values, halfPeriod)
  const wma2 = rollingWma(values, period)
  const diff = wma1.map((v, i) => {
    if (v == null || wma2[i] == null) return NaN
    return 2 * v - wma2[i]
  })
  return rollingWma(diff, sqrtPeriod)
}

// Weighted Moving Average - linear weights (recent bars weighted more)
const rollingWma = (values, period) => {
  const out = new Array(values.length).fill(null)
  const divisor = (period * (period + 1)) / 2
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0
    let valid = true
    for (let j = 0; j < period; j++) {
      const v = values[i - period + 1 + j]
      if (Number.isNaN(v)) {
        valid = false
        break
      }
      sum += v * (j + 1) // weight increases from 1 to period
    }
    if (valid) out[i] = sum / divisor
  }
  return out
}

// Wilder's Moving Average (same alpha as Wilder RSI uses)
const rollingWildersMa = (values, period) => {
  const out = new Array(values.length).fill(null)
  const alpha = 1 / period
  let ma = null
  let seedSum = 0
  let seedCount = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (Number.isNaN(v)) {
      ma = null
      seedSum = 0
      seedCount = 0
      continue
    }
    if (ma == null) {
      seedSum += v
      seedCount++
      if (seedCount === period) {
        ma = seedSum / period
        out[i] = ma
      }
      continue
    }
    ma = alpha * v + (1 - alpha) * ma
    out[i] = ma
  }
  return out
}

// Double EMA (DEMA) = 2*EMA - EMA(EMA)
const rollingDema = (values, period) => {
  const ema1 = rollingEma(values, period)
  const ema2 = rollingEma(ema1.map(v => v ?? NaN), period)
  return ema1.map((v, i) => {
    if (v == null || ema2[i] == null) return null
    return 2 * v - ema2[i]
  })
}

// Triple EMA (TEMA) = 3*EMA - 3*EMA(EMA) + EMA(EMA(EMA))
const rollingTema = (values, period) => {
  const ema1 = rollingEma(values, period)
  const ema2 = rollingEma(ema1.map(v => v ?? NaN), period)
  const ema3 = rollingEma(ema2.map(v => v ?? NaN), period)
  return ema1.map((v, i) => {
    if (v == null || ema2[i] == null || ema3[i] == null) return null
    return 3 * v - 3 * ema2[i] + ema3[i]
  })
}

// Kaufman Adaptive Moving Average (KAMA)
const rollingKama = (values, period, fastPeriod = 2, slowPeriod = 30) => {
  const out = new Array(values.length).fill(null)
  const fastSC = 2 / (fastPeriod + 1)
  const slowSC = 2 / (slowPeriod + 1)
  let kama = null
  for (let i = period; i < values.length; i++) {
    const v = values[i]
    if (Number.isNaN(v) || Number.isNaN(values[i - period])) {
      kama = null
      continue
    }
    // Calculate Efficiency Ratio
    const change = Math.abs(v - values[i - period])
    let volatility = 0
    let valid = true
    for (let j = 1; j <= period; j++) {
      if (Number.isNaN(values[i - j]) || Number.isNaN(values[i - j + 1])) {
        valid = false
        break
      }
      volatility += Math.abs(values[i - j + 1] - values[i - j])
    }
    if (!valid) continue
    const er = volatility === 0 ? 0 : change / volatility
    const sc = Math.pow(er * (fastSC - slowSC) + slowSC, 2)
    if (kama == null) {
      kama = v
    } else {
      kama = kama + sc * (v - kama)
    }
    out[i] = kama
  }
  return out
}

// ============================================
// RSI VARIANTS
// ============================================

// RSI with SMA smoothing (instead of Wilder's method)
const rollingRsiSma = (closes, period) => {
  const out = new Array(closes.length).fill(null)
  const gains = new Array(closes.length).fill(NaN)
  const losses = new Array(closes.length).fill(NaN)
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1]
    if (Number.isNaN(change)) continue
    gains[i] = change > 0 ? change : 0
    losses[i] = change < 0 ? -change : 0
  }
  const avgGain = rollingSma(gains, period)
  const avgLoss = rollingSma(losses, period)
  for (let i = 0; i < closes.length; i++) {
    if (avgGain[i] == null || avgLoss[i] == null) continue
    const rs = avgLoss[i] === 0 ? Infinity : avgGain[i] / avgLoss[i]
    out[i] = 100 - 100 / (1 + rs)
  }
  return out
}

// RSI with EMA smoothing
const rollingRsiEma = (closes, period) => {
  const out = new Array(closes.length).fill(null)
  const gains = new Array(closes.length).fill(NaN)
  const losses = new Array(closes.length).fill(NaN)
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1]
    if (Number.isNaN(change)) continue
    gains[i] = change > 0 ? change : 0
    losses[i] = change < 0 ? -change : 0
  }
  const avgGain = rollingEma(gains, period)
  const avgLoss = rollingEma(losses, period)
  for (let i = 0; i < closes.length; i++) {
    if (avgGain[i] == null || avgLoss[i] == null) continue
    const rs = avgLoss[i] === 0 ? Infinity : avgGain[i] / avgLoss[i]
    out[i] = 100 - 100 / (1 + rs)
  }
  return out
}

// Stochastic RSI = (RSI - RSI_Low) / (RSI_High - RSI_Low) * 100
const rollingStochRsi = (closes, rsiPeriod, stochPeriod) => {
  const rsi = rollingWilderRsi(closes, rsiPeriod)
  const out = new Array(closes.length).fill(null)
  for (let i = stochPeriod - 1; i < closes.length; i++) {
    let minRsi = Infinity, maxRsi = -Infinity
    let valid = true
    for (let j = 0; j < stochPeriod; j++) {
      const r = rsi[i - j]
      if (r == null) {
        valid = false
        break
      }
      if (r < minRsi) minRsi = r
      if (r > maxRsi) maxRsi = r
    }
    if (valid && maxRsi !== minRsi) {
      out[i] = ((rsi[i] - minRsi) / (maxRsi - minRsi)) * 100
    }
  }
  return out
}

// Laguerre RSI (Ehlers) - gamma typically 0.5-0.8
const rollingLaguerreRsi = (closes, gamma = 0.8) => {
  const out = new Array(closes.length).fill(null)
  let L0 = 0, L1 = 0, L2 = 0, L3 = 0
  let L0_1 = 0, L1_1 = 0, L2_1 = 0, L3_1 = 0
  for (let i = 0; i < closes.length; i++) {
    const v = closes[i]
    if (Number.isNaN(v)) continue
    L0 = (1 - gamma) * v + gamma * L0_1
    L1 = -gamma * L0 + L0_1 + gamma * L1_1
    L2 = -gamma * L1 + L1_1 + gamma * L2_1
    L3 = -gamma * L2 + L2_1 + gamma * L3_1
    const cu = (L0 > L1 ? L0 - L1 : 0) + (L1 > L2 ? L1 - L2 : 0) + (L2 > L3 ? L2 - L3 : 0)
    const cd = (L0 < L1 ? L1 - L0 : 0) + (L1 < L2 ? L2 - L1 : 0) + (L2 < L3 ? L3 - L2 : 0)
    if (cu + cd !== 0) {
      out[i] = cu / (cu + cd) * 100
    }
    L0_1 = L0
    L1_1 = L1
    L2_1 = L2
    L3_1 = L3
  }
  return out
}

// ============================================
// VOLATILITY INDICATORS
// ============================================

// Bollinger %B = (Price - Lower Band) / (Upper Band - Lower Band)
// Returns 0-1 range (below 0 = below lower band, above 1 = above upper band)
const rollingBollingerB = (closes, period, stdMult = 2) => {
  const sma = rollingSma(closes, period)
  const std = rollingStdDev(closes, period)
  return closes.map((v, i) => {
    if (sma[i] == null || std[i] == null || Number.isNaN(v)) return null
    const stdVal = std[i] / 100 * sma[i] // Convert from percentage back
    const upper = sma[i] + stdMult * stdVal
    const lower = sma[i] - stdMult * stdVal
    const range = upper - lower
    if (range === 0) return 0.5
    return (v - lower) / range
  })
}

// Bollinger Bandwidth = (Upper - Lower) / Middle * 100
const rollingBollingerBandwidth = (closes, period, stdMult = 2) => {
  const sma = rollingSma(closes, period)
  const std = rollingStdDev(closes, period)
  return closes.map((_, i) => {
    if (sma[i] == null || std[i] == null || sma[i] === 0) return null
    const stdVal = std[i] / 100 * sma[i]
    return (2 * stdMult * stdVal) / sma[i] * 100
  })
}

// Average True Range (ATR)
const rollingAtr = (highs, lows, closes, period) => {
  const tr = new Array(closes.length).fill(NaN)
  for (let i = 1; i < closes.length; i++) {
    if (Number.isNaN(highs[i]) || Number.isNaN(lows[i]) || Number.isNaN(closes[i - 1])) continue
    const hl = highs[i] - lows[i]
    const hc = Math.abs(highs[i] - closes[i - 1])
    const lc = Math.abs(lows[i] - closes[i - 1])
    tr[i] = Math.max(hl, hc, lc)
  }
  return rollingWildersMa(tr, period)
}

// ATR as percentage of price
const rollingAtrPercent = (highs, lows, closes, period) => {
  const atr = rollingAtr(highs, lows, closes, period)
  return atr.map((v, i) => {
    if (v == null || closes[i] == null || closes[i] === 0) return null
    return (v / closes[i]) * 100
  })
}

// Historical Volatility (annualized standard deviation of returns)
const rollingHistoricalVolatility = (closes, period) => {
  const returns = new Array(closes.length).fill(NaN)
  for (let i = 1; i < closes.length; i++) {
    if (!Number.isNaN(closes[i]) && !Number.isNaN(closes[i - 1]) && closes[i - 1] !== 0) {
      returns[i] = Math.log(closes[i] / closes[i - 1])
    }
  }
  const std = rollingStdDev(returns, period)
  return std.map(v => v == null ? null : v * Math.sqrt(252)) // Annualize
}

// Ulcer Index - measures downside volatility/pain
const rollingUlcerIndex = (closes, period) => {
  const out = new Array(closes.length).fill(null)
  for (let i = period - 1; i < closes.length; i++) {
    let maxClose = -Infinity
    let sumSq = 0
    let valid = true
    for (let j = 0; j < period; j++) {
      const v = closes[i - period + 1 + j]
      if (Number.isNaN(v)) {
        valid = false
        break
      }
      if (v > maxClose) maxClose = v
      const pctDrawdown = ((v - maxClose) / maxClose) * 100
      sumSq += pctDrawdown * pctDrawdown
    }
    if (valid) {
      out[i] = Math.sqrt(sumSq / period)
    }
  }
  return out
}

// ============================================
// MOMENTUM INDICATORS
// ============================================

// Rate of Change (ROC) - percentage change over period
const rollingRoc = (closes, period) => {
  const out = new Array(closes.length).fill(null)
  for (let i = period; i < closes.length; i++) {
    const prev = closes[i - period]
    const cur = closes[i]
    if (!Number.isNaN(prev) && !Number.isNaN(cur) && prev !== 0) {
      out[i] = ((cur - prev) / prev) * 100
    }
  }
  return out
}

// Williams %R = (Highest High - Close) / (Highest High - Lowest Low) * -100
// Range: -100 to 0 (oversold below -80, overbought above -20)
const rollingWilliamsR = (highs, lows, closes, period) => {
  const out = new Array(closes.length).fill(null)
  for (let i = period - 1; i < closes.length; i++) {
    let hh = -Infinity, ll = Infinity
    let valid = true
    for (let j = 0; j < period; j++) {
      const h = highs[i - j]
      const l = lows[i - j]
      if (Number.isNaN(h) || Number.isNaN(l)) {
        valid = false
        break
      }
      if (h > hh) hh = h
      if (l < ll) ll = l
    }
    if (valid && hh !== ll && !Number.isNaN(closes[i])) {
      out[i] = ((hh - closes[i]) / (hh - ll)) * -100
    }
  }
  return out
}

// Commodity Channel Index (CCI)
// CCI = (Typical Price - SMA of TP) / (0.015 * Mean Deviation)
const rollingCci = (highs, lows, closes, period) => {
  const tp = closes.map((c, i) => {
    if (Number.isNaN(c) || Number.isNaN(highs[i]) || Number.isNaN(lows[i])) return NaN
    return (highs[i] + lows[i] + c) / 3
  })
  const smaTP = rollingSma(tp, period)
  const out = new Array(closes.length).fill(null)
  for (let i = period - 1; i < closes.length; i++) {
    if (smaTP[i] == null || Number.isNaN(tp[i])) continue
    let meanDev = 0
    let valid = true
    for (let j = 0; j < period; j++) {
      if (Number.isNaN(tp[i - j])) {
        valid = false
        break
      }
      meanDev += Math.abs(tp[i - j] - smaTP[i])
    }
    if (valid) {
      meanDev /= period
      if (meanDev !== 0) {
        out[i] = (tp[i] - smaTP[i]) / (0.015 * meanDev)
      }
    }
  }
  return out
}

// Stochastic %K (Fast) = (Close - Lowest Low) / (Highest High - Lowest Low) * 100
const rollingStochK = (highs, lows, closes, period) => {
  const out = new Array(closes.length).fill(null)
  for (let i = period - 1; i < closes.length; i++) {
    let hh = -Infinity, ll = Infinity
    let valid = true
    for (let j = 0; j < period; j++) {
      const h = highs[i - j]
      const l = lows[i - j]
      if (Number.isNaN(h) || Number.isNaN(l)) {
        valid = false
        break
      }
      if (h > hh) hh = h
      if (l < ll) ll = l
    }
    if (valid && hh !== ll && !Number.isNaN(closes[i])) {
      out[i] = ((closes[i] - ll) / (hh - ll)) * 100
    }
  }
  return out
}

// Stochastic %D (Slow) = SMA of %K
// Both kPeriod and dPeriod use the user's window setting for consistency
const rollingStochD = (highs, lows, closes, kPeriod, dPeriod) => {
  // Default dPeriod to kPeriod if not specified (common practice)
  const actualDPeriod = dPeriod ?? kPeriod
  const stochK = rollingStochK(highs, lows, closes, kPeriod)
  return rollingSma(stochK.map(v => v ?? NaN), actualDPeriod)
}

// Average Directional Index (ADX)
const rollingAdx = (highs, lows, closes, period) => {
  const n = closes.length
  const tr = new Array(n).fill(NaN)
  const plusDM = new Array(n).fill(NaN)
  const minusDM = new Array(n).fill(NaN)

  for (let i = 1; i < n; i++) {
    if (Number.isNaN(highs[i]) || Number.isNaN(lows[i]) || Number.isNaN(closes[i - 1])) continue
    const hl = highs[i] - lows[i]
    const hc = Math.abs(highs[i] - closes[i - 1])
    const lc = Math.abs(lows[i] - closes[i - 1])
    tr[i] = Math.max(hl, hc, lc)

    const upMove = highs[i] - highs[i - 1]
    const downMove = lows[i - 1] - lows[i]
    plusDM[i] = (upMove > downMove && upMove > 0) ? upMove : 0
    minusDM[i] = (downMove > upMove && downMove > 0) ? downMove : 0
  }

  const smoothTR = rollingWildersMa(tr, period)
  const smoothPlusDM = rollingWildersMa(plusDM, period)
  const smoothMinusDM = rollingWildersMa(minusDM, period)

  const plusDI = smoothPlusDM.map((v, i) => {
    if (v == null || smoothTR[i] == null || smoothTR[i] === 0) return NaN
    return (v / smoothTR[i]) * 100
  })
  const minusDI = smoothMinusDM.map((v, i) => {
    if (v == null || smoothTR[i] == null || smoothTR[i] === 0) return NaN
    return (v / smoothTR[i]) * 100
  })

  const dx = plusDI.map((plus, i) => {
    const minus = minusDI[i]
    if (Number.isNaN(plus) || Number.isNaN(minus)) return NaN
    const sum = plus + minus
    if (sum === 0) return 0
    return (Math.abs(plus - minus) / sum) * 100
  })

  return rollingWildersMa(dx, period)
}

// ============================================
// TREND INDICATORS
// ============================================

// Linear Regression Slope (normalized by price)
const rollingLinRegSlope = (values, period) => {
  const out = new Array(values.length).fill(null)
  for (let i = period - 1; i < values.length; i++) {
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0
    let valid = true
    const n = period

    for (let j = 0; j < n; j++) {
      const y = values[i - n + 1 + j]
      if (Number.isNaN(y)) {
        valid = false
        break
      }
      sumX += j
      sumY += y
      sumXY += j * y
      sumX2 += j * j
    }

    if (valid) {
      const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
      // Normalize by average price to get percentage slope
      const avgPrice = sumY / n
      out[i] = avgPrice !== 0 ? (slope / avgPrice) * 100 : 0
    }
  }
  return out
}

// Linear Regression Value (predicted price at current bar)
const rollingLinRegValue = (values, period) => {
  const out = new Array(values.length).fill(null)
  for (let i = period - 1; i < values.length; i++) {
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0
    let valid = true
    const n = period

    for (let j = 0; j < n; j++) {
      const y = values[i - n + 1 + j]
      if (Number.isNaN(y)) {
        valid = false
        break
      }
      sumX += j
      sumY += y
      sumXY += j * y
      sumX2 += j * j
    }

    if (valid) {
      const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
      const intercept = (sumY - slope * sumX) / n
      out[i] = intercept + slope * (n - 1)
    }
  }
  return out
}

// Price vs SMA ratio (Price / SMA - 1) * 100
const rollingPriceVsSma = (closes, period) => {
  const sma = rollingSma(closes, period)
  return closes.map((v, i) => {
    if (sma[i] == null || Number.isNaN(v) || sma[i] === 0) return null
    return ((v / sma[i]) - 1) * 100
  })
}

// ============================================
// INDICATOR CACHE
// ============================================

const emptyCache = () => ({
  rsi: new Map(),
  sma: new Map(),
  ema: new Map(),
  std: new Map(),
  maxdd: new Map(),
  stdPrice: new Map(),
  cumRet: new Map(),
  smaRet: new Map(),
  // Momentum indicators
  mom13612w: new Map(),
  mom13612u: new Map(),
  momsma12: new Map(),
  // Other indicators
  drawdown: new Map(),
  aroonUp: new Map(),
  aroonDown: new Map(),
  aroonOsc: new Map(),
  macd: new Map(),
  ppo: new Map(),
  trendClarity: new Map(),
  ultimateSmoother: new Map(),
  ultSmooth: new Map(),
  // New Moving Averages
  hma: new Map(),
  wma: new Map(),
  wildersMa: new Map(),
  dema: new Map(),
  tema: new Map(),
  kama: new Map(),
  // RSI Variants
  rsiSma: new Map(),
  rsiEma: new Map(),
  stochRsi: new Map(),
  laguerreRsi: new Map(),
  // Volatility
  bollingerB: new Map(),
  bollingerBandwidth: new Map(),
  atr: new Map(),
  atrPercent: new Map(),
  histVol: new Map(),
  ulcerIndex: new Map(),
  // Momentum
  roc: new Map(),
  williamsR: new Map(),
  cci: new Map(),
  stochK: new Map(),
  stochD: new Map(),
  adx: new Map(),
  // Trend
  linRegSlope: new Map(),
  linRegValue: new Map(),
  priceVsSma: new Map(),
  // Performance optimization: cache close and returns arrays
  closeArrays: new Map(),
  returnsArrays: new Map(),
  // High/Low arrays cache (for indicators needing OHLC)
  highArrays: new Map(),
  lowArrays: new Map(),
  // Volume arrays cache (for volume-based indicators)
  volumeArrays: new Map(),
  mfi: new Map(),
  obv: new Map(),
  vwapRatio: new Map(),
  // FRD-021: Branch equity curves cache (for subspell support)
  // Key: nodeId, Value: { equity: Float64Array, returns: Float64Array }
  branchEquity: new Map(),
})

const getCachedSeries = (cache, kind, ticker, period, compute) => {
  const t = getSeriesKey(ticker)
  let map = cache[kind]
  if (!map) {
    // Dynamically add missing cache key (for new indicators)
    console.warn(`[getCachedSeries] cache[${kind}] missing, creating dynamically`)
    map = new Map()
    cache[kind] = map
  }
  let byTicker = map.get(t)
  if (!byTicker) {
    byTicker = new Map()
    map.set(t, byTicker)
  }
  const existing = byTicker.get(period)
  if (existing) return existing
  const next = compute()
  byTicker.set(period, next)
  return next
}

// ============================================
// PRICE DATABASE
// ============================================

// Build price database from series data
// dateIntersectionTickers: optional Set of tickers to use for date intersection
// If provided, only those tickers determine the common date range (allows longer history for indicators)
// Position tickers get null values for dates before their data starts
const buildPriceDb = (series, dateIntersectionTickers = null) => {
  if (!series.length) return { dates: [], open: {}, high: {}, low: {}, close: {}, adjClose: {}, volume: {} }

  // Build a map from ticker -> (time -> bar) for each series
  const barMaps = series.map((s) => {
    const t = getSeriesKey(s.ticker)
    const byTime = new Map()
    let validCount = 0
    for (const b of s.bars) {
      // Only include bars with valid (non-null) close prices
      if (b.close != null && Number.isFinite(b.close)) {
        byTime.set(Number(b.time), b)
        validCount++
      }
    }
    return { ticker: t, byTime }
  })

  // Find dates that have valid prices for intersection tickers only
  // This allows indicator tickers (with longer history) to determine date range
  const intersectionSet = dateIntersectionTickers ? new Set(dateIntersectionTickers.map(t => getSeriesKey(t))) : null
  const intersectionMaps = intersectionSet
    ? barMaps.filter(m => intersectionSet.has(m.ticker))
    : barMaps

  // Fallback to all tickers if no intersection tickers found

  const mapsForDates = intersectionMaps.length > 0 ? intersectionMaps : barMaps

  // Optimized date intersection using sorted arrays instead of Set operations
  // This is O(n log n) instead of O(n * m) for multiple tickers
  const sortedDateArrays = mapsForDates.map((m) =>
    Array.from(m.byTime.keys()).sort((a, b) => a - b)
  )

  let dates
  if (sortedDateArrays.length === 1) {
    dates = sortedDateArrays[0]
  } else {
    // Use the shortest array as base for faster intersection
    sortedDateArrays.sort((a, b) => a.length - b.length)
    let common = new Set(sortedDateArrays[0])

    // Intersect with remaining arrays (checking against Set is O(1))
    for (let i = 1; i < sortedDateArrays.length && common.size > 0; i++) {
      const arr = sortedDateArrays[i]
      const arrSet = new Set(arr)
      common = new Set([...common].filter(d => arrSet.has(d)))
    }

    dates = [...common].sort((a, b) => a - b)
  }

  const open = {}
  const high = {}
  const low = {}
  const close = {}
  const adjClose = {}
  const volume = {}
  for (const { ticker, byTime } of barMaps) {
    // All tickers get arrays aligned to dates, but may have null for dates before their data starts
    open[ticker] = dates.map((d) => byTime.get(d)?.open ?? null)
    high[ticker] = dates.map((d) => byTime.get(d)?.high ?? null)
    low[ticker] = dates.map((d) => byTime.get(d)?.low ?? null)
    close[ticker] = dates.map((d) => byTime.get(d)?.close ?? null)
    adjClose[ticker] = dates.map((d) => byTime.get(d)?.adjClose ?? null)
    volume[ticker] = dates.map((d) => byTime.get(d)?.volume ?? null)
  }

  return { dates, open, high, low, close, adjClose, volume }
}

// Cached version - handles ratio tickers like "SPY/XLU" by computing numerator/denominator prices
// IMPORTANT: Uses adjClose for all indicator calculations (accurate historical signals)
const getCachedCloseArray = (cache, db, ticker) => {
  const t = getSeriesKey(ticker)
  const existing = cache.closeArrays.get(t)
  if (existing) return existing

  // Check if this is a ratio ticker
  const ratio = parseRatioTicker(t)
  if (ratio) {
    // Compute ratio prices from component tickers using adjClose for indicators
    const numAdjClose = db.adjClose[ratio.numerator] || []
    const denAdjClose = db.adjClose[ratio.denominator] || []
    const len = Math.max(numAdjClose.length, denAdjClose.length)
    const arr = new Array(len).fill(NaN)
    for (let i = 0; i < len; i++) {
      const num = numAdjClose[i]
      const den = denAdjClose[i]
      if (num != null && den != null && den !== 0) {
        arr[i] = num / den
      }
    }
    cache.closeArrays.set(t, arr)
    return arr
  }

  // Regular ticker - use adjClose for indicator calculations
  const arr = (db.adjClose[t] || []).map((v) => (v == null ? NaN : v))
  cache.closeArrays.set(t, arr)
  return arr
}

// Cached returns array - avoids rebuilding for Standard Deviation calculations
const getCachedReturnsArray = (cache, db, ticker) => {
  const t = getSeriesKey(ticker)
  const existing = cache.returnsArrays.get(t)
  if (existing) return existing
  const closes = getCachedCloseArray(cache, db, t)
  const returns = new Array(closes.length).fill(NaN)
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1]
    const cur = closes[i]
    if (!Number.isNaN(prev) && !Number.isNaN(cur) && prev !== 0) {
      returns[i] = cur / prev - 1
    }
  }
  cache.returnsArrays.set(t, returns)
  return returns
}

// Cached high array for OHLC indicators
const getCachedHighArray = (cache, db, ticker) => {
  const t = getSeriesKey(ticker)
  const existing = cache.highArrays.get(t)
  if (existing) return existing
  const arr = (db.high?.[t] || []).map((v) => (v == null ? NaN : v))
  cache.highArrays.set(t, arr)
  return arr
}

// Cached low array for OHLC indicators
const getCachedLowArray = (cache, db, ticker) => {
  const t = getSeriesKey(ticker)
  const existing = cache.lowArrays.get(t)
  if (existing) return existing
  const arr = (db.low?.[t] || []).map((v) => (v == null ? NaN : v))
  cache.lowArrays.set(t, arr)
  return arr
}

// Cached volume array for volume-based indicators
const getCachedVolumeArray = (cache, db, ticker) => {
  const t = getSeriesKey(ticker)
  const existing = cache.volumeArrays.get(t)
  if (existing) return existing
  const arr = (db.volume?.[t] || []).map((v) => (v == null ? NaN : v))
  cache.volumeArrays.set(t, arr)
  return arr
}

// ============================================
// VOLUME-BASED INDICATORS
// ============================================

// Money Flow Index (MFI) - like RSI but weighted by volume
// Measures buying/selling pressure with volume confirmation
const rollingMfi = (highs, lows, closes, volumes, window) => {
  const n = closes.length
  const result = new Array(n).fill(NaN)

  // Calculate typical price for each bar
  const typicalPrices = new Array(n)
  for (let i = 0; i < n; i++) {
    typicalPrices[i] = (highs[i] + lows[i] + closes[i]) / 3
  }

  // Calculate raw money flow
  const rawMoneyFlow = new Array(n)
  for (let i = 0; i < n; i++) {
    rawMoneyFlow[i] = typicalPrices[i] * volumes[i]
  }

  // Calculate MFI for each window
  for (let i = window; i < n; i++) {
    let positiveFlow = 0
    let negativeFlow = 0

    for (let j = i - window + 1; j <= i; j++) {
      if (typicalPrices[j] > typicalPrices[j - 1]) {
        positiveFlow += rawMoneyFlow[j]
      } else if (typicalPrices[j] < typicalPrices[j - 1]) {
        negativeFlow += rawMoneyFlow[j]
      }
    }

    if (negativeFlow === 0) {
      result[i] = 100
    } else {
      const moneyRatio = positiveFlow / negativeFlow
      result[i] = 100 - (100 / (1 + moneyRatio))
    }
  }

  return result
}

// On-Balance Volume Rate of Change - momentum of cumulative volume
// Positive when price up, negative when price down
const rollingObvRoc = (closes, volumes, window) => {
  const n = closes.length
  const result = new Array(n).fill(NaN)

  // Build cumulative OBV
  const obv = new Array(n)
  obv[0] = 0
  for (let i = 1; i < n; i++) {
    if (closes[i] > closes[i - 1]) {
      obv[i] = obv[i - 1] + volumes[i]
    } else if (closes[i] < closes[i - 1]) {
      obv[i] = obv[i - 1] - volumes[i]
    } else {
      obv[i] = obv[i - 1]
    }
  }

  // Calculate ROC of OBV
  for (let i = window; i < n; i++) {
    const prev = obv[i - window]
    if (prev !== 0) {
      result[i] = ((obv[i] - prev) / Math.abs(prev)) * 100
    }
  }

  return result
}

// Volume-Weighted Average Price Ratio
// Current price vs VWAP for the window period (as percentage)
const rollingVwapRatio = (closes, volumes, window) => {
  const n = closes.length
  const result = new Array(n).fill(NaN)

  for (let i = window - 1; i < n; i++) {
    let sumPV = 0  // price * volume
    let sumV = 0   // volume

    for (let j = i - window + 1; j <= i; j++) {
      sumPV += closes[j] * volumes[j]
      sumV += volumes[j]
    }

    if (sumV > 0) {
      const vwap = sumPV / sumV
      // Return percentage of price vs VWAP (100 = at VWAP)
      result[i] = (closes[i] / vwap) * 100
    }
  }

  return result
}

// ============================================
// FRD-035: CUSTOM INDICATOR FORMULA PARSER & EVALUATOR
// ============================================

// Simple recursive descent parser for custom indicator formulas
// Supports: +, -, *, /, %, parentheses, numbers, variables, functions

const MATH_FUNCS = ['abs', 'sqrt', 'log', 'log10', 'exp', 'sign', 'floor', 'ceil', 'round']
const BINARY_FUNCS = ['min', 'max', 'pow']
const ROLLING_FUNCS = ['sma', 'ema', 'stdev', 'rmax', 'rmin', 'roc']

function tokenizeFormula(input) {
  const tokens = []
  let pos = 0
  const str = input.trim()

  while (pos < str.length) {
    // Skip whitespace
    while (pos < str.length && /\s/.test(str[pos])) pos++
    if (pos >= str.length) break

    const ch = str[pos]

    // Number
    if (/[0-9.]/.test(ch)) {
      let num = ''
      while (pos < str.length && /[0-9.]/.test(str[pos])) {
        num += str[pos++]
      }
      tokens.push({ type: 'NUMBER', value: num })
      continue
    }

    // Identifier (variable or function)
    if (/[a-zA-Z_]/.test(ch)) {
      let id = ''
      while (pos < str.length && /[a-zA-Z0-9_]/.test(str[pos])) {
        id += str[pos++]
      }
      tokens.push({ type: 'IDENTIFIER', value: id.toLowerCase() })
      continue
    }

    // Operators and parens
    if ('+-*/%()'.includes(ch)) {
      tokens.push({ type: ch === '(' ? 'LPAREN' : ch === ')' ? 'RPAREN' : 'OPERATOR', value: ch })
      pos++
      continue
    }

    // Comma
    if (ch === ',') {
      tokens.push({ type: 'COMMA', value: ch })
      pos++
      continue
    }

    throw new Error(`Unexpected char '${ch}' in formula`)
  }

  tokens.push({ type: 'EOF', value: '' })
  return tokens
}

function parseFormula(formula) {
  const tokens = tokenizeFormula(formula)
  let idx = 0

  const current = () => tokens[idx] || { type: 'EOF', value: '' }
  const advance = () => tokens[idx++] || { type: 'EOF', value: '' }

  function parseExpr() {
    let left = parseTerm()
    while (current().type === 'OPERATOR' && (current().value === '+' || current().value === '-')) {
      const op = advance().value
      const right = parseTerm()
      left = { type: 'BinaryOp', operator: op, left, right }
    }
    return left
  }

  function parseTerm() {
    let left = parseFactor()
    while (current().type === 'OPERATOR' && '*/%'.includes(current().value)) {
      const op = advance().value
      const right = parseFactor()
      left = { type: 'BinaryOp', operator: op, left, right }
    }
    return left
  }

  function parseFactor() {
    if (current().type === 'OPERATOR' && current().value === '-') {
      advance()
      const operand = parseFactor()
      return { type: 'UnaryOp', operator: '-', operand }
    }
    return parsePrimary()
  }

  function parsePrimary() {
    const tok = current()

    if (tok.type === 'NUMBER') {
      advance()
      return { type: 'Number', value: parseFloat(tok.value) }
    }

    if (tok.type === 'IDENTIFIER') {
      const name = advance().value
      if (current().type === 'LPAREN') {
        advance() // consume '('
        const args = []
        if (current().type !== 'RPAREN') {
          args.push(parseExpr())
          while (current().type === 'COMMA') {
            advance()
            args.push(parseExpr())
          }
        }
        if (current().type !== 'RPAREN') throw new Error('Expected )')
        advance()
        return { type: 'FunctionCall', name, args }
      }
      return { type: 'Variable', name }
    }

    if (tok.type === 'LPAREN') {
      advance()
      const expr = parseExpr()
      if (current().type !== 'RPAREN') throw new Error('Expected )')
      advance()
      return expr
    }

    throw new Error(`Unexpected token: ${tok.value}`)
  }

  return parseExpr()
}

// Evaluate AST with a context that can resolve variables
function evaluateFormulaAST(node, getVar, getSeries, defaultWindow = 20) {
  switch (node.type) {
    case 'Number':
      return node.value

    case 'Variable':
      return getVar(node.name, defaultWindow)

    case 'BinaryOp': {
      const left = evaluateFormulaAST(node.left, getVar, getSeries, defaultWindow)
      const right = evaluateFormulaAST(node.right, getVar, getSeries, defaultWindow)
      if (left == null || right == null) return null
      switch (node.operator) {
        case '+': return left + right
        case '-': return left - right
        case '*': return left * right
        case '/': return right !== 0 ? left / right : null
        case '%': return right !== 0 ? left % right : null
        default: return null
      }
    }

    case 'UnaryOp':
      const operand = evaluateFormulaAST(node.operand, getVar, getSeries, defaultWindow)
      return operand != null ? -operand : null

    case 'FunctionCall':
      return evaluateFunctionCall(node, getVar, getSeries, defaultWindow)

    default:
      return null
  }
}

function evaluateFunctionCall(node, getVar, getSeries, defaultWindow) {
  const { name, args } = node

  // Math functions (single argument)
  if (MATH_FUNCS.includes(name)) {
    if (args.length !== 1) return null
    const arg = evaluateFormulaAST(args[0], getVar, getSeries, defaultWindow)
    if (arg == null) return null
    switch (name) {
      case 'abs': return Math.abs(arg)
      case 'sqrt': return arg >= 0 ? Math.sqrt(arg) : null
      case 'log': return arg > 0 ? Math.log(arg) : null
      case 'log10': return arg > 0 ? Math.log10(arg) : null
      case 'exp': return Math.exp(arg)
      case 'sign': return Math.sign(arg)
      case 'floor': return Math.floor(arg)
      case 'ceil': return Math.ceil(arg)
      case 'round': return Math.round(arg)
      default: return null
    }
  }

  // Binary functions (two arguments)
  if (BINARY_FUNCS.includes(name)) {
    if (args.length !== 2) return null
    const a = evaluateFormulaAST(args[0], getVar, getSeries, defaultWindow)
    const b = evaluateFormulaAST(args[1], getVar, getSeries, defaultWindow)
    if (a == null || b == null) return null
    switch (name) {
      case 'min': return Math.min(a, b)
      case 'max': return Math.max(a, b)
      case 'pow': return Math.pow(a, b)
      default: return null
    }
  }

  // Rolling functions (variable + window)
  if (ROLLING_FUNCS.includes(name)) {
    if (args.length !== 2) return null
    if (args[1].type !== 'Number') return null
    const window = Math.ceil(args[1].value)
    if (args[0].type !== 'Variable') return null // Only simple variables for now
    const varName = args[0].name
    const series = getSeries(varName, defaultWindow, window + 50)
    if (!series || series.length < window) return null

    switch (name) {
      case 'sma': {
        const slice = series.slice(-window)
        return slice.reduce((a, b) => a + b, 0) / window
      }
      case 'ema': {
        const alpha = 2 / (window + 1)
        let ema = series[0]
        for (let i = 1; i < series.length; i++) {
          ema = alpha * series[i] + (1 - alpha) * ema
        }
        return ema
      }
      case 'stdev': {
        const slice = series.slice(-window)
        const mean = slice.reduce((a, b) => a + b, 0) / window
        const variance = slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / window
        return Math.sqrt(variance)
      }
      case 'rmax': return Math.max(...series.slice(-window))
      case 'rmin': return Math.min(...series.slice(-window))
      case 'roc': {
        if (series.length < window + 1) return null
        const current = series[series.length - 1]
        const previous = series[series.length - 1 - window]
        return previous !== 0 ? ((current - previous) / previous) * 100 : null
      }
      default: return null
    }
  }

  return null
}

// Cache for parsed formulas
const formulaASTCache = new Map()

function getParsedFormula(formula) {
  if (formulaASTCache.has(formula)) {
    return formulaASTCache.get(formula)
  }
  try {
    const ast = parseFormula(formula)
    formulaASTCache.set(formula, ast)
    return ast
  } catch (e) {
    console.error(`[CustomIndicator] Failed to parse formula "${formula}":`, e.message)
    return null
  }
}

// ============================================
// METRIC CALCULATION
// ============================================

const metricAt = (ctx, ticker, metric, window, parentNode = null) => {
  // DEBUG: Log when branch:from is being calculated
  if (ticker && ticker.toLowerCase().includes('branch:')) {
    console.log(`[BRANCH CALC] metricAt called with ticker="${ticker}", metric="${metric}", window=${window}, parentNode=${parentNode?.id ?? 'NULL'}`)
  }

  // FRD-021: Handle branch references (e.g., 'branch:from')
  if (isBranchRef(ticker)) {
    const branchName = parseBranchRef(ticker)

    // UNCONDITIONAL DEBUG - first 3 bars only to avoid log spam
    if (ctx.decisionIndex < 3) {
      console.log(`[BRANCH INSIDE] decisionIndex=${ctx.decisionIndex}, branchName="${branchName}", parentNode=${parentNode?.id ?? 'NULL'}`)
    }

    // DEBUG: Log branch resolution details for first few dates
    const DEBUG_BRANCH = ctx.decisionIndex < 5
    if (DEBUG_BRANCH) {
      console.log(`[metricAt DEBUG] ticker: "${ticker}", branchName: "${branchName}"`)
      console.log(`[metricAt DEBUG] parentNode provided: ${!!parentNode}, id: ${parentNode?.id ?? 'none'}`)
      console.log(`[metricAt DEBUG] ctx.branchParentNode: ${!!ctx.branchParentNode}`)
    }

    const branchNode = getBranchChildNode(parentNode || ctx.branchParentNode, branchName, DEBUG_BRANCH)

    if (DEBUG_BRANCH) {
      console.log(`[metricAt DEBUG] getBranchChildNode returned: ${branchNode ? `node id=${branchNode.id}, kind=${branchNode.kind}` : 'NULL'}`)
    }

    if (!branchNode) {
      // Branch not found - return null (indicator will fail gracefully)
      if (DEBUG_BRANCH) {
        console.log(`[metricAt DEBUG] Branch not found, returning null`)
      }
      return null
    }
    const branchEquity = getBranchEquity(ctx, branchNode)

    if (DEBUG_BRANCH) {
      console.log(`[metricAt DEBUG] branchEquity: ${branchEquity ? `equity array length=${branchEquity.equity?.length}` : 'NULL'}`)
    }

    if (!branchEquity) return null
    const result = branchMetricAt(ctx, branchEquity, metric, window, ctx.indicatorIndex)

    if (DEBUG_BRANCH) {
      console.log(`[metricAt DEBUG] branchMetricAt result: ${result?.toFixed(6) ?? 'NULL'}`)
    }

    // DEBUG: Print branch:from value for EVERY day
    console.log(`[BRANCH VALUE] day=${ctx.decisionIndex}, date=${ctx.db.dates[ctx.decisionIndex]}, ticker="${ticker}", metric="${metric}", window=${window}, value=${result}`)

    return result
  }

  // FRD-035: Handle custom indicators (metric = 'custom:ci_xxxxx')
  if (metric && metric.startsWith('custom:')) {
    const customId = metric // e.g., 'custom:ci_abc123'
    const customIndicator = ctx.customIndicators?.find(ci => `custom:${ci.id}` === customId)

    if (!customIndicator) {
      console.warn(`[CustomIndicator] Unknown custom indicator: ${customId}`)
      return null
    }

    // Parse the formula (cached)
    const ast = getParsedFormula(customIndicator.formula)
    if (!ast) return null

    // Get series key for the ticker
    const t = getSeriesKey(ticker)
    if (!t || t === 'Empty') return null

    const i = ctx.indicatorIndex
    if (i < 0) return null

    // Create getVar function that maps variable names to built-in indicators
    const getVar = (varName, defaultWindow) => {
      // Map variable names to built-in metrics
      const varToMetric = {
        'close': 'Current Price',
        'open': 'Current Price', // Will be handled specially
        'high': 'Current Price', // Will be handled specially
        'low': 'Current Price', // Will be handled specially
        'volume': 'Volume',
        'sma': 'Simple Moving Average',
        'ema': 'Exponential Moving Average',
        'rsi': 'Relative Strength Index',
        'stdev': 'Standard Deviation',
        'maxdd': 'Max Drawdown',
        'drawdown': 'Drawdown',
        'cumret': 'Cumulative Return',
        'atr': 'ATR',
        'atr_pct': 'ATR %',
        'roc': 'Rate of Change',
        'macd_hist': 'MACD Histogram',
        'bbpctb': 'Bollinger %B',
        'bbwidth': 'Bollinger Bandwidth',
        'aroon_up': 'Aroon Up',
        'aroon_down': 'Aroon Down',
        'aroon_osc': 'Aroon Oscillator',
        'momentum_w': '13612W Momentum',
        'momentum_u': '13612U Momentum',
        'stochk': 'Stochastic %K',
        'stochd': 'Stochastic %D',
        'willr': 'Williams %R',
        'adx': 'ADX',
        'hvol': 'Historical Volatility',
        'ulcer': 'Ulcer Index',
        'r2': 'Trend Clarity',
        'hma': 'Hull Moving Average',
        'kama': 'KAMA',
        'mfi': 'Money Flow Index',
      }

      // Handle price variables specially
      if (varName === 'close') {
        const closes = getCachedCloseArray(ctx.cache, ctx.db, t)
        return closes[i] ?? null
      }
      if (varName === 'open') {
        const opens = ctx.db.open?.[t]
        return opens?.[i] ?? null
      }
      if (varName === 'high') {
        const highs = ctx.db.high?.[t]
        return highs?.[i] ?? null
      }
      if (varName === 'low') {
        const lows = ctx.db.low?.[t]
        return lows?.[i] ?? null
      }
      if (varName === 'volume') {
        const vols = ctx.db.volume?.[t]
        return vols?.[i] ?? null
      }

      // Map to built-in metric
      const metricName = varToMetric[varName]
      if (metricName) {
        // Use the window from the condition (passed as the outer window)
        return metricAt(ctx, ticker, metricName, window, parentNode)
      }

      console.warn(`[CustomIndicator] Unknown variable in formula: ${varName}`)
      return null
    }

    // Create getSeries function for rolling calculations
    const getSeries = (varName, defaultWindow, length) => {
      // Get historical values for rolling functions
      if (varName === 'close') {
        const closes = getCachedCloseArray(ctx.cache, ctx.db, t)
        const startIdx = Math.max(0, i - length + 1)
        return Array.from(closes.slice(startIdx, i + 1))
      }
      if (varName === 'open') {
        const opens = ctx.db.open?.[t]
        if (!opens) return null
        const startIdx = Math.max(0, i - length + 1)
        return Array.from({ length: i + 1 - startIdx }, (_, j) => opens[startIdx + j])
      }
      // Add more as needed...
      return null
    }

    // Evaluate the formula
    const result = evaluateFormulaAST(ast, getVar, getSeries, window)
    return result
  }

  const t = getSeriesKey(ticker)
  if (!t || t === 'Empty') return null

  if (metric === 'Current Price') {
    // For CC/CO modes (decisionPrice='close'), use adjClose to match indicator calculations
    // For OO/OC modes (decisionPrice='open'), use open price
    const arr = ctx.decisionPrice === 'open' ? ctx.db.open[t] : (ctx.db.adjClose[t] || ctx.db.close[t])
    const v = arr?.[ctx.decisionIndex]
    return v == null ? null : v
  }

  const i = ctx.indicatorIndex
  if (i < 0) return null
  // Use cached close array to avoid rebuilding on every call
  const closes = getCachedCloseArray(ctx.cache, ctx.db, t)
  const w = Math.max(1, Math.floor(Number(window || 0)))

  switch (metric) {
    case 'Simple Moving Average': {
      const series = getCachedSeries(ctx.cache, 'sma', t, w, () => rollingSma(closes, w))
      return series[i] ?? null
    }
    case 'Exponential Moving Average': {
      const series = getCachedSeries(ctx.cache, 'ema', t, w, () => rollingEma(closes, w))
      return series[i] ?? null
    }
    case 'Relative Strength Index': {
      const series = getCachedSeries(ctx.cache, 'rsi', t, w, () => rollingWilderRsi(closes, w))
      return series[i] ?? null
    }
    case 'Standard Deviation': {
      // Use cached returns array to avoid rebuilding on every call
      const rets = getCachedReturnsArray(ctx.cache, ctx.db, t)
      const series = getCachedSeries(ctx.cache, 'std', t, w, () => rollingStdDev(rets, w))
      return series[i] ?? null
    }
    case 'Max Drawdown': {
      const series = getCachedSeries(ctx.cache, 'maxdd', t, w, () => rollingMaxDrawdown(closes, w))
      return series[i] ?? null
    }
    case 'Standard Deviation of Price': {
      const series = getCachedSeries(ctx.cache, 'stdPrice', t, w, () => rollingStdDevOfPrices(closes, w))
      return series[i] ?? null
    }
    case 'Cumulative Return': {
      const series = getCachedSeries(ctx.cache, 'cumRet', t, w, () => rollingCumulativeReturn(closes, w))
      return series[i] ?? null
    }
    case 'SMA of Returns': {
      const series = getCachedSeries(ctx.cache, 'smaRet', t, w, () => rollingSmaOfReturns(closes, w))
      return series[i] ?? null
    }
    // Momentum indicators (no window - fixed lookbacks)
    // Support both Atlas names and QM import names
    case 'Momentum (Weighted)':
    case '13612W Momentum': {
      const series = getCachedSeries(ctx.cache, 'mom13612w', t, 0, () => rolling13612W(closes))
      return series[i] ?? null
    }
    case 'Momentum (Unweighted)':
    case '13612U Momentum': {
      const series = getCachedSeries(ctx.cache, 'mom13612u', t, 0, () => rolling13612U(closes))
      return series[i] ?? null
    }
    case 'Momentum (12-Month SMA)':
    case 'SMA12 Momentum': {
      const series = getCachedSeries(ctx.cache, 'momsma12', t, 0, () => rollingSMA12Momentum(closes))
      return series[i] ?? null
    }
    // Drawdown from ATH (no window)
    case 'Drawdown': {
      const series = getCachedSeries(ctx.cache, 'drawdown', t, 0, () => rollingDrawdown(closes))
      return series[i] ?? null
    }
    // Aroon indicators (need high/low prices)
    case 'Aroon Up': {
      const highs = ctx.db.high?.[t]
      if (!highs) return null
      const series = getCachedSeries(ctx.cache, 'aroonUp', t, w, () => rollingAroonUp(highs, w))
      return series[i] ?? null
    }
    case 'Aroon Down': {
      const lows = ctx.db.low?.[t]
      if (!lows) return null
      const series = getCachedSeries(ctx.cache, 'aroonDown', t, w, () => rollingAroonDown(lows, w))
      return series[i] ?? null
    }
    case 'Aroon Oscillator': {
      const highs = ctx.db.high?.[t]
      const lows = ctx.db.low?.[t]
      if (!highs || !lows) return null
      const series = getCachedSeries(ctx.cache, 'aroonOsc', t, w, () => rollingAroonOscillator(highs, lows, w))
      return series[i] ?? null
    }
    // MACD & PPO (fixed 12/26/9 periods)
    case 'MACD Histogram': {
      const series = getCachedSeries(ctx.cache, 'macd', t, 0, () => rollingMACD(closes))
      return series[i] ?? null
    }
    case 'PPO Histogram': {
      const series = getCachedSeries(ctx.cache, 'ppo', t, 0, () => rollingPPO(closes))
      return series[i] ?? null
    }
    // Trend Clarity (R²)
    case 'Trend Clarity': {
      const series = getCachedSeries(ctx.cache, 'trendClarity', t, w, () => rollingTrendClarity(closes, w))
      return series[i] ?? null
    }
    // Ultimate Smoother
    case 'Ultimate Smoother': {
      const series = getCachedSeries(ctx.cache, 'ultSmooth', t, w, () => rollingUltimateSmoother(closes, w))
      return series[i] ?? null
    }
    // ============================================
    // NEW MOVING AVERAGES
    // ============================================
    case 'Hull Moving Average': {
      const series = getCachedSeries(ctx.cache, 'hma', t, w, () => rollingHma(closes, w))
      return series[i] ?? null
    }
    case 'Weighted Moving Average': {
      const series = getCachedSeries(ctx.cache, 'wma', t, w, () => rollingWma(closes, w))
      return series[i] ?? null
    }
    case 'Wilder Moving Average': {
      const series = getCachedSeries(ctx.cache, 'wildersMa', t, w, () => rollingWildersMa(closes, w))
      return series[i] ?? null
    }
    case 'DEMA': {
      const series = getCachedSeries(ctx.cache, 'dema', t, w, () => rollingDema(closes, w))
      return series[i] ?? null
    }
    case 'TEMA': {
      const series = getCachedSeries(ctx.cache, 'tema', t, w, () => rollingTema(closes, w))
      return series[i] ?? null
    }
    case 'KAMA': {
      const series = getCachedSeries(ctx.cache, 'kama', t, w, () => rollingKama(closes, w))
      return series[i] ?? null
    }
    // ============================================
    // RSI VARIANTS
    // ============================================
    case 'RSI (SMA)': {
      const series = getCachedSeries(ctx.cache, 'rsiSma', t, w, () => rollingRsiSma(closes, w))
      return series[i] ?? null
    }
    case 'RSI (EMA)': {
      const series = getCachedSeries(ctx.cache, 'rsiEma', t, w, () => rollingRsiEma(closes, w))
      return series[i] ?? null
    }
    case 'Stochastic RSI': {
      const series = getCachedSeries(ctx.cache, 'stochRsi', t, w, () => rollingStochRsi(closes, w, w))
      return series[i] ?? null
    }
    case 'Laguerre RSI': {
      const series = getCachedSeries(ctx.cache, 'laguerreRsi', t, 0, () => rollingLaguerreRsi(closes))
      return series[i] ?? null
    }
    // ============================================
    // VOLATILITY INDICATORS
    // ============================================
    case 'Bollinger %B': {
      const series = getCachedSeries(ctx.cache, 'bollingerB', t, w, () => rollingBollingerB(closes, w))
      return series[i] ?? null
    }
    case 'Bollinger Bandwidth': {
      const series = getCachedSeries(ctx.cache, 'bollingerBandwidth', t, w, () => rollingBollingerBandwidth(closes, w))
      return series[i] ?? null
    }
    case 'ATR': {
      const highs = getCachedHighArray(ctx.cache, ctx.db, t)
      const lows = getCachedLowArray(ctx.cache, ctx.db, t)
      if (!highs.length || !lows.length) return null
      const series = getCachedSeries(ctx.cache, 'atr', t, w, () => rollingAtr(highs, lows, closes, w))
      return series[i] ?? null
    }
    case 'ATR %': {
      const highs = getCachedHighArray(ctx.cache, ctx.db, t)
      const lows = getCachedLowArray(ctx.cache, ctx.db, t)
      if (!highs.length || !lows.length) return null
      const series = getCachedSeries(ctx.cache, 'atrPercent', t, w, () => rollingAtrPercent(highs, lows, closes, w))
      return series[i] ?? null
    }
    case 'Historical Volatility': {
      const series = getCachedSeries(ctx.cache, 'histVol', t, w, () => rollingHistoricalVolatility(closes, w))
      return series[i] ?? null
    }
    case 'Ulcer Index': {
      const series = getCachedSeries(ctx.cache, 'ulcerIndex', t, w, () => rollingUlcerIndex(closes, w))
      return series[i] ?? null
    }
    // ============================================
    // MOMENTUM INDICATORS
    // ============================================
    case 'Rate of Change': {
      const series = getCachedSeries(ctx.cache, 'roc', t, w, () => rollingRoc(closes, w))
      return series[i] ?? null
    }
    case 'Williams %R': {
      const highs = getCachedHighArray(ctx.cache, ctx.db, t)
      const lows = getCachedLowArray(ctx.cache, ctx.db, t)
      if (!highs.length || !lows.length) return null
      const series = getCachedSeries(ctx.cache, 'williamsR', t, w, () => rollingWilliamsR(highs, lows, closes, w))
      return series[i] ?? null
    }
    case 'CCI': {
      const highs = getCachedHighArray(ctx.cache, ctx.db, t)
      const lows = getCachedLowArray(ctx.cache, ctx.db, t)
      if (!highs.length || !lows.length) return null
      const series = getCachedSeries(ctx.cache, 'cci', t, w, () => rollingCci(highs, lows, closes, w))
      return series[i] ?? null
    }
    case 'Stochastic %K': {
      const highs = getCachedHighArray(ctx.cache, ctx.db, t)
      const lows = getCachedLowArray(ctx.cache, ctx.db, t)
      if (!highs.length || !lows.length) return null
      const series = getCachedSeries(ctx.cache, 'stochK', t, w, () => rollingStochK(highs, lows, closes, w))
      return series[i] ?? null
    }
    case 'Stochastic %D': {
      const highs = getCachedHighArray(ctx.cache, ctx.db, t)
      const lows = getCachedLowArray(ctx.cache, ctx.db, t)
      if (!highs.length || !lows.length) return null
      const series = getCachedSeries(ctx.cache, 'stochD', t, w, () => rollingStochD(highs, lows, closes, w))
      return series[i] ?? null
    }
    case 'ADX': {
      const highs = getCachedHighArray(ctx.cache, ctx.db, t)
      const lows = getCachedLowArray(ctx.cache, ctx.db, t)
      if (!highs.length || !lows.length) return null
      const series = getCachedSeries(ctx.cache, 'adx', t, w, () => rollingAdx(highs, lows, closes, w))
      return series[i] ?? null
    }
    // ============================================
    // TREND INDICATORS
    // ============================================
    case 'Linear Reg Slope': {
      const series = getCachedSeries(ctx.cache, 'linRegSlope', t, w, () => rollingLinRegSlope(closes, w))
      return series[i] ?? null
    }
    case 'Linear Reg Value': {
      const series = getCachedSeries(ctx.cache, 'linRegValue', t, w, () => rollingLinRegValue(closes, w))
      return series[i] ?? null
    }
    case 'Price vs SMA': {
      const series = getCachedSeries(ctx.cache, 'priceVsSma', t, w, () => rollingPriceVsSma(closes, w))
      return series[i] ?? null
    }
    // ============================================
    // VOLUME-BASED INDICATORS
    // ============================================
    case 'Money Flow Index': {
      const highs = getCachedHighArray(ctx.cache, ctx.db, t)
      const lows = getCachedLowArray(ctx.cache, ctx.db, t)
      const volumes = getCachedVolumeArray(ctx.cache, ctx.db, t)
      if (!highs.length || !lows.length || !volumes.length) return null
      const series = getCachedSeries(ctx.cache, 'mfi', t, w, () => rollingMfi(highs, lows, closes, volumes, w))
      return series[i] ?? null
    }
    case 'OBV Rate of Change': {
      const volumes = getCachedVolumeArray(ctx.cache, ctx.db, t)
      if (!volumes.length) return null
      const series = getCachedSeries(ctx.cache, 'obv', t, w, () => rollingObvRoc(closes, volumes, w))
      return series[i] ?? null
    }
    case 'VWAP Ratio': {
      const volumes = getCachedVolumeArray(ctx.cache, ctx.db, t)
      if (!volumes.length) return null
      const series = getCachedSeries(ctx.cache, 'vwapRatio', t, w, () => rollingVwapRatio(closes, volumes, w))
      return series[i] ?? null
    }
  }
  return null
}

// ============================================
// FRD-021: BRANCH EQUITY SIMULATION (Subspell Support)
// ============================================

// Find a node by ID in the tree (for resolving branch references in indicator overlays)
const findNodeById = (root, nodeId) => {
  if (!root || !nodeId) return null
  if (root.id === nodeId) return root

  // Check all children slots
  if (root.children) {
    for (const slot of Object.keys(root.children)) {
      const children = root.children[slot]
      if (Array.isArray(children)) {
        for (const child of children) {
          if (child) {
            const found = findNodeById(child, nodeId)
            if (found) return found
          }
        }
      }
    }
  }
  return null
}

// Check if a ticker reference is a branch reference (e.g., 'branch:from' or 'BRANCH:FROM')
const isBranchRef = (ticker) => {
  return typeof ticker === 'string' && ticker.toUpperCase().startsWith('BRANCH:')
}

// Parse branch reference to get branch name ('branch:from' -> 'from', 'BRANCH:FROM' -> 'from')
const parseBranchRef = (ticker) => {
  if (!isBranchRef(ticker)) return null
  return ticker.slice(7).toLowerCase() // Remove 'branch:' or 'BRANCH:' prefix, normalize to lowercase
}

// Get the child node for a branch reference from the parent node
// branchName: 'from', 'to', 'then', 'else', 'enter', 'exit'
const getBranchChildNode = (parentNode, branchName, debug = false) => {
  if (debug) {
    console.log(`[getBranchChildNode DEBUG] parentNode: ${parentNode ? `id=${parentNode.id}, kind=${parentNode.kind}` : 'NULL'}`)
    console.log(`[getBranchChildNode DEBUG] branchName: "${branchName}"`)
  }

  if (!parentNode || !branchName) {
    if (debug) console.log(`[getBranchChildNode DEBUG] Early return null - missing parentNode or branchName`)
    return null
  }

  // Map branch names to slot names
  const slotMap = {
    'from': 'then',   // Scaling: from_incantation maps to 'then' slot
    'to': 'else',     // Scaling: to_incantation maps to 'else' slot
    'then': 'then',   // Indicator: then_incantation
    'else': 'else',   // Indicator: else_incantation
    'enter': 'then',  // AltExit: entry maps to 'then' slot
    'exit': 'else',   // AltExit: exit maps to 'else' slot
  }

  const slotName = slotMap[branchName]
  if (debug) {
    console.log(`[getBranchChildNode DEBUG] slotName for "${branchName}": ${slotName ?? 'NOT FOUND'}`)
  }
  if (!slotName) return null

  const children = parentNode.children?.[slotName]
  if (debug) {
    console.log(`[getBranchChildNode DEBUG] parentNode.children keys: ${parentNode.children ? Object.keys(parentNode.children).join(', ') : 'no children'}`)
    console.log(`[getBranchChildNode DEBUG] children[${slotName}]: ${children ? `array length=${children.length}` : 'NULL/undefined'}`)
    if (children?.[0]) {
      console.log(`[getBranchChildNode DEBUG] children[0]: id=${children[0].id}, kind=${children[0].kind}`)
    }
  }

  if (!Array.isArray(children) || children.length === 0) return null

  return children[0] // Return first child in the slot
}

// Simulate a branch's equity curve starting at $1
// Returns { equity: Float64Array, returns: Float64Array } aligned with db.dates
// NOTE: Using regular function declaration for hoisting (called from metricAt before evaluateNode is defined)
function simulateBranchEquity(ctx, branchNode) {
  if (!branchNode) return null

  const numDates = ctx.db.dates.length
  const equity = new Float64Array(numDates)
  const returns = new Float64Array(numDates)

  // Start with $1 equity
  let currentEquity = 1.0

  // Use same lookback as main evaluation
  const lookback = Math.max(50, collectMaxLookback(branchNode))
  const startIndex = ctx.decisionPrice === 'open' ? (lookback > 0 ? lookback + 1 : 0) : lookback

  // Fill initial values with NaN (not 0) so rolling calculations skip them
  for (let i = 0; i < startIndex && i < numDates; i++) {
    equity[i] = 1.0
    returns[i] = NaN
  }

  // Create persistent state for altExit nodes across all days in this simulation
  const altExitState = {}

  // Simulate daily returns
  for (let i = startIndex; i < numDates; i++) {
    const indicatorIndex = ctx.decisionPrice === 'open' ? i - 1 : i

    // Create a sub-context for evaluating the branch
    // Important: We don't include branchParentNode to avoid infinite recursion
    const subCtx = {
      db: ctx.db,
      cache: ctx.cache,
      decisionIndex: i,
      indicatorIndex,
      decisionPrice: ctx.decisionPrice,
      warnings: [],
      tickerLocations: ctx.tickerLocations,
      altExitState, // Persist Enter/Exit state across days
      // Note: No branchParentNode - subspells are evaluated independently
    }

    // Get allocation for this day
    const allocation = evaluateNode(subCtx, branchNode)

    // Calculate portfolio return for this day
    let portfolioReturn = 0
    let hasValidReturn = false
    for (const [ticker, weight] of Object.entries(allocation)) {
      const t = getSeriesKey(ticker)
      if (!t || t === 'Empty' || weight === 0) continue

      // Get daily return using close prices (subspells always use CC pricing)
      const closes = ctx.db.close[t]
      if (!closes || i === 0) continue

      const prevClose = closes[i - 1]
      const currClose = closes[i]
      if (prevClose == null || currClose == null || prevClose === 0) continue

      const tickerReturn = (currClose - prevClose) / prevClose
      portfolioReturn += tickerReturn * weight
      hasValidReturn = true
    }

    // Use 0 if no valid returns (holding cash/Empty positions)
    returns[i] = hasValidReturn ? portfolioReturn : 0
    currentEquity *= (1 + portfolioReturn)
    equity[i] = currentEquity
  }

  return { equity, returns }
}

// Get or compute cached branch equity curve
const getBranchEquity = (ctx, branchNode) => {
  if (!branchNode || !branchNode.id) return null

  // Check cache first
  const cached = ctx.cache.branchEquity.get(branchNode.id)
  if (cached) return cached

  // Simulate and cache
  const result = simulateBranchEquity(ctx, branchNode)
  if (result) {
    ctx.cache.branchEquity.set(branchNode.id, result)
  }
  return result
}

// Compute metric on branch equity curve
const branchMetricAt = (ctx, branchEquity, metric, window, index) => {
  if (!branchEquity || index < 0) return null

  const { equity, returns } = branchEquity
  const w = Math.max(1, Math.floor(Number(window || 0)))

  // For Current Price, return the equity value
  if (metric === 'Current Price') {
    return equity[index] ?? null
  }

  // Create a cache key for branch-based indicators
  // We'll use the branchEquity object reference as part of caching
  switch (metric) {
    case 'Simple Moving Average': {
      const series = rollingSma(Array.from(equity), w)
      return series[index] ?? null
    }
    case 'Exponential Moving Average': {
      const series = rollingEma(Array.from(equity), w)
      return series[index] ?? null
    }
    case 'Relative Strength Index': {
      const series = rollingWilderRsi(Array.from(equity), w)
      return series[index] ?? null
    }
    case 'Standard Deviation': {
      // Volatility uses returns, not equity
      const series = rollingStdDev(Array.from(returns), w)
      return series[index] ?? null
    }
    case 'Max Drawdown': {
      const series = rollingMaxDrawdown(Array.from(equity), w)
      return series[index] ?? null
    }
    case 'Cumulative Return': {
      const series = rollingCumulativeReturn(Array.from(equity), w)
      return series[index] ?? null
    }
    case 'Drawdown': {
      const series = rollingDrawdown(Array.from(equity))
      return series[index] ?? null
    }
    case 'SMA of Returns': {
      const series = rollingSmaOfReturns(Array.from(equity), w)
      return series[index] ?? null
    }
    // Momentum indicators
    case 'Momentum (Weighted)':
    case '13612W Momentum': {
      const series = rolling13612W(Array.from(equity))
      return series[index] ?? null
    }
    case 'Momentum (Unweighted)':
    case '13612U Momentum': {
      const series = rolling13612U(Array.from(equity))
      return series[index] ?? null
    }
    case 'Momentum (12-Month SMA)':
    case 'SMA12 Momentum': {
      const series = rollingSMA12Momentum(Array.from(equity))
      return series[index] ?? null
    }
    // Rate of change
    case 'Rate of Change': {
      const series = rollingRoc(Array.from(equity), w)
      return series[index] ?? null
    }
    // Moving averages
    case 'Hull Moving Average': {
      const series = rollingHma(Array.from(equity), w)
      return series[index] ?? null
    }
    case 'Weighted Moving Average': {
      const series = rollingWma(Array.from(equity), w)
      return series[index] ?? null
    }
    case "Wilder's Smoothing": {
      const series = rollingWildersMa(Array.from(equity), w)
      return series[index] ?? null
    }
    case 'DEMA': {
      const series = rollingDema(Array.from(equity), w)
      return series[index] ?? null
    }
    case 'TEMA': {
      const series = rollingTema(Array.from(equity), w)
      return series[index] ?? null
    }
    case 'KAMA': {
      const series = rollingKama(Array.from(equity), w)
      return series[index] ?? null
    }
    case 'Ultimate Smoother': {
      const series = rollingUltimateSmoother(Array.from(equity), w)
      return series[index] ?? null
    }
    // Trend
    case 'Linear Regression Slope': {
      const series = rollingLinRegSlope(Array.from(equity), w)
      return series[index] ?? null
    }
    case 'Linear Regression Value': {
      const series = rollingLinRegValue(Array.from(equity), w)
      return series[index] ?? null
    }
    case 'Price vs SMA': {
      const series = rollingPriceVsSma(Array.from(equity), w)
      return series[index] ?? null
    }
    case 'Trend Clarity': {
      const series = rollingTrendClarity(Array.from(equity), w)
      return series[index] ?? null
    }
    // MACD / PPO
    case 'MACD Histogram': {
      const series = rollingMACD(Array.from(equity))
      return series[index] ?? null
    }
    case 'PPO Histogram': {
      const series = rollingPPO(Array.from(equity))
      return series[index] ?? null
    }
    // Volatility
    case 'Historical Volatility': {
      const series = rollingHistoricalVolatility(Array.from(equity), w)
      return series[index] ?? null
    }
    case 'Ulcer Index': {
      const series = rollingUlcerIndex(Array.from(equity), w)
      return series[index] ?? null
    }
    case 'Bollinger %B': {
      const series = rollingBollingerB(Array.from(equity), w)
      return series[index] ?? null
    }
    case 'Bollinger Bandwidth': {
      const series = rollingBollingerBandwidth(Array.from(equity), w)
      return series[index] ?? null
    }
    // RSI variants
    case 'RSI SMA': {
      const series = rollingRsiSma(Array.from(equity), w)
      return series[index] ?? null
    }
    case 'RSI EMA': {
      const series = rollingRsiEma(Array.from(equity), w)
      return series[index] ?? null
    }
    case 'Stochastic RSI': {
      const series = rollingStochRsi(Array.from(equity), w, w)
      return series[index] ?? null
    }
    case 'Laguerre RSI': {
      const series = rollingLaguerreRsi(Array.from(equity))
      return series[index] ?? null
    }
    default:
      // Unsupported indicator for branch equity
      return null
  }
}

// Evaluate a metric at a specific index (for forDays support)
const metricAtIndex = (ctx, ticker, metric, window, index, parentNode = null) => {
  // FRD-021: Handle branch references (e.g., 'branch:from')
  if (isBranchRef(ticker)) {
    const branchName = parseBranchRef(ticker)
    const branchNode = getBranchChildNode(parentNode || ctx.branchParentNode, branchName)
    if (!branchNode) {
      // Branch not found - return null (indicator will fail gracefully)
      return null
    }
    const branchEquity = getBranchEquity(ctx, branchNode)
    if (!branchEquity) return null
    return branchMetricAt(ctx, branchEquity, metric, window, index)
  }

  // FRD-035: Handle custom indicators (metric = 'custom:ci_xxxxx')
  if (metric && metric.startsWith('custom:')) {
    const customId = metric
    const customIndicator = ctx.customIndicators?.find(ci => `custom:${ci.id}` === customId)

    if (!customIndicator) {
      return null
    }

    const ast = getParsedFormula(customIndicator.formula)
    if (!ast) return null

    const t = getSeriesKey(ticker)
    if (!t || t === 'Empty') return null

    if (index < 0) return null

    // Create getVar function for this specific index
    const getVar = (varName, defaultWindow) => {
      if (varName === 'close') {
        const closes = getCachedCloseArray(ctx.cache, ctx.db, t)
        return closes[index] ?? null
      }
      if (varName === 'open') {
        const opens = ctx.db.open?.[t]
        return opens?.[index] ?? null
      }
      if (varName === 'high') {
        const highs = ctx.db.high?.[t]
        return highs?.[index] ?? null
      }
      if (varName === 'low') {
        const lows = ctx.db.low?.[t]
        return lows?.[index] ?? null
      }
      if (varName === 'volume') {
        const vols = ctx.db.volume?.[t]
        return vols?.[index] ?? null
      }

      // For other variables, delegate to metricAtIndex recursively
      const varToMetric = {
        'sma': 'Simple Moving Average',
        'ema': 'Exponential Moving Average',
        'rsi': 'Relative Strength Index',
        'stdev': 'Standard Deviation',
        'maxdd': 'Max Drawdown',
        'drawdown': 'Drawdown',
        'cumret': 'Cumulative Return',
        'atr': 'ATR',
        'roc': 'Rate of Change',
      }
      const metricName = varToMetric[varName]
      if (metricName) {
        return metricAtIndex(ctx, ticker, metricName, window, index, parentNode)
      }
      return null
    }

    const getSeries = (varName, defaultWindow, length) => {
      if (varName === 'close') {
        const closes = getCachedCloseArray(ctx.cache, ctx.db, t)
        const startIdx = Math.max(0, index - length + 1)
        return Array.from(closes.slice(startIdx, index + 1))
      }
      return null
    }

    return evaluateFormulaAST(ast, getVar, getSeries, window)
  }

  const t = getSeriesKey(ticker)
  if (!t || t === 'Empty') return null

  if (metric === 'Current Price') {
    // For CC/CO modes (decisionPrice='close'), use adjClose to match indicator calculations
    // For OO/OC modes (decisionPrice='open'), use open price
    const arr = ctx.decisionPrice === 'open' ? ctx.db.open[t] : (ctx.db.adjClose[t] || ctx.db.close[t])
    const v = arr?.[index]
    return v == null ? null : v
  }

  if (index < 0) return null
  const closes = getCachedCloseArray(ctx.cache, ctx.db, t)
  const w = Math.max(1, Math.floor(Number(window || 0)))

  switch (metric) {
    case 'Simple Moving Average': {
      const series = getCachedSeries(ctx.cache, 'sma', t, w, () => rollingSma(closes, w))
      return series[index] ?? null
    }
    case 'Exponential Moving Average': {
      const series = getCachedSeries(ctx.cache, 'ema', t, w, () => rollingEma(closes, w))
      return series[index] ?? null
    }
    case 'Relative Strength Index': {
      const series = getCachedSeries(ctx.cache, 'rsi', t, w, () => rollingWilderRsi(closes, w))
      return series[index] ?? null
    }
    case 'Standard Deviation': {
      const rets = getCachedReturnsArray(ctx.cache, ctx.db, t)
      const series = getCachedSeries(ctx.cache, 'std', t, w, () => rollingStdDev(rets, w))
      return series[index] ?? null
    }
    case 'Max Drawdown': {
      const series = getCachedSeries(ctx.cache, 'maxdd', t, w, () => rollingMaxDrawdown(closes, w))
      return series[index] ?? null
    }
    case 'Standard Deviation of Price': {
      const series = getCachedSeries(ctx.cache, 'stdPrice', t, w, () => rollingStdDevOfPrices(closes, w))
      return series[index] ?? null
    }
    case 'Cumulative Return': {
      const series = getCachedSeries(ctx.cache, 'cumRet', t, w, () => rollingCumulativeReturn(closes, w))
      return series[index] ?? null
    }
    case 'SMA of Returns': {
      const series = getCachedSeries(ctx.cache, 'smaRet', t, w, () => rollingSmaOfReturns(closes, w))
      return series[index] ?? null
    }
    // Momentum indicators (no window - fixed lookbacks)
    // Support both Atlas names and QM import names
    case 'Momentum (Weighted)':
    case '13612W Momentum': {
      const series = getCachedSeries(ctx.cache, 'mom13612w', t, 0, () => rolling13612W(closes))
      return series[index] ?? null
    }
    case 'Momentum (Unweighted)':
    case '13612U Momentum': {
      const series = getCachedSeries(ctx.cache, 'mom13612u', t, 0, () => rolling13612U(closes))
      return series[index] ?? null
    }
    case 'Momentum (12-Month SMA)':
    case 'SMA12 Momentum': {
      const series = getCachedSeries(ctx.cache, 'momsma12', t, 0, () => rollingSMA12Momentum(closes))
      return series[index] ?? null
    }
    // Drawdown from ATH (no window)
    case 'Drawdown': {
      const series = getCachedSeries(ctx.cache, 'drawdown', t, 0, () => rollingDrawdown(closes))
      return series[index] ?? null
    }
    // Aroon indicators (need high/low prices)
    case 'Aroon Up': {
      const highs = ctx.db.high?.[t]
      if (!highs) return null
      const series = getCachedSeries(ctx.cache, 'aroonUp', t, w, () => rollingAroonUp(highs, w))
      return series[index] ?? null
    }
    case 'Aroon Down': {
      const lows = ctx.db.low?.[t]
      if (!lows) return null
      const series = getCachedSeries(ctx.cache, 'aroonDown', t, w, () => rollingAroonDown(lows, w))
      return series[index] ?? null
    }
    case 'Aroon Oscillator': {
      const highs = ctx.db.high?.[t]
      const lows = ctx.db.low?.[t]
      if (!highs || !lows) return null
      const series = getCachedSeries(ctx.cache, 'aroonOsc', t, w, () => rollingAroonOscillator(highs, lows, w))
      return series[index] ?? null
    }
    // MACD & PPO (fixed 12/26/9 periods)
    case 'MACD Histogram': {
      const series = getCachedSeries(ctx.cache, 'macd', t, 0, () => rollingMACD(closes))
      return series[index] ?? null
    }
    case 'PPO Histogram': {
      const series = getCachedSeries(ctx.cache, 'ppo', t, 0, () => rollingPPO(closes))
      return series[index] ?? null
    }
    // Trend Clarity (R²)
    case 'Trend Clarity': {
      const series = getCachedSeries(ctx.cache, 'trendClarity', t, w, () => rollingTrendClarity(closes, w))
      return series[index] ?? null
    }
    // Ultimate Smoother
    case 'Ultimate Smoother': {
      const series = getCachedSeries(ctx.cache, 'ultSmooth', t, w, () => rollingUltimateSmoother(closes, w))
      return series[index] ?? null
    }
    // ============================================
    // NEW MOVING AVERAGES
    // ============================================
    case 'Hull Moving Average': {
      const series = getCachedSeries(ctx.cache, 'hma', t, w, () => rollingHma(closes, w))
      return series[index] ?? null
    }
    case 'Weighted Moving Average': {
      const series = getCachedSeries(ctx.cache, 'wma', t, w, () => rollingWma(closes, w))
      return series[index] ?? null
    }
    case 'Wilder Moving Average': {
      const series = getCachedSeries(ctx.cache, 'wildersMa', t, w, () => rollingWildersMa(closes, w))
      return series[index] ?? null
    }
    case 'DEMA': {
      const series = getCachedSeries(ctx.cache, 'dema', t, w, () => rollingDema(closes, w))
      return series[index] ?? null
    }
    case 'TEMA': {
      const series = getCachedSeries(ctx.cache, 'tema', t, w, () => rollingTema(closes, w))
      return series[index] ?? null
    }
    case 'KAMA': {
      const series = getCachedSeries(ctx.cache, 'kama', t, w, () => rollingKama(closes, w))
      return series[index] ?? null
    }
    // ============================================
    // RSI VARIANTS
    // ============================================
    case 'RSI (SMA)': {
      const series = getCachedSeries(ctx.cache, 'rsiSma', t, w, () => rollingRsiSma(closes, w))
      return series[index] ?? null
    }
    case 'RSI (EMA)': {
      const series = getCachedSeries(ctx.cache, 'rsiEma', t, w, () => rollingRsiEma(closes, w))
      return series[index] ?? null
    }
    case 'Stochastic RSI': {
      const series = getCachedSeries(ctx.cache, 'stochRsi', t, w, () => rollingStochRsi(closes, w, w))
      return series[index] ?? null
    }
    case 'Laguerre RSI': {
      const series = getCachedSeries(ctx.cache, 'laguerreRsi', t, 0, () => rollingLaguerreRsi(closes))
      return series[index] ?? null
    }
    // ============================================
    // VOLATILITY INDICATORS
    // ============================================
    case 'Bollinger %B': {
      const series = getCachedSeries(ctx.cache, 'bollingerB', t, w, () => rollingBollingerB(closes, w))
      return series[index] ?? null
    }
    case 'Bollinger Bandwidth': {
      const series = getCachedSeries(ctx.cache, 'bollingerBandwidth', t, w, () => rollingBollingerBandwidth(closes, w))
      return series[index] ?? null
    }
    case 'ATR': {
      const highs = getCachedHighArray(ctx.cache, ctx.db, t)
      const lows = getCachedLowArray(ctx.cache, ctx.db, t)
      if (!highs.length || !lows.length) return null
      const series = getCachedSeries(ctx.cache, 'atr', t, w, () => rollingAtr(highs, lows, closes, w))
      return series[index] ?? null
    }
    case 'ATR %': {
      const highs = getCachedHighArray(ctx.cache, ctx.db, t)
      const lows = getCachedLowArray(ctx.cache, ctx.db, t)
      if (!highs.length || !lows.length) return null
      const series = getCachedSeries(ctx.cache, 'atrPercent', t, w, () => rollingAtrPercent(highs, lows, closes, w))
      return series[index] ?? null
    }
    case 'Historical Volatility': {
      const series = getCachedSeries(ctx.cache, 'histVol', t, w, () => rollingHistoricalVolatility(closes, w))
      return series[index] ?? null
    }
    case 'Ulcer Index': {
      const series = getCachedSeries(ctx.cache, 'ulcerIndex', t, w, () => rollingUlcerIndex(closes, w))
      return series[index] ?? null
    }
    // ============================================
    // MOMENTUM INDICATORS
    // ============================================
    case 'Rate of Change': {
      const series = getCachedSeries(ctx.cache, 'roc', t, w, () => rollingRoc(closes, w))
      return series[index] ?? null
    }
    case 'Williams %R': {
      const highs = getCachedHighArray(ctx.cache, ctx.db, t)
      const lows = getCachedLowArray(ctx.cache, ctx.db, t)
      if (!highs.length || !lows.length) return null
      const series = getCachedSeries(ctx.cache, 'williamsR', t, w, () => rollingWilliamsR(highs, lows, closes, w))
      return series[index] ?? null
    }
    case 'CCI': {
      const highs = getCachedHighArray(ctx.cache, ctx.db, t)
      const lows = getCachedLowArray(ctx.cache, ctx.db, t)
      if (!highs.length || !lows.length) return null
      const series = getCachedSeries(ctx.cache, 'cci', t, w, () => rollingCci(highs, lows, closes, w))
      return series[index] ?? null
    }
    case 'Stochastic %K': {
      const highs = getCachedHighArray(ctx.cache, ctx.db, t)
      const lows = getCachedLowArray(ctx.cache, ctx.db, t)
      if (!highs.length || !lows.length) return null
      const series = getCachedSeries(ctx.cache, 'stochK', t, w, () => rollingStochK(highs, lows, closes, w))
      return series[index] ?? null
    }
    case 'Stochastic %D': {
      const highs = getCachedHighArray(ctx.cache, ctx.db, t)
      const lows = getCachedLowArray(ctx.cache, ctx.db, t)
      if (!highs.length || !lows.length) return null
      const series = getCachedSeries(ctx.cache, 'stochD', t, w, () => rollingStochD(highs, lows, closes, w))
      return series[index] ?? null
    }
    case 'ADX': {
      const highs = getCachedHighArray(ctx.cache, ctx.db, t)
      const lows = getCachedLowArray(ctx.cache, ctx.db, t)
      if (!highs.length || !lows.length) return null
      const series = getCachedSeries(ctx.cache, 'adx', t, w, () => rollingAdx(highs, lows, closes, w))
      return series[index] ?? null
    }
    // ============================================
    // TREND INDICATORS
    // ============================================
    case 'Linear Reg Slope': {
      const series = getCachedSeries(ctx.cache, 'linRegSlope', t, w, () => rollingLinRegSlope(closes, w))
      return series[index] ?? null
    }
    case 'Linear Reg Value': {
      const series = getCachedSeries(ctx.cache, 'linRegValue', t, w, () => rollingLinRegValue(closes, w))
      return series[index] ?? null
    }
    case 'Price vs SMA': {
      const series = getCachedSeries(ctx.cache, 'priceVsSma', t, w, () => rollingPriceVsSma(closes, w))
      return series[index] ?? null
    }
    // ============================================
    // VOLUME-BASED INDICATORS
    // ============================================
    case 'Money Flow Index': {
      const highs = getCachedHighArray(ctx.cache, ctx.db, t)
      const lows = getCachedLowArray(ctx.cache, ctx.db, t)
      const volumes = getCachedVolumeArray(ctx.cache, ctx.db, t)
      if (!highs.length || !lows.length || !volumes.length) return null
      const series = getCachedSeries(ctx.cache, 'mfi', t, w, () => rollingMfi(highs, lows, closes, volumes, w))
      return series[index] ?? null
    }
    case 'OBV Rate of Change': {
      const volumes = getCachedVolumeArray(ctx.cache, ctx.db, t)
      if (!volumes.length) return null
      const series = getCachedSeries(ctx.cache, 'obv', t, w, () => rollingObvRoc(closes, volumes, w))
      return series[index] ?? null
    }
    case 'VWAP Ratio': {
      const volumes = getCachedVolumeArray(ctx.cache, ctx.db, t)
      if (!volumes.length) return null
      const series = getCachedSeries(ctx.cache, 'vwapRatio', t, w, () => rollingVwapRatio(closes, volumes, w))
      return series[index] ?? null
    }
  }
  return null
}

// ============================================
// SLOT CONFIG
// ============================================

const SLOT_ORDER = {
  basic: ['next'],
  function: ['next'],
  indicator: ['then', 'else'],
  numbered: ['then', 'else'],
  scaling: ['then', 'else'],
  position: [],
  call: [],
}

const getSlotConfig = (node, slot) => {
  const key = slot === 'then' ? 'thenWeighting' : slot === 'else' ? 'elseWeighting' : 'weighting'
  const mode = node[key] || 'equal'
  const volKey = slot === 'then' ? 'thenVolWindow' : slot === 'else' ? 'elseVolWindow' : 'volWindow'
  const volWindow = Math.floor(Number(node[volKey] ?? 20))
  const fallbackKey = slot === 'then' ? 'thenCappedFallback' : slot === 'else' ? 'elseCappedFallback' : 'cappedFallback'
  const cappedFallback = node[fallbackKey] || 'BIL'

  // Extract min/max caps (convert from percentage to decimal)
  const minCapKey = slot === 'then' ? 'minCapThen' : slot === 'else' ? 'minCapElse' : 'minCap'
  const maxCapKey = slot === 'then' ? 'maxCapThen' : slot === 'else' ? 'maxCapElse' : 'maxCap'
  const minCap = Number(node[minCapKey] ?? 0) / 100
  const maxCap = Number(node[maxCapKey] ?? 100) / 100

  return { mode, volWindow, cappedFallback, minCap, maxCap }
}

// ============================================
// CONDITION EVALUATION
// ============================================

const normalizeComparatorChoice = (c) => {
  if (c === 'gt' || c === '>') return 'gt'
  if (c === 'crossAbove') return 'crossAbove'
  if (c === 'crossBelow') return 'crossBelow'
  return 'lt'
}

// ─────────────────────────────────────────────────────────────────────────────
// Date Condition Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a date to a comparable "month-day" number (month * 100 + day)
 */
const toMonthDay = (month, day) => month * 100 + day

/**
 * Check if a trading date (timestamp in seconds) falls within the specified date range
 * Handles year-wrapping ranges (e.g., Dec 15 to Jan 15)
 */
const isDateInRange = (timestamp, fromMonth, fromDay, toMonth, toDay) => {
  // Convert timestamp (seconds) to Date
  const date = new Date(timestamp * 1000)
  const currentMonth = date.getUTCMonth() + 1 // 1-12
  const currentDay = date.getUTCDate()
  const current = toMonthDay(currentMonth, currentDay)

  // If no range (single date), check exact match
  if (toMonth === undefined || toDay === undefined) {
    const target = toMonthDay(fromMonth, fromDay)
    return current === target
  }

  const from = toMonthDay(fromMonth, fromDay)
  const to = toMonthDay(toMonth, toDay)

  // Normal range (e.g., Jan 1 to Mar 31)
  if (from <= to) {
    return current >= from && current <= to
  }

  // Year-wrapping range (e.g., Nov 1 to Feb 28)
  // True if current >= from OR current <= to
  return current >= from || current <= to
}

// Evaluate a single condition at a specific index (for forDays support)
const evaluateConditionAtIndex = (ctx, cond, index, parentNode = null) => {
  // Handle Date conditions specially
  if (cond.metric === 'Date') {
    const dateTimestamp = ctx.db.dates[index]
    if (dateTimestamp == null) return null
    // For expanded Date conditions, use dateTo if available, otherwise default to end of same month
    const fromMonth = cond.dateMonth ?? 1
    const fromDay = cond.dateDay ?? 1
    let toMonth, toDay
    if (cond.expanded) {
      // Use dateTo if set, otherwise default to last day of the from month
      toMonth = cond.dateTo?.month ?? fromMonth
      toDay = cond.dateTo?.day ?? 31
    }
    return isDateInRange(dateTimestamp, fromMonth, fromDay, toMonth, toDay)
  }

  const leftTicker = normalizeChoice(cond.ticker)
  const leftVal = metricAtIndex(ctx, leftTicker, cond.metric, cond.window, index, parentNode)
  if (leftVal == null) return null

  const cmp = normalizeComparatorChoice(cond.comparator)
  const isCrossing = cmp === 'crossAbove' || cmp === 'crossBelow'

  // For crossing comparators, get yesterday's value
  const leftYesterday = isCrossing && index > 0
    ? metricAtIndex(ctx, leftTicker, cond.metric, cond.window, index - 1, parentNode)
    : null

  if (!cond.expanded) {
    const threshold = Number(cond.threshold)
    if (!Number.isFinite(threshold)) return null

    if (isCrossing) {
      if (leftYesterday == null) return null
      // crossAbove: yesterday < threshold AND today >= threshold
      // crossBelow: yesterday > threshold AND today <= threshold
      if (cmp === 'crossAbove') return leftYesterday < threshold && leftVal >= threshold
      return leftYesterday > threshold && leftVal <= threshold
    }

    return cmp === 'gt' ? leftVal > threshold : leftVal < threshold
  }

  const rightTicker = normalizeChoice(cond.rightTicker ?? cond.ticker)
  const rightMetric = cond.rightMetric ?? cond.metric
  const rightWindow = cond.rightWindow ?? cond.window
  const rightVal = metricAtIndex(ctx, rightTicker, rightMetric, rightWindow, index, parentNode)
  if (rightVal == null) return null

  if (isCrossing) {
    const rightYesterday = index > 0
      ? metricAtIndex(ctx, rightTicker, rightMetric, rightWindow, index - 1, parentNode)
      : null
    if (leftYesterday == null || rightYesterday == null) return null
    // crossAbove: yesterday left < right AND today left >= right
    // crossBelow: yesterday left > right AND today left <= right
    if (cmp === 'crossAbove') return leftYesterday < rightYesterday && leftVal >= rightVal
    return leftYesterday > rightYesterday && leftVal <= rightVal
  }

  return cmp === 'gt' ? leftVal > rightVal : leftVal < rightVal
}

const evaluateCondition = (ctx, cond, parentNode = null) => {
  // Handle Date conditions specially (no forDays needed for date conditions)
  if (cond.metric === 'Date') {
    const dateTimestamp = ctx.db.dates[ctx.indicatorIndex]
    if (dateTimestamp == null) return null
    // For expanded Date conditions, use dateTo if available, otherwise default to end of same month
    const fromMonth = cond.dateMonth ?? 1
    const fromDay = cond.dateDay ?? 1
    let toMonth, toDay
    if (cond.expanded) {
      // Use dateTo if set, otherwise default to last day of the from month
      toMonth = cond.dateTo?.month ?? fromMonth
      toDay = cond.dateTo?.day ?? 31
    }
    return isDateInRange(dateTimestamp, fromMonth, fromDay, toMonth, toDay)
  }

  const forDays = cond.forDays || 1

  // For forDays > 1, check that the condition was true for the past N consecutive days
  if (forDays > 1) {
    for (let dayOffset = 0; dayOffset < forDays; dayOffset++) {
      const checkIndex = ctx.indicatorIndex - dayOffset
      if (checkIndex < 0) {
        // Not enough history to check - return null (indeterminate), not false
        return null
      }
      const result = evaluateConditionAtIndex(ctx, cond, checkIndex, parentNode)
      if (result !== true) {
        // Condition failed on one of the days (false or null)
        return result === null ? null : false
      }
    }
    // All days passed
    return true
  }

  // Standard single-day evaluation (forDays = 1)
  const leftTicker = normalizeChoice(cond.ticker)
  const leftVal = metricAt(ctx, leftTicker, cond.metric, cond.window, parentNode)
  if (leftVal == null) return null

  const cmp = normalizeComparatorChoice(cond.comparator)
  const isCrossing = cmp === 'crossAbove' || cmp === 'crossBelow'

  // For crossing comparators, get yesterday's value
  const leftYesterday = isCrossing && ctx.indicatorIndex > 0
    ? metricAtIndex(ctx, leftTicker, cond.metric, cond.window, ctx.indicatorIndex - 1, parentNode)
    : null

  if (!cond.expanded) {
    const threshold = Number(cond.threshold)
    if (!Number.isFinite(threshold)) return null

    if (isCrossing) {
      if (leftYesterday == null) return null
      if (cmp === 'crossAbove') return leftYesterday < threshold && leftVal >= threshold
      return leftYesterday > threshold && leftVal <= threshold
    }

    return cmp === 'gt' ? leftVal > threshold : leftVal < threshold
  }

  const rightTicker = normalizeChoice(cond.rightTicker ?? cond.ticker)
  const rightMetric = cond.rightMetric ?? cond.metric
  const rightWindow = cond.rightWindow ?? cond.window
  const rightVal = metricAt(ctx, rightTicker, rightMetric, rightWindow, parentNode)
  if (rightVal == null) return null

  if (isCrossing) {
    const rightYesterday = ctx.indicatorIndex > 0
      ? metricAtIndex(ctx, rightTicker, rightMetric, rightWindow, ctx.indicatorIndex - 1, parentNode)
      : null
    if (leftYesterday == null || rightYesterday == null) return null
    if (cmp === 'crossAbove') return leftYesterday < rightYesterday && leftVal >= rightVal
    return leftYesterday > rightYesterday && leftVal <= rightVal
  }

  return cmp === 'gt' ? leftVal > rightVal : leftVal < rightVal
}

const normalizeConditionType = (t, fallback = 'and') => {
  if (t === 'if' || t === 'and' || t === 'or') return t
  return fallback
}

const evaluateConditions = (ctx, conditions, logic, parentNode = null) => {
  if (!conditions || conditions.length === 0) return false

  // Standard boolean precedence: AND binds tighter than OR.
  // Example: `A or B and C` => `A || (B && C)`.
  //
  // Null handling:
  // - AND: null AND anything = null (null propagates through AND)
  // - OR: null OR true = true, null OR false = null, null OR null = null
  let currentAnd = undefined  // Use undefined to distinguish "not set" from null
  const orTerms = []

  for (const c of conditions) {
    const v = evaluateCondition(ctx, c, parentNode)
    const t = normalizeConditionType(c.type, 'and')

    if (t === 'if') {
      if (currentAnd !== undefined) orTerms.push(currentAnd)
      currentAnd = v
      continue
    }

    if (currentAnd === undefined) {
      currentAnd = v
      continue
    }

    if (t === 'and') {
      // AND with null propagates null
      if (currentAnd === null || v === null) {
        currentAnd = null
      } else {
        currentAnd = currentAnd && v
      }
      continue
    }

    if (t === 'or') {
      orTerms.push(currentAnd)
      currentAnd = v
      continue
    }

    currentAnd = v
  }

  if (currentAnd !== undefined) orTerms.push(currentAnd)

  // OR logic: true if ANY term is true, null if no true but has null, false otherwise
  if (orTerms.some(term => term === true)) return true
  if (orTerms.some(term => term === null)) return null
  return false
}

// ============================================
// LOOKBACK CALCULATION
// ============================================

// Get the actual lookback period needed for an indicator (for warm-up calculations)
const getIndicatorLookback = (metric, window) => {
  switch (metric) {
    case 'Current Price':
      return 0
    case 'Momentum (Weighted)':
    case '13612W Momentum':
    case 'Momentum (Unweighted)':
    case '13612U Momentum':
      return 252 // 12 months of trading days
    case 'Momentum (12-Month SMA)':
    case 'SMA12 Momentum':
      return 252 // 12 months
    case 'Drawdown':
      return 0 // Uses all history, no fixed lookback needed
    case 'MACD Histogram':
    case 'PPO Histogram':
      return 35 // 26 + 9 for signal line
    case 'Laguerre RSI':
      return 10 // Minimal lookback, uses recursive filter
    // EMAs need extra lookback for multi-layer indicators
    case 'DEMA':
      return Math.max(1, Math.floor(window || 0)) * 2
    case 'TEMA':
      return Math.max(1, Math.floor(window || 0)) * 3
    case 'KAMA':
      return Math.max(1, Math.floor(window || 0)) + 30 // window + slow period
    case 'ADX':
      return Math.max(1, Math.floor(window || 0)) * 2 // Extra for smoothing
    default:
      return Math.max(1, Math.floor(window || 0))
  }
}

// Walk a node tree and collect the maximum lookback needed
// NOTE: Using regular function declaration for hoisting (called from simulateBranchEquity)
function collectMaxLookback(node) {
  if (!node) return 0
  let maxLookback = 0

  // Helper to process a conditions array
  const processConditions = (conditions) => {
    for (const cond of conditions || []) {
      const forDaysOffset = Math.max(0, (cond.forDays || 1) - 1)
      maxLookback = Math.max(maxLookback, getIndicatorLookback(cond.metric, cond.window || 0) + forDaysOffset)
      if (cond.expanded) {
        const rightMetric = cond.rightMetric ?? cond.metric
        const rightWindow = cond.rightWindow ?? cond.window
        maxLookback = Math.max(maxLookback, getIndicatorLookback(rightMetric, rightWindow || 0) + forDaysOffset)
      }
    }
  }

  // Check conditions on indicator/numbered/scaling nodes
  processConditions(node.conditions)

  // Check entry/exit conditions on altExit nodes
  processConditions(node.entryConditions)
  processConditions(node.exitConditions)

  // Check numbered node items
  if (node.numbered?.items) {
    for (const item of node.numbered.items) {
      processConditions(item.conditions)
    }
  }

  // Check function nodes (pickMetric, excludeMetric)
  if (node.pickMetric) {
    maxLookback = Math.max(maxLookback, getIndicatorLookback(node.pickMetric, node.pickWindow || 0))
  }
  if (node.excludeMetric) {
    maxLookback = Math.max(maxLookback, getIndicatorLookback(node.excludeMetric, node.excludeWindow || 0))
  }

  // Check scaling nodes
  if (node.scaleMetric) {
    maxLookback = Math.max(maxLookback, getIndicatorLookback(node.scaleMetric, node.scaleWindow || 0))
  }

  // Recursively check children
  const children = node.children || {}
  for (const slot of Object.keys(children)) {
    const childArray = children[slot] || []
    for (const child of childArray) {
      if (child) {
        maxLookback = Math.max(maxLookback, collectMaxLookback(child))
      }
    }
  }

  return maxLookback
}

// Helper to find first index with valid data in an array
function findFirstValidIndex(arr) {
  if (!arr) return 0
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] != null && !Number.isNaN(arr[i])) return i
  }
  return arr.length  // No valid data
}

/**
 * Collect branch lookback requirements from all nodes in the tree.
 * Branch references (branch:from, branch:to, etc.) require extra warmup because
 * the branch equity curve needs to be calculated first, and THEN indicators
 * need additional history on top of that.
 *
 * This applies to ALL node types that use branch references:
 * - Indicator nodes with branch:from/to in conditions
 * - Scaling nodes with branch:from/to in scaleTicker
 * - AltExit nodes with branch:from/to in entry/exit conditions
 * - Numbered nodes with branch references in item conditions
 */
function collectBranchLookbacks(node) {
  let maxBranchLookback = 0

  const checkConditions = (conditions) => {
    for (const cond of conditions || []) {
      // Check main ticker
      if (isBranchRef(cond.ticker)) {
        const lookback = getIndicatorLookback(cond.metric, cond.window || 0)
        maxBranchLookback = Math.max(maxBranchLookback, lookback)
      }
      // Check rightTicker for expanded conditions
      if (cond.expanded && isBranchRef(cond.rightTicker)) {
        const rightMetric = cond.rightMetric ?? cond.metric
        const lookback = getIndicatorLookback(rightMetric, cond.rightWindow || 0)
        maxBranchLookback = Math.max(maxBranchLookback, lookback)
      }
    }
  }

  // Check all condition sources - applicable to ANY node type
  checkConditions(node.conditions)
  checkConditions(node.entryConditions)
  checkConditions(node.exitConditions)

  // Check numbered items (numbered nodes)
  if (node.numbered?.items) {
    for (const item of node.numbered.items) {
      checkConditions(item.conditions)
    }
  }

  // Check scaling nodes with branch references in scaleTicker
  if (node.scaleMetric && isBranchRef(node.scaleTicker)) {
    const lookback = getIndicatorLookback(node.scaleMetric, node.scaleWindow || 0)
    maxBranchLookback = Math.max(maxBranchLookback, lookback)
  }

  // Recurse into ALL children regardless of node type
  for (const slot of Object.keys(node.children || {})) {
    for (const child of node.children[slot] || []) {
      if (child) {
        maxBranchLookback = Math.max(maxBranchLookback, collectBranchLookbacks(child))
      }
    }
  }

  return maxBranchLookback
}

/**
 * Collect ratio ticker lookback requirements from all nodes in the tree.
 * Ratio tickers (like SPY/AGG) need BOTH component tickers to have valid data
 * before the ratio can be calculated, and THEN the indicator lookback applies.
 *
 * This applies to ALL node types that use ratio tickers in conditions.
 * Returns an array of { firstValidIndex, lookback } for each ratio found.
 */
function collectRatioLookbacks(node, db) {
  const ratioLookbacks = []  // Array of { firstValidIndex, lookback }

  const checkConditions = (conditions) => {
    for (const cond of conditions || []) {
      // Check main ticker
      const ratio = parseRatioTicker(cond.ticker)
      if (ratio) {
        const lookback = getIndicatorLookback(cond.metric, cond.window || 0)
        const numFirst = findFirstValidIndex(db.close[ratio.numerator])
        const denFirst = findFirstValidIndex(db.close[ratio.denominator])
        const firstValid = Math.max(numFirst, denFirst)
        ratioLookbacks.push({ firstValidIndex: firstValid, lookback })
      }
      // Check rightTicker for expanded conditions
      if (cond.expanded) {
        const rightRatio = parseRatioTicker(cond.rightTicker)
        if (rightRatio) {
          const rightMetric = cond.rightMetric ?? cond.metric
          const lookback = getIndicatorLookback(rightMetric, cond.rightWindow || 0)
          const numFirst = findFirstValidIndex(db.close[rightRatio.numerator])
          const denFirst = findFirstValidIndex(db.close[rightRatio.denominator])
          const firstValid = Math.max(numFirst, denFirst)
          ratioLookbacks.push({ firstValidIndex: firstValid, lookback })
        }
      }
    }
  }

  // Check all condition sources - applicable to ANY node type
  checkConditions(node.conditions)
  checkConditions(node.entryConditions)
  checkConditions(node.exitConditions)

  // Check numbered items (numbered nodes)
  if (node.numbered?.items) {
    for (const item of node.numbered.items) {
      checkConditions(item.conditions)
    }
  }

  // Check scaling nodes with ratio tickers in scaleTicker
  const scaleRatio = parseRatioTicker(node.scaleTicker)
  if (node.scaleMetric && scaleRatio) {
    const lookback = getIndicatorLookback(node.scaleMetric, node.scaleWindow || 0)
    const numFirst = findFirstValidIndex(db.close[scaleRatio.numerator])
    const denFirst = findFirstValidIndex(db.close[scaleRatio.denominator])
    const firstValid = Math.max(numFirst, denFirst)
    ratioLookbacks.push({ firstValidIndex: firstValid, lookback })
  }

  // Recurse into ALL children regardless of node type
  for (const slot of Object.keys(node.children || {})) {
    for (const child of node.children[slot] || []) {
      if (child) {
        ratioLookbacks.push(...collectRatioLookbacks(child, db))
      }
    }
  }

  return ratioLookbacks
}

// ============================================
// NODE EVALUATION
// ============================================

// NOTE: Using regular function declaration for hoisting (called from simulateBranchEquity)
function evaluateNode(ctx, node) {
  if (!node) return {}

  if (node.kind === 'position') {
    const positions = node.positions || []
    if (positions.length === 0) return {}
    const alloc = {}
    const validPositions = positions.filter(p => normalizeChoice(p) !== 'Empty')
    if (validPositions.length === 0) return {}
    const weight = 1 / validPositions.length
    for (const p of validPositions) {
      const t = normalizeChoice(p)
      alloc[t] = (alloc[t] || 0) + weight
    }

    return alloc
  }

  if (node.kind === 'indicator') {
    const conditions = node.conditions || []
    const logic = node.conditionLogic || 'and'
    // FRD-021: Pass node as parentNode for branch reference resolution in conditions
    const result = evaluateConditions(ctx, conditions, logic, node)
    const branch = result === true ? 'then' : 'else'

    const children = (node.children?.[branch] || []).filter(Boolean)
    return evaluateChildren(ctx, node, branch, children)
  }

  if (node.kind === 'function') {
    const children = (node.children?.next || []).filter(Boolean)
    const metric = node.metric || 'Relative Strength Index'
    const window = Math.floor(Number(node.window ?? 10))
    const pickN = Math.floor(Number(node.bottom ?? 1))
    const rank = node.rank || 'bottom'

    // Collect values for each child
    const childValues = children.map((child) => {
      // Use pre-computed ticker locations for O(1) lookup, fallback to tree walk
      const tickers = ctx.tickerLocations?.get(child.id)
        ? Array.from(ctx.tickerLocations.get(child.id))
        : collectPositionTickers(child)
      if (tickers.length === 0) return { child, value: null }
      const avgValue = tickers.reduce((sum, t) => {
        const v = metricAt(ctx, t, metric, window)
        return sum + (v ?? 0)
      }, 0) / tickers.length
      return { child, value: avgValue }
    })

    // Sort and pick
    const sorted = childValues.filter(cv => cv.value != null).sort((a, b) => {
      if (rank === 'bottom') return a.value - b.value
      return b.value - a.value
    })

    const picked = sorted.slice(0, pickN)
    if (picked.length === 0) return {}

    // Evaluate picked children
    return evaluateChildren(ctx, node, 'next', picked.map(p => p.child))
  }

  if (node.kind === 'basic') {
    const children = (node.children?.next || []).filter(Boolean)
    return evaluateChildren(ctx, node, 'next', children)
  }

  if (node.kind === 'scaling') {
    // DEBUG: Always log scaling node evaluation
    console.log(`[SCALING EVAL] node=${node.id}, raw scaleTicker="${node.scaleTicker}"`)

    // Scaling nodes blend between then/else based on an indicator value in a range
    const scaleTicker = normalizeChoice(node.scaleTicker || 'SPY')
    const scaleMetric = node.scaleMetric || 'Relative Strength Index'
    const scaleWindow = node.scaleWindow || 14
    const scaleFrom = Number(node.scaleFrom ?? 0)
    const scaleTo = Number(node.scaleTo ?? 100)

    // DEBUG: Log EVERY scaling node on first date to see what's happening
    if (ctx.decisionIndex === 0) {
      console.log(`[Scaling Node] id=${node.id}, scaleTicker="${scaleTicker}", isBranchRef=${isBranchRef(scaleTicker)}`)
    }

    // ALWAYS log for branch references on first date to verify resolution
    const isBranch = isBranchRef(scaleTicker)
    if (isBranch && ctx.decisionIndex === 0) {
      console.log(`\n[Branch Scaling] ========== First Date Debug ==========`)
      console.log(`[Branch Scaling] Node: ${node.title || node.id}`)
      console.log(`[Branch Scaling] scaleTicker: "${scaleTicker}", scaleMetric: "${scaleMetric}", scaleWindow: ${scaleWindow}`)
      console.log(`[Branch Scaling] scaleFrom: ${scaleFrom}, scaleTo: ${scaleTo}`)
      console.log(`[Branch Scaling] node.children.then exists: ${!!node.children?.then}, length: ${node.children?.then?.length ?? 0}`)
      console.log(`[Branch Scaling] node.children.else exists: ${!!node.children?.else}, length: ${node.children?.else?.length ?? 0}`)
      if (node.children?.then?.[0]) {
        console.log(`[Branch Scaling] then[0] id: ${node.children.then[0].id}, kind: ${node.children.then[0].kind}`)
      }
    }

    // FRD-021: Pass the scaling node as parent for branch reference resolution
    const val = metricAt(ctx, scaleTicker, scaleMetric, scaleWindow, node)

    // ALWAYS log result for branch references on first date
    if (isBranch && ctx.decisionIndex === 0) {
      console.log(`[Branch Scaling] metricAt result: ${val?.toFixed(6) ?? 'NULL'}`)
      console.log(`[Branch Scaling] ==========================================\n`)
    }

    // Calculate blend factor: 0 = all "then", 1 = all "else"
    // If val is below scaleFrom, blend = 0 (100% then)
    // If val is above scaleTo, blend = 1 (100% else)
    // Otherwise, linear interpolation
    // If val is null (no valid data yet), default to blend=0 (100% then branch)
    let blend = 0
    if (val != null && scaleFrom !== scaleTo) {
      if (scaleFrom < scaleTo) {
        // Normal range: scaleFrom < scaleTo (e.g., 70 to 90)
        blend = Math.max(0, Math.min(1, (val - scaleFrom) / (scaleTo - scaleFrom)))
      } else {
        // Inverted range: scaleFrom > scaleTo (e.g., 20 to 10)
        blend = Math.max(0, Math.min(1, (scaleFrom - val) / (scaleFrom - scaleTo)))
      }
    }

    const thenChildren = (node.children?.then || []).filter(Boolean)
    const elseChildren = (node.children?.else || []).filter(Boolean)

    const thenAlloc = evaluateChildren(ctx, node, 'then', thenChildren)
    const elseAlloc = evaluateChildren(ctx, node, 'else', elseChildren)

    // Blend allocations: (1 - blend) * then + blend * else
    const alloc = {}
    for (const [ticker, weight] of Object.entries(thenAlloc)) {
      alloc[ticker] = (alloc[ticker] || 0) + weight * (1 - blend)
    }
    for (const [ticker, weight] of Object.entries(elseAlloc)) {
      alloc[ticker] = (alloc[ticker] || 0) + weight * blend
    }

    return alloc
  }

  if (node.kind === 'altExit') {
    // Enter/Exit node: stateful node that tracks whether we're "entered" or "exited"
    // Entry conditions determine when to enter (go to then branch)
    // Exit conditions determine when to exit (go to else branch)
    // State persists across days via ctx.altExitState

    const entryConditions = node.entryConditions || []
    const exitConditions = node.exitConditions || []

    // Initialize state tracking if not present
    if (!ctx.altExitState) ctx.altExitState = {}
    const nodeId = node.id || 'unknown'
    const isEntered = ctx.altExitState[nodeId] ?? false

    // Evaluate conditions
    const entryLogic = node.entryConditionLogic || 'and'
    const exitLogic = node.exitConditionLogic || 'and'

    // FRD-021: Pass node as parentNode for branch reference resolution in conditions
    const entryMet = entryConditions.length > 0 ? evaluateConditions(ctx, entryConditions, entryLogic, node) : false
    const exitMet = exitConditions.length > 0 ? evaluateConditions(ctx, exitConditions, exitLogic, node) : false

    // State machine:
    // - If not entered and entry conditions met → enter (then branch)
    // - If entered and exit conditions met → exit (else branch)
    // - Otherwise maintain current state
    let newState = isEntered
    if (!isEntered && entryMet === true) {
      newState = true // Enter
    } else if (isEntered && exitMet === true) {
      newState = false // Exit
    }

    // Update state
    ctx.altExitState[nodeId] = newState

    // Choose branch based on current state
    const branch = newState ? 'then' : 'else'
    const children = (node.children?.[branch] || []).filter(Boolean)
    return evaluateChildren(ctx, node, branch, children)
  }

  if (node.kind === 'numbered') {
    const items = node.numbered?.items || []
    // Evaluate each item's conditions
    const itemTruth = items.map((item, idx) => {
      const conditions = item.conditions || []
      if (conditions.length === 0) return false
      // Evaluate using standard boolean precedence: AND binds tighter than OR
      let currentAnd = null
      const orTerms = []
      for (const c of conditions) {
        // FRD-021: Pass node as parentNode for branch reference resolution in conditions
        const v = evaluateCondition(ctx, c, node)
        if (v == null) return false // Missing data = false
        const t = c.type === 'or' ? 'or' : c.type === 'and' ? 'and' : 'if'
        if (t === 'if') {
          if (currentAnd !== null) orTerms.push(currentAnd)
          currentAnd = v
          continue
        }
        if (currentAnd === null) {
          currentAnd = v
          continue
        }
        if (t === 'and') {
          currentAnd = currentAnd && v
          continue
        }
        if (t === 'or') {
          orTerms.push(currentAnd)
          currentAnd = v
          continue
        }
        currentAnd = v
      }
      if (currentAnd !== null) orTerms.push(currentAnd)
      return orTerms.some(Boolean)
    })

    const nTrue = itemTruth.filter(Boolean).length
    const q = node.numbered?.quantifier ?? 'all'
    const n = Math.max(0, Math.floor(Number(node.numbered?.n ?? 0)))

    // Handle ladder mode: select ladder-N slot based on how many conditions are true
    if (q === 'ladder') {
      const slotKey = `ladder-${nTrue}`
      const children = (node.children?.[slotKey] || []).filter(Boolean)
      return evaluateChildren(ctx, node, slotKey, children)
    }

    const ok =
      q === 'any'
        ? nTrue >= 1
        : q === 'all'
          ? nTrue === items.length
          : q === 'none'
            ? nTrue === 0
            : q === 'exactly'
              ? nTrue === n
              : q === 'atLeast'
                ? nTrue >= n
                : nTrue <= n // atMost

    const branch = ok ? 'then' : 'else'
    const children = (node.children?.[branch] || []).filter(Boolean)
    return evaluateChildren(ctx, node, branch, children)
  }

  return {}
}

const evaluateChildren = (ctx, node, slot, children) => {
  if (children.length === 0) return {}

  const { mode, volWindow, cappedFallback, minCap, maxCap } = getSlotConfig(node, slot)
  const childAllocs = children.map((c) => evaluateNode(ctx, c))

  // Filter to only active children (those with non-empty allocations)
  // Empty branches should "flow through" - their weight redistributes to remaining active children
  const active = children
    .map((child, idx) => ({ child, alloc: childAllocs[idx], origIdx: idx }))
    .filter((x) => Object.keys(x.alloc).length > 0)

  // If no active children, return empty (becomes cash)
  if (active.length === 0) return {}

  // Calculate weights based on mode (using ACTIVE children count)
  let weights
  if (mode === 'equal') {
    weights = active.map(() => 1 / active.length)
  } else if (mode === 'defined') {
    const definedWeights = active.map((x) => Number(x.child.window || 0))
    const total = definedWeights.reduce((a, b) => a + b, 0)
    weights = total > 0 ? definedWeights.map((w) => w / total) : active.map(() => 1 / active.length)
  } else if (mode === 'inverse' || mode === 'pro') {
    // Volatility-based weighting
    const vols = active.map((x) => {
      const tickers = Object.keys(x.alloc)
      if (tickers.length === 0) return null
      const avgVol = tickers.reduce((sum, t) => {
        const closes = getCachedCloseArray(ctx.cache, ctx.db, t)
        const rets = closes.map((v, idx) => {
          if (idx === 0) return NaN
          const prev = closes[idx - 1]
          if (Number.isNaN(prev) || Number.isNaN(v) || prev === 0) return NaN
          return v / prev - 1
        })
        const stdSeries = rollingStdDev(rets, volWindow)
        const v = stdSeries[ctx.indicatorIndex]
        return sum + (v ?? 0)
      }, 0) / tickers.length
      return avgVol
    })

    if (vols.some((v) => v == null || v <= 0)) {
      weights = active.map(() => 1 / active.length)
    } else {
      if (mode === 'inverse') {
        const invVols = vols.map((v) => 1 / v)
        const total = invVols.reduce((a, b) => a + b, 0)
        weights = invVols.map((v) => v / total)
      } else {
        const total = vols.reduce((a, b) => a + b, 0)
        weights = vols.map((v) => v / total)
      }
    }
  } else {
    weights = active.map(() => 1 / active.length)
  }

  // ========== Apply min/max caps ==========
  if (mode === 'capped' || mode === 'inverse' || mode === 'pro') {
    // Step 1: Apply caps to each weight
    let cappedWeights = weights.map(w => Math.max(minCap, Math.min(maxCap, w)))
    let cappedTotal = cappedWeights.reduce((a, b) => a + b, 0)

    // Step 2: Handle min cap overflow (normalize down if total > 100%)
    if (cappedTotal > 1.0) {
      cappedWeights = cappedWeights.map(w => w / cappedTotal)
      cappedTotal = 1.0
    }

    if (mode === 'capped') {
      // Capped mode: excess goes to fallback ticker
      const excess = 1 - cappedTotal
      weights = cappedWeights

      if (excess > 0.001 && cappedFallback && cappedFallback !== 'Empty') {
        // Add fallback allocation and early return
        const combined = {}
        for (let i = 0; i < active.length; i++) {
          const alloc = active[i].alloc
          const weight = weights[i]
          for (const [ticker, w] of Object.entries(alloc)) {
            combined[ticker] = (combined[ticker] || 0) + w * weight
          }
        }
        combined[cappedFallback] = (combined[cappedFallback] || 0) + excess
        return combined
      }
    } else {
      // Inverse/Pro mode: redistribute excess proportionally among uncapped positions
      if (cappedTotal < 0.999) {
        // Find positions that can still grow (not at max cap yet)
        const canGrow = weights.map((w, i) => {
          const isCapped = cappedWeights[i] >= maxCap - 0.0001 // Allow small epsilon
          return !isCapped ? i : -1
        }).filter(i => i >= 0)

        if (canGrow.length > 0) {
          const excess = 1 - cappedTotal
          const growthTotal = canGrow.reduce((sum, i) => sum + weights[i], 0)

          // Distribute excess proportionally
          canGrow.forEach(i => {
            const share = excess * (weights[i] / growthTotal)
            cappedWeights[i] = Math.min(maxCap, cappedWeights[i] + share)
          })
        }
        // Note: If all positions are maxed out and total < 100%, the shortfall becomes cash
      }
      weights = cappedWeights
    }
  }
  // ========== END: Apply min/max caps ==========

  // Combine allocations from active children only
  const combined = {}
  for (let i = 0; i < active.length; i++) {
    const alloc = active[i].alloc
    const weight = weights[i]
    for (const [ticker, w] of Object.entries(alloc)) {
      combined[ticker] = (combined[ticker] || 0) + w * weight
    }
  }

  return combined
}

// Expand ratio ticker into component tickers for fetching
// "SPY/XLU" -> ["SPY", "XLU"], "SPY" -> ["SPY"]
const expandTickerComponents = (ticker) => {
  const ratio = parseRatioTicker(ticker)
  if (ratio) return [ratio.numerator, ratio.denominator]
  const norm = normalizeChoice(ticker)
  return norm === 'Empty' ? [] : [norm]
}

// Add a ticker (and its ratio components) to the set
const addTickerWithComponents = (tickers, ticker) => {
  const t = normalizeChoice(ticker)
  if (t === 'Empty') return
  for (const component of expandTickerComponents(t)) {
    tickers.add(component)
  }
}

// Walk ALL children of a node (including ladder slots for numbered nodes)
const walkAllChildren = (n, callback) => {
  if (!n || !n.children) return
  for (const slot of Object.keys(n.children)) {
    for (const child of n.children[slot] || []) {
      if (child) callback(child)
    }
  }
}

// Collect only position tickers (used for function node ranking calculations)
const collectPositionTickers = (node) => {
  const tickers = new Set()
  const walk = (n) => {
    if (!n) return
    if (n.kind === 'position') {
      for (const p of n.positions || []) {
        const t = normalizeChoice(p)
        if (t !== 'Empty') tickers.add(t)
      }
    }
    walkAllChildren(n, walk)
  }
  walk(node)
  return Array.from(tickers)
}

// Collect INDICATOR tickers only (conditions, scaling, function nodes - NOT positions)
// These are used for date intersection since they need longer history for lookback
const collectIndicatorTickers = (node) => {
  const tickers = new Set()

  const addConditionTickers = (conditions) => {
    for (const cond of conditions || []) {
      // FRD-021: Skip branch references - they're computed from child equity, not external tickers
      if (cond.ticker && !isBranchRef(cond.ticker)) {
        addTickerWithComponents(tickers, cond.ticker)
      }
      if (cond.rightTicker && !isBranchRef(cond.rightTicker)) {
        addTickerWithComponents(tickers, cond.rightTicker)
      }
    }
  }

  const walk = (n) => {
    if (!n) return

    // Indicator nodes - collect condition tickers
    if (n.kind === 'indicator' && n.conditions) {
      addConditionTickers(n.conditions)
    }

    // Numbered nodes - collect condition tickers from all items
    if (n.kind === 'numbered' && n.numbered?.items) {
      for (const item of n.numbered.items) {
        addConditionTickers(item.conditions)
      }
    }

    // Scaling nodes - collect scale ticker
    if (n.kind === 'scaling') {
      // FRD-021: Skip branch references - they're computed from child equity, not external tickers
      if (n.scaleTicker && !isBranchRef(n.scaleTicker)) {
        addTickerWithComponents(tickers, n.scaleTicker)
      }
      addConditionTickers(n.conditions)
    }

    // Alt Exit nodes - collect entry/exit condition tickers
    if (n.kind === 'altExit') {
      addConditionTickers(n.entryConditions)
      addConditionTickers(n.exitConditions)
    }

    // Function nodes - collect ticker if specified for ranking
    if (n.kind === 'function' && n.ticker) {
      addTickerWithComponents(tickers, n.ticker)
    }

    // Recursively walk ALL children (including ladder slots)
    walkAllChildren(n, walk)
  }

  walk(node)
  return Array.from(tickers)
}

// Collect ALL tickers from a strategy: positions, conditions, scaling, function nodes, etc.
const collectAllTickers = (node) => {
  const tickers = new Set()

  const addConditionTickers = (conditions) => {
    for (const cond of conditions || []) {
      // FRD-021: Skip branch references - they're computed from child equity, not external tickers
      if (cond.ticker && !isBranchRef(cond.ticker)) {
        addTickerWithComponents(tickers, cond.ticker)
      }
      if (cond.rightTicker && !isBranchRef(cond.rightTicker)) {
        addTickerWithComponents(tickers, cond.rightTicker)
      }
    }
  }

  const walk = (n) => {
    if (!n) return

    // Position nodes - collect position tickers
    if (n.kind === 'position') {
      for (const p of n.positions || []) {
        addTickerWithComponents(tickers, p)
      }
    }

    // Indicator nodes - collect condition tickers
    if (n.kind === 'indicator' && n.conditions) {
      addConditionTickers(n.conditions)
    }

    // Numbered nodes - collect condition tickers from all items
    if (n.kind === 'numbered' && n.numbered?.items) {
      for (const item of n.numbered.items) {
        addConditionTickers(item.conditions)
      }
    }

    // Scaling nodes - collect scale ticker
    if (n.kind === 'scaling') {
      // FRD-021: Skip branch references - they're computed from child equity, not external tickers
      if (n.scaleTicker && !isBranchRef(n.scaleTicker)) {
        addTickerWithComponents(tickers, n.scaleTicker)
      }
      // Also check conditions array (used in UI display)
      addConditionTickers(n.conditions)
    }

    // Alt Exit nodes - collect entry/exit condition tickers
    if (n.kind === 'altExit') {
      addConditionTickers(n.entryConditions)
      addConditionTickers(n.exitConditions)
    }

    // Function nodes - collect ticker if specified for ranking
    if (n.kind === 'function' && n.ticker) {
      addTickerWithComponents(tickers, n.ticker)
    }

    // Recursively walk ALL children (including ladder slots)
    walkAllChildren(n, walk)
  }

  walk(node)
  return Array.from(tickers)
}

// ============================================
// BACKTEST METRICS
// ============================================

const computeMetrics = (equity, returns) => {
  const days = returns.length
  const final = equity.length ? equity[equity.length - 1] : 1
  const cagr = days > 0 && final > 0 ? Math.pow(final, 252 / days) - 1 : 0

  let peak = -Infinity
  let maxDd = 0
  for (const v of equity) {
    if (v > peak) peak = v
    if (peak > 0) {
      const dd = v / peak - 1
      if (dd < maxDd) maxDd = dd
    }
  }

  const mean = days > 0 ? returns.reduce((a, b) => a + b, 0) / days : 0
  const variance = days > 1 ? returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (days - 1) : 0
  const std = Math.sqrt(Math.max(0, variance))
  const sharpe = std > 0 ? (Math.sqrt(252) * mean) / std : 0

  // Sortino
  const downsideSquaredSum = returns.reduce((sum, r) => sum + (r < 0 ? r * r : 0), 0)
  const downsideVariance = returns.length > 1 ? downsideSquaredSum / (returns.length - 1) : 0
  const downsideStd = Math.sqrt(Math.max(0, downsideVariance))
  const annualizedDownsideStd = downsideStd * Math.sqrt(252)
  const annualizedMean = mean * 252
  const sortino = annualizedDownsideStd > 0 ? annualizedMean / annualizedDownsideStd : 0

  // Volatility
  const vol = std * Math.sqrt(252)

  // Calmar
  const calmar = maxDd < 0 ? cagr / Math.abs(maxDd) : 0

  return { cagr, maxDrawdown: maxDd, sharpe, sortino, calmar, volatility: vol, days }
}

const turnoverFraction = (prevAlloc, alloc) => {
  const allTickers = new Set([...Object.keys(prevAlloc), ...Object.keys(alloc)])
  let changed = 0
  for (const t of allTickers) {
    changed += Math.abs((alloc[t] || 0) - (prevAlloc[t] || 0))
  }
  return changed / 2
}

// Calculate Time in Market (TIM) as percentage of days invested in non-cash assets
const calculateTIM = (dailyAllocations) => {
  if (dailyAllocations.length === 0) return 0

  let daysInMarket = 0
  for (const { entries } of dailyAllocations) {
    // Check if any non-cash position has weight
    let hasMarketPosition = false
    for (const { ticker, weight } of entries) {
      // Consider invested if ticker is not BIL, Empty, or has 0 weight
      const normalizedTicker = ticker.toUpperCase().trim()
      if (weight > 0 && normalizedTicker !== 'BIL' && normalizedTicker !== 'EMPTY') {
        hasMarketPosition = true
        break
      }
    }
    if (hasMarketPosition) daysInMarket++
  }

  return daysInMarket / dailyAllocations.length
}

// ============================================
// MAIN BACKTEST FUNCTION
// ============================================

// Export cache initialization function for server startup
// Clear ticker data cache (for admin cache invalidation)
function clearTickerDataCache() {
  const count = tickerDataCache.size
  tickerDataCache.clear()
  cacheInitialized = false
  console.log(`[Backtest] Cleared ticker data cache (${count} entries)`)
  return count
}

export { initTickerCache, clearTickerDataCache }

// ============================================
// PRICE DATABASE CACHE - Cache built price databases to avoid rebuilding for each backtest
// ============================================
const priceDbCache = new Map()
const MAX_PRICE_DB_CACHE_SIZE = 50

function getPriceDbCacheKey(tickers, indicatorTickers, limit) {
  const sortedTickers = [...tickers].sort().join(',')
  const sortedIndicators = [...indicatorTickers].sort().join(',')
  return `${sortedTickers}|${sortedIndicators}|${limit}`
}

function clearPriceDbCache() {
  const count = priceDbCache.size
  priceDbCache.clear()
  console.log(`[Backtest] Cleared price DB cache (${count} entries)`)
  return count
}

export async function runBacktest(payload, options = {}) {
  console.log(`[Backtest] >>> runBacktest called`)
  const backtestMode = options.mode || 'OC' // OO, CC, CO, OC
  const costBps = options.costBps ?? 0
  const indicatorOverlays = options.indicatorOverlays || [] // Conditions to show as chart overlays
  const customIndicators = options.customIndicators || [] // FRD-035: Custom indicators
  const splitConfig = options.splitConfig // IS/OOS split configuration
  let benchmarkTicker = options.benchmarkTicker || 'SPY' // Benchmark ticker for comparison (default: SPY, can fallback if data unavailable)

  // DEBUG: Log splitConfig to verify it's being received
  console.log(`[Backtest] >>> splitConfig:`, JSON.stringify(splitConfig))
  console.log(`[Backtest] >>> benchmarkTicker:`, benchmarkTicker)

  // Parse payload if string
  const rawNode = typeof payload === 'string' ? JSON.parse(payload) : payload
  console.log(`[Backtest] >>> Parsed payload, rawNode kind=${rawNode?.kind}, has children=${!!rawNode?.children}`)

  // DEBUG: Dump all scaling nodes to verify branch:from is being received
  const dumpScalingNodes = (n, depth = 0) => {
    if (!n) return
    const indent = '  '.repeat(depth)

    // Helper to describe a branch
    const describeBranch = (b) => {
      if (!b) return 'NONE'
      if (Array.isArray(b)) {
        const first = b[0]
        return first ? `[array] first: id=${first.id}, kind=${first.kind}` : '[empty array]'
      }
      return `id=${b.id}, kind=${b.kind}`
    }

    if (n.kind === 'scaling') {
      console.log(`${indent}[DUMP] SCALING NODE: id=${n.id}, scaleTicker="${n.scaleTicker}", scaleMetric="${n.scaleMetric}", scaleWindow=${n.scaleWindow}`)
      console.log(`${indent}[DUMP]   children.then: ${describeBranch(n.children?.then)}`)
      console.log(`${indent}[DUMP]   children.else: ${describeBranch(n.children?.else)}`)
    } else if (n.kind === 'indicator' && n.conditions) {
      // Check for branch refs in conditions
      const branchConditions = n.conditions.filter(c => c.ticker?.startsWith('branch:') || c.rightTicker?.startsWith('branch:'))
      if (branchConditions.length > 0) {
        console.log(`${indent}[DUMP] INDICATOR NODE with branch refs: id=${n.id}`)
        branchConditions.forEach(c => {
          console.log(`${indent}[DUMP]   condition: ticker="${c.ticker}", rightTicker="${c.rightTicker}"`)
        })
      }
    }
    // Recurse into children
    if (n.children) {
      if (Array.isArray(n.children)) {
        n.children.forEach(c => dumpScalingNodes(c, depth + 1))
      } else {
        const recurse = (slot) => {
          if (!slot) return
          if (Array.isArray(slot)) slot.forEach(c => dumpScalingNodes(c, depth + 1))
          else dumpScalingNodes(slot, depth + 1)
        }
        recurse(n.children.then)
        recurse(n.children.else)
        recurse(n.children.pass)
        recurse(n.children.fail)
        recurse(n.children.next)
      }
    }
    if (n.incantations) {
      n.incantations.forEach((inc, i) => dumpScalingNodes(inc, depth + 1))
    }
  }
  console.log(`[DUMP] ========== RAW PAYLOAD BEFORE COMPRESSION ==========`)
  dumpScalingNodes(rawNode)
  console.log(`[DUMP] ========== END RAW PAYLOAD ==========`)

  console.log(`[Backtest] >>> Starting compression...`)
  const compressionStart = Date.now()
  const { tree: node, tickerLocations, stats: compressionStats } = compressTree(rawNode)
  const compressionTime = Date.now() - compressionStart
  console.log(`[Backtest] Tree compression: ${compressionStats.originalNodes} → ${compressionStats.compressedNodes} nodes (${compressionStats.nodesRemoved} removed, ${compressionStats.gateChainsMerged} gates merged) in ${compressionTime}ms`)

  if (!node) {
    // Tree was completely pruned - likely all position nodes are empty
    throw new Error('Strategy tree contains no valid positions. Please add at least one ticker to a position node (e.g., SPY, QQQ, etc.) to run a backtest.')
  }

  // Collect all tickers from the strategy (positions + conditions + scaling + ratio components)
  const tickers = collectAllTickers(node)
  if (tickers.length === 0) {
    throw new Error('No tickers found in strategy')
  }

  // Collect indicator tickers separately (conditions, scaling, function nodes - NOT positions)
  // These determine the date intersection since they need longer history for lookback
  const indicatorTickers = collectIndicatorTickers(node)

  // Always include benchmark ticker for Treynor ratio and as fallback indicator ticker
  if (!tickers.includes(benchmarkTicker)) {
    tickers.push(benchmarkTicker)
  }
  if (!indicatorTickers.includes(benchmarkTicker)) {
    indicatorTickers.push(benchmarkTicker)
  }

  // Add tickers from indicator overlays (conditions to display on chart)
  for (const cond of indicatorOverlays) {
    const t = getSeriesKey(cond.ticker)
    if (t && t !== "Empty" && !tickers.includes(t)) {
      tickers.push(t)
      indicatorTickers.push(t)
    }
    if (cond.expanded && cond.rightTicker) {
      const rt = getSeriesKey(cond.rightTicker)
      if (rt && rt !== "Empty" && !tickers.includes(rt)) {
        tickers.push(rt)
        indicatorTickers.push(rt)
      }
    }
  }

  // Load price data and build database (with caching for performance)
  const limit = 20000
  const cacheKey = getPriceDbCacheKey(tickers, indicatorTickers, limit)

  let db = priceDbCache.get(cacheKey)
  if (db) {
    console.log(`[Backtest] Using cached price database (${tickers.length} tickers, ${db.dates.length} dates)`)
  } else {
    console.log(`[Backtest] Building price database (${tickers.length} tickers)...`)
    const loadStart = Date.now()

    const loaded = await Promise.all(
      tickers.map(async (t) => {
        try {
          const bars = await fetchOhlcSeries(t, limit)
          return { ticker: t, bars }
        } catch (err) {
          console.warn(`[Backtest] Failed to load ${t}:`, err.message)
          return { ticker: t, bars: [] }
        }
      })
    )

    // Use indicator tickers for date intersection to get longer history for lookback calculations
    // Position tickers may have shorter history but get null values before their data starts
    db = buildPriceDb(loaded.filter(l => l.bars.length > 0), indicatorTickers)

    const loadTime = Date.now() - loadStart
    console.log(`[Backtest] Price database built in ${loadTime}ms (${db.dates.length} dates)`)

    // Cache the database for reuse
    priceDbCache.set(cacheKey, db)

    // Limit cache size
    if (priceDbCache.size > MAX_PRICE_DB_CACHE_SIZE) {
      const firstKey = priceDbCache.keys().next().value
      priceDbCache.delete(firstKey)
    }
  }

  // Validate benchmark ticker has data, fallback to SPY if not
  const hasBenchmarkData = db.open[benchmarkTicker] &&
                           db.close[benchmarkTicker] &&
                           db.adjClose[benchmarkTicker]

  if (!hasBenchmarkData && benchmarkTicker !== 'SPY') {
    console.warn(`[Backtest] Benchmark ticker ${benchmarkTicker} has no data, falling back to SPY`)
    benchmarkTicker = 'SPY'

    // Verify SPY data exists as final fallback
    const hasSPYData = db.open['SPY'] && db.close['SPY'] && db.adjClose['SPY']
    if (!hasSPYData) {
      console.warn(`[Backtest] SPY fallback also has no data - benchmark curve will be empty`)
    }
  }

  if (db.dates.length < 3) {
    throw new Error('Not enough overlapping price data to run a backtest')
  }

  // Find first index where ALL position tickers have valid price data
  // This ensures we don't allocate to tickers before they have data
  const positionTickers = collectPositionTickers(node)
  let firstValidPosIndex = 0
  if (positionTickers.length > 0) {
    for (let i = 0; i < db.dates.length; i++) {
      let allValid = true
      for (const ticker of positionTickers) {
        const t = getSeriesKey(ticker)
        if (t === 'Empty') continue
        const closeVal = db.close[t]?.[i]
        if (closeVal == null) {
          allValid = false
          break
        }
      }
      if (allValid) {
        firstValidPosIndex = i
        break
      }
    }
  }

  // Run backtest
  const cache = emptyCache()
  const decisionPrice = backtestMode === 'CC' || backtestMode === 'CO' ? 'close' : 'open'

  const allocationsAt = Array.from({ length: db.dates.length }, () => ({}))

  // Calculate lookback based on indicators used (momentum indicators need 252 days)
  const regularLookback = Math.max(50, collectMaxLookback(node))

  // Branch lookback: indicators using branch:from/to need extra warmup because
  // the branch equity curve must be calculated FIRST, then the indicator needs
  // additional history on top of that. This applies to ALL node types.
  const branchLookback = collectBranchLookbacks(node)

  // Ratio lookbacks: ratio tickers (like SPY/AGG) need both components to have
  // valid data before the ratio can be calculated. Each ratio has its own
  // firstValidIndex + lookback requirement.
  const ratioLookbacks = collectRatioLookbacks(node, db)

  // Calculate effective start index considering all constraints:
  // 1. Regular lookback (for normal indicators)
  // 2. firstValidPosIndex + branchLookback (branch refs need extra warmup AFTER position data is available)
  // 3. Each ratio's firstValidIndex + lookback
  let startEvalIndex = Math.max(
    decisionPrice === 'open' ? (regularLookback > 0 ? regularLookback + 1 : 0) : regularLookback,
    firstValidPosIndex + branchLookback  // Branch references need extra warmup AFTER position tickers have data
  )

  // Also check ratio constraints - each ratio has its own first valid index + lookback
  for (const { firstValidIndex, lookback } of ratioLookbacks) {
    const ratioStart = decisionPrice === 'open' ? firstValidIndex + lookback + 1 : firstValidIndex + lookback
    startEvalIndex = Math.max(startEvalIndex, ratioStart)
  }

  console.log(`[WARMUP] regularLookback=${regularLookback}, branchLookback=${branchLookback}, firstValidPosIndex=${firstValidPosIndex}, ratioCount=${ratioLookbacks.length}, startEvalIndex=${startEvalIndex}`)

  // Persistent state for altExit (Enter/Exit) nodes across all days
  const altExitState = {}

  // Track which days have valid scaling data (no null fallbacks)
  const hasValidScalingData = new Array(db.dates.length).fill(true)

  for (let i = startEvalIndex; i < db.dates.length; i++) {
    const indicatorIndex = decisionPrice === 'open' ? i - 1 : i
    const ctx = {
      db,
      cache,
      decisionIndex: i,
      indicatorIndex,
      decisionPrice,
      warnings: [],
      tickerLocations, // Pre-computed ticker locations for O(1) lookup
      altExitState, // Persist Enter/Exit state across days
      usedScalingFallback: false, // Track if any scaling node used null fallback
      customIndicators, // FRD-035: Custom indicators for formula evaluation
    }
    allocationsAt[i] = evaluateNode(ctx, node)
    hasValidScalingData[i] = !ctx.usedScalingFallback
  }

  // Calculate equity curve
  // Find first day with non-empty allocation (skip days where indicators don't have enough data)
  let startTradeIndex = startEvalIndex
  for (let i = startEvalIndex; i < db.dates.length; i++) {
    const alloc = allocationsAt[i]
    if (alloc && Object.keys(alloc).length > 0) {
      startTradeIndex = i
      break
    }
  }
  const startPointIndex = backtestMode === 'OC' ? Math.max(0, startTradeIndex - 1) : startTradeIndex
  const points = [{ time: db.dates[startPointIndex], value: 1 }]
  const returns = []
  const benchmarkReturns = [] // For Treynor ratio
  const dailyAllocations = [] // For allocations tab
  let totalTurnover = 0
  let turnoverCount = 0
  let totalHoldings = 0
  let holdingsCount = 0
  let winDays = 0
  let lossDays = 0
  let bestDay = -Infinity
  let worstDay = Infinity

  let equity = 1
  let peak = 1
  let benchmarkEquity = 1  // For benchmark curve
  const benchmarkPoints = [{ time: db.dates[startPointIndex], value: 1 }]
  const startEnd = backtestMode === 'OC' ? startTradeIndex : startTradeIndex + 1

  for (let end = startEnd; end < db.dates.length; end++) {
    let start = end - 1
    if (backtestMode === 'OC') start = end
    if (start < 0 || start >= db.dates.length) continue
    if (backtestMode === 'OC' && end === 0) continue

    const alloc = allocationsAt[start] || {}
    const prevAlloc = start - 1 >= 0 ? allocationsAt[start - 1] || {} : {}
    const turnover = turnoverFraction(prevAlloc, alloc)
    const cost = (Math.max(0, costBps) / 10000) * turnover

    // Track turnover
    totalTurnover += turnover
    turnoverCount++

    // Track holdings count
    const holdingsThisDay = Object.values(alloc).filter(w => w > 0).length
    totalHoldings += holdingsThisDay
    holdingsCount++

    // Store daily allocation for allocations tab (use start date = entry/holding date, matching QuantMage)
    const dateStr = safeIsoDate(db.dates[start])
    // Transform alloc object to entries array for frontend
    const entries = Object.entries(alloc)
      .filter(([_, weight]) => weight > 0)
      .map(([ticker, weight]) => ({ ticker, weight }))
    dailyAllocations.push({ date: dateStr, entries })

    let gross = 0
    for (const [ticker, w] of Object.entries(alloc)) {
      if (!(w > 0)) continue
      const t = getSeriesKey(ticker)
      const openArr = db.open[t]
      const closeArr = db.close[t]
      const adjCloseArr = db.adjClose[t]

      let entry, exit
      if (backtestMode === 'OO') {
        // OO mode: Use actual open prices
        entry = openArr?.[start]
        exit = openArr?.[end]
      } else if (backtestMode === 'CC') {
        // CC mode: Use adjClose for dividend-adjusted returns
        entry = adjCloseArr?.[start]
        exit = adjCloseArr?.[end]
      } else if (backtestMode === 'CO') {
        // CO mode: Use actual close/open prices
        entry = closeArr?.[start]
        exit = openArr?.[end]
      } else { // OC
        // OC mode: Use actual open/close prices
        entry = openArr?.[start]
        exit = closeArr?.[start]
      }

      if (entry == null || exit == null || !(entry > 0) || !(exit > 0)) {
        continue
      }
      gross += w * (exit / entry - 1)
    }

    // Calculate benchmark return for Treynor ratio
    const benchOpen = db.open[benchmarkTicker]
    const benchClose = db.close[benchmarkTicker]
    const benchAdjClose = db.adjClose[benchmarkTicker]
    let benchRet = 0
    if (benchOpen && benchClose && benchAdjClose) {
      let benchEntry, benchExit
      if (backtestMode === 'OO') {
        benchEntry = benchOpen[start]
        benchExit = benchOpen[end]
      } else if (backtestMode === 'CC') {
        // CC mode: Use adjClose for dividend-adjusted benchmark
        benchEntry = benchAdjClose[start]
        benchExit = benchAdjClose[end]
      } else if (backtestMode === 'CO') {
        benchEntry = benchClose[start]
        benchExit = benchOpen[end]
      } else { // OC
        benchEntry = benchOpen[start]
        benchExit = benchClose[start]
      }
      if (benchEntry > 0 && benchExit > 0) {
        benchRet = benchExit / benchEntry - 1
      }
    }
    benchmarkReturns.push(benchRet)

    // Accumulate benchmark equity for benchmark curve
    benchmarkEquity *= 1 + benchRet
    benchmarkPoints.push({ time: db.dates[end], value: benchmarkEquity })

    if (!Number.isFinite(gross)) gross = 0

    let net = gross - cost
    if (!Number.isFinite(net) || net < -0.9999) net = 0

    // Track win/loss days and best/worst
    if (net > 0) winDays++
    else if (net < 0) lossDays++
    if (net > bestDay) bestDay = net
    if (net < worstDay) worstDay = net

    equity *= 1 + net
    if (equity > peak) peak = equity

    points.push({ time: db.dates[end], value: equity })
    returns.push(net)
  }

  // Compute summary metrics
  const equityValues = points.map(p => p.value)
  const metrics = computeMetrics(equityValues, returns)

  // Compute Treynor ratio (beta-adjusted return) and Beta
  let treynorRatio = 0
  let beta = 0
  if (benchmarkReturns.length > 1 && returns.length > 1) {
    const meanRet = returns.reduce((a, b) => a + b, 0) / returns.length
    const meanBench = benchmarkReturns.reduce((a, b) => a + b, 0) / benchmarkReturns.length
    let cov = 0
    let varBench = 0
    for (let i = 0; i < returns.length; i++) {
      cov += (returns[i] - meanRet) * (benchmarkReturns[i] - meanBench)
      varBench += (benchmarkReturns[i] - meanBench) ** 2
    }
    beta = varBench > 0 ? cov / varBench : 0
    if (beta > 0) {
      treynorRatio = (metrics.cagr) / beta
    }
  }

  // Compute additional metrics
  const avgTurnover = turnoverCount > 0 ? totalTurnover / turnoverCount : 0
  const avgHoldings = holdingsCount > 0 ? totalHoldings / holdingsCount : 0
  const winRate = (winDays + lossDays) > 0 ? winDays / (winDays + lossDays) : 0

  // Compute IS/OOS metrics if split is enabled
  let isMetrics = null
  let oosMetrics = null
  let chronologicalThresholdDate = null  // Declare at higher scope for use in IS/OOS data splits
  console.log(`[Backtest] >>> Checking IS/OOS split - enabled: ${splitConfig?.enabled}, strategy: ${splitConfig?.strategy}, percent: ${splitConfig?.chronologicalPercent}`)
  if (splitConfig?.enabled) {
    console.log(`[Backtest] >>> IS/OOS split is ENABLED, proceeding with split calculation`)
    // Extract all timestamps from the equity curve
    const allTimestamps = points.map(p => p.time)

    // For chronological strategy, calculate the split date based on percentage OR use direct splitDate
    if (splitConfig.strategy === 'chronological' && splitConfig.chronologicalPercent) {
      // Sort timestamps to get date range
      const sortedTimestamps = [...allTimestamps].sort((a, b) => a - b)
      const startTime = sortedTimestamps[0]
      const endTime = sortedTimestamps[sortedTimestamps.length - 1]

      // Calculate threshold based on percentage (50% = halfway through data)
      const percent = splitConfig.chronologicalPercent / 100
      const thresholdTime = startTime + (endTime - startTime) * percent

      // Convert to date string for splitDates function (expects YYYY-MM-DD)
      const thresholdDate = new Date(thresholdTime * 1000)
      chronologicalThresholdDate = thresholdDate.toISOString().split('T')[0]

      console.log(`[Backtest] >>> SPLIT CALCULATION:`)
      console.log(`[Backtest]   - Total data points: ${allTimestamps.length}`)
      console.log(`[Backtest]   - Start time: ${startTime} (${new Date(startTime * 1000).toISOString()})`)
      console.log(`[Backtest]   - End time: ${endTime} (${new Date(endTime * 1000).toISOString()})`)
      console.log(`[Backtest]   - Split percent: ${splitConfig.chronologicalPercent}%`)
      console.log(`[Backtest]   - Threshold date: ${chronologicalThresholdDate}`)
    } else if (splitConfig.splitDate) {
      // Use direct splitDate (for shard-generated strategies)
      chronologicalThresholdDate = splitConfig.splitDate
      console.log(`[Backtest] >>> SPLIT CALCULATION (direct date):`)
      console.log(`[Backtest]   - Using splitDate: ${chronologicalThresholdDate}`)
    }

    // Split dates using the configured strategy
    console.log(`[Backtest] >>> Calling splitDates with strategy=${splitConfig.strategy}, thresholdDate=${chronologicalThresholdDate}`)
    const { isDates, oosDates } = splitDates(
      allTimestamps,
      splitConfig.strategy,
      chronologicalThresholdDate
    )
    console.log(`[Backtest] >>> splitDates returned: IS=${isDates.size} dates, OOS=${oosDates.size} dates`)

    // Filter equity points and returns for IS
    // Note: points has 1 more element than returns (initial equity point), so iterate up to returns.length
    const isIndices = []
    const isEquityValues = []
    const isReturns = []
    const isBenchmarkReturns = []
    for (let i = 0; i < points.length; i++) {
      if (isDates.has(points[i].time)) {
        isIndices.push(i)
        isEquityValues.push(points[i].value)
        // Only push returns if they exist (returns array is 1 shorter than points)
        if (i < returns.length) {
          isReturns.push(returns[i])
          isBenchmarkReturns.push(benchmarkReturns[i])
        }
      }
    }

    // Filter equity points and returns for OOS
    // Note: points has 1 more element than returns (initial equity point), so iterate up to returns.length
    const oosIndices = []
    const oosEquityValues = []
    const oosReturns = []
    const oosBenchmarkReturns = []
    for (let i = 0; i < points.length; i++) {
      if (oosDates.has(points[i].time)) {
        oosIndices.push(i)
        oosEquityValues.push(points[i].value)
        // Only push returns if they exist (returns array is 1 shorter than points)
        if (i < returns.length) {
          oosReturns.push(returns[i])
          oosBenchmarkReturns.push(benchmarkReturns[i])
        }
      }
    }

    console.log(`[Backtest] >>> Filtered data:`)
    console.log(`[Backtest]   - IS equity points: ${isEquityValues.length}`)
    console.log(`[Backtest]   - OOS equity points: ${oosEquityValues.length}`)

    // Compute IS metrics
    if (isEquityValues.length > 0 && isReturns.length > 0) {
      const isBaseMetrics = computeMetrics(isEquityValues, isReturns)

      // Compute IS Treynor and Beta
      let isTreynor = 0
      let isBeta = 0
      if (isBenchmarkReturns.length > 1 && isReturns.length > 1) {
        const meanRet = isReturns.reduce((a, b) => a + b, 0) / isReturns.length
        const meanBench = isBenchmarkReturns.reduce((a, b) => a + b, 0) / isBenchmarkReturns.length
        let cov = 0
        let varBench = 0
        for (let i = 0; i < isReturns.length; i++) {
          cov += (isReturns[i] - meanRet) * (isBenchmarkReturns[i] - meanBench)
          varBench += (isBenchmarkReturns[i] - meanBench) ** 2
        }
        isBeta = varBench > 0 ? cov / varBench : 0
        if (isBeta > 0) {
          isTreynor = (isBaseMetrics.cagr) / isBeta
        }
      }

      // Compute IS win rate, best/worst day
      let isWinDays = 0
      let isLossDays = 0
      let isBestDay = -Infinity
      let isWorstDay = Infinity
      for (const r of isReturns) {
        if (r > 0) isWinDays++
        else if (r < 0) isLossDays++
        if (r > isBestDay) isBestDay = r
        if (r < isWorstDay) isWorstDay = r
      }
      const isWinRate = (isWinDays + isLossDays) > 0 ? isWinDays / (isWinDays + isLossDays) : 0

      // Calculate IS TIM (Time in Market) - filter dailyAllocations for IS dates
      // Note: dailyAllocations and points are built in the same loop, so indices align
      const isDailyAllocs = dailyAllocations.filter((_, idx) => {
        const pointTime = points[idx]?.time
        return pointTime && isDates.has(pointTime)
      })
      const isTIM = calculateTIM(isDailyAllocs)
      const isTIMAR = isTIM > 0 ? isBaseMetrics.cagr / isTIM : 0

      isMetrics = {
        startDate: isEquityValues.length > 0 ? safeIsoDate(points[isIndices[0]].time) : '',
        endDate: isEquityValues.length > 0 ? safeIsoDate(points[isIndices[isIndices.length - 1]].time) : '',
        days: isBaseMetrics.days,
        years: isBaseMetrics.days / 252,
        totalReturn: isEquityValues.length > 0 ? isEquityValues[isEquityValues.length - 1] - 1 : 0,
        cagr: isBaseMetrics.cagr,
        volatility: isBaseMetrics.volatility,
        maxDrawdown: isBaseMetrics.maxDrawdown,
        calmarRatio: isBaseMetrics.calmar,
        sharpeRatio: isBaseMetrics.sharpe,
        sortinoRatio: isBaseMetrics.sortino,
        treynorRatio: isTreynor,
        beta: isBeta,
        winRate: isWinRate,
        bestDay: isBestDay === -Infinity ? 0 : isBestDay,
        worstDay: isWorstDay === Infinity ? 0 : isWorstDay,
        avgTurnover: 0, // Not computed per-split (requires day-level allocation tracking)
        avgHoldings: 0, // Not computed per-split
        tim: isTIM, // Time in Market as decimal (0-1)
        timar: isTIMAR, // Time in Market Adjusted Return (CAGR/TIM)
      }
      console.log(`[Backtest] >>> IS metrics computed: CAGR=${isMetrics.cagr.toFixed(4)}, Sharpe=${isMetrics.sharpeRatio.toFixed(2)}, years=${isMetrics.years.toFixed(1)}, TIM=${(isTIM * 100).toFixed(1)}%, TIMAR=${(isTIMAR * 100).toFixed(2)}%`)
    } else {
      console.log(`[Backtest] >>> WARNING: IS metrics NOT computed (isEquityValues.length=${isEquityValues.length}, isReturns.length=${isReturns.length})`)
    }

    // Compute OOS metrics
    if (oosEquityValues.length > 0 && oosReturns.length > 0) {
      const oosBaseMetrics = computeMetrics(oosEquityValues, oosReturns)

      // DEBUG: Log all input values for OOS volatility calculation
      console.log(`[Backtest] >>> OOS VOLATILITY DEBUG:`)
      console.log(`[Backtest]     - oosReturns.length: ${oosReturns.length}`)

      // Safe formatter for returns (handles undefined, NaN, null)
      const formatReturn = r => {
        if (r === undefined) return 'undefined'
        if (r === null) return 'null'
        if (Number.isNaN(r)) return 'NaN'
        return r.toFixed(6)
      }

      console.log(`[Backtest]     - oosReturns sample (first 10): ${oosReturns.slice(0, 10).map(formatReturn).join(', ')}`)
      console.log(`[Backtest]     - oosReturns sample (last 10): ${oosReturns.slice(-10).map(formatReturn).join(', ')}`)

      // Count NaN and undefined values in oosReturns
      const nanCount = oosReturns.filter(r => Number.isNaN(r)).length
      const undefinedCount = oosReturns.filter(r => r === undefined).length
      const nullCount = oosReturns.filter(r => r === null).length
      console.log(`[Backtest]     - NaN values in oosReturns: ${nanCount}`)
      console.log(`[Backtest]     - undefined values in oosReturns: ${undefinedCount}`)
      console.log(`[Backtest]     - null values in oosReturns: ${nullCount}`)
      if (nanCount > 0 || undefinedCount > 0 || nullCount > 0) {
        const badIndices = oosReturns.map((r, i) => (Number.isNaN(r) || r === undefined || r === null) ? i : -1).filter(i => i >= 0).slice(0, 20)
        console.log(`[Backtest]     - First 20 bad value indices: ${badIndices.join(', ')}`)
      }

      console.log(`[Backtest]     - oosEquityValues.length: ${oosEquityValues.length}`)
      console.log(`[Backtest]     - oosEquityValues sample (first 10): ${oosEquityValues.slice(0, 10).map(v => v.toFixed(4)).join(', ')}`)
      console.log(`[Backtest]     - oosEquityValues sample (last 10): ${oosEquityValues.slice(-10).map(v => v.toFixed(4)).join(', ')}`)

      // Recompute volatility with debug logging
      const oosSum = oosReturns.reduce((a, b) => a + b, 0)
      console.log(`[Backtest]     - oosReturns sum: ${oosSum}`)
      const oosMean = oosSum / oosReturns.length
      const oosVariance = oosReturns.length > 1 ? oosReturns.reduce((a, b) => a + (b - oosMean) ** 2, 0) / (oosReturns.length - 1) : 0
      const oosStd = Math.sqrt(Math.max(0, oosVariance))
      const oosVol = oosStd * Math.sqrt(252)
      console.log(`[Backtest]     - Mean return: ${oosMean.toFixed(8)}`)
      console.log(`[Backtest]     - Variance: ${oosVariance.toFixed(10)}`)
      console.log(`[Backtest]     - Std dev (daily): ${oosStd.toFixed(8)}`)
      console.log(`[Backtest]     - Vol (annualized): ${oosVol.toFixed(8)}`)
      console.log(`[Backtest]     - oosBaseMetrics.volatility: ${oosBaseMetrics.volatility}`)

      // Debug Sortino calculation
      const oosDownsideSquaredSum = oosReturns.reduce((sum, r) => sum + (r < 0 ? r * r : 0), 0)
      const oosDownsideVariance = oosReturns.length > 1 ? oosDownsideSquaredSum / (oosReturns.length - 1) : 0
      const oosDownsideStd = Math.sqrt(Math.max(0, oosDownsideVariance))
      const oosAnnualizedDownsideStd = oosDownsideStd * Math.sqrt(252)
      console.log(`[Backtest]     - Downside squared sum: ${oosDownsideSquaredSum.toFixed(10)}`)
      console.log(`[Backtest]     - Downside variance: ${oosDownsideVariance.toFixed(10)}`)
      console.log(`[Backtest]     - Downside std: ${oosDownsideStd.toFixed(8)}`)
      console.log(`[Backtest]     - Annualized downside std: ${oosAnnualizedDownsideStd.toFixed(8)}`)
      console.log(`[Backtest]     - oosBaseMetrics.sortino: ${oosBaseMetrics.sortino}`)

      // Compute OOS Treynor and Beta
      let oosTreynor = 0
      let oosBeta = 0
      if (oosBenchmarkReturns.length > 1 && oosReturns.length > 1) {
        const meanRet = oosReturns.reduce((a, b) => a + b, 0) / oosReturns.length
        const meanBench = oosBenchmarkReturns.reduce((a, b) => a + b, 0) / oosBenchmarkReturns.length
        let cov = 0
        let varBench = 0
        for (let i = 0; i < oosReturns.length; i++) {
          cov += (oosReturns[i] - meanRet) * (oosBenchmarkReturns[i] - meanBench)
          varBench += (oosBenchmarkReturns[i] - meanBench) ** 2
        }
        oosBeta = varBench > 0 ? cov / varBench : 0
        if (oosBeta > 0) {
          oosTreynor = (oosBaseMetrics.cagr) / oosBeta
        }
      }

      // Compute OOS win rate, best/worst day
      let oosWinDays = 0
      let oosLossDays = 0
      let oosBestDay = -Infinity
      let oosWorstDay = Infinity
      for (const r of oosReturns) {
        if (r > 0) oosWinDays++
        else if (r < 0) oosLossDays++
        if (r > oosBestDay) oosBestDay = r
        if (r < oosWorstDay) oosWorstDay = r
      }
      const oosWinRate = (oosWinDays + oosLossDays) > 0 ? oosWinDays / (oosWinDays + oosLossDays) : 0

      // Calculate OOS TIM (Time in Market) - filter dailyAllocations for OOS dates
      // Note: dailyAllocations and points are built in the same loop, so indices align
      const oosDailyAllocs = dailyAllocations.filter((_, idx) => {
        const pointTime = points[idx]?.time
        return pointTime && oosDates.has(pointTime)
      })
      const oosTIM = calculateTIM(oosDailyAllocs)
      const oosTIMAR = oosTIM > 0 ? oosBaseMetrics.cagr / oosTIM : 0

      oosMetrics = {
        startDate: oosEquityValues.length > 0 ? safeIsoDate(points[oosIndices[0]].time) : '',
        endDate: oosEquityValues.length > 0 ? safeIsoDate(points[oosIndices[oosIndices.length - 1]].time) : '',
        days: oosBaseMetrics.days,
        years: oosBaseMetrics.days / 252,
        totalReturn: oosEquityValues.length > 0 ? oosEquityValues[oosEquityValues.length - 1] - 1 : 0,
        cagr: oosBaseMetrics.cagr,
        volatility: oosBaseMetrics.volatility,
        maxDrawdown: oosBaseMetrics.maxDrawdown,
        calmarRatio: oosBaseMetrics.calmar,
        sharpeRatio: oosBaseMetrics.sharpe,
        sortinoRatio: oosBaseMetrics.sortino,
        treynorRatio: oosTreynor,
        beta: oosBeta,
        winRate: oosWinRate,
        bestDay: oosBestDay === -Infinity ? 0 : oosBestDay,
        worstDay: oosWorstDay === Infinity ? 0 : oosWorstDay,
        avgTurnover: 0, // Not computed per-split
        avgHoldings: 0, // Not computed per-split
        tim: oosTIM, // Time in Market as decimal (0-1)
        timar: oosTIMAR, // Time in Market Adjusted Return (CAGR/TIM)
      }
      console.log(`[Backtest] >>> OOS metrics computed: CAGR=${oosMetrics.cagr.toFixed(4)}, Sharpe=${oosMetrics.sharpeRatio.toFixed(2)}, years=${oosMetrics.years.toFixed(1)}, TIM=${(oosTIM * 100).toFixed(1)}%, TIMAR=${(oosTIMAR * 100).toFixed(2)}%`)
    } else {
      console.log(`[Backtest] >>> WARNING: OOS metrics NOT computed (oosEquityValues.length=${oosEquityValues.length}, oosReturns.length=${oosReturns.length})`)
    }
  } else {
    console.log(`[Backtest] >>> IS/OOS split is DISABLED or not configured`)
  }

  // === IS/OOS SPLIT DATA FOR IN DEPTH TAB ===
  let isAllocations = []
  let oosAllocations = []
  let oosStartDate = null

  if (splitConfig?.enabled && chronologicalThresholdDate) {
    // Split allocations by date
    isAllocations = dailyAllocations.filter(a => a.date < chronologicalThresholdDate)
    oosAllocations = dailyAllocations.filter(a => a.date >= chronologicalThresholdDate)
    oosStartDate = chronologicalThresholdDate

    console.log(`[Backtest] >>> IS/OOS data split: isAllocations=${isAllocations.length}, oosAllocations=${oosAllocations.length}, oosStartDate=${oosStartDate}`)
  }

  // Create a context object for indicator lookups outside the main eval loop
  const overlayCtx = {
    db,
    cache,
    decisionIndex: db.dates.length - 1,
    indicatorIndex: db.dates.length - 1,
    decisionPrice: "close",
    warnings: [],
    tickerLocations, // Needed for branch equity simulation
  }

  // Cache for branch equity curves (avoid recomputing for same branch)
  const branchEquityCache = new Map()

  // Helper to get or compute branch equity for indicator overlays
  const getOrComputeBranchEquity = (ticker, parentNodeId) => {
    if (!isBranchRef(ticker)) return null
    if (!parentNodeId) {
      console.warn(`[Overlay] Branch reference ${ticker} missing parentNodeId, cannot resolve`)
      return null
    }

    const cacheKey = `${parentNodeId}:${ticker}`
    if (branchEquityCache.has(cacheKey)) {
      return branchEquityCache.get(cacheKey)
    }

    // Look up parent node from the raw tree
    const parentNode = findNodeById(rawNode, parentNodeId)
    if (!parentNode) {
      console.warn(`[Overlay] Could not find parent node ${parentNodeId} for branch ${ticker}`)
      branchEquityCache.set(cacheKey, null)
      return null
    }

    // Get branch child node
    const branchName = parseBranchRef(ticker)
    const branchNode = getBranchChildNode(parentNode, branchName)
    if (!branchNode) {
      console.warn(`[Overlay] Could not find branch ${branchName} in node ${parentNodeId}`)
      branchEquityCache.set(cacheKey, null)
      return null
    }

    // Simulate branch equity
    const branchEquity = simulateBranchEquity(overlayCtx, branchNode)
    branchEquityCache.set(cacheKey, branchEquity)
    return branchEquity
  }

  // Compute indicator overlay series if requested
  const overlaySeriesResult = indicatorOverlays.map((cond, idx) => {
    const OVERLAY_COLORS = ['#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316']
    const color = OVERLAY_COLORS[idx % OVERLAY_COLORS.length]

    // Helper to format indicator label
    const formatLabel = (ticker, metric, window) => {
      const WINDOWLESS = ['Current Price', 'Momentum (Weighted)', 'Momentum (Unweighted)', 'Momentum (12-Month SMA)', 'Drawdown', 'MACD Histogram', 'PPO Histogram', 'Laguerre RSI']
      const prefix = WINDOWLESS.includes(metric) ? '' : `${Math.floor(window || 0)}d `
      // For branch references, show the branch name instead of the raw ticker
      const tickerLabel = isBranchRef(ticker) ? ticker.replace('branch:', '').replace('BRANCH:', '') + ' Branch' : getSeriesKey(ticker)
      return `${prefix}${metric} of ${tickerLabel}`
    }

    // Compute left indicator series
    const leftSeries = []
    const leftBranchEquity = isBranchRef(cond.ticker) ? getOrComputeBranchEquity(cond.ticker, cond.parentNodeId) : null

    for (let i = startEvalIndex; i < db.dates.length; i++) {
      let value
      if (leftBranchEquity) {
        // Use branchMetricAt for branch equity
        value = branchMetricAt(overlayCtx, leftBranchEquity, cond.metric, cond.window, i)
      } else if (isBranchRef(cond.ticker)) {
        // Branch reference but no equity computed (error case)
        value = null
      } else {
        // Regular ticker
        value = metricAtIndex(overlayCtx, cond.ticker, cond.metric, cond.window, i)
      }
      leftSeries.push({
        date: safeIsoDate(db.dates[i]),
        value: value ?? null
      })
    }

    // Compute right indicator series if expanded mode
    let rightSeries = null
    if (cond.expanded && cond.rightTicker && cond.rightMetric) {
      rightSeries = []
      const rightBranchEquity = isBranchRef(cond.rightTicker) ? getOrComputeBranchEquity(cond.rightTicker, cond.parentNodeId) : null

      for (let i = startEvalIndex; i < db.dates.length; i++) {
        let value
        if (rightBranchEquity) {
          value = branchMetricAt(overlayCtx, rightBranchEquity, cond.rightMetric, cond.rightWindow || cond.window, i)
        } else if (isBranchRef(cond.rightTicker)) {
          value = null
        } else {
          value = metricAtIndex(overlayCtx, cond.rightTicker, cond.rightMetric, cond.rightWindow || cond.window, i)
        }
        rightSeries.push({
          date: safeIsoDate(db.dates[i]),
          value: value ?? null
        })
      }
    }

    return {
      conditionId: cond.id,
      label: formatLabel(cond.ticker, cond.metric, cond.window),
      leftSeries,
      rightSeries,
      rightLabel: cond.expanded ? formatLabel(cond.rightTicker, cond.rightMetric, cond.rightWindow || cond.window) : null,
      threshold: cond.expanded ? null : (cond.threshold ?? null),
      comparator: cond.comparator,
      color
    }
  })

  return {
    metrics: {
      cagr: metrics.cagr,
      maxDrawdown: metrics.maxDrawdown,
      calmarRatio: metrics.calmar,
      sharpeRatio: metrics.sharpe,
      sortinoRatio: metrics.sortino,
      treynorRatio,
      beta, // FRD-016: Add Beta metric
      volatility: metrics.volatility,
      winRate,
      avgTurnover,
      avgHoldings,
      bestDay: bestDay === -Infinity ? 0 : bestDay,
      worstDay: worstDay === Infinity ? 0 : worstDay,
      tradingDays: metrics.days,
    },
    isMetrics, // In-sample metrics (only if split enabled)
    oosMetrics, // Out-of-sample metrics (only if split enabled)
    oosStartDate, // OOS start date for split indicator (only if split enabled)
    equityCurve: points.map(p => ({ date: safeIsoDate(p.time), equity: p.value })),
    benchmarkCurve: benchmarkPoints.map(p => ({ date: safeIsoDate(p.time), equity: p.value })),
    // Include daily allocations for the Allocations tab
    allocations: dailyAllocations,
    // Include IS/OOS split allocations (only if split enabled)
    isAllocations: splitConfig?.enabled ? isAllocations : undefined,
    oosAllocations: splitConfig?.enabled ? oosAllocations : undefined,
    // Include indicator overlay series if requested
    indicatorOverlays: overlaySeriesResult.length > 0 ? overlaySeriesResult : undefined,
    // Include daily returns for sanity report
    dailyReturns: returns,
    // Compression stats for debugging (logged to F12 console)
    compression: {
      originalNodes: compressionStats.originalNodes,
      compressedNodes: compressionStats.compressedNodes,
      nodesRemoved: compressionStats.nodesRemoved,
      gatesMerged: compressionStats.gateChainsMerged,
      compressionTimeMs: compressionTime,
    },
  }
}
