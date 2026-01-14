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

// Type for storing loaded job data
interface LoadedJobData {
  metadata: OptimizationJob | RollingJob
  branches: OptimizationResult[] | RollingOptimizationResult['branches']
}

interface ShardState {
  // Phase 1: Job Loading (multi-job support)
  loadedJobType: 'chronological' | 'rolling' | null  // Enforces same type for all loaded jobs
  loadedJobIds: number[]  // Array of loaded job IDs (preserves order)
  loadedJobs: Record<number, LoadedJobData>  // Map of jobId -> job data
  allBranches: OptimizationResult[] | RollingOptimizationResult['branches']  // Combined from all loaded jobs

  // Phase 2: Filtering
  filterMetric: 'sharpe' | 'cagr' | 'tim' | 'timar' | 'calmar'
  filterTopX: number
  filteredBranches: OptimizationResult[] | RollingOptimizationResult['branches']

  // Phase 3: Combined System
  combinedTree: FlowNode | null

  // Actions - Phase 1
  loadChronologicalJob: (jobId: number) => Promise<void>
  loadRollingJob: (jobId: number) => Promise<void>
  unloadJob: (jobId: number) => void
  clearAllJobs: () => void
  isJobLoaded: (jobId: number) => boolean

  // Actions - Phase 2
  setFilterMetric: (metric: ShardState['filterMetric']) => void
  setFilterTopX: (count: number) => void
  applyFilters: () => void
  removeBranchFromFiltered: (jobId: number, branchId: string) => void
  clearFilteredBranches: () => void

  // Actions - Phase 3
  generateCombinedTree: () => void
  clearCombinedTree: () => void
  saveToModel: () => Promise<string>
}

export const useShardStore = create<ShardState>((set, get) => ({
  // Initial state
  loadedJobType: null,
  loadedJobIds: [],
  loadedJobs: {},
  allBranches: [],

  filterMetric: 'sharpe',
  filterTopX: 10,
  filteredBranches: [],

  combinedTree: null,

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
      const results: OptimizationResult[] = await res.json()

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

      // Add to loaded jobs
      const newLoadedJobs = {
        ...loadedJobs,
        [jobId]: { metadata: data.job, branches: data.branches }
      }
      const newLoadedJobIds = [...loadedJobIds, jobId]

      // Combine all branches
      const combined: RollingOptimizationResult['branches'] = []
      for (const id of newLoadedJobIds) {
        const jobData = newLoadedJobs[id]
        if (jobData) {
          combined.push(...(jobData.branches as RollingOptimizationResult['branches']))
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

  // Phase 1: Unload a specific job
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
  },

  // Phase 1: Clear all loaded jobs
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

  // Phase 1: Check if a job is loaded
  isJobLoaded: (jobId: number) => {
    return get().loadedJobIds.includes(jobId)
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
    const filtered = sorted.slice(0, filterTopX) as typeof allBranches
    set({ filteredBranches: filtered })

    console.log(`[ShardStore] Filtered to top ${filterTopX} branches by ${filterMetric}:`, filtered)
  },

  // Phase 2: Remove a specific branch from filtered results
  removeBranchFromFiltered: (jobId: number, branchId: string) => {
    const { filteredBranches, loadedJobType } = get()

    const newFiltered = filteredBranches.filter(branch => {
      const bJobId = loadedJobType === 'chronological'
        ? (branch as OptimizationResult).jobId
        : (branch as RollingOptimizationResult['branches'][number]).jobId
      const bBranchId = loadedJobType === 'chronological'
        ? (branch as OptimizationResult).branchId
        : (branch as RollingOptimizationResult['branches'][number]).branchId
      return !(bJobId === jobId && bBranchId === branchId)
    }) as typeof filteredBranches

    set({ filteredBranches: newFiltered })
  },

  // Phase 2: Clear all filtered branches
  clearFilteredBranches: () => {
    set({ filteredBranches: [] })
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
  }
}))
