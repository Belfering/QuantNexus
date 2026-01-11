// src/tabs/ForgeTab.tsx
// Forge tab component - lazy loadable wrapper for flowchart builder

import { type RefObject, useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { USED_TICKERS_DATALIST_ID } from '@/constants'
import { OptimizationResultsPanel } from '@/features/optimization/components/OptimizationResultsPanel'
import { RollingResultsSection } from '@/features/optimization/components/RollingResultsSection'
import { TickerListsPanel } from '@/features/forge/components/TickerListsPanel'
import type {
  FlowNode,
  CallChain,
  BlockKind,
  SlotId,
  PositionChoice,
  MetricChoice,
  RankChoice,
  WeightMode,
  BacktestError,
  BacktestResult,
  NumberedQuantifier,
  ConditionLine,
  BotSession,
} from '@/types'
import {
  createNode,
  ensureSlots,
  insertAtSlot,
  appendPlaceholder,
  deleteNode,
  removeSlotEntry,
  updateTitle,
  updateWeight,
  updateCappedFallback,
  updateVolWindow,
  updateCollapse,
  setCollapsedBelow,
  updateColor,
  updateCallReference,
  updateFunctionWindow,
  updateFunctionBottom,
  updateFunctionMetric,
  updateFunctionRank,
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
  cloneNode,
  cloneAndNormalize,
  findNode,
  collectUsedTickers,
  findTickerInstances,
  replaceTickerInTree,
  NodeCard,
} from '@/features/builder'
import { SettingsPanel } from '@/components/SettingsPanel'
import { ParameterBoxPanel } from '@/features/parameters/components/ParameterBoxPanel'
import type { ParameterField, ParameterRange } from '@/features/parameters/types'
import { loadCallChainsFromApi } from '@/features/auth'
import { useAuthStore, useUIStore, useBotStore, useBacktestStore, useTreeStore } from '@/stores'
import { useTreeSync, useTreeUndo, useTickerLists } from '@/hooks'
// Updated: TIM/TIMAR metrics now included
import { useBatchBacktest } from '@/features/optimization/hooks/useBatchBacktest'
import { applyBranchToTree } from '@/features/optimization/services/branchGenerator'
import type { EligibilityRequirement } from '@/types/admin'

export interface ForgeTabProps {
  // Backtest panel props (from App.tsx - derived or callback)
  tickerOptions: string[]
  backtestStatus: 'idle' | 'running' | 'done' | 'error'
  backtestResult: BacktestResult | null
  backtestErrors: BacktestError[]
  handleRunBacktest: () => void
  handleJumpToBacktestError: (err: BacktestError) => void
  theme: 'light' | 'dark'
  fetchBenchmarkMetrics: () => void
  runModelRobustness: () => void
  activeBot: BotSession | undefined

  // Call chain props (from App.tsx - per-bot state)
  callChains: CallChain[]
  setCallChains: (chains: CallChain[]) => void
  handleAddCallChain: () => void
  handleRenameCallChain: (id: string, name: string) => void
  handleToggleCallChainCollapse: (id: string) => void
  handleDeleteCallChain: (id: string) => void
  pushCallChain: (id: string, newRoot: FlowNode) => void

  // Backtest visual state
  backtestErrorNodeIds: Set<string>
  backtestFocusNodeId: string | null

  // Scroll refs for floating scrollbar sync
  flowchartScrollRef: RefObject<HTMLDivElement | null>
  floatingScrollRef: RefObject<HTMLDivElement | null>
}

export function ForgeTab({
  // Props from App.tsx (derived or callback)
  tickerOptions,
  backtestStatus,
  backtestResult,
  backtestErrors,
  handleRunBacktest,
  handleJumpToBacktestError,
  theme,
  fetchBenchmarkMetrics,
  runModelRobustness,
  activeBot,
  // Call chain props
  callChains,
  setCallChains,
  handleAddCallChain,
  handleRenameCallChain,
  handleToggleCallChainCollapse,
  handleDeleteCallChain,
  pushCallChain,
  // Backtest visual state
  backtestErrorNodeIds,
  backtestFocusNodeId,
  // Refs
  flowchartScrollRef,
  floatingScrollRef,
}: ForgeTabProps) {
  // --- Tree state from useTreeStore (Phase 2N-15c) ---
  // Use Forge-specific tree sync to keep independent from Model tab
  const current = useTreeSync('Forge')
  const { undo, redo } = useTreeUndo()
  const treeStore = useTreeStore()

  // Flowchart scroll width for the horizontal scrollbar (updated by App.tsx)
  const flowchartScrollWidth = useUIStore(s => s.flowchartScrollWidth)
  const { forgeSubtab, setForgeSubtab } = useUIStore()

  // Ticker lists for Forge optimization (Phase 3)
  const { tickerLists } = useTickerLists()

  // Tree operation handlers from store
  const handleAdd = (parentId: string, slot: SlotId, index: number, kind: BlockKind) => {
    treeStore.insertNode(parentId, slot, index, kind)
  }
  const handleAppend = (parentId: string, slot: SlotId) => {
    treeStore.appendPlaceholder(parentId, slot)
  }
  const handleRemoveSlotEntry = (parentId: string, slot: SlotId, index: number) => {
    treeStore.removeSlotEntry(parentId, slot, index)
  }
  const handleDelete = (id: string) => {
    if (current.id === id) {
      // Deleting root - handled by useBotStore.closeBot
      const { activeBotId, closeBot } = useBotStore.getState()
      closeBot(activeBotId)
      return
    }
    treeStore.deleteNode(id)
  }
  const handleRename = (id: string, title: string) => {
    treeStore.renameNode(id, title)
  }
  const handleWeightChange = (id: string, weight: WeightMode, branch?: 'then' | 'else') => {
    treeStore.updateWeight(id, weight, branch)
  }
  const handleUpdateCappedFallback = (id: string, choice: PositionChoice, branch?: 'then' | 'else') => {
    treeStore.updateCappedFallback(id, choice, branch)
  }
  const handleUpdateVolWindow = (id: string, days: number, branch?: 'then' | 'else') => {
    treeStore.updateVolWindow(id, days, branch)
  }
  const handleColorChange = (id: string, color?: string) => {
    treeStore.updateColor(id, color)
  }
  const handleToggleCollapse = (id: string, collapsed: boolean) => {
    treeStore.toggleCollapse(id, collapsed)
  }
  const handleNumberedQuantifier = (id: string, quantifier: NumberedQuantifier) => {
    treeStore.updateNumberedQuantifier(id, quantifier)
  }
  const handleNumberedN = (id: string, n: number) => {
    treeStore.updateNumberedN(id, n)
  }
  const handleAddNumberedItem = (id: string) => {
    treeStore.addNumberedItem(id)
  }
  const handleDeleteNumberedItem = (id: string, itemId: string) => {
    treeStore.deleteNumberedItem(id, itemId)
  }
  const handleAddCondition = (id: string, type: 'and' | 'or', itemId?: string) => {
    treeStore.addCondition(id, type, itemId)
  }
  const handleDeleteCondition = (id: string, condId: string, itemId?: string) => {
    treeStore.deleteCondition(id, condId, itemId)
  }
  const handleFunctionWindow = (id: string, value: number) => {
    treeStore.updateFunctionWindow(id, value)
  }
  const handleFunctionBottom = (id: string, value: number) => {
    treeStore.updateFunctionBottom(id, value)
  }
  const handleFunctionMetric = (id: string, metric: MetricChoice) => {
    treeStore.updateFunctionMetric(id, metric)
  }
  const handleFunctionRank = (id: string, rank: RankChoice) => {
    treeStore.updateFunctionRank(id, rank as 'Top' | 'Bottom')
  }
  const handleAddPos = (id: string) => {
    treeStore.addPosition(id)
  }
  const handleRemovePos = (id: string, index: number) => {
    treeStore.removePosition(id, index)
  }
  const handleChoosePos = (id: string, index: number, choice: PositionChoice) => {
    // If ticker list selected, also set node-level fields for branch generator
    if (choice.startsWith('list:')) {
      const listId = choice.substring(5)
      const tickerList = tickerLists?.find(l => l.id === listId)

      // Helper to recursively update node
      const updateNode = (node: FlowNode): FlowNode => {
        if (node.id === id && node.kind === 'position') {
          const newPositions = [...(node.positions || [])]
          newPositions[index] = choice
          return {
            ...node,
            positions: newPositions,
            positionMode: 'ticker_list', // Set mode to ticker_list
            positionTickerListId: listId,
            positionTickerListName: tickerList?.name
          }
        }
        // Recurse through children
        if (node.children) {
          const newChildren: Partial<Record<SlotId, FlowNode[]>> = {}
          for (const [slotKey, slotNodes] of Object.entries(node.children)) {
            if (Array.isArray(slotNodes)) {
              newChildren[slotKey as SlotId] = slotNodes.map(child => child ? updateNode(child) : child)
            }
          }
          return { ...node, children: newChildren }
        }
        return node
      }

      const next = updateNode(current)
      push(next)
    } else {
      // Regular ticker selected - clear ticker list metadata
      const updateNode = (node: FlowNode): FlowNode => {
        if (node.id === id && node.kind === 'position') {
          const newPositions = [...(node.positions || [])]
          newPositions[index] = choice
          return {
            ...node,
            positions: newPositions,
            positionMode: 'manual', // Reset to manual mode
            positionTickerListId: undefined,
            positionTickerListName: undefined
          }
        }
        // Recurse through children
        if (node.children) {
          const newChildren: Partial<Record<SlotId, FlowNode[]>> = {}
          for (const [slotKey, slotNodes] of Object.entries(node.children)) {
            if (Array.isArray(slotNodes)) {
              newChildren[slotKey as SlotId] = slotNodes.map(child => child ? updateNode(child) : child)
            }
          }
          return { ...node, children: newChildren }
        }
        return node
      }

      const next = updateNode(current)
      push(next)
    }

    // Auto-create parameter range for ticker list references
    if (activeBot && tickerLists && choice.startsWith('list:')) {
      const listId = choice.substring(5) // Remove 'list:' prefix
      const tickerList = tickerLists.find(l => l.id === listId)
      if (tickerList) {
        const paramId = `${id}-position-list`
        const updatedRanges = [...(activeBot.parameterRanges || [])]
        const existingIndex = updatedRanges.findIndex(r => r.id === paramId)

        const parameterRange: ParameterRange = {
          id: paramId,
          type: 'ticker_list',
          nodeId: id,
          path: `${id}.positions`,
          currentValue: 0, // Not used for ticker lists
          enabled: true,
          min: 0,
          max: 0,
          step: 1,
          tickerListId: tickerList.id,
          tickerListName: tickerList.name,
          tickers: tickerList.tickers
        }

        if (existingIndex !== -1) {
          updatedRanges[existingIndex] = parameterRange
        } else {
          updatedRanges.push(parameterRange)
        }

        botStore.setParameterRanges(activeBot.id, updatedRanges)
      }
    } else if (activeBot) {
      // Regular ticker selected - remove ticker list parameter range if it exists
      const paramId = `${id}-position-list`
      const updatedRanges = (activeBot.parameterRanges || []).filter(r => r.id !== paramId)
      if (updatedRanges.length !== (activeBot.parameterRanges || []).length) {
        botStore.setParameterRanges(activeBot.id, updatedRanges)
      }
    }
  }
  const handleUpdatePositionMode = (id: string, mode: 'manual' | 'ticker_list' | 'match_indicator') => {
    // Helper to recursively update node
    const updateNode = (node: FlowNode): FlowNode => {
      if (node.id === id && node.kind === 'position') {
        return {
          ...node,
          positionMode: mode
        }
      }
      // Recurse through children
      if (node.children) {
        const newChildren: Partial<Record<SlotId, FlowNode[]>> = {}
        for (const [slotKey, slotNodes] of Object.entries(node.children)) {
          if (Array.isArray(slotNodes)) {
            newChildren[slotKey as SlotId] = slotNodes.map(child => child ? updateNode(child) : child)
          }
        }
        return { ...node, children: newChildren }
      }
      return node
    }

    const next = updateNode(current)
    push(next)
  }
  const handleUpdateCallRef = (id: string, callId: string | null) => {
    treeStore.updateCallReference(id, callId)
  }
  const handleAddEntryCondition = (id: string, type: 'and' | 'or') => {
    treeStore.addEntryCondition(id, type)
  }
  const handleAddExitCondition = (id: string, type: 'and' | 'or') => {
    treeStore.addExitCondition(id, type)
  }
  const handleDeleteEntryCondition = (id: string, condId: string) => {
    treeStore.deleteEntryCondition(id, condId)
  }
  const handleDeleteExitCondition = (id: string, condId: string) => {
    treeStore.deleteExitCondition(id, condId)
  }
  const handleUpdateEntryCondition = (id: string, condId: string, updates: Partial<ConditionLine>) => {
    treeStore.updateEntryCondition(id, condId, updates as Parameters<typeof treeStore.updateEntryCondition>[2])

    // Auto-create parameter ranges for ticker list references in entry conditions
    if (activeBot && tickerLists) {
      const handleTickerListRange = (ticker: string | undefined, isRightTicker: boolean) => {
        if (!ticker || !ticker.startsWith('list:')) return

        const listId = ticker.substring(5)
        const tickerList = tickerLists.find(l => l.id === listId)
        if (!tickerList) return

        const paramId = isRightTicker
          ? `${id}-entry-${condId}-rightTicker-list`
          : `${id}-entry-${condId}-ticker-list`

        const updatedRanges = [...(activeBot.parameterRanges || [])]
        const existingIndex = updatedRanges.findIndex(r => r.id === paramId)

        const parameterRange: ParameterRange = {
          id: paramId,
          type: 'ticker_list',
          nodeId: id,
          conditionId: condId,
          path: isRightTicker
            ? `${id}.entryConditions.${condId}.rightTicker`
            : `${id}.entryConditions.${condId}.ticker`,
          currentValue: 0,
          enabled: true,
          min: 0,
          max: 0,
          step: 1,
          tickerListId: tickerList.id,
          tickerListName: tickerList.name,
          tickers: tickerList.tickers
        }

        if (existingIndex !== -1) {
          updatedRanges[existingIndex] = parameterRange
        } else {
          updatedRanges.push(parameterRange)
        }

        botStore.setParameterRanges(activeBot.id, updatedRanges)
      }

      if (updates.ticker !== undefined) {
        handleTickerListRange(updates.ticker as string, false)
      }
      if (updates.rightTicker !== undefined) {
        handleTickerListRange(updates.rightTicker as string, true)
      }
    }
  }
  const handleUpdateExitCondition = (id: string, condId: string, updates: Partial<ConditionLine>) => {
    treeStore.updateExitCondition(id, condId, updates as Parameters<typeof treeStore.updateExitCondition>[2])

    // Auto-create parameter ranges for ticker list references in exit conditions
    if (activeBot && tickerLists) {
      const handleTickerListRange = (ticker: string | undefined, isRightTicker: boolean) => {
        if (!ticker || !ticker.startsWith('list:')) return

        const listId = ticker.substring(5)
        const tickerList = tickerLists.find(l => l.id === listId)
        if (!tickerList) return

        const paramId = isRightTicker
          ? `${id}-exit-${condId}-rightTicker-list`
          : `${id}-exit-${condId}-ticker-list`

        const updatedRanges = [...(activeBot.parameterRanges || [])]
        const existingIndex = updatedRanges.findIndex(r => r.id === paramId)

        const parameterRange: ParameterRange = {
          id: paramId,
          type: 'ticker_list',
          nodeId: id,
          conditionId: condId,
          path: isRightTicker
            ? `${id}.exitConditions.${condId}.rightTicker`
            : `${id}.exitConditions.${condId}.ticker`,
          currentValue: 0,
          enabled: true,
          min: 0,
          max: 0,
          step: 1,
          tickerListId: tickerList.id,
          tickerListName: tickerList.name,
          tickers: tickerList.tickers
        }

        if (existingIndex !== -1) {
          updatedRanges[existingIndex] = parameterRange
        } else {
          updatedRanges.push(parameterRange)
        }

        botStore.setParameterRanges(activeBot.id, updatedRanges)
      }

      if (updates.ticker !== undefined) {
        handleTickerListRange(updates.ticker as string, false)
      }
      if (updates.rightTicker !== undefined) {
        handleTickerListRange(updates.rightTicker as string, true)
      }
    }
  }
  const handleUpdateScaling = (id: string, updates: Record<string, unknown>) => {
    treeStore.updateScaling(id, updates as Parameters<typeof treeStore.updateScaling>[1])

    // Auto-create parameter range for ticker list references in scaling ticker
    if (activeBot && tickerLists && updates.scaleTicker) {
      const ticker = updates.scaleTicker as string
      if (ticker.startsWith('list:')) {
        const listId = ticker.substring(5)
        const tickerList = tickerLists.find(l => l.id === listId)
        if (tickerList) {
          const paramId = `${id}-scaling-ticker-list`
          const updatedRanges = [...(activeBot.parameterRanges || [])]
          const existingIndex = updatedRanges.findIndex(r => r.id === paramId)

          const parameterRange: ParameterRange = {
            id: paramId,
            type: 'ticker_list',
            nodeId: id,
            path: `${id}.scaleTicker`,
            currentValue: 0,
            enabled: true,
            min: 0,
            max: 0,
            step: 1,
            tickerListId: tickerList.id,
            tickerListName: tickerList.name,
            tickers: tickerList.tickers
          }

          if (existingIndex !== -1) {
            updatedRanges[existingIndex] = parameterRange
          } else {
            updatedRanges.push(parameterRange)
          }

          botStore.setParameterRanges(activeBot.id, updatedRanges)
        }
      }
    }
  }
  const handleUpdateRolling = (id: string, updates: Record<string, unknown>) => {
    treeStore.updateRolling(id, updates as Parameters<typeof treeStore.updateRolling>[1])

    // Sync to IS/OOS Split config when Rolling node is updated
    if (activeBot && activeBot.splitConfig?.strategy === 'rolling') {
      const typedUpdates = updates as { rollingWindow?: string; rankBy?: string }
      const updatedConfig = { ...activeBot.splitConfig }

      if (typedUpdates.rollingWindow) {
        updatedConfig.rollingWindowPeriod = typedUpdates.rollingWindow as 'daily' | 'monthly' | 'yearly'
      }
      if (typedUpdates.rankBy) {
        updatedConfig.rankBy = typedUpdates.rankBy
      }

      useBotStore.getState().setSplitConfig(activeBot.id, updatedConfig)
    }
  }
  // Clipboard handlers using useBotStore
  const handleCopy = (id: string) => {
    const found = findNode(current, id)
    if (!found) return
    const { setClipboard, setCopiedNodeId } = useBotStore.getState()
    setClipboard(cloneNode(found))
    setCopiedNodeId(id)
  }
  const handlePaste = (parentId: string, slot: SlotId, index: number, child: FlowNode) => {
    const normalized = cloneAndNormalize(child)
    treeStore.insertNode(parentId, slot, index, normalized.kind)
    // After insert, replace the placeholder with the cloned node
    const next = insertAtSlot(current, parentId, slot, index, normalized)
    treeStore.setRoot(next)
  }
  const handlePasteCallRef = (parentId: string, slot: SlotId, index: number, callChainId: string) => {
    const callNode = createNode('call')
    callNode.callRefId = callChainId
    const next = insertAtSlot(current, parentId, slot, index, ensureSlots(callNode))
    treeStore.setRoot(next)
  }
  // push for inline callbacks that still need it
  const push = (node: FlowNode) => {
    treeStore.setRoot(node)
  }

  // Handle parameter updates from ParameterBoxPanel (legacy flat version)
  const handleParameterUpdate = (paramId: string, field: ParameterField, value: any) => {
    // Parse paramId to extract nodeId, condId, and potentially itemId
    const parts = paramId.split('-')
    const nodeId = parts[0]

    // Check if this is a function node (paramId format: nodeId-function-field)
    if (parts[1] === 'function') {
      if (field === 'window') {
        treeStore.updateFunctionWindow(nodeId, value)
      } else if (field === 'metric') {
        treeStore.updateFunctionMetric(nodeId, value)
      }
      return
    }

    // For indicator and numbered nodes, use updateConditionFields
    // Format: nodeId-condId-field or nodeId-itemId-condId-field
    let condId: string
    let itemId: string | undefined

    if (parts.length === 4) {
      // Numbered node: nodeId-itemId-condId-field
      itemId = parts[1]
      condId = parts[2]
    } else {
      // Indicator node: nodeId-condId-field
      condId = parts[1]
    }

    const updates = { [field]: value }
    const next = updateConditionFields(current, nodeId, condId, updates, itemId)
    push(next)
  }

  // Handle hierarchical parameter updates with StrategyParameter type
  const handleHierarchicalParameterUpdate = (
    nodeId: string,
    parameter: import('@/features/parameters/types').StrategyParameter,
    value: any
  ) => {
    switch (parameter.type) {
      case 'weight':
        // Update weight (with optional branch)
        treeStore.updateWeight(nodeId, value as WeightMode, parameter.branch)
        break

      case 'condition':
        // Update condition field
        const updates = { [parameter.field]: value }
        const next = updateConditionFields(
          current,
          nodeId,
          parameter.conditionId,
          updates,
          parameter.itemId
        )
        push(next)
        break

      case 'position':
        // Update positions array
        const found = findNode(current, nodeId)
        if (found && found.kind === 'position') {
          const updated = { ...found, positions: value as string[] }
          const nextTree = replaceNodeById(current, nodeId, updated)
          push(nextTree)
        }
        break

      case 'function':
        // Update function node parameters
        if (parameter.field === 'window') {
          treeStore.updateFunctionWindow(nodeId, value)
        } else if (parameter.field === 'metric') {
          treeStore.updateFunctionMetric(nodeId, value)
        } else if (parameter.field === 'bottom') {
          treeStore.updateFunctionBottom(nodeId, value)
        } else if (parameter.field === 'rank') {
          treeStore.updateFunctionRank(nodeId, value as 'Top' | 'Bottom')
        }
        break

      case 'numbered':
        // Update numbered node config
        if (parameter.field === 'quantifier') {
          treeStore.updateNumberedQuantifier(nodeId, value)
        } else if (parameter.field === 'n') {
          treeStore.updateNumberedN(nodeId, value)
        }
        break
    }
  }

  // Handle parameter range updates from flowchart
  const handleFlowchartRangeUpdate = (
    paramId: string,
    enabled: boolean,
    range?: { min: number; max: number; step: number }
  ) => {
    if (!activeBot) return

    // Read from the appropriate parameter range array based on current strategy
    const currentStrategy = activeBot.splitConfig?.strategy || 'chronological'
    const sourceRanges = currentStrategy === 'rolling'
      ? (activeBot.rollingParameterRanges || [])
      : parameterRanges
    const updatedRanges = [...sourceRanges]

    if (enabled && range) {
      // Find or create parameter range
      const existingIndex = updatedRanges.findIndex((r) => r.id === paramId)

      // Parse paramId to get metadata
      const parts = paramId.split('-')
      const nodeId = parts[0]

      // Check if this is a function node (format: nodeId-function-window or nodeId-function-bottom)
      if (parts[1] === 'function' && parts[2] === 'window') {
        // Update function window
        treeStore.updateFunctionWindow(nodeId, range.min)

        const parameterRange: ParameterRange = {
          id: paramId,
          type: 'period',
          nodeId,
          conditionId: '',
          path: `${nodeId}.window`,
          currentValue: range.min,
          enabled: true,
          min: range.min,
          max: range.max,
          step: range.step,
        }

        if (existingIndex !== -1) {
          updatedRanges[existingIndex] = parameterRange
        } else {
          updatedRanges.push(parameterRange)
        }
      } else if (parts[1] === 'function' && parts[2] === 'bottom') {
        // Update function bottom
        treeStore.updateFunctionBottom(nodeId, range.min)

        const parameterRange: ParameterRange = {
          id: paramId,
          type: 'threshold',
          nodeId,
          conditionId: '',
          path: `${nodeId}.bottom`,
          currentValue: range.min,
          enabled: true,
          min: range.min,
          max: range.max,
          step: range.step,
        }

        if (existingIndex !== -1) {
          updatedRanges[existingIndex] = parameterRange
        } else {
          updatedRanges.push(parameterRange)
        }
      } else if (parts[1] === 'scaling' && parts[2] === 'window') {
        // Update scaling window
        const next = replaceNode(current, nodeId, (node) => ({
          ...node,
          scaleWindow: range.min,
        }))
        push(next)

        const parameterRange: ParameterRange = {
          id: paramId,
          type: 'period',
          nodeId,
          conditionId: '',
          path: `${nodeId}.scaleWindow`,
          currentValue: range.min,
          enabled: true,
          min: range.min,
          max: range.max,
          step: range.step,
        }

        if (existingIndex !== -1) {
          updatedRanges[existingIndex] = parameterRange
        } else {
          updatedRanges.push(parameterRange)
        }
      } else if (parts[1] === 'scaling' && parts[2] === 'from') {
        // Update scaling from
        const next = replaceNode(current, nodeId, (node) => ({
          ...node,
          scaleFrom: range.min,
        }))
        push(next)

        const parameterRange: ParameterRange = {
          id: paramId,
          type: 'threshold',
          nodeId,
          conditionId: '',
          path: `${nodeId}.scaleFrom`,
          currentValue: range.min,
          enabled: true,
          min: range.min,
          max: range.max,
          step: range.step,
        }

        if (existingIndex !== -1) {
          updatedRanges[existingIndex] = parameterRange
        } else {
          updatedRanges.push(parameterRange)
        }
      } else if (parts[1] === 'scaling' && parts[2] === 'to') {
        // Update scaling to
        const next = replaceNode(current, nodeId, (node) => ({
          ...node,
          scaleTo: range.min,
        }))
        push(next)

        const parameterRange: ParameterRange = {
          id: paramId,
          type: 'threshold',
          nodeId,
          conditionId: '',
          path: `${nodeId}.scaleTo`,
          currentValue: range.min,
          enabled: true,
          min: range.min,
          max: range.max,
          step: range.step,
        }

        if (existingIndex !== -1) {
          updatedRanges[existingIndex] = parameterRange
        } else {
          updatedRanges.push(parameterRange)
        }
      } else if (parts[1] === 'numbered' && parts[2] === 'n') {
        // Handle numbered n parameter (format: nodeId-numbered-n)
        treeStore.updateNumberedN(nodeId, range.min)

        const parameterRange: ParameterRange = {
          id: paramId,
          type: 'threshold',
          nodeId,
          conditionId: '',
          path: `${nodeId}.numbered.n`,
          currentValue: range.min,
          enabled: true,
          min: range.min,
          max: range.max,
          step: range.step,
        }

        if (existingIndex !== -1) {
          updatedRanges[existingIndex] = parameterRange
        } else {
          updatedRanges.push(parameterRange)
        }
      } else {
        // Handle condition parameters (format: nodeId-condId-field)
        const condId = parts[1]
        const field = parts[parts.length - 1] as 'window' | 'threshold' | 'rightWindow' | 'forDays'

        // Update the actual value in the tree to the min value
        const updates = { [field]: range.min }
        const next = updateConditionFields(current, nodeId, condId, updates)
        push(next)

        const parameterRange: ParameterRange = {
          id: paramId,
          type: field === 'window' || field === 'rightWindow' ? 'period' : 'threshold',
          nodeId,
          conditionId: condId,
          path: `${nodeId}.conditions.${condId}.${field}`,
          currentValue: range.min,
          enabled: true,
          min: range.min,
          max: range.max,
          step: range.step,
        }

        if (existingIndex !== -1) {
          updatedRanges[existingIndex] = parameterRange
        } else {
          updatedRanges.push(parameterRange)
        }
      }
    } else {
      // Disable optimization
      const existingIndex = updatedRanges.findIndex((r) => r.id === paramId)
      if (existingIndex !== -1) {
        updatedRanges[existingIndex] = {
          ...updatedRanges[existingIndex],
          enabled: false,
        }
      }
    }

    // Save to the appropriate parameter range array based on current strategy
    if (currentStrategy === 'rolling') {
      botStore.setRollingParameterRanges(activeBot.id, updatedRanges)
    } else {
      botStore.setParameterRanges(activeBot.id, updatedRanges)
    }
  }

  // --- Zustand stores ---
  // Auth store
  const userId = useAuthStore((s) => s.userId)

  // UI store
  const {
    callbackNodesCollapsed,
    setCallbackNodesCollapsed,
    customIndicatorsCollapsed,
    setCustomIndicatorsCollapsed,
    openTickerModal,
  } = useUIStore()

  // Bot store
  const {
    clipboard,
    setClipboard,
    copiedNodeId,
    copiedCallChainId,
    setCopiedCallChainId,
    findTicker,
    setFindTicker,
    replaceTicker,
    setReplaceTicker,
    includePositions,
    setIncludePositions,
    includeIndicators,
    setIncludeIndicators,
    includeCallChains,
    setIncludeCallChains,
    foundInstances,
    setFoundInstances,
    currentInstanceIndex,
    setCurrentInstanceIndex,
    highlightedInstance,
    setHighlightedInstance,
  } = useBotStore()

  // Backtest store
  const {
    backtestMode,
    setBacktestMode,
    backtestCostBps,
    setBacktestCostBps,
    backtestBenchmark,
    setBacktestBenchmark,
    backtestShowBenchmark,
    setBacktestShowBenchmark,
    etfsOnlyMode,
    setEtfsOnlyMode,
    indicatorOverlayData,
    benchmarkMetrics,
    modelSanityReport,
    enabledOverlays,
    toggleOverlay: handleToggleOverlay,
  } = useBacktestStore()

  // Floating scrollbar position tracking
  const [flowchartRect, setFlowchartRect] = useState({ left: 0, width: 0 })

  // Parameter ranges for optimization (stored in bot session)
  const botStore = useBotStore()
  const parameterRanges = activeBot?.parameterRanges ?? []

  // Track flowchart container position for floating scrollbar
  useEffect(() => {
    const updateRect = () => {
      const container = flowchartScrollRef.current?.parentElement
      if (container) {
        const rect = container.getBoundingClientRect()
        setFlowchartRect({ left: rect.left, width: rect.width })
      }
    }

    // Initialize scroll dimensions on mount
    const initScrollDimensions = () => {
      const scrollContainer = flowchartScrollRef.current
      if (scrollContainer) {
        const { setFlowchartScrollWidth, setFlowchartClientWidth } = useUIStore.getState()
        setFlowchartScrollWidth(scrollContainer.scrollWidth)
        setFlowchartClientWidth(scrollContainer.clientWidth)
      }
    }

    // Initial update
    updateRect()
    // Delay scroll dimension init to ensure content is rendered
    setTimeout(initScrollDimensions, 100)

    // Update on resize
    window.addEventListener('resize', updateRect)

    // Also observe the container for size changes (e.g., sidebar collapse)
    const container = flowchartScrollRef.current?.parentElement
    let resizeObserver: ResizeObserver | null = null
    if (container) {
      resizeObserver = new ResizeObserver(() => {
        updateRect()
        initScrollDimensions()
      })
      resizeObserver.observe(container)
    }

    return () => {
      window.removeEventListener('resize', updateRect)
      resizeObserver?.disconnect()
    }
  }, [flowchartScrollRef])

  // --- Optimization state and handlers ---
  const [requirements, setRequirements] = useState<EligibilityRequirement[]>([])
  const { job: batchJob, runBatchBacktest, cancelJob } = useBatchBacktest()
  const [rollingOptimizationRunning, setRollingOptimizationRunning] = useState(false)
  const [rollingProgress, setRollingProgress] = useState<{completed: number, total: number, currentPeriod: number, totalPeriods: number} | null>(null)
  const [resultsSubtab, setResultsSubtab] = useState<'Chronological' | 'Rolling'>('Chronological')

  // Load requirements from API on mount
  useEffect(() => {
    async function loadRequirements() {
      try {
        const response = await fetch('/api/admin/eligibility')
        if (response.ok) {
          const data = await response.json()
          setRequirements(data.eligibilityRequirements || [])
        }
      } catch (error) {
        console.error('Failed to load eligibility requirements:', error)
      }
    }
    loadRequirements()
  }, [])

  // Clear old batch job when switching to Forge tab
  useEffect(() => {
    if (activeBot) {
      console.log('[ForgeTab] Clearing old batch job on tab mount')
      useBotStore.getState().setBranchGenerationJob(activeBot.id, undefined)
    }
  }, []) // Run only on mount

  // Auto-extract parameter ranges from tree values (ROLLING ONLY)
  // This parses syntax like "9-10" → min:9, max:10 from indicator conditions
  const extractRollingRanges = (node: FlowNode): ParameterRange[] => {
    const ranges: ParameterRange[] = []

    // Recursively traverse tree
    const traverse = (n: FlowNode) => {
      console.log('[extractRollingRanges] Checking node:', n.kind, n.id)

      if (n.kind === 'indicator' && n.conditions) {
        console.log('[extractRollingRanges] Found indicator with conditions:', n.conditions)

        for (const cond of n.conditions) {
          const condId = cond.id
          console.log('[extractRollingRanges] Condition:', condId, cond)

          // Parse window (e.g., "9-10" → min:9, max:10)
          if (cond.window) {
            console.log('[extractRollingRanges] Window:', cond.window, typeof cond.window)
            const parts = String(cond.window).split('-')
            console.log('[extractRollingRanges] Window parts:', parts)
            if (parts.length === 2) {
              const min = parseInt(parts[0])
              const max = parseInt(parts[1])
              if (!isNaN(min) && !isNaN(max)) {
                console.log('[extractRollingRanges] Adding window range:', min, max)
                ranges.push({
                  id: `${n.id}-${condId}-window`,
                  type: 'period',
                  path: `${n.id}.conditions.${condId}.window`,
                  min,
                  max,
                  step: 1,
                  enabled: true
                })
              }
            }
          }

          // Parse threshold (e.g., "25-26" → min:25, max:26)
          if (cond.threshold !== undefined) {
            console.log('[extractRollingRanges] Threshold:', cond.threshold, typeof cond.threshold)
            const parts = String(cond.threshold).split('-')
            console.log('[extractRollingRanges] Threshold parts:', parts)
            if (parts.length === 2) {
              const min = parseFloat(parts[0])
              const max = parseFloat(parts[1])
              if (!isNaN(min) && !isNaN(max)) {
                console.log('[extractRollingRanges] Adding threshold range:', min, max)
                ranges.push({
                  id: `${n.id}-${condId}-threshold`,
                  type: 'threshold',
                  path: `${n.id}.conditions.${condId}.threshold`,
                  min,
                  max,
                  step: 1,
                  enabled: true
                })
              }
            }
          }

          // Parse forDays (e.g., "10-12" → min:10, max:12)
          if (cond.forDays !== undefined) {
            console.log('[extractRollingRanges] ForDays:', cond.forDays, typeof cond.forDays)
            const parts = String(cond.forDays).split('-')
            console.log('[extractRollingRanges] ForDays parts:', parts)
            if (parts.length === 2) {
              const min = parseInt(parts[0])
              const max = parseInt(parts[1])
              if (!isNaN(min) && !isNaN(max)) {
                console.log('[extractRollingRanges] Adding forDays range:', min, max)
                ranges.push({
                  id: `${n.id}-${condId}-forDays`,
                  type: 'period',
                  path: `${n.id}.conditions.${condId}.forDays`,
                  min,
                  max,
                  step: 1,
                  enabled: true
                })
              }
            }
          }
        }
      }

      // Recursively check children
      if (n.children) {
        for (const slot in n.children) {
          const children = n.children[slot as SlotId]
          if (Array.isArray(children)) {
            for (const child of children) {
              if (child) {
                traverse(child)
              }
            }
          }
        }
      }
    }

    traverse(node)
    console.log('[extractRollingRanges] Final ranges:', ranges)
    return ranges
  }

  // Handler to start branch generation
  const handleGenerateBranches = async () => {
    if (!activeBot) return

    const parameterRanges = activeBot.parameterRanges || []
    // Ensure splitConfig has default values if not initialized
    const splitConfig = activeBot.splitConfig || {
      enabled: true,
      strategy: 'chronological' as const,
      chronologicalPercent: 50,
      minYears: 5
    }
    const mode = 'CC' // Default mode
    const costBps = 5 // Default cost

    // DEBUG: Log splitConfig to verify it's initialized
    console.log('[ForgeTab] Starting optimization with splitConfig:', JSON.stringify(splitConfig))

    // Check if tree contains Rolling node
    const hasRollingNode = (node: FlowNode): boolean => {
      if (node.kind === 'rolling') return true
      if (node.children) {
        for (const slot in node.children) {
          const children = node.children[slot as SlotId]
          if (Array.isArray(children)) {
            for (const child of children) {
              if (child && hasRollingNode(child)) return true
            }
          }
        }
      }
      return false
    }

    // If Rolling node exists and strategy is rolling, use rolling optimization endpoint
    if (hasRollingNode(current) && splitConfig.strategy === 'rolling') {
      console.log('[ForgeTab] Detected Rolling node - using rolling optimization endpoint')

      // Clear any old batch job before starting new rolling optimization
      useBotStore.getState().setBranchGenerationJob(activeBot.id, undefined)

      // ROLLING: Use separate rollingParameterRanges
      const rollingParameterRanges = activeBot.rollingParameterRanges || []
      console.log('[ForgeTab] Using rolling parameter ranges:', rollingParameterRanges)

      // Extract tickers from ticker lists in rolling parameter ranges
      console.log('[ForgeTab] Rolling parameter ranges:', JSON.stringify(rollingParameterRanges, null, 2))
      const tickerListRanges = rollingParameterRanges.filter(r => r.type === 'ticker_list')
      console.log('[ForgeTab] Filtered ticker list ranges:', tickerListRanges)

      const tickers: string[] = []
      for (const range of tickerListRanges) {
        if (range.tickers) {
          tickers.push(...range.tickers)
        }
      }

      // Fallback: If no ticker list parameter ranges, extract tickers from position nodes in tree
      if (tickers.length === 0) {
        console.log('[ForgeTab] No ticker list parameter ranges found, extracting from position nodes...')
        console.log('[ForgeTab] Current tree:', JSON.stringify(current, null, 2))

        const extractTickersFromTree = (node: FlowNode, depth = 0): string[] => {
          const found: string[] = []
          const indent = '  '.repeat(depth)

          console.log(`${indent}[ForgeTab] Checking node:`, node.kind, node.id)

          // If this is a position node, extract tickers
          if (node.kind === 'position') {
            console.log(`${indent}  Position node found, positions:`, node.positions)
            if (node.positions && Array.isArray(node.positions)) {
              for (const pos of node.positions) {
                console.log(`${indent}    Position entry:`, pos)
                // Positions can be either strings or objects with ticker property
                const ticker = typeof pos === 'string' ? pos : pos.ticker
                if (ticker && ticker !== 'Empty' && ticker !== '') {
                  console.log(`${indent}      Adding ticker: ${ticker}`)
                  found.push(ticker)
                }
              }
            }
          }

          // Recursively check children
          if (node.children) {
            console.log(`${indent}  Checking children:`, Object.keys(node.children))
            for (const slot in node.children) {
              const children = node.children[slot as SlotId]
              if (Array.isArray(children)) {
                for (const child of children) {
                  if (child) {
                    found.push(...extractTickersFromTree(child, depth + 1))
                  }
                }
              }
            }
          }

          return found
        }

        tickers.push(...extractTickersFromTree(current))
        console.log('[ForgeTab] Extracted tickers from position nodes:', tickers)
      }

      // Deduplicate tickers
      const uniqueTickers = Array.from(new Set(tickers))

      console.log('[ForgeTab] Rolling optimization tickers:', uniqueTickers)

      // Validate that we have tickers
      if (uniqueTickers.length === 0) {
        alert('Rolling optimization requires at least one ticker.\n\nPlease add:\n1. A ticker list parameter range, OR\n2. Position nodes with tickers in your tree')
        return
      }

      setRollingOptimizationRunning(true)
      setRollingProgress(null)

      // Use POST to initiate, then stream progress via GET with query params
      const params = new URLSearchParams({
        botId: activeBot.id,
        tree: JSON.stringify(current),
        tickers: JSON.stringify(uniqueTickers),
        splitConfig: JSON.stringify(splitConfig),
        parameterRanges: JSON.stringify(rollingParameterRanges)
      })

      const eventSource = new EventSource(`/api/optimization/rolling?${params}`)

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          console.log('[ForgeTab] SSE event:', data)

          if (data.type === 'progress') {
            // Update progress
            setRollingProgress({
              completed: data.completed,
              total: data.total,
              currentPeriod: data.currentPeriod,
              totalPeriods: data.totalPeriods
            })
          } else if (data.type === 'complete') {
            // Optimization complete - fetch full results
            console.log('[ForgeTab] Rolling optimization complete, job ID:', data.jobId)

            // Clean up SSE
            eventSource.close()
            setRollingOptimizationRunning(false)
            setRollingProgress(null)

            // Fetch full results from API
            fetch(`/api/optimization/rolling/${data.jobId}`)
              .then(res => res.json())
              .then(results => {
                console.log('[ForgeTab] Fetched rolling results:', results)

                // Store results
                useBotStore.getState().setRollingResult(activeBot.id, results)

                // Switch to Results tab and Rolling subtab
                setForgeSubtab('Results')
                setResultsSubtab('Rolling')

                // Show success notification
                alert(`Rolling optimization complete!\nJob ID: ${data.jobId}\nValid tickers: ${results.job.validTickers.length}\nBranches tested: ${results.job.branchCount}\nYears: ${results.branches[0]?.isStartYear || '?'} - present\n\nResults are now available in the Results tab.`)
              })
              .catch(error => {
                console.error('[ForgeTab] Failed to fetch rolling results:', error)
                alert(`Rolling optimization completed but failed to load results: ${error.message}`)
              })
          } else if (data.type === 'error') {
            // Error occurred
            console.error('[ForgeTab] Rolling optimization error:', data.error)
            alert(`Rolling optimization failed: ${data.error}`)

            // Clean up
            eventSource.close()
            setRollingOptimizationRunning(false)
            setRollingProgress(null)
          }
        } catch (error) {
          console.error('[ForgeTab] Failed to parse SSE data:', error)
        }
      }

      eventSource.onerror = (error) => {
        console.error('[ForgeTab] SSE error:', error)
        alert('Connection to rolling optimizer lost')
        eventSource.close()
        setRollingOptimizationRunning(false)
        setRollingProgress(null)
      }
    } else {
      // Use existing chronological batch backtest
      console.log('[ForgeTab] Using chronological batch optimization')

      // Get bot name from database if saved, otherwise use fallback
      let botName = 'Unsaved Strategy'
      if (activeBot.savedBotId) {
        try {
          const response = await fetch(`/api/bots/${activeBot.savedBotId}`)
          if (response.ok) {
            const bot = await response.json()
            botName = bot.name || botName
          }
        } catch (error) {
          console.error('Failed to fetch bot name:', error)
        }
      }

      // Filter out ticker_list parameter ranges for chronological optimization
      // (ticker_list ranges are only used for rolling optimization)
      const chronologicalRanges = parameterRanges.filter(r => r.type !== 'ticker_list')
      console.log('[ForgeTab] Filtered parameter ranges for chronological:', chronologicalRanges.length, 'of', parameterRanges.length)

      await runBatchBacktest(current, chronologicalRanges, splitConfig, requirements, activeBot.id, botName, mode, costBps)
    }
  }

  // Handler to load a selected branch
  const handleSelectBranch = (branchId: string) => {
    if (!activeBot || !batchJob) return

    // Find the branch result
    const branchResult = batchJob.results.find(r => r.branchId === branchId)
    if (!branchResult) {
      console.error('Branch result not found:', branchId)
      return
    }

    // Apply the branch combination to the current tree
    const modifiedTree = applyBranchToTree(current, branchResult.combination, activeBot.parameterRanges || [])

    // Push to history
    treeStore.pushTree(modifiedTree)
  }

  return (
    <Card className="h-full flex flex-col overflow-hidden mx-2 my-4">
      <CardContent className="flex-1 flex flex-col gap-4 p-4 pb-8 overflow-auto min-h-0">
        {/* Subtab Navigation */}
        <div className="flex gap-2 shrink-0">
          <Button
            variant={forgeSubtab === 'Builder' ? 'accent' : 'secondary'}
            onClick={() => setForgeSubtab('Builder')}
          >
            Builder
          </Button>
          <Button
            variant={forgeSubtab === 'Ticker Lists' ? 'accent' : 'secondary'}
            onClick={() => setForgeSubtab('Ticker Lists')}
          >
            Ticker Lists
          </Button>
          <Button
            variant={forgeSubtab === 'Results' ? 'accent' : 'secondary'}
            onClick={() => setForgeSubtab('Results')}
          >
            Results
          </Button>
        </div>

        {/* Conditional Content */}
        {forgeSubtab === 'Builder' ? (
          <>
            {/* Top Zone - Settings Panel */}
            <div className="shrink-0 border-b border-border pb-4">
              <SettingsPanel
                splitConfig={activeBot?.splitConfig}
                onSplitConfigChange={(config) => {
                  if (activeBot) {
                    const previousStrategy = activeBot.splitConfig?.strategy
                    useBotStore.getState().setSplitConfig(activeBot.id, config)

                    // Auto-manage tree structure based on strategy change
                    if (config.strategy !== previousStrategy) {
                      // Clear old batch job when switching strategies
                      console.log(`[ForgeTab] Strategy changed from ${previousStrategy} to ${config.strategy} - clearing old batch job`)
                      useBotStore.getState().setBranchGenerationJob(activeBot.id, undefined)

                      if (config.strategy === 'rolling') {
                        // Switch to Rolling: Clear tree and add Rolling node
                        const rollingNode = createNode('rolling')
                        rollingNode.rollingWindow = config.rollingWindowPeriod ?? 'monthly'
                        rollingNode.rankBy = config.rankBy ?? 'Sharpe Ratio'
                        treeStore.setRoot(ensureSlots(rollingNode))
                      } else if (config.strategy === 'chronological') {
                        // Switch to Chronological: Reset to default basic node
                        const basicNode = createNode('basic')
                        treeStore.setRoot(ensureSlots(basicNode))
                      }
                    } else if (config.strategy === 'rolling' && config.rollingWindowPeriod && config.rankBy) {
                      // Same strategy but updated rolling config - sync to existing Rolling nodes
                      const updateRollingNodes = (node: FlowNode): FlowNode => {
                        if (node.kind === 'rolling') {
                          return {
                            ...node,
                            rollingWindow: config.rollingWindowPeriod,
                            rankBy: config.rankBy,
                            children: Object.fromEntries(
                              Object.entries(node.children).map(([slot, arr]) => [
                                slot,
                                arr?.map((c) => (c ? updateRollingNodes(c) : c))
                              ])
                            )
                          }
                        }
                        // Recursively update children
                        const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
                        Object.entries(node.children).forEach(([slot, arr]) => {
                          children[slot as SlotId] = arr?.map((c) => (c ? updateRollingNodes(c) : c))
                        })
                        return { ...node, children }
                      }

                      const updatedTree = updateRollingNodes(current)
                      treeStore.setRoot(updatedTree)
                    }
                  }
                }}
              />
            </div>

            {/* Flowchart Toolbar - Run Forge + Find/Replace + Undo/Redo - Floating above the flowchart zone */}
        <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center px-4 py-2 border border-border rounded-lg shrink-0 z-20 sticky top-0" style={{ backgroundColor: 'color-mix(in srgb, var(--color-muted) 60%, var(--color-card))' }}>
          {/* Left section: Run Forge button OR Branch generation progress */}
          <div className="flex items-center gap-3">
            {(() => {
              // If rolling optimization is running, show progress
              if (rollingOptimizationRunning) {
                const percentage = rollingProgress && rollingProgress.total > 0
                  ? Math.round((rollingProgress.completed / rollingProgress.total) * 100)
                  : 0

                return (
                  <>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center justify-between text-xs font-medium">
                        <span>Rolling Optimization</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-5 overflow-hidden">
                        <div
                          className={`h-full bg-primary flex items-center justify-center text-xs font-medium text-primary-foreground transition-all duration-300 ${!rollingProgress ? 'animate-pulse' : ''}`}
                          style={{ width: rollingProgress ? `${percentage}%` : '100%' }}
                        >
                          {rollingProgress ? `${percentage}%` : 'Starting...'}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {rollingProgress
                          ? `Period ${rollingProgress.currentPeriod} of ${rollingProgress.totalPeriods} • ${rollingProgress.completed} / ${rollingProgress.total} branches tested`
                          : 'Initializing rolling optimization...'}
                      </div>
                    </div>
                  </>
                )
              }

              // If branch generation is running, show progress bar
              if (batchJob && batchJob.status === 'running') {
                const percentage = batchJob.progress.total > 0
                  ? Math.round((batchJob.progress.completed / batchJob.progress.total) * 100)
                  : 0

                return (
                  <>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center justify-between text-xs font-medium">
                        <span>Branch Generation</span>
                        <Button size="sm" variant="ghost" className="h-6 px-2" onClick={cancelJob}>
                          Cancel
                        </Button>
                      </div>
                      <div className="w-full bg-muted rounded-full h-5 overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all duration-300 flex items-center justify-center text-xs font-medium text-primary-foreground"
                          style={{ width: `${percentage}%` }}
                        >
                          {percentage}%
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Generating branches... {batchJob.progress.completed} / {batchJob.progress.total} completed
                      </div>
                    </div>
                  </>
                )
              }

              // Otherwise show Run Forge button
              // Use rolling parameter ranges if strategy is rolling, otherwise use chronological ranges
              const currentSplitConfig = activeBot?.splitConfig || { strategy: 'chronological' as const }
              const isRollingStrategy = currentSplitConfig.strategy === 'rolling'

              // Check if tree has Rolling node
              const hasRollingNodeInTree = (node: FlowNode): boolean => {
                if (node.kind === 'rolling') return true
                if (node.children) {
                  for (const slot in node.children) {
                    const children = node.children[slot as SlotId]
                    if (Array.isArray(children)) {
                      for (const child of children) {
                        if (child && hasRollingNodeInTree(child)) return true
                      }
                    }
                  }
                }
                return false
              }

              // Use separate parameter ranges for rolling vs chronological
              const rangesToUse = isRollingStrategy
                ? (activeBot?.rollingParameterRanges || [])
                : (activeBot?.parameterRanges || [])
              const enabledRanges = rangesToUse.filter(r => r.enabled)

              let branchCount = 1
              for (const range of enabledRanges) {
                if (range.type === 'ticker_list') {
                  // Ticker list: multiply by number of tickers
                  branchCount *= (range.tickers?.length || 1)
                } else {
                  // Numeric range: multiply by number of steps
                  const steps = Math.floor((range.max - range.min) / range.step) + 1
                  branchCount *= steps
                }
              }

              // For rolling: enable if Rolling node exists AND has ranges, for chronological: enable if ranges exist
              const hasRanges = isRollingStrategy
                ? (hasRollingNodeInTree(current) && enabledRanges.length > 0)
                : enabledRanges.length > 0

              const etaMinutes = Math.ceil(branchCount * 0.5 / 60) // Rough estimate: 0.5s per branch

              return (
                <>
                  <Button
                    size="sm"
                    disabled={!hasRanges}
                    onClick={handleGenerateBranches}
                  >
                    Run Forge
                  </Button>
                  {hasRanges && (
                    <span className="text-xs text-muted-foreground">
                      {branchCount} {branchCount === 1 ? 'branch' : 'branches'} (~{etaMinutes} min)
                    </span>
                  )}
                </>
              )
            })()}
          </div>
          {/* Center section: Find/Replace Controls */}
          <div className="flex items-center gap-2">
            <datalist id={USED_TICKERS_DATALIST_ID}>
              {collectUsedTickers(current, includeCallChains ? callChains : undefined).map(t => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Replace</span>
              <button
                className="h-7 w-24 px-2 border border-border rounded bg-card text-xs font-mono hover:bg-muted/50 text-left truncate"
                onClick={() => openTickerModal((ticker) => {
                  setFindTicker(ticker)
                  let instances = findTickerInstances(current, ticker, includePositions, includeIndicators)
                  if (includeCallChains && callChains.length > 0) {
                    callChains.forEach(chain => {
                      try {
                        const chainRoot = typeof chain.root === 'string' ? JSON.parse(chain.root) : chain.root
                        const chainInstances = findTickerInstances(chainRoot, ticker, includePositions, includeIndicators, chain.id)
                        instances = [...instances, ...chainInstances]
                      } catch { /* ignore parse errors */ }
                    })
                  }
                  setFoundInstances(instances)
                  setCurrentInstanceIndex(instances.length > 0 ? 0 : -1)
                  setHighlightedInstance(instances.length > 0 ? instances[0] : null)
                }, collectUsedTickers(current, includeCallChains ? callChains : undefined))}
              >
                {findTicker || 'Ticker'}
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">With</span>
              <button
                className="h-7 w-24 px-2 border border-border rounded bg-card text-xs font-mono hover:bg-muted/50 text-left truncate"
                onClick={() => openTickerModal((ticker) => setReplaceTicker(ticker))}
              >
                {replaceTicker || 'Ticker'}
              </button>
              {findTicker && foundInstances.length > 0 && (
                <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  {foundInstances.length} {foundInstances.length === 1 ? 'instance' : 'instances'}
                </span>
              )}
            </div>
            <label className="flex items-center gap-1 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={includePositions}
                onChange={(e) => {
                  setIncludePositions(e.target.checked)
                  let instances = findTickerInstances(current, findTicker, e.target.checked, includeIndicators)
                  if (includeCallChains && callChains.length > 0) {
                    callChains.forEach(chain => {
                      try {
                        const chainRoot = typeof chain.root === 'string' ? JSON.parse(chain.root) : chain.root
                        instances = [...instances, ...findTickerInstances(chainRoot, findTicker, e.target.checked, includeIndicators, chain.id)]
                      } catch { /* ignore */ }
                    })
                  }
                  setFoundInstances(instances)
                  setCurrentInstanceIndex(instances.length > 0 ? 0 : -1)
                }}
              />
              Trade Tickers
            </label>
            <label className="flex items-center gap-1 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={includeIndicators}
                onChange={(e) => {
                  setIncludeIndicators(e.target.checked)
                  let instances = findTickerInstances(current, findTicker, includePositions, e.target.checked)
                  if (includeCallChains && callChains.length > 0) {
                    callChains.forEach(chain => {
                      try {
                        const chainRoot = typeof chain.root === 'string' ? JSON.parse(chain.root) : chain.root
                        instances = [...instances, ...findTickerInstances(chainRoot, findTicker, includePositions, e.target.checked, chain.id)]
                      } catch { /* ignore */ }
                    })
                  }
                  setFoundInstances(instances)
                  setCurrentInstanceIndex(instances.length > 0 ? 0 : -1)
                }}
              />
              Indicator Tickers
            </label>
            <label className="flex items-center gap-1 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={includeCallChains}
                onChange={(e) => {
                  setIncludeCallChains(e.target.checked)
                  if (e.target.checked && callChains.length > 0) {
                    let instances = findTickerInstances(current, findTicker, includePositions, includeIndicators)
                    callChains.forEach(chain => {
                      try {
                        const chainRoot = typeof chain.root === 'string' ? JSON.parse(chain.root) : chain.root
                        instances = [...instances, ...findTickerInstances(chainRoot, findTicker, includePositions, includeIndicators, chain.id)]
                      } catch { /* ignore */ }
                    })
                    setFoundInstances(instances)
                    setCurrentInstanceIndex(instances.length > 0 ? 0 : -1)
                  } else {
                    const instances = findTickerInstances(current, findTicker, includePositions, includeIndicators)
                    setFoundInstances(instances)
                    setCurrentInstanceIndex(instances.length > 0 ? 0 : -1)
                  }
                }}
              />
              Call Chains
            </label>
            <Button
              variant="secondary"
              size="sm"
              className="active:bg-accent/30"
              disabled={foundInstances.length === 0}
              onClick={() => {
                const newIdx = (currentInstanceIndex - 1 + foundInstances.length) % foundInstances.length
                setCurrentInstanceIndex(newIdx)
                const instance = foundInstances[newIdx]
                setHighlightedInstance(instance)
                const nodeEl = document.querySelector(`[data-node-id="${instance.nodeId}"]`)
                if (nodeEl) nodeEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }}
            >
              ◀ Prev
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="active:bg-accent/30"
              disabled={foundInstances.length === 0}
              onClick={() => {
                const newIdx = (currentInstanceIndex + 1) % foundInstances.length
                setCurrentInstanceIndex(newIdx)
                const instance = foundInstances[newIdx]
                setHighlightedInstance(instance)
                const nodeEl = document.querySelector(`[data-node-id="${instance.nodeId}"]`)
                if (nodeEl) nodeEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }}
            >
              Next ▶
            </Button>
            <Button
              variant="default"
              size="sm"
              className="active:bg-accent/50"
              disabled={!findTicker || !replaceTicker || foundInstances.length === 0}
              onClick={() => {
                const nextRoot = replaceTickerInTree(current, findTicker, replaceTicker, includePositions, includeIndicators)
                push(nextRoot)
                if (includeCallChains && callChains.length > 0) {
                  callChains.forEach(chain => {
                    try {
                      const chainRoot = typeof chain.root === 'string' ? JSON.parse(chain.root) : chain.root
                      const updatedRoot = replaceTickerInTree(chainRoot, findTicker, replaceTicker, includePositions, includeIndicators)
                      fetch(`/api/call-chains/${chain.id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ root: JSON.stringify(updatedRoot) })
                      }).then(() => { if (userId) loadCallChainsFromApi(userId).then(setCallChains) })
                    } catch { /* ignore parse errors */ }
                  })
                }
                setFindTicker('')
                setReplaceTicker('')
                setFoundInstances([])
                setCurrentInstanceIndex(-1)
                setHighlightedInstance(null)
              }}
            >
              Replace{foundInstances.length > 0 ? ` (${foundInstances.length})` : ''}
            </Button>
          </div>
          {/* Right section: Undo/Redo */}
          <div className="flex gap-2 justify-end">
            <Button
              variant="secondary"
              className="px-4 py-2 text-sm font-semibold active:bg-accent/30"
              onClick={undo}
              disabled={!activeBot || activeBot.historyIndex <= 0}
            >
              Undo
            </Button>
            <Button
              variant="secondary"
              className="px-4 py-2 text-sm font-semibold active:bg-accent/30"
              onClick={redo}
              disabled={!activeBot || activeBot.historyIndex >= activeBot.history.length - 1}
            >
              Redo
            </Button>
          </div>
        </div>

        {/* Bottom Row - Flow Tree Builder */}
        <div className="flex gap-4 flex-1">
          {/* Flow Tree Builder */}
          <div className="w-full flex flex-col relative min-h-0 min-w-0 overflow-hidden">
            {/* Flowchart Card */}
            <div className="flex-1 border border-border rounded-lg bg-card min-h-0 relative" style={{ height: 'calc(100vh - 400px)', overflow: 'hidden' }}>
              <div
                ref={flowchartScrollRef}
                style={{
                  width: '100%',
                  height: '100%',
                  padding: '1rem',
                  overflowY: 'auto',
                  overflowX: 'auto',
                }}
                onScroll={(e) => {
                  if (floatingScrollRef.current) {
                    floatingScrollRef.current.scrollLeft = e.currentTarget.scrollLeft
                  }
                  // Update scroll dimensions in store for floating scrollbar
                  const { setFlowchartScrollWidth, setFlowchartClientWidth } = useUIStore.getState()
                  setFlowchartScrollWidth(e.currentTarget.scrollWidth)
                  setFlowchartClientWidth(e.currentTarget.clientWidth)
                }}
              >
                <NodeCard
                  node={current}
                  depth={0}
                  parentId={null}
                  parentSlot={null}
                  myIndex={0}
                  errorNodeIds={backtestErrorNodeIds}
                  focusNodeId={backtestFocusNodeId}
                  tickerOptions={tickerOptions}
                  tickerLists={tickerLists}
                  isForgeMode={true}
                  onAdd={handleAdd}
                  onAppend={handleAppend}
                  onRemoveSlotEntry={handleRemoveSlotEntry}
                  onDelete={handleDelete}
                  onCopy={handleCopy}
                  onPaste={handlePaste}
                  onPasteCallRef={handlePasteCallRef}
                  onRename={handleRename}
                  onWeightChange={handleWeightChange}
                  onUpdateCappedFallback={handleUpdateCappedFallback}
                  onUpdateVolWindow={handleUpdateVolWindow}
                  onColorChange={handleColorChange}
                  onToggleCollapse={handleToggleCollapse}
                  onNumberedQuantifier={handleNumberedQuantifier}
                  onNumberedN={handleNumberedN}
                  onAddNumberedItem={handleAddNumberedItem}
                  onDeleteNumberedItem={handleDeleteNumberedItem}
                  onAddCondition={handleAddCondition}
                  onDeleteCondition={handleDeleteCondition}
                  onFunctionWindow={handleFunctionWindow}
                  onFunctionBottom={handleFunctionBottom}
                  onFunctionMetric={handleFunctionMetric}
                  onFunctionRank={handleFunctionRank}
                  onUpdateCondition={(id, condId, updates, itemId) => {
                    // Set tickerListId field when ticker is a list reference
                    const enhancedUpdates = { ...updates }
                    if (updates.ticker && typeof updates.ticker === 'string' && updates.ticker.startsWith('list:')) {
                      const listId = updates.ticker.substring(5)
                      const tickerList = tickerLists?.find(l => l.id === listId)
                      enhancedUpdates.tickerListId = listId
                      enhancedUpdates.tickerListName = tickerList?.name
                    }
                    if (updates.rightTicker && typeof updates.rightTicker === 'string' && updates.rightTicker.startsWith('list:')) {
                      const listId = updates.rightTicker.substring(5)
                      const tickerList = tickerLists?.find(l => l.id === listId)
                      enhancedUpdates.rightTickerListId = listId
                      enhancedUpdates.rightTickerListName = tickerList?.name
                    }

                    const next = updateConditionFields(current, id, condId, enhancedUpdates, itemId)
                    push(next)

                    // Auto-create parameter ranges for ticker list references
                    if (activeBot && tickerLists) {
                      const handleTickerListRange = (ticker: string | undefined, isRightTicker: boolean) => {
                        if (!ticker) return

                        // Create parameter range ID
                        const paramId = isRightTicker
                          ? `${id}-${condId}-rightTicker-list`
                          : `${id}-${condId}-ticker-list`

                        if (ticker.startsWith('list:')) {
                          // Ticker list selected - create/update parameter range
                          const listId = ticker.substring(5) // Remove 'list:' prefix
                          const tickerList = tickerLists.find(l => l.id === listId)
                          if (!tickerList) return

                          const updatedRanges = [...(activeBot.parameterRanges || [])]
                          const existingIndex = updatedRanges.findIndex(r => r.id === paramId)

                          const parameterRange: ParameterRange = {
                            id: paramId,
                            type: 'ticker_list',
                            nodeId: id,
                            conditionId: condId,
                            path: isRightTicker
                              ? `${id}.conditions.${condId}.rightTicker`
                              : `${id}.conditions.${condId}.ticker`,
                            currentValue: 0, // Not used for ticker lists
                            enabled: true,
                            min: 0,
                            max: 0,
                            step: 1,
                            tickerListId: tickerList.id,
                            tickerListName: tickerList.name,
                            tickers: tickerList.tickers
                          }

                          if (existingIndex !== -1) {
                            updatedRanges[existingIndex] = parameterRange
                          } else {
                            updatedRanges.push(parameterRange)
                          }

                          botStore.setParameterRanges(activeBot.id, updatedRanges)
                        } else {
                          // Regular ticker selected - remove ticker list parameter range if it exists
                          const updatedRanges = (activeBot.parameterRanges || []).filter(r => r.id !== paramId)
                          if (updatedRanges.length !== (activeBot.parameterRanges || []).length) {
                            botStore.setParameterRanges(activeBot.id, updatedRanges)
                          }
                        }
                      }

                      // Check both ticker and rightTicker
                      if (updates.ticker !== undefined) {
                        handleTickerListRange(updates.ticker as string, false)
                      }
                      if (updates.rightTicker !== undefined) {
                        handleTickerListRange(updates.rightTicker as string, true)
                      }
                    }
                  }}
                  onAddPosition={handleAddPos}
                  onRemovePosition={handleRemovePos}
                  onChoosePosition={handleChoosePos}
                  onUpdatePositionMode={handleUpdatePositionMode}
                  openTickerModal={openTickerModal}
                  clipboard={clipboard}
                  copiedNodeId={copiedNodeId}
                  copiedCallChainId={copiedCallChainId}
                  callChains={callChains}
                  onUpdateCallRef={handleUpdateCallRef}
                  onAddEntryCondition={handleAddEntryCondition}
                  onAddExitCondition={handleAddExitCondition}
                  onDeleteEntryCondition={handleDeleteEntryCondition}
                  onDeleteExitCondition={handleDeleteExitCondition}
                  onUpdateEntryCondition={handleUpdateEntryCondition}
                  onUpdateExitCondition={handleUpdateExitCondition}
                  onUpdateScaling={handleUpdateScaling}
                  onUpdateRolling={handleUpdateRolling}
                  onExpandAllBelow={(id, currentlyCollapsed) => {
                    const next = setCollapsedBelow(current, id, !currentlyCollapsed)
                    push(next)
                  }}
                  highlightedInstance={highlightedInstance}
                  enabledOverlays={enabledOverlays}
                  onToggleOverlay={handleToggleOverlay}
                  parameterRanges={parameterRanges}
                  onUpdateRange={handleFlowchartRangeUpdate}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Horizontal scrollbar for flowchart - fixed at bottom, same width as flowchart */}
        {flowchartRect.width > 0 && (
          <div
            ref={floatingScrollRef}
            style={{
              position: 'fixed',
              bottom: 0,
              left: flowchartRect.left,
              width: flowchartRect.width,
              height: '16px',
              overflowX: 'scroll',
              overflowY: 'hidden',
              backgroundColor: 'var(--color-card)',
              borderTop: '1px solid var(--color-border)',
              zIndex: 50,
            }}
            onScroll={(e) => {
              const scrollContainer = flowchartScrollRef.current
              if (scrollContainer) {
                scrollContainer.scrollLeft = e.currentTarget.scrollLeft
              }
            }}
          >
            <div style={{ width: flowchartScrollWidth > 0 ? flowchartScrollWidth : 1, height: '1px' }} />
          </div>
        )}
          </>
        ) : forgeSubtab === 'Ticker Lists' ? (
          <TickerListsPanel />
        ) : (
          <>
            {/* Results Sub-Subtabs */}
            <div className="flex gap-2 shrink-0">
              <Button
                variant={resultsSubtab === 'Chronological' ? 'accent' : 'secondary'}
                onClick={() => setResultsSubtab('Chronological')}
              >
                Chronological
              </Button>
              <Button
                variant={resultsSubtab === 'Rolling' ? 'accent' : 'secondary'}
                onClick={() => setResultsSubtab('Rolling')}
              >
                Rolling
              </Button>
            </div>

            {/* Results Content */}
            {resultsSubtab === 'Chronological' ? (
              <OptimizationResultsPanel />
            ) : (
              <RollingResultsSection
                result={activeBot?.rollingResult ?? null}
                onClose={() => {
                  // Clear the rolling result when closed
                  if (activeBot) {
                    useBotStore.getState().setRollingResult(activeBot.id, undefined)
                  }
                }}
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

export default ForgeTab
