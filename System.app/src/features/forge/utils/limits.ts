// Forge limits and validation utilities
// Prevents overfitting and system overload with three-tier limit system

import type { FlowNode } from '@/types/flowNode'
import type { OptimizationResult } from '@/types/optimizationJob'
import type { RollingOptimizationResult } from '@/types/bot'
import { countNodesInTree } from '@/features/backtest/utils/compression'

/**
 * System limits
 */
export const LIMITS = {
  FORGE_MAX_NODES: 6,           // Max indicator/function/basic nodes in Forge tab
  MAX_BRANCHES: 100_000_000,    // Max branches per optimization job (100 million)
  STRATEGY_MAX_NODES: 5000      // Max total nodes in strategy
} as const

/**
 * Format number with commas for display
 */
function formatNumber(num: number): string {
  return num.toLocaleString('en-US')
}

/**
 * Count non-position nodes under Forge System root
 * Only counts: basic, function, indicator, numbered nodes
 * Excludes: position, call, altExit, scaling, rolling nodes
 * Excludes the root node itself from the count
 */
export function countForgeNodes(tree: FlowNode | null): number {
  if (!tree) return 0

  const countableKinds: FlowNode['kind'][] = ['basic', 'function', 'indicator', 'numbered']

  function countRecursive(node: FlowNode, isRoot: boolean): number {
    // Don't count root node, only its children
    let count = (isRoot || !countableKinds.includes(node.kind)) ? 0 : 1

    // Recursively count children
    if (node.children) {
      for (const children of Object.values(node.children)) {
        if (Array.isArray(children)) {
          for (const child of children) {
            if (child) {
              count += countRecursive(child, false)
            }
          }
        }
      }
    }

    return count
  }

  return countRecursive(tree, true)
}

/**
 * Check if adding a node would exceed the Forge node limit
 */
export function canAddNodeToForge(
  tree: FlowNode | null
): { allowed: boolean; currentCount: number; message?: string } {
  const currentCount = countForgeNodes(tree)
  const allowed = currentCount < LIMITS.FORGE_MAX_NODES

  if (!allowed) {
    return {
      allowed: false,
      currentCount,
      message: `Node limit reached (${currentCount}/${LIMITS.FORGE_MAX_NODES}). Remove nodes to add more.`
    }
  }

  return { allowed: true, currentCount }
}

/**
 * Validate branch count against maximum limit
 */
export function validateBranchCount(branchCount: number): {
  valid: boolean
  displayText: string
  errorMessage?: string
} {
  const valid = branchCount <= LIMITS.MAX_BRANCHES

  if (!valid) {
    return {
      valid: false,
      displayText: `${formatNumber(branchCount)} branches`,
      errorMessage: `Exceeds maximum of ${formatNumber(LIMITS.MAX_BRANCHES)} branches. Reduce parameter ranges.`
    }
  }

  // Calculate rough time estimate (0.5s per branch)
  const etaMinutes = Math.ceil(branchCount * 0.5 / 60)
  return {
    valid: true,
    displayText: `${formatNumber(branchCount)} ${branchCount === 1 ? 'branch' : 'branches'} (~${etaMinutes} min)`
  }
}

/**
 * Count total nodes across all branches in a strategy
 * Includes ALL node types (including positions)
 */
export function countStrategyNodes(
  branches: OptimizationResult[] | RollingOptimizationResult['branches']
): number {
  let totalNodes = 1 // Root wrapper node

  for (const branch of branches) {
    // Handle chronological branches with treeJson
    if ('treeJson' in branch && branch.treeJson) {
      try {
        const tree: FlowNode = JSON.parse(branch.treeJson)
        // Get the actual branch tree (may be nested in children.next)
        const branchRoot = tree.children?.next?.[0] || tree
        totalNodes += countNodesInTree(branchRoot)
      } catch (error) {
        // Parse error: use conservative estimate
        console.warn('[Limits] Failed to parse branch tree, using estimate:', error)
        totalNodes += 10 // Conservative estimate
      }
    } else {
      // Rolling branches or branches without treeJson: use conservative estimate
      // Rolling branches typically have: basic wrapper + position = 2 nodes
      totalNodes += 2
    }
  }

  return totalNodes
}

/**
 * Validate strategy composition against node limit
 */
export function validateStrategyComposition(
  branches: OptimizationResult[] | RollingOptimizationResult['branches']
): {
  valid: boolean
  nodeCount: number
  errorMessage?: string
} {
  const nodeCount = countStrategyNodes(branches)
  const valid = nodeCount <= LIMITS.STRATEGY_MAX_NODES

  if (!valid) {
    return {
      valid: false,
      nodeCount,
      errorMessage: `Strategy too large: ${formatNumber(nodeCount)} nodes (max ${formatNumber(LIMITS.STRATEGY_MAX_NODES)}). Remove branches or choose smaller shards.`
    }
  }

  return { valid: true, nodeCount }
}

/**
 * Check if pasting a subtree would exceed the Forge node limit
 * (for future clipboard validation)
 */
export function canPasteNodeToForge(
  tree: FlowNode | null,
  clipboardSubtree: FlowNode
): { allowed: boolean; message?: string } {
  const currentCount = countForgeNodes(tree)
  const pasteCount = countForgeNodes(clipboardSubtree)
  const newTotal = currentCount + pasteCount

  if (newTotal > LIMITS.FORGE_MAX_NODES) {
    return {
      allowed: false,
      message: `Cannot paste: would add ${pasteCount} nodes (${newTotal}/${LIMITS.FORGE_MAX_NODES})`
    }
  }

  return { allowed: true }
}
