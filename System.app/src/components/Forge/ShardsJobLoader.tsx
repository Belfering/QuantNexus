// Shards Job Loader - Left card for loading chronological or rolling optimization jobs

import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { OptimizationJob } from '@/types/optimizationJob'
import type { RollingJob } from '@/features/optimization/hooks/useRollingJobs'

interface ShardsJobLoaderProps {
  loadedJobType: 'chronological' | 'rolling' | null
  loadedJobId: number | null
  onLoadJob: (type: 'chronological' | 'rolling', jobId: number) => Promise<void>
}

export function ShardsJobLoader({
  loadedJobType,
  loadedJobId,
  onLoadJob
}: ShardsJobLoaderProps) {
  const [jobType, setJobType] = useState<'chronological' | 'rolling'>('chronological')
  const [chronologicalJobs, setChronologicalJobs] = useState<OptimizationJob[]>([])
  const [rollingJobs, setRollingJobs] = useState<RollingJob[]>([])
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
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

  const handleLoadJob = async () => {
    if (!selectedJobId) return

    try {
      setLoading(true)
      setError(null)
      await onLoadJob(jobType, selectedJobId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load job')
    } finally {
      setLoading(false)
    }
  }

  const currentJobs = jobType === 'chronological' ? chronologicalJobs : rollingJobs

  return (
    <div className="p-4 bg-muted/30 rounded-lg flex flex-col h-full">
      <div className="text-sm font-medium mb-3">Load Optimization Job</div>

      {/* Job Type Selector */}
      <div className="mb-3">
        <label className="text-xs text-muted-foreground block mb-1">Job Type</label>
        <select
          value={jobType}
          onChange={(e) => {
            setJobType(e.target.value as 'chronological' | 'rolling')
            setSelectedJobId(null) // Reset selection when changing type
          }}
          className="w-full px-2 py-1 rounded border border-border bg-background text-sm"
        >
          <option value="chronological">Chronological (Split)</option>
          <option value="rolling">Rolling (Walk Forward)</option>
        </select>
      </div>

      {/* Job Selector */}
      <div className="mb-3">
        <label className="text-xs text-muted-foreground block mb-1">Select Job</label>
        <select
          value={selectedJobId || ''}
          onChange={(e) => setSelectedJobId(Number(e.target.value) || null)}
          className="w-full px-2 py-1 rounded border border-border bg-background text-sm"
          disabled={currentJobs.length === 0}
        >
          <option value="">-- Select Job --</option>
          {currentJobs.map(job => (
            <option key={job.id} value={job.id}>
              {job.botName} - {new Date(job.createdAt).toLocaleString()} ({job.branchCount} branches)
            </option>
          ))}
        </select>
      </div>

      <Button
        onClick={handleLoadJob}
        disabled={!selectedJobId || loading}
        size="sm"
        className="mb-3"
      >
        {loading ? 'Loading...' : 'Load Job'}
      </Button>

      {/* Error Display */}
      {error && (
        <div className="text-xs text-red-500 mb-3 p-2 bg-red-50 rounded">
          {error}
        </div>
      )}

      {/* Current Loaded Job Info */}
      {loadedJobId && (
        <div className="p-2 bg-accent/10 rounded">
          <div className="text-xs font-bold text-accent-foreground">
            Loaded: {loadedJobType === 'chronological' ? 'Split' : 'Walk Forward'} Job #{loadedJobId}
          </div>
        </div>
      )}

      {/* Jobs List */}
      <div className="flex-1 mt-3 overflow-y-auto">
        <div className="text-xs font-medium mb-2">
          Available Jobs ({currentJobs.length})
        </div>
        <div className="space-y-2">
          {currentJobs.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-4">
              No {jobType === 'chronological' ? 'Split' : 'Walk Forward'} jobs found
            </div>
          ) : (
            currentJobs.map(job => (
              <div
                key={job.id}
                className={`p-2 rounded border text-xs cursor-pointer transition-colors ${
                  selectedJobId === job.id
                    ? 'border-accent bg-accent/10'
                    : 'border-border bg-background hover:border-accent/50'
                }`}
                onClick={() => setSelectedJobId(job.id)}
              >
                <div className="font-bold">{job.botName}</div>
                <div className="text-muted-foreground">
                  {new Date(job.createdAt).toLocaleString()}
                </div>
                <div className="text-muted-foreground">
                  {job.branchCount} branches
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
