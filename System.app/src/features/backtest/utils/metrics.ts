// src/features/backtest/utils/metrics.ts
// Metrics computation utilities for backtest

import type { BacktestDayRow, EquityPoint } from '@/types'

/**
 * Convert UTC seconds to ISO date string (YYYY-MM-DD)
 */
export const isoFromUtcSeconds = (t: number): string => {
  const ms = Number(t) * 1000
  if (!Number.isFinite(ms)) return '1970-01-01'
  try {
    return new Date(ms).toISOString().slice(0, 10)
  } catch {
    return '1970-01-01'
  }
}

/**
 * Basic metrics computed from equity curve and returns
 */
export type BasicMetrics = {
  cagr: number
  maxDrawdown: number
  sharpe: number
  days: number
}

/**
 * Compute basic metrics from equity curve and returns array
 */
export const computeMetrics = (equity: number[], returns: number[]): BasicMetrics => {
  const days = returns.length
  const final = equity.length ? equity[equity.length - 1] : 1
  const cagr = days > 0 && final > 0 ? final ** (252 / days) - 1 : 0
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
  return { cagr, maxDrawdown: maxDd, sharpe, days }
}

/**
 * Monthly return bucket
 */
export type MonthlyReturn = {
  year: number
  month: number
  value: number
}

/**
 * Compute monthly returns from daily backtest data
 */
export const computeMonthlyReturns = (days: BacktestDayRow[]): MonthlyReturn[] => {
  const buckets = new Map<string, { year: number; month: number; acc: number }>()
  for (const d of days) {
    const dt = d.date
    const year = Number(dt.slice(0, 4))
    const month = Number(dt.slice(5, 7))
    const key = `${year}-${month}`
    const prev = buckets.get(key) || { year, month, acc: 1 }
    prev.acc *= 1 + (Number.isFinite(d.netReturn) ? d.netReturn : 0)
    buckets.set(key, prev)
  }
  return Array.from(buckets.values())
    .map((b) => ({ year: b.year, month: b.month, value: b.acc - 1 }))
    .sort((a, b) => (a.year - b.year) || (a.month - b.month))
}

/**
 * Summary metrics for a backtest
 */
export type BacktestSummary = {
  startDate: string
  endDate: string
  days: number
  years: number
  totalReturn: number
  cagr: number
  vol: number
  maxDrawdown: number
  calmar: number
  sharpe: number
  sortino: number
  treynor: number
  beta: number
  winRate: number
  bestDay: number
  worstDay: number
  avgTurnover: number
  avgHoldings: number
}

/**
 * Compute comprehensive backtest summary metrics
 */
export const computeBacktestSummary = (
  points: EquityPoint[],
  drawdowns: number[],
  days: BacktestDayRow[],
  benchmarkPoints?: EquityPoint[]
): BacktestSummary => {
  const equity = points.map((p) => p.value)
  const returns = days.map((d) => d.netReturn)
  const base = computeMetrics(equity, returns)

  const totalReturn = equity.length ? equity[equity.length - 1] - 1 : 0
  const years = base.days / 252

  const mean = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0
  const variance =
    returns.length > 1 ? returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1) : 0
  const dailyStd = Math.sqrt(Math.max(0, variance))
  const vol = dailyStd * Math.sqrt(252)

  // Sortino: uses downside deviation (squared negative returns relative to 0)
  // Calculate downside deviation using all returns, but only penalizing negative ones
  const downsideSquaredSum = returns.reduce((sum, r) => sum + (r < 0 ? r * r : 0), 0)
  const downsideVariance = returns.length > 1 ? downsideSquaredSum / (returns.length - 1) : 0
  const downsideStd = Math.sqrt(Math.max(0, downsideVariance))
  const annualizedDownsideStd = downsideStd * Math.sqrt(252)
  const annualizedMean = mean * 252
  const sortino = annualizedDownsideStd > 0 ? annualizedMean / annualizedDownsideStd : 0

  // Treynor Ratio: (Portfolio Return - Risk-Free Rate) / Beta
  // Beta = Cov(Rp, Rm) / Var(Rm)
  let treynor = 0
  let beta = 0
  if (benchmarkPoints && benchmarkPoints.length > 1 && returns.length > 1) {
    // Calculate benchmark returns from benchmark equity points
    const benchReturns: number[] = []
    for (let i = 1; i < benchmarkPoints.length; i++) {
      const prev = benchmarkPoints[i - 1].value
      const curr = benchmarkPoints[i].value
      if (prev > 0) {
        benchReturns.push(curr / prev - 1)
      }
    }

    // Align returns arrays (use minimum length)
    const minLen = Math.min(returns.length, benchReturns.length)
    if (minLen > 1) {
      const portReturns = returns.slice(0, minLen)
      const mktReturns = benchReturns.slice(0, minLen)

      const portMean = portReturns.reduce((a, b) => a + b, 0) / minLen
      const mktMean = mktReturns.reduce((a, b) => a + b, 0) / minLen

      // Covariance of portfolio and market
      let cov = 0
      let mktVar = 0
      for (let i = 0; i < minLen; i++) {
        cov += (portReturns[i] - portMean) * (mktReturns[i] - mktMean)
        mktVar += (mktReturns[i] - mktMean) ** 2
      }
      cov /= (minLen - 1)
      mktVar /= (minLen - 1)

      // Beta = Cov(Rp, Rm) / Var(Rm)
      beta = mktVar > 0 ? cov / mktVar : 0

      // Treynor = annualized excess return / beta (assuming 0% risk-free rate)
      if (beta !== 0) {
        treynor = annualizedMean / beta
      }
    }
  }

  const winRate = returns.length ? returns.filter((r) => r > 0).length / returns.length : 0
  const bestDay = returns.length ? Math.max(...returns) : 0
  const worstDay = returns.length ? Math.min(...returns) : 0
  const avgTurnover = days.length ? days.reduce((a, d) => a + d.turnover, 0) / days.length : 0
  const avgHoldings = days.length ? days.reduce((a, d) => a + d.holdings.length, 0) / days.length : 0

  const startDate = points.length ? isoFromUtcSeconds(points[0].time) : ''
  const endDate = points.length ? isoFromUtcSeconds(points[points.length - 1].time) : ''
  const maxDrawdown = drawdowns.length ? Math.min(...drawdowns) : 0

  // Calmar: CAGR / abs(maxDrawdown)
  const calmar = maxDrawdown !== 0 ? base.cagr / Math.abs(maxDrawdown) : 0

  return {
    startDate,
    endDate,
    days: base.days,
    years,
    totalReturn,
    cagr: base.cagr,
    vol,
    maxDrawdown,
    calmar,
    sharpe: base.sharpe,
    sortino,
    treynor,
    beta,
    winRate,
    bestDay,
    worstDay,
    avgTurnover,
    avgHoldings,
  }
}
