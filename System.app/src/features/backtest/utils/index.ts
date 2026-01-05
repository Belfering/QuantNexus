// src/features/backtest/utils/index.ts
// Barrel export for backtest utilities

export {
  type CompressionStats,
  countNodesInTree,
  isEmptyAllocation,
  pruneEmptyBranches,
  collapseSingleChildren,
  computeSubtreeHash,
  mergeGateChains,
  compressTreeForBacktest,
} from './compression'

export {
  type BacktestValidationError,
  makeBacktestValidationError,
  isBacktestValidationError,
} from './validation'

export {
  downloadEquityCsv,
  downloadAllocationsCsv,
  downloadRebalancesCsv,
} from './downloads'

export {
  isoFromUtcSeconds,
  type BasicMetrics,
  computeMetrics,
  type MonthlyReturn,
  computeMonthlyReturns,
  type BacktestSummary,
  computeBacktestSummary,
} from './metrics'

export {
  type VisibleRange,
  EMPTY_EQUITY_POINTS,
  toUtcSeconds,
  clampVisibleRangeToPoints,
  sanitizeSeriesPoints,
} from './chartHelpers'

export {
  type PriceDB,
  type IndicatorCache,
  type IndicatorCacheSeriesKey,
  emptyCache,
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
} from './indicators'

export {
  type TickerRef,
  type BacktestInputs,
  collectBacktestInputs,
  collectPositionTickers,
  isEtfsOnlyBot,
  collectIndicatorTickers,
} from './inputCollection'

export {
  normalizeConditions,
  normalizeNodeForBacktest,
} from './normalization'

export {
  buildPriceDb,
} from './priceDb'
