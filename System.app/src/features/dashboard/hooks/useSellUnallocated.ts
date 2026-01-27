// src/features/dashboard/hooks/useSellUnallocated.ts
// Hook for selling unallocated positions (schedules sells for next trade window)

import { useState, useCallback } from 'react'

export interface SellOrder {
  symbol: string
  qty: number
  dollarValue: number
}

export interface PendingSell {
  id: string
  credentialType: 'live' | 'paper'
  symbol: string
  qty: number
  status: 'pending' | 'executed' | 'cancelled' | 'failed'
  createdAt: number
  executedAt?: number
  errorMessage?: string
}

interface ScheduleResult {
  success: boolean
  scheduled: boolean
  orders: Array<{
    id: string
    symbol: string
    qty: number
    status: string
  }>
  errors?: Array<{
    symbol: string
    error: string
  }>
  message?: string
}

export function useSellUnallocated() {
  const [isLoading, setIsLoading] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingSells, setPendingSells] = useState<PendingSell[]>([])

  // Schedule positions for sale at next trade window
  const scheduleSell = async (
    credentialType: 'live' | 'paper',
    orders: SellOrder[]
  ): Promise<ScheduleResult | null> => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/dashboard/broker/sell-unallocated', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          credentialType,
          orders: orders.map((o) => ({ symbol: o.symbol, qty: o.qty })),
        }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to schedule sells')
      }

      const result: ScheduleResult = await response.json()
      // Refresh pending sells after scheduling
      await fetchPendingSells(credentialType)
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setError(message)
      return null
    } finally {
      setIsLoading(false)
    }
  }

  // Fetch pending sell orders
  const fetchPendingSells = useCallback(async (credentialType?: 'live' | 'paper') => {
    try {
      const url = credentialType
        ? `/api/admin/dashboard/broker/pending-sells?credentialType=${credentialType}`
        : '/api/admin/dashboard/broker/pending-sells'

      const response = await fetch(url, {
        credentials: 'include',
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to fetch pending sells')
      }

      const data = await response.json()
      setPendingSells(data.pendingSells || [])
      return data.pendingSells || []
    } catch (err) {
      console.error('Failed to fetch pending sells:', err)
      return []
    }
  }, [])

  // Cancel a pending sell order
  const cancelPendingSell = async (id: string): Promise<boolean> => {
    setIsCancelling(true)
    setError(null)

    try {
      const response = await fetch(`/api/admin/dashboard/broker/pending-sells/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to cancel pending sell')
      }

      // Remove from local state
      setPendingSells((prev) => prev.filter((sell) => sell.id !== id))
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setError(message)
      return false
    } finally {
      setIsCancelling(false)
    }
  }

  return {
    scheduleSell,
    fetchPendingSells,
    cancelPendingSell,
    pendingSells,
    isLoading,
    isCancelling,
    error,
  }
}
