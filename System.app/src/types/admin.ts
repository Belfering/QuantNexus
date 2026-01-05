// src/types/admin.ts
// Admin and configuration types

export type AdminStatus = {
  root: string
  tickersPath: string
  parquetDir: string
  tickersExists: boolean
  parquetDirExists: boolean
  parquetFileCount: number
}

export type AdminCandlesResponse = {
  ticker: string
  candles: Array<{ time: number; open: number; high: number; low: number; close: number }>
  preview: Array<{ Date: string; Open: number; High: number; Low: number; Close: number }>
}

// Admin types for Atlas Overview
export type EligibilityMetric = 'cagr' | 'maxDrawdown' | 'calmar' | 'sharpe' | 'sortino' | 'treynor' | 'beta' | 'vol' | 'winRate' | 'avgTurnover' | 'avgHoldings'

export type EligibilityRequirement = {
  id: string
  type: 'live_months' | 'metric' | 'etfs_only'
  metric?: EligibilityMetric
  comparison?: 'at_least' | 'at_most'
  value: number
}

export type AdminConfig = {
  atlasFeePercent: number
  partnerProgramSharePercent: number
  eligibilityRequirements: EligibilityRequirement[]
  atlasFundSlots: string[] // Array of bot IDs for Atlas Sponsored systems
}

export type TreasuryEntry = {
  id: string
  date: number
  type: 'fee_deposit' | 'withdrawal' | 'interest'
  amount: number
  description: string
}

export type TreasuryState = {
  balance: number
  entries: TreasuryEntry[]
}

export type AdminAggregatedStats = {
  totalDollarsInAccounts: number
  totalDollarsInvested: number
  totalPortfolioValue: number
  totalInvestedAtlas: number
  totalInvestedNexus: number
  totalInvestedPrivate: number
  userCount: number
  lastUpdated: number
}

export type TreasuryFeeBreakdown = {
  atlasFeesTotal: number
  privateFeesTotal: number
  nexusFeesTotal: number
  nexusPartnerPaymentsTotal: number
}

export type FundZones = {
  fund1: string | null
  fund2: string | null
  fund3: string | null
  fund4: string | null
  fund5: string | null
}

// Labels for eligibility metrics (used in both AdminPanel and Partner Program)
export const METRIC_LABELS: Record<EligibilityMetric, string> = {
  cagr: 'CAGR',
  maxDrawdown: 'Max Drawdown',
  calmar: 'Calmar Ratio',
  sharpe: 'Sharpe Ratio',
  sortino: 'Sortino Ratio',
  treynor: 'Treynor Ratio',
  beta: 'Beta',
  vol: 'Volatility',
  winRate: 'Win Rate',
  avgTurnover: 'Avg Turnover',
  avgHoldings: 'Avg Holdings'
}
