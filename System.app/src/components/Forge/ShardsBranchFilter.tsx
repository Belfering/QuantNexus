// Shards Branch Filter - Middle card for filtering branches by metric
// Shows all available branches with full parameter details extracted from tree

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import type { OptimizationResult } from '@/types/optimizationJob'
import type { RollingOptimizationResult } from '@/types/bot'
import type { FlowNode, ConditionLine } from '@/types/flowNode'

// Comparator display mapping
const COMPARATOR_SYMBOLS: Record<string, string> = {
  lt: '<',
  gt: '>',
  crossAbove: '↗',
  crossBelow: '↘'
}

// Short indicator names for compact display
const SHORT_INDICATOR_NAMES: Record<string, string> = {
  'Relative Strength Index': 'RSI',
  'Simple Moving Average': 'SMA',
  'Exponential Moving Average': 'EMA',
  'Weighted Moving Average': 'WMA',
  'Hull Moving Average': 'Hull',
  'MACD Histogram': 'MACD-H',
  'MACD Line': 'MACD',
  'MACD Signal': 'MACD-S',
  'Bollinger Upper': 'BB-U',
  'Bollinger Mid': 'BB-M',
  'Bollinger Lower': 'BB-L',
  'Average True Range': 'ATR',
  'Average Directional Index': 'ADX',
  'Current Price': 'Price',
  'Stochastic %K': 'Stoch-K',
  'Stochastic %D': 'Stoch-D',
}

interface LoadedJobData {
  metadata: any
  branches: any[]
}

interface ShardsBranchFilterProps {
  loadedJobType: 'chronological' | 'rolling' | null
  allBranches: OptimizationResult[] | RollingOptimizationResult['branches']
  filterMetric: 'sharpe' | 'cagr' | 'tim' | 'timar' | 'calmar'
  filterTopX: number
  filterMode: 'overall' | 'perPattern'
  filterTopXPerPattern: number
  discoveredPatterns: Record<string, any>
  onFilterMetricChange: (metric: 'sharpe' | 'cagr' | 'tim' | 'timar' | 'calmar') => void
  onFilterTopXChange: (count: number) => void
  onFilterModeChange: (mode: 'overall' | 'perPattern') => void
  onFilterTopXPerPatternChange: (count: number) => void
  onApplyFilter: () => void
}

// Extract meaningful display info from tree
interface BranchDisplayInfo {
  conditions: string[]  // e.g., "RSI(14) < 70"
  positions: string[]   // e.g., "SPY", "QQQ"
  weighting: string     // e.g., "equal"
}

function extractBranchDisplayInfo(treeJson: string | undefined): BranchDisplayInfo | null {
  if (!treeJson) return null

  try {
    const tree: FlowNode = JSON.parse(treeJson)
    const info: BranchDisplayInfo = {
      conditions: [],
      positions: [],
      weighting: tree.weighting || 'equal'
    }

    // Recursively extract info from tree
    function traverse(node: FlowNode, context?: 'then' | 'else') {
      if (node.kind === 'indicator' && node.conditions) {
        for (const cond of node.conditions) {
          const c = cond as ConditionLine
          const indicator = SHORT_INDICATOR_NAMES[c.metric] || c.metric
          const comp = COMPARATOR_SYMBOLS[c.comparator] || c.comparator
          const ticker = c.ticker || ''
          const condStr = `${indicator}(${c.window}) ${ticker} ${comp} ${c.threshold}`
          if (context) {
            info.conditions.push(`[${context}] ${condStr}`)
          } else {
            info.conditions.push(condStr)
          }
        }
      }

      if (node.kind === 'position' && node.positions) {
        for (const pos of node.positions) {
          if (pos && pos !== 'Empty' && !info.positions.includes(pos)) {
            info.positions.push(pos)
          }
        }
      }

      // Traverse children
      if (node.children) {
        for (const [slot, children] of Object.entries(node.children)) {
          if (Array.isArray(children)) {
            for (const child of children) {
              if (child) {
                const childContext = slot === 'then' ? 'then' : slot === 'else' ? 'else' : undefined
                traverse(child, childContext)
              }
            }
          }
        }
      }
    }

    traverse(tree)
    return info
  } catch {
    return null
  }
}

export function ShardsBranchFilter({
  loadedJobType,
  allBranches,
  filterMetric,
  filterTopX,
  filterMode,
  filterTopXPerPattern,
  discoveredPatterns,
  onFilterMetricChange,
  onFilterTopXChange,
  onFilterModeChange,
  onFilterTopXPerPatternChange,
  onApplyFilter
}: ShardsBranchFilterProps) {
  // Local state for the input to allow clearing while typing
  const [topXInput, setTopXInput] = useState(String(filterTopX))

  // Sync local state when prop changes (e.g., from store reset)
  useEffect(() => {
    setTopXInput(filterTopX === 0 ? '' : String(filterTopX))
  }, [filterTopX])

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
    <div className="p-4 bg-muted/30 rounded-lg flex flex-col h-full">
      <div className="text-sm font-medium mb-3">Filter Settings</div>

      {/* Filter Controls */}
      <div className="space-y-3 mb-3">
        {/* Row 1: Metric selector */}
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Metric</label>
          <select
            value={filterMetric}
            onChange={(e) => onFilterMetricChange(e.target.value as any)}
            className="w-full px-2 py-1 rounded border border-border bg-background text-sm"
            disabled={allBranches.length === 0}
          >
            <option value="sharpe">Sharpe</option>
            <option value="cagr">CAGR</option>
            <option value="tim">TIM</option>
            <option value="timar">TIMAR</option>
            <option value="calmar">Calmar</option>
          </select>
        </div>

        {/* Row 2: Mode toggle */}
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Filter Mode</label>
          <div className="flex items-center gap-2 p-2 bg-background rounded border border-border">
            <button
              onClick={() => onFilterModeChange('overall')}
              className={`flex-1 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                filterMode === 'overall'
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-transparent text-muted-foreground hover:bg-muted'
              }`}
            >
              Overall
            </button>
            <button
              onClick={() => onFilterModeChange('perPattern')}
              className={`flex-1 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                filterMode === 'perPattern'
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-transparent text-muted-foreground hover:bg-muted'
              }`}
            >
              Per Pattern
            </button>
          </div>
        </div>

        {/* Row 3a: Overall mode - single Top X input */}
        {filterMode === 'overall' && (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground block mb-1">Top X</label>
              <input
                type="number"
                min={0}
                value={filterTopX}
                onChange={(e) => onFilterTopXChange(parseInt(e.target.value, 10) || 0)}
                className="w-full px-2 py-1 rounded border border-border bg-background text-sm"
                disabled={allBranches.length === 0}
              />
            </div>
            <Button
              onClick={onApplyFilter}
              size="sm"
              disabled={allBranches.length === 0}
            >
              Apply
            </Button>
          </div>
        )}

        {/* Row 3b: Per-pattern mode - Top X per pattern + pattern discovery */}
        {filterMode === 'perPattern' && (
          <div className="space-y-2">
            {/* Pattern discovery summary */}
            <div className="p-2 bg-accent/20 rounded border border-accent/30">
              <div className="text-xs font-medium">
                {Object.keys(discoveredPatterns).length} Unique Patterns Found
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {allBranches.length} total branches across patterns
              </div>
            </div>

            {/* Top X per pattern input */}
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground block mb-1">
                  Top X from Each Pattern
                </label>
                <input
                  type="number"
                  min={1}
                  value={filterTopXPerPattern}
                  onChange={(e) => onFilterTopXPerPatternChange(parseInt(e.target.value, 10) || 1)}
                  className="w-full px-2 py-1 rounded border border-border bg-background text-sm"
                  disabled={Object.keys(discoveredPatterns).length === 0}
                />
              </div>
              <Button
                onClick={onApplyFilter}
                size="sm"
                disabled={Object.keys(discoveredPatterns).length === 0}
              >
                Apply
              </Button>
            </div>

            {/* Pattern list (shows what patterns exist) */}
            {Object.keys(discoveredPatterns).length > 0 && (
              <div className="max-h-48 overflow-y-auto space-y-1 p-2 bg-background rounded border border-border">
                <div className="text-xs font-medium mb-1">Discovered Patterns:</div>
                {Object.entries(discoveredPatterns).map(([sig, info]: [string, any]) => (
                  <div key={sig} className="text-xs text-muted-foreground px-2 py-1 hover:bg-accent/10 rounded">
                    <div className="font-mono text-[11px] truncate">
                      {info.displayInfo?.conditions.join(', ') || sig.substring(0, 30)}
                    </div>
                    <div className="text-[10px]">
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
      <div className="text-xs font-medium mb-2">
        Available Branches ({allBranches.length})
      </div>
      <div className="flex-1 overflow-y-auto space-y-2">
        {allBranches.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-8">
            Load jobs to see branches
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
              <div key={uniqueKey} className="p-2 bg-background rounded text-xs border border-border">
                {displayInfo ? (
                  <>
                    {/* Conditions */}
                    {displayInfo.conditions.length > 0 && (
                      <div className="space-y-0.5">
                        {displayInfo.conditions.map((cond, i) => (
                          <div key={i} className="text-foreground font-mono text-[11px]">
                            {cond}
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Positions */}
                    {displayInfo.positions.length > 0 && (
                      <div className="mt-1 text-muted-foreground text-[11px]">
                        Positions: {displayInfo.positions.join(', ')}
                      </div>
                    )}
                    {/* Weighting */}
                    <div className="text-muted-foreground text-[11px]">
                      Weight: {displayInfo.weighting}
                    </div>
                  </>
                ) : (
                  <div className="text-muted-foreground text-[11px]">No tree data</div>
                )}
                {/* Metric */}
                <div className="mt-1 pt-1 border-t border-border/50 text-muted-foreground">
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
