/**
 * Tree Compressor Module
 *
 * Optimizes strategy trees before backtest evaluation to reduce node count
 * and evaluation overhead. Similar to competitor's compression that removes
 * "158 if/else gates and 1086 redundant weights".
 *
 * Optimizations:
 * - Gate chain merging: Nested if/else with same "then" → single OR condition
 * - Empty branch pruning: Remove branches leading only to "Empty" positions
 * - Single-child collapse: Remove wrapper nodes with only one active child
 * - Pre-computed ticker locations: Avoid collectPositionTickers() per bar
 */

/**
 * Deep clone a node tree (fast recursive implementation)
 * JSON.parse(JSON.stringify()) is extremely slow for large trees (4710 nodes = seconds)
 */
export function deepClone(node) {
  if (!node) return null

  const clone = {
    id: node.id,
    kind: node.kind,
  }

  // Copy all properties except children
  for (const key of Object.keys(node)) {
    if (key === 'children' || key === 'id' || key === 'kind') continue
    const val = node[key]
    if (val === undefined) continue

    if (Array.isArray(val)) {
      // Shallow copy arrays (positions, conditions, etc.)
      clone[key] = val.map(item =>
        item && typeof item === 'object' ? { ...item } : item
      )
    } else if (val && typeof val === 'object') {
      clone[key] = { ...val }
    } else {
      clone[key] = val
    }
  }

  // Clone children recursively
  if (node.children) {
    clone.children = {}
    for (const [slot, children] of Object.entries(node.children)) {
      clone.children[slot] = (children || []).map(child => deepClone(child))
    }
  }

  return clone
}

/**
 * Count total nodes in a tree
 */
export function countNodes(node) {
  if (!node) return 0
  let count = 1
  for (const children of Object.values(node.children || {})) {
    for (const child of children || []) {
      if (child) count += countNodes(child)
    }
  }
  return count
}

/**
 * Check if a node represents an "empty" allocation
 * (position node with only Empty positions, or null)
 */
function isEmptyAllocation(node) {
  if (!node) return true
  if (node.kind === 'position') {
    const positions = node.positions || []
    return positions.length === 0 || positions.every(p => p === 'Empty' || p === '')
  }
  // For other node types, check if all children lead to empty
  const children = node.children || {}
  for (const slot of Object.keys(children)) {
    const slotChildren = children[slot] || []
    for (const child of slotChildren) {
      if (!isEmptyAllocation(child)) return false
    }
  }
  return true
}

/**
 * Prune branches that lead only to empty allocations
 */
export function pruneEmptyBranches(node) {
  if (!node) return null

  // If this node is entirely empty, return null
  if (isEmptyAllocation(node)) return null

  // Recursively prune children
  const newChildren = {}
  let hasNonEmptyChild = false

  for (const [slot, children] of Object.entries(node.children || {})) {
    const prunedChildren = []
    for (const child of children || []) {
      const pruned = pruneEmptyBranches(child)
      if (pruned) {
        prunedChildren.push(pruned)
        hasNonEmptyChild = true
      }
    }
    newChildren[slot] = prunedChildren
  }

  // For indicator nodes, if else branch is empty, we can simplify
  if (node.kind === 'indicator') {
    const thenBranch = newChildren.then || []
    const elseBranch = newChildren.else || []

    // If both branches are empty, this node is useless
    if (thenBranch.length === 0 && elseBranch.length === 0) {
      return null
    }
  }

  // If this is a container node with no children, remove it
  if (['basic', 'function'].includes(node.kind) && !hasNonEmptyChild) {
    return null
  }

  return { ...node, children: newChildren }
}

/**
 * Collapse single-child wrapper nodes
 * e.g., basic -> basic -> basic -> position becomes just position
 */
export function collapseSingleChildren(node) {
  if (!node) return null

  // First, recursively process children
  const newChildren = {}
  for (const [slot, children] of Object.entries(node.children || {})) {
    newChildren[slot] = (children || [])
      .map(child => collapseSingleChildren(child))
      .filter(Boolean)
  }

  const result = { ...node, children: newChildren }

  // Check if this is a collapsible wrapper
  if (['basic', 'function'].includes(node.kind)) {
    const nextChildren = newChildren.next || []

    // If there's exactly one child and this node adds no value
    if (nextChildren.length === 1) {
      const child = nextChildren[0]

      // For basic nodes with equal weighting and single child, collapse
      if (node.kind === 'basic' && (node.weighting === 'equal' || !node.weighting)) {
        // Return the child directly, preserving its structure
        return child
      }
    }
  }

  return result
}

/**
 * Compute a hash for a subtree to detect duplicates
 */
export function computeSubtreeHash(node) {
  if (!node) return 'null'

  const parts = [node.kind]

  if (node.positions) {
    parts.push('pos:' + node.positions.sort().join(','))
  }
  if (node.weighting) {
    parts.push('w:' + node.weighting)
  }
  if (node.conditions) {
    parts.push('cond:' + JSON.stringify(node.conditions))
  }

  // Hash children
  for (const [slot, children] of Object.entries(node.children || {})) {
    const childHashes = (children || []).map(c => computeSubtreeHash(c))
    parts.push(slot + ':' + childHashes.join('|'))
  }

  return parts.join(';')
}

/**
 * Check if two subtrees are equivalent (same allocations)
 */
export function areSubtreesEquivalent(a, b) {
  return computeSubtreeHash(a) === computeSubtreeHash(b)
}

/**
 * Merge gate chains where nested indicators have equivalent "then" outcomes
 *
 * BEFORE:
 * If RSI SPY < 30
 *   then → TQQQ
 *   else → If RSI QQQ < 30
 *            then → TQQQ
 *            else → BIL
 *
 * AFTER:
 * If ANY: RSI SPY < 30 OR RSI QQQ < 30
 *   then → TQQQ
 *   else → BIL
 */
export function mergeGateChains(node) {
  if (!node) return null

  // First, recursively process all children
  const newChildren = {}
  for (const [slot, children] of Object.entries(node.children || {})) {
    newChildren[slot] = (children || [])
      .map(child => mergeGateChains(child))
      .filter(Boolean)
  }

  let result = { ...node, children: newChildren }

  // Only process indicator nodes
  if (node.kind !== 'indicator') {
    return result
  }

  // Check if else branch contains a single indicator with equivalent then branch
  const elseBranch = newChildren.else || []
  const thenBranch = newChildren.then || []

  if (elseBranch.length === 1 && elseBranch[0]?.kind === 'indicator') {
    const nestedIndicator = elseBranch[0]
    const nestedThen = nestedIndicator.children?.then || []

    // Check if the nested "then" is equivalent to our "then"
    if (thenBranch.length === nestedThen.length) {
      let allEquivalent = true
      for (let i = 0; i < thenBranch.length; i++) {
        if (!areSubtreesEquivalent(thenBranch[i], nestedThen[i])) {
          allEquivalent = false
          break
        }
      }

      if (allEquivalent) {
        // Merge conditions with OR logic
        const mergedConditions = [
          ...(node.conditions || []),
          ...(nestedIndicator.conditions || []).map(c => ({
            ...c,
            _orGroup: true  // Mark as part of OR group
          }))
        ]

        // Use the nested indicator's else branch
        const mergedElse = nestedIndicator.children?.else || []

        result = {
          ...result,
          conditions: mergedConditions,
          _mergedGates: (node._mergedGates || 1) + 1,
          children: {
            ...newChildren,
            else: mergedElse
          }
        }

        // Recursively try to merge more gates
        return mergeGateChains(result)
      }
    }
  }

  return result
}

/**
 * Pre-compute ticker locations for each node
 * Returns a Map of nodeId -> Set of tickers reachable from that node
 */
export function precomputeTickerLocations(node, tickerMap = new Map()) {
  if (!node) return tickerMap

  const tickers = new Set()

  if (node.kind === 'position') {
    // Position nodes have direct tickers
    for (const ticker of node.positions || []) {
      if (ticker && ticker !== 'Empty') {
        tickers.add(ticker)
      }
    }
  } else {
    // Other nodes collect tickers from children
    for (const children of Object.values(node.children || {})) {
      for (const child of children || []) {
        if (child) {
          precomputeTickerLocations(child, tickerMap)
          const childTickers = tickerMap.get(child.id)
          if (childTickers) {
            for (const t of childTickers) {
              tickers.add(t)
            }
          }
        }
      }
    }
  }

  // Also add tickers from conditions (indicator tickers)
  if (node.conditions) {
    for (const cond of node.conditions) {
      if (cond.ticker) {
        tickers.add(cond.ticker)
      }
    }
  }

  if (node.id) {
    tickerMap.set(node.id, tickers)
  }

  return tickerMap
}

/**
 * Identify static subtrees that always return the same allocation
 * These can be cached and not re-evaluated each bar
 */
export function identifyStaticSubtrees(node, staticNodes = new Set()) {
  if (!node) return staticNodes

  // Position nodes are always static
  if (node.kind === 'position') {
    if (node.id) staticNodes.add(node.id)
    return staticNodes
  }

  // Process children first
  for (const children of Object.values(node.children || {})) {
    for (const child of children || []) {
      identifyStaticSubtrees(child, staticNodes)
    }
  }

  // Basic nodes with all static children are static
  if (node.kind === 'basic') {
    const allChildrenStatic = Object.values(node.children || {})
      .flatMap(c => c || [])
      .every(child => child?.id && staticNodes.has(child.id))

    if (allChildrenStatic && node.id) {
      staticNodes.add(node.id)
    }
  }

  // Indicator and function nodes are NOT static (depend on data)

  return staticNodes
}

/**
 * Main compression function.
 * Applies all optimizations and returns compressed tree with metadata.
 */
export function compressTree(node, options = {}) {
  if (!node) {
    return {
      tree: null,
      tickerLocations: new Map(),
      stats: {
        originalNodes: 0,
        compressedNodes: 0,
        nodesRemoved: 0,
        gateChainsMerged: 0,
      },
    }
  }

  const originalNodes = countNodes(node)

  // Deep clone to avoid mutating original
  let result = deepClone(node)

  // Apply optimizations in order
  result = pruneEmptyBranches(result)

  if (!result) {
    return {
      tree: null,
      tickerLocations: new Map(),
      stats: {
        originalNodes,
        compressedNodes: 0,
        nodesRemoved: originalNodes,
        gateChainsMerged: 0,
      },
    }
  }

  result = collapseSingleChildren(result)

  // Gate chain merging (can be disabled via options)
  if (options.mergeGateChains !== false) {
    result = mergeGateChains(result)
  }

  // Identify static subtrees
  if (options.identifyStatic !== false) {
    identifyStaticSubtrees(result)
  }

  // Pre-compute ticker locations
  const tickerLocations = precomputeTickerLocations(result)

  const compressedNodes = countNodes(result)

  // Count merged gates
  let gateChainsMerged = 0
  const countMerged = (n) => {
    if (!n) return
    if (n._mergedGates) gateChainsMerged += n._mergedGates - 1
    for (const children of Object.values(n.children || {})) {
      for (const child of children || []) {
        countMerged(child)
      }
    }
  }
  countMerged(result)

  return {
    tree: result,
    tickerLocations,
    stats: {
      originalNodes,
      compressedNodes,
      nodesRemoved: originalNodes - compressedNodes,
      gateChainsMerged,
    },
  }
}
