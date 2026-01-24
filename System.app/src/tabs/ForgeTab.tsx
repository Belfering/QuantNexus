// src/tabs/ForgeTab.tsx
// Forge tab component - lazy loadable wrapper for flowchart builder

import { type RefObject, useState, useEffect, useRef, useMemo } from 'react'
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
  Watchlist,
  SavedBot,
  AnalyzeBacktestState,
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
import { ChronologicalSettingsPanel } from '@/components/Forge/ChronologicalSettingsPanel'
import { WalkForwardSettingsPanel } from '@/components/Forge/WalkForwardSettingsPanel'
import { ShardsJobLoader } from '@/components/Forge/ShardsJobLoader'
import { ShardsBranchFilter } from '@/components/Forge/ShardsBranchFilter'
import { ShardsCombinedPreview } from '@/components/Forge/ShardsCombinedPreview'
import { ShardsLibrary } from '@/components/Forge/ShardsLibrary'
import { ForgeModelTab } from '@/components/Forge/ForgeModelTab'
import { ParameterBoxPanel, isBrokenPath, migrateParameterRange } from '@/features/parameters/components/ParameterBoxPanel'
import type { ParameterField, ParameterRange } from '@/features/parameters/types'
import { loadCallChainsFromApi } from '@/features/auth'
import { useAuthStore, useUIStore, useBotStore, useBacktestStore, useTreeStore } from '@/stores'
import { useShardStore } from '@/stores/useShardStore'
import { useTreeSync, useTreeUndo, useTickerLists, useWatchlistCallbacks } from '@/hooks'
// Updated: TIM/TIMAR metrics now included
import { useBatchBacktest } from '@/features/optimization/hooks/useBatchBacktest'
import { applyBranchToTree } from '@/features/optimization/services/branchGenerator'
import type { EligibilityRequirement } from '@/types/admin'
import { countForgeNodes, LIMITS, validateBranchCount, validateStrategyComposition } from '@/features/forge/utils/limits'

// Development mode flag - controls visibility of experimental features
const IS_DEV_MODE = import.meta.env.VITE_DEV_MODE === 'true'

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

  // Watchlist props (for save to watchlist)
  watchlists: Watchlist[]
  savedBots: SavedBot[]
  setWatchlists: (updater: (prev: Watchlist[]) => Watchlist[]) => void
  setSavedBots: (updater: (prev: SavedBot[]) => SavedBot[]) => void
  setBots: (updater: (prev: BotSession[]) => BotSession[]) => void
  setAnalyzeBacktests: (updater: (prev: Record<string, AnalyzeBacktestState>) => Record<string, AnalyzeBacktestState>) => void
  callChainsById: Map<string, CallChain>
  tickerMetadata: Map<string, { assetType?: string; name?: string }>

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
  // Watchlist props
  watchlists,
  savedBots,
  setWatchlists,
  setSavedBots,
  setBots,
  setAnalyzeBacktests,
  callChainsById,
  tickerMetadata,
  // Backtest visual state
  backtestErrorNodeIds,
  backtestFocusNodeId,
  // Refs
  flowchartScrollRef,
  floatingScrollRef,
}: ForgeTabProps) {
  // --- Tree state from useTreeStore (Phase 2N-15c) ---
  // Get forgeSubtab first to determine which tree field to sync
  const { forgeSubtab, setForgeSubtab } = useUIStore()

  // Determine which tree field based on active subtab
  const treeField = forgeSubtab === 'Shaping'
    ? 'splitTree'
    : forgeSubtab === 'Walk Forward'
    ? 'walkForwardTree'
    : forgeSubtab === 'Combine'
    ? 'combineTree'
    : 'splitTree' // Default for Data/Shards

  // Use tree sync with treeField - saves on EVERY change
  const current = useTreeSync('Forge', treeField)
  const { undo, redo } = useTreeUndo()
  const treeStore = useTreeStore()

  // Effect: Sync activeForgeBotId when switching Forge subtabs
  useEffect(() => {
    if (forgeSubtab === 'Shaping') {
      const activeShapingBot = useBotStore.getState().activeShapingBotId
      useBotStore.getState().setActiveForgeBotId(activeShapingBot)
      console.log('[ForgeTab] Switched to Shaping, loading bot:', activeShapingBot)
    } else if (forgeSubtab === 'Combine') {
      const activeCombineBot = useBotStore.getState().activeCombineBotId
      useBotStore.getState().setActiveForgeBotId(activeCombineBot)
      console.log('[ForgeTab] Switched to Combine, loading bot:', activeCombineBot)
    } else if (forgeSubtab === 'Walk Forward') {
      const activeWalkForwardBot = useBotStore.getState().activeWalkForwardBotId
      useBotStore.getState().setActiveForgeBotId(activeWalkForwardBot)
      console.log('[ForgeTab] Switched to Walk Forward, loading bot:', activeWalkForwardBot)
    }
  }, [forgeSubtab])

  // Flowchart scroll width for the horizontal scrollbar (updated by App.tsx)
  const flowchartScrollWidth = useUIStore(s => s.flowchartScrollWidth)

  // Ticker lists for Forge optimization (Phase 3)
  const { tickerLists } = useTickerLists()

  // Shards state
  const shardLoadedJobType = useShardStore(s => s.loadedJobType)
  const shardLoadedJobIds = useShardStore(s => s.loadedJobIds)
  const shardAllBranches = useShardStore(s => s.allBranches)
  const shardFilteredBranches = useShardStore(s => s.filteredBranches)
  const shardFilterMetric = useShardStore(s => s.filterMetric)
  const shardFilterTopX = useShardStore(s => s.filterTopX)
  const shardFilterMode = useShardStore(s => s.filterMode)
  const shardFilterTopXPerPattern = useShardStore(s => s.filterTopXPerPattern)
  const shardMetricRequirements = useShardStore(s => s.metricRequirements)
  const shardDiscoveredPatterns = useShardStore(s => s.discoveredPatterns)
  const shardLoadedJobs = useShardStore(s => s.loadedJobs)
  const shardCombinedTree = useShardStore(s => s.combinedTree)
  const shardLoadChronologicalJob = useShardStore(s => s.loadChronologicalJob)
  const shardLoadRollingJob = useShardStore(s => s.loadRollingJob)
  const shardLoadSavedShard = useShardStore(s => s.loadSavedShard)
  const shardUnloadJob = useShardStore(s => s.unloadJob)
  const shardClearAllJobs = useShardStore(s => s.clearAllJobs)
  const shardIsJobLoaded = useShardStore(s => s.isJobLoaded)
  const shardSetFilterMetric = useShardStore(s => s.setFilterMetric)
  const shardSetFilterTopX = useShardStore(s => s.setFilterTopX)
  const shardSetFilterMode = useShardStore(s => s.setFilterMode)
  const shardSetFilterTopXPerPattern = useShardStore(s => s.setFilterTopXPerPattern)
  const shardSetMetricRequirements = useShardStore(s => s.setMetricRequirements)
  const shardApplyFilters = useShardStore(s => s.applyFilters)
  const shardRemoveBranchFromFiltered = useShardStore(s => s.removeBranchFromFiltered)
  const shardClearFilteredBranches = useShardStore(s => s.clearFilteredBranches)
  const shardGenerateCombinedTree = useShardStore(s => s.generateCombinedTree)
  const shardSaveToModel = useShardStore(s => s.saveToModel)
  const shardFilterGroups = useShardStore(s => s.filterGroups)
  const shardFilterHistory = useShardStore(s => s.filterHistory)
  const shardUndoFilter = useShardStore(s => s.undoFilter)
  const shardRemoveFilterGroup = useShardStore(s => s.removeFilterGroup)
  const shardSelectedFilterGroupId = useShardStore(s => s.selectedFilterGroupId)
  const shardSetSelectedFilterGroup = useShardStore(s => s.setSelectedFilterGroup)

  // Strategy List state (Phase 2b)
  const shardStrategyBranches = useShardStore(s => s.strategyBranches)
  const shardActiveListView = useShardStore(s => s.activeListView)
  const shardLoadJobAndAddToStrategy = useShardStore(s => s.loadJobAndAddToStrategy)
  const shardLoadSavedShardAndAddToStrategy = useShardStore(s => s.loadSavedShardAndAddToStrategy)
  const shardAddBranchesToStrategy = useShardStore(s => s.addBranchesToStrategy)
  const shardRemoveBranchFromStrategy = useShardStore(s => s.removeBranchFromStrategy)
  const shardClearStrategyBranches = useShardStore(s => s.clearStrategyBranches)
  const shardSetActiveListView = useShardStore(s => s.setActiveListView)

  // Strategy Job Loading state (Phase 1b - for Card 4)
  const shardLoadedStrategyJobs = useShardStore(s => s.loadedStrategyJobs)
  const shardLoadedStrategyJobIds = useShardStore(s => s.loadedStrategyJobIds)
  const shardUnloadStrategyJob = useShardStore(s => s.unloadStrategyJob)

  // Shard Library state (Phase 4)
  const shardSavedShards = useShardStore(s => s.savedShards)
  const shardSelectedShardIds = useShardStore(s => s.selectedShardIds)
  const shardLoadedShardBranches = useShardStore(s => s.loadedShardBranches)
  const shardSavedShardsRefreshTrigger = useShardStore(s => s.savedShardsRefreshTrigger)
  const shardIsLoadingShards = useShardStore(s => s.isLoadingShards)
  const shardIsSavingShard = useShardStore(s => s.isSavingShard)
  const shardBotName = useShardStore(s => s.shardBotName)
  const shardWeighting = useShardStore(s => s.shardWeighting)
  const shardCappedPercent = useShardStore(s => s.shardCappedPercent)
  const shardFetchSavedShards = useShardStore(s => s.fetchSavedShards)
  const shardSaveShard = useShardStore(s => s.saveShard)
  const shardDeleteShard = useShardStore(s => s.deleteShard)
  const shardSelectShard = useShardStore(s => s.selectShard)
  const shardDeselectShard = useShardStore(s => s.deselectShard)
  const shardLoadSelectedShards = useShardStore(s => s.loadSelectedShards)
  const shardSetShardBotName = useShardStore(s => s.setShardBotName)
  const shardSetShardWeighting = useShardStore(s => s.setShardWeighting)
  const shardSetShardCappedPercent = useShardStore(s => s.setShardCappedPercent)
  const shardGenerateBotFromShards = useShardStore(s => s.generateBotFromShards)

  // Calculate node count for strategy validation
  const strategyNodeValidation = useMemo(() => {
    if (shardStrategyBranches.length === 0) {
      return { valid: true, nodeCount: 0 }
    }
    return validateStrategyComposition(shardStrategyBranches)
  }, [shardStrategyBranches])

  // Tree syncing is now handled automatically by useTreeSync hook above
  // No manual save/load needed - it saves on every change and loads on subtab switch

  // Forge node limit tracking (only for Split and Walk Forward tabs)
  const forgeNodeCount = useMemo(() => {
    if (forgeSubtab === 'Shards') return 0
    return countForgeNodes(current)
  }, [current, forgeSubtab])

  const forgeNodeLimitReached = forgeNodeCount >= LIMITS.FORGE_MAX_NODES

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

    // Read from the appropriate parameter range array based on active tab
    const sourceRanges = forgeSubtab === 'Walk Forward'
      ? (activeBot.rollingParameterRanges || [])
      : (activeBot.parameterRanges || [])  // Split tab / default
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

    // Save to the appropriate parameter range array based on active tab
    if (forgeSubtab === 'Walk Forward') {
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

  // Watchlist callbacks hook
  const {
    handleSaveToWatchlist,
  } = useWatchlistCallbacks({
    userId,
    isAdmin,
    current,
    activeBotId,
    activeSavedBotId,
    activeBot,
    watchlists,
    savedBots,
    callChainsById,
    tickerMetadata,
    backtestMode,
    backtestCostBps,
    setWatchlists,
    setSavedBots,
    setBots,
    setAnalyzeBacktests,
    setSaveMenuOpen,
    setSaveNewWatchlistName,
    setJustSavedFeedback,
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

  // Floating scrollbar position tracking
  const [flowchartRect, setFlowchartRect] = useState({ left: 0, width: 0 })

  // Parameter ranges for optimization (stored in bot session)
  const botStore = useBotStore()
  // Use correct parameter ranges based on active tab
  // Split tab uses parameterRanges (chronological), Walk Forward uses rollingParameterRanges
  // Apply automatic migration to fix broken parameter range paths
  const parameterRanges = useMemo(() => {
    const rawRanges = forgeSubtab === 'Walk Forward'
      ? (activeBot?.rollingParameterRanges ?? [])
      : (activeBot?.parameterRanges ?? [])

    // Migrate broken paths automatically
    const migrated = rawRanges.map(migrateParameterRange)
    const needsSave = migrated.some((r, i) => r.path !== rawRanges[i].path)

    if (needsSave && activeBot) {
      console.log('[ForgeTab] Migrating broken parameter ranges')
      setTimeout(() => {
        if (forgeSubtab === 'Walk Forward') {
          botStore.setRollingParameterRanges(activeBot.id, migrated)
        } else {
          botStore.setParameterRanges(activeBot.id, migrated)
        }
      }, 0)
    }

    return migrated
  }, [forgeSubtab, activeBot?.rollingParameterRanges, activeBot?.parameterRanges, activeBot?.id, botStore])

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
  const { job: batchJob, runBatchBacktest, cancelJob } = useBatchBacktest()
  const [rollingOptimizationRunning, setRollingOptimizationRunning] = useState(false)
  const [rollingProgress, setRollingProgress] = useState<{completed: number, total: number, currentPeriod: number, totalPeriods: number} | null>(null)
  const [resultsSubtab, setResultsSubtab] = useState<'Chronological' | 'Rolling'>('Chronological')
  const [shardsSubtab, setShardsSubtab] = useState<'shards' | 'results'>('shards')

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

    // Determine strategy and data based on active tab
    const isWalkForward = forgeSubtab === 'Walk Forward'

    // Use correct parameter ranges based on tab
    const parameterRanges = isWalkForward
      ? (activeBot.rollingParameterRanges || [])
      : (activeBot.parameterRanges || [])

    // Use correct requirements based on tab
    const requirements = isWalkForward
      ? (activeBot.rollingRequirements || [])
      : (activeBot.chronologicalRequirements || [])

    // Ensure splitConfig has correct strategy based on tab
    const splitConfig = {
      ...(activeBot.splitConfig || {}),
      enabled: true,
      strategy: isWalkForward ? ('rolling' as const) : ('chronological' as const),
      chronologicalPercent: activeBot.splitConfig?.chronologicalPercent ?? 50,
      minYears: activeBot.splitConfig?.minYears ?? 5,
      rollingWindowPeriod: activeBot.splitConfig?.rollingWindowPeriod ?? 'monthly',
      rankBy: activeBot.splitConfig?.rankBy ?? 'Sharpe Ratio',
      minWarmUpYears: activeBot.splitConfig?.minWarmUpYears ?? 3
    }

    const mode = 'CC' // Default mode
    const costBps = 5 // Default cost

    // DEBUG: Log config to verify
    console.log(`[ForgeTab] Starting ${isWalkForward ? 'rolling' : 'chronological'} optimization from ${forgeSubtab} tab`)
    console.log('[ForgeTab] splitConfig:', JSON.stringify(splitConfig))
    console.log('[ForgeTab] parameterRanges:', parameterRanges.length)
    console.log('[ForgeTab] requirements:', requirements.length)

    // If Walk Forward tab, use rolling optimization endpoint
    if (isWalkForward) {
      console.log('[ForgeTab] Walk Forward tab - using rolling optimization endpoint')

      // Clear any old batch job before starting new rolling optimization
      useBotStore.getState().setBranchGenerationJob(activeBot.id, undefined)

      // Extract tickers from ticker lists in parameter ranges (already set to rolling)
      console.log('[ForgeTab] Parameter ranges:', JSON.stringify(parameterRanges, null, 2))
      const tickerListRanges = parameterRanges.filter(r => r.type === 'ticker_list')
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
        parameterRanges: JSON.stringify(parameterRanges)  // Already set to rolling ranges at top
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

                // Switch to Shards tab > Run Results sub-subtab > Rolling
                setForgeSubtab('Shards')
                setShardsSubtab('results')
                setResultsSubtab('Rolling')

                // Show success notification
                alert(`Rolling optimization complete!\nJob ID: ${data.jobId}\nValid tickers: ${results.job.validTickers.length}\nBranches tested: ${results.job.branchCount}\nYears: ${results.branches[0]?.isStartYear || '?'} - present\n\nResults are now available in the Shards > Run Results tab.`)
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

      // Include all parameter ranges (including ticker_list) for chronological optimization
      console.log('[ForgeTab] Using parameter ranges for chronological:', parameterRanges.length)

      // Use requirements from the tab-aware variable (already set to chronological at top)
      await runBatchBacktest(current, parameterRanges, splitConfig, requirements, activeBot.id, botName, mode, costBps)
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
        {/* Shaping Tab Content */}
        {forgeSubtab === 'Shaping' && (
          <>
            {/* Top Zone - Chronological Settings Panel */}
            <div className="shrink-0 border-b border-border pb-4">
              <ChronologicalSettingsPanel
                requirements={activeBot?.chronologicalRequirements ?? []}
                onRequirementsChange={(requirements) => {
                  if (activeBot) {
                    useBotStore.getState().setChronologicalRequirements(activeBot.id, requirements)
                  }
                }}
                splitConfig={{
                  ...activeBot?.splitConfig,
                  enabled: activeBot?.splitConfig?.enabled ?? true,
                  strategy: 'chronological'
                }}
                onSplitConfigChange={(config) => {
                  if (activeBot) {
                    useBotStore.getState().setSplitConfig(activeBot.id, {
                      ...config,
                      strategy: 'chronological' // Force chronological strategy
                    })
                  }
                }}
              />
            </div>

            {/* Split Tab - Flowchart Toolbar & Tree */}
            <>
            {/* Flowchart Toolbar - Run Split + Find/Replace + Undo/Redo - Floating above the flowchart zone */}
        <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center px-4 py-2 border border-border rounded-lg shrink-0 z-20 sticky top-0" style={{ backgroundColor: 'color-mix(in srgb, var(--color-muted) 60%, var(--color-card))' }}>
          {/* Left section: Run Split button OR Branch generation progress */}
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

              // Otherwise show Run Split button
              // Split tab ALWAYS uses chronological parameter ranges

              // Split tab uses chronological parameter ranges
              const enabledRanges = (activeBot?.parameterRanges || []).filter(r => r.enabled)

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

              // For Split: enable if chronological ranges exist
              const hasRanges = enabledRanges.length > 0

              // Validate branch count against MAX_BRANCHES limit
              const validation = validateBranchCount(branchCount)

              return (
                <>
                  <Button
                    size="sm"
                    disabled={!hasRanges || !validation.valid}
                    onClick={handleGenerateBranches}
                  >
                    Run Split
                  </Button>
                  {hasRanges && (
                    <div className="flex flex-col items-start gap-1">
                      <span className={`text-xs ${validation.valid ? 'text-muted-foreground' : 'text-red-500'}`}>
                        {validation.displayText}
                      </span>
                      {!validation.valid && validation.errorMessage && (
                        <span className="text-xs text-red-500">
                          {validation.errorMessage}
                        </span>
                      )}
                    </div>
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
              {forgeNodeLimitReached && (
                <div className="m-2 mb-0 px-3 py-2 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded text-sm text-red-600 dark:text-red-400">
                  Node limit reached: {forgeNodeCount}/{LIMITS.FORGE_MAX_NODES}. Remove nodes to add more.
                </div>
              )}
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
                  forgeNodeLimitReached={forgeNodeLimitReached}
                  forgeNodeCount={forgeNodeCount}
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
          </>
        )}

        {/* Walk Forward Tab Content */}
        {forgeSubtab === 'Walk Forward' && (
          <>
            {/* Top Zone - Walk Forward Settings Panel */}
            <div className="shrink-0 border-b border-border pb-4">
              <WalkForwardSettingsPanel
                requirements={activeBot?.rollingRequirements ?? []}
                onRequirementsChange={(requirements) => {
                  if (activeBot) {
                    useBotStore.getState().setRollingRequirements(activeBot.id, requirements)
                  }
                }}
                splitConfig={{
                  ...activeBot?.splitConfig,
                  enabled: activeBot?.splitConfig?.enabled ?? true,
                  strategy: 'rolling'
                }}
                onSplitConfigChange={(config) => {
                  if (activeBot) {
                    // Sync rolling config changes to Rolling nodes in tree
                    if (config.rollingWindowPeriod && config.rankBy) {
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

                    useBotStore.getState().setSplitConfig(activeBot.id, {
                      ...config,
                      strategy: 'rolling' // Force rolling strategy
                    })
                  }
                }}
              />
            </div>

            {/* Flowchart Toolbar - Run Walk Forward + Find/Replace + Undo/Redo - Floating above the flowchart zone */}
        <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center px-4 py-2 border border-border rounded-lg shrink-0 z-20 sticky top-0" style={{ backgroundColor: 'color-mix(in srgb, var(--color-muted) 60%, var(--color-card))' }}>
          {/* Left section: Run Walk Forward button OR Branch generation progress */}
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

              // Otherwise show Run Walk Forward button
              // Walk Forward tab ALWAYS uses rolling parameter ranges

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

              // Walk Forward tab uses rolling parameter ranges
              const enabledRanges = (activeBot?.rollingParameterRanges || []).filter(r => r.enabled)

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

              // For Walk Forward: enable if Rolling node exists AND has rolling ranges
              const hasRanges = hasRollingNodeInTree(current) && enabledRanges.length > 0

              // Validate branch count against MAX_BRANCHES limit
              const validation = validateBranchCount(branchCount)

              return (
                <>
                  <Button
                    size="sm"
                    disabled={!hasRanges || !validation.valid}
                    onClick={handleGenerateBranches}
                  >
                    Run Walk Forward
                  </Button>
                  {hasRanges && (
                    <div className="flex flex-col items-start gap-1">
                      <span className={`text-xs ${validation.valid ? 'text-muted-foreground' : 'text-red-500'}`}>
                        {validation.displayText}
                      </span>
                      {!validation.valid && validation.errorMessage && (
                        <span className="text-xs text-red-500">
                          {validation.errorMessage}
                        </span>
                      )}
                    </div>
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
              {forgeNodeLimitReached && (
                <div className="m-2 mb-0 px-3 py-2 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded text-sm text-red-600 dark:text-red-400">
                  Node limit reached: {forgeNodeCount}/{LIMITS.FORGE_MAX_NODES}. Remove nodes to add more.
                </div>
              )}
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
                  forgeNodeLimitReached={forgeNodeLimitReached}
                  forgeNodeCount={forgeNodeCount}
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
        )}

        {/* Data Tab */}
        {forgeSubtab === 'Data' && <TickerListsPanel />}

        {/* Shards Tab Content */}
        {forgeSubtab === 'Shards' && (
          <>
            {/* Shards Sub-Subtabs */}
            <div className="flex gap-2 shrink-0 mb-4 px-6 pt-6">
              <Button
                variant={shardsSubtab === 'shards' ? 'accent' : 'secondary'}
                onClick={() => setShardsSubtab('shards')}
              >
                Shards
              </Button>
              <Button
                variant={shardsSubtab === 'results' ? 'accent' : 'secondary'}
                onClick={() => setShardsSubtab('results')}
              >
                Run Results
              </Button>
            </div>

            {/* Shards Content */}
            {shardsSubtab === 'shards' ? (
          <div className="flex-1 overflow-hidden flex flex-col p-6 max-h-[calc(100vh-160px)]">
            <div className="grid grid-cols-4 gap-4 h-full min-h-0">
              {/* Card 1: Job Loading */}
              <ShardsJobLoader
                loadedJobType={shardLoadedJobType}
                loadedJobIds={shardLoadedJobIds}
                allBranches={shardAllBranches}
                onLoadJob={async (type, jobId) => {
                  if (type === 'chronological') {
                    await shardLoadChronologicalJob(jobId)
                  } else {
                    await shardLoadRollingJob(jobId)
                  }
                }}
                onLoadSavedShard={shardLoadSavedShard}
                onUnloadJob={shardUnloadJob}
                onClearAllJobs={shardClearAllJobs}
                isJobLoaded={shardIsJobLoaded}
                onLoadJobAndAddToStrategy={shardLoadJobAndAddToStrategy}
                onLoadSavedShardAndAddToStrategy={shardLoadSavedShardAndAddToStrategy}
                refreshTrigger={shardSavedShardsRefreshTrigger}
              />

              {/* Card 2: Filter Settings */}
              <ShardsBranchFilter
                loadedJobType={shardLoadedJobType}
                allBranches={shardAllBranches}
                filterMetric={shardFilterMetric}
                filterTopX={shardFilterTopX}
                filterMode={shardFilterMode}
                filterTopXPerPattern={shardFilterTopXPerPattern}
                metricRequirements={shardMetricRequirements}
                discoveredPatterns={shardDiscoveredPatterns}
                onFilterMetricChange={shardSetFilterMetric}
                onFilterTopXChange={shardSetFilterTopX}
                onFilterModeChange={shardSetFilterMode}
                onFilterTopXPerPatternChange={shardSetFilterTopXPerPattern}
                onMetricRequirementsChange={shardSetMetricRequirements}
                onApplyFilter={shardApplyFilters}
              />

              {/* Card 3: Filtered Results */}
              <ShardsCombinedPreview
                loadedJobType={shardLoadedJobType}
                filteredBranches={shardFilteredBranches}
                strategyBranches={shardStrategyBranches}
                activeListView={shardActiveListView}
                filterMetric={shardFilterMetric}
                filterGroups={shardFilterGroups}
                selectedFilterGroupId={shardSelectedFilterGroupId}
                canUndo={shardFilterHistory.length > 0}
                onRemoveBranch={shardRemoveBranchFromFiltered}
                onRemoveBranchFromStrategy={shardRemoveBranchFromStrategy}
                onClearFiltered={shardClearFilteredBranches}
                onClearStrategy={shardClearStrategyBranches}
                onRemoveGroup={shardRemoveFilterGroup}
                onSelectFilterGroup={shardSetSelectedFilterGroup}
                onSetActiveListView={shardSetActiveListView}
                onUndo={shardUndoFilter}
                onGenerate={shardGenerateCombinedTree}
                onSaveToModel={async () => {
                  const botId = await shardSaveToModel()
                  // Stay on Shards tab after saving
                  console.log('[ForgeTab] Saved shard to Model tab:', botId)
                }}
                canSave={shardFilteredBranches.length > 0}
                isSavingShard={shardIsSavingShard}
                onSaveShard={shardSaveShard}
              />

              {/* Card 4: Shard Library */}
              <ShardsLibrary
                loadedStrategyJobs={shardLoadedStrategyJobs}
                loadedStrategyJobIds={shardLoadedStrategyJobIds}
                isLoadingShards={shardIsLoadingShards}
                shardBotName={shardBotName}
                shardWeighting={shardWeighting}
                shardCappedPercent={shardCappedPercent}
                onSetShardBotName={shardSetShardBotName}
                onSetShardWeighting={shardSetShardWeighting}
                onSetShardCappedPercent={shardSetShardCappedPercent}
                onUnloadStrategyJob={shardUnloadStrategyJob}
                strategyNodeCount={strategyNodeValidation.nodeCount}
                strategyNodeLimitExceeded={!strategyNodeValidation.valid}
                strategyNodeErrorMessage={strategyNodeValidation.errorMessage}
                onGenerateBot={async () => {
                  // Validate node count BEFORE generating tree
                  if (!strategyNodeValidation.valid) {
                    console.error('[ForgeTab] Strategy exceeds node limit:', strategyNodeValidation)
                    // Error already shown in UI via ShardsLibrary props
                    return
                  }

                  const tree = shardGenerateBotFromShards()
                  if (!tree) {
                    console.error('[ForgeTab] No tree generated from strategy shards')
                    return
                  }

                  // Create bot session in Forge tab WITHOUT saving to database
                  // User can save manually using the "Save to Watchlist" button
                  const botId = `shard-${Date.now()}`

                  // Add to bot store with the generated tree (unsaved)
                  useBotStore.getState().addBot({
                    id: botId,
                    history: [tree],
                    historyIndex: 0,
                    combineTree: tree, // Combine tab displays this tree
                    backtest: {
                      status: 'idle',
                      result: null,
                      errors: [],
                      errorNodeIds: new Set(),
                      focusNodeId: null,
                      benchmarkMetrics: null
                    },
                    callChains: [],
                    customIndicators: [],
                    parameterRanges: [],
                    tabContext: 'Forge',
                    subtabContext: 'Combine' // Mark as Combine subtab bot
                    // Note: No savedBotId - this bot is unsaved until user clicks "Save to Watchlist"
                  })

                  console.log('[ForgeTab] Generated strategy bot (unsaved):', botId, 'with', shardStrategyBranches.length, 'branches')

                  // Navigate to Combine subtab
                  useUIStore.getState().setForgeSubtab('Combine')

                  // Set this bot as active in Forge tab
                  useBotStore.getState().setActiveForgeBotId(botId)
                  useBotStore.getState().setActiveCombineBotId(botId) // Remember as Combine active bot

                  // Close the initial "Forge System" bot if it exists
                  const initialBot = useBotStore.getState().bots.find(
                    b => b.tabContext === 'Forge' && b.history[0]?.title === 'Forge System'
                  )
                  if (initialBot) {
                    useBotStore.getState().closeBot(initialBot.id)
                    console.log('[ForgeTab] Closed initial "Forge System" bot')
                  }
                }}
              />
            </div>
          </div>
            ) : (
              /* Run Results Content */
              <>
                {/* Results Sub-Subtabs */}
                <div className="flex gap-2 shrink-0 px-6">
                  <Button
                    variant={resultsSubtab === 'Chronological' ? 'accent' : 'secondary'}
                    onClick={() => setResultsSubtab('Chronological')}
                  >
                    Chronological
                  </Button>
                  {IS_DEV_MODE && (
                    <Button
                      variant={resultsSubtab === 'Rolling' ? 'accent' : 'secondary'}
                      onClick={() => setResultsSubtab('Rolling')}
                    >
                      Rolling
                    </Button>
                  )}
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
          </>
        )}

        {/* Combine Subtab - Independent copy of Model tab */}
        {forgeSubtab === 'Combine' && (
          <ForgeModelTab
            tickerOptions={tickerOptions}
            backtestStatus={backtestStatus}
            backtestResult={backtestResult}
            backtestErrors={backtestErrors}
            handleRunBacktest={handleRunBacktest}
            handleJumpToBacktestError={handleJumpToBacktestError}
            theme={theme}
            fetchBenchmarkMetrics={fetchBenchmarkMetrics}
            runModelRobustness={runModelRobustness}
            activeBot={activeBot}
            callChains={callChains}
            setCallChains={setCallChains}
            handleAddCallChain={handleAddCallChain}
            handleRenameCallChain={handleRenameCallChain}
            handleToggleCallChainCollapse={handleToggleCallChainCollapse}
            handleDeleteCallChain={handleDeleteCallChain}
            pushCallChain={pushCallChain}
            handleSaveToWatchlist={handleSaveToWatchlist}
            watchlists={watchlists}
            saveMenuOpen={saveMenuOpen}
            setSaveMenuOpen={setSaveMenuOpen}
            saveNewWatchlistName={saveNewWatchlistName}
            setSaveNewWatchlistName={setSaveNewWatchlistName}
            justSavedFeedback={justSavedFeedback}
            backtestErrorNodeIds={backtestErrorNodeIds}
            backtestFocusNodeId={backtestFocusNodeId}
            flowchartScrollRef={flowchartScrollRef}
            floatingScrollRef={floatingScrollRef}
          />
        )}
      </CardContent>
    </Card>
  )
}

export default ForgeTab
