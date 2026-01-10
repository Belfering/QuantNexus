// Ticker Lists Panel - manage custom ticker lists for branch optimization

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { TickerList } from '@/types/tickerList'
import { TickerListModal } from './TickerListModal'

export function TickerListsPanel() {
  const [lists, setLists] = useState<TickerList[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedListId, setSelectedListId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<'create' | 'edit' | 'import'>('create')
  const [editingList, setEditingList] = useState<TickerList | undefined>()

  const selectedList = lists.find(l => l.id === selectedListId)

  // Fetch ticker lists from API
  const fetchLists = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/ticker-lists')
      if (!response.ok) {
        throw new Error('Failed to fetch ticker lists')
      }
      const data = await response.json()
      setLists(data)
    } catch (err) {
      console.error('Error fetching ticker lists:', err)
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLists()
  }, [])

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this ticker list?')) return

    setIsDeleting(true)
    try {
      const response = await fetch(`/api/ticker-lists/${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to delete ticker list')
      }

      // Clear selection if deleted list was selected
      if (selectedListId === id) {
        setSelectedListId(null)
      }

      // Refresh lists
      await fetchLists()
    } catch (err) {
      console.error('Error deleting ticker list:', err)
      alert('Failed to delete ticker list')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleExport = async (id: string) => {
    try {
      const response = await fetch(`/api/ticker-lists/${id}/export-csv`, {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error('Failed to export ticker list')
      }

      // Create blob and download
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${lists.find(l => l.id === id)?.name || 'ticker-list'}.csv`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (err) {
      console.error('Error exporting ticker list:', err)
      alert('Failed to export ticker list')
    }
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString()
  }

  const handleOpenCreate = () => {
    setModalMode('create')
    setEditingList(undefined)
    setModalOpen(true)
  }

  const handleOpenEdit = () => {
    if (!selectedList) return
    setModalMode('edit')
    setEditingList(selectedList)
    setModalOpen(true)
  }

  const handleOpenImport = () => {
    setModalMode('import')
    setEditingList(undefined)
    setModalOpen(true)
  }

  const handleModalSave = () => {
    fetchLists()
  }

  if (loading) {
    return (
      <Card className="p-6">
        <div className="text-center text-muted-foreground">Loading ticker lists...</div>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="p-6">
        <div className="text-center text-destructive">Error: {error}</div>
        <div className="text-center mt-4">
          <Button onClick={fetchLists}>Retry</Button>
        </div>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Ticker Lists</h2>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={fetchLists}>
            Refresh
          </Button>
          <Button size="sm" onClick={handleOpenCreate}>
            Create New List
          </Button>
          <Button size="sm" variant="outline" onClick={handleOpenImport}>
            Import CSV
          </Button>
        </div>
      </div>

      {lists.length === 0 ? (
        <Card className="p-8">
          <div className="text-center text-muted-foreground">
            <p className="mb-4">No ticker lists yet</p>
            <p className="text-sm">Create a new list or import from CSV to get started</p>
          </div>
        </Card>
      ) : (
        <div className="flex gap-4 flex-1 min-h-0">
          {/* Left side: List of ticker lists */}
          <Card className="w-80 p-4 flex flex-col">
            <div className="text-sm font-medium mb-2 text-muted-foreground">
              {lists.length} {lists.length === 1 ? 'List' : 'Lists'}
            </div>
            <div className="flex-1 overflow-auto space-y-2">
              {lists.map(list => (
                <div
                  key={list.id}
                  className={`p-3 rounded border cursor-pointer transition-colors ${
                    selectedListId === list.id
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:bg-muted/50'
                  }`}
                  onClick={() => setSelectedListId(list.id)}
                >
                  <div className="font-medium truncate">{list.name}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {list.tickers.length} {list.tickers.length === 1 ? 'ticker' : 'tickers'}
                  </div>
                  {list.tags.length > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {list.tags.map(tag => (
                        <span
                          key={tag}
                          className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>

          {/* Right side: Selected list details */}
          {selectedList ? (
            <Card className="flex-1 p-4 flex flex-col">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold">{selectedList.name}</h3>
                  {selectedList.description && (
                    <p className="text-sm text-muted-foreground mt-1">{selectedList.description}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-2">
                    Created: {formatDate(selectedList.createdAt)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={handleOpenEdit}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleExport(selectedList.id)}
                  >
                    Export CSV
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleDelete(selectedList.id)}
                    disabled={isDeleting}
                  >
                    Delete
                  </Button>
                </div>
              </div>

              {/* Tags */}
              {selectedList.tags.length > 0 && (
                <div className="mb-4">
                  <div className="text-sm font-medium mb-2">Tags</div>
                  <div className="flex gap-2 flex-wrap">
                    {selectedList.tags.map(tag => (
                      <span
                        key={tag}
                        className="px-2 py-1 rounded bg-muted text-sm"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Tickers table */}
              <div className="flex-1 flex flex-col min-h-0">
                <div className="text-sm font-medium mb-2">
                  Tickers ({selectedList.tickers.length})
                </div>
                <div className="flex-1 overflow-auto border rounded">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted">
                      <tr>
                        <th className="text-left p-2 font-medium">Ticker</th>
                        <th className="text-left p-2 font-medium">Name</th>
                        <th className="text-left p-2 font-medium">Type</th>
                        <th className="text-left p-2 font-medium">Exchange</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedList.tickers.map(ticker => {
                        const meta = selectedList.metadata[ticker]
                        return (
                          <tr key={ticker} className="border-t border-border hover:bg-muted/50">
                            <td className="p-2 font-mono font-medium">{ticker}</td>
                            <td className="p-2">{meta?.name || '-'}</td>
                            <td className="p-2">{meta?.assetType || '-'}</td>
                            <td className="p-2">{meta?.exchange || '-'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </Card>
          ) : (
            <Card className="flex-1 p-8">
              <div className="text-center text-muted-foreground">
                Select a ticker list to view details
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Modal */}
      <TickerListModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleModalSave}
        editingList={editingList}
        mode={modalMode}
      />
    </div>
  )
}
