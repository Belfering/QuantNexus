// Optimization results panel - displays saved optimization jobs and their results

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useOptimizationJobs } from '../hooks/useOptimizationJobs'
import { useOptimizationResults } from '../hooks/useOptimizationResults'
import { useOptimizationExport } from '../hooks/useOptimizationExport'
import { useBotStore } from '@/stores/useBotStore'
import { useTreeSync } from '@/hooks/useTreeSync'
import { applyBranchToTree } from '../services/branchGenerator'

export function OptimizationResultsPanel() {
  const { jobs, loading: jobsLoading, error: jobsError, selectedJobId, setSelectedJobId, refresh } = useOptimizationJobs()
  const { results, loading: resultsLoading, sortBy, sortOrder, setSortBy, setSortOrder } = useOptimizationResults(selectedJobId)
  const { exportCSV, exporting } = useOptimizationExport()
  const { activeBot } = useBotStore()
  const { current, pushTree } = useTreeSync('Forge')

  const [isRenaming, setIsRenaming] = useState(false)
  const [newName, setNewName] = useState('')

  const selectedJob = useMemo(() => {
    return jobs.find(j => j.id === selectedJobId)
  }, [jobs, selectedJobId])

  const handleLoadBranch = (result: typeof results[0]) => {
    if (!activeBot || !current) {
      alert('No active bot or tree')
      return
    }

    // Convert OptimizationResult to BranchCombination format
    const combination = {
      id: result.branchId,
      parameterValues: result.parameterValues,
      label: result.parameterLabel,
    }

    // Apply the branch parameters to the current tree
    const modifiedTree = applyBranchToTree(current, combination, activeBot.parameterRanges || [])
    pushTree(modifiedTree)

    alert(`Parameters loaded: ${result.parameterLabel}`)
  }

  const handleStartRename = () => {
    setNewName(selectedJob?.name || '')
    setIsRenaming(true)
  }

  const handleCancelRename = () => {
    setIsRenaming(false)
    setNewName('')
  }

  const handleSaveRename = async () => {
    if (!selectedJobId) return

    try {
      const response = await fetch(`/api/optimization/jobs/${selectedJobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() || null })
      })

      if (!response.ok) {
        throw new Error('Failed to update job name')
      }

      setIsRenaming(false)
      setNewName('')
      refresh() // Refresh jobs list to show updated name
    } catch (error) {
      console.error('Failed to rename job:', error)
      alert('Failed to rename job')
    }
  }

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleString()
  }

  const formatDuration = (start: number, end?: number) => {
    if (!end) return '-'
    const seconds = Math.floor((end - start) / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    if (hours > 0) return `${hours}h ${minutes % 60}m`
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`
    return `${seconds}s`
  }

  if (jobsLoading) {
    return (
      <Card className="p-6">
        <div className="text-center text-muted-foreground">Loading jobs...</div>
      </Card>
    )
  }

  if (jobsError) {
    return (
      <Card className="p-6">
        <div className="text-center text-red-500">Error: {jobsError}</div>
      </Card>
    )
  }

  if (jobs.length === 0) {
    return (
      <Card className="p-6">
        <div className="text-center text-muted-foreground">
          <p className="mb-2">No optimization jobs found.</p>
          <p className="text-sm">Run an optimization from the Builder tab to see results here.</p>
        </div>
      </Card>
    )
  }

  return (
    <Card className="p-6">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Optimization Results</h2>
          <Button size="sm" variant="outline" onClick={refresh}>
            Refresh
          </Button>
        </div>

        {/* Job Selector */}
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
                  {job.name || `Job #${job.id} - ${job.botName}`} - {formatTimestamp(job.createdAt)} - {job.passingBranches}/{job.totalBranches} passed
                </option>
              ))}
            </select>
            {selectedJobId && !isRenaming && (
              <Button size="sm" variant="outline" onClick={handleStartRename}>
                Rename
              </Button>
            )}
          </div>
          {isRenaming && (
            <div className="flex gap-2 items-center p-3 bg-muted/20 rounded">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Enter job name (optional)"
                className="flex-1 px-2 py-1 rounded border border-border bg-background text-sm"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveRename()
                  if (e.key === 'Escape') handleCancelRename()
                }}
              />
              <Button size="sm" onClick={handleSaveRename}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={handleCancelRename}>
                Cancel
              </Button>
            </div>
          )}
        </div>

        {/* Job Details */}
        {selectedJob && (
          <div className="p-4 rounded bg-muted/20 space-y-2">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-medium">Bot:</span> {selectedJob.botName}
              </div>
              <div>
                <span className="font-medium">Status:</span>{' '}
                <span className={selectedJob.status === 'completed' ? 'text-green-500' : 'text-yellow-500'}>
                  {selectedJob.status}
                </span>
              </div>
              <div>
                <span className="font-medium">Started:</span> {formatTimestamp(selectedJob.startTime)}
              </div>
              <div>
                <span className="font-medium">Duration:</span> {formatDuration(selectedJob.startTime, selectedJob.endTime)}
              </div>
              <div>
                <span className="font-medium">Total Branches:</span> {selectedJob.totalBranches}
              </div>
              <div>
                <span className="font-medium">Passing Branches:</span>{' '}
                <span className="text-green-500 font-bold">{selectedJob.passingBranches}</span>
              </div>
            </div>
            {selectedJob.errorMessage && (
              <div className="text-red-500 text-sm">
                <span className="font-medium">Error:</span> {selectedJob.errorMessage}
              </div>
            )}
          </div>
        )}

        {/* Results Table */}
        {selectedJobId && (
          <div className="space-y-4">
            {/* Actions */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <label className="text-sm">Sort by:</label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="px-2 py-1 rounded border border-border bg-background text-sm"
                >
                  <option value="is_cagr">IS CAGR</option>
                  <option value="is_sharpe">IS Sharpe</option>
                  <option value="is_calmar">IS Calmar</option>
                  <option value="is_sortino">IS Sortino</option>
                  <option value="is_treynor">IS Treynor</option>
                  <option value="is_beta">IS Beta</option>
                  <option value="is_volatility">IS Volatility</option>
                  <option value="is_win_rate">IS Win Rate</option>
                  <option value="is_max_drawdown">IS MaxDD</option>
                  <option value="is_tim">IS TIM</option>
                  <option value="is_timar">IS TIMAR</option>
                  <option value="oos_cagr">OOS CAGR</option>
                  <option value="oos_sharpe">OOS Sharpe</option>
                  <option value="oos_calmar">OOS Calmar</option>
                  <option value="oos_sortino">OOS Sortino</option>
                  <option value="oos_treynor">OOS Treynor</option>
                  <option value="oos_beta">OOS Beta</option>
                  <option value="oos_volatility">OOS Volatility</option>
                  <option value="oos_win_rate">OOS Win Rate</option>
                  <option value="oos_max_drawdown">OOS MaxDD</option>
                  <option value="oos_tim">OOS TIM</option>
                  <option value="oos_timar">OOS TIMAR</option>
                </select>
                <select
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value as 'asc' | 'desc')}
                  className="px-2 py-1 rounded border border-border bg-background text-sm"
                >
                  <option value="desc">Descending</option>
                  <option value="asc">Ascending</option>
                </select>
              </div>
              <Button size="sm" onClick={() => exportCSV(selectedJobId)} disabled={exporting}>
                {exporting ? 'Exporting...' : 'Export CSV'}
              </Button>
            </div>

            {/* Table */}
            {resultsLoading ? (
              <div className="text-center text-muted-foreground py-8">Loading results...</div>
            ) : results.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">No results found for this job.</div>
            ) : (
              <div className="overflow-auto max-h-[600px] border border-border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left">Branch</th>
                      <th className="px-3 py-2 text-left">Parameters</th>
                      <th className="px-3 py-2 text-left">IS Start</th>
                      <th className="px-3 py-2 text-right">IS CAGR</th>
                      <th className="px-3 py-2 text-right">IS Sharpe</th>
                      <th className="px-3 py-2 text-right">IS Calmar</th>
                      <th className="px-3 py-2 text-right">IS Sortino</th>
                      <th className="px-3 py-2 text-right">IS Treynor</th>
                      <th className="px-3 py-2 text-right">IS Beta</th>
                      <th className="px-3 py-2 text-right">IS Vol</th>
                      <th className="px-3 py-2 text-right">IS MaxDD</th>
                      <th className="px-3 py-2 text-right">IS TIM</th>
                      <th className="px-3 py-2 text-right">IS TIMAR</th>
                      <th className="px-3 py-2 text-right">IS Win%</th>
                      <th className="px-3 py-2 text-left">OOS Start</th>
                      <th className="px-3 py-2 text-right">OOS CAGR</th>
                      <th className="px-3 py-2 text-right">OOS Sharpe</th>
                      <th className="px-3 py-2 text-right">OOS Calmar</th>
                      <th className="px-3 py-2 text-right">OOS Sortino</th>
                      <th className="px-3 py-2 text-right">OOS Treynor</th>
                      <th className="px-3 py-2 text-right">OOS Beta</th>
                      <th className="px-3 py-2 text-right">OOS Vol</th>
                      <th className="px-3 py-2 text-right">OOS MaxDD</th>
                      <th className="px-3 py-2 text-right">OOS TIM</th>
                      <th className="px-3 py-2 text-right">OOS TIMAR</th>
                      <th className="px-3 py-2 text-right">OOS Win%</th>
                      <th className="px-3 py-2 text-center">Pass</th>
                      <th className="px-3 py-2 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((result, idx) => (
                      <tr
                        key={result.id}
                        className={`border-t border-border ${idx % 2 === 0 ? 'bg-background' : 'bg-muted/20'} hover:bg-muted/40`}
                      >
                        <td className="px-3 py-2 font-mono text-xs">{result.branchId}</td>
                        <td className="px-3 py-2 text-xs">{result.parameterLabel}</td>
                        <td className="px-3 py-2 text-xs">{result.isMetrics?.startDate || '-'}</td>
                        <td className="px-3 py-2 text-right">{result.isMetrics?.cagr != null ? (result.isMetrics.cagr * 100).toFixed(2) + '%' : '-'}</td>
                        <td className="px-3 py-2 text-right">{result.isMetrics?.sharpe != null ? result.isMetrics.sharpe.toFixed(2) : '-'}</td>
                        <td className="px-3 py-2 text-right">{result.isMetrics?.calmar != null ? result.isMetrics.calmar.toFixed(2) : '-'}</td>
                        <td className="px-3 py-2 text-right">{result.isMetrics?.sortino != null ? result.isMetrics.sortino.toFixed(2) : '-'}</td>
                        <td className="px-3 py-2 text-right">{result.isMetrics?.treynor != null ? result.isMetrics.treynor.toFixed(2) : '-'}</td>
                        <td className="px-3 py-2 text-right">{result.isMetrics?.beta != null ? result.isMetrics.beta.toFixed(2) : '-'}</td>
                        <td className="px-3 py-2 text-right">{result.isMetrics?.volatility != null ? (result.isMetrics.volatility * 100).toFixed(2) + '%' : '-'}</td>
                        <td className="px-3 py-2 text-right">{result.isMetrics?.maxDrawdown != null ? (result.isMetrics.maxDrawdown * 100).toFixed(2) + '%' : '-'}</td>
                        <td className="px-3 py-2 text-right">{result.isMetrics?.tim != null ? (result.isMetrics.tim * 100).toFixed(1) + '%' : '-'}</td>
                        <td className="px-3 py-2 text-right">{result.isMetrics?.timar != null ? (result.isMetrics.timar * 100).toFixed(2) + '%' : '-'}</td>
                        <td className="px-3 py-2 text-right">{result.isMetrics?.winRate != null ? (result.isMetrics.winRate * 100).toFixed(1) + '%' : '-'}</td>
                        <td className="px-3 py-2 text-xs">{result.oosMetrics?.startDate || '-'}</td>
                        <td className="px-3 py-2 text-right">{result.oosMetrics?.cagr != null ? (result.oosMetrics.cagr * 100).toFixed(2) + '%' : '-'}</td>
                        <td className="px-3 py-2 text-right">{result.oosMetrics?.sharpe != null ? result.oosMetrics.sharpe.toFixed(2) : '-'}</td>
                        <td className="px-3 py-2 text-right">{result.oosMetrics?.calmar != null ? result.oosMetrics.calmar.toFixed(2) : '-'}</td>
                        <td className="px-3 py-2 text-right">{result.oosMetrics?.sortino != null ? result.oosMetrics.sortino.toFixed(2) : '-'}</td>
                        <td className="px-3 py-2 text-right">{result.oosMetrics?.treynor != null ? result.oosMetrics.treynor.toFixed(2) : '-'}</td>
                        <td className="px-3 py-2 text-right">{result.oosMetrics?.beta != null ? result.oosMetrics.beta.toFixed(2) : '-'}</td>
                        <td className="px-3 py-2 text-right">{result.oosMetrics?.volatility != null ? (result.oosMetrics.volatility * 100).toFixed(2) + '%' : '-'}</td>
                        <td className="px-3 py-2 text-right">{result.oosMetrics?.maxDrawdown != null ? (result.oosMetrics.maxDrawdown * 100).toFixed(2) + '%' : '-'}</td>
                        <td className="px-3 py-2 text-right">{result.oosMetrics?.tim != null ? (result.oosMetrics.tim * 100).toFixed(1) + '%' : '-'}</td>
                        <td className="px-3 py-2 text-right">{result.oosMetrics?.timar != null ? (result.oosMetrics.timar * 100).toFixed(2) + '%' : '-'}</td>
                        <td className="px-3 py-2 text-right">{result.oosMetrics?.winRate != null ? (result.oosMetrics.winRate * 100).toFixed(1) + '%' : '-'}</td>
                        <td className="px-3 py-2 text-center">
                          {result.passed ? (
                            <span className="text-green-500 font-bold">✓</span>
                          ) : (
                            <span className="text-red-500 font-bold">✗</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Button size="sm" variant="outline" onClick={() => handleLoadBranch(result)}>
                            Load
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Result count */}
            <div className="text-sm text-muted-foreground text-center">
              Showing {results.length} result{results.length !== 1 ? 's' : ''}
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
