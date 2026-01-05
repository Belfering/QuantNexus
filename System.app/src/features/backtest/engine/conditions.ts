// src/features/backtest/engine/conditions.ts
// Condition evaluation functions for backtesting

import type { ConditionLine } from '@/types'
import { isWindowlessIndicator } from '@/constants'
import { normalizeChoice } from '@/shared/utils'
import { normalizeComparatorChoice } from '@/features/builder'
import { isoFromUtcSeconds } from '../utils'
import type { EvalCtx } from './evalContext'
import { metricAtIndex, metricAt } from './evalContext'

// ─────────────────────────────────────────────────────────────────────────────
// Condition Type Normalization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize condition type to valid values ('if' | 'and' | 'or')
 */
export const normalizeConditionType = (
  value: unknown,
  fallback: ConditionLine['type']
): ConditionLine['type'] => {
  if (value === 'if' || value === 'and' || value === 'or') return value
  const s = String(value || '').trim().toLowerCase()
  if (!s) return fallback
  if (s === 'and if' || s === 'andif' || s.startsWith('and')) return 'and'
  if (s === 'or if' || s === 'orif' || s.startsWith('or')) return 'or'
  if (s.startsWith('if')) return 'if'
  if (s.includes('and')) return 'and'
  if (s.includes('or')) return 'or'
  if (s.includes('if')) return 'if'
  return fallback
}

// ─────────────────────────────────────────────────────────────────────────────
// Condition Expression Formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a condition as a human-readable expression string
 */
export const conditionExpr = (cond: ConditionLine): string => {
  const leftPrefix = isWindowlessIndicator(cond.metric) ? '' : `${Math.floor(Number(cond.window || 0))}d `
  const left = `${leftPrefix}${cond.metric} of ${normalizeChoice(cond.ticker)}`
  const cmp = normalizeComparatorChoice(cond.comparator) === 'lt' ? '<' : '>'
  const forDaysSuffix = cond.forDays && cond.forDays > 1 ? ` for ${cond.forDays} days` : ''
  if (!cond.expanded) return `${left} ${cmp} ${String(cond.threshold)}${forDaysSuffix}`

  const rightMetric = cond.rightMetric ?? cond.metric
  const rightTicker = normalizeChoice(cond.rightTicker ?? cond.ticker)
  const rightWindow = Math.floor(Number((cond.rightWindow ?? cond.window) || 0))
  const rightPrefix = isWindowlessIndicator(rightMetric) ? '' : `${rightWindow}d `
  const right = `${rightPrefix}${rightMetric} of ${rightTicker}`
  return `${left} ${cmp} ${right}${forDaysSuffix}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Condition Evaluation Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluate a single condition at a specific index (for forDays support)
 */
export const evalConditionAtIndex = (
  ctx: EvalCtx,
  cond: ConditionLine,
  index: number
): boolean => {
  const cmp = normalizeComparatorChoice(cond.comparator)
  const left = metricAtIndex(ctx, cond.ticker, cond.metric, cond.window, index)
  if (cond.expanded) {
    const rightMetric = cond.rightMetric ?? cond.metric
    const rightTicker = cond.rightTicker ?? cond.ticker
    const rightWindow = cond.rightWindow ?? cond.window
    const right = metricAtIndex(ctx, rightTicker, rightMetric, rightWindow, index)
    if (left == null || right == null) return false
    return cmp === 'lt' ? left < right : left > right
  }
  if (left == null) return false
  return cmp === 'lt' ? left < cond.threshold : left > cond.threshold
}

/**
 * Evaluate a single condition with tracing support
 */
export const evalCondition = (
  ctx: EvalCtx,
  ownerId: string,
  traceOwnerId: string,
  cond: ConditionLine
): boolean => {
  const forDays = cond.forDays || 1
  const cmp = normalizeComparatorChoice(cond.comparator)

  // For forDays > 1, check that the condition was true for the past N consecutive days
  if (forDays > 1) {
    for (let dayOffset = 0; dayOffset < forDays; dayOffset++) {
      const checkIndex = ctx.indicatorIndex - dayOffset
      if (checkIndex < 0) {
        // Not enough history to check
        ctx.trace?.recordCondition(traceOwnerId, cond, false, {
          date: isoFromUtcSeconds(ctx.db.dates[ctx.decisionIndex]),
          left: null,
          threshold: cond.threshold,
        })
        return false
      }
      if (!evalConditionAtIndex(ctx, cond, checkIndex)) {
        // Condition failed on one of the days
        const left = metricAtIndex(ctx, cond.ticker, cond.metric, cond.window, ctx.indicatorIndex)
        ctx.trace?.recordCondition(traceOwnerId, cond, false, {
          date: isoFromUtcSeconds(ctx.db.dates[ctx.decisionIndex]),
          left,
          threshold: cond.threshold,
        })
        return false
      }
    }
    // All days passed
    const left = metricAtIndex(ctx, cond.ticker, cond.metric, cond.window, ctx.indicatorIndex)
    ctx.trace?.recordCondition(traceOwnerId, cond, true, {
      date: isoFromUtcSeconds(ctx.db.dates[ctx.decisionIndex]),
      left,
      threshold: cond.threshold,
    })
    return true
  }

  // Standard single-day evaluation (forDays = 1)
  const left = metricAt(ctx, cond.ticker, cond.metric, cond.window)
  if (cond.expanded) {
    const rightMetric = cond.rightMetric ?? cond.metric
    const rightTicker = cond.rightTicker ?? cond.ticker
    const rightWindow = cond.rightWindow ?? cond.window
    const right = metricAt(ctx, rightTicker, rightMetric, rightWindow)

    if (left == null || right == null) {
      ctx.warnings.push({
        time: ctx.db.dates[ctx.decisionIndex],
        date: isoFromUtcSeconds(ctx.db.dates[ctx.decisionIndex]),
        message: `Missing data for condition on ${ownerId}.`,
      })
      ctx.trace?.recordCondition(traceOwnerId, cond, false, {
        date: isoFromUtcSeconds(ctx.db.dates[ctx.decisionIndex]),
        left,
        right,
      })
      return false
    }
    const ok = cmp === 'lt' ? left < right : left > right
    ctx.trace?.recordCondition(traceOwnerId, cond, ok, {
      date: isoFromUtcSeconds(ctx.db.dates[ctx.decisionIndex]),
      left,
      right,
    })
    return ok
  }

  if (left == null) {
    ctx.warnings.push({
      time: ctx.db.dates[ctx.decisionIndex],
      date: isoFromUtcSeconds(ctx.db.dates[ctx.decisionIndex]),
      message: `Missing data for condition on ${ownerId}.`,
    })
    ctx.trace?.recordCondition(traceOwnerId, cond, false, {
      date: isoFromUtcSeconds(ctx.db.dates[ctx.decisionIndex]),
      left,
      threshold: cond.threshold,
    })
    return false
  }
  const ok = cmp === 'lt' ? left < cond.threshold : left > cond.threshold
  ctx.trace?.recordCondition(traceOwnerId, cond, ok, {
    date: isoFromUtcSeconds(ctx.db.dates[ctx.decisionIndex]),
    left,
    threshold: cond.threshold,
  })
  return ok
}

/**
 * Evaluate multiple conditions with boolean precedence (AND binds tighter than OR)
 * Example: `A or B and C` => `A || (B && C)`
 */
export const evalConditions = (
  ctx: EvalCtx,
  ownerId: string,
  conditions: ConditionLine[] | undefined,
  traceOwnerId: string = ownerId
): boolean => {
  if (!conditions || conditions.length === 0) return false

  // Standard boolean precedence: AND binds tighter than OR.
  let currentAnd: boolean | null = null
  const orTerms: boolean[] = []

  for (const c of conditions) {
    const v = evalCondition(ctx, ownerId, traceOwnerId, c)
    const t = normalizeConditionType(c.type, 'and')
    if (t === 'if') {
      if (currentAnd !== null) orTerms.push(currentAnd)
      currentAnd = v
      continue
    }

    if (currentAnd === null) {
      currentAnd = v
      continue
    }

    if (t === 'and') {
      currentAnd = currentAnd && v
      continue
    }

    if (t === 'or') {
      orTerms.push(currentAnd)
      currentAnd = v
      continue
    }

    currentAnd = v
  }

  if (currentAnd !== null) orTerms.push(currentAnd)
  return orTerms.some(Boolean)
}
