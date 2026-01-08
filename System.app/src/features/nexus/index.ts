// src/features/nexus/index.ts
// Nexus feature - community bots and portfolio correlation

// API functions
export {
  type CorrelationOptimizationMetric,
  type CorrelationTimePeriod,
  type CorrelationOptimizeParams,
  type CorrelationOptimizeResult,
  type CorrelationRecommendParams,
  type CorrelationRecommendation,
  type CorrelationRecommendResult,
  optimizeCorrelation,
  getCorrelationRecommendations,
} from './api'

// Hooks
export {
  type PortfolioMetrics,
  type CorrelationState,
  type CorrelationActions,
  type UseCorrelationResult,
  type UseCorrelationParams,
  useCorrelation,
} from './hooks/useCorrelation'

// Components
export {
  NexusPanel,
  type NexusPanelProps,
  type CommunityBotRow,
  type CommunitySort,
  type CommunitySortKey,
  type SortDir,
  type CommunitySearchFilter,
  type InvestmentWithPnl,
} from './components'
