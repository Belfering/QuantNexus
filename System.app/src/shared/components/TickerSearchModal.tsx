// src/shared/components/TickerSearchModal.tsx
// Ticker search modal with filtering and metadata display

import { useState, useEffect, useRef, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { POPULAR_TICKERS } from '@/constants'

export interface TickerMetadata {
  name?: string
  assetType?: string
  exchange?: string
}

export interface TickerSearchModalProps {
  open: boolean
  onClose: () => void
  onSelect: (ticker: string) => void
  tickerOptions: string[]
  tickerMetadata: Map<string, TickerMetadata>
  restrictToTickers?: string[]
}

export function TickerSearchModal({
  open,
  onClose,
  onSelect,
  tickerOptions,
  tickerMetadata,
  restrictToTickers,
}: TickerSearchModalProps) {
  const [search, setSearch] = useState('')
  const [includeETFs, setIncludeETFs] = useState(true)
  const [includeStocks, setIncludeStocks] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)

  // Determine base ticker list (restricted or full)
  const baseTickers = restrictToTickers || tickerOptions

  // Auto-focus on open and reset search
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
      setSearch('')
    }
  }, [open])

  // Close on ESC
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (open) {
      document.addEventListener('keydown', handleEsc)
      return () => document.removeEventListener('keydown', handleEsc)
    }
  }, [open, onClose])

  // Filter results
  const filteredResults = useMemo(() => {
    const query = search.toLowerCase().trim()
    const hasEmpty = baseTickers.includes('Empty')

    // If no search query, show Empty first, then popular tickers (filtered to available)
    if (!query) {
      const popular = POPULAR_TICKERS.filter(t => t !== 'Empty' && baseTickers.includes(t))
      const remaining = baseTickers.filter(t => t !== 'Empty' && !POPULAR_TICKERS.includes(t))
      const filtered = [...popular, ...remaining]
        .filter(ticker => {
          const meta = tickerMetadata.get(ticker.toUpperCase())
          const assetType = meta?.assetType
          if (assetType === 'ETF' && !includeETFs) return false
          if (assetType === 'Stock' && !includeStocks) return false
          return true
        })
        .slice(0, 49) // Leave room for Empty
      return hasEmpty ? ['Empty', ...filtered] : filtered
    }

    // With search query
    const filtered = baseTickers
      .filter(ticker => {
        if (ticker === 'Empty') return 'empty'.includes(query)
        const meta = tickerMetadata.get(ticker.toUpperCase())
        const assetType = meta?.assetType

        // Asset type filter
        if (assetType === 'ETF' && !includeETFs) return false
        if (assetType === 'Stock' && !includeStocks) return false

        // Search filter - also search exchange
        const tickerMatch = ticker.toLowerCase().includes(query)
        const nameMatch = meta?.name?.toLowerCase().includes(query)
        const exchangeMatch = meta?.exchange?.toLowerCase().includes(query)
        return tickerMatch || nameMatch || exchangeMatch
      })
      .slice(0, 50)

    // If Empty matches and is in results, move it to front
    if (filtered.includes('Empty')) {
      return ['Empty', ...filtered.filter(t => t !== 'Empty')]
    }
    return filtered
  }, [search, baseTickers, tickerMetadata, includeETFs, includeStocks])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-surface border border-border rounded-lg shadow-2xl w-[500px] max-h-[70vh] flex flex-col">
        {/* Header with search */}
        <div className="p-4 border-b border-border">
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ticker or company name..."
            className="w-full px-3 py-2 border border-border rounded bg-card text-sm"
          />

          {/* Filter checkboxes */}
          <div className="flex gap-4 mt-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={includeETFs}
                onChange={(e) => setIncludeETFs(e.target.checked)}
              />
              Include ETFs
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={includeStocks}
                onChange={(e) => setIncludeStocks(e.target.checked)}
              />
              Include Stocks
            </label>
          </div>
        </div>

        {/* Results list */}
        <div className="flex-1 overflow-y-auto">
          {filteredResults.map(ticker => {
            const meta = tickerMetadata.get(ticker.toUpperCase())
            return (
              <div
                key={ticker}
                className="px-4 py-2 hover:bg-muted/50 cursor-pointer flex items-center justify-between border-b border-border/50"
                onClick={() => { onSelect(ticker); onClose() }}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="font-mono font-bold shrink-0 w-16">{ticker}</span>
                  <span className="text-muted-foreground text-sm truncate flex-1">
                    {ticker === 'Empty'
                      ? 'No position'
                      : (meta?.name || <span className="italic text-muted-foreground/60">Metadata Unavailable</span>)}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {ticker === 'Empty'
                      ? ''
                      : (meta?.exchange || <span className="italic text-muted-foreground/60">Exchange Unavailable</span>)}
                  </span>
                </div>
                {meta?.assetType && (
                  <span className={cn(
                    'px-1.5 py-0.5 rounded text-xs shrink-0 ml-2',
                    meta.assetType === 'ETF' ? 'bg-blue-500/20 text-blue-400' : 'bg-green-500/20 text-green-400'
                  )}>
                    {meta.assetType}
                  </span>
                )}
              </div>
            )
          })}
          {filteredResults.length === 0 && (
            <div className="px-4 py-8 text-center text-muted-foreground">
              No tickers found
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export interface TickerDatalistProps {
  id: string
  options: string[]
}

export function TickerDatalist({ id, options }: TickerDatalistProps) {
  return (
    <datalist id={id}>
      {options.map((t) => (
        <option key={t} value={t} />
      ))}
    </datalist>
  )
}
