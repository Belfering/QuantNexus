// src/components/TrashModal.tsx
// Modal component for viewing and restoring deleted items

import { useState, useEffect } from 'react'
import { Modal, ModalFooter } from '@/shared/components/Modal'
import { Button } from '@/components/ui/button'
import { Trash2, RotateCcw, AlertTriangle } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import type { SavedBot } from '@/types/bot'

interface DeletedBot extends SavedBot {
  deletedAt: number
}

interface DeletedShard {
  id: string
  name: string
  description?: string
  sourceJobIds: number[]
  loadedJobType: 'chronological' | 'rolling'
  branchCount: number
  filterSummary?: string
  createdAt: number
  updatedAt: number
  deletedAt: number
}

interface TrashModalProps {
  open: boolean
  onClose: () => void
  userId: string | null
  context: 'model' | 'forge'
  onBotRestored?: () => void
  onShardRestored?: () => void
}

export function TrashModal({ open, onClose, userId, context, onBotRestored, onShardRestored }: TrashModalProps) {
  const [deletedBots, setDeletedBots] = useState<DeletedBot[]>([])
  const [deletedShards, setDeletedShards] = useState<DeletedShard[]>([])
  const [loading, setLoading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'bot' | 'shard', id: string } | null>(null)
  const [tab, setTab] = useState<'bots' | 'shards'>(context === 'model' ? 'bots' : 'shards')

  // Fetch deleted items when modal opens
  useEffect(() => {
    if (!open || !userId) return

    const fetchDeletedItems = async () => {
      setLoading(true)
      try {
        // Fetch deleted bots
        if (context === 'model' || tab === 'bots') {
          const botsRes = await fetch(`/api/bots/trash?userId=${userId}`)
          if (botsRes.ok) {
            const data = await botsRes.json()
            setDeletedBots(data.bots)
          }
        }

        // Fetch deleted shards (for Forge tab)
        if (context === 'forge' || tab === 'shards') {
          const shardsRes = await fetch(`/api/shards/trash?userId=${userId}`)
          if (shardsRes.ok) {
            const data = await shardsRes.json()
            setDeletedShards(data.shards)
          }
        }
      } catch (err) {
        console.error('Failed to fetch deleted items:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchDeletedItems()
  }, [open, userId, context, tab])

  const handleRestoreBot = async (botId: string) => {
    if (!userId) return

    try {
      const res = await fetch(`/api/bots/${botId}/restore?ownerId=${userId}`, {
        method: 'POST'
      })

      if (res.ok) {
        setDeletedBots(prev => prev.filter(b => b.id !== botId))
        if (onBotRestored) onBotRestored()
      } else {
        const error = await res.json()
        alert(`Failed to restore: ${error.error}`)
      }
    } catch (err) {
      console.error('Restore failed:', err)
      alert('Failed to restore bot')
    }
  }

  const handleRestoreShard = async (shardId: string) => {
    if (!userId) return

    try {
      const res = await fetch(`/api/shards/${shardId}/restore?ownerId=${userId}`, {
        method: 'POST'
      })

      if (res.ok) {
        setDeletedShards(prev => prev.filter(s => s.id !== shardId))
        if (onShardRestored) onShardRestored()
      } else {
        const error = await res.json()
        alert(`Failed to restore: ${error.error}`)
      }
    } catch (err) {
      console.error('Restore failed:', err)
      alert('Failed to restore shard')
    }
  }

  const handlePermanentDeleteBot = async (botId: string) => {
    if (!userId) return

    try {
      const res = await fetch(`/api/bots/${botId}/permanent?ownerId=${userId}`, {
        method: 'DELETE'
      })

      if (res.ok) {
        setDeletedBots(prev => prev.filter(b => b.id !== botId))
        setConfirmDelete(null)
      } else {
        const error = await res.json()
        alert(`Failed to delete: ${error.error}`)
      }
    } catch (err) {
      console.error('Delete failed:', err)
      alert('Failed to delete bot')
    }
  }

  const handlePermanentDeleteShard = async (shardId: string) => {
    if (!userId) return

    try {
      const res = await fetch(`/api/shards/${shardId}/permanent?ownerId=${userId}`, {
        method: 'DELETE'
      })

      if (res.ok) {
        setDeletedShards(prev => prev.filter(s => s.id !== shardId))
        setConfirmDelete(null)
      } else {
        const error = await res.json()
        alert(`Failed to delete: ${error.error}`)
      }
    } catch (err) {
      console.error('Delete failed:', err)
      alert('Failed to delete shard')
    }
  }

  const formatDeletedTime = (timestamp: number) => {
    try {
      return formatDistanceToNow(new Date(timestamp), { addSuffix: true })
    } catch {
      return 'Unknown'
    }
  }

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="Trash"
      size="xl"
    >
      <div className="space-y-4">
        {/* Tab selector for Forge context (bots + shards) */}
        {context === 'forge' && (
          <div className="flex gap-2 border-b border-border">
            <button
              onClick={() => setTab('bots')}
              className={`px-4 py-2 font-medium transition-colors ${
                tab === 'bots'
                  ? 'border-b-2 border-accent text-accent'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Deleted Systems ({deletedBots.length})
            </button>
            <button
              onClick={() => setTab('shards')}
              className={`px-4 py-2 font-medium transition-colors ${
                tab === 'shards'
                  ? 'border-b-2 border-accent text-accent'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Deleted Shards ({deletedShards.length})
            </button>
          </div>
        )}

        {/* Info banner */}
        <div className="bg-muted/50 border border-border rounded p-3 text-sm">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Items are permanently deleted after 90 days</div>
              <div className="text-muted-foreground text-xs mt-1">
                You can restore deleted items or permanently delete them manually.
              </div>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : (
          <>
            {/* Deleted Bots */}
            {(tab === 'bots' || context === 'model') && (
              <div className="space-y-2">
                <div className="text-sm font-medium">
                  Deleted Systems ({deletedBots.length})
                </div>
                {deletedBots.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No deleted systems
                  </div>
                ) : (
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {deletedBots.map((bot) => (
                      <div
                        key={bot.id}
                        className="flex items-center justify-between p-3 border border-border rounded hover:bg-muted/50"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{bot.name}</div>
                          {bot.description && (
                            <div className="text-sm text-muted-foreground truncate">
                              {bot.description}
                            </div>
                          )}
                          <div className="text-xs text-muted-foreground mt-1">
                            Deleted {formatDeletedTime(bot.deletedAt)}
                          </div>
                          {bot.tags && bot.tags.length > 0 && (
                            <div className="flex gap-1 mt-1">
                              {bot.tags.map(tag => (
                                <span
                                  key={tag}
                                  className="text-xs px-1.5 py-0.5 bg-muted rounded"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2 ml-4">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleRestoreBot(bot.id)}
                            className="flex items-center gap-1"
                          >
                            <RotateCcw className="h-3 w-3" />
                            Restore
                          </Button>
                          {confirmDelete?.type === 'bot' && confirmDelete?.id === bot.id ? (
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => handlePermanentDeleteBot(bot.id)}
                              >
                                Confirm
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setConfirmDelete(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setConfirmDelete({ type: 'bot', id: bot.id })}
                              className="flex items-center gap-1 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                            >
                              <Trash2 className="h-3 w-3" />
                              Delete
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Deleted Shards */}
            {tab === 'shards' && context === 'forge' && (
              <div className="space-y-2">
                <div className="text-sm font-medium">
                  Deleted Shards ({deletedShards.length})
                </div>
                {deletedShards.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No deleted shards
                  </div>
                ) : (
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {deletedShards.map((shard) => (
                      <div
                        key={shard.id}
                        className="flex items-center justify-between p-3 border border-border rounded hover:bg-muted/50"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{shard.name}</div>
                          {shard.description && (
                            <div className="text-sm text-muted-foreground truncate">
                              {shard.description}
                            </div>
                          )}
                          <div className="text-xs text-muted-foreground mt-1">
                            {shard.branchCount} branches • {shard.loadedJobType} • Deleted {formatDeletedTime(shard.deletedAt)}
                          </div>
                        </div>
                        <div className="flex gap-2 ml-4">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleRestoreShard(shard.id)}
                            className="flex items-center gap-1"
                          >
                            <RotateCcw className="h-3 w-3" />
                            Restore
                          </Button>
                          {confirmDelete?.type === 'shard' && confirmDelete?.id === shard.id ? (
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => handlePermanentDeleteShard(shard.id)}
                              >
                                Confirm
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setConfirmDelete(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setConfirmDelete({ type: 'shard', id: shard.id })}
                              className="flex items-center gap-1 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                            >
                              <Trash2 className="h-3 w-3" />
                              Delete
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </ModalFooter>
    </Modal>
  )
}
