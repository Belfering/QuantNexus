// Shards Combined Preview - Right card showing filtered branches and tree generation

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { X, Undo2, ChevronDown, Trash2 } from 'lucide-react'
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
  selectedFilterGroupId: string | null
  canUndo: boolean
  onRemoveBranch: (jobId: number, branchId: string | number) => void
  onClearFiltered: () => void
  onRemoveGroup: (groupId: string) => void
  onSelectFilterGroup: (groupId: string | null) => void
  onUndo: () => void
  onGenerate: () => void
  onSaveToModel: () => Promise<void>
}

export function ShardsCombinedPreview({
  loadedJobType,
  filteredBranches,
  filterMetric,
  filterGroups,
  selectedFilterGroupId,
  canUndo,
  onRemoveBranch,
  onClearFiltered,
  onRemoveGroup,
  onSelectFilterGroup,
  onUndo,
  onGenerate,
  onSaveToModel
}: ShardsCombinedPreviewProps) {
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)

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

  // Helper to get branch key
  const getBranchKey = (branch: any): string => {
    return `${branch.jobId}-${branch.branchId}`
  }

  // Get the currently selected group (if any)
  const selectedGroup = selectedFilterGroupId
    ? filterGroups.find(g => g.id === selectedFilterGroupId)
    : null

  // Get display label for dropdown
  const getDropdownLabel = (): string => {
    if (selectedGroup) {
      return `${selectedGroup.jobName} - Top ${selectedGroup.topX} ${selectedGroup.metric}`
    }
    return 'All Runs'
  }

  // Filter branches based on selection
  const displayedBranches = selectedFilterGroupId === null
    ? filteredBranches
    : filteredBranches.filter(b => {
        const key = getBranchKey(b)
        return selectedGroup?.branchKeys.includes(key)
      })

  return (
    <div className="p-4 bg-muted/30 rounded-lg flex flex-col h-full">
      {/* Header with count */}
      <div className="text-sm font-medium mb-2">
        Filtered Branches ({filteredBranches.length})
      </div>

      {/* Dropdown and Clear/Delete button row */}
      {filterGroups.length > 0 && (
        <div className="flex items-center gap-2 mb-2">
          {/* Dropdown */}
          <div className="relative flex-1">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="w-full flex items-center justify-between px-3 py-1.5 bg-background border border-border rounded text-sm hover:bg-accent/50 transition-colors"
            >
              <span className="truncate">{getDropdownLabel()}</span>
              <ChevronDown className={`h-4 w-4 ml-2 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown menu */}
            {dropdownOpen && (
              <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-background border border-border rounded shadow-lg max-h-64 overflow-y-auto">
                {/* All Runs option */}
                <button
                  onClick={() => {
                    onSelectFilterGroup(null)
                    setDropdownOpen(false)
                  }}
                  className={`w-full flex items-center px-3 py-2 text-sm hover:bg-accent/50 ${
                    selectedFilterGroupId === null ? 'bg-accent/30 font-medium' : ''
                  }`}
                >
                  All Runs
                </button>

                {/* Separator */}
                {filterGroups.length > 0 && <div className="border-t border-border" />}

                {/* Individual groups */}
                {filterGroups.map(group => (
                  <div
                    key={group.id}
                    className={`flex items-center justify-between px-3 py-2 hover:bg-accent/50 ${
                      selectedFilterGroupId === group.id ? 'bg-accent/30' : ''
                    }`}
                  >
                    <button
                      onClick={() => {
                        onSelectFilterGroup(group.id)
                        setDropdownOpen(false)
                      }}
                      className={`flex-1 text-left text-sm truncate ${
                        selectedFilterGroupId === group.id ? 'font-medium' : ''
                      }`}
                    >
                      {group.jobName} - Top {group.topX} {group.metric}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onRemoveGroup(group.id)
                      }}
                      className="p-1 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-500 ml-2"
                      title="Delete this filter group"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Clear All / Delete button */}
          {selectedFilterGroupId === null ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearFiltered}
              className="h-8 px-2 text-xs text-red-500 hover:text-red-700 hover:bg-red-500/10 whitespace-nowrap"
            >
              Clear All
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onRemoveGroup(selectedFilterGroupId)}
              className="h-8 px-2 text-xs text-red-500 hover:text-red-700 hover:bg-red-500/10 whitespace-nowrap"
            >
              Delete
            </Button>
          )}
        </div>
      )}

      {/* Showing X of Y indicator when filtered */}
      {selectedFilterGroupId !== null && (
        <div className="text-xs text-muted-foreground mb-2">
          Showing {displayedBranches.length} of {filteredBranches.length} branches
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
        ) : displayedBranches.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-8">
            No branches in this filter group
          </div>
        ) : (
          displayedBranches.map((branch, idx) => {
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
