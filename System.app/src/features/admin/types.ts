// src/features/admin/types.ts
// Admin feature types

/**
 * Search result from ticker registry
 */
export type TickerSearchResult = {
  ticker: string
  name: string | null
  description: string | null
  assetType: string | null
}

/**
 * Props for AdminDataPanel component
 */
export interface AdminDataPanelProps {
  tickers: string[]
  error: string | null
}

/**
 * Admin panel subtab options
 */
export type AdminSubtab = 'Atlas Overview' | 'Nexus Maintenance' | 'Ticker Data' | 'User Management' | 'Trading Control'
