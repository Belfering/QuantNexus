// src/features/backtest/utils/priceDb.ts
// Price database builder for backtest engine

import type { PriceDB } from './indicators'
import { getSeriesKey } from './indicators'
import type { UTCTimestamp } from 'lightweight-charts'

/**
 * Build price database from series data
 *
 * @param series - Array of ticker data with OHLC bars
 * @param dateIntersectionTickers - If provided, only these tickers are used to calculate the date intersection.
 *   This allows indicator tickers (with longer history) to set the date range, while position tickers
 *   (which may have shorter history) just get null values for dates before their data starts.
 */
export const buildPriceDb = (
  series: Array<{
    ticker: string
    bars: Array<{ time: UTCTimestamp; open: number; close: number; adjClose: number }>
  }>,
  dateIntersectionTickers?: string[]
): PriceDB => {
  const byTicker = new Map<string, Map<number, { open: number; close: number; adjClose: number }>>()
  const tickerCounts: Record<string, number> = {}
  let overlapStart = 0
  let overlapEnd = Number.POSITIVE_INFINITY
  let limitingTicker: string | undefined

  // Build the set of tickers to use for date intersection
  const intersectionSet = dateIntersectionTickers
    ? new Set(dateIntersectionTickers.map((t) => getSeriesKey(t)))
    : null

  for (const s of series) {
    const t = getSeriesKey(s.ticker)
    const map = new Map<number, { open: number; close: number; adjClose: number }>()
    for (const b of s.bars) map.set(Number(b.time), { open: Number(b.open), close: Number(b.close), adjClose: Number(b.adjClose) })
    byTicker.set(t, map)
    tickerCounts[t] = s.bars.length

    // Only use tickers in intersectionSet (if provided) for date range calculation
    if (intersectionSet && !intersectionSet.has(t)) continue

    const times = s.bars.map((b) => Number(b.time)).sort((a, b) => a - b)
    if (times.length === 0) continue

    // Track which ticker is setting the overlap start (newest first date = limiting ticker)
    if (times[0] > overlapStart) {
      overlapStart = times[0]
      limitingTicker = t
    }
    overlapEnd = Math.min(overlapEnd, times[times.length - 1])
  }

  if (!(overlapEnd >= overlapStart)) return { dates: [], open: {}, close: {}, adjClose: {}, tickerCounts }

  // Build date intersection using only the intersection tickers (if provided)
  let intersection: Set<number> | null = null
  for (const [ticker, map] of byTicker) {
    // Only use tickers in intersectionSet for building the date intersection
    if (intersectionSet && !intersectionSet.has(ticker)) continue

    const set = new Set<number>()
    for (const time of map.keys()) {
      if (time >= overlapStart && time <= overlapEnd) set.add(time)
    }
    if (intersection == null) {
      intersection = set
    } else {
      const next = new Set<number>()
      for (const t of intersection) if (set.has(t)) next.add(t)
      intersection = next
    }
  }
  const dates = Array.from(intersection ?? new Set<number>()).sort((a, b) => a - b) as UTCTimestamp[]

  // Build price arrays for ALL tickers (not just intersection tickers)
  // Non-intersection tickers may have nulls for dates before their data starts
  const open: Record<string, Array<number | null>> = {}
  const close: Record<string, Array<number | null>> = {}
  const adjClose: Record<string, Array<number | null>> = {}
  for (const [ticker, map] of byTicker) {
    open[ticker] = dates.map((d) => (map.get(Number(d))?.open ?? null))
    close[ticker] = dates.map((d) => (map.get(Number(d))?.close ?? null))
    adjClose[ticker] = dates.map((d) => (map.get(Number(d))?.adjClose ?? null))
  }

  return { dates, open, close, adjClose, limitingTicker, tickerCounts }
}
