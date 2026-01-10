// src/features/nexus/hooks/useCorrelation.ts
// Hook for portfolio correlation optimization and recommendations

import { useState, useEffect, useCallback } from 'react'
import type { SavedBot, AnalyzeBacktestState } from '@/types'
import {
  type CorrelationOptimizationMetric,
  type CorrelationTimePeriod,
  type CorrelationRecommendation,
  optimizeCorrelation,
  getCorrelationRecommendations,
} from '../api'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type PortfolioMetrics = {
  cagr: number
  volatility: number
  sharpe: number
  maxDrawdown: number
  beta: number
}

export type CorrelationState = {
  // Selection
  selectedBotIds: string[]
  optimizationMetric: CorrelationOptimizationMetric
  timePeriod: CorrelationTimePeriod
  maxWeight: number // percentage (0-100)

  // Results
  correlationMatrix: number[][] | null
  weights: Record<string, number> // botId -> weight percentage
  validBotIds: string[]
  portfolioMetrics: PortfolioMetrics | null

  // Loading/Error
  loading: boolean
  error: string | null

  // Recommendations
  userRecommendations: CorrelationRecommendation[]
  nexusRecommendations: CorrelationRecommendation[]

  // Filters
  minCagr: number | ''
  maxDrawdown: number | ''
  minSharpe: number | ''
  userSearch: string
  nexusSearch: string
}

export type CorrelationActions = {
  setSelectedBotIds: (ids: string[]) => void
  addBotId: (id: string) => void
  removeBotId: (id: string) => void
  setOptimizationMetric: (metric: CorrelationOptimizationMetric) => void
  setTimePeriod: (period: CorrelationTimePeriod) => void
  setMaxWeight: (weight: number) => void
  setMinCagr: (value: number | '') => void
  setMaxDrawdown: (value: number | '') => void
  setMinSharpe: (value: number | '') => void
  setUserSearch: (search: string) => void
  setNexusSearch: (search: string) => void
  passesFilters: (metrics: { cagr?: number; maxDrawdown?: number; sharpe?: number; sharpeRatio?: number } | null | undefined) => boolean
  passesUserSearch: (bot: SavedBot) => boolean
  passesNexusSearch: (bot: SavedBot) => boolean
}

export type UseCorrelationResult = CorrelationState & CorrelationActions

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export type UseCorrelationParams = {
  savedBots: SavedBot[]
  allNexusBots: SavedBot[]
  analyzeBacktests: Record<string, AnalyzeBacktestState>
}

export const useCorrelation = ({
  savedBots,
  allNexusBots,
  analyzeBacktests,
}: UseCorrelationParams): UseCorrelationResult => {
  // Selection state
  const [selectedBotIds, setSelectedBotIds] = useState<string[]>([])
  const [optimizationMetric, setOptimizationMetric] = useState<CorrelationOptimizationMetric>('correlation')
  const [timePeriod, setTimePeriod] = useState<CorrelationTimePeriod>('full')
  const [maxWeight, setMaxWeight] = useState<number>(40)

  // Results state
  const [correlationMatrix, setCorrelationMatrix] = useState<number[][] | null>(null)
  const [weights, setWeights] = useState<Record<string, number>>({})
  const [validBotIds, setValidBotIds] = useState<string[]>([])
  const [portfolioMetrics, setPortfolioMetrics] = useState<PortfolioMetrics | null>(null)

  // Loading/Error state
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Recommendations state
  const [userRecommendations, setUserRecommendations] = useState<CorrelationRecommendation[]>([])
  const [nexusRecommendations, setNexusRecommendations] = useState<CorrelationRecommendation[]>([])

  // Filter state
  const [minCagr, setMinCagr] = useState<number | ''>('')
  const [maxDrawdown, setMaxDrawdownState] = useState<number | ''>('')
  const [minSharpe, setMinSharpe] = useState<number | ''>('')
  const [userSearch, setUserSearch] = useState('')
  const [nexusSearch, setNexusSearch] = useState('')

  // Filter functions
  const passesFilters = useCallback(
    (metrics: { cagr?: number; maxDrawdown?: number; sharpe?: number; sharpeRatio?: number } | null | undefined): boolean => {
      if (!metrics) return false
      if (minCagr !== '' && (metrics.cagr ?? 0) * 100 < minCagr) return false
      if (maxDrawdown !== '' && Math.abs(metrics.maxDrawdown ?? 0) * 100 > maxDrawdown) return false
      if (minSharpe !== '' && (metrics.sharpe ?? metrics.sharpeRatio ?? 0) < minSharpe) return false
      return true
    },
    [minCagr, maxDrawdown, minSharpe]
  )

  const passesUserSearch = useCallback(
    (bot: SavedBot): boolean => {
      if (!userSearch.trim()) return true
      const search = userSearch.toLowerCase().trim()
      if (bot.name.toLowerCase().includes(search)) return true
      if (bot.tags?.some(tag => tag.toLowerCase().includes(search))) return true
      return false
    },
    [userSearch]
  )

  const passesNexusSearch = useCallback(
    (bot: SavedBot): boolean => {
      if (!nexusSearch.trim()) return true
      const search = nexusSearch.toLowerCase().trim()
      if (bot.name.toLowerCase().includes(search)) return true
      if (bot.tags?.some(tag => tag.toLowerCase().includes(search))) return true
      if (bot.builderDisplayName?.toLowerCase().includes(search)) return true
      return false
    },
    [nexusSearch]
  )

  // Actions
  const addBotId = useCallback((id: string) => {
    setSelectedBotIds(prev => prev.includes(id) ? prev : [...prev, id])
  }, [])

  const removeBotId = useCallback((id: string) => {
    setSelectedBotIds(prev => prev.filter(x => x !== id))
  }, [])

  const setMaxDrawdown = useCallback((value: number | '') => {
    setMaxDrawdownState(value)
  }, [])

  // Optimization effect
  useEffect(() => {
    if (selectedBotIds.length < 2) {
      setCorrelationMatrix(null)
      setWeights({})
      setPortfolioMetrics(null)
      setValidBotIds([])
      setError(null)
      return
    }

    const fetchOptimization = async () => {
      setLoading(true)
      setError(null)
      try {
        const result = await optimizeCorrelation({
          botIds: selectedBotIds,
          metric: optimizationMetric,
          period: timePeriod,
          maxWeight: maxWeight / 100,
        })

        // Convert weights array to object keyed by botId
        const weightsObj: Record<string, number> = {}
        result.validBotIds.forEach((botId, i) => {
          weightsObj[botId] = (result.weights[i] ?? 0) * 100
        })

        setWeights(weightsObj)
        setCorrelationMatrix(result.correlationMatrix)
        setValidBotIds(result.validBotIds)
        setPortfolioMetrics(result.portfolioMetrics)
      } catch (err) {
        console.error('[Correlation] Optimization error:', err)
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    }

    fetchOptimization()
  }, [selectedBotIds, optimizationMetric, timePeriod, maxWeight])

  // Recommendations effect
  useEffect(() => {
    const fetchRecommendations = async () => {
      // Check for auth token first to avoid spamming console with errors
      const token = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken')
      if (!token) {
        // Not authenticated, skip fetching recommendations
        return
      }

      // Get user bot IDs with backtest data
      const userBotIds = savedBots
        .filter(b => b.backtestResult || analyzeBacktests[b.id]?.result)
        .filter(b => passesUserSearch(b))
        .filter(b => !selectedBotIds.includes(b.id))
        .map(b => b.id)

      // Get nexus bot IDs with backtest data
      const nexusBotIds = allNexusBots
        .filter(b => b.backtestResult)
        .filter(b => passesNexusSearch(b))
        .filter(b => !selectedBotIds.includes(b.id))
        .map(b => b.id)

      // Fetch user recommendations
      if (userBotIds.length > 0) {
        try {
          const recs = await getCorrelationRecommendations({
            currentBotIds: selectedBotIds,
            candidateBotIds: userBotIds,
            metric: optimizationMetric,
            period: timePeriod,
            limit: 3,
          })
          setUserRecommendations(recs)
        } catch (err) {
          console.error('[Correlation] User recommendations error:', err)
        }
      } else {
        setUserRecommendations([])
      }

      // Fetch nexus recommendations
      if (nexusBotIds.length > 0) {
        try {
          const recs = await getCorrelationRecommendations({
            currentBotIds: selectedBotIds,
            candidateBotIds: nexusBotIds,
            metric: optimizationMetric,
            period: timePeriod,
            limit: 3,
          })
          setNexusRecommendations(recs)
        } catch (err) {
          console.error('[Correlation] Nexus recommendations error:', err)
        }
      } else {
        setNexusRecommendations([])
      }
    }

    fetchRecommendations()
  }, [selectedBotIds, optimizationMetric, timePeriod, savedBots, allNexusBots, analyzeBacktests, passesUserSearch, passesNexusSearch])

  return {
    // State
    selectedBotIds,
    optimizationMetric,
    timePeriod,
    maxWeight,
    correlationMatrix,
    weights,
    validBotIds,
    portfolioMetrics,
    loading,
    error,
    userRecommendations,
    nexusRecommendations,
    minCagr,
    maxDrawdown,
    minSharpe,
    userSearch,
    nexusSearch,
    // Actions
    setSelectedBotIds,
    addBotId,
    removeBotId,
    setOptimizationMetric,
    setTimePeriod,
    setMaxWeight,
    setMinCagr,
    setMaxDrawdown,
    setMinSharpe,
    setUserSearch,
    setNexusSearch,
    passesFilters,
    passesUserSearch,
    passesNexusSearch,
  }
}
