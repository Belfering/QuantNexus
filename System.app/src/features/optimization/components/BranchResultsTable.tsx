// src/features/optimization/components/BranchResultsTable.tsx
// Branch results table with sorting, filtering, and selection

import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import type { BranchResult } from '@/types/branch'

interface BranchResultsTableProps {
  results: BranchResult[]
  onSelectBranch: (branchId: string) => void
}

type SortKey = 'branchId' | 'isCAGR' | 'isSharpe' | 'isCalmar' | 'isTIM' | 'isTIMAR' | 'isTIMARMaxDD' | 'isTIMARTIMARMaxDD' | 'isCAGRCALMAR' | 'oosCAGR' | 'oosSharpe' | 'oosCalmar' | 'oosTIM' | 'oosTIMAR' | 'oosTIMARMaxDD' | 'oosTIMARTIMARMaxDD' | 'oosCAGRCALMAR'
type FilterType = 'all' | 'passed' | 'failed'

export function BranchResultsTable({ results, onSelectBranch }: BranchResultsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('branchId')
  const [sortAsc, setSortAsc] = useState(true) // Default: ascending by branch ID
  const [filterType, setFilterType] = useState<FilterType>('all')

  // Filter results
  const filteredResults = useMemo(() => {
    if (filterType === 'all') return results
    if (filterType === 'passed') return results.filter(r => r.passed)
    return results.filter(r => !r.passed)
  }, [results, filterType])

  // Helper to compute metrics
  const computeTIMARMaxDD = (metrics: any): number | null => {
    const timar = (metrics as any).timar ?? metrics.timar ?? null
    const maxDD = metrics.maxDrawdown ?? null
    if (timar !== null && maxDD !== null && maxDD !== 0) {
      return timar / Math.abs(maxDD)
    }
    return null
  }

  const computeTIMARTIMARMaxDD = (metrics: any): number | null => {
    const timar = (metrics as any).timar ?? metrics.timar ?? null
    const maxDD = metrics.maxDrawdown ?? null
    if (timar !== null && maxDD !== null && maxDD !== 0) {
      const ratio = timar / Math.abs(maxDD)
      return (timar * 100) * ratio  // Convert TIMAR to percentage for readability
    }
    return null
  }

  const computeCAGRCALMAR = (metrics: any): number | null => {
    const cagr = metrics.cagr ?? null
    const calmar = metrics.calmar ?? null
    if (cagr !== null && calmar !== null) {
      return (cagr * 100) * calmar  // Convert CAGR to percentage for readability
    }
    return null
  }

  // Sort results
  const sortedResults = useMemo(() => {
    const sorted = [...filteredResults]
    sorted.sort((a, b) => {
      let aVal: number | string = 0
      let bVal: number | string = 0

      if (sortKey === 'branchId') {
        aVal = parseInt(a.branchId.replace('branch-', ''))
        bVal = parseInt(b.branchId.replace('branch-', ''))
      } else if (sortKey === 'isCAGR') {
        aVal = a.isMetrics?.cagr ?? -Infinity
        bVal = b.isMetrics?.cagr ?? -Infinity
      } else if (sortKey === 'isSharpe') {
        aVal = a.isMetrics?.sharpe ?? -Infinity
        bVal = b.isMetrics?.sharpe ?? -Infinity
      } else if (sortKey === 'isCalmar') {
        aVal = a.isMetrics?.calmar ?? -Infinity
        bVal = b.isMetrics?.calmar ?? -Infinity
      } else if (sortKey === 'isTIM') {
        aVal = (a.isMetrics as any)?.tim ?? -Infinity
        bVal = (b.isMetrics as any)?.tim ?? -Infinity
      } else if (sortKey === 'isTIMAR') {
        aVal = (a.isMetrics as any)?.timar ?? -Infinity
        bVal = (b.isMetrics as any)?.timar ?? -Infinity
      } else if (sortKey === 'isTIMARMaxDD') {
        aVal = a.isMetrics ? (computeTIMARMaxDD(a.isMetrics) ?? -Infinity) : -Infinity
        bVal = b.isMetrics ? (computeTIMARMaxDD(b.isMetrics) ?? -Infinity) : -Infinity
      } else if (sortKey === 'isTIMARTIMARMaxDD') {
        aVal = a.isMetrics ? (computeTIMARTIMARMaxDD(a.isMetrics) ?? -Infinity) : -Infinity
        bVal = b.isMetrics ? (computeTIMARTIMARMaxDD(b.isMetrics) ?? -Infinity) : -Infinity
      } else if (sortKey === 'isCAGRCALMAR') {
        aVal = a.isMetrics ? (computeCAGRCALMAR(a.isMetrics) ?? -Infinity) : -Infinity
        bVal = b.isMetrics ? (computeCAGRCALMAR(b.isMetrics) ?? -Infinity) : -Infinity
      } else if (sortKey === 'oosCAGR') {
        aVal = a.oosMetrics?.cagr ?? -Infinity
        bVal = b.oosMetrics?.cagr ?? -Infinity
      } else if (sortKey === 'oosSharpe') {
        aVal = a.oosMetrics?.sharpe ?? -Infinity
        bVal = b.oosMetrics?.sharpe ?? -Infinity
      } else if (sortKey === 'oosCalmar') {
        aVal = a.oosMetrics?.calmar ?? -Infinity
        bVal = b.oosMetrics?.calmar ?? -Infinity
      } else if (sortKey === 'oosTIM') {
        aVal = (a.oosMetrics as any)?.tim ?? -Infinity
        bVal = (b.oosMetrics as any)?.tim ?? -Infinity
      } else if (sortKey === 'oosTIMAR') {
        aVal = (a.oosMetrics as any)?.timar ?? -Infinity
        bVal = (b.oosMetrics as any)?.timar ?? -Infinity
      } else if (sortKey === 'oosTIMARMaxDD') {
        aVal = a.oosMetrics ? (computeTIMARMaxDD(a.oosMetrics) ?? -Infinity) : -Infinity
        bVal = b.oosMetrics ? (computeTIMARMaxDD(b.oosMetrics) ?? -Infinity) : -Infinity
      } else if (sortKey === 'oosTIMARTIMARMaxDD') {
        aVal = a.oosMetrics ? (computeTIMARTIMARMaxDD(a.oosMetrics) ?? -Infinity) : -Infinity
        bVal = b.oosMetrics ? (computeTIMARTIMARMaxDD(b.oosMetrics) ?? -Infinity) : -Infinity
      } else if (sortKey === 'oosCAGRCALMAR') {
        aVal = a.oosMetrics ? (computeCAGRCALMAR(a.oosMetrics) ?? -Infinity) : -Infinity
        bVal = b.oosMetrics ? (computeCAGRCALMAR(b.oosMetrics) ?? -Infinity) : -Infinity
      }

      if (sortAsc) {
        return aVal > bVal ? 1 : -1
      } else {
        return aVal < bVal ? 1 : -1
      }
    })
    return sorted
  }, [filteredResults, sortKey, sortAsc])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc)
    } else {
      setSortKey(key)
      setSortAsc(false) // Default to descending
    }
  }

  const getSortIndicator = (key: SortKey) => {
    if (sortKey !== key) return ''
    return sortAsc ? ' ↑' : ' ↓'
  }

  return (
    <div className="space-y-3">
      {/* Filter Dropdown */}
      <div className="flex items-center gap-2">
        <label className="text-sm">Filter:</label>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as FilterType)}
          className="px-2 py-1 rounded border border-border bg-background text-sm"
        >
          <option value="all">All ({results.length})</option>
          <option value="passed">Passed ({results.filter(r => r.passed).length})</option>
          <option value="failed">Failed ({results.filter(r => !r.passed).length})</option>
        </select>
      </div>

      {/* Results Table */}
      <div className="overflow-auto max-h-96 border border-border rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 sticky top-0">
            <tr>
              <th
                className="px-3 py-2 text-left cursor-pointer hover:bg-muted"
                onClick={() => handleSort('branchId')}
              >
                Branch{getSortIndicator('branchId')}
              </th>
              <th className="px-3 py-2 text-left">Parameters</th>
              <th className="px-3 py-2 text-left">Condition Ticker</th>
              <th className="px-3 py-2 text-left">Position Ticker</th>
              <th
                className="px-3 py-2 text-right cursor-pointer hover:bg-muted"
                onClick={() => handleSort('isCAGR')}
              >
                IS CAGR{getSortIndicator('isCAGR')}
              </th>
              <th
                className="px-3 py-2 text-right cursor-pointer hover:bg-muted"
                onClick={() => handleSort('isSharpe')}
              >
                IS Sharpe{getSortIndicator('isSharpe')}
              </th>
              <th
                className="px-3 py-2 text-right cursor-pointer hover:bg-muted"
                onClick={() => handleSort('isCalmar')}
              >
                IS Calmar{getSortIndicator('isCalmar')}
              </th>
              <th
                className="px-3 py-2 text-right cursor-pointer hover:bg-muted"
                onClick={() => handleSort('isTIM')}
              >
                IS TIM{getSortIndicator('isTIM')}
              </th>
              <th
                className="px-3 py-2 text-right cursor-pointer hover:bg-muted"
                onClick={() => handleSort('isTIMAR')}
              >
                IS TIMAR{getSortIndicator('isTIMAR')}
              </th>
              <th
                className="px-3 py-2 text-right cursor-pointer hover:bg-muted"
                onClick={() => handleSort('isTIMARMaxDD')}
                title="TIMAR divided by Max Drawdown"
              >
                IS TIMAR/MaxDD{getSortIndicator('isTIMARMaxDD')}
              </th>
              <th
                className="px-3 py-2 text-right cursor-pointer hover:bg-muted"
                onClick={() => handleSort('isTIMARTIMARMaxDD')}
                title="TIMAR multiplied by (TIMAR/MaxDD)"
              >
                IS TIMAR×(TIMAR/MaxDD){getSortIndicator('isTIMARTIMARMaxDD')}
              </th>
              <th
                className="px-3 py-2 text-right cursor-pointer hover:bg-muted"
                onClick={() => handleSort('isCAGRCALMAR')}
                title="CAGR multiplied by Calmar Ratio"
              >
                IS CAGR×CALMAR{getSortIndicator('isCAGRCALMAR')}
              </th>
              <th
                className="px-3 py-2 text-right cursor-pointer hover:bg-muted"
                onClick={() => handleSort('oosCAGR')}
              >
                OOS CAGR{getSortIndicator('oosCAGR')}
              </th>
              <th
                className="px-3 py-2 text-right cursor-pointer hover:bg-muted"
                onClick={() => handleSort('oosSharpe')}
              >
                OOS Sharpe{getSortIndicator('oosSharpe')}
              </th>
              <th
                className="px-3 py-2 text-right cursor-pointer hover:bg-muted"
                onClick={() => handleSort('oosCalmar')}
              >
                OOS Calmar{getSortIndicator('oosCalmar')}
              </th>
              <th
                className="px-3 py-2 text-right cursor-pointer hover:bg-muted"
                onClick={() => handleSort('oosTIM')}
              >
                OOS TIM{getSortIndicator('oosTIM')}
              </th>
              <th
                className="px-3 py-2 text-right cursor-pointer hover:bg-muted"
                onClick={() => handleSort('oosTIMAR')}
              >
                OOS TIMAR{getSortIndicator('oosTIMAR')}
              </th>
              <th
                className="px-3 py-2 text-right cursor-pointer hover:bg-muted"
                onClick={() => handleSort('oosTIMARMaxDD')}
                title="TIMAR divided by Max Drawdown"
              >
                OOS TIMAR/MaxDD{getSortIndicator('oosTIMARMaxDD')}
              </th>
              <th
                className="px-3 py-2 text-right cursor-pointer hover:bg-muted"
                onClick={() => handleSort('oosTIMARTIMARMaxDD')}
                title="TIMAR multiplied by (TIMAR/MaxDD)"
              >
                OOS TIMAR×(TIMAR/MaxDD){getSortIndicator('oosTIMARTIMARMaxDD')}
              </th>
              <th
                className="px-3 py-2 text-right cursor-pointer hover:bg-muted"
                onClick={() => handleSort('oosCAGRCALMAR')}
                title="CAGR multiplied by Calmar Ratio"
              >
                OOS CAGR×CALMAR{getSortIndicator('oosCAGRCALMAR')}
              </th>
              <th className="px-3 py-2 text-center">Pass/Fail</th>
              <th className="px-3 py-2 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedResults.map((result, idx) => (
              <tr
                key={result.branchId}
                className={`border-t border-border ${idx % 2 === 0 ? 'bg-background' : 'bg-muted/20'} hover:bg-muted/40`}
              >
                <td className="px-3 py-2 font-mono text-xs">{result.branchId}</td>
                <td className="px-3 py-2 text-xs">{result.combination.label}</td>
                <td className="px-3 py-2 text-xs">{(result.combination as any).conditionTicker || '-'}</td>
                <td className="px-3 py-2 text-xs">{(result.combination as any).positionTicker || '-'}</td>
                <td className="px-3 py-2 text-right">
                  {result.isMetrics ? `${(result.isMetrics.cagr * 100).toFixed(2)}%` : '-'}
                </td>
                <td className="px-3 py-2 text-right">
                  {result.isMetrics ? result.isMetrics.sharpe.toFixed(2) : '-'}
                </td>
                <td className="px-3 py-2 text-right">
                  {result.isMetrics ? result.isMetrics.calmar.toFixed(2) : '-'}
                </td>
                <td className="px-3 py-2 text-right">
                  {result.isMetrics && (result.isMetrics as any).tim != null ? `${((result.isMetrics as any).tim * 100).toFixed(2)}%` : '-'}
                </td>
                <td className="px-3 py-2 text-right">
                  {result.isMetrics && (result.isMetrics as any).timar != null ? ((result.isMetrics as any).timar * 100).toFixed(2) : '-'}
                </td>
                <td className="px-3 py-2 text-right">
                  {result.isMetrics ? (computeTIMARMaxDD(result.isMetrics)?.toFixed(4) ?? '-') : '-'}
                </td>
                <td className="px-3 py-2 text-right">
                  {result.isMetrics ? (computeTIMARTIMARMaxDD(result.isMetrics)?.toFixed(4) ?? '-') : '-'}
                </td>
                <td className="px-3 py-2 text-right">
                  {result.isMetrics ? (computeCAGRCALMAR(result.isMetrics)?.toFixed(4) ?? '-') : '-'}
                </td>
                <td className="px-3 py-2 text-right">
                  {result.oosMetrics ? `${(result.oosMetrics.cagr * 100).toFixed(2)}%` : '-'}
                </td>
                <td className="px-3 py-2 text-right">
                  {result.oosMetrics ? result.oosMetrics.sharpe.toFixed(2) : '-'}
                </td>
                <td className="px-3 py-2 text-right">
                  {result.oosMetrics ? result.oosMetrics.calmar.toFixed(2) : '-'}
                </td>
                <td className="px-3 py-2 text-right">
                  {result.oosMetrics && (result.oosMetrics as any).tim != null ? `${((result.oosMetrics as any).tim * 100).toFixed(2)}%` : '-'}
                </td>
                <td className="px-3 py-2 text-right">
                  {result.oosMetrics && (result.oosMetrics as any).timar != null ? ((result.oosMetrics as any).timar * 100).toFixed(2) : '-'}
                </td>
                <td className="px-3 py-2 text-right">
                  {result.oosMetrics ? (computeTIMARMaxDD(result.oosMetrics)?.toFixed(4) ?? '-') : '-'}
                </td>
                <td className="px-3 py-2 text-right">
                  {result.oosMetrics ? (computeTIMARTIMARMaxDD(result.oosMetrics)?.toFixed(4) ?? '-') : '-'}
                </td>
                <td className="px-3 py-2 text-right">
                  {result.oosMetrics ? (computeCAGRCALMAR(result.oosMetrics)?.toFixed(4) ?? '-') : '-'}
                </td>
                <td className="px-3 py-2 text-center">
                  {result.status === 'success' ? (
                    result.passed ? (
                      <span className="text-green-500 font-bold">✓</span>
                    ) : (
                      <span className="text-red-500 font-bold">✗</span>
                    )
                  ) : result.status === 'error' ? (
                    <span className="text-orange-500 text-xs">Error</span>
                  ) : (
                    <span className="text-muted text-xs">-</span>
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onSelectBranch(result.branchId)}
                    disabled={result.status !== 'success'}
                  >
                    Load
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sortedResults.length === 0 && (
        <div className="text-center text-sm text-muted py-4">
          No results match the filter
        </div>
      )}
    </div>
  )
}
