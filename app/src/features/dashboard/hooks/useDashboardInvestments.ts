// src/features/dashboard/hooks/useDashboardInvestments.ts
// Dashboard investment management hook - handles buying, selling, and P&L calculations
// Accepts state as parameters (will be passed from App.tsx or Dashboard tab)

import { useState, useMemo, useCallback, type Dispatch, type SetStateAction } from 'react'
import type { DashboardInvestment, DashboardPortfolio, SavedBot, AnalyzeBacktestState, UserId } from '@/types'

// ─────────────────────────────────────────────────────────────────────────────
// Utility: Calculate P&L for an investment
// ─────────────────────────────────────────────────────────────────────────────

export const calculateInvestmentPnl = (
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

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type InvestmentWithPnl = DashboardInvestment & {
  currentValue: number
  pnl: number
  pnlPercent: number
}

export type UseDashboardInvestmentsParams = {
  userId: UserId | null
  savedBots: SavedBot[]
  allNexusBots: SavedBot[]
  dashboardPortfolio: DashboardPortfolio
  setDashboardPortfolio: Dispatch<SetStateAction<DashboardPortfolio>>
  analyzeBacktests: Record<string, AnalyzeBacktestState>
}

export type UseDashboardInvestmentsResult = {
  // Computed values
  cash: number
  investmentsWithPnl: InvestmentWithPnl[]
  totalValue: number
  totalPnl: number
  totalPnlPct: number

  // Buy form state
  buyBotId: string
  setBuyBotId: (id: string) => void
  buyBotSearch: string
  setBuyBotSearch: (search: string) => void
  buyBotDropdownOpen: boolean
  setBuyBotDropdownOpen: (open: boolean) => void
  buyAmount: string
  setBuyAmount: (amount: string) => void
  buyMode: '$' | '%'
  setBuyMode: (mode: '$' | '%') => void

  // Sell form state
  sellBotId: string | null
  setSellBotId: (id: string | null) => void
  sellAmount: string
  setSellAmount: (amount: string) => void
  sellMode: '$' | '%'
  setSellMode: (mode: '$' | '%') => void

  // Buy more form state
  buyMoreBotId: string | null
  setBuyMoreBotId: (id: string | null) => void
  buyMoreAmount: string
  setBuyMoreAmount: (amount: string) => void
  buyMoreMode: '$' | '%'
  setBuyMoreMode: (mode: '$' | '%') => void

  // Nexus inline buy state
  nexusBuyBotId: string | null
  setNexusBuyBotId: (id: string | null) => void
  nexusBuyAmount: string
  setNexusBuyAmount: (amount: string) => void
  nexusBuyMode: '$' | '%'
  setNexusBuyMode: (mode: '$' | '%') => void

  // Actions
  handleBuy: () => Promise<void>
  handleSell: (botId: string, sellAll: boolean) => Promise<void>
  handleBuyMore: (botId: string) => Promise<void>
  handleNexusBuy: (botId: string) => Promise<void>

  // Helpers
  findBot: (botId: string) => SavedBot | undefined
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const STARTING_CAPITAL = 100000

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useDashboardInvestments(params: UseDashboardInvestmentsParams): UseDashboardInvestmentsResult {
  const {
    userId,
    savedBots,
    allNexusBots,
    dashboardPortfolio,
    setDashboardPortfolio,
    analyzeBacktests,
  } = params

  // ─────────────────────────────────────────────────────────────────────────────
  // Buy form state
  // ─────────────────────────────────────────────────────────────────────────────

  const [buyBotId, setBuyBotId] = useState<string>('')
  const [buyBotSearch, setBuyBotSearch] = useState<string>('')
  const [buyBotDropdownOpen, setBuyBotDropdownOpen] = useState(false)
  const [buyAmount, setBuyAmount] = useState<string>('')
  const [buyMode, setBuyMode] = useState<'$' | '%'>('$')

  // ─────────────────────────────────────────────────────────────────────────────
  // Sell form state
  // ─────────────────────────────────────────────────────────────────────────────

  const [sellBotId, setSellBotId] = useState<string | null>(null)
  const [sellAmount, setSellAmount] = useState<string>('')
  const [sellMode, setSellMode] = useState<'$' | '%'>('$')

  // ─────────────────────────────────────────────────────────────────────────────
  // Buy more form state
  // ─────────────────────────────────────────────────────────────────────────────

  const [buyMoreBotId, setBuyMoreBotId] = useState<string | null>(null)
  const [buyMoreAmount, setBuyMoreAmount] = useState<string>('')
  const [buyMoreMode, setBuyMoreMode] = useState<'$' | '%'>('$')

  // ─────────────────────────────────────────────────────────────────────────────
  // Nexus inline buy state
  // ─────────────────────────────────────────────────────────────────────────────

  const [nexusBuyBotId, setNexusBuyBotId] = useState<string | null>(null)
  const [nexusBuyAmount, setNexusBuyAmount] = useState<string>('')
  const [nexusBuyMode, setNexusBuyMode] = useState<'$' | '%'>('$')

  // ─────────────────────────────────────────────────────────────────────────────
  // Derived values
  // ─────────────────────────────────────────────────────────────────────────────

  const cash = dashboardPortfolio.cash

  // Memoize current timestamp to avoid impure Date.now() calls during render
  // eslint-disable-next-line react-hooks/purity -- Date.now() is intentionally captured once at mount
  const now = useMemo(() => Date.now(), [])

  const findBot = useCallback(
    (botId: string): SavedBot | undefined => {
      return savedBots.find((b) => b.id === botId) ?? allNexusBots.find((b) => b.id === botId)
    },
    [savedBots, allNexusBots],
  )

  // Calculate live P&L for investments using real backtest data
  const investmentsWithPnl = useMemo<InvestmentWithPnl[]>(() => {
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
          { date: now, value: 100 },
        ]
      }

      const { currentValue, pnl, pnlPercent } = calculateInvestmentPnl(inv, equityCurve)
      return { ...inv, currentValue, pnl, pnlPercent }
    })
  }, [dashboardPortfolio.investments, analyzeBacktests, now])

  const totalValue = cash + investmentsWithPnl.reduce((sum, inv) => sum + inv.currentValue, 0)
  const totalPnl = investmentsWithPnl.reduce((sum, inv) => sum + inv.pnl, 0)
  const totalPnlPct = STARTING_CAPITAL > 0 ? (totalPnl / STARTING_CAPITAL) * 100 : 0

  // ─────────────────────────────────────────────────────────────────────────────
  // Actions
  // ─────────────────────────────────────────────────────────────────────────────

  const handleBuy = useCallback(async () => {
    if (!buyBotId || !userId) return
    const bot = findBot(buyBotId)
    if (!bot) return

    // Calculate amount
    let amount = 0
    if (buyMode === '$') {
      amount = parseFloat(buyAmount) || 0
    } else {
      const pct = parseFloat(buyAmount) || 0
      amount = (pct / 100) * cash
    }

    // Validate
    if (amount < 100) {
      alert('Minimum investment is $100')
      return
    }
    if (amount > cash) {
      alert('Insufficient cash')
      return
    }
    // Check if already invested
    if (dashboardPortfolio.investments.some((inv) => inv.botId === buyBotId)) {
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
      setBuyBotId('')
      setBuyBotSearch('')
      setBuyAmount('')
    } catch (e) {
      console.error('[Portfolio] Buy failed:', e)
      alert('Network error - failed to buy')
    }
  }, [buyBotId, buyMode, buyAmount, cash, userId, dashboardPortfolio.investments, findBot, setDashboardPortfolio])

  const handleSell = useCallback(
    async (botId: string, sellAll: boolean) => {
      if (!userId) return
      const investment = dashboardPortfolio.investments.find((inv) => inv.botId === botId)
      if (!investment) return

      const invWithPnl = investmentsWithPnl.find((inv) => inv.botId === botId)
      if (!invWithPnl) return

      let amountToSell = invWithPnl.currentValue
      if (!sellAll) {
        if (sellMode === '$') {
          amountToSell = Math.min(parseFloat(sellAmount) || 0, invWithPnl.currentValue)
        } else {
          const pct = parseFloat(sellAmount) || 0
          amountToSell = (pct / 100) * invWithPnl.currentValue
        }
      }

      if (amountToSell <= 0) return

      // Call API to persist the sale
      try {
        const res = await fetch('/api/portfolio/sell', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, botId, amount: amountToSell }),
        })
        if (!res.ok) {
          const { error } = await res.json()
          alert(error || 'Failed to sell')
          return
        }

        // Update local state after successful API call
        // If selling all or selling more than 99% of position, remove investment
        if (amountToSell >= invWithPnl.currentValue * 0.99) {
          setDashboardPortfolio((prev) => ({
            cash: prev.cash + invWithPnl.currentValue,
            investments: prev.investments.filter((inv) => inv.botId !== botId),
          }))
        } else {
          // Partial sell - reduce cost basis proportionally
          const sellRatio = amountToSell / invWithPnl.currentValue
          const newCostBasis = investment.costBasis * (1 - sellRatio)
          setDashboardPortfolio((prev) => ({
            cash: prev.cash + amountToSell,
            investments: prev.investments.map((inv) =>
              inv.botId === botId ? { ...inv, costBasis: newCostBasis } : inv,
            ),
          }))
        }

        setSellBotId(null)
        setSellAmount('')
      } catch (e) {
        console.error('[Portfolio] Sell failed:', e)
        alert('Network error - failed to sell')
      }
    },
    [userId, dashboardPortfolio.investments, investmentsWithPnl, sellMode, sellAmount, setDashboardPortfolio],
  )

  const handleBuyMore = useCallback(
    async (botId: string) => {
      if (!userId) return
      const investment = dashboardPortfolio.investments.find((inv) => inv.botId === botId)
      if (!investment) return

      // Calculate amount
      let amount = 0
      if (buyMoreMode === '$') {
        amount = parseFloat(buyMoreAmount) || 0
      } else {
        const pct = parseFloat(buyMoreAmount) || 0
        amount = (pct / 100) * cash
      }

      // Validate
      if (amount < 100) {
        alert('Minimum investment is $100')
        return
      }
      if (amount > cash) {
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

        setBuyMoreBotId(null)
        setBuyMoreAmount('')
      } catch (e) {
        console.error('[Portfolio] Buy more failed:', e)
        alert('Network error - failed to buy more')
      }
    },
    [userId, dashboardPortfolio.investments, buyMoreMode, buyMoreAmount, cash, setDashboardPortfolio],
  )

  // Handle buying from inline UI (Analyze tab, Nexus, watchlists)
  const handleNexusBuy = useCallback(
    async (botId: string) => {
      if (!userId) return
      const bot = findBot(botId)
      if (!bot) return

      // Calculate amount
      let amount = 0
      if (nexusBuyMode === '$') {
        amount = parseFloat(nexusBuyAmount) || 0
      } else {
        const pct = parseFloat(nexusBuyAmount) || 0
        amount = (pct / 100) * cash
      }

      // Validate
      if (amount < 100) {
        alert('Minimum investment is $100')
        return
      }
      if (amount > cash) {
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
    },
    [userId, nexusBuyMode, nexusBuyAmount, cash, dashboardPortfolio.investments, findBot, setDashboardPortfolio],
  )

  return {
    // Computed values
    cash,
    investmentsWithPnl,
    totalValue,
    totalPnl,
    totalPnlPct,

    // Buy form state
    buyBotId,
    setBuyBotId,
    buyBotSearch,
    setBuyBotSearch,
    buyBotDropdownOpen,
    setBuyBotDropdownOpen,
    buyAmount,
    setBuyAmount,
    buyMode,
    setBuyMode,

    // Sell form state
    sellBotId,
    setSellBotId,
    sellAmount,
    setSellAmount,
    sellMode,
    setSellMode,

    // Buy more form state
    buyMoreBotId,
    setBuyMoreBotId,
    buyMoreAmount,
    setBuyMoreAmount,
    buyMoreMode,
    setBuyMoreMode,

    // Nexus inline buy state
    nexusBuyBotId,
    setNexusBuyBotId,
    nexusBuyAmount,
    setNexusBuyAmount,
    nexusBuyMode,
    setNexusBuyMode,

    // Actions
    handleBuy,
    handleSell,
    handleBuyMore,
    handleNexusBuy,

    // Helpers
    findBot,
  }
}
