# Agent Handoff: App.tsx Deep Extraction (Phases 2N-21 to 2N-24)

## Context

We've reduced `src/App.tsx` from 3,942 lines to 1,678 lines (57% reduction) by extracting code to custom hooks. The goal is to continue reducing it to ~1,150 lines (71% total reduction).

**Current state:** App.tsx = 1,678 lines
**Target state:** App.tsx = ~1,150 lines

## FRD Reference

All details are documented in `/frd/FRD-030-Scalable-Architecture-Overhaul.md` under "Phase 2N-21" through "Phase 2N-24".

---

## Phase 2N-21: useUserDataSync Hook (~180 lines → ~15 lines)

### What to Extract (App.tsx lines ~428-642)

Extract these useEffect blocks that handle data loading/sync:

1. **Load bots from API** (lines ~428-458)
   - Loads from API, migrates from localStorage if needed
   - Sets `savedBots` via `setSavedBots`

2. **Load portfolio from API** (lines ~461-497)
   - Fetches `/api/portfolio?userId=`
   - Sets `dashboardPortfolio` via `setDashboardPortfolio`

3. **Load watchlists from API** (lines ~510-558)
   - Loads from API, migrates from localStorage
   - Uses `createWatchlistInApi`, `addBotToWatchlistInApi`
   - Sets `watchlists` via `setWatchlists`

4. **Load/save preferences** (lines ~562-608)
   - Load from API on mount
   - Debounced save on change (1 second)
   - Uses `loadPreferencesFromApi`, `savePreferencesToApi`

5. **Refresh Nexus bots** (lines ~614-642)
   - `refreshAllNexusBots` callback
   - useEffect to trigger refresh

### Hook Interface

```typescript
// src/hooks/useUserDataSync.ts
interface UseUserDataSyncOptions {
  userId: UserId | null
  setSavedBots: (bots: SavedBot[]) => void
  setWatchlists: (fn: (prev: Watchlist[]) => Watchlist[]) => void
  setDashboardPortfolio: (portfolio: DashboardPortfolio) => void
  setUiState: (state: UserUiState) => void
  setAllNexusBots: (bots: SavedBot[]) => void
  savedBots: SavedBot[]
}

export function useUserDataSync(options: UseUserDataSyncOptions): {
  refreshAllNexusBots: () => Promise<void>
  botsLoaded: boolean
  watchlistsLoaded: boolean
  prefsLoaded: boolean
}
```

### Pattern to Follow

Look at existing hooks in `src/hooks/` for patterns:
- `useBotOperations.ts` - similar structure with options interface
- `useWatchlistCallbacks.ts` - similar API integration pattern

---

## Phase 2N-22: useTickerManager Hook (~150 lines → ~10 lines)

### What to Extract (App.tsx lines ~644-800)

1. **loadAvailableTickers callback** (lines ~644-706)
   - Fetches from multiple API endpoints
   - Normalizes ticker list

2. **Ticker refresh useEffect** (lines ~708-723)
   - Initial load on mount
   - Retry interval for failures

3. **ETFs-only filtering** (lines ~748-768)
   - `tickerOptions` useMemo
   - Filters based on `etfsOnlyMode` and `tickerMetadata`

4. **Datalist DOM sync** (lines ~799-835)
   - useEffect that syncs `<datalist>` options

### Hook Interface

```typescript
// src/hooks/useTickerManager.ts
interface UseTickerManagerOptions {
  etfsOnlyMode: boolean
  tickerMetadata: Map<string, { assetType?: string; name?: string }>
}

export function useTickerManager(options: UseTickerManagerOptions): {
  availableTickers: string[]
  tickerOptions: string[]
  refreshTickers: () => Promise<void>
}
```

---

## Phase 2N-23: AppHeader Component (~150 lines → ~5 lines)

### What to Extract (App.tsx lines ~1294-1420)

Extract the header JSX into a component:

1. **Tab navigation** - The row of tab buttons (Dashboard, Nexus, Analyze, Model, etc.)
2. **QuantNexus logo** - With theme-based CSS filters
3. **Save-to-watchlist dropdown** - The dropdown menu in Model tab
4. **Logout button** - Shows username and handles logout

### Component Interface

```typescript
// src/components/AppHeader.tsx
interface AppHeaderProps {
  tab: TabName
  setTab: (tab: TabName) => void
  isAdmin: boolean
  hasEngineerAccess: boolean
  theme: ThemeMode
  colorTheme: string
  userDisplayName: string | null
  // Save menu props
  saveMenuOpen: boolean
  setSaveMenuOpen: (open: boolean) => void
  watchlists: Watchlist[]
  handleSaveToWatchlist: (id: string) => void
  saveNewWatchlistName: string
  setSaveNewWatchlistName: (name: string) => void
  justSavedFeedback: boolean
  // Actions
  handleNewBot: () => void
  handleLogout: () => void
}
```

---

## Phase 2N-24: useCallChainHandlers Hook (~45 lines → ~5 lines)

### What to Extract (App.tsx lines ~1178-1220)

Extract call chain CRUD handlers:

```typescript
const handleAddCallChain = useCallback(() => { ... }, [])
const handleRenameCallChain = useCallback((id: string, name: string) => { ... }, [])
const handleToggleCallChainCollapse = useCallback((id: string) => { ... }, [])
const handleDeleteCallChain = useCallback((id: string) => { ... }, [])
const pushCallChain = useCallback((id: string, next: FlowNode) => { ... }, [])
```

### Hook Interface

```typescript
// src/hooks/useCallChainHandlers.ts
interface UseCallChainHandlersOptions {
  callChains: CallChain[]
  setCallChains: (fn: (prev: CallChain[]) => CallChain[]) => void
}

export function useCallChainHandlers(options: UseCallChainHandlersOptions): {
  handleAddCallChain: () => void
  handleRenameCallChain: (id: string, name: string) => void
  handleToggleCallChainCollapse: (id: string) => void
  handleDeleteCallChain: (id: string) => void
  pushCallChain: (id: string, next: FlowNode) => void
}
```

---

## Implementation Checklist

For each phase:

1. [ ] Read the relevant section of `src/App.tsx`
2. [ ] Create the new hook/component file
3. [ ] Export from `src/hooks/index.ts` (or `src/components/index.ts`)
4. [ ] Update `src/App.tsx` to import and use the new hook/component
5. [ ] Remove the extracted code from `src/App.tsx`
6. [ ] Run `npm run build` to verify TypeScript passes
7. [ ] Update FRD-030 with completion status

## Build Command

```bash
cd System.app
npm run build
```

## Success Criteria

- App.tsx reduced to ~1,150 lines
- Build passes with no TypeScript errors
- All functionality preserved
- FRD-030 updated with completion status for each phase
