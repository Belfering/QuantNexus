// src/features/builder/utils/tickerSearch.ts
// Utilities for searching and replacing tickers in the flow tree

import type { FlowNode, ConditionLine, TickerInstance } from '@/types'
import { getAllSlotsForNode } from './helpers'

/**
 * Find all instances of a ticker in the tree
 */
export const findTickerInstances = (
  root: FlowNode,
  ticker: string,
  includePositions: boolean,
  includeIndicators: boolean,
  callChainId?: string
): TickerInstance[] => {
  const instances: TickerInstance[] = []
  if (!ticker.trim()) return instances
  const normalized = ticker.trim().toUpperCase()

  const traverse = (node: FlowNode) => {
    // Check positions (Trade Tickers)
    if (includePositions && node.positions) {
      node.positions.forEach((p, idx) => {
        if (p.toUpperCase() === normalized) {
          instances.push({ nodeId: node.id, field: 'position', index: idx, callChainId })
        }
      })
    }

    // Check conditions (Indicator Tickers)
    if (includeIndicators && node.conditions) {
      node.conditions.forEach((cond, idx) => {
        if (cond.ticker?.toUpperCase() === normalized) {
          instances.push({ nodeId: node.id, field: 'condition', index: idx, callChainId })
        }
        if (cond.rightTicker?.toUpperCase() === normalized) {
          instances.push({ nodeId: node.id, field: 'rightCondition', index: idx, callChainId })
        }
      })
    }

    // Check numbered items
    if (includeIndicators && node.numbered?.items) {
      node.numbered.items.forEach(item => {
        item.conditions?.forEach((cond, idx) => {
          if (cond.ticker?.toUpperCase() === normalized) {
            instances.push({ nodeId: node.id, field: 'condition', index: idx, itemId: item.id, callChainId })
          }
          if (cond.rightTicker?.toUpperCase() === normalized) {
            instances.push({ nodeId: node.id, field: 'rightCondition', index: idx, itemId: item.id, callChainId })
          }
        })
      })
    }

    // Check entry/exit conditions (Alt Exit nodes)
    if (includeIndicators && node.entryConditions) {
      node.entryConditions.forEach((cond, idx) => {
        if (cond.ticker?.toUpperCase() === normalized) {
          instances.push({ nodeId: node.id, field: 'entry', index: idx, callChainId })
        }
        if (cond.rightTicker?.toUpperCase() === normalized) {
          instances.push({ nodeId: node.id, field: 'rightCondition', index: idx, callChainId })
        }
      })
    }
    if (includeIndicators && node.exitConditions) {
      node.exitConditions.forEach((cond, idx) => {
        if (cond.ticker?.toUpperCase() === normalized) {
          instances.push({ nodeId: node.id, field: 'exit', index: idx, callChainId })
        }
        if (cond.rightTicker?.toUpperCase() === normalized) {
          instances.push({ nodeId: node.id, field: 'rightCondition', index: idx, callChainId })
        }
      })
    }

    // Check scaleTicker
    if (includeIndicators && node.scaleTicker?.toUpperCase() === normalized) {
      instances.push({ nodeId: node.id, field: 'scaleTicker', callChainId })
    }

    // Check capped fallbacks (considered as positions)
    if (includePositions) {
      if (node.cappedFallback?.toUpperCase() === normalized) {
        instances.push({ nodeId: node.id, field: 'cappedFallback', callChainId })
      }
      if (node.cappedFallbackThen?.toUpperCase() === normalized) {
        instances.push({ nodeId: node.id, field: 'cappedFallback', callChainId })
      }
      if (node.cappedFallbackElse?.toUpperCase() === normalized) {
        instances.push({ nodeId: node.id, field: 'cappedFallback', callChainId })
      }
    }

    // Recurse into children
    for (const slot of getAllSlotsForNode(node)) {
      const arr = node.children[slot]
      if (arr) {
        arr.forEach(child => { if (child) traverse(child) })
      }
    }
  }

  traverse(root)
  return instances
}

/**
 * Collect all unique tickers used in the tree (for Find/Replace autocomplete)
 */
export const collectUsedTickers = (root: FlowNode, callChains?: { id: string; root: string | FlowNode }[]): string[] => {
  const tickers = new Set<string>()

  const traverse = (node: FlowNode) => {
    // Positions
    if (node.positions) {
      node.positions.forEach(p => {
        if (p && p !== 'Empty') tickers.add(p.toUpperCase())
      })
    }

    // Conditions (ticker and rightTicker)
    if (node.conditions) {
      node.conditions.forEach(cond => {
        if (cond.ticker) tickers.add(cond.ticker.toUpperCase())
        if (cond.rightTicker) tickers.add(cond.rightTicker.toUpperCase())
      })
    }

    // Numbered items
    if (node.numbered?.items) {
      node.numbered.items.forEach(item => {
        item.conditions?.forEach(cond => {
          if (cond.ticker) tickers.add(cond.ticker.toUpperCase())
          if (cond.rightTicker) tickers.add(cond.rightTicker.toUpperCase())
        })
      })
    }

    // Entry/Exit conditions (Alt Exit nodes)
    if (node.entryConditions) {
      node.entryConditions.forEach(cond => {
        if (cond.ticker) tickers.add(cond.ticker.toUpperCase())
        if (cond.rightTicker) tickers.add(cond.rightTicker.toUpperCase())
      })
    }
    if (node.exitConditions) {
      node.exitConditions.forEach(cond => {
        if (cond.ticker) tickers.add(cond.ticker.toUpperCase())
        if (cond.rightTicker) tickers.add(cond.rightTicker.toUpperCase())
      })
    }

    // scaleTicker
    if (node.scaleTicker) tickers.add(node.scaleTicker.toUpperCase())

    // Capped fallbacks
    if (node.cappedFallback && node.cappedFallback !== 'Empty') tickers.add(node.cappedFallback.toUpperCase())
    if (node.cappedFallbackThen && node.cappedFallbackThen !== 'Empty') tickers.add(node.cappedFallbackThen.toUpperCase())
    if (node.cappedFallbackElse && node.cappedFallbackElse !== 'Empty') tickers.add(node.cappedFallbackElse.toUpperCase())

    // Recurse into children
    for (const slot of getAllSlotsForNode(node)) {
      const arr = node.children[slot]
      if (arr) {
        arr.forEach(child => { if (child) traverse(child) })
      }
    }
  }

  traverse(root)

  // Also check call chains if provided
  if (callChains) {
    callChains.forEach(chain => {
      try {
        const chainRoot = typeof chain.root === 'string' ? JSON.parse(chain.root) : chain.root
        traverse(chainRoot)
      } catch { /* ignore parse errors */ }
    })
  }

  return [...tickers].sort()
}

/**
 * Extended condition with parent node ID for branch reference resolution
 */
export interface ConditionWithContext extends ConditionLine {
  parentNodeId?: string
}

/**
 * Collect enabled conditions from the tree for indicator overlay
 * Includes parentNodeId for conditions that use branch references (branch:from, branch:to, etc.)
 * so the server can look up the parent node to compute branch equity curves.
 */
export const collectEnabledConditions = (
  root: FlowNode,
  enabledSet: Set<string>
): ConditionWithContext[] => {
  const conditions: ConditionWithContext[] = []
  if (enabledSet.size === 0) return conditions

  const traverse = (node: FlowNode) => {
    // Check regular conditions
    if (node.conditions) {
      node.conditions.forEach(cond => {
        const key = `${node.id}:${cond.id}`
        if (enabledSet.has(key)) {
          // Include parent node ID for branch reference resolution
          conditions.push({ ...cond, parentNodeId: node.id })
        }
      })
    }

    // Check numbered items
    if (node.numbered?.items) {
      node.numbered.items.forEach(item => {
        item.conditions?.forEach(cond => {
          const key = `${node.id}:${item.id}:${cond.id}`
          if (enabledSet.has(key)) {
            conditions.push({ ...cond, parentNodeId: node.id })
          }
        })
      })
    }

    // Check entry/exit conditions (Alt Exit nodes)
    if (node.entryConditions) {
      node.entryConditions.forEach(cond => {
        const key = `${node.id}:entry:${cond.id}`
        if (enabledSet.has(key)) {
          conditions.push({ ...cond, parentNodeId: node.id })
        }
      })
    }
    if (node.exitConditions) {
      node.exitConditions.forEach(cond => {
        const key = `${node.id}:exit:${cond.id}`
        if (enabledSet.has(key)) {
          conditions.push({ ...cond, parentNodeId: node.id })
        }
      })
    }

    // Check scaling node overlay (Scale by indicator)
    if (node.kind === 'scaling') {
      const scaleKey = `${node.id}:scale`
      if (enabledSet.has(scaleKey)) {
        // Create a synthetic condition for the scaling indicator
        conditions.push({
          id: `${node.id}-scale`,
          type: 'if',
          ticker: node.scaleTicker ?? 'SPY',
          metric: node.scaleMetric ?? 'Relative Strength Index',
          window: node.scaleWindow ?? 14,
          comparator: 'gt',
          threshold: 0,
          parentNodeId: node.id,
        })
      }
    }

    // Recurse into children
    for (const slot of getAllSlotsForNode(node)) {
      const arr = node.children[slot]
      if (arr) {
        arr.forEach(child => { if (child) traverse(child) })
      }
    }
  }

  traverse(root)
  return conditions
}

/**
 * Replace all instances of a ticker in the tree (returns new tree)
 */
export const replaceTickerInTree = (
  root: FlowNode,
  fromTicker: string,
  toTicker: string,
  includePositions: boolean,
  includeIndicators: boolean
): FlowNode => {
  const from = fromTicker.trim().toUpperCase()
  const to = toTicker.trim().toUpperCase() || 'Empty'

  const replaceInNode = (node: FlowNode): FlowNode => {
    const next = { ...node }

    // Replace in positions
    if (includePositions && next.positions) {
      next.positions = next.positions.map(p =>
        p.toUpperCase() === from ? to : p
      )
    }

    // Replace in conditions
    if (includeIndicators && next.conditions) {
      next.conditions = next.conditions.map(c => ({
        ...c,
        ticker: c.ticker?.toUpperCase() === from ? to : c.ticker,
        rightTicker: c.rightTicker?.toUpperCase() === from ? to : c.rightTicker,
      }))
    }

    // Replace in numbered items
    if (includeIndicators && next.numbered?.items) {
      next.numbered = {
        ...next.numbered,
        items: next.numbered.items.map(item => ({
          ...item,
          conditions: item.conditions?.map(c => ({
            ...c,
            ticker: c.ticker?.toUpperCase() === from ? to : c.ticker,
            rightTicker: c.rightTicker?.toUpperCase() === from ? to : c.rightTicker,
          }))
        }))
      }
    }

    // Replace in entry/exit conditions
    if (includeIndicators && next.entryConditions) {
      next.entryConditions = next.entryConditions.map(c => ({
        ...c,
        ticker: c.ticker?.toUpperCase() === from ? to : c.ticker,
        rightTicker: c.rightTicker?.toUpperCase() === from ? to : c.rightTicker,
      }))
    }
    if (includeIndicators && next.exitConditions) {
      next.exitConditions = next.exitConditions.map(c => ({
        ...c,
        ticker: c.ticker?.toUpperCase() === from ? to : c.ticker,
        rightTicker: c.rightTicker?.toUpperCase() === from ? to : c.rightTicker,
      }))
    }

    // Replace scaleTicker
    if (includeIndicators && next.scaleTicker?.toUpperCase() === from) {
      next.scaleTicker = to
    }

    // Replace capped fallbacks
    if (includePositions) {
      if (next.cappedFallback?.toUpperCase() === from) next.cappedFallback = to
      if (next.cappedFallbackThen?.toUpperCase() === from) next.cappedFallbackThen = to
      if (next.cappedFallbackElse?.toUpperCase() === from) next.cappedFallbackElse = to
    }

    // Recurse into children
    if (next.children) {
      const newChildren: typeof next.children = {}
      for (const slot of getAllSlotsForNode(node)) {
        const arr = next.children[slot]
        newChildren[slot] = arr?.map(child =>
          child ? replaceInNode(child) : child
        )
      }
      next.children = newChildren
    }

    return next
  }

  return replaceInNode(root)
}
