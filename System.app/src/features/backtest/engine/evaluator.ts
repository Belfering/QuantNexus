// src/features/backtest/engine/evaluator.ts
// Core node evaluation logic for backtest engine

import type { FlowNode, SlotId } from '@/types'
import { isWindowlessIndicator } from '@/constants'
import { normalizeChoice } from '@/shared/utils'
import { isoFromUtcSeconds } from '../utils'
import type { EvalCtx } from './evalContext'
import { metricAt } from './evalContext'
import type { Allocation } from './allocation'
import { weightChildren, mergeAlloc, normalizeAlloc } from './allocation'
import { evalConditions } from './conditions'

// ─────────────────────────────────────────────────────────────────────────────
// Node Evaluation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recursively evaluate a FlowNode tree and return the resulting allocation.
 * Each node type has specific evaluation logic:
 * - position: Returns allocation based on ticker positions
 * - call: Resolves reference to another flowchart
 * - basic: Weighted combination of children
 * - indicator: Conditional branching (then/else)
 * - numbered: Multi-condition quantifier logic
 * - function: Metric-based ranking/selection
 * - altExit: Entry/exit state machine
 * - scaling: Continuous blending based on metric value
 */
export const evaluateNode = (
  ctx: EvalCtx,
  node: FlowNode,
  callStack: string[] = []
): Allocation => {
  switch (node.kind) {
    case 'position': {
      const tickers = (node.positions || []).map(normalizeChoice).filter((t) => t !== 'Empty')
      if (tickers.length === 0) return {}
      const unique = Array.from(new Set(tickers))
      const share = 1 / unique.length
      const alloc: Allocation = {}
      for (const t of unique) alloc[t] = (alloc[t] || 0) + share
      return alloc
    }
    case 'call': {
      const callId = node.callRefId
      if (!callId) return {}
      if (callStack.includes(callId)) {
        ctx.warnings.push({
          time: ctx.db.dates[ctx.decisionIndex],
          date: isoFromUtcSeconds(ctx.db.dates[ctx.decisionIndex]),
          message: `Call "${callId}" is referencing itself.`,
        })
        return {}
      }
      const resolved = ctx.resolveCall(callId)
      if (!resolved) {
        ctx.warnings.push({
          time: ctx.db.dates[ctx.decisionIndex],
          date: isoFromUtcSeconds(ctx.db.dates[ctx.decisionIndex]),
          message: `Call "${callId}" could not be found.`,
        })
        return {}
      }
      return evaluateNode(ctx, resolved, [...callStack, callId])
    }
    case 'basic': {
      const children = (node.children.next || []).filter((c): c is FlowNode => Boolean(c))
      const childAllocs = children.map((c) => evaluateNode(ctx, c, callStack))
      const weighted = weightChildren(ctx, node, 'next', children, childAllocs)
      const out: Allocation = {}
      for (const w of weighted) mergeAlloc(out, w.alloc, w.share)
      return normalizeAlloc(out)
    }
    case 'indicator': {
      const ok = evalConditions(ctx, node.id, node.conditions)
      ctx.trace?.recordBranch(node.id, 'indicator', ok)
      const slot: SlotId = ok ? 'then' : 'else'
      const children = (node.children[slot] || []).filter((c): c is FlowNode => Boolean(c))
      const childAllocs = children.map((c) => evaluateNode(ctx, c, callStack))
      const weighted = weightChildren(ctx, node, slot, children, childAllocs)
      const out: Allocation = {}
      for (const w of weighted) mergeAlloc(out, w.alloc, w.share)
      return normalizeAlloc(out)
    }
    case 'numbered': {
      const items = node.numbered?.items || []
      const itemTruth = items.map((it) => evalConditions(ctx, node.id, it.conditions, `${node.id}:${it.id}`))
      const nTrue = itemTruth.filter(Boolean).length
      const q = node.numbered?.quantifier ?? 'all'
      const n = Math.max(0, Math.floor(Number(node.numbered?.n ?? 0)))

      // Handle ladder mode: select ladder-N slot based on how many conditions are true
      if (q === 'ladder') {
        const slotKey = `ladder-${nTrue}` as SlotId
        ctx.trace?.recordBranch(node.id, 'numbered', nTrue > 0)
        const children = (node.children[slotKey] || []).filter((c): c is FlowNode => Boolean(c))
        const childAllocs = children.map((c) => evaluateNode(ctx, c, callStack))
        const weighted = weightChildren(ctx, node, slotKey, children, childAllocs)
        const out: Allocation = {}
        for (const w of weighted) mergeAlloc(out, w.alloc, w.share)
        return normalizeAlloc(out)
      }

      const ok =
        q === 'any'
          ? nTrue >= 1
          : q === 'all'
            ? nTrue === items.length
            : q === 'none'
              ? nTrue === 0
              : q === 'exactly'
                ? nTrue === n
                : q === 'atLeast'
                  ? nTrue >= n
                  : nTrue <= n
      ctx.trace?.recordBranch(node.id, 'numbered', ok)
      const slot: SlotId = ok ? 'then' : 'else'
      const children = (node.children[slot] || []).filter((c): c is FlowNode => Boolean(c))
      const childAllocs = children.map((c) => evaluateNode(ctx, c, callStack))
      const weighted = weightChildren(ctx, node, slot, children, childAllocs)
      const out: Allocation = {}
      for (const w of weighted) mergeAlloc(out, w.alloc, w.share)
      return normalizeAlloc(out)
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

      if (scored.length === 0) return {}

      scored.sort((a, b) => (a.score as number) - (b.score as number))
      const selected = rank === 'Bottom' ? scored.slice(0, pickN) : scored.slice(-pickN)

      const selChildren = selected.map((s) => s.child)
      const selAllocs = selected.map((s) => s.alloc)
      const weighted = weightChildren(ctx, node, 'next', selChildren, selAllocs)
      const out: Allocation = {}
      for (const w of weighted) mergeAlloc(out, w.alloc, w.share)
      return normalizeAlloc(out)
    }
    case 'altExit': {
      // Evaluate both entry and exit conditions
      const entryOk = evalConditions(ctx, node.id, node.entryConditions, `${node.id}:entry`)
      const exitOk = evalConditions(ctx, node.id, node.exitConditions, `${node.id}:exit`)

      // Get previous state from trace (or null for first bar)
      const prevState = ctx.trace?.getAltExitState(node.id) ?? null

      let currentState: 'then' | 'else'
      if (prevState === null) {
        // First bar: entry takes priority
        currentState = entryOk ? 'then' : 'else'
      } else if (prevState === 'then') {
        // In THEN: only exit condition can change us
        currentState = exitOk ? 'else' : 'then'
      } else {
        // In ELSE: only entry condition can change us
        currentState = entryOk ? 'then' : 'else'
      }

      // Store current state for next bar
      ctx.trace?.setAltExitState(node.id, currentState)
      ctx.trace?.recordBranch(node.id, 'altExit', currentState === 'then')

      const slot: SlotId = currentState
      const children = (node.children[slot] || []).filter((c): c is FlowNode => Boolean(c))
      const childAllocs = children.map((c) => evaluateNode(ctx, c, callStack))
      const weighted = weightChildren(ctx, node, slot, children, childAllocs)
      const out: Allocation = {}
      for (const w of weighted) mergeAlloc(out, w.alloc, w.share)
      return normalizeAlloc(out)
    }
    case 'scaling': {
      const metric = node.scaleMetric ?? 'Relative Strength Index'
      const win = Math.floor(Number(node.scaleWindow ?? 14))
      const ticker = node.scaleTicker ?? 'SPY'
      const fromVal = Number(node.scaleFrom ?? 30)
      const toVal = Number(node.scaleTo ?? 70)

      const currentVal = metricAt(ctx, ticker, metric, win)

      // Calculate weights
      let thenWeight: number
      let elseWeight: number

      if (currentVal == null) {
        // No data available - default to 50/50
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

      ctx.trace?.recordBranch(node.id, 'scaling', thenWeight > 0.5)

      // Evaluate both branches and blend allocations
      const thenChildren = (node.children.then || []).filter((c): c is FlowNode => Boolean(c))
      const elseChildren = (node.children.else || []).filter((c): c is FlowNode => Boolean(c))

      const thenAllocs = thenChildren.map((c) => evaluateNode(ctx, c, callStack))
      const elseAllocs = elseChildren.map((c) => evaluateNode(ctx, c, callStack))

      const thenWeighted = weightChildren(ctx, node, 'then', thenChildren, thenAllocs)
      const elseWeighted = weightChildren(ctx, node, 'else', elseChildren, elseAllocs)

      const out: Allocation = {}
      for (const w of thenWeighted) mergeAlloc(out, w.alloc, w.share * thenWeight)
      for (const w of elseWeighted) mergeAlloc(out, w.alloc, w.share * elseWeight)
      return normalizeAlloc(out)
    }
  }
}
