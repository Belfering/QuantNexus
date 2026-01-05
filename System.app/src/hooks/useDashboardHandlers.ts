// src/hooks/useDashboardHandlers.ts
// Hook for dashboard buy/sell handlers and equity curve computation

import { useMemo, useCallback } from 'react'
import type { UTCTimestamp } from 'lightweight-charts'
import type {
  UserId,
  DashboardInvestment,
  EquityCurvePoint,
} from '@/types'
import { STARTING_CAPITAL } from '@/types'
import { type BotReturnSeries } from '@/features/dashboard'
import { useDashboardStore, useBotStore, useBacktestStore, useUIStore } from '@/stores'

// Bot colors for chart lines
const BOT_CHART_COLORS = ['#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1']

/**
 * Calculate P&L for an investment based on equity curve
 */
const calculateInvestmentPnl = (
  investment: DashboardInvestment,
  equityCurve: Array<{ date: number; value: number }>,
): { currentValue: number; pnl: number; pnlPercent: number } => {
  if (!equityCurve || equityCurve.length < 2) {
    return { currentValue: investment.costBasis, pnl: 0, pnlPercent: 0 }
  }

  // Find the equity value at or after the buy date
  const buyDateEquityPoint = equityCurve.find((pt) => pt.date >= investment.buyDate)
  const buyDateEquity = buyDateEquityPoint?.value ?? equityCurve[0]?.value ?? 100

  // Get the latest equity value
  const latestEquity = equityCurve[equityCurve.length - 1]?.value ?? buyDateEquity

  // Calculate growth ratio and apply to cost basis
  const growthRatio = buyDateEquity > 0 ? latestEquity / buyDateEquity : 1
  const currentValue = investment.costBasis * growthRatio
  const pnl = currentValue - investment.costBasis
  const pnlPercent = investment.costBasis > 0 ? (pnl / investment.costBasis) * 100 : 0

  return { currentValue, pnl, pnlPercent }
}

interface UseDashboardHandlersOptions {
  userId: UserId | null
}

/**
 * Hook that provides dashboard handlers and computed values
 * Extracts dashboard logic from App.tsx (Phase 2N-18)
 */
export function useDashboardHandlers({ userId }: UseDashboardHandlersOptions) {
  // Dashboard Store
  const dashboardPortfolio = useDashboardStore((s) => s.dashboardPortfolio)
  const setDashboardPortfolio = useDashboardStore((s) => s.setDashboardPortfolio)
  const dashboardBuyBotId = useDashboardStore((s) => s.dashboardBuyBotId)
  const setDashboardBuyBotId = useDashboardStore((s) => s.setDashboardBuyBotId)
  const setDashboardBuyBotSearch = useDashboardStore((s) => s.setDashboardBuyBotSearch)
  const dashboardBuyAmount = useDashboardStore((s) => s.dashboardBuyAmount)
  const setDashboardBuyAmount = useDashboardStore((s) => s.setDashboardBuyAmount)
  const dashboardBuyMode = useDashboardStore((s) => s.dashboardBuyMode)
  const setDashboardSellBotId = useDashboardStore((s) => s.setDashboardSellBotId)
  const dashboardSellAmount = useDashboardStore((s) => s.dashboardSellAmount)
  const setDashboardSellAmount = useDashboardStore((s) => s.setDashboardSellAmount)
  const dashboardSellMode = useDashboardStore((s) => s.dashboardSellMode)
  const setDashboardBuyMoreBotId = useDashboardStore((s) => s.setDashboardBuyMoreBotId)
  const dashboardBuyMoreAmount = useDashboardStore((s) => s.dashboardBuyMoreAmount)
  const setDashboardBuyMoreAmount = useDashboardStore((s) => s.setDashboardBuyMoreAmount)
  const dashboardBuyMoreMode = useDashboardStore((s) => s.dashboardBuyMoreMode)

  // Bot Store
  const savedBots = useBotStore((s) => s.savedBots)
  const allNexusBots = useBotStore((s) => s.allNexusBots)

  // Backtest Store
  const analyzeBacktests = useBacktestStore((s) => s.analyzeBacktests)

  // UI Store - for Nexus buy
  const nexusBuyAmount = useUIStore((s) => s.nexusBuyAmount)
  const nexusBuyMode = useUIStore((s) => s.nexusBuyMode)
  const setNexusBuyBotId = useUIStore((s) => s.setNexusBuyBotId)
  const setNexusBuyAmount = useUIStore((s) => s.setNexusBuyAmount)

  // Computed values
  const dashboardCash = dashboardPortfolio.cash

  // Calculate live P&L for investments using real backtest data
  const dashboardInvestmentsWithPnl = useMemo(() => {
    return dashboardPortfolio.investments.map((inv) => {
      // Get backtest result for this bot from analyzeBacktests
      const backtestState = analyzeBacktests[inv.botId]
      const backtestResult = backtestState?.result

      // Convert backtest equity points to the format expected by calculateInvestmentPnl
      let equityCurve: Array<{ date: number; value: number }> = []
      if (backtestResult?.points && backtestResult.points.length > 0) {
        equityCurve = backtestResult.points.map((pt) => ({
          date: (typeof pt.time === 'number' ? pt.time : Date.parse(pt.time as string) / 1000) * 1000,
          value: pt.value,
        }))
      } else {
        // Fallback: mock data if no backtest available
        equityCurve = [
          { date: inv.buyDate, value: 100 },
          { date: Date.now(), value: 100 },
        ]
      }

      const { currentValue, pnl, pnlPercent } = calculateInvestmentPnl(inv, equityCurve)
      return { ...inv, currentValue, pnl, pnlPercent }
    })
  }, [dashboardPortfolio.investments, analyzeBacktests])

  const dashboardTotalValue = dashboardCash + dashboardInvestmentsWithPnl.reduce((sum, inv) => sum + inv.currentValue, 0)
  const dashboardTotalPnl = dashboardInvestmentsWithPnl.reduce((sum, inv) => sum + inv.pnl, 0)
  const dashboardTotalPnlPct = STARTING_CAPITAL > 0 ? (dashboardTotalPnl / STARTING_CAPITAL) * 100 : 0

  // Generate equity curves from actual invested bot backtest data
  const { dashboardEquityCurve, dashboardBotSeries } = useMemo(() => {
    const investments = dashboardInvestmentsWithPnl

    if (investments.length === 0) {
      // No investments - show flat line at starting capital
      const now = Date.now()
      const oneDay = 24 * 60 * 60 * 1000
      const portfolioPoints: EquityCurvePoint[] = []
      for (let i = 30; i >= 0; i--) {
        const timestamp = Math.floor((now - i * oneDay) / 1000) as UTCTimestamp
        portfolioPoints.push({ time: timestamp, value: STARTING_CAPITAL })
      }
      return { dashboardEquityCurve: portfolioPoints, dashboardBotSeries: [] }
    }

    // Build bot series from real backtest data (full historical data, scaled by cost basis)
    const botSeries: BotReturnSeries[] = []
    const botEquityByTime = new Map<number, Map<string, { value: number; costBasis: number }>>()

    investments.forEach((inv, botIdx) => {
      const backtestState = analyzeBacktests[inv.botId]
      const backtestResult = backtestState?.result

      if (backtestResult?.points && backtestResult.points.length > 0) {
        // Use start of backtest as baseline (value = 1 at start)
        const startEquity = backtestResult.points[0].value
        const botPoints: EquityCurvePoint[] = []

        for (const pt of backtestResult.points) {
          const timeSec = typeof pt.time === 'number' ? pt.time : Math.floor(Date.parse(pt.time as string) / 1000)

          // Scale backtest equity to cost basis (if you invested $20k at start, show growth from $20k)
          const growthRatio = startEquity > 0 ? pt.value / startEquity : 1
          const currentValue = inv.costBasis * growthRatio

          botPoints.push({ time: timeSec as UTCTimestamp, value: currentValue })

          // Track for portfolio aggregation
          if (!botEquityByTime.has(timeSec)) {
            botEquityByTime.set(timeSec, new Map())
          }
          botEquityByTime.get(timeSec)!.set(inv.botId, { value: currentValue, costBasis: inv.costBasis })
        }

        if (botPoints.length > 0) {
          botSeries.push({
            id: inv.botId,
            name: inv.botName,
            color: BOT_CHART_COLORS[botIdx % BOT_CHART_COLORS.length],
            data: botPoints,
          })
        }
      }
    })

    // Build portfolio equity curve by summing all bot values + remaining cash at each time point
    const sortedTimes = Array.from(botEquityByTime.keys()).sort((a, b) => a - b)
    const portfolioPoints: EquityCurvePoint[] = []
    const lastKnownValues = new Map<string, number>()

    // Initialize with cost basis values for each investment
    investments.forEach((inv) => {
      lastKnownValues.set(inv.botId, inv.costBasis)
    })

    for (const timeSec of sortedTimes) {
      const timeData = botEquityByTime.get(timeSec)!

      // Update last known values for bots that have data at this time
      for (const [botId, data] of timeData) {
        lastKnownValues.set(botId, data.value)
      }

      // Sum all bot values at this time point
      let totalBotValue = 0
      for (const value of lastKnownValues.values()) {
        totalBotValue += value
      }

      // Total portfolio = cash + all bot values
      const portfolioValue = dashboardCash + totalBotValue
      portfolioPoints.push({ time: timeSec as UTCTimestamp, value: portfolioValue })
    }

    // If no portfolio points generated, create a simple curve
    if (portfolioPoints.length === 0) {
      const now = Date.now()
      const oneDay = 24 * 60 * 60 * 1000
      for (let i = 30; i >= 0; i--) {
        const timestamp = Math.floor((now - i * oneDay) / 1000) as UTCTimestamp
        portfolioPoints.push({ time: timestamp, value: dashboardTotalValue })
      }
    }

    return { dashboardEquityCurve: portfolioPoints, dashboardBotSeries: botSeries }
  }, [dashboardInvestmentsWithPnl, analyzeBacktests, dashboardCash, dashboardTotalValue])

  /**
   * Handle buying a bot from the Dashboard tab
   */
  const handleDashboardBuy = useCallback(async () => {
    if (!dashboardBuyBotId || !userId) return
    // Look in both savedBots and allNexusBots to find the bot
    const bot = savedBots.find((b) => b.id === dashboardBuyBotId)
      ?? allNexusBots.find((b) => b.id === dashboardBuyBotId)
    if (!bot) return

    // Calculate amount
    let amount = 0
    if (dashboardBuyMode === '$') {
      amount = parseFloat(dashboardBuyAmount) || 0
    } else {
      const pct = parseFloat(dashboardBuyAmount) || 0
      amount = (pct / 100) * dashboardCash
    }

    // Validate
    if (amount < 100) {
      alert('Minimum investment is $100')
      return
    }
    if (amount > dashboardCash) {
      alert('Insufficient cash')
      return
    }
    // Check if already invested
    if (dashboardPortfolio.investments.some((inv) => inv.botId === dashboardBuyBotId)) {
      alert('Already invested in this system. Sell first to reinvest.')
      return
    }

    // Call API to persist the purchase
    try {
      const res = await fetch('/api/portfolio/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, botId: bot.id, amount }),
      })
      if (!res.ok) {
        const { error } = await res.json()
        alert(error || 'Failed to buy')
        return
      }

      // Update local state after successful API call
      const newInvestment: DashboardInvestment = {
        botId: bot.id,
        botName: bot.name,
        buyDate: Date.now(),
        costBasis: amount,
      }

      setDashboardPortfolio((prev) => ({
        cash: prev.cash - amount,
        investments: [...prev.investments, newInvestment],
      }))
      setDashboardBuyBotId('')
      setDashboardBuyBotSearch('')
      setDashboardBuyAmount('')
    } catch (e) {
      console.error('[Portfolio] Buy failed:', e)
      alert('Network error - failed to buy')
    }
  }, [dashboardBuyBotId, userId, savedBots, allNexusBots, dashboardBuyMode, dashboardBuyAmount, dashboardCash, dashboardPortfolio.investments, setDashboardPortfolio, setDashboardBuyBotId, setDashboardBuyBotSearch, setDashboardBuyAmount])

  /**
   * Handle selling a bot from the Dashboard tab
   */
  const handleDashboardSell = useCallback(async (botId: string, sellAll: boolean) => {
    if (!userId) return
    const investment = dashboardPortfolio.investments.find((inv) => inv.botId === botId)
    if (!investment) return

    const invWithPnl = dashboardInvestmentsWithPnl.find((inv) => inv.botId === botId)
    if (!invWithPnl) return

    let sellAmount = invWithPnl.currentValue
    if (!sellAll) {
      if (dashboardSellMode === '$') {
        sellAmount = Math.min(parseFloat(dashboardSellAmount) || 0, invWithPnl.currentValue)
      } else {
        const pct = parseFloat(dashboardSellAmount) || 0
        sellAmount = (pct / 100) * invWithPnl.currentValue
      }
    }

    if (sellAmount <= 0) return

    // Call API to persist the sale
    try {
      const res = await fetch('/api/portfolio/sell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, botId, amount: sellAmount }),
      })
      if (!res.ok) {
        const { error } = await res.json()
        alert(error || 'Failed to sell')
        return
      }

      // Update local state after successful API call
      // If selling all or selling more than 99% of position, remove investment
      if (sellAmount >= invWithPnl.currentValue * 0.99) {
        setDashboardPortfolio((prev) => ({
          cash: prev.cash + invWithPnl.currentValue,
          investments: prev.investments.filter((inv) => inv.botId !== botId),
        }))
      } else {
        // Partial sell - reduce cost basis proportionally
        const sellRatio = sellAmount / invWithPnl.currentValue
        const newCostBasis = investment.costBasis * (1 - sellRatio)
        setDashboardPortfolio((prev) => ({
          cash: prev.cash + sellAmount,
          investments: prev.investments.map((inv) =>
            inv.botId === botId ? { ...inv, costBasis: newCostBasis } : inv,
          ),
        }))
      }

      setDashboardSellBotId(null)
      setDashboardSellAmount('')
    } catch (e) {
      console.error('[Portfolio] Sell failed:', e)
      alert('Network error - failed to sell')
    }
  }, [userId, dashboardPortfolio.investments, dashboardInvestmentsWithPnl, dashboardSellMode, dashboardSellAmount, setDashboardPortfolio, setDashboardSellBotId, setDashboardSellAmount])

  /**
   * Handle buying more of an existing position
   */
  const handleDashboardBuyMore = useCallback(async (botId: string) => {
    if (!userId) return
    const investment = dashboardPortfolio.investments.find((inv) => inv.botId === botId)
    if (!investment) return

    // Calculate amount
    let amount = 0
    if (dashboardBuyMoreMode === '$') {
      amount = parseFloat(dashboardBuyMoreAmount) || 0
    } else {
      const pct = parseFloat(dashboardBuyMoreAmount) || 0
      amount = (pct / 100) * dashboardCash
    }

    // Validate
    if (amount < 100) {
      alert('Minimum investment is $100')
      return
    }
    if (amount > dashboardCash) {
      alert('Insufficient cash')
      return
    }

    // Call API to persist the additional purchase
    try {
      const res = await fetch('/api/portfolio/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, botId, amount }),
      })
      if (!res.ok) {
        const { error } = await res.json()
        alert(error || 'Failed to buy more')
        return
      }

      // Add to existing position
      setDashboardPortfolio((prev) => ({
        cash: prev.cash - amount,
        investments: prev.investments.map((inv) =>
          inv.botId === botId
            ? { ...inv, costBasis: inv.costBasis + amount, buyDate: Date.now() }
            : inv,
        ),
      }))

      setDashboardBuyMoreBotId(null)
      setDashboardBuyMoreAmount('')
    } catch (e) {
      console.error('[Portfolio] Buy more failed:', e)
      alert('Network error - failed to buy more')
    }
  }, [userId, dashboardPortfolio.investments, dashboardBuyMoreMode, dashboardBuyMoreAmount, dashboardCash, setDashboardPortfolio, setDashboardBuyMoreBotId, setDashboardBuyMoreAmount])

  /**
   * Handle buying Nexus bots from inline buy UI (Analyze tab, Nexus, watchlists)
   */
  const handleNexusBuy = useCallback(async (botId: string) => {
    if (!userId) return
    // Look in both savedBots and allNexusBots to find the bot
    const bot = savedBots.find((b) => b.id === botId)
      ?? allNexusBots.find((b) => b.id === botId)
    if (!bot) return

    // Calculate amount
    let amount = 0
    if (nexusBuyMode === '$') {
      amount = parseFloat(nexusBuyAmount) || 0
    } else {
      const pct = parseFloat(nexusBuyAmount) || 0
      amount = (pct / 100) * dashboardCash
    }

    // Validate
    if (amount < 100) {
      alert('Minimum investment is $100')
      return
    }
    if (amount > dashboardCash) {
      alert('Insufficient cash')
      return
    }

    // Call API to persist the purchase
    try {
      const res = await fetch('/api/portfolio/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, botId: bot.id, amount }),
      })
      if (!res.ok) {
        const { error } = await res.json()
        alert(error || 'Failed to buy')
        return
      }

      // Update local state after successful API call
      // Check if already invested - if so, add to position
      const existingInvestment = dashboardPortfolio.investments.find((inv) => inv.botId === botId)
      if (existingInvestment) {
        // Add to existing position
        setDashboardPortfolio((prev) => ({
          cash: prev.cash - amount,
          investments: prev.investments.map((inv) =>
            inv.botId === botId
              ? { ...inv, costBasis: inv.costBasis + amount, buyDate: Date.now() }
              : inv,
          ),
        }))
      } else {
        // Create new investment
        const newInvestment: DashboardInvestment = {
          botId: bot.id,
          botName: bot.name,
          buyDate: Date.now(),
          costBasis: amount,
        }
        setDashboardPortfolio((prev) => ({
          cash: prev.cash - amount,
          investments: [...prev.investments, newInvestment],
        }))
      }

      // Reset state
      setNexusBuyBotId(null)
      setNexusBuyAmount('')
    } catch (e) {
      console.error('[Portfolio] Nexus buy failed:', e)
      alert('Network error - failed to buy')
    }
  }, [userId, savedBots, allNexusBots, nexusBuyMode, nexusBuyAmount, dashboardCash, dashboardPortfolio.investments, setDashboardPortfolio, setNexusBuyBotId, setNexusBuyAmount])

  return {
    // Computed values
    dashboardCash,
    dashboardInvestmentsWithPnl,
    dashboardTotalValue,
    dashboardTotalPnl,
    dashboardTotalPnlPct,
    dashboardEquityCurve,
    dashboardBotSeries,
    // Handlers
    handleDashboardBuy,
    handleDashboardSell,
    handleDashboardBuyMore,
    handleNexusBuy,
  }
}
