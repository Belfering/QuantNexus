// Shards Combined Preview - Right card showing filtered branches and tree generation

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { X, Undo2 } from 'lucide-react'
import type { OptimizationResult } from '@/types/optimizationJob'
import type { RollingOptimizationResult } from '@/types/bot'
import type { FlowNode, ConditionLine } from '@/types/flowNode'
import type { FilterGroup } from '@/stores/useShardStore'

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

interface ShardsCombinedPreviewProps {
  loadedJobType: 'chronological' | 'rolling' | null
  filteredBranches: OptimizationResult[] | RollingOptimizationResult['branches']
  filterMetric: 'sharpe' | 'cagr' | 'tim' | 'timar' | 'calmar'
  filterGroups: FilterGroup[]
  canUndo: boolean
  onRemoveBranch: (jobId: number, branchId: string | number) => void
  onClearFiltered: () => void
  onRemoveGroup: (groupId: string) => void
  onUndo: () => void
  onGenerate: () => void
  onSaveToModel: () => Promise<void>
}

export function ShardsCombinedPreview({
  loadedJobType,
  filteredBranches,
  filterMetric,
  filterGroups,
  canUndo,
  onRemoveBranch,
  onClearFiltered,
  onRemoveGroup,
  onUndo,
  onGenerate,
  onSaveToModel
}: ShardsCombinedPreviewProps) {
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      await onSaveToModel()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  // Helper to get metric value for display
  // Detects branch type from data structure, not from loadedJobType (so it works after unloading)
  const getMetricValue = (branch: OptimizationResult | RollingOptimizationResult['branches'][number]): number | null => {
    const b = branch as any
    // Chronological branches have isMetrics object
    if (b.isMetrics && typeof b.isMetrics === 'object') {
      return b.isMetrics[filterMetric] ?? null
    }
    // Rolling branches have isOosMetrics object
    if (b.isOosMetrics && typeof b.isOosMetrics === 'object') {
      return b.isOosMetrics.IS ?? null
    }
    return null
  }

  // Helper to format metric value
  const formatMetricValue = (value: number | null): string => {
    if (value === null) return 'N/A'
    return value.toFixed(4)
  }

  // Get display info from branch
  // Detects branch type from data structure, not from loadedJobType (so it works after unloading)
  const getBranchDisplay = (branch: OptimizationResult | RollingOptimizationResult['branches'][number]): BranchDisplayInfo | null => {
    const b = branch as any
    // Chronological branches have treeJson
    if (b.treeJson) {
      return extractBranchDisplayInfo(b.treeJson)
    }
    // Rolling branches don't have treeJson - could add support later
    return null
  }

  return (
    <div className="p-4 bg-muted/30 rounded-lg flex flex-col h-full">
      {/* Header with count and clear button */}
      <div className="flex justify-between items-center mb-2">
        <div className="text-sm font-medium">
          Filtered Branches ({filteredBranches.length})
        </div>
        {filteredBranches.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearFiltered}
            className="h-6 px-2 text-xs text-red-500 hover:text-red-700 hover:bg-red-500/10"
          >
            Clear All
          </Button>
        )}
      </div>

      {/* Filter Group Tags */}
      {filterGroups.length > 0 && (
        <div className="mb-2">
          <div className="flex flex-wrap gap-1">
            {filterGroups.map(group => (
              <div
                key={group.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-accent/50 rounded text-[10px] text-foreground"
              >
                <span>Top {group.topX} {group.metric}</span>
                <button
                  onClick={() => onRemoveGroup(group.id)}
                  className="p-0.5 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-500"
                  title="Remove this filter group"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Undo Button */}
      {canUndo && (
        <div className="mb-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onUndo}
            className="h-6 px-2 text-xs"
          >
            <Undo2 className="h-3 w-3 mr-1" />
            Undo
          </Button>
        </div>
      )}

      {/* Filtered Branches List */}
      <div className="flex-1 overflow-y-auto space-y-2 mb-3">
        {filteredBranches.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-8">
            Apply filters to add branches here
          </div>
        ) : (
          filteredBranches.map((branch, idx) => {
            // All filtered branches are deep copies with jobId attached
            const b = branch as any
            const jobId = b.jobId as number
            const branchId = b.branchId as string | number
            const uniqueKey = `${jobId}-${branchId}-${idx}`

            const displayInfo = getBranchDisplay(branch)
            const metricValue = getMetricValue(branch)

            return (
              <div key={uniqueKey} className="p-2 bg-background rounded text-xs border border-border">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
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
                  <button
                    onClick={() => onRemoveBranch(jobId, branchId)}
                    className="p-1 rounded hover:bg-red-500/20 text-red-500 hover:text-red-700 transition-colors flex-shrink-0"
                    title="Remove branch"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
