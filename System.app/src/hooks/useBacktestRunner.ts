// src/hooks/useBacktestRunner.ts
// Hook for running backtests on FlowNode trees

import { useCallback } from 'react'
import type { UTCTimestamp } from 'lightweight-charts'
import type {
  FlowNode,
  CallChain,
  BacktestWarning,
  BacktestResult,
  BacktestDayRow,
  BacktestAllocationRow,
  EquityPoint,
  EquityMarker,
} from '@/types'
import {
  cloneNode,
  ensureSlots,
} from '@/features/builder'
import {
  compressTreeForBacktest,
  computeMonthlyReturns,
  computeBacktestSummary,
  isoFromUtcSeconds,
  mdyFromUtcSeconds,
  emptyCache,
  getSeriesKey,
  buildPriceDb,
  collectBacktestInputs,
  collectPositionTickers,
  collectIndicatorTickers,
  makeBacktestValidationError,
  type EvalCtx,
  type Allocation,
  type PositionContribution,
  allocEntries,
  turnoverFraction,
  createBacktestTraceCollector,
  normalizeNodeForBacktest,
  evaluateNode,
  tracePositionContributions,
} from '@/features/backtest'
import { fetchOhlcSeriesBatch } from '@/features/data'
import { normalizeChoice } from '@/shared'
import { useBacktestStore } from '@/stores'

export interface BacktestRunResult {
  result: BacktestResult
}

interface UseBacktestRunnerOptions {
  callChainsById: Map<string, CallChain>
}

/**
 * Hook that provides the runBacktestForNode function
 * Extracts backtest execution logic from App.tsx
 */
export function useBacktestRunner({ callChainsById }: UseBacktestRunnerOptions) {
  const backtestMode = useBacktestStore((s) => s.backtestMode)
  const backtestCostBps = useBacktestStore((s) => s.backtestCostBps)
  const backtestBenchmark = useBacktestStore((s) => s.backtestBenchmark)

  const runBacktestForNode = useCallback(
    async (node: FlowNode): Promise<BacktestRunResult> => {
      const backtestStartTime = performance.now()
      const timings: Record<string, number> = {}

      // Phase 1: Tree preparation & compression
      const prepStartTime = performance.now()
      const prepared = normalizeNodeForBacktest(ensureSlots(cloneNode(node)))

      // Compress tree for faster evaluation
      const { tree: compressedTree, stats: compressionStats } = compressTreeForBacktest(prepared)
      if (!compressedTree) {
        throw makeBacktestValidationError([{ nodeId: prepared.id, field: 'tree', message: 'Strategy is empty after compression (all branches lead to Empty).' }])
      }
      timings['1_preparation'] = performance.now() - prepStartTime

      // Log compression stats to console
      console.log(
        `[Backtest] Tree compression: ${compressionStats.originalNodes} → ${compressionStats.compressedNodes} nodes ` +
          `(${compressionStats.nodesRemoved} removed, ${compressionStats.gateChainsMerged} gates merged) in ${compressionStats.compressionTimeMs.toFixed(1)}ms`
      )

      // Phase 2: Input collection & validation
      const inputStartTime = performance.now()
      // Use compressed tree for backtest, but original for validation/ticker collection
      const inputs = collectBacktestInputs(prepared, callChainsById)
      if (inputs.errors.length > 0) {
        throw makeBacktestValidationError(inputs.errors)
      }
      if (inputs.tickers.length === 0) {
        throw makeBacktestValidationError([{ nodeId: prepared.id, field: 'tickers', message: 'No tickers found in this strategy.' }])
      }
      timings['2_inputCollection'] = performance.now() - inputStartTime

      // Phase 3: Data fetching (using batch API for 5-10x speedup)
      const fetchStartTime = performance.now()
      const decisionPrice: EvalCtx['decisionPrice'] = backtestMode === 'CC' || backtestMode === 'CO' ? 'close' : 'open'
      const limit = 20000
      const benchTicker = normalizeChoice(backtestBenchmark)
      const needsBench = benchTicker && benchTicker !== 'Empty' && !inputs.tickers.includes(benchTicker)
      const needsSpy = !inputs.tickers.includes('SPY') && benchTicker !== 'SPY'

      // Build list of all tickers to fetch (including benchmark and SPY if needed)
      const allTickersToFetch = [...inputs.tickers]
      if (needsBench && benchTicker) allTickersToFetch.push(benchTicker)
      if (needsSpy) allTickersToFetch.push('SPY')

      // Batch fetch all tickers at once (much faster than individual fetches)
      const batchResults = await fetchOhlcSeriesBatch(allTickersToFetch, limit)

      // Convert batch results to the expected format
      const loaded = inputs.tickers.map((t) => ({
        ticker: t,
        bars: batchResults.get(t) || [],
      }))

      // Extract benchmark and SPY data from batch results
      const benchBarsFromBatch = needsBench && benchTicker ? batchResults.get(benchTicker) || null : null
      const spyBarsFromBatch = needsSpy ? batchResults.get('SPY') || null : null

      timings['3_dataFetching'] = performance.now() - fetchStartTime
      console.log(`[Backtest] Fetched ${inputs.tickers.length} tickers in ${timings['3_dataFetching'].toFixed(1)}ms`)

      // Phase 4: Build price DB
      const dbBuildStartTime = performance.now()
      // Collect indicator tickers (for date intersection) vs position tickers (can start later)
      const indicatorTickers = collectIndicatorTickers(prepared, callChainsById)
      const positionTickers = collectPositionTickers(prepared, callChainsById)

      // Build price DB using only indicator tickers for date intersection
      // This allows position tickers with shorter history (like UVXY) to not limit the date range
      const db = buildPriceDb(loaded, indicatorTickers.length > 0 ? indicatorTickers : undefined)
      if (db.dates.length < 3) {
        throw makeBacktestValidationError([{ nodeId: prepared.id, field: 'data', message: 'Not enough overlapping price data to run a backtest.' }])
      }
      timings['4_dbBuild'] = performance.now() - dbBuildStartTime
      console.log(`[Backtest] Built price DB: ${db.dates.length} dates, ${Object.keys(db.close).length} tickers in ${timings['4_dbBuild'].toFixed(1)}ms`)

      // Phase 5: Setup before evaluation
      const setupStartTime = performance.now()
      const cache = emptyCache()
      const warnings: BacktestWarning[] = []
      const trace = createBacktestTraceCollector()

      // Get benchmark bars (either from main data or separately fetched)
      let benchBars: Array<{ time: UTCTimestamp; open: number; close: number; adjClose: number }> | null = null
      if (benchTicker && benchTicker !== 'Empty') {
        const already = loaded.find((x) => getSeriesKey(x.ticker) === benchTicker)
        if (already && already.bars.length > 0) {
          benchBars = already.bars
        } else if (benchBarsFromBatch && benchBarsFromBatch.length > 0) {
          benchBars = benchBarsFromBatch
        } else {
          warnings.push({
            time: db.dates[0],
            date: isoFromUtcSeconds(db.dates[0]),
            message: `Benchmark ${benchTicker} failed to load`,
          })
        }
      }

      const benchMap = new Map<number, { open: number; close: number; adjClose: number }>()
      if (benchBars) {
        for (const b of benchBars) benchMap.set(Number(b.time), { open: b.open, close: b.close, adjClose: b.adjClose })
      }

      // SPY data for Treynor Ratio (always uses SPY as systematic risk benchmark)
      let spyBars: Array<{ time: UTCTimestamp; open: number; close: number; adjClose: number }> | null = null
      if (benchTicker === 'SPY' && benchBars) {
        spyBars = benchBars
      } else {
        const alreadySpy = loaded.find((x) => getSeriesKey(x.ticker) === 'SPY')
        if (alreadySpy && alreadySpy.bars.length > 0) {
          spyBars = alreadySpy.bars
        } else if (spyBarsFromBatch && spyBarsFromBatch.length > 0) {
          spyBars = spyBarsFromBatch
        }
      }

      const spyMap = new Map<number, { open: number; close: number; adjClose: number }>()
      if (spyBars) {
        for (const b of spyBars) spyMap.set(Number(b.time), { open: b.open, close: b.close, adjClose: b.adjClose })
      }

      // Find first index where all position tickers have valid close prices
      // This prevents allocating to tickers before their data starts
      let firstValidPosIndex = 0
      if (positionTickers.length > 0) {
        for (let i = 0; i < db.dates.length; i++) {
          let allValid = true
          for (const ticker of positionTickers) {
            const t = getSeriesKey(ticker)
            const closeVal = db.close[t]?.[i]
            if (closeVal == null) {
              allValid = false
              break
            }
          }
          if (allValid) {
            firstValidPosIndex = i
            break
          }
        }
      }

      const allocationsAt: Allocation[] = Array.from({ length: db.dates.length }, () => ({}))
      const contributionsAt: PositionContribution[][] = Array.from({ length: db.dates.length }, () => [])
      const lookback = Math.max(0, Math.floor(Number(inputs.maxLookback || 0)))
      const baseLookbackIndex = decisionPrice === 'open' ? (lookback > 0 ? lookback + 1 : 0) : lookback
      // Start evaluation at the later of: lookback requirement OR first valid position ticker date
      const startEvalIndex = Math.max(baseLookbackIndex, firstValidPosIndex)

      // Check if we have enough data for the lookback period
      if (startEvalIndex >= db.dates.length) {
        const limitingInfo = db.limitingTicker
          ? ` ${db.limitingTicker} has only ${db.tickerCounts?.[db.limitingTicker] ?? 0} days of data and is limiting the overlap.`
          : ''
        throw new Error(
          `Not enough historical data: strategy requires ${lookback} days of lookback, ` +
            `but only ${db.dates.length} days of overlapping data available.${limitingInfo} ` +
            `Need at least ${startEvalIndex + 1} days.`
        )
      }

      const callNodeCache = new Map<string, FlowNode>()
      const resolveCallNode = (id: string) => {
        const chain = callChainsById.get(id)
        if (!chain) return null
        if (!callNodeCache.has(id)) {
          callNodeCache.set(id, normalizeNodeForBacktest(ensureSlots(cloneNode(chain.root))))
        }
        return callNodeCache.get(id) ?? null
      }
      timings['5_evalSetup'] = performance.now() - setupStartTime

      // Phase 6: Main evaluation loop (the core backtest)
      const evalLoopStartTime = performance.now()
      const numBarsToEval = db.dates.length - startEvalIndex
      for (let i = startEvalIndex; i < db.dates.length; i++) {
        const indicatorIndex = decisionPrice === 'open' ? i - 1 : i
        const ctx: EvalCtx = {
          db,
          cache,
          decisionIndex: i,
          indicatorIndex,
          decisionPrice,
          warnings,
          resolveCall: resolveCallNode,
          trace,
        }
        allocationsAt[i] = evaluateNode(ctx, compressedTree)
        contributionsAt[i] = tracePositionContributions(ctx, compressedTree)
      }
      timings['6_evalLoop'] = performance.now() - evalLoopStartTime
      const evalPerBar = numBarsToEval > 0 ? timings['6_evalLoop'] / numBarsToEval : 0
      console.log(`[Backtest] Evaluation loop: ${numBarsToEval} bars in ${timings['6_evalLoop'].toFixed(1)}ms (${evalPerBar.toFixed(3)}ms/bar)`)

      // Phase 7: Return calculation loop
      const returnCalcStartTime = performance.now()
      const startTradeIndex = startEvalIndex
      const startPointIndex = backtestMode === 'OC' ? Math.max(0, startTradeIndex - 1) : startTradeIndex
      const points: EquityPoint[] = [{ time: db.dates[startPointIndex], value: 1 }]
      const benchmarkPoints: EquityPoint[] = benchMap.size ? [{ time: db.dates[startPointIndex], value: 1 }] : []
      const spyBenchmarkPoints: EquityPoint[] = spyMap.size ? [{ time: db.dates[startPointIndex], value: 1 }] : []
      const drawdownPoints: EquityPoint[] = [{ time: db.dates[startPointIndex], value: 0 }]
      const markers: EquityMarker[] = []
      const allocations: BacktestAllocationRow[] = []
      const returns: number[] = []
      const days: BacktestDayRow[] = []

      let equity = 1
      let peak = 1
      let benchEquity = 1
      let spyEquity = 1
      const startEnd = backtestMode === 'OC' ? startTradeIndex : startTradeIndex + 1
      for (let end = startEnd; end < db.dates.length; end++) {
        let start = end - 1
        if (backtestMode === 'OC') start = end
        if (start < 0 || start >= db.dates.length) continue
        if (backtestMode === 'OC' && end === 0) continue

        const alloc = allocationsAt[start] || {}
        const prevAlloc = start - 1 >= 0 ? allocationsAt[start - 1] || {} : {}
        const turnover = turnoverFraction(prevAlloc, alloc)
        const cost = (Math.max(0, backtestCostBps) / 10000) * turnover

        let gross = 0
        for (const [ticker, w] of Object.entries(alloc)) {
          if (!(w > 0)) continue
          const t = getSeriesKey(ticker)
          const openArr = db.open[t]
          const closeArr = db.close[t]
          const adjCloseArr = db.adjClose[t]
          const entry =
            backtestMode === 'OO'
              ? openArr?.[start]
              : backtestMode === 'CC'
                ? adjCloseArr?.[start]  // Use adjClose for dividend-adjusted returns
                : backtestMode === 'CO'
                  ? closeArr?.[start]
                  : openArr?.[start]
          const exit =
            backtestMode === 'OO'
              ? openArr?.[end]
              : backtestMode === 'CC'
                ? adjCloseArr?.[end]  // Use adjClose for dividend-adjusted returns
                : backtestMode === 'CO'
                  ? openArr?.[end]
                  : closeArr?.[start]
          if (entry == null || exit == null || !(entry > 0) || !(exit > 0)) {
            const date = isoFromUtcSeconds(db.dates[end])
            warnings.push({ time: db.dates[end], date, message: `Broken ticker ${t} on ${date} (missing price). Return forced to 0.` })
            markers.push({ time: db.dates[end], text: `Missing ${t}` })
            continue
          }
          gross += w * (exit / entry - 1)
        }

        if (!Number.isFinite(gross)) {
          const date = isoFromUtcSeconds(db.dates[end])
          warnings.push({ time: db.dates[end], date, message: `Non-finite gross return on ${date}. Return forced to 0.` })
          markers.push({ time: db.dates[end], text: 'Bad gross' })
          gross = 0
        }

        let net = gross - cost
        if (!Number.isFinite(net) || net < -0.9999) {
          const date = isoFromUtcSeconds(db.dates[end])
          warnings.push({ time: db.dates[end], date, message: `Non-finite net return on ${date}. Return forced to 0.` })
          markers.push({ time: db.dates[end], text: 'Bad net' })
          net = 0
        }
        equity *= 1 + net
        if (equity > peak) peak = equity
        const ddRaw = peak > 0 && Number.isFinite(equity) ? equity / peak - 1 : 0
        const dd = Math.min(0, Math.max(-0.9999, ddRaw))
        points.push({ time: db.dates[end], value: equity })
        drawdownPoints.push({ time: db.dates[end], value: dd })
        returns.push(net)

        // Show decision date (when you buy at close), matching QuantMage convention
        // In CC mode: start is the decision day, end is when we measure the return
        allocations.push({
          date: mdyFromUtcSeconds(db.dates[start]),
          entries: allocEntries(alloc),
        })

        if (benchMap.size) {
          const startTime = Number(db.dates[start])
          const endTime = Number(db.dates[end])
          const startBar = benchMap.get(startTime)
          const endBar = benchMap.get(endTime)
          const entryBench =
            backtestMode === 'OO'
              ? startBar?.open
              : backtestMode === 'CC'
                ? startBar?.adjClose  // Use adjClose for dividend-adjusted benchmark
                : backtestMode === 'CO'
                  ? startBar?.close
                  : startBar?.open
          const exitBench =
            backtestMode === 'OO'
              ? endBar?.open
              : backtestMode === 'CC'
                ? endBar?.adjClose  // Use adjClose for dividend-adjusted benchmark
                : backtestMode === 'CO'
                  ? endBar?.open
                  : startBar?.close
          if (entryBench != null && exitBench != null && entryBench > 0 && exitBench > 0) {
            benchEquity *= 1 + (exitBench / entryBench - 1)
            benchmarkPoints.push({ time: db.dates[end], value: benchEquity })
          } else {
            benchmarkPoints.push({ time: db.dates[end], value: benchEquity })
          }
        }

        // SPY tracking for Treynor Ratio calculation
        if (spyMap.size) {
          const startTime = Number(db.dates[start])
          const endTime = Number(db.dates[end])
          const startBar = spyMap.get(startTime)
          const endBar = spyMap.get(endTime)
          const entrySpy =
            backtestMode === 'OO'
              ? startBar?.open
              : backtestMode === 'CC'
                ? startBar?.adjClose  // Use adjClose for dividend-adjusted benchmark
                : backtestMode === 'CO'
                  ? startBar?.close
                  : startBar?.open
          const exitSpy =
            backtestMode === 'OO'
              ? endBar?.open
              : backtestMode === 'CC'
                ? endBar?.adjClose  // Use adjClose for dividend-adjusted benchmark
                : backtestMode === 'CO'
                  ? endBar?.open
                  : startBar?.close
          if (entrySpy != null && exitSpy != null && entrySpy > 0 && exitSpy > 0) {
            spyEquity *= 1 + (exitSpy / entrySpy - 1)
            spyBenchmarkPoints.push({ time: db.dates[end], value: spyEquity })
          } else {
            spyBenchmarkPoints.push({ time: db.dates[end], value: spyEquity })
          }
        }

        days.push({
          time: db.dates[end],
          date: isoFromUtcSeconds(db.dates[end]),
          equity,
          drawdown: dd,
          grossReturn: gross,
          netReturn: net,
          turnover,
          cost,
          holdings: allocEntries(alloc),
          endNodes: contributionsAt[start] || [],
        })
      }

      timings['7_returnCalc'] = performance.now() - returnCalcStartTime

      // Phase 8: Compute metrics
      const metricsStartTime = performance.now()
      const metrics = computeBacktestSummary(points, days.map((d) => d.drawdown), days, spyBenchmarkPoints.length > 0 ? spyBenchmarkPoints : undefined)
      const monthly = computeMonthlyReturns(days)
      timings['8_metrics'] = performance.now() - metricsStartTime

      // Total time
      const totalTime = performance.now() - backtestStartTime
      timings['total'] = totalTime

      // Print timing summary
      console.log(`[Backtest] ═══════════════════════════════════════════════════════`)
      console.log(`[Backtest] TIMING SUMMARY (${compressionStats.compressedNodes} nodes, ${numBarsToEval} bars):`)
      console.log(`[Backtest]   1. Preparation & Compression: ${timings['1_preparation'].toFixed(1)}ms`)
      console.log(`[Backtest]   2. Input Collection:          ${timings['2_inputCollection'].toFixed(1)}ms`)
      console.log(`[Backtest]   3. Data Fetching:             ${timings['3_dataFetching'].toFixed(1)}ms`)
      console.log(`[Backtest]   4. Price DB Build:            ${timings['4_dbBuild'].toFixed(1)}ms`)
      console.log(`[Backtest]   5. Evaluation Setup:          ${timings['5_evalSetup'].toFixed(1)}ms`)
      console.log(`[Backtest]   6. Evaluation Loop:           ${timings['6_evalLoop'].toFixed(1)}ms (${evalPerBar.toFixed(3)}ms/bar)`)
      console.log(`[Backtest]   7. Return Calculation:        ${timings['7_returnCalc'].toFixed(1)}ms`)
      console.log(`[Backtest]   8. Metrics Computation:       ${timings['8_metrics'].toFixed(1)}ms`)
      console.log(`[Backtest] ───────────────────────────────────────────────────────`)
      console.log(`[Backtest]   TOTAL:                        ${totalTime.toFixed(1)}ms (${(totalTime/1000).toFixed(2)}s)`)
      console.log(`[Backtest] ═══════════════════════════════════════════════════════`)

      return {
        result: {
          points,
          benchmarkPoints: benchmarkPoints.length ? benchmarkPoints : undefined,
          drawdownPoints,
          markers,
          metrics,
          days,
          allocations,
          warnings,
          monthly,
          trace: trace.toResult(),
        },
      }
    },
    [backtestMode, backtestBenchmark, backtestCostBps, callChainsById]
  )

  return { runBacktestForNode }
}
