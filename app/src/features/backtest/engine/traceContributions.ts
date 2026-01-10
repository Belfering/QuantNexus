// src/features/backtest/engine/traceContributions.ts
// Position contribution tracing for backtest visualization

import type { FlowNode, SlotId } from '@/types'
import { isWindowlessIndicator } from '@/constants'
import { normalizeChoice } from '@/shared/utils'
import type { EvalCtx } from './evalContext'
import { metricAt } from './evalContext'
import { weightChildren } from './allocation'
import { evalConditions } from './conditions'
import { evaluateNode } from './evaluator'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Represents a position node's contribution to the final allocation
 */
export type PositionContribution = {
  nodeId: string
  title: string
  weight: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Position Contribution Tracing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Trace which position nodes contributed to an allocation.
 * Returns array of { nodeId, title, weight } for each contributing position node.
 * This mirrors evaluateNode logic but tracks position node contributions
 * instead of computing allocations.
 */
export const tracePositionContributions = (
  ctx: EvalCtx,
  node: FlowNode,
  parentWeight: number = 1,
  callStack: string[] = [],
): PositionContribution[] => {
  if (parentWeight < 0.0001) return []

  switch (node.kind) {
    case 'position': {
      const tickers = (node.positions || []).map(normalizeChoice).filter((t) => t !== 'Empty')
      if (tickers.length === 0) return []
      return [{
        nodeId: node.id,
        title: node.title || tickers.join(', '),
        weight: parentWeight,
      }]
    }
    case 'call': {
      const callId = node.callRefId
      if (!callId || callStack.includes(callId)) return []
      const resolved = ctx.resolveCall(callId)
      if (!resolved) return []
      return tracePositionContributions(ctx, resolved, parentWeight, [...callStack, callId])
    }
    case 'basic': {
      const children = (node.children.next || []).filter((c): c is FlowNode => Boolean(c))
      const childAllocs = children.map((c) => evaluateNode(ctx, c, callStack))
      const weighted = weightChildren(ctx, node, 'next', children, childAllocs)
      const result: PositionContribution[] = []
      for (const w of weighted) {
        const childIdx = children.indexOf(w.child)
        if (childIdx >= 0) {
          result.push(...tracePositionContributions(ctx, w.child, parentWeight * w.share, callStack))
        }
      }
      return result
    }
    case 'indicator': {
      const ok = evalConditions(ctx, node.id, node.conditions)
      const slot: SlotId = ok ? 'then' : 'else'
      const children = (node.children[slot] || []).filter((c): c is FlowNode => Boolean(c))
      const childAllocs = children.map((c) => evaluateNode(ctx, c, callStack))
      const weighted = weightChildren(ctx, node, slot, children, childAllocs)
      const result: PositionContribution[] = []
      for (const w of weighted) {
        result.push(...tracePositionContributions(ctx, w.child, parentWeight * w.share, callStack))
      }
      return result
    }
    case 'numbered': {
      const items = node.numbered?.items || []
      const itemTruth = items.map((it) => evalConditions(ctx, node.id, it.conditions, `${node.id}:${it.id}`))
      const nTrue = itemTruth.filter(Boolean).length
      const q = node.numbered?.quantifier ?? 'all'
      const n = Math.max(0, Math.floor(Number(node.numbered?.n ?? 0)))

      let slot: SlotId
      if (q === 'ladder') {
        slot = `ladder-${nTrue}` as SlotId
      } else {
        const ok =
          q === 'any' ? nTrue >= 1
          : q === 'all' ? nTrue === items.length
          : q === 'none' ? nTrue === 0
          : q === 'exactly' ? nTrue === n
          : q === 'atLeast' ? nTrue >= n
          : nTrue <= n
        slot = ok ? 'then' : 'else'
      }

      const children = (node.children[slot] || []).filter((c): c is FlowNode => Boolean(c))
      const childAllocs = children.map((c) => evaluateNode(ctx, c, callStack))
      const weighted = weightChildren(ctx, node, slot, children, childAllocs)
      const result: PositionContribution[] = []
      for (const w of weighted) {
        result.push(...tracePositionContributions(ctx, w.child, parentWeight * w.share, callStack))
      }
      return result
    }
    case 'function': {
      const children = (node.children.next || []).filter((c): c is FlowNode => Boolean(c))
      const candidateAllocs = children.map((c) => evaluateNode(ctx, c, callStack))
      const candidates = children
        .map((child, idx) => ({ child, alloc: candidateAllocs[idx] }))
        .filter((x) => Object.keys(x.alloc).length > 0)

      const metric = node.metric ?? 'Relative Strength Index'
      const win = isWindowlessIndicator(metric) ? 1 : Math.floor(Number(node.window ?? 10))
      const pickN = Math.max(1, Math.floor(Number(node.bottom ?? 1)))
      const rank = node.rank ?? 'Bottom'

      const scored = candidates
        .map((c) => {
          const vals: number[] = []
          for (const [t, w] of Object.entries(c.alloc)) {
            if (!(w > 0)) continue
            const mv = metricAt(ctx, t, metric, win)
            if (mv == null) continue
            vals.push(mv * w)
          }
          const score = vals.reduce((a, b) => a + b, 0)
          return { ...c, score: Number.isFinite(score) ? score : null }
        })
        .filter((x) => x.score != null)

      if (scored.length === 0) return []

      scored.sort((a, b) => (a.score as number) - (b.score as number))
      const selected = rank === 'Bottom' ? scored.slice(0, pickN) : scored.slice(-pickN)

      const selChildren = selected.map((s) => s.child)
      const selAllocs = selected.map((s) => s.alloc)
      const weighted = weightChildren(ctx, node, 'next', selChildren, selAllocs)
      const result: PositionContribution[] = []
      for (const w of weighted) {
        const origChild = selected.find((s) => s.child === w.child)?.child
        if (origChild) {
          result.push(...tracePositionContributions(ctx, origChild, parentWeight * w.share, callStack))
        }
      }
      return result
    }
    case 'altExit': {
      const entryOk = evalConditions(ctx, node.id, node.entryConditions, `${node.id}:entry`)
      const exitOk = evalConditions(ctx, node.id, node.exitConditions, `${node.id}:exit`)
      const prevState = ctx.trace?.getAltExitState(node.id) ?? null
      let currentState: 'then' | 'else'
      if (prevState === null) {
        currentState = entryOk ? 'then' : 'else'
      } else if (prevState === 'then') {
        currentState = exitOk ? 'else' : 'then'
      } else {
        currentState = entryOk ? 'then' : 'else'
      }
      const slot: SlotId = currentState
      const children = (node.children[slot] || []).filter((c): c is FlowNode => Boolean(c))
      const childAllocs = children.map((c) => evaluateNode(ctx, c, callStack))
      const weighted = weightChildren(ctx, node, slot, children, childAllocs)
      const result: PositionContribution[] = []
      for (const w of weighted) {
        result.push(...tracePositionContributions(ctx, w.child, parentWeight * w.share, callStack))
      }
      return result
    }
    case 'scaling': {
      const metric = node.scaleMetric ?? 'Relative Strength Index'
      const win = Math.floor(Number(node.scaleWindow ?? 14))
      const ticker = node.scaleTicker ?? 'SPY'
      const fromVal = Number(node.scaleFrom ?? 30)
      const toVal = Number(node.scaleTo ?? 70)
      const currentVal = metricAt(ctx, ticker, metric, win)

      let thenWeight: number
      let elseWeight: number
      if (currentVal == null) {
        thenWeight = 0.5
        elseWeight = 0.5
      } else {
        const isInverted = fromVal > toVal
        const low = isInverted ? toVal : fromVal
        const high = isInverted ? fromVal : toVal
        if (currentVal <= low) {
          thenWeight = isInverted ? 0 : 1
          elseWeight = isInverted ? 1 : 0
        } else if (currentVal >= high) {
          thenWeight = isInverted ? 1 : 0
          elseWeight = isInverted ? 0 : 1
        } else {
          const ratio = (currentVal - low) / (high - low)
          elseWeight = isInverted ? (1 - ratio) : ratio
          thenWeight = 1 - elseWeight
        }
      }

      const result: PositionContribution[] = []
      const thenChildren = (node.children.then || []).filter((c): c is FlowNode => Boolean(c))
      const elseChildren = (node.children.else || []).filter((c): c is FlowNode => Boolean(c))

      const thenAllocs = thenChildren.map((c) => evaluateNode(ctx, c, callStack))
      const elseAllocs = elseChildren.map((c) => evaluateNode(ctx, c, callStack))

      const thenWeighted = weightChildren(ctx, node, 'then', thenChildren, thenAllocs)
      const elseWeighted = weightChildren(ctx, node, 'else', elseChildren, elseAllocs)

      for (const w of thenWeighted) {
        result.push(...tracePositionContributions(ctx, w.child, parentWeight * thenWeight * w.share, callStack))
      }
      for (const w of elseWeighted) {
        result.push(...tracePositionContributions(ctx, w.child, parentWeight * elseWeight * w.share, callStack))
      }
      return result
    }
    default:
      return []
  }
}
