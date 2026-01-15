// Shards Library - 4th zone for saving, loading, and combining shards

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Trash2, Check, Loader2 } from 'lucide-react'
import type { ShardListItem } from '@/types/shard'
import type { WeightMode } from '@/types/flowNode'

// Weighting options matching FlowNode WeightMode (excluding 'defined' which requires manual weights)
const WEIGHTING_OPTIONS: { value: WeightMode; label: string }[] = [
  { value: 'equal', label: 'Equal Weight' },
  { value: 'inverse', label: 'Inverse Volatility' },
  { value: 'pro', label: 'Pro Volatility' },
  { value: 'capped', label: 'Capped' },
]

interface ShardsLibraryProps {
  // Saved shards
  savedShards: ShardListItem[]
  selectedShardIds: string[]
  loadedShardBranches: any[]
  isLoadingShards: boolean

  // Strategy generation
  shardBotName: string
  shardWeighting: string  // 'equal' | 'inverse' | 'pro' | 'capped'
  shardCappedPercent: number  // For capped weighting: 0-100

  // Actions
  onFetchShards: () => Promise<void>
  onDeleteShard: (shardId: string) => Promise<void>
  onSelectShard: (shardId: string) => void
  onDeselectShard: (shardId: string) => void
  onLoadSelectedShards: () => Promise<void>
  onSetShardBotName: (name: string) => void
  onSetShardWeighting: (weighting: string) => void
  onSetShardCappedPercent: (percent: number) => void
  onGenerateBot: () => void
}

export function ShardsLibrary({
  savedShards,
  selectedShardIds,
  loadedShardBranches,
  isLoadingShards,
  shardBotName,
  shardWeighting,
  shardCappedPercent,
  onFetchShards,
  onDeleteShard,
  onSelectShard,
  onDeselectShard,
  onLoadSelectedShards,
  onSetShardBotName,
  onSetShardWeighting,
  onSetShardCappedPercent,
  onGenerateBot
}: ShardsLibraryProps) {
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Fetch shards on mount
  useEffect(() => {
    onFetchShards()
  }, [onFetchShards])

  // Load branches when selection changes
  useEffect(() => {
    if (selectedShardIds.length > 0) {
      onLoadSelectedShards()
    }
  }, [selectedShardIds, onLoadSelectedShards])

  // Handle delete shard
  const handleDelete = async (shardId: string) => {
    setDeleteError(null)
    try {
      await onDeleteShard(shardId)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  // Toggle shard selection
  const toggleShard = (shardId: string) => {
    if (selectedShardIds.includes(shardId)) {
      onDeselectShard(shardId)
    } else {
      onSelectShard(shardId)
    }
  }

  // Format date
  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  // Calculate total selected branches
  const totalSelectedBranches = savedShards
    .filter(s => selectedShardIds.includes(s.id))
    .reduce((sum, s) => sum + s.branchCount, 0)

  // Calculate equal weight percentage based on branch count
  const equalWeightPercent = loadedShardBranches.length > 0
    ? (100 / loadedShardBranches.length).toFixed(2)
    : '0'

  return (
    <div className="p-4 bg-muted/30 rounded-lg flex flex-col h-full overflow-y-auto hide-horizontal-scrollbar">
      {/* Create Strategy Section - Always visible at top */}
      <div className="mb-4">
        <div className="text-base font-semibold mb-2">Create Strategy</div>
        <div className="text-sm text-muted-foreground mb-2">
          Selected: {selectedShardIds.length} shard{selectedShardIds.length !== 1 ? 's' : ''} ({loadedShardBranches.length} unique branches)
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
              disabled={loadedShardBranches.length === 0 || isLoadingShards}
            >
              {isLoadingShards ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Loading...
                </>
              ) : (
                'Create & Save to Model'
              )}
            </Button>
          </div>

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
          {shardWeighting === 'equal' && loadedShardBranches.length > 0 && (
            <div className="text-sm text-muted-foreground px-1">
              Each branch: {equalWeightPercent}% ({loadedShardBranches.length} branches)
            </div>
          )}

          {/* Capped percentage input - only show when Capped is selected */}
          {shardWeighting === 'capped' && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Cap %:</span>
              <Input
                type="number"
                min={0}
                max={100}
                step={1}
                value={shardCappedPercent}
                onChange={(e) => onSetShardCappedPercent(Number(e.target.value))}
                className="h-8 text-sm w-20"
              />
              <span className="text-sm text-muted-foreground">max per position</span>
            </div>
          )}
        </div>
      </div>

      {/* Saved Shards List - Below, scrollable */}
      <div className="border-t border-border pt-3">
        <div className="text-sm font-medium mb-2">
          Saved Shards ({savedShards.length})
        </div>
      </div>
      <div className="space-y-2">
        {isLoadingShards && savedShards.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Loading...
          </div>
        ) : savedShards.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            No saved shards yet
          </div>
        ) : (
          savedShards.map(shard => {
            const isSelected = selectedShardIds.includes(shard.id)
            return (
              <div
                key={shard.id}
                className={`p-2 bg-background rounded border transition-colors cursor-pointer ${
                  isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50'
                }`}
                onClick={() => toggleShard(shard.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                          isSelected
                            ? 'bg-primary border-primary'
                            : 'border-muted-foreground/40'
                        }`}
                      >
                        {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                      </div>
                      <div className="font-medium text-sm truncate">{shard.name}</div>
                      <div className="text-sm text-muted-foreground">({shard.branchCount})</div>
                    </div>
                    <div className="text-sm text-muted-foreground mt-1 ml-6">
                      {shard.filterSummary} • {formatDate(shard.createdAt)}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(shard.id)
                    }}
                    className="p-1 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-500 transition-colors flex-shrink-0"
                    title="Delete shard"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )
          })
        )}
        {deleteError && (
          <div className="text-sm text-red-500 text-center">{deleteError}</div>
        )}
      </div>
    </div>
  )
}
