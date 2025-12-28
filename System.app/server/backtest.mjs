/**
 * Server-side backtest engine
 * This module runs backtests on the server to protect IP (payload never sent to non-owners)
 */

import duckdb from 'duckdb'
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

const duckDbPromise = new Promise((resolve, reject) => {
  const db = new duckdb.Database(':memory:')
  db.all('SELECT 1', (err) => {
    if (err) reject(err)
    else resolve(db)
  })
})

async function fetchOhlcSeries(ticker, limit = 20000) {
  const db = await duckDbPromise
  const filePath = path.join(PARQUET_DIR, `${ticker}.parquet`)

  return new Promise((resolve, reject) => {
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
      ORDER BY Date DESC
      LIMIT ${limit}
    `
    db.all(sql, (err, rows) => {
      if (err) {
        reject(err)
        return
      }
      const sorted = rows
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
      resolve(sorted)
    })
  })
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

// John Ehlers' Ultimate Smoother - reduces lag while maintaining smoothness
const rollingUltimateSmoother = (values, period) => {
  const out = new Array(values.length).fill(null)
  const a = Math.exp(-1.414 * Math.PI / period)
  const b = 2 * a * Math.cos(1.414 * Math.PI / period)
  const c2 = b
  const c3 = -a * a
  const c1 = (1 + c2 - c3) / 4

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
    out[i] = c1 * (values[i] + 2 * values[i - 1] + values[i - 2]) + c2 * prev1 + c3 * prev2
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
const rollingStochD = (highs, lows, closes, kPeriod, dPeriod = 3) => {
  const stochK = rollingStochK(highs, lows, closes, kPeriod)
  return rollingSma(stochK.map(v => v ?? NaN), dPeriod)
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
})

const getCachedSeries = (cache, kind, ticker, period, compute) => {
  const t = getSeriesKey(ticker)
  const map = cache[kind]
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
  const datesByTicker = mapsForDates.map((m) => new Set(m.byTime.keys()))
  let common = datesByTicker[0]
  for (let i = 1; i < datesByTicker.length; i++) {
    common = new Set([...common].filter((d) => datesByTicker[i].has(d)))
  }
  const dates = [...common].sort((a, b) => a - b)

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
// METRIC CALCULATION
// ============================================

const metricAt = (ctx, ticker, metric, window) => {
  const t = getSeriesKey(ticker)
  if (!t || t === 'Empty') return null

  if (metric === 'Current Price') {
    const arr = ctx.decisionPrice === 'open' ? ctx.db.open[t] : ctx.db.close[t]
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
      const series = getCachedSeries(ctx.cache, 'stdPrice', t, w, () => rollingStdDev(closes, w))
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

// Evaluate a metric at a specific index (for forDays support)
const metricAtIndex = (ctx, ticker, metric, window, index) => {
  const t = getSeriesKey(ticker)
  if (!t || t === 'Empty') return null

  if (metric === 'Current Price') {
    const arr = ctx.decisionPrice === 'open' ? ctx.db.open[t] : ctx.db.close[t]
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
      const series = getCachedSeries(ctx.cache, 'stdPrice', t, w, () => rollingStdDev(closes, w))
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
  return { mode, volWindow, cappedFallback }
}

// ============================================
// CONDITION EVALUATION
// ============================================

const normalizeComparatorChoice = (c) => (c === 'gt' || c === '>' ? 'gt' : 'lt')

// Evaluate a single condition at a specific index (for forDays support)
const evaluateConditionAtIndex = (ctx, cond, index) => {
  const leftTicker = normalizeChoice(cond.ticker)
  const leftVal = metricAtIndex(ctx, leftTicker, cond.metric, cond.window, index)
  if (leftVal == null) return null

  if (!cond.expanded) {
    const threshold = Number(cond.threshold)
    if (!Number.isFinite(threshold)) return null
    const cmp = normalizeComparatorChoice(cond.comparator)
    return cmp === 'gt' ? leftVal > threshold : leftVal < threshold
  }

  const rightTicker = normalizeChoice(cond.rightTicker ?? cond.ticker)
  const rightMetric = cond.rightMetric ?? cond.metric
  const rightWindow = cond.rightWindow ?? cond.window
  const rightVal = metricAtIndex(ctx, rightTicker, rightMetric, rightWindow, index)
  if (rightVal == null) return null
  const cmp = normalizeComparatorChoice(cond.comparator)
  return cmp === 'gt' ? leftVal > rightVal : leftVal < rightVal
}

const evaluateCondition = (ctx, cond) => {
  const forDays = cond.forDays || 1

  // For forDays > 1, check that the condition was true for the past N consecutive days
  if (forDays > 1) {
    for (let dayOffset = 0; dayOffset < forDays; dayOffset++) {
      const checkIndex = ctx.indicatorIndex - dayOffset
      if (checkIndex < 0) {
        // Not enough history to check
        return false
      }
      const result = evaluateConditionAtIndex(ctx, cond, checkIndex)
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
  const leftVal = metricAt(ctx, leftTicker, cond.metric, cond.window)
  if (leftVal == null) return null

  if (!cond.expanded) {
    const threshold = Number(cond.threshold)
    if (!Number.isFinite(threshold)) return null
    const cmp = normalizeComparatorChoice(cond.comparator)
    return cmp === 'gt' ? leftVal > threshold : leftVal < threshold
  }

  const rightTicker = normalizeChoice(cond.rightTicker ?? cond.ticker)
  const rightMetric = cond.rightMetric ?? cond.metric
  const rightWindow = cond.rightWindow ?? cond.window
  const rightVal = metricAt(ctx, rightTicker, rightMetric, rightWindow)
  if (rightVal == null) return null
  const cmp = normalizeComparatorChoice(cond.comparator)
  return cmp === 'gt' ? leftVal > rightVal : leftVal < rightVal
}

const normalizeConditionType = (t, fallback = 'and') => {
  if (t === 'if' || t === 'and' || t === 'or') return t
  return fallback
}

const evaluateConditions = (ctx, conditions, logic) => {
  if (!conditions || conditions.length === 0) return false

  // Standard boolean precedence: AND binds tighter than OR.
  // Example: `A or B and C` => `A || (B && C)`.
  let currentAnd = null
  const orTerms = []

  for (const c of conditions) {
    const v = evaluateCondition(ctx, c)
    if (v == null) return null // null propagates
    const t = normalizeConditionType(c.type, 'and')
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
const collectMaxLookback = (node) => {
  if (!node) return 0
  let maxLookback = 0

  // Check conditions on indicator/numbered/scaling nodes
  const conditions = node.conditions || []
  for (const cond of conditions) {
    const forDaysOffset = Math.max(0, (cond.forDays || 1) - 1)
    maxLookback = Math.max(maxLookback, getIndicatorLookback(cond.metric, cond.window || 0) + forDaysOffset)
    if (cond.expanded) {
      const rightMetric = cond.rightMetric ?? cond.metric
      const rightWindow = cond.rightWindow ?? cond.window
      maxLookback = Math.max(maxLookback, getIndicatorLookback(rightMetric, rightWindow || 0) + forDaysOffset)
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

// ============================================
// NODE EVALUATION
// ============================================

const evaluateNode = (ctx, node) => {
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
    const result = evaluateConditions(ctx, conditions, logic)
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
      const tickers = collectPositionTickers(child)
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
    // Scaling nodes blend between then/else based on an indicator value in a range
    const scaleTicker = normalizeChoice(node.scaleTicker || 'SPY')
    const scaleMetric = node.scaleMetric || 'Relative Strength Index'
    const scaleWindow = node.scaleWindow || 14
    const scaleFrom = Number(node.scaleFrom ?? 0)
    const scaleTo = Number(node.scaleTo ?? 100)

    const val = metricAt(ctx, scaleTicker, scaleMetric, scaleWindow)

    // Calculate blend factor: 0 = all "then", 1 = all "else"
    // If val is below scaleFrom, blend = 0 (100% then)
    // If val is above scaleTo, blend = 1 (100% else)
    // Otherwise, linear interpolation
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
        const v = evaluateCondition(ctx, c)
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

  const { mode, volWindow } = getSlotConfig(node, slot)
  const childAllocs = children.map((c) => evaluateNode(ctx, c))

  // Calculate weights based on mode
  let weights
  if (mode === 'equal') {
    weights = new Array(children.length).fill(1 / children.length)
  } else if (mode === 'defined') {
    const definedWeights = children.map((c) => Number(c.window || 0))
    const total = definedWeights.reduce((a, b) => a + b, 0)
    weights = total > 0 ? definedWeights.map((w) => w / total) : new Array(children.length).fill(1 / children.length)
  } else if (mode === 'inverse' || mode === 'pro') {
    // Volatility-based weighting
    const vols = childAllocs.map((alloc) => {
      const tickers = Object.keys(alloc)
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
      weights = new Array(children.length).fill(1 / children.length)
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
    weights = new Array(children.length).fill(1 / children.length)
  }

  // Combine allocations
  const combined = {}
  for (let i = 0; i < childAllocs.length; i++) {
    const alloc = childAllocs[i]
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
      if (cond.ticker) addTickerWithComponents(tickers, cond.ticker)
      if (cond.rightTicker) addTickerWithComponents(tickers, cond.rightTicker)
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
      if (n.scaleTicker) addTickerWithComponents(tickers, n.scaleTicker)
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
      if (cond.ticker) addTickerWithComponents(tickers, cond.ticker)
      if (cond.rightTicker) addTickerWithComponents(tickers, cond.rightTicker)
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
      if (n.scaleTicker) addTickerWithComponents(tickers, n.scaleTicker)
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

// ============================================
// MAIN BACKTEST FUNCTION
// ============================================

export async function runBacktest(payload, options = {}) {
  const backtestMode = options.mode || 'OC' // OO, CC, CO, OC
  const costBps = options.costBps ?? 0
  const indicatorOverlays = options.indicatorOverlays || [] // Conditions to show as chart overlays

  // Parse payload if string
  const node = typeof payload === 'string' ? JSON.parse(payload) : payload

  // Collect all tickers from the strategy (positions + conditions + scaling + ratio components)
  const tickers = collectAllTickers(node)
  if (tickers.length === 0) {
    throw new Error('No tickers found in strategy')
  }

  // Collect indicator tickers separately (conditions, scaling, function nodes - NOT positions)
  // These determine the date intersection since they need longer history for lookback
  const indicatorTickers = collectIndicatorTickers(node)

  // Always include SPY for Treynor ratio and as fallback indicator ticker
  if (!tickers.includes('SPY')) {
    tickers.push('SPY')
  }
  if (!indicatorTickers.includes('SPY')) {
    indicatorTickers.push('SPY')
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

  // Load price data
  const limit = 20000
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
  const db = buildPriceDb(loaded.filter(l => l.bars.length > 0), indicatorTickers)
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
  const lookback = Math.max(50, collectMaxLookback(node))
  // Start evaluation from the later of: lookback period OR first valid position data
  const startEvalIndex = Math.max(
    decisionPrice === 'open' ? (lookback > 0 ? lookback + 1 : 0) : lookback,
    firstValidPosIndex
  )

  for (let i = startEvalIndex; i < db.dates.length; i++) {
    const indicatorIndex = decisionPrice === 'open' ? i - 1 : i
    const ctx = {
      db,
      cache,
      decisionIndex: i,
      indicatorIndex,
      decisionPrice,
      warnings: [],
    }
    allocationsAt[i] = evaluateNode(ctx, node)
  }

  // Calculate equity curve
  const startTradeIndex = startEvalIndex
  const startPointIndex = backtestMode === 'OC' ? Math.max(0, startTradeIndex - 1) : startTradeIndex
  const points = [{ time: db.dates[startPointIndex], value: 1 }]
  const returns = []
  const spyReturns = [] // For Treynor ratio
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
  let spyEquity = 1  // For benchmark curve
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

    // Store daily allocation for allocations tab (use end date = holding date, matching QuantMage)
    const dateStr = safeIsoDate(db.dates[end])
    dailyAllocations.push({ date: dateStr, alloc: { ...alloc } })

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

    // Calculate SPY return for Treynor ratio
    const spyOpen = db.open['SPY']
    const spyClose = db.close['SPY']
    const spyAdjClose = db.adjClose['SPY']
    let spyRet = 0
    if (spyOpen && spyClose && spyAdjClose) {
      let spyEntry, spyExit
      if (backtestMode === 'OO') {
        spyEntry = spyOpen[start]
        spyExit = spyOpen[end]
      } else if (backtestMode === 'CC') {
        // CC mode: Use adjClose for dividend-adjusted benchmark
        spyEntry = spyAdjClose[start]
        spyExit = spyAdjClose[end]
      } else if (backtestMode === 'CO') {
        spyEntry = spyClose[start]
        spyExit = spyOpen[end]
      } else { // OC
        spyEntry = spyOpen[start]
        spyExit = spyClose[start]
      }
      if (spyEntry > 0 && spyExit > 0) {
        spyRet = spyExit / spyEntry - 1
      }
    }
    spyReturns.push(spyRet)

    // Accumulate SPY equity for benchmark curve
    spyEquity *= 1 + spyRet
    benchmarkPoints.push({ time: db.dates[end], value: spyEquity })

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
  if (spyReturns.length > 1 && returns.length > 1) {
    const meanRet = returns.reduce((a, b) => a + b, 0) / returns.length
    const meanSpy = spyReturns.reduce((a, b) => a + b, 0) / spyReturns.length
    let cov = 0
    let varSpy = 0
    for (let i = 0; i < returns.length; i++) {
      cov += (returns[i] - meanRet) * (spyReturns[i] - meanSpy)
      varSpy += (spyReturns[i] - meanSpy) ** 2
    }
    beta = varSpy > 0 ? cov / varSpy : 0
    if (beta > 0) {
      treynorRatio = (metrics.cagr) / beta
    }
  }

  // Compute additional metrics
  const avgTurnover = turnoverCount > 0 ? totalTurnover / turnoverCount : 0
  const avgHoldings = holdingsCount > 0 ? totalHoldings / holdingsCount : 0
  const winRate = (winDays + lossDays) > 0 ? winDays / (winDays + lossDays) : 0

  // Create a context object for indicator lookups outside the main eval loop
  const overlayCtx = {
    db,
    cache,
    decisionIndex: db.dates.length - 1,
    indicatorIndex: db.dates.length - 1,
    decisionPrice: "close",
    warnings: [],
  }

  // Compute indicator overlay series if requested
  const overlaySeriesResult = indicatorOverlays.map((cond, idx) => {
    const OVERLAY_COLORS = ['#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316']
    const color = OVERLAY_COLORS[idx % OVERLAY_COLORS.length]

    // Helper to format indicator label
    const formatLabel = (ticker, metric, window) => {
      const WINDOWLESS = ['Current Price', 'Momentum (Weighted)', 'Momentum (Unweighted)', 'Momentum (12-Month SMA)', 'Drawdown', 'MACD Histogram', 'PPO Histogram', 'Laguerre RSI']
      const prefix = WINDOWLESS.includes(metric) ? '' : `${Math.floor(window || 0)}d `
      return `${prefix}${metric} of ${getSeriesKey(ticker)}`
    }

    // Compute left indicator series
    const leftSeries = []
    for (let i = startEvalIndex; i < db.dates.length; i++) {
      const value = metricAtIndex(overlayCtx, cond.ticker, cond.metric, cond.window, i)
      leftSeries.push({
        date: safeIsoDate(db.dates[i]),
        value: value ?? null
      })
    }

    // Compute right indicator series if expanded mode
    let rightSeries = null
    if (cond.expanded && cond.rightTicker && cond.rightMetric) {
      rightSeries = []
      for (let i = startEvalIndex; i < db.dates.length; i++) {
        const value = metricAtIndex(overlayCtx, cond.rightTicker, cond.rightMetric, cond.rightWindow || cond.window, i)
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
    equityCurve: points.map(p => ({ date: safeIsoDate(p.time), equity: p.value })),
    benchmarkCurve: benchmarkPoints.map(p => ({ date: safeIsoDate(p.time), equity: p.value })),
    // Include daily allocations for the Allocations tab
    allocations: dailyAllocations,
    // Include indicator overlay series if requested
    indicatorOverlays: overlaySeriesResult.length > 0 ? overlaySeriesResult : undefined,
    // Include daily returns for sanity report
    dailyReturns: returns,
  }
}
