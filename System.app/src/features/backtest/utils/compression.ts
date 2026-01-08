// src/features/backtest/utils/compression.ts
// Tree compression utilities for backtest optimization

import type { FlowNode, SlotId } from '@/types'
import { deepCloneForCompression } from '@/features/builder'

export type CompressionStats = {
  originalNodes: number
  compressedNodes: number
  nodesRemoved: number
  gateChainsMerged: number
  compressionTimeMs: number
}

/**
 * Count total nodes in a tree
 */
export const countNodesInTree = (node: FlowNode | null): number => {
  if (!node) return 0
  let count = 1
  for (const children of Object.values(node.children || {})) {
    for (const child of children || []) {
      if (child) count += countNodesInTree(child)
    }
  }
  return count
}

/**
 * Check if a node represents an "empty" allocation
 */
export const isEmptyAllocation = (node: FlowNode | null): boolean => {
  if (!node) return true
  if (node.kind === 'position') {
    const positions = node.positions || []
    return positions.length === 0 || positions.every((p) => p === 'Empty' || p === '')
  }
  for (const slot of Object.keys(node.children || {})) {
    const slotChildren = node.children[slot as SlotId] || []
    for (const child of slotChildren) {
      if (!isEmptyAllocation(child)) return false
    }
  }
  return true
}

/**
 * Prune branches that lead only to empty allocations
 */
export const pruneEmptyBranches = (node: FlowNode | null): FlowNode | null => {
  if (!node) return null
  if (isEmptyAllocation(node)) return null

  const newChildren: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  let hasNonEmptyChild = false

  for (const [slot, children] of Object.entries(node.children || {})) {
    const prunedChildren: Array<FlowNode | null> = []
    for (const child of children || []) {
      const pruned = pruneEmptyBranches(child)
      if (pruned) {
        prunedChildren.push(pruned)
        hasNonEmptyChild = true
      }
    }
    newChildren[slot as SlotId] = prunedChildren
  }

  if (node.kind === 'indicator') {
    const thenBranch = newChildren.then || []
    const elseBranch = newChildren.else || []
    if (thenBranch.length === 0 && elseBranch.length === 0) return null
  }

  if (['basic', 'function'].includes(node.kind) && !hasNonEmptyChild) return null

  return { ...node, children: newChildren }
}

/**
 * Collapse single-child wrapper nodes
 */
export const collapseSingleChildren = (node: FlowNode | null): FlowNode | null => {
  if (!node) return null

  const newChildren: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  for (const [slot, children] of Object.entries(node.children || {})) {
    newChildren[slot as SlotId] = (children || []).map((child) => collapseSingleChildren(child)).filter(Boolean) as Array<FlowNode | null>
  }

  const result = { ...node, children: newChildren }

  if (['basic', 'function'].includes(node.kind)) {
    const nextChildren = newChildren.next || []
    if (nextChildren.length === 1) {
      const child = nextChildren[0]
      if (node.kind === 'basic' && (node.weighting === 'equal' || !node.weighting) && child) {
        return child
      }
    }
  }

  return result
}

/**
 * Compute a hash for a subtree to detect duplicates
 */
export const computeSubtreeHash = (node: FlowNode | null): string => {
  if (!node) return 'null'
  const parts: string[] = [node.kind]
  if (node.positions) parts.push('pos:' + node.positions.sort().join(','))
  if (node.weighting) parts.push('w:' + node.weighting)
  if (node.conditions) parts.push('cond:' + JSON.stringify(node.conditions))
  for (const [slot, children] of Object.entries(node.children || {})) {
    const childHashes = (children || []).map((c) => computeSubtreeHash(c))
    parts.push(slot + ':' + childHashes.join('|'))
  }
  return parts.join(';')
}

/**
 * Merge gate chains where nested indicators have equivalent "then" outcomes
 */
export const mergeGateChains = (node: FlowNode | null): FlowNode | null => {
  if (!node) return null

  const newChildren: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  for (const [slot, children] of Object.entries(node.children || {})) {
    newChildren[slot as SlotId] = (children || []).map((child) => mergeGateChains(child)).filter(Boolean) as Array<FlowNode | null>
  }

  let result: FlowNode = { ...node, children: newChildren }

  if (node.kind !== 'indicator') return result

  const elseBranch = newChildren.else || []
  const thenBranch = newChildren.then || []

  if (elseBranch.length === 1 && elseBranch[0]?.kind === 'indicator') {
    const nestedIndicator = elseBranch[0]
    const nestedThen = nestedIndicator.children?.then || []

    if (thenBranch.length === nestedThen.length) {
      let allEquivalent = true
      for (let i = 0; i < thenBranch.length; i++) {
        if (computeSubtreeHash(thenBranch[i]) !== computeSubtreeHash(nestedThen[i])) {
          allEquivalent = false
          break
        }
      }

      if (allEquivalent) {
        const mergedConditions = [...(node.conditions || []), ...(nestedIndicator.conditions || [])]
        const mergedElse = nestedIndicator.children?.else || []

        result = {
          ...result,
          conditions: mergedConditions,
          children: { ...newChildren, else: mergedElse },
        }
        return mergeGateChains(result)
      }
    }
  }

  return result
}

/**
 * Main compression function - optimizes tree for backtest by removing empty branches,
 * collapsing single-child wrappers, and merging equivalent gate chains
 */
export const compressTreeForBacktest = (
  node: FlowNode | null
): {
  tree: FlowNode | null
  stats: CompressionStats
} => {
  const startTime = performance.now()

  if (!node) {
    return {
      tree: null,
      stats: { originalNodes: 0, compressedNodes: 0, nodesRemoved: 0, gateChainsMerged: 0, compressionTimeMs: 0 },
    }
  }

  const originalNodes = countNodesInTree(node)
  let result = deepCloneForCompression(node)

  result = pruneEmptyBranches(result)
  if (!result) {
    return {
      tree: null,
      stats: { originalNodes, compressedNodes: 0, nodesRemoved: originalNodes, gateChainsMerged: 0, compressionTimeMs: performance.now() - startTime },
    }
  }

  result = collapseSingleChildren(result)
  result = mergeGateChains(result)

  const compressedNodes = countNodesInTree(result)
  const compressionTimeMs = performance.now() - startTime

  // Count merged gates
  let gateChainsMerged = 0
  const countMerged = (n: FlowNode | null) => {
    if (!n) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((n as any)._mergedGates) gateChainsMerged += (n as any)._mergedGates - 1
    for (const children of Object.values(n.children || {})) {
      for (const child of children || []) countMerged(child)
    }
  }
  countMerged(result)

  return {
    tree: result,
    stats: { originalNodes, compressedNodes, nodesRemoved: originalNodes - compressedNodes, gateChainsMerged, compressionTimeMs },
  }
}
