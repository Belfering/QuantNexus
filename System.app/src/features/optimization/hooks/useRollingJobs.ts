// Hook for fetching all rolling optimization jobs

import { useState, useEffect } from 'react'

export interface RollingJob {
  id: number
  botId: string
  botName: string
  splitConfig: any
  validTickers: string[]
  tickerStartDates: Record<string, string>
  branchCount: number
  elapsedSeconds: number
  createdAt: number
}

export function useRollingJobs() {
  const [jobs, setJobs] = useState<RollingJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null)

  // Fetch jobs on mount
  useEffect(() => {
    async function fetchJobs() {
      try {
        setLoading(true)
        setError(null)
        const response = await fetch('/api/optimization/rolling/jobs')
        if (!response.ok) {
          throw new Error('Failed to fetch rolling jobs')
        }
        const data = await response.json()
        setJobs(data)

        // Auto-select first job if none selected
        if (!selectedJobId && data.length > 0) {
          setSelectedJobId(data[0].id)
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
      const response = await fetch('/api/optimization/rolling/jobs')
      if (!response.ok) {
        throw new Error('Failed to fetch rolling jobs')
      }
      const data = await response.json()
      setJobs(data)
    } catch (err) {
      console.error('Failed to refresh rolling jobs:', err)
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
