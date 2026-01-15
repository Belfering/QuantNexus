// Shards Combined Preview - Right card showing filtered branches and tree generation

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { X, Undo2, ChevronDown, Trash2, Loader2 } from 'lucide-react'
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
  strategyBranches: OptimizationResult[] | RollingOptimizationResult['branches']
  activeListView: 'filter' | 'strategy'
  filterMetric: 'sharpe' | 'cagr' | 'tim' | 'timar' | 'calmar'
  filterGroups: FilterGroup[]
  selectedFilterGroupId: string | null
  canUndo: boolean
  onRemoveBranch: (jobId: number, branchId: string | number) => void
  onRemoveBranchFromStrategy: (jobId: number, branchId: string | number) => void
  onClearFiltered: () => void
  onClearStrategy: () => void
  onRemoveGroup: (groupId: string) => void
  onSelectFilterGroup: (groupId: string | null) => void
  onSetActiveListView: (view: 'filter' | 'strategy') => void
  onUndo: () => void
  onGenerate: () => void
  onSaveToModel: () => Promise<void>

  // Save shard functionality
  canSave: boolean
  isSavingShard: boolean
  onSaveShard: (name: string) => Promise<string>
}

export function ShardsCombinedPreview({
  loadedJobType,
  filteredBranches,
  strategyBranches,
  activeListView,
  filterMetric,
  filterGroups,
  selectedFilterGroupId,
  canUndo,
  onRemoveBranch,
  onRemoveBranchFromStrategy,
  onClearFiltered,
  onClearStrategy,
  onRemoveGroup,
  onSelectFilterGroup,
  onSetActiveListView,
  onUndo,
  onGenerate,
  onSaveToModel,
  canSave,
  isSavingShard,
  onSaveShard
}: ShardsCombinedPreviewProps) {
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [saveShardName, setSaveShardName] = useState('')
  const [shardSaveError, setShardSaveError] = useState<string | null>(null)

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

  // Handle save shard
  const handleSaveShard = async () => {
    if (!saveShardName.trim()) {
      setShardSaveError('Please enter a name')
      return
    }

    setShardSaveError(null)
    try {
      await onSaveShard(saveShardName.trim())
      setSaveShardName('')
    } catch (err) {
      setShardSaveError(err instanceof Error ? err.message : 'Failed to save')
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

  // Determine which list to display based on activeListView
  const activeBranches = activeListView === 'filter' ? filteredBranches : strategyBranches
  const activeCount = activeBranches.length

  // Filter branches based on selection (only for filter view)
  const displayedBranches = activeListView === 'filter' && selectedFilterGroupId !== null
    ? activeBranches.filter(b => {
        const key = getBranchKey(b)
        return selectedGroup?.branchKeys.includes(key)
      })
    : activeBranches

  return (
    <div className="p-4 bg-muted/30 rounded-lg flex flex-col h-full overflow-y-auto hide-horizontal-scrollbar">
      {/* Header with toggle buttons */}
      <div className="mb-2">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="text-base font-semibold">
            {activeListView === 'filter' ? 'Filter List' : 'Strategy List'} ({activeCount})
          </div>
        </div>

        {/* Toggle buttons */}
        <div className="flex items-center gap-1 p-1 bg-muted/50 rounded">
          <button
            onClick={() => onSetActiveListView('filter')}
            className={`flex-1 px-3 py-1.5 text-sm font-medium rounded transition-all ${
              activeListView === 'filter'
                ? 'bg-blue-600 dark:bg-blue-500 text-white shadow-sm'
                : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            Filter List
          </button>
          <button
            onClick={() => onSetActiveListView('strategy')}
            className={`flex-1 px-3 py-1.5 text-sm font-medium rounded transition-all ${
              activeListView === 'strategy'
                ? 'bg-blue-600 dark:bg-blue-500 text-white shadow-sm'
                : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            Strategy List
          </button>
        </div>
      </div>

      {/* Dropdown and Clear/Delete button row - only for filter view */}
      {activeListView === 'filter' && filterGroups.length > 0 && (
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
                      {group.mode === 'perPattern' && group.perPatternConfig
                        ? `${group.jobName} - Top ${group.perPatternConfig.topXPerPattern} per pattern (${group.perPatternConfig.patternCount} patterns, ${group.branchKeys.length} branches)`
                        : `${group.jobName} - Top ${group.topX} ${group.metric}`}
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
              className="h-8 px-2 text-sm text-red-500 hover:text-red-700 hover:bg-red-500/10 whitespace-nowrap"
            >
              Clear All
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onRemoveGroup(selectedFilterGroupId)}
              className="h-8 px-2 text-sm text-red-500 hover:text-red-700 hover:bg-red-500/10 whitespace-nowrap"
            >
              Delete
            </Button>
          )}
        </div>
      )}

      {/* Clear All button for strategy view */}
      {activeListView === 'strategy' && strategyBranches.length > 0 && (
        <div className="flex justify-end mb-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearStrategy}
            className="h-8 px-2 text-sm text-red-500 hover:text-red-700 hover:bg-red-500/10 whitespace-nowrap"
          >
            Clear All
          </Button>
        </div>
      )}

      {/* Save As Shard section - only for filter view when "All Runs" selected */}
      {activeListView === 'filter' && selectedFilterGroupId === null && filteredBranches.length > 0 && (
        <div className="mb-3 p-2 bg-background rounded border border-border">
          <div className="text-sm text-muted-foreground mb-1.5">Save as Shard ({filteredBranches.length} branches)</div>
          <div className="flex items-center gap-2">
            <Input
              value={saveShardName}
              onChange={(e) => setSaveShardName(e.target.value)}
              placeholder="Shard name..."
              className="flex-1 h-7 text-sm"
              disabled={!canSave || isSavingShard}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveShard()}
            />
            <Button
              onClick={handleSaveShard}
              size="sm"
              disabled={!canSave || isSavingShard || !saveShardName.trim()}
              className="h-7 px-3"
            >
              {isSavingShard ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                'Save'
              )}
            </Button>
          </div>
          {shardSaveError && (
            <div className="text-sm text-red-500 mt-1">{shardSaveError}</div>
          )}
        </div>
      )}

      {/* Showing X of Y indicator when filtered (filter view only) */}
      {activeListView === 'filter' && selectedFilterGroupId !== null && (
        <div className="text-sm text-muted-foreground mb-2">
          Showing {displayedBranches.length} of {filteredBranches.length} branches
        </div>
      )}

      {/* Branch List */}
      <div className="space-y-2 mb-3">
        {activeCount === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            {activeListView === 'filter' ? 'Apply filters to add branches here' : 'No branches in strategy yet'}
          </div>
        ) : displayedBranches.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">
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
              <div key={uniqueKey} className="p-3 bg-background rounded border border-border">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
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
                  <button
                    onClick={() => activeListView === 'filter' ? onRemoveBranch(jobId, branchId) : onRemoveBranchFromStrategy(jobId, branchId)}
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
