// src/features/backtest/types.ts
// Additional types for backtest feature

import type { BacktestMode, BacktestError, BacktestResult, IndicatorOverlayData, PositionChoice } from '@/types'

/**
 * Percentile distribution for robustness analysis
 */
export type SanityReportPercentiles = {
  p5: number
  p25: number
  p50: number
  p75: number
  p95: number
  histogram?: { min: number; max: number; midpoint: number; count: number }[]
}

/**
 * Comparison metrics for benchmark analysis
 */
export type ComparisonMetrics = {
  cagr50: number
  maxdd50: number
  maxdd95: number
  calmar50: number
  calmar95: number
  sharpe: number
  sortino: number
  volatility: number
  winRate: number
  beta: number
  treynor: number
}

/**
 * Path risk analysis from Monte Carlo and K-Fold simulations
 */
export type SanityReportPathRisk = {
  monteCarlo: {
    drawdowns: SanityReportPercentiles
    cagrs: SanityReportPercentiles
    sharpes?: SanityReportPercentiles
    volatilities?: SanityReportPercentiles
  }
  kfold: {
    drawdowns: SanityReportPercentiles
    cagrs: SanityReportPercentiles
    sharpes?: SanityReportPercentiles
    volatilities?: SanityReportPercentiles
  }
  drawdownProbabilities: { gt20: number; gt30: number; gt40: number; gt50: number }
  comparisonMetrics?: { monteCarlo: ComparisonMetrics; kfold: ComparisonMetrics }
}

/**
 * Fragility analysis metrics
 */
export type SanityReportFragility = {
  subPeriodStability: { level: string; concentrationPct: number; detail: string; blockReturns: number[] }
  profitConcentration: { level: string; top5DaysPct: number; top10DaysPct: number; detail: string }
  smoothnessScore: { level: string; actualMaxDD: number; shuffledP50: number; ratio: number; detail: string }
  thinningFragility: { level: string; originalCagr: number; medianThinnedCagr: number; cagrDrop: number; detail: string }
}

/**
 * Full sanity/robustness report
 */
export type SanityReport = {
  original: { cagr: number; maxDD: number; tradingDays: number }
  pathRisk: SanityReportPathRisk
  fragility: SanityReportFragility
  summary: string[]
  meta: { mcSimulations: number; kfFolds: number; generatedAt: string }
}

/**
 * State for sanity report loading
 */
export type SanityReportState = {
  status: 'idle' | 'loading' | 'done' | 'error'
  report?: SanityReport
  error?: string
}

/**
 * Benchmark metrics state
 */
export type BenchmarkMetricsState = {
  status: 'idle' | 'loading' | 'done' | 'error'
  data?: Record<string, ComparisonMetrics>
  error?: string
}

/**
 * Props for BacktesterPanel component
 */
export interface BacktesterPanelProps {
  mode: BacktestMode
  setMode: (mode: BacktestMode) => void
  costBps: number
  setCostBps: (bps: number) => void
  benchmark: string
  setBenchmark: (ticker: string) => void
  showBenchmark: boolean
  setShowBenchmark: (show: boolean) => void
  tickerOptions: string[]
  status: 'idle' | 'running' | 'done' | 'error'
  result: BacktestResult | null
  errors: BacktestError[]
  onRun: () => void
  onJumpToError: (err: BacktestError) => void
  indicatorOverlays?: IndicatorOverlayData[]
  theme?: 'dark' | 'light'
  // Benchmarks tab
  benchmarkMetrics?: BenchmarkMetricsState
  onFetchBenchmarks?: () => void
  // Robustness tab
  modelSanityReport?: SanityReportState
  onFetchRobustness?: () => void
  // Undo/Redo
  onUndo?: () => void
  onRedo?: () => void
  canUndo?: boolean
  canRedo?: boolean
  // Ticker modal
  openTickerModal?: (onSelect: (ticker: string) => void) => void
}

/**
 * Normalize a position choice to uppercase string
 */
export const normalizeChoice = (raw: PositionChoice): string => {
  const s = String(raw ?? '').trim().toUpperCase()
  if (!s || s === 'EMPTY') return 'Empty'
  return s
}
