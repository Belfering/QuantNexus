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
    splitConfig?: import('@/types').ISOOSSplitConfig
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
  const backtestBenchmark = useBacktestStore((s) => s.backtestBenchmark)
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
          body: JSON.stringify({ mode: bot.backtestMode || 'CC', costBps: bot.backtestCostBps ?? 5, forceRefresh, benchmarkTicker: backtestBenchmark }),
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
            allocations?: { date: string; entries: { ticker: string; weight: number }[] }[]
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

          // Debug: Log what allocations were received from server
          console.log(`[Backtest] Server response for ${bot.name}:`, {
            allocations: serverAllocations ? `${serverAllocations.length} dates` : 'undefined',
            firstAllocation: serverAllocations?.[0],
            firstAllocationKeys: serverAllocations?.[0] ? Object.keys(serverAllocations[0]) : [],
            firstAllocationAlloc: serverAllocations?.[0]?.alloc,
            cached: wasCached
          })

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
          // Server sends { date, entries: [{ ticker, weight }] } directly
          const allocations: BacktestAllocationRow[] = (serverAllocations || []).map((a) => ({
            date: a.date,
            entries: a.entries || [],
          }))

          console.log(`[Backtest] Transformed allocations for ${bot.name}:`, {
            total: allocations.length,
            firstAllocation: allocations[0],
            firstEntries: allocations[0]?.entries,
            daysWithEntries: allocations.filter(a => a.entries.length > 0).length
          })

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

          console.log(`[Backtest] Built days array for ${bot.name}:`, {
            total: days.length,
            firstDay: days[0],
            firstDayHoldings: days[0]?.holdings,
            daysWithHoldings: days.filter(d => d.holdings.length > 0).length
          })

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
          console.log('[Backtest] ✅ Backtest state set to DONE - result saved for bot:', bot.id)

          // Auto eligibility tagging (for all logged-in users)
          if (userId && result?.metrics) {
            console.log('[Eligibility] ═══════════════════════════════════════════════════')
            console.log('[Eligibility] Starting eligibility check for bot:', bot.name)
            console.log('[Eligibility] User ID:', userId, '| isAdmin:', isAdmin)
            console.log('[Eligibility] Backtest Metrics:', {
              cagr: (result.metrics.cagr * 100).toFixed(2) + '%',
              sharpe: result.metrics.sharpe?.toFixed(2),
              maxDD: (result.metrics.maxDrawdown * 100).toFixed(2) + '%',
              calmar: result.metrics.calmar?.toFixed(2),
              days: result.metrics.days
            })
            try {
              // Fetch eligibility requirements
              const eligRes = await fetch('/api/admin/eligibility')
              if (eligRes.ok) {
                const { eligibilityRequirements } = await eligRes.json() as { eligibilityRequirements: EligibilityRequirement[] }

                // Check if bot is already in a Fund zone
                console.log('[Eligibility] 🔍 CRITICAL FIX CHECK - uiState analysis:')
                console.log('[Eligibility]   - typeof uiState:', typeof uiState)
                console.log('[Eligibility]   - uiState === null:', uiState === null)
                console.log('[Eligibility]   - uiState === undefined:', uiState === undefined)
                console.log('[Eligibility]   - uiState?.fundZones:', uiState?.fundZones)
                const fundZonesValue = uiState?.fundZones || {}
                console.log('[Eligibility] ✅ Fix worked! fundZonesValue =', fundZonesValue)
                console.log('[Eligibility]   - Object.keys(fundZonesValue):', Object.keys(fundZonesValue))
                const fundZonesArray = Object.values(fundZonesValue)
                const isInFundZone = fundZonesArray.includes(bot.id)
                console.log('[Eligibility]   - isInFundZone:', isInFundZone)

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
                    const newFundZones = { ...(prev?.fundZones || {}) }
                    for (const key of Object.keys(newFundZones) as (keyof FundZones)[]) {
                      if (newFundZones[key] === bot.id) {
                        newFundZones[key] = null
                      }
                    }
                    return { ...(prev || {}), fundZones: newFundZones }
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
              console.log('[Eligibility] ✅ Eligibility check COMPLETED SUCCESSFULLY')
              console.log('[Eligibility] ═══════════════════════════════════════════════════')
            } catch (eligErr) {
              console.error('[Eligibility] ❌ Eligibility check FAILED:', eligErr)
              console.error('[Eligibility] Error details:', {
                message: (eligErr as Error)?.message,
                stack: (eligErr as Error)?.stack?.split('\n').slice(0, 3)
              })
              console.log('[Eligibility] ═══════════════════════════════════════════════════')
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

          console.log('[Backtest] 🎉 runAnalyzeBacktest COMPLETED SUCCESSFULLY for bot:', bot.name)
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
          body: JSON.stringify({ mode: bot.backtestMode || 'CC', costBps: bot.backtestCostBps ?? 5, benchmarkTicker: backtestBenchmark }),
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

    // Get oosStartDate and splitConfig from the appropriate backtest result
    // Check forgeBacktestResult first (Forge tab), then modelBacktestResult (Model tab)
    const backtestResult = savedBotId
      ? savedBots.find(b => b.id === savedBotId)?.backtest?.result
      : (useBacktestStore.getState().forgeBacktestResult || useBacktestStore.getState().modelBacktestResult)

    const oosStartDate = backtestResult?.oosStartDate || null

    // Get splitConfig from activeBot
    const splitConfig = activeBot?.splitConfig || undefined

    console.log('[runModelRobustness] DEBUG activeBot:', {
      exists: !!activeBot,
      id: activeBot?.id,
      savedBotId: activeBot?.savedBotId,
      hasSplitConfig: !!activeBot?.splitConfig,
      splitConfig: activeBot?.splitConfig,
      tabContext: (activeBot as any)?.tabContext,
      subtabContext: (activeBot as any)?.subtabContext,
    })
    console.log('[runModelRobustness] oosStartDate:', oosStartDate)
    console.log('[runModelRobustness] splitConfig (extracted):', splitConfig)
    console.log('[runModelRobustness] backtestResult has IS/OOS?', {
      hasIS: !!backtestResult?.isMetrics,
      hasOOS: !!backtestResult?.oosMetrics,
    })

    setModelSanityReport({ status: 'loading' })

    try {
      let res: Response

      if (savedBotId) {
        // Use saved bot endpoint (cached)
        res = await fetch(`${API_BASE}/bots/${savedBotId}/sanity-report`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: backtestMode, costBps: backtestCostBps, oosStartDate, splitConfig, benchmarkTicker: backtestBenchmark }),
        })
      } else {
        // Use direct payload endpoint for unsaved strategies
        const payload = JSON.stringify(ensureSlots(cloneNode(current)))
        res = await fetch(`${API_BASE}/sanity-report`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payload, mode: backtestMode, costBps: backtestCostBps, oosStartDate, splitConfig, benchmarkTicker: backtestBenchmark }),
        })
      }

      if (res.ok) {
        const data = await res.json() as { success: boolean; report: SanityReport; cached: boolean; cachedAt?: number }
        console.log('[runModelRobustness] Report received, has IS/OOS?', {
          hasISPathRisk: !!data.report.pathRisk.isPathRisk,
          hasOOSPathRisk: !!data.report.pathRisk.oosPathRisk,
        })
        setModelSanityReport({ status: 'done', report: data.report })
      } else {
        const errorData = await res.json().catch(() => ({ error: 'Server sanity report failed' }))
        setModelSanityReport({ status: 'error', error: errorData.error || 'Failed to generate sanity report' })
      }
    } catch (err) {
      const message = String((err as Error)?.message || err)
      setModelSanityReport({ status: 'error', error: message })
    }
  }, [activeBot?.savedBotId, current, backtestMode, backtestCostBps, savedBots, setModelSanityReport])

  /**
   * Run ticker contribution analysis
   */
  const runAnalyzeTickerContribution = useCallback(
    async (key: string, ticker: string, botResult: BacktestResult) => {
      console.log(`[TickerCalc] Starting calculation for ${ticker}, key: ${key}`)
      setAnalyzeTickerContrib((prev) => {
        if (prev[key]?.status === 'loading') {
          console.log(`[TickerCalc] ${ticker}: already loading, skipping`)
          return prev
        }
        console.log(`[TickerCalc] ${ticker}: setting status to loading`)
        return { ...prev, [key]: { status: 'loading' } }
      })
      try {
        console.log(`[TickerCalc] ${ticker}: fetching OHLC data`)
        const bars = await fetchOhlcSeries(ticker, 20000)
        console.log(`[TickerCalc] ${ticker}: fetched ${bars.length} bars`)
        const barMap = new Map<number, { open: number; close: number; adjClose: number }>()
        for (const b of bars) barMap.set(Number(b.time), { open: Number(b.open), close: Number(b.close), adjClose: Number(b.adjClose) })

        const days = botResult.days || []
        const points = botResult.points || []
        const finalEquity = days.length > 0 ? days[days.length - 1]?.equity : undefined
        // Build equity curve for this ticker's contribution
        let tickerEquity = 1.0
        let winCount = 0
        let lossCount = 0
        let sumWins = 0
        let sumLossAbs = 0
        let validDays = 0
        let skippedNoWeight = 0
        let skippedNoPrices = 0

        // Start from day 1 since we need to look at previous day's holdings
        for (let i = 1; i < days.length; i++) {
          const day = days[i]
          const prevDay = days[i - 1]
          if (!prevDay) continue

          // Check if we held this ticker on the PREVIOUS day
          const weight = prevDay.holdings?.find((h) => normalizeChoice(h.ticker) === normalizeChoice(ticker))?.weight ?? 0

          if (!(Number.isFinite(weight) && weight > 0)) {
            skippedNoWeight++
            continue
          }

          validDays++

          // Get price bars
          const prevTime = prevDay.time
          const endTime = day.time
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
            skippedNoPrices++
            continue
          }

          // Calculate daily return for this ticker
          const r = exit / entry - 1

          // Weighted return for this day
          const dailyWeightedReturn = weight * r

          // Compound into equity curve
          tickerEquity *= (1 + dailyWeightedReturn)

          // Track win/loss for expectancy
          if (dailyWeightedReturn > 0) {
            winCount += 1
            sumWins += dailyWeightedReturn
          } else if (dailyWeightedReturn < 0) {
            lossCount += 1
            sumLossAbs += Math.abs(dailyWeightedReturn)
          }
        }

        // Final contribution is equity curve result minus starting value
        const returnPct = tickerEquity - 1
        const totalCount = winCount + lossCount
        const winRate = totalCount > 0 ? winCount / totalCount : 0
        const lossRate = totalCount > 0 ? lossCount / totalCount : 0
        const avgWin = winCount > 0 ? sumWins / winCount : 0
        const avgLoss = lossCount > 0 ? sumLossAbs / lossCount : 0
        const expectancy = winRate * avgWin - lossRate * avgLoss
        console.log(`[TickerCalc] ${ticker}: DONE - totalDays=${days.length}, validDays=${validDays}, skippedNoWeight=${skippedNoWeight}, skippedNoPrices=${skippedNoPrices}, tickerEquity=${tickerEquity.toFixed(4)}, returnPct=${returnPct.toFixed(4)}, expectancy=${expectancy.toFixed(4)}`)
        setAnalyzeTickerContrib((prev) => ({ ...prev, [key]: { status: 'done', returnPct, expectancy } }))
      } catch (err) {
        const message = String((err as Error)?.message || err)
        console.error(`[TickerCalc] ${ticker}: ERROR -`, message, err)
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
