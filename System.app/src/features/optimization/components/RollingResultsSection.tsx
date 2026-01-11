// Rolling optimization results section - displays branch matrix with per-year metrics

import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { RollingOptimizationResult } from '@/types/bot'
import { extractNodeIds } from '../services/nodeExtractor'
import { useRollingJobs } from '../hooks/useRollingJobs'
import { useRollingResults } from '../hooks/useRollingResults'

export interface RollingResultsSectionProps {
  result: RollingOptimizationResult | null
  onClose: () => void
}

export function RollingResultsSection({ result: currentResult, onClose }: RollingResultsSectionProps) {
  const { jobs, loading: jobsLoading, error: jobsError, selectedJobId, setSelectedJobId, refresh } = useRollingJobs()
  const { result: selectedResult, loading: resultsLoading } = useRollingResults(selectedJobId)

  // Show current result if available, otherwise show selected job result
  const result = currentResult || selectedResult

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleString()
  }

  // If showing a browsed job (not current result)
  const isBrowsingHistory = !currentResult && selectedResult

  const handleDeleteJob = async () => {
    if (!selectedJobId) return

    const jobName = `Job #${selectedJobId}`
    if (!confirm(`Are you sure you want to delete "${jobName}"? This cannot be undone.`)) {
      return
    }

    try {
      const response = await fetch(`/api/optimization/rolling/jobs/${selectedJobId}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        throw new Error('Failed to delete rolling job')
      }

      // Clear selection and refresh jobs list
      setSelectedJobId(null)
      refresh()
      alert('Job deleted successfully')
    } catch (error) {
      console.error('Failed to delete rolling job:', error)
      alert('Failed to delete rolling job')
    }
  }

  if (!result && jobsLoading) {
    return (
      <Card className="p-6">
        <div className="text-center text-muted-foreground">Loading jobs...</div>
      </Card>
    )
  }

  if (!result && jobsError) {
    return (
      <Card className="p-6">
        <div className="text-center text-red-500">Error: {jobsError}</div>
      </Card>
    )
  }

  if (!result && jobs.length === 0) {
    return (
      <Card className="p-6">
        <div className="text-center text-muted-foreground">
          <p className="mb-2">No rolling optimization jobs found.</p>
          <p className="text-sm">Run a rolling optimization from the Builder tab to see results here.</p>
        </div>
      </Card>
    )
  }

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

  // Format the rank by metric name for display
  const getMetricDisplayName = (rankBy: string) => {
    const metricMap: Record<string, string> = {
      'sharpe_ratio': 'Sharpe',
      'calmar_ratio': 'Calmar',
      'sortino_ratio': 'Sortino',
      'cagr': 'CAGR',
      'total_return': 'Return',
      'max_drawdown': 'Drawdown',
      'win_rate': 'WinRate',
    }
    return metricMap[rankBy] || rankBy
  }

  const metricName = getMetricDisplayName(result.job.splitConfig.rankBy)

  // Extract all unique years from branches and sort
  const allYears = new Set<number>()
  result.branches.forEach(branch => {
    Object.keys(branch.yearlyMetrics).forEach(year => {
      allYears.add(parseInt(year, 10))
    })
  })
  const years = Array.from(allYears).sort((a, b) => a - b)

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

  // Convert parameterValues to node arrays (matching chronological structure)
  const branchesWithNodes = result.branches.map(branch => {
    // Extract node IDs in depth-first order from tree structure
    let nodeIds: string[]
    if (result.job.treeJson && typeof result.job.treeJson === 'string') {
      try {
        const tree = JSON.parse(result.job.treeJson)
        nodeIds = extractNodeIds(tree)
      } catch (e) {
        console.error('Failed to parse tree JSON:', e)
        // Fallback to alphabetical sort
        nodeIds = Object.keys(branch.parameterValues || {}).sort()
      }
    } else {
      // Fallback for old results without tree JSON
      nodeIds = Object.keys(branch.parameterValues || {}).sort()
    }

    // Extract parameter values in the correct order
    const nodes = nodeIds
      .map(nodeId => branch.parameterValues[nodeId])
      .filter(Boolean) // Remove any undefined entries
    return { ...branch, nodes }
  })

  // Calculate maximum number of nodes across all branches
  const maxNodes = Math.max(...branchesWithNodes.map(b => b.nodes.length), 0)

  return (
    <Card className="p-6">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Rolling Optimization Results</h2>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={refresh}>
              Refresh
            </Button>
            <Button size="sm" variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>

        {/* Job Selector - only show if browsing history */}
        {!currentResult && jobs.length > 0 && (
          <div className="space-y-2">
            <label className="text-sm font-medium">Select Job:</label>
            <div className="flex gap-2">
              <select
                value={selectedJobId || ''}
                onChange={(e) => setSelectedJobId(Number(e.target.value))}
                className="flex-1 px-3 py-2 rounded border border-border bg-background"
              >
                <option value="">-- Select a job --</option>
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    Job #{job.id} - {job.botName} - {formatTimestamp(job.createdAt)} - {job.branchCount} branches
                  </option>
                ))}
              </select>
              {selectedJobId && (
                <Button size="sm" variant="outline" onClick={handleDeleteJob}>
                  Delete
                </Button>
              )}
            </div>
          </div>
        )}

        {resultsLoading && (
          <div className="text-center text-muted-foreground py-8">Loading results...</div>
        )}

        {!resultsLoading && result && (
          <>

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
          <h3 className="text-lg font-semibold">Branch Performance Matrix (Annual {metricName})</h3>
          <div className="overflow-auto max-h-[600px] border border-border rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0 z-10">
                <tr>
                  <th className="px-2 py-2 text-left sticky left-0 bg-muted/50 border-r border-border min-w-[60px]">
                    Branch
                  </th>
                  {Array.from({ length: maxNodes }, (_, i) => (
                    <th key={`node-${i + 1}`} className="px-2 py-2 text-left">
                      Node {i + 1}
                    </th>
                  ))}
                  {years.map(year => (
                    <th key={year} className="px-2 py-2 text-center min-w-[70px]">
                      {year} {metricName}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Branch rows */}
                {branchesWithNodes.map((branch, idx) => (
                  <tr
                    key={branch.branchId}
                    className={`border-t border-border ${
                      idx % 2 === 0 ? 'bg-background' : 'bg-muted/20'
                    } hover:bg-muted/40`}
                  >
                    <td className="px-2 py-2 font-mono sticky left-0 bg-inherit border-r border-border">
                      {branch.branchId}
                    </td>
                    {Array.from({ length: maxNodes }, (_, nodeIdx) => {
                      const node = branch.nodes?.[nodeIdx]
                      return (
                        <td key={`node-${nodeIdx}`} className="px-2 py-2 text-xs">
                          {node ? (
                            <pre className="text-xs font-mono overflow-auto max-w-xs max-h-24 bg-muted/20 p-1 rounded">
                              {JSON.stringify(node, null, 2)}
                            </pre>
                          ) : (
                            '-'
                          )}
                        </td>
                      )
                    })}
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
          </>
        )}
      </div>
    </Card>
  )
}
