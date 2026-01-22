// src/features/dashboard/hooks/useSellUnallocated.ts
// Hook for selling unallocated positions

import { useState } from 'react'

export interface SellOrder {
  symbol: string
  qty: number
  dollarValue: number
}

interface SellResult {
  success: boolean
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
}

export function useSellUnallocated() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sellPositions = async (
    credentialType: 'live' | 'paper',
    orders: SellOrder[]
  ): Promise<SellResult | null> => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/dashboard/broker/sell-unallocated', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // Include cookies for session auth
        body: JSON.stringify({
          credentialType,
          orders: orders.map((o) => ({ symbol: o.symbol, qty: o.qty })),
        }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to sell positions')
      }

      const result: SellResult = await response.json()
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setError(message)
      return null
    } finally {
      setIsLoading(false)
    }
  }

  return { sellPositions, isLoading, error }
}
