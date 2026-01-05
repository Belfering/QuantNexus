// src/types/flowNode.ts
// Core flow node types for the tree builder

import type { MetricChoice, ComparatorChoice, RankChoice } from './indicators'

export type BlockKind = 'basic' | 'function' | 'indicator' | 'numbered' | 'position' | 'call' | 'altExit' | 'scaling'
export type SlotId = 'next' | 'then' | 'else' | `ladder-${number}`
export type PositionChoice = string
export type WeightMode = 'equal' | 'defined' | 'inverse' | 'pro' | 'capped'

export type NumberedQuantifier = 'any' | 'all' | 'none' | 'exactly' | 'atLeast' | 'atMost' | 'ladder'

export type ConditionLine = {
  id: string
  type: 'if' | 'and' | 'or'
  window: number
  metric: MetricChoice
  comparator: ComparatorChoice
  ticker: PositionChoice
  threshold: number
  expanded?: boolean
  rightWindow?: number
  rightMetric?: MetricChoice
  rightTicker?: PositionChoice
  forDays?: number // Condition must be true for N consecutive days (default: 1)
}

export type NumberedItem = {
  id: string
  conditions: ConditionLine[]
  groupLogic?: 'and' | 'or'  // How conditions within this item combine (for AnyOf/AllOf imports)
}

export type FlowNode = {
  id: string
  kind: BlockKind
  title: string
  children: Partial<Record<SlotId, Array<FlowNode | null>>>
  positions?: PositionChoice[]
  weighting: WeightMode
  weightingThen?: WeightMode
  weightingElse?: WeightMode
  cappedFallback?: PositionChoice
  cappedFallbackThen?: PositionChoice
  cappedFallbackElse?: PositionChoice
  volWindow?: number
  volWindowThen?: number
  volWindowElse?: number
  bgColor?: string
  collapsed?: boolean
  conditions?: ConditionLine[]
  numbered?: {
    quantifier: NumberedQuantifier
    n: number
    items: NumberedItem[]
  }
  metric?: MetricChoice
  window?: number
  bottom?: number
  rank?: RankChoice
  callRefId?: string
  // Alt Exit node properties
  entryConditions?: ConditionLine[]
  exitConditions?: ConditionLine[]
  // Scaling node properties
  scaleMetric?: MetricChoice
  scaleWindow?: number
  scaleTicker?: string
  scaleFrom?: number
  scaleTo?: number
}

export type CallChain = {
  id: string
  name: string
  root: FlowNode
  collapsed: boolean
}

// Find/Replace ticker instance tracking
export type TickerInstance = {
  nodeId: string
  field: 'position' | 'condition' | 'rightCondition' | 'scaleTicker' | 'cappedFallback' | 'entry' | 'exit'
  index?: number      // For arrays (positions, conditions)
  itemId?: string     // For numbered items
  callChainId?: string // If found in a call chain
}

export type ImportFormat = 'atlas' | 'composer' | 'quantmage' | 'unknown'

// Slot order for each node kind
export const SLOT_ORDER: Record<BlockKind, SlotId[]> = {
  basic: ['next'],
  function: ['next'],
  indicator: ['then', 'else', 'next'],
  numbered: ['then', 'else', 'next'],
  position: [],
  call: [],
  altExit: ['then', 'else'],
  scaling: ['then', 'else'],
}
