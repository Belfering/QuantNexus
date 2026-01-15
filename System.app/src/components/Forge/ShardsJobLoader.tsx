// Shards Loader - Left card for loading chronological or rolling optimization shards
// Supports multi-shard loading (additive) with visual indicators for loaded state

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Check, Trash2, Edit2 } from 'lucide-react'
import type { OptimizationJob } from '@/types/optimizationJob'
import type { RollingJob } from '@/features/optimization/hooks/useRollingJobs'

interface ShardsJobLoaderProps {
  loadedJobType: 'chronological' | 'rolling' | null
  loadedJobIds: number[]
  allBranches: any[]
  onLoadJob: (type: 'chronological' | 'rolling', jobId: number) => Promise<void>
  onUnloadJob: (jobId: number) => void
  onClearAllJobs: () => void
  isJobLoaded: (jobId: number) => boolean
  onAddBranchesToStrategy: (branches: any[]) => void
}

export function ShardsJobLoader({
  loadedJobType,
  loadedJobIds,
  allBranches,
  onLoadJob,
  onUnloadJob,
  onClearAllJobs,
  isJobLoaded,
  onAddBranchesToStrategy
}: ShardsJobLoaderProps) {
  const [jobType, setJobType] = useState<'chronological' | 'rolling'>('chronological')
  const [chronologicalJobs, setChronologicalJobs] = useState<OptimizationJob[]>([])
  const [rollingJobs, setRollingJobs] = useState<RollingJob[]>([])
  const [loadingJobId, setLoadingJobId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [renamingJobId, setRenamingJobId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState<string>('')
  const [contextMenu, setContextMenu] = useState<{ visible: boolean; x: number; y: number; jobId: number | null }>({
    visible: false,
    x: 0,
    y: 0,
    jobId: null
  })

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
      } catch (err) {
        console.error('[ShardsJobLoader] Failed to fetch jobs:', err)
        setError(err instanceof Error ? err.message : 'Failed to fetch jobs')
      }
    }

    fetchJobs()
  }, [])

  // Handle clicking a job card to show context menu or unload
  const handleJobClick = (e: React.MouseEvent, jobId: number) => {
    // If already loaded, unload it
    if (isJobLoaded(jobId)) {
      onUnloadJob(jobId)
      setContextMenu({ visible: false, x: 0, y: 0, jobId: null })
      return
    }

    // Check if switching shard types with shards already loaded
    if (loadedJobIds.length > 0 && loadedJobType !== jobType) {
      setError('Cannot mix shard types. Clear loaded shards first to switch types.')
      return
    }

    // Show context menu at cursor position
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      jobId
    })
    setError(null)
  }

  // Handle "Add to Filter" - load job branches for filtering
  const handleAddToFilter = async () => {
    if (!contextMenu.jobId) return

    try {
      setLoadingJobId(contextMenu.jobId)
      setError(null)
      setContextMenu({ visible: false, x: 0, y: 0, jobId: null })
      await onLoadJob(jobType, contextMenu.jobId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load job')
    } finally {
      setLoadingJobId(null)
    }
  }

  // Handle "Add to Strategy" - directly add job branches to strategy list
  const handleAddToStrategy = async () => {
    if (!contextMenu.jobId) return

    try {
      setLoadingJobId(contextMenu.jobId)
      setError(null)
      setContextMenu({ visible: false, x: 0, y: 0, jobId: null })

      // Fetch job branches
      const endpoint = jobType === 'chronological'
        ? `/api/optimization/jobs/${contextMenu.jobId}`
        : `/api/optimization/rolling/jobs/${contextMenu.jobId}`

      const response = await fetch(endpoint)
      if (!response.ok) {
        throw new Error('Failed to fetch job')
      }

      const jobData = await response.json()
      const branches = jobType === 'chronological'
        ? jobData.results || []
        : jobData.branches || []

      // Augment branches with jobId
      const branchesWithJobId = branches.map((b: any) => ({ ...b, jobId: contextMenu.jobId }))

      // Add directly to strategy list
      onAddBranchesToStrategy(branchesWithJobId)
      console.log(`[ShardsJobLoader] Added ${branchesWithJobId.length} branches from job ${contextMenu.jobId} to strategy`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add to strategy')
    } finally {
      setLoadingJobId(null)
    }
  }

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      if (contextMenu.visible) {
        setContextMenu({ visible: false, x: 0, y: 0, jobId: null })
      }
    }

    if (contextMenu.visible) {
      window.addEventListener('click', handleClickOutside)
      return () => window.removeEventListener('click', handleClickOutside)
    }
  }, [contextMenu.visible])

  // Handle delete job
  const handleDeleteJob = async (e: React.MouseEvent, jobId: number) => {
    e.stopPropagation()

    if (!confirm('Permanently delete this optimization shard? This cannot be undone.')) {
      return
    }

    try {
      const endpoint = jobType === 'chronological'
        ? `/api/optimization/jobs/${jobId}`
        : `/api/optimization/rolling/jobs/${jobId}`

      const response = await fetch(endpoint, { method: 'DELETE' })

      if (!response.ok) {
        throw new Error('Failed to delete job')
      }

      // Remove from state
      if (jobType === 'chronological') {
        setChronologicalJobs(prev => prev.filter(j => j.id !== jobId))
      } else {
        setRollingJobs(prev => prev.filter(j => j.id !== jobId))
      }

      // Unload if currently loaded
      if (isJobLoaded(jobId)) {
        onUnloadJob(jobId)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete job')
    }
  }

  // Handle rename job - start renaming
  const handleStartRename = (e: React.MouseEvent, jobId: number, currentName: string) => {
    e.stopPropagation()
    setRenamingJobId(jobId)
    setRenameValue(currentName)
  }

  // Handle rename job - confirm
  const handleConfirmRename = async (e: React.MouseEvent, jobId: number) => {
    e.stopPropagation()

    if (!renameValue.trim()) {
      setRenamingJobId(null)
      return
    }

    try {
      const endpoint = jobType === 'chronological'
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

      setRenamingJobId(null)
      setRenameValue('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename job')
    }
  }

  // Handle cancel rename
  const handleCancelRename = (e: React.MouseEvent) => {
    e.stopPropagation()
    setRenamingJobId(null)
    setRenameValue('')
  }

  // Handle job type change
  const handleJobTypeChange = (newType: 'chronological' | 'rolling') => {
    if (loadedJobIds.length > 0 && loadedJobType !== newType) {
      // Clear jobs when switching types
      onClearAllJobs()
    }
    setJobType(newType)
    setError(null)
  }

  const currentJobs = jobType === 'chronological' ? chronologicalJobs : rollingJobs
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
          onChange={(e) => handleJobTypeChange(e.target.value as 'chronological' | 'rolling')}
          className="w-full px-2 py-1 rounded border border-border bg-background text-sm"
        >
          <option value="chronological">Chronological (Split)</option>
          <option value="rolling">Rolling (Walk Forward)</option>
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
                Loaded: {loadedCount} {loadedJobType === 'chronological' ? 'Split' : 'Walk Forward'} Shard{loadedCount !== 1 ? 's' : ''}
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
          Available Shards ({currentJobs.length})
        </div>
        <div className="space-y-2">
          {currentJobs.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-4">
              No {jobType === 'chronological' ? 'Split' : 'Walk Forward'} shards found
            </div>
          ) : (
            currentJobs.map(job => {
              const loaded = isJobLoaded(job.id)
              const isLoading = loadingJobId === job.id
              const isRenaming = renamingJobId === job.id

              return (
                <div
                  key={job.id}
                  className={`p-3 rounded border text-sm transition-colors ${
                    loaded
                      ? 'border-green-500/50 bg-green-500/10 cursor-pointer'
                      : 'border-border bg-background hover:border-accent/50 cursor-pointer'
                  } ${isLoading ? 'opacity-50' : ''}`}
                  onClick={(e) => !isLoading && !isRenaming && handleJobClick(e, job.id)}
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
                                handleConfirmRename(e as any, job.id)
                              } else if (e.key === 'Escape') {
                                handleCancelRename(e as any)
                              }
                            }}
                          />
                          <button
                            onClick={(e) => handleConfirmRename(e, job.id)}
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
                            <span className="font-semibold truncate">{job.botName}</span>
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
                          onClick={(e) => handleStartRename(e, job.id, job.botName)}
                          className="p-1.5 rounded hover:bg-blue-500/20 text-blue-600 hover:text-blue-700 transition-colors"
                          title="Rename shard"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={(e) => handleDeleteJob(e, job.id)}
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
