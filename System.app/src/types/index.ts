// src/types/index.ts
// Barrel export for all types

// Indicator types
export type {
  MetricChoice,
  RankChoice,
  ComparatorChoice,
  IndicatorOverlayData,
} from './indicators'

// Flow node types
export type {
  BlockKind,
  SlotId,
  PositionChoice,
  WeightMode,
  NumberedQuantifier,
  ConditionLine,
  NumberedItem,
  FlowNode,
  CallChain,
  TickerInstance,
  ImportFormat,
  CustomIndicator,
} from './flowNode'
export { SLOT_ORDER } from './flowNode'

// Theme types
export type {
  UserId,
  ThemeMode,
  ColorTheme,
} from './theme'

// Backtest types
export type {
  BacktestMode,
  BacktestError,
  BacktestWarning,
  BacktestAllocationRow,
  BacktestDayRow,
  BacktestTraceSample,
  BacktestConditionTrace,
  BacktestNodeTrace,
  BacktestTrace,
  BacktestTraceCollector,
  EquityPoint,
  EquityMarker,
  BacktestResult,
  BotBacktestState,
  AnalyzeBacktestState,
  TickerContributionState,
} from './backtest'

// Bot types
export type {
  SystemVisibility,
  BotVisibility,
  SavedSystem,
  SavedBot,
  Watchlist,
  BotSession,
  NexusBotFromApi,
} from './bot'

// Dashboard types
export type {
  DashboardTimePeriod,
  EquityCurvePoint,
  DashboardInvestment,
  DashboardPortfolio,
  DbPosition,
  PortfolioMode,
  AlpacaAccount,
  AlpacaPosition,
  AlpacaHistoryPoint,
  BotInvestment,
  PositionLedgerEntry,
  UnallocatedPosition,
} from './dashboard'
export { STARTING_CAPITAL, defaultDashboardPortfolio } from './dashboard'

// Admin types
export type {
  AdminStatus,
  AdminCandlesResponse,
  EligibilityMetric,
  EligibilityRequirement,
  AdminConfig,
  TreasuryEntry,
  TreasuryState,
  AdminAggregatedStats,
  TreasuryFeeBreakdown,
  FundZones,
} from './admin'
export { METRIC_LABELS } from './admin'

// User types
export type {
  UserUiState,
  UserData,
} from './user'
