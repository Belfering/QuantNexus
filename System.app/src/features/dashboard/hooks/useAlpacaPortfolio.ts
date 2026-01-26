// src/features/dashboard/hooks/useAlpacaPortfolio.ts
// Hook to fetch and manage Alpaca trading data for Dashboard (paper and live)
// Includes bot investments, position ledger, and unallocated positions for Live/Paper trading

import { useCallback, useEffect, useRef } from 'react'
import { useDashboardStore } from '@/stores/useDashboardStore'
import type { DashboardTimePeriod, PortfolioMode, BotInvestment, PositionLedgerEntry, UnallocatedPosition } from '@/types'

// API response types
interface BrokerStatusResponse {
  hasCredentials: boolean
  isPaper: boolean
  isConnected: boolean
  mode?: string
  errorMessage?: string
}

interface AccountResponse {
  equity: number
  cash: number
  buyingPower: number
  portfolioValue: number
  status: string
}

interface PositionsResponse {
  positions: Array<{
    symbol: string
    qty: number
    avgEntryPrice: number
    marketValue: number
    costBasis: number
    unrealizedPl: number
    unrealizedPlPc: number
    currentPrice: number
    side: string
  }>
}

interface HistoryResponse {
  history: Array<{
    timestamp: number
    equity: number
    profitLoss: number
    profitLossPct: number
  }>
}

interface InvestmentsResponse {
  investments: BotInvestment[]
}

interface LedgerResponse {
  ledger: PositionLedgerEntry[]
}

interface UnallocatedResponse {
  unallocated: UnallocatedPosition[]
}

// Refresh interval for auto-polling (30 seconds)
const REFRESH_INTERVAL_MS = 30000

export interface UseAlpacaPortfolioParams {
  portfolioMode: PortfolioMode
  timePeriod: DashboardTimePeriod
  enabled?: boolean
}

export interface UseAlpacaPortfolioResult {
  // Status
  hasCredentials: boolean
  isPaper: boolean
  isConnected: boolean
  isLoading: boolean
  error: string | null
  errorMessage: string | null
  lastRefresh: number | null

  // Alpaca data
  account: {
    equity: number
    cash: number
    buyingPower: number
    portfolioValue: number
    status: string
  } | null
  positions: Array<{
    symbol: string
    qty: number
    avgEntryPrice: number
    marketValue: number
    costBasis: number
    unrealizedPl: number
    unrealizedPlPc: number
    currentPrice: number
    side: string
  }>
  history: Array<{
    timestamp: number
    equity: number
    profitLoss: number
    profitLossPct: number
  }>

  // Bot investment and position attribution data
  investments: BotInvestment[]
  positionLedger: PositionLedgerEntry[]
  unallocatedPositions: UnallocatedPosition[]

  // Actions
  refresh: () => Promise<void>
  addInvestment: (botId: string, amount: number, mode: 'dollars' | 'percent') => Promise<boolean>
  removeInvestment: (botId: string) => Promise<boolean>
}

export function useAlpacaPortfolio({
  portfolioMode,
  timePeriod,
  enabled = true,
}: UseAlpacaPortfolioParams): UseAlpacaPortfolioResult {
  const {
    alpacaBrokerStatus,
    alpacaAccount,
    alpacaPositions,
    alpacaHistory,
    alpacaLoading,
    alpacaError,
    alpacaLastRefresh,
    botInvestments,
    positionLedger,
    unallocatedPositions,
    setAlpacaBrokerStatus,
    setAlpacaAccount,
    setAlpacaPositions,
    setAlpacaHistory,
    setAlpacaLoading,
    setAlpacaError,
    setAlpacaLastRefresh,
    setBotInvestments,
    setPositionLedger,
    setUnallocatedPositions,
  } = useDashboardStore()

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Get the API mode parameter based on portfolio mode
  const getApiMode = useCallback((mode: PortfolioMode): string => {
    if (mode === 'live') return 'live'
    return 'paper' // Both 'paper' and 'simulated' use paper credentials (simulated doesn't fetch anyway)
  }, [])

  // Fetch broker status for a specific mode
  const fetchBrokerStatus = useCallback(async (mode: PortfolioMode): Promise<BrokerStatusResponse | null> => {
    try {
      const apiMode = getApiMode(mode)
      const res = await fetch(`/api/admin/dashboard/broker/status?mode=${apiMode}`)
      if (!res.ok) return null
      return await res.json()
    } catch (err) {
      console.warn('[useAlpacaPortfolio] Failed to fetch broker status:', err)
      return null
    }
  }, [getApiMode])

  // Fetch account info for a specific mode
  const fetchAccount = useCallback(async (mode: PortfolioMode): Promise<AccountResponse | null> => {
    try {
      const apiMode = getApiMode(mode)
      const res = await fetch(`/api/admin/dashboard/broker/account?mode=${apiMode}`)
      if (!res.ok) return null
      return await res.json()
    } catch (err) {
      console.warn('[useAlpacaPortfolio] Failed to fetch account:', err)
      return null
    }
  }, [getApiMode])

  // Fetch positions for a specific mode
  const fetchPositions = useCallback(async (mode: PortfolioMode): Promise<PositionsResponse | null> => {
    try {
      const apiMode = getApiMode(mode)
      const res = await fetch(`/api/admin/dashboard/broker/positions?mode=${apiMode}`)
      if (!res.ok) return null
      return await res.json()
    } catch (err) {
      console.warn('[useAlpacaPortfolio] Failed to fetch positions:', err)
      return null
    }
  }, [getApiMode])

  // Fetch history for a specific mode
  const fetchHistory = useCallback(async (period: string, mode: PortfolioMode): Promise<HistoryResponse | null> => {
    try {
      const apiMode = getApiMode(mode)
      const res = await fetch(`/api/admin/dashboard/broker/history?period=${period}&mode=${apiMode}`)
      if (!res.ok) return null
      return await res.json()
    } catch (err) {
      console.warn('[useAlpacaPortfolio] Failed to fetch history:', err)
      return null
    }
  }, [getApiMode])

  // Fetch bot investments for a specific mode
  const fetchInvestments = useCallback(async (mode: PortfolioMode): Promise<InvestmentsResponse | null> => {
    try {
      const apiMode = getApiMode(mode)
      const res = await fetch(`/api/admin/trading/investments?mode=${apiMode}`)
      if (!res.ok) return null
      return await res.json()
    } catch (err) {
      console.warn('[useAlpacaPortfolio] Failed to fetch investments:', err)
      return null
    }
  }, [getApiMode])

  // Fetch position ledger for a specific mode
  const fetchLedger = useCallback(async (mode: PortfolioMode): Promise<LedgerResponse | null> => {
    try {
      const apiMode = getApiMode(mode)
      const res = await fetch(`/api/admin/trading/ledger?mode=${apiMode}`)
      if (!res.ok) return null
      return await res.json()
    } catch (err) {
      console.warn('[useAlpacaPortfolio] Failed to fetch ledger:', err)
      return null
    }
  }, [getApiMode])

  // Fetch unallocated positions for a specific mode
  const fetchUnallocated = useCallback(async (mode: PortfolioMode): Promise<UnallocatedResponse | null> => {
    try {
      const apiMode = getApiMode(mode)
      const res = await fetch(`/api/admin/trading/unallocated?mode=${apiMode}`)
      if (!res.ok) return null
      return await res.json()
    } catch (err) {
      console.warn('[useAlpacaPortfolio] Failed to fetch unallocated:', err)
      return null
    }
  }, [getApiMode])

  // Main refresh function - works for both paper and live modes
  const refresh = useCallback(async () => {
    // Only fetch for paper or live modes, not simulated
    if (portfolioMode === 'simulated') return

    setAlpacaLoading(true)
    setAlpacaError(null)

    const modeLabel = portfolioMode === 'live' ? 'Live' : 'Paper'

    try {
      // Check broker status first for the current mode
      const status = await fetchBrokerStatus(portfolioMode)
      if (!status) {
        setAlpacaError(`Failed to check ${modeLabel} broker status`)
        setAlpacaLoading(false)
        return
      }

      setAlpacaBrokerStatus(status)

      if (!status.hasCredentials) {
        setAlpacaError(`No Alpaca ${modeLabel} credentials configured. Set up in Admin > Trading Control.`)
        setAlpacaLoading(false)
        return
      }

      if (!status.isConnected) {
        setAlpacaError(`Alpaca ${modeLabel} connection failed. Check credentials in Admin > Trading Control.`)
        setAlpacaLoading(false)
        return
      }

      // Fetch all data in parallel
      const [accountData, positionsData, historyData, investmentsData, ledgerData, unallocatedData] = await Promise.all([
        fetchAccount(portfolioMode),
        fetchPositions(portfolioMode),
        fetchHistory(timePeriod, portfolioMode),
        fetchInvestments(portfolioMode),
        fetchLedger(portfolioMode),
        fetchUnallocated(portfolioMode),
      ])

      if (accountData) {
        setAlpacaAccount(accountData)
      }

      if (positionsData) {
        setAlpacaPositions(positionsData.positions)
      }

      if (historyData) {
        setAlpacaHistory(historyData.history)
      }

      if (investmentsData) {
        setBotInvestments(investmentsData.investments)
      }

      if (ledgerData) {
        setPositionLedger(ledgerData.ledger)
      }

      if (unallocatedData) {
        setUnallocatedPositions(unallocatedData.unallocated)
      }

      setAlpacaLastRefresh(Date.now())
    } catch (err) {
      setAlpacaError(err instanceof Error ? err.message : `Failed to fetch Alpaca ${modeLabel} data`)
    } finally {
      setAlpacaLoading(false)
    }
  }, [
    portfolioMode,
    timePeriod,
    fetchBrokerStatus,
    fetchAccount,
    fetchPositions,
    fetchHistory,
    fetchInvestments,
    fetchLedger,
    fetchUnallocated,
    setAlpacaBrokerStatus,
    setAlpacaAccount,
    setAlpacaPositions,
    setAlpacaHistory,
    setBotInvestments,
    setPositionLedger,
    setUnallocatedPositions,
    setAlpacaLoading,
    setAlpacaError,
    setAlpacaLastRefresh,
  ])

  // Always check broker status on mount (so we know if credentials exist for toggling)
  useEffect(() => {
    if (enabled) {
      // Check status for the current portfolio mode (paper by default for toggle availability check)
      fetchBrokerStatus(portfolioMode !== 'simulated' ? portfolioMode : 'paper').then((status) => {
        if (status) {
          setAlpacaBrokerStatus(status)
        }
      })
    }
  }, [enabled, portfolioMode, fetchBrokerStatus, setAlpacaBrokerStatus])

  // Initial fetch when switching to paper or live mode
  useEffect(() => {
    if (enabled && (portfolioMode === 'paper' || portfolioMode === 'live')) {
      refresh()
    }
  }, [enabled, portfolioMode, refresh])

  // Re-fetch when time period changes (for history)
  useEffect(() => {
    if (enabled && (portfolioMode === 'paper' || portfolioMode === 'live') && alpacaBrokerStatus?.isConnected) {
      fetchHistory(timePeriod, portfolioMode).then((data) => {
        if (data) {
          setAlpacaHistory(data.history)
        }
      })
    }
  }, [enabled, portfolioMode, timePeriod, alpacaBrokerStatus?.isConnected, fetchHistory, setAlpacaHistory])

  // Auto-refresh polling when in paper or live mode
  useEffect(() => {
    if (enabled && (portfolioMode === 'paper' || portfolioMode === 'live') && alpacaBrokerStatus?.isConnected) {
      intervalRef.current = setInterval(() => {
        refresh()
      }, REFRESH_INTERVAL_MS)

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
      }
    } else {
      // Clear interval when in simulated mode
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [enabled, portfolioMode, alpacaBrokerStatus?.isConnected, refresh])

  // Add a bot investment
  const addInvestment = useCallback(async (botId: string, amount: number, mode: 'dollars' | 'percent'): Promise<boolean> => {
    if (portfolioMode === 'simulated') return false

    try {
      const apiMode = getApiMode(portfolioMode)
      const res = await fetch('/api/admin/trading/investments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: apiMode,
          botId,
          investmentAmount: amount,
          weightMode: mode,
        }),
      })

      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: 'Failed to add investment' }))
        console.error('[useAlpacaPortfolio] Failed to add investment:', error)
        return false
      }

      // Refresh investments after adding
      const investmentsData = await fetchInvestments(portfolioMode)
      if (investmentsData) {
        setBotInvestments(investmentsData.investments)
      }

      return true
    } catch (err) {
      console.error('[useAlpacaPortfolio] Error adding investment:', err)
      return false
    }
  }, [portfolioMode, getApiMode, fetchInvestments, setBotInvestments])

  // Remove a bot investment
  const removeInvestment = useCallback(async (botId: string): Promise<boolean> => {
    if (portfolioMode === 'simulated') return false

    try {
      const apiMode = getApiMode(portfolioMode)
      const res = await fetch(`/api/admin/trading/investments/${encodeURIComponent(botId)}?mode=${apiMode}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: 'Failed to remove investment' }))
        console.error('[useAlpacaPortfolio] Failed to remove investment:', error)
        return false
      }

      // Refresh investments after removing
      const investmentsData = await fetchInvestments(portfolioMode)
      if (investmentsData) {
        setBotInvestments(investmentsData.investments)
      }

      return true
    } catch (err) {
      console.error('[useAlpacaPortfolio] Error removing investment:', err)
      return false
    }
  }, [portfolioMode, getApiMode, fetchInvestments, setBotInvestments])

  return {
    // Status
    hasCredentials: alpacaBrokerStatus?.hasCredentials ?? false,
    isPaper: alpacaBrokerStatus?.isPaper ?? true,
    isConnected: alpacaBrokerStatus?.isConnected ?? false,
    isLoading: alpacaLoading,
    error: alpacaError,
    errorMessage: alpacaBrokerStatus?.errorMessage ?? null,
    lastRefresh: alpacaLastRefresh,

    // Alpaca data
    account: alpacaAccount,
    positions: alpacaPositions,
    history: alpacaHistory,

    // Bot investment and position attribution data
    investments: botInvestments,
    positionLedger: positionLedger,
    unallocatedPositions: unallocatedPositions,

    // Actions
    refresh,
    addInvestment,
    removeInvestment,
  }
}
