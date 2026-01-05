// src/features/backtest/index.ts
// Backtest feature - backtesting engine and metrics computation

// Types
export type {
  SanityReportPercentiles,
  ComparisonMetrics,
  SanityReportPathRisk,
  SanityReportFragility,
  SanityReport,
  SanityReportState,
  BenchmarkMetricsState,
  BacktesterPanelProps,
} from './types'
export { normalizeChoice } from './types'

// Utilities
export * from './utils'

// Components
export * from './components'
