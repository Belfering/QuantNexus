// src/tabs/ModelTab.tsx
// Model tab component - lazy loadable wrapper for flowchart builder

import { type RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { BacktesterPanel } from '@/features/backtest'
import { loadCallChainsFromApi } from '@/features/auth'
import { useAuthStore, useUIStore, useBotStore, useBacktestStore } from '@/stores'

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
  undo: () => void
  redo: () => void
  activeBot: BotSession | undefined

  // Call chain props (from App.tsx - per-bot state)
  callChains: CallChain[]
  setCallChains: (chains: CallChain[]) => void
  handleAddCallChain: () => void
  handleRenameCallChain: (id: string, name: string) => void
  handleToggleCallChainCollapse: (id: string) => void
  handleDeleteCallChain: (id: string) => void
  pushCallChain: (id: string, newRoot: FlowNode) => void

  // Main flowchart (from App.tsx - derived or callback)
  current: FlowNode
  push: (node: FlowNode) => void
  backtestErrorNodeIds: Set<string>
  backtestFocusNodeId: string | null
  handleAdd: (parentId: string, slot: SlotId, index: number, kind: BlockKind) => void
  handleAppend: (parentId: string, slot: SlotId) => void
  handleRemoveSlotEntry: (parentId: string, slot: SlotId, index: number) => void
  handleDelete: (id: string) => void
  handleCopy: (id: string) => void
  handlePaste: (parentId: string, slot: SlotId, index: number, child: FlowNode) => void
  handlePasteCallRef: (parentId: string, slot: SlotId, index: number, callChainId: string) => void
  handleRename: (id: string, title: string) => void
  handleWeightChange: (id: string, weight: WeightMode, branch?: 'then' | 'else') => void
  handleUpdateCappedFallback: (id: string, choice: PositionChoice, branch?: 'then' | 'else') => void
  handleUpdateVolWindow: (id: string, days: number, branch?: 'then' | 'else') => void
  handleColorChange: (id: string, color?: string) => void
  handleToggleCollapse: (id: string, collapsed: boolean) => void
  handleNumberedQuantifier: (id: string, quantifier: NumberedQuantifier) => void
  handleNumberedN: (id: string, n: number) => void
  handleAddNumberedItem: (id: string) => void
  handleDeleteNumberedItem: (id: string, itemId: string) => void
  handleAddCondition: (id: string, type: 'and' | 'or', itemId?: string) => void
  handleDeleteCondition: (id: string, condId: string, itemId?: string) => void
  handleFunctionWindow: (id: string, value: number) => void
  handleFunctionBottom: (id: string, value: number) => void
  handleFunctionMetric: (id: string, metric: MetricChoice) => void
  handleFunctionRank: (id: string, rank: RankChoice) => void
  handleAddPos: (id: string) => void
  handleRemovePos: (id: string, index: number) => void
  handleChoosePos: (id: string, index: number, choice: PositionChoice) => void
  handleUpdateCallRef: (id: string, callId: string | null) => void
  handleAddEntryCondition: (id: string, type: 'and' | 'or') => void
  handleAddExitCondition: (id: string, type: 'and' | 'or') => void
  handleDeleteEntryCondition: (id: string, condId: string) => void
  handleDeleteExitCondition: (id: string, condId: string) => void
  handleUpdateEntryCondition: (id: string, condId: string, updates: Partial<ConditionLine>) => void
  handleUpdateExitCondition: (id: string, condId: string, updates: Partial<ConditionLine>) => void
  handleUpdateScaling: (id: string, updates: Record<string, unknown>) => void

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
  undo,
  redo,
  activeBot,
  // Call chain props
  callChains,
  setCallChains,
  handleAddCallChain,
  handleRenameCallChain,
  handleToggleCallChainCollapse,
  handleDeleteCallChain,
  pushCallChain,
  // Main flowchart
  current,
  push,
  backtestErrorNodeIds,
  backtestFocusNodeId,
  handleAdd,
  handleAppend,
  handleRemoveSlotEntry,
  handleDelete,
  handleCopy,
  handlePaste,
  handlePasteCallRef,
  handleRename,
  handleWeightChange,
  handleUpdateCappedFallback,
  handleUpdateVolWindow,
  handleColorChange,
  handleToggleCollapse,
  handleNumberedQuantifier,
  handleNumberedN,
  handleAddNumberedItem,
  handleDeleteNumberedItem,
  handleAddCondition,
  handleDeleteCondition,
  handleFunctionWindow,
  handleFunctionBottom,
  handleFunctionMetric,
  handleFunctionRank,
  handleAddPos,
  handleRemovePos,
  handleChoosePos,
  handleUpdateCallRef,
  handleAddEntryCondition,
  handleAddExitCondition,
  handleDeleteEntryCondition,
  handleDeleteExitCondition,
  handleUpdateEntryCondition,
  handleUpdateExitCondition,
  handleUpdateScaling,
  // Refs
  flowchartScrollRef,
  floatingScrollRef,
}: ModelTabProps) {
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
  return (
    <Card className="h-full flex flex-col overflow-hidden mx-2 my-4">
      <CardContent className="flex-1 flex flex-col gap-4 p-4 overflow-auto min-h-0">
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
          />
        </div>

        {/* Bottom Row - 2 Zones Side by Side */}
        <div className="flex gap-4 flex-1">
          {/* Bottom Left Zone - Sticky Labels + Content */}
          <div className={`flex items-start transition-all ${callbackNodesCollapsed && customIndicatorsCollapsed ? 'w-auto' : 'w-1/2'}`}>
            {/* Left Side - Labels and Buttons (sticky, fills visible height, split 50/50) */}
            <div className="flex flex-col w-auto border border-border rounded-l-lg sticky top-4 z-10" style={{ height: 'calc(100vh - 240px)', backgroundColor: 'color-mix(in srgb, var(--color-muted) 40%, var(--color-card))' }}>
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
              className="flex-1 grid overflow-hidden border border-l-0 border-border rounded-r-lg sticky top-4 z-10"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-muted) 40%, var(--color-card))',
                gridTemplateRows:
                  callbackNodesCollapsed && customIndicatorsCollapsed ? '0fr 0fr' :
                  callbackNodesCollapsed && !customIndicatorsCollapsed ? '0fr 1fr' :
                  !callbackNodesCollapsed && customIndicatorsCollapsed ? '1fr 0fr' :
                  '1fr 1fr',
                height: 'calc(100vh - 240px)'
              }}
            >
              {/* Callback Nodes Content */}
              {!callbackNodesCollapsed && (
                <div className="overflow-auto p-4 border-b border-border">
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
              )}

              {/* Custom Indicators Content */}
              {!customIndicatorsCollapsed && (
                <div className="overflow-auto p-4">
                  <div className="text-muted text-sm">Coming soon...</div>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Right Zone - Flow Tree Builder with Floating Toolbar */}
          <div className={`flex flex-col transition-all relative min-h-0 overflow-hidden ${callbackNodesCollapsed && customIndicatorsCollapsed ? 'flex-1' : 'w-1/2'}`}>
            {/* ETFs Only Toggle + Find/Replace - FLOATING TOOLBAR (sticky like Callback Nodes) */}
            <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center px-4 py-2 border border-border rounded-lg mb-2 sticky top-4 z-20" style={{ backgroundColor: 'color-mix(in srgb, var(--color-muted) 60%, var(--color-card))' }}>
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
                <span className="text-xs text-muted">
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
                  <span className="text-xs text-muted">Replace</span>
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
                  <span className="text-xs text-muted">With</span>
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
                      let instances = findTickerInstances(current, findTicker, includePositions, includeIndicators)
                      if (e.target.checked && callChains.length > 0) {
                        callChains.forEach(chain => {
                          try {
                            const chainRoot = typeof chain.root === 'string' ? JSON.parse(chain.root) : chain.root
                            instances = [...instances, ...findTickerInstances(chainRoot, findTicker, includePositions, includeIndicators, chain.id)]
                          } catch { /* ignore */ }
                        })
                      }
                      setFoundInstances(instances)
                      setCurrentInstanceIndex(instances.length > 0 ? 0 : -1)
                    }}
                  />
                  Call Chains
                </label>
                <Button
                  variant="outline"
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
                  Prev
                </Button>
                <Button
                  variant="outline"
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
                  Next
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
            {/* Flowchart Card - separate from toolbar */}
            <div className="flex-1 border border-border rounded-lg bg-card min-h-0 p-4 relative" style={{ height: 'calc(100vh - 340px)', overflow: 'hidden' }}>
              <div
                ref={flowchartScrollRef}
                style={{
                  width: '100%',
                  height: 'calc(100% + 20px)',
                  marginBottom: '-20px',
                  overflowY: 'auto',
                  overflowX: 'scroll',
                }}
                onScroll={(e) => {
                  if (floatingScrollRef.current) {
                    floatingScrollRef.current.scrollLeft = e.currentTarget.scrollLeft
                  }
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
                />
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default ModelTab
