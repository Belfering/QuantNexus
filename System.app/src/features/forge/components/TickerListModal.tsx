// Ticker List Modal - create and edit custom ticker lists

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { TickerList, TickerListCreateInput, CSVImportResult } from '@/types/tickerList'

interface TickerListModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: () => void
  editingList?: TickerList
  mode: 'create' | 'edit' | 'import'
}

export function TickerListModal({ isOpen, onClose, onSave, editingList, mode }: TickerListModalProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [tickers, setTickers] = useState<string[]>([])
  const [tickerInput, setTickerInput] = useState('')
  const [metadata, setMetadata] = useState<Record<string, any>>({})
  const [saving, setSaving] = useState(false)
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)

  // Reset form when modal opens/closes or editing list changes
  useEffect(() => {
    if (isOpen) {
      if (mode === 'edit' && editingList) {
        setName(editingList.name)
        setDescription(editingList.description || '')
        setTags(editingList.tags)
        setTickers(editingList.tickers)
        setMetadata(editingList.metadata)
      } else {
        setName('')
        setDescription('')
        setTags([])
        setTickers([])
        setMetadata({})
        setCsvFile(null)
      }
    }
  }, [isOpen, mode, editingList])

  const handleAddTag = () => {
    const trimmed = tagInput.trim()
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed])
      setTagInput('')
    }
  }

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter(t => t !== tag))
  }

  const handleAddTicker = () => {
    const trimmed = tickerInput.trim().toUpperCase()
    if (trimmed && !tickers.includes(trimmed)) {
      setTickers([...tickers, trimmed])
      setTickerInput('')
    }
  }

  const handleRemoveTicker = (ticker: string) => {
    setTickers(tickers.filter(t => t !== ticker))
    const newMetadata = { ...metadata }
    delete newMetadata[ticker]
    setMetadata(newMetadata)
  }

  const handleImportCSV = async () => {
    if (!csvFile) return

    setImporting(true)
    try {
      const text = await csvFile.text()
      const response = await fetch('/api/ticker-lists/import-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: text })
      })

      if (!response.ok) {
        throw new Error('Failed to import CSV')
      }

      const result: CSVImportResult = await response.json()
      setTickers(result.tickers)
      setMetadata(result.metadata)
      if (result.tags.length > 0) {
        setTags([...new Set([...tags, ...result.tags])])
      }
    } catch (err) {
      console.error('Error importing CSV:', err)
      alert('Failed to import CSV')
    } finally {
      setImporting(false)
    }
  }

  const handleSave = async () => {
    if (!name.trim()) {
      alert('Please enter a name for the ticker list')
      return
    }

    if (tickers.length === 0) {
      alert('Please add at least one ticker')
      return
    }

    setSaving(true)
    try {
      const payload: TickerListCreateInput = {
        name: name.trim(),
        description: description.trim() || undefined,
        tags,
        tickers,
        metadata
      }

      let response: Response
      if (mode === 'edit' && editingList) {
        response = await fetch(`/api/ticker-lists/${editingList.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
      } else {
        response = await fetch('/api/ticker-lists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
      }

      if (!response.ok) {
        throw new Error('Failed to save ticker list')
      }

      onSave()
      onClose()
    } catch (err) {
      console.error('Error saving ticker list:', err)
      alert('Failed to save ticker list')
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <Card className="w-full max-w-2xl max-h-[90vh] flex flex-col p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">
            {mode === 'edit' ? 'Edit Ticker List' : mode === 'import' ? 'Import Ticker List' : 'Create Ticker List'}
          </h2>
          <Button size="sm" variant="ghost" onClick={onClose}>
            ✕
          </Button>
        </div>

        <div className="flex-1 overflow-auto space-y-4">
          {/* CSV Import Section (only in import mode) */}
          {mode === 'import' && (
            <div className="border border-border rounded p-4 space-y-3">
              <div>
                <label className="text-sm font-medium">CSV File</label>
                <p className="text-xs text-muted-foreground mb-2">
                  Expected format: Ticker,Name,Tags (semicolon-separated)
                </p>
                <input
                  type="file"
                  accept=".csv"
                  onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                  className="w-full text-sm"
                />
              </div>
              <Button
                size="sm"
                onClick={handleImportCSV}
                disabled={!csvFile || importing}
              >
                {importing ? 'Importing...' : 'Import CSV'}
              </Button>
              {tickers.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  Imported {tickers.length} tickers
                </p>
              )}
            </div>
          )}

          {/* Name */}
          <div>
            <label className="text-sm font-medium">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Top ETFs, Defensive Assets"
              className="w-full mt-1 px-3 py-2 border border-border rounded bg-card"
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-sm font-medium">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              rows={2}
              className="w-full mt-1 px-3 py-2 border border-border rounded bg-card resize-none"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="text-sm font-medium">Tags</label>
            <div className="flex gap-2 mt-1">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddTag()
                  }
                }}
                placeholder="Add tag and press Enter"
                className="flex-1 px-3 py-2 border border-border rounded bg-card"
              />
              <Button size="sm" onClick={handleAddTag}>
                Add
              </Button>
            </div>
            {tags.length > 0 && (
              <div className="flex gap-2 flex-wrap mt-2">
                {tags.map(tag => (
                  <span
                    key={tag}
                    className="px-2 py-1 rounded bg-muted text-sm flex items-center gap-1"
                  >
                    {tag}
                    <button
                      onClick={() => handleRemoveTag(tag)}
                      className="hover:text-destructive"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Tickers */}
          <div>
            <label className="text-sm font-medium">Tickers *</label>
            <div className="flex gap-2 mt-1">
              <input
                type="text"
                value={tickerInput}
                onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddTicker()
                  }
                }}
                placeholder="Add ticker and press Enter"
                className="flex-1 px-3 py-2 border border-border rounded bg-card font-mono"
              />
              <Button size="sm" onClick={handleAddTicker}>
                Add
              </Button>
            </div>
            {tickers.length > 0 && (
              <div className="mt-2 border border-border rounded max-h-48 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      <th className="text-left p-2 font-medium">Ticker</th>
                      <th className="text-left p-2 font-medium">Name</th>
                      <th className="text-right p-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {tickers.map(ticker => (
                      <tr key={ticker} className="border-t border-border">
                        <td className="p-2 font-mono font-medium">{ticker}</td>
                        <td className="p-2 text-muted-foreground">
                          {metadata[ticker]?.name || '-'}
                        </td>
                        <td className="p-2 text-right">
                          <button
                            onClick={() => handleRemoveTicker(ticker)}
                            className="text-xs hover:text-destructive"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              {tickers.length} {tickers.length === 1 ? 'ticker' : 'tickers'}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-border">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : mode === 'edit' ? 'Save Changes' : 'Create List'}
          </Button>
        </div>
      </Card>
    </div>
  )
}
