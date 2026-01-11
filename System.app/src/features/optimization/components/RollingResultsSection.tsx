// Rolling optimization results section - displays OOS periods and selected branches

import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface RollingResult {
  validTickers: string[]
  tickerStartDates?: Record<string, string>
  oosPeriodCount: number
  selectedBranches: Array<{
    oosPeriod: [string, string]
    branchId: number
    params: Record<string, any>
    isMetric: number | null
    oosMetrics: Record<string, any>
  }>
  oosEquityCurve: Array<[number, number]>  // [timestamp, equity] pairs
  oosMetrics: Record<string, any>
  elapsedSeconds: number
  branchCount?: number  // Total branches tested per period
}

export interface RollingResultsSectionProps {
  result: RollingResult | null
  onClose: () => void
}

export function RollingResultsSection({ result, onClose }: RollingResultsSectionProps) {
  if (!result) {
    return (
      <Card className="p-6">
        <div className="text-center text-muted-foreground">
          <p className="mb-2">No rolling optimization results yet.</p>
          <p className="text-sm">Configure a Rolling node and run optimization from the Builder tab.</p>
        </div>
      </Card>
    )
  }

  const formatDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    if (hours > 0) return `${hours}h ${minutes % 60}m`
    if (minutes > 0) return `${minutes}m ${Math.floor(seconds % 60)}s`
    return `${Math.floor(seconds)}s`
  }

  const formatMetric = (value: number | undefined | null, isPercentage = false) => {
    if (value == null) return '-'
    if (isPercentage) return `${(value * 100).toFixed(2)}%`
    return value.toFixed(2)
  }

  return (
    <Card className="p-6">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Rolling Optimization Results</h2>
          <Button size="sm" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>

        {/* Summary Statistics */}
        <div className="p-4 rounded bg-muted/20 space-y-2">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="font-medium">Valid Tickers:</span> {result.validTickers.length}
            </div>
            <div>
              <span className="font-medium">OOS Periods:</span> {result.oosPeriodCount}
            </div>
            <div>
              <span className="font-medium">Duration:</span> {formatDuration(result.elapsedSeconds)}
            </div>
            <div>
              <span className="font-medium">Equity Points:</span> {result.oosEquityCurve.length}
            </div>
            <div>
              <span className="font-medium">Branches/Period:</span> {result.branchCount || '-'}
            </div>
          </div>
        </div>

        {/* Final OOS Metrics */}
        <div className="space-y-2">
          <h3 className="text-lg font-semibold">Final Out-of-Sample Metrics</h3>
          <div className="overflow-auto border border-border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left">Metric</th>
                  <th className="px-3 py-2 text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-border">
                  <td className="px-3 py-2">CAGR</td>
                  <td className="px-3 py-2 text-right font-semibold">{formatMetric(result.oosMetrics.cagr, true)}</td>
                </tr>
                <tr className="border-t border-border bg-muted/20">
                  <td className="px-3 py-2">Sharpe Ratio</td>
                  <td className="px-3 py-2 text-right font-semibold">{formatMetric(result.oosMetrics.sharpe)}</td>
                </tr>
                <tr className="border-t border-border">
                  <td className="px-3 py-2">Max Drawdown</td>
                  <td className="px-3 py-2 text-right font-semibold">{formatMetric(result.oosMetrics.maxDrawdown, true)}</td>
                </tr>
                <tr className="border-t border-border bg-muted/20">
                  <td className="px-3 py-2">Calmar Ratio</td>
                  <td className="px-3 py-2 text-right font-semibold">{formatMetric(result.oosMetrics.calmar)}</td>
                </tr>
                <tr className="border-t border-border">
                  <td className="px-3 py-2">Sortino Ratio</td>
                  <td className="px-3 py-2 text-right font-semibold">{formatMetric(result.oosMetrics.sortino)}</td>
                </tr>
                <tr className="border-t border-border bg-muted/20">
                  <td className="px-3 py-2">Win Rate</td>
                  <td className="px-3 py-2 text-right font-semibold">{formatMetric(result.oosMetrics.winRate, true)}</td>
                </tr>
                <tr className="border-t border-border">
                  <td className="px-3 py-2">Volatility</td>
                  <td className="px-3 py-2 text-right font-semibold">{formatMetric(result.oosMetrics.volatility, true)}</td>
                </tr>
                <tr className="border-t border-border bg-muted/20">
                  <td className="px-3 py-2">Time in Market</td>
                  <td className="px-3 py-2 text-right font-semibold">{formatMetric(result.oosMetrics.tim, true)}</td>
                </tr>
                <tr className="border-t border-border">
                  <td className="px-3 py-2">TIM Adjusted Returns</td>
                  <td className="px-3 py-2 text-right font-semibold">{formatMetric(result.oosMetrics.timar, true)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Selected Branches Timeline */}
        <div className="space-y-2">
          <h3 className="text-lg font-semibold">Selected Branches by Period</h3>
          <div className="overflow-auto max-h-[500px] border border-border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left">OOS Period</th>
                  <th className="px-3 py-2 text-left">Branch ID</th>
                  <th className="px-3 py-2 text-left">Parameters</th>
                  <th className="px-3 py-2 text-right">IS Metric</th>
                  <th className="px-3 py-2 text-right">OOS CAGR</th>
                  <th className="px-3 py-2 text-right">OOS Sharpe</th>
                  <th className="px-3 py-2 text-right">OOS MaxDD</th>
                </tr>
              </thead>
              <tbody>
                {result.selectedBranches.map((branch, idx) => (
                  <tr
                    key={idx}
                    className={`border-t border-border ${idx % 2 === 0 ? 'bg-background' : 'bg-muted/20'} hover:bg-muted/40`}
                  >
                    <td className="px-3 py-2 font-mono text-xs">
                      {branch.oosPeriod[0]} to {branch.oosPeriod[1]}
                    </td>
                    <td className="px-3 py-2 font-mono">{branch.branchId}</td>
                    <td className="px-3 py-2 text-xs">
                      <pre className="text-xs font-mono overflow-auto max-w-md max-h-20 bg-muted/20 p-1 rounded">
                        {JSON.stringify(branch.params, null, 2)}
                      </pre>
                    </td>
                    <td className="px-3 py-2 text-right">{formatMetric(branch.isMetric)}</td>
                    <td className="px-3 py-2 text-right">{formatMetric(branch.oosMetrics?.cagr, true)}</td>
                    <td className="px-3 py-2 text-right">{formatMetric(branch.oosMetrics?.sharpe)}</td>
                    <td className="px-3 py-2 text-right">{formatMetric(branch.oosMetrics?.maxDrawdown, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Valid Tickers List */}
        <div className="space-y-2">
          <h3 className="text-lg font-semibold">Valid Tickers ({result.validTickers.length})</h3>
          <div className="p-3 rounded bg-muted/20 max-h-32 overflow-auto">
            <div className="flex flex-wrap gap-2">
              {result.validTickers.map((ticker) => (
                <span
                  key={ticker}
                  className="px-2 py-1 rounded bg-primary/10 text-xs font-mono"
                  title={result.tickerStartDates?.[ticker] ? `Start: ${result.tickerStartDates[ticker]}` : undefined}
                >
                  {ticker}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Additional Info */}
        {result.oosMetrics.message && (
          <div className="p-3 rounded bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 text-sm">
            <strong>Note:</strong> {result.oosMetrics.message}
          </div>
        )}
      </div>
    </Card>
  )
}
