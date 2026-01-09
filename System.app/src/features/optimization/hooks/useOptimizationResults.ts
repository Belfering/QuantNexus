// Hook for fetching results for a specific optimization job

import { useState, useEffect } from 'react'
import type { OptimizationResult } from '@/types/optimizationJob'

type SortField = 'is_cagr' | 'is_sharpe' | 'is_calmar' | 'oos_cagr' | 'oos_sharpe' | 'oos_calmar'

export function useOptimizationResults(jobId: number | null) {
  const [results, setResults] = useState<OptimizationResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<SortField>('is_cagr')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  // Fetch results when jobId or sort changes
  useEffect(() => {
    if (!jobId) {
      setResults([])
      return
    }

    async function fetchResults() {
      try {
        setLoading(true)
        setError(null)
        const response = await fetch(
          `/api/optimization/${jobId}/results?sortBy=${sortBy}&order=${sortOrder}&limit=1000`
        )
        if (!response.ok) {
          throw new Error('Failed to fetch results')
        }
        const data = await response.json()
        setResults(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    fetchResults()
  }, [jobId, sortBy, sortOrder])

  return {
    results,
    loading,
    error,
    sortBy,
    sortOrder,
    setSortBy,
    setSortOrder,
  }
}
