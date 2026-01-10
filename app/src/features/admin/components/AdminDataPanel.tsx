// src/features/admin/components/AdminDataPanel.tsx
// Admin data panel for viewing ticker data

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import type { AdminCandlesResponse } from '@/types'
import type { AdminDataPanelProps, TickerSearchResult } from '../types'

/**
 * Admin panel for browsing and previewing ticker data
 */
export function AdminDataPanel({
  tickers,
  error,
}: AdminDataPanelProps) {
  const [selected, setSelected] = useState<string>(() => tickers[0] || '')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [searchResults, setSearchResults] = useState<TickerSearchResult[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [dataError, setDataError] = useState<string | null>(null)
  const [preview, setPreview] = useState<AdminCandlesResponse['preview']>([])

  // Search tickers by metadata
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setSearchResults([])
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/tickers/registry/search?q=${encodeURIComponent(searchQuery)}&limit=10`, {
          signal: controller.signal
        })
        if (res.ok) {
          const data = await res.json() as TickerSearchResult[]
          setSearchResults(data)
        }
      } catch {
        // Ignore abort errors
      }
    }, 200) // Debounce

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [searchQuery])

  const load = useCallback(
    async (ticker: string) => {
      if (!ticker) return
      setLoading(true)
      setDataError(null)
      try {
        const res = await fetch(`/api/candles/${encodeURIComponent(ticker)}?limit=50`)
        const payload = (await res.json()) as AdminCandlesResponse | { error: string }
        if (!res.ok) throw new Error('error' in payload ? payload.error : `Request failed (${res.status})`)
        const p = payload as AdminCandlesResponse
        setPreview(p.preview || [])
      } catch (e) {
        setPreview([])
        setDataError(String((e as Error)?.message || e))
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    if (!selected && tickers[0]) setSelected(tickers[0])
  }, [selected, tickers])

  useEffect(() => {
    if (!selected) return
    void load(selected)
  }, [selected, load])

  const selectTicker = (ticker: string) => {
    setSelected(ticker)
    setSearchQuery('')
    setSearchResults([])
    setSearchOpen(false)
  }

  const combinedError = error || dataError

  return (
    <div>
      <div className="flex gap-2.5 items-center flex-wrap">
        <div className="font-extrabold">Search</div>
        <div className="relative">
          <Input
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              setSearchOpen(true)
            }}
            onFocus={() => setSearchOpen(true)}
            placeholder="Search by ticker, name, or description..."
            className="w-72"
          />
          {searchOpen && searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-lg z-50 max-h-60 overflow-auto">
              {searchResults.map((r) => (
                <button
                  key={r.ticker}
                  className="w-full px-3 py-2 text-left hover:bg-muted border-b border-border last:border-b-0"
                  onClick={() => selectTicker(r.ticker)}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-bold">{r.ticker}</span>
                    {r.assetType && (
                      <span className="text-xs px-1 py-0.5 bg-primary/10 text-primary rounded">
                        {r.assetType}
                      </span>
                    )}
                  </div>
                  {r.name && <div className="text-sm text-muted-foreground truncate">{r.name}</div>}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="font-extrabold">Selected:</div>
        <div className="font-mono bg-muted px-2 py-1 rounded">{selected || 'None'}</div>
        <Button onClick={() => void load(selected)} disabled={!selected || loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </Button>
      </div>

      {combinedError && <div className="mt-2.5 text-danger font-bold">{combinedError}</div>}

      <div className="mt-3">
        <div className="font-extrabold mb-1.5">Ticker data preview (last 50 rows)</div>
        <div className="max-h-[320px] overflow-auto border border-border rounded-xl bg-surface">
          <Table>
            <TableHeader>
              <TableRow>
                {['Date', 'Open', 'High', 'Low', 'Close'].map((h) => (
                  <TableHead key={h} className="sticky top-0 bg-surface">
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.map((r, idx) => (
                <TableRow key={idx}>
                  <TableCell className="whitespace-nowrap">{r.Date}</TableCell>
                  <TableCell>{r.Open}</TableCell>
                  <TableCell>{r.High}</TableCell>
                  <TableCell>{r.Low}</TableCell>
                  <TableCell>{r.Close}</TableCell>
                </TableRow>
              ))}
              {preview.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted">
                    No data loaded yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}
