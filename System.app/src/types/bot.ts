// src/types/bot.ts
// Bot/System and watchlist types

import type { FlowNode, CallChain, CustomIndicator } from './flowNode'
import type { UserId } from './theme'
import type { BacktestMode, BotBacktestState } from './backtest'
import type { ParameterRange } from '@/features/parameters/types'
import type { ISOOSSplitConfig } from './split'
import type { BranchGenerationJob } from './branch'
import type { EligibilityRequirement } from './admin'

export type SystemVisibility = 'private' | 'community'
export type BotVisibility = SystemVisibility // Backwards compat alias

export type SavedSystem = {
  id: string
  name: string
  builderId: UserId
  builderDisplayName?: string // Display name of the builder (for showing in UI)
  payload: FlowNode
  callChains?: CallChain[] // Per-bot call chains (stored with the system)
  customIndicators?: CustomIndicator[] // Per-bot custom indicators (FRD-035)
  visibility: BotVisibility
  createdAt: number
  tags?: string[] // e.g., ['Atlas', 'Nexus']
  fundSlot?: 1 | 2 | 3 | 4 | 5 | null // Which fund slot this system is in (for Nexus systems)
  backtestMode?: BacktestMode // Official backtest mode for this system (default: 'CC')
  backtestCostBps?: number // Official transaction cost in bps for this system (default: 5)
  backtestResult?: { // Cached metrics from API for cross-user Nexus systems
    cagr: number
    maxDrawdown: number
    calmar: number
    sharpe: number
    sortino: number
    treynor: number
    beta: number
    volatility: number
    winRate: number
    avgTurnover: number
    avgHoldings: number
  }
}
export type SavedBot = SavedSystem // Backwards compat alias

export type Watchlist = {
  id: string
  name: string
  botIds: string[]
  isDefault?: boolean
}

export type RollingOptimizationResult = {
  job: {
    id: number
    botId: string
    botName: string
    splitConfig: ISOOSSplitConfig
    validTickers: string[]
    tickerStartDates: Record<string, string>
    branchCount: number
    elapsedSeconds: number
    createdAt?: number
    treeJson?: string  // JSON string of tree structure
  }
  branches: Array<{
    branchId: number
    parameterValues: Record<string, any>  // Node structure by node ID
    isStartYear: number
    yearlyMetrics: Record<string, number | null>  // { "1993": 0.125, "1994": 0.153, ... } - CUMULATIVE metrics for adaptive logic
    isOosMetrics: { IS: number | null; OOS: number | null }  // For display: IS/OOS metrics
    rankByMetric: string
  }>
  adaptivePortfolio?: {
    yearlyMetrics: Record<string, number | null>  // Composite equity curve yearly cumulative metrics
    isStartDate: string  // IS period start date (YYYY-MM-DD)
    isCagr: number | null  // CAGR for IS period
    isSharpe: number | null  // Sharpe ratio for IS period
    isCalmar: number | null  // Calmar ratio for IS period
    isSortino: number | null  // Sortino ratio for IS period
    isTreynor: number | null  // Treynor ratio for IS period
    isBeta: number | null  // Beta for IS period
    isVol: number | null  // Volatility for IS period
    isMaxDD: number | null  // Max drawdown for IS period
    isTim: number | null  // TIM for IS period
    isTimar: number | null  // TIMAR for IS period
    isWinRate: number | null  // Win rate for IS period
    oosStartDate: string  // OOS period start date (YYYY-MM-DD)
    oosCagr: number | null  // CAGR for OOS period
    oosSharpe: number | null  // Sharpe ratio for OOS period
    oosCalmar: number | null  // Calmar ratio for OOS period
    oosSortino: number | null  // Sortino ratio for OOS period
    oosTreynor: number | null  // Treynor ratio for OOS period
    oosBeta: number | null  // Beta for OOS period
    oosVol: number | null  // Volatility for OOS period
    oosMaxDD: number | null  // Max drawdown for OOS period
    oosTim: number | null  // TIM for OOS period
    oosTimar: number | null  // TIMAR for OOS period
    oosWinRate: number | null  // Win rate for OOS period
    pass: boolean | null  // Whether the adaptive portfolio passes the criteria
  }
}

export type BotSession = {
  id: string
  history: FlowNode[]  // DEPRECATED - kept for backward compatibility
  historyIndex: number  // DEPRECATED - kept for backward compatibility
  splitTree?: FlowNode  // Current tree for Split tab (chronological optimization)
  walkForwardTree?: FlowNode  // Current tree for Walk Forward tab (rolling optimization)
  savedBotId?: string
  backtest: BotBacktestState
  callChains: CallChain[] // Per-bot call chains (stored with bot payload)
  customIndicators: CustomIndicator[] // Per-bot custom indicators (FRD-035)
  parameterRanges: ParameterRange[] // Chronological optimization ranges
  rollingParameterRanges?: ParameterRange[] // Rolling optimization ranges (separate from chronological)
  chronologicalRequirements?: EligibilityRequirement[]  // Requirements for Split tab (chronological)
  rollingRequirements?: EligibilityRequirement[]  // Requirements for Walk Forward tab (rolling)
  splitConfig?: ISOOSSplitConfig // IS/OOS split configuration for optimization
  branchGenerationJob?: BranchGenerationJob // Current branch generation job state
  rollingResult?: RollingOptimizationResult // Rolling optimization results
  tabContext: 'Forge' | 'Model' // Which tab this bot belongs to
}

// API type for Nexus bots (no payload for IP protection)
export type NexusBotFromApi = {
  id: string
  ownerId: string
  name: string
  visibility: string
  tags: string | null
  fundSlot: number | null
  createdAt: string
  owner_display_name?: string | null  // Flat field from SQL JOIN
  metrics?: {
    cagr?: number
    maxDrawdown?: number
    calmarRatio?: number
    sharpeRatio?: number
    sortinoRatio?: number
  } | null
}
