// src/shared/utils/ticker.ts
// Ticker normalization and parsing utilities

import type { PositionChoice } from '@/types'

/**
 * Normalize a position choice to a standard format
 * - Trims whitespace, converts to uppercase
 * - Treats empty/null/undefined as 'Empty'
 */
export const normalizeChoice = (raw: PositionChoice): string => {
  const s = String(raw ?? '').trim().toUpperCase()
  if (!s || s === 'EMPTY') return 'Empty'
  return s
}

/**
 * Check if a position choice represents "no position"
 */
export const isEmptyChoice = (raw: PositionChoice) => normalizeChoice(raw) === 'Empty'

/**
 * Parse a ratio ticker (e.g., "JNK/XLP") into its component tickers
 * Returns null if not a ratio ticker
 */
export const parseRatioTicker = (ticker: string): { numerator: string; denominator: string } | null => {
  const norm = normalizeChoice(ticker)
  const parts = norm.split('/')
  if (parts.length !== 2) return null
  const [numerator, denominator] = parts.map((p) => p.trim())
  if (!numerator || !denominator) return null
  return { numerator, denominator }
}

/**
 * Expand a ticker to all component tickers needed for data fetching
 * For ratio tickers like "JNK/XLP" returns ["JNK", "XLP"]
 * For regular tickers like "SPY" returns ["SPY"]
 * For "Empty" returns []
 */
export const expandTickerComponents = (ticker: string): string[] => {
  const ratio = parseRatioTicker(ticker)
  if (ratio) return [ratio.numerator, ratio.denominator]
  const norm = normalizeChoice(ticker)
  return norm === 'Empty' ? [] : [norm]
}
