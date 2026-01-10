// src/hooks/index.ts
// Barrel export for custom hooks

// Phase 2N-8: State hooks (extracted)
// All hooks have been migrated to Zustand stores:
// useTickerModal - migrated to stores/useUIStore.ts (Phase 2N-13b)
// useFindReplace - migrated to stores/useBotStore.ts (Phase 2N-13c)
// useIndicatorOverlays - migrated to stores/useBacktestStore.ts (Phase 2N-13d)
// useSaveMenu - migrated to stores/useUIStore.ts (Phase 2N-13b)
// useDisplayNameState - migrated to stores/useAuthStore.ts (Phase 2N-13a)
// useCommunityState - migrated to stores/useDashboardStore.ts (Phase 2N-13e)
// useDashboardUIState - migrated to stores/useDashboardStore.ts (Phase 2N-13e)

// Phase 2N-15: Tree sync hooks
export { useTreeSync, useTreeUndo } from './useTreeSync'

// Phase 2N-16: Backtest runner hook
export { useBacktestRunner, type BacktestRunResult } from './useBacktestRunner'

// Phase 2N-17: Analyze runner hook
export { useAnalyzeRunner } from './useAnalyzeRunner'

// Phase 2N-18: Dashboard handlers hook
export { useDashboardHandlers } from './useDashboardHandlers'

// Phase 2N-19: Bot operations hook
export { useBotOperations } from './useBotOperations'

// Phase 2N-20: Watchlist callbacks hook
export { useWatchlistCallbacks, ensureDefaultWatchlist } from './useWatchlistCallbacks'

// Phase 2N-21: User data sync hook
export { useUserDataSync } from './useUserDataSync'

// Phase 2N-22: Ticker manager hook
export { useTickerManager } from './useTickerManager'

// Phase 2N-24: Call chain handlers hook
export { useCallChainHandlers } from './useCallChainHandlers'
