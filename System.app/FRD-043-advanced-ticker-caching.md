# FRD-043: Advanced Ticker Data Caching Enhancements

## Priority: MEDIUM (Performance optimization)

## Context
**Related Work**: The basic ticker pre-caching system was implemented to fix missing benchmark data issues. On login, all ~4600 ETFs are pre-cached to client memory (20-30MB, 5-minute TTL). This resolves benchmark data availability but leaves room for further optimization.

**Current Implementation**:
- All ETFs pre-cached on login (~10-20 seconds)
- In-memory Map cache with 5-minute TTL
- Pre-flight check fetches missing tickers before backtest
- ~95% cache hit rate for ETF-based strategies

## Problem
While the current implementation solves the immediate problem, several advanced caching features could further improve performance and user experience:

1. **Session Persistence**: Cache is lost on browser refresh
2. **Inefficient Warming**: All 4600 tickers at once, even if user only needs 50
3. **No Prioritization**: All tickers treated equally, no smart prefetching
4. **Unlimited Growth**: No cache size limits or eviction policy
5. **Online-Only**: No offline mode for cached data

## Proposed Enhancements

### 1. IndexedDB Persistence for Longer-Term Caching
**Goal**: Persist cache across browser sessions

**Implementation**:
```typescript
// New file: src/features/data/storage/indexedDB.ts
interface CachedTickerRecord {
  ticker: string
  data: CachedOhlcData
  limit: number
  timestamp: number
  lastAccessed: number
}

class TickerCacheDB {
  private db: IDBDatabase

  async save(ticker: string, data: CachedOhlcData, limit: number): Promise<void>
  async get(ticker: string): Promise<CachedTickerRecord | null>
  async getAll(): Promise<CachedTickerRecord[]>
  async delete(ticker: string): Promise<void>
  async clear(): Promise<void>
}
```

**Benefits**:
- Instant cache warmup on page load (read from IndexedDB)
- Survives browser refresh
- Reduced network requests (cache persists longer than 5 minutes)

**Files to Modify**:
- `src/features/data/storage/indexedDB.ts` (NEW) - IndexedDB wrapper
- `src/features/data/api/ohlc.ts` - Add IndexedDB layer under in-memory cache
- `src/hooks/useUserDataSync.ts` - Load from IndexedDB before pre-caching

### 2. Smart Pre-Caching Based on User's Most-Used Tickers
**Goal**: Prioritize frequently used tickers

**Implementation**:
```typescript
// Track ticker usage
interface TickerUsageStats {
  ticker: string
  accessCount: number
  lastAccessed: number
  backtestCount: number
}

// Store in localStorage or IndexedDB
const updateTickerUsage = (ticker: string) => {
  const stats = getTickerUsage()
  stats[ticker] = {
    ticker,
    accessCount: (stats[ticker]?.accessCount || 0) + 1,
    lastAccessed: Date.now(),
    backtestCount: (stats[ticker]?.backtestCount || 0) + 1,
  }
  saveTickerUsage(stats)
}

// Pre-cache in order of usage frequency
const getPreCachePriority = (): string[] => {
  const usage = getTickerUsage()
  const sorted = Object.values(usage)
    .sort((a, b) => b.accessCount - a.accessCount)
  return sorted.map(s => s.ticker)
}
```

**Benefits**:
- Faster cache warming for frequent users
- Personalized caching strategy
- Reduced memory footprint (cache only what's needed)

**Files to Modify**:
- `src/features/data/api/ohlc.ts` - Add usage tracking to fetch functions
- `src/features/data/storage/tickerUsage.ts` (NEW) - Usage tracking
- `src/hooks/useUserDataSync.ts` - Use priority list for pre-caching

### 3. Progressive Cache Warming
**Goal**: Fetch popular tickers first, rest later

**Implementation**:
```typescript
// Phase 1: Common benchmarks (instant - 100ms)
const CRITICAL_TICKERS = ['SPY', 'QQQ', 'BIL', 'IWM', 'TLT']

// Phase 2: User's most-used (fast - 1 second)
const userFrequentTickers = getTopUserTickers(50)

// Phase 3: All ETFs (background - 10-20 seconds)
const allETFs = getAllETFs()

// Progressive loading
export const progressivePreCache = async () => {
  await fetchOhlcSeriesBatch(CRITICAL_TICKERS, 5000)  // Phase 1
  await fetchOhlcSeriesBatch(userFrequentTickers, 5000)  // Phase 2
  fetchOhlcSeriesBatch(allETFs, 5000).catch(console.warn)  // Phase 3 (background)
}
```

**Benefits**:
- Instant benchmark availability
- Perceived performance improvement
- Non-blocking UI during full cache load

**Files to Modify**:
- `src/features/data/api/ohlc.ts` - Add `progressivePreCache()`
- `src/hooks/useUserDataSync.ts` - Use progressive loading instead of single batch

### 4. Cache Size Limits and LRU Eviction
**Goal**: Prevent unlimited memory growth

**Implementation**:
```typescript
// LRU Cache implementation
class LRUCache<K, V> {
  private maxSize: number
  private cache: Map<K, { value: V; timestamp: number }>
  private accessOrder: K[]

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize
    this.cache = new Map()
    this.accessOrder = []
  }

  get(key: K): V | undefined {
    const item = this.cache.get(key)
    if (!item) return undefined

    // Move to end (most recently used)
    this.accessOrder = this.accessOrder.filter(k => k !== key)
    this.accessOrder.push(key)

    return item.value
  }

  set(key: K, value: V): void {
    // Evict least recently used if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const lru = this.accessOrder.shift()
      if (lru) this.cache.delete(lru)
    }

    this.cache.set(key, { value, timestamp: Date.now() })
    this.accessOrder.push(key)
  }
}

// Replace Map with LRU cache
export const ohlcDataCache = new LRUCache<string, CachedOhlcData>(5000)
```

**Benefits**:
- Predictable memory usage
- Automatic eviction of unused tickers
- Better performance on long-running sessions

**Files to Modify**:
- `src/features/data/storage/lruCache.ts` (NEW) - LRU cache implementation
- `src/features/data/api/ohlc.ts` - Replace Map with LRUCache

### 5. Offline Mode with Cached Data Only
**Goal**: Allow backtests with cached data when offline

**Implementation**:
```typescript
// Offline detection
const isOffline = () => !navigator.onLine

// Offline backtest mode
const runOfflineBacktest = async (node: FlowNode) => {
  const requiredTickers = collectAllTickers(node)
  const cachedTickers = Array.from(ohlcDataCache.keys())

  const missing = requiredTickers.filter(t => !cachedTickers.includes(t))

  if (missing.length > 0) {
    throw new Error(`Cannot run offline backtest: Missing data for ${missing.join(', ')}`)
  }

  // Run backtest with cached data only (client-side engine)
  return runClientSideBacktest(node, ohlcDataCache)
}

// UI indicator
<div className="offline-banner">
  {isOffline() && (
    <Alert>
      Offline mode - backtests limited to cached tickers ({ohlcDataCache.size} available)
    </Alert>
  )}
</div>
```

**Benefits**:
- Work without internet connection
- Useful for demos/presentations
- Resilience to network issues

**Files to Modify**:
- `src/hooks/useBacktestRunner.ts` - Add offline mode check
- `src/features/backtest/engine/clientSideEngine.ts` (NEW) - Client-side backtest
- `src/components/OfflineIndicator.tsx` (NEW) - Offline status UI

## Files to Create

### Core Storage
1. `src/features/data/storage/indexedDB.ts` - IndexedDB persistence layer
2. `src/features/data/storage/lruCache.ts` - LRU cache implementation
3. `src/features/data/storage/tickerUsage.ts` - Usage tracking

### Offline Support
4. `src/features/backtest/engine/clientSideEngine.ts` - Client-side backtest engine
5. `src/components/OfflineIndicator.tsx` - Offline status banner

## Files to Modify

1. `src/features/data/api/ohlc.ts` - Add IndexedDB layer, LRU cache, progressive loading
2. `src/hooks/useUserDataSync.ts` - Update pre-caching strategy
3. `src/hooks/useBacktestRunner.ts` - Add offline mode support
4. `src/App.tsx` - Add offline indicator

## Technical Considerations

### IndexedDB
- **Storage Limit**: ~50MB typical, up to several GB on Chrome
- **Async API**: All operations are async (Promise-based)
- **Structured Data**: Can store large objects efficiently
- **Same-Origin**: Per-domain storage

### LRU Cache
- **Max Size**: 5000 tickers = ~50-60MB (conservative limit)
- **Eviction**: Least recently used first
- **Thread-Safe**: Not needed (single-threaded JavaScript)

### Progressive Loading
- **Phase 1**: 5 tickers (~50KB) - instant
- **Phase 2**: 50 user tickers (~500KB) - 1 second
- **Phase 3**: 4600 ETFs (~20-30MB) - background (10-20 seconds)

### Offline Mode
- **Client-Side Engine**: Requires porting server backtest logic to client
- **Data Availability**: Only works with cached tickers
- **Limitation**: No indicator calculation (requires server-side DuckDB)

## Migration Path

### Phase 1: IndexedDB Persistence (Week 1)
- Add IndexedDB layer under existing in-memory cache
- Populate IndexedDB during pre-cache
- Load from IndexedDB on login

### Phase 2: Smart Pre-Caching (Week 2)
- Add usage tracking to fetch functions
- Implement progressive loading strategy
- Show cache loading progress indicator

### Phase 3: LRU Eviction (Week 3)
- Replace Map with LRU cache
- Add cache size monitoring
- Test with long-running sessions

### Phase 4: Offline Mode (Week 4)
- Port backtest engine to client-side
- Add offline detection
- UI for offline status and limitations

## Success Metrics

1. **Cache Persistence**: 0ms cache warmup on page refresh (vs 10-20 seconds)
2. **Smart Pre-Caching**: Top 50 user tickers cached in < 1 second
3. **Progressive Loading**: Critical tickers (SPY, QQQ, BIL) available in < 100ms
4. **Memory Usage**: Cache stays under 60MB even after hours of use
5. **Offline Mode**: 100% success rate for backtests with cached tickers

## Future Considerations

1. **Service Worker**: Background cache updates while app is closed
2. **Cache Sync**: Sync cache across browser tabs
3. **Compression**: Compress cached data (reduce size by 50-70%)
4. **Prefetching**: Predict and prefetch tickers based on user behavior
5. **Cloud Sync**: Sync cache across devices (requires backend)

## Dependencies

- **Dexie.js**: Modern IndexedDB wrapper (recommended)
- **idb**: Lightweight IndexedDB wrapper alternative
- None for LRU, progressive loading, or offline mode (vanilla JS)

## Risk Assessment

**Medium Risk**:
- IndexedDB has browser compatibility issues (Safari limitations)
- Client-side backtest engine requires significant porting effort
- LRU eviction could evict tickers that are still needed
- Offline mode is complex and may not be worth the effort

**Mitigation**:
- Graceful degradation (fall back to in-memory cache if IndexedDB fails)
- Start with IndexedDB and smart pre-caching (lower risk, high value)
- Skip offline mode if complexity is too high
- Extensive testing on different browsers and devices
