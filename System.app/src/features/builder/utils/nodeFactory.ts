// src/features/builder/utils/nodeFactory.ts
// Factory functions for creating and normalizing flow nodes

import type { FlowNode, BlockKind, SlotId } from '@/types'
import { SLOT_ORDER } from '@/types'
import { getAllSlotsForNode, newId } from './helpers'

/**
 * Create a new node of the specified kind with default values
 */
export const createNode = (kind: BlockKind): FlowNode => {
  const needsThenElseWeighting = kind === 'indicator' || kind === 'numbered' || kind === 'altExit' || kind === 'scaling'
  const base: FlowNode = {
    id: newId(),
    kind,
    title:
      kind === 'function'
        ? 'Sort'
        : kind === 'indicator'
          ? 'Indicator'
          : kind === 'numbered'
            ? 'Numbered'
            : kind === 'position'
              ? 'Position'
              : kind === 'call'
                ? 'Call Reference'
                : kind === 'altExit'
                  ? 'Alt Exit'
                  : kind === 'scaling'
                    ? 'Scaling'
                    : 'Basic',
    children: {},
    weighting: 'equal',
    weightingThen: needsThenElseWeighting ? 'equal' : undefined,
    weightingElse: needsThenElseWeighting ? 'equal' : undefined,
    cappedFallback: undefined,
    cappedFallbackThen: undefined,
    cappedFallbackElse: undefined,
    volWindow: undefined,
    volWindowThen: undefined,
    volWindowElse: undefined,
    bgColor: undefined,
    conditions:
      kind === 'indicator'
        ? [
            {
              id: newId(),
              type: 'if',
              window: 14,
              metric: 'Relative Strength Index',
              comparator: 'lt',
              ticker: 'SPY',
              threshold: 30,
            },
          ]
        : undefined,
    numbered:
      kind === 'numbered'
        ? {
            quantifier: 'all',
            n: 1,
            items: [
              {
                id: newId(),
                conditions: [
                  {
                    id: newId(),
                    type: 'if',
                    window: 14,
                    metric: 'Relative Strength Index',
                    comparator: 'lt',
                    ticker: 'SPY',
                    threshold: 30,
                    expanded: false,
                    rightWindow: 14,
                    rightMetric: 'Relative Strength Index',
                    rightTicker: 'SPY',
                  },
                ],
              },
            ],
          }
        : undefined,
    metric: kind === 'function' ? 'Relative Strength Index' : undefined,
    window: undefined,
    bottom: kind === 'function' ? 1 : undefined,
    rank: kind === 'function' ? 'Bottom' : undefined,
    collapsed: false,
    // Alt Exit properties
    entryConditions:
      kind === 'altExit'
        ? [
            {
              id: newId(),
              type: 'if',
              window: 14,
              metric: 'Relative Strength Index',
              comparator: 'gt',
              ticker: 'SPY',
              threshold: 30,
            },
          ]
        : undefined,
    exitConditions:
      kind === 'altExit'
        ? [
            {
              id: newId(),
              type: 'if',
              window: 14,
              metric: 'Relative Strength Index',
              comparator: 'lt',
              ticker: 'SPY',
              threshold: 70,
            },
          ]
        : undefined,
    // Scaling properties
    scaleMetric: kind === 'scaling' ? 'Relative Strength Index' : undefined,
    scaleWindow: kind === 'scaling' ? 14 : undefined,
    scaleTicker: kind === 'scaling' ? 'SPY' : undefined,
    scaleFrom: kind === 'scaling' ? 30 : undefined,
    scaleTo: kind === 'scaling' ? 70 : undefined,
  }
  SLOT_ORDER[kind].forEach((slot) => {
    base.children[slot] = [null]
  })
  if (kind === 'position') {
    base.positions = ['Empty']
  }
  if (kind === 'call') {
    base.callRefId = undefined
  }
  return base
}

/**
 * Ensure all required slots exist for a node (normalize structure)
 */
export const ensureSlots = (node: FlowNode): FlowNode => {
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  SLOT_ORDER[node.kind].forEach((slot) => {
    const arr = node.children[slot] ?? [null]
    children[slot] = arr.map((c) => (c ? ensureSlots(c) : c))
  })
  // Preserve ladder slots for numbered nodes in ladder mode
  if (node.kind === 'numbered' && node.numbered?.quantifier === 'ladder') {
    Object.keys(node.children).forEach((key) => {
      if (key.startsWith('ladder-')) {
        const slotKey = key as SlotId
        const arr = node.children[slotKey] ?? [null]
        children[slotKey] = arr.map((c) => (c ? ensureSlots(c) : c))
      }
    })
  }
  return { ...node, children }
}

/**
 * Performance optimization: Single-pass import normalization
 * Combines hasLegacyIdsOrDuplicates + ensureSlots + regenerateIds into one traversal
 * Also collapses all nodes except root for performance with large imports
 */
export const normalizeForImport = (node: FlowNode): FlowNode => {
  const seen = new Set<string>()
  let needsNewIds = false

  // First pass: detect if we need to regenerate IDs
  const detectLegacy = (n: FlowNode) => {
    if (/^node-\d+$/.test(n.id) || seen.has(n.id)) needsNewIds = true
    seen.add(n.id)
    getAllSlotsForNode(n).forEach((slot) => {
      n.children[slot]?.forEach((c) => {
        if (c) detectLegacy(c)
      })
    })
  }
  detectLegacy(node)

  // Second pass: normalize, optionally regenerate IDs, and collapse all nodes
  const walk = (n: FlowNode): FlowNode => {
    const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
    const slots = getAllSlotsForNode(n)
    slots.forEach((slot) => {
      const arr = n.children[slot] ?? [null]
      children[slot] = arr.map((c) => (c ? walk(c) : c))
    })

    // Migration: altExit nodes with legacy 'conditions' field should use 'entryConditions'
    // Old format: conditions array for entry, no exit conditions
    // New format: entryConditions + exitConditions separate arrays
    let entryConditions = n.entryConditions
    let exitConditions = n.exitConditions
    if (n.kind === 'altExit' && n.conditions && !n.entryConditions) {
      entryConditions = n.conditions
    }

    return {
      ...n,
      id: needsNewIds ? newId() : n.id,
      collapsed: true, // Collapse all nodes for performance
      children,
      // Apply migrated conditions for altExit nodes
      ...(n.kind === 'altExit' ? { entryConditions, exitConditions } : {}),
    }
  }
  const result = walk(node)
  // Root node should be expanded so user can see the tree structure
  result.collapsed = false
  return result
}

/**
 * Create a default root node for a new bot/system
 */
export const createDefaultRoot = (): FlowNode => {
  return createNode('basic')
}
