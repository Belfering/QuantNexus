// src/features/analyze/components/RobustnessTabContent.tsx
// Robustness tab content for bot analysis cards - Monte Carlo and K-Fold analysis

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { SanityReportState, SanityReportPathRisk, SanityReportFragility } from '@/features/backtest'
import type { SavedBot } from '@/types'

interface RobustnessTabContentProps {
  bot: SavedBot
  sanityReports: Record<string, SanityReportState>
  runSanityReport: (bot: SavedBot) => void
}

export function RobustnessTabContent(props: RobustnessTabContentProps) {
  const {
    bot: b,
    sanityReports,
    runSanityReport,
  } = props

  const sanityState = sanityReports[b.id] ?? { status: 'idle' as const }

  const getLevelColor = (level: string) => {
    if (level === 'Low') return 'text-success'
    if (level === 'Medium') return 'text-warning'
    if (level === 'High' || level === 'Fragile') return 'text-danger'
    return 'text-muted'
  }

  const getLevelIcon = (level: string) => {
    if (level === 'Low') return '🟢'
    if (level === 'Medium') return '🟡'
    if (level === 'High' || level === 'Fragile') return '🔴'
    return '⚪'
  }

  const formatPctVal = (v: number) => Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '--'
  const formatDDPct = (v: number) => Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '--'

  return (
    <div className="saved-item flex flex-col gap-2.5 h-full min-w-0">
      <div className="flex items-center justify-between gap-2.5">
        <div className="font-black">Robustness Analysis</div>
        <Button
          size="sm"
          onClick={() => runSanityReport(b)}
          disabled={sanityState.status === 'loading'}
        >
          {sanityState.status === 'loading' ? 'Running...' : sanityState.status === 'done' ? 'Re-run' : 'Generate'}
        </Button>
      </div>

      {sanityState.status === 'idle' && (
        <div className="text-muted text-sm p-4 border border-border rounded-xl text-center">
          Click "Generate" to run bootstrap simulations and fragility analysis.
          <br />
          <span className="text-xs">This may take 10-30 seconds.</span>
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
        <>
          {/* Check if we have IS/OOS split data */}
          {sanityState.report.oosStartDate && sanityState.report.pathRisk.isPathRisk && sanityState.report.pathRisk.oosPathRisk ? (
            <div className="flex flex-col gap-4">
              {/* In-Sample Section */}
              <div>
                <div className="text-sm font-bold mb-2 text-center">
                  In-Sample Robustness Analysis (Start - {sanityState.report.oosStartDate})
                </div>
                <RobustnessAnalysisGrid
                  pathRisk={sanityState.report.pathRisk.isPathRisk}
                  fragility={sanityState.report.fragility}
                  summary={sanityState.report.summary}
                  getLevelColor={getLevelColor}
                  getLevelIcon={getLevelIcon}
                  formatPctVal={formatPctVal}
                  formatDDPct={formatDDPct}
                />
              </div>

              {/* Out-of-Sample Section */}
              <div>
                <div className="text-sm font-bold mb-2 text-center">
                  Out-of-Sample Robustness Analysis ({sanityState.report.oosStartDate} - End)
                </div>
                <RobustnessAnalysisGrid
                  pathRisk={sanityState.report.pathRisk.oosPathRisk}
                  fragility={sanityState.report.fragility}
                  summary={sanityState.report.summary}
                  getLevelColor={getLevelColor}
                  getLevelIcon={getLevelIcon}
                  formatPctVal={formatPctVal}
                  formatDDPct={formatDDPct}
                />
              </div>
            </div>
          ) : (
            // Fallback: Single view (no split)
            <RobustnessAnalysisGrid
              pathRisk={sanityState.report.pathRisk}
              fragility={sanityState.report.fragility}
              summary={sanityState.report.summary}
              getLevelColor={getLevelColor}
              getLevelIcon={getLevelIcon}
              formatPctVal={formatPctVal}
              formatDDPct={formatDDPct}
            />
          )}
        </>
      )}
    </div>
  )
}

// Reusable 4-column grid component for robustness analysis
interface RobustnessAnalysisGridProps {
  pathRisk: SanityReportPathRisk
  fragility: SanityReportFragility
  summary: string[]
  getLevelColor: (level: string) => string
  getLevelIcon: (level: string) => string
  formatPctVal: (v: number) => string
  formatDDPct: (v: number) => string
}

function RobustnessAnalysisGrid({
  pathRisk,
  fragility,
  summary,
  getLevelColor,
  getLevelIcon,
  formatPctVal,
  formatDDPct,
}: RobustnessAnalysisGridProps) {
  return (
    <div className="grid grid-cols-4 gap-3 w-full">
      {/* Left Card: Summary & Fragility */}
      <div className="border border-border rounded-xl p-3 flex flex-col gap-3">
        {/* Summary */}
        <div>
          <div className="text-xs font-bold mb-1.5 text-center">Summary</div>
          {summary.length > 0 ? (
            <ul className="text-xs space-y-0.5">
              {summary.map((s, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="text-warning">•</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-xs text-muted">No major red flags detected.</div>
          )}
        </div>

        {/* Fragility Table (2x4 Grid) */}
        <div>
          <div className="text-xs font-bold mb-1.5 text-center">Fragility Fingerprints</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {[
              { name: 'History', data: fragility.backtestLength, tooltip: 'Length of backtest data. <5yr = high risk, 5-15yr = caution, >15yr = good.' },
              { name: 'Turnover', data: fragility.turnoverRisk, tooltip: 'Average daily turnover. >50% = high cost, 20-50% = moderate, <20% = reasonable.' },
              { name: 'Holdings', data: fragility.concentrationRisk, tooltip: 'Average positions held. <3 = concentrated, 3-5 = moderate, >5 = diversified.' },
              { name: 'Recovery', data: fragility.drawdownRecovery, tooltip: 'Time to recover from max drawdown. >2yr = high risk, 1-2yr = caution, <1yr = good.' },
              { name: 'Sub-Period', data: fragility.subPeriodStability, tooltip: 'Consistency of returns across different time periods. Low = stable across all periods.' },
              { name: 'Profit Conc.', data: fragility.profitConcentration, tooltip: 'How concentrated profits are in a few big days. Low = profits spread evenly.' },
              { name: 'Smoothness', data: fragility.smoothnessScore, tooltip: 'How smooth the equity curve is. Normal = acceptable volatility in growth.' },
              { name: 'Thinning', data: fragility.thinningFragility, tooltip: 'Sensitivity to removing random trades. Robust = performance holds when trades removed.' },
            ].filter(({ data }) => data != null).map(({ name, data, tooltip }) => (
              <div key={name} className="flex items-center gap-1.5 text-xs" title={tooltip}>
                <span className="w-16 truncate text-muted cursor-help">{name}</span>
                <span className={cn("flex-1 truncate", getLevelColor(data!.level))}>
                  {getLevelIcon(data!.level)} {data!.level}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* DD Probabilities */}
        <div>
          <div className="text-xs font-bold mb-1.5 text-center">DD Probability</div>
          <div className="space-y-0.5 text-xs">
            <div><span className="font-semibold">{formatPctVal(pathRisk.drawdownProbabilities.gt20)}</span> chance of 20% DD</div>
            <div><span className="font-semibold">{formatPctVal(pathRisk.drawdownProbabilities.gt30)}</span> chance of 30% DD</div>
            <div><span className="font-semibold">{formatPctVal(pathRisk.drawdownProbabilities.gt40)}</span> chance of 40% DD</div>
            <div><span className="font-semibold">{formatPctVal(pathRisk.drawdownProbabilities.gt50)}</span> chance of 50% DD</div>
          </div>
        </div>
      </div>

      {/* Middle Card: Monte Carlo */}
      <div className="border border-border rounded-xl p-3 flex flex-col">
        <div className="text-xs font-bold mb-2 text-center">Monte Carlo (2000 years)</div>

        {/* MC Drawdown Distribution */}
        <div className="mb-3">
          <div className="text-xs text-muted mb-1 cursor-help text-center" title="Distribution of maximum drawdowns across 400 simulated 5-year paths (2000 total years). Shows worst-case (P5), median, and best-case (P95) scenarios.">Max Drawdown Distribution</div>
          {(() => {
            const dd = pathRisk.monteCarlo.drawdowns
            // Drawdowns are negative: p95 is worst (most negative), p5 is best (least negative)
            const minVal = dd.p95
            const maxVal = dd.p5
            const range = maxVal - minVal || 0.01
            const toPos = (v: number) => Math.max(0, Math.min(100, ((v - minVal) / range) * 100))
            return (
              <>
                <div className="relative h-4 bg-muted/30 rounded overflow-hidden">
                  <div
                    className="absolute h-full bg-danger/40"
                    style={{ left: `${toPos(dd.p75)}%`, width: `${Math.abs(toPos(dd.p25) - toPos(dd.p75))}%` }}
                  />
                  <div
                    className="absolute h-full w-0.5 bg-danger"
                    style={{ left: `${toPos(dd.p50)}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs mt-0.5">
                  <span className="text-danger">P95: {formatDDPct(dd.p5)}</span>
                  <span className="font-semibold">P50: {formatDDPct(dd.p50)}</span>
                  <span className="text-success">P5: {formatDDPct(dd.p95)}</span>
                </div>
              </>
            )
          })()}
        </div>

        {/* MC CAGR Distribution */}
        <div className="mb-3">
          <div className="text-xs text-muted mb-1 cursor-help text-center" title="Distribution of annualized returns (CAGR) across 200 simulated 5-year paths. P5 is worst, P95 is best expected returns.">CAGR Distribution</div>
          {(() => {
            const cagr = pathRisk.monteCarlo.cagrs
            const minVal = Math.min(cagr.p5, cagr.p95)
            const maxVal = Math.max(cagr.p5, cagr.p95)
            const range = maxVal - minVal || 1
            const toPos = (v: number) => ((v - minVal) / range) * 100
            return (
              <>
                <div className="relative h-4 bg-muted/30 rounded overflow-hidden">
                  <div
                    className="absolute h-full bg-success/40"
                    style={{ left: `${toPos(cagr.p25)}%`, width: `${toPos(cagr.p75) - toPos(cagr.p25)}%` }}
                  />
                  <div
                    className="absolute h-full w-0.5 bg-success"
                    style={{ left: `${toPos(cagr.p50)}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs mt-0.5">
                  <span className="text-danger">P5: {formatDDPct(cagr.p5)}</span>
                  <span className="font-semibold">P50: {formatDDPct(cagr.p50)}</span>
                  <span className="text-success">P95: {formatDDPct(cagr.p95)}</span>
                </div>
              </>
            )
          })()}
        </div>

        {/* MC Sharpe Distribution */}
        {pathRisk.monteCarlo.sharpes && (
          <div className="mb-3">
            <div className="text-xs text-muted mb-1 cursor-help text-center" title="Distribution of Sharpe ratios across Monte Carlo simulations. Higher is better.">Sharpe Distribution</div>
            {(() => {
              const sh = pathRisk.monteCarlo.sharpes
              const minVal = sh.p5
              const maxVal = sh.p95
              const range = maxVal - minVal || 0.01
              const toPos = (v: number) => Math.max(0, Math.min(100, ((v - minVal) / range) * 100))
              const hasP25P75 = sh.p25 != null && sh.p75 != null
              return (
                <>
                  <div className="relative h-4 bg-muted/30 rounded overflow-hidden">
                    {hasP25P75 && (
                      <div
                        className="absolute h-full bg-success/40"
                        style={{ left: `${toPos(sh.p25)}%`, width: `${toPos(sh.p75) - toPos(sh.p25)}%` }}
                      />
                    )}
                    <div
                      className="absolute h-full w-0.5 bg-success"
                      style={{ left: `${toPos(sh.p50)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs mt-0.5">
                    <span className="text-danger">P5: {sh.p5?.toFixed(2) ?? '-'}</span>
                    <span className="font-semibold">P50: {sh.p50?.toFixed(2) ?? '-'}</span>
                    <span className="text-success">P95: {sh.p95?.toFixed(2) ?? '-'}</span>
                  </div>
                </>
              )
            })()}
          </div>
        )}

        {/* MC Volatility Distribution */}
        {pathRisk.monteCarlo.volatilities && (
          <div>
            <div className="text-xs text-muted mb-1 cursor-help text-center" title="Distribution of annualized volatility across Monte Carlo simulations. Lower is generally better.">Volatility Distribution</div>
            {(() => {
              const vol = pathRisk.monteCarlo.volatilities
              const minVal = vol.p95
              const maxVal = vol.p5
              const range = maxVal - minVal || 0.01
              const toPos = (v: number) => Math.max(0, Math.min(100, ((v - minVal) / range) * 100))
              const hasP25P75 = vol.p25 != null && vol.p75 != null
              return (
                <>
                  <div className="relative h-4 bg-muted/30 rounded overflow-hidden">
                    {hasP25P75 && (
                      <div
                        className="absolute h-full bg-danger/40"
                        style={{ left: `${toPos(vol.p75)}%`, width: `${toPos(vol.p25) - toPos(vol.p75)}%` }}
                      />
                    )}
                    <div
                      className="absolute h-full w-0.5 bg-danger"
                      style={{ left: `${toPos(vol.p50)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs mt-0.5">
                    <span className="text-danger">P95: {formatDDPct(vol.p95)}</span>
                    <span className="font-semibold">P50: {formatDDPct(vol.p50)}</span>
                    <span className="text-success">P5: {formatDDPct(vol.p5)}</span>
                  </div>
                </>
              )
            })()}
          </div>
        )}
      </div>

      {/* Distribution Curves Card */}
      <div className="border border-border rounded-xl p-3 flex flex-col gap-3">
        <div className="text-xs font-bold mb-1 text-center">Distribution Curves</div>

        {/* CAGR Distribution Bar Chart */}
        <div>
          <div className="text-xs text-muted mb-1 cursor-help text-center" title="Distribution of CAGR values across 200 Monte Carlo simulations. Each bar represents a bucket of CAGR values.">CAGR Distribution</div>
          {(() => {
            const histogram = pathRisk.monteCarlo.cagrs.histogram
            if (!histogram || histogram.length === 0) return <div className="text-xs text-muted">No histogram data</div>
            const maxCount = Math.max(...histogram.map((b: { count: number }) => b.count))
            return (
              <div className="flex items-end gap-px h-16">
                {histogram.map((bucket: { midpoint: number; count: number; min: number; max: number }, i: number) => {
                  const heightPct = maxCount > 0 ? (bucket.count / maxCount) * 100 : 0
                  const isPositive = bucket.midpoint >= 0
                  return (
                    <div
                      key={i}
                      className={`flex-1 rounded-t ${isPositive ? 'bg-success/60' : 'bg-danger/60'}`}
                      style={{ height: `${heightPct}%`, minHeight: bucket.count > 0 ? '2px' : '0' }}
                      title={`${(bucket.min * 100).toFixed(1)}% to ${(bucket.max * 100).toFixed(1)}%: ${bucket.count} sims`}
                    />
                  )
                })}
              </div>
            )
          })()}
          <div className="flex justify-between text-xs mt-0.5">
            <span className="text-muted">{((pathRisk.monteCarlo.cagrs.histogram?.[0]?.min ?? 0) * 100).toFixed(0)}%</span>
            <span className="text-muted">{((pathRisk.monteCarlo.cagrs.histogram?.[pathRisk.monteCarlo.cagrs.histogram.length - 1]?.max ?? 0) * 100).toFixed(0)}%</span>
          </div>
        </div>

        {/* MaxDD Distribution Bar Chart */}
        <div>
          <div className="text-xs text-muted mb-1 cursor-help text-center" title="Distribution of Max Drawdown values across 200 Monte Carlo simulations. Each bar represents a bucket of drawdown values.">Max Drawdown Distribution</div>
          {(() => {
            const histogram = pathRisk.monteCarlo.drawdowns.histogram
            if (!histogram || histogram.length === 0) return <div className="text-xs text-muted">No histogram data</div>
            const maxCount = Math.max(...histogram.map((b: { count: number }) => b.count))
            return (
              <div className="flex items-end gap-px h-16">
                {histogram.map((bucket: { midpoint: number; count: number; min: number; max: number }, i: number) => {
                  const heightPct = maxCount > 0 ? (bucket.count / maxCount) * 100 : 0
                  const severity = Math.abs(bucket.midpoint)
                  const bgClass = severity > 0.4 ? 'bg-danger/80' : severity > 0.25 ? 'bg-danger/60' : 'bg-warning/60'
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
            )
          })()}
          <div className="flex justify-between text-xs mt-0.5">
            <span className="text-muted">{((pathRisk.monteCarlo.drawdowns.histogram?.[0]?.min ?? 0) * 100).toFixed(0)}%</span>
            <span className="text-muted">{((pathRisk.monteCarlo.drawdowns.histogram?.[pathRisk.monteCarlo.drawdowns.histogram.length - 1]?.max ?? 0) * 100).toFixed(0)}%</span>
          </div>
        </div>
      </div>

      {/* Right Card: K-Fold */}
      <div className="border border-border rounded-xl p-3 flex flex-col">
        <div className="text-xs font-bold mb-2 text-center">K-Fold (200 Folds)</div>

        {/* KF Drawdown Distribution */}
        <div className="mb-3">
          <div className="text-xs text-muted mb-1 cursor-help text-center" title="Distribution of maximum drawdowns across 200 K-Fold subsets (90% of data each). Tests stability when portions of history are removed.">Max Drawdown Distribution</div>
          {(() => {
            const dd = pathRisk.kfold.drawdowns
            const minVal = dd.p95
            const maxVal = dd.p5
            const range = maxVal - minVal || 0.01
            const toPos = (v: number) => Math.max(0, Math.min(100, ((v - minVal) / range) * 100))
            return (
              <>
                <div className="relative h-4 bg-muted/30 rounded overflow-hidden">
                  <div
                    className="absolute h-full bg-danger/40"
                    style={{ left: `${toPos(dd.p75)}%`, width: `${Math.abs(toPos(dd.p25) - toPos(dd.p75))}%` }}
                  />
                  <div
                    className="absolute h-full w-0.5 bg-danger"
                    style={{ left: `${toPos(dd.p50)}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs mt-0.5">
                  <span className="text-danger">P95: {formatDDPct(dd.p5)}</span>
                  <span className="font-semibold">P50: {formatDDPct(dd.p50)}</span>
                  <span className="text-success">P5: {formatDDPct(dd.p95)}</span>
                </div>
              </>
            )
          })()}
        </div>

        {/* KF CAGR Distribution */}
        <div className="mb-3">
          <div className="text-xs text-muted mb-1 cursor-help text-center" title="Distribution of annualized returns across K-Fold iterations. P5 is worst, P95 is best expected returns.">CAGR Distribution</div>
          {(() => {
            const cagr = pathRisk.kfold.cagrs
            const minVal = Math.min(cagr.p5, cagr.p95)
            const maxVal = Math.max(cagr.p5, cagr.p95)
            const range = maxVal - minVal || 1
            const toPos = (v: number) => ((v - minVal) / range) * 100
            return (
              <>
                <div className="relative h-4 bg-muted/30 rounded overflow-hidden">
                  <div
                    className="absolute h-full bg-success/40"
                    style={{ left: `${toPos(cagr.p25)}%`, width: `${toPos(cagr.p75) - toPos(cagr.p25)}%` }}
                  />
                  <div
                    className="absolute h-full w-0.5 bg-success"
                    style={{ left: `${toPos(cagr.p50)}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs mt-0.5">
                  <span className="text-danger">P5: {formatDDPct(cagr.p5)}</span>
                  <span className="font-semibold">P50: {formatDDPct(cagr.p50)}</span>
                  <span className="text-success">P95: {formatDDPct(cagr.p95)}</span>
                </div>
              </>
            )
          })()}
        </div>

        {/* KF Sharpe Distribution */}
        {pathRisk.kfold.sharpes && (
          <div className="mb-3">
            <div className="text-xs text-muted mb-1 cursor-help text-center" title="Distribution of Sharpe ratios across K-Fold iterations. Higher is better.">Sharpe Distribution</div>
            {(() => {
              const sh = pathRisk.kfold.sharpes
              const minVal = sh.p5
              const maxVal = sh.p95
              const range = maxVal - minVal || 0.01
              const toPos = (v: number) => Math.max(0, Math.min(100, ((v - minVal) / range) * 100))
              const hasP25P75 = sh.p25 != null && sh.p75 != null
              return (
                <>
                  <div className="relative h-4 bg-muted/30 rounded overflow-hidden">
                    {hasP25P75 && (
                      <div
                        className="absolute h-full bg-success/40"
                        style={{ left: `${toPos(sh.p25)}%`, width: `${toPos(sh.p75) - toPos(sh.p25)}%` }}
                      />
                    )}
                    <div
                      className="absolute h-full w-0.5 bg-success"
                      style={{ left: `${toPos(sh.p50)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs mt-0.5">
                    <span className="text-danger">P5: {sh.p5?.toFixed(2) ?? '-'}</span>
                    <span className="font-semibold">P50: {sh.p50?.toFixed(2) ?? '-'}</span>
                    <span className="text-success">P95: {sh.p95?.toFixed(2) ?? '-'}</span>
                  </div>
                </>
              )
            })()}
          </div>
        )}

        {/* KF Volatility Distribution */}
        {pathRisk.kfold.volatilities && (
          <div>
            <div className="text-xs text-muted mb-1 cursor-help text-center" title="Distribution of annualized volatility across K-Fold iterations. Lower is generally better.">Volatility Distribution</div>
            {(() => {
              const vol = pathRisk.kfold.volatilities
              const minVal = vol.p95
              const maxVal = vol.p5
              const range = maxVal - minVal || 0.01
              const toPos = (v: number) => Math.max(0, Math.min(100, ((v - minVal) / range) * 100))
              const hasP25P75 = vol.p25 != null && vol.p75 != null
              return (
                <>
                  <div className="relative h-4 bg-muted/30 rounded overflow-hidden">
                    {hasP25P75 && (
                      <div
                        className="absolute h-full bg-danger/40"
                        style={{ left: `${toPos(vol.p75)}%`, width: `${toPos(vol.p25) - toPos(vol.p75)}%` }}
                      />
                    )}
                    <div
                      className="absolute h-full w-0.5 bg-danger"
                      style={{ left: `${toPos(vol.p50)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs mt-0.5">
                    <span className="text-danger">P95: {formatDDPct(vol.p95)}</span>
                    <span className="font-semibold">P50: {formatDDPct(vol.p50)}</span>
                    <span className="text-success">P5: {formatDDPct(vol.p5)}</span>
                  </div>
                </>
              )
            })()}
          </div>
        )}
      </div>
    </div>
  )
}
