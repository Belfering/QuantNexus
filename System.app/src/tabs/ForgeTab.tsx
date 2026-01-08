// src/tabs/ForgeTab.tsx
// Forge tab component - lazy loadable wrapper for flowchart builder

import { type RefObject, useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { USED_TICKERS_DATALIST_ID } from '@/constants'
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
import { useTreeSync, useTreeUndo } from '@/hooks'

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
    treeStore.choosePosition(id, index, choice)
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
  }
  const handleUpdateExitCondition = (id: string, condId: string, updates: Partial<ConditionLine>) => {
    treeStore.updateExitCondition(id, condId, updates as Parameters<typeof treeStore.updateExitCondition>[2])
  }
  const handleUpdateScaling = (id: string, updates: Record<string, unknown>) => {
    treeStore.updateScaling(id, updates as Parameters<typeof treeStore.updateScaling>[1])
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

    const updatedRanges = [...parameterRanges]

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

    botStore.setParameterRanges(activeBot.id, updatedRanges)
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

  return (
    <Card className="h-full flex flex-col overflow-hidden mx-2 my-4">
      <CardContent className="flex-1 flex flex-col gap-4 p-4 pb-8 overflow-auto min-h-0">
        {/* Top Zone - Settings Panel */}
        <div className="shrink-0 border-b border-border pb-4">
          <SettingsPanel />
        </div>

        {/* Flowchart Toolbar - ETFs Only + Find/Replace + Undo/Redo - Floating above the flowchart zone */}
        <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center px-4 py-2 border border-border rounded-lg shrink-0 z-20 sticky top-0" style={{ backgroundColor: 'color-mix(in srgb, var(--color-muted) 60%, var(--color-card))' }}>
          {/* Left section: ETFs Only checkbox + ticker count */}
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={etfsOnlyMode}
                onChange={(e) => setEtfsOnlyMode(e.target.checked)}
                className="w-4 h-4 rounded border-border cursor-pointer"
              />
              <span className="text-sm font-semibold">ETFs Only</span>
            </label>
            <span className="text-xs text-muted-foreground">
              {etfsOnlyMode
                ? `Showing ${tickerOptions.length} ETFs`
                : `Showing all ${tickerOptions.length} tickers`}
            </span>
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

        {/* Bottom Row - 2 Zones Side by Side */}
        <div className="flex gap-4 flex-1">
          {/* Bottom Left Zone - Parameters Panel */}
          <div className="w-1/2">
            <Card className="h-full overflow-hidden" style={{ height: 'calc(100vh - 300px)' }}>
              <div className="p-4 h-full overflow-y-auto">
                <ParameterBoxPanel
                  root={current}
                  onUpdate={handleParameterUpdate}
                  onHierarchicalUpdate={handleHierarchicalParameterUpdate}
                  parameterRanges={parameterRanges}
                  onUpdateRanges={(ranges) => {
                    if (activeBot) {
                      botStore.setParameterRanges(activeBot.id, ranges)
                    }
                  }}
                  openTickerModal={openTickerModal}
                />
              </div>
            </Card>
          </div>

          {/* Bottom Right Zone - Flow Tree Builder */}
          <div className="w-1/2 flex flex-col relative min-h-0 min-w-0 overflow-hidden">
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
                    const next = updateConditionFields(current, id, condId, updates, itemId)
                    push(next)
                  }}
                  onAddPosition={handleAddPos}
                  onRemovePosition={handleRemovePos}
                  onChoosePosition={handleChoosePos}
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
      </CardContent>
    </Card>
  )
}

export default ForgeTab
