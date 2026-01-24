// src/shared/components/TickerSearchModal.tsx
// Ticker search modal with filtering, metadata display, ratio tickers, and branch references

import { useState, useEffect, useRef, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { POPULAR_TICKERS } from '@/constants'
import { Button } from '@/components/ui/button'
import type { TickerList } from '@/types/tickerList'

export interface TickerMetadata {
  name?: string
  assetType?: string
  exchange?: string
}

export type TickerModalMode = 'tickers' | 'ratios' | 'branches' | 'lists'
export type BlockKind = 'basic' | 'function' | 'indicator' | 'position' | 'numbered' | 'call' | 'altExit' | 'scaling'

// Common ratio tickers used in QuantMage strategies
const COMMON_RATIO_TICKERS = [
  'SPY/AGG', 'SPY/TLT', 'SPY/BIL', 'SPY/SHY',
  'JNK/TLT', 'JNK/XLP', 'JNK/LQD', 'JNK/IEI',
  'HYG/TLT', 'HYG/SHY', 'HYG/IEF',
  'VTI/BND', 'VTI/AGG',
  'QQQ/AGG', 'QQQ/QQQE', 'QQQ/XLU',
  'QQQE/AGG', 'RSP/AGG',
]

// Branch equity options for scaling/indicator nodes
const BRANCH_OPTIONS = [
  { value: 'branch:from', label: 'From Branch', description: 'Equity curve of the "From" child', nodeKinds: ['scaling'] },
  { value: 'branch:to', label: 'To Branch', description: 'Equity curve of the "To" child', nodeKinds: ['scaling'] },
  { value: 'branch:then', label: 'Then Branch', description: 'Equity curve of the "Then" child', nodeKinds: ['indicator'] },
  { value: 'branch:else', label: 'Else Branch', description: 'Equity curve of the "Else" child', nodeKinds: ['indicator'] },
  { value: 'branch:enter', label: 'Enter Branch', description: 'Equity curve of the "Enter" child', nodeKinds: ['altExit'] },
  { value: 'branch:exit', label: 'Exit Branch', description: 'Equity curve of the "Exit" child', nodeKinds: ['altExit'] },
  { value: 'branch:children', label: 'Children', description: 'Sort/rank children by their equity metrics', nodeKinds: ['function'] },
]

// Parse a ratio ticker like "SPY/AGG" into numerator/denominator
export const parseRatioTicker = (ticker: string): { numerator: string; denominator: string } | null => {
  const norm = ticker.toUpperCase().trim()
  const parts = norm.split('/')
  if (parts.length !== 2) return null
  const [numerator, denominator] = parts.map((p) => p.trim())
  if (!numerator || !denominator) return null
  return { numerator, denominator }
}

// Check if a ticker is a ratio ticker
export const isRatioTicker = (ticker: string): boolean => {
  return parseRatioTicker(ticker) !== null
}

export interface TickerSearchModalProps {
  open: boolean
  onClose: () => void
  onSelect: (ticker: string) => void
  tickerOptions: string[]
  tickerMetadata: Map<string, TickerMetadata>
  restrictToTickers?: string[]
  allowedModes?: TickerModalMode[]
  nodeKind?: BlockKind // Parent node type for contextual branch filtering
  initialValue?: string // Current ticker value to pre-populate (e.g., "JNK/XLP" for ratios)
  position?: 'center' | 'right' // Position modal center or right side
  tickerLists?: TickerList[] // Available ticker lists for Forge mode
}

export function TickerSearchModal({
  open,
  onClose,
  onSelect,
  tickerOptions,
  tickerMetadata,
  restrictToTickers,
  allowedModes = ['tickers'],
  nodeKind,
  initialValue,
  position = 'center',
  tickerLists = [],
}: TickerSearchModalProps) {
  const [search, setSearch] = useState('')
  const [includeETFs, setIncludeETFs] = useState(true)
  const [includeStocks, setIncludeStocks] = useState(true)
  const [mode, setMode] = useState<TickerModalMode>('tickers')
  const [ratioLeft, setRatioLeft] = useState('')
  const [ratioRight, setRatioRight] = useState('')
  const [ratioPickerTarget, setRatioPickerTarget] = useState<'left' | 'right' | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Determine base ticker list (restricted or full)
  const baseTickers = restrictToTickers || tickerOptions

  // Auto-focus on open and detect initial mode based on current value
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
      setSearch('')
      setRatioPickerTarget(null)

      // Check if initialValue is a ratio ticker (e.g., "JNK/XLP")
      const ratio = initialValue ? parseRatioTicker(initialValue) : null
      if (ratio && allowedModes.includes('ratios')) {
        setMode('ratios')
        setRatioLeft(ratio.numerator)
        setRatioRight(ratio.denominator)
      } else if (initialValue?.toUpperCase().startsWith('BRANCH:') && allowedModes.includes('branches')) {
        setMode('branches')
        setRatioLeft('')
        setRatioRight('')
      } else {
        setMode(allowedModes[0] || 'tickers')
        setRatioLeft('')
        setRatioRight('')
      }
    }
  }, [open, allowedModes, initialValue])

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

  // When positioned right, render as inline element (parent handles positioning)
  // When centered, use fixed full-screen overlay
  if (position === 'right') {
    return (
      <div
        className="relative bg-surface border border-border rounded-lg shadow-2xl w-[500px] h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with search */}
        <div className="p-4 border-b border-border">
          {mode === 'tickers' && (
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ticker or company name..."
              className="w-full px-3 py-2 border border-border rounded bg-card text-sm"
            />
          )}

          {mode === 'ratios' && !ratioPickerTarget && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setRatioPickerTarget('left')
                  setSearch('')
                  setTimeout(() => inputRef.current?.focus(), 50)
                }}
                className="flex-1 px-3 py-2 border border-border rounded bg-card text-sm font-mono text-center hover:bg-muted/50 cursor-pointer"
              >
                {ratioLeft || <span className="text-muted-foreground">SPY</span>}
              </button>
              <span className="text-xl font-bold text-muted-foreground">/</span>
              <button
                type="button"
                onClick={() => {
                  setRatioPickerTarget('right')
                  setSearch('')
                  setTimeout(() => inputRef.current?.focus(), 50)
                }}
                className="flex-1 px-3 py-2 border border-border rounded bg-card text-sm font-mono text-center hover:bg-muted/50 cursor-pointer"
              >
                {ratioRight || <span className="text-muted-foreground">AGG</span>}
              </button>
              <Button
                size="sm"
                disabled={!ratioLeft || !ratioRight}
                onClick={() => {
                  if (ratioLeft && ratioRight) {
                    onSelect(`${ratioLeft}/${ratioRight}`)
                    onClose()
                  }
                }}
              >
                Use
              </Button>
            </div>
          )}

          {/* Ratio picker sub-mode: show ticker search to pick left or right ticker */}
          {mode === 'ratios' && ratioPickerTarget && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRatioPickerTarget(null)}
                className="px-2 py-1 text-sm text-muted-foreground hover:text-foreground"
              >
                ← Back
              </button>
              <span className="text-sm text-muted-foreground">
                Select {ratioPickerTarget === 'left' ? 'numerator' : 'denominator'} ticker
              </span>
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search ticker..."
                className="flex-1 px-3 py-2 border border-border rounded bg-card text-sm"
              />
            </div>
          )}

          {mode === 'branches' && (
            <div className="text-sm text-muted-foreground">
              Select a branch equity curve to use as an indicator source
            </div>
          )}

          {/* Filter row - checkboxes + mode dropdown */}
          <div className="flex items-center gap-4 mt-3">
            {(mode === 'tickers' || (mode === 'ratios' && ratioPickerTarget)) && (
              <>
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
              </>
            )}
            {/* Mode dropdown - only show if multiple modes allowed and not in ratio picker sub-mode */}
            {allowedModes.length > 1 && !ratioPickerTarget && (
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as TickerModalMode)}
                className="ml-auto px-2 py-1 border border-border rounded bg-card text-sm"
              >
                {allowedModes.includes('tickers') && <option value="tickers">Tickers</option>}
                {allowedModes.includes('ratios') && <option value="ratios">Ratios</option>}
                {allowedModes.includes('branches') && <option value="branches">Branches</option>}
                {allowedModes.includes('lists') && <option value="lists">Lists</option>}
              </select>
            )}
          </div>
        </div>

        {/* Results list */}
        <div className="flex-1 overflow-y-auto">
          {/* Tickers mode */}
          {mode === 'tickers' && (
            <>
              {filteredResults.map(ticker => {
                const meta = tickerMetadata.get(ticker.toUpperCase())
                return (
                  <div
                    key={ticker}
                    className="px-4 py-2 hover:bg-muted/50 cursor-pointer flex items-center justify-between border-b border-border/50"
                    onClick={() => {
                      onSelect(ticker)
                      // Only close if centered position (normal use), keep open if right position (ticker list builder)
                      if (position === 'center') onClose()
                    }}
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
            </>
          )}

          {/* Ratios mode - common ratios list (only when not picking a ticker) */}
          {mode === 'ratios' && !ratioPickerTarget && (
            <>
              <div className="px-4 py-2 text-xs text-muted-foreground border-b border-border">
                Common ratios - click to use, or click ticker boxes above to search
              </div>
              {COMMON_RATIO_TICKERS.map(ratio => (
                <div
                  key={ratio}
                  className="px-4 py-2 hover:bg-muted/50 cursor-pointer flex items-center justify-between border-b border-border/50"
                  onClick={() => {
                    onSelect(ratio)
                    if (position === 'center') onClose()
                  }}
                >
                  <span className="font-mono font-bold">{ratio}</span>
                  <span className="text-xs text-muted-foreground">
                    {ratio.split('/').join(' vs ')}
                  </span>
                </div>
              ))}
            </>
          )}

          {/* Ratios mode - ticker picker (when selecting left or right ticker) */}
          {mode === 'ratios' && ratioPickerTarget && (
            <>
              {filteredResults.filter(t => t !== 'Empty').map(ticker => {
                const meta = tickerMetadata.get(ticker.toUpperCase())
                return (
                  <div
                    key={ticker}
                    className="px-4 py-2 hover:bg-muted/50 cursor-pointer flex items-center justify-between border-b border-border/50"
                    onClick={() => {
                      if (ratioPickerTarget === 'left') {
                        setRatioLeft(ticker)
                      } else {
                        setRatioRight(ticker)
                      }
                      setRatioPickerTarget(null)
                      setSearch('')
                    }}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="font-mono font-bold shrink-0 w-16">{ticker}</span>
                      <span className="text-muted-foreground text-sm truncate flex-1">
                        {meta?.name || <span className="italic text-muted-foreground/60">Metadata Unavailable</span>}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {meta?.exchange || ''}
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
              {filteredResults.filter(t => t !== 'Empty').length === 0 && (
                <div className="px-4 py-8 text-center text-muted-foreground">
                  No tickers found
                </div>
              )}
            </>
          )}

          {/* Branches mode */}
          {mode === 'branches' && (
            <>
              {BRANCH_OPTIONS
                .filter(opt => !nodeKind || opt.nodeKinds.includes(nodeKind))
                .map(opt => (
                  <div
                    key={opt.value}
                    className="px-4 py-2 hover:bg-muted/50 cursor-pointer flex items-center justify-between border-b border-border/50"
                    onClick={() => {
                      onSelect(opt.value)
                      if (position === 'center') onClose()
                    }}
                  >
                    <div className="flex flex-col">
                      <span className="font-mono font-bold">{opt.label}</span>
                      <span className="text-xs text-muted-foreground">{opt.description}</span>
                    </div>
                    <span className="text-xs text-muted-foreground font-mono">{opt.value}</span>
                  </div>
                ))}
              {BRANCH_OPTIONS.filter(opt => !nodeKind || opt.nodeKinds.includes(nodeKind)).length === 0 && (
                <div className="px-4 py-8 text-center text-muted-foreground">
                  No branch options available for this node type
                </div>
              )}
            </>
          )}

          {/* Lists mode */}
          {mode === 'lists' && (
            <>
              {/* Special option: Match Indicator (for position and condition nodes) */}
              {(nodeKind === 'position' || nodeKind === 'indicator' || nodeKind === 'numbered' || nodeKind === 'altExit') && (
                <div
                  className="px-4 py-2 hover:bg-muted/50 cursor-pointer flex items-center justify-between border-b border-border"
                  onClick={() => {
                    onSelect('mode:match_indicator')
                    if (position === 'center') onClose()
                  }}
                >
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="font-bold">
                      {nodeKind === 'position' ? 'Match Indicator Ticker' : 'Auto (Match Parent)'}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {nodeKind === 'position'
                        ? 'Auto-match tickers from conditions above'
                        : 'Match ticker from parent condition or list'}
                    </span>
                  </div>
                  <div className="shrink-0 ml-2">
                    <span className="px-1.5 py-0.5 rounded text-xs bg-purple-500/20 text-purple-400">
                      Auto
                    </span>
                  </div>
                </div>
              )}

              {tickerLists.map(list => (
                <div
                  key={list.id}
                  className="px-4 py-2 hover:bg-muted/50 cursor-pointer flex items-center justify-between border-b border-border/50"
                  onClick={() => {
                    onSelect(`list:${list.id}`)
                    if (position === 'center') onClose()
                  }}
                >
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="font-bold truncate">{list.name}</span>
                    {list.description && (
                      <span className="text-xs text-muted-foreground truncate">{list.description}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <span className="text-xs text-muted-foreground">{list.tickers.length} tickers</span>
                    {list.tags && list.tags.length > 0 && (
                      <span className="px-1.5 py-0.5 rounded text-xs bg-blue-500/20 text-blue-400">
                        {list.tags[0]}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {tickerLists.length === 0 && (
                <div className="px-4 py-8 text-center text-muted-foreground">
                  No ticker lists found. Create lists in the Ticker Lists tab.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  // Centered position - full screen overlay
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-surface border border-border rounded-lg shadow-2xl w-[500px] max-h-[70vh] flex flex-col">
        {/* Header with search */}
        <div className="p-4 border-b border-border">
          {mode === 'tickers' && (
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ticker or company name..."
              className="w-full px-3 py-2 border border-border rounded bg-card text-sm"
            />
          )}

          {mode === 'ratios' && !ratioPickerTarget && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setRatioPickerTarget('left')
                  setSearch('')
                }}
                className={cn(
                  'flex-1 px-3 py-2 border rounded text-sm font-mono transition-colors',
                  ratioLeft
                    ? 'border-border bg-card hover:bg-muted'
                    : 'border-dashed border-muted-foreground/50 bg-muted/30 hover:bg-muted',
                )}
              >
                {ratioLeft || 'Select'}
              </button>
              <span className="text-muted-foreground">/</span>
              <button
                type="button"
                onClick={() => {
                  setRatioPickerTarget('right')
                  setSearch('')
                }}
                className={cn(
                  'flex-1 px-3 py-2 border rounded text-sm font-mono transition-colors',
                  ratioRight
                    ? 'border-border bg-card hover:bg-muted'
                    : 'border-dashed border-muted-foreground/50 bg-muted/30 hover:bg-muted',
                )}
              >
                {ratioRight || 'Select'}
              </button>
            </div>
          )}

          {mode === 'ratios' && ratioPickerTarget && (
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${ratioPickerTarget} side ticker...`}
              className="w-full px-3 py-2 border border-border rounded bg-card text-sm"
            />
          )}

          {mode === 'branches' && (
            <div className="text-sm text-muted-foreground">
              Select a branch equity curve to compare
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="px-4 py-2 border-b border-border flex gap-4 text-sm items-center">
          {(mode === 'tickers' || (mode === 'ratios' && ratioPickerTarget)) && (
            <>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeETFs}
                  onChange={(e) => setIncludeETFs(e.target.checked)}
                  className="w-4 h-4"
                />
                <span>Include ETFs</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeStocks}
                  onChange={(e) => setIncludeStocks(e.target.checked)}
                  className="w-4 h-4"
                />
                <span>Include Stocks</span>
              </label>
            </>
          )}
          {/* Mode dropdown - only show if multiple modes allowed and not in ratio picker sub-mode */}
          {allowedModes.length > 1 && !ratioPickerTarget && (
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as TickerModalMode)}
              className="ml-auto px-2 py-1 border border-border rounded bg-card text-sm"
            >
              {allowedModes.includes('tickers') && <option value="tickers">Tickers</option>}
              {allowedModes.includes('ratios') && <option value="ratios">Ratios</option>}
              {allowedModes.includes('branches') && <option value="branches">Branches</option>}
              {allowedModes.includes('lists') && <option value="lists">Lists</option>}
            </select>
          )}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {mode === 'tickers' && (
            <>
              {filteredResults.map((ticker) => {
                const meta = tickerMetadata.get(ticker.toUpperCase())
                const assetType = meta?.assetType
                const assetColor =
                  assetType === 'ETF' ? 'bg-green-500/20 text-green-400' : 'bg-blue-500/20 text-blue-400'
                const assetLabel = assetType === 'ETF' ? 'ETF' : assetType === 'Stock' ? 'Stock' : ''

                return (
                  <div
                    key={ticker}
                    onClick={() => onSelect(ticker)}
                    className="px-4 py-3 hover:bg-muted cursor-pointer border-b border-border/50 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex flex-col min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold">{ticker}</span>
                          {assetLabel && (
                            <span className={cn('text-xs px-1.5 py-0.5 rounded', assetColor)}>{assetLabel}</span>
                          )}
                        </div>
                        <span className="text-sm text-muted-foreground truncate">
                          {meta?.name || 'No position'}
                        </span>
                      </div>
                      {meta?.exchange && (
                        <span className="text-xs text-muted-foreground shrink-0">
                          {meta.exchange === 'Exchange Unavailable' ? '' : meta.exchange}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
              {filteredResults.length === 0 && (
                <div className="px-4 py-8 text-center text-muted-foreground">No tickers found</div>
              )}
            </>
          )}

          {mode === 'ratios' && !ratioPickerTarget && (
            <>
              <div className="px-4 py-2 bg-muted/50 text-xs text-muted-foreground font-semibold">
                Common Ratio Tickers
              </div>
              {COMMON_RATIO_TICKERS.map((ratio) => (
                <div
                  key={ratio}
                  onClick={() => onSelect(ratio)}
                  className="px-4 py-3 hover:bg-muted cursor-pointer border-b border-border/50"
                >
                  <span className="font-mono font-bold">{ratio}</span>
                </div>
              ))}
            </>
          )}

          {mode === 'ratios' && ratioPickerTarget && (
            <>
              {filteredResults.map((ticker) => {
                const meta = tickerMetadata.get(ticker.toUpperCase())
                return (
                  <div
                    key={ticker}
                    onClick={() => {
                      if (ratioPickerTarget === 'left') {
                        setRatioLeft(ticker.toUpperCase())
                      } else {
                        setRatioRight(ticker.toUpperCase())
                      }
                      setRatioPickerTarget(null)
                      setSearch('')

                      // If both sides filled, auto-submit
                      const left = ratioPickerTarget === 'left' ? ticker.toUpperCase() : ratioLeft
                      const right = ratioPickerTarget === 'right' ? ticker.toUpperCase() : ratioRight
                      if (left && right) {
                        onSelect(`${left}/${right}`)
                      }
                    }}
                    className="px-4 py-3 hover:bg-muted cursor-pointer border-b border-border/50"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="font-mono font-bold">{ticker}</span>
                        <span className="text-sm text-muted-foreground truncate">{meta?.name || 'No position'}</span>
                      </div>
                      {meta?.exchange && (
                        <span className="text-xs text-muted-foreground shrink-0">{meta.exchange}</span>
                      )}
                    </div>
                  </div>
                )
              })}
              {filteredResults.length === 0 && (
                <div className="px-4 py-8 text-center text-muted-foreground">No tickers found</div>
              )}
            </>
          )}

          {mode === 'branches' && (
            <>
              {BRANCH_OPTIONS.filter(opt => !nodeKind || opt.nodeKinds.includes(nodeKind)).map((opt) => (
                <div
                  key={opt.value}
                  onClick={() => onSelect(opt.value)}
                  className="px-4 py-3 hover:bg-muted cursor-pointer border-b border-border/50 flex items-center justify-between gap-3"
                >
                  <div className="flex flex-col">
                    <span className="font-mono font-bold">{opt.label}</span>
                    <span className="text-xs text-muted-foreground">{opt.description}</span>
                  </div>
                  <span className="text-xs text-muted-foreground font-mono">{opt.value}</span>
                </div>
              ))}
              {BRANCH_OPTIONS.filter(opt => !nodeKind || opt.nodeKinds.includes(nodeKind)).length === 0 && (
                <div className="px-4 py-8 text-center text-muted-foreground">
                  No branch options available for this node type
                </div>
              )}
            </>
          )}

          {mode === 'lists' && (
            <>
              {/* Special option: Match Indicator (only for position nodes) */}
              {nodeKind === 'position' && (
                <div
                  onClick={() => onSelect('mode:match_indicator')}
                  className="px-4 py-3 hover:bg-muted cursor-pointer border-b border-border"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="font-bold">Match Indicator Ticker</span>
                      <span className="text-sm text-muted-foreground">
                        Auto-match tickers from conditions above
                      </span>
                    </div>
                    <div className="shrink-0">
                      <span className="px-1.5 py-0.5 rounded text-xs bg-purple-500/20 text-purple-400">
                        Auto
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {tickerLists.map(list => (
                <div
                  key={list.id}
                  onClick={() => onSelect(`list:${list.id}`)}
                  className="px-4 py-3 hover:bg-muted cursor-pointer border-b border-border/50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="font-bold truncate">{list.name}</span>
                      {list.description && (
                        <span className="text-sm text-muted-foreground truncate">{list.description}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground">{list.tickers.length} tickers</span>
                      {list.tags && list.tags.length > 0 && (
                        <span className="px-1.5 py-0.5 rounded text-xs bg-blue-500/20 text-blue-400">
                          {list.tags[0]}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {tickerLists.length === 0 && (
                <div className="px-4 py-8 text-center text-muted-foreground">
                  No ticker lists found. Create lists in the Ticker Lists tab.
                </div>
              )}
            </>
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
