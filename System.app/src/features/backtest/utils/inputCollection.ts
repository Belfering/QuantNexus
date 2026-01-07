// src/features/backtest/utils/inputCollection.ts
// Functions for collecting and validating backtest inputs from the flowchart tree

import type {
  FlowNode,
  SlotId,
  PositionChoice,
  MetricChoice,
  ConditionLine,
  CallChain,
  BacktestError,
} from '@/types'
import { isWindowlessIndicator, getIndicatorLookback } from '@/constants'
import { normalizeChoice, expandTickerComponents } from '@/shared/utils'
import { ensureSlots, cloneNode, getAllSlotsForNode } from '@/features/builder'
import { getSlotConfig } from '../engine'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reference to a ticker usage in the tree
 */
export type TickerRef = { nodeId: string; field: string }

/**
 * Collected inputs required for running a backtest
 */
export type BacktestInputs = {
  tickers: string[]
  tickerRefs: Map<string, TickerRef>
  maxLookback: number
  errors: BacktestError[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Input Collection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Collect all tickers, validate conditions, and compute max lookback for a backtest.
 * Returns validation errors if the tree has configuration issues.
 */
export const collectBacktestInputs = (
  root: FlowNode,
  callMap: Map<string, CallChain>
): BacktestInputs => {
  const errors: BacktestError[] = []
  const tickers = new Set<string>()
  const tickerRefs = new Map<string, TickerRef>()
  let maxLookback = 0

  const addTicker = (t: PositionChoice, nodeId: string, field: string) => {
    const norm = normalizeChoice(t)
    if (norm === 'Empty') return
    // For ratio tickers like "JNK/XLP", add both components for fetching
    const components = expandTickerComponents(norm)
    for (const c of components) {
      tickers.add(c)
      if (!tickerRefs.has(c)) tickerRefs.set(c, { nodeId, field })
    }
  }

  const addError = (nodeId: string, field: string, message: string) =>
    errors.push({ nodeId, field, message })

  const validateCondition = (ownerId: string, fieldPrefix: string, cond: ConditionLine) => {
    const baseField = `${fieldPrefix}.${cond.id}`
    const ticker = normalizeChoice(cond.ticker)
    if (ticker === 'Empty') {
      addError(ownerId, `${baseField}.ticker`, 'Indicator condition is missing a ticker.')
    } else {
      addTicker(ticker, ownerId, `${baseField}.ticker`)
    }
    // forDays adds extra lookback (we need to check N consecutive days)
    const forDaysOffset = Math.max(0, (cond.forDays || 1) - 1)
    if (cond.metric !== 'Current Price' && !isWindowlessIndicator(cond.metric)) {
      if (!Number.isFinite(cond.window) || cond.window < 1)
        addError(ownerId, `${baseField}.window`, 'Indicator window must be >= 1.')
    }
    // Use actual indicator lookback (e.g., 252 for momentum indicators)
    maxLookback = Math.max(maxLookback, getIndicatorLookback(cond.metric, cond.window || 0) + forDaysOffset)
    if (cond.expanded) {
      const rt = normalizeChoice(cond.rightTicker ?? '')
      if (rt === 'Empty') addError(ownerId, `${baseField}.rightTicker`, 'Right-side ticker is missing.')
      else addTicker(rt, ownerId, `${baseField}.rightTicker`)
      const rw = Number(cond.rightWindow ?? cond.window)
      const rightMetric = (cond.rightMetric ?? cond.metric) as MetricChoice
      if (rightMetric !== 'Current Price' && !isWindowlessIndicator(rightMetric)) {
        if (!Number.isFinite(rw) || rw < 1)
          addError(ownerId, `${baseField}.rightWindow`, 'Right-side window must be >= 1.')
      }
      // Use actual indicator lookback for right side
      maxLookback = Math.max(maxLookback, getIndicatorLookback(rightMetric, rw || 0) + forDaysOffset)
    }
  }

  const walk = (node: FlowNode, callStack: string[]) => {
    if (node.kind === 'call') {
      const callId = node.callRefId
      if (!callId) {
        addError(node.id, 'callRefId', 'Select a call chain to reference.')
        return
      }
      if (callStack.includes(callId)) {
        addError(node.id, 'callRefId', 'Call references cannot form a loop.')
        return
      }
      const target = callMap.get(callId)
      if (!target) {
        addError(node.id, 'callRefId', 'Call chain not found.')
        return
      }
      const cloned = ensureSlots(cloneNode(target.root))
      walk(cloned, [...callStack, callId])
      return
    }

    if (node.kind === 'indicator' && node.conditions) {
      node.conditions.forEach((c) => validateCondition(node.id, 'conditions', c))
    }
    if (node.kind === 'numbered' && node.numbered) {
      node.numbered.items.forEach((item) => {
        item.conditions.forEach((c) =>
          validateCondition(node.id, `numbered.items.${item.id}.conditions`, c)
        )
      })
    }
    if (node.kind === 'position') {
      for (const p of node.positions || []) addTicker(p, node.id, 'positions')
    }

    if (node.kind === 'function') {
      const metric = node.metric ?? 'Relative Strength Index'
      const win = isWindowlessIndicator(metric) ? 0 : Math.floor(Number(node.window ?? 10))
      if (!isWindowlessIndicator(metric) && (!(win >= 1) || !Number.isFinite(win))) {
        addError(node.id, 'window', 'Sort window must be >= 1.')
      }
      maxLookback = Math.max(maxLookback, win || 0)
      const pickN = Math.floor(Number(node.bottom ?? 1))
      if (!(pickN >= 1) || !Number.isFinite(pickN))
        addError(node.id, 'bottom', 'Pick count must be >= 1.')
      const nextChildren = (node.children.next ?? []).filter((c): c is FlowNode => Boolean(c))
      if (Number.isFinite(pickN) && pickN >= 1 && nextChildren.length < pickN) {
        addError(
          node.id,
          'bottom',
          `Pick count is ${pickN} but only ${nextChildren.length} child nodes exist.`
        )
      }
    }

    // Alt Exit node - validate entry/exit conditions and add their tickers
    if (node.kind === 'altExit') {
      if (node.entryConditions) {
        node.entryConditions.forEach((c) => validateCondition(node.id, 'entryConditions', c))
      }
      if (node.exitConditions) {
        node.exitConditions.forEach((c) => validateCondition(node.id, 'exitConditions', c))
      }
    }

    // Scaling node - validate and add the scale ticker
    if (node.kind === 'scaling') {
      const scaleTicker = normalizeChoice(node.scaleTicker ?? 'SPY')
      if (scaleTicker === 'Empty') {
        addError(node.id, 'scaleTicker', 'Scaling node is missing a ticker.')
      } else {
        addTicker(scaleTicker, node.id, 'scaleTicker')
      }
      const scaleMetric = node.scaleMetric ?? 'Relative Strength Index'
      const scaleWin = isWindowlessIndicator(scaleMetric)
        ? 0
        : Math.floor(Number(node.scaleWindow ?? 14))
      if (!isWindowlessIndicator(scaleMetric) && (!(scaleWin >= 1) || !Number.isFinite(scaleWin))) {
        addError(node.id, 'scaleWindow', 'Scale window must be >= 1.')
      }
      maxLookback = Math.max(maxLookback, scaleWin || 0)
    }

    // weight-mode-specific validations for the node's active slots
    const slotsToCheck: SlotId[] =
      node.kind === 'indicator' ||
      node.kind === 'numbered' ||
      node.kind === 'altExit' ||
      node.kind === 'scaling'
        ? ['then', 'else']
        : node.kind === 'position'
          ? []
          : ['next']

    for (const slot of slotsToCheck) {
      const { mode, volWindow, cappedFallback } = getSlotConfig(node, slot)
      if ((mode === 'inverse' || mode === 'pro') && (!Number.isFinite(volWindow) || volWindow < 1)) {
        addError(node.id, `volWindow.${slot}`, 'Volatility window must be >= 1.')
      }
      if (mode === 'inverse' || mode === 'pro') {
        maxLookback = Math.max(maxLookback, Math.floor(Number(volWindow || 0)))
      }
      if (mode === 'capped') addTicker(cappedFallback, node.id, `cappedFallback.${slot}`)
      const children = (node.children[slot] ?? []).filter((c): c is FlowNode => Boolean(c))
      if (mode === 'defined' || mode === 'capped') {
        for (const child of children) {
          const v = Number(child.window)
          // Allow 0% weight (valid choice to not allocate to a branch)
          // Only error if undefined/NaN or negative
          if (!Number.isFinite(v) || v < 0) {
            addError(
              child.id,
              'window',
              `${mode === 'capped' ? 'Cap' : 'Weight'} % is missing for "${child.title}".`
            )
          } else if (mode === 'capped' && v > 100) {
            addError(child.id, 'window', `Cap % must be <= 100 for "${child.title}".`)
          }
        }
      }
    }

    for (const slot of getAllSlotsForNode(node)) {
      const arr = node.children[slot] || []
      for (const c of arr) if (c) walk(c, callStack)
    }
  }

  walk(root, [])

  return { tickers: Array.from(tickers).sort(), tickerRefs, maxLookback, errors }
}

// ─────────────────────────────────────────────────────────────────────────────
// Position Ticker Collection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Collect only position tickers (tickers held in position nodes).
 * Does not include indicator tickers from conditions.
 */
export const collectPositionTickers = (
  root: FlowNode,
  callMap: Map<string, CallChain>
): string[] => {
  const tickers = new Set<string>()

  const addTicker = (t: PositionChoice) => {
    const norm = normalizeChoice(t)
    if (norm === 'Empty') return
    tickers.add(norm)
  }

  const walk = (node: FlowNode, callStack: string[]) => {
    if (node.kind === 'call') {
      const callId = node.callRefId
      if (!callId) return
      if (callStack.includes(callId)) return
      const target = callMap.get(callId)
      if (!target) return
      const cloned = ensureSlots(cloneNode(target.root))
      walk(cloned, [...callStack, callId])
      return
    }

    if (node.kind === 'position') {
      for (const p of node.positions || []) addTicker(p)
    }

    for (const slot of getAllSlotsForNode(node)) {
      const arr = node.children[slot] || []
      for (const c of arr) if (c) walk(c, callStack)
    }
  }

  walk(root, [])

  return Array.from(tickers).sort()
}

// ─────────────────────────────────────────────────────────────────────────────
// ETF-Only Check
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a bot only contains ETF positions.
 * Returns true if all position tickers are ETFs, false if any are stocks or unknown.
 */
export const isEtfsOnlyBot = (
  root: FlowNode,
  callMap: Map<string, CallChain>,
  tickerMetadata: Map<string, { assetType?: string; name?: string }>
): boolean => {
  const positionTickers = collectPositionTickers(root, callMap)

  // Exclude special values that aren't real tickers
  const realTickers = positionTickers.filter((t) => t !== 'Empty' && t !== 'CASH' && t !== 'BIL')

  // If no real tickers, consider it ETF-only (vacuously true)
  if (realTickers.length === 0) return true

  // Check if all tickers are ETFs
  return realTickers.every((ticker) => {
    const meta = tickerMetadata.get(ticker.toUpperCase())
    // If we don't have metadata for the ticker, assume it's not an ETF (be conservative)
    return meta?.assetType === 'ETF'
  })
}

/**
 * Check if ALL tickers in a bot (both positions AND indicators) are ETFs.
 * This is a stricter check than isEtfsOnlyBot which only checks positions.
 * Used for the "ETFs Only" badge on the Analyze tab.
 */
export const isAllTickersEtf = (
  root: FlowNode,
  callMap: Map<string, CallChain>,
  tickerMetadata: Map<string, { assetType?: string; name?: string }>
): boolean => {
  const positionTickers = collectPositionTickers(root, callMap)
  const indicatorTickers = collectIndicatorTickers(root, callMap)
  const allTickers = [...new Set([...positionTickers, ...indicatorTickers])]

  // Exclude special values that aren't real tickers
  const realTickers = allTickers.filter((t) => t !== 'Empty' && t !== 'CASH' && t !== 'BIL')

  // If no real tickers, consider it ETF-only (vacuously true)
  if (realTickers.length === 0) return true

  // Check if all tickers are ETFs
  return realTickers.every((ticker) => {
    const meta = tickerMetadata.get(ticker.toUpperCase())
    // If we don't have metadata for the ticker, assume it's not an ETF (be conservative)
    return meta?.assetType === 'ETF'
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Indicator Ticker Collection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Collect only indicator tickers (from conditions, function nodes, scaling nodes).
 * Excludes position tickers since those can have shorter history without affecting
 * indicator calculations.
 */
export const collectIndicatorTickers = (
  root: FlowNode,
  callMap: Map<string, CallChain>
): string[] => {
  const tickers = new Set<string>()

  const addTicker = (t: PositionChoice) => {
    const norm = normalizeChoice(t)
    if (norm === 'Empty') return
    // For ratio tickers like "JNK/XLP", add both components
    const components = expandTickerComponents(norm)
    for (const c of components) tickers.add(c)
  }

  const collectFromCondition = (cond: ConditionLine) => {
    const ticker = normalizeChoice(cond.ticker)
    if (ticker !== 'Empty') addTicker(ticker)
    if (cond.expanded) {
      const rt = normalizeChoice(cond.rightTicker ?? '')
      if (rt !== 'Empty') addTicker(rt)
    }
  }

  const walk = (node: FlowNode, callStack: string[]) => {
    if (node.kind === 'call') {
      const callId = node.callRefId
      if (!callId) return
      if (callStack.includes(callId)) return
      const target = callMap.get(callId)
      if (!target) return
      const cloned = ensureSlots(cloneNode(target.root))
      walk(cloned, [...callStack, callId])
      return
    }

    // Indicator nodes have conditions with tickers
    if (node.kind === 'indicator' && node.conditions) {
      node.conditions.forEach((c) => collectFromCondition(c))
    }

    // Numbered nodes have items with conditions
    if (node.kind === 'numbered' && node.numbered) {
      node.numbered.items.forEach((item) => {
        item.conditions.forEach((c) => collectFromCondition(c))
      })
    }

    // Alt Exit nodes have entry/exit conditions
    if (node.kind === 'altExit') {
      if (node.entryConditions) node.entryConditions.forEach((c) => collectFromCondition(c))
      if (node.exitConditions) node.exitConditions.forEach((c) => collectFromCondition(c))
    }

    // Scaling nodes have a scale ticker
    if (node.kind === 'scaling') {
      const scaleTicker = normalizeChoice(node.scaleTicker ?? 'SPY')
      if (scaleTicker !== 'Empty') addTicker(scaleTicker)
    }

    // Function nodes sort by a metric on their children (the children are usually positions)
    // The function node itself may reference tickers in the metric context
    // (but typically uses the children's tickers which are position tickers)
    // We don't add function node tickers here since those are in the children

    // Walk all children (including ladder slots)
    for (const slot of getAllSlotsForNode(node)) {
      const arr = node.children[slot] || []
      for (const c of arr) if (c) walk(c, callStack)
    }
  }

  walk(root, [])

  return Array.from(tickers).sort()
}
