// src/types/dashboard.ts
// Dashboard and portfolio types

import type { UTCTimestamp } from 'lightweight-charts'

export type DashboardTimePeriod = '1D' | '1W' | '1M' | '3M' | '6M' | 'YTD' | '1Y' | 'ALL'

export type EquityCurvePoint = {
  time: UTCTimestamp
  value: number
}

// Dashboard investment types
export type DashboardInvestment = {
  botId: string
  botName: string
  buyDate: number // timestamp when purchased
  costBasis: number // amount invested (dollars)
}

export type DashboardPortfolio = {
  cash: number // remaining uninvested cash (starts at $100,000)
  investments: DashboardInvestment[]
}

// Type for database portfolio position (from API)
export type DbPosition = {
  botId: string
  costBasis: number
  shares: number
  entryDate: string
  bot?: { name: string }
}

export const STARTING_CAPITAL = 100000

export const defaultDashboardPortfolio = (): DashboardPortfolio => ({
  cash: STARTING_CAPITAL,
  investments: [],
})

// Portfolio mode for Dashboard - simulated (mock), paper (Alpaca paper), or live (Alpaca live)
export type PortfolioMode = 'simulated' | 'paper' | 'live'

// Alpaca account info
export type AlpacaAccount = {
  equity: number
  cash: number
  buyingPower: number
  portfolioValue: number
  status: string
}

// Alpaca position
export type AlpacaPosition = {
  symbol: string
  qty: number
  avgEntryPrice: number
  marketValue: number
  costBasis: number
  unrealizedPl: number
  unrealizedPlPc: number
  currentPrice: number
  side: string
}

// Alpaca portfolio history point
export type AlpacaHistoryPoint = {
  timestamp: number
  equity: number
  profitLoss: number
  profitLossPct: number
}

// Bot investment tracking (for live/paper trading)
export type BotInvestment = {
  id: number
  botId: string
  botName?: string
  investmentAmount: number
  weightMode: 'dollars' | 'percent'
  createdAt: number
  updatedAt: number
}

// Position ledger entry - tracks shares attributed to each bot
export type PositionLedgerEntry = {
  id: number
  botId: string
  botName?: string
  symbol: string
  shares: number
  avgPrice: number
  createdAt: number
  updatedAt: number
}

// Unallocated position - Alpaca position not attributed to any bot
export type UnallocatedPosition = AlpacaPosition & {
  unallocatedQty: number
}
