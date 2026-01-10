// src/features/parameters/types.ts
// Type definitions for parameters panel

export type ParameterField = 'window' | 'metric' | 'comparator' | 'ticker' | 'threshold'

export interface VisualParameter {
  id: string  // ${nodeId}-${condId}-${field}
  field: ParameterField
  nodeId: string
  nodeTitle: string
  conditionId: string
  currentValue: number | string
  nodeColor: string
  path: string
  optimizationEnabled?: boolean
  min?: number
  max?: number
  step?: number
}

export interface ParameterRange {
  id: string
  type: 'period' | 'threshold' | 'ticker_list'
  nodeId: string
  conditionId?: string
  path: string
  currentValue: number
  enabled: boolean
  min: number
  max: number
  step: number
  // Ticker list fields (Phase 3: Custom Ticker Lists)
  tickerListId?: string
  tickerListName?: string
  tickers?: string[]
}

// Options for metric dropdown
export const METRIC_OPTIONS = [
  { value: 'rsi', label: 'RSI' },
  { value: 'sma', label: 'SMA' },
  { value: 'ema', label: 'EMA' },
  { value: 'macd', label: 'MACD' },
  { value: 'volume', label: 'Volume' },
  { value: 'price', label: 'Price' }
] as const

// Options for comparator dropdown
export const COMPARATOR_OPTIONS = [
  { value: 'gt', label: '>' },
  { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '<=' },
  { value: 'eq', label: '=' },
  { value: 'neq', label: '!=' }
] as const

// ============================================
// Hierarchical Parameter Types (New Design)
// ============================================

import type { BlockKind, WeightMode, NumberedQuantifier, SlotId } from '@/types/flowNode'

// Discriminated union for all strategy parameters
export type StrategyParameter =
  | WeightParameter
  | ConditionParameter
  | PositionParameter
  | FunctionParameter
  | NumberedConfigParameter
  | ScalingParameter

export interface WeightParameter {
  type: 'weight'
  field: 'weighting' | 'weightingThen' | 'weightingElse'
  currentValue: WeightMode
  branch?: 'then' | 'else'
}

export interface ConditionParameter {
  type: 'condition'
  conditionId: string
  itemId?: string  // For numbered nodes
  field: 'window' | 'metric' | 'comparator' | 'ticker' | 'threshold' | 'rightWindow' | 'rightMetric' | 'rightTicker' | 'forDays'
  currentValue: number | string
  optimizationEnabled?: boolean
  min?: number
  max?: number
  step?: number
}

export interface PositionParameter {
  type: 'position'
  field: 'positions'
  currentValue: string[]
}

export interface FunctionParameter {
  type: 'function'
  field: 'window' | 'metric' | 'bottom' | 'rank'
  currentValue: number | string
  optimizationEnabled?: boolean
  min?: number
  max?: number
  step?: number
}

export interface NumberedConfigParameter {
  type: 'numbered'
  field: 'quantifier' | 'n'
  currentValue: NumberedQuantifier | number
  optimizationEnabled?: boolean
  min?: number
  max?: number
  step?: number
}

export interface ScalingParameter {
  type: 'scaling'
  field: 'scaleWindow' | 'scaleMetric' | 'scaleTicker' | 'scaleFrom' | 'scaleTo'
  currentValue: number | string
  optimizationEnabled?: boolean
  min?: number
  max?: number
  step?: number
}

// Recursive tree structure that mirrors flowchart hierarchy
export interface HierarchicalParameter {
  nodeId: string
  nodePath: string[]  // ['root', 'node-1', 'node-2']
  depth: number       // 0, 1, 2... for indentation

  nodeTitle: string
  nodeKind: BlockKind
  nodeColor?: string

  parameters: StrategyParameter[]

  children: {
    next?: HierarchicalParameter[]
    then?: HierarchicalParameter[]
    else?: HierarchicalParameter[]
  }
}
