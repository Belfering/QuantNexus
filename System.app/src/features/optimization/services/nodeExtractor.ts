// Extract node parameters from tree structure for optimization results display
import type { FlowNode } from '@/types/flowNode'

const SLOT_ORDER: Record<string, string[]> = {
  indicator: ['then', 'else', 'next'],
  basic: ['next'],
  function: ['next'],
  position: [],
  numbered: ['next'],
  altExit: ['next'],
  scaling: ['next']
}

/**
 * Extract node parameters from tree, skipping the root node
 * @param tree - The complete tree structure
 * @returns Array of node parameters in depth-first order
 */
export function extractNodeParameters(tree: FlowNode): Array<Record<string, any>> {
  const nodes: Array<Record<string, any>> = []

  function traverse(node: FlowNode, isRoot: boolean = false) {
    // Skip root node
    if (isRoot) {
      // Process root's children instead
      const slots = SLOT_ORDER[node.kind] || ['next']
      for (const slotKey of slots) {
        const children = node.children?.[slotKey as keyof typeof node.children]
        if (Array.isArray(children)) {
          children.forEach(child => child && traverse(child, false))
        }
      }
      return
    }

    // Extract node parameters based on kind
    const params: Record<string, any> = { kind: node.kind }

    switch (node.kind) {
      case 'indicator':
        params.conditions = node.conditions
        params.weighting = node.weighting
        break
      case 'position':
        params.positions = node.positions
        params.weighting = node.weighting
        params.positionMode = node.positionMode
        break
      case 'function':
        params.metric = node.metric
        params.window = node.window
        params.bottom = node.bottom
        params.rank = node.rank
        params.weighting = node.weighting
        break
      case 'numbered':
        params.quantifier = node.quantifier
        params.n = node.n
        params.items = node.items
        params.weighting = node.weighting
        break
      case 'basic':
        params.title = node.title
        params.weighting = node.weighting
        break
      case 'altExit':
        params.entryConditions = node.entryConditions
        params.exitConditions = node.exitConditions
        break
      case 'scaling':
        params.scaleMetric = node.scaleMetric
        params.scaleWindow = node.scaleWindow
        params.scaleTicker = node.scaleTicker
        params.scaleFrom = node.scaleFrom
        params.scaleTo = node.scaleTo
        break
    }

    nodes.push(params)

    // Recursively traverse children
    const slots = SLOT_ORDER[node.kind] || []
    for (const slotKey of slots) {
      const children = node.children?.[slotKey as keyof typeof node.children]
      if (Array.isArray(children)) {
        children.forEach(child => child && traverse(child, false))
      }
    }
  }

  traverse(tree, true)
  return nodes
}

/**
 * Extract node IDs and condition IDs from tree in depth-first order
 * Used by rolling optimization to order parameterValues correctly
 * @param tree - The complete tree structure
 * @returns Array of node/condition IDs in depth-first order
 */
export function extractNodeIds(tree: FlowNode): string[] {
  const ids: string[] = []

  function traverse(node: FlowNode, isRoot: boolean = false) {
    // Skip root node
    if (isRoot) {
      const slots = SLOT_ORDER[node.kind] || ['next']
      for (const slotKey of slots) {
        const children = node.children?.[slotKey as keyof typeof node.children]
        if (Array.isArray(children)) {
          children.forEach(child => child && traverse(child, false))
        }
      }
      return
    }

    // For indicators, extract condition IDs
    if (node.kind === 'indicator' && node.conditions) {
      node.conditions.forEach((cond: any) => {
        if (cond.id) ids.push(cond.id)
      })
    } else {
      // For other nodes, extract node ID
      if (node.id) ids.push(node.id)
    }

    // Recursively traverse children
    const slots = SLOT_ORDER[node.kind] || []
    for (const slotKey of slots) {
      const children = node.children?.[slotKey as keyof typeof node.children]
      if (Array.isArray(children)) {
        children.forEach(child => child && traverse(child, false))
      }
    }
  }

  traverse(tree, true)
  return ids
}
