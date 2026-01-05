// src/features/builder/hooks/useNodeCallbacks.ts
// Memoized callbacks for tree node operations

import { useCallback } from 'react'
import type {
  FlowNode,
  SlotId,
  BlockKind,
  WeightMode,
  PositionChoice,
  MetricChoice,
  RankChoice,
  NumberedQuantifier,
} from '@/types'
import {
  insertAtSlot,
  appendPlaceholder,
  removeSlotEntry,
  deleteNode,
  updateTitle,
  updateWeight,
  updateCappedFallback,
  updateVolWindow,
  updateFunctionWindow,
  updateFunctionBottom,
  updateFunctionMetric,
  updateFunctionRank,
  updateColor,
  updateCallReference,
  updateCollapse,
  setCollapsedBelow,
  addPositionRow,
  removePositionRow,
  choosePosition,
  addConditionLine,
  deleteConditionLine,
  updateConditionFields,
  addEntryCondition,
  addExitCondition,
  deleteEntryCondition,
  deleteExitCondition,
  updateEntryConditionFields,
  updateExitConditionFields,
  updateScalingFields,
  updateNumberedQuantifier,
  updateNumberedN,
  addNumberedItem,
  deleteNumberedItem,
  cloneAndNormalize,
  ensureSlots,
} from '../utils'
import { createNode } from '../utils/nodeFactory'

export type UseNodeCallbacksParams = {
  /** Current tree root */
  current: FlowNode
  /** Push function to add new tree state to history */
  push: (next: FlowNode) => void
}

export type ConditionFieldUpdates = Partial<{
  window: number
  metric: MetricChoice
  comparator: 'gt' | 'lt'
  ticker: PositionChoice
  threshold: number
  expanded: boolean
  rightWindow: number
  rightMetric: MetricChoice
  rightTicker: PositionChoice
}>

export type ScalingFieldUpdates = Partial<{
  scaleMetric: MetricChoice
  scaleWindow: number
  scaleTicker: string
  scaleFrom: number
  scaleTo: number
}>

/**
 * Hook providing memoized callbacks for all tree node operations.
 *
 * Each callback performs a tree operation and pushes the result to history.
 *
 * @example
 * ```tsx
 * const { handleAdd, handleDelete, handleRename } = useNodeCallbacks({
 *   current,
 *   push
 * })
 *
 * // Add a node
 * handleAdd(parentId, 'next', 0, 'indicator')
 *
 * // Delete a node
 * handleDelete(nodeId)
 *
 * // Rename a node
 * handleRename(nodeId, 'New Title')
 * ```
 */
export function useNodeCallbacks({ current, push }: UseNodeCallbacksParams) {
  // ============================================================================
  // STRUCTURAL OPERATIONS
  // ============================================================================

  /** Add a new node at a specific slot and index */
  const handleAdd = useCallback(
    (parentId: string, slot: SlotId, index: number, kind: BlockKind) => {
      const next = insertAtSlot(current, parentId, slot, index, ensureSlots(createNode(kind)))
      push(next)
    },
    [current, push]
  )

  /** Append a null placeholder to a slot */
  const handleAppend = useCallback(
    (parentId: string, slot: SlotId) => {
      const next = appendPlaceholder(current, parentId, slot)
      push(next)
    },
    [current, push]
  )

  /** Remove a slot entry at specific index */
  const handleRemoveSlotEntry = useCallback(
    (parentId: string, slot: SlotId, index: number) => {
      const next = removeSlotEntry(current, parentId, slot, index)
      push(next)
    },
    [current, push]
  )

  /** Delete a node by ID */
  const handleDelete = useCallback(
    (id: string) => {
      const next = deleteNode(current, id)
      push(next)
    },
    [current, push]
  )

  /** Paste a copied node at a specific location */
  const handlePaste = useCallback(
    (parentId: string, slot: SlotId, index: number, child: FlowNode) => {
      const next = insertAtSlot(current, parentId, slot, index, cloneAndNormalize(child))
      push(next)
    },
    [current, push]
  )

  /** Paste a call reference at a specific location */
  const handlePasteCallRef = useCallback(
    (parentId: string, slot: SlotId, index: number, callChainId: string) => {
      const callNode = createNode('call')
      callNode.callRefId = callChainId
      const next = insertAtSlot(current, parentId, slot, index, ensureSlots(callNode))
      push(next)
    },
    [current, push]
  )

  // ============================================================================
  // PROPERTY UPDATES
  // ============================================================================

  /** Rename a node */
  const handleRename = useCallback(
    (id: string, title: string) => {
      const next = updateTitle(current, id, title)
      push(next)
    },
    [current, push]
  )

  /** Change weighting mode */
  const handleWeightChange = useCallback(
    (id: string, weight: WeightMode, branch?: 'then' | 'else') => {
      const next = updateWeight(current, id, weight, branch)
      push(next)
    },
    [current, push]
  )

  /** Update capped fallback ticker */
  const handleUpdateCappedFallback = useCallback(
    (id: string, choice: PositionChoice, branch?: 'then' | 'else') => {
      const next = updateCappedFallback(current, id, choice, branch)
      push(next)
    },
    [current, push]
  )

  /** Update volatility window */
  const handleUpdateVolWindow = useCallback(
    (id: string, days: number, branch?: 'then' | 'else') => {
      const next = updateVolWindow(current, id, days, branch)
      push(next)
    },
    [current, push]
  )

  /** Update function node window */
  const handleFunctionWindow = useCallback(
    (id: string, value: number) => {
      const next = updateFunctionWindow(current, id, value)
      push(next)
    },
    [current, push]
  )

  /** Update function node bottom N */
  const handleFunctionBottom = useCallback(
    (id: string, value: number) => {
      const next = updateFunctionBottom(current, id, value)
      push(next)
    },
    [current, push]
  )

  /** Update function node metric */
  const handleFunctionMetric = useCallback(
    (id: string, metric: MetricChoice) => {
      const next = updateFunctionMetric(current, id, metric)
      push(next)
    },
    [current, push]
  )

  /** Update function node rank direction */
  const handleFunctionRank = useCallback(
    (id: string, rank: RankChoice) => {
      const next = updateFunctionRank(current, id, rank)
      push(next)
    },
    [current, push]
  )

  /** Change node background color */
  const handleColorChange = useCallback(
    (id: string, color?: string) => {
      const next = updateColor(current, id, color)
      push(next)
    },
    [current, push]
  )

  /** Update call reference ID */
  const handleUpdateCallRef = useCallback(
    (id: string, callId: string | null) => {
      const next = updateCallReference(current, id, callId)
      push(next)
    },
    [current, push]
  )

  /** Toggle node collapse state */
  const handleToggleCollapse = useCallback(
    (id: string, isCollapsed: boolean) => {
      const next = updateCollapse(current, id, isCollapsed)
      push(next)
    },
    [current, push]
  )

  /** Collapse/expand all nodes below a target */
  const handleCollapseBelow = useCallback(
    (id: string, collapsed: boolean) => {
      const next = setCollapsedBelow(current, id, collapsed)
      push(next)
    },
    [current, push]
  )

  // ============================================================================
  // POSITION OPERATIONS
  // ============================================================================

  /** Add a position row to a position node */
  const handleAddPositionRow = useCallback(
    (id: string) => {
      const next = addPositionRow(current, id)
      push(next)
    },
    [current, push]
  )

  /** Remove a position row from a position node */
  const handleRemovePositionRow = useCallback(
    (id: string, index: number) => {
      const next = removePositionRow(current, id, index)
      push(next)
    },
    [current, push]
  )

  /** Choose a ticker for a position */
  const handleChoosePos = useCallback(
    (id: string, index: number, choice: PositionChoice) => {
      const next = choosePosition(current, id, index, choice)
      push(next)
    },
    [current, push]
  )

  // ============================================================================
  // CONDITION OPERATIONS (Indicator nodes)
  // ============================================================================

  /** Add a condition line to an indicator node */
  const handleAddCondition = useCallback(
    (id: string, type: 'and' | 'or', itemId?: string) => {
      const next = addConditionLine(current, id, type, itemId)
      push(next)
    },
    [current, push]
  )

  /** Delete a condition line from an indicator node */
  const handleDeleteCondition = useCallback(
    (id: string, condId: string, itemId?: string) => {
      const next = deleteConditionLine(current, id, condId, itemId)
      push(next)
    },
    [current, push]
  )

  /** Update condition fields */
  const handleUpdateCondition = useCallback(
    (id: string, condId: string, updates: ConditionFieldUpdates, itemId?: string) => {
      const next = updateConditionFields(current, id, condId, updates, itemId)
      push(next)
    },
    [current, push]
  )

  // ============================================================================
  // ALT EXIT CONDITION OPERATIONS
  // ============================================================================

  /** Add an entry condition to an altExit node */
  const handleAddEntryCondition = useCallback(
    (id: string, type: 'and' | 'or') => {
      const next = addEntryCondition(current, id, type)
      push(next)
    },
    [current, push]
  )

  /** Add an exit condition to an altExit node */
  const handleAddExitCondition = useCallback(
    (id: string, type: 'and' | 'or') => {
      const next = addExitCondition(current, id, type)
      push(next)
    },
    [current, push]
  )

  /** Delete an entry condition */
  const handleDeleteEntryCondition = useCallback(
    (id: string, condId: string) => {
      const next = deleteEntryCondition(current, id, condId)
      push(next)
    },
    [current, push]
  )

  /** Delete an exit condition */
  const handleDeleteExitCondition = useCallback(
    (id: string, condId: string) => {
      const next = deleteExitCondition(current, id, condId)
      push(next)
    },
    [current, push]
  )

  /** Update entry condition fields */
  const handleUpdateEntryCondition = useCallback(
    (id: string, condId: string, updates: ConditionFieldUpdates) => {
      const next = updateEntryConditionFields(current, id, condId, updates)
      push(next)
    },
    [current, push]
  )

  /** Update exit condition fields */
  const handleUpdateExitCondition = useCallback(
    (id: string, condId: string, updates: ConditionFieldUpdates) => {
      const next = updateExitConditionFields(current, id, condId, updates)
      push(next)
    },
    [current, push]
  )

  // ============================================================================
  // SCALING NODE OPERATIONS
  // ============================================================================

  /** Update scaling node fields */
  const handleUpdateScaling = useCallback(
    (id: string, updates: ScalingFieldUpdates) => {
      const next = updateScalingFields(current, id, updates)
      push(next)
    },
    [current, push]
  )

  // ============================================================================
  // NUMBERED NODE OPERATIONS
  // ============================================================================

  /** Update numbered node quantifier */
  const handleNumberedQuantifier = useCallback(
    (id: string, quantifier: NumberedQuantifier) => {
      const next = updateNumberedQuantifier(current, id, quantifier)
      push(next)
    },
    [current, push]
  )

  /** Update numbered node N value */
  const handleNumberedN = useCallback(
    (id: string, n: number) => {
      const next = updateNumberedN(current, id, n)
      push(next)
    },
    [current, push]
  )

  /** Add an item to a numbered node */
  const handleAddNumberedItem = useCallback(
    (id: string) => {
      const next = addNumberedItem(current, id)
      push(next)
    },
    [current, push]
  )

  /** Delete an item from a numbered node */
  const handleDeleteNumberedItem = useCallback(
    (id: string, itemId: string) => {
      const next = deleteNumberedItem(current, id, itemId)
      push(next)
    },
    [current, push]
  )

  return {
    // Structural
    handleAdd,
    handleAppend,
    handleRemoveSlotEntry,
    handleDelete,
    handlePaste,
    handlePasteCallRef,
    // Properties
    handleRename,
    handleWeightChange,
    handleUpdateCappedFallback,
    handleUpdateVolWindow,
    handleFunctionWindow,
    handleFunctionBottom,
    handleFunctionMetric,
    handleFunctionRank,
    handleColorChange,
    handleUpdateCallRef,
    handleToggleCollapse,
    handleCollapseBelow,
    // Positions
    handleAddPositionRow,
    handleRemovePositionRow,
    handleChoosePos,
    // Conditions
    handleAddCondition,
    handleDeleteCondition,
    handleUpdateCondition,
    // Alt Exit conditions
    handleAddEntryCondition,
    handleAddExitCondition,
    handleDeleteEntryCondition,
    handleDeleteExitCondition,
    handleUpdateEntryCondition,
    handleUpdateExitCondition,
    // Scaling
    handleUpdateScaling,
    // Numbered
    handleNumberedQuantifier,
    handleNumberedN,
    handleAddNumberedItem,
    handleDeleteNumberedItem,
  }
}
