// Hook for fetching all optimization jobs

import { useState, useEffect } from 'react'
import type { OptimizationJob } from '@/types/optimizationJob'

export function useOptimizationJobs() {
  const [jobs, setJobs] = useState<OptimizationJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null)

  // Fetch jobs on mount
  useEffect(() => {
    async function fetchJobs() {
      try {
        setLoading(true)
        setError(null)
        const response = await fetch('/api/optimization/jobs')
        if (!response.ok) {
          throw new Error('Failed to fetch jobs')
        }
        const data = await response.json()
        setJobs(data)

        // Auto-select first completed job if none selected
        if (!selectedJobId && data.length > 0) {
          const firstCompleted = data.find((j: OptimizationJob) => j.status === 'completed')
          if (firstCompleted) {
            setSelectedJobId(firstCompleted.id)
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    fetchJobs()
  }, [selectedJobId])

  // Refresh jobs (useful after saving a new job)
  const refresh = async () => {
    try {
      const response = await fetch('/api/optimization/jobs')
      if (!response.ok) {
        throw new Error('Failed to fetch jobs')
      }
      const data = await response.json()
      setJobs(data)
    } catch (err) {
      console.error('Failed to refresh jobs:', err)
    }
  }

  return {
    jobs,
    loading,
    error,
    selectedJobId,
    setSelectedJobId,
    refresh,
  }
}
