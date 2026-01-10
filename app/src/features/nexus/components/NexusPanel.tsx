// src/features/nexus/components/NexusPanel.tsx
// Nexus tab component - displays community bots, top performers, and search

import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { formatPct, formatUsd } from '@/shared/utils'
import { EquityChart } from '@/features/backtest'
import { useAuthStore, useUIStore, useBotStore, useBacktestStore, useDashboardStore } from '@/stores'
import type {
  SavedBot,
  UserUiState,
  FlowNode,
  Watchlist,
} from '@/types'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type CommunitySortKey = 'name' | 'tags' | 'oosCagr' | 'oosMaxdd' | 'oosSharpe'
export type SortDir = 'asc' | 'desc'
export type CommunitySort = { key: CommunitySortKey; dir: SortDir }

export type CommunityBotRow = {
  id: string
  name: string
  tags: string[]
  oosCagr: number
  oosMaxdd: number
  oosSharpe: number
  calmar?: number
}

export type CommunitySearchFilter = {
  id: string
  mode: 'builder' | 'cagr' | 'sharpe' | 'calmar' | 'maxdd'
  comparison: 'greater' | 'less'
  value: string
}

export type InvestmentWithPnl = {
  botId: string
  botName: string
  buyDate: number
  costBasis: number
  currentValue: number
  pnl: number
  pnlPercent: number
}

export interface NexusPanelProps {
  // UI state (API-persisted)
  uiState: UserUiState
  setUiState: Dispatch<SetStateAction<UserUiState>>

  // Dashboard integration (computed from API data)
  dashboardCash: number
  dashboardInvestmentsWithPnl: InvestmentWithPnl[]

  // Callbacks
  handleNexusBuy: (botId: string) => Promise<void>
  removeBotFromWatchlist: (botId: string, watchlistId: string) => void
  push: (node: FlowNode) => void
  runAnalyzeBacktest: (bot: SavedBot) => void
  handleCopyToNew: (bot: SavedBot) => void

  // Helpers
  getFundSlotForBot: (botId: string) => number | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function NexusPanel(props: NexusPanelProps) {
  const {
    uiState,
    setUiState,
    dashboardCash,
    dashboardInvestmentsWithPnl,
    handleNexusBuy,
    removeBotFromWatchlist,
    push,
    runAnalyzeBacktest,
    handleCopyToNew,
    getFundSlotForBot,
  } = props

  // ─── Stores ───────────────────────────────────────────────────────────────────
  const { userId, userDisplayName, isAdmin } = useAuthStore()
  const {
    nexusBuyBotId,
    setNexusBuyBotId,
    nexusBuyAmount,
    setNexusBuyAmount,
    nexusBuyMode,
    setNexusBuyMode,
    setAddToWatchlistBotId,
    setAddToWatchlistNewName,
    setTab,
  } = useUIStore()
  const { savedBots, allNexusBots, watchlists } = useBotStore()
  const { analyzeBacktests } = useBacktestStore()
  const {
    communityTopSort,
    setCommunityTopSort,
    communitySearchSort,
    setCommunitySearchSort,
    atlasSort,
    setAtlasSort,
    communitySearchFilters,
    setCommunitySearchFilters,
  } = useDashboardStore()

  // Derived: watchlists by bot ID
  const watchlistsByBotId = useMemo(() => {
    const map = new Map<string, Watchlist[]>()
    for (const wl of watchlists) {
      for (const botId of wl.botIds) {
        const existing = map.get(botId) ?? []
        existing.push(wl)
        map.set(botId, existing)
      }
    }
    return map
  }, [watchlists])

  // Generate community bot rows
  const communityBotRows = useMemo<CommunityBotRow[]>(() => {
    return allNexusBots.map((bot) => {
      const tagNames = (watchlistsByBotId.get(bot.id) ?? []).map((w) => w.name)
      const builderName = bot.builderDisplayName || (bot.builderId === userId ? userDisplayName : null) || bot.builderId
      const tags = ['Nexus', builderName, ...tagNames]
      const metrics = analyzeBacktests[bot.id]?.result?.metrics ?? bot.backtestResult
      const fundSlot = bot.fundSlot ?? getFundSlotForBot(bot.id)
      const displayName = fundSlot
        ? `${builderName}'s Fund #${fundSlot}`
        : `${builderName}'s Fund`
      return {
        id: bot.id,
        name: displayName,
        tags,
        oosCagr: metrics?.cagr ?? 0,
        oosMaxdd: metrics?.maxDrawdown ?? 0,
        oosSharpe: metrics?.sharpe ?? 0,
      }
    })
  }, [allNexusBots, watchlistsByBotId, userId, userDisplayName, analyzeBacktests, getFundSlotForBot])

  // Atlas sponsored bots
  const atlasBotRows = useMemo<CommunityBotRow[]>(() => {
    return allNexusBots
      .filter(bot => bot.tags?.includes('Atlas'))
      .map((bot) => {
        const tagNames = (watchlistsByBotId.get(bot.id) ?? []).map((w) => w.name)
        const tags = ['Atlas', 'Sponsored', ...tagNames]
        const metrics = analyzeBacktests[bot.id]?.result?.metrics ?? bot.backtestResult
        return {
          id: bot.id,
          name: bot.name,
          tags,
          oosCagr: metrics?.cagr ?? 0,
          oosMaxdd: metrics?.maxDrawdown ?? 0,
          oosSharpe: metrics?.sharpe ?? 0,
        }
      })
  }, [allNexusBots, watchlistsByBotId, analyzeBacktests])

  // Top lists
  const topByCagr = useMemo(() =>
    [...communityBotRows].sort((a, b) => b.oosCagr - a.oosCagr).slice(0, 100),
    [communityBotRows]
  )

  const topByCalmar = useMemo(() =>
    communityBotRows
      .map((r) => ({ ...r, calmar: r.oosMaxdd !== 0 ? Math.abs(r.oosCagr / r.oosMaxdd) : 0 }))
      .sort((a, b) => b.calmar - a.calmar)
      .slice(0, 100),
    [communityBotRows]
  )

  const topBySharpe = useMemo(() =>
    [...communityBotRows].sort((a, b) => b.oosSharpe - a.oosSharpe).slice(0, 100),
    [communityBotRows]
  )

  // Builder names for autocomplete
  const allBuilderIds = useMemo(() =>
    [...new Set(communityBotRows.map((r) => r.tags[1] ?? '').filter(Boolean))],
    [communityBotRows]
  )

  // Search results
  const searchedBots = useMemo(() => {
    const activeFilters = communitySearchFilters.filter(f => f.value.trim())
    if (activeFilters.length === 0) return []

    const nexusBotIds = new Set(allNexusBots.map(b => b.id))
    const currentUserDisplayName = userDisplayName || userId || ''

    const myPrivateBotRows: CommunityBotRow[] = savedBots
      .filter(bot => bot.builderId === userId && !nexusBotIds.has(bot.id))
      .map((bot) => {
        const tagNames = (watchlistsByBotId.get(bot.id) ?? []).map((w) => w.name)
        const tags = ['Private', bot.builderDisplayName || currentUserDisplayName, ...tagNames]
        const metrics = analyzeBacktests[bot.id]?.result?.metrics ?? bot.backtestResult
        return {
          id: bot.id,
          name: bot.name,
          tags,
          oosCagr: metrics?.cagr ?? 0,
          oosMaxdd: metrics?.maxDrawdown ?? 0,
          oosSharpe: metrics?.sharpe ?? 0,
        }
      })

    const allSearchableBots = [...communityBotRows, ...myPrivateBotRows]
    let result = allSearchableBots.map((r) => ({
      ...r,
      calmar: r.oosMaxdd !== 0 ? Math.abs(r.oosCagr / r.oosMaxdd) : 0,
    }))

    for (const filter of activeFilters) {
      const searchVal = filter.value.trim().toLowerCase()
      const isGreater = filter.comparison === 'greater'

      if (filter.mode === 'builder') {
        result = result.filter((r) => {
          const builderName = (r.tags[1] ?? '').toLowerCase()
          return builderName.includes(searchVal) || r.name.toLowerCase().includes(searchVal)
        })
      } else {
        const threshold = parseFloat(filter.value)
        if (isNaN(threshold)) continue

        switch (filter.mode) {
          case 'cagr':
            result = result.filter((r) => isGreater ? r.oosCagr * 100 >= threshold : r.oosCagr * 100 <= threshold)
            break
          case 'sharpe':
            result = result.filter((r) => isGreater ? r.oosSharpe >= threshold : r.oosSharpe <= threshold)
            break
          case 'calmar':
            result = result.filter((r) => isGreater ? r.calmar >= threshold : r.calmar <= threshold)
            break
          case 'maxdd':
            result = result.filter((r) => isGreater ? Math.abs(r.oosMaxdd * 100) >= threshold : Math.abs(r.oosMaxdd * 100) <= threshold)
            break
        }
      }
    }

    return result
  }, [communitySearchFilters, allNexusBots, savedBots, communityBotRows, watchlistsByBotId, userId, userDisplayName, analyzeBacktests])

  // Sort helper
  const sortRows = useCallback((rows: CommunityBotRow[], sort: CommunitySort): CommunityBotRow[] => {
    const dir = sort.dir === 'asc' ? 1 : -1
    const arr = [...rows]
    arr.sort((a, b) => {
      let cmp = 0
      if (sort.key === 'name') cmp = a.name.localeCompare(b.name)
      else if (sort.key === 'tags') cmp = a.tags.join(',').localeCompare(b.tags.join(','))
      else if (sort.key === 'oosCagr') cmp = a.oosCagr - b.oosCagr
      else if (sort.key === 'oosMaxdd') cmp = a.oosMaxdd - b.oosMaxdd
      else cmp = a.oosSharpe - b.oosSharpe
      return dir * (cmp || a.id.localeCompare(b.id))
    })
    return arr
  }, [])

  // Render bot card
  const renderBotCard = useCallback((r: CommunityBotRow, _opts?: { showCollapsedMetrics?: boolean }) => {
    const collapsed = uiState.communityCollapsedByBotId[r.id] ?? true
    const b = allNexusBots.find((bot) => bot.id === r.id) ?? savedBots.find((bot) => bot.id === r.id)
    const analyzeState = analyzeBacktests[r.id]
    const wlTags = watchlistsByBotId.get(r.id) ?? []

    if (!b) return null

    const toggleCollapse = () => {
      const next = !collapsed
      setUiState((prev) => ({
        ...prev,
        communityCollapsedByBotId: { ...prev.communityCollapsedByBotId, [r.id]: next },
      }))
      if (!next && b) {
        if (!analyzeState || analyzeState.status === 'idle' || analyzeState.status === 'error') {
          runAnalyzeBacktest(b)
        }
      }
    }

    const fundSlot = b.fundSlot ?? getFundSlotForBot(b.id)
    const builderName = b.builderDisplayName || (b.builderId === userId ? userDisplayName : null) || b.builderId
    const displayName = b.tags?.includes('Nexus') && fundSlot
      ? `${builderName}'s Fund #${fundSlot}`
      : b.tags?.includes('Nexus')
        ? `${builderName}'s Fund`
        : b.name

    return (
      <Card key={r.id} className="grid gap-2.5 p-2">
        <div className="flex items-center gap-2.5 flex-wrap">
          <Button variant="ghost" size="sm" onClick={toggleCollapse}>
            {collapsed ? 'Expand' : 'Collapse'}
          </Button>
          <div className="font-black">{displayName}</div>
          <Badge variant={b.tags?.includes('Nexus') ? 'default' : b.tags?.includes('Atlas') ? 'default' : 'accent'}>
            {b.tags?.includes('Nexus') ? 'Nexus' : b.tags?.includes('Atlas') ? 'Atlas' : 'Private'}
          </Badge>
          {b.tags?.includes('Nexus Eligible') && (
            <Badge variant="secondary">Nexus Eligible</Badge>
          )}
          <Badge variant="default">{b.builderDisplayName || (b.builderId === userId ? userDisplayName : null) || b.builderId}</Badge>
          <div className="flex gap-1.5 flex-wrap">
            {wlTags.map((w) => (
              <Badge key={w.id} variant="accent" className="gap-1.5">
                {w.name}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4 p-0 hover:bg-transparent"
                  onClick={() => removeBotFromWatchlist(b.id, w.id)}
                  title={`Remove from ${w.name}`}
                >
                  X
                </Button>
              </Badge>
            ))}
          </div>
          <div className="ml-auto flex gap-2 flex-wrap items-center">
            <Button
              size="sm"
              onClick={() => {
                setAddToWatchlistBotId(b.id)
                setAddToWatchlistNewName('')
              }}
            >
              Add to Watchlist
            </Button>
          </div>
        </div>

        {!collapsed && (
          <div className="flex flex-col gap-2.5 w-full">
            <div className="saved-item grid grid-cols-1 gap-3.5 h-full w-full min-w-0 overflow-hidden items-stretch justify-items-stretch">
              {analyzeState?.status === 'loading' ? (
                <div className="text-muted">Running backtest...</div>
              ) : analyzeState?.status === 'error' ? (
                <div className="grid gap-2">
                  <div className="text-muted">{analyzeState.error ?? 'Failed to run backtest.'}</div>
                  {b?.payload && <Button onClick={() => runAnalyzeBacktest(b)}>Retry</Button>}
                </div>
              ) : analyzeState?.status === 'done' ? (
                <div className="grid grid-cols-1 gap-2.5 min-w-0 w-full">
                  {/* Buy System Section */}
                  <div className="border-b border-border pb-3 mb-1">
                    <div className="font-bold mb-2">Buy System</div>
                    <div className="text-sm mb-2">
                      <span className="text-muted">Cash Available:</span>{' '}
                      <span className="font-bold">{formatUsd(dashboardCash)}</span>
                      {nexusBuyBotId === b.id && nexusBuyMode === '%' && nexusBuyAmount && (
                        <span className="text-muted"> - Amount: {formatUsd((parseFloat(nexusBuyAmount) / 100) * dashboardCash)}</span>
                      )}
                    </div>
                    <div className="flex gap-2 items-center">
                      <Button
                        size="sm"
                        onClick={() => handleNexusBuy(b.id)}
                        disabled={nexusBuyBotId !== b.id || !nexusBuyAmount}
                        className="h-8 px-4"
                      >
                        Buy
                      </Button>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant={nexusBuyBotId === b.id && nexusBuyMode === '$' ? 'accent' : 'outline'}
                          className="h-8 w-8 p-0"
                          onClick={() => { setNexusBuyBotId(b.id); setNexusBuyMode('$') }}
                        >
                          $
                        </Button>
                        <Button
                          size="sm"
                          variant={nexusBuyBotId === b.id && nexusBuyMode === '%' ? 'accent' : 'outline'}
                          className="h-8 w-8 p-0"
                          onClick={() => { setNexusBuyBotId(b.id); setNexusBuyMode('%') }}
                        >
                          %
                        </Button>
                      </div>
                      <Input
                        type="number"
                        placeholder={nexusBuyBotId === b.id && nexusBuyMode === '%' ? '% of cash' : 'Amount'}
                        value={nexusBuyBotId === b.id ? nexusBuyAmount : ''}
                        onChange={(e) => { setNexusBuyBotId(b.id); setNexusBuyAmount(e.target.value) }}
                        className="h-8 flex-1"
                      />
                    </div>
                  </div>

                  {/* Stats and Charts */}
                  <div className="base-stats-grid w-full self-stretch grid grid-cols-1 grid-rows-[auto_auto_auto] gap-3">
                    {(() => {
                      const investment = dashboardInvestmentsWithPnl.find((inv) => inv.botId === b.id)
                      const isInvested = !!investment
                      const amountInvested = investment?.costBasis ?? 0
                      const currentValue = investment?.currentValue ?? 0
                      const pnlPct = investment?.pnlPercent ?? 0
                      let liveCagr = 0
                      if (investment) {
                        const daysSinceInvestment = (Date.now() - investment.buyDate) / (1000 * 60 * 60 * 24)
                        const yearsSinceInvestment = daysSinceInvestment / 365
                        if (yearsSinceInvestment > 0 && amountInvested > 0) {
                          liveCagr = (Math.pow(currentValue / amountInvested, 1 / yearsSinceInvestment) - 1)
                        }
                      }
                      return (
                        <div className="base-stats-card w-full min-w-0 max-w-full flex flex-col items-stretch text-center">
                          <div className="font-black mb-2 text-center">Live Stats</div>
                          {isInvested ? (
                            <div className="grid grid-cols-4 gap-2.5 justify-items-center w-full">
                              <div>
                                <div className="stat-label">Invested</div>
                                <div className="stat-value">{formatUsd(amountInvested)}</div>
                              </div>
                              <div>
                                <div className="stat-label">Current Value</div>
                                <div className="stat-value">{formatUsd(currentValue)}</div>
                              </div>
                              <div>
                                <div className="stat-label">P&L</div>
                                <div className={cn("stat-value", pnlPct >= 0 ? 'text-success' : 'text-danger')}>
                                  {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                                </div>
                              </div>
                              <div>
                                <div className="stat-label">CAGR</div>
                                <div className={cn("stat-value", liveCagr >= 0 ? 'text-success' : 'text-danger')}>
                                  {formatPct(liveCagr)}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="text-muted text-sm">Not invested in this system</div>
                          )}
                        </div>
                      )
                    })()}

                    {/* Backtest Stats */}
                    {analyzeState?.result?.metrics && (
                      <div className="base-stats-card">
                        <div className="font-black mb-2 text-center">Backtest Stats</div>
                        <div className="grid grid-cols-4 gap-2.5 justify-items-center w-full text-sm">
                          <div>
                            <div className="stat-label">CAGR</div>
                            <div className={cn("stat-value", (analyzeState.result.metrics.cagr ?? 0) >= 0 ? 'text-success' : 'text-danger')}>
                              {formatPct(analyzeState.result.metrics.cagr ?? 0)}
                            </div>
                          </div>
                          <div>
                            <div className="stat-label">Sharpe</div>
                            <div className="stat-value">{analyzeState.result.metrics.sharpe?.toFixed(2) ?? '--'}</div>
                          </div>
                          <div>
                            <div className="stat-label">Sortino</div>
                            <div className="stat-value">{analyzeState.result.metrics.sortino?.toFixed(2) ?? '--'}</div>
                          </div>
                          <div>
                            <div className="stat-label">MaxDD</div>
                            <div className="stat-value text-danger">{formatPct(analyzeState.result.metrics.maxDrawdown ?? 0)}</div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Equity Chart */}
                    {analyzeState?.result?.points && (
                      <div className="h-48">
                        <EquityChart
                          points={analyzeState.result.points}
                          markers={[]}
                          heightPx={180}
                          logScale
                          showCursorStats={false}
                        />
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-muted">Click Expand to run backtest</div>
              )}
            </div>
          </div>
        )}
      </Card>
    )
  }, [
    uiState.communityCollapsedByBotId,
    allNexusBots,
    savedBots,
    analyzeBacktests,
    watchlistsByBotId,
    userId,
    userDisplayName,
    isAdmin,
    setUiState,
    runAnalyzeBacktest,
    getFundSlotForBot,
    dashboardCash,
    dashboardInvestmentsWithPnl,
    nexusBuyBotId,
    nexusBuyAmount,
    nexusBuyMode,
    setNexusBuyBotId,
    setNexusBuyMode,
    setNexusBuyAmount,
    handleNexusBuy,
    setAddToWatchlistBotId,
    setAddToWatchlistNewName,
    removeBotFromWatchlist,
    push,
    setTab,
    handleCopyToNew,
  ])

  // Render bot cards list
  const renderBotCards = useCallback((
    rows: CommunityBotRow[],
    sort: CommunitySort,
    _setSort: Dispatch<SetStateAction<CommunitySort>>,
    opts?: { emptyMessage?: string; showCollapsedMetrics?: boolean },
  ) => {
    const sorted = sortRows(rows, sort)
    if (sorted.length === 0) {
      return <div className="text-muted p-3">{opts?.emptyMessage ?? 'No systems yet.'}</div>
    }
    return (
      <div className="flex flex-col gap-2.5">
        {sorted.map((r) => renderBotCard(r, opts))}
      </div>
    )
  }, [sortRows, renderBotCard])

  return (
    <div className="grid grid-cols-2 gap-4 min-h-[calc(100vh-260px)] items-stretch m-4">
      {/* Left Column - Atlas Systems and Search */}
      <Card className="flex flex-col gap-4 p-4">
        <Card className="flex-[2] flex flex-col p-4 border-2 overflow-auto">
          <div className="flex items-center justify-between mb-3">
            <div className="font-bold">Atlas Sponsored Systems</div>
            {/* Sort dropdown */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">Sort:</span>
              <Select
                className="h-7 px-2 text-xs"
                value={`${atlasSort.key}-${atlasSort.dir}`}
                onChange={(e) => {
                  const [key, dir] = e.target.value.split('-')
                  setAtlasSort({ key: key as CommunitySortKey, dir: dir as SortDir })
                }}
              >
                <option value="oosCagr-desc">CAGR (High-Low)</option>
                <option value="oosCagr-asc">CAGR (Low-High)</option>
                <option value="oosSharpe-desc">Sharpe (High-Low)</option>
                <option value="oosSharpe-asc">Sharpe (Low-High)</option>
                <option value="oosMaxdd-desc">MaxDD (Low-High)</option>
                <option value="oosMaxdd-asc">MaxDD (High-Low)</option>
                <option value="name-asc">Name (A-Z)</option>
                <option value="name-desc">Name (Z-A)</option>
              </Select>
            </div>
          </div>
          {renderBotCards(atlasBotRows, atlasSort, setAtlasSort, {
            emptyMessage: 'No Atlas sponsored systems yet.',
            showCollapsedMetrics: true,
          })}
        </Card>
        <Card className="flex-1 flex flex-col p-3 border-2">
          <div className="font-bold text-center mb-2">Search Nexus Strategies</div>
          <div className="flex flex-col gap-2 mb-2">
            {communitySearchFilters.map((filter, idx) => (
              <div key={filter.id} className="flex gap-2 items-center">
                <Select
                  className="h-8 px-2 text-sm"
                  value={filter.mode}
                  onChange={(e) => {
                    setCommunitySearchFilters(prev => prev.map((f, i) =>
                      i === idx ? { ...f, mode: e.target.value as typeof filter.mode, value: '' } : f
                    ))
                  }}
                >
                  <option value="builder">Builder Name</option>
                  <option value="cagr">CAGR</option>
                  <option value="sharpe">Sharpe</option>
                  <option value="calmar">Calmar</option>
                  <option value="maxdd">Max Drawdown</option>
                </Select>
                {filter.mode !== 'builder' && (
                  <Select
                    className="h-8 px-2 text-sm"
                    value={filter.comparison}
                    onChange={(e) => {
                      setCommunitySearchFilters(prev => prev.map((f, i) =>
                        i === idx ? { ...f, comparison: e.target.value as 'greater' | 'less' } : f
                      ))
                    }}
                  >
                    <option value="greater">Greater Than</option>
                    <option value="less">Less Than</option>
                  </Select>
                )}
                {filter.mode === 'builder' ? (
                  <div className="flex-1 relative">
                    <Input
                      type="text"
                      list={`builder-list-${filter.id}`}
                      placeholder="Search builder..."
                      value={filter.value}
                      onChange={(e) => {
                        setCommunitySearchFilters(prev => prev.map((f, i) =>
                          i === idx ? { ...f, value: e.target.value } : f
                        ))
                      }}
                      className="h-8 w-full"
                    />
                    <datalist id={`builder-list-${filter.id}`}>
                      {allBuilderIds.map((id) => (
                        <option key={id} value={id} />
                      ))}
                    </datalist>
                  </div>
                ) : (
                  <Input
                    type="number"
                    placeholder={
                      filter.mode === 'cagr'
                        ? 'CAGR %'
                        : filter.mode === 'sharpe'
                          ? 'Sharpe'
                          : filter.mode === 'calmar'
                            ? 'Calmar'
                            : 'Max DD %'
                    }
                    value={filter.value}
                    onChange={(e) => {
                      setCommunitySearchFilters(prev => prev.map((f, i) =>
                        i === idx ? { ...f, value: e.target.value } : f
                      ))
                    }}
                    className="flex-1 h-8"
                  />
                )}
                {communitySearchFilters.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted hover:text-danger"
                    onClick={() => {
                      setCommunitySearchFilters(prev => prev.filter((_, i) => i !== idx))
                    }}
                    title="Remove filter"
                  >
                    X
                  </Button>
                )}
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs self-start"
              onClick={() => {
                setCommunitySearchFilters(prev => [
                  ...prev,
                  { id: `filter-${Date.now()}`, mode: 'cagr', comparison: 'greater', value: '' }
                ])
              }}
            >
              + Add Filter
            </Button>
          </div>
          {/* Sort dropdown for search results */}
          {communitySearchFilters.some(f => f.value.trim()) && searchedBots.length > 0 && (
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-bold">Results: {searchedBots.length} systems</div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted">Sort:</span>
                <Select
                  className="h-7 px-2 text-xs"
                  value={`${communitySearchSort.key}-${communitySearchSort.dir}`}
                  onChange={(e) => {
                    const [key, dir] = e.target.value.split('-')
                    setCommunitySearchSort({ key: key as CommunitySortKey, dir: dir as SortDir })
                  }}
                >
                  <option value="oosCagr-desc">CAGR (High-Low)</option>
                  <option value="oosCagr-asc">CAGR (Low-High)</option>
                  <option value="oosSharpe-desc">Sharpe (High-Low)</option>
                  <option value="oosSharpe-asc">Sharpe (Low-High)</option>
                  <option value="oosMaxdd-desc">MaxDD (Low-High)</option>
                  <option value="oosMaxdd-asc">MaxDD (High-Low)</option>
                  <option value="name-asc">Name (A-Z)</option>
                  <option value="name-desc">Name (Z-A)</option>
                </Select>
              </div>
            </div>
          )}
          <div className="flex-1 overflow-auto">
            {communitySearchFilters.some(f => f.value.trim()) ? (
              searchedBots.length > 0 ? (
                renderBotCards(searchedBots.slice(0, 20), communitySearchSort, setCommunitySearchSort, {
                  emptyMessage: 'No matching systems found.',
                })
              ) : (
                <div className="text-muted text-center p-3">
                  No systems match these criteria.
                </div>
              )
            ) : (
              <div className="text-muted text-center p-3">
                Enter filter values to search.
              </div>
            )}
          </div>
        </Card>
      </Card>

      {/* Right Column - Nexus Select Zone */}
      <Card className="flex flex-col p-4">
        <div className="font-black text-center mb-4">Nexus Select Zone</div>
        <div className="flex flex-col gap-4 flex-1">
          <Card className="flex-1 flex flex-col p-3 border-2">
            <div className="font-bold text-center mb-2">Top Systems by CAGR</div>
            <div className="flex-1 overflow-auto max-h-[400px]">
              {renderBotCards(topByCagr, communityTopSort, setCommunityTopSort, {
                emptyMessage: 'No Nexus systems with backtest data.',
              })}
            </div>
          </Card>
          <Card className="flex-1 flex flex-col p-3 border-2">
            <div className="font-bold text-center mb-2">Top Systems by Calmar Ratio</div>
            <div className="flex-1 overflow-auto max-h-[400px]">
              {renderBotCards(topByCalmar, communityTopSort, setCommunityTopSort, {
                emptyMessage: 'No Nexus systems with backtest data.',
              })}
            </div>
          </Card>
          <Card className="flex-1 flex flex-col p-3 border-2">
            <div className="font-bold text-center mb-2">Top Systems by Sharpe Ratio</div>
            <div className="flex-1 overflow-auto max-h-[400px]">
              {renderBotCards(topBySharpe, communityTopSort, setCommunityTopSort, {
                emptyMessage: 'No Nexus systems with backtest data.',
              })}
            </div>
          </Card>
        </div>
      </Card>
    </div>
  )
}

export default NexusPanel
