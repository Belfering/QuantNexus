// src/features/backtest/utils/indicators.ts
// Technical indicator calculations for backtesting

import type { UTCTimestamp } from 'lightweight-charts'
import { normalizeChoice, parseRatioTicker } from '@/shared/utils'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type PriceDB = {
  dates: UTCTimestamp[]
  open: Record<string, Array<number | null>>
  close: Record<string, Array<number | null>>
  adjClose: Record<string, Array<number | null>>  // For indicator calculations
  high?: Record<string, Array<number | null>>   // For Aroon indicators
  low?: Record<string, Array<number | null>>    // For Aroon indicators
  limitingTicker?: string // Ticker with fewest data points that limits the intersection
  tickerCounts?: Record<string, number> // Data point count for each ticker
}

export type IndicatorCache = {
  rsi: Map<string, Map<number, Array<number | null>>>
  sma: Map<string, Map<number, Array<number | null>>>
  ema: Map<string, Map<number, Array<number | null>>>
  std: Map<string, Map<number, Array<number | null>>>
  maxdd: Map<string, Map<number, Array<number | null>>>
  stdPrice: Map<string, Map<number, Array<number | null>>>
  cumRet: Map<string, Map<number, Array<number | null>>>
  smaRet: Map<string, Map<number, Array<number | null>>>
  mom13612w: Map<string, Map<number, Array<number | null>>>
  mom13612u: Map<string, Map<number, Array<number | null>>>
  momsma12: Map<string, Map<number, Array<number | null>>>
  drawdown: Map<string, Map<number, Array<number | null>>>
  aroonUp: Map<string, Map<number, Array<number | null>>>
  aroonDown: Map<string, Map<number, Array<number | null>>>
  aroonOsc: Map<string, Map<number, Array<number | null>>>
  macd: Map<string, Map<number, Array<number | null>>>
  ppo: Map<string, Map<number, Array<number | null>>>
  trendClarity: Map<string, Map<number, Array<number | null>>>
  ultSmooth: Map<string, Map<number, Array<number | null>>>
  closeArrays: Map<string, number[]>
  returnsArrays: Map<string, number[]>
}

export type IndicatorCacheSeriesKey =
  | 'rsi' | 'sma' | 'ema' | 'std' | 'maxdd' | 'stdPrice' | 'cumRet' | 'smaRet'
  | 'mom13612w' | 'mom13612u' | 'momsma12' | 'drawdown'
  | 'aroonUp' | 'aroonDown' | 'aroonOsc' | 'macd' | 'ppo' | 'trendClarity' | 'ultSmooth'

// ─────────────────────────────────────────────────────────────────────────────
// Cache Factory
// ─────────────────────────────────────────────────────────────────────────────

export const emptyCache = (): IndicatorCache => ({
  rsi: new Map(),
  sma: new Map(),
  ema: new Map(),
  std: new Map(),
  maxdd: new Map(),
  stdPrice: new Map(),
  cumRet: new Map(),
  smaRet: new Map(),
  mom13612w: new Map(),
  mom13612u: new Map(),
  momsma12: new Map(),
  drawdown: new Map(),
  aroonUp: new Map(),
  aroonDown: new Map(),
  aroonOsc: new Map(),
  macd: new Map(),
  ppo: new Map(),
  trendClarity: new Map(),
  ultSmooth: new Map(),
  closeArrays: new Map(),
  returnsArrays: new Map(),
})

// ─────────────────────────────────────────────────────────────────────────────
// Cache Helpers
// ─────────────────────────────────────────────────────────────────────────────

export const getSeriesKey = (ticker: string) => normalizeChoice(ticker)

/**
 * Get cached close array for a ticker
 * Handles ratio tickers like "JNK/XLP" by computing numerator / denominator prices
 * Uses adjClose for all indicator calculations (accurate historical signals)
 */
export const getCachedCloseArray = (cache: IndicatorCache, db: PriceDB, ticker: string): number[] => {
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

/**
 * Get cached returns array for a ticker
 * Avoids rebuilding for Standard Deviation calculations
 */
export const getCachedReturnsArray = (cache: IndicatorCache, db: PriceDB, ticker: string): number[] => {
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

/**
 * Get cached indicator series with lazy computation
 */
export const getCachedSeries = (
  cache: IndicatorCache,
  kind: IndicatorCacheSeriesKey,
  ticker: string,
  period: number,
  compute: () => Array<number | null>
) => {
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

// ─────────────────────────────────────────────────────────────────────────────
// Rolling Indicator Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simple Moving Average
 */
export const rollingSma = (values: number[], period: number): Array<number | null> => {
  const out: Array<number | null> = new Array(values.length).fill(null)
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

/**
 * Exponential Moving Average
 */
export const rollingEma = (values: number[], period: number): Array<number | null> => {
  const out: Array<number | null> = new Array(values.length).fill(null)
  const alpha = 2 / (period + 1)
  let ema: number | null = null
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

/**
 * Wilder's RSI (Relative Strength Index)
 */
export const rollingWilderRsi = (closes: number[], period: number): Array<number | null> => {
  const out: Array<number | null> = new Array(closes.length).fill(null)
  let avgGain: number | null = null
  let avgLoss: number | null = null
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

/**
 * Rolling Standard Deviation (of returns, as percentage)
 */
export const rollingStdDev = (values: number[], period: number): Array<number | null> => {
  const out: Array<number | null> = new Array(values.length).fill(null)
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
      out[i] = Math.sqrt(variance) * 100 // Return as percentage
    }
  }
  return out
}

/**
 * Rolling Maximum Drawdown
 * Optimized with periodic recalculation to avoid O(n*period) complexity
 */
export const rollingMaxDrawdown = (values: number[], period: number): Array<number | null> => {
  const n = values.length
  const out: Array<number | null> = new Array(n).fill(null)
  if (period <= 0 || n === 0) return out

  // For small periods or short arrays, use simple approach
  if (period <= 50 || n < period * 2) {
    for (let i = period - 1; i < n; i++) {
      let peak = -Infinity
      let maxDd = 0
      let valid = true
      for (let j = i - period + 1; j <= i && valid; j++) {
        const v = values[j]
        if (Number.isNaN(v)) {
          valid = false
          break
        }
        if (v > peak) peak = v
        if (peak > 0) {
          const dd = v / peak - 1
          if (dd < maxDd) maxDd = dd
        }
      }
      if (valid) out[i] = Math.abs(maxDd)
    }
    return out
  }

  // For larger periods, use incremental approach with periodic recalculation
  const recalcInterval = Math.max(period, 100)
  let cachedPeak = -Infinity
  let cachedMaxDd = 0
  let lastRecalc = -1

  for (let i = period - 1; i < n; i++) {
    const windowStart = i - period + 1

    // Check if window contains NaN
    let hasNan = false
    for (let j = Math.max(windowStart, lastRecalc + 1); j <= i; j++) {
      if (Number.isNaN(values[j])) {
        hasNan = true
        break
      }
    }

    if (hasNan || i - lastRecalc >= recalcInterval || lastRecalc < windowStart) {
      // Full recalculation
      let peak = -Infinity
      let maxDd = 0
      let valid = true
      for (let j = windowStart; j <= i; j++) {
        const v = values[j]
        if (Number.isNaN(v)) {
          valid = false
          break
        }
        if (v > peak) peak = v
        if (peak > 0) {
          const dd = v / peak - 1
          if (dd < maxDd) maxDd = dd
        }
      }
      if (valid) {
        out[i] = Math.abs(maxDd)
        cachedPeak = peak
        cachedMaxDd = maxDd
        lastRecalc = i
      }
    } else {
      // Incremental update
      const v = values[i]
      if (!Number.isNaN(v)) {
        if (v > cachedPeak) cachedPeak = v
        if (cachedPeak > 0) {
          const dd = v / cachedPeak - 1
          if (dd < cachedMaxDd) cachedMaxDd = dd
        }
        out[i] = Math.abs(cachedMaxDd)
      }
    }
  }
  return out
}

/**
 * Cumulative Return: (current - start) / start over window
 */
export const rollingCumulativeReturn = (values: number[], period: number): Array<number | null> => {
  const out: Array<number | null> = new Array(values.length).fill(null)
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

/**
 * SMA of Returns: smoothed daily returns over window
 */
export const rollingSmaOfReturns = (values: number[], period: number): Array<number | null> => {
  const returns: number[] = new Array(values.length).fill(NaN)
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1]
    const cur = values[i]
    if (!Number.isNaN(prev) && !Number.isNaN(cur) && prev !== 0) {
      returns[i] = cur / prev - 1
    }
  }
  return rollingSma(returns, period)
}

/**
 * Standard Deviation of Prices (absolute price volatility in dollars, not percentage)
 * Unlike rollingStdDev which multiplies by 100 for return-based volatility,
 * this returns the raw standard deviation of price values.
 */
export const rollingStdDevOfPrices = (values: number[], period: number): Array<number | null> => {
  const out: Array<number | null> = new Array(values.length).fill(null)
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
      out[i] = Math.sqrt(variance) // Raw stddev, no percentage conversion
    }
  }
  return out
}

/**
 * 13612W Weighted Momentum (fixed formula, no window parameter)
 * (12*(p0/p1-1) + 4*(p0/p3-1) + 2*(p0/p6-1) + (p0/p12-1)) / 19
 * Where pN = price N months ago (~21 trading days per month)
 */
export const rolling13612W = (closes: number[]): Array<number | null> => {
  const out: Array<number | null> = new Array(closes.length).fill(null)
  const m1 = 21, m3 = 63, m6 = 126, m12 = 252
  for (let i = m12; i < closes.length; i++) {
    const p0 = closes[i]
    const p1 = closes[i - m1]
    const p3 = closes[i - m3]
    const p6 = closes[i - m6]
    const p12 = closes[i - m12]
    // Check for valid numbers (not NaN) and non-zero divisors (can't divide by 0)
    if (p1 !== 0 && p3 !== 0 && p6 !== 0 && p12 !== 0 &&
        Number.isFinite(p0) && Number.isFinite(p1) && Number.isFinite(p3) && Number.isFinite(p6) && Number.isFinite(p12)) {
      out[i] = (12 * (p0 / p1 - 1) + 4 * (p0 / p3 - 1) + 2 * (p0 / p6 - 1) + (p0 / p12 - 1)) / 19
    }
  }
  return out
}

/**
 * 13612U Unweighted Momentum
 */
export const rolling13612U = (closes: number[]): Array<number | null> => {
  const out: Array<number | null> = new Array(closes.length).fill(null)
  const m1 = 21, m3 = 63, m6 = 126, m12 = 252
  for (let i = m12; i < closes.length; i++) {
    const p0 = closes[i]
    const p1 = closes[i - m1]
    const p3 = closes[i - m3]
    const p6 = closes[i - m6]
    const p12 = closes[i - m12]
    // Check for valid numbers (not NaN) and non-zero divisors (can't divide by 0)
    if (p1 !== 0 && p3 !== 0 && p6 !== 0 && p12 !== 0 &&
        Number.isFinite(p0) && Number.isFinite(p1) && Number.isFinite(p3) && Number.isFinite(p6) && Number.isFinite(p12)) {
      out[i] = ((p0 / p1 - 1) + (p0 / p3 - 1) + (p0 / p6 - 1) + (p0 / p12 - 1)) / 4
    }
  }
  return out
}

/**
 * SMA12 Momentum: 13*P0 / (P0+P1+...+P12) - 1
 */
export const rollingSMA12Momentum = (closes: number[]): Array<number | null> => {
  const out: Array<number | null> = new Array(closes.length).fill(null)
  const m = 21 // monthly
  for (let i = 12 * m; i < closes.length; i++) {
    let sum = 0
    let valid = true
    for (let j = 0; j <= 12; j++) {
      const v = closes[i - j * m]
      if (Number.isNaN(v)) { valid = false; break }
      sum += v
    }
    if (valid && sum !== 0) {
      out[i] = 13 * closes[i] / sum - 1
    }
  }
  return out
}

/**
 * Drawdown from All-Time High (no window - uses all history)
 */
export const rollingDrawdown = (closes: number[]): Array<number | null> => {
  const out: Array<number | null> = new Array(closes.length).fill(null)
  let peak = closes[0] || 0
  for (let i = 0; i < closes.length; i++) {
    const v = closes[i]
    if (Number.isNaN(v)) continue
    if (v > peak) peak = v
    out[i] = peak > 0 ? (peak - v) / peak : 0
  }
  return out
}

/**
 * Aroon Up: ((n - days since n-day high) / n) * 100
 */
export const rollingAroonUp = (highs: Array<number | null>, period: number): Array<number | null> => {
  const out: Array<number | null> = new Array(highs.length).fill(null)
  for (let i = period; i < highs.length; i++) {
    let maxIdx = i - period
    let maxVal = highs[maxIdx] ?? -Infinity
    for (let j = i - period; j <= i; j++) {
      const v = highs[j]
      if (v != null && !Number.isNaN(v) && v >= maxVal) {
        maxVal = v
        maxIdx = j
      }
    }
    out[i] = ((period - (i - maxIdx)) / period) * 100
  }
  return out
}

/**
 * Aroon Down: ((n - days since n-day low) / n) * 100
 */
export const rollingAroonDown = (lows: Array<number | null>, period: number): Array<number | null> => {
  const out: Array<number | null> = new Array(lows.length).fill(null)
  for (let i = period; i < lows.length; i++) {
    let minIdx = i - period
    let minVal = lows[minIdx] ?? Infinity
    for (let j = i - period; j <= i; j++) {
      const v = lows[j]
      if (v != null && !Number.isNaN(v) && v <= minVal) {
        minVal = v
        minIdx = j
      }
    }
    out[i] = ((period - (i - minIdx)) / period) * 100
  }
  return out
}

/**
 * Aroon Oscillator: Aroon Up - Aroon Down
 */
export const rollingAroonOscillator = (
  highs: Array<number | null>,
  lows: Array<number | null>,
  period: number
): Array<number | null> => {
  const up = rollingAroonUp(highs, period)
  const down = rollingAroonDown(lows, period)
  return up.map((u, i) => (u != null && down[i] != null ? u - down[i]! : null))
}

/**
 * MACD Histogram (fixed 12/26/9)
 */
export const rollingMACD = (closes: number[]): Array<number | null> => {
  const ema12 = rollingEma(closes, 12)
  const ema26 = rollingEma(closes, 26)
  const macdLine = ema12.map((v, i) => v != null && ema26[i] != null ? v - ema26[i]! : null)
  const macdFiltered = macdLine.map(v => v ?? NaN)
  const signal = rollingEma(macdFiltered, 9)
  return macdLine.map((v, i) => v != null && signal[i] != null ? v - signal[i]! : null)
}

/**
 * PPO Histogram (fixed 12/26/9) - percentage version of MACD
 */
export const rollingPPO = (closes: number[]): Array<number | null> => {
  const ema12 = rollingEma(closes, 12)
  const ema26 = rollingEma(closes, 26)
  const ppoLine = ema12.map((v, i) => v != null && ema26[i] != null && ema26[i]! !== 0
    ? ((v - ema26[i]!) / ema26[i]!) * 100 : null)
  const ppoFiltered = ppoLine.map(v => v ?? NaN)
  const signal = rollingEma(ppoFiltered, 9)
  return ppoLine.map((v, i) => v != null && signal[i] != null ? v - signal[i]! : null)
}

/**
 * Trend Clarity (R-squared of linear regression)
 */
export const rollingTrendClarity = (values: number[], period: number): Array<number | null> => {
  const out: Array<number | null> = new Array(values.length).fill(null)
  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1)
    if (slice.some(v => Number.isNaN(v))) continue
    const n = slice.length
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0
    for (let j = 0; j < n; j++) {
      sumX += j
      sumY += slice[j]
      sumXY += j * slice[j]
      sumX2 += j * j
      sumY2 += slice[j] * slice[j]
    }
    const num = n * sumXY - sumX * sumY
    const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY))
    const r = den === 0 ? 0 : num / den
    out[i] = r * r * 100 // R-squared as percentage
  }
  return out
}

/**
 * Ultimate Smoother (Ehlers)
 * Fixed: c1 = (1 - c2 - c3) / 4 ensures unity DC gain (output tracks input level)
 */
export const rollingUltimateSmoother = (values: number[], period: number): Array<number | null> => {
  const out: Array<number | null> = new Array(values.length).fill(null)
  const a = Math.exp(-1.414 * Math.PI / period)
  const b = 2 * a * Math.cos(1.414 * Math.PI / period)
  const c2 = b
  const c3 = -a * a
  // Unity DC gain: c1*4 + c2 + c3 = 1, so c1 = (1 - c2 - c3) / 4
  const c1 = (1 - c2 - c3) / 4

  for (let i = 2; i < values.length; i++) {
    if (i < period) continue
    if (Number.isNaN(values[i]) || Number.isNaN(values[i - 1]) || Number.isNaN(values[i - 2])) continue
    out[i] = c1 * (values[i] + 2 * values[i - 1] + values[i - 2])
           + c2 * (out[i - 1] ?? values[i - 1])
           + c3 * (out[i - 2] ?? values[i - 2])
  }
  return out
}
