// Shards Job Loader - Left card for loading chronological or rolling optimization jobs
// Supports multi-job loading (additive) with visual indicators for loaded state

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Check, X } from 'lucide-react'
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
}

export function ShardsJobLoader({
  loadedJobType,
  loadedJobIds,
  allBranches,
  onLoadJob,
  onUnloadJob,
  onClearAllJobs,
  isJobLoaded
}: ShardsJobLoaderProps) {
  const [jobType, setJobType] = useState<'chronological' | 'rolling'>('chronological')
  const [chronologicalJobs, setChronologicalJobs] = useState<OptimizationJob[]>([])
  const [rollingJobs, setRollingJobs] = useState<RollingJob[]>([])
  const [loadingJobId, setLoadingJobId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Fetch jobs on mount
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

  // Handle clicking a job card to load/toggle it
  const handleJobClick = async (jobId: number) => {
    // If already loaded, do nothing (use X button to unload)
    if (isJobLoaded(jobId)) return

    // Check if switching job types with jobs already loaded
    if (loadedJobIds.length > 0 && loadedJobType !== jobType) {
      setError('Cannot mix job types. Clear loaded jobs first to switch types.')
      return
    }

    try {
      setLoadingJobId(jobId)
      setError(null)
      await onLoadJob(jobType, jobId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load job')
    } finally {
      setLoadingJobId(null)
    }
  }

  // Handle unload button click
  const handleUnloadClick = (e: React.MouseEvent, jobId: number) => {
    e.stopPropagation() // Prevent triggering the card click
    onUnloadJob(jobId)
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
    <div className="p-4 bg-muted/30 rounded-lg flex flex-col h-full">
      <div className="text-sm font-medium mb-3">Load Optimization Job</div>

      {/* Job Type Selector */}
      <div className="mb-3">
        <label className="text-xs text-muted-foreground block mb-1">Job Type</label>
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
                Loaded: {loadedCount} {loadedJobType === 'chronological' ? 'Split' : 'Walk Forward'} Job{loadedCount !== 1 ? 's' : ''}
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

      {/* Jobs List */}
      <div className="flex-1 overflow-y-auto">
        <div className="text-xs font-medium mb-2">
          Available Jobs ({currentJobs.length})
        </div>
        <div className="space-y-2">
          {currentJobs.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-4">
              No {jobType === 'chronological' ? 'Split' : 'Walk Forward'} jobs found
            </div>
          ) : (
            currentJobs.map(job => {
              const loaded = isJobLoaded(job.id)
              const isLoading = loadingJobId === job.id

              return (
                <div
                  key={job.id}
                  className={`p-2 rounded border text-xs transition-colors ${
                    loaded
                      ? 'border-green-500/50 bg-green-500/10 cursor-default'
                      : 'border-border bg-background hover:border-accent/50 cursor-pointer'
                  } ${isLoading ? 'opacity-50' : ''}`}
                  onClick={() => !loaded && !isLoading && handleJobClick(job.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {loaded && (
                          <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400 flex-shrink-0" />
                        )}
                        <span className="font-bold truncate">{job.botName}</span>
                      </div>
                      <div className="text-muted-foreground">
                        {new Date(job.createdAt).toLocaleString()}
                      </div>
                      <div className="text-muted-foreground">
                        {'branchCount' in job ? job.branchCount : job.totalBranches} branches
                      </div>
                    </div>
                    {loaded && (
                      <button
                        onClick={(e) => handleUnloadClick(e, job.id)}
                        className="p-1 rounded hover:bg-red-500/20 text-red-500 hover:text-red-700 transition-colors flex-shrink-0"
                        title="Unload job"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
