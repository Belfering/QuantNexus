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

// Month names for date formatting
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Format a date as "Jan 1st", "Feb 14th", etc.
 */
const formatDateCondition = (month: number, day: number): string => {
  const suffix = day === 1 || day === 21 || day === 31 ? 'st'
    : day === 2 || day === 22 ? 'nd'
    : day === 3 || day === 23 ? 'rd' : 'th'
  return `${MONTH_ABBR[month - 1]} ${day}${suffix}`
}

/**
 * Format a condition as a human-readable expression string
 */
export const conditionExpr = (cond: ConditionLine): string => {
  // Special formatting for Date conditions
  if (cond.metric === 'Date') {
    const fromDate = formatDateCondition(cond.dateMonth ?? 1, cond.dateDay ?? 1)
    if (cond.expanded && cond.dateTo) {
      const toDate = formatDateCondition(cond.dateTo.month, cond.dateTo.day)
      return `Date is ${fromDate} to ${toDate}`
    }
    return `Date is ${fromDate}`
  }

  const leftPrefix = isWindowlessIndicator(cond.metric) ? '' : `${Math.floor(Number(cond.window || 0))}d `
  const left = `${leftPrefix}${cond.metric} of ${normalizeChoice(cond.ticker)}`
  const normalized = normalizeComparatorChoice(cond.comparator)
  const cmp = normalized === 'lt' ? '<' : normalized === 'gt' ? '>' : normalized === 'crossAbove' ? '↗' : '↘'
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
// Date Evaluation Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a date to a comparable "month-day" number (month * 100 + day)
 * This allows easy comparison that handles year wrapping properly
 */
const toMonthDay = (month: number, day: number): number => month * 100 + day

/**
 * Check if a trading date (ISO string) falls within the specified date range
 * Handles year-wrapping ranges (e.g., Dec 15 to Jan 15)
 */
const isDateInRange = (
  isoDate: string,
  fromMonth: number,
  fromDay: number,
  toMonth?: number,
  toDay?: number
): boolean => {
  // Parse the ISO date string to get month and day
  const date = new Date(isoDate)
  const currentMonth = date.getUTCMonth() + 1 // 1-12
  const currentDay = date.getUTCDate()
  const current = toMonthDay(currentMonth, currentDay)

  // If no range (single date), check exact match
  if (toMonth === undefined || toDay === undefined) {
    const target = toMonthDay(fromMonth, fromDay)
    return current === target
  }

  const from = toMonthDay(fromMonth, fromDay)
  const to = toMonthDay(toMonth, toDay)

  // Normal range (e.g., Jan 1 to Mar 31)
  if (from <= to) {
    return current >= from && current <= to
  }

  // Year-wrapping range (e.g., Nov 1 to Feb 28)
  // True if current >= from OR current <= to
  return current >= from || current <= to
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
  // Handle Date conditions specially
  if (cond.metric === 'Date') {
    const dateTimestamp = ctx.db.dates[index]
    if (dateTimestamp == null) return false
    const isoDate = isoFromUtcSeconds(dateTimestamp)
    // For expanded Date conditions, use dateTo if available, otherwise default to end of same month
    const fromMonth = cond.dateMonth ?? 1
    const fromDay = cond.dateDay ?? 1
    let toMonth: number | undefined, toDay: number | undefined
    if (cond.expanded) {
      // Use dateTo if set, otherwise default to last day of the from month
      toMonth = cond.dateTo?.month ?? fromMonth
      toDay = cond.dateTo?.day ?? 31
    }
    return isDateInRange(isoDate, fromMonth, fromDay, toMonth, toDay)
  }

  const cmp = normalizeComparatorChoice(cond.comparator)
  const left = metricAtIndex(ctx, cond.ticker, cond.metric, cond.window, index)

  // For crossing comparators, we need yesterday's value too
  const isCrossing = cmp === 'crossAbove' || cmp === 'crossBelow'
  const leftYesterday = isCrossing && index > 0
    ? metricAtIndex(ctx, cond.ticker, cond.metric, cond.window, index - 1)
    : null

  if (cond.expanded) {
    const rightMetric = cond.rightMetric ?? cond.metric
    const rightTicker = cond.rightTicker ?? cond.ticker
    const rightWindow = cond.rightWindow ?? cond.window
    const right = metricAtIndex(ctx, rightTicker, rightMetric, rightWindow, index)
    if (left == null || right == null) return false

    if (isCrossing) {
      const rightYesterday = index > 0
        ? metricAtIndex(ctx, rightTicker, rightMetric, rightWindow, index - 1)
        : null
      if (leftYesterday == null || rightYesterday == null) return false
      // crossAbove: yesterday left < right AND today left >= right
      // crossBelow: yesterday left > right AND today left <= right
      if (cmp === 'crossAbove') return leftYesterday < rightYesterday && left >= right
      return leftYesterday > rightYesterday && left <= right
    }

    return cmp === 'lt' ? left < right : left > right
  }

  if (left == null) return false

  if (isCrossing) {
    if (leftYesterday == null) return false
    // crossAbove: yesterday < threshold AND today >= threshold
    // crossBelow: yesterday > threshold AND today <= threshold
    if (cmp === 'crossAbove') return leftYesterday < cond.threshold && left >= cond.threshold
    return leftYesterday > cond.threshold && left <= cond.threshold
  }

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
  // Handle Date conditions specially
  if (cond.metric === 'Date') {
    const dateTimestamp = ctx.db.dates[ctx.indicatorIndex]
    if (dateTimestamp == null) {
      ctx.trace?.recordCondition(traceOwnerId, cond, false, {
        date: 'unknown',
        left: null,
        threshold: undefined,
      })
      return false
    }
    const isoDate = isoFromUtcSeconds(dateTimestamp)
    // For expanded Date conditions, use dateTo if available, otherwise default to end of same month
    const fromMonth = cond.dateMonth ?? 1
    const fromDay = cond.dateDay ?? 1
    let toMonth: number | undefined, toDay: number | undefined
    if (cond.expanded) {
      // Use dateTo if set, otherwise default to last day of the from month
      toMonth = cond.dateTo?.month ?? fromMonth
      toDay = cond.dateTo?.day ?? 31
    }
    const ok = isDateInRange(isoDate, fromMonth, fromDay, toMonth, toDay)
    ctx.trace?.recordCondition(traceOwnerId, cond, ok, {
      date: isoDate,
      left: null,
      threshold: undefined,
    })
    return ok
  }

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
  const isCrossing = cmp === 'crossAbove' || cmp === 'crossBelow'

  // For crossing comparators, get yesterday's values
  const leftYesterday = isCrossing && ctx.indicatorIndex > 0
    ? metricAtIndex(ctx, cond.ticker, cond.metric, cond.window, ctx.indicatorIndex - 1)
    : null

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

    let ok: boolean
    if (isCrossing) {
      const rightYesterday = ctx.indicatorIndex > 0
        ? metricAtIndex(ctx, rightTicker, rightMetric, rightWindow, ctx.indicatorIndex - 1)
        : null
      if (leftYesterday == null || rightYesterday == null) {
        ctx.trace?.recordCondition(traceOwnerId, cond, false, {
          date: isoFromUtcSeconds(ctx.db.dates[ctx.decisionIndex]),
          left,
          right,
        })
        return false
      }
      ok = cmp === 'crossAbove'
        ? leftYesterday < rightYesterday && left >= right
        : leftYesterday > rightYesterday && left <= right
    } else {
      ok = cmp === 'lt' ? left < right : left > right
    }

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

  let ok: boolean
  if (isCrossing) {
    if (leftYesterday == null) {
      ctx.trace?.recordCondition(traceOwnerId, cond, false, {
        date: isoFromUtcSeconds(ctx.db.dates[ctx.decisionIndex]),
        left,
        threshold: cond.threshold,
      })
      return false
    }
    ok = cmp === 'crossAbove'
      ? leftYesterday < cond.threshold && left >= cond.threshold
      : leftYesterday > cond.threshold && left <= cond.threshold
  } else {
    ok = cmp === 'lt' ? left < cond.threshold : left > cond.threshold
  }

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
