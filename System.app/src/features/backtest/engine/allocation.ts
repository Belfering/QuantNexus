// src/features/backtest/engine/allocation.ts
// Allocation manipulation and weighting functions for backtesting

import type { FlowNode, SlotId } from '@/types'
import { isEmptyChoice } from '@/shared/utils'
import { getSeriesKey } from '../utils/indicators'
import type { EvalCtx } from './evalContext'
import { metricAt } from './evalContext'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Allocation represents a portfolio with ticker -> weight mapping
 */
export type Allocation = Record<string, number>

// ─────────────────────────────────────────────────────────────────────────────
// Allocation Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get allocation entries as array of {ticker, weight}
 */
export const allocEntries = (alloc: Allocation): Array<{ ticker: string; weight: number }> => {
  return Object.entries(alloc)
    .filter(([, w]) => w > 0)
    .map(([ticker, weight]) => ({ ticker, weight }))
}

/**
 * Sum all weights in an allocation
 */
export const sumAlloc = (alloc: Allocation) => Object.values(alloc).reduce((a, b) => a + b, 0)

/**
 * Normalize allocation so weights sum to 1
 */
export const normalizeAlloc = (alloc: Allocation): Allocation => {
  const total = sumAlloc(alloc)
  if (!(total > 0)) return {}
  const out: Allocation = {}
  for (const [k, v] of Object.entries(alloc)) {
    if (v <= 0) continue
    out[k] = v / total
  }
  return out
}

/**
 * Merge an allocation into a base allocation with scaling
 */
export const mergeAlloc = (base: Allocation, add: Allocation, scale: number) => {
  if (!(scale > 0)) return
  for (const [t, w] of Object.entries(add)) {
    if (!(w > 0)) continue
    base[t] = (base[t] || 0) + w * scale
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Slot Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get weighting configuration for a specific slot
 */
export const getSlotConfig = (node: FlowNode, slot: SlotId) => {
  if ((node.kind === 'indicator' || node.kind === 'numbered') && (slot === 'then' || slot === 'else')) {
    const mode = slot === 'then' ? (node.weightingThen ?? node.weighting) : (node.weightingElse ?? node.weighting)
    const volWindow = slot === 'then' ? (node.volWindowThen ?? node.volWindow ?? 20) : (node.volWindowElse ?? node.volWindow ?? 20)
    const cappedFallback =
      slot === 'then' ? (node.cappedFallbackThen ?? node.cappedFallback ?? 'Empty') : (node.cappedFallbackElse ?? node.cappedFallback ?? 'Empty')
    return { mode, volWindow, cappedFallback }
  }
  return { mode: node.weighting, volWindow: node.volWindow ?? 20, cappedFallback: node.cappedFallback ?? 'Empty' }
}

// ─────────────────────────────────────────────────────────────────────────────
// Volatility and Weighting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate portfolio volatility for an allocation
 */
export const volForAlloc = (ctx: EvalCtx, alloc: Allocation, window: number): number | null => {
  const w = Math.max(1, Math.floor(Number(window || 0)))
  let sumSq = 0
  let any = false
  for (const [ticker, weight] of Object.entries(alloc)) {
    if (!(weight > 0)) continue
    const std = metricAt(ctx, ticker, 'Standard Deviation', w)
    if (std == null) continue
    any = true
    sumSq += (weight * std) ** 2
  }
  return any ? Math.sqrt(sumSq) : null
}

/**
 * Weight children allocations based on parent's weighting mode
 */
export const weightChildren = (
  ctx: EvalCtx,
  parent: FlowNode,
  slot: SlotId,
  children: FlowNode[],
  allocs: Allocation[]
): Array<{ child: FlowNode; alloc: Allocation; share: number }> => {
  const { mode, volWindow, cappedFallback } = getSlotConfig(parent, slot)

  const active = children
    .map((child, idx) => ({ child, alloc: allocs[idx] }))
    .filter((x) => Object.keys(x.alloc).length > 0)

  if (active.length === 0) return []

  if (mode === 'equal') {
    const share = 1 / active.length
    return active.map((x) => ({ ...x, share }))
  }

  if (mode === 'defined') {
    const weights = active.map((x) => Math.max(0, Number(x.child.window || 0)))
    const total = weights.reduce((a, b) => a + b, 0)
    if (!(total > 0)) return active.map((x) => ({ ...x, share: 0 }))
    return active.map((x, i) => ({ ...x, share: weights[i] / total }))
  }

  if (mode === 'inverse' || mode === 'pro') {
    const vols = active.map((x) => volForAlloc(ctx, x.alloc, volWindow) ?? null)
    const rawWeights = vols.map((v) => {
      if (!v || !(v > 0)) return 0
      return mode === 'inverse' ? 1 / v : v
    })
    const total = rawWeights.reduce((a, b) => a + b, 0)
    if (!(total > 0)) {
      const share = 1 / active.length
      return active.map((x) => ({ ...x, share }))
    }
    return active.map((x, i) => ({ ...x, share: rawWeights[i] / total }))
  }

  // capped
  let remaining = 1
  const out: Array<{ child: FlowNode; alloc: Allocation; share: number }> = []
  for (const x of active) {
    if (!(remaining > 0)) break
    const capPct = Math.max(0, Number(x.child.window || 0))
    const cap = Math.min(1, capPct / 100)
    if (!(cap > 0)) continue
    const share = Math.min(cap, remaining)
    remaining -= share
    out.push({ ...x, share })
  }

  if (remaining > 0 && !isEmptyChoice(cappedFallback)) {
    out.push({
      child: { ...parent, id: `${parent.id}-capped-fallback` } as FlowNode,
      alloc: { [getSeriesKey(cappedFallback)]: 1 },
      share: remaining,
    })
  }

  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Turnover Calculation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate turnover fraction between two allocations
 * Returns value between 0 (no change) and 1 (complete turnover)
 */
export const turnoverFraction = (prev: Allocation, next: Allocation) => {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next), '__CASH__'])
  const prevTotal = sumAlloc(prev)
  const nextTotal = sumAlloc(next)
  const prevCash = Math.max(0, 1 - prevTotal)
  const nextCash = Math.max(0, 1 - nextTotal)
  let sumAbs = 0
  for (const k of keys) {
    const a = k === '__CASH__' ? prevCash : prev[k] || 0
    const b = k === '__CASH__' ? nextCash : next[k] || 0
    sumAbs += Math.abs(a - b)
  }
  return sumAbs / 2
}
