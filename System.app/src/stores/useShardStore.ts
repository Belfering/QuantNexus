// Store for Shards tab state management

import { create } from 'zustand'
import type { OptimizationJob, OptimizationResult } from '@/types/optimizationJob'
import type { RollingOptimizationResult, SavedSystem } from '@/types/bot'
import type { RollingJob } from '@/features/optimization/hooks/useRollingJobs'
import type { FlowNode } from '@/types/flowNode'
import type { ShardListItem, SavedShard } from '@/types/shard'
import { buildShardTree } from '@/features/shards/treeBuilder'
import { createBotInApi } from '@/features/bots/api'
import { useAuthStore } from './useAuthStore'
import { useBotStore } from './useBotStore'

// ============================================================================
// Tree Signature Utilities (for pattern-based filtering)
// ============================================================================

// Normalized tree structure for signature generation (noise removed)
interface NormalizedNode {
  kind: string
  weighting?: string
  conditions?: Array<{
    type: string
    metric: string
    window: number
    ticker: string
    comparator: string
    rightMetric?: string
    rightWindow?: number
    rightTicker?: string
  }>
  positions?: string[]
  children?: Record<string, NormalizedNode[]>
  metric?: string
  window?: number
  bottom?: number
  rank?: string
  numbered?: {
    quantifier: string
    n: number
    items: Array<{ conditions: any[] }>
  }
}

// Normalize a tree by removing noise (IDs, titles, thresholds, forDays, dates)
// Keep: structure, indicators, windows, tickers, comparators, positions, weighting
function normalizeTreeForSignature(node: FlowNode): NormalizedNode {
  const normalized: NormalizedNode = {
    kind: node.kind,
  }

  // Include weighting if present
  if (node.weighting) {
    normalized.weighting = node.weighting
  }

  // Normalize conditions (strip threshold, forDays, dates, IDs, window)
  // Pattern = Indicator + Ticker only (NO windows/periods)
  if (node.conditions && node.conditions.length > 0) {
    normalized.conditions = node.conditions.map(cond => {
      const c = cond as any // Cast to access all fields
      return {
        type: c.type,
        metric: c.metric,
        // window: REMOVED - normalized away (RSI(5) = RSI(18) = same pattern)
        ticker: c.ticker || '',
        comparator: c.comparator,
        rightMetric: c.rightMetric,
        // rightWindow: REMOVED - normalized away
        rightTicker: c.rightTicker,
      }
    }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  }

  // Include positions (sorted for stability)
  if (node.positions && node.positions.length > 0) {
    normalized.positions = [...node.positions].filter(p => p && p !== 'Empty').sort()
  }

  // Normalize children recursively
  if (node.children) {
    normalized.children = {}
    for (const [slot, children] of Object.entries(node.children)) {
      if (Array.isArray(children) && children.length > 0) {
        normalized.children[slot] = children
          .filter(c => c !== null)
          .map(c => normalizeTreeForSignature(c!))
      }
    }
  }

  // Function node fields
  if (node.metric) normalized.metric = node.metric
  if (node.window !== undefined) normalized.window = node.window
  if (node.bottom !== undefined) normalized.bottom = node.bottom
  if (node.rank) normalized.rank = node.rank

  // Numbered node (simplified)
  if (node.numbered) {
    normalized.numbered = {
      quantifier: node.numbered.quantifier,
      n: node.numbered.n,
      items: node.numbered.items.map(item => ({
        conditions: item.conditions || []
      }))
    }
  }

  return normalized
}

// Hash a tree signature using simple djb2 algorithm
function simpleHash(str: string): string {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i)
  }
  return Math.abs(hash).toString(36)
}

// Helper to recursively sort object keys for deterministic JSON
function sortKeysRecursive(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }
  if (Array.isArray(obj)) {
    return obj.map(sortKeysRecursive)
  }
  const sorted: any = {}
  Object.keys(obj).sort().forEach(key => {
    sorted[key] = sortKeysRecursive(obj[key])
  })
  return sorted
}

// Get a signature for a tree (hash of normalized tree)
function getTreeSignature(treeJson: string | undefined): string | null {
  if (!treeJson) return null
  try {
    const tree: FlowNode = JSON.parse(treeJson)
    const normalized = normalizeTreeForSignature(tree)
    // Sort keys recursively for deterministic JSON (important for hashing)
    const sorted = sortKeysRecursive(normalized)
    const canonical = JSON.stringify(sorted)
    const hash = simpleHash(canonical)

    return `sig-${hash}`
  } catch (err) {
    console.warn('[ShardStore] Failed to generate tree signature:', err)
    return null
  }
}

// Comparator display mapping
const COMPARATOR_SYMBOLS: Record<string, string> = {
  lt: '<',
  gt: '>',
  crossAbove: '↗',
  crossBelow: '↘'
}

// Display info extracted from tree
interface BranchDisplayInfo {
  conditions: string[]  // e.g., "RSI(14) < 70"
  positions: string[]   // e.g., "SPY", "QQQ"
  weighting: string     // e.g., "equal"
}

// Short indicator names for compact display
const SHORT_INDICATOR_NAMES: Record<string, string> = {
  'Relative Strength Index': 'RSI',
  'Simple Moving Average': 'SMA',
  'Exponential Moving Average': 'EMA',
  'Weighted Moving Average': 'WMA',
  'Hull Moving Average': 'Hull',
  'MACD Histogram': 'MACD-H',
  'MACD Line': 'MACD',
  'MACD Signal': 'MACD-S',
  'Bollinger Upper': 'BB-U',
  'Bollinger Mid': 'BB-M',
  'Bollinger Lower': 'BB-L',
  'Average True Range': 'ATR',
  'Average Directional Index': 'ADX',
  'Current Price': 'Price',
  'Stochastic %K': 'Stoch-K',
  'Stochastic %D': 'Stoch-D',
}

// Extract meaningful display info from tree
function extractBranchDisplayInfo(treeJson: string | undefined): BranchDisplayInfo | null {
  if (!treeJson) return null

  try {
    const tree: FlowNode = JSON.parse(treeJson)
    const info: BranchDisplayInfo = {
      conditions: [],
      positions: [],
      weighting: tree.weighting || 'equal'
    }

    // Recursively extract info from tree
    function traverse(node: FlowNode, context?: 'then' | 'else') {
      if (node.kind === 'indicator' && node.conditions) {
        for (const cond of node.conditions) {
          const c = cond as any
          const indicator = SHORT_INDICATOR_NAMES[c.metric] || c.metric
          const comp = COMPARATOR_SYMBOLS[c.comparator] || c.comparator
          const ticker = c.ticker || ''
          const condStr = `${indicator}(${c.window}) ${ticker} ${comp} ${c.threshold}`
          if (context) {
            info.conditions.push(`[${context}] ${condStr}`)
          } else {
            info.conditions.push(condStr)
          }
        }
      }

      if (node.kind === 'position' && node.positions) {
        for (const pos of node.positions) {
          if (pos && pos !== 'Empty' && !info.positions.includes(pos)) {
            info.positions.push(pos)
          }
        }
      }

      // Traverse children
      if (node.children) {
        for (const [slot, children] of Object.entries(node.children)) {
          if (Array.isArray(children)) {
            for (const child of children) {
              if (child) {
                const childContext = slot === 'then' ? 'then' : slot === 'else' ? 'else' : undefined
                traverse(child, childContext)
              }
            }
          }
        }
      }
    }

    traverse(tree)
    return info
  } catch {
    return null
  }
}

// ============================================================================

// Type for storing loaded job data
interface LoadedJobData {
  metadata: OptimizationJob | RollingJob
  branches: OptimizationResult[] | RollingOptimizationResult['branches']
}

// Type for tracking filter groups (each Apply action creates a group)
export interface FilterGroup {
  id: string
  jobName: string                // From loaded job metadata (e.g., "RSI Optimization")
  jobId: number                  // Source job ID (first loaded job)
  metric: 'sharpe' | 'cagr' | 'tim' | 'timar' | 'calmar'
  topX: number
  addedAt: number
  branchKeys: string[]           // ALL branches selected (for reference counting)
  mode: 'overall' | 'perPattern' // Filter mode: overall or per-pattern
  perPatternConfig?: {           // Config for per-pattern mode
    patternCount: number         // How many unique patterns found
    topXPerPattern: number       // Top X from each pattern
    patterns: Record<string, {   // signature -> metadata
      signature: string
      count: number              // Total branches with this pattern
      selected: number           // How many were selected
      example: string            // Display string (e.g., "RSI(14) SPY → SPY")
    }>
  }
}

// History snapshot for undo - stores both groups and branches
interface FilterHistorySnapshot {
  filterGroups: FilterGroup[]
  filteredBranches: OptimizationResult[] | RollingOptimizationResult['branches']
}

interface ShardState {
  // Phase 1: Job Loading (multi-job support)
  loadedJobType: 'chronological' | 'rolling' | null  // Enforces same type for all loaded jobs
  loadedJobIds: number[]  // Array of loaded job IDs (preserves order)
  loadedJobs: Record<number, LoadedJobData>  // Map of jobId -> job data
  allBranches: OptimizationResult[] | RollingOptimizationResult['branches']  // Combined from all loaded jobs

  // Phase 1b: Strategy Job Loading (separate from filter jobs - for Card 4)
  loadedStrategyJobs: Record<number, LoadedJobData>  // Map of jobId -> job data for strategy shards
  loadedStrategyJobIds: number[]  // Array of loaded strategy job IDs

  // Phase 2: Filtering (additive with undo)
  filterMetric: 'sharpe' | 'cagr' | 'tim' | 'timar' | 'calmar'
  filterTopX: number
  filterMode: 'overall' | 'perPattern'  // Filter mode: overall or per-pattern
  filterTopXPerPattern: number  // How many to take from each pattern (in perPattern mode)
  discoveredPatterns: Record<string, {  // Pattern discovery results
    signature: string
    count: number
    branchKeys: string[]
    displayInfo: BranchDisplayInfo | null
  }>
  filteredBranches: OptimizationResult[] | RollingOptimizationResult['branches']
  filterGroups: FilterGroup[]      // Track each Apply action as a group
  filterHistory: FilterHistorySnapshot[]   // Stack for undo (stores both groups and branches)
  selectedFilterGroupId: string | null  // null = "All Runs", or specific group ID for filtering view

  // Phase 2b: Strategy List (parallel to Filter List)
  strategyBranches: OptimizationResult[] | RollingOptimizationResult['branches']  // Branches added directly to strategy (bypasses filtering)
  activeListView: 'filter' | 'strategy'  // Toggle state for card 3

  // Phase 3: Combined System
  combinedTree: FlowNode | null

  // Phase 4: Saved Shards Library
  savedShards: ShardListItem[]
  selectedShardIds: string[]
  loadedShardBranches: any[]  // Branches from selected shards (deduped)
  shardBotName: string
  shardWeighting: string  // 'equal' | 'inverse' | 'pro' | 'capped'
  shardCappedPercent: number  // For capped weighting: 0-100
  isSavingShard: boolean
  isLoadingShards: boolean

  // Actions - Phase 1
  loadChronologicalJob: (jobId: number) => Promise<void>
  loadRollingJob: (jobId: number) => Promise<void>
  loadSavedShard: (shardId: string) => Promise<void>
  unloadJob: (jobId: number) => void
  clearAllJobs: () => void
  isJobLoaded: (jobId: number) => boolean

  // Actions - Phase 1b: Strategy Job Loading
  loadJobAndAddToStrategy: (type: 'chronological' | 'rolling', jobId: number) => Promise<void>
  loadSavedShardAndAddToStrategy: (shardId: string) => Promise<void>
  unloadStrategyJob: (jobId: number) => void
  isStrategyJobLoaded: (jobId: number) => boolean

  // Actions - Phase 2
  setFilterMetric: (metric: ShardState['filterMetric']) => void
  setFilterTopX: (count: number) => void
  setFilterMode: (mode: 'overall' | 'perPattern') => void
  setFilterTopXPerPattern: (count: number) => void
  discoverPatterns: () => void
  applyFilters: () => void
  removeBranchFromFiltered: (jobId: number, branchId: string | number) => void
  clearFilteredBranches: () => void
  undoFilter: () => void
  removeFilterGroup: (groupId: string) => void
  setSelectedFilterGroup: (groupId: string | null) => void

  // Actions - Phase 2b: Strategy List
  addBranchesToStrategy: (branches: any[]) => void  // Add branches directly to strategy list
  removeBranchFromStrategy: (jobId: number, branchId: string | number) => void
  clearStrategyBranches: () => void
  setActiveListView: (view: 'filter' | 'strategy') => void

  // Actions - Phase 3
  generateCombinedTree: () => void
  clearCombinedTree: () => void
  saveToModel: () => Promise<string>

  // Actions - Phase 4: Saved Shards
  fetchSavedShards: () => Promise<void>
  saveShard: (name: string, description?: string) => Promise<string>
  deleteShard: (shardId: string) => Promise<void>
  selectShard: (shardId: string) => void
  deselectShard: (shardId: string) => void
  clearSelectedShards: () => void
  loadSelectedShards: () => Promise<void>
  setShardBotName: (name: string) => void
  setShardWeighting: (weighting: string) => void
  setShardCappedPercent: (percent: number) => void
  generateBotFromShards: () => FlowNode | null
}

export const useShardStore = create<ShardState>((set, get) => ({
  // Initial state
  loadedJobType: null,
  loadedJobIds: [],
  loadedJobs: {},
  allBranches: [],

  loadedStrategyJobs: {},
  loadedStrategyJobIds: [],

  filterMetric: 'sharpe',
  filterTopX: 10,
  filterMode: 'overall',
  filterTopXPerPattern: 5,  // Default: top 5 from each pattern
  discoveredPatterns: {},
  filteredBranches: [],
  filterGroups: [],
  filterHistory: [],
  selectedFilterGroupId: null,

  strategyBranches: [],
  activeListView: 'filter',

  combinedTree: null,

  // Phase 4: Saved Shards Library
  savedShards: [],
  selectedShardIds: [],
  loadedShardBranches: [],
  shardBotName: '',
  shardWeighting: 'equal',
  shardCappedPercent: 5,  // Default 5%
  isSavingShard: false,
  isLoadingShards: false,

  // Helper to combine branches from all loaded jobs
  _combineAllBranches: (): OptimizationResult[] | RollingOptimizationResult['branches'] => {
    const { loadedJobs, loadedJobIds } = get()
    const combined: any[] = []
    for (const jobId of loadedJobIds) {
      const jobData = loadedJobs[jobId]
      if (jobData) {
        combined.push(...jobData.branches)
      }
    }
    return combined
  },

  // Phase 1: Load chronological optimization job (additive)
  loadChronologicalJob: async (jobId: number) => {
    const { loadedJobType, loadedJobIds, loadedJobs, isJobLoaded } = get()

    // Skip if already loaded
    if (isJobLoaded(jobId)) {
      console.log('[ShardStore] Job already loaded:', jobId)
      return
    }

    // Check type compatibility
    if (loadedJobType !== null && loadedJobType !== 'chronological') {
      throw new Error('Cannot mix job types. Clear existing jobs first.')
    }

    try {
      const res = await fetch(`/api/optimization/${jobId}/results?sortBy=is_sharpe&order=desc&limit=10000`)
      if (!res.ok) {
        throw new Error('Failed to fetch chronological job results')
      }
      const allResults: OptimizationResult[] = await res.json()

      // Filter to only include branches that passed requirements
      const results = allResults.filter(branch => branch.passed === true)

      console.log(`[ShardStore] Loaded job ${jobId}: ${results.length} passing branches out of ${allResults.length} total`)

      // Fetch job metadata
      const jobsRes = await fetch('/api/optimization/jobs')
      if (!jobsRes.ok) {
        throw new Error('Failed to fetch job metadata')
      }
      const jobs: OptimizationJob[] = await jobsRes.json()
      const jobMetadata = jobs.find(j => j.id === jobId)

      if (!jobMetadata) {
        throw new Error('Job metadata not found')
      }

      // Add to loaded jobs
      const newLoadedJobs = {
        ...loadedJobs,
        [jobId]: { metadata: jobMetadata, branches: results }
      }
      const newLoadedJobIds = [...loadedJobIds, jobId]

      // Combine all branches
      const combined: OptimizationResult[] = []
      for (const id of newLoadedJobIds) {
        const jobData = newLoadedJobs[id]
        if (jobData) {
          combined.push(...(jobData.branches as OptimizationResult[]))
        }
      }

      set({
        loadedJobType: 'chronological',
        loadedJobIds: newLoadedJobIds,
        loadedJobs: newLoadedJobs,
        allBranches: combined,
        combinedTree: null // Reset combined tree when jobs change
      })
    } catch (err) {
      console.error('[ShardStore] Failed to load chronological job:', err)
      throw err
    }
  },

  // Phase 1: Load rolling optimization job (additive)
  loadRollingJob: async (jobId: number) => {
    const { loadedJobType, loadedJobIds, loadedJobs, isJobLoaded } = get()

    // Skip if already loaded
    if (isJobLoaded(jobId)) {
      console.log('[ShardStore] Job already loaded:', jobId)
      return
    }

    // Check type compatibility
    if (loadedJobType !== null && loadedJobType !== 'rolling') {
      throw new Error('Cannot mix job types. Clear existing jobs first.')
    }

    try {
      const res = await fetch(`/api/optimization/rolling/${jobId}`)
      if (!res.ok) {
        throw new Error('Failed to fetch rolling job results')
      }
      const data: RollingOptimizationResult = await res.json()

      // Add jobId to each branch for identification
      const branchesWithJobId = data.branches.map(b => ({ ...b, jobId }))

      // Add to loaded jobs
      const newLoadedJobs = {
        ...loadedJobs,
        [jobId]: { metadata: data.job, branches: branchesWithJobId }
      }
      const newLoadedJobIds = [...loadedJobIds, jobId]

      // Combine all branches from all loaded jobs
      const combined: Array<RollingOptimizationResult['branches'][number] & { jobId: number }> = []
      for (const id of newLoadedJobIds) {
        const jobData = newLoadedJobs[id]
        if (jobData) {
          combined.push(...(jobData.branches as typeof combined))
        }
      }

      set({
        loadedJobType: 'rolling',
        loadedJobIds: newLoadedJobIds,
        loadedJobs: newLoadedJobs as Record<number, LoadedJobData>,
        allBranches: combined,
        combinedTree: null // Reset combined tree when jobs change
      })
    } catch (err) {
      console.error('[ShardStore] Failed to load rolling job:', err)
      throw err
    }
  },

  // Phase 1: Unload a specific job (filter jobs only, not strategy jobs)
  unloadJob: (jobId: number) => {
    const { loadedJobIds, loadedJobs, loadedJobType } = get()

    // Remove from loaded jobs
    const newLoadedJobIds = loadedJobIds.filter(id => id !== jobId)
    const { [jobId]: removed, ...newLoadedJobs } = loadedJobs

    // If no jobs left, reset type
    const newJobType = newLoadedJobIds.length === 0 ? null : loadedJobType

    // Recombine branches
    const combined: any[] = []
    for (const id of newLoadedJobIds) {
      const jobData = newLoadedJobs[id]
      if (jobData) {
        combined.push(...jobData.branches)
      }
    }

    set({
      loadedJobType: newJobType,
      loadedJobIds: newLoadedJobIds,
      loadedJobs: newLoadedJobs,
      allBranches: combined,
      combinedTree: null // Reset combined tree when jobs change
    })

    console.log(`[ShardStore] Unloaded filter job ${jobId}`)
  },

  // Phase 1: Clear all loaded jobs (filter jobs only, not strategy jobs)
  clearAllJobs: () => {
    set({
      loadedJobType: null,
      loadedJobIds: [],
      loadedJobs: {},
      allBranches: [],
      filteredBranches: [],
      combinedTree: null
    })
  },

  // Phase 1b: Load job and add to strategy (shows in Card 4, NOT Card 1)
  loadJobAndAddToStrategy: async (type: 'chronological' | 'rolling', jobId: number) => {
    const { loadedStrategyJobIds, loadedStrategyJobs, strategyBranches } = get()

    // Skip if already loaded as strategy job
    if (loadedStrategyJobIds.includes(jobId)) {
      console.log('[ShardStore] Strategy job already loaded:', jobId)
      return
    }

    // Helper to get branch key
    const getBranchKey = (branch: any): string => {
      return `${branch.jobId}-${branch.branchId}`
    }

    try {
      let metadata: any
      let branches: any[]

      if (type === 'chronological') {
        // Fetch chronological job
        const res = await fetch(`/api/optimization/${jobId}/results?sortBy=is_sharpe&order=desc&limit=10000`)
        if (!res.ok) {
          throw new Error('Failed to fetch chronological job results')
        }
        const data = await res.json()

        // Handle both response formats: {branches: [...]} or just [...]
        branches = data.branches || data

        if (!Array.isArray(branches)) {
          console.error('[ShardStore] Unexpected response format:', data)
          throw new Error('Invalid response format - expected array of branches')
        }

        // Get metadata
        const metaRes = await fetch(`/api/optimization/jobs`)
        if (!metaRes.ok) {
          throw new Error('Failed to fetch job metadata')
        }
        const allJobs: OptimizationJob[] = await metaRes.json()
        metadata = allJobs.find(j => j.id === jobId)

        if (!metadata) {
          throw new Error(`Job ${jobId} not found in metadata`)
        }

        // Tag branches with jobId
        branches = branches.map(b => ({ ...b, jobId }))
      } else {
        // Fetch rolling job
        const res = await fetch(`/api/optimization/rolling/jobs/${jobId}/results`)
        if (!res.ok) {
          throw new Error('Failed to fetch rolling job results')
        }
        const data: any = await res.json()

        // Handle both response formats: {branches: [...]} or just [...]
        branches = data.branches || data

        if (!Array.isArray(branches)) {
          console.error('[ShardStore] Unexpected rolling response format:', data)
          throw new Error('Invalid response format - expected array of branches')
        }

        // Get metadata
        const metaRes = await fetch(`/api/optimization/rolling/jobs`)
        if (!metaRes.ok) {
          throw new Error('Failed to fetch rolling job metadata')
        }
        const allJobs: RollingJob[] = await metaRes.json()
        metadata = allJobs.find(j => j.id === jobId)

        if (!metadata) {
          throw new Error(`Rolling job ${jobId} not found in metadata`)
        }

        // Tag branches with jobId
        branches = branches.map(b => ({ ...b, jobId }))
      }

      console.log(`[ShardStore] Loaded strategy job ${jobId}: ${branches.length} branches`)

      // Add to loadedStrategyJobs
      const updatedStrategyJobs = {
        ...loadedStrategyJobs,
        [jobId]: { metadata, branches }
      }

      const updatedStrategyJobIds = [...loadedStrategyJobIds, jobId]

      // De-duplicate branches - only add branches not already in strategy list
      const existingKeys = new Set(strategyBranches.map(b => getBranchKey(b)))
      const newBranches = branches.filter(b => !existingKeys.has(getBranchKey(b)))

      // Deep copy new branches to avoid mutations
      const copiedBranches = newBranches.map(b => JSON.parse(JSON.stringify(b)))

      // Append to strategy branches
      const updatedStrategy = [...strategyBranches, ...copiedBranches] as typeof strategyBranches

      set({
        loadedStrategyJobs: updatedStrategyJobs,
        loadedStrategyJobIds: updatedStrategyJobIds,
        strategyBranches: updatedStrategy
      })

      console.log(`[ShardStore] Added ${copiedBranches.length} branches to strategy (total: ${updatedStrategy.length})`)
      console.log(`[ShardStore] Loaded strategy jobs: ${updatedStrategyJobIds.length}`)
    } catch (err) {
      console.error('[ShardStore] Failed to load job and add to strategy:', err)
      throw err
    }
  },

  // Phase 1: Load saved shard for filtering (shows in Card 2)
  loadSavedShard: async (shardId: string) => {
    const { loadedJobType, loadedJobIds, loadedJobs } = get()
    const userId = useAuthStore.getState().userId

    if (!userId) {
      throw new Error('Not logged in')
    }

    // Extract numeric ID from shard ID format (e.g., "shard-123" -> 123)
    const numericId = parseInt(shardId.split('-')[1] || shardId, 10)

    // Skip if already loaded
    if (loadedJobIds.includes(numericId)) {
      console.log('[ShardStore] Saved shard already loaded:', shardId)
      return
    }

    // Check type consistency
    if (loadedJobType !== null && loadedJobType !== 'chronological') {
      throw new Error('Cannot mix shard types. Clear loaded shards first.')
    }

    try {
      // Fetch saved shard
      const res = await fetch(`/api/shards/${shardId}?userId=${userId}`)
      if (!res.ok) {
        throw new Error('Failed to fetch saved shard')
      }
      const data: { shard: SavedShard } = await res.json()

      const branches = data.shard.branches || []

      // Tag branches with jobId
      const taggedBranches = branches.map(b => ({ ...b, jobId: numericId }))

      // Add to loaded jobs
      const newLoadedJobs = {
        ...loadedJobs,
        [numericId]: {
          metadata: {
            id: numericId,
            botName: data.shard.name,
            createdAt: data.shard.createdAt
          },
          branches: taggedBranches
        }
      }

      const newLoadedJobIds = [...loadedJobIds, numericId]

      // Combine all branches
      const combined: any[] = []
      for (const id of newLoadedJobIds) {
        const jobData = newLoadedJobs[id]
        if (jobData) {
          combined.push(...(jobData.branches as typeof combined))
        }
      }

      set({
        loadedJobType: 'chronological',
        loadedJobIds: newLoadedJobIds,
        loadedJobs: newLoadedJobs as Record<number, LoadedJobData>,
        allBranches: combined,
        combinedTree: null
      })

      console.log(`[ShardStore] Loaded saved shard ${shardId} (${taggedBranches.length} branches)`)
    } catch (err) {
      console.error('[ShardStore] Failed to load saved shard:', err)
      throw err
    }
  },

  // Phase 1b: Load saved shard and add to strategy (shows in Card 4)
  loadSavedShardAndAddToStrategy: async (shardId: string) => {
    const { loadedStrategyJobIds, loadedStrategyJobs, strategyBranches } = get()
    const userId = useAuthStore.getState().userId

    if (!userId) {
      throw new Error('Not logged in')
    }

    // Extract numeric ID from shard ID format
    const numericId = parseInt(shardId.split('-')[1] || shardId, 10)

    // Skip if already loaded as strategy job
    if (loadedStrategyJobIds.includes(numericId)) {
      console.log('[ShardStore] Saved shard already loaded as strategy:', shardId)
      return
    }

    // Helper to get branch key
    const getBranchKey = (branch: any): string => {
      return `${branch.jobId}-${branch.branchId}`
    }

    try {
      // Fetch saved shard
      const res = await fetch(`/api/shards/${shardId}?userId=${userId}`)
      if (!res.ok) {
        throw new Error('Failed to fetch saved shard')
      }
      const data: { shard: SavedShard } = await res.json()

      const branches = data.shard.branches || []

      // Tag branches with jobId
      const taggedBranches = branches.map(b => ({ ...b, jobId: numericId }))

      // Add to loaded strategy jobs
      const updatedStrategyJobs = {
        ...loadedStrategyJobs,
        [numericId]: {
          metadata: {
            id: numericId,
            botName: data.shard.name,
            createdAt: data.shard.createdAt
          },
          branches: taggedBranches
        }
      }

      const updatedStrategyJobIds = [...loadedStrategyJobIds, numericId]

      // Deep copy branches to avoid reference sharing
      const copiedBranches = taggedBranches.map(b => JSON.parse(JSON.stringify(b)))

      // Filter out duplicates from strategy branches
      const existingKeys = new Set(strategyBranches.map(b => getBranchKey(b)))
      const newBranches = copiedBranches.filter(b => !existingKeys.has(getBranchKey(b)))

      // Append to strategy branches
      const updatedStrategy = [...strategyBranches, ...newBranches] as typeof strategyBranches

      set({
        loadedStrategyJobs: updatedStrategyJobs,
        loadedStrategyJobIds: updatedStrategyJobIds,
        strategyBranches: updatedStrategy
      })

      console.log(`[ShardStore] Added saved shard ${shardId} to strategy (${newBranches.length} new branches, total: ${updatedStrategy.length})`)
      console.log(`[ShardStore] Loaded strategy jobs: ${updatedStrategyJobIds.length}`)
    } catch (err) {
      console.error('[ShardStore] Failed to load saved shard and add to strategy:', err)
      throw err
    }
  },

  // Phase 1: Check if a job is loaded
  isJobLoaded: (jobId: number) => {
    return get().loadedJobIds.includes(jobId)
  },

  // Phase 1b: Unload strategy job (removes from Card 4 and removes branches from strategy list)
  unloadStrategyJob: (jobId: number) => {
    const { loadedStrategyJobs, loadedStrategyJobIds, strategyBranches } = get()

    // Check if job is loaded
    if (!loadedStrategyJobIds.includes(jobId)) {
      console.log('[ShardStore] Strategy job not loaded:', jobId)
      return
    }

    // Helper to get branch key
    const getBranchKey = (branch: any): string => {
      return `${branch.jobId}-${branch.branchId}`
    }

    // Get branches from this job
    const jobData = loadedStrategyJobs[jobId]
    if (!jobData) {
      console.warn('[ShardStore] Job data not found for strategy job:', jobId)
      return
    }

    const jobBranchKeys = new Set(
      jobData.branches.map((b: any) => getBranchKey(b))
    )

    // Remove branches from strategy list
    const updatedStrategy = strategyBranches.filter(
      b => !jobBranchKeys.has(getBranchKey(b))
    )

    // Remove from loaded strategy jobs
    const updatedStrategyJobs = { ...loadedStrategyJobs }
    delete updatedStrategyJobs[jobId]

    const updatedStrategyJobIds = loadedStrategyJobIds.filter(id => id !== jobId)

    set({
      loadedStrategyJobs: updatedStrategyJobs,
      loadedStrategyJobIds: updatedStrategyJobIds,
      strategyBranches: updatedStrategy as typeof strategyBranches
    })

    console.log(`[ShardStore] Unloaded strategy job ${jobId}`)
    console.log(`[ShardStore] Remaining strategy branches: ${updatedStrategy.length}`)
    console.log(`[ShardStore] Remaining strategy jobs: ${updatedStrategyJobIds.length}`)
  },

  // Phase 1b: Check if a strategy job is loaded
  isStrategyJobLoaded: (jobId: number) => {
    return get().loadedStrategyJobIds.includes(jobId)
  },

  // Phase 2: Set filter metric (no auto-apply - user clicks button)
  setFilterMetric: (metric) => {
    set({ filterMetric: metric })
  },

  // Phase 2: Set top X count (no auto-apply - user clicks button)
  // Allow 0 for clearing input while typing, will reset to 1 on blur
  setFilterTopX: (count) => {
    set({ filterTopX: Math.max(0, count) })
  },

  // Phase 2: Set filter mode (overall or per-pattern)
  setFilterMode: (mode) => {
    set({ filterMode: mode })
    // Auto-discover patterns when switching to perPattern mode
    if (mode === 'perPattern') {
      get().discoverPatterns()
    }
  },

  // Phase 2: Set top X per pattern (for perPattern mode)
  setFilterTopXPerPattern: (count) => {
    set({ filterTopXPerPattern: Math.max(1, count) })
  },

  // Phase 2: Discover unique patterns in loaded branches
  discoverPatterns: () => {
    const { allBranches, loadedJobType } = get()

    const patterns: Record<string, {
      signature: string
      count: number
      branchKeys: string[]
      displayInfo: BranchDisplayInfo | null
    }> = {}

    for (const branch of allBranches) {
      const b = branch as any
      // Get tree signature
      const treeJson = loadedJobType === 'chronological' ? b.treeJson : undefined
      const signature = getTreeSignature(treeJson)

      if (!signature) continue

      const branchKey = `${b.jobId}-${b.branchId}`

      if (!patterns[signature]) {
        // Extract display info using existing helper (defined below)
        const displayInfo = extractBranchDisplayInfo(treeJson)
        patterns[signature] = {
          signature,
          count: 0,
          branchKeys: [],
          displayInfo
        }
      }

      patterns[signature].count++
      patterns[signature].branchKeys.push(branchKey)
    }

    set({ discoveredPatterns: patterns })
    console.log(`[ShardStore] Discovered ${Object.keys(patterns).length} unique patterns from ${allBranches.length} branches`)
  },

  // Phase 2: Apply filters to branches (ADDITIVE - appends to existing filtered branches)
  applyFilters: () => {
    const { allBranches, filterMetric, filterTopX, filterTopXPerPattern, filterMode, loadedJobType, filteredBranches, filterGroups, filterHistory, loadedJobs, loadedJobIds, discoveredPatterns } = get()

    if (allBranches.length === 0) {
      return
    }

    // Get job name from loaded jobs
    const getJobName = (): string => {
      if (loadedJobIds.length === 0) return 'Unknown'
      if (loadedJobIds.length === 1) {
        const job = loadedJobs[loadedJobIds[0]]
        return job?.metadata?.botName || job?.metadata?.name || `Job #${loadedJobIds[0]}`
      }
      return `${loadedJobIds.length} Jobs`
    }

    // Helper function to extract metric value
    const getMetricValue = (branch: any): number | null => {
      if (loadedJobType === 'chronological') {
        return branch.isMetrics?.[filterMetric] ?? null
      } else if (loadedJobType === 'rolling') {
        return branch.isOosMetrics?.IS ?? null
      }
      return null
    }

    // Helper to get branch key
    const getBranchKey = (branch: any): string => {
      return `${branch.jobId}-${branch.branchId}`
    }

    let topBranches: any[]
    let perPatternConfigUsed: Record<string, { count: number; selected: number; example: string }> | undefined

    if (filterMode === 'overall') {
      // EXISTING LOGIC: Sort all branches together, take top X
      const sorted = [...allBranches].sort((a, b) => {
        const aValue = getMetricValue(a)
        const bValue = getMetricValue(b)
        return (bValue || -Infinity) - (aValue || -Infinity)
      })
      topBranches = sorted.slice(0, filterTopX)
    } else {
      // NEW LOGIC: Per-pattern mode - group by signature, take top X from each
      // Group branches by signature
      const branchesBySignature: Record<string, any[]> = {}

      for (const branch of allBranches) {
        const b = branch as any
        const treeJson = loadedJobType === 'chronological' ? b.treeJson : undefined
        const signature = getTreeSignature(treeJson)

        if (!signature) continue

        if (!branchesBySignature[signature]) {
          branchesBySignature[signature] = []
        }
        branchesBySignature[signature].push(branch)
      }

      // For each pattern, take top X by metric
      topBranches = []
      perPatternConfigUsed = {}

      for (const [signature, branches] of Object.entries(branchesBySignature)) {
        const sortedBranches = branches.sort((a, b) => {
          const aValue = getMetricValue(a)
          const bValue = getMetricValue(b)
          return (bValue || -Infinity) - (aValue || -Infinity)
        })

        const topFromPattern = sortedBranches.slice(0, filterTopXPerPattern)
        topBranches.push(...topFromPattern)

        // Get display info for this pattern
        const patternInfo = discoveredPatterns[signature]
        const displayInfo = patternInfo?.displayInfo
        const exampleStr = displayInfo
          ? `${displayInfo.conditions.join(', ')} → ${displayInfo.positions.join(', ')}`
          : signature.substring(0, 20)

        perPatternConfigUsed[signature] = {
          count: branches.length,
          selected: topFromPattern.length,
          example: exampleStr
        }
      }
    }

    // Get ALL branch keys for reference counting (even if already in list)
    const allSelectedKeys = topBranches.map(b => getBranchKey(b))

    // De-duplicate: filter out branches already in filteredBranches (for display)
    const existingKeys = new Set(filteredBranches.map(b => getBranchKey(b)))
    const newBranches = topBranches.filter(b => !existingKeys.has(getBranchKey(b)))

    // Save current state for undo (both groups and branches)
    const previousSnapshot: FilterHistorySnapshot = {
      filterGroups: [...filterGroups],
      filteredBranches: [...filteredBranches] as typeof filteredBranches
    }

    // Create new filter group with ALL selected keys (for reference counting)
    const newGroup: FilterGroup = {
      id: `group-${Date.now()}`,
      jobName: getJobName(),
      jobId: loadedJobIds[0] || 0,
      metric: filterMetric,
      topX: filterMode === 'overall' ? filterTopX : filterTopXPerPattern,
      addedAt: Date.now(),
      branchKeys: allSelectedKeys,  // ALL branches, not just new ones
      mode: filterMode,
      perPatternConfig: perPatternConfigUsed ? {
        patternCount: Object.keys(perPatternConfigUsed).length,
        topXPerPattern: filterTopXPerPattern,
        patterns: perPatternConfigUsed
      } : undefined
    }

    // Deep copy only NEW branches so they persist independently
    const copiedBranches = newBranches.map(b => JSON.parse(JSON.stringify(b)))

    // Append new branches to existing filtered branches
    const updatedFiltered = [...filteredBranches, ...copiedBranches] as typeof filteredBranches

    set({
      filteredBranches: updatedFiltered,
      filterGroups: [...filterGroups, newGroup],
      filterHistory: [...filterHistory, previousSnapshot]
    })

    const modeDesc = filterMode === 'overall'
      ? `Top ${filterTopX} ${filterMetric} (overall)`
      : `Top ${filterTopXPerPattern} ${filterMetric} per pattern (${Object.keys(perPatternConfigUsed || {}).length} patterns)`

    console.log(`[ShardStore] Added group "${newGroup.jobName} - ${modeDesc}": ${copiedBranches.length} new branches (${allSelectedKeys.length} total refs). Total displayed: ${updatedFiltered.length}`)
  },

  // Phase 2: Remove a specific branch from filtered results
  removeBranchFromFiltered: (jobId: number, branchId: string | number) => {
    const { filteredBranches } = get()

    // Filtered branches are deep copies with jobId already on them
    const newFiltered = filteredBranches.filter(branch => {
      const b = branch as any
      return !(b.jobId === jobId && b.branchId === branchId)
    }) as typeof filteredBranches

    set({ filteredBranches: newFiltered })
  },

  // Phase 2: Clear all filtered branches
  clearFilteredBranches: () => {
    const { filterGroups, filteredBranches, filterHistory } = get()
    // Save current state for undo before clearing
    const previousSnapshot: FilterHistorySnapshot = {
      filterGroups: [...filterGroups],
      filteredBranches: [...filteredBranches] as typeof filteredBranches
    }
    set({
      filteredBranches: [],
      filterGroups: [],
      filterHistory: [...filterHistory, previousSnapshot]
    })
  },

  // Phase 2: Undo the last filter action
  undoFilter: () => {
    const { filterHistory } = get()

    if (filterHistory.length === 0) {
      console.log('[ShardStore] Nothing to undo')
      return
    }

    // Pop last snapshot from history
    const previousSnapshot = filterHistory[filterHistory.length - 1]
    const newHistory = filterHistory.slice(0, -1)

    // Restore both groups and branches from snapshot
    set({
      filterGroups: previousSnapshot.filterGroups,
      filteredBranches: previousSnapshot.filteredBranches,
      filterHistory: newHistory
    })

    console.log(`[ShardStore] Undo: restored ${previousSnapshot.filterGroups.length} groups, ${previousSnapshot.filteredBranches.length} branches`)
  },

  // Phase 2: Remove a specific filter group (with reference counting)
  removeFilterGroup: (groupId: string) => {
    const { filterGroups, filteredBranches, filterHistory, selectedFilterGroupId } = get()

    const groupToRemove = filterGroups.find(g => g.id === groupId)
    if (!groupToRemove) {
      console.log('[ShardStore] Group not found:', groupId)
      return
    }

    // Save current state for undo
    const previousSnapshot: FilterHistorySnapshot = {
      filterGroups: [...filterGroups],
      filteredBranches: [...filteredBranches] as typeof filteredBranches
    }

    // Helper to get branch key from filtered branch
    const getBranchKey = (branch: any): string => {
      return `${branch.jobId}-${branch.branchId}`
    }

    // Get remaining groups after removal
    const remainingGroups = filterGroups.filter(g => g.id !== groupId)

    // Build set of keys still referenced by other groups
    const stillReferencedKeys = new Set(remainingGroups.flatMap(g => g.branchKeys))

    // Only remove branches that have NO remaining references
    const newFiltered = filteredBranches.filter(b =>
      stillReferencedKeys.has(getBranchKey(b))
    ) as typeof filteredBranches

    const removedCount = filteredBranches.length - newFiltered.length

    set({
      filterGroups: remainingGroups,
      filteredBranches: newFiltered,
      filterHistory: [...filterHistory, previousSnapshot],
      // Reset selection if removed group was selected
      selectedFilterGroupId: selectedFilterGroupId === groupId ? null : selectedFilterGroupId
    })

    console.log(`[ShardStore] Removed group "${groupToRemove.jobName} - Top ${groupToRemove.topX} ${groupToRemove.metric}": ${removedCount} branches removed (${groupToRemove.branchKeys.length} refs)`)
  },

  // Phase 2: Set selected filter group for dropdown view
  setSelectedFilterGroup: (groupId: string | null) => {
    set({ selectedFilterGroupId: groupId })
  },

  // Phase 2b: Add branches directly to strategy list (skips filtering)
  addBranchesToStrategy: (branches: any[]) => {
    const { strategyBranches } = get()

    // Helper to get branch key
    const getBranchKey = (branch: any): string => {
      return `${branch.jobId}-${branch.branchId}`
    }

    // De-duplicate - only add branches not already in strategy list
    const existingKeys = new Set(strategyBranches.map(b => getBranchKey(b)))
    const newBranches = branches.filter(b => !existingKeys.has(getBranchKey(b)))

    // Deep copy new branches to avoid mutations
    const copiedBranches = newBranches.map(b => JSON.parse(JSON.stringify(b)))

    // Append to strategy branches
    const updatedStrategy = [...strategyBranches, ...copiedBranches] as typeof strategyBranches

    set({ strategyBranches: updatedStrategy })

    console.log(`[ShardStore] Added ${copiedBranches.length} branches to strategy (total: ${updatedStrategy.length})`)
  },

  // Phase 2b: Remove a branch from strategy list
  removeBranchFromStrategy: (jobId: number, branchId: string | number) => {
    const { strategyBranches } = get()

    const newStrategy = strategyBranches.filter((b: any) =>
      !(b.jobId === jobId && b.branchId === branchId)
    ) as typeof strategyBranches

    set({ strategyBranches: newStrategy })

    console.log(`[ShardStore] Removed branch ${jobId}-${branchId} from strategy (remaining: ${newStrategy.length})`)
  },

  // Phase 2b: Clear all strategy branches
  clearStrategyBranches: () => {
    set({ strategyBranches: [] })
    console.log('[ShardStore] Cleared all strategy branches')
  },

  // Phase 2b: Set active list view (filter or strategy)
  setActiveListView: (view: 'filter' | 'strategy') => {
    set({ activeListView: view })
    console.log(`[ShardStore] Switched to ${view} list view`)
  },

  // Phase 3: Generate combined tree from filtered branches
  generateCombinedTree: () => {
    const { filteredBranches, loadedJobType, loadedJobs, loadedJobIds, filterMetric, filterTopX } = get()

    if (filteredBranches.length === 0) {
      console.warn('[ShardStore] Cannot generate tree: no filtered branches')
      return
    }

    if (loadedJobIds.length === 0) {
      console.warn('[ShardStore] Cannot generate tree: no jobs loaded')
      return
    }

    if (!loadedJobType) {
      console.warn('[ShardStore] Cannot generate tree: no job type')
      return
    }

    // Build job name from all loaded jobs
    const jobNames = loadedJobIds.map(id => {
      const job = loadedJobs[id]
      return job?.metadata?.botName || `Job ${id}`
    })
    const jobName = jobNames.length === 1
      ? jobNames[0]
      : `${jobNames.length} Jobs`

    // Build the combined tree
    const tree = buildShardTree(
      filteredBranches,
      loadedJobType,
      jobName,
      filterMetric,
      filterTopX
    )

    set({ combinedTree: tree })
    console.log('[ShardStore] Generated combined tree:', tree)
  },

  // Phase 3: Clear combined tree
  clearCombinedTree: () => {
    set({ combinedTree: null })
  },

  // Phase 3: Save combined tree to Model tab as a new bot
  saveToModel: async () => {
    const { combinedTree, loadedJobs, loadedJobIds, filterMetric, filterTopX } = get()

    if (!combinedTree) {
      throw new Error('No combined tree to save')
    }

    // Get current user ID
    const userId = useAuthStore.getState().userId
    if (!userId) {
      throw new Error('Not logged in')
    }

    // Create SavedSystem object
    const botId = `shard-${Date.now()}`

    // Build job name for tags
    const jobNames = loadedJobIds.map(id => {
      const job = loadedJobs[id]
      return job?.metadata?.botName || `Job ${id}`
    })
    const jobName = jobNames.join(', ')

    const savedSystem: SavedSystem = {
      id: botId,
      name: combinedTree.title, // Use the tree's title (already contains "Shard: ..." prefix)
      builderId: userId,
      payload: combinedTree,
      visibility: 'private',
      createdAt: Date.now(),
      tags: ['Shard', `Top${filterTopX}`, filterMetric, jobName]
    }

    // Save to database via API
    const result = await createBotInApi(userId, savedSystem)

    if (!result) {
      throw new Error('Failed to save to database')
    }

    // Add to bot store so it appears in Model tab
    useBotStore.getState().addBot({
      id: botId,
      history: [],
      historyIndex: -1,
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
      tabContext: 'Model'
    })

    console.log('[ShardStore] Saved to Model tab:', botId)
    return botId
  },

  // Phase 4: Fetch saved shards for current user
  fetchSavedShards: async () => {
    const userId = useAuthStore.getState().userId
    if (!userId) {
      console.warn('[ShardStore] Cannot fetch shards: not logged in')
      return
    }

    set({ isLoadingShards: true })

    try {
      const res = await fetch(`/api/shards?userId=${userId}`)
      if (!res.ok) {
        throw new Error('Failed to fetch shards')
      }
      const data = await res.json()
      set({ savedShards: data.shards || [] })
      console.log('[ShardStore] Fetched shards:', data.shards?.length || 0)
    } catch (err) {
      console.error('[ShardStore] Failed to fetch shards:', err)
    } finally {
      set({ isLoadingShards: false })
    }
  },

  // Phase 4: Save current filtered branches as a shard
  saveShard: async (name: string, description?: string) => {
    const { filteredBranches, loadedJobIds, loadedJobType, filterGroups, filterMetric, filterTopX } = get()
    const userId = useAuthStore.getState().userId

    console.log('[ShardStore] Attempting to save shard with userId:', userId)

    if (!userId) {
      throw new Error('Not logged in - please log in to save shards')
    }

    if (filteredBranches.length === 0) {
      throw new Error('No branches to save')
    }

    set({ isSavingShard: true })

    try {
      // Build filter summary from filter groups
      const filterSummary = filterGroups.length > 0
        ? filterGroups.map(g => `Top ${g.topX} ${g.metric}`).join(', ')
        : `Top ${filterTopX} ${filterMetric}`

      const payload = {
        ownerId: userId,
        name,
        description,
        sourceJobIds: loadedJobIds,
        loadedJobType: loadedJobType || 'chronological',
        branches: filteredBranches,
        filterSummary
      }

      console.log('[ShardStore] Saving shard:', {
        name,
        branchCount: filteredBranches.length,
        sourceJobIds: loadedJobIds,
        payloadSize: JSON.stringify(payload).length
      })

      const res = await fetch('/api/shards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!res.ok) {
        // Read response body once
        const responseText = await res.text()
        let errorMessage = 'Failed to save shard'

        try {
          // Try to parse as JSON
          const errorData = JSON.parse(responseText)
          errorMessage = errorData.error || errorMessage
        } catch (parseError) {
          // If JSON parse fails, log the raw text response
          console.error('[ShardStore] Non-JSON error response:', responseText.substring(0, 300))
          errorMessage = `Server returned non-JSON response (status ${res.status}). Check console for details.`
        }
        throw new Error(errorMessage)
      }

      const data = await res.json()
      console.log('[ShardStore] Saved shard:', data.id)

      // Refresh saved shards list
      await get().fetchSavedShards()

      return data.id
    } finally {
      set({ isSavingShard: false })
    }
  },

  // Phase 4: Delete a saved shard
  deleteShard: async (shardId: string) => {
    const userId = useAuthStore.getState().userId
    if (!userId) {
      throw new Error('Not logged in')
    }

    const res = await fetch(`/api/shards/${shardId}?ownerId=${userId}`, {
      method: 'DELETE'
    })

    if (!res.ok) {
      const errorData = await res.json()
      throw new Error(errorData.error || 'Failed to delete shard')
    }

    console.log('[ShardStore] Deleted shard:', shardId)

    // Update local state
    set(state => ({
      savedShards: state.savedShards.filter(s => s.id !== shardId),
      selectedShardIds: state.selectedShardIds.filter(id => id !== shardId)
    }))
  },

  // Phase 4: Select a shard for combining
  selectShard: (shardId: string) => {
    set(state => ({
      selectedShardIds: state.selectedShardIds.includes(shardId)
        ? state.selectedShardIds
        : [...state.selectedShardIds, shardId]
    }))
  },

  // Phase 4: Deselect a shard
  deselectShard: (shardId: string) => {
    set(state => ({
      selectedShardIds: state.selectedShardIds.filter(id => id !== shardId)
    }))
  },

  // Phase 4: Clear shard selection
  clearSelectedShards: () => {
    set({ selectedShardIds: [], loadedShardBranches: [] })
  },

  // Phase 4: Load full branch data for selected shards and dedupe
  loadSelectedShards: async () => {
    const { selectedShardIds } = get()
    const userId = useAuthStore.getState().userId

    if (!userId) {
      console.warn('[ShardStore] Cannot load shards: not logged in')
      return
    }

    if (selectedShardIds.length === 0) {
      set({ loadedShardBranches: [] })
      return
    }

    set({ isLoadingShards: true })

    try {
      // Fetch full data for each selected shard
      const allBranches: any[] = []
      const seenKeys = new Set<string>()

      for (const shardId of selectedShardIds) {
        const res = await fetch(`/api/shards/${shardId}?userId=${userId}`)
        if (!res.ok) {
          console.warn(`[ShardStore] Failed to fetch shard ${shardId}`)
          continue
        }
        const data: { shard: SavedShard } = await res.json()

        // Add branches, deduplicating by jobId-branchId
        for (const branch of data.shard.branches) {
          const key = `${branch.jobId}-${branch.branchId}`
          if (!seenKeys.has(key)) {
            seenKeys.add(key)
            allBranches.push(branch)
          }
        }
      }

      set({ loadedShardBranches: allBranches })
      console.log(`[ShardStore] Loaded ${allBranches.length} unique branches from ${selectedShardIds.length} shards`)
    } catch (err) {
      console.error('[ShardStore] Failed to load shard branches:', err)
    } finally {
      set({ isLoadingShards: false })
    }
  },

  // Phase 4: Set bot name for generation
  setShardBotName: (name: string) => {
    set({ shardBotName: name })
  },

  // Phase 4: Set weighting mode for generation
  setShardWeighting: (weighting: string) => {
    set({ shardWeighting: weighting })
  },

  // Phase 4: Set capped percentage for capped weighting
  setShardCappedPercent: (percent: number) => {
    set({ shardCappedPercent: Math.max(0, Math.min(100, percent)) })
  },

  // Phase 4: Generate bot tree from selected shards with chosen weighting
  generateBotFromShards: () => {
    const { loadedShardBranches, shardBotName, shardWeighting, shardCappedPercent } = get()

    if (loadedShardBranches.length === 0) {
      console.warn('[ShardStore] No branches loaded to generate bot')
      return null
    }

    const botName = shardBotName.trim() || 'Shard Bot'
    const branchCount = loadedShardBranches.length

    // Parse weighting mode: 'equal', 'inverse', 'pro', 'capped'
    const weightMode = shardWeighting as 'equal' | 'inverse' | 'pro' | 'capped'

    // Create root node with selected weighting
    const root: FlowNode = {
      id: `root-${Date.now()}`,
      kind: 'basic',
      title: botName,
      weighting: weightMode,
      // For inverse/pro volatility, set default vol window
      ...(weightMode === 'inverse' || weightMode === 'pro' ? { volWindow: 20 } : {}),
      // For capped weighting, set the fallback to 'Empty' (no remainder allocation)
      ...(weightMode === 'capped' ? { cappedFallback: 'Empty' } : {}),
      children: {
        next: loadedShardBranches.map((branch, idx) => {
          // If branch has full tree JSON, use it
          if (branch.treeJson) {
            try {
              const tree = JSON.parse(branch.treeJson)
              // Ensure unique IDs by prefixing
              const prefixedTree = prefixNodeIds(tree, `b${idx}-`)
              // For capped weighting, set the cap percentage on the child's window property
              // QuantNexus uses child.window to determine cap % per branch
              if (weightMode === 'capped') {
                prefixedTree.window = shardCappedPercent
              }
              return prefixedTree
            } catch {
              // Fall back to basic node
            }
          }

          // Create a meaningful fallback node from branch metadata
          // Use parameterLabel as title (shows the branch parameters like "RSI(14) > 70")
          // Use positionTicker if available for positions
          const branchTitle = branch.parameterLabel || `Branch ${branch.branchId}`
          const positions = branch.positionTicker ? [branch.positionTicker] : ['SPY']
          const timestamp = Date.now()

          // Create a basic wrapper node with position child
          const fallbackNode: FlowNode = {
            id: `branch-${idx}-${timestamp}`,
            kind: 'basic' as const,
            title: branchTitle,
            weighting: 'equal' as const,
            children: {
              next: [{
                id: `pos-${idx}-${timestamp}`,
                kind: 'position' as const,
                title: 'Positions',
                positions,
                weighting: 'equal' as const,
                children: {}
              }]
            }
          }
          // For capped weighting, set cap % on the branch node
          if (weightMode === 'capped') {
            fallbackNode.window = shardCappedPercent
          }
          return fallbackNode
        })
      }
    }

    console.log('[ShardStore] Generated bot tree with', branchCount, 'branches, weighting:', weightMode,
      weightMode === 'capped' ? `(${shardCappedPercent}% cap per branch)` : '')
    return root
  }
}))

// Helper function to prefix all node IDs in a tree (for uniqueness when combining)
function prefixNodeIds(node: FlowNode, prefix: string): FlowNode {
  const newNode: FlowNode = {
    ...node,
    id: prefix + node.id,
    children: {}
  }

  if (node.children) {
    for (const [slot, children] of Object.entries(node.children)) {
      if (Array.isArray(children)) {
        newNode.children[slot as keyof typeof newNode.children] = children.map(child =>
          child ? prefixNodeIds(child, prefix) : null
        )
      }
    }
  }

  return newNode
}
