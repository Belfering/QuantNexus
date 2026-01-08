# Phase 4: Client-Side Caching ⬜ PENDING

**Timeline**: Days 11-12
**Status**: ⬜ PENDING

---

## Tasks

- [ ] Implement `src/features/data/tickerCache.ts` (IndexedDB)
- [ ] Implement `src/features/data/deltaSync.ts`
- [ ] Add `?since=` parameter to candles endpoint
- [ ] Extend cache TTL from 5min to 24h
- [ ] Test cold start performance

---

## Goal

Reduce cold start time from 30+ seconds to < 1 second by caching ticker data in IndexedDB.

---

## Implementation Details

### IndexedDB Ticker Cache

```typescript
// src/features/data/tickerCache.ts
import { openDB, DBSchema, IDBPDatabase } from 'idb'

interface TickerCacheDB extends DBSchema {
  tickers: {
    key: string  // ticker symbol
    value: {
      ticker: string
      data: OHLC[]
      lastUpdated: number  // Unix timestamp
    }
  }
}

let db: IDBPDatabase<TickerCacheDB> | null = null

export async function initTickerCache() {
  db = await openDB<TickerCacheDB>('ticker-cache', 1, {
    upgrade(db) {
      db.createObjectStore('tickers', { keyPath: 'ticker' })
    }
  })
}

export async function getCachedTicker(ticker: string) {
  if (!db) await initTickerCache()
  return db!.get('tickers', ticker)
}

export async function setCachedTicker(ticker: string, data: OHLC[]) {
  if (!db) await initTickerCache()
  await db!.put('tickers', {
    ticker,
    data,
    lastUpdated: Date.now()
  })
}

export async function getCacheTimestamp(ticker: string): Promise<number | null> {
  const cached = await getCachedTicker(ticker)
  return cached?.lastUpdated ?? null
}
```

### Delta Sync

```typescript
// src/features/data/deltaSync.ts
import { getCachedTicker, setCachedTicker, getCacheTimestamp } from './tickerCache'

export async function fetchTickerWithDelta(ticker: string): Promise<OHLC[]> {
  const cached = await getCachedTicker(ticker)
  const lastUpdated = cached?.lastUpdated

  // If we have cached data, only fetch new records
  const url = lastUpdated
    ? `/api/candles/${ticker}?since=${lastUpdated}`
    : `/api/candles/${ticker}`

  const response = await fetch(url)
  const newData = await response.json()

  if (cached && newData.length > 0) {
    // Merge new data with cached data
    const merged = [...cached.data, ...newData]
    await setCachedTicker(ticker, merged)
    return merged
  } else if (cached) {
    // No new data, return cached
    return cached.data
  } else {
    // No cache, store full response
    await setCachedTicker(ticker, newData)
    return newData
  }
}
```

### Server-Side Delta Support

```javascript
// server/features/data/routes.mjs
router.get('/candles/:ticker', async (req, res) => {
  const { ticker } = req.params
  const { since } = req.query  // Unix timestamp

  let query = `SELECT * FROM read_parquet('${parquetPath}')`

  if (since) {
    const sinceDate = new Date(parseInt(since)).toISOString().slice(0, 10)
    query += ` WHERE date > '${sinceDate}'`
  }

  query += ' ORDER BY date ASC'

  const result = await duckdb.all(query)
  res.json(result)
})
```

---

## Success Criteria

- [ ] IndexedDB stores ticker data across sessions
- [ ] Delta sync only fetches new data after cache
- [ ] Cold start time < 1 second for returning users
- [ ] Cache survives browser refresh and restarts
- [ ] Cache invalidation works correctly on data updates
