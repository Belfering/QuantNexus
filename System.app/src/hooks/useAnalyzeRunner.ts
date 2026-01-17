// src/hooks/useAnalyzeRunner.ts
// Hook for running analyze backtests, sanity reports, and ticker contributions

import { useCallback } from 'react'
import type { UTCTimestamp } from 'lightweight-charts'
import type {
  FlowNode,
  UserId,
  BacktestError,
  BacktestResult,
  BacktestDayRow,
  BacktestAllocationRow,
  EquityPoint,
  SavedBot,
  UserUiState,
  FundZones,
  EligibilityRequirement,
} from '@/types'
import {
  cloneNode,
  ensureSlots,
} from '@/features/builder'
import {
  isBacktestValidationError,
  type SanityReport,
  type ComparisonMetrics,
} from '@/features/backtest'
import { fetchOhlcSeries } from '@/features/data'
import { normalizeChoice } from '@/shared'
import { useBacktestStore } from '@/stores'
import { updateBotInApi, syncBotMetricsToApi } from '@/features/bots'
import { API_BASE } from '@/constants'
import type { BacktestRunResult } from './useBacktestRunner'

/**
 * Options for the useAnalyzeRunner hook
 */
interface UseAnalyzeRunnerOptions {
  runBacktestForNode: (node: FlowNode, splitConfig?: import('@/types').ISOOSSplitConfig, shardOosDate?: string) => Promise<BacktestRunResult>
  savedBots: SavedBot[]
  setSavedBots: (dataOrFn: SavedBot[] | ((prev: SavedBot[]) => SavedBot[])) => void
  userId: UserId | null
  isAdmin: boolean
  uiState: UserUiState
  setUiState: (dataOrFn: UserUiState | ((prev: UserUiState) => UserUiState)) => void
  // For runModelRobustness - the active bot context
  activeBot?: {
    savedBotId?: string
  }
  current: FlowNode
}

/**
 * Hook that provides analyze/sanity handlers
 * Extracts analyze execution logic from App.tsx (Phase 2N-17)
 */
export function useAnalyzeRunner({
  runBacktestForNode,
  savedBots,
  setSavedBots,
  userId,
  isAdmin,
  uiState,
  setUiState,
  activeBot,
  current,
}: UseAnalyzeRunnerOptions) {
  // Backtest settings from store
  const backtestMode = useBacktestStore((s) => s.backtestMode)
  const backtestCostBps = useBacktestStore((s) => s.backtestCostBps)
  const benchmarkMetrics = useBacktestStore((s) => s.benchmarkMetrics)

  // State setters from store
  const setAnalyzeBacktests = useBacktestStore((s) => s.setAnalyzeBacktests)
  const setAnalyzeTickerContrib = useBacktestStore((s) => s.setAnalyzeTickerContrib)
  const setSanityReports = useBacktestStore((s) => s.setSanityReports)
  const setBenchmarkMetrics = useBacktestStore((s) => s.setBenchmarkMetrics)
  const setModelSanityReport = useBacktestStore((s) => s.setModelSanityReport)

  /**
   * Run backtest for a saved bot in the Analyze tab
   */
  const runAnalyzeBacktest = useCallback(
    async (bot: SavedBot, forceRefresh = false) => {
      setAnalyzeBacktests((prev) => {
        if (prev[bot.id]?.status === 'loading') return prev
        return { ...prev, [bot.id]: { status: 'loading' } }
      })

      // FRD-014: Always try server-side cached backtest first
      try {
        const res = await fetch(`${API_BASE}/bots/${bot.id}/run-backtest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: bot.backtestMode || 'CC', costBps: bot.backtestCostBps ?? 5, forceRefresh }),
        })

        if (res.ok) {
          const { metrics, equityCurve, benchmarkCurve, allocations: serverAllocations, cached: wasCached, compression } = await res.json() as {
            metrics: {
              cagr: number
              maxDrawdown: number
              calmarRatio: number
              sharpeRatio: number
              sortinoRatio: number
              treynorRatio?: number
              beta?: number
              volatility: number
              winRate?: number
              avgTurnover?: number
              avgHoldings?: number
              bestDay?: number
              worstDay?: number
              tradingDays: number
            }
            equityCurve?: { date: string; equity: number }[]
            benchmarkCurve?: { date: string; equity: number }[]
            allocations?: { date: string; alloc: Record<string, number> }[]
            cached?: boolean
            compression?: {
              originalNodes: number
              compressedNodes: number
              nodesRemoved: number
              gatesMerged: number
              compressionTimeMs: number
            }
          }

          if (wasCached) {
            console.log(`[Backtest] Cache hit for ${bot.name}`)
          } else if (compression) {
            console.log(`[Backtest] Tree compression: ${compression.originalNodes} → ${compression.compressedNodes} nodes (${compression.nodesRemoved} removed, ${compression.gatesMerged} gates merged) in ${compression.compressionTimeMs}ms`)
          }

          // Convert equity curve from server format to frontend format
          const safeParseDate = (dateStr: string | undefined): number => {
            if (!dateStr) return 0
            const d = new Date(dateStr)
            const t = d.getTime()
            return Number.isFinite(t) ? t / 1000 : 0
          }
          const points: EquityPoint[] = (equityCurve || [])
            .filter((p) => p.date && !isNaN(new Date(p.date).getTime()))
            .map((p) => ({
              time: safeParseDate(p.date) as UTCTimestamp,
              value: p.equity,
            }))
          // Convert benchmark curve (SPY) to frontend format
          const benchmarkPoints: EquityPoint[] = (benchmarkCurve || [])
            .filter((p) => p.date && !isNaN(new Date(p.date).getTime()))
            .map((p) => ({
              time: safeParseDate(p.date) as UTCTimestamp,
              value: p.equity,
            }))
          // Compute drawdown points from equity curve
          let peak = 1
          const drawdownPoints: EquityPoint[] = points.map((p) => {
            if (p.value > peak) peak = p.value
            const dd = (p.value - peak) / peak
            return { time: p.time, value: dd }
          })
          const startDate = equityCurve?.[0]?.date || ''
          const endDate = equityCurve?.[equityCurve.length - 1]?.date || ''
          const totalReturn = points.length > 0 ? points[points.length - 1].value - 1 : 0
          const years = metrics.tradingDays / 252

          // Convert server allocations to frontend format
          const allocations: BacktestAllocationRow[] = (serverAllocations || []).map((a) => ({
            date: a.date,
            entries: Object.entries(a.alloc)
              .filter(([, w]) => w > 0)
              .map(([ticker, weight]) => ({ ticker, weight })),
          }))

          // Build days array from allocations for ticker stats table
          const days: BacktestDayRow[] = allocations.map((a, i) => ({
            time: safeParseDate(a.date) as UTCTimestamp,
            date: a.date,
            equity: points[i]?.value ?? 1,
            drawdown: drawdownPoints[i]?.value ?? 0,
            grossReturn: 0,
            netReturn: 0,
            turnover: 0,
            cost: 0,
            holdings: a.entries.map((e) => ({ ticker: e.ticker, weight: e.weight })),
          }))

          const result: BacktestResult = {
            points,
            benchmarkPoints,
            drawdownPoints,
            markers: [],
            metrics: {
              startDate,
              endDate,
              days: metrics.tradingDays,
              years,
              totalReturn,
              cagr: metrics.cagr,
              maxDrawdown: metrics.maxDrawdown,
              calmar: metrics.calmarRatio,
              sharpe: metrics.sharpeRatio,
              sortino: metrics.sortinoRatio,
              vol: metrics.volatility,
              treynor: metrics.treynorRatio ?? 0,
              beta: metrics.beta ?? 0,
              winRate: metrics.winRate ?? 0,
              bestDay: metrics.bestDay ?? 0,
              worstDay: metrics.worstDay ?? 0,
              avgTurnover: metrics.avgTurnover ?? 0,
              avgHoldings: metrics.avgHoldings ?? 0,
            },
            days,
            allocations,
            warnings: [],
            monthly: [],
          }

          setAnalyzeBacktests((prev) => ({
            ...prev,
            [bot.id]: { status: 'done', result },
          }))

          // Auto eligibility tagging (for all logged-in users)
          if (userId && result?.metrics) {
            console.log('[Eligibility] Checking bot:', bot.name, 'userId:', userId, 'isAdmin:', isAdmin)
            try {
              // Fetch eligibility requirements
              const eligRes = await fetch('/api/admin/eligibility')
              console.log('[Eligibility] Fetch status:', eligRes.status)
              if (eligRes.ok) {
                const { eligibilityRequirements } = await eligRes.json() as { eligibilityRequirements: EligibilityRequirement[] }
                console.log('[Eligibility] Requirements:', eligibilityRequirements)

                // Check if bot is already in a Fund zone
                const isInFundZone = Object.values(uiState.fundZones).includes(bot.id)
                console.log('[Eligibility] isInFundZone:', isInFundZone)

                // Check live months requirement
                const liveMonthsReq = eligibilityRequirements.find(r => r.type === 'live_months')
                const botAgeMonths = (Date.now() - bot.createdAt) / (1000 * 60 * 60 * 24 * 30)
                const passesLiveMonths = !liveMonthsReq || botAgeMonths >= liveMonthsReq.value
                console.log('[Eligibility] passesLiveMonths:', passesLiveMonths)

                // Check metric requirements
                const percentMetrics = ['cagr', 'maxDrawdown', 'vol', 'winRate', 'avgTurnover']
                const metricReqs = eligibilityRequirements.filter(r => r.type === 'metric')
                const passesMetrics = metricReqs.every(req => {
                  const metricValue = result.metrics[req.metric as keyof typeof result.metrics]
                  console.log('[Eligibility] Checking metric:', req.metric, 'value:', metricValue, 'reqValue:', req.value, 'compareValue:', percentMetrics.includes(req.metric || '') ? req.value / 100 : req.value)
                  if (typeof metricValue !== 'number' || !Number.isFinite(metricValue)) return false
                  const compareValue = percentMetrics.includes(req.metric || '') ? req.value / 100 : req.value
                  const passes = req.comparison === 'at_least' ? metricValue >= compareValue : req.comparison === 'at_most' ? metricValue <= compareValue : true
                  console.log('[Eligibility] Metric passes:', passes)
                  if (req.comparison === 'at_least') return metricValue >= compareValue
                  if (req.comparison === 'at_most') return metricValue <= compareValue
                  return true
                })

                const passesAll = passesLiveMonths && passesMetrics
                console.log('[Eligibility] passesAll:', passesAll)

                // Detect stale fund zone reference (bot in zone but missing Nexus tag)
                const botTags = savedBots.find(b => b.id === bot.id)?.tags || []
                const hasNexusTag = botTags.includes('Nexus')
                const isStaleRef = isInFundZone && !hasNexusTag
                if (isStaleRef) {
                  // Clear the stale fund zone reference
                  setUiState(prev => {
                    const newFundZones = { ...prev.fundZones }
                    for (const key of Object.keys(newFundZones) as (keyof FundZones)[]) {
                      if (newFundZones[key] === bot.id) {
                        newFundZones[key] = null
                      }
                    }
                    return { ...prev, fundZones: newFundZones }
                  })
                }

                console.log('[Eligibility] About to update tags, passesAll:', passesAll, 'isInFundZone:', isInFundZone, 'isStaleRef:', isStaleRef)
                let updatedBotForSync: SavedBot | null = null
                setSavedBots(prev => prev.map(b => {
                  if (b.id !== bot.id) return b
                  const currentTags = b.tags || []
                  const hasNexus = currentTags.includes('Nexus')
                  const hasNexusEligible = currentTags.includes('Nexus Eligible')
                  const hasPrivate = currentTags.includes('Private')
                  console.log('[Eligibility] Bot found, currentTags:', currentTags, 'hasNexus:', hasNexus, 'hasNexusEligible:', hasNexusEligible)

                  if (passesAll) {
                    console.log('[Eligibility] passesAll=true, checking add condition...')
                    if ((!isInFundZone || isStaleRef) && !hasNexus && !hasNexusEligible) {
                      console.log('[Eligibility] ADDING Nexus Eligible tag!')
                      const baseTags = currentTags.filter(t => t !== 'Nexus' && t !== 'Atlas')
                      const newTags = hasPrivate ? [...baseTags, 'Nexus Eligible'] : ['Private', ...baseTags, 'Nexus Eligible']
                      updatedBotForSync = { ...b, tags: newTags }
                      return updatedBotForSync
                    }
                    console.log('[Eligibility] Condition not met')
                  } else {
                    if (hasNexus || hasNexusEligible) {
                      const baseTags = currentTags.filter(t => t !== 'Nexus' && t !== 'Nexus Eligible' && t !== 'Private' && t !== 'Atlas')
                      const newTags = ['Private', ...baseTags]
                      console.log('[Eligibility] Removing Nexus tags, new tags:', newTags)
                      updatedBotForSync = { ...b, tags: newTags }
                      return updatedBotForSync
                    }
                  }
                  return b
                }))
                // Sync tag changes to API
                if (updatedBotForSync && userId) {
                  updateBotInApi(userId, updatedBotForSync).catch(err => console.warn('[API] Failed to sync bot tags:', err))
                }
              }
            } catch (eligErr) {
              console.warn('Failed to check eligibility:', eligErr)
            }
          }

          // Sync metrics to database for Nexus bots
          if (result?.metrics && bot.tags?.includes('Nexus')) {
            syncBotMetricsToApi(bot.id, {
              cagr: result.metrics.cagr,
              maxDrawdown: result.metrics.maxDrawdown,
              calmarRatio: result.metrics.calmar,
              sharpeRatio: result.metrics.sharpe,
              sortinoRatio: result.metrics.sortino,
              treynorRatio: result.metrics.treynor,
              volatility: result.metrics.vol,
              winRate: result.metrics.winRate,
              avgTurnover: result.metrics.avgTurnover,
              avgHoldings: result.metrics.avgHoldings,
              tradingDays: result.metrics.days,
            }).catch((err) => console.warn('[API] Failed to sync metrics:', err))
          }

          return // Success - exit early
        }

        // Server returned error
        const errorData = await res.json().catch(() => ({ error: 'Server backtest failed' }))
        setAnalyzeBacktests((prev) => ({
          ...prev,
          [bot.id]: { status: 'error', error: errorData.error || 'Failed to run backtest' },
        }))
      } catch (err) {
        let message = String((err as Error)?.message || err)
        if (isBacktestValidationError(err)) {
          message = err.errors.map((e: BacktestError) => e.message).join(', ')
        }
        setAnalyzeBacktests((prev) => ({ ...prev, [bot.id]: { status: 'error', error: message } }))
      }
    },
    [runBacktestForNode, userId, uiState.fundZones, backtestMode, backtestCostBps, isAdmin, savedBots, setSavedBots, setUiState, setAnalyzeBacktests],
  )

  /**
   * Run sanity report for a saved bot
   */
  const runSanityReport = useCallback(
    async (bot: SavedBot) => {
      setSanityReports((prev) => {
        if (prev[bot.id]?.status === 'loading') return prev
        return { ...prev, [bot.id]: { status: 'loading' } }
      })

      try {
        const res = await fetch(`${API_BASE}/bots/${bot.id}/sanity-report`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: bot.backtestMode || 'CC', costBps: bot.backtestCostBps ?? 5 }),
        })

        if (res.ok) {
          const data = await res.json() as { success: boolean; report: SanityReport; cached: boolean; cachedAt?: number }
          setSanityReports((prev) => ({
            ...prev,
            [bot.id]: { status: 'done', report: data.report },
          }))
          return
        }

        const errorData = await res.json().catch(() => ({ error: 'Server sanity report failed' }))
        setSanityReports((prev) => ({
          ...prev,
          [bot.id]: { status: 'error', error: errorData.error || 'Failed to generate sanity report' },
        }))
      } catch (err) {
        const message = String((err as Error)?.message || err)
        setSanityReports((prev) => ({ ...prev, [bot.id]: { status: 'error', error: message } }))
      }
    },
    [backtestMode, backtestCostBps, setSanityReports],
  )

  /**
   * Fetch benchmark metrics (SPY, etc.)
   */
  const fetchBenchmarkMetrics = useCallback(async () => {
    if (benchmarkMetrics.status === 'loading') return

    setBenchmarkMetrics({ status: 'loading' })

    try {
      const res = await fetch(`${API_BASE}/benchmarks/metrics`)
      if (res.ok) {
        const data = await res.json() as { success: boolean; benchmarks: Record<string, ComparisonMetrics>; errors?: string[] }
        setBenchmarkMetrics({ status: 'done', data: data.benchmarks })
      } else {
        const errorData = await res.json().catch(() => ({ error: 'Failed to fetch benchmarks' }))
        setBenchmarkMetrics({ status: 'error', error: errorData.error || 'Failed to fetch benchmark metrics' })
      }
    } catch (err) {
      const message = String((err as Error)?.message || err)
      setBenchmarkMetrics({ status: 'error', error: message })
    }
  }, [benchmarkMetrics.status, setBenchmarkMetrics])

  /**
   * Run robustness analysis for the Model tab
   */
  const runModelRobustness = useCallback(async () => {
    const savedBotId = activeBot?.savedBotId

    setModelSanityReport({ status: 'loading' })

    try {
      let res: Response

      if (savedBotId) {
        // Use saved bot endpoint (cached)
        res = await fetch(`${API_BASE}/bots/${savedBotId}/sanity-report`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: backtestMode, costBps: backtestCostBps }),
        })
      } else {
        // Use direct payload endpoint for unsaved strategies
        const payload = JSON.stringify(ensureSlots(cloneNode(current)))
        res = await fetch(`${API_BASE}/sanity-report`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payload, mode: backtestMode, costBps: backtestCostBps }),
        })
      }

      if (res.ok) {
        const data = await res.json() as { success: boolean; report: SanityReport; cached: boolean; cachedAt?: number }
        setModelSanityReport({ status: 'done', report: data.report })
      } else {
        const errorData = await res.json().catch(() => ({ error: 'Server sanity report failed' }))
        setModelSanityReport({ status: 'error', error: errorData.error || 'Failed to generate sanity report' })
      }
    } catch (err) {
      const message = String((err as Error)?.message || err)
      setModelSanityReport({ status: 'error', error: message })
    }
  }, [activeBot?.savedBotId, current, backtestMode, backtestCostBps, setModelSanityReport])

  /**
   * Run ticker contribution analysis
   */
  const runAnalyzeTickerContribution = useCallback(
    async (key: string, ticker: string, botResult: BacktestResult) => {
      setAnalyzeTickerContrib((prev) => {
        if (prev[key]?.status === 'loading') return prev
        return { ...prev, [key]: { status: 'loading' } }
      })
      try {
        const bars = await fetchOhlcSeries(ticker, 20000)
        const barMap = new Map<number, { open: number; close: number; adjClose: number }>()
        for (const b of bars) barMap.set(Number(b.time), { open: Number(b.open), close: Number(b.close), adjClose: Number(b.adjClose) })

        const days = botResult.days || []
        const points = botResult.points || []
        let cumulative = 0
        let winCount = 0
        let lossCount = 0
        let sumWins = 0
        let sumLossAbs = 0

        for (let i = 0; i < days.length; i++) {
          const day = days[i]
          const prevBotEquity = i === 0 ? 1 : days[i - 1]?.equity ?? 1
          const weight = day.holdings?.find((h) => normalizeChoice(h.ticker) === normalizeChoice(ticker))?.weight ?? 0
          if (!(Number.isFinite(weight) && weight > 0)) {
            continue
          }

          const endTime = day.time
          const prevTime = points[i]?.time ?? endTime
          const startBar = barMap.get(Number(prevTime))
          const endBar = barMap.get(Number(endTime))
          const entry =
            backtestMode === 'OC'
              ? endBar?.open
              : backtestMode === 'OO'
                ? startBar?.open
                : backtestMode === 'CC'
                  ? startBar?.adjClose
                  : backtestMode === 'CO'
                    ? startBar?.close
                    : startBar?.open
          const exit =
            backtestMode === 'OC'
              ? endBar?.close
              : backtestMode === 'OO'
                ? endBar?.open
                : backtestMode === 'CC'
                  ? endBar?.adjClose
                  : backtestMode === 'CO'
                    ? endBar?.open
                    : endBar?.close
          if (entry == null || exit == null || !(entry > 0) || !(exit > 0)) {
            continue
          }

          const r = exit / entry - 1
          const investedWeight = (day.holdings || []).reduce((sum, h) => {
            const t = normalizeChoice(h.ticker)
            if (t === 'CASH' || t === 'Empty') return sum
            const w = Number(h.weight || 0)
            return sum + (Number.isFinite(w) ? w : 0)
          }, 0)
          const costShare = investedWeight > 0 ? (day.cost || 0) * (weight / investedWeight) : 0
          const contribPct = weight * r - costShare

          if (contribPct > 0) {
            winCount += 1
            sumWins += contribPct
          } else if (contribPct < 0) {
            lossCount += 1
            sumLossAbs += Math.abs(contribPct)
          }

          const dailyDollar = prevBotEquity * contribPct
          if (Number.isFinite(dailyDollar)) cumulative += dailyDollar
        }

        const botTotal = days.length ? (days[days.length - 1].equity ?? 1) - 1 : 0
        const returnPct = botTotal !== 0 ? cumulative / botTotal : 0
        const totalCount = winCount + lossCount
        const winRate = totalCount > 0 ? winCount / totalCount : 0
        const lossRate = totalCount > 0 ? lossCount / totalCount : 0
        const avgWin = winCount > 0 ? sumWins / winCount : 0
        const avgLoss = lossCount > 0 ? sumLossAbs / lossCount : 0
        const expectancy = winRate * avgWin - lossRate * avgLoss
        setAnalyzeTickerContrib((prev) => ({ ...prev, [key]: { status: 'done', returnPct, expectancy } }))
      } catch (err) {
        const message = String((err as Error)?.message || err)
        setAnalyzeTickerContrib((prev) => ({ ...prev, [key]: { status: 'error', error: message } }))
      }
    },
    [backtestMode, setAnalyzeTickerContrib],
  )

  return {
    runAnalyzeBacktest,
    runSanityReport,
    fetchBenchmarkMetrics,
    runModelRobustness,
    runAnalyzeTickerContribution,
  }
}
