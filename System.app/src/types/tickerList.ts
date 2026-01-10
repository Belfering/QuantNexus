/**
 * Ticker List Types
 *
 * Types for custom ticker lists used in branch optimization
 */

export interface TickerMetadata {
  name?: string
  assetType?: string
  exchange?: string
}

export interface TickerList {
  id: string
  userId: string
  name: string
  description?: string
  tags: string[]
  tickers: string[]
  metadata: Record<string, TickerMetadata>
  createdAt: number
  updatedAt: number
}

export interface TickerListCreateInput {
  name: string
  description?: string
  tags?: string[]
  tickers: string[]
  metadata?: Record<string, TickerMetadata>
}

export interface TickerListUpdateInput {
  name?: string
  description?: string
  tags?: string[]
  tickers?: string[]
  metadata?: Record<string, TickerMetadata>
}

export interface CSVImportResult {
  tickers: string[]
  metadata: Record<string, TickerMetadata>
  tags: string[]
}
