// src/features/backtest/engine/evalContext.ts
// Backtest evaluation context and metric computation functions

import type { MetricChoice, BacktestWarning, BacktestTraceCollector, FlowNode } from '@/types'
import type { PriceDB, IndicatorCache } from '../utils/indicators'
import {
  getSeriesKey,
  getCachedCloseArray,
  getCachedReturnsArray,
  getCachedSeries,
  rollingSma,
  rollingEma,
  rollingWilderRsi,
  rollingStdDev,
  rollingMaxDrawdown,
  rollingCumulativeReturn,
  rollingSmaOfReturns,
  rollingStdDevOfPrices,
  rolling13612W,
  rolling13612U,
  rollingSMA12Momentum,
  rollingDrawdown,
  rollingAroonUp,
  rollingAroonDown,
  rollingAroonOscillator,
  rollingMACD,
  rollingPPO,
  rollingTrendClarity,
  rollingUltimateSmoother,
} from '../utils/indicators'

// ─────────────────────────────────────────────────────────────────────────────
// Evaluation Context Type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Context object passed to all backtest evaluation functions
 */
export type EvalCtx = {
  db: PriceDB
  cache: IndicatorCache
  decisionIndex: number
  indicatorIndex: number
  decisionPrice: 'open' | 'close'
  warnings: BacktestWarning[]
  resolveCall: (id: string) => FlowNode | null
  trace?: BacktestTraceCollector
}

// ─────────────────────────────────────────────────────────────────────────────
// Metric Evaluation Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluate metric at a specific index (for forDays consecutive day checks)
 */
export const metricAtIndex = (
  ctx: EvalCtx,
  ticker: string,
  metric: MetricChoice,
  window: number,
  index: number
): number | null => {
  const t = getSeriesKey(ticker)
  if (!t || t === 'Empty') return null

  if (metric === 'Current Price') {
    const arr = ctx.decisionPrice === 'open' ? ctx.db.open[t] : ctx.db.close[t]
    const v = arr?.[index]
    return v == null ? null : v
  }

  if (index < 0) return null
  // Use cached close array to avoid rebuilding on every call
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
      // Use cached returns array to avoid rebuilding on every call
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
    case 'Momentum (Weighted)': {
      const series = getCachedSeries(ctx.cache, 'mom13612w', t, 0, () => rolling13612W(closes))
      return series[index] ?? null
    }
    case 'Momentum (Unweighted)': {
      const series = getCachedSeries(ctx.cache, 'mom13612u', t, 0, () => rolling13612U(closes))
      return series[index] ?? null
    }
    case 'Momentum (12-Month SMA)': {
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
  }
  return null
}

/**
 * Evaluate metric at the current indicator index
 */
export const metricAt = (
  ctx: EvalCtx,
  ticker: string,
  metric: MetricChoice,
  window: number
): number | null => {
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
    case 'Momentum (Weighted)': {
      const series = getCachedSeries(ctx.cache, 'mom13612w', t, 0, () => rolling13612W(closes))
      return series[i] ?? null
    }
    case 'Momentum (Unweighted)': {
      const series = getCachedSeries(ctx.cache, 'mom13612u', t, 0, () => rolling13612U(closes))
      return series[i] ?? null
    }
    case 'Momentum (12-Month SMA)': {
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
  }
  return null
}
