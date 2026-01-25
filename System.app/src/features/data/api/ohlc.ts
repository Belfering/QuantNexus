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
// Max cache size: 5000 tickers × 5000 rows × 5 fields × 8 bytes ≈ 1GB limit
const MAX_CACHE_SIZE = 5000

export const ohlcDataCache = new Map<string, { data: CachedOhlcData; limit: number; timestamp: number; lastAccessed: number }>()

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
      // Update last accessed time for LRU tracking
      cached.lastAccessed = now
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

        // Evict LRU entries if cache is full
        if (ohlcDataCache.size >= MAX_CACHE_SIZE) {
          const entries = Array.from(ohlcDataCache.entries())
          // Sort by lastAccessed (oldest first)
          entries.sort((a, b) => (a[1].lastAccessed || 0) - (b[1].lastAccessed || 0))
          // Remove oldest 10% of entries
          const toRemove = Math.floor(MAX_CACHE_SIZE * 0.1)
          for (let j = 0; j < toRemove && j < entries.length; j++) {
            ohlcDataCache.delete(entries[j][0])
          }
          console.log(`[OHLC Cache] Evicted ${toRemove} LRU entries (cache size: ${ohlcDataCache.size})`)
        }

        ohlcDataCache.set(tickerKey, { data, limit, timestamp: now, lastAccessed: now })
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
            ohlcDataCache.set(getSeriesKey(ticker), { data, limit, timestamp: now, lastAccessed: now })
          } catch (e) {
            console.warn(`[Backtest] Failed to fetch ${ticker}:`, e)
          }
        })
      )
    }
  }

  return results
}

// Guard to prevent multiple simultaneous pre-cache operations
let preCacheInProgress = false

/**
 * Pre-cache all ETFs for faster subsequent backtests
 * Called on login to populate cache with all ETF tickers
 * Takes ~10-20 seconds to cache ~4600 ETFs
 * Uses progressive loading with delays to prevent heap overflow
 */
export const preCacheAllETFs = async (
  limit: number = 15000,
  onProgress?: (loaded: number, total: number) => void
): Promise<void> => {
  // Prevent multiple simultaneous pre-cache operations
  if (preCacheInProgress) {
    console.log('[OHLC Cache] Pre-cache already in progress, skipping...')
    return
  }

  preCacheInProgress = true
  console.log('[OHLC Cache] Pre-caching all ETFs...')

  try {
    // Fetch only ETF tickers from server (not all 12,066 tickers!)
    // This prevents heap overflow by limiting cache to ~4600 ETFs instead of all tickers
    const response = await fetch('/api/parquet-tickers?assetType=ETF')
    if (!response.ok) {
      throw new Error('Failed to fetch ETF ticker list')
    }

    const data = (await response.json()) as { tickers: string[] }
    const etfTickers = (data.tickers || []).filter((t) => t !== 'Empty')

    console.log(`[OHLC Cache] Found ${etfTickers.length} ETFs to pre-cache`)

    // Progressive loading with memory management
    // Fetch in smaller chunks with delays to prevent heap overflow
    const CHUNK_SIZE = 500 // Server batch limit
    const DELAY_MS = 500 // Delay between batches to allow GC
    const now = Date.now()
    let totalCached = 0

    for (let i = 0; i < etfTickers.length; i += CHUNK_SIZE) {
      const chunk = etfTickers.slice(i, i + CHUNK_SIZE)

      // Clear stale entries before fetching new batch (memory management)
      if (i > 0) {
        const cacheKeys = Array.from(ohlcDataCache.keys())
        for (const key of cacheKeys) {
          const cached = ohlcDataCache.get(key)
          if (cached && now - cached.timestamp >= OHLC_CACHE_TTL) {
            ohlcDataCache.delete(key)
          }
        }
      }

      // Fetch batch
      const results = await fetchOhlcSeriesBatch(chunk, limit)
      totalCached += results.size

      console.log(`[OHLC Cache] Progress: ${totalCached}/${etfTickers.length} tickers cached`)

      if (onProgress) {
        onProgress(totalCached, etfTickers.length)
      }

      // Add delay between batches to allow garbage collection (except last batch)
      if (i + CHUNK_SIZE < etfTickers.length) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS))
      }
    }

    console.log(`[OHLC Cache] Successfully pre-cached ${totalCached}/${etfTickers.length} ETFs`)
  } catch (err) {
    console.warn('[OHLC Cache] Failed to pre-cache ETFs:', err)
    // Don't throw - pre-caching is optional optimization
  } finally {
    preCacheInProgress = false
  }
}

/**
 * Ensure all required tickers are cached before backtest
 * Fetches missing tickers from server if needed
 */
export const ensureTickersAvailable = async (tickers: string[], limit: number = 15000): Promise<void> => {
  const missing: string[] = []
  const now = Date.now()

  // Check which tickers are missing or stale in cache
  for (const ticker of tickers) {
    if (ticker === 'Empty') continue // Skip empty positions

    const key = getSeriesKey(ticker)
    const cached = ohlcDataCache.get(key)

    if (!cached || cached.limit < limit || now - cached.timestamp >= OHLC_CACHE_TTL) {
      missing.push(ticker)
    }
  }

  // Fetch missing tickers
  if (missing.length > 0) {
    console.log(`[OHLC Cache] Fetching ${missing.length} missing tickers before backtest:`, missing)
    await fetchOhlcSeriesBatch(missing, limit)
  } else {
    console.log('[OHLC Cache] All required tickers already cached')
  }
}
