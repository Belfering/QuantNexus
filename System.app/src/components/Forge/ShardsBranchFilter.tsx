// Shards Branch Filter - Middle card for filtering branches by metric

import { Card } from '@/components/ui/card'
import type { OptimizationResult } from '@/types/optimizationJob'
import type { RollingOptimizationResult } from '@/types/bot'

interface ShardsBranchFilterProps {
  loadedJobType: 'chronological' | 'rolling' | null
  allBranches: OptimizationResult[] | RollingOptimizationResult['branches']
  filteredBranches: OptimizationResult[] | RollingOptimizationResult['branches']
  filterMetric: 'sharpe' | 'cagr' | 'tim' | 'timar' | 'calmar'
  filterTopX: number
  onFilterMetricChange: (metric: 'sharpe' | 'cagr' | 'tim' | 'timar' | 'calmar') => void
  onFilterTopXChange: (count: number) => void
}

export function ShardsBranchFilter({
  loadedJobType,
  allBranches,
  filteredBranches,
  filterMetric,
  filterTopX,
  onFilterMetricChange,
  onFilterTopXChange
}: ShardsBranchFilterProps) {
  // Helper function to extract metric value from branch based on job type
  const getMetricValue = (branch: OptimizationResult | RollingOptimizationResult['branches'][number]): number | null => {
    if (loadedJobType === 'chronological') {
      const b = branch as OptimizationResult
      // Use IS metrics for chronological
      return b.isMetrics?.[filterMetric] ?? null
    } else if (loadedJobType === 'rolling') {
      const b = branch as RollingOptimizationResult['branches'][number]
      // Use IS metrics for rolling
      return b.isOosMetrics?.IS ?? null
    }
    return null
  }

  // Helper function to format metric value for display
  const formatMetricValue = (value: number | null): string => {
    if (value === null) return 'N/A'
    return value.toFixed(4)
  }

  // Helper function to get branch label
  const getBranchLabel = (branch: OptimizationResult | RollingOptimizationResult['branches'][number]): string => {
    if (loadedJobType === 'chronological') {
      const b = branch as OptimizationResult
      return b.parameterLabel || `Branch ${b.branchId}`
    } else {
      const b = branch as RollingOptimizationResult['branches'][number]
      return `Branch ${b.branchId}`
    }
  }

  return (
    <div className="p-4 bg-muted/30 rounded-lg flex flex-col h-full">
      <div className="text-sm font-medium mb-3">Metric Filters</div>

      {/* Filter Controls */}
      <div className="space-y-3 mb-4">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Metric</label>
          <select
            value={filterMetric}
            onChange={(e) => onFilterMetricChange(e.target.value as any)}
            className="w-full px-2 py-1 rounded border border-border bg-background text-sm"
            disabled={allBranches.length === 0}
          >
            <option value="sharpe">Sharpe Ratio</option>
            <option value="cagr">CAGR</option>
            <option value="tim">TIM</option>
            <option value="timar">TIMAR</option>
            <option value="calmar">Calmar Ratio</option>
          </select>
        </div>

        <div>
          <label className="text-xs text-muted-foreground block mb-1">Top X Branches</label>
          <input
            type="number"
            min="1"
            max={allBranches.length || 100}
            value={filterTopX}
            onChange={(e) => onFilterTopXChange(Number(e.target.value) || 1)}
            className="w-full px-2 py-1 rounded border border-border bg-background text-sm"
            disabled={allBranches.length === 0}
          />
        </div>
      </div>

      {/* Filtered Branches List */}
      <div className="text-xs font-medium mb-2">
        Filtered Branches ({filteredBranches.length})
      </div>
      <div className="flex-1 overflow-y-auto space-y-2">
        {allBranches.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-8">
            Load a job to see branches
          </div>
        ) : filteredBranches.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-8">
            No branches match criteria
          </div>
        ) : (
          filteredBranches.map((branch, idx) => {
            const branchId = loadedJobType === 'chronological'
              ? (branch as OptimizationResult).branchId
              : (branch as RollingOptimizationResult['branches'][number]).branchId

            return (
              <div key={branchId || idx} className="p-2 bg-background rounded text-xs">
                <div className="font-bold">
                  {getBranchLabel(branch)}
                </div>
                <div className="text-muted-foreground">
                  {filterMetric}: {formatMetricValue(getMetricValue(branch))}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
