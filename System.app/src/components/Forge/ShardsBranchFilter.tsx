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

interface ShardsBranchFilterProps {
  loadedJobType: 'chronological' | 'rolling' | null
  allBranches: OptimizationResult[] | RollingOptimizationResult['branches']
  filterMetric: 'sharpe' | 'cagr' | 'tim' | 'timar' | 'calmar'
  filterTopX: number
  onFilterMetricChange: (metric: 'sharpe' | 'cagr' | 'tim' | 'timar' | 'calmar') => void
  onFilterTopXChange: (count: number) => void
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
  onFilterMetricChange,
  onFilterTopXChange,
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

      {/* Filter Controls - Single Row */}
      <div className="flex items-end gap-2 mb-3">
        <div className="flex-1">
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

        <div className="w-16">
          <label className="text-xs text-muted-foreground block mb-1">Top</label>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={topXInput}
            onChange={(e) => {
              const val = e.target.value
              // Only allow digits
              if (val === '' || /^\d+$/.test(val)) {
                setTopXInput(val)
              }
            }}
            onBlur={() => {
              // On blur, commit to store (default to 1 if empty)
              const num = parseInt(topXInput, 10)
              if (isNaN(num) || num < 1) {
                setTopXInput('1')
                onFilterTopXChange(1)
              } else {
                onFilterTopXChange(num)
              }
            }}
            className="w-full px-2 py-1 rounded border border-border bg-background text-sm text-center"
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
            const jobId = loadedJobType === 'chronological'
              ? (branch as OptimizationResult).jobId
              : (branch as RollingOptimizationResult['branches'][number]).jobId
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
