// src/hooks/useTickerManager.ts
// Hook for ticker loading and management (Phase 2N-22)

import { useCallback, useEffect, useMemo, useState } from 'react'

interface TickerMetadata {
  assetType?: string
  name?: string
  exchange?: string
}

interface UseTickerManagerOptions {
  etfsOnlyMode: boolean
}

const normalizeTickersForUi = (tickers: string[]): string[] => {
  const normalized = tickers
    .map((t) => String(t || '').trim().toUpperCase())
    .filter(Boolean)

  const set = new Set(normalized)
  set.delete('EMPTY')
  const sorted = Array.from(set).sort((a, b) => a.localeCompare(b))
  return ['Empty', ...sorted]
}

/**
 * Hook that manages ticker loading, metadata, and filtering
 * Extracts ticker logic from App.tsx (Phase 2N-22)
 */
export function useTickerManager({ etfsOnlyMode }: UseTickerManagerOptions) {
  const [availableTickers, setAvailableTickers] = useState<string[]>([])
  const [tickerMetadata, setTickerMetadata] = useState<Map<string, TickerMetadata>>(new Map())
  const [tickerApiError, setTickerApiError] = useState<string | null>(null)

  const loadAvailableTickers = useCallback(async () => {
    const tryLoad = async (url: string) => {
      const res = await fetch(url)
      const text = await res.text()
      let payload: unknown = null
      try {
        payload = text ? (JSON.parse(text) as unknown) : null
      } catch {
        throw new Error(
          `Tickers failed (${res.status}). Non-JSON response from ${url}: ${text ? text.slice(0, 200) : '<empty>'}`,
        )
      }
      if (!res.ok) {
        if (payload && typeof payload === 'object' && 'error' in payload) {
          throw new Error(String((payload as { error?: unknown }).error ?? `Tickers failed (${res.status})`))
        }
        throw new Error(`Tickers failed (${res.status})`)
      }
      if (!payload || typeof payload !== 'object' || !('tickers' in payload)) throw new Error('Tickers failed.')
      const tickers = (payload as { tickers?: unknown }).tickers
      return Array.isArray(tickers) ? (tickers as string[]) : []
    }

    const tryLoadFromBase = async (baseUrl: string) => {
      const prefix = baseUrl ? String(baseUrl).replace(/\/+$/, '') : ''
      const [fileTickers, parquetTickers] = await Promise.allSettled([
        tryLoad(`${prefix}/api/tickers`),
        tryLoad(`${prefix}/api/parquet-tickers`),
      ])

      const out = new Set<string>()
      if (fileTickers.status === 'fulfilled') {
        for (const t of fileTickers.value) out.add(t)
      }
      if (parquetTickers.status === 'fulfilled') {
        for (const t of parquetTickers.value) out.add(t)
      }
      if (out.size > 0) return Array.from(out).sort()

      const reasons = [fileTickers, parquetTickers]
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map((r) => String(r.reason?.message || r.reason))
        .filter(Boolean)
      throw new Error(reasons.join(' | ') || 'Ticker endpoints failed.')
    }

    try {
      setAvailableTickers(await tryLoadFromBase(''))
      setTickerApiError(null)
    } catch (e) {
      try {
        setAvailableTickers(await tryLoadFromBase('http://localhost:8787'))
        setTickerApiError(null)
      } catch (e2) {
        setAvailableTickers([])
        setTickerApiError(
          `Ticker API not reachable. Start the backend with "cd System.app" then "npm run api". (${String(
            (e2 as Error)?.message || (e as Error)?.message || 'unknown error',
          )})`,
        )
      }
    }
  }, [])

  // Initial load
  useEffect(() => {
    const t = window.setTimeout(() => {
      void loadAvailableTickers()
    }, 0)
    return () => window.clearTimeout(t)
  }, [loadAvailableTickers])

  // Retry loading tickers if there was an error (e.g., rate limiting)
  useEffect(() => {
    if (!tickerApiError) return
    const retryInterval = window.setInterval(() => {
      void loadAvailableTickers()
    }, 5000) // Retry every 5 seconds
    return () => window.clearInterval(retryInterval)
  }, [tickerApiError, loadAvailableTickers])

  // Load ticker metadata for ETFs Only filtering
  useEffect(() => {
    const loadMetadata = async () => {
      try {
        const res = await fetch('/api/tickers/registry/metadata')
        if (res.ok) {
          const data = await res.json()
          if (data.tickers && Array.isArray(data.tickers)) {
            const map = new Map<string, TickerMetadata>()
            for (const t of data.tickers) {
              if (t.ticker) {
                map.set(t.ticker.toUpperCase(), { assetType: t.assetType, name: t.name, exchange: t.exchange })
              }
            }
            setTickerMetadata(map)
          }
        }
      } catch {
        // Ignore metadata loading errors - ETFs Only mode just won't filter
      }
    }
    void loadMetadata()
  }, [])

  const tickerOptions = useMemo(() => {
    const normalized = normalizeTickersForUi(availableTickers)
    if (!etfsOnlyMode) return normalized
    // Filter to ETFs only using metadata
    return normalized.filter(t => {
      const meta = tickerMetadata.get(t.toUpperCase())
      // Include if it's an ETF, or if we don't have metadata (don't exclude unknowns)
      return meta?.assetType === 'ETF' || !meta
    })
  }, [availableTickers, etfsOnlyMode, tickerMetadata])

  return {
    availableTickers,
    setAvailableTickers,
    tickerMetadata,
    tickerApiError,
    tickerOptions,
    refreshTickers: loadAvailableTickers,
  }
}
