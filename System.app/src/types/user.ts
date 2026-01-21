// src/types/user.ts
// User and UI state types

import type { ThemeMode, ColorTheme } from './theme'
import type { SavedBot, Watchlist } from './bot'
import type { CallChain } from './flowNode'
import type { DashboardPortfolio, PortfolioMode } from './dashboard'
import type { FundZones } from './admin'

export type UserUiState = {
  theme: ThemeMode
  colorTheme: ColorTheme
  analyzeCollapsedByBotId: Record<string, boolean>
  communityCollapsedByBotId: Record<string, boolean>
  analyzeBotCardTab: Record<string, 'overview' | 'advanced' | 'robustness'>
  analyzeFilterWatchlistId: string | null
  communitySelectedWatchlistId: string | null
  communityWatchlistSlot1Id: string | null
  communityWatchlistSlot2Id: string | null
  fundZones: FundZones
  portfolioMode: PortfolioMode // 'simulated' or 'paper'
}

export type UserData = {
  savedBots: SavedBot[]
  watchlists: Watchlist[]
  callChains: CallChain[]
  ui: UserUiState
  dashboardPortfolio?: DashboardPortfolio
}

// Re-export UserId for convenience
export { type UserId } from './theme'
