// src/features/backtest/engine/index.ts
// Backtest engine - core evaluation logic

export type { EvalCtx } from './evalContext'
export { metricAtIndex, metricAt } from './evalContext'

export {
  normalizeConditionType,
  conditionExpr,
  evalConditionAtIndex,
  evalCondition,
  evalConditions,
} from './conditions'

export { createBacktestTraceCollector } from './traceCollector'

export type { Allocation } from './allocation'
export {
  allocEntries,
  sumAlloc,
  normalizeAlloc,
  mergeAlloc,
  getSlotConfig,
  volForAlloc,
  weightChildren,
  turnoverFraction,
} from './allocation'

export { evaluateNode } from './evaluator'

export type { PositionContribution } from './traceContributions'
export { tracePositionContributions } from './traceContributions'
