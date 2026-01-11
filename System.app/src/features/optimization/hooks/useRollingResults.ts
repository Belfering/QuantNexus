// Hook for fetching rolling optimization results for a specific job

import { useState, useEffect } from 'react'
import type { RollingOptimizationResult } from '@/types/bot'

export function useRollingResults(jobId: number | null) {
  const [result, setResult] = useState<RollingOptimizationResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!jobId) {
      setResult(null)
      return
    }

    async function fetchResults() {
      try {
        setLoading(true)
        setError(null)
        const response = await fetch(`/api/optimization/rolling/${jobId}`)
        if (!response.ok) {
          throw new Error('Failed to fetch rolling results')
        }
        const data = await response.json()
        setResult(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
        setResult(null)
      } finally {
        setLoading(false)
      }
    }

    fetchResults()
  }, [jobId])

  return {
    result,
    loading,
    error,
  }
}
