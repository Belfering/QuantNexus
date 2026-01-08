// src/features/builder/utils/helpers.ts
// Helper utilities for tree operations

import type { FlowNode, SlotId } from '@/types'
import { SLOT_ORDER } from '@/types'

/**
 * Get all slot keys for a node, including dynamic ladder slots for numbered nodes
 */
export const getAllSlotsForNode = (node: FlowNode): SlotId[] => {
  const slots = [...SLOT_ORDER[node.kind]]
  if (node.kind === 'numbered' && node.numbered?.quantifier === 'ladder') {
    Object.keys(node.children).forEach((key) => {
      if (key.startsWith('ladder-') && !slots.includes(key as SlotId)) {
        slots.push(key as SlotId)
      }
    })
  }
  return slots
}

/**
 * Performance-optimized ID generator
 * Refreshes timestamp and random suffix every 1000 IDs instead of every call
 */
export const newId = (() => {
  let counter = 0
  let batchTs = Date.now()
  let batchRand = Math.random().toString(36).slice(2, 10)

  return () => {
    // Refresh batch values periodically to maintain uniqueness across sessions
    if (counter % 1000 === 0) {
      batchTs = Date.now()
      batchRand = Math.random().toString(36).slice(2, 10)
    }
    counter += 1
    return `node-${batchTs}-${counter}-${batchRand}`
  }
})()
