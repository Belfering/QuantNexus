# FRD-031: Server Cache Management (Admin Clear Cache Button)

## Priority: HIGH (Critical for development/debugging)

## Problem
Developers need to force re-runs of all calculations to verify correctness instead of using potentially stale cached data. Currently there's no way to clear server-side indicator/system caches without restarting the server.

## Current State
- **Cache Database**: `server/data/backtest_cache.db` with 4 tables:
  - `backtest_cache` - Full backtest results
  - `sanity_report_cache` - Robustness reports
  - `benchmark_metrics_cache` - Benchmark comparisons
  - `cache_metadata` - Daily refresh tracking
- **Cache Functions** (`server/db/cache.mjs`):
  - `invalidateAllCache()` - Exists but not exposed to UI
  - `getCacheStats()` - Returns entry counts
- **Ticker Data Cache**: In-memory Map in `server/backtest.mjs` (tickerDataCache)

## Solution

### Admin Tab Button
Add "Clear Server Cache" button to Admin > Nexus Maintenance tab.

### Implementation

**File**: `src/features/admin/components/AdminPanel.tsx`
```typescript
// In Nexus Maintenance section, add button:
<Button
  variant="destructive"
  onClick={async () => {
    if (!confirm('Clear ALL server caches? This will force recalculation of all backtests.')) return
    const res = await fetch('/api/admin/cache/clear-all', { method: 'POST' })
    if (res.ok) toast.success('All caches cleared')
  }}
>
  Clear Server Cache
</Button>
```

**File**: `server/index.mjs`
```javascript
// New endpoint
app.post('/api/admin/cache/clear-all', requireAdmin, async (req, res) => {
  try {
    // Clear SQLite caches
    await cache.invalidateAllCache()

    // Clear in-memory ticker data cache (keep parquet files)
    tickerDataCache.clear()

    // Clear any indicator pre-computation caches
    indicatorCache?.clear?.()

    res.json({ success: true, message: 'All caches cleared' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})
```

### Files to Modify
| File | Change |
|------|--------|
| `src/features/admin/components/AdminPanel.tsx` | Add "Clear Server Cache" button |
| `server/index.mjs` | Add `/api/admin/cache/clear-all` endpoint |
| `server/db/cache.mjs` | Ensure `invalidateAllCache()` clears all 4 tables |
