// src/features/builder/utils/treeOperations.ts
// Pure functions for immutable tree manipulation

import type {
  FlowNode,
  SlotId,
  WeightMode,
  PositionChoice,
  MetricChoice,
  ComparatorChoice,
  NumberedQuantifier,
  NumberedItem,
} from '@/types'
import { getAllSlotsForNode, newId } from './helpers'

/**
 * Normalize comparator value to valid type
 */
export const normalizeComparatorChoice = (value: unknown): ComparatorChoice => {
  if (value === 'gt' || value === 'lt' || value === 'crossAbove' || value === 'crossBelow') return value
  const s = String(value || '').trim().toLowerCase()
  if (!s) return 'lt'
  if (s === 'crossabove' || s === 'crosses above' || s === 'cross above') return 'crossAbove'
  if (s === 'crossbelow' || s === 'crosses below' || s === 'cross below') return 'crossBelow'
  if (s === 'greater than' || s === 'greater' || s === 'gt') return 'gt'
  if (s === 'less than' || s === 'less' || s === 'lt') return 'lt'
  if (s.includes('cross') && s.includes('above')) return 'crossAbove'
  if (s.includes('cross') && s.includes('below')) return 'crossBelow'
  if (s.includes('greater')) return 'gt'
  if (s.includes('less')) return 'lt'
  return 'lt'
}

// ============================================================================
// CORE TREE OPERATIONS
// ============================================================================

/**
 * Replace a child node at a specific slot and index
 */
export const replaceSlot = (
  node: FlowNode,
  parentId: string,
  slot: SlotId,
  index: number,
  child: FlowNode
): FlowNode => {
  if (node.id === parentId) {
    const arr = node.children[slot] ?? [null]
    const next = arr.slice()
    next[index] = child
    return { ...node, children: { ...node.children, [slot]: next } }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? replaceSlot(c, parentId, slot, index, child) : c)) : arr
  })
  return { ...node, children }
}

/**
 * Insert a node at a specific index (shifts existing nodes down)
 */
export const insertAtSlot = (
  node: FlowNode,
  parentId: string,
  slot: SlotId,
  index: number,
  child: FlowNode
): FlowNode => {
  if (node.id === parentId) {
    const arr = node.children[slot] ?? [null]
    const next = arr.slice()
    next.splice(index, 0, child)
    return { ...node, children: { ...node.children, [slot]: next } }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? insertAtSlot(c, parentId, slot, index, child) : c)) : arr
  })
  return { ...node, children }
}

/**
 * Append a null placeholder to a slot
 */
export const appendPlaceholder = (node: FlowNode, targetId: string, slot: SlotId): FlowNode => {
  if (node.id === targetId) {
    const arr = node.children[slot] ?? [null]
    return { ...node, children: { ...node.children, [slot]: [...arr, null] } }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? appendPlaceholder(c, targetId, slot) : c)) : arr
  })
  return { ...node, children }
}

/**
 * Delete a node by ID (recursively)
 */
export const deleteNode = (node: FlowNode, targetId: string): FlowNode => {
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    if (!arr) return
    const filtered = arr
      .map((c) => (c ? deleteNode(c, targetId) : c))
      .filter((c) => (c ? c.id !== targetId : true))
    children[s] = filtered.length ? filtered : [null]
  })
  return { ...node, children }
}

/**
 * Remove a slot entry at specific index
 */
export const removeSlotEntry = (
  node: FlowNode,
  targetId: string,
  slot: SlotId,
  index: number
): FlowNode => {
  if (node.id === targetId) {
    const arr = node.children[slot] ?? []
    const next = arr.slice()
    next.splice(index, 1)
    return { ...node, children: { ...node.children, [slot]: next.length ? next : [null] } }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? removeSlotEntry(c, targetId, slot, index) : c)) : arr
  })
  return { ...node, children }
}

// ============================================================================
// NODE PROPERTY UPDATES
// ============================================================================

export const updateTitle = (node: FlowNode, id: string, title: string): FlowNode => {
  if (node.id === id) return { ...node, title }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateTitle(c, id, title) : c)) : arr
  })
  return { ...node, children }
}

export const updateWeight = (
  node: FlowNode,
  id: string,
  weighting: WeightMode,
  branch?: 'then' | 'else'
): FlowNode => {
  if (node.id === id) {
    if ((node.kind === 'indicator' || node.kind === 'numbered') && branch) {
      if (branch === 'then') {
        const next: FlowNode = { ...node, weightingThen: weighting }
        if (weighting === 'capped') {
          if (!next.cappedFallbackThen) next.cappedFallbackThen = 'Empty'
          if (next.minCapThen === undefined) next.minCapThen = 0
          if (next.maxCapThen === undefined) next.maxCapThen = 100
        }
        if (weighting === 'inverse' || weighting === 'pro') {
          if (!next.volWindowThen) next.volWindowThen = 20
          if (next.minCapThen === undefined) next.minCapThen = 0
          if (next.maxCapThen === undefined) next.maxCapThen = 100
        }
        return next
      }
      const next: FlowNode = { ...node, weightingElse: weighting }
      if (weighting === 'capped') {
        if (!next.cappedFallbackElse) next.cappedFallbackElse = 'Empty'
        if (next.minCapElse === undefined) next.minCapElse = 0
        if (next.maxCapElse === undefined) next.maxCapElse = 100
      }
      if (weighting === 'inverse' || weighting === 'pro') {
        if (!next.volWindowElse) next.volWindowElse = 20
        if (next.minCapElse === undefined) next.minCapElse = 0
        if (next.maxCapElse === undefined) next.maxCapElse = 100
      }
      return next
    }
    const next: FlowNode = { ...node, weighting }
    if (weighting === 'capped') {
      if (!next.cappedFallback) next.cappedFallback = 'Empty'
      if (next.minCap === undefined) next.minCap = 0
      if (next.maxCap === undefined) next.maxCap = 100
    }
    if (weighting === 'inverse' || weighting === 'pro') {
      if (!next.volWindow) next.volWindow = 20
      if (next.minCap === undefined) next.minCap = 0
      if (next.maxCap === undefined) next.maxCap = 100
    }
    return next
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateWeight(c, id, weighting, branch) : c)) : arr
  })
  return { ...node, children }
}

export const updateCappedFallback = (
  node: FlowNode,
  id: string,
  choice: PositionChoice,
  branch?: 'then' | 'else'
): FlowNode => {
  if (node.id === id) {
    if (branch === 'then') return { ...node, cappedFallbackThen: choice }
    if (branch === 'else') return { ...node, cappedFallbackElse: choice }
    return { ...node, cappedFallback: choice }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateCappedFallback(c, id, choice, branch) : c)) : arr
  })
  return { ...node, children }
}

export const updateVolWindow = (
  node: FlowNode,
  id: string,
  days: number,
  branch?: 'then' | 'else'
): FlowNode => {
  if (node.id === id) {
    const nextDays = Math.max(1, Math.floor(Number(days) || 0))
    if (branch === 'then') return { ...node, volWindowThen: nextDays }
    if (branch === 'else') return { ...node, volWindowElse: nextDays }
    return { ...node, volWindow: nextDays }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateVolWindow(c, id, days, branch) : c)) : arr
  })
  return { ...node, children }
}

export const updateMinCap = (
  node: FlowNode,
  id: string,
  value: number,
  branch?: 'then' | 'else'
): FlowNode => {
  if (node.id === id) {
    const normalized = Math.max(0, Math.min(100, Math.floor(Number(value) || 0)))
    if (branch === 'then') return { ...node, minCapThen: normalized }
    if (branch === 'else') return { ...node, minCapElse: normalized }
    return { ...node, minCap: normalized }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateMinCap(c, id, value, branch) : c)) : arr
  })
  return { ...node, children }
}

export const updateMaxCap = (
  node: FlowNode,
  id: string,
  value: number,
  branch?: 'then' | 'else'
): FlowNode => {
  if (node.id === id) {
    const normalized = Math.max(0, Math.min(100, Math.floor(Number(value) || 0)))
    if (branch === 'then') return { ...node, maxCapThen: normalized }
    if (branch === 'else') return { ...node, maxCapElse: normalized }
    return { ...node, maxCap: normalized }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateMaxCap(c, id, value, branch) : c)) : arr
  })
  return { ...node, children }
}

export const updateCollapse = (node: FlowNode, id: string, collapsed: boolean): FlowNode => {
  if (node.id === id) return { ...node, collapsed }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateCollapse(c, id, collapsed) : c)) : arr
  })
  return { ...node, children }
}

export const setAllCollapsed = (node: FlowNode, collapsed: boolean): FlowNode => {
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? setAllCollapsed(c, collapsed) : c)) : arr
  })
  return { ...node, collapsed, children }
}

export const setCollapsedBelow = (root: FlowNode, targetId: string, collapsed: boolean): FlowNode => {
  if (root.id === targetId) {
    return setAllCollapsed(root, collapsed)
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(root).forEach((s) => {
    const arr = root.children[s]
    children[s] = arr ? arr.map((c) => (c ? setCollapsedBelow(c, targetId, collapsed) : c)) : arr
  })
  return { ...root, children }
}

export const updateColor = (node: FlowNode, id: string, color?: string): FlowNode => {
  if (node.id === id) return { ...node, bgColor: color }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateColor(c, id, color) : c)) : arr
  })
  return { ...node, children }
}

export const updateCallReference = (node: FlowNode, id: string, callId: string | null): FlowNode => {
  if (node.id === id) {
    return { ...node, callRefId: callId || undefined }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateCallReference(c, id, callId) : c)) : arr
  })
  return { ...node, children }
}

// ============================================================================
// FUNCTION NODE OPERATIONS
// ============================================================================

export const updateFunctionWindow = (node: FlowNode, id: string, value: number): FlowNode => {
  if (node.id === id) {
    if (Number.isNaN(value)) return { ...node, window: undefined }
    return { ...node, window: value }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateFunctionWindow(c, id, value) : c)) : arr
  })
  return { ...node, children }
}

export const updateFunctionBottom = (node: FlowNode, id: string, value: number): FlowNode => {
  if (node.id === id && node.kind === 'function') return { ...node, bottom: value }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateFunctionBottom(c, id, value) : c)) : arr
  })
  return { ...node, children }
}

export const updateFunctionMetric = (node: FlowNode, id: string, metric: MetricChoice): FlowNode => {
  if (node.id === id && node.kind === 'function') return { ...node, metric }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateFunctionMetric(c, id, metric) : c)) : arr
  })
  return { ...node, children }
}

export const updateFunctionRank = (node: FlowNode, id: string, rank: 'Top' | 'Bottom'): FlowNode => {
  if (node.id === id && node.kind === 'function') return { ...node, rank }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateFunctionRank(c, id, rank) : c)) : arr
  })
  return { ...node, children }
}

// ============================================================================
// POSITION NODE OPERATIONS
// ============================================================================

export const addPositionRow = (node: FlowNode, id: string): FlowNode => {
  if (node.id === id && node.positions) {
    return { ...node, positions: [...node.positions, 'Empty'] }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? addPositionRow(c, id) : c)) : arr
  })
  return { ...node, children }
}

export const removePositionRow = (node: FlowNode, id: string, index: number): FlowNode => {
  if (node.id === id && node.positions) {
    const next = node.positions.slice()
    next.splice(index, 1)
    return { ...node, positions: next.length ? next : ['Empty'] }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? removePositionRow(c, id, index) : c)) : arr
  })
  return { ...node, children }
}

export const choosePosition = (
  node: FlowNode,
  id: string,
  index: number,
  choice: PositionChoice
): FlowNode => {
  if (node.id === id && node.positions) {
    const next = node.positions.map((p, i) => (i === index ? choice : p))
    return { ...node, positions: next }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? choosePosition(c, id, index, choice) : c)) : arr
  })
  return { ...node, children }
}

// ============================================================================
// CONDITION OPERATIONS
// ============================================================================

export const addConditionLine = (
  node: FlowNode,
  id: string,
  type: 'and' | 'or',
  itemId?: string
): FlowNode => {
  if (node.id === id && node.kind === 'indicator') {
    const last = node.conditions && node.conditions.length ? node.conditions[node.conditions.length - 1] : null
    const next = [
      ...(node.conditions ?? []),
      {
        id: newId(),
        type,
        window: last?.window ?? 0,
        metric: (last?.metric as MetricChoice) ?? 'Relative Strength Index',
        comparator: normalizeComparatorChoice(last?.comparator ?? 'lt'),
        ticker: last?.ticker ?? 'SPY',
        threshold: last?.threshold ?? 0,
        expanded: false,
        rightWindow: last?.rightWindow ?? 0,
        rightMetric: (last?.rightMetric as MetricChoice) ?? 'Relative Strength Index',
        rightTicker: last?.rightTicker ?? 'SPY',
        forDays: last?.forDays,
      },
    ]
    return { ...node, conditions: next }
  }
  if (node.id === id && node.kind === 'numbered' && node.numbered && itemId) {
    const nextItems = node.numbered.items.map((item) => {
      if (item.id !== itemId) return item
      const last = item.conditions.length ? item.conditions[item.conditions.length - 1] : null
      return {
        ...item,
        conditions: [
          ...item.conditions,
          {
            id: newId(),
            type,
            window: last?.window ?? 0,
            metric: (last?.metric as MetricChoice) ?? 'Relative Strength Index',
            comparator: normalizeComparatorChoice(last?.comparator ?? 'lt'),
            ticker: last?.ticker ?? 'SPY',
            threshold: last?.threshold ?? 0,
            expanded: false,
            rightWindow: last?.rightWindow ?? 0,
            rightMetric: (last?.rightMetric as MetricChoice) ?? 'Relative Strength Index',
            rightTicker: last?.rightTicker ?? 'SPY',
            forDays: last?.forDays,
          },
        ],
      }
    })
    return { ...node, numbered: { ...node.numbered, items: nextItems } }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? addConditionLine(c, id, type, itemId) : c)) : arr
  })
  return { ...node, children }
}

export const deleteConditionLine = (
  node: FlowNode,
  id: string,
  condId: string,
  itemId?: string
): FlowNode => {
  if (node.id === id && node.kind === 'indicator' && node.conditions) {
    const keep = node.conditions.filter((c, idx) => idx === 0 || c.id !== condId)
    return { ...node, conditions: keep.length ? keep : node.conditions }
  }
  if (node.id === id && node.kind === 'numbered' && node.numbered && itemId) {
    const nextItems = node.numbered.items.map((item) => {
      if (item.id !== itemId) return item
      const keep = item.conditions.filter((c) => c.id !== condId)
      return { ...item, conditions: keep.length ? keep : item.conditions }
    })
    return { ...node, numbered: { ...node.numbered, items: nextItems } }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? deleteConditionLine(c, id, condId, itemId) : c)) : arr
  })
  return { ...node, children }
}

export const updateConditionFields = (
  node: FlowNode,
  id: string,
  condId: string,
  updates: Partial<{
    window: number
    metric: MetricChoice
    comparator: ComparatorChoice
    ticker: PositionChoice
    threshold: number
    expanded?: boolean
    rightWindow?: number
    rightMetric?: MetricChoice
    rightTicker?: PositionChoice
    forDays?: number
  }>,
  itemId?: string
): FlowNode => {
  if (node.id === id && node.kind === 'indicator' && node.conditions) {
    const next = node.conditions.map((c) => (c.id === condId ? { ...c, ...updates } : c))
    return { ...node, conditions: next }
  }
  if (node.id === id && node.kind === 'numbered' && node.numbered && itemId) {
    const nextItems = node.numbered.items.map((item) => {
      if (item.id !== itemId) return item
      const next = item.conditions.map((c) => (c.id === condId ? { ...c, ...updates } : c))
      return { ...item, conditions: next }
    })
    return { ...node, numbered: { ...node.numbered, items: nextItems } }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateConditionFields(c, id, condId, updates, itemId) : c)) : arr
  })
  return { ...node, children }
}

// ============================================================================
// ALT EXIT CONDITION OPERATIONS
// ============================================================================

export const addEntryCondition = (node: FlowNode, id: string, type: 'and' | 'or'): FlowNode => {
  if (node.id === id && node.kind === 'altExit') {
    const last = node.entryConditions?.length ? node.entryConditions[node.entryConditions.length - 1] : null
    const next = [
      ...(node.entryConditions ?? []),
      {
        id: newId(),
        type,
        window: last?.window ?? 14,
        metric: (last?.metric as MetricChoice) ?? 'Relative Strength Index',
        comparator: normalizeComparatorChoice(last?.comparator ?? 'gt'),
        ticker: last?.ticker ?? 'SPY',
        threshold: last?.threshold ?? 30,
        expanded: false,
        rightWindow: last?.rightWindow ?? 14,
        rightMetric: (last?.rightMetric as MetricChoice) ?? 'Relative Strength Index',
        rightTicker: last?.rightTicker ?? 'SPY',
        forDays: last?.forDays,
      },
    ]
    return { ...node, entryConditions: next }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? addEntryCondition(c, id, type) : c)) : arr
  })
  return { ...node, children }
}

export const addExitCondition = (node: FlowNode, id: string, type: 'and' | 'or'): FlowNode => {
  if (node.id === id && node.kind === 'altExit') {
    const last = node.exitConditions?.length ? node.exitConditions[node.exitConditions.length - 1] : null
    const next = [
      ...(node.exitConditions ?? []),
      {
        id: newId(),
        type,
        window: last?.window ?? 14,
        metric: (last?.metric as MetricChoice) ?? 'Relative Strength Index',
        comparator: normalizeComparatorChoice(last?.comparator ?? 'lt'),
        ticker: last?.ticker ?? 'SPY',
        threshold: last?.threshold ?? 70,
        expanded: false,
        rightWindow: last?.rightWindow ?? 14,
        rightMetric: (last?.rightMetric as MetricChoice) ?? 'Relative Strength Index',
        rightTicker: last?.rightTicker ?? 'SPY',
        forDays: last?.forDays,
      },
    ]
    return { ...node, exitConditions: next }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? addExitCondition(c, id, type) : c)) : arr
  })
  return { ...node, children }
}

export const deleteEntryCondition = (node: FlowNode, id: string, condId: string): FlowNode => {
  if (node.id === id && node.kind === 'altExit' && node.entryConditions) {
    const keep = node.entryConditions.filter((c, idx) => idx === 0 || c.id !== condId)
    return { ...node, entryConditions: keep.length ? keep : node.entryConditions }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? deleteEntryCondition(c, id, condId) : c)) : arr
  })
  return { ...node, children }
}

export const deleteExitCondition = (node: FlowNode, id: string, condId: string): FlowNode => {
  if (node.id === id && node.kind === 'altExit' && node.exitConditions) {
    const keep = node.exitConditions.filter((c, idx) => idx === 0 || c.id !== condId)
    return { ...node, exitConditions: keep.length ? keep : node.exitConditions }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? deleteExitCondition(c, id, condId) : c)) : arr
  })
  return { ...node, children }
}

export const updateEntryConditionFields = (
  node: FlowNode,
  id: string,
  condId: string,
  updates: Partial<{
    window: number
    metric: MetricChoice
    comparator: ComparatorChoice
    ticker: PositionChoice
    threshold: number
    expanded?: boolean
    rightWindow?: number
    rightMetric?: MetricChoice
    rightTicker?: PositionChoice
  }>
): FlowNode => {
  if (node.id === id && node.kind === 'altExit' && node.entryConditions) {
    const next = node.entryConditions.map((c) => (c.id === condId ? { ...c, ...updates } : c))
    return { ...node, entryConditions: next }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateEntryConditionFields(c, id, condId, updates) : c)) : arr
  })
  return { ...node, children }
}

export const updateExitConditionFields = (
  node: FlowNode,
  id: string,
  condId: string,
  updates: Partial<{
    window: number
    metric: MetricChoice
    comparator: ComparatorChoice
    ticker: PositionChoice
    threshold: number
    expanded?: boolean
    rightWindow?: number
    rightMetric?: MetricChoice
    rightTicker?: PositionChoice
  }>
): FlowNode => {
  if (node.id === id && node.kind === 'altExit' && node.exitConditions) {
    const next = node.exitConditions.map((c) => (c.id === condId ? { ...c, ...updates } : c))
    return { ...node, exitConditions: next }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateExitConditionFields(c, id, condId, updates) : c)) : arr
  })
  return { ...node, children }
}

// ============================================================================
// SCALING NODE OPERATIONS
// ============================================================================

export const updateScalingFields = (
  node: FlowNode,
  id: string,
  updates: Partial<{
    scaleMetric: MetricChoice
    scaleWindow: number
    scaleTicker: string
    scaleFrom: number
    scaleTo: number
  }>
): FlowNode => {
  if (node.id === id && node.kind === 'scaling') {
    return { ...node, ...updates }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateScalingFields(c, id, updates) : c)) : arr
  })
  return { ...node, children }
}

// ============================================================================
// ROLLING NODE OPERATIONS
// ============================================================================

export const updateRollingFields = (
  node: FlowNode,
  id: string,
  updates: Partial<{
    rollingWindow: string
    rankBy: string
  }>
): FlowNode => {
  if (node.id === id && node.kind === 'rolling') {
    return { ...node, ...updates }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateRollingFields(c, id, updates) : c)) : arr
  })
  return { ...node, children }
}

// ============================================================================
// NUMBERED NODE OPERATIONS
// ============================================================================

export const updateNumberedQuantifier = (
  node: FlowNode,
  id: string,
  quantifier: NumberedQuantifier
): FlowNode => {
  if (node.id === id && node.kind === 'numbered' && node.numbered) {
    return { ...node, numbered: { ...node.numbered, quantifier } }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateNumberedQuantifier(c, id, quantifier) : c)) : arr
  })
  return { ...node, children }
}

export const updateNumberedN = (node: FlowNode, id: string, n: number): FlowNode => {
  if (node.id === id && node.kind === 'numbered' && node.numbered) {
    const next = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : node.numbered.n
    return { ...node, numbered: { ...node.numbered, n: next } }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateNumberedN(c, id, n) : c)) : arr
  })
  return { ...node, children }
}

export const addNumberedItem = (node: FlowNode, id: string): FlowNode => {
  if (node.id === id && node.kind === 'numbered' && node.numbered) {
    const lastItem = node.numbered.items.length ? node.numbered.items[node.numbered.items.length - 1] : null
    const lastCond = lastItem?.conditions?.length ? lastItem.conditions[lastItem.conditions.length - 1] : null
    const newItem: NumberedItem = {
      id: newId(),
      conditions: [
        {
          id: newId(),
          type: 'if',
          window: lastCond?.window ?? 14,
          metric: (lastCond?.metric as MetricChoice) ?? 'Relative Strength Index',
          comparator: normalizeComparatorChoice(lastCond?.comparator ?? 'lt'),
          ticker: lastCond?.ticker ?? 'SPY',
          threshold: lastCond?.threshold ?? 30,
          expanded: lastCond?.expanded ?? false,
          rightWindow: lastCond?.rightWindow ?? 14,
          rightMetric: (lastCond?.rightMetric as MetricChoice) ?? 'Relative Strength Index',
          rightTicker: lastCond?.rightTicker ?? 'SPY',
        },
      ],
    }
    return { ...node, numbered: { ...node.numbered, items: [...node.numbered.items, newItem] } }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? addNumberedItem(c, id) : c)) : arr
  })
  return { ...node, children }
}

export const deleteNumberedItem = (node: FlowNode, id: string, itemId: string): FlowNode => {
  if (node.id === id && node.kind === 'numbered' && node.numbered) {
    const nextItems = node.numbered.items.filter((item, idx) => idx === 0 || item.id !== itemId)
    return { ...node, numbered: { ...node.numbered, items: nextItems.length ? nextItems : node.numbered.items } }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? deleteNumberedItem(c, id, itemId) : c)) : arr
  })
  return { ...node, children }
}

// ============================================================================
// CLONE OPERATIONS
// ============================================================================

/**
 * Deep clone a node with new IDs
 */
export const cloneNode = (node: FlowNode): FlowNode => {
  const cloned: FlowNode = {
    id: newId(),
    kind: node.kind,
    title: node.title,
    children: {},
    positions: node.positions ? [...node.positions] : undefined,
    weighting: node.weighting,
    weightingThen: node.weightingThen,
    weightingElse: node.weightingElse,
    cappedFallback: node.cappedFallback,
    cappedFallbackThen: node.cappedFallbackThen,
    cappedFallbackElse: node.cappedFallbackElse,
    volWindow: node.volWindow,
    volWindowThen: node.volWindowThen,
    volWindowElse: node.volWindowElse,
    conditions: node.conditions ? node.conditions.map((c) => ({ ...c, id: newId() })) : undefined,
    numbered: node.numbered
      ? {
          quantifier: node.numbered.quantifier,
          n: node.numbered.n,
          items: node.numbered.items.map((item) => ({
            ...item,
            id: newId(),
            conditions: item.conditions.map((c) => ({ ...c, id: newId() })),
          })),
        }
      : undefined,
    metric: node.metric,
    window: node.window,
    bottom: node.bottom,
    rank: node.rank,
    bgColor: node.bgColor,
    collapsed: node.collapsed,
    callRefId: node.callRefId,
    entryConditions: node.entryConditions ? node.entryConditions.map((c) => ({ ...c, id: newId() })) : undefined,
    exitConditions: node.exitConditions ? node.exitConditions.map((c) => ({ ...c, id: newId() })) : undefined,
    scaleMetric: node.scaleMetric,
    scaleWindow: node.scaleWindow,
    scaleTicker: node.scaleTicker,
    scaleFrom: node.scaleFrom,
    scaleTo: node.scaleTo,
  }
  getAllSlotsForNode(node).forEach((slot) => {
    const arr = node.children[slot]
    cloned.children[slot] = arr ? arr.map((c) => (c ? cloneNode(c) : null)) : [null]
  })
  return cloned
}

/**
 * Deep clone preserving IDs (for compression, not for UI cloning)
 */
export const deepCloneForCompression = (node: FlowNode | null): FlowNode | null => {
  if (!node) return null
  const clone: FlowNode = {
    id: node.id,
    kind: node.kind,
    title: node.title,
    children: {},
    positions: node.positions ? [...node.positions] : undefined,
    weighting: node.weighting,
    conditions: node.conditions ? node.conditions.map((c) => ({ ...c })) : undefined,
  }
  // Copy all other properties
  if (node.weightingThen) clone.weightingThen = node.weightingThen
  if (node.weightingElse) clone.weightingElse = node.weightingElse
  if (node.cappedFallback) clone.cappedFallback = node.cappedFallback
  if (node.cappedFallbackThen) clone.cappedFallbackThen = node.cappedFallbackThen
  if (node.cappedFallbackElse) clone.cappedFallbackElse = node.cappedFallbackElse
  if (node.volWindow) clone.volWindow = node.volWindow
  if (node.volWindowThen) clone.volWindowThen = node.volWindowThen
  if (node.volWindowElse) clone.volWindowElse = node.volWindowElse
  if (node.numbered) clone.numbered = JSON.parse(JSON.stringify(node.numbered))
  if (node.metric) clone.metric = node.metric
  if (node.window) clone.window = node.window
  if (node.bottom !== undefined) clone.bottom = node.bottom
  if (node.rank) clone.rank = node.rank
  if (node.bgColor) clone.bgColor = node.bgColor
  if (node.collapsed) clone.collapsed = node.collapsed
  if (node.callRefId) clone.callRefId = node.callRefId
  if (node.entryConditions) clone.entryConditions = node.entryConditions.map((c) => ({ ...c }))
  if (node.exitConditions) clone.exitConditions = node.exitConditions.map((c) => ({ ...c }))
  if (node.scaleMetric) clone.scaleMetric = node.scaleMetric
  if (node.scaleWindow) clone.scaleWindow = node.scaleWindow
  if (node.scaleTicker) clone.scaleTicker = node.scaleTicker
  if (node.scaleFrom !== undefined) clone.scaleFrom = node.scaleFrom
  if (node.scaleTo !== undefined) clone.scaleTo = node.scaleTo
  if (node.positionMode) clone.positionMode = node.positionMode
  if (node.positionTickerListId) clone.positionTickerListId = node.positionTickerListId
  if (node.positionTickerListName) clone.positionTickerListName = node.positionTickerListName

  for (const slot of getAllSlotsForNode(node)) {
    const arr = node.children[slot]
    clone.children[slot] = arr ? arr.map((c) => deepCloneForCompression(c)) : [null]
  }
  return clone
}

// ============================================================================
// TREE SEARCH OPERATIONS
// ============================================================================

/**
 * Find a node by ID in the tree
 */
export const findNode = (node: FlowNode, id: string): FlowNode | null => {
  if (node.id === id) return node
  for (const slot of getAllSlotsForNode(node)) {
    const arr = node.children[slot]
    if (!arr) continue
    for (const child of arr) {
      if (!child) continue
      const found = findNode(child, id)
      if (found) return found
    }
  }
  return null
}

/**
 * Clone and normalize a node (assigns new IDs throughout)
 * Single-pass clone + normalize for better performance
 */
export const cloneAndNormalize = (node: FlowNode): FlowNode => {
  const walk = (n: FlowNode): FlowNode => {
    const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
    getAllSlotsForNode(n).forEach((slot) => {
      const arr = n.children[slot] ?? [null]
      children[slot] = arr.map((c) => (c ? walk(c) : c))
    })
    return { ...n, id: newId(), children }
  }
  return walk(node)
}

/**
 * Expand all collapsed nodes on the path to a target node
 */
export const expandToNode = (node: FlowNode, targetId: string): { next: FlowNode; found: boolean } => {
  if (node.id === targetId) {
    return { next: node.collapsed ? { ...node, collapsed: false } : node, found: true }
  }
  let found = false
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  for (const slot of getAllSlotsForNode(node)) {
    const arr = node.children[slot] ?? [null]
    children[slot] = arr.map((c) => {
      if (!c) return c
      const r = expandToNode(c, targetId)
      if (r.found) found = true
      return r.next
    })
  }
  const self = found && node.collapsed ? { ...node, collapsed: false } : node
  return found ? { next: { ...self, children }, found: true } : { next: node, found: false }
}
