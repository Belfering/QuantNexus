// src/features/backtest/utils/normalization.ts
// Utilities for normalizing conditions and nodes before running backtests

import type { FlowNode, ConditionLine, SlotId } from '@/types'
import { SLOT_ORDER } from '@/types'
import { normalizeComparatorChoice } from '@/features/builder'
import { normalizeConditionType } from '../engine/conditions'

/**
 * Normalize conditions array - ensures type, comparator, threshold, and window are valid
 */
export const normalizeConditions = (conditions: ConditionLine[] | undefined): ConditionLine[] | undefined => {
  if (!conditions) return conditions
  return conditions.map((c, idx) => ({
    ...c,
    type: idx === 0 ? 'if' : normalizeConditionType((c as unknown as { type?: unknown })?.type, 'and'),
    comparator: normalizeComparatorChoice((c as unknown as { comparator?: unknown })?.comparator),
    threshold: Number.isFinite(Number((c as unknown as { threshold?: unknown })?.threshold))
      ? Number((c as unknown as { threshold?: unknown })?.threshold)
      : 0,
    window: Number.isFinite(Number((c as unknown as { window?: unknown })?.window))
      ? Math.max(1, Math.floor(Number((c as unknown as { window?: unknown })?.window)))
      : 14,
    rightWindow: Number.isFinite(Number((c as unknown as { rightWindow?: unknown })?.rightWindow))
      ? Math.max(1, Math.floor(Number((c as unknown as { rightWindow?: unknown })?.rightWindow)))
      : c.rightWindow,
  }))
}

/**
 * Recursively normalize a node and all its children for backtest execution
 */
export const normalizeNodeForBacktest = (node: FlowNode): FlowNode => {
  const next: FlowNode = {
    ...node,
    conditions: normalizeConditions(node.conditions),
    numbered: node.numbered
      ? {
          ...node.numbered,
          items: node.numbered.items.map((item) => ({ ...item, conditions: normalizeConditions(item.conditions) ?? item.conditions })),
        }
      : undefined,
    // Alt Exit conditions
    entryConditions: normalizeConditions(node.entryConditions),
    exitConditions: normalizeConditions(node.exitConditions),
    children: { ...node.children },
  }
  // Get slots including ladder slots for numbered nodes
  const slots = [...SLOT_ORDER[node.kind]]
  if (node.kind === 'numbered' && node.numbered?.quantifier === 'ladder') {
    Object.keys(node.children).forEach((key) => {
      if (key.startsWith('ladder-') && !slots.includes(key as SlotId)) {
        slots.push(key as SlotId)
      }
    })
  }
  for (const slot of slots) {
    const arr = node.children[slot] ?? [null]
    next.children[slot] = arr.map((c) => (c ? normalizeNodeForBacktest(c) : c))
  }
  return next
}
