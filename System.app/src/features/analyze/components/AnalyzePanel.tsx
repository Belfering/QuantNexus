// src/features/analyze/components/AnalyzePanel.tsx
// Analyze tab component - displays bot analysis with Systems and Correlation Tool subtabs

import { type Dispatch, type SetStateAction, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import {
  type SanityReportState,
  type BenchmarkMetricsState,
  normalizeNodeForBacktest,
} from '@/features/backtest'
export type { BenchmarkMetricsState }
import { useAuthStore, useUIStore, useBotStore, useBacktestStore } from '@/stores'
import type {
  FlowNode,
  CallChain,
  SavedBot,
  UserUiState,
  Watchlist,
  AnalyzeBacktestState,
  TickerContributionState,
  UserId,
  BacktestMode,
} from '@/types'
import type { InvestmentWithPnl } from '@/features/dashboard/hooks/useDashboardInvestments'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type AnalyzeSubtab = 'Systems' | 'Correlation Tool'

export interface CorrelationHookResult {
  // Selection
  selectedBotIds: string[]
  setSelectedBotIds: (ids: string[]) => void
  addBotId: (id: string) => void
  removeBotId: (id: string) => void
  validBotIds: string[]

  // Filter settings
  optimizationMetric: 'correlation' | 'volatility' | 'beta' | 'sharpe'
  setOptimizationMetric: (v: 'correlation' | 'volatility' | 'beta' | 'sharpe') => void
  timePeriod: 'full' | '1y' | '3y' | '5y'
  setTimePeriod: (v: 'full' | '1y' | '3y' | '5y') => void
  maxWeight: number
  setMaxWeight: (v: number) => void
  minCagr: number | ''
  setMinCagr: (v: number | '') => void
  maxDrawdown: number | ''
  setMaxDrawdown: (v: number | '') => void
  minSharpe: number | ''
  setMinSharpe: (v: number | '') => void

  // Search
  userSearch: string
  setUserSearch: (v: string) => void
  nexusSearch: string
  setNexusSearch: (v: string) => void

  // Filter functions
  passesFilters: (metrics: { cagr?: number; maxDrawdown?: number; sharpe?: number } | null | undefined) => boolean
  passesUserSearch: (bot: SavedBot) => boolean
  passesNexusSearch: (bot: SavedBot) => boolean

  // Results
  weights: Record<string, number>
  correlationMatrix: number[][] | null
  portfolioMetrics: {
    cagr: number
    volatility: number
    sharpe: number
    maxDrawdown: number
    beta: number
  } | null
  userRecommendations: Array<{ botId: string; correlation: number }>
  nexusRecommendations: Array<{ botId: string; correlation: number }>

  // Status
  loading: boolean
  error: string | null
}

export interface AnalyzePanelProps {
  // UI state (persisted to API - kept as prop for now)
  uiState: UserUiState
  setUiState: Dispatch<SetStateAction<UserUiState>>

  // Dashboard integration (computed values)
  dashboardCash: number
  dashboardInvestmentsWithPnl: InvestmentWithPnl[]

  // Action callbacks
  handleNexusBuy: (botId: string) => Promise<void>
  removeBotFromWatchlist: (botId: string, watchlistId: string) => Promise<void>
  runAnalyzeBacktest: (bot: SavedBot, force?: boolean) => void
  handleCopyToNew: (bot: SavedBot) => void
  handleOpenSaved: (bot: SavedBot) => void
  handleCopySaved: (bot: SavedBot) => void
  handleDeleteSaved: (id: string) => Promise<void>
  runSanityReport: (bot: SavedBot) => void
  fetchBenchmarkMetrics: () => Promise<void>

  // Correlation hook result
  correlation: CorrelationHookResult

  // Call chains for ticker extraction
  callChainsById: Map<string, CallChain>
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function AnalyzePanel(props: AnalyzePanelProps) {
  const {
    // UI state (from props - persisted to API)
    uiState,
    setUiState,

    // Dashboard integration
    dashboardCash,
    dashboardInvestmentsWithPnl,

    // Action callbacks
    handleNexusBuy,
    removeBotFromWatchlist,
    runAnalyzeBacktest,
    handleCopyToNew,
    handleOpenSaved,
    handleCopySaved,
    handleDeleteSaved,
    runSanityReport,
    fetchBenchmarkMetrics,

    // Correlation hook
    correlation,

    // Call chains
    callChainsById,
  } = props

  // --- Zustand stores ---
  // Auth store
  const { userId, userDisplayName, isAdmin } = useAuthStore()

  // UI store
  const {
    analyzeSubtab,
    setAnalyzeSubtab,
    nexusBuyBotId,
    setNexusBuyBotId,
    nexusBuyAmount,
    setNexusBuyAmount,
    nexusBuyMode,
    setNexusBuyMode,
    setAddToWatchlistBotId,
    setAddToWatchlistNewName,
  } = useUIStore()

  // Bot store
  const { savedBots, allNexusBots, watchlists, setWatchlists } = useBotStore()

  // Backtest store
  const {
    analyzeBacktests,
    analyzeTickerSort,
    setAnalyzeTickerSort,
    analyzeTickerContrib,
    backtestMode,
    backtestBenchmark,
    sanityReports,
    benchmarkMetrics,
  } = useBacktestStore()

  // --- Computed values ---
  // Map watchlists by botId for quick lookup
  const watchlistsByBotId = useMemo(() => {
    const map = new Map<string, Watchlist[]>()
    for (const w of watchlists) {
      for (const botId of w.botIds) {
        const existing = map.get(botId) ?? []
        existing.push(w)
        map.set(botId, existing)
      }
    }
    return map
  }, [watchlists])

  // Compute visible bot IDs based on filter
  const analyzeVisibleBotIds = useMemo(() => {
    const filterWatchlistId = uiState.analyzeFilterWatchlistId
    if (!filterWatchlistId) {
      // Show all saved bots
      return savedBots.map((b) => b.id)
    }
    // Filter to bots in the selected watchlist
    const watchlist = watchlists.find((w) => w.id === filterWatchlistId)
    return watchlist?.botIds ?? []
  }, [savedBots, watchlists, uiState.analyzeFilterWatchlistId])

  return (
    <Card className="h-full flex flex-col overflow-hidden m-4">
      <CardContent className="p-4 flex flex-col h-full overflow-auto">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="font-black">Analyze</div>
            <div className="flex gap-2">
              {(['Systems', 'Correlation Tool'] as const).map((t) => (
                <Button
                  key={t}
                  variant={analyzeSubtab === t ? 'accent' : 'secondary'}
                  size="sm"
                  onClick={() => setAnalyzeSubtab(t)}
                >
                  {t}
                </Button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2">
            <div className="text-xs font-bold text-muted">Filter</div>
            <Select
              value={uiState.analyzeFilterWatchlistId ?? ''}
              onChange={(e) =>
                setUiState((prev) => ({ ...prev, analyzeFilterWatchlistId: e.target.value ? e.target.value : null }))
              }
            >
              <option value="">All watchlists</option>
              {watchlists.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </label>
        </div>

        {analyzeSubtab === 'Correlation Tool' ? (
          <CorrelationToolContent
            savedBots={savedBots}
            allNexusBots={allNexusBots}
            analyzeBacktests={analyzeBacktests}
            watchlists={watchlists}
            userId={userId}
            correlation={correlation}
            setWatchlists={setWatchlists}
          />
        ) : null}

        {analyzeSubtab !== 'Systems' ? null : (
          <SystemsContent
            savedBots={savedBots}
            analyzeBacktests={analyzeBacktests}
            analyzeVisibleBotIds={analyzeVisibleBotIds}
            watchlistsByBotId={watchlistsByBotId}
            userId={userId}
            userDisplayName={userDisplayName}
            isAdmin={isAdmin}
            uiState={uiState}
            setUiState={setUiState}
            analyzeTickerSort={analyzeTickerSort}
            setAnalyzeTickerSort={setAnalyzeTickerSort}
            analyzeTickerContrib={analyzeTickerContrib}
            backtestMode={backtestMode}
            backtestBenchmark={backtestBenchmark}
            dashboardCash={dashboardCash}
            dashboardInvestmentsWithPnl={dashboardInvestmentsWithPnl}
            nexusBuyBotId={nexusBuyBotId}
            setNexusBuyBotId={setNexusBuyBotId}
            nexusBuyAmount={nexusBuyAmount}
            setNexusBuyAmount={setNexusBuyAmount}
            nexusBuyMode={nexusBuyMode}
            setNexusBuyMode={setNexusBuyMode}
            handleNexusBuy={handleNexusBuy}
            setAddToWatchlistBotId={setAddToWatchlistBotId}
            setAddToWatchlistNewName={setAddToWatchlistNewName}
            removeBotFromWatchlist={removeBotFromWatchlist}
            runAnalyzeBacktest={runAnalyzeBacktest}
            handleCopyToNew={handleCopyToNew}
            handleOpenSaved={handleOpenSaved}
            handleCopySaved={handleCopySaved}
            handleDeleteSaved={handleDeleteSaved}
            sanityReports={sanityReports}
            runSanityReport={runSanityReport}
            benchmarkMetrics={benchmarkMetrics}
            fetchBenchmarkMetrics={fetchBenchmarkMetrics}
            callChainsById={callChainsById}
            normalizeNodeForBacktest={normalizeNodeForBacktest}
          />
        )}
      </CardContent>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Correlation Tool Content
// ─────────────────────────────────────────────────────────────────────────────

interface CorrelationToolContentProps {
  savedBots: SavedBot[]
  allNexusBots: SavedBot[]
  analyzeBacktests: Record<string, AnalyzeBacktestState>
  watchlists: Watchlist[]
  userId: UserId | null
  correlation: CorrelationHookResult
  setWatchlists: Dispatch<SetStateAction<Watchlist[]>>
}

function CorrelationToolContent(props: CorrelationToolContentProps) {
  const {
    savedBots,
    allNexusBots,
    analyzeBacktests,
    watchlists,
    userId,
    correlation,
    setWatchlists,
  } = props

  return (
    <div className="mt-3 flex flex-col gap-3 flex-1 min-h-0">
      {/* Filters Bar */}
      <Card className="p-3 flex items-center gap-4 flex-wrap">
        <label className="flex items-center gap-2">
          <span className="text-xs font-bold text-muted">Optimize for</span>
          <Select
            value={correlation.optimizationMetric}
            onChange={(e) => correlation.setOptimizationMetric(e.target.value as typeof correlation.optimizationMetric)}
            className="text-sm"
          >
            <option value="correlation">Min Correlation</option>
            <option value="volatility">Min Volatility</option>
            <option value="beta">Min Beta</option>
            <option value="sharpe">Max Sharpe</option>
          </Select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-xs font-bold text-muted">Period</span>
          <Select
            value={correlation.timePeriod}
            onChange={(e) => correlation.setTimePeriod(e.target.value as typeof correlation.timePeriod)}
            className="text-sm"
          >
            <option value="full">Full History</option>
            <option value="1y">1 Year</option>
            <option value="3y">3 Years</option>
            <option value="5y">5 Years</option>
          </Select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-xs font-bold text-muted">Max Weight</span>
          <input
            type="number"
            value={correlation.maxWeight}
            onChange={(e) => correlation.setMaxWeight(Math.min(100, Math.max(10, parseInt(e.target.value) || 40)))}
            className="w-16 px-2 py-1 rounded border border-border bg-background text-sm"
            min={10}
            max={100}
          />
          <span className="text-xs text-muted">%</span>
        </label>
        <div className="w-px h-6 bg-border" />
        <label className="flex items-center gap-2">
          <span className="text-xs font-bold text-muted">Min CAGR</span>
          <input
            type="number"
            value={correlation.minCagr}
            onChange={(e) => correlation.setMinCagr(e.target.value === '' ? '' : parseFloat(e.target.value))}
            className="w-14 px-2 py-1 rounded border border-border bg-background text-sm"
            placeholder="--"
          />
          <span className="text-xs text-muted">%</span>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-xs font-bold text-muted">Max DD</span>
          <input
            type="number"
            value={correlation.maxDrawdown}
            onChange={(e) => correlation.setMaxDrawdown(e.target.value === '' ? '' : parseFloat(e.target.value))}
            className="w-14 px-2 py-1 rounded border border-border bg-background text-sm"
            placeholder="--"
          />
          <span className="text-xs text-muted">%</span>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-xs font-bold text-muted">Min Sharpe</span>
          <input
            type="number"
            step="0.1"
            value={correlation.minSharpe}
            onChange={(e) => correlation.setMinSharpe(e.target.value === '' ? '' : parseFloat(e.target.value))}
            className="w-14 px-2 py-1 rounded border border-border bg-background text-sm"
            placeholder="--"
          />
        </label>
      </Card>

      {/* Three Panel Layout */}
      <div className="grid grid-cols-3 gap-3 flex-1 min-h-0">
        {/* Left Panel: Your Systems */}
        <Card className="flex flex-col min-h-[400px] max-h-[600px]">
          <div className="p-3 border-b border-border">
            <div className="flex items-center gap-2">
              <div className="font-bold text-sm shrink-0">Your Systems</div>
              <Input
                placeholder="Search..."
                value={correlation.userSearch}
                onChange={(e) => correlation.setUserSearch(e.target.value)}
                className="h-6 text-xs flex-1"
              />
            </div>
          </div>
          <div className="flex-1 overflow-hidden flex flex-col">
            {savedBots.filter(b => b.backtestResult || analyzeBacktests[b.id]?.result).length === 0 ? (
              <div className="text-sm text-muted p-2">No backtested systems yet. Run backtests in the Analyze tab first.</div>
            ) : (
              <>
                {/* Top 3 Recommended - Fixed Section (always visible) */}
                <div className="p-2 border-b border-border bg-green-500/5 shrink-0">
                  <div className="text-xs font-bold text-green-600 mb-2">Top 3 Recommended</div>
                  <div className="grid gap-1">
                    {(() => {
                      // Get filtered bots not already in portfolio
                      const filteredBots = savedBots
                        .filter(b => b.backtestResult || analyzeBacktests[b.id]?.result)
                        .filter(b => {
                          const metrics = analyzeBacktests[b.id]?.result?.metrics ?? b.backtestResult
                          return correlation.passesFilters(metrics)
                        })
                        .filter(b => correlation.passesUserSearch(b)).filter(b => !correlation.selectedBotIds.includes(b.id))

                      // If we have API recommendations, use those; otherwise sort by Sharpe
                      let top3: typeof filteredBots = []
                      if (correlation.userRecommendations.length > 0) {
                        top3 = correlation.userRecommendations
                          .slice(0, 3)
                          .map(rec => filteredBots.find(b => b.id === rec.botId))
                          .filter((b): b is NonNullable<typeof b> => b != null)
                      } else {
                        top3 = [...filteredBots]
                          .sort((a, b) => {
                            const aMetrics = analyzeBacktests[a.id]?.result?.metrics ?? a.backtestResult
                            const bMetrics = analyzeBacktests[b.id]?.result?.metrics ?? b.backtestResult
                            return (bMetrics?.sharpe ?? 0) - (aMetrics?.sharpe ?? 0)
                          })
                          .slice(0, 3)
                      }

                      if (top3.length === 0) {
                        return <div className="text-xs text-muted">No recommendations available</div>
                      }

                      return top3.map(bot => {
                        const metrics = analyzeBacktests[bot.id]?.result?.metrics ?? bot.backtestResult
                        const rec = correlation.userRecommendations.find(r => r.botId === bot.id)
                        return (
                          <div
                            key={bot.id}
                            className="flex items-center justify-between p-2 rounded text-sm border border-green-500/30 bg-background hover:bg-green-500/10"
                          >
                            <div className="flex flex-col min-w-0 flex-1">
                              <div className="font-medium truncate">{bot.name}</div>
                              <div className="text-xs text-muted">
                                {rec ? `Corr: ${rec.correlation.toFixed(2)} | ` : ''}CAGR: {((metrics?.cagr ?? 0) * 100).toFixed(1)}%
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => correlation.addBotId(bot.id)}
                            >
                              +
                            </Button>
                          </div>
                        )
                      })
                    })()}
                  </div>
                </div>

                {/* All Your Bots - Scrollable Section */}
                <div className="flex-1 overflow-auto p-2">
                  <div className="text-xs font-bold text-muted mb-2">All Systems</div>
                  <div className="grid gap-1">
                    {savedBots
                      .filter(b => b.backtestResult || analyzeBacktests[b.id]?.result)
                      .filter(b => {
                        const metrics = analyzeBacktests[b.id]?.result?.metrics ?? b.backtestResult
                        return correlation.passesFilters(metrics)
                      })
                      .filter(b => correlation.passesUserSearch(b))
                      .map(bot => {
                        const metrics = analyzeBacktests[bot.id]?.result?.metrics ?? bot.backtestResult
                        const isSelected = correlation.selectedBotIds.includes(bot.id)
                        return (
                          <div
                            key={bot.id}
                            className={`flex items-center justify-between p-2 rounded text-sm ${isSelected ? 'bg-accent/20 opacity-50' : 'hover:bg-accent/10'}`}
                          >
                            <div className="flex flex-col min-w-0 flex-1">
                              <div className="font-medium truncate">{bot.name}</div>
                              <div className="text-xs text-muted">
                                CAGR: {((metrics?.cagr ?? 0) * 100).toFixed(1)}% | DD: {((metrics?.maxDrawdown ?? 0) * 100).toFixed(1)}%
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={isSelected}
                              onClick={() => correlation.addBotId(bot.id)}
                            >
                              +
                            </Button>
                          </div>
                        )
                      })}
                  </div>
                </div>
              </>
            )}
          </div>
        </Card>

        {/* Middle Panel: Nexus Systems */}
        <Card className="flex flex-col min-h-[400px] max-h-[600px]">
          <div className="p-3 border-b border-border">
            <div className="flex items-center gap-2">
              <div className="font-bold text-sm shrink-0">Nexus Systems</div>
              <Input
                placeholder="Search..."
                value={correlation.nexusSearch}
                onChange={(e) => correlation.setNexusSearch(e.target.value)}
                className="h-6 text-xs flex-1"
              />
            </div>
          </div>
          <div className="flex-1 overflow-hidden flex flex-col">
            {allNexusBots.filter(b => b.backtestResult).length === 0 ? (
              <div className="text-sm text-muted p-2">No Nexus systems with metrics available.</div>
            ) : (
              <>
                {/* Top 3 Recommended - Fixed Section (always visible) */}
                <div className="p-2 border-b border-border bg-green-500/5 shrink-0">
                  <div className="text-xs font-bold text-green-600 mb-2">Top 3 Recommended</div>
                  <div className="grid gap-1">
                    {(() => {
                      // Get filtered bots not already in portfolio
                      const filteredBots = allNexusBots
                        .filter(b => b.backtestResult)
                        .filter(b => correlation.passesFilters(b.backtestResult))
                        .filter(b => correlation.passesNexusSearch(b)).filter(b => !correlation.selectedBotIds.includes(b.id))

                      // If we have API recommendations, use those; otherwise sort by Sharpe
                      let top3: typeof filteredBots = []
                      if (correlation.nexusRecommendations.length > 0) {
                        top3 = correlation.nexusRecommendations
                          .slice(0, 3)
                          .map(rec => filteredBots.find(b => b.id === rec.botId))
                          .filter((b): b is NonNullable<typeof b> => b != null)
                      } else {
                        top3 = [...filteredBots]
                          .sort((a, b) => (b.backtestResult?.sharpe ?? 0) - (a.backtestResult?.sharpe ?? 0))
                          .slice(0, 3)
                      }

                      if (top3.length === 0) {
                        return <div className="text-xs text-muted">No recommendations available</div>
                      }

                      return top3.map(bot => {
                        const metrics = bot.backtestResult
                        const rec = correlation.nexusRecommendations.find(r => r.botId === bot.id)
                        return (
                          <div
                            key={bot.id}
                            className="flex items-center justify-between p-2 rounded text-sm border border-green-500/30 bg-background hover:bg-green-500/10"
                          >
                            <div className="flex flex-col min-w-0 flex-1">
                              <div className="font-medium truncate">{bot.name}</div>
                              <div className="text-xs text-muted">
                                {rec ? `Corr: ${rec.correlation.toFixed(2)} | ` : ''}CAGR: {((metrics?.cagr ?? 0) * 100).toFixed(1)}%
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => correlation.addBotId(bot.id)}
                            >
                              +
                            </Button>
                          </div>
                        )
                      })
                    })()}
                  </div>
                </div>

                {/* All Nexus Bots - Scrollable Section */}
                <div className="flex-1 overflow-auto p-2">
                  <div className="text-xs font-bold text-muted mb-2">All Systems</div>
                  <div className="grid gap-1">
                    {allNexusBots
                      .filter(b => b.backtestResult)
                      .filter(b => correlation.passesFilters(b.backtestResult))
                      .filter(b => correlation.passesNexusSearch(b))
                      .map(bot => {
                        const metrics = bot.backtestResult
                        const isSelected = correlation.selectedBotIds.includes(bot.id)
                        return (
                          <div
                            key={bot.id}
                            className={`flex items-center justify-between p-2 rounded text-sm ${isSelected ? 'bg-accent/20 opacity-50' : 'hover:bg-accent/10'}`}
                          >
                            <div className="flex flex-col min-w-0 flex-1">
                              <div className="font-medium truncate">{bot.name}</div>
                              <div className="text-xs text-muted">
                                {bot.builderDisplayName && <span className="mr-2">by {bot.builderDisplayName}</span>}
                                CAGR: {((metrics?.cagr ?? 0) * 100).toFixed(1)}%
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={isSelected}
                              onClick={() => correlation.addBotId(bot.id)}
                            >
                              +
                            </Button>
                          </div>
                        )
                      })}
                  </div>
                </div>
              </>
            )}
          </div>
        </Card>

        {/* Right Panel: Portfolio Builder */}
        <Card className="flex flex-col min-h-[400px] max-h-[600px]">
          <div className="p-3 border-b border-border flex items-center justify-between">
            <div className="font-bold text-sm">Portfolio Builder</div>
            <div className="flex items-center gap-2">
              {/* Load Watchlist */}
              <Select
                value=""
                onChange={async (e) => {
                  const watchlistId = e.target.value
                  if (!watchlistId) return
                  const watchlist = watchlists.find(w => w.id === watchlistId)
                  if (!watchlist) return
                  // Get bot IDs from watchlist
                  const botIds = watchlist.botIds || []
                  correlation.setSelectedBotIds(botIds)
                }}
                className="text-xs h-7"
              >
                <option value="">Load watchlist...</option>
                {watchlists.map(w => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </Select>
              {/* Save as Watchlist */}
              {correlation.selectedBotIds.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs h-7"
                  onClick={async () => {
                    const name = prompt('Enter watchlist name:')
                    if (!name || !userId) return
                    try {
                      const token = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken')
                      const res = await fetch('/api/watchlists', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify({
                          name,
                          userId,
                          botIds: correlation.selectedBotIds
                        })
                      })
                      if (res.ok) {
                        const data = await res.json()
                        setWatchlists(prev => [...prev, data.watchlist])
                        alert('Portfolio saved as watchlist!')
                      }
                    } catch (err) {
                      console.error('Failed to save watchlist:', err)
                    }
                  }}
                >
                  Save
                </Button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-auto p-2">
            {correlation.selectedBotIds.length === 0 ? (
              <div className="text-sm text-muted p-2">Add systems from the left panels or load a watchlist to build your portfolio.</div>
            ) : (
              <div className="grid gap-3">
                {/* Selected Bots */}
                <div>
                  <div className="text-xs font-bold text-muted mb-2">Selected Systems</div>
                  <div className="grid gap-1">
                    {correlation.selectedBotIds.map(botId => {
                      const bot = savedBots.find(b => b.id === botId) ?? allNexusBots.find(b => b.id === botId)
                      if (!bot) return null
                      const weight = correlation.weights[botId] ?? (100 / correlation.selectedBotIds.length)
                      return (
                        <div key={botId} className="flex items-center justify-between p-2 rounded bg-accent/10 text-sm">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span className="font-medium truncate">{bot.name}</span>
                            <span className="text-xs text-muted">{weight.toFixed(1)}%</span>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => correlation.removeBotId(botId)}
                          >
                            ×
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Loading/Error State */}
                {correlation.loading && (
                  <div className="text-xs text-muted p-2 text-center">
                    Calculating optimal weights...
                  </div>
                )}
                {correlation.error && (
                  <div className="text-xs text-red-500 p-2 bg-red-500/10 rounded">
                    {correlation.error}
                  </div>
                )}

                {/* Correlation Matrix */}
                {correlation.selectedBotIds.length >= 2 && correlation.correlationMatrix && correlation.validBotIds.length >= 2 && (
                  <div>
                    <div className="text-xs font-bold text-muted mb-2">Correlation Matrix</div>
                    <div className="overflow-x-auto">
                      <table className="text-xs w-full">
                        <thead>
                          <tr>
                            <th className="p-1 text-left"></th>
                            {correlation.validBotIds.map(id => {
                              const bot = savedBots.find(b => b.id === id) ?? allNexusBots.find(b => b.id === id)
                              return (
                                <th key={id} className="p-1 text-center font-medium truncate max-w-[60px]" title={bot?.name}>
                                  {bot?.name?.slice(0, 6) ?? id.slice(0, 6)}
                                </th>
                              )
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {correlation.validBotIds.map((rowId, i) => {
                            const rowBot = savedBots.find(b => b.id === rowId) ?? allNexusBots.find(b => b.id === rowId)
                            return (
                              <tr key={rowId}>
                                <td className="p-1 font-medium truncate max-w-[60px]" title={rowBot?.name}>
                                  {rowBot?.name?.slice(0, 6) ?? rowId.slice(0, 6)}
                                </td>
                                {correlation.validBotIds.map((colId, j) => {
                                  const corr = correlation.correlationMatrix?.[i]?.[j] ?? 0
                                  // Color: green (negative/low) -> yellow (0.5) -> red (high positive)
                                  const hue = Math.max(0, 120 - corr * 120) // 120=green, 0=red
                                  const bgColor = i === j ? 'transparent' : `hsl(${hue}, 70%, 85%)`
                                  return (
                                    <td
                                      key={colId}
                                      className="p-1 text-center"
                                      style={{ backgroundColor: bgColor }}
                                    >
                                      {i === j ? '1.00' : corr.toFixed(2)}
                                    </td>
                                  )
                                })}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Portfolio Metrics */}
                <div>
                  <div className="text-xs font-bold text-muted mb-2">Portfolio Metrics</div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-accent/5 p-2 rounded">
                      <div className="text-muted">Expected CAGR</div>
                      <div className="font-bold">
                        {correlation.portfolioMetrics ? `${(correlation.portfolioMetrics.cagr * 100).toFixed(1)}%` : '--'}
                      </div>
                    </div>
                    <div className="bg-accent/5 p-2 rounded">
                      <div className="text-muted">Volatility</div>
                      <div className="font-bold">
                        {correlation.portfolioMetrics ? `${(correlation.portfolioMetrics.volatility * 100).toFixed(1)}%` : '--'}
                      </div>
                    </div>
                    <div className="bg-accent/5 p-2 rounded">
                      <div className="text-muted">Sharpe Ratio</div>
                      <div className="font-bold">
                        {correlation.portfolioMetrics ? correlation.portfolioMetrics.sharpe.toFixed(2) : '--'}
                      </div>
                    </div>
                    <div className="bg-accent/5 p-2 rounded">
                      <div className="text-muted">Max Drawdown</div>
                      <div className="font-bold">
                        {correlation.portfolioMetrics ? `${(correlation.portfolioMetrics.maxDrawdown * 100).toFixed(1)}%` : '--'}
                      </div>
                    </div>
                    <div className="bg-accent/5 p-2 rounded col-span-2">
                      <div className="text-muted">Portfolio Beta</div>
                      <div className="font-bold">
                        {correlation.portfolioMetrics ? correlation.portfolioMetrics.beta.toFixed(2) : '--'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Systems Content
// ─────────────────────────────────────────────────────────────────────────────

interface SystemsContentProps {
  savedBots: SavedBot[]
  analyzeBacktests: Record<string, AnalyzeBacktestState>
  analyzeVisibleBotIds: string[]
  watchlistsByBotId: Map<string, Watchlist[]>
  userId: UserId | null
  userDisplayName: string | null
  isAdmin: boolean
  uiState: UserUiState
  setUiState: Dispatch<SetStateAction<UserUiState>>
  analyzeTickerSort: { column: string; dir: 'asc' | 'desc' }
  setAnalyzeTickerSort: Dispatch<SetStateAction<{ column: string; dir: 'asc' | 'desc' }>>
  analyzeTickerContrib: Record<string, TickerContributionState>
  backtestMode: BacktestMode
  backtestBenchmark: string
  dashboardCash: number
  dashboardInvestmentsWithPnl: InvestmentWithPnl[]
  nexusBuyBotId: string | null
  setNexusBuyBotId: (id: string | null) => void
  nexusBuyAmount: string
  setNexusBuyAmount: (amount: string) => void
  nexusBuyMode: '$' | '%'
  setNexusBuyMode: (mode: '$' | '%') => void
  handleNexusBuy: (botId: string) => Promise<void>
  setAddToWatchlistBotId: (id: string | null) => void
  setAddToWatchlistNewName: (name: string) => void
  removeBotFromWatchlist: (botId: string, watchlistId: string) => Promise<void>
  runAnalyzeBacktest: (bot: SavedBot, force?: boolean) => void
  handleCopyToNew: (bot: SavedBot) => void
  handleOpenSaved: (bot: SavedBot) => void
  handleCopySaved: (bot: SavedBot) => void
  handleDeleteSaved: (id: string) => Promise<void>
  sanityReports: Record<string, SanityReportState>
  runSanityReport: (bot: SavedBot) => void
  benchmarkMetrics: BenchmarkMetricsState
  fetchBenchmarkMetrics: () => Promise<void>
  callChainsById: Map<string, CallChain>
  normalizeNodeForBacktest: (node: FlowNode) => FlowNode
}

function SystemsContent(props: SystemsContentProps) {
  const {
    savedBots,
    analyzeBacktests,
    analyzeVisibleBotIds,
    watchlistsByBotId,
    userId,
    userDisplayName,
    isAdmin,
    uiState,
    setUiState,
    analyzeTickerSort,
    setAnalyzeTickerSort,
    analyzeTickerContrib,
    backtestMode,
    backtestBenchmark,
    dashboardCash,
    dashboardInvestmentsWithPnl,
    nexusBuyBotId,
    setNexusBuyBotId,
    nexusBuyAmount,
    setNexusBuyAmount,
    nexusBuyMode,
    setNexusBuyMode,
    handleNexusBuy,
    setAddToWatchlistBotId,
    setAddToWatchlistNewName,
    removeBotFromWatchlist,
    runAnalyzeBacktest,
    handleCopyToNew,
    handleOpenSaved,
    handleCopySaved,
    handleDeleteSaved,
    sanityReports,
    runSanityReport,
    benchmarkMetrics,
    fetchBenchmarkMetrics,
    callChainsById,
    normalizeNodeForBacktest,
  } = props

  if (analyzeVisibleBotIds.length === 0) {
    return <div className="mt-3 text-muted">No systems in your watchlists yet.</div>
  }

  return (
    <div className="grid gap-3 mt-3">
      {analyzeVisibleBotIds
        .map((id) => savedBots.find((b) => b.id === id))
        .filter((b): b is SavedBot => Boolean(b))
        .map((b) => (
          <BotCard
            key={b.id}
            bot={b}
            analyzeBacktests={analyzeBacktests}
            watchlistsByBotId={watchlistsByBotId}
            userId={userId}
            userDisplayName={userDisplayName}
            isAdmin={isAdmin}
            uiState={uiState}
            setUiState={setUiState}
            analyzeTickerSort={analyzeTickerSort}
            setAnalyzeTickerSort={setAnalyzeTickerSort}
            analyzeTickerContrib={analyzeTickerContrib}
            backtestMode={backtestMode}
            backtestBenchmark={backtestBenchmark}
            dashboardCash={dashboardCash}
            dashboardInvestmentsWithPnl={dashboardInvestmentsWithPnl}
            nexusBuyBotId={nexusBuyBotId}
            setNexusBuyBotId={setNexusBuyBotId}
            nexusBuyAmount={nexusBuyAmount}
            setNexusBuyAmount={setNexusBuyAmount}
            nexusBuyMode={nexusBuyMode}
            setNexusBuyMode={setNexusBuyMode}
            handleNexusBuy={handleNexusBuy}
            setAddToWatchlistBotId={setAddToWatchlistBotId}
            setAddToWatchlistNewName={setAddToWatchlistNewName}
            removeBotFromWatchlist={removeBotFromWatchlist}
            runAnalyzeBacktest={runAnalyzeBacktest}
            handleCopyToNew={handleCopyToNew}
            handleOpenSaved={handleOpenSaved}
            handleCopySaved={handleCopySaved}
            handleDeleteSaved={handleDeleteSaved}
            sanityReports={sanityReports}
            runSanityReport={runSanityReport}
            benchmarkMetrics={benchmarkMetrics}
            fetchBenchmarkMetrics={fetchBenchmarkMetrics}
            callChainsById={callChainsById}
            normalizeNodeForBacktest={normalizeNodeForBacktest}
          />
        ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Bot Card Component
// ─────────────────────────────────────────────────────────────────────────────

interface BotCardProps {
  bot: SavedBot
  analyzeBacktests: Record<string, AnalyzeBacktestState>
  watchlistsByBotId: Map<string, Watchlist[]>
  userId: UserId | null
  userDisplayName: string | null
  isAdmin: boolean
  uiState: UserUiState
  setUiState: Dispatch<SetStateAction<UserUiState>>
  analyzeTickerSort: { column: string; dir: 'asc' | 'desc' }
  setAnalyzeTickerSort: Dispatch<SetStateAction<{ column: string; dir: 'asc' | 'desc' }>>
  analyzeTickerContrib: Record<string, TickerContributionState>
  backtestMode: BacktestMode
  backtestBenchmark: string
  dashboardCash: number
  dashboardInvestmentsWithPnl: InvestmentWithPnl[]
  nexusBuyBotId: string | null
  setNexusBuyBotId: (id: string | null) => void
  nexusBuyAmount: string
  setNexusBuyAmount: (amount: string) => void
  nexusBuyMode: '$' | '%'
  setNexusBuyMode: (mode: '$' | '%') => void
  handleNexusBuy: (botId: string) => Promise<void>
  setAddToWatchlistBotId: (id: string | null) => void
  setAddToWatchlistNewName: (name: string) => void
  removeBotFromWatchlist: (botId: string, watchlistId: string) => Promise<void>
  runAnalyzeBacktest: (bot: SavedBot, force?: boolean) => void
  handleCopyToNew: (bot: SavedBot) => void
  handleOpenSaved: (bot: SavedBot) => void
  handleCopySaved: (bot: SavedBot) => void
  handleDeleteSaved: (id: string) => Promise<void>
  sanityReports: Record<string, SanityReportState>
  runSanityReport: (bot: SavedBot) => void
  benchmarkMetrics: BenchmarkMetricsState
  fetchBenchmarkMetrics: () => Promise<void>
  callChainsById: Map<string, CallChain>
  normalizeNodeForBacktest: (node: FlowNode) => FlowNode
}

function BotCard(props: BotCardProps) {
  const {
    bot: b,
    analyzeBacktests,
    watchlistsByBotId,
    userId,
    userDisplayName,
    isAdmin: _isAdmin,
    uiState,
    setUiState,
    analyzeTickerSort,
    setAnalyzeTickerSort,
    analyzeTickerContrib,
    backtestMode,
    backtestBenchmark,
    dashboardCash,
    dashboardInvestmentsWithPnl,
    nexusBuyBotId,
    setNexusBuyBotId,
    nexusBuyAmount,
    setNexusBuyAmount,
    nexusBuyMode,
    setNexusBuyMode,
    handleNexusBuy,
    setAddToWatchlistBotId,
    setAddToWatchlistNewName,
    removeBotFromWatchlist,
    runAnalyzeBacktest,
    handleCopyToNew,
    handleOpenSaved,
    handleCopySaved,
    handleDeleteSaved,
    sanityReports,
    runSanityReport,
    benchmarkMetrics,
    fetchBenchmarkMetrics,
    callChainsById,
    normalizeNodeForBacktest,
  } = props

  const collapsed = uiState.analyzeCollapsedByBotId[b.id] ?? true
  const analyzeState = analyzeBacktests[b.id]
  const tags = watchlistsByBotId.get(b.id) ?? []

  return (
    <Card className="grid gap-2.5">
      <div className="flex items-center gap-2.5 flex-wrap">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const next = !(uiState.analyzeCollapsedByBotId[b.id] ?? true)
            setUiState((prev) => ({
              ...prev,
              analyzeCollapsedByBotId: { ...prev.analyzeCollapsedByBotId, [b.id]: next },
            }))
            if (!next) runAnalyzeBacktest(b)
          }}
        >
          {collapsed ? 'Expand' : 'Collapse'}
        </Button>
        <div className="font-black">{b.name}</div>
        <Badge variant={b.tags?.includes('Nexus') ? 'default' : b.tags?.includes('Atlas') ? 'default' : 'accent'}>
          {b.tags?.includes('Nexus') ? 'Nexus' : b.tags?.includes('Atlas') ? 'Atlas' : 'Private'}
        </Badge>
        {b.tags?.includes('Nexus Eligible') && (
          <Badge variant="secondary">Nexus Eligible</Badge>
        )}
        <Badge variant="default">{b.builderDisplayName || (b.builderId === userId ? userDisplayName : null) || b.builderId}</Badge>
        <div className="flex gap-1.5 flex-wrap">
          {tags.map((w) => (
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
        <div className="ml-auto flex gap-2 flex-wrap">
          {/* FRD-012: Show Copy to New for published systems, Open in Build for private */}
          {b.builderId === userId && b.visibility !== 'community' && (
            (b.tags?.includes('Nexus') || b.tags?.includes('Atlas')) ? (
              <Button size="sm" onClick={() => handleCopyToNew(b)}>Copy to New System</Button>
            ) : (
              <Button size="sm" onClick={() => handleOpenSaved(b)}>Open in Build</Button>
            )
          )}
          <Button
            size="sm"
            onClick={() => {
              setAddToWatchlistBotId(b.id)
              setAddToWatchlistNewName('')
            }}
          >
            Add to Watchlist
          </Button>
          {/* Only show Copy to clipboard for bot owners (IP protection) */}
          {b.builderId === userId && b.visibility !== 'community' && (
            <Button size="sm" onClick={() => handleCopySaved(b)}>Copy JSON</Button>
          )}
          {/* Only show Delete for bot owners - but NOT for published systems */}
          {b.builderId === userId && !(b.tags?.includes('Nexus') || b.tags?.includes('Atlas')) && (
            <Button variant="destructive" size="sm" onClick={() => handleDeleteSaved(b.id)}>Delete</Button>
          )}
        </div>
      </div>

      {!collapsed && (
        <BotCardContent
          bot={b}
          analyzeState={analyzeState}
          uiState={uiState}
          setUiState={setUiState}
          analyzeTickerSort={analyzeTickerSort}
          setAnalyzeTickerSort={setAnalyzeTickerSort}
          analyzeTickerContrib={analyzeTickerContrib}
          backtestMode={backtestMode}
          backtestBenchmark={backtestBenchmark}
          dashboardCash={dashboardCash}
          dashboardInvestmentsWithPnl={dashboardInvestmentsWithPnl}
          nexusBuyBotId={nexusBuyBotId}
          setNexusBuyBotId={setNexusBuyBotId}
          nexusBuyAmount={nexusBuyAmount}
          setNexusBuyAmount={setNexusBuyAmount}
          nexusBuyMode={nexusBuyMode}
          setNexusBuyMode={setNexusBuyMode}
          handleNexusBuy={handleNexusBuy}
          runAnalyzeBacktest={runAnalyzeBacktest}
          sanityReports={sanityReports}
          runSanityReport={runSanityReport}
          benchmarkMetrics={benchmarkMetrics}
          fetchBenchmarkMetrics={fetchBenchmarkMetrics}
          callChainsById={callChainsById}
          normalizeNodeForBacktest={normalizeNodeForBacktest}
        />
      )}
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Bot Card Content (when expanded)
// ─────────────────────────────────────────────────────────────────────────────

interface BotCardContentProps {
  bot: SavedBot
  analyzeState: AnalyzeBacktestState | undefined
  uiState: UserUiState
  setUiState: Dispatch<SetStateAction<UserUiState>>
  analyzeTickerSort: { column: string; dir: 'asc' | 'desc' }
  setAnalyzeTickerSort: Dispatch<SetStateAction<{ column: string; dir: 'asc' | 'desc' }>>
  analyzeTickerContrib: Record<string, TickerContributionState>
  backtestMode: BacktestMode
  backtestBenchmark: string
  dashboardCash: number
  dashboardInvestmentsWithPnl: InvestmentWithPnl[]
  nexusBuyBotId: string | null
  setNexusBuyBotId: (id: string | null) => void
  nexusBuyAmount: string
  setNexusBuyAmount: (amount: string) => void
  nexusBuyMode: '$' | '%'
  setNexusBuyMode: (mode: '$' | '%') => void
  handleNexusBuy: (botId: string) => Promise<void>
  runAnalyzeBacktest: (bot: SavedBot, force?: boolean) => void
  sanityReports: Record<string, SanityReportState>
  runSanityReport: (bot: SavedBot) => void
  benchmarkMetrics: BenchmarkMetricsState
  fetchBenchmarkMetrics: () => Promise<void>
  callChainsById: Map<string, CallChain>
  normalizeNodeForBacktest: (node: FlowNode) => FlowNode
}

function BotCardContent(props: BotCardContentProps) {
  const {
    bot: b,
    analyzeState,
    uiState,
    setUiState,
    analyzeTickerSort,
    setAnalyzeTickerSort,
    analyzeTickerContrib,
    backtestMode,
    backtestBenchmark,
    dashboardCash,
    dashboardInvestmentsWithPnl,
    nexusBuyBotId,
    setNexusBuyBotId,
    nexusBuyAmount,
    setNexusBuyAmount,
    nexusBuyMode,
    setNexusBuyMode,
    handleNexusBuy,
    runAnalyzeBacktest,
    sanityReports,
    runSanityReport,
    benchmarkMetrics,
    fetchBenchmarkMetrics,
    callChainsById,
    normalizeNodeForBacktest,
  } = props

  const currentTab = uiState.analyzeBotCardTab[b.id] ?? 'overview'

  return (
    <div className="flex flex-col gap-2.5 w-full">
      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-border pb-2">
        <Button
          size="sm"
          variant={currentTab === 'overview' ? 'default' : 'outline'}
          onClick={() => setUiState((prev) => ({
            ...prev,
            analyzeBotCardTab: { ...prev.analyzeBotCardTab, [b.id]: 'overview' },
          }))}
        >
          Overview
        </Button>
        <Button
          size="sm"
          variant={currentTab === 'advanced' ? 'default' : 'outline'}
          onClick={() => setUiState((prev) => ({
            ...prev,
            analyzeBotCardTab: { ...prev.analyzeBotCardTab, [b.id]: 'advanced' },
          }))}
        >
          Benchmarks
        </Button>
        <Button
          size="sm"
          variant={currentTab === 'robustness' ? 'default' : 'outline'}
          onClick={() => setUiState((prev) => ({
            ...prev,
            analyzeBotCardTab: { ...prev.analyzeBotCardTab, [b.id]: 'robustness' },
          }))}
        >
          Robustness
        </Button>
      </div>

      {/* Overview Tab Content */}
      {currentTab === 'overview' && (
        <OverviewTabContent
          bot={b}
          analyzeState={analyzeState}
          uiState={uiState}
          analyzeTickerSort={analyzeTickerSort}
          setAnalyzeTickerSort={setAnalyzeTickerSort}
          analyzeTickerContrib={analyzeTickerContrib}
          backtestMode={backtestMode}
          backtestBenchmark={backtestBenchmark}
          dashboardCash={dashboardCash}
          dashboardInvestmentsWithPnl={dashboardInvestmentsWithPnl}
          nexusBuyBotId={nexusBuyBotId}
          setNexusBuyBotId={setNexusBuyBotId}
          nexusBuyAmount={nexusBuyAmount}
          setNexusBuyAmount={setNexusBuyAmount}
          nexusBuyMode={nexusBuyMode}
          setNexusBuyMode={setNexusBuyMode}
          handleNexusBuy={handleNexusBuy}
          runAnalyzeBacktest={runAnalyzeBacktest}
          callChainsById={callChainsById}
          normalizeNodeForBacktest={normalizeNodeForBacktest}
        />
      )}

      {/* Advanced Tab Content */}
      {currentTab === 'advanced' && (
        <AdvancedTabContent
          bot={b}
          sanityReports={sanityReports}
          runSanityReport={runSanityReport}
          benchmarkMetrics={benchmarkMetrics}
          fetchBenchmarkMetrics={fetchBenchmarkMetrics}
        />
      )}

      {/* Robustness Tab Content */}
      {currentTab === 'robustness' && (
        <RobustnessTabContent
          bot={b}
          sanityReports={sanityReports}
          runSanityReport={runSanityReport}
        />
      )}
    </div>
  )
}

// The remaining tab content components (OverviewTabContent, AdvancedTabContent, RobustnessTabContent)
// are very large and will be imported from separate files to keep this file manageable.
// For now, we'll implement them inline to complete the extraction.

import { OverviewTabContent } from './OverviewTabContent'
import { AdvancedTabContent } from './AdvancedTabContent'
import { RobustnessTabContent } from './RobustnessTabContent'
