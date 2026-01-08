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
  const mcMetrics = sanityState?.report?.pathRisk?.comparisonMetrics?.monteCarlo
  const kfMetrics = sanityState?.report?.pathRisk?.comparisonMetrics?.kfold
  const benchmarks = benchmarkMetrics.data ?? {}
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
  // MC is the baseline - shows how much better MC is vs the row
  // For "higher is better" metrics (CAGR, Sharpe): if MC > row, green (strategy beats benchmark)
  // For "lower is better" metrics (MaxDD, Volatility): if MC > row, green (less negative = better)
  // Note: MaxDD values are negative, so MC -16% vs benchmark -18% gives diff +2%, which is better
  const fmtAlpha = (mcVal: number | undefined, rowVal: number | undefined, isPct = false, isHigherBetter = true) => {
    if (mcVal === undefined || rowVal === undefined || !Number.isFinite(mcVal) || !Number.isFinite(rowVal)) return null
    const diff = mcVal - rowVal // MC minus row value
    // For drawdown metrics (negative values where less negative is better), positive diff = MC is better
    // For volatility/beta (positive values where lower is better), negative diff = MC is better
    // Simplified: for "lower is better", flip the comparison for negative metrics like MaxDD
    const mcIsBetter = isHigherBetter ? diff > 0 : (mcVal < 0 ? diff > 0 : diff < 0)
    const color = mcIsBetter ? 'text-success' : diff === 0 ? 'text-muted' : 'text-danger'
    const sign = diff > 0 ? '+' : ''
    const formatted = isPct ? `${sign}${(diff * 100).toFixed(1)}%` : `${sign}${diff.toFixed(2)}`
    return <span className={`${color} text-xs ml-1`}>({formatted})</span>
  }

  // Build row data - MC is baseline (no alpha), all others show alpha vs MC
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

  // Define columns with "higher is better" flag for alpha coloring
  const cols: { key: keyof ComparisonMetrics; label: string; isPct?: boolean; isRatio?: boolean; higherBetter?: boolean }[] = [
    { key: 'cagr50', label: 'CAGR-50', isPct: true, higherBetter: true },
    { key: 'maxdd50', label: 'MaxDD-DD50', isPct: true, higherBetter: false }, // Less negative is better
    { key: 'maxdd95', label: 'Tail Risk-DD95', isPct: true, higherBetter: false },
    { key: 'calmar50', label: 'Calmar Ratio-50', isRatio: true, higherBetter: true },
    { key: 'calmar95', label: 'Calmar Ratio-95', isRatio: true, higherBetter: true },
    { key: 'sharpe', label: 'Sharpe Ratio', isRatio: true, higherBetter: true },
    { key: 'sortino', label: 'Sortino Ratio', isRatio: true, higherBetter: true },
    { key: 'treynor', label: 'Treynor Ratio', isRatio: true, higherBetter: true },
    { key: 'beta', label: 'Beta', isRatio: true, higherBetter: false }, // Lower beta = less volatile
    { key: 'volatility', label: 'Volatility', isPct: true, higherBetter: false }, // Lower vol is better
    { key: 'winRate', label: 'Win Rate', isPct: true, higherBetter: true },
  ]

  return (
    <div className="saved-item flex flex-col gap-2.5 h-full min-w-0">
      <div className="flex items-center justify-between gap-2.5">
        <div className="font-black">Advanced Stats</div>
        <Button
          size="sm"
          onClick={() => {
            // Run both sanity report (for MC/KF) and benchmark fetch
            runSanityReport(b)
            fetchBenchmarkMetrics()
          }}
          disabled={sanityReports[b.id]?.status === 'loading' || benchmarkMetrics.status === 'loading'}
        >
          {sanityReports[b.id]?.status === 'loading' || benchmarkMetrics.status === 'loading' ? 'Running...' : 'Run'}
        </Button>
      </div>
      <div className="font-black">Comparison Table</div>
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
    </div>
  )
}
