// src/features/nexus/api/index.ts
// API functions for Nexus portfolio correlation and optimization

import { API_BASE } from '@/constants'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type CorrelationOptimizationMetric = 'correlation' | 'volatility' | 'beta' | 'sharpe'
export type CorrelationTimePeriod = 'full' | '1y' | '3y' | '5y'

export type CorrelationOptimizeParams = {
  botIds: string[]
  metric: CorrelationOptimizationMetric
  period: CorrelationTimePeriod
  maxWeight: number // 0-1 (e.g., 0.4 for 40%)
}

export type CorrelationOptimizeResult = {
  correlationMatrix: number[][]
  weights: number[]
  validBotIds: string[]
  portfolioMetrics: {
    cagr: number
    volatility: number
    sharpe: number
    maxDrawdown: number
    beta: number
  }
}

export type CorrelationRecommendParams = {
  currentBotIds: string[]
  candidateBotIds: string[]
  metric: CorrelationOptimizationMetric
  period: CorrelationTimePeriod
  limit: number
}

export type CorrelationRecommendation = {
  botId: string
  score: number
  correlation: number
  metrics: {
    cagr?: number
    sharpe?: number
  }
}

export type CorrelationRecommendResult = {
  recommendations: CorrelationRecommendation[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────────────────────────

const getAuthToken = (): string | null => {
  return localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken')
}

// ─────────────────────────────────────────────────────────────────────────────
// API Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Optimize portfolio weights based on correlation, volatility, beta, or sharpe.
 * Returns correlation matrix, optimal weights, and portfolio metrics.
 */
export const optimizeCorrelation = async (
  params: CorrelationOptimizeParams
): Promise<CorrelationOptimizeResult> => {
  const token = getAuthToken()
  if (!token) {
    throw new Error('Authentication required')
  }

  const res = await fetch(`${API_BASE}/correlation/optimize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  })

  const data = await res.json()
  if (!res.ok) {
    throw new Error(data.error || 'Optimization failed')
  }

  return data as CorrelationOptimizeResult
}

/**
 * Get bot recommendations based on correlation with current portfolio.
 * Returns ranked list of candidate bots that would improve portfolio.
 */
export const getCorrelationRecommendations = async (
  params: CorrelationRecommendParams
): Promise<CorrelationRecommendation[]> => {
  const token = getAuthToken()
  if (!token) {
    throw new Error('Authentication required')
  }

  const res = await fetch(`${API_BASE}/correlation/recommend`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  })

  const data = await res.json()
  if (!res.ok) {
    throw new Error(data.error || 'Recommendations failed')
  }

  return data.recommendations || []
}
