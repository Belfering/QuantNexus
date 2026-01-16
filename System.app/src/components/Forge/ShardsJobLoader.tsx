// Shards Loader - Left card for loading chronological or rolling optimization shards
// Supports multi-shard loading (additive) with visual indicators for loaded state

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Check, Trash2, Edit2 } from 'lucide-react'
import type { OptimizationJob } from '@/types/optimizationJob'
import type { RollingJob } from '@/features/optimization/hooks/useRollingJobs'

interface ShardsJobLoaderProps {
  loadedJobType: 'chronological' | 'rolling' | null
  loadedJobIds: number[]
  allBranches: any[]
  onLoadJob: (type: 'chronological' | 'rolling', jobId: number) => Promise<void>
  onLoadSavedShard: (shardId: string) => Promise<void>
  onUnloadJob: (jobId: number) => void
  onClearAllJobs: () => void
  isJobLoaded: (jobId: number) => boolean
  onLoadJobAndAddToStrategy: (type: 'chronological' | 'rolling', jobId: number) => Promise<void>
  onLoadSavedShardAndAddToStrategy: (shardId: string) => Promise<void>
  refreshTrigger?: number // Timestamp trigger to refresh saved shards
}

export function ShardsJobLoader({
  loadedJobType,
  loadedJobIds,
  allBranches,
  onLoadJob,
  onLoadSavedShard,
  onUnloadJob,
  onClearAllJobs,
  isJobLoaded,
  onLoadJobAndAddToStrategy,
  onLoadSavedShardAndAddToStrategy,
  refreshTrigger
}: ShardsJobLoaderProps) {
  const [jobType, setJobType] = useState<'chronological' | 'rolling' | 'saved'>('chronological')
  const [chronologicalJobs, setChronologicalJobs] = useState<OptimizationJob[]>([])
  const [rollingJobs, setRollingJobs] = useState<RollingJob[]>([])
  const [savedShards, setSavedShards] = useState<any[]>([]) // Saved shards from API
  const [loadingJobId, setLoadingJobId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [renamingJobId, setRenamingJobId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState<string>('')
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean
    x: number
    y: number
    jobId: number | string | null
    jobType: 'chronological' | 'rolling' | 'saved' | null
  }>({
    visible: false,
    x: 0,
    y: 0,
    jobId: null,
    jobType: null
  })

  // Ref to track if we're opening the context menu (prevent immediate close)
  const isOpeningContextMenu = useRef<boolean>(false)

  // Helper function to fetch saved shards
  const fetchSavedShards = async () => {
    try {
      const authData = localStorage.getItem('auth-storage')
      if (authData) {
        const parsed = JSON.parse(authData)
        const userId = parsed?.state?.userId
        if (userId) {
          const shardsRes = await fetch(`/api/shards?userId=${userId}`)
          if (shardsRes.ok) {
            const shardsData = await shardsRes.json()
            setSavedShards(shardsData.shards || [])
            console.log('[ShardsJobLoader] Loaded saved shards:', shardsData.shards?.length || 0)
          }
        }
      }
    } catch (parseErr) {
      console.warn('[ShardsJobLoader] Could not get userId from localStorage')
    }
  }

  // Fetch shards on mount
  useEffect(() => {
    async function fetchJobs() {
      try {
        // Fetch chronological jobs
        const chronoRes = await fetch('/api/optimization/jobs')
        if (chronoRes.ok) {
          const chronoData: OptimizationJob[] = await chronoRes.json()
          setChronologicalJobs(chronoData)
        }

        // Fetch rolling jobs
        const rollingRes = await fetch('/api/optimization/rolling/jobs')
        if (rollingRes.ok) {
          const rollingData: RollingJob[] = await rollingRes.json()
          setRollingJobs(rollingData)
        }

        // Fetch saved shards
        await fetchSavedShards()
      } catch (err) {
        console.error('[ShardsJobLoader] Failed to fetch jobs:', err)
        setError(err instanceof Error ? err.message : 'Failed to fetch jobs')
      }
    }

    fetchJobs()
  }, [])

  // Refresh saved shards when refreshTrigger changes
  useEffect(() => {
    if (refreshTrigger) {
      fetchSavedShards()
    }
  }, [refreshTrigger])

  // Handle clicking a job card to show context menu or unload
  const handleJobClick = (e: React.MouseEvent, jobId: number | string, jobType: 'chronological' | 'rolling' | 'saved') => {
    e.stopPropagation() // Prevent immediate close from click-outside handler

    // For saved shards, convert string ID to number for checking
    const numericId = typeof jobId === 'string' ? parseInt(jobId.split('-')[1] || jobId, 10) : jobId

    // If already loaded, unload it
    if (isJobLoaded(numericId)) {
      onUnloadJob(numericId)
      setContextMenu({ visible: false, x: 0, y: 0, jobId: null, jobType: null })
      return
    }

    // Check if switching shard types with shards already loaded
    if (loadedJobIds.length > 0 && loadedJobType !== jobType) {
      setError('Cannot mix shard types. Clear loaded shards first to switch types.')
      return
    }

    // Mark that we're opening the context menu (prevent immediate close)
    isOpeningContextMenu.current = true

    // Show context menu at cursor position (keep original jobId format)
    console.log('[ShardsJobLoader] Opening context menu at', e.clientX, e.clientY, 'for job', jobId)
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      jobId,
      jobType
    })
    setError(null)

    // Reset flag after current event cycle completes
    setTimeout(() => {
      isOpeningContextMenu.current = false
    }, 100)
  }

  // Handle "Add to Filter" - load job branches for filtering
  const handleAddToFilter = async () => {
    if (!contextMenu.jobId || !contextMenu.jobType) return

    try {
      const numericId = typeof contextMenu.jobId === 'string'
        ? parseInt(contextMenu.jobId.split('-')[1] || contextMenu.jobId, 10)
        : contextMenu.jobId

      setLoadingJobId(numericId)
      setError(null)
      setContextMenu({ visible: false, x: 0, y: 0, jobId: null, jobType: null })

      // Call appropriate method based on job type
      if (contextMenu.jobType === 'saved' && typeof contextMenu.jobId === 'string') {
        await onLoadSavedShard(contextMenu.jobId)
      } else if (typeof contextMenu.jobId === 'number') {
        await onLoadJob(contextMenu.jobType as 'chronological' | 'rolling', contextMenu.jobId)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load job')
    } finally {
      setLoadingJobId(null)
    }
  }

  // Handle "Add to Strategy" - load job and add branches to strategy list
  const handleAddToStrategy = async () => {
    if (!contextMenu.jobId || !contextMenu.jobType) return

    try {
      const numericId = typeof contextMenu.jobId === 'string'
        ? parseInt(contextMenu.jobId.split('-')[1] || contextMenu.jobId, 10)
        : contextMenu.jobId

      setLoadingJobId(numericId)
      setError(null)
      setContextMenu({ visible: false, x: 0, y: 0, jobId: null, jobType: null })

      // Call appropriate method based on job type
      if (contextMenu.jobType === 'saved' && typeof contextMenu.jobId === 'string') {
        await onLoadSavedShardAndAddToStrategy(contextMenu.jobId)
      } else if (typeof contextMenu.jobId === 'number') {
        await onLoadJobAndAddToStrategy(contextMenu.jobType as 'chronological' | 'rolling', contextMenu.jobId)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add to strategy')
    } finally {
      setLoadingJobId(null)
    }
  }

  // Close context menu when clicking outside
  useEffect(() => {
    if (!contextMenu.visible) return

    const handleClickOutside = () => {
      // Don't close if we're still opening the menu
      if (isOpeningContextMenu.current) {
        console.log('[ShardsJobLoader] Ignoring click - context menu is opening')
        return
      }
      console.log('[ShardsJobLoader] Click outside detected, closing context menu')
      setContextMenu({ visible: false, x: 0, y: 0, jobId: null, jobType: null })
    }

    // Add listener on next tick to avoid closing immediately
    const timeoutId = setTimeout(() => {
      window.addEventListener('click', handleClickOutside)
    }, 0)

    return () => {
      clearTimeout(timeoutId)
      window.removeEventListener('click', handleClickOutside)
    }
  }, [contextMenu.visible])

  // Handle delete job
  const handleDeleteJob = async (e: React.MouseEvent, jobId: number | string, jobType: 'chronological' | 'rolling' | 'saved') => {
    e.stopPropagation()

    const confirmMsg = jobType === 'saved'
      ? 'Permanently delete this saved shard? This cannot be undone.'
      : 'Permanently delete this optimization shard? This cannot be undone.'

    if (!confirm(confirmMsg)) {
      return
    }

    try {
      let endpoint: string
      const userId = JSON.parse(localStorage.getItem('auth-storage') || '{}')?.state?.userId

      if (jobType === 'saved' && typeof jobId === 'string') {
        endpoint = `/api/shards/${jobId}?ownerId=${userId}`
      } else if (jobType === 'chronological') {
        endpoint = `/api/optimization/jobs/${jobId}`
      } else {
        endpoint = `/api/optimization/rolling/jobs/${jobId}`
      }

      const response = await fetch(endpoint, { method: 'DELETE' })

      if (!response.ok) {
        throw new Error('Failed to delete shard')
      }

      // Remove from state
      if (jobType === 'saved' && typeof jobId === 'string') {
        setSavedShards(prev => prev.filter(s => s.id !== jobId))
      } else if (jobType === 'chronological') {
        setChronologicalJobs(prev => prev.filter(j => j.id !== jobId))
      } else {
        setRollingJobs(prev => prev.filter(j => j.id !== jobId))
      }

      // Unload if currently loaded
      const numericId = typeof jobId === 'string'
        ? parseInt(jobId.split('-')[1] || jobId, 10)
        : jobId

      if (isJobLoaded(numericId)) {
        onUnloadJob(numericId)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete shard')
    }
  }

  // Handle rename job - start renaming
  const handleStartRename = (e: React.MouseEvent, jobId: number | string, currentName: string) => {
    e.stopPropagation()
    const numericId = typeof jobId === 'string'
      ? parseInt(jobId.split('-')[1] || jobId, 10)
      : jobId
    setRenamingJobId(numericId)
    setRenameValue(currentName)
  }

  // Handle rename job - confirm
  const handleConfirmRename = async (e: React.MouseEvent, jobId: number | string, jobType: 'chronological' | 'rolling' | 'saved') => {
    e.stopPropagation()

    if (!renameValue.trim()) {
      setRenamingJobId(null)
      return
    }

    try {
      let endpoint: string
      const userId = JSON.parse(localStorage.getItem('auth-storage') || '{}')?.state?.userId

      if (jobType === 'saved' && typeof jobId === 'string') {
        endpoint = `/api/shards/${jobId}`
        // For saved shards, we use different body format
        const response = await fetch(endpoint, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ownerId: userId,
            name: renameValue.trim()
          })
        })

        if (!response.ok) {
          throw new Error('Failed to rename shard')
        }

        // Update in state
        setSavedShards(prev => prev.map(s =>
          s.id === jobId ? { ...s, name: renameValue.trim() } : s
        ))
      } else {
        endpoint = jobType === 'chronological'
          ? `/api/optimization/jobs/${jobId}`
          : `/api/optimization/rolling/jobs/${jobId}`

        const response = await fetch(endpoint, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ botName: renameValue.trim() })
        })

        if (!response.ok) {
          throw new Error('Failed to rename job')
        }

        // Update in state
        if (jobType === 'chronological') {
          setChronologicalJobs(prev => prev.map(j =>
            j.id === jobId ? { ...j, botName: renameValue.trim() } : j
          ))
        } else {
          setRollingJobs(prev => prev.map(j =>
            j.id === jobId ? { ...j, botName: renameValue.trim() } : j
          ))
        }
      }

      setRenamingJobId(null)
      setRenameValue('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename shard')
    }
  }

  // Handle cancel rename
  const handleCancelRename = (e: React.MouseEvent) => {
    e.stopPropagation()
    setRenamingJobId(null)
    setRenameValue('')
  }

  // Handle job type change
  const handleJobTypeChange = (newType: 'chronological' | 'rolling' | 'saved') => {
    if (loadedJobIds.length > 0 && loadedJobType !== newType) {
      onClearAllJobs()
    }
    setJobType(newType)
    setError(null)
  }

  // Filter jobs based on selected type
  const currentJobs = jobType === 'chronological'
    ? chronologicalJobs.map(j => ({ ...j, type: 'chronological' as const }))
    : jobType === 'rolling'
    ? rollingJobs.map(j => ({ ...j, type: 'rolling' as const }))
    : savedShards.map(s => ({ ...s, type: 'saved' as const }))

  // Sort by creation date (newest first)
  const sortedJobs = [...currentJobs].sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )

  const loadedCount = loadedJobIds.length
  const totalBranches = allBranches.length

  return (
    <div className="p-4 bg-muted/30 rounded-lg flex flex-col h-full overflow-y-auto hide-horizontal-scrollbar">
      <div className="text-base font-semibold mb-3">Load Optimization Shard</div>

      {/* Shard Type Selector */}
      <div className="mb-3">
        <label className="text-xs text-muted-foreground block mb-1">Shard Type</label>
        <select
          value={jobType}
          onChange={(e) => handleJobTypeChange(e.target.value as 'chronological' | 'rolling' | 'saved')}
          className="w-full px-2 py-1 rounded border border-border bg-background text-sm"
        >
          <option value="chronological">Chronological (Split)</option>
          <option value="rolling">Rolling (Walk Forward)</option>
          <option value="saved">Saved Shards</option>
        </select>
      </div>

      {/* Error Display */}
      {error && (
        <div className="text-xs text-red-500 mb-3 p-2 bg-red-500/10 rounded">
          {error}
        </div>
      )}

      {/* Loaded Jobs Summary */}
      {loadedCount > 0 && (
        <div className="p-2 bg-green-500/10 border border-green-500/30 rounded mb-3">
          <div className="flex justify-between items-center">
            <div>
              <div className="text-xs font-bold text-green-700 dark:text-green-400">
                Loaded: {loadedCount} {
                  loadedJobType === 'chronological' ? 'Split' :
                  loadedJobType === 'rolling' ? 'Walk Forward' :
                  'Saved'
                } Shard{loadedCount !== 1 ? 's' : ''}
              </div>
              <div className="text-xs text-green-600 dark:text-green-500">
                {totalBranches} total branches
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearAllJobs}
              className="h-6 px-2 text-xs text-red-500 hover:text-red-700 hover:bg-red-500/10"
            >
              Clear All
            </Button>
          </div>
        </div>
      )}

      {/* Shards List */}
      <div className="flex-1 min-h-0">
        <div className="text-sm font-medium mb-2">
          Available Shards ({sortedJobs.length})
        </div>
        <div className="space-y-2">
          {sortedJobs.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-4">
              No {jobType === 'chronological' ? 'Split' : jobType === 'rolling' ? 'Walk Forward' : 'Saved'} shards found
            </div>
          ) : (
            sortedJobs.map(job => {
              // For saved shards, keep string ID; for optimization jobs, use numeric ID
              const originalId = job.id // Keep original ID format for handlers
              const numericId = job.type === 'saved'
                ? parseInt(job.id.split('-')[1] || job.id, 10)
                : job.id

              const loaded = isJobLoaded(numericId)
              const isLoading = loadingJobId === numericId
              const isRenaming = renamingJobId === numericId

              // Get the display name (saved shards use 'name', optimization jobs use 'botName')
              const displayName = job.type === 'saved' ? (job as any).name : job.botName

              return (
                <div
                  key={job.id}
                  className={`p-3 rounded border text-sm transition-colors ${
                    loaded
                      ? 'border-green-500/50 bg-green-500/10 cursor-pointer'
                      : 'border-border bg-background hover:border-accent/50 cursor-pointer'
                  } ${isLoading ? 'opacity-50' : ''}`}
                  onClick={(e) => !isLoading && !isRenaming && handleJobClick(e, originalId, job.type)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      {isRenaming ? (
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            className="flex-1 px-2 py-1 text-sm border border-border rounded bg-background"
                            placeholder="Shard name..."
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleConfirmRename(e as any, originalId, job.type)
                              } else if (e.key === 'Escape') {
                                handleCancelRename(e as any)
                              }
                            }}
                          />
                          <button
                            onClick={(e) => handleConfirmRename(e, originalId, job.type)}
                            className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
                          >
                            ✓
                          </button>
                          <button
                            onClick={handleCancelRename}
                            className="px-2 py-1 text-xs bg-gray-600 text-white rounded hover:bg-gray-700"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            {loaded && (
                              <Check className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0" />
                            )}
                            <span className="font-semibold truncate">{displayName}</span>
                          </div>
                          <div className="text-muted-foreground text-sm mt-1">
                            {new Date(job.createdAt).toLocaleString()}
                          </div>
                          <div className="text-muted-foreground text-sm">
                            {'branchCount' in job ? job.branchCount : job.passingBranches} passing branches
                          </div>
                        </>
                      )}
                    </div>
                    {!isRenaming && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={(e) => handleStartRename(e, originalId, displayName)}
                          className="p-1.5 rounded hover:bg-blue-500/20 text-blue-600 hover:text-blue-700 transition-colors"
                          title="Rename shard"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={(e) => handleDeleteJob(e, originalId, job.type)}
                          className="p-1.5 rounded hover:bg-red-500/20 text-red-500 hover:text-red-700 transition-colors"
                          title="Delete shard permanently"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Context Menu Popup */}
      {contextMenu.visible && (
        <div
          className="fixed z-50 bg-background border border-border rounded shadow-lg py-1 min-w-[160px]"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleAddToFilter}
            className="w-full px-4 py-2 text-sm text-left hover:bg-accent/50 transition-colors flex items-center gap-2"
          >
            <span>Add to Filter</span>
          </button>
          <button
            onClick={handleAddToStrategy}
            className="w-full px-4 py-2 text-sm text-left hover:bg-accent/50 transition-colors flex items-center gap-2"
          >
            <span>Add to Strategy</span>
          </button>
        </div>
      )}
    </div>
  )
}
