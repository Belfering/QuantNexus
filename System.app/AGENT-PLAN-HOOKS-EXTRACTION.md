# Agent Plan: Hooks Extraction (Phase 2N-8/9/10)

## Overview

Extract ~203 hook usages from `App.tsx` (4,238 lines) into focused custom hooks organized by domain.

**Goal**: Reduce App.tsx to ~2,000-2,500 lines by moving state, callbacks, and effects into reusable hooks.

**Branch**: `feature/frd-030-architecture-overhaul`

---

## Current State

- App.tsx: 4,238 lines
- ~70 useState declarations
- ~60 useCallback declarations
- ~25 useEffect declarations
- ~15 useMemo declarations
- Build: Passing

---

## Extraction Plan

### Hook 1: `src/hooks/useAuthState.ts` (~150 lines)

**State to extract:**
```typescript
// Lines 467-469
const [userId, setUserId] = useState<UserId | null>()
const [userRole, setUserRole] = useState<string | null>()
const [userDisplayName, setUserDisplayName] = useState<string | null>()

// Lines 889-894 (display name UI)
const [displayNameInput, setDisplayNameInput] = useState<string>('')
const [displayNameSaving, setDisplayNameSaving] = useState(false)
const [displayNameError, setDisplayNameError] = useState<string | null>(null)
const [displayNameSuccess, setDisplayNameSuccess] = useState(false)
const [displayNameAvailable, setDisplayNameAvailable] = useState<boolean | null>(null)
const [displayNameChecking, setDisplayNameChecking] = useState(false)
```

**Callbacks to extract:**
```typescript
// Line 3566 - checkDisplayNameAvailability
// Lines 3476-3482 - handleLogin/handleLogout logic
```

**Effects to extract:**
```typescript
// Line 3593 - display name debounce effect
```

**Return type:**
```typescript
interface UseAuthState {
  userId: UserId | null
  userRole: string | null
  userDisplayName: string | null
  setUserId: (id: UserId | null) => void
  setUserRole: (role: string | null) => void
  setUserDisplayName: (name: string | null) => void
  // Display name UI
  displayNameInput: string
  setDisplayNameInput: (v: string) => void
  displayNameSaving: boolean
  displayNameError: string | null
  displayNameSuccess: boolean
  displayNameAvailable: boolean | null
  displayNameChecking: boolean
  checkDisplayNameAvailability: (name: string) => Promise<void>
  handleLogin: (id: UserId, role: string, displayName: string | null) => void
  handleLogout: () => void
}
```

---

### Hook 2: `src/hooks/useBotSessions.ts` (~200 lines)

**State to extract:**
```typescript
// Lines 870-875
const [bots, setBots] = useState<BotSession[]>()
const [activeBotId, setActiveBotId] = useState<string>()
const [clipboard, setClipboard] = useState<FlowNode | null>(null)
const [copiedNodeId, setCopiedNodeId] = useState<string | null>(null)
const [copiedCallChainId, setCopiedCallChainId] = useState<string | null>(null)
const [isImporting, setIsImporting] = useState(false)
```

**Memos to extract:**
```typescript
// Line 857 - createBotSession
// Line 869 - initialBot
// Line 1006 - activeBot
```

**Callbacks to extract:**
```typescript
// Line 1597 - push (history)
// Line 1635 - handleCloseBot
// Line 2236 - handleDuplicateBot
// Line 2256 - handleExport
// Line 2272 - handleExportBot
// Line 3147 - handleImport
```

---

### Hook 3: `src/hooks/useSavedBots.ts` (~250 lines)

**State to extract:**
```typescript
// Lines 477-478
const [savedBots, setSavedBots] = useState<SavedBot[]>()
const [watchlists, setWatchlists] = useState<Watchlist[]>()

// Line 525
const [_botsLoadedFromApi, setBotsLoadedFromApi] = useState(false)
// Line 607
const [_watchlistsLoadedFromApi, setWatchlistsLoadedFromApi] = useState(false)
```

**Memos to extract:**
```typescript
// Line 1115 - watchlistsById
// Line 1116 - watchlistsByBotId
// Line 1128 - allWatchlistedBotIds
// Line 1134 - analyzeVisibleBotIds
// Line 1145 - eligibleBots
```

**Callbacks to extract:**
```typescript
// Line 2302 - handleOpenBot
// Line 2336 - resolveWatchlistId
// Line 2361 - addBotToWatchlist
// Line 2376 - removeBotFromWatchlist
// Line 2392 - computeEtfsOnlyTag
// Line 2404 - handleSaveToWatchlist
// Line 3040 - handleCopySaved
// Line 3061 - handleCopyToNew
// Line 3104 - handleDeleteSaved
// Line 3113 - handleOpenSaved
```

**Effects to extract:**
```typescript
// Line 526 - load bots from API
// Line 608 - load watchlists from API
```

---

### Hook 4: `src/hooks/useBacktestState.ts` (~300 lines)

**State to extract:**
```typescript
// Lines 484-496
const [analyzeBacktests, setAnalyzeBacktests] = useState<Record<string, AnalyzeBacktestState>>({})
const [analyzeTickerContrib, setAnalyzeTickerContrib] = useState<Record<string, TickerContributionState>>({})
const [sanityReports, setSanityReports] = useState<Record<string, SanityReportState>>({})
const [benchmarkMetrics, setBenchmarkMetrics] = useState<...>()
const [modelSanityReport, setModelSanityReport] = useState<SanityReportState>()

// Lines 518-521
const [backtestMode, setBacktestMode] = useState<BacktestMode>('CC')
const [backtestCostBps, setBacktestCostBps] = useState<number>(5)
const [backtestBenchmark, setBacktestBenchmark] = useState<string>('SPY')
const [backtestShowBenchmark, setBacktestShowBenchmark] = useState<boolean>(true)
```

**Callbacks to extract:**
```typescript
// Line 1788 - updateActiveBotBacktest
// Line 1796 - handleJumpToBacktestError
// Line 1808 - runBacktestForNode (LARGE - ~400 lines)
// Line 2213 - handleRunBacktest
// Line 2481 - runAnalyzeBacktest (LARGE - ~280 lines)
// Line 2765 - runSanityReport
// Line 2802 - fetchBenchmarkMetrics
// Line 2823 - runModelRobustness
// Line 2862 - runAnalyzeTickerContribution
```

**Note**: `runBacktestForNode` and `runAnalyzeBacktest` are very large. Consider extracting to separate file `src/features/backtest/hooks/useBacktestRunner.ts`.

---

### Hook 5: `src/hooks/useDashboardState.ts` (~200 lines)

**State to extract:**
```typescript
// Lines 482-483
const [dashboardPortfolio, setDashboardPortfolio] = useState<DashboardPortfolio>()
const [_portfolioLoading, setPortfolioLoading] = useState(false)

// Lines 957-965
const [dashboardTimePeriod, setDashboardTimePeriod] = useState<DashboardTimePeriod>('1Y')
const [dashboardBotExpanded, setDashboardBotExpanded] = useState<Record<string, boolean>>({})
const [dashboardBuyBotId, setDashboardBuyBotId] = useState<string>('')
const [dashboardBuyBotSearch, setDashboardBuyBotSearch] = useState<string>('')
const [dashboardBuyBotDropdownOpen, setDashboardBuyBotDropdownOpen] = useState(false)
const [dashboardBuyAmount, setDashboardBuyAmount] = useState<string>('')
const [dashboardBuyMode, setDashboardBuyMode] = useState<'$' | '%'>('$')
const [dashboardSellBotId, setDashboardSellBotId] = useState<string | null>(null)
const [dashboardSellAmount, setDashboardSellAmount] = useState<string>('')
```

**Memos to extract:**
```typescript
// Line 1159 - dashboardInvestmentsWithPnl
// Line 1500 - dashboardEquityCurve, dashboardBotSeries
```

**Effects to extract:**
```typescript
// Line 1190 - portfolio sync effect
```

---

### Hook 6: `src/hooks/useUIState.ts` (~150 lines)

**State to extract:**
```typescript
// Line 414
const [deviceTheme] = useState<ThemeMode>()
// Line 480
const [uiState, setUiState] = useState<UserUiState>()

// Lines 876-883
const [tab, setTab] = useState<...>('Model')
const [dashboardSubtab, setDashboardSubtab] = useState<...>('Portfolio')
const [analyzeSubtab, setAnalyzeSubtab] = useState<...>('Systems')
const [adminTab, setAdminTab] = useState<AdminSubtab>('Atlas Overview')
const [databasesTab, setDatabasesTab] = useState<DatabasesSubtab>('Systems')
const [helpTab, setHelpTab] = useState<...>('Changelog')
const [changelogContent, setChangelogContent] = useState<string>('')
const [changelogLoading, setChangelogLoading] = useState(false)

// Lines 903-904
const [callbackNodesCollapsed, setCallbackNodesCollapsed] = useState(true)
const [customIndicatorsCollapsed, setCustomIndicatorsCollapsed] = useState(true)
```

**Effects to extract:**
```typescript
// Line 599 - initial tab effect
// Line 660 - prefs load effect
// Line 693 - prefs save effect
// Line 1067 - changelog load effect
```

---

### Hook 7: `src/hooks/useTickerState.ts` (~150 lines)

**State to extract:**
```typescript
// Lines 514-517
const [availableTickers, setAvailableTickers] = useState<string[]>([])
const [tickerMetadata, setTickerMetadata] = useState<Map<...>>(new Map())
const [tickerApiError, setTickerApiError] = useState<string | null>(null)
const [etfsOnlyMode, setEtfsOnlyMode] = useState(false)
```

**Memos to extract:**
```typescript
// Line 846 - tickerOptions
```

**Callbacks to extract:**
```typescript
// Line 742 - loadAvailableTickers
```

**Effects to extract:**
```typescript
// Line 806 - ticker load effect
// Line 814 - ticker load on login
```

---

### Hook 8: `src/hooks/useTickerModal.ts` (~50 lines)

**State to extract:**
```typescript
// Lines 886-888
const [tickerModalOpen, setTickerModalOpen] = useState(false)
const [tickerModalCallback, setTickerModalCallback] = useState<...>(null)
const [tickerModalRestriction, setTickerModalRestriction] = useState<...>(undefined)
```

**Callbacks to extract:**
```typescript
// Line 2295 - openTickerModal
```

---

### Hook 9: `src/hooks/useFindReplace.ts` (~100 lines)

**State to extract:**
```typescript
// Lines 977-984
const [findTicker, setFindTicker] = useState('')
const [replaceTicker, setReplaceTicker] = useState('')
const [includePositions, setIncludePositions] = useState(true)
const [includeIndicators, setIncludeIndicators] = useState(true)
const [includeCallChains, setIncludeCallChains] = useState(false)
const [foundInstances, setFoundInstances] = useState<TickerInstance[]>([])
const [currentInstanceIndex, setCurrentInstanceIndex] = useState(-1)
const [highlightedInstance, setHighlightedInstance] = useState<TickerInstance | null>(null)
```

---

### Hook 10: `src/hooks/useIndicatorOverlays.ts` (~80 lines)

**State to extract:**
```typescript
// Lines 988-991
const [enabledOverlays, setEnabledOverlays] = useState<Set<string>>(new Set())
const [indicatorOverlayData, setIndicatorOverlayData] = useState<IndicatorOverlayData[]>([])
```

**Callbacks to extract:**
```typescript
// Line 994 - handleToggleOverlay
```

---

### Hook 11: `src/hooks/useCallChains.ts` (~100 lines)

**State extracted via setCallChains wrapper:**
```typescript
// Line 1016 - setCallChains callback
// Line 1141 - callChainsById memo
```

**Callbacks to extract:**
```typescript
// Line 3014 - handleAddCallChain
// Line 3024 - handleRenameCallChain
// Line 3028 - handleToggleCallChainCollapse
// Line 3032 - handleDeleteCallChain
// Line 3036 - pushCallChain
```

---

### Hook 12: `src/hooks/useTreeCallbacks.ts` (~400 lines)

All tree operation callbacks:
```typescript
// Lines 1611-1779 and 3275-3434
handleAdd, handleAppend, handleRemoveSlotEntry, handleDelete,
handleCopy, handlePaste, handlePasteCallRef, handleRename,
handleWeightChange, handleUpdateCappedFallback, handleUpdateVolWindow,
handleFunctionWindow, handleFunctionBottom, handleFunctionMetric,
handleFunctionRank, handleColorChange, handleUpdateCallRef,
handleToggleCollapse, handleAddCondition, handleDeleteCondition,
handleNumberedQuantifier, handleNumberedN, handleAddNumberedItem,
handleDeleteNumberedItem, handleAddEntryCondition, handleAddExitCondition,
handleDeleteEntryCondition, handleDeleteExitCondition,
handleUpdateEntryCondition, handleUpdateExitCondition, handleUpdateScaling,
handleAddPos, handleRemovePos, handleChoosePos
```

---

### Hook 13: `src/hooks/useCommunityState.ts` (~100 lines)

**State to extract:**
```typescript
// Line 499
const [allNexusBots, setAllNexusBots] = useState<SavedBot[]>([])

// Lines 949-954
const [communityTopSort, setCommunityTopSort] = useState<CommunitySort>()
const [communitySearchFilters, setCommunitySearchFilters] = useState<...>([])
const [communitySearchSort, setCommunitySearchSort] = useState<CommunitySort>()
const [atlasSort, setAtlasSort] = useState<CommunitySort>()
```

**Callbacks to extract:**
```typescript
// Line 712 - refreshAllNexusBots
```

**Effects to extract:**
```typescript
// Line 738 - nexus bots load effect
```

---

### Hook 14: `src/hooks/useSaveMenu.ts` (~50 lines)

**State to extract:**
```typescript
// Lines 898-902
const [saveMenuOpen, setSaveMenuOpen] = useState(false)
const [saveNewWatchlistName, setSaveNewWatchlistName] = useState('')
const [justSavedFeedback, setJustSavedFeedback] = useState(false)
const [_addToWatchlistBotId, setAddToWatchlistBotId] = useState<string | null>(null)
const [_addToWatchlistNewName, setAddToWatchlistNewName] = useState('')
```

---

## Execution Order

1. **Start with simple, isolated hooks** (low risk):
   - `useTickerModal` (50 lines)
   - `useFindReplace` (100 lines)
   - `useIndicatorOverlays` (80 lines)
   - `useSaveMenu` (50 lines)

2. **Extract domain-specific state** (medium risk):
   - `useAuthState` (150 lines)
   - `useUIState` (150 lines)
   - `useTickerState` (150 lines)
   - `useCommunityState` (100 lines)

3. **Extract complex stateful hooks** (higher risk):
   - `useBotSessions` (200 lines)
   - `useSavedBots` (250 lines)
   - `useDashboardState` (200 lines)
   - `useCallChains` (100 lines)

4. **Extract callback-heavy hooks** (highest complexity):
   - `useTreeCallbacks` (400 lines)
   - `useBacktestState` (300 lines) - may need further splitting

---

## Pattern to Follow

For each hook:

1. **Create the hook file** in `src/hooks/`
2. **Move state declarations** from App.tsx
3. **Move related callbacks** that only depend on that state
4. **Move related effects** that only depend on that state
5. **Move related memos** that only depend on that state
6. **Export the hook** from `src/hooks/index.ts`
7. **Import in App.tsx** and destructure
8. **Run `npm run build`** to verify
9. **Test the app** manually

---

## Example Extraction

Before (in App.tsx):
```typescript
const [tickerModalOpen, setTickerModalOpen] = useState(false)
const [tickerModalCallback, setTickerModalCallback] = useState<((ticker: string) => void) | null>(null)
const [tickerModalRestriction, setTickerModalRestriction] = useState<string[] | undefined>(undefined)

const openTickerModal = useCallback((onSelect: (ticker: string) => void, restrictTo?: string[]) => {
  setTickerModalCallback(() => onSelect)
  setTickerModalRestriction(restrictTo)
  setTickerModalOpen(true)
}, [])
```

After (in `src/hooks/useTickerModal.ts`):
```typescript
import { useState, useCallback } from 'react'

export function useTickerModal() {
  const [tickerModalOpen, setTickerModalOpen] = useState(false)
  const [tickerModalCallback, setTickerModalCallback] = useState<((ticker: string) => void) | null>(null)
  const [tickerModalRestriction, setTickerModalRestriction] = useState<string[] | undefined>(undefined)

  const openTickerModal = useCallback((onSelect: (ticker: string) => void, restrictTo?: string[]) => {
    setTickerModalCallback(() => onSelect)
    setTickerModalRestriction(restrictTo)
    setTickerModalOpen(true)
  }, [])

  const closeTickerModal = useCallback(() => {
    setTickerModalOpen(false)
    setTickerModalCallback(null)
    setTickerModalRestriction(undefined)
  }, [])

  return {
    tickerModalOpen,
    tickerModalCallback,
    tickerModalRestriction,
    openTickerModal,
    closeTickerModal,
    setTickerModalOpen,
  }
}
```

After (in App.tsx):
```typescript
import { useTickerModal } from './hooks/useTickerModal'

function App() {
  const {
    tickerModalOpen,
    tickerModalCallback,
    tickerModalRestriction,
    openTickerModal,
    closeTickerModal,
  } = useTickerModal()

  // ... rest of component
}
```

---

## Success Criteria

- [ ] App.tsx reduced to ~2,000-2,500 lines
- [ ] All hooks in `src/hooks/` directory
- [ ] `src/hooks/index.ts` barrel file exports all hooks
- [ ] Build passes (`npm run build`)
- [ ] App functions correctly (manual testing)
- [ ] No TypeScript errors

---

## Notes for Agent

1. **Don't extract callbacks that depend on multiple hooks' state** - leave those in App.tsx for now
2. **Watch for circular dependencies** - hooks shouldn't import each other
3. **Keep refs in App.tsx** for now (flowchartScrollRef, etc.)
4. **Large backtest callbacks** (runBacktestForNode, runAnalyzeBacktest) may need to stay in App.tsx or go to a feature-specific hooks file
5. **Test after each extraction** - don't batch multiple extractions without testing
