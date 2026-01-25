// Shards Library - 4th zone for creating strategy bots from loaded shards

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Trash2, Check, Loader2 } from 'lucide-react'
import type { WeightMode } from '@/types/flowNode'

// Weighting options matching FlowNode WeightMode (excluding 'defined' which requires manual weights)
const WEIGHTING_OPTIONS: { value: WeightMode; label: string }[] = [
  { value: 'equal', label: 'Equal Weight' },
  { value: 'inverse', label: 'Inverse Volatility' },
  { value: 'pro', label: 'Pro Volatility' },
]

interface ShardsLibraryProps {
  // Loaded strategy shards (from Card 1 "Add to Strategy")
  loadedStrategyJobs: Record<number, any>
  loadedStrategyJobIds: number[]
  isLoadingShards: boolean

  // Strategy generation
  shardBotName: string
  shardWeighting: string  // 'equal' | 'inverse' | 'pro' | 'capped'
  shardCappedPercent: number  // For capped weighting: 0-100

  // Validation
  strategyNodeCount: number
  strategyNodeLimitExceeded: boolean
  strategyNodeErrorMessage?: string

  // Actions
  onSetShardBotName: (name: string) => void
  onSetShardWeighting: (weighting: string) => void
  onSetShardCappedPercent: (percent: number) => void
  onGenerateBot: () => void
  onUnloadStrategyJob: (jobId: number) => void
}

export function ShardsLibrary({
  loadedStrategyJobs,
  loadedStrategyJobIds,
  isLoadingShards,
  shardBotName,
  shardWeighting,
  shardCappedPercent,
  strategyNodeCount,
  strategyNodeLimitExceeded,
  strategyNodeErrorMessage,
  onSetShardBotName,
  onSetShardWeighting,
  onSetShardCappedPercent,
  onGenerateBot,
  onUnloadStrategyJob
}: ShardsLibraryProps) {
  // Calculate total strategy branches (for Create Strategy section at top)
  const totalStrategyBranches = loadedStrategyJobIds.reduce((sum, jobId) => {
    const jobData = loadedStrategyJobs[jobId]
    return sum + (jobData?.branches?.length || 0)
  }, 0)

  // Calculate equal weight percentage based on strategy branch count
  const equalWeightPercent = totalStrategyBranches > 0
    ? (100 / totalStrategyBranches).toFixed(2)
    : '0'

  return (
    <div className="p-4 bg-muted/30 rounded-lg flex flex-col h-full overflow-y-auto hide-horizontal-scrollbar">
      {/* Create Strategy Section - Always visible at top */}
      <div className="mb-4">
        <div className="text-base font-semibold mb-2">Create Strategy</div>
        <div className="text-sm text-muted-foreground mb-2">
          Loaded: {loadedStrategyJobIds.length} shard{loadedStrategyJobIds.length !== 1 ? 's' : ''} ({totalStrategyBranches} branches{strategyNodeCount > 0 ? `, ${strategyNodeCount.toLocaleString()} nodes` : ''})
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Input
              value={shardBotName}
              onChange={(e) => onSetShardBotName(e.target.value)}
              placeholder="Strategy name..."
              className="h-8 text-sm flex-1"
            />
            <Button
              onClick={onGenerateBot}
              className="h-8 px-3 text-sm whitespace-nowrap"
              disabled={totalStrategyBranches === 0 || isLoadingShards || strategyNodeLimitExceeded}
            >
              {isLoadingShards ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Loading...
                </>
              ) : (
                'Create Strategy'
              )}
            </Button>
          </div>

          {strategyNodeLimitExceeded && strategyNodeErrorMessage && (
            <div className="text-xs text-red-500 p-2 bg-red-500/10 border border-red-500/30 rounded">
              {strategyNodeErrorMessage}
            </div>
          )}

          <select
            className="w-full px-2 py-1 rounded border border-border bg-background text-sm h-8"
            value={shardWeighting}
            onChange={(e) => onSetShardWeighting(e.target.value)}
          >
            {WEIGHTING_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          {/* Show equal weight percentage info */}
          {shardWeighting === 'equal' && totalStrategyBranches > 0 && (
            <div className="text-sm text-muted-foreground px-1">
              Each branch: {equalWeightPercent}% ({totalStrategyBranches} branches)
            </div>
          )}
        </div>
      </div>

      {/* Loaded Strategy Shards - Show jobs loaded from Card 1 "Add to Strategy" */}
      {loadedStrategyJobIds.length > 0 && (
        <div className="mb-4 border-t border-border pt-3">
          <div className="text-sm font-medium mb-2">
            Loaded Strategy Shards ({loadedStrategyJobIds.length})
          </div>
          <div className="space-y-2">
            {loadedStrategyJobIds.map(jobId => {
              const jobData = loadedStrategyJobs[jobId]
              if (!jobData) return null

              const jobName = jobData.metadata?.botName || jobData.metadata?.name || `Job #${jobId}`
              const branchCount = jobData.branches?.length || 0

              return (
                <div
                  key={jobId}
                  className="p-2 bg-green-500/10 border border-green-500/30 rounded"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0" />
                        <div className="text-sm font-medium truncate">{jobName}</div>
                      </div>
                      <div className="text-sm text-muted-foreground ml-6">
                        {branchCount} branches loaded
                      </div>
                    </div>
                    <button
                      onClick={() => onUnloadStrategyJob(jobId)}
                      className="p-1.5 rounded hover:bg-red-500/20 text-red-500 hover:text-red-700 transition-colors flex-shrink-0"
                      title="Unload strategy shard"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
