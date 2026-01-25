// src/hooks/useBacktestRunner.ts
// Hook for running backtests on FlowNode trees via server API

import { useCallback } from 'react'
import type { UTCTimestamp } from 'lightweight-charts'
import type {
  FlowNode,
  CallChain,
  BacktestResult,
  BacktestDayRow,
  BacktestAllocationRow,
  EquityPoint,
  CustomIndicator,
} from '@/types'
import {
  cloneNode,
  ensureSlots,
} from '@/features/builder'
import {
  computeMonthlyReturns,
  normalizeNodeForBacktest,
} from '@/features/backtest'
import { useBacktestStore } from '@/stores'

const API_BASE = '/api'

export interface BacktestRunResult {
  result: BacktestResult
}

interface UseBacktestRunnerOptions {
  callChainsById: Map<string, CallChain>
  customIndicators?: CustomIndicator[]
}

/**
 * Hook that provides the runBacktestForNode function
 * All backtests are now routed through the server for IP protection
 * and consistent results across all environments.
 */
export function useBacktestRunner({ callChainsById: _callChainsById, customIndicators = [] }: UseBacktestRunnerOptions) {
  const backtestMode = useBacktestStore((s) => s.backtestMode)
  const backtestCostBps = useBacktestStore((s) => s.backtestCostBps)
  const backtestBenchmark = useBacktestStore((s) => s.backtestBenchmark)

  const runBacktestForNode = useCallback(
    async (node: FlowNode, splitConfig?: import('@/types').ISOOSSplitConfig, shardOosDate?: string): Promise<BacktestRunResult> => {
      // ========================================================================
      // SERVER-SIDE BACKTEST - All backtests are now routed through the server
      // for IP protection and consistent results across all environments.
      // ========================================================================
      const backtestStartTime = performance.now()

      // Prepare the payload
      const prepared = normalizeNodeForBacktest(ensureSlots(cloneNode(node)))
      const payload = JSON.stringify(prepared)

      // Call server API for backtest
      const response = await fetch(`${API_BASE}/backtest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payload,
          mode: backtestMode,
          costBps: backtestCostBps,
          customIndicators,
          splitConfig, // Pass splitConfig to backend for IS/OOS split calculation
          benchmarkTicker: backtestBenchmark,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Server backtest failed' }))
        throw new Error(errorData.error || `Server returned ${response.status}`)
      }

      const serverResult = await response.json()

      // Transform server response to frontend format
      // Server returns: { metrics, equityCurve, benchmarkCurve, allocations, compression }
      // Frontend expects: { result: { points, benchmarkPoints, drawdownPoints, markers, metrics, days, allocations, warnings, monthly, trace } }

      // Convert equity curve from { date, equity } to { time, value }
      const points: EquityPoint[] = (serverResult.equityCurve || []).map((p: { date: string; equity: number }) => ({
        time: Math.floor(new Date(p.date + 'T00:00:00Z').getTime() / 1000) as UTCTimestamp,
        value: p.equity,
      }))

      const benchmarkPoints: EquityPoint[] = (serverResult.benchmarkCurve || []).map((p: { date: string; equity: number }) => ({
        time: Math.floor(new Date(p.date + 'T00:00:00Z').getTime() / 1000) as UTCTimestamp,
        value: p.equity,
      }))

      // Compute drawdown from equity curve
      let peak = 1
      const drawdownPoints: EquityPoint[] = points.map((p) => {
        if (p.value > peak) peak = p.value
        const dd = peak > 0 ? p.value / peak - 1 : 0
        return { time: p.time, value: Math.min(0, dd) }
      })

      // Convert allocations from server format
      const allocations: BacktestAllocationRow[] = (serverResult.allocations || []).map((a: { date: string; alloc: Record<string, number> }) => ({
        date: a.date,
        entries: Object.entries(a.alloc || {})
          .filter(([_, w]) => (w as number) > 0)
          .map(([ticker, weight]) => ({ ticker, weight: weight as number }))
          .sort((x, y) => y.weight - x.weight),
      }))

      // Transform metrics from server format to frontend format
      const tradingDays = serverResult.metrics?.tradingDays ?? 0
      const years = tradingDays / 252
      const startDate = points.length > 0 ? new Date(Number(points[0].time) * 1000).toISOString().split('T')[0] : ''
      const endDate = points.length > 0 ? new Date(Number(points[points.length - 1].time) * 1000).toISOString().split('T')[0] : ''
      const totalReturn = points.length > 0 ? points[points.length - 1].value - 1 : 0

      const metrics = {
        startDate,
        endDate,
        days: tradingDays,
        years,
        totalReturn,
        cagr: serverResult.metrics?.cagr ?? 0,
        vol: serverResult.metrics?.volatility ?? 0,
        maxDrawdown: serverResult.metrics?.maxDrawdown ?? 0,
        calmar: serverResult.metrics?.calmarRatio ?? 0,
        sharpe: serverResult.metrics?.sharpeRatio ?? 0,
        sortino: serverResult.metrics?.sortinoRatio ?? 0,
        treynor: serverResult.metrics?.treynorRatio ?? 0,
        beta: serverResult.metrics?.beta ?? 0,
        winRate: serverResult.metrics?.winRate ?? 0,
        bestDay: serverResult.metrics?.bestDay ?? 0,
        worstDay: serverResult.metrics?.worstDay ?? 0,
        avgTurnover: serverResult.metrics?.avgTurnover ?? 0,
        avgHoldings: serverResult.metrics?.avgHoldings ?? 0,
      }

      // Extract OOS start date if available (for IS/OOS split visualization)
      let oosStartDate: string | undefined

      // Priority: 1. Server-calculated OOS date, 2. Shard OOS date (for combined strategies)
      if (serverResult.oosMetrics?.startDate) {
        oosStartDate = serverResult.oosMetrics.startDate
      } else if (shardOosDate) {
        oosStartDate = shardOosDate
      }

      // Helper to calculate turnover between two allocations
      const calculateTurnover = (prevAlloc: BacktestAllocationRow | undefined, currAlloc: BacktestAllocationRow | undefined): number => {
        if (!prevAlloc || !currAlloc) return 0

        const allTickers = new Set<string>()
        prevAlloc.entries.forEach(e => allTickers.add(e.ticker))
        currAlloc.entries.forEach(e => allTickers.add(e.ticker))

        let changed = 0
        for (const ticker of allTickers) {
          const prevWeight = prevAlloc.entries.find(e => e.ticker === ticker)?.weight ?? 0
          const currWeight = currAlloc.entries.find(e => e.ticker === ticker)?.weight ?? 0
          changed += Math.abs(currWeight - prevWeight)
        }

        return changed / 2
      }

      // Build minimal days array for monthly returns calculation
      const days: BacktestDayRow[] = points.slice(1).map((p, i) => {
        const prevEquity = i > 0 ? points[i].value : 1
        const netReturn = prevEquity > 0 ? p.value / prevEquity - 1 : 0
        const turnover = calculateTurnover(allocations[i - 1], allocations[i])
        const cost = (backtestCostBps / 10000) * turnover

        return {
          time: p.time,
          date: new Date(Number(p.time) * 1000).toISOString().split('T')[0],
          equity: p.value,
          drawdown: drawdownPoints[i + 1]?.value ?? 0,
          grossReturn: netReturn,
          netReturn,
          turnover,
          cost,
          holdings: allocations[i]?.entries || [],
          endNodes: [],
        }
      })

      const monthly = computeMonthlyReturns(days)

      // Transform IS/OOS metrics if available
      let isMetrics = undefined
      let oosMetrics = undefined

      if (serverResult.isMetrics) {
        isMetrics = {
          startDate: serverResult.isMetrics.startDate || '',
          endDate: serverResult.isMetrics.endDate || '',
          days: serverResult.isMetrics.days || 0,
          years: (serverResult.isMetrics.days || 0) / 252,
          totalReturn: serverResult.isMetrics.totalReturn || 0,
          cagr: serverResult.isMetrics.cagr || 0,
          vol: serverResult.isMetrics.volatility || 0,
          maxDrawdown: serverResult.isMetrics.maxDrawdown || 0,
          calmar: serverResult.isMetrics.calmarRatio || 0,
          sharpe: serverResult.isMetrics.sharpeRatio || 0,
          sortino: serverResult.isMetrics.sortinoRatio || 0,
          treynor: serverResult.isMetrics.treynorRatio || 0,
          beta: serverResult.isMetrics.beta || 0,
          winRate: serverResult.isMetrics.winRate || 0,
          bestDay: serverResult.isMetrics.bestDay || 0,
          worstDay: serverResult.isMetrics.worstDay || 0,
          avgTurnover: serverResult.isMetrics.avgTurnover || 0,
          avgHoldings: serverResult.isMetrics.avgHoldings || 0,
        }
      }

      if (serverResult.oosMetrics) {
        oosMetrics = {
          startDate: serverResult.oosMetrics.startDate || '',
          endDate: serverResult.oosMetrics.endDate || '',
          days: serverResult.oosMetrics.days || 0,
          years: (serverResult.oosMetrics.days || 0) / 252,
          totalReturn: serverResult.oosMetrics.totalReturn || 0,
          cagr: serverResult.oosMetrics.cagr || 0,
          vol: serverResult.oosMetrics.volatility || 0,
          maxDrawdown: serverResult.oosMetrics.maxDrawdown || 0,
          calmar: serverResult.oosMetrics.calmarRatio || 0,
          sharpe: serverResult.oosMetrics.sharpeRatio || 0,
          sortino: serverResult.oosMetrics.sortinoRatio || 0,
          treynor: serverResult.oosMetrics.treynorRatio || 0,
          beta: serverResult.oosMetrics.beta || 0,
          winRate: serverResult.oosMetrics.winRate || 0,
          bestDay: serverResult.oosMetrics.bestDay || 0,
          worstDay: serverResult.oosMetrics.worstDay || 0,
          avgTurnover: serverResult.oosMetrics.avgTurnover || 0,
          avgHoldings: serverResult.oosMetrics.avgHoldings || 0,
        }
      }

      // Transform IS/OOS split data for In Depth tab
      let isAllocations = undefined
      let oosAllocations = undefined
      let isMonthly = undefined
      let oosMonthly = undefined

      if (serverResult.isAllocations) {
        // Transform from backend format { date, alloc } to frontend format { date, entries }
        isAllocations = (serverResult.isAllocations || []).map((a: { date: string; alloc: Record<string, number> }) => ({
          date: a.date,
          entries: Object.entries(a.alloc || {})
            .filter(([_, w]) => (w as number) > 0)
            .map(([ticker, weight]) => ({ ticker, weight: weight as number }))
            .sort((x, y) => y.weight - x.weight),
        }))
      }
      if (serverResult.oosAllocations) {
        // Transform from backend format { date, alloc } to frontend format { date, entries }
        oosAllocations = (serverResult.oosAllocations || []).map((a: { date: string; alloc: Record<string, number> }) => ({
          date: a.date,
          entries: Object.entries(a.alloc || {})
            .filter(([_, w]) => (w as number) > 0)
            .map(([ticker, weight]) => ({ ticker, weight: weight as number }))
            .sort((x, y) => y.weight - x.weight),
        }))
      }

      // Compute monthly returns for IS/OOS periods from filtered days
      if (oosStartDate && days.length > 0) {
        const isDays = days.filter(d => d.date < oosStartDate)
        const oosDays = days.filter(d => d.date >= oosStartDate)

        if (isDays.length > 0) {
          isMonthly = computeMonthlyReturns(isDays)
        }
        if (oosDays.length > 0) {
          oosMonthly = computeMonthlyReturns(oosDays)
        }
      }

      return {
        result: {
          points,
          benchmarkPoints: benchmarkPoints.length > 0 ? benchmarkPoints : undefined,
          drawdownPoints,
          markers: [],
          metrics,
          isMetrics,
          oosMetrics,
          oosStartDate,
          isAllocations,
          oosAllocations,
          isMonthly,
          oosMonthly,
          days,
          allocations,
          warnings: [],
          monthly,
          trace: { nodes: [] },
        },
      }
    },
    [backtestMode, backtestCostBps, customIndicators, backtestBenchmark]
  )

  return { runBacktestForNode }
}
