// src/features/dashboard/hooks/useBotPositions.ts
// Hook to fetch bot-specific positions from the position ledger

import { useState, useEffect, useCallback, useRef } from 'react'
import type { PortfolioMode } from '@/types'

export interface BotPosition {
  symbol: string
  shares: number
  avgPrice: number
  currentPrice: number
  marketValue: number
  unrealizedPl: number
  lastUpdated: string
}

export interface BotPositionsResult {
  positions: BotPosition[]
  totalValue: number
  isLoading: boolean
  error: string | null
  lastRefresh: number | null
  refresh: () => Promise<void>
}

interface BotPositionsResponse {
  positions: BotPosition[]
  totalValue: number
}

const REFRESH_INTERVAL_MS = 30000 // 30 seconds

export function useBotPositions(
  botId: string | null | undefined,
  portfolioMode: PortfolioMode,
  enabled: boolean = true
): BotPositionsResult {
  const [positions, setPositions] = useState<BotPosition[]>([])
  const [totalValue, setTotalValue] = useState<number>(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<number | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchPositions = useCallback(async () => {
    if (!botId || !enabled || portfolioMode === 'simulated') {
      setPositions([])
      setTotalValue(0)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const credentialType = portfolioMode === 'live' ? 'live' : 'paper'
      const response = await fetch(
        `/api/admin/trading/bot-positions/${botId}?credentialType=${credentialType}`,
        { credentials: 'include' }
      )

      if (!response.ok) {
        throw new Error(`Failed to fetch bot positions: ${response.statusText}`)
      }

      const data: BotPositionsResponse = await response.json()
      setPositions(data.positions || [])
      setTotalValue(data.totalValue || 0)
      setLastRefresh(Date.now())
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch bot positions'
      setError(errorMessage)
      console.error('[useBotPositions] Error:', err)
    } finally {
      setIsLoading(false)
    }
  }, [botId, portfolioMode, enabled])

  // Initial fetch
  useEffect(() => {
    if (enabled && botId && portfolioMode !== 'simulated') {
      fetchPositions()
    } else {
      setPositions([])
      setTotalValue(0)
    }
  }, [fetchPositions, enabled, botId, portfolioMode])

  // Auto-refresh polling
  useEffect(() => {
    if (!enabled || !botId || portfolioMode === 'simulated') {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    // Clear existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
    }

    // Set up new interval
    intervalRef.current = setInterval(() => {
      fetchPositions()
    }, REFRESH_INTERVAL_MS)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [fetchPositions, enabled, botId, portfolioMode])

  return {
    positions,
    totalValue,
    isLoading,
    error,
    lastRefresh,
    refresh: fetchPositions,
  }
}
