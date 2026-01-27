// src/features/analyze/components/AdvancedTabContent.tsx
// Advanced/Benchmarks tab content for bot analysis cards

import { Button } from '@/components/ui/button'
import type { ComparisonMetrics, SanityReportState } from '@/features/backtest'
import type { SavedBot } from '@/types'
import type { BenchmarkMetricsState } from './AnalyzePanel'

interface AdvancedTabContentProps {
  bot: SavedBot
  sanityReports: Record<string, SanityReportState>
  runSanityReport: (bot: SavedBot) => void
  benchmarkMetrics: BenchmarkMetricsState
  fetchBenchmarkMetrics: () => Promise<void>
}

export function AdvancedTabContent(props: AdvancedTabContentProps) {
  const {
    bot: b,
    sanityReports,
    runSanityReport,
    benchmarkMetrics,
    fetchBenchmarkMetrics,
  } = props

  const sanityState = sanityReports[b.id]
  const hasISOOSSplit = !!(sanityState?.report?.oosStartDate &&
                          sanityState?.report?.pathRisk?.isPathRisk &&
                          sanityState?.report?.pathRisk?.oosPathRisk)

  // Get IS/OOS specific metrics if available, otherwise fall back to full period
  const isMcMetrics = sanityState?.report?.pathRisk?.isPathRisk?.comparisonMetrics?.monteCarlo ??
                      sanityState?.report?.pathRisk?.comparisonMetrics?.monteCarlo ?? null
  const isKfMetrics = sanityState?.report?.pathRisk?.isPathRisk?.comparisonMetrics?.kfold ??
                      sanityState?.report?.pathRisk?.comparisonMetrics?.kfold ?? null

  const oosMcMetrics = sanityState?.report?.pathRisk?.oosPathRisk?.comparisonMetrics?.monteCarlo ??
                       sanityState?.report?.pathRisk?.comparisonMetrics?.monteCarlo ?? null
  const oosKfMetrics = sanityState?.report?.pathRisk?.oosPathRisk?.comparisonMetrics?.kfold ??
                       sanityState?.report?.pathRisk?.comparisonMetrics?.kfold ?? null

  // Prefer benchmark metrics from sanity report (calculated vs strategy) over global benchmarks
  const reportBenchmarks = (sanityState?.report as { benchmarkMetrics?: Record<string, ComparisonMetrics> })?.benchmarkMetrics
  const isBenchmarks = (sanityState?.report as { isBenchmarkMetrics?: Record<string, ComparisonMetrics> })?.isBenchmarkMetrics
  const oosBenchmarks = (sanityState?.report as { oosBenchmarkMetrics?: Record<string, ComparisonMetrics> })?.oosBenchmarkMetrics
  // Use reportBenchmarks only if it has actual data, otherwise fall back to global benchmarks
  const benchmarks = (reportBenchmarks && Object.keys(reportBenchmarks).length > 0) ? reportBenchmarks : (benchmarkMetrics?.data ?? {})
  // Strategy betas vs each benchmark ticker
  const strategyBetas: Record<string, number> = (sanityState?.report as { strategyBetas?: Record<string, number> })?.strategyBetas ?? {}

  // Helper to format metrics for display
  const fmt = (v: number | undefined, isPct = false, isRatio = false) => {
    if (v === undefined || !Number.isFinite(v)) return '—'
    if (isPct) return `${(v * 100).toFixed(1)}%`
    if (isRatio) return v.toFixed(2)
    return v.toFixed(2)
  }

  // Helper to format alpha difference with color
  const fmtAlpha = (mcVal: number | undefined, rowVal: number | undefined, isPct = false, isHigherBetter = true) => {
    if (mcVal === undefined || rowVal === undefined || !Number.isFinite(mcVal) || !Number.isFinite(rowVal)) return null
    const diff = mcVal - rowVal
    const mcIsBetter = isHigherBetter ? diff > 0 : (mcVal < 0 ? diff > 0 : diff < 0)
    const color = mcIsBetter ? 'text-success' : diff === 0 ? 'text-muted' : 'text-danger'
    const sign = diff > 0 ? '+' : ''
    const formatted = isPct ? `${sign}${(diff * 100).toFixed(1)}%` : `${sign}${diff.toFixed(2)}`
    return <span className={`${color} text-xs ml-1`}>({formatted})</span>
  }

  // Define columns
  const cols: { key: keyof ComparisonMetrics; label: string; isPct?: boolean; isRatio?: boolean; higherBetter?: boolean }[] = [
    { key: 'cagr50', label: 'CAGR-50', isPct: true, higherBetter: true },
    { key: 'maxdd50', label: 'MaxDD-DD50', isPct: true, higherBetter: false },
    { key: 'maxdd95', label: 'Tail Risk-DD95', isPct: true, higherBetter: false },
    { key: 'calmar50', label: 'Calmar Ratio-50', isRatio: true, higherBetter: true },
    { key: 'calmar95', label: 'Calmar Ratio-95', isRatio: true, higherBetter: true },
    { key: 'sharpe', label: 'Sharpe Ratio', isRatio: true, higherBetter: true },
    { key: 'sortino', label: 'Sortino Ratio', isRatio: true, higherBetter: true },
    { key: 'treynor', label: 'Treynor Ratio', isRatio: true, higherBetter: true },
    { key: 'beta', label: 'Beta', isRatio: true, higherBetter: false },
    { key: 'volatility', label: 'Volatility', isPct: true, higherBetter: false },
    { key: 'winRate', label: 'Win Rate', isPct: true, higherBetter: true },
  ]

  return (
    <div className="saved-item flex flex-col gap-2.5 h-full min-w-0">
      <div className="flex items-center justify-between gap-2.5">
        <div className="font-black">Benchmark Comparison</div>
        <Button
          size="sm"
          onClick={() => {
            runSanityReport(b)
            fetchBenchmarkMetrics()
          }}
          disabled={sanityReports[b.id]?.status === 'loading' || benchmarkMetrics.status === 'loading'}
        >
          {sanityReports[b.id]?.status === 'loading' || benchmarkMetrics.status === 'loading' ? 'Running...' : 'Refresh'}
        </Button>
      </div>

      {hasISOOSSplit ? (
        // Two tables: IS and OOS
        <div className="flex flex-col gap-4">
          {/* In-Sample Comparison */}
          <div>
            <div className="font-black mb-2">In-Sample Comparison</div>
            <ComparisonTable
              mcMetrics={isMcMetrics}
              kfMetrics={isKfMetrics}
              benchmarks={isBenchmarks ?? benchmarks}
              strategyBetas={strategyBetas}
              cols={cols}
              fmt={fmt}
              fmtAlpha={fmtAlpha}
            />
          </div>

          {/* Out-of-Sample Comparison */}
          <div>
            <div className="font-black mb-2">Out-of-Sample Comparison</div>
            <ComparisonTable
              mcMetrics={oosMcMetrics}
              kfMetrics={oosKfMetrics}
              benchmarks={oosBenchmarks ?? benchmarks}
              strategyBetas={strategyBetas}
              cols={cols}
              fmt={fmt}
              fmtAlpha={fmtAlpha}
            />
          </div>
        </div>
      ) : (
        // Single table fallback
        <>
          <div className="font-black">Comparison Table</div>
          <ComparisonTable
            mcMetrics={isMcMetrics}
            kfMetrics={isKfMetrics}
            benchmarks={benchmarks}
            strategyBetas={strategyBetas}
            cols={cols}
            fmt={fmt}
            fmtAlpha={fmtAlpha}
          />
        </>
      )}
    </div>
  )
}

// Reusable comparison table component
interface ComparisonTableProps {
  mcMetrics: ComparisonMetrics | undefined
  kfMetrics: ComparisonMetrics | undefined
  benchmarks: Record<string, ComparisonMetrics>
  strategyBetas: Record<string, number>
  cols: { key: keyof ComparisonMetrics; label: string; isPct?: boolean; isRatio?: boolean; higherBetter?: boolean }[]
  fmt: (v: number | undefined, isPct?: boolean, isRatio?: boolean) => string
  fmtAlpha: (mcVal: number | undefined, rowVal: number | undefined, isPct?: boolean, isHigherBetter?: boolean) => JSX.Element | null
}

function ComparisonTable({
  mcMetrics,
  kfMetrics,
  benchmarks,
  strategyBetas,
  cols,
  fmt,
  fmtAlpha,
}: ComparisonTableProps) {
  // Build row data
  type RowData = { label: string; metrics: ComparisonMetrics | undefined; isBaseline?: boolean; ticker?: string }
  const rowData: RowData[] = [
    { label: 'Monte Carlo Comparison', metrics: mcMetrics, isBaseline: true },
    { label: 'K-Fold Comparison', metrics: kfMetrics },
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

  return (
    <div className="flex-1 overflow-auto border border-border rounded-xl max-w-full">
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
              <td>{row.label}</td>
              {cols.map((c) => {
                // For Beta column in benchmark rows, show strategy beta vs that ticker
                let val = row.metrics?.[c.key]
                if (c.key === 'beta' && row.ticker && strategyBetas[row.ticker] !== undefined) {
                  val = strategyBetas[row.ticker]
                }
                // Show alpha vs MC for all non-baseline rows
                const showAlpha = !row.isBaseline && mcMetrics
                const mcVal = mcMetrics?.[c.key]
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
    </div>
  )
}
