// Store for Shards tab state management

import { create } from 'zustand'
import type { OptimizationJob, OptimizationResult } from '@/types/optimizationJob'
import type { RollingOptimizationResult, SavedSystem } from '@/types/bot'
import type { RollingJob } from '@/features/optimization/hooks/useRollingJobs'
import type { FlowNode } from '@/types/flowNode'
import { buildShardTree } from '@/features/shards/treeBuilder'
import { createBotInApi } from '@/features/bots/api'
import { useAuthStore } from './useAuthStore'
import { useBotStore } from './useBotStore'

interface ShardState {
  // Phase 1: Job Loading
  loadedJobType: 'chronological' | 'rolling' | null
  loadedJobId: number | null
  loadedJobMetadata: OptimizationJob | RollingJob | null
  allBranches: OptimizationResult[] | RollingOptimizationResult['branches']

  // Phase 2: Filtering
  filterMetric: 'sharpe' | 'cagr' | 'tim' | 'timar' | 'calmar'
  filterTopX: number
  filteredBranches: OptimizationResult[] | RollingOptimizationResult['branches']

  // Phase 3: Combined System
  combinedTree: FlowNode | null

  // Actions - Phase 1
  loadChronologicalJob: (jobId: number) => Promise<void>
  loadRollingJob: (jobId: number) => Promise<void>
  clearJob: () => void

  // Actions - Phase 2
  setFilterMetric: (metric: ShardState['filterMetric']) => void
  setFilterTopX: (count: number) => void
  applyFilters: () => void

  // Actions - Phase 3
  generateCombinedTree: () => void
  clearCombinedTree: () => void
  saveToModel: () => Promise<string>
}

export const useShardStore = create<ShardState>((set, get) => ({
  // Initial state
  loadedJobType: null,
  loadedJobId: null,
  loadedJobMetadata: null,
  allBranches: [],

  filterMetric: 'sharpe',
  filterTopX: 10,
  filteredBranches: [],

  combinedTree: null,

  // Phase 1: Load chronological optimization job
  loadChronologicalJob: async (jobId: number) => {
    try {
      const res = await fetch(`/api/optimization/${jobId}/results?sortBy=is_sharpe&order=desc&limit=10000`)
      if (!res.ok) {
        throw new Error('Failed to fetch chronological job results')
      }
      const results: OptimizationResult[] = await res.json()

      // Fetch job metadata
      const jobsRes = await fetch('/api/optimization/jobs')
      if (!jobsRes.ok) {
        throw new Error('Failed to fetch job metadata')
      }
      const jobs: OptimizationJob[] = await jobsRes.json()
      const jobMetadata = jobs.find(j => j.id === jobId)

      set({
        loadedJobType: 'chronological',
        loadedJobId: jobId,
        loadedJobMetadata: jobMetadata || null,
        allBranches: results,
        filteredBranches: [], // Reset filtered branches
        combinedTree: null // Reset combined tree
      })

      // Auto-apply filters after loading
      get().applyFilters()
    } catch (err) {
      console.error('[ShardStore] Failed to load chronological job:', err)
      throw err
    }
  },

  // Phase 1: Load rolling optimization job
  loadRollingJob: async (jobId: number) => {
    try {
      const res = await fetch(`/api/optimization/rolling/${jobId}`)
      if (!res.ok) {
        throw new Error('Failed to fetch rolling job results')
      }
      const data: RollingOptimizationResult = await res.json()

      set({
        loadedJobType: 'rolling',
        loadedJobId: jobId,
        loadedJobMetadata: data.job,
        allBranches: data.branches,
        filteredBranches: [], // Reset filtered branches
        combinedTree: null // Reset combined tree
      })

      // Auto-apply filters after loading
      get().applyFilters()
    } catch (err) {
      console.error('[ShardStore] Failed to load rolling job:', err)
      throw err
    }
  },

  // Phase 1: Clear loaded job
  clearJob: () => {
    set({
      loadedJobType: null,
      loadedJobId: null,
      loadedJobMetadata: null,
      allBranches: [],
      filteredBranches: [],
      combinedTree: null
    })
  },

  // Phase 2: Set filter metric
  setFilterMetric: (metric) => {
    set({ filterMetric: metric })
    // Auto-apply filters when metric changes
    setTimeout(() => get().applyFilters(), 0)
  },

  // Phase 2: Set top X count
  setFilterTopX: (count) => {
    set({ filterTopX: Math.max(1, count) })
    // Auto-apply filters when count changes
    setTimeout(() => get().applyFilters(), 0)
  },

  // Phase 2: Apply filters to branches
  applyFilters: () => {
    const { allBranches, filterMetric, filterTopX, loadedJobType } = get()

    if (allBranches.length === 0) {
      set({ filteredBranches: [] })
      return
    }

    // Helper function to extract metric value
    const getMetricValue = (branch: any): number | null => {
      if (loadedJobType === 'chronological') {
        const b = branch as OptimizationResult
        // Use IS metrics for chronological
        return b.isMetrics?.[filterMetric] ?? null
      } else if (loadedJobType === 'rolling') {
        // For rolling, use IS metrics from isOosMetrics
        const b = branch as RollingOptimizationResult['branches'][number]
        return b.isOosMetrics?.IS ?? null
      }
      return null
    }

    // Sort by metric (descending - higher is better)
    const sorted = [...allBranches].sort((a, b) => {
      const aValue = getMetricValue(a)
      const bValue = getMetricValue(b)
      return (bValue || -Infinity) - (aValue || -Infinity)
    })

    // Take top X
    const filtered = sorted.slice(0, filterTopX)
    set({ filteredBranches: filtered })

    console.log(`[ShardStore] Filtered to top ${filterTopX} branches by ${filterMetric}:`, filtered)
  },

  // Phase 3: Generate combined tree from filtered branches
  generateCombinedTree: () => {
    const { filteredBranches, loadedJobType, loadedJobMetadata, filterMetric, filterTopX } = get()

    if (filteredBranches.length === 0) {
      console.warn('[ShardStore] Cannot generate tree: no filtered branches')
      return
    }

    if (!loadedJobMetadata) {
      console.warn('[ShardStore] Cannot generate tree: no job metadata')
      return
    }

    if (!loadedJobType) {
      console.warn('[ShardStore] Cannot generate tree: no job type')
      return
    }

    // Get job name
    const jobName = loadedJobMetadata.botName || `Job ${loadedJobMetadata.id}`

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
    const { combinedTree, loadedJobMetadata, filterMetric, filterTopX } = get()

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
    const jobName = loadedJobMetadata?.botName || 'Unknown'

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
  }
}))
