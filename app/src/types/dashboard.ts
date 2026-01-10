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
