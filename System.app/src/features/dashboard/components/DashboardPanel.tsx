// src/features/dashboard/components/DashboardPanel.tsx
// Dashboard tab component - displays portfolio, investments, and partner program

import { type Dispatch, type SetStateAction, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { BacktestModeTag } from '@/components/ui/BacktestModeTag'
import { cn } from '@/lib/utils'
import { formatPct, formatUsd, formatSignedUsd } from '@/shared/utils'
import { EquityChart, DrawdownChart } from '@/features/backtest'
import { DashboardEquityChart } from './DashboardEquityChart'
import { PartnerTBillChart } from './PartnerTBillChart'
import { UnallocatedPositionsTable } from './UnallocatedPositionsTable'
import { SellPositionModal, type SellOrder } from './SellPositionModal'
import { useAuthStore, useUIStore, useBotStore, useBacktestStore, useDashboardStore } from '@/stores'
import type {
  SavedBot,
  UserId,
  UserUiState,
  Watchlist,
  DashboardTimePeriod,
  EquityCurvePoint,
  FundZones,
  EligibilityRequirement,
} from '@/types'
import type { BotReturnSeries } from '../types'
import type { InvestmentWithPnl } from '../hooks/useDashboardInvestments'
import type { UTCTimestamp } from 'lightweight-charts'
import type { PortfolioMode } from '@/types'
import { useAlpacaPortfolio } from '../hooks'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const BOT_CHART_COLORS = ['#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1']

const METRIC_LABELS: Record<string, string> = {
  cagr: 'CAGR',
  maxDrawdown: 'Max Drawdown',
  sharpe: 'Sharpe Ratio',
  calmar: 'Calmar Ratio',
  sortino: 'Sortino Ratio',
  winRate: 'Win Rate',
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DashboardPanelProps {
  // UI state (persisted to API - kept as prop for now)
  uiState: UserUiState
  setUiState: Dispatch<SetStateAction<UserUiState>>

  // Computed/derived dashboard values (computed in App.tsx)
  eligibleBots: SavedBot[]
  dashboardCash: number
  dashboardTotalValue: number
  dashboardTotalPnl: number
  dashboardTotalPnlPct: number
  dashboardInvestmentsWithPnl: InvestmentWithPnl[]
  dashboardEquityCurve: EquityCurvePoint[]
  dashboardBotSeries: BotReturnSeries[]

  // Action callbacks
  handleDashboardBuy: () => Promise<void>
  handleDashboardSell: (botId: string, sellAll: boolean) => Promise<void>
  handleDashboardBuyMore: (botId: string) => Promise<void>
  handleNexusBuy: (botId: string) => Promise<void>
  runAnalyzeBacktest: (bot: SavedBot, force?: boolean) => void
  runSanityReport: (bot: SavedBot) => void
  updateBotInApi: (userId: UserId, bot: SavedBot) => Promise<boolean>
  handleCopyToNew: (bot: SavedBot) => void
  handleOpenSaved: (bot: SavedBot) => void

  // Helpers
  getFundSlotForBot: (botId: string) => number | null

  // Eligibility requirements
  appEligibilityRequirements: EligibilityRequirement[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function DashboardPanel(props: DashboardPanelProps) {
  const {
    // UI state (from props - persisted to API)
    uiState,
    setUiState,

    // Computed/derived dashboard values
    eligibleBots,
    dashboardCash,
    dashboardTotalValue,
    dashboardTotalPnl,
    dashboardTotalPnlPct,
    dashboardInvestmentsWithPnl,
    dashboardEquityCurve,
    dashboardBotSeries,

    // Action callbacks
    handleDashboardBuy,
    handleDashboardSell,
    handleDashboardBuyMore,
    handleNexusBuy,
    runAnalyzeBacktest,
    runSanityReport,
    updateBotInApi,
    handleCopyToNew,
    handleOpenSaved,

    // Helpers
    getFundSlotForBot,

    // Eligibility requirements
    appEligibilityRequirements,
  } = props

  // --- Zustand stores ---
  // Auth store
  const { userId, userDisplayName } = useAuthStore()

  // UI store
  const {
    dashboardSubtab,
    setDashboardSubtab,
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
  const { savedBots, allNexusBots, watchlists } = useBotStore()

  // Backtest store
  const { analyzeBacktests, sanityReports, backtestBenchmark } = useBacktestStore()

  // Dashboard store
  const {
    dashboardPortfolio,
    dashboardTimePeriod,
    setDashboardTimePeriod,
    dashboardBotExpanded,
    setDashboardBotExpanded,
    dashboardUnallocatedExpanded,
    setDashboardUnallocatedExpanded,
    dashboardBuyBotId,
    setDashboardBuyBotId,
    dashboardBuyBotSearch,
    setDashboardBuyBotSearch,
    dashboardBuyBotDropdownOpen,
    setDashboardBuyBotDropdownOpen,
    dashboardBuyAmount,
    setDashboardBuyAmount,
    dashboardBuyMode,
    setDashboardBuyMode,
    dashboardSellBotId,
    setDashboardSellBotId,
    dashboardSellAmount,
    setDashboardSellAmount,
    dashboardSellMode,
    setDashboardSellMode,
    dashboardBuyMoreBotId,
    setDashboardBuyMoreBotId,
    dashboardBuyMoreAmount,
    setDashboardBuyMoreAmount,
    dashboardBuyMoreMode,
    setDashboardBuyMoreMode,
  } = useDashboardStore()

  // Portfolio mode from UI state (persisted)
  const portfolioMode: PortfolioMode = uiState.portfolioMode || 'simulated'
  const setPortfolioMode = (mode: PortfolioMode) => {
    setUiState((prev) => ({ ...(prev || {}), portfolioMode: mode }))
  }

  // Alpaca/Paper Trading hook - always enabled so we can check if credentials exist
  const alpaca = useAlpacaPortfolio({
    portfolioMode,
    timePeriod: dashboardTimePeriod,
    enabled: true, // Always enabled to check broker status for toggle button
  })

  // Bulk sell modal state for unallocated positions
  const [isBulkSellModalOpen, setIsBulkSellModalOpen] = useState(false)

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

  // Memoize current time to avoid impure Date.now() calls during render
  // eslint-disable-next-line react-hooks/purity -- Date.now() is intentionally captured once at mount
  const now = useMemo(() => Date.now(), [])

  // Convert Alpaca history to chart format
  const alpacaEquityCurve = useMemo((): EquityCurvePoint[] => {
    if (!alpaca.history || alpaca.history.length === 0) return []
    return alpaca.history.map((h) => ({
      time: Math.floor(h.timestamp / 1000) as UTCTimestamp, // Convert ms to seconds
      value: h.equity,
    }))
  }, [alpaca.history])

  return (
    <Card className="h-full flex flex-col overflow-hidden m-4">
      <CardContent className="p-4 flex flex-col h-full overflow-auto">
        <div className="flex gap-2.5 items-center flex-wrap">
          {(['Portfolio', 'Partner Program'] as const).map((t) => (
            <button
              key={t}
              className={`tab-btn ${dashboardSubtab === t ? 'active' : ''}`}
              onClick={() => setDashboardSubtab(t)}
            >
              {t}
            </button>
          ))}
        </div>

        {dashboardSubtab === 'Portfolio' ? (
          <div className="mt-3 flex flex-col gap-4">
            {/* 6 Stat Bubbles - Alpaca Data (Live or Paper) */}
            <div className="grid grid-cols-6 gap-3">
              <Card className="p-3 text-center">
                <div className="text-[10px] font-bold text-muted">Equity</div>
                <div className="text-lg font-black">{alpaca.account ? formatUsd(alpaca.account.equity) : '—'}</div>
              </Card>
              <Card className="p-3 text-center">
                <div className="text-[10px] font-bold text-muted">Cash</div>
                <div className="text-lg font-black">{alpaca.account ? formatUsd(alpaca.account.cash) : '—'}</div>
              </Card>
              <Card className="p-3 text-center">
                <div className="text-[10px] font-bold text-muted">Unrealized P&L</div>
                {(() => {
                  const totalPl = alpaca.positions.reduce((sum, p) => sum + p.unrealizedPl, 0)
                  return (
                    <div className={cn("text-lg font-black", totalPl >= 0 ? 'text-success' : 'text-danger')}>
                      {formatSignedUsd(totalPl)}
                    </div>
                  )
                })()}
              </Card>
              <Card className="p-3 text-center">
                <div className="text-[10px] font-bold text-muted">Buying Power</div>
                <div className="text-lg font-black">{alpaca.account ? formatUsd(alpaca.account.buyingPower) : '—'}</div>
              </Card>
              <Card className="p-3 text-center">
                <div className="text-[10px] font-bold text-muted">Market Value</div>
                <div className="text-lg font-black">
                  {formatUsd(alpaca.positions.reduce((sum, p) => sum + p.marketValue, 0))}
                </div>
              </Card>
              <Card className="p-3 text-center">
                <div className="text-[10px] font-bold text-muted">Positions</div>
                <div className="text-lg font-black">{alpaca.positions.length}</div>
              </Card>
            </div>

            {/* Full-Width Portfolio Performance Chart */}
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-4">
                  <div className="font-black">Portfolio Performance</div>
                  {/* Mode Toggle - Live vs Paper Trading */}
                  <div className="flex gap-1 bg-muted/30 rounded-lg p-1">
                    <Button
                      size="sm"
                      variant={portfolioMode === 'live' ? 'accent' : 'ghost'}
                      className="h-6 px-3 text-xs"
                      onClick={() => setPortfolioMode('live')}
                    >
                      Live
                    </Button>
                    <Button
                      size="sm"
                      variant={portfolioMode === 'paper' ? 'accent' : 'ghost'}
                      className="h-6 px-3 text-xs"
                      onClick={() => setPortfolioMode('paper')}
                    >
                      Paper
                    </Button>
                  </div>
                  {/* Connection status indicator */}
                  {(portfolioMode === 'paper' || portfolioMode === 'live') && (
                    <div className={cn(
                      "flex items-center gap-1.5 text-xs",
                      alpaca.isConnected ? "text-emerald-500" : "text-amber-500"
                    )}>
                      <div className={cn(
                        "w-2 h-2 rounded-full shrink-0",
                        alpaca.isConnected ? "bg-emerald-500" : "bg-amber-500",
                        alpaca.isLoading && "animate-pulse"
                      )} />
                      {alpaca.isLoading ? 'Loading...' : alpaca.isConnected ? 'Connected' : (
                        <div className="flex flex-col">
                          <span>Disconnected</span>
                          {alpaca.errorMessage && (
                            <span className="text-[10px] text-muted-foreground mt-0.5">
                              {alpaca.errorMessage}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex gap-1">
                  {(['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y', 'ALL'] as DashboardTimePeriod[]).map((period) => (
                    <Button
                      key={period}
                      size="sm"
                      variant={dashboardTimePeriod === period ? 'accent' : 'ghost'}
                      className="h-6 px-2 text-xs"
                      onClick={() => setDashboardTimePeriod(period)}
                    >
                      {period}
                    </Button>
                  ))}
                </div>
              </div>
              <DashboardEquityChart
                portfolioData={alpacaEquityCurve}
                botSeries={[]}
                theme={uiState.theme}
              />
            </Card>

            {/* Bottom Zone: Buy System + Invested Systems (left 2/3) | Portfolio Allocation (right 1/3) */}
            <div className="grid grid-cols-3 gap-4">
              {/* Left Panel: Alpaca Positions (Live or Paper) */}
              <Card className="col-span-2 p-4">
                {(portfolioMode === 'paper' || portfolioMode === 'live') ? (
                  /* Live/Paper Trading Mode - Show Unallocated, Buy System, and Invested Systems */
                  (() => {
                    // Calculate total invested (dollar amounts only) to show adjusted available cash
                    const totalInvestedDollars = alpaca.investments
                      .filter(inv => inv.weightMode === 'dollars')
                      .reduce((sum, inv) => sum + inv.investmentAmount, 0)

                    // Available cash = Alpaca cash minus reserved investment amounts
                    const availableCash = (alpaca.account?.cash ?? 0) - totalInvestedDollars

                    return (
                  <>
                    {/* Section 1: Buy System (using Alpaca cash) */}
                    <div className="font-black mb-3">Buy System</div>
                    <div className="grid gap-2 mb-4">
                      {/* Cash available line */}
                      <div className="text-sm">
                        <span className="text-muted">Cash Available:</span>{' '}
                        <span className="font-bold">{formatUsd(availableCash)}</span>
                        {totalInvestedDollars > 0 && (
                          <span className="text-muted ml-2">(${formatUsd(totalInvestedDollars).replace('$', '')} reserved for investments)</span>
                        )}
                        {dashboardBuyMode === '%' && dashboardBuyAmount && (
                          <span className="text-muted"> · Amount: {formatUsd((parseFloat(dashboardBuyAmount) / 100) * availableCash)}</span>
                        )}
                      </div>

                      {/* Buy button, $/% toggle, amount input */}
                      <div className="flex gap-2 items-center">
                        <Button
                          onClick={async () => {
                            if (!dashboardBuyBotId || !dashboardBuyAmount) return
                            const amount = dashboardBuyMode === '%'
                              ? (parseFloat(dashboardBuyAmount) / 100) * availableCash
                              : parseFloat(dashboardBuyAmount)
                            if (amount > availableCash) {
                              console.warn('[Dashboard] Investment amount exceeds available cash')
                              return
                            }
                            const success = await alpaca.addInvestment(dashboardBuyBotId, amount, dashboardBuyMode === '%' ? 'percent' : 'dollars')
                            if (success) {
                              setDashboardBuyBotId('')
                              setDashboardBuyBotSearch('')
                              setDashboardBuyAmount('')
                            }
                          }}
                          disabled={!dashboardBuyBotId || !dashboardBuyAmount || !alpaca.isConnected || availableCash <= 0}
                          className="h-8 px-4"
                        >
                          Invest
                        </Button>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant={dashboardBuyMode === '$' ? 'accent' : 'outline'}
                            className="h-8 w-8 p-0"
                            onClick={() => setDashboardBuyMode('$')}
                          >
                            $
                          </Button>
                          <Button
                            size="sm"
                            variant={dashboardBuyMode === '%' ? 'accent' : 'outline'}
                            className="h-8 w-8 p-0"
                            onClick={() => setDashboardBuyMode('%')}
                          >
                            %
                          </Button>
                        </div>
                        <Input
                          type="number"
                          placeholder={dashboardBuyMode === '$' ? 'Amount' : '% of cash'}
                          value={dashboardBuyAmount}
                          onChange={(e) => setDashboardBuyAmount(e.target.value)}
                          className="h-8 flex-1"
                        />
                      </div>

                      {/* System selector with search */}
                      <div className="relative">
                        <Input
                          type="text"
                          placeholder="Search and select a system..."
                          value={dashboardBuyBotSearch}
                          onChange={(e) => {
                            setDashboardBuyBotSearch(e.target.value)
                            setDashboardBuyBotDropdownOpen(true)
                          }}
                          onFocus={() => setDashboardBuyBotDropdownOpen(true)}
                          className="h-8 w-full"
                        />
                        {dashboardBuyBotDropdownOpen && (
                          <>
                            <div
                              className="fixed inset-0 z-[199]"
                              onClick={() => setDashboardBuyBotDropdownOpen(false)}
                            />
                            <div className="absolute top-full left-0 right-0 z-[200] mt-1 max-h-48 overflow-y-auto bg-card border border-border rounded-md shadow-lg">
                              {(() => {
                                // Filter out bots already invested in
                                const investedBotIds = new Set(alpaca.investments.map(inv => inv.botId))
                                const availableBots = eligibleBots.filter(
                                  (bot) => !investedBotIds.has(bot.id)
                                )
                                const searchLower = dashboardBuyBotSearch.toLowerCase()
                                const filteredBots = availableBots.filter(
                                  (bot) =>
                                    bot.name.toLowerCase().includes(searchLower) ||
                                    bot.tags?.some((t) => t.toLowerCase().includes(searchLower))
                                )

                                if (filteredBots.length === 0) {
                                  return (
                                    <div className="px-3 py-2 text-sm text-muted">
                                      {availableBots.length === 0
                                        ? 'No eligible systems available'
                                        : 'No matching systems found'}
                                    </div>
                                  )
                                }

                                return filteredBots.map((bot) => (
                                  <div
                                    key={bot.id}
                                    className={cn(
                                      'px-3 py-2 text-sm cursor-pointer hover:bg-muted/50',
                                      dashboardBuyBotId === bot.id && 'bg-muted'
                                    )}
                                    onClick={() => {
                                      setDashboardBuyBotId(bot.id)
                                      setDashboardBuyBotSearch(bot.name)
                                      setDashboardBuyBotDropdownOpen(false)
                                    }}
                                  >
                                    <div className="font-bold">{bot.name}</div>
                                    {bot.tags && bot.tags.length > 0 && (
                                      <div className="text-xs text-muted">{bot.tags.join(', ')}</div>
                                    )}
                                  </div>
                                ))
                              })()}
                            </div>
                          </>
                        )}
                        {dashboardBuyBotId && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0 text-muted hover:text-foreground"
                            onClick={() => {
                              setDashboardBuyBotId('')
                              setDashboardBuyBotSearch('')
                            }}
                          >
                            ×
                          </Button>
                        )}
                      </div>

                      {eligibleBots.length === 0 && (
                        <div className="text-xs text-muted">
                          No eligible systems. Your private systems or systems tagged "Atlas"/"Nexus" will appear here.
                        </div>
                      )}
                    </div>

                    {/* Divider */}
                    <div className="border-t border-border my-3" />

                    {/* Section 2: Systems Invested In - Full expandable cards like simulated mode */}
                    {(() => {
                      // Calculate unallocated totals
                      const unallocatedValue = alpaca.unallocatedPositions.reduce((sum, pos) =>
                        sum + (pos.unallocatedQty * pos.currentPrice), 0)
                      const unallocatedCostBasis = alpaca.unallocatedPositions.reduce((sum, pos) =>
                        sum + (pos.unallocatedQty * pos.avgEntryPrice), 0)
                      const unallocatedPnl = unallocatedValue - unallocatedCostBasis
                      const unallocatedPnlPct = unallocatedCostBasis > 0
                        ? (unallocatedPnl / unallocatedCostBasis) * 100
                        : 0

                      // Create synthetic unallocated "bot" investment
                      const syntheticUnallocated = alpaca.unallocatedPositions.length > 0 ? {
                        id: -1,
                        botId: '__UNALLOCATED__',
                        botName: `Unallocated Positions (${alpaca.unallocatedPositions.length})`,
                        investmentAmount: unallocatedValue,
                        weightMode: 'dollars' as const,
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                        // Extended properties for display
                        _synthetic: true,
                        _costBasis: unallocatedCostBasis,
                        _currentValue: unallocatedValue,
                        _pnl: unallocatedPnl,
                        _pnlPct: unallocatedPnlPct,
                      } : null

                      // Prepend to investments array
                      const allInvestments = syntheticUnallocated
                        ? [syntheticUnallocated, ...alpaca.investments]
                        : alpaca.investments

                      return (
                        <>
                          <div className="font-black mb-3">Systems Invested In ({allInvestments.length})</div>
                          {allInvestments.length === 0 ? (
                            <div className="text-muted text-center py-4">No investments yet. Use "Buy System" above to invest in a trading bot.</div>
                          ) : (
                            <div className="flex flex-col gap-2.5">
                              {allInvestments.map((inv, idx) => {
                                const isSyntheticUnallocated = inv.botId === '__UNALLOCATED__'

                                // Find bot info (not applicable for synthetic)
                                const b = isSyntheticUnallocated ? null : (savedBots.find((bot) => bot.id === inv.botId) ?? allNexusBots.find((bot) => bot.id === inv.botId))

                                // Use slate/gray color for unallocated, cycle through BOT_CHART_COLORS for regular bots
                                const botColor = isSyntheticUnallocated
                                  ? '#94a3b8' // slate-400
                                  : BOT_CHART_COLORS[(idx - 1) % BOT_CHART_COLORS.length] // Offset by 1 since unallocated takes first slot

                                const isExpanded = dashboardBotExpanded?.[inv.botId] ?? false
                                const isBuyingMore = dashboardBuyMoreBotId === inv.botId
                                const analyzeState = analyzeBacktests[inv.botId]
                                const wlTags = watchlistsByBotId.get(inv.botId) ?? []

                                // For synthetic unallocated, use pre-calculated values; otherwise calculate from ledger
                                let displayCostBasis: number
                                let displayCurrentValue: number
                                let pnl: number
                                let pnlPercent: number
                                let hasPositions: boolean
                                let allocation: number

                                if (isSyntheticUnallocated) {
                                  // Use pre-calculated values for synthetic unallocated
                                  displayCostBasis = inv._costBasis
                                  displayCurrentValue = inv._currentValue
                                  pnl = inv._pnl
                                  pnlPercent = inv._pnlPct
                                  hasPositions = alpaca.unallocatedPositions.length > 0
                                  const totalEquity = alpaca.account?.equity ?? 0
                                  allocation = totalEquity > 0 ? (displayCurrentValue / totalEquity) * 100 : 0
                                } else {
                                  // Get positions attributed to this bot from ledger
                                  const botPositions = alpaca.positionLedger.filter(l => l.botId === inv.botId)
                                  hasPositions = botPositions.length > 0

                                  // Calculate P&L from actual Alpaca positions (position-based)
                                  const costBasis = botPositions.reduce((sum, l) => sum + (l.shares * l.avgPrice), 0)
                                  const currentValue = botPositions.reduce((sum, l) => {
                                    const pos = alpaca.positions.find(p => p.symbol === l.symbol)
                                    return sum + (pos ? l.shares * pos.currentPrice : 0)
                                  }, 0)

                                  // If no positions yet, use investment amount as placeholder
                                  displayCostBasis = hasPositions ? costBasis : inv.investmentAmount
                                  displayCurrentValue = hasPositions ? currentValue : inv.investmentAmount
                                  pnl = displayCurrentValue - displayCostBasis
                                  pnlPercent = displayCostBasis > 0 ? (pnl / displayCostBasis) * 100 : 0

                                  // Calculate allocation as percentage of total portfolio
                                  const totalEquity = alpaca.account?.equity ?? 0
                                  allocation = totalEquity > 0 ? (displayCurrentValue / totalEquity) * 100 : 0
                                }

                                // Use anonymized display name for Nexus bots from other users (not for synthetic)
                                const displayName = isSyntheticUnallocated
                                  ? inv.botName
                                  : (() => {
                                      const fundSlot = b?.fundSlot ?? getFundSlotForBot(inv.botId)
                                      const builderName = b?.builderDisplayName || (b?.builderId === userId ? userDisplayName : null) || b?.builderId
                                      return b?.tags?.includes('Nexus') && b?.builderId !== userId && fundSlot
                                        ? `${builderName}'s Fund #${fundSlot}`
                                        : b?.tags?.includes('Nexus') && b?.builderId !== userId
                                          ? `${builderName}'s Fund`
                                          : inv.botName || b?.name || inv.botId
                                    })()

                                const toggleCollapse = () => {
                                  const next = !isExpanded
                                  setDashboardBotExpanded((prev) => ({ ...(prev || {}), [inv.botId]: next }))
                                  // Run backtest if expanding and not already done (not for synthetic)
                                  if (next && b && !isSyntheticUnallocated) {
                                    if (!analyzeState || analyzeState.status === 'idle' || analyzeState.status === 'error') {
                                      runAnalyzeBacktest(b)
                                    }
                                  }
                                }

                          return (
                            <Card key={inv.botId} className="grid gap-2.5">
                              <div className="flex items-center gap-2.5 flex-wrap">
                                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: botColor }} />
                                <Button variant="ghost" size="sm" onClick={toggleCollapse}>
                                  {isExpanded ? 'Collapse' : 'Expand'}
                                </Button>
                                {!isSyntheticUnallocated && b?.backtestMode && <BacktestModeTag mode={b.backtestMode} />}
                                <div className="font-black">{displayName}</div>

                                {isSyntheticUnallocated ? (
                                  // Synthetic unallocated card badges
                                  <Badge variant="default" className="bg-slate-600/20 text-slate-400 border-slate-600/30">
                                    Not Traded by Scheduler
                                  </Badge>
                                ) : (
                                  // Regular bot badges
                                  <>
                                    <Badge variant={b?.tags?.includes('Nexus') ? 'default' : b?.tags?.includes('Atlas') ? 'default' : 'accent'}>
                                      {b?.tags?.includes('Nexus') ? 'Nexus' : b?.tags?.includes('Atlas') ? 'Atlas' : 'Private'}
                                    </Badge>
                                    {/* Investment amount badge */}
                                    <Badge variant="accent" className="text-xs">
                                      {inv.weightMode === 'percent' ? `${inv.investmentAmount}%` : formatUsd(inv.investmentAmount)}
                                    </Badge>
                                    {/* Pending status badge when no positions yet */}
                                    {!hasPositions && (
                                      <Badge variant="default" className="text-xs bg-amber-600/20 text-amber-500 border-amber-600/30">
                                        Pending - Next Trade Window
                                      </Badge>
                                    )}
                                    {(b?.builderDisplayName || b?.builderId) && <Badge variant="default">{b?.builderDisplayName || (b?.builderId === userId ? userDisplayName : null) || b?.builderId}</Badge>}
                                    <div className="flex gap-1.5 flex-wrap">
                                      {wlTags.map((w) => (
                                        <Badge key={w.id} variant="accent" className="gap-1.5">
                                          {w.name}
                                        </Badge>
                                      ))}
                                    </div>
                                  </>
                                )}

                                <div className="ml-auto flex items-center gap-2.5 flex-wrap">
                                  {/* Show P&L for both synthetic and regular */}
                                  {hasPositions && (
                                    <>
                                      <div className="text-sm text-muted">
                                        {formatUsd(displayCostBasis)} → {formatUsd(displayCurrentValue)}
                                      </div>
                                      <div className={cn("font-bold min-w-[80px] text-right", pnl >= 0 ? 'text-success' : 'text-danger')}>
                                        {formatSignedUsd(pnl)} ({pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(1)}%)
                                      </div>
                                    </>
                                  )}

                                  {isSyntheticUnallocated ? (
                                    // Synthetic unallocated: Show only Sell button
                                    <Button
                                      size="sm"
                                      variant="destructive"
                                      onClick={() => setIsBulkSellModalOpen(true)}
                                    >
                                      Sell
                                    </Button>
                                  ) : (
                                    // Regular bot: Show Buy More and Remove buttons
                                    <>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                          setDashboardBuyMoreBotId(isBuyingMore ? null : inv.botId)
                                        }}
                                      >
                                        Buy More
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="destructive"
                                        onClick={() => alpaca.removeInvestment(inv.botId)}
                                      >
                                        Remove
                                      </Button>
                                    </>
                                  )}
                                </div>
                              </div>

                              {/* Buy More inline form */}
                              {isBuyingMore && (
                                <div className="pt-3 border-t border-border flex gap-2 items-center flex-wrap">
                                  <div className="flex gap-1">
                                    <Button
                                      size="sm"
                                      variant={dashboardBuyMoreMode === '$' ? 'accent' : 'outline'}
                                      className="h-8 w-8 p-0"
                                      onClick={() => setDashboardBuyMoreMode('$')}
                                    >
                                      $
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant={dashboardBuyMoreMode === '%' ? 'accent' : 'outline'}
                                      className="h-8 w-8 p-0"
                                      onClick={() => setDashboardBuyMoreMode('%')}
                                    >
                                      %
                                    </Button>
                                  </div>
                                  <Input
                                    type="number"
                                    placeholder={dashboardBuyMoreMode === '$' ? 'Amount' : '% of cash'}
                                    value={dashboardBuyMoreAmount}
                                    onChange={(e) => setDashboardBuyMoreAmount(e.target.value)}
                                    className="h-8 w-32"
                                  />
                                  <Button
                                    size="sm"
                                    variant="default"
                                    onClick={async () => {
                                      const amount = dashboardBuyMoreMode === '%'
                                        ? (parseFloat(dashboardBuyMoreAmount) / 100) * availableCash
                                        : parseFloat(dashboardBuyMoreAmount)
                                      if (isNaN(amount) || amount <= 0) return
                                      if (amount > availableCash) {
                                        console.warn('[Dashboard] Buy More amount exceeds available cash')
                                        return
                                      }
                                      const success = await alpaca.addInvestment(inv.botId, inv.investmentAmount + amount, 'dollars')
                                      if (success) {
                                        setDashboardBuyMoreBotId(null)
                                        setDashboardBuyMoreAmount('')
                                      }
                                    }}
                                  >
                                    Buy More
                                  </Button>
                                  <span className="text-sm text-muted">Cash: {formatUsd(availableCash)}</span>
                                </div>
                              )}

                              {/* Expanded view - different content for synthetic vs regular */}
                              {isExpanded && !isBuyingMore && (
                                isSyntheticUnallocated ? (
                                  // Synthetic unallocated expanded view: Show UnallocatedPositionsTable
                                  <div className="mt-3">
                                    <UnallocatedPositionsTable
                                      positions={alpaca.unallocatedPositions}
                                      credentialType={portfolioMode === 'live' ? 'live' : 'paper'}
                                      onSellComplete={() => alpaca.refetch()}
                                    />
                                  </div>
                                ) : (
                                  // Regular bot expanded view: Show backtest stats
                                  <div className="flex flex-col gap-2.5 w-full">
                                    <div className="saved-item grid grid-cols-1 gap-3.5 h-full w-full min-w-0 overflow-hidden items-stretch justify-items-stretch">
                                      {analyzeState?.status === 'loading' ? (
                                      <div className="text-muted">Running backtest…</div>
                                    ) : analyzeState?.status === 'error' ? (
                                      <div className="grid gap-2">
                                        <div className="text-muted">{analyzeState.error ?? 'Failed to run backtest.'}</div>
                                        {b?.payload && <Button onClick={() => runAnalyzeBacktest(b)}>Retry</Button>}
                                      </div>
                                    ) : analyzeState?.status === 'done' ? (
                                      <div className="grid grid-cols-1 gap-2.5 min-w-0 w-full">
                                        {/* Live Stats - show pending message or actual stats */}
                                        <div className="base-stats-card w-full min-w-0 max-w-full flex flex-col items-stretch text-center">
                                          <div className="font-black mb-2 text-center">Live Stats</div>
                                          {hasPositions ? (
                                            <div className="grid grid-cols-4 gap-2.5 justify-items-center w-full">
                                              <div>
                                                <div className="stat-label">Allocation</div>
                                                <div className="stat-value">{allocation.toFixed(1)}%</div>
                                              </div>
                                              <div>
                                                <div className="stat-label">Cost Basis</div>
                                                <div className="stat-value">{formatUsd(displayCostBasis)}</div>
                                              </div>
                                              <div>
                                                <div className="stat-label">Current Value</div>
                                                <div className="stat-value">{formatUsd(displayCurrentValue)}</div>
                                              </div>
                                              <div>
                                                <div className="stat-label">P&L</div>
                                                <div className={cn("stat-value", pnl >= 0 ? 'text-success' : 'text-danger')}>
                                                  {formatSignedUsd(pnl)} ({pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(1)}%)
                                                </div>
                                              </div>
                                            </div>
                                          ) : (
                                            <div className="text-muted text-sm py-2">
                                              Trades will execute at next scheduled window. Investment: {formatUsd(inv.investmentAmount)}
                                            </div>
                                          )}
                                        </div>

                                        {/* Backtest Snapshot - shows what the bot WILL trade */}
                                        <div className="base-stats-card w-full min-w-0 text-center self-stretch">
                                          <div className="w-full">
                                            <div className="font-black mb-1.5">Backtest Snapshot</div>
                                            <div className="text-xs text-muted mb-2.5">Benchmark: {backtestBenchmark}</div>
                                            <div className="w-full max-w-full overflow-hidden">
                                              <EquityChart
                                                points={analyzeState.result?.points ?? []}
                                                benchmarkPoints={analyzeState.result?.benchmarkPoints}
                                                markers={analyzeState.result?.markers ?? []}
                                                logScale
                                                showCursorStats={false}
                                                heightPx={390}
                                                theme={uiState.theme}
                                              />
                                            </div>
                                            <div className="mt-2.5 w-full">
                                              <DrawdownChart points={analyzeState.result?.drawdownPoints ?? []} theme={uiState.theme} />
                                            </div>
                                          </div>
                                        </div>

                                        {/* Historical Stats */}
                                        <div className="base-stats-card w-full min-w-0 text-center self-stretch">
                                          <div className="w-full">
                                            <div className="font-black mb-2">Historical Stats</div>
                                            <div className="grid grid-cols-[repeat(4,minmax(140px,1fr))] gap-2.5 justify-items-center overflow-x-auto max-w-full w-full">
                                              <div>
                                                <div className="stat-label">CAGR</div>
                                                <div className="stat-value">{formatPct(analyzeState.result?.metrics.cagr ?? NaN)}</div>
                                              </div>
                                              <div>
                                                <div className="stat-label">Max DD</div>
                                                <div className="stat-value">{formatPct(analyzeState.result?.metrics.maxDrawdown ?? NaN)}</div>
                                              </div>
                                              <div>
                                                <div className="stat-label">Calmar Ratio</div>
                                                <div className="stat-value">
                                                  {Number.isFinite(analyzeState.result?.metrics.calmar ?? NaN)
                                                    ? (analyzeState.result?.metrics.calmar ?? 0).toFixed(2)
                                                    : '--'}
                                                </div>
                                              </div>
                                              <div>
                                                <div className="stat-label">Sharpe Ratio</div>
                                                <div className="stat-value">
                                                  {Number.isFinite(analyzeState.result?.metrics.sharpe ?? NaN)
                                                    ? (analyzeState.result?.metrics.sharpe ?? 0).toFixed(2)
                                                    : '--'}
                                                </div>
                                              </div>
                                              <div>
                                                <div className="stat-label">Sortino Ratio</div>
                                                <div className="stat-value">
                                                  {Number.isFinite(analyzeState.result?.metrics.sortino ?? NaN)
                                                    ? (analyzeState.result?.metrics.sortino ?? 0).toFixed(2)
                                                    : '--'}
                                                </div>
                                              </div>
                                              <div>
                                                <div className="stat-label">Treynor Ratio</div>
                                                <div className="stat-value">
                                                  {Number.isFinite(analyzeState.result?.metrics.treynor ?? NaN)
                                                    ? (analyzeState.result?.metrics.treynor ?? 0).toFixed(2)
                                                    : '--'}
                                                </div>
                                              </div>
                                              <div>
                                                <div className="stat-label">Beta</div>
                                                <div className="stat-value">
                                                  {Number.isFinite(analyzeState.result?.metrics.beta ?? NaN)
                                                    ? (analyzeState.result?.metrics.beta ?? 0).toFixed(2)
                                                    : '--'}
                                                </div>
                                              </div>
                                              <div>
                                                <div className="stat-label">Volatility</div>
                                                <div className="stat-value">{formatPct(analyzeState.result?.metrics.vol ?? NaN)}</div>
                                              </div>
                                              <div>
                                                <div className="stat-label">Win Rate</div>
                                                <div className="stat-value">{formatPct(analyzeState.result?.metrics.winRate ?? NaN)}</div>
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="text-muted">Click Expand to load backtest data.</div>
                                    )}
                                  </div>
                                </div>
                                )
                              )}

                              {/* Show attributed positions in collapsed view */}
                              {!isExpanded && hasPositions && !isSyntheticUnallocated && (
                                <div className="mt-2 pt-2 border-t border-border text-sm">
                                  <div className="text-xs text-muted mb-1">Positions:</div>
                                  <div className="flex flex-wrap gap-2">
                                    {botPositions.map((l) => {
                                      const pos = alpaca.positions.find(p => p.symbol === l.symbol)
                                      return (
                                        <Badge key={l.symbol} variant="default" className="text-xs">
                                          {l.symbol}: {l.shares} @ {formatUsd(l.avgPrice)}
                                          {pos && ` → ${formatUsd(pos.currentPrice)}`}
                                        </Badge>
                                      )
                                    })}
                                  </div>
                                </div>
                              )}
                            </Card>
                          )
                        })}
                      </div>
                    )}

                    {/* Last refresh indicator */}
                    {alpaca.lastRefresh && (
                      <div className="text-xs text-muted mt-3 pt-2 border-t border-border">
                        Last updated: {new Date(alpaca.lastRefresh).toLocaleTimeString()}
                        <Button size="sm" variant="ghost" className="ml-2 h-5 px-2 text-xs" onClick={() => alpaca.refresh()}>
                          Refresh
                        </Button>
                      </div>
                    )}
                        </>
                      )
                    })()}
                  </>
                )
              })()
            ) : (
                  /* Simulated Mode - Show bot investments */
                  <>
                {/* Buy System Section */}
                <div className="font-black mb-3">Buy System</div>
                <div className="grid gap-2 mb-4">
                  {/* Cash available line */}
                  <div className="text-sm">
                    <span className="text-muted">Cash Available:</span>{' '}
                    <span className="font-bold">{formatUsd(dashboardCash)}</span>
                    {dashboardBuyMode === '%' && dashboardBuyAmount && (
                      <span className="text-muted"> · Amount: {formatUsd((parseFloat(dashboardBuyAmount) / 100) * dashboardCash)}</span>
                    )}
                  </div>

                  {/* Buy button, $/% toggle, amount input */}
                  <div className="flex gap-2 items-center">
                    <Button
                      onClick={handleDashboardBuy}
                      disabled={!dashboardBuyBotId || !dashboardBuyAmount}
                      className="h-8 px-4"
                    >
                      Buy
                    </Button>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant={dashboardBuyMode === '$' ? 'accent' : 'outline'}
                        className="h-8 w-8 p-0"
                        onClick={() => setDashboardBuyMode('$')}
                      >
                        $
                      </Button>
                      <Button
                        size="sm"
                        variant={dashboardBuyMode === '%' ? 'accent' : 'outline'}
                        className="h-8 w-8 p-0"
                        onClick={() => setDashboardBuyMode('%')}
                      >
                        %
                      </Button>
                    </div>
                    <Input
                      type="number"
                      placeholder={dashboardBuyMode === '$' ? 'Amount' : '% of cash'}
                      value={dashboardBuyAmount}
                      onChange={(e) => setDashboardBuyAmount(e.target.value)}
                      className="h-8 flex-1"
                    />
                  </div>

                  {/* System selector with search */}
                  <div className="relative">
                    <Input
                      type="text"
                      placeholder="Search and select a system..."
                      value={dashboardBuyBotSearch}
                      onChange={(e) => {
                        setDashboardBuyBotSearch(e.target.value)
                        setDashboardBuyBotDropdownOpen(true)
                      }}
                      onFocus={() => setDashboardBuyBotDropdownOpen(true)}
                      className="h-8 w-full"
                    />
                    {dashboardBuyBotDropdownOpen && (
                      <>
                        <div
                          className="fixed inset-0 z-[199]"
                          onClick={() => setDashboardBuyBotDropdownOpen(false)}
                        />
                        <div className="absolute top-full left-0 right-0 z-[200] mt-1 max-h-48 overflow-y-auto bg-card border border-border rounded-md shadow-lg">
                          {(() => {
                            const availableBots = eligibleBots.filter(
                              (bot) => !dashboardPortfolio.investments.some((inv) => inv.botId === bot.id)
                            )
                            const searchLower = dashboardBuyBotSearch.toLowerCase()
                            const filteredBots = availableBots.filter(
                              (bot) =>
                                bot.name.toLowerCase().includes(searchLower) ||
                                bot.tags?.some((t) => t.toLowerCase().includes(searchLower))
                            )

                            if (filteredBots.length === 0) {
                              return (
                                <div className="px-3 py-2 text-sm text-muted">
                                  {availableBots.length === 0
                                    ? 'No eligible systems available'
                                    : 'No matching systems found'}
                                </div>
                              )
                            }

                            return filteredBots.map((bot) => (
                              <div
                                key={bot.id}
                                className={cn(
                                  'px-3 py-2 text-sm cursor-pointer hover:bg-muted/50',
                                  dashboardBuyBotId === bot.id && 'bg-muted'
                                )}
                                onClick={() => {
                                  setDashboardBuyBotId(bot.id)
                                  setDashboardBuyBotSearch(bot.name)
                                  setDashboardBuyBotDropdownOpen(false)
                                }}
                              >
                                <div className="font-bold">{bot.name}</div>
                                {bot.tags && bot.tags.length > 0 && (
                                  <div className="text-xs text-muted">{bot.tags.join(', ')}</div>
                                )}
                              </div>
                            ))
                          })()}
                        </div>
                      </>
                    )}
                    {dashboardBuyBotId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0 text-muted hover:text-foreground"
                        onClick={() => {
                          setDashboardBuyBotId('')
                          setDashboardBuyBotSearch('')
                        }}
                      >
                        ×
                      </Button>
                    )}
                  </div>

                  {eligibleBots.length === 0 && (
                    <div className="text-xs text-muted">
                      No eligible systems. Your private systems or systems tagged "Atlas"/"Nexus" will appear here.
                    </div>
                  )}
                </div>

                {/* Divider */}
                <div className="border-t border-border my-3" />

                {/* Systems Invested In Section - Uses same card format as Nexus */}
                <div className="font-black mb-3">Systems Invested In ({dashboardInvestmentsWithPnl.length})</div>
                {dashboardInvestmentsWithPnl.length === 0 ? (
                  <div className="text-muted text-center py-4">No investments yet.</div>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {dashboardInvestmentsWithPnl.map((inv, idx) => {
                      const isExpanded = dashboardBotExpanded?.[inv.botId] ?? false
                      const isSelling = dashboardSellBotId === inv.botId
                      const isBuyingMore = dashboardBuyMoreBotId === inv.botId
                      const botColor = BOT_CHART_COLORS[idx % BOT_CHART_COLORS.length]
                      const allocation = dashboardTotalValue > 0 ? (inv.currentValue / dashboardTotalValue) * 100 : 0
                      // Look up bot from savedBots or allNexusBots
                      const b = savedBots.find((bot) => bot.id === inv.botId)
                        ?? allNexusBots.find((bot) => bot.id === inv.botId)
                      const analyzeState = analyzeBacktests[inv.botId]
                      const wlTags = watchlistsByBotId.get(inv.botId) ?? []

                      const toggleCollapse = () => {
                        const next = !isExpanded
                        setDashboardBotExpanded((prev) => ({ ...(prev || {}), [inv.botId]: next }))
                        // Run backtest if expanding and not already done
                        if (next && b) {
                          if (!analyzeState || analyzeState.status === 'idle' || analyzeState.status === 'error') {
                            runAnalyzeBacktest(b)
                          }
                        }
                      }

                      // Use anonymized display name for Nexus bots from other users
                      const fundSlot = b?.fundSlot ?? getFundSlotForBot(inv.botId)
                      const builderName = b?.builderDisplayName || (b?.builderId === userId ? userDisplayName : null) || b?.builderId
                      const displayName = b?.tags?.includes('Nexus') && b?.builderId !== userId && fundSlot
                        ? `${builderName}'s Fund #${fundSlot}`
                        : b?.tags?.includes('Nexus') && b?.builderId !== userId
                          ? `${builderName}'s Fund`
                          : inv.botName

                      return (
                        <Card key={inv.botId} className="grid gap-2.5">
                          <div className="flex items-center gap-2.5 flex-wrap">
                            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: botColor }} />
                            <Button variant="ghost" size="sm" onClick={toggleCollapse}>
                              {isExpanded ? 'Collapse' : 'Expand'}
                            </Button>
                            {b?.backtestMode && <BacktestModeTag mode={b.backtestMode} />}
                            <div className="font-black">{displayName}</div>
                            <Badge variant={b?.tags?.includes('Nexus') ? 'default' : b?.tags?.includes('Atlas') ? 'default' : 'accent'}>
                              {b?.tags?.includes('Nexus') ? 'Nexus' : b?.tags?.includes('Atlas') ? 'Atlas' : 'Private'}
                            </Badge>
                            {(b?.builderDisplayName || b?.builderId) && <Badge variant="default">{b?.builderDisplayName || (b?.builderId === userId ? userDisplayName : null) || b?.builderId}</Badge>}
                            <div className="flex gap-1.5 flex-wrap">
                              {wlTags.map((w) => (
                                <Badge key={w.id} variant="accent" className="gap-1.5">
                                  {w.name}
                                </Badge>
                              ))}
                            </div>
                            <div className="ml-auto flex items-center gap-2.5 flex-wrap">
                              <div className="text-sm text-muted">
                                {formatUsd(inv.costBasis)} → {formatUsd(inv.currentValue)}
                              </div>
                              <div className={cn("font-bold min-w-[80px] text-right", inv.pnl >= 0 ? 'text-success' : 'text-danger')}>
                                {formatSignedUsd(inv.pnl)} ({inv.pnlPercent >= 0 ? '+' : ''}{inv.pnlPercent.toFixed(1)}%)
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setDashboardSellBotId(null)
                                  setDashboardBuyMoreBotId(isBuyingMore ? null : inv.botId)
                                }}
                              >
                                Buy More
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setDashboardBuyMoreBotId(null)
                                  setDashboardSellBotId(isSelling ? null : inv.botId)
                                }}
                              >
                                Sell
                              </Button>
                            </div>
                          </div>

                          {/* Buy More inline form */}
                          {isBuyingMore && (
                            <div className="pt-3 border-t border-border flex gap-2 items-center flex-wrap">
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant={dashboardBuyMoreMode === '$' ? 'accent' : 'outline'}
                                  className="h-8 w-8 p-0"
                                  onClick={() => setDashboardBuyMoreMode('$')}
                                >
                                  $
                                </Button>
                                <Button
                                  size="sm"
                                  variant={dashboardBuyMoreMode === '%' ? 'accent' : 'outline'}
                                  className="h-8 w-8 p-0"
                                  onClick={() => setDashboardBuyMoreMode('%')}
                                >
                                  %
                                </Button>
                              </div>
                              <Input
                                type="number"
                                placeholder={dashboardBuyMoreMode === '$' ? 'Amount' : '% of cash'}
                                value={dashboardBuyMoreAmount}
                                onChange={(e) => setDashboardBuyMoreAmount(e.target.value)}
                                className="h-8 w-32"
                              />
                              <Button
                                size="sm"
                                variant="default"
                                onClick={() => handleDashboardBuyMore(inv.botId)}
                              >
                                Buy More
                              </Button>
                              <span className="text-sm text-muted">Cash: {formatUsd(dashboardCash)}</span>
                            </div>
                          )}

                          {/* Sell inline form */}
                          {isSelling && (
                            <div className="pt-3 border-t border-border flex gap-2 items-center flex-wrap">
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant={dashboardSellMode === '$' ? 'accent' : 'outline'}
                                  className="h-8 w-8 p-0"
                                  onClick={() => setDashboardSellMode('$')}
                                >
                                  $
                                </Button>
                                <Button
                                  size="sm"
                                  variant={dashboardSellMode === '%' ? 'accent' : 'outline'}
                                  className="h-8 w-8 p-0"
                                  onClick={() => setDashboardSellMode('%')}
                                >
                                  %
                                </Button>
                              </div>
                              <Input
                                type="number"
                                placeholder={dashboardSellMode === '$' ? 'Amount' : 'Percent'}
                                value={dashboardSellAmount}
                                onChange={(e) => setDashboardSellAmount(e.target.value)}
                                className="h-8 w-32"
                              />
                              <Button
                                size="sm"
                                variant="default"
                                onClick={() => handleDashboardSell(inv.botId, false)}
                              >
                                Sell
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => handleDashboardSell(inv.botId, true)}
                              >
                                Sell All
                              </Button>
                            </div>
                          )}

                          {/* Expanded view - same format as Nexus cards */}
                          {isExpanded && !isSelling && !isBuyingMore && (
                            <div className="flex flex-col gap-2.5 w-full">
                              <div className="saved-item grid grid-cols-1 gap-3.5 h-full w-full min-w-0 overflow-hidden items-stretch justify-items-stretch">
                                {analyzeState?.status === 'loading' ? (
                                  <div className="text-muted">Running backtest…</div>
                                ) : analyzeState?.status === 'error' ? (
                                  <div className="grid gap-2">
                                    <div className="text-muted">{analyzeState.error ?? 'Failed to run backtest.'}</div>
                                    {b?.payload && <Button onClick={() => runAnalyzeBacktest(b)}>Retry</Button>}
                                  </div>
                                ) : analyzeState?.status === 'done' ? (
                                  <div className="grid grid-cols-1 gap-2.5 min-w-0 w-full">
                                    {/* Live Stats */}
                                    <div className="base-stats-card w-full min-w-0 max-w-full flex flex-col items-stretch text-center">
                                      <div className="font-black mb-2 text-center">Live Stats</div>
                                      <div className="grid grid-cols-4 gap-2.5 justify-items-center w-full">
                                        <div>
                                          <div className="stat-label">Allocation</div>
                                          <div className="stat-value">{allocation.toFixed(1)}%</div>
                                        </div>
                                        <div>
                                          <div className="stat-label">Cost Basis</div>
                                          <div className="stat-value">{formatUsd(inv.costBasis)}</div>
                                        </div>
                                        <div>
                                          <div className="stat-label">Current Value</div>
                                          <div className="stat-value">{formatUsd(inv.currentValue)}</div>
                                        </div>
                                        <div>
                                          <div className="stat-label">P&L</div>
                                          <div className={cn("stat-value", inv.pnl >= 0 ? 'text-success' : 'text-danger')}>
                                            {formatSignedUsd(inv.pnl)} ({inv.pnlPercent >= 0 ? '+' : ''}{inv.pnlPercent.toFixed(1)}%)
                                          </div>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Backtest Snapshot */}
                                    <div className="base-stats-card w-full min-w-0 text-center self-stretch">
                                      <div className="w-full">
                                        <div className="font-black mb-1.5">Backtest Snapshot</div>
                                        <div className="text-xs text-muted mb-2.5">Benchmark: {backtestBenchmark}</div>
                                        <div className="w-full max-w-full overflow-hidden">
                                          <EquityChart
                                            points={analyzeState.result?.points ?? []}
                                            benchmarkPoints={analyzeState.result?.benchmarkPoints}
                                            markers={analyzeState.result?.markers ?? []}
                                            logScale
                                            showCursorStats={false}
                                            heightPx={390}
                                            theme={uiState.theme}
                                          />
                                        </div>
                                        <div className="mt-2.5 w-full">
                                          <DrawdownChart points={analyzeState.result?.drawdownPoints ?? []} theme={uiState.theme} />
                                        </div>
                                      </div>
                                    </div>

                                    {/* Historical Stats */}
                                    <div className="base-stats-card w-full min-w-0 text-center self-stretch">
                                      <div className="w-full">
                                        <div className="font-black mb-2">Historical Stats</div>
                                        <div className="grid grid-cols-[repeat(4,minmax(140px,1fr))] gap-2.5 justify-items-center overflow-x-auto max-w-full w-full">
                                          <div>
                                            <div className="stat-label">CAGR</div>
                                            <div className="stat-value">{formatPct(analyzeState.result?.metrics.cagr ?? NaN)}</div>
                                          </div>
                                          <div>
                                            <div className="stat-label">Max DD</div>
                                            <div className="stat-value">{formatPct(analyzeState.result?.metrics.maxDrawdown ?? NaN)}</div>
                                          </div>
                                          <div>
                                            <div className="stat-label">Calmar Ratio</div>
                                            <div className="stat-value">
                                              {Number.isFinite(analyzeState.result?.metrics.calmar ?? NaN)
                                                ? (analyzeState.result?.metrics.calmar ?? 0).toFixed(2)
                                                : '--'}
                                            </div>
                                          </div>
                                          <div>
                                            <div className="stat-label">Sharpe Ratio</div>
                                            <div className="stat-value">
                                              {Number.isFinite(analyzeState.result?.metrics.sharpe ?? NaN)
                                                ? (analyzeState.result?.metrics.sharpe ?? 0).toFixed(2)
                                                : '--'}
                                            </div>
                                          </div>
                                          <div>
                                            <div className="stat-label">Sortino Ratio</div>
                                            <div className="stat-value">
                                              {Number.isFinite(analyzeState.result?.metrics.sortino ?? NaN)
                                                ? (analyzeState.result?.metrics.sortino ?? 0).toFixed(2)
                                                : '--'}
                                            </div>
                                          </div>
                                          <div>
                                            <div className="stat-label">Treynor Ratio</div>
                                            <div className="stat-value">
                                              {Number.isFinite(analyzeState.result?.metrics.treynor ?? NaN)
                                                ? (analyzeState.result?.metrics.treynor ?? 0).toFixed(2)
                                                : '--'}
                                            </div>
                                          </div>
                                          <div>
                                            <div className="stat-label">Beta</div>
                                            <div className="stat-value">
                                              {Number.isFinite(analyzeState.result?.metrics.beta ?? NaN)
                                                ? (analyzeState.result?.metrics.beta ?? 0).toFixed(2)
                                                : '--'}
                                            </div>
                                          </div>
                                          <div>
                                            <div className="stat-label">Volatility</div>
                                            <div className="stat-value">{formatPct(analyzeState.result?.metrics.vol ?? NaN)}</div>
                                          </div>
                                          <div>
                                            <div className="stat-label">Win Rate</div>
                                            <div className="stat-value">{formatPct(analyzeState.result?.metrics.winRate ?? NaN)}</div>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="text-muted">Click Expand to load backtest data.</div>
                                )}
                              </div>
                            </div>
                          )}
                        </Card>
                      )
                    })}
                  </div>
                )}
                  </>
                )}
              </Card>

              {/* Right Panel: Portfolio Allocation Pie Chart */}
              <Card className="p-4">
                <div className="font-black mb-3">Portfolio Allocation</div>
                {(portfolioMode === 'paper' || portfolioMode === 'live') ? (
                  /* Live/Paper Trading Mode - Show Alpaca position allocation */
                  <div className="flex items-start gap-4">
                    {/* Pie Chart SVG */}
                    <svg viewBox="0 0 100 100" className="w-40 h-40 flex-shrink-0">
                      {(() => {
                        const totalValue = (alpaca.account?.equity ?? 0)
                        const cashValue = (alpaca.account?.cash ?? 0)
                        const cashAlloc = totalValue > 0 ? cashValue / totalValue : 1
                        const slices: Array<{ color: string; percent: number; label: string }> = []

                        // Add position slices
                        alpaca.positions.forEach((pos, idx) => {
                          const pct = totalValue > 0 ? pos.marketValue / totalValue : 0
                          if (pct > 0) {
                            slices.push({
                              color: BOT_CHART_COLORS[idx % BOT_CHART_COLORS.length],
                              percent: pct,
                              label: pos.symbol,
                            })
                          }
                        })

                        // Add cash slice
                        if (cashAlloc > 0) {
                          slices.push({ color: '#94a3b8', percent: cashAlloc, label: 'Cash' })
                        }

                        // Draw pie slices
                        let cumulativePercent = 0
                        return slices.map((slice, i) => {
                          const startAngle = cumulativePercent * 360
                          cumulativePercent += slice.percent
                          const endAngle = cumulativePercent * 360

                          const startRad = ((startAngle - 90) * Math.PI) / 180
                          const endRad = ((endAngle - 90) * Math.PI) / 180

                          const x1 = 50 + 45 * Math.cos(startRad)
                          const y1 = 50 + 45 * Math.sin(startRad)
                          const x2 = 50 + 45 * Math.cos(endRad)
                          const y2 = 50 + 45 * Math.sin(endRad)

                          const largeArc = slice.percent > 0.5 ? 1 : 0

                          // Handle full circle case
                          if (slices.length === 1) {
                            return (
                              <circle
                                key={i}
                                cx="50"
                                cy="50"
                                r="45"
                                fill={slice.color}
                              />
                            )
                          }

                          return (
                            <path
                              key={i}
                              d={`M 50 50 L ${x1} ${y1} A 45 45 0 ${largeArc} 1 ${x2} ${y2} Z`}
                              fill={slice.color}
                            />
                          )
                        })
                      })()}
                    </svg>

                    {/* Legend */}
                    <div className="flex-1 grid gap-1.5 text-sm">
                      {alpaca.positions.map((pos, idx) => {
                        const totalValue = alpaca.account?.equity ?? 0
                        const pct = totalValue > 0 ? (pos.marketValue / totalValue) * 100 : 0
                        return (
                          <div key={pos.symbol} className="flex items-center gap-2">
                            <div
                              className="w-3 h-3 rounded-sm flex-shrink-0"
                              style={{ backgroundColor: BOT_CHART_COLORS[idx % BOT_CHART_COLORS.length] }}
                            />
                            <span className="flex-1 truncate font-bold">{pos.symbol}</span>
                            <span className="text-muted">{pct.toFixed(1)}%</span>
                            <span className="font-bold">{formatUsd(pos.marketValue)}</span>
                          </div>
                        )
                      })}
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-sm flex-shrink-0 bg-slate-400" />
                        <span className="flex-1 font-bold">Cash</span>
                        <span className="text-muted">
                          {(alpaca.account?.equity ?? 0) > 0 ? (((alpaca.account?.cash ?? 0) / (alpaca.account?.equity ?? 1)) * 100).toFixed(1) : '100.0'}%
                        </span>
                        <span className="font-bold">{formatUsd(alpaca.account?.cash ?? 0)}</span>
                      </div>
                      <div className="border-t border-border pt-1.5 mt-1 flex items-center gap-2">
                        <div className="w-3 h-3" />
                        <span className="flex-1 font-black">Total</span>
                        <span className="text-muted">100%</span>
                        <span className="font-black">{formatUsd(alpaca.account?.equity ?? 0)}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Live (Simulated) Mode - Show bot allocation */
                <div className="flex items-start gap-4">
                  {/* Pie Chart SVG */}
                  <svg viewBox="0 0 100 100" className="w-40 h-40 flex-shrink-0">
                    {(() => {
                      const cashAlloc = dashboardTotalValue > 0 ? dashboardCash / dashboardTotalValue : 1
                      const slices: Array<{ color: string; percent: number; label: string }> = []

                      // Add bot slices
                      dashboardInvestmentsWithPnl.forEach((inv, idx) => {
                        const pct = dashboardTotalValue > 0 ? inv.currentValue / dashboardTotalValue : 0
                        if (pct > 0) {
                          slices.push({
                            color: BOT_CHART_COLORS[idx % BOT_CHART_COLORS.length],
                            percent: pct,
                            label: inv.botName,
                          })
                        }
                      })

                      // Add cash slice
                      if (cashAlloc > 0) {
                        slices.push({ color: '#94a3b8', percent: cashAlloc, label: 'Cash' })
                      }

                      // Draw pie slices
                      let cumulativePercent = 0
                      return slices.map((slice, i) => {
                        const startAngle = cumulativePercent * 360
                        cumulativePercent += slice.percent
                        const endAngle = cumulativePercent * 360

                        const startRad = ((startAngle - 90) * Math.PI) / 180
                        const endRad = ((endAngle - 90) * Math.PI) / 180

                        const x1 = 50 + 45 * Math.cos(startRad)
                        const y1 = 50 + 45 * Math.sin(startRad)
                        const x2 = 50 + 45 * Math.cos(endRad)
                        const y2 = 50 + 45 * Math.sin(endRad)

                        const largeArc = slice.percent > 0.5 ? 1 : 0

                        // Handle full circle case
                        if (slices.length === 1) {
                          return (
                            <circle
                              key={i}
                              cx="50"
                              cy="50"
                              r="45"
                              fill={slice.color}
                            />
                          )
                        }

                        return (
                          <path
                            key={i}
                            d={`M 50 50 L ${x1} ${y1} A 45 45 0 ${largeArc} 1 ${x2} ${y2} Z`}
                            fill={slice.color}
                          />
                        )
                      })
                    })()}
                  </svg>

                  {/* Legend */}
                  <div className="flex-1 grid gap-1.5 text-sm">
                    {dashboardInvestmentsWithPnl.map((inv, idx) => {
                      const pct = dashboardTotalValue > 0 ? (inv.currentValue / dashboardTotalValue) * 100 : 0
                      return (
                        <div key={inv.botId} className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-sm flex-shrink-0"
                            style={{ backgroundColor: BOT_CHART_COLORS[idx % BOT_CHART_COLORS.length] }}
                          />
                          <span className="flex-1 truncate font-bold">{inv.botName}</span>
                          <span className="text-muted">{pct.toFixed(1)}%</span>
                          <span className="font-bold">{formatUsd(inv.currentValue)}</span>
                        </div>
                      )
                    })}
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-sm flex-shrink-0 bg-slate-400" />
                      <span className="flex-1 font-bold">Cash</span>
                      <span className="text-muted">
                        {dashboardTotalValue > 0 ? ((dashboardCash / dashboardTotalValue) * 100).toFixed(1) : '100.0'}%
                      </span>
                      <span className="font-bold">{formatUsd(dashboardCash)}</span>
                    </div>
                    <div className="border-t border-border pt-1.5 mt-1 flex items-center gap-2">
                      <div className="w-3 h-3" />
                      <span className="flex-1 font-black">Total</span>
                      <span className="text-muted">100%</span>
                      <span className="font-black">{formatUsd(dashboardTotalValue)}</span>
                    </div>
                  </div>
                </div>
                )}
              </Card>
            </div>
          </div>
        ) : (
          /* Partner Program subtab */
          <div className="mt-3 space-y-4">
            {/* Nexus Eligibility Requirements Section */}
            <Card className="p-4">
              <div className="font-black mb-3">Nexus Eligibility Requirements</div>
              <div className="p-3 bg-muted/30 rounded-lg text-sm space-y-2">
                {appEligibilityRequirements.length === 0 ? (
                  <div className="text-muted">No eligibility requirements set. Contact admin for more information.</div>
                ) : (
                  <ul className="list-disc list-inside space-y-1">
                    {appEligibilityRequirements.map((req) => (
                      <li key={req.id}>
                        {req.type === 'live_months' ? (
                          <>System must be live for at least {req.value} months</>
                        ) : req.type === 'etfs_only' ? (
                          <>System must only contain ETF positions (no individual stocks)</>
                        ) : (
                          <>System must have {METRIC_LABELS[req.metric!]} of {req.comparison === 'at_least' ? 'at least' : 'at most'} {req.value}</>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="text-xs text-muted mt-2 pt-2 border-t border-border">
                  Systems that meet all requirements above can be added to the Nexus Fund to earn partner program revenue.
                </div>
              </div>
            </Card>

            {/* T-Bill Zone at Top with working equity chart */}
            <Card className="p-4">
              <div className="font-black mb-3">T-Bill Performance</div>
              {(() => {
                // Calculate total gains from all funds
                const fundGains = ([1, 2, 3, 4, 5] as const).map(n => {
                  const fundKey = `fund${n}` as keyof FundZones
                  const botId = uiState.fundZones?.[fundKey]
                  if (!botId) return 0
                  const investment = dashboardPortfolio.investments.find(inv => inv.botId === botId)
                  if (!investment) return 0
                  const currentValue = analyzeBacktests[botId]?.result?.metrics?.cagr
                    ? investment.costBasis * (1 + (analyzeBacktests[botId]?.result?.metrics?.cagr ?? 0))
                    : investment.costBasis
                  return currentValue - investment.costBasis
                })
                const totalGains = fundGains.reduce((sum, g) => sum + g, 0)

                // Generate equity curve data for T-Bill (simulated 4.5% annual return)
                const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000
                const tBillEquityData: { time: UTCTimestamp; value: number }[] = []
                const startValue = 100000 // Starting with $100k
                const dailyReturn = Math.pow(1.045, 1/365) - 1 // 4.5% annual = daily compounded

                for (let d = 0; d <= 365; d += 7) { // Weekly data points
                  const date = new Date(oneYearAgo + d * 24 * 60 * 60 * 1000)
                  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
                  const value = startValue * Math.pow(1 + dailyReturn, d)
                  tBillEquityData.push({
                    time: dateStr as unknown as UTCTimestamp,
                    value: ((value - startValue) / startValue) * 100 // % return
                  })
                }

                return (
                  <>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div className="p-3 bg-emerald-500/10 rounded-lg border border-emerald-500/30">
                        <div className="text-xs text-muted mb-1">T-Bill Yield (Annual)</div>
                        <div className="text-xl font-black text-emerald-500">4.50%</div>
                      </div>
                      <div className="p-3 bg-blue-500/10 rounded-lg border border-blue-500/30">
                        <div className="text-xs text-muted mb-1">Total Fund Gains</div>
                        <div className={cn("text-xl font-black", totalGains >= 0 ? "text-emerald-500" : "text-red-500")}>
                          {totalGains >= 0 ? '+' : ''}{formatUsd(totalGains)}
                        </div>
                      </div>
                    </div>
                    <PartnerTBillChart data={tBillEquityData} theme={uiState.theme} />
                  </>
                )
              })()}
            </Card>

            {/* 5 Fund Zones - Each as its own card */}
            <div className="grid grid-cols-5 gap-3">
              {([1, 2, 3, 4, 5] as const).map(n => {
                const fundKey = `fund${n}` as keyof FundZones
                const botId = uiState.fundZones?.[fundKey]
                const bot = botId ? savedBots.find(b => b.id === botId) : null

                // Calculate fund gains
                let fundGain = 0
                let fundCagr = 0
                if (botId) {
                  const investment = dashboardPortfolio.investments.find(inv => inv.botId === botId)
                  const metrics = analyzeBacktests[botId]?.result?.metrics
                  fundCagr = metrics?.cagr ?? 0
                  if (investment) {
                    const currentValue = metrics?.cagr
                      ? investment.costBasis * (1 + metrics.cagr)
                      : investment.costBasis
                    fundGain = currentValue - investment.costBasis
                  }
                }

                return (
                  <Card key={n} className="p-3">
                    <div className="text-xs font-bold text-muted mb-2">Fund #{n}</div>
                    {bot ? (
                      <div className="space-y-2">
                        <div className="font-bold text-sm truncate" title={bot.name}>{bot.name}</div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full h-6 text-xs text-red-500 hover:text-red-600"
                          onClick={async () => {
                            // Remove from fund, re-evaluate eligibility
                            setUiState(prev => ({
                              ...(prev || {}),
                              fundZones: { ...(prev?.fundZones || {}), [fundKey]: null }
                            }))
                            // Change tag from Nexus back to Private + Nexus Eligible, clear fundSlot
                            const baseTags = (bot.tags || []).filter(t => t !== 'Nexus' && t !== 'Private' && t !== 'Nexus Eligible')
                            const updatedBot: SavedBot = { ...bot, tags: ['Private', 'Nexus Eligible', ...baseTags], fundSlot: null }
                            // Sync to database - this will set visibility to 'nexus_eligible' (not 'nexus')
                            await updateBotInApi(userId!, updatedBot)
                          }}
                        >
                          Remove
                        </Button>
                        <div className="border-t border-border pt-2 mt-2">
                          <div className="text-[10px] text-muted">Returns</div>
                          <div className={cn("text-sm font-bold", fundGain >= 0 ? "text-emerald-500" : "text-red-500")}>
                            {fundGain >= 0 ? '+' : ''}{formatUsd(fundGain)}
                          </div>
                          <div className={cn("text-xs", fundCagr >= 0 ? "text-emerald-400" : "text-red-400")}>
                            CAGR: {formatPct(fundCagr)}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-muted text-center py-6">
                        Empty
                      </div>
                    )}
                  </Card>
                )
              })}
            </div>

            {/* Nexus Eligible Systems */}
            <Card className="p-4">
              <div className="font-black mb-3">Nexus Eligible Systems</div>
              {(() => {
                // Filter bots owned by current user with Nexus or Nexus Eligible tags
                const eligibleBotsList = savedBots.filter(
                  b => b.builderId === userId && (b.tags?.includes('Nexus') || b.tags?.includes('Nexus Eligible'))
                )

                if (eligibleBotsList.length === 0) {
                  return (
                    <div className="text-center text-muted py-8">
                      No eligible systems. Systems become eligible when they meet the Partner Program requirements.
                    </div>
                  )
                }

                return (
                  <div className="flex flex-col gap-2.5">
                    {eligibleBotsList.map(b => {
                      const collapsed = uiState.communityCollapsedByBotId?.[b.id] ?? true
                      const analyzeState = analyzeBacktests[b.id]
                      const fundZonesForCheck = uiState.fundZones || {}
                      const isInFund = Object.values(fundZonesForCheck).includes(b.id)
                      const wlTags = watchlistsByBotId.get(b.id) ?? []

                      const toggleCollapse = () => {
                        const next = !collapsed
                        setUiState(prev => ({
                          ...(prev || {}),
                          communityCollapsedByBotId: { ...(prev?.communityCollapsedByBotId || {}), [b.id]: next }
                        }))
                        if (!next && (!analyzeState || analyzeState.status === 'idle' || analyzeState.status === 'error')) {
                          runAnalyzeBacktest(b)
                        }
                      }

                      return (
                        <Card key={b.id} className="grid gap-2.5">
                          <div className="flex items-center gap-2.5 flex-wrap">
                            <Button variant="ghost" size="sm" onClick={toggleCollapse}>
                              {collapsed ? 'Expand' : 'Collapse'}
                            </Button>
                            {b.backtestMode && <BacktestModeTag mode={b.backtestMode} />}
                            <div className="font-black">{b.name}</div>
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
                                </Badge>
                              ))}
                            </div>
                            <div className="ml-auto flex gap-2 flex-wrap items-center">
                              {isInFund ? (
                                <Badge variant="muted">In Fund</Badge>
                              ) : (
                                <select
                                  className="text-xs px-2 py-1 rounded border border-border bg-background"
                                  value=""
                                  onChange={async (e) => {
                                    const fundKey = e.target.value as keyof FundZones
                                    if (!fundKey) return
                                    // Extract fund number from key (e.g., 'fund1' -> 1)
                                    const fundNum = parseInt(fundKey.replace('fund', '')) as 1 | 2 | 3 | 4 | 5
                                    setUiState(prev => ({
                                      ...(prev || {}),
                                      fundZones: { ...(prev?.fundZones || {}), [fundKey]: b.id }
                                    }))
                                    // Remove Private, Nexus Eligible; add Nexus (keep other tags like Atlas if any)
                                    const baseTags = (b.tags || []).filter(t => t !== 'Private' && t !== 'Nexus Eligible' && t !== 'Nexus')
                                    const updatedBot = { ...b, tags: ['Nexus', ...baseTags], fundSlot: fundNum }
                                    // Sync to database for cross-user visibility
                                    if (userId) await updateBotInApi(userId, updatedBot)
                                  }}
                                >
                                  <option value="">Add to Fund...</option>
                                  {([1, 2, 3, 4, 5] as const).map(n => {
                                    const fundKey = `fund${n}` as keyof FundZones
                                    const isEmpty = !uiState.fundZones?.[fundKey]
                                    return (
                                      <option key={n} value={fundKey} disabled={!isEmpty}>
                                        Fund #{n} {isEmpty ? '' : '(occupied)'}
                                      </option>
                                    )
                                  })}
                                </select>
                              )}
                              {/* FRD-012: Show Copy to New for published systems, Open in Build for private */}
                              {(b.tags?.includes('Nexus') || b.tags?.includes('Atlas')) ? (
                                <Button size="sm" onClick={() => handleCopyToNew(b)}>Copy to New System</Button>
                              ) : (
                                <Button size="sm" onClick={() => handleOpenSaved(b)}>Open in Build</Button>
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
                            </div>
                          </div>

                          {!collapsed && (
                            <div className="flex flex-col gap-2.5 w-full">
                              {/* Tab Navigation */}
                              <div className="flex gap-2 border-b border-border pb-2">
                                <Button
                                  size="sm"
                                  variant={(uiState.analyzeBotCardTab[b.id] ?? 'overview') === 'overview' ? 'default' : 'outline'}
                                  onClick={() => setUiState((prev) => ({
                                    ...(prev || {}),
                                    analyzeBotCardTab: { ...(prev?.analyzeBotCardTab || {}), [b.id]: 'overview' },
                                  }))}
                                >
                                  Overview
                                </Button>
                                <Button
                                  size="sm"
                                  variant={(uiState.analyzeBotCardTab[b.id] ?? 'overview') === 'advanced' ? 'default' : 'outline'}
                                  onClick={() => setUiState((prev) => ({
                                    ...(prev || {}),
                                    analyzeBotCardTab: { ...(prev?.analyzeBotCardTab || {}), [b.id]: 'advanced' },
                                  }))}
                                >
                                  Benchmarks
                                </Button>
                                <Button
                                  size="sm"
                                  variant={(uiState.analyzeBotCardTab[b.id] ?? 'overview') === 'robustness' ? 'default' : 'outline'}
                                  onClick={() => setUiState((prev) => ({
                                    ...(prev || {}),
                                    analyzeBotCardTab: { ...(prev?.analyzeBotCardTab || {}), [b.id]: 'robustness' },
                                  }))}
                                >
                                  Robustness
                                </Button>
                              </div>

                              {/* Overview Tab Content */}
                              {(uiState.analyzeBotCardTab[b.id] ?? 'overview') === 'overview' && (
                                <div className="grid w-full max-w-full grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-2.5 items-stretch overflow-x-hidden">
                                  <div className="saved-item grid grid-cols-1 gap-3.5 h-full w-full min-w-0 overflow-hidden items-stretch justify-items-stretch">
                                    {analyzeState?.status === 'loading' ? (
                                      <div className="text-muted">Running backtest…</div>
                                    ) : analyzeState?.status === 'error' ? (
                                      <div className="grid gap-2">
                                        <div className="text-danger font-extrabold">{analyzeState.error ?? 'Failed to run backtest.'}</div>
                                        <Button onClick={() => runAnalyzeBacktest(b)}>Retry</Button>
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
                                              <span className="text-muted"> · Amount: {formatUsd((parseFloat(nexusBuyAmount) / 100) * dashboardCash)}</span>
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

                                        <div className="base-stats-grid w-full self-stretch grid grid-cols-1 grid-rows-[auto_auto_auto] gap-3">
                                          {(() => {
                                            const investment = dashboardInvestmentsWithPnl.find((inv) => inv.botId === b.id)
                                            const isInvested = !!investment
                                            const amountInvested = investment?.costBasis ?? 0
                                            const currentValue = investment?.currentValue ?? 0
                                            const pnlPct = investment?.pnlPercent ?? 0
                                            let liveCagr = 0
                                            if (investment) {
                                              const daysSinceInvestment = (now - investment.buyDate) / (1000 * 60 * 60 * 24)
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
                                                  <div className="text-muted text-sm">Not invested in this system. Buy from Dashboard to track live stats.</div>
                                                )}
                                              </div>
                                            )
                                          })()}

                                          <div className="base-stats-card w-full min-w-0 text-center self-stretch">
                                            <div className="w-full">
                                              <div className="font-black mb-1.5">Backtest Snapshot</div>
                                              <div className="text-xs text-muted mb-2.5">Benchmark: {backtestBenchmark}</div>
                                              <div className="w-full max-w-full overflow-hidden">
                                                <EquityChart
                                                  points={analyzeState.result?.points ?? []}
                                                  benchmarkPoints={analyzeState.result?.benchmarkPoints}
                                                  markers={analyzeState.result?.markers ?? []}
                                                  logScale
                                                  showCursorStats={false}
                                                  heightPx={390}
                                                  theme={uiState.theme}
                                                />
                                              </div>
                                              <div className="mt-2.5 w-full">
                                                <DrawdownChart points={analyzeState.result?.drawdownPoints ?? []} theme={uiState.theme} />
                                              </div>
                                            </div>
                                          </div>

                                          <div className="base-stats-card w-full min-w-0 text-center self-stretch">
                                            <div className="w-full">
                                              <div className="font-black mb-2">Historical Stats</div>
                                              <div className="grid grid-cols-[repeat(4,minmax(140px,1fr))] gap-2.5 justify-items-center overflow-x-auto max-w-full w-full">
                                                <div>
                                                  <div className="stat-label">CAGR</div>
                                                  <div className="stat-value">{formatPct(analyzeState.result?.metrics.cagr ?? NaN)}</div>
                                                </div>
                                                <div>
                                                  <div className="stat-label">Max DD</div>
                                                  <div className="stat-value">{formatPct(analyzeState.result?.metrics.maxDrawdown ?? NaN)}</div>
                                                </div>
                                                <div>
                                                  <div className="stat-label">Calmar Ratio</div>
                                                  <div className="stat-value">
                                                    {Number.isFinite(analyzeState.result?.metrics.calmar ?? NaN)
                                                      ? (analyzeState.result?.metrics.calmar ?? 0).toFixed(2)
                                                      : '--'}
                                                  </div>
                                                </div>
                                                <div>
                                                  <div className="stat-label">Sharpe Ratio</div>
                                                  <div className="stat-value">
                                                    {Number.isFinite(analyzeState.result?.metrics.sharpe ?? NaN)
                                                      ? (analyzeState.result?.metrics.sharpe ?? 0).toFixed(2)
                                                      : '--'}
                                                  </div>
                                                </div>
                                                <div>
                                                  <div className="stat-label">Sortino Ratio</div>
                                                  <div className="stat-value">
                                                    {Number.isFinite(analyzeState.result?.metrics.sortino ?? NaN)
                                                      ? (analyzeState.result?.metrics.sortino ?? 0).toFixed(2)
                                                      : '--'}
                                                  </div>
                                                </div>
                                                <div>
                                                  <div className="stat-label">Treynor Ratio</div>
                                                  <div className="stat-value">
                                                    {Number.isFinite(analyzeState.result?.metrics.treynor ?? NaN)
                                                      ? (analyzeState.result?.metrics.treynor ?? 0).toFixed(2)
                                                      : '--'}
                                                  </div>
                                                </div>
                                                <div>
                                                  <div className="stat-label">Beta</div>
                                                  <div className="stat-value">
                                                    {Number.isFinite(analyzeState.result?.metrics.beta ?? NaN)
                                                      ? (analyzeState.result?.metrics.beta ?? 0).toFixed(2)
                                                      : '--'}
                                                  </div>
                                                </div>
                                                <div>
                                                  <div className="stat-label">Volatility</div>
                                                  <div className="stat-value">{formatPct(analyzeState.result?.metrics.vol ?? NaN)}</div>
                                                </div>
                                                <div>
                                                  <div className="stat-label">Win Rate</div>
                                                  <div className="stat-value">{formatPct(analyzeState.result?.metrics.winRate ?? NaN)}</div>
                                                </div>
                                                <div>
                                                  <div className="stat-label">Turnover</div>
                                                  <div className="stat-value">{formatPct(analyzeState.result?.metrics.avgTurnover ?? NaN)}</div>
                                                </div>
                                                <div>
                                                  <div className="stat-label">Avg Holdings</div>
                                                  <div className="stat-value">
                                                    {Number.isFinite(analyzeState.result?.metrics.avgHoldings ?? NaN)
                                                      ? (analyzeState.result?.metrics.avgHoldings ?? 0).toFixed(1)
                                                      : '--'}
                                                  </div>
                                                </div>
                                                <div>
                                                  <div className="stat-label">Trading Days</div>
                                                  <div className="stat-value">{analyzeState.result?.metrics.days ?? '--'}</div>
                                                </div>
                                              </div>
                                              <div className="mt-2 text-xs text-muted">
                                                Period: {analyzeState.result?.metrics.startDate ?? '--'} to {analyzeState.result?.metrics.endDate ?? '--'}
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    ) : (
                                      <button onClick={() => runAnalyzeBacktest(b)}>Run backtest</button>
                                    )}
                                  </div>

                                  <div className="saved-item flex flex-col gap-2.5 h-full min-w-0">
                                    <div className="font-black">Information</div>
                                    <div className="text-xs text-muted font-extrabold">Placeholder text: Information, tickers, etc</div>
                                  </div>
                                </div>
                              )}

                              {/* Robustness Tab Content */}
                              {(uiState.analyzeBotCardTab[b.id] ?? 'overview') === 'robustness' && (
                                <div className="saved-item flex flex-col gap-2.5 h-full min-w-0">
                                  {(() => {
                                    const sanityState = sanityReports[b.id] ?? { status: 'idle' as const }

                                    return (
                                      <>
                                        <div className="flex items-center justify-between gap-2.5">
                                          <div className="font-black">Robustness Analysis</div>
                                          <Button
                                            size="sm"
                                            onClick={() => runSanityReport(b)}
                                            disabled={sanityState.status === 'loading'}
                                          >
                                            {sanityState.status === 'loading' ? 'Running...' : sanityState.status === 'done' ? 'Re-run' : 'Generate'}
                                          </Button>
                                        </div>

                                        {sanityState.status === 'idle' && (
                                          <div className="text-muted text-sm p-4 border border-border rounded-xl text-center">
                                            Click "Generate" to run bootstrap simulations and fragility analysis.
                                            <br />
                                            <span className="text-xs">This may take 10-30 seconds.</span>
                                          </div>
                                        )}

                                        {sanityState.status === 'loading' && (
                                          <div className="text-muted text-sm p-4 border border-border rounded-xl text-center">
                                            <div className="animate-pulse">Running bootstrap simulations...</div>
                                            <div className="text-xs mt-1">Monte Carlo + K-Fold analysis in progress</div>
                                          </div>
                                        )}

                                        {sanityState.status === 'error' && (
                                          <div className="text-danger text-sm p-4 border border-danger rounded-xl">
                                            Error: {sanityState.error}
                                          </div>
                                        )}

                                        {sanityState.status === 'done' && sanityState.report && (
                                          <div className="text-sm text-muted">
                                            Robustness analysis complete. View detailed results in the Analyze tab.
                                          </div>
                                        )}
                                      </>
                                    )
                                  })()}
                                </div>
                              )}
                            </div>
                          )}
                        </Card>
                      )
                    })}
                  </div>
                )
              })()}
            </Card>
          </div>
        )}
      </CardContent>

      {/* Bulk Sell Modal for Unallocated Positions */}
      <SellPositionModal
        isOpen={isBulkSellModalOpen}
        onClose={() => setIsBulkSellModalOpen(false)}
        mode="bulk"
        positions={alpaca.unallocatedPositions}
        credentialType={portfolioMode === 'live' ? 'live' : 'paper'}
        onConfirm={async (sellOrders) => {
          // Use the same hook/API as the individual sell
          const response = await fetch('/api/dashboard/broker/sell-unallocated', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              credentialType: portfolioMode === 'live' ? 'live' : 'paper',
              orders: sellOrders.map((o) => ({ symbol: o.symbol, qty: o.qty })),
            }),
          })

          if (response.ok) {
            const result = await response.json()
            console.log(`Successfully submitted ${result.orders.length} bulk sell order(s)`)
            setIsBulkSellModalOpen(false)
            alpaca.refetch()
          } else {
            const data = await response.json().catch(() => ({}))
            console.error('Failed to sell positions:', data.error || 'Unknown error')
          }
        }}
      />
    </Card>
  )
}

export default DashboardPanel
