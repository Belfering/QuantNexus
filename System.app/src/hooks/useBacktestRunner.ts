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
}

/**
 * Hook that provides the runBacktestForNode function
 * All backtests are now routed through the server for IP protection
 * and consistent results across all environments.
 */
export function useBacktestRunner({ callChainsById: _callChainsById }: UseBacktestRunnerOptions) {
  const backtestMode = useBacktestStore((s) => s.backtestMode)
  const backtestCostBps = useBacktestStore((s) => s.backtestCostBps)

  const runBacktestForNode = useCallback(
    async (node: FlowNode): Promise<BacktestRunResult> => {
      // ========================================================================
      // SERVER-SIDE BACKTEST - All backtests are now routed through the server
      // for IP protection and consistent results across all environments.
      // ========================================================================
      const backtestStartTime = performance.now()

      // Prepare the payload
      const prepared = normalizeNodeForBacktest(ensureSlots(cloneNode(node)))
      const payload = JSON.stringify(prepared)

      // Call server API for backtest
      console.log(`[Backtest] Calling server API with mode=${backtestMode}, costBps=${backtestCostBps}...`)
      const response = await fetch(`${API_BASE}/backtest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payload,
          mode: backtestMode,
          costBps: backtestCostBps,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Server backtest failed' }))
        throw new Error(errorData.error || `Server returned ${response.status}`)
      }

      const serverResult = await response.json()
      const totalTime = performance.now() - backtestStartTime
      console.log(`[Backtest] Server response received in ${totalTime.toFixed(1)}ms`)

      // Log compression stats from server
      if (serverResult.compression) {
        console.log(
          `[Backtest] Tree compression: ${serverResult.compression.originalNodes} → ${serverResult.compression.compressedNodes} nodes ` +
            `(${serverResult.compression.nodesRemoved} removed, ${serverResult.compression.gatesMerged} gates merged) in ${serverResult.compression.compressionTimeMs?.toFixed(1) || '?'}ms`
        )
      }

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
      const allocations: BacktestAllocationRow[] = (serverResult.allocations || []).map((a: { date: string; holdings: Record<string, number> }) => ({
        date: a.date,
        entries: Object.entries(a.holdings || {})
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

      // Build minimal days array for monthly returns calculation
      const days: BacktestDayRow[] = points.slice(1).map((p, i) => {
        const prevEquity = i > 0 ? points[i].value : 1
        const netReturn = prevEquity > 0 ? p.value / prevEquity - 1 : 0
        return {
          time: p.time,
          date: new Date(Number(p.time) * 1000).toISOString().split('T')[0],
          equity: p.value,
          drawdown: drawdownPoints[i + 1]?.value ?? 0,
          grossReturn: netReturn,
          netReturn,
          turnover: 0,
          cost: 0,
          holdings: allocations[i]?.entries || [],
          endNodes: [],
        }
      })

      const monthly = computeMonthlyReturns(days)

      return {
        result: {
          points,
          benchmarkPoints: benchmarkPoints.length > 0 ? benchmarkPoints : undefined,
          drawdownPoints,
          markers: [],
          metrics,
          days,
          allocations,
          warnings: [],
          monthly,
          trace: { nodes: [] },
        },
      }
    },
    [backtestMode, backtestCostBps]
  )

  return { runBacktestForNode }
}
