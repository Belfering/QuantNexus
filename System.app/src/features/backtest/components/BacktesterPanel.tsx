// src/features/backtest/components/BacktesterPanel.tsx
// Main backtest panel with controls, metrics, and visualization tabs

import { useCallback, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { UTCTimestamp } from 'lightweight-charts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { cn } from '@/lib/utils'
import { formatPct, downloadTextFile } from '@/shared/utils'
import type { EquityPoint, BacktestWarning } from '@/types'
import {
  type BacktesterPanelProps,
  type ComparisonMetrics,
  normalizeChoice,
} from '../types'
import {
  type VisibleRange,
  EMPTY_EQUITY_POINTS,
  clampVisibleRangeToPoints,
  isoFromUtcSeconds,
  downloadEquityCsv,
  downloadAllocationsCsv,
  downloadRebalancesCsv,
} from '../utils'
import { BacktestModeDropdown } from './BacktestModeDropdown'
import { EquityChart } from './EquityChart'
import { DrawdownChart } from './DrawdownChart'
import { RangeNavigator } from './RangeNavigator'
import { AllocationChart, type AllocationSeriesData } from './AllocationChart'
import { renderMonthlyHeatmap } from './MonthlyHeatmap'

export function BacktesterPanel({
  mode,
  setMode,
  costBps,
  setCostBps,
  benchmark,
  setBenchmark,
  showBenchmark,
  setShowBenchmark,
  tickerOptions,
  status,
  result,
  errors,
  onRun,
  onJumpToError,
  indicatorOverlays,
  theme = 'light',
  benchmarkMetrics,
  onFetchBenchmarks,
  modelSanityReport,
  onFetchRobustness,
  onUndo: _onUndo,
  onRedo: _onRedo,
  canUndo: _canUndo = false,
  canRedo: _canRedo = false,
  openTickerModal,
}: BacktesterPanelProps) {
  const [tab, setTab] = useState<'Overview' | 'In Depth' | 'Benchmarks' | 'Robustness'>('Overview')
  const [selectedRange, setSelectedRange] = useState<VisibleRange | null>(null)
  const [logScale, setLogScale] = useState(true)
  const [activePreset, setActivePreset] = useState<'1m' | '3m' | '6m' | 'ytd' | '1y' | '5y' | 'max' | 'custom'>('max')
  const [rangePickerOpen, setRangePickerOpen] = useState(false)
  const [rangeStart, setRangeStart] = useState<string>('')
  const [rangeEnd, setRangeEnd] = useState<string>('')
  const rangePickerRef = useRef<HTMLDivElement | null>(null)
  const rangePopoverRef = useRef<HTMLDivElement | null>(null)
  const [rangePopoverPos, setRangePopoverPos] = useState<{ top: number; left: number; width: number } | null>(null)

  const benchmarkKnown = useMemo(() => {
    const t = normalizeChoice(benchmark)
    if (!t || t === 'Empty') return false
    return tickerOptions.includes(t)
  }, [benchmark, tickerOptions])

  const points = result?.points ?? EMPTY_EQUITY_POINTS
  const visibleRange = useMemo<VisibleRange | undefined>(() => {
    if (!points.length) return undefined
    const full = { from: points[0].time, to: points[points.length - 1].time }
    const r = selectedRange ?? full
    return clampVisibleRangeToPoints(points, r)
  }, [points, selectedRange])

  // Rebase points so the first visible point = 1 (0%)
  const rebasedPoints = useMemo(() => {
    if (!points.length || !visibleRange) return points
    const fromTime = Number(visibleRange.from)
    const firstVisibleIdx = points.findIndex(p => Number(p.time) >= fromTime)
    if (firstVisibleIdx < 0) return points
    const baseValue = points[firstVisibleIdx].value
    if (!baseValue || baseValue <= 0) return points
    return points.map(p => ({ ...p, value: p.value / baseValue }))
  }, [points, visibleRange])

  // Also rebase benchmark points
  const rebasedBenchmarkPoints = useMemo(() => {
    const benchPts = result?.benchmarkPoints
    if (!benchPts?.length || !visibleRange) return benchPts
    const fromTime = Number(visibleRange.from)
    const firstVisibleIdx = benchPts.findIndex(p => Number(p.time) >= fromTime)
    if (firstVisibleIdx < 0) return benchPts
    const baseValue = benchPts[firstVisibleIdx].value
    if (!baseValue || baseValue <= 0) return benchPts
    return benchPts.map(p => ({ ...p, value: p.value / baseValue }))
  }, [result?.benchmarkPoints, visibleRange])

  const handleRun = useCallback(() => {
    setSelectedRange(null)
    setActivePreset('max')
    setRangePickerOpen(false)
    setRangeStart('')
    setRangeEnd('')
    onRun()
  }, [onRun])

  const computeRangePopoverPos = useCallback(() => {
    const anchor = rangePickerRef.current
    if (!anchor) return null
    const rect = anchor.getBoundingClientRect()
    const width = 360
    const padding = 10
    const top = rect.bottom + 8
    let left = rect.right - width
    left = Math.max(padding, Math.min(left, window.innerWidth - width - padding))
    return { top, left, width }
  }, [])

  const rangeLabel = useMemo(() => {
    if (!visibleRange) return { start: '', end: '' }
    return { start: isoFromUtcSeconds(visibleRange.from), end: isoFromUtcSeconds(visibleRange.to) }
  }, [visibleRange])

  const tradingDaysInRange = useMemo(() => {
    if (!result || !visibleRange) return 0
    const from = Number(visibleRange.from)
    const to = Number(visibleRange.to)
    if (!(Number.isFinite(from) && Number.isFinite(to) && from <= to)) return 0
    const nPoints = points.filter((p) => {
      const t = Number(p.time)
      return t >= from && t <= to
    }).length
    return Math.max(0, nPoints - 1)
  }, [result, visibleRange, points])

  const applyPreset = (preset: '1m' | '3m' | '6m' | 'ytd' | '1y' | '5y' | 'max') => {
    if (!points.length) return
    setActivePreset(preset)
    if (preset === 'max') {
      setSelectedRange(null)
      return
    }

    try {
      const endTime = visibleRange?.to ?? points[points.length - 1].time
      const endMs = Number(endTime) * 1000
      if (!Number.isFinite(endMs)) return
      const endDate = new Date(endMs)
      let startDate: Date
      switch (preset) {
        case '1m':
          startDate = new Date(endDate)
          startDate.setUTCMonth(startDate.getUTCMonth() - 1)
          break
        case '3m':
          startDate = new Date(endDate)
          startDate.setUTCMonth(startDate.getUTCMonth() - 3)
          break
        case '6m':
          startDate = new Date(endDate)
          startDate.setUTCMonth(startDate.getUTCMonth() - 6)
          break
        case 'ytd':
          startDate = new Date(Date.UTC(endDate.getUTCFullYear(), 0, 1))
          break
        case '1y':
          startDate = new Date(endDate)
          startDate.setUTCFullYear(startDate.getUTCFullYear() - 1)
          break
        case '5y':
          startDate = new Date(endDate)
          startDate.setUTCFullYear(startDate.getUTCFullYear() - 5)
          break
      }
      const startSec = Math.floor(startDate.getTime() / 1000)
      let startTime = points[0].time
      for (let i = 0; i < points.length; i++) {
        if (Number(points[i].time) >= startSec) {
          startTime = points[i].time
          break
        }
      }
      setSelectedRange(clampVisibleRangeToPoints(points, { from: startTime, to: endTime }))
    } catch {
      // Invalid date - ignore preset
    }
  }

  const handleChartVisibleRangeChange = useCallback(
    (r: VisibleRange) => {
      if (!points.length) return
      const next = clampVisibleRangeToPoints(points, r)
      setActivePreset('custom')
      setSelectedRange((prev) => {
        if (!prev) return next
        if (Number(prev.from) === Number(next.from) && Number(prev.to) === Number(next.to)) return prev
        return next
      })
    },
    [points],
  )

  const applyCustomRange = useCallback(() => {
    if (!points.length) return
    if (!rangeStart || !rangeEnd) return
    const parse = (s: string) => {
      const [yy, mm, dd] = s.split('-').map((x) => Number(x))
      if (!(Number.isFinite(yy) && Number.isFinite(mm) && Number.isFinite(dd))) return null
      return Math.floor(Date.UTC(yy, mm - 1, dd) / 1000) as UTCTimestamp
    }
    const from0 = parse(rangeStart)
    const to0 = parse(rangeEnd)
    if (!from0 || !to0) return
    const clamped = clampVisibleRangeToPoints(points, { from: from0, to: to0 })
    setSelectedRange(clamped)
    setActivePreset('custom')
    setRangePickerOpen(false)
  }, [points, rangeEnd, rangeStart])

  const rangePopover = rangePickerOpen
    ? createPortal(
        <div
          ref={rangePopoverRef}
          className="range-popover"
          role="dialog"
          aria-label="Choose date range"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: rangePopoverPos?.top ?? 0,
            left: rangePopoverPos?.left ?? 0,
            width: rangePopoverPos?.width ?? 360,
            right: 'auto',
            zIndex: 500,
          }}
        >
          <div className="range-popover-row">
            <label className="range-field">
              <span>Start</span>
              <input type="date" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} />
            </label>
            <label className="range-field">
              <span>End</span>
              <input type="date" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} />
            </label>
          </div>
          <div className="range-popover-actions">
            <button onClick={() => setRangePickerOpen(false)}>Cancel</button>
            <button onClick={applyCustomRange}>Apply</button>
          </div>
        </div>,
        document.body,
      )
    : null

  const allocationSeries = useMemo<AllocationSeriesData[]>(() => {
    const days = result?.days || []
    if (days.length === 0) return []
    const totals = new Map<string, number>()
    for (const d of days) {
      for (const h of d.holdings) totals.set(h.ticker, (totals.get(h.ticker) || 0) + h.weight)
    }
    const ranked = Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([t]) => t)

    const palette = ['#0ea5e9', '#7c3aed', '#16a34a', '#f97316', '#db2777', '#0891b2', '#eab308', '#dc2626', '#475569', '#4f46e5']
    const series = ranked.map((ticker, i) => ({
      name: ticker,
      color: palette[i % palette.length],
      points: days.map((d) => ({
        time: d.time,
        value: d.holdings.find((h) => h.ticker === ticker)?.weight ?? 0,
      })) as EquityPoint[],
    }))

    series.push({
      name: 'Cash',
      color: '#94a3b8',
      points: days.map((d) => {
        const invested = d.holdings.reduce((a, b) => a + b.weight, 0)
        return { time: d.time, value: Math.max(0, 1 - invested) }
      }) as EquityPoint[],
    })

    return series
  }, [result])

  const groupedWarnings = useMemo(() => {
    const out = new Map<string, { message: string; count: number; first?: BacktestWarning; last?: BacktestWarning }>()
    for (const w of result?.warnings || []) {
      const key = w.message
      const prev = out.get(key)
      if (!prev) out.set(key, { message: key, count: 1, first: w, last: w })
      else out.set(key, { ...prev, count: prev.count + 1, last: w })
    }
    return Array.from(out.values()).sort((a, b) => b.count - a.count)
  }, [result])

  const rebalanceDays = useMemo(() => {
    return (result?.days || []).filter((d) => d.turnover > 0.0001)
  }, [result])

  // Render Benchmarks Tab Content
  const renderBenchmarksTab = () => {
    if (!result) return null

    return (
      <div className="saved-item flex flex-col gap-2.5 h-full min-w-0">
        <div className="flex items-center justify-between gap-2.5">
          <div className="font-black">Benchmark Comparison</div>
          <Button
            size="sm"
            onClick={() => onFetchBenchmarks?.()}
            disabled={benchmarkMetrics?.status === 'loading'}
          >
            {benchmarkMetrics?.status === 'loading' ? 'Loading...' : benchmarkMetrics?.status === 'done' ? 'Refresh' : 'Load Benchmarks'}
          </Button>
        </div>
        {benchmarkMetrics?.status === 'idle' && (
          <div className="text-muted text-sm p-4 border border-border rounded-xl text-center">
            Click "Load Benchmarks" to compare your strategy against major indices (VTI, SPY, QQQ, etc.).
          </div>
        )}
        {benchmarkMetrics?.status === 'loading' && (
          <div className="text-muted text-sm p-4 border border-border rounded-xl text-center">
            <div className="animate-pulse">Loading benchmark data...</div>
          </div>
        )}
        {benchmarkMetrics?.status === 'error' && (
          <div className="text-danger text-sm p-4 border border-danger rounded-xl">
            Error: {benchmarkMetrics.error}
          </div>
        )}
        {benchmarkMetrics?.status === 'done' && benchmarkMetrics.data && (
          <div className="flex-1 overflow-auto border border-border rounded-xl max-w-full">
            {renderBenchmarksTable(result, benchmarkMetrics.data, modelSanityReport)}
          </div>
        )}
      </div>
    )
  }

  // Render Robustness Tab Content
  const renderRobustnessTab = () => {
    const sanityState = modelSanityReport ?? { status: 'idle' as const }

    const getLevelColor = (level: string) => {
      if (level === 'Low') return 'text-success'
      if (level === 'Medium') return 'text-warning'
      if (level === 'High' || level === 'Fragile') return 'text-danger'
      return 'text-muted'
    }

    const getLevelIcon = (level: string) => {
      if (level === 'Low') return '\u{1F7E2}' // Green circle
      if (level === 'Medium') return '\u{1F7E1}' // Yellow circle
      if (level === 'High' || level === 'Fragile') return '\u{1F534}' // Red circle
      return '\u{26AA}' // White circle
    }

    const formatPctVal = (v: number) => Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '--'

    return (
      <div className="saved-item flex flex-col gap-2.5 h-full min-w-0">
        <div className="flex items-center justify-between gap-2.5">
          <div className="font-black">Robustness Analysis</div>
          <Button
            size="sm"
            onClick={() => onFetchRobustness?.()}
            disabled={sanityState.status === 'loading'}
          >
            {sanityState.status === 'loading' ? 'Running...' : sanityState.status === 'done' ? 'Re-run' : 'Generate'}
          </Button>
        </div>

        {sanityState.status === 'idle' && (
          <div className="text-muted text-sm p-4 border border-border rounded-xl text-center">
            Click "Generate" to run bootstrap simulations and fragility analysis.
            <br />
            <span className="text-xs">Note: Save the bot first to run robustness analysis via the API.</span>
          </div>
        )}

        {sanityState.status === 'loading' && (
          <div className="text-muted text-sm p-4 border border-border rounded-xl text-center">
            <div className="animate-pulse">Running bootstrap simulations...</div>
            <div className="text-xs mt-1">Monte Carlo + K-Fold analysis in progress</div>
          </div>
        )}

        {sanityState.status === 'error' && (
          <div className="text-danger text-sm p-4 border border-danger rounded-xl">
            Error: {sanityState.error}
          </div>
        )}

        {sanityState.status === 'done' && sanityState.report && (
          <div className="grid grid-cols-4 gap-3 w-full h-full">
            {/* Left Card: Summary & Fragility */}
            <div className="border border-border rounded-xl p-3 flex flex-col gap-3 h-full">
              <div>
                <div className="text-xs font-bold mb-1.5 text-center">Summary</div>
                {sanityState.report.summary.length > 0 ? (
                  <ul className="text-xs space-y-0.5">
                    {sanityState.report.summary.map((s, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="text-warning">{'\u2022'}</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-xs text-muted">No major red flags detected.</div>
                )}
              </div>

              <div>
                <div className="text-xs font-bold mb-1.5 text-center">Fragility Fingerprints</div>
                <div className="space-y-1">
                  {[
                    { name: 'Sub-Period', data: sanityState.report.fragility.subPeriodStability, tooltip: 'Consistency of returns across different time periods. Low = stable across all periods.' },
                    { name: 'Profit Conc.', data: sanityState.report.fragility.profitConcentration, tooltip: 'How concentrated profits are in a few big days. Low = profits spread evenly.' },
                    { name: 'Smoothness', data: sanityState.report.fragility.smoothnessScore, tooltip: 'How smooth the equity curve is. Normal = acceptable volatility in growth.' },
                    { name: 'Thinning', data: sanityState.report.fragility.thinningFragility, tooltip: 'Sensitivity to removing random trades. Robust = performance holds when trades removed.' },
                  ].map(({ name, data, tooltip }) => (
                    <div key={name} className="flex items-center gap-2 text-xs" title={tooltip}>
                      <span className="w-20 truncate text-muted cursor-help">{name}</span>
                      <span className={cn("w-16", getLevelColor(data.level))}>
                        {getLevelIcon(data.level)} {data.level}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-bold mb-1.5 text-center">DD Probability</div>
                <div className="space-y-0.5 text-xs">
                  <div><span className="font-semibold">{formatPctVal(sanityState.report.pathRisk.drawdownProbabilities.gt20)}</span> chance of 20% DD</div>
                  <div><span className="font-semibold">{formatPctVal(sanityState.report.pathRisk.drawdownProbabilities.gt30)}</span> chance of 30% DD</div>
                  <div><span className="font-semibold">{formatPctVal(sanityState.report.pathRisk.drawdownProbabilities.gt40)}</span> chance of 40% DD</div>
                  <div><span className="font-semibold">{formatPctVal(sanityState.report.pathRisk.drawdownProbabilities.gt50)}</span> chance of 50% DD</div>
                </div>
              </div>
            </div>

            {/* Monte Carlo Card */}
            <div className="border border-border rounded-xl p-3 flex flex-col h-full">
              <div className="text-xs font-bold mb-2 text-center">Monte Carlo (2000 years)</div>
              {renderDistributionBar('Max Drawdown Distribution', sanityState.report.pathRisk.monteCarlo.drawdowns, true, formatPctVal)}
              {renderDistributionBar('CAGR Distribution', sanityState.report.pathRisk.monteCarlo.cagrs, false, formatPctVal)}
              {sanityState.report.pathRisk.monteCarlo.sharpes && renderDistributionBar('Sharpe Distribution', sanityState.report.pathRisk.monteCarlo.sharpes, false, (v) => v?.toFixed(2) ?? '-')}
              {sanityState.report.pathRisk.monteCarlo.volatilities && renderDistributionBar('Volatility Distribution', sanityState.report.pathRisk.monteCarlo.volatilities, true, formatPctVal)}
            </div>

            {/* Distribution Curves Card */}
            <div className="border border-border rounded-xl p-3 flex flex-col gap-3 h-full">
              <div className="text-xs font-bold mb-1 text-center">Distribution Curves</div>
              {renderHistogram('CAGR Distribution', sanityState.report.pathRisk.monteCarlo.cagrs.histogram, true)}
              {renderHistogram('Max Drawdown Distribution', sanityState.report.pathRisk.monteCarlo.drawdowns.histogram, false)}
            </div>

            {/* K-Fold Card */}
            <div className="border border-border rounded-xl p-3 flex flex-col h-full">
              <div className="text-xs font-bold mb-2 text-center">K-Fold (200 Folds)</div>
              {renderDistributionBar('Max Drawdown Distribution', sanityState.report.pathRisk.kfold.drawdowns, true, formatPctVal)}
              {renderDistributionBar('CAGR Distribution', sanityState.report.pathRisk.kfold.cagrs, false, formatPctVal)}
              {sanityState.report.pathRisk.kfold.sharpes && renderDistributionBar('Sharpe Distribution', sanityState.report.pathRisk.kfold.sharpes, false, (v) => v?.toFixed(2) ?? '-')}
              {sanityState.report.pathRisk.kfold.volatilities && renderDistributionBar('Volatility Distribution', sanityState.report.pathRisk.kfold.volatilities, true, formatPctVal)}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="grid grid-cols-[1fr_1fr_1fr] gap-3 items-stretch">
          {/* Left section: Run Backtest through Show benchmark */}
          <div className="flex flex-nowrap gap-2 items-stretch">
            <Button
              onClick={handleRun}
              disabled={status === 'running'}
              className="flex-1 px-5 text-sm font-bold whitespace-nowrap h-full border-l-[3px] border-l-accent hover:brightness-95 transition-all"
              style={{ background: 'color-mix(in srgb, var(--color-accent) 12%, var(--color-surface-2) 88%)' }}
            >
              {status === 'running' ? 'Running\u2026' : 'Run Backtest'}
            </Button>
            <div className="flex-1 flex flex-col items-center justify-center border border-border rounded px-3">
              <span className="text-xs font-bold text-muted">Mode</span>
              <BacktestModeDropdown value={mode} onChange={(m) => setMode(m)} />
            </div>
            <div className="flex-1 flex flex-col items-center justify-center border border-border rounded px-3">
              <span className="text-xs font-bold text-muted">Cost (bps)</span>
              <Input
                type="number"
                min={0}
                step={1}
                value={Number.isFinite(costBps) ? costBps : 0}
                onChange={(e) => setCostBps(Number(e.target.value || 0))}
                title="Transaction cost (bps)"
                className="w-[60px] text-sm border-0 p-0 h-auto bg-transparent text-center"
              />
            </div>
            <div className="flex-1 flex flex-col items-center justify-center border border-border rounded px-3">
              <div className="flex items-center justify-center gap-1">
                <input type="checkbox" checked={showBenchmark} onChange={(e) => setShowBenchmark(e.target.checked)} title="Show benchmark on chart" />
                <span className="text-xs font-bold text-muted">Benchmark</span>
              </div>
              <div className="flex items-center justify-center gap-1">
                <button
                  className="px-2 py-0.5 border border-border rounded bg-card text-sm font-mono hover:bg-muted/50"
                  onClick={() => openTickerModal?.((ticker) => setBenchmark(ticker))}
                  title="Benchmark ticker"
                >
                  {benchmark || 'SPY'}
                </button>
                {!benchmarkKnown && benchmark.trim() ? (
                  <span className="text-danger font-bold text-xs">?</span>
                ) : null}
              </div>
            </div>
          </div>
          {/* Center section: View tabs */}
          <div className="flex items-stretch">
            {(['Overview', 'In Depth', 'Benchmarks', 'Robustness'] as const).map((t) => (
              <Button key={t} variant={tab === t ? 'accent' : 'secondary'} className="flex-1 px-5 text-sm font-semibold h-full" onClick={() => setTab(t)}>
                {t}
              </Button>
            ))}
          </div>
          {/* Right section: empty spacer for grid balance */}
          <div />
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {errors.length > 0 && (
          <Alert variant="destructive">
            <AlertTitle>Fix these errors before running:</AlertTitle>
            <AlertDescription>
              <div className="grid gap-1.5">
                {errors.map((e, idx) => (
                  <Button
                    key={`${e.nodeId}-${e.field}-${idx}`}
                    variant="link"
                    className="justify-start h-auto p-0 text-inherit"
                    onClick={() => onJumpToError(e)}
                  >
                    {e.message}
                  </Button>
                ))}
              </div>
            </AlertDescription>
          </Alert>
        )}

        {result && tab === 'Overview' ? (
          <>
            {/* Metrics Row */}
            <div className="flex gap-1.5 w-full">
              <Card
                ref={rangePickerRef}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (!rangePickerOpen && visibleRange) {
                    setRangeStart(isoFromUtcSeconds(visibleRange.from))
                    setRangeEnd(isoFromUtcSeconds(visibleRange.to))
                  }
                  setRangePopoverPos(computeRangePopoverPos())
                  setRangePickerOpen((v) => !v)
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return
                  e.preventDefault()
                  if (!rangePickerOpen && visibleRange) {
                    setRangeStart(isoFromUtcSeconds(visibleRange.from))
                    setRangeEnd(isoFromUtcSeconds(visibleRange.to))
                  }
                  setRangePopoverPos(computeRangePopoverPos())
                  setRangePickerOpen((v) => !v)
                }}
                className="cursor-pointer relative p-1.5 text-center flex-1 min-w-0"
                title="Click to set a custom date range"
              >
                <div className="text-[9px] font-bold text-muted whitespace-nowrap">Date range</div>
                <div className="text-xs font-black whitespace-nowrap">{rangeLabel.start} {'\u2192'} {rangeLabel.end}</div>
                <div className="text-[9px] text-muted">{tradingDaysInRange} days</div>
              </Card>
              <Card className="p-1.5 text-center flex-1 min-w-0 cursor-help" title="Compound Annual Growth Rate">
                <div className="text-[9px] font-bold text-muted">CAGR</div>
                <div className="text-xs font-black">{formatPct(result.metrics.cagr)}</div>
              </Card>
              <Card className="p-1.5 text-center flex-1 min-w-0 cursor-help" title="Maximum Drawdown">
                <div className="text-[9px] font-bold text-muted">Max DD</div>
                <div className="text-xs font-black">{formatPct(result.metrics.maxDrawdown)}</div>
              </Card>
              <Card className="p-1.5 text-center flex-1 min-w-0 cursor-help" title="Calmar Ratio: CAGR / Max DD">
                <div className="text-[9px] font-bold text-muted">Calmar</div>
                <div className="text-xs font-black">{Number.isFinite(result.metrics.calmar) ? result.metrics.calmar.toFixed(2) : '\u2014'}</div>
              </Card>
              <Card className="p-1.5 text-center flex-1 min-w-0 cursor-help" title="Sharpe Ratio">
                <div className="text-[9px] font-bold text-muted">Sharpe</div>
                <div className="text-xs font-black">{Number.isFinite(result.metrics.sharpe) ? result.metrics.sharpe.toFixed(2) : '\u2014'}</div>
              </Card>
              <Card className="p-1.5 text-center flex-1 min-w-0 cursor-help" title="Sortino Ratio">
                <div className="text-[9px] font-bold text-muted">Sortino</div>
                <div className="text-xs font-black">{Number.isFinite(result.metrics.sortino) ? result.metrics.sortino.toFixed(2) : '\u2014'}</div>
              </Card>
              <Card className="p-1.5 text-center flex-1 min-w-0 cursor-help" title="Treynor Ratio">
                <div className="text-[9px] font-bold text-muted">Treynor</div>
                <div className="text-xs font-black">{Number.isFinite(result.metrics.treynor) ? result.metrics.treynor.toFixed(2) : '\u2014'}</div>
              </Card>
              <Card className="p-1.5 text-center flex-1 min-w-0 cursor-help" title="Beta vs benchmark">
                <div className="text-[9px] font-bold text-muted">Beta</div>
                <div className="text-xs font-black">{Number.isFinite(result.metrics.beta) ? result.metrics.beta.toFixed(2) : '\u2014'}</div>
              </Card>
              <Card className="p-1.5 text-center flex-1 min-w-0 cursor-help" title="Annualized volatility">
                <div className="text-[9px] font-bold text-muted">Volatility</div>
                <div className="text-xs font-black">{formatPct(result.metrics.vol)}</div>
              </Card>
              <Card className="p-1.5 text-center flex-1 min-w-0 cursor-help" title="Win rate">
                <div className="text-[9px] font-bold text-muted">Win rate</div>
                <div className="text-xs font-black">{formatPct(result.metrics.winRate)}</div>
              </Card>
              <Card className="p-1.5 text-center flex-1 min-w-0 cursor-help" title="Average turnover">
                <div className="text-[9px] font-bold text-muted">Turnover</div>
                <div className="text-xs font-black">{formatPct(result.metrics.avgTurnover)}</div>
              </Card>
              <Card className="p-1.5 text-center flex-1 min-w-0 cursor-help" title="Average holdings">
                <div className="text-[9px] font-bold text-muted">Avg Hold</div>
                <div className="text-xs font-black">{result.metrics.avgHoldings.toFixed(2)}</div>
              </Card>
            </div>

            {/* Charts */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="flex gap-1">
                  <Button variant={activePreset === '1m' ? 'accent' : 'secondary'} size="sm" onClick={() => applyPreset('1m')}>1m</Button>
                  <Button variant={activePreset === '3m' ? 'accent' : 'secondary'} size="sm" onClick={() => applyPreset('3m')}>3m</Button>
                  <Button variant={activePreset === '6m' ? 'accent' : 'secondary'} size="sm" onClick={() => applyPreset('6m')}>6m</Button>
                  <Button variant={activePreset === 'ytd' ? 'accent' : 'secondary'} size="sm" onClick={() => applyPreset('ytd')}>YTD</Button>
                  <Button variant={activePreset === '1y' ? 'accent' : 'secondary'} size="sm" onClick={() => applyPreset('1y')}>1yr</Button>
                  <Button variant={activePreset === '5y' ? 'accent' : 'secondary'} size="sm" onClick={() => applyPreset('5y')}>5yr</Button>
                  <Button variant={activePreset === 'max' ? 'accent' : 'secondary'} size="sm" onClick={() => applyPreset('max')}>Max</Button>
                  <Button variant={logScale ? 'accent' : 'secondary'} size="sm" onClick={() => setLogScale((v) => !v)}>Log</Button>
                </div>
              </div>
              <EquityChart
                points={rebasedPoints}
                benchmarkPoints={showBenchmark ? rebasedBenchmarkPoints : undefined}
                markers={result.markers}
                visibleRange={visibleRange}
                logScale={logScale}
                indicatorOverlays={indicatorOverlays}
                theme={theme}
              />
            </div>
            {rangePopover}

            <div>
              <div className="mb-2">
                <div className="font-black">Drawdown</div>
              </div>
              <DrawdownChart
                points={result.drawdownPoints}
                visibleRange={visibleRange}
                theme={theme}
              />
              {visibleRange ? (
                <RangeNavigator points={result.points} range={visibleRange} onChange={handleChartVisibleRangeChange} theme={theme} />
              ) : null}
            </div>

            {result.warnings.length > 0 && (
              <Alert variant="warning">
                <AlertTitle>Warnings ({result.warnings.length})</AlertTitle>
                <AlertDescription>
                  <div className="max-h-[140px] overflow-auto grid gap-1">
                    {result.warnings.slice(0, 50).map((w, idx) => (
                      <div key={`${w.time}-${idx}`}>{w.date}: {w.message}</div>
                    ))}
                    {result.warnings.length > 50 ? <div>{'\u2026'}</div> : null}
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </>
        ) : result && tab === 'In Depth' ? (
          <>
            <div className="saved-item grid grid-cols-2 gap-4 items-stretch">
              <div className="border border-border rounded-lg p-3 flex flex-col" style={{ height: '320px' }}>
                <div className="font-black mb-1.5">Monthly Returns</div>
                <div className="flex-1 overflow-auto min-h-0">
                  {renderMonthlyHeatmap(result.monthly, result.days, theme)}
                </div>
              </div>
              <div className="border border-border rounded-lg p-3 flex flex-col" style={{ height: '320px' }}>
                <div className="font-black mb-1.5">Allocations (recent)</div>
                <div className="flex-1 overflow-auto font-mono text-xs min-h-0">
                  {(result.allocations || []).slice(-300).reverse().map((row) => (
                    <div key={row.date}>
                      {row.date} {'\u2014'}{' '}
                      {row.entries.length === 0
                        ? 'Cash'
                        : row.entries
                            .slice()
                            .sort((a, b) => b.weight - a.weight)
                            .map((e) => `${e.ticker} ${(e.weight * 100).toFixed(2)}%`)
                            .join(', ')}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="saved-item">
              <AllocationChart series={allocationSeries} visibleRange={visibleRange} theme={theme} />
            </div>
            <div className="saved-item grid grid-cols-2 gap-4 items-start">
              <div className="border border-border rounded-lg p-3 flex flex-col" style={{ height: '280px' }}>
                <div className="font-black mb-1.5">Rebalance days ({rebalanceDays.length})</div>
                <div className="backtester-table flex-1 overflow-auto min-h-0">
                  <div className="backtester-row backtester-head-row">
                    <div>Date</div>
                    <div>Net</div>
                    <div>Turnover</div>
                    <div>Cost</div>
                    <div>Holdings</div>
                  </div>
                  <div className="backtester-body-rows">
                    {rebalanceDays.slice(-400).reverse().map((d) => (
                      <div key={d.date} className="backtester-row">
                        <div>{d.date}</div>
                        <div>{formatPct(d.netReturn)}</div>
                        <div>{formatPct(d.turnover)}</div>
                        <div>{formatPct(d.cost)}</div>
                        <div className="font-mono text-xs">
                          {d.holdings.length === 0
                            ? 'Cash'
                            : d.holdings
                                .slice()
                                .sort((a, b) => b.weight - a.weight)
                                .map((h) => `${h.ticker} ${(h.weight * 100).toFixed(1)}%`)
                                .join(', ')}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="border border-border rounded-lg p-3 flex flex-col" style={{ height: '280px' }}>
                <div className="font-black mb-1.5">Warnings ({result.warnings.length})</div>
                {groupedWarnings.length === 0 ? (
                  <div className="text-muted flex-1 flex items-center justify-center">No warnings.</div>
                ) : (
                  <div className="backtester-table flex-1 overflow-auto min-h-0">
                    <div className="backtester-row backtester-head-row">
                      <div>Count</div>
                      <div>Message</div>
                      <div>First</div>
                      <div>Last</div>
                    </div>
                    <div className="backtester-body-rows">
                      {groupedWarnings.map((g) => (
                        <div key={g.message} className="backtester-row">
                          <div>{g.count}</div>
                          <div>{g.message}</div>
                          <div>{g.first?.date ?? '\u2014'}</div>
                          <div>{g.last?.date ?? '\u2014'}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {result.trace ? (
              <div className="saved-item">
                <div className="flex gap-2.5 items-center flex-wrap">
                  <div className="font-black">Condition trace (debug)</div>
                  <Button onClick={() => downloadTextFile('backtest_trace.json', JSON.stringify(result.trace, null, 2), 'application/json')}>
                    Download trace JSON
                  </Button>
                </div>
                <div className="mt-2 backtester-table max-h-[300px] overflow-auto">
                  <div className="backtester-row backtester-head-row">
                    <div>Node</div>
                    <div>Kind</div>
                    <div>Then</div>
                    <div>Else</div>
                    <div>Conditions</div>
                  </div>
                  <div className="backtester-body-rows">
                    {result.trace.nodes.slice(0, 80).map((n) => (
                      <div key={n.nodeId} className="backtester-row">
                        <div className="font-mono text-xs">{n.nodeId}</div>
                        <div>{n.kind}</div>
                        <div>{n.thenCount}</div>
                        <div>{n.elseCount}</div>
                        <div className="font-mono text-xs">
                          {n.conditions.length === 0
                            ? '\u2014'
                            : n.conditions
                                .slice(0, 4)
                                .map((c) => `${c.type.toUpperCase()} ${c.expr} [T:${c.trueCount} F:${c.falseCount}]`)
                                .join(' | ')}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {result.trace.nodes.length > 80 ? (
                  <div className="mt-1.5 text-muted">Showing first 80 nodes. Use Download trace JSON for the full set.</div>
                ) : null}
              </div>
            ) : null}

            <Card>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" onClick={() => downloadEquityCsv(result, mode, costBps, benchmark, showBenchmark)}>Download equity CSV</Button>
                <Button size="sm" onClick={() => downloadAllocationsCsv(result)}>Download allocations CSV</Button>
                <Button size="sm" onClick={() => downloadRebalancesCsv(result)}>Download rebalances CSV</Button>
              </div>
            </Card>
          </>
        ) : result && tab === 'Benchmarks' ? (
          renderBenchmarksTab()
        ) : result && tab === 'Robustness' ? (
          renderRobustnessTab()
        ) : status === 'running' ? (
          <div className="text-muted font-bold p-4 text-center">Running backtest{'\u2026'}</div>
        ) : (
          <div className="text-muted font-bold p-4 text-center">
            Tip: Click Run Backtest in the top left corner to generate an equity curve
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Helper: Render benchmarks comparison table
function renderBenchmarksTable(
  result: NonNullable<BacktesterPanelProps['result']>,
  benchmarks: Record<string, ComparisonMetrics>,
  modelSanityReport?: BacktesterPanelProps['modelSanityReport']
) {
  const strategyMetrics = result.metrics

  const fmt = (v: number | undefined, isPct = false, isRatio = false) => {
    if (v === undefined || !Number.isFinite(v)) return '\u2014'
    if (isPct) return `${(v * 100).toFixed(1)}%`
    if (isRatio) return v.toFixed(2)
    return v.toFixed(2)
  }

  const fmtAlpha = (stratVal: number | undefined, rowVal: number | undefined, isPct = false, isHigherBetter = true) => {
    if (stratVal === undefined || rowVal === undefined || !Number.isFinite(stratVal) || !Number.isFinite(rowVal)) return null
    const diff = stratVal - rowVal
    const stratIsBetter = isHigherBetter ? diff > 0 : (stratVal < 0 ? diff > 0 : diff < 0)
    const color = stratIsBetter ? 'text-success' : diff === 0 ? 'text-muted' : 'text-danger'
    const sign = diff > 0 ? '+' : ''
    const formatted = isPct ? `${sign}${(diff * 100).toFixed(1)}%` : `${sign}${diff.toFixed(2)}`
    return <span className={`${color} text-xs ml-1`}>({formatted})</span>
  }

  const mcMetrics = modelSanityReport?.report?.pathRisk?.comparisonMetrics?.monteCarlo
  const kfMetrics = modelSanityReport?.report?.pathRisk?.comparisonMetrics?.kfold
  const strategyBetas: Record<string, number> = (modelSanityReport?.report as { strategyBetas?: Record<string, number> } | undefined)?.strategyBetas ?? {}

  type RowData = { label: string; metrics: ComparisonMetrics | undefined; isBaseline?: boolean; ticker?: string }
  const rowData: RowData[] = [
    {
      label: mcMetrics ? 'Monte Carlo Comparison' : 'Your Strategy',
      metrics: mcMetrics ?? {
        cagr50: strategyMetrics.cagr,
        maxdd50: strategyMetrics.maxDrawdown,
        maxdd95: strategyMetrics.maxDrawdown,
        calmar50: strategyMetrics.calmar,
        calmar95: strategyMetrics.calmar,
        sharpe: strategyMetrics.sharpe,
        sortino: strategyMetrics.sortino,
        treynor: strategyMetrics.treynor ?? 0,
        beta: strategyMetrics.beta ?? 1,
        volatility: strategyMetrics.vol,
        winRate: strategyMetrics.winRate
      },
      isBaseline: true
    },
    ...(kfMetrics ? [{ label: 'K-Fold Comparison', metrics: kfMetrics }] : []),
    { label: 'Benchmark VTI', metrics: benchmarks['VTI'], ticker: 'VTI' },
    { label: 'Benchmark SPY', metrics: benchmarks['SPY'], ticker: 'SPY' },
    { label: 'Benchmark QQQ', metrics: benchmarks['QQQ'], ticker: 'QQQ' },
    { label: 'Benchmark DIA', metrics: benchmarks['DIA'], ticker: 'DIA' },
    { label: 'Benchmark DBC', metrics: benchmarks['DBC'], ticker: 'DBC' },
    { label: 'Benchmark DBO', metrics: benchmarks['DBO'], ticker: 'DBO' },
    { label: 'Benchmark GLD', metrics: benchmarks['GLD'], ticker: 'GLD' },
    { label: 'Benchmark BND', metrics: benchmarks['BND'], ticker: 'BND' },
    { label: 'Benchmark TLT', metrics: benchmarks['TLT'], ticker: 'TLT' },
    { label: 'Benchmark GBTC', metrics: benchmarks['GBTC'], ticker: 'GBTC' },
  ]

  const cols: { key: keyof ComparisonMetrics; label: string; isPct?: boolean; isRatio?: boolean; higherBetter?: boolean }[] = [
    { key: 'cagr50', label: 'CAGR-50', isPct: true, higherBetter: true },
    { key: 'maxdd50', label: 'MaxDD-50', isPct: true, higherBetter: false },
    { key: 'maxdd95', label: 'Tail Risk-DD95', isPct: true, higherBetter: false },
    { key: 'calmar50', label: 'Calmar-50', isRatio: true, higherBetter: true },
    { key: 'calmar95', label: 'Calmar-95', isRatio: true, higherBetter: true },
    { key: 'sharpe', label: 'Sharpe', isRatio: true, higherBetter: true },
    { key: 'sortino', label: 'Sortino', isRatio: true, higherBetter: true },
    { key: 'treynor', label: 'Treynor', isRatio: true, higherBetter: true },
    { key: 'beta', label: 'Beta', isRatio: true, higherBetter: false },
    { key: 'volatility', label: 'Volatility', isPct: true, higherBetter: false },
    { key: 'winRate', label: 'Win Rate', isPct: true, higherBetter: true },
  ]

  const stratMetrics = rowData[0].metrics

  return (
    <table className="analyze-compare-table">
      <thead>
        <tr>
          <th>Comparison</th>
          {cols.map((c) => (
            <th key={c.key}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rowData.map((row) => (
          <tr key={row.label}>
            <td className={row.isBaseline ? 'font-bold' : ''}>{row.label}</td>
            {cols.map((c) => {
              let val = row.metrics?.[c.key]
              if (c.key === 'beta' && row.ticker && strategyBetas[row.ticker] !== undefined) {
                val = strategyBetas[row.ticker]
              }
              const showAlpha = !row.isBaseline && stratMetrics
              const mcVal = stratMetrics?.[c.key]
              const alpha = showAlpha ? fmtAlpha(mcVal, val, c.isPct ?? false, c.higherBetter ?? true) : null
              return (
                <td key={c.key}>
                  {fmt(val, c.isPct ?? false, c.isRatio ?? false)}
                  {alpha}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// Helper: Render distribution bar visualization
function renderDistributionBar(
  title: string,
  data: { p5: number; p25?: number; p50: number; p75?: number; p95: number },
  invertColors: boolean,
  formatFn: (v: number) => string
) {
  const minVal = invertColors ? data.p95 : Math.min(data.p5, data.p95)
  const maxVal = invertColors ? data.p5 : Math.max(data.p5, data.p95)
  const range = maxVal - minVal || 0.01
  const toPos = (v: number) => Math.max(0, Math.min(100, ((v - minVal) / range) * 100))
  const hasP25P75 = data.p25 != null && data.p75 != null
  const barColor = invertColors ? 'bg-danger/40' : 'bg-success/40'
  const lineColor = invertColors ? 'bg-danger' : 'bg-success'

  return (
    <div className="mb-3">
      <div className="text-xs text-muted mb-1 cursor-help text-center" title={title}>{title}</div>
      <div className="relative h-4 bg-muted/30 rounded overflow-hidden">
        {hasP25P75 && (
          <div
            className={`absolute h-full ${barColor}`}
            style={{
              left: `${toPos(data.p25!)}%`,
              width: `${Math.abs(toPos(data.p75!) - toPos(data.p25!))}%`
            }}
          />
        )}
        <div
          className={`absolute h-full w-0.5 ${lineColor}`}
          style={{ left: `${toPos(data.p50)}%` }}
        />
      </div>
      <div className="flex justify-between text-xs mt-0.5">
        <span className={invertColors ? 'text-danger' : 'text-danger'}>P{invertColors ? '95' : '5'}: {formatFn(invertColors ? data.p5 : data.p5)}</span>
        <span className="font-semibold">P50: {formatFn(data.p50)}</span>
        <span className={invertColors ? 'text-success' : 'text-success'}>P{invertColors ? '5' : '95'}: {formatFn(invertColors ? data.p95 : data.p95)}</span>
      </div>
    </div>
  )
}

// Helper: Render histogram visualization
function renderHistogram(
  title: string,
  histogram: Array<{ min: number; max: number; midpoint: number; count: number }> | undefined,
  isPositiveGood: boolean
) {
  if (!histogram || histogram.length === 0) {
    return (
      <div>
        <div className="text-xs text-muted mb-1 text-center">{title}</div>
        <div className="text-xs text-muted">No histogram data</div>
      </div>
    )
  }

  const maxCount = Math.max(...histogram.map((b) => b.count))

  return (
    <div>
      <div className="text-xs text-muted mb-1 cursor-help text-center" title={title}>{title}</div>
      <div className="flex items-end gap-px h-16">
        {histogram.map((bucket, i) => {
          const heightPct = maxCount > 0 ? (bucket.count / maxCount) * 100 : 0
          let bgClass: string
          if (isPositiveGood) {
            bgClass = bucket.midpoint >= 0 ? 'bg-success/60' : 'bg-danger/60'
          } else {
            const severity = Math.abs(bucket.midpoint)
            bgClass = severity > 0.4 ? 'bg-danger/80' : severity > 0.25 ? 'bg-danger/60' : 'bg-warning/60'
          }
          return (
            <div
              key={i}
              className={`flex-1 rounded-t ${bgClass}`}
              style={{ height: `${heightPct}%`, minHeight: bucket.count > 0 ? '2px' : '0' }}
              title={`${(bucket.min * 100).toFixed(1)}% to ${(bucket.max * 100).toFixed(1)}%: ${bucket.count} sims`}
            />
          )
        })}
      </div>
      <div className="flex justify-between text-xs mt-0.5">
        <span className="text-muted">{((histogram[0]?.min ?? 0) * 100).toFixed(0)}%</span>
        <span className="text-muted">{((histogram[histogram.length - 1]?.max ?? 0) * 100).toFixed(0)}%</span>
      </div>
    </div>
  )
}
