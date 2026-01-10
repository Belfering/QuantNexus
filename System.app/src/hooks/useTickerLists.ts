// src/hooks/useTickerLists.ts
// Hook to fetch and manage ticker lists

import { useState, useEffect } from 'react'
import type { TickerList } from '@/types/tickerList'

export function useTickerLists() {
  const [tickerLists, setTickerLists] = useState<TickerList[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchTickerLists = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/ticker-lists')
      if (!response.ok) {
        throw new Error('Failed to fetch ticker lists')
      }
      const data = await response.json()
      setTickerLists(data)
    } catch (err) {
      console.error('Error fetching ticker lists:', err)
      setError(err instanceof Error ? err.message : 'Unknown error')
      setTickerLists([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTickerLists()
  }, [])

  return {
    tickerLists,
    loading,
    error,
    refetch: fetchTickerLists,
  }
}
