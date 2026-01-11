// Rolling optimization results section - displays branch matrix with per-year metrics

import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { RollingOptimizationResult } from '@/types/bot'

export interface RollingResultsSectionProps {
  result: RollingOptimizationResult | null
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

  const formatMetric = (value: number | null, isPercentage = true) => {
    if (value == null) return '-'
    if (isPercentage) return `${(value * 100).toFixed(1)}%`
    return value.toFixed(2)
  }

  // Extract all unique years from branches and sort
  const allYears = new Set<number>()
  result.branches.forEach(branch => {
    Object.keys(branch.yearlyMetrics).forEach(year => {
      allYears.add(parseInt(year, 10))
    })
  })
  const years = Array.from(allYears).sort((a, b) => a - b)

  // Calculate average metric per year across all branches
  const yearAverages: Record<number, number> = {}
  years.forEach(year => {
    const values = result.branches
      .map(b => b.yearlyMetrics[year.toString()])
      .filter((v): v is number => v != null)

    if (values.length > 0) {
      yearAverages[year] = values.reduce((sum, v) => sum + v, 0) / values.length
    }
  })

  // Find best branch per year (highest metric value)
  const yearBestBranch: Record<number, number> = {}
  years.forEach(year => {
    let bestValue = -Infinity
    let bestBranchId = -1

    result.branches.forEach(branch => {
      const value = branch.yearlyMetrics[year.toString()]
      if (value != null && value > bestValue) {
        bestValue = value
        bestBranchId = branch.branchId
      }
    })

    if (bestBranchId !== -1) {
      yearBestBranch[year] = bestBranchId
    }
  })

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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="font-medium">Job ID:</span> {result.job.id}
            </div>
            <div>
              <span className="font-medium">Valid Tickers:</span> {result.job.validTickers.length}
            </div>
            <div>
              <span className="font-medium">Branches Tested:</span> {result.job.branchCount}
            </div>
            <div>
              <span className="font-medium">Duration:</span> {formatDuration(result.job.elapsedSeconds)}
            </div>
            <div>
              <span className="font-medium">Rolling Window:</span> {result.job.splitConfig.rollingWindowPeriod}
            </div>
            <div>
              <span className="font-medium">Rank By:</span> {result.job.splitConfig.rankBy}
            </div>
            <div>
              <span className="font-medium">Min Warm-Up:</span> {result.job.splitConfig.minWarmUpYears} years
            </div>
            <div>
              <span className="font-medium">Years Tested:</span> {years.length}
            </div>
          </div>
        </div>

        {/* Branch Matrix Table */}
        <div className="space-y-2">
          <h3 className="text-lg font-semibold">Branch Performance Matrix (Annual Returns)</h3>
          <div className="overflow-auto max-h-[600px] border border-border rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0 z-10">
                <tr>
                  <th className="px-2 py-2 text-left sticky left-0 bg-muted/50 border-r border-border min-w-[60px]">
                    Branch
                  </th>
                  <th className="px-2 py-2 text-left sticky left-[60px] bg-muted/50 border-r border-border min-w-[200px]">
                    Parameters
                  </th>
                  {years.map(year => (
                    <th key={year} className="px-2 py-2 text-center min-w-[70px]">
                      {year}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Average row */}
                <tr className="border-t border-border bg-blue-500/10 font-semibold">
                  <td className="px-2 py-2 sticky left-0 bg-blue-500/10 border-r border-border">
                    Avg
                  </td>
                  <td className="px-2 py-2 sticky left-[60px] bg-blue-500/10 border-r border-border text-xs">
                    Average across all branches
                  </td>
                  {years.map(year => (
                    <td key={year} className="px-2 py-2 text-center">
                      {yearAverages[year] != null ? formatMetric(yearAverages[year]) : '-'}
                    </td>
                  ))}
                </tr>

                {/* Branch rows */}
                {result.branches.map((branch, idx) => (
                  <tr
                    key={branch.branchId}
                    className={`border-t border-border ${
                      idx % 2 === 0 ? 'bg-background' : 'bg-muted/20'
                    } hover:bg-muted/40`}
                  >
                    <td className="px-2 py-2 font-mono sticky left-0 bg-inherit border-r border-border">
                      {branch.branchId}
                    </td>
                    <td className="px-2 py-2 sticky left-[60px] bg-inherit border-r border-border">
                      <div className="text-xs space-y-0.5 max-w-[200px]">
                        {Object.entries(branch.parameterValues || {}).map(([nodeId, nodeInfo]: [string, any]) => (
                          <div key={nodeId} className="font-mono">
                            {nodeInfo.kind === 'indicator' && (
                              <span>{nodeInfo.indicator} {nodeInfo.operator} {nodeInfo.threshold} (w={nodeInfo.window})</span>
                            )}
                            {nodeInfo.kind === 'function' && (
                              <span>{nodeInfo.rank} {nodeInfo.bottom} by {nodeInfo.metric} (w={nodeInfo.window})</span>
                            )}
                            {nodeInfo.kind === 'position' && nodeInfo.positions && (
                              <span>→ {nodeInfo.positions.join(', ')}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </td>
                    {years.map(year => {
                      const value = branch.yearlyMetrics[year.toString()]
                      const isBest = yearBestBranch[year] === branch.branchId

                      return (
                        <td
                          key={year}
                          className={`px-2 py-2 text-center ${
                            isBest && value != null ? 'bg-green-500/20 font-semibold' : ''
                          }`}
                          title={isBest && value != null ? 'Best branch this year' : undefined}
                        >
                          {formatMetric(value)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Green cells indicate the best-performing branch for that year. "-" indicates no data for that period.
          </p>
        </div>

        {/* Valid Tickers List */}
        <div className="space-y-2">
          <h3 className="text-lg font-semibold">Valid Tickers ({result.job.validTickers.length})</h3>
          <div className="p-3 rounded bg-muted/20 max-h-32 overflow-auto">
            <div className="flex flex-wrap gap-2">
              {result.job.validTickers.map((ticker) => (
                <span
                  key={ticker}
                  className="px-2 py-1 rounded bg-primary/10 text-xs font-mono"
                  title={
                    result.job.tickerStartDates?.[ticker]
                      ? `Start: ${result.job.tickerStartDates[ticker]}`
                      : undefined
                  }
                >
                  {ticker}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
}
