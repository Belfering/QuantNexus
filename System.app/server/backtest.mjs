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
      out[i] = Math.sqrt(variance)
    }
  }
  return out
}

const rollingMaxDrawdown = (values, period) => {
  const out = new Array(values.length).fill(null)
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) continue
    let peak = -Infinity
    let maxDd = 0
    for (let j = i - period + 1; j <= i; j++) {
      const v = values[j]
      if (Number.isNaN(v)) {
        peak = -Infinity
        maxDd = 0
        continue
      }
      if (v > peak) peak = v
      if (peak > 0) {
        const dd = v / peak - 1
        if (dd < maxDd) maxDd = dd
      }
    }
    out[i] = maxDd
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
  // Performance optimization: cache close and returns arrays
  closeArrays: new Map(),
  returnsArrays: new Map(),
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

const buildPriceDb = (series) => {
  if (!series.length) return { dates: [], open: {}, close: {} }

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
    console.log(`[buildPriceDb] ${t}: ${s.bars.length} bars, ${validCount} valid`)
    return { ticker: t, byTime }
  })

  // Find dates that have valid prices for ALL tickers
  const datesByTicker = barMaps.map((m) => new Set(m.byTime.keys()))
  let common = datesByTicker[0]
  for (let i = 1; i < datesByTicker.length; i++) {
    common = new Set([...common].filter((d) => datesByTicker[i].has(d)))
  }
  const dates = [...common].sort((a, b) => a - b)
  const safeDate = (ts) => {
    try {
      const ms = Number(ts) * 1000
      if (!Number.isFinite(ms)) return '1970-01-01'
      return new Date(ms).toISOString()
    } catch {
      return '1970-01-01'
    }
  }
  console.log(`[buildPriceDb] Common dates: ${dates.length}, first: ${safeDate(dates[0])}, last: ${safeDate(dates[dates.length - 1])}`)

  const open = {}
  const close = {}
  for (const { ticker, byTime } of barMaps) {
    open[ticker] = dates.map((d) => byTime.get(d)?.open ?? null)
    close[ticker] = dates.map((d) => byTime.get(d)?.close ?? null)
  }

  return { dates, open, close }
}

// Cached version - avoids rebuilding array on every metricAt() call
const getCachedCloseArray = (cache, db, ticker) => {
  const t = getSeriesKey(ticker)
  const existing = cache.closeArrays.get(t)
  if (existing) return existing
  const arr = (db.close[t] || []).map((v) => (v == null ? NaN : v))
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

const evaluateCondition = (ctx, cond) => {
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

const evaluateConditions = (ctx, conditions, logic) => {
  if (!conditions || conditions.length === 0) return true
  const results = conditions.map((c) => evaluateCondition(ctx, c))
  if (results.some((r) => r == null)) return null
  return logic === 'or' ? results.some((r) => r === true) : results.every((r) => r === true)
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
        const closes = buildCloseArray(ctx.db, t)
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
    for (const slot of SLOT_ORDER[n.kind] || []) {
      for (const child of n.children?.[slot] || []) {
        if (child) walk(child)
      }
    }
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

  // Parse payload if string
  const node = typeof payload === 'string' ? JSON.parse(payload) : payload

  // Collect all tickers from the strategy
  const tickers = collectPositionTickers(node)
  if (tickers.length === 0) {
    throw new Error('No tickers found in strategy')
  }

  // Always include SPY for Treynor ratio
  if (!tickers.includes('SPY')) {
    tickers.push('SPY')
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

  const db = buildPriceDb(loaded.filter(l => l.bars.length > 0))
  if (db.dates.length < 3) {
    throw new Error('Not enough overlapping price data to run a backtest')
  }

  // Run backtest
  const cache = emptyCache()
  const decisionPrice = backtestMode === 'CC' || backtestMode === 'CO' ? 'close' : 'open'

  const allocationsAt = Array.from({ length: db.dates.length }, () => ({}))
  const lookback = 50 // Default lookback for indicators
  const startEvalIndex = decisionPrice === 'open' ? (lookback > 0 ? lookback + 1 : 0) : lookback

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

    // Store daily allocation for allocations tab
    const dateStr = safeIsoDate(db.dates[start])
    dailyAllocations.push({ date: dateStr, alloc: { ...alloc } })

    let gross = 0
    for (const [ticker, w] of Object.entries(alloc)) {
      if (!(w > 0)) continue
      const t = getSeriesKey(ticker)
      const openArr = db.open[t]
      const closeArr = db.close[t]

      let entry, exit
      if (backtestMode === 'OO') {
        entry = openArr?.[start]
        exit = openArr?.[end]
      } else if (backtestMode === 'CC') {
        entry = closeArr?.[start]
        exit = closeArr?.[end]
      } else if (backtestMode === 'CO') {
        entry = closeArr?.[start]
        exit = openArr?.[end]
      } else { // OC
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
    let spyRet = 0
    if (spyOpen && spyClose) {
      let spyEntry, spyExit
      if (backtestMode === 'OO') {
        spyEntry = spyOpen[start]
        spyExit = spyOpen[end]
      } else if (backtestMode === 'CC') {
        spyEntry = spyClose[start]
        spyExit = spyClose[end]
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
    // Include daily allocations for the Allocations tab (sample every N days to reduce payload size)
    allocations: dailyAllocations.filter((_, i) => i % 5 === 0 || i === dailyAllocations.length - 1),
  }
}
