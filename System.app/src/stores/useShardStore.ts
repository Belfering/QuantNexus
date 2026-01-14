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

// Type for tracking filter groups (each Apply action creates a group)
export interface FilterGroup {
  id: string
  metric: 'sharpe' | 'cagr' | 'tim' | 'timar' | 'calmar'
  topX: number
  addedAt: number
  branchKeys: string[]  // jobId-branchId keys for branches in this group
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

  // Phase 2: Filtering (additive with undo)
  filterMetric: 'sharpe' | 'cagr' | 'tim' | 'timar' | 'calmar'
  filterTopX: number
  filteredBranches: OptimizationResult[] | RollingOptimizationResult['branches']
  filterGroups: FilterGroup[]      // Track each Apply action as a group
  filterHistory: FilterHistorySnapshot[]   // Stack for undo (stores both groups and branches)

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
  removeBranchFromFiltered: (jobId: number, branchId: string | number) => void
  clearFilteredBranches: () => void
  undoFilter: () => void
  removeFilterGroup: (groupId: string) => void

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
  filterGroups: [],
  filterHistory: [],

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

  // Phase 2: Apply filters to branches (ADDITIVE - appends to existing filtered branches)
  applyFilters: () => {
    const { allBranches, filterMetric, filterTopX, loadedJobType, filteredBranches, filterGroups, filterHistory } = get()

    if (allBranches.length === 0) {
      return
    }

    // Helper function to extract metric value
    const getMetricValue = (branch: any): number | null => {
      if (loadedJobType === 'chronological') {
        const b = branch as OptimizationResult
        return b.isMetrics?.[filterMetric] ?? null
      } else if (loadedJobType === 'rolling') {
        const b = branch as RollingOptimizationResult['branches'][number]
        return b.isOosMetrics?.IS ?? null
      }
      return null
    }

    // Helper to get branch key
    const getBranchKey = (branch: any): string => {
      if (loadedJobType === 'chronological') {
        const b = branch as OptimizationResult
        return `${b.jobId}-${b.branchId}`
      } else {
        const b = branch as RollingOptimizationResult['branches'][number]
        return `${b.jobId}-${b.branchId}`
      }
    }

    // Sort by metric (descending - higher is better)
    const sorted = [...allBranches].sort((a, b) => {
      const aValue = getMetricValue(a)
      const bValue = getMetricValue(b)
      return (bValue || -Infinity) - (aValue || -Infinity)
    })

    // Take top X
    const topBranches = sorted.slice(0, filterTopX)

    // De-duplicate: filter out branches already in filteredBranches
    const existingKeys = new Set(filteredBranches.map(b => getBranchKey(b)))
    const newBranches = topBranches.filter(b => !existingKeys.has(getBranchKey(b)))

    if (newBranches.length === 0) {
      console.log('[ShardStore] No new branches to add (all already filtered)')
      return
    }

    // Save current state for undo (both groups and branches)
    const previousSnapshot: FilterHistorySnapshot = {
      filterGroups: [...filterGroups],
      filteredBranches: [...filteredBranches] as typeof filteredBranches
    }

    // Create new filter group
    const newGroup: FilterGroup = {
      id: `group-${Date.now()}`,
      metric: filterMetric,
      topX: filterTopX,
      addedAt: Date.now(),
      branchKeys: newBranches.map(b => getBranchKey(b))
    }

    // Deep copy new branches so they persist independently of allBranches
    // This allows filtered branches to survive job unloading
    const copiedBranches = newBranches.map(b => JSON.parse(JSON.stringify(b)))

    // Append new branches to existing filtered branches
    const updatedFiltered = [...filteredBranches, ...copiedBranches] as typeof filteredBranches

    set({
      filteredBranches: updatedFiltered,
      filterGroups: [...filterGroups, newGroup],
      filterHistory: [...filterHistory, previousSnapshot]
    })

    console.log(`[ShardStore] Added ${copiedBranches.length} branches (Top ${filterTopX} by ${filterMetric}). Total: ${updatedFiltered.length}`)
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

  // Phase 2: Remove a specific filter group and its branches
  removeFilterGroup: (groupId: string) => {
    const { filterGroups, filteredBranches, filterHistory } = get()

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

    // Helper to get branch key from filtered branch (these are deep copies with jobId)
    const getBranchKey = (branch: any): string => {
      return `${branch.jobId}-${branch.branchId}`
    }

    // Remove group and its branches
    const keysToRemove = new Set(groupToRemove.branchKeys)
    const newFiltered = filteredBranches.filter(b => !keysToRemove.has(getBranchKey(b))) as typeof filteredBranches

    set({
      filterGroups: filterGroups.filter(g => g.id !== groupId),
      filteredBranches: newFiltered,
      filterHistory: [...filterHistory, previousSnapshot]
    })

    console.log(`[ShardStore] Removed group "${groupToRemove.metric} top ${groupToRemove.topX}": ${groupToRemove.branchKeys.length} branches`)
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
