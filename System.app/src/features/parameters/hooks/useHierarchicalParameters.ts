// src/features/parameters/hooks/useHierarchicalParameters.ts
// Hook to recursively extract hierarchical parameters from flowchart tree

import { useMemo } from 'react'
import type { FlowNode, ConditionLine } from '@/types/flowNode'
import { SLOT_ORDER } from '@/types/flowNode'
import type { HierarchicalParameter, StrategyParameter, ConditionParameter } from '../types'

/**
 * Hook to extract hierarchical parameters from flowchart tree
 * Returns recursive tree structure that mirrors flowchart hierarchy
 */
export function useHierarchicalParameters(root: FlowNode | null): HierarchicalParameter | null {
  return useMemo(() => {
    if (!root) return null
    return extractHierarchicalParameters(root, 0, [])
  }, [root])
}

/**
 * Recursively extract parameters from node and its children
 */
function extractHierarchicalParameters(
  node: FlowNode,
  depth: number,
  path: string[]
): HierarchicalParameter {
  const nodePath = [...path, node.id]
  const parameters = extractNodeParameters(node)

  // Recursively extract children
  const children: HierarchicalParameter['children'] = {}
  const slots = SLOT_ORDER[node.kind]

  for (const slot of slots) {
    const slotChildren = node.children[slot]
    if (slotChildren && slotChildren.length > 0) {
      children[slot] = slotChildren
        .filter(child => child !== null)
        .map(child => extractHierarchicalParameters(
          child as FlowNode,
          depth + 1,
          nodePath
        ))
    }
  }

  return {
    nodeId: node.id,
    nodePath,
    depth,
    nodeTitle: node.title,
    nodeKind: node.kind,
    nodeColor: node.bgColor,
    parameters,
    children
  }
}

/**
 * Extract strategy parameters from a single node
 */
function extractNodeParameters(node: FlowNode): StrategyParameter[] {
  const params: StrategyParameter[] = []

  switch (node.kind) {
    case 'basic':
    case 'function':
      // Basic nodes have a single weight
      params.push({
        type: 'weight',
        field: 'weighting',
        currentValue: node.weighting
      })

      // Function nodes have additional parameters
      if (node.kind === 'function') {
        params.push(
          { type: 'function', field: 'window', currentValue: node.window ?? 20 },
          { type: 'function', field: 'metric', currentValue: node.metric ?? 'rsi' },
          { type: 'function', field: 'bottom', currentValue: node.bottom ?? 2 },
          { type: 'function', field: 'rank', currentValue: node.rank ?? 'Bottom' }
        )
      }
      break

    case 'indicator':
    case 'numbered':
      // Smart branch weights (only for indicator/numbered nodes)
      params.push(
        { type: 'weight', field: 'weightingThen', currentValue: node.weightingThen ?? 'equal', branch: 'then' },
        { type: 'weight', field: 'weightingElse', currentValue: node.weightingElse ?? 'equal', branch: 'else' }
      )

      // Extract conditions from indicator nodes
      if (node.kind === 'indicator' && node.conditions) {
        node.conditions.forEach(cond => {
          params.push(...extractConditionParameters(cond, node.id))
        })
      }

      // Extract numbered config and conditions
      if (node.kind === 'numbered' && node.numbered) {
        params.push(
          { type: 'numbered', field: 'quantifier', currentValue: node.numbered.quantifier },
          { type: 'numbered', field: 'n', currentValue: node.numbered.n }
        )

        // Extract conditions from each numbered item
        node.numbered.items.forEach(item => {
          item.conditions.forEach(cond => {
            params.push(...extractConditionParameters(cond, node.id, item.id))
          })
        })
      }
      break

    case 'position':
      // Position nodes show ticker array
      params.push({
        type: 'position',
        field: 'positions',
        currentValue: node.positions ?? ['Empty']
      })
      break

    case 'altExit':
      // AltExit nodes have branch weights
      params.push(
        { type: 'weight', field: 'weightingThen', currentValue: node.weightingThen ?? 'equal', branch: 'then' },
        { type: 'weight', field: 'weightingElse', currentValue: node.weightingElse ?? 'equal', branch: 'else' }
      )
      // TODO: Extract entry/exit conditions if needed
      break

    case 'scaling':
      // Scaling nodes have branch weights
      params.push(
        { type: 'weight', field: 'weightingThen', currentValue: node.weightingThen ?? 'equal', branch: 'then' },
        { type: 'weight', field: 'weightingElse', currentValue: node.weightingElse ?? 'equal', branch: 'else' }
      )
      // Extract scaling parameters
      params.push(
        { type: 'scaling', field: 'scaleWindow', currentValue: node.scaleWindow ?? 14 },
        { type: 'scaling', field: 'scaleMetric', currentValue: node.scaleMetric ?? 'Relative Strength Index' },
        { type: 'scaling', field: 'scaleTicker', currentValue: node.scaleTicker ?? 'SPY' },
        { type: 'scaling', field: 'scaleFrom', currentValue: node.scaleFrom ?? 30 },
        { type: 'scaling', field: 'scaleTo', currentValue: node.scaleTo ?? 70 }
      )
      break

    case 'call':
      // Call nodes don't have editable parameters (they reference other chains)
      break
  }

  return params
}

/**
 * Extract condition parameters (window, metric, comparator, ticker, threshold)
 * Also extracts expanded fields (rightWindow, rightMetric, rightTicker, forDays) when condition is expanded
 */
function extractConditionParameters(
  cond: ConditionLine,
  nodeId: string,
  itemId?: string
): ConditionParameter[] {
  const params: ConditionParameter[] = []

  const baseId = itemId ? `${nodeId}-${itemId}-${cond.id}` : `${nodeId}-${cond.id}`

  // Window (period)
  if (cond.window !== undefined) {
    params.push({
      type: 'condition',
      conditionId: cond.id,
      itemId,
      field: 'window',
      currentValue: cond.window,
      optimizationEnabled: false
    })
  }

  // Metric
  if (cond.metric !== undefined) {
    params.push({
      type: 'condition',
      conditionId: cond.id,
      itemId,
      field: 'metric',
      currentValue: cond.metric
    })
  }

  // Comparator
  if (cond.comparator !== undefined) {
    params.push({
      type: 'condition',
      conditionId: cond.id,
      itemId,
      field: 'comparator',
      currentValue: cond.comparator
    })
  }

  // Ticker
  if (cond.ticker !== undefined) {
    params.push({
      type: 'condition',
      conditionId: cond.id,
      itemId,
      field: 'ticker',
      currentValue: cond.ticker
    })
  }

  // Threshold
  if (cond.threshold !== undefined) {
    params.push({
      type: 'condition',
      conditionId: cond.id,
      itemId,
      field: 'threshold',
      currentValue: cond.threshold,
      optimizationEnabled: false
    })
  }

  // Expanded fields (when condition is expanded)
  if (cond.expanded) {
    // Right window
    if (cond.rightWindow !== undefined) {
      params.push({
        type: 'condition',
        conditionId: cond.id,
        itemId,
        field: 'rightWindow',
        currentValue: cond.rightWindow,
        optimizationEnabled: false
      })
    }

    // Right metric
    if (cond.rightMetric !== undefined) {
      params.push({
        type: 'condition',
        conditionId: cond.id,
        itemId,
        field: 'rightMetric',
        currentValue: cond.rightMetric
      })
    }

    // Right ticker
    if (cond.rightTicker !== undefined) {
      params.push({
        type: 'condition',
        conditionId: cond.id,
        itemId,
        field: 'rightTicker',
        currentValue: cond.rightTicker
      })
    }

    // For days
    if (cond.forDays !== undefined) {
      params.push({
        type: 'condition',
        conditionId: cond.id,
        itemId,
        field: 'forDays',
        currentValue: cond.forDays
      })
    }
  }

  return params
}
