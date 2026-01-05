// src/features/data/api/ohlc.ts
// OHLC data fetching and caching

import { OHLC_CACHE_TTL } from '@/constants'
import { getSeriesKey } from '@/features/backtest'
import type { AdminCandlesResponse } from '@/types'
import type { UTCTimestamp } from 'lightweight-charts'

// Cached OHLC data type
export type CachedOhlcData = Array<{
  time: UTCTimestamp
  open: number
  close: number
  adjClose: number
}>

// Client-side ticker data cache for faster subsequent backtests
export const ohlcDataCache = new Map<string, { data: CachedOhlcData; limit: number; timestamp: number }>()

/**
 * Fetch OHLC series for a single ticker
 */
export const fetchOhlcSeries = async (
  ticker: string,
  limit: number
): Promise<CachedOhlcData> => {
  const t = encodeURIComponent(getSeriesKey(ticker))
  const res = await fetch(`/api/candles/${t}?limit=${encodeURIComponent(String(limit))}`)
  const text = await res.text()
  let payload: unknown = null
  try {
    payload = text ? (JSON.parse(text) as unknown) : null
  } catch {
    throw new Error(`Failed to load ${ticker} candles. Non-JSON response: ${text ? text.slice(0, 200) : '<empty>'}`)
  }
  if (!res.ok) {
    const err = payload && typeof payload === 'object' && 'error' in payload ? String((payload as { error?: unknown }).error) : `HTTP ${res.status}`
    throw new Error(`Failed to load ${ticker} candles. ${err}`)
  }
  const candles = (payload as AdminCandlesResponse).candles || []
  return candles.map((c) => ({
    time: c.time as UTCTimestamp,
    open: Number(c.open),
    close: Number(c.close),
    adjClose: Number((c as unknown as { adjClose?: number }).adjClose ?? c.close),
  }))
}

/**
 * Batch fetch multiple tickers in a single request (much faster than individual fetches)
 */
export const fetchOhlcSeriesBatch = async (
  tickers: string[],
  limit: number
): Promise<Map<string, CachedOhlcData>> => {
  const results = new Map<string, CachedOhlcData>()
  const now = Date.now()
  const tickersToFetch: string[] = []

  // Check cache first
  for (const ticker of tickers) {
    const key = getSeriesKey(ticker)
    const cached = ohlcDataCache.get(key)
    if (cached && cached.limit >= limit && now - cached.timestamp < OHLC_CACHE_TTL) {
      results.set(ticker, cached.data)
    } else {
      tickersToFetch.push(ticker)
    }
  }

  if (tickersToFetch.length === 0) {
    console.log(`[Backtest] All ${tickers.length} tickers served from cache`)
    return results
  }

  console.log(`[Backtest] Fetching ${tickersToFetch.length} tickers via batch API (${results.size} from cache)`)

  // Batch fetch in chunks of 500 (server limit)
  const BATCH_SIZE = 500
  for (let i = 0; i < tickersToFetch.length; i += BATCH_SIZE) {
    const batch = tickersToFetch.slice(i, i + BATCH_SIZE)
    const normalizedBatch = batch.map((t) => getSeriesKey(t))

    try {
      const res = await fetch('/api/candles/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: normalizedBatch, limit }),
      })

      if (!res.ok) {
        throw new Error(`Batch fetch failed: HTTP ${res.status}`)
      }

      const payload = (await res.json()) as {
        success: boolean
        results: Record<string, Array<{ time: number; open: number; close: number; adjClose: number }>>
        errors?: string[]
      }

      // Process results and cache them
      for (const [tickerKey, candles] of Object.entries(payload.results)) {
        const data = candles.map((c) => ({
          time: c.time as UTCTimestamp,
          open: Number(c.open),
          close: Number(c.close),
          adjClose: Number(c.adjClose ?? c.close),
        }))
        // Find original ticker (might have different case)
        const originalTicker = batch.find((t) => getSeriesKey(t) === tickerKey) || tickerKey
        results.set(originalTicker, data)
        ohlcDataCache.set(tickerKey, { data, limit, timestamp: now })
      }

      if (payload.errors && payload.errors.length > 0) {
        console.warn('[Backtest] Batch fetch errors:', payload.errors)
      }
    } catch (err) {
      console.error('[Backtest] Batch fetch failed, falling back to individual fetches:', err)
      // Fallback to individual fetches for this batch
      await Promise.all(
        batch.map(async (ticker) => {
          try {
            const data = await fetchOhlcSeries(ticker, limit)
            results.set(ticker, data)
            ohlcDataCache.set(getSeriesKey(ticker), { data, limit, timestamp: now })
          } catch (e) {
            console.warn(`[Backtest] Failed to fetch ${ticker}:`, e)
          }
        })
      )
    }
  }

  return results
}
