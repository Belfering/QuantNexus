# Phase 2: Frontend Restructure ✅ COMPLETE

**Timeline**: Days 5-18+ (Extended due to App.tsx being 20,945 lines, not 832 as estimated)
**Status**: ✅ COMPLETE

---

## Summary

**Starting Point:** App.tsx at 20,945 lines (monolithic)
**Ending Point:** App.tsx at 1,343 lines (93.6% reduction)

| Metric | Before | After | Reduction |
|--------|--------|-------|-----------|
| App.tsx lines | 20,945 | 1,343 | -19,602 (93.6%) |
| Main bundle | 1,279 KB | 925 KB | -354 KB (28%) |
| ModelTab props | 107 | ~20 | -87 (81%) |
| useState calls | 51+ | 18 | -33 (65%) |

---

## Sub-Phase Index

| Phase | Name | Status |
|-------|------|--------|
| 2A | Foundation | ✅ COMPLETE |
| 2B | Builder Utils | ✅ COMPLETE |
| 2C | Backtest Utils | ✅ COMPLETE |
| 2D | Watchlist Feature | ✅ COMPLETE |
| 2E | Builder Components | ✅ COMPLETE |
| 2F | Backtest Components | ✅ COMPLETE |
| 2G | Dashboard Components | ✅ COMPLETE |
| 2H | Admin Features | ✅ COMPLETE |
| 2I | Recent Extractions | ✅ COMPLETE |
| 2J | Backtest Engine | ✅ COMPLETE |
| 2K | Nexus Feature | ✅ COMPLETE |
| 2L | Auth Feature | ✅ COMPLETE |
| 2M | Data/Import Feature | ⬜ PENDING (deferred to Phase 4) |
| 2N | Tab Extraction + Zustand | ✅ COMPLETE |

---

## Phase 2A: Foundation ✅ COMPLETE

- [x] Extract types to `src/types/`
- [x] Extract constants (indicators, themes) to `src/constants/`
- [x] Create `src/shared/` utilities and components

---

## Phase 2B: Builder Utils ✅ COMPLETE

- [x] Extract `builder/utils/treeOperations.ts`
- [x] Extract `builder/utils/nodeFactory.ts`
- [x] Extract `builder/utils/helpers.ts`

---

## Phase 2C: Backtest Utils ✅ COMPLETE

- [x] Extract `backtest/utils/metrics.ts`
- [x] Extract `backtest/utils/compression.ts`
- [x] Extract `backtest/utils/downloads.ts`
- [x] Extract `backtest/utils/validation.ts`
- [x] Extract `backtest/components/BacktestModeDropdown.tsx`

---

## Phase 2D: Watchlist Feature ✅ COMPLETE

- [x] Extract `watchlist/api/index.ts` (API functions)
- [x] Extract `watchlist/utils/helpers.ts`
- [x] Extract `watchlist/hooks/useWatchlist.ts`

---

## Phase 2E: Builder Components ✅ COMPLETE

- [x] `builder/components/InsertMenu.tsx`
- [x] `builder/components/NodeCard/` - All sub-components
- [x] `builder/components/WeightPicker.tsx`
- [x] `builder/components/WeightDetailChip.tsx`
- [x] `builder/components/IndicatorDropdown.tsx`
- [x] `builder/components/ConditionEditor.tsx`
- [x] `builder/components/ColorPicker.tsx`
- [x] `builder/hooks/useTreeState.ts`
- [x] `builder/hooks/useClipboard.ts`
- [x] `builder/hooks/useNodeCallbacks.ts`

---

## Phase 2F: Backtest Components ✅ COMPLETE

- [x] `backtest/components/EquityChart.tsx`
- [x] `backtest/components/DrawdownChart.tsx`
- [x] `backtest/components/RangeNavigator.tsx`
- [x] `backtest/components/AllocationChart.tsx`
- [x] `backtest/components/MonthlyHeatmap.tsx`
- [x] `backtest/components/BacktesterPanel.tsx`
- [x] `backtest/utils/chartHelpers.ts`

---

## Phase 2G: Dashboard Components ✅ COMPLETE

- [x] `dashboard/components/DashboardPanel.tsx`
- [x] `dashboard/components/DashboardEquityChart.tsx`
- [x] `dashboard/components/PartnerTBillChart.tsx`
- [x] `dashboard/types.ts`
- [x] `dashboard/index.ts`

---

## Phase 2H: Admin Features ✅ COMPLETE

- [x] `admin/components/AdminDataPanel.tsx`
- [x] `admin/components/AdminPanel.tsx`
- [x] `admin/components/DatabasesPanel.tsx`
- [x] `admin/types.ts`
- [x] `admin/index.ts`

---

## Phase 2I: Recent Extractions ✅ COMPLETE

- [x] `features/bots/api/index.ts` - Bot CRUD API functions (~200 lines)
- [x] `features/data/utils/importParsers.ts` - Composer/QuantMage parsers (~660 lines)
- [x] `shared/components/TickerSearchModal.tsx` - Ticker search modal (~180 lines)
- [x] `shared/utils/ticker.ts` - Ticker normalization utilities (~30 lines)
- [x] `features/backtest/utils/indicators.ts` - All rolling indicator functions (~540 lines)

---

## Phase 2J: Backtest Engine Extraction ✅ COMPLETE

- [x] `backtest/engine/evalContext.ts` - EvalCtx type, metricAtIndex, metricAt
- [x] `backtest/engine/conditions.ts` - conditionExpr, evalConditions
- [x] `backtest/engine/traceCollector.ts` - createBacktestTraceCollector
- [x] `backtest/engine/allocation.ts` - volForAlloc, weightChildren, turnoverFraction
- [x] `backtest/engine/evaluator.ts` - evaluateNode
- [x] `backtest/engine/traceContributions.ts` - tracePositionContributions
- [x] `backtest/engine/index.ts` - Barrel export

---

## Phase 2K: Nexus Feature ✅ COMPLETE

- [x] `nexus/api/index.ts` - optimizeCorrelation, getCorrelationRecommendations
- [x] `nexus/hooks/useCorrelation.ts` - Full correlation state (~299 lines)
- [x] `nexus/index.ts` - Barrel export

---

## Phase 2L: Auth Feature ✅ COMPLETE

- [x] `auth/hooks/useAuth.ts` - Auth state management (~260 lines)
- [x] `auth/index.ts` - Barrel export

---

## Phase 2M: Data/Import Feature ⬜ PENDING

Deferred to Phase 4 (Client-Side Caching):
- [ ] `data/tickerCache.ts` - IndexedDB operations
- [ ] `data/deltaSync.ts` - Fetch only new data since last sync
- [ ] `data/hooks/useTickerData.ts` - Load/cache ticker data

---

## Phase 2N: Tab Extraction + Zustand ✅ COMPLETE

This was the largest sub-phase, broken into 26 sub-sub-phases.

### Phase 2N Results Summary

| Metric | Before 2N | After 2N | Reduction |
|--------|-----------|----------|-----------|
| App.tsx lines | 9,392 | 1,343 | -8,049 (86%) |
| Tab props (total) | ~271 | ~62 | -209 (77%) |
| useState calls | 51 | 18 | -33 (65%) |

### Lazy-Loaded Tab Chunks

| Tab | Chunk Size | gzip |
|-----|------------|------|
| AdminTab | 124 KB | 16 KB |
| DatabasesTab | 11 KB | 3 KB |
| NexusTab | 29 KB | 5 KB |
| DashboardTab | 91 KB | 12 KB |
| AnalyzeTab | 123 KB | 14 KB |
| HelpTab | 12 KB | 3 KB |
| ModelTab | 200 KB | 31 KB |

### Zustand Stores Created

```
src/stores/
├── index.ts              # Re-exports all stores
├── useAuthStore.ts       # userId, userRole, displayName, isAdmin
├── useUIStore.ts         # tabs, modals, collapse states
├── useBotStore.ts        # bots, activeBotId, clipboard, undo/redo
├── useBacktestStore.ts   # backtestMode, results, sanityReports
├── useDashboardStore.ts  # portfolio, buy/sell forms
└── useTreeStore.ts       # tree state with zundo (undo/redo)
```

### Custom Hooks Created

```
src/hooks/
├── useTreeSync.ts          # Sync tree store with active bot (~130 lines)
├── useBacktestRunner.ts    # Backtest execution (~471 lines)
├── useAnalyzeRunner.ts     # Analyze/sanity handlers (~565 lines)
├── useDashboardHandlers.ts # Dashboard buy/sell (~500 lines)
├── useBotOperations.ts     # Bot CRUD + import (~400 lines)
├── useWatchlistCallbacks.ts # Watchlist operations (~240 lines)
├── useUserDataSync.ts      # Data loading/sync (~230 lines)
├── useTickerManager.ts     # Ticker management (~155 lines)
└── useCallChainHandlers.ts # Call chain CRUD (~70 lines)
```

### Phase 2N Sub-Phases Detail

| Phase | Description | Result |
|-------|-------------|--------|
| 2N-1 | AppContext (auth-only) | ✅ |
| 2N-2 | Dashboard Hook | ✅ |
| 2N-3 | Tab Lazy Loading | ✅ All 7 tabs |
| 2N-4 | Vite Chunking | ⬜ Optional |
| 2N-5 | API Consolidation | ✅ -213 lines |
| 2N-6 | Tab Extraction | ✅ |
| 2N-7 | Tab Wrappers | ✅ |
| 2N-11 | Duplicate Removal | ✅ -1,778 lines |
| 2N-12 | Pure Functions | ✅ -342 lines |
| 2N-13 | Zustand Stores | ✅ 5 stores |
| 2N-14 | Tab Store Integration | ✅ -155 props |
| 2N-15 | Tree Store (zundo) | ✅ -415 lines |
| 2N-16 | Backtest Extraction | ✅ -437 lines |
| 2N-17 | Analyze Extraction | ✅ -466 lines |
| 2N-18 | Dashboard Extraction | ✅ -420 lines |
| 2N-19 | Bot Operations | ✅ -384 lines |
| 2N-20 | Watchlist Callbacks | ✅ -120 lines |
| 2N-21 | User Data Sync | ✅ -228 lines |
| 2N-22 | Ticker Manager | ✅ -70 lines |
| 2N-23 | AppHeader | ⬜ Planned |
| 2N-24 | Call Chain Handlers | ✅ -37 lines |
| 2N-25 | React Hooks Fixes | ✅ -17 errors |
| 2N-26 | Master Integration | ✅ All features |

### Phase 2N-26: Master Feature Integration ✅ COMPLETE

All features from master merged into refactored architecture:

**Bug Fixes (2N-26d):**
- [x] Case-insensitive indicator mapping (`importWorker.ts:128`)
- [x] Frontend adjClose fix (`evalContext.ts:70`)
- [x] Backtest state closure bug (`useBotOperations.ts:158`)
- [x] Database panel auth headers (uses `authFetch`)

**Core Features (2N-26e):**
- [x] Subspell references (`branch:from`, `branch:to`)
- [x] Ratio ticker support (`SPY/AGG` style)
- [x] Auto-run robustness after backtest

**Admin Features (2N-26f):**
- [x] Atlas Systems tab (inline in `AdminPanel.tsx:2270-2309`)
- [x] Trading Control tab (inline in `AdminPanel.tsx:1856-2180`)

**Polish (2N-26g):**
- [x] EnterExit import handler (`importWorker.ts:661-683`)
- [x] Fragility fingerprints 2x4 grid (`RobustnessTabContent.tsx:98-110`)
