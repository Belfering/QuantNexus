// src/types/bot.ts
// Bot/System and watchlist types

import type { FlowNode, CallChain, CustomIndicator } from './flowNode'
import type { UserId } from './theme'
import type { BacktestMode, BotBacktestState } from './backtest'
import type { ParameterRange } from '@/features/parameters/types'
import type { ISOOSSplitConfig } from './split'
import type { BranchGenerationJob } from './branch'

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
    isOosMetrics: { IS: number | null; OOS: number | null }  // Composite equity curve IS/OOS metrics
  }
}

export type BotSession = {
  id: string
  history: FlowNode[]
  historyIndex: number
  savedBotId?: string
  backtest: BotBacktestState
  callChains: CallChain[] // Per-bot call chains (stored with bot payload)
  customIndicators: CustomIndicator[] // Per-bot custom indicators (FRD-035)
  parameterRanges: ParameterRange[] // Chronological optimization ranges
  rollingParameterRanges?: ParameterRange[] // Rolling optimization ranges (separate from chronological)
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
