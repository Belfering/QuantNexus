// Shards Branch Filter - Middle card for filtering branches by metric
// Shows all available branches with full parameter details extracted from tree

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import type { OptimizationResult } from '@/types/optimizationJob'
import type { RollingOptimizationResult } from '@/types/bot'
import { extractBranchDisplayInfo, type BranchDisplayInfo } from '@/features/shards/utils/conditionDisplay'
import { type EligibilityRequirement, METRIC_LABELS, type EligibilityMetric } from '@/types/admin'
import { MetricDropdown } from './MetricDropdown'
import { FilterMetricDropdown } from './FilterMetricDropdown'

interface ShardsBranchFilterProps {
  loadedJobType: 'chronological' | 'rolling' | null
  allBranches: OptimizationResult[] | RollingOptimizationResult['branches']
  filterMetric: 'sharpe' | 'sortino' | 'treynor' | 'cagr' | 'calmar' | 'tim' | 'timar' | 'maxDrawdown' | 'vol' | 'beta' | 'winRate' | 'avgTurnover' | 'avgHoldings' | 'timarMaxDDRatio' | 'timarTimarMaxDD' | 'cagrCalmar'
  filterTopX: number
  filterMode: 'overall' | 'perPattern'
  filterTopXPerPattern: number
  discoveredPatterns: Record<string, any>
  metricRequirements: EligibilityRequirement[]
  onFilterMetricChange: (metric: 'sharpe' | 'sortino' | 'treynor' | 'cagr' | 'calmar' | 'tim' | 'timar' | 'maxDrawdown' | 'vol' | 'beta' | 'winRate' | 'avgTurnover' | 'avgHoldings' | 'timarMaxDDRatio' | 'timarTimarMaxDD' | 'cagrCalmar') => void
  onFilterTopXChange: (count: number) => void
  onFilterModeChange: (mode: 'overall' | 'perPattern') => void
  onFilterTopXPerPatternChange: (count: number) => void
  onMetricRequirementsChange: (requirements: EligibilityRequirement[]) => void
  onApplyFilter: () => void
}

export function ShardsBranchFilter({
  loadedJobType,
  allBranches,
  filterMetric,
  filterTopX,
  filterMode,
  filterTopXPerPattern,
  discoveredPatterns,
  metricRequirements,
  onFilterMetricChange,
  onFilterTopXChange,
  onFilterModeChange,
  onFilterTopXPerPatternChange,
  onMetricRequirementsChange,
  onApplyFilter
}: ShardsBranchFilterProps) {
  // Local state for the input to allow clearing while typing
  const [topXInput, setTopXInput] = useState(String(filterTopX))

  // Sync local state when prop changes (e.g., from store reset)
  useEffect(() => {
    setTopXInput(filterTopX === 0 ? '' : String(filterTopX))
  }, [filterTopX])

  // Collapsible section state
  const [showRequirements, setShowRequirements] = useState(false)

  // New requirement inputs
  const [newMetric, setNewMetric] = useState<EligibilityMetric>('sharpe')
  const [newComparison, setNewComparison] = useState<'at_least' | 'at_most'>('at_least')
  const [newMetricValue, setNewMetricValue] = useState(0)

  // Auto-expand when first requirement added
  useEffect(() => {
    if (metricRequirements.length > 0 && !showRequirements) {
      setShowRequirements(true)
    }
  }, [metricRequirements.length])

  // Add requirement handler
  const handleAddRequirement = () => {
    // Max Drawdown is stored as POSITIVE in backend (0.155 = 15.5% drawdown)
    // User enters positive values and comparison works normally (no reversal needed)
    const newReq: EligibilityRequirement = {
      id: `metric-${Date.now()}`,
      type: 'metric',
      metric: newMetric,
      comparison: newComparison,
      value: newMetricValue
    }
    onMetricRequirementsChange([...metricRequirements, newReq])
  }

  // Format requirement value with percentage or decimal
  const formatRequirementValue = (req: EligibilityRequirement): string => {
    const isPercentage = ['cagr', 'maxDrawdown', 'tim', 'timar', 'winRate', 'vol', 'avgTurnover', 'timarTimarMaxDD', 'cagrCalmar'].includes(req.metric || '')
    return isPercentage ? `${req.value.toFixed(2)}%` : req.value.toFixed(4)
  }

  // Helper to get metric value for display
  const getMetricValue = (branch: OptimizationResult | RollingOptimizationResult['branches'][number]): number | null => {
    if (loadedJobType === 'chronological') {
      const b = branch as OptimizationResult
      return b.isMetrics?.[filterMetric] ?? null
    } else if (loadedJobType === 'rolling') {
      const b = branch as RollingOptimizationResult['branches'][number]
      return b.isOosMetrics?.IS ?? null
    }
    return null
  }

  // Helper to format metric value
  const formatMetricValue = (value: number | null): string => {
    if (value === null) return 'N/A'
    return value.toFixed(4)
  }

  // Get display info from branch
  const getBranchDisplay = (branch: OptimizationResult | RollingOptimizationResult['branches'][number]): BranchDisplayInfo | null => {
    if (loadedJobType === 'chronological') {
      const b = branch as OptimizationResult
      return extractBranchDisplayInfo(b.treeJson)
    }
    return null
  }

  return (
    <div className="p-4 bg-muted/30 rounded-lg flex flex-col h-full overflow-y-auto hide-horizontal-scrollbar">
      <div className="text-base font-semibold mb-3">Filter Settings</div>

      {/* Filter Controls */}
      <div className="space-y-3 mb-3">
        {/* Row 1: Mode toggle with theme colors */}
        <div>
          <div className="flex items-center gap-1">
            <Button
              onClick={() => onFilterModeChange('overall')}
              variant={filterMode === 'overall' ? 'accent' : 'ghost'}
              size="sm"
              className="flex-1"
            >
              All
            </Button>
            <Button
              onClick={() => onFilterModeChange('perPattern')}
              variant={filterMode === 'perPattern' ? 'accent' : 'ghost'}
              size="sm"
              className="flex-1"
            >
              Per Pattern
            </Button>
          </div>
        </div>

        {/* Collapsible Metric Requirements Section */}
        <div className="border-t border-border pt-3">
          <button
            onClick={() => setShowRequirements(!showRequirements)}
            className="flex items-center justify-between w-full text-sm font-medium mb-2 hover:text-foreground transition-colors"
          >
            <span>Metric Requirements ({metricRequirements.length})</span>
            <span className="text-muted-foreground text-xs">{showRequirements ? '▼' : '▶'}</span>
          </button>

          {showRequirements && (
            <div className="space-y-3 p-3 bg-background rounded border border-border">
              {/* Add New Requirement Row */}
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-end">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">
                    Metric
                  </label>
                  <MetricDropdown
                    value={newMetric}
                    onChange={setNewMetric}
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Comparison</label>
                  <select
                    value={newComparison}
                    onChange={(e) => setNewComparison(e.target.value as 'at_least' | 'at_most')}
                    className="w-full px-2 py-1 rounded border border-border bg-background text-sm h-8"
                  >
                    <option value="at_least">at least</option>
                    <option value="at_most">at most</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Value</label>
                  <input
                    type="number"
                    step="0.01"
                    value={newMetricValue}
                    onChange={(e) => setNewMetricValue(Number(e.target.value))}
                    className="w-20 px-2 py-1 rounded border border-border bg-background text-sm h-8"
                  />
                </div>

                <Button onClick={handleAddRequirement} size="sm" className="h-8">
                  Add
                </Button>
              </div>

              {/* Current Requirements List */}
              {metricRequirements.length > 0 && (
                <div className="space-y-2 border-t border-border pt-2 mt-2">
                  {metricRequirements.map(req => {
                    const displayComparison = req.comparison === 'at_least' ? '≥' : '≤'

                    return (
                      <div key={req.id} className="flex items-center justify-between p-2 bg-muted/30 rounded">
                        <span className="text-sm">
                          {METRIC_LABELS[req.metric!]} {displayComparison} {formatRequirementValue(req)}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onMetricRequirementsChange(metricRequirements.filter(r => r.id !== req.id))}
                          className="h-6 w-6 p-0"
                        >
                          X
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Row 2: Metric + Top X + Apply (inline) */}
        <div className="flex items-end gap-2 border-t border-border pt-3">
          <div className="flex-1">
            <label className="text-sm text-muted-foreground block mb-1">
              Metric
            </label>
            <FilterMetricDropdown
              value={filterMetric}
              onChange={onFilterMetricChange}
              disabled={allBranches.length === 0}
              className="w-full"
            />
          </div>
          <div className="w-20">
            <label className="text-sm text-muted-foreground block mb-1">
              {filterMode === 'overall' ? 'Top X' : 'Top/Pat'}
            </label>
            <input
              type="number"
              min={filterMode === 'overall' ? 0 : 1}
              value={filterMode === 'overall' ? filterTopX : filterTopXPerPattern}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10) || (filterMode === 'overall' ? 0 : 1)
                if (filterMode === 'overall') {
                  onFilterTopXChange(val)
                } else {
                  onFilterTopXPerPatternChange(val)
                }
              }}
              className="w-full px-2 py-1 rounded border border-border bg-background text-sm h-8"
              disabled={filterMode === 'perPattern' ? Object.keys(discoveredPatterns).length === 0 : allBranches.length === 0}
            />
          </div>
          <Button
            onClick={onApplyFilter}
            size="sm"
            className="h-8"
            disabled={filterMode === 'perPattern' ? Object.keys(discoveredPatterns).length === 0 : allBranches.length === 0}
          >
            Apply
          </Button>
        </div>

        {/* Row 3: Per-pattern info (only shown in perPattern mode) */}
        {filterMode === 'perPattern' && (
          <div className="space-y-2">
            {/* Pattern discovery summary */}
            <div className="p-2 bg-accent/10 rounded border border-accent/30">
              <div className="text-sm font-medium">
                {Object.keys(discoveredPatterns).length} Unique Patterns Found
              </div>
              <div className="text-sm text-muted-foreground mt-0.5">
                {allBranches.length} total branches across patterns
              </div>
            </div>

            {/* Pattern list (shows what patterns exist) */}
            {Object.keys(discoveredPatterns).length > 0 && (
              <div className="max-h-32 overflow-y-auto hide-horizontal-scrollbar space-y-1 p-2 bg-background rounded border border-border">
                <div className="text-sm font-medium mb-1 sticky top-0 bg-background">Discovered Patterns:</div>
                {Object.entries(discoveredPatterns).map(([sig, info]: [string, any]) => (
                  <div key={sig} className="px-2 py-1 hover:bg-accent/10 rounded">
                    <div className="font-mono text-sm truncate">
                      {info.displayInfo?.conditions.join(', ') || sig.substring(0, 30)}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {info.count} branches • {info.displayInfo?.positions.join(', ') || 'N/A'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Available Branches List */}
      <div className="text-sm font-medium mb-2">
        Available Branches ({allBranches.length})
      </div>
      <div className="space-y-2">
        {allBranches.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            Load shards to see branches
          </div>
        ) : (
          allBranches.map((branch, idx) => {
            // Rolling branches have jobId added at load time (augmented type)
            const jobId = loadedJobType === 'chronological'
              ? (branch as OptimizationResult).jobId
              : (branch as any).jobId as number
            const branchId = loadedJobType === 'chronological'
              ? (branch as OptimizationResult).branchId
              : (branch as RollingOptimizationResult['branches'][number]).branchId
            const uniqueKey = `${jobId}-${branchId}-${idx}`
            const displayInfo = getBranchDisplay(branch)
            const metricValue = getMetricValue(branch)

            return (
              <div key={uniqueKey} className="p-3 bg-background rounded border border-border">
                {displayInfo ? (
                  <>
                    {/* Conditions */}
                    {displayInfo.conditions.length > 0 && (
                      <div className="space-y-0.5">
                        {displayInfo.conditions.map((cond, i) => (
                          <div key={i} className="text-foreground font-mono text-sm">
                            {cond}
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Positions */}
                    {displayInfo.positions.length > 0 && (
                      <div className="mt-1 text-muted-foreground text-sm">
                        Positions: {displayInfo.positions.join(', ')}
                      </div>
                    )}
                    {/* Weighting */}
                    <div className="text-muted-foreground text-sm">
                      Weight: {displayInfo.weighting}
                    </div>
                  </>
                ) : (
                  <div className="text-muted-foreground text-sm">No tree data</div>
                )}
                {/* Metric */}
                <div className="mt-1 pt-1 border-t border-border/50 text-muted-foreground text-sm">
                  {filterMetric}: {formatMetricValue(metricValue)}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
