// src/types/backtest.ts
// Backtest engine types

import type { UTCTimestamp, LineData } from 'lightweight-charts'
import type { ConditionLine } from './flowNode'

export type BacktestMode = 'CC' | 'OO' | 'OC' | 'CO'

export type BacktestError = {
  nodeId: string
  field: string
  message: string
}

export type BacktestWarning = {
  time: UTCTimestamp
  date: string
  message: string
}

export type BacktestAllocationRow = {
  date: string
  entries: Array<{ ticker: string; weight: number }>
}

export type BacktestDayRow = {
  time: UTCTimestamp
  date: string
  equity: number
  drawdown: number
  grossReturn: number
  netReturn: number
  turnover: number
  cost: number
  holdings: Array<{ ticker: string; weight: number }>
  endNodes?: Array<{ nodeId: string; title: string; weight: number }>
}

export type BacktestTraceSample = {
  date: string
  left: number | null
  right?: number | null
  threshold?: number
}

export type BacktestConditionTrace = {
  id: string
  type: ConditionLine['type']
  expr: string
  trueCount: number
  falseCount: number
  firstTrue?: BacktestTraceSample
  firstFalse?: BacktestTraceSample
}

export type BacktestNodeTrace = {
  nodeId: string
  kind: 'indicator' | 'numbered' | 'numbered-item' | 'altExit' | 'scaling'
  thenCount: number
  elseCount: number
  conditions: BacktestConditionTrace[]
}

export type BacktestTrace = {
  nodes: BacktestNodeTrace[]
}

export type BacktestTraceCollector = {
  recordBranch: (nodeId: string, kind: BacktestNodeTrace['kind'], ok: boolean) => void
  recordCondition: (traceOwnerId: string, cond: ConditionLine, ok: boolean, sample: BacktestTraceSample) => void
  toResult: () => BacktestTrace
  // Alt Exit state tracking
  getAltExitState: (nodeId: string) => 'then' | 'else' | null
  setAltExitState: (nodeId: string, state: 'then' | 'else') => void
}

export type EquityPoint = LineData<UTCTimestamp>
export type EquityMarker = { time: UTCTimestamp; text: string }

// Extracted backtest metrics type for reuse in IS/OOS splits
export type BacktestMetrics = {
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

export type BacktestResult = {
  points: EquityPoint[]
  benchmarkPoints?: EquityPoint[]
  drawdownPoints: EquityPoint[]
  markers: EquityMarker[]
  metrics: BacktestMetrics
  isMetrics?: BacktestMetrics // In-sample metrics (only if IS/OOS split enabled)
  oosMetrics?: BacktestMetrics // Out-of-sample metrics (only if IS/OOS split enabled)
  oosStartDate?: string // OOS start date in YYYY-MM-DD format (for vertical line indicator)
  // IS/OOS split data for In Depth tab
  isAllocations?: BacktestAllocationRow[] // In-sample allocations (only if IS/OOS split enabled)
  oosAllocations?: BacktestAllocationRow[] // Out-of-sample allocations (only if IS/OOS split enabled)
  isMonthly?: Array<{ year: number; month: number; value: number }> // In-sample monthly returns (computed in frontend)
  oosMonthly?: Array<{ year: number; month: number; value: number }> // Out-of-sample monthly returns (computed in frontend)
  days: BacktestDayRow[]
  allocations: BacktestAllocationRow[]
  warnings: BacktestWarning[]
  monthly: Array<{ year: number; month: number; value: number }>
  trace?: BacktestTrace
}

export type BotBacktestState = {
  status: 'idle' | 'running' | 'done' | 'error'
  errors: BacktestError[]
  result: BacktestResult | null
  focusNodeId: string | null
}

export type AnalyzeBacktestState = {
  status: 'idle' | 'loading' | 'error' | 'done'
  result?: BacktestResult
  warnings?: BacktestWarning[]
  error?: string
}

export type TickerContributionState = {
  status: 'idle' | 'loading' | 'error' | 'done'
  returnPct?: number
  expectancy?: number
  error?: string
}
