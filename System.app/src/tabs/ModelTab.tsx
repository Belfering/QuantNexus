// src/tabs/ModelTab.tsx
// Model tab component - lazy loadable wrapper for flowchart builder

import { type RefObject, useState, useMemo, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { USED_TICKERS_DATALIST_ID, KNOWN_VARIABLES, VARIABLE_CATEGORIES } from '@/constants'
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
  CustomIndicator,
  Watchlist,
  SavedBot,
  UserId,
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
  updateMinCap,
  updateMaxCap,
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
import { BacktesterPanel, parseFormula, ROLLING_FUNCTIONS } from '@/features/backtest'
import { loadCallChainsFromApi } from '@/features/auth'
import { newId } from '@/features/builder'
import { useAuthStore, useUIStore, useBotStore, useBacktestStore, useTreeStore } from '@/stores'
import { useTreeSync, useTreeUndo, useWatchlistCallbacks } from '@/hooks'

export interface ModelTabProps {
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

  // Watchlist props (for save to watchlist)
  watchlists: Watchlist[]
  savedBots: SavedBot[]
  setWatchlists: (updater: (prev: Watchlist[]) => Watchlist[]) => void
  setSavedBots: (updater: (prev: SavedBot[]) => SavedBot[]) => void
  tickerMetadata: Map<string, { assetType?: string; name?: string }>
  callChainsById: Map<string, CallChain>

  // Backtest visual state
  backtestErrorNodeIds: Set<string>
  backtestFocusNodeId: string | null

  // Scroll refs for floating scrollbar sync
  flowchartScrollRef: RefObject<HTMLDivElement | null>
  floatingScrollRef: RefObject<HTMLDivElement | null>
}

export function ModelTab({
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
  // Watchlist props
  watchlists,
  savedBots,
  setWatchlists,
  setSavedBots,
  tickerMetadata,
  callChainsById,
  // Backtest visual state
  backtestErrorNodeIds,
  backtestFocusNodeId,
  // Refs
  flowchartScrollRef,
  floatingScrollRef,
}: ModelTabProps) {
  // --- Tree state from useTreeStore (Phase 2N-15c) ---
  // Use Model-specific tree sync to keep independent from Forge tab
  const current = useTreeSync('Model', 'root')
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
  const handleUpdateMinCap = (id: string, value: number, branch?: 'then' | 'else') => {
    treeStore.updateMinCap(id, value, branch)
  }
  const handleUpdateMaxCap = (id: string, value: number, branch?: 'then' | 'else') => {
    treeStore.updateMaxCap(id, value, branch)
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

  // Recalculate scroll dimensions when sidebar collapse states change
  useEffect(() => {
    const timer = setTimeout(() => {
      if (flowchartScrollRef.current) {
        const { setFlowchartScrollWidth, setFlowchartClientWidth } = useUIStore.getState()
        setFlowchartScrollWidth(flowchartScrollRef.current.scrollWidth)
        setFlowchartClientWidth(flowchartScrollRef.current.clientWidth)
      }
    }, 100) // Small delay to let CSS transitions complete
    return () => clearTimeout(timer)
  }, [callbackNodesCollapsed, customIndicatorsCollapsed, flowchartScrollRef])

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

  // UI Store - save menu
  const saveMenuOpen = useUIStore(s => s.saveMenuOpen)
  const setSaveMenuOpen = useUIStore(s => s.setSaveMenuOpen)
  const saveNewWatchlistName = useUIStore(s => s.saveNewWatchlistName)
  const setSaveNewWatchlistName = useUIStore(s => s.setSaveNewWatchlistName)
  const justSavedFeedback = useUIStore(s => s.justSavedFeedback)
  const setJustSavedFeedback = useUIStore(s => s.setJustSavedFeedback)

  // Admin access (hardcoded for local development, same as App.tsx)
  const isAdmin = true

  // Helper for activeSavedBotId (used by watchlist hook)
  const activeBotId = activeBot?.id ?? null
  const activeSavedBotId = activeBot?.savedBotId

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

  // Watchlist callbacks hook
  const {
    handleSaveToWatchlist,
  } = useWatchlistCallbacks({
    userId,
    isAdmin,
    savedBots,
    setSavedBots,
    watchlists,
    setWatchlists,
    current,
    activeBotId,
    activeSavedBotId,
    activeBot,
    tabContext: 'Model',
    bots: [], // ModelTab doesn't use bots state
    setBots: () => {}, // No-op
    setAnalyzeBacktests: () => {}, // No-op
    setSaveMenuOpen,
    setSaveNewWatchlistName,
    setJustSavedFeedback,
    callChainsById,
    tickerMetadata,
    backtestMode,
    backtestCostBps,
  })

  // Close save menu when clicking outside
  useEffect(() => {
    if (!saveMenuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      // Don't close if clicking inside the save menu dropdown
      if (target.closest('.save-watchlist-dropdown')) return
      setSaveMenuOpen(false)
    }
    // Use timeout to avoid closing on the same click that opened it
    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleClickOutside)
    }, 0)
    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('click', handleClickOutside)
    }
  }, [saveMenuOpen, setSaveMenuOpen])

  // Custom Indicators state (FRD-035)
  const [newIndicatorName, setNewIndicatorName] = useState('')
  const [newIndicatorFormula, setNewIndicatorFormula] = useState('')
  const [showVariableRef, setShowVariableRef] = useState(false)

  // Floating scrollbar position tracking
  const [flowchartRect, setFlowchartRect] = useState({ left: 0, width: 0 })

  // Get customIndicators from activeBot
  const customIndicators = activeBot?.customIndicators || []

  // Validate formula in real-time
  const formulaValidation = useMemo(() => {
    if (!newIndicatorFormula.trim()) {
      return { valid: true, errors: [], variables: [], functions: [] }
    }
    return parseFormula(newIndicatorFormula, KNOWN_VARIABLES)
  }, [newIndicatorFormula])

  // Add new custom indicator
  const handleAddCustomIndicator = () => {
    if (!newIndicatorName.trim() || !newIndicatorFormula.trim()) return
    if (!formulaValidation.valid) return
    if (!activeBot) return

    const newIndicator: CustomIndicator = {
      id: `ci_${newId()}`,
      name: newIndicatorName.trim(),
      formula: newIndicatorFormula.trim(),
      createdAt: Date.now(),
    }

    // Update the bot's custom indicators
    const { updateBot } = useBotStore.getState()
    updateBot(activeBot.id, {
      customIndicators: [...customIndicators, newIndicator],
    })

    // Clear form
    setNewIndicatorName('')
    setNewIndicatorFormula('')
  }

  // Delete custom indicator
  const handleDeleteCustomIndicator = (id: string) => {
    if (!activeBot) return
    const { updateBot } = useBotStore.getState()
    updateBot(activeBot.id, {
      customIndicators: customIndicators.filter(ci => ci.id !== id),
    })
  }

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
        {/* Top Zone - Backtester */}
        <div className="shrink-0 border-b border-border pb-4">
          <BacktesterPanel
            mode={backtestMode}
            setMode={setBacktestMode}
            costBps={backtestCostBps}
            setCostBps={setBacktestCostBps}
            benchmark={backtestBenchmark}
            setBenchmark={setBacktestBenchmark}
            showBenchmark={backtestShowBenchmark}
            setShowBenchmark={setBacktestShowBenchmark}
            tickerOptions={tickerOptions}
            status={backtestStatus}
            result={backtestResult}
            errors={backtestErrors}
            onRun={handleRunBacktest}
            onJumpToError={handleJumpToBacktestError}
            indicatorOverlays={indicatorOverlayData}
            theme={theme}
            benchmarkMetrics={benchmarkMetrics}
            onFetchBenchmarks={fetchBenchmarkMetrics}
            modelSanityReport={modelSanityReport}
            onFetchRobustness={runModelRobustness}
            onUndo={undo}
            onRedo={redo}
            canUndo={activeBot ? activeBot.historyIndex > 0 : false}
            canRedo={activeBot ? activeBot.historyIndex < activeBot.history.length - 1 : false}
            openTickerModal={openTickerModal}
            tabContext="Model"
          />
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
          {/* Right section: Save to Watchlist + Undo/Redo */}
          <div className="flex gap-2 justify-end overflow-visible">
            <div className="relative overflow-visible">
              <Button
                onClick={() => setSaveMenuOpen(!saveMenuOpen)}
                title="Save this system to a watchlist"
                variant={justSavedFeedback ? 'accent' : 'secondary'}
                className={`px-4 py-2 text-sm font-semibold ${justSavedFeedback ? 'transition-colors duration-300' : ''}`}
              >
                {justSavedFeedback ? '✓ Saved!' : 'Save to Watchlist'}
              </Button>
              {saveMenuOpen ? (
                <Card
                  className="save-watchlist-dropdown absolute top-full right-0 z-[200] min-w-60 p-1.5 mt-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex flex-col gap-1">
                    {watchlists.map((w) => (
                      <Button
                        key={w.id}
                        variant="ghost"
                        className="justify-start"
                        onClick={() => handleSaveToWatchlist(w.id)}
                      >
                        {w.name}
                      </Button>
                    ))}
                    {watchlists.length === 0 && (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        No watchlists yet
                      </div>
                    )}
                    <div className="h-px bg-border my-1" />
                    <div className="flex gap-1 px-1">
                      <Input
                        placeholder="New watchlist name"
                        value={saveNewWatchlistName}
                        onChange={(e) => setSaveNewWatchlistName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && saveNewWatchlistName.trim()) {
                            handleSaveToWatchlist(saveNewWatchlistName.trim())
                          }
                        }}
                        className="h-8 text-sm"
                      />
                      <Button
                        size="sm"
                        onClick={() => {
                          if (saveNewWatchlistName.trim()) {
                            handleSaveToWatchlist(saveNewWatchlistName.trim())
                          }
                        }}
                        disabled={!saveNewWatchlistName.trim()}
                      >
                        Create
                      </Button>
                    </div>
                  </div>
                </Card>
              ) : null}
            </div>
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
          {/* Bottom Left Zone - Sticky Labels + Content */}
          <div className={`flex items-start transition-all ${callbackNodesCollapsed && customIndicatorsCollapsed ? '' : 'w-1/2'}`}>
            {/* Left Side - Labels and Buttons (sticky below ETF toolbar, stops above scrollbar) */}
            <div className="flex flex-col w-auto border border-border rounded-l-lg sticky top-[52px] z-10" style={{ height: 'calc(100vh - 300px)', backgroundColor: 'color-mix(in srgb, var(--color-muted) 40%, var(--color-card))' }}>
              {/* Callback Nodes Label/Button Zone - takes 50% */}
              <div className="flex-1 flex flex-col items-center justify-center border-b border-border">
                <button
                  onClick={() => setCallbackNodesCollapsed(!callbackNodesCollapsed)}
                  className={`px-2 py-2 transition-colors rounded active:bg-accent/30 ${!callbackNodesCollapsed ? 'bg-accent/20' : 'hover:bg-accent/10'}`}
                  title={callbackNodesCollapsed ? 'Expand' : 'Collapse'}
                >
                  <div className="text-xs font-bold" style={{ writingMode: 'vertical-lr', textOrientation: 'mixed', transform: 'rotate(180deg)' }}>
                    {callbackNodesCollapsed ? 'Expand' : 'Collapse'}
                  </div>
                </button>
                <div className="px-2 py-2">
                  <div className="font-black text-lg tracking-wide" style={{ writingMode: 'vertical-lr', textOrientation: 'mixed', transform: 'rotate(180deg)' }}>
                    Callback Nodes
                  </div>
                </div>
              </div>

              {/* Custom Indicators Label/Button Zone - takes 50% */}
              <div className="flex-1 flex flex-col items-center justify-center">
                <button
                  onClick={() => setCustomIndicatorsCollapsed(!customIndicatorsCollapsed)}
                  className={`px-2 py-2 transition-colors rounded active:bg-accent/30 ${!customIndicatorsCollapsed ? 'bg-accent/20' : 'hover:bg-accent/10'}`}
                  title={customIndicatorsCollapsed ? 'Expand' : 'Collapse'}
                >
                  <div className="text-xs font-bold" style={{ writingMode: 'vertical-lr', textOrientation: 'mixed', transform: 'rotate(180deg)' }}>
                    {customIndicatorsCollapsed ? 'Expand' : 'Collapse'}
                  </div>
                </button>
                <div className="px-2 py-2">
                  <div className="font-black text-lg tracking-wide" style={{ writingMode: 'vertical-lr', textOrientation: 'mixed', transform: 'rotate(180deg)' }}>
                    Custom Indicators
                  </div>
                </div>
              </div>
            </div>

            {/* Right Side - Content Area (dynamic based on expanded state) */}
            <div
              className={`grid overflow-hidden border border-l-0 border-border rounded-r-lg sticky top-[52px] z-10 ${callbackNodesCollapsed && customIndicatorsCollapsed ? '' : 'flex-1'}`}
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-muted) 40%, var(--color-card))',
                gridTemplateRows:
                  callbackNodesCollapsed && customIndicatorsCollapsed ? '0fr 0fr' :
                  callbackNodesCollapsed && !customIndicatorsCollapsed ? '0fr 1fr' :
                  !callbackNodesCollapsed && customIndicatorsCollapsed ? '1fr 0fr' :
                  '1fr 1fr',
                height: 'calc(100vh - 300px)',
                width: callbackNodesCollapsed && customIndicatorsCollapsed ? '0' : undefined
              }}
            >
              {/* Callback Nodes Content */}
              <div className={`overflow-auto min-h-0 ${!callbackNodesCollapsed ? 'p-4 border-b border-border' : ''}`}>
                <div className="flex gap-2 mb-4">
                  <Button onClick={handleAddCallChain}>Make new Call</Button>
                </div>
                <div className="grid gap-2.5">
              {callChains.length === 0 ? (
                <div className="text-muted">No call chains yet.</div>
              ) : (
                callChains.map((c) => (
                  <Card key={c.id}>
                    <div className="flex gap-2 items-center">
                      <Input value={c.name} onChange={(e) => handleRenameCallChain(c.id, e.target.value)} className="flex-1" />
                      <Button
                        variant="ghost"
                        size="sm"
                        className={`active:bg-accent/30 ${!c.collapsed ? 'bg-accent/20' : ''}`}
                        onClick={() => handleToggleCallChainCollapse(c.id)}
                      >
                        {c.collapsed ? 'Expand' : 'Collapse'}
                      </Button>
                      <Button
                        variant={copiedCallChainId === c.id ? 'accent' : 'ghost'}
                        size="sm"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(c.id)
                            setCopiedCallChainId(c.id)
                          } catch {
                            // ignore
                          }
                        }}
                        title={copiedCallChainId === c.id ? 'Call ID copied!' : 'Copy call ID'}
                      >
                        {copiedCallChainId === c.id ? 'Copied!' : 'Copy ID'}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          if (!confirm(`Delete call chain "${c.name}"?`)) return
                          handleDeleteCallChain(c.id)
                        }}
                        title="Delete call chain"
                      >
                        X
                      </Button>
                    </div>
                    <div className="text-xs text-muted mt-1.5">ID: {c.id}</div>
                    {!c.collapsed ? (
                      <div className="mt-2.5">
                        <NodeCard
                          node={c.root}
                          depth={0}
                          parentId={null}
                          parentSlot={null}
                          myIndex={0}
                          tickerOptions={tickerOptions}
                          onAdd={(parentId, slot, index, kind) => {
                            const next = insertAtSlot(c.root, parentId, slot, index, ensureSlots(createNode(kind)))
                            pushCallChain(c.id, next)
                          }}
                          onAppend={(parentId, slot) => {
                            const next = appendPlaceholder(c.root, parentId, slot)
                            pushCallChain(c.id, next)
                          }}
                          onRemoveSlotEntry={(parentId, slot, index) => {
                            const next = removeSlotEntry(c.root, parentId, slot, index)
                            pushCallChain(c.id, next)
                          }}
                          onDelete={(id) => {
                            const next = deleteNode(c.root, id)
                            pushCallChain(c.id, next)
                          }}
                          onCopy={(id) => {
                            const found = findNode(c.root, id)
                            if (!found) return
                            setClipboard(cloneNode(found))
                          }}
                          onPaste={(parentId, slot, index, child) => {
                            // Use single-pass clone + normalize for better performance
                            const next = insertAtSlot(c.root, parentId, slot, index, cloneAndNormalize(child))
                            pushCallChain(c.id, next)
                          }}
                          onPasteCallRef={(parentId, slot, index, callChainId) => {
                            const callNode = createNode('call')
                            callNode.callRefId = callChainId
                            const next = insertAtSlot(c.root, parentId, slot, index, ensureSlots(callNode))
                            pushCallChain(c.id, next)
                          }}
                          onRename={(id, title) => {
                            const next = updateTitle(c.root, id, title)
                            pushCallChain(c.id, next)
                          }}
                          onWeightChange={(id, weight, branch) => {
                            const next = updateWeight(c.root, id, weight, branch)
                            pushCallChain(c.id, next)
                          }}
                          onUpdateCappedFallback={(id, choice, branch) => {
                            const next = updateCappedFallback(c.root, id, choice, branch)
                            pushCallChain(c.id, next)
                          }}
                          onUpdateVolWindow={(id, days, branch) => {
                            const next = updateVolWindow(c.root, id, days, branch)
                            pushCallChain(c.id, next)
                          }}
                          onColorChange={(id, color) => {
                            const next = updateColor(c.root, id, color)
                            pushCallChain(c.id, next)
                          }}
                          onToggleCollapse={(id, collapsed) => {
                            const next = updateCollapse(c.root, id, collapsed)
                            pushCallChain(c.id, next)
                          }}
                          onNumberedQuantifier={(id, quantifier) => {
                            const next = updateNumberedQuantifier(c.root, id, quantifier)
                            pushCallChain(c.id, next)
                          }}
                          onNumberedN={(id, n) => {
                            const next = updateNumberedN(c.root, id, n)
                            pushCallChain(c.id, next)
                          }}
                          onAddNumberedItem={(id) => {
                            const next = addNumberedItem(c.root, id)
                            pushCallChain(c.id, next)
                          }}
                          onDeleteNumberedItem={(id, itemId) => {
                            const next = deleteNumberedItem(c.root, id, itemId)
                            pushCallChain(c.id, next)
                          }}
                          onAddCondition={(id, type, itemId) => {
                            const next = addConditionLine(c.root, id, type, itemId)
                            pushCallChain(c.id, next)
                          }}
                          onDeleteCondition={(id, condId, itemId) => {
                            const next = deleteConditionLine(c.root, id, condId, itemId)
                            pushCallChain(c.id, next)
                          }}
                          onFunctionWindow={(id, value) => {
                            const next = updateFunctionWindow(c.root, id, value)
                            pushCallChain(c.id, next)
                          }}
                          onFunctionBottom={(id, value) => {
                            const next = updateFunctionBottom(c.root, id, value)
                            pushCallChain(c.id, next)
                          }}
                          onFunctionMetric={(id, metric) => {
                            const next = updateFunctionMetric(c.root, id, metric)
                            pushCallChain(c.id, next)
                          }}
                          onFunctionRank={(id, rank) => {
                            const next = updateFunctionRank(c.root, id, rank)
                            pushCallChain(c.id, next)
                          }}
                          onUpdateCondition={(id, condId, updates, itemId) => {
                            const next = updateConditionFields(c.root, id, condId, updates, itemId)
                            pushCallChain(c.id, next)
                          }}
                          onAddPosition={(id) => {
                            const next = addPositionRow(c.root, id)
                            pushCallChain(c.id, next)
                          }}
                          onRemovePosition={(id, index) => {
                            const next = removePositionRow(c.root, id, index)
                            pushCallChain(c.id, next)
                          }}
                          onChoosePosition={(id, index, choice) => {
                            const next = choosePosition(c.root, id, index, choice)
                            pushCallChain(c.id, next)
                          }}
                          clipboard={clipboard}
                          copiedNodeId={copiedNodeId}
                          copiedCallChainId={copiedCallChainId}
                          callChains={callChains}
                          onUpdateCallRef={(id, callId) => {
                            const next = updateCallReference(c.root, id, callId)
                            pushCallChain(c.id, next)
                          }}
                          onAddEntryCondition={(id, type) => {
                            const next = addEntryCondition(c.root, id, type)
                            pushCallChain(c.id, next)
                          }}
                          onAddExitCondition={(id, type) => {
                            const next = addExitCondition(c.root, id, type)
                            pushCallChain(c.id, next)
                          }}
                          onDeleteEntryCondition={(id, condId) => {
                            const next = deleteEntryCondition(c.root, id, condId)
                            pushCallChain(c.id, next)
                          }}
                          onDeleteExitCondition={(id, condId) => {
                            const next = deleteExitCondition(c.root, id, condId)
                            pushCallChain(c.id, next)
                          }}
                          onUpdateEntryCondition={(id, condId, updates) => {
                            const next = updateEntryConditionFields(c.root, id, condId, updates)
                            pushCallChain(c.id, next)
                          }}
                          onUpdateExitCondition={(id, condId, updates) => {
                            const next = updateExitConditionFields(c.root, id, condId, updates)
                            pushCallChain(c.id, next)
                          }}
                          onUpdateScaling={(id, updates) => {
                            const next = updateScalingFields(c.root, id, updates)
                            pushCallChain(c.id, next)
                          }}
                          onExpandAllBelow={(id, currentlyCollapsed) => {
                            const next = setCollapsedBelow(c.root, id, !currentlyCollapsed)
                            pushCallChain(c.id, next)
                          }}
                          highlightedInstance={highlightedInstance}
                          enabledOverlays={enabledOverlays}
                          onToggleOverlay={handleToggleOverlay}
                        />
                      </div>
                    ) : null}
                  </Card>
                ))
              )}
                </div>
              </div>

              {/* Custom Indicators Content */}
              <div className={`overflow-auto min-h-0 ${!customIndicatorsCollapsed ? 'p-4' : ''}`}>
                  {/* Create New Indicator Form */}
                  <div className="space-y-3 mb-4 p-3 border border-border rounded-lg bg-card">
                    <div className="flex gap-2">
                      <Input
                        placeholder="Indicator Name"
                        value={newIndicatorName}
                        onChange={(e) => setNewIndicatorName(e.target.value)}
                        className="flex-1"
                      />
                      <Button
                        onClick={handleAddCustomIndicator}
                        disabled={!newIndicatorName.trim() || !newIndicatorFormula.trim() || !formulaValidation.valid}
                      >
                        Create
                      </Button>
                    </div>
                    <div className="relative">
                      <Input
                        placeholder="Formula: e.g., rsi / 100 or sma(close, 20) / close"
                        value={newIndicatorFormula}
                        onChange={(e) => setNewIndicatorFormula(e.target.value)}
                        className={`font-mono text-sm ${newIndicatorFormula && !formulaValidation.valid ? 'border-red-500' : ''}`}
                      />
                      {newIndicatorFormula && !formulaValidation.valid && (
                        <div className="text-xs text-red-500 mt-1">
                          {formulaValidation.errors.join(', ')}
                        </div>
                      )}
                      {newIndicatorFormula && formulaValidation.valid && formulaValidation.variables.length > 0 && (
                        <div className="text-xs text-green-600 mt-1">
                          Variables: {formulaValidation.variables.join(', ')}
                          {formulaValidation.functions.length > 0 && ` | Functions: ${formulaValidation.functions.join(', ')}`}
                        </div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowVariableRef(!showVariableRef)}
                      className="text-xs"
                    >
                      {showVariableRef ? '▲ Hide' : '▼ Show'} Variable Reference
                    </Button>
                    {showVariableRef && (
                      <div className="text-xs bg-muted/50 p-2 rounded max-h-48 overflow-y-auto">
                        <div className="font-semibold mb-1">Functions:</div>
                        <div className="text-muted mb-2">
                          Math: {['abs', 'sqrt', 'log', 'exp', 'sign', 'floor', 'ceil', 'round'].join(', ')}<br />
                          Rolling: {ROLLING_FUNCTIONS.map(f => `${f}(var, N)`).join(', ')}<br />
                          Binary: min(a, b), max(a, b), pow(a, b)
                        </div>
                        <div className="font-semibold mb-1">Variables by Category:</div>
                        {Object.entries(VARIABLE_CATEGORIES).map(([cat, vars]) => (
                          <div key={cat} className="mb-1">
                            <span className="font-medium">{cat}:</span>{' '}
                            <span className="text-muted">{vars.join(', ')}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* List of Custom Indicators */}
                  <div className="space-y-2">
                    {customIndicators.length === 0 ? (
                      <div className="text-muted text-sm text-center py-4">
                        No custom indicators yet. Create one above!
                      </div>
                    ) : (
                      customIndicators.map((ci) => (
                        <div key={ci.id} className="flex items-center justify-between p-2 border border-border rounded-lg bg-card">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{ci.name}</div>
                            <div className="text-xs text-muted font-mono truncate">{ci.formula}</div>
                            <div className="text-xs text-muted">ID: {ci.id}</div>
                          </div>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => {
                              if (confirm(`Delete custom indicator "${ci.name}"?`)) {
                                handleDeleteCustomIndicator(ci.id)
                              }
                            }}
                          >
                            X
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
              </div>
            </div>
          </div>

          {/* Bottom Right Zone - Flow Tree Builder */}
          <div className={`flex flex-col transition-all relative min-h-0 min-w-0 overflow-hidden ${callbackNodesCollapsed && customIndicatorsCollapsed ? 'flex-1' : 'w-1/2'}`}>
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
                  onUpdateMinCap={handleUpdateMinCap}
                  onUpdateMaxCap={handleUpdateMaxCap}
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

export default ModelTab
