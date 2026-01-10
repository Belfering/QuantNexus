// src/features/admin/components/DatabasesPanel.tsx
// Database browser panel for viewing all database tables

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { API_BASE } from '@/constants'
import { authFetch } from '@/lib/authFetch'

export type DatabasesSubtab = 'Users' | 'Systems' | 'Portfolios' | 'Cache' | 'Admin Config' | 'Tickers'
type DbSortConfig = { col: string; dir: 'asc' | 'desc' }

export interface DatabasesPanelProps {
  databasesTab: DatabasesSubtab
  setDatabasesTab: (t: DatabasesSubtab) => void
  onOpenBot?: (botId: string) => void
  onExportBot?: (botId: string) => void
  isAdmin: boolean
}

export function DatabasesPanel({
  databasesTab,
  setDatabasesTab,
  onOpenBot,
  onExportBot,
  isAdmin,
}: DatabasesPanelProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<Record<string, unknown>[] | null>(null)
  const [columns, setColumns] = useState<string[]>([])
  const [sortConfig, setSortConfig] = useState<DbSortConfig>({ col: '', dir: 'desc' })

  // Ticker-specific state
  const [tickerSearch, setTickerSearch] = useState('')
  const [tickerSearchDebounced, setTickerSearchDebounced] = useState('')
  const [tickerActiveOnly, setTickerActiveOnly] = useState(false)
  const [tickerTotal, setTickerTotal] = useState(0)
  const [tickerOffset, setTickerOffset] = useState(0)
  const tickerLimit = 500

  // Debounce ticker search
  useEffect(() => {
    const timer = setTimeout(() => {
      setTickerSearchDebounced(tickerSearch)
      setTickerOffset(0)
    }, 300)
    return () => clearTimeout(timer)
  }, [tickerSearch])

  const fetchTable = useCallback(async (table: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await authFetch(`${API_BASE}/admin/db/${table}`)
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || `Failed to fetch ${table}`)
      }
      const result = await res.json()
      setData(result.rows || [])
      setColumns(result.columns || [])
    } catch (e) {
      setError(String((e as Error)?.message || e))
      setData(null)
      setColumns([])
    } finally {
      setLoading(false)
    }
  }, [])

  // Special fetch for Tickers with search/filter/pagination
  const fetchTickers = useCallback(async (search: string, activeOnly: boolean, offset: number) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        search,
        activeOnly: activeOnly.toString(),
        limit: tickerLimit.toString(),
        offset: offset.toString(),
      })
      const res = await authFetch(`${API_BASE}/tickers/registry/all?${params}`)
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to fetch tickers')
      }
      const result = await res.json()
      setData(result.rows || [])
      setColumns(['ticker', 'name', 'asset_type', 'exchange', 'is_active', 'last_synced', 'start_date', 'end_date', 'currency'])
      setTickerTotal(result.total || 0)
    } catch (e) {
      setError(String((e as Error)?.message || e))
      setData(null)
      setColumns([])
    } finally {
      setLoading(false)
    }
  }, [tickerLimit])

  useEffect(() => {
    if (databasesTab === 'Tickers') {
      fetchTickers(tickerSearchDebounced, tickerActiveOnly, tickerOffset)
    } else {
      const tableMap: Record<DatabasesSubtab, string> = {
        'Users': 'users',
        'Systems': 'bots',
        'Portfolios': 'portfolios',
        'Cache': 'cache',
        'Admin Config': 'admin_config',
        'Tickers': 'ticker_registry',
      }
      fetchTable(tableMap[databasesTab])
    }
  }, [databasesTab, fetchTable, fetchTickers, tickerSearchDebounced, tickerActiveOnly, tickerOffset])

  const formatValue = (val: unknown): string => {
    if (val === null || val === undefined) return '—'
    if (typeof val === 'object') {
      const str = JSON.stringify(val)
      return str.length > 100 ? str.substring(0, 100) + '...' : str
    }
    const str = String(val)
    return str.length > 100 ? str.substring(0, 100) + '...' : str
  }

  return (
    <>
      <div className="flex items-center gap-3 mb-6">
        <div className="font-black text-lg">Databases</div>
        <div className="flex gap-2">
          {(isAdmin
            ? ['Users', 'Systems', 'Portfolios', 'Cache', 'Admin Config', 'Tickers'] as const
            : ['Systems'] as const
          ).map((t) => (
            <Button
              key={t}
              variant={databasesTab === t ? 'accent' : 'secondary'}
              size="sm"
              onClick={() => setDatabasesTab(t)}
            >
              {t}
            </Button>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (databasesTab === 'Tickers') {
              fetchTickers(tickerSearchDebounced, tickerActiveOnly, tickerOffset)
            } else {
              const tableMap: Record<DatabasesSubtab, string> = {
                'Users': 'users',
                'Systems': 'bots',
                'Portfolios': 'portfolios',
                'Cache': 'cache',
                'Admin Config': 'admin_config',
                'Tickers': 'ticker_registry',
              }
              fetchTable(tableMap[databasesTab])
            }
          }}
          disabled={loading}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </Button>
      </div>

      {/* Ticker-specific search and filter controls */}
      {databasesTab === 'Tickers' && (
        <div className="flex items-center gap-4 mb-4">
          <input
            type="text"
            placeholder="Search by ticker or name..."
            value={tickerSearch}
            onChange={(e) => setTickerSearch(e.target.value)}
            className="w-64 h-8 px-3 text-sm rounded border border-border bg-background"
          />
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={tickerActiveOnly}
              onChange={(e) => {
                setTickerActiveOnly(e.target.checked)
                setTickerOffset(0) // Reset to first page on filter change
              }}
            />
            Active only
          </label>
          <div className="text-sm text-muted-foreground">
            Showing {data?.length || 0} of {tickerTotal.toLocaleString()} tickers
          </div>
          {tickerTotal > tickerLimit && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={tickerOffset === 0 || loading}
                onClick={() => setTickerOffset(Math.max(0, tickerOffset - tickerLimit))}
              >
                ← Prev
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {Math.floor(tickerOffset / tickerLimit) + 1} of {Math.ceil(tickerTotal / tickerLimit)}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={tickerOffset + tickerLimit >= tickerTotal || loading}
                onClick={() => setTickerOffset(tickerOffset + tickerLimit)}
              >
                Next →
              </Button>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-destructive/10 border border-destructive rounded text-destructive text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-muted text-center py-8">Loading...</div>
      ) : data && data.length > 0 ? (
        (() => {
          // Sort data if sort config is set
          const sortedData = sortConfig.col
            ? [...data].sort((a, b) => {
                const aVal = a[sortConfig.col]
                const bVal = b[sortConfig.col]
                // Handle null/undefined
                if (aVal == null && bVal == null) return 0
                if (aVal == null) return sortConfig.dir === 'asc' ? -1 : 1
                if (bVal == null) return sortConfig.dir === 'asc' ? 1 : -1
                // Numeric comparison for stats columns
                if (typeof aVal === 'number' && typeof bVal === 'number') {
                  return sortConfig.dir === 'asc' ? aVal - bVal : bVal - aVal
                }
                // String comparison
                const strA = String(aVal).toLowerCase()
                const strB = String(bVal).toLowerCase()
                return sortConfig.dir === 'asc' ? strA.localeCompare(strB) : strB.localeCompare(strA)
              })
            : data

          const handleSort = (col: string) => {
            if (sortConfig.col === col) {
              setSortConfig({ col, dir: sortConfig.dir === 'asc' ? 'desc' : 'asc' })
            } else {
              setSortConfig({ col, dir: 'desc' })
            }
          }

          // Add Actions column for Systems tab and Tickers tab (for reactivate)
          const showActions = (databasesTab === 'Systems' && (onOpenBot || onExportBot)) || databasesTab === 'Tickers'
          const displayColumns = showActions ? [...columns, 'Actions'] : columns

          return (
            <div className="border rounded-lg overflow-auto max-h-[calc(100vh-300px)]">
              <table className="w-full text-sm">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    {displayColumns.map((col) => (
                      <th
                        key={col}
                        className={`px-3 py-2 text-left font-semibold border-b whitespace-nowrap ${col !== 'Actions' ? 'cursor-pointer hover:bg-accent/20 select-none' : ''}`}
                        onClick={() => col !== 'Actions' && handleSort(col)}
                      >
                        <div className="flex items-center gap-1">
                          {col}
                          {col !== 'Actions' && sortConfig.col === col && (
                            <span className="text-accent">{sortConfig.dir === 'asc' ? '↑' : '↓'}</span>
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedData.map((row, i) => (
                    <tr key={i} className="hover:bg-muted/50 border-b border-border/50">
                      {columns.map((col) => (
                        <td key={col} className="px-3 py-2 font-mono text-xs whitespace-nowrap max-w-[300px] overflow-hidden text-ellipsis">
                          {formatValue(row[col])}
                        </td>
                      ))}
                      {showActions && (
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="flex gap-1">
                            {databasesTab === 'Systems' && onExportBot && (
                              <Button size="sm" variant="outline" onClick={() => onExportBot(String(row['id']))}>
                                Export
                              </Button>
                            )}
                            {databasesTab === 'Systems' && onOpenBot && (
                              <Button size="sm" variant="outline" onClick={() => onOpenBot(String(row['id']))}>
                                Open
                              </Button>
                            )}
                            {databasesTab === 'Tickers' && !row['isActive'] && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={async () => {
                                  try {
                                    const res = await authFetch(`${API_BASE}/tickers/registry/reactivate`, {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ ticker: String(row['ticker']) }),
                                    })
                                    if (res.ok) {
                                      // Refresh the ticker list
                                      fetchTickers(tickerSearchDebounced, tickerActiveOnly, tickerOffset)
                                    }
                                  } catch {
                                    // Ignore errors
                                  }
                                }}
                              >
                                Reactivate
                              </Button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })()
      ) : data && data.length === 0 ? (
        <div className="text-muted text-center py-8">No records found</div>
      ) : null}

      {data && (
        <div className="mt-3 text-xs text-muted">
          Showing {data.length} record{data.length !== 1 ? 's' : ''}
        </div>
      )}
    </>
  )
}
