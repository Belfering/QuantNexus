import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

// Lazy-loaded tab components (code splitting)
const AnalyzeTab = lazy(() => import('./tabs/AnalyzeTab'))
const DashboardTab = lazy(() => import('./tabs/DashboardTab'))
const ForgeTab = lazy(() => import('./tabs/ForgeTab'))
const AdminTab = lazy(() => import('./tabs/AdminTab'))
const DatabasesTab = lazy(() => import('./tabs/DatabasesTab'))
const HelpTab = lazy(() => import('./tabs/HelpTab'))
const ModelTab = lazy(() => import('./tabs/ModelTab'))
const NexusTab = lazy(() => import('./tabs/NexusTab'))
import './App.css'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { LoginScreen } from '@/components/LoginScreen'
import { BacktestModeTag } from '@/components/ui/BacktestModeTag'
import { cn } from '@/lib/utils'
import type {
  FlowNode,
  CallChain,
  ThemeMode,
  UserId,
  BotVisibility,
  SavedBot,
  Watchlist,
  // DbPosition - moved to useUserDataSync (Phase 2N-21)
  EligibilityRequirement,
  FundZones,
  UserUiState,
  UserData,
} from './types'
import { defaultDashboardPortfolio } from './types'
import {
  API_BASE,
  TICKER_DATALIST_ID,
  CURRENT_USER_KEY,
  userDataKey,
} from './constants'
import {
  // Helpers (newId moved to useCallChainHandlers, Phase 2N-24)
  // Node factory
  createNode,
  ensureSlots,
  normalizeForImport,
  // Tree operations (most moved to ModelTab - Phase 2N-15c)
  cloneNode,
  collectEnabledConditions,
} from './features/builder'
import {
  // Input collection
  collectPositionTickers,
  // isEtfsOnlyBot - moved to useWatchlistCallbacks (Phase 2N-20)
  // Normalization
  normalizeNodeForBacktest,
} from './features/backtest'
import { useCorrelation } from './features/nexus'
// AdminSubtab, DatabasesSubtab types now used via useUIStore
import {
  // fetchNexusBotsFromApi, loadBotsFromApi, createBotInApi - moved to useUserDataSync (Phase 2N-21)
  updateBotInApi,
  // loadWatchlistsFromApi, createWatchlistInApi, addBotToWatchlistInApi - moved to useUserDataSync (Phase 2N-21)
  // removeBotFromWatchlistInApi - moved to useWatchlistCallbacks (Phase 2N-20)
} from './features/bots'
import {
  // loadPreferencesFromApi - moved to useUserDataSync (Phase 2N-21)
  savePreferencesToApi, // Still needed for HelpTab props
} from './features/auth'
// detectImportFormat, parseComposerSymphony, yieldToMain moved to useBotOperations (Phase 2N-19)
import {
  TickerSearchModal,
  TickerDatalist,
} from './shared'
// useTickerModal - migrated to stores/useUIStore.ts (Phase 2N-13b)
// useFindReplace - migrated to stores/useBotStore.ts (Phase 2N-13c)
// useIndicatorOverlays - migrated to stores/useBacktestStore.ts (Phase 2N-13d)
// useSaveMenu - migrated to stores/useUIStore.ts (Phase 2N-13b)
import { useAuthStore, useUIStore, useBotStore, useBacktestStore, useDashboardStore } from './stores'
import { useTreeSync, useBacktestRunner, useAnalyzeRunner, useDashboardHandlers, useBotOperations, useWatchlistCallbacks, ensureDefaultWatchlist, useCallChainHandlers, useUserDataSync, useTickerManager, useTickerLists } from './hooks'
// useCommunityState - migrated to stores/useDashboardStore.ts (Phase 2N-13e)
// useDashboardUIState - migrated to stores/useDashboardStore.ts (Phase 2N-13e)

// Normalization functions imported from @/features/backtest

// Development mode flag - controls visibility of experimental features
const IS_DEV_MODE = import.meta.env.VITE_DEV_MODE === 'true'

const loadDeviceThemeMode = (): ThemeMode => {
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

// Bot and watchlist API functions imported from './features/bots'
// Preferences API functions imported from './features/auth'

const loadInitialThemeMode = (): ThemeMode => {
  // Default to light mode for new users - they can change to dark in settings
  return 'light'
}

const newKeyId = () => `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const defaultUiState = (): UserUiState => ({
  theme: loadInitialThemeMode(),
  colorTheme: 'slate',
  analyzeCollapsedByBotId: {},
  communityCollapsedByBotId: {},
  analyzeBotCardTab: {},
  analyzeFilterWatchlistId: null,
  communitySelectedWatchlistId: null,
  communityWatchlistSlot1Id: null,
  communityWatchlistSlot2Id: null,
  fundZones: { fund1: null, fund2: null, fund3: null, fund4: null, fund5: null },
  portfolioMode: 'simulated',
})

// ensureDefaultWatchlist moved to hooks/useWatchlistCallbacks.ts (Phase 2N-20)

const loadUserData = (userId: UserId): UserData => {
  try {
    const raw = localStorage.getItem(userDataKey(userId))
    if (!raw) {
      // No localStorage data - return empty data (bots come from database)
      return { savedBots: [], watchlists: ensureDefaultWatchlist([]), callChains: [], ui: defaultUiState() }
    }
    const parsed = JSON.parse(raw) as Partial<UserData>
    const savedBots = Array.isArray(parsed.savedBots)
      ? (parsed.savedBots as Array<Partial<SavedBot>>).map((b) => {
          const rawPayload: FlowNode =
            (b.payload as FlowNode) ??
            ({
              id: `node-${newKeyId()}`,
              kind: 'basic',
              title: 'Basic',
              children: { next: [null] },
              weighting: 'equal',
              collapsed: false,
            } as unknown as FlowNode)
          // Use single-pass normalization for better performance
          const payload = normalizeForImport(rawPayload)
          return {
            id: String(b.id || ''),
            name: String(b.name || 'Untitled'),
            builderId: (['1', '3', '5', '7', '9'].includes(b.builderId as string) ? b.builderId : userId) as UserId,
            payload,
            visibility: (b.visibility === 'community' ? 'community' : 'private') as BotVisibility,
            createdAt: Number(b.createdAt || 0) || Date.now(),
          }
        })
      : []
    const watchlists = ensureDefaultWatchlist(
      Array.isArray(parsed.watchlists)
        ? (parsed.watchlists as Array<Partial<Watchlist>>).map((w) => ({
            id: String(w.id || `wl-${newKeyId()}`),
            name: String(w.name || 'Untitled'),
            botIds: Array.isArray(w.botIds) ? (w.botIds as string[]).map(String) : [],
          }))
        : [],
    )
    const callChains = Array.isArray((parsed as Partial<UserData>).callChains)
      ? (((parsed as Partial<UserData>).callChains as Array<Partial<CallChain>>).map((c) => {
          const rawRoot: FlowNode =
            (c.root as FlowNode) ??
            ({
              id: `node-${newKeyId()}`,
              kind: 'basic',
              title: 'Basic',
              children: { next: [null] },
              weighting: 'equal',
              collapsed: false,
            } as unknown as FlowNode)
          // Use single-pass normalization for better performance
          const root = normalizeForImport(rawRoot)
          return {
            id: String(c.id || `call-${newKeyId()}`),
            name: String(c.name || 'Call'),
            root,
            collapsed: Boolean(c.collapsed ?? false),
          }
        }) as CallChain[])
      : []
    const ui = parsed.ui ? ({ ...defaultUiState(), ...(parsed.ui as Partial<UserUiState>) } as UserUiState) : defaultUiState()
    // Note: dashboardPortfolio is now loaded from database API, not localStorage
    return { savedBots, watchlists, callChains, ui }
  } catch {
    return { savedBots: [], watchlists: ensureDefaultWatchlist([]), callChains: [], ui: defaultUiState() }
  }
}

// Dashboard investment helpers - calculateInvestmentPnl moved to useDashboardHandlers (Phase 2N-18)
const getEligibleBots = (allBots: SavedBot[], userId: UserId): SavedBot[] => {
  return allBots.filter(
    (bot) =>
      bot.builderId === userId || // own private bots
      bot.tags?.includes('Atlas') ||
      bot.tags?.includes('Nexus'),
  )
}

// normalizeTickersForUi moved to useTickerManager hook (Phase 2N-22)

// TickerDatalist, TickerSearchModal imported from ./shared

// Import parsers (detectImportFormat, parseComposerSymphony, parseQuantMageIncantationRoot, cloneAndNormalize)
// imported from ./features/data

// EquityChart, DrawdownChart, RangeNavigator, AllocationChart, BacktesterPanel
// are now imported from './features/backtest'



// Tree operations imported from @/features/builder:
// replaceSlot, insertAtSlot, appendPlaceholder, deleteNode, updateTitle
// updateWeight, updateCappedFallback, updateVolWindow, updateFunctionWindow
// updateFunctionBottom, updateFunctionMetric, updateFunctionRank
// updateCollapse, setAllCollapsed, setCollapsedBelow, updateColor

// Additional tree operations imported from @/features/builder:
// updateCallReference, addPositionRow, removePositionRow, removeSlotEntry
// addConditionLine, deleteConditionLine, updateConditionFields
// addEntryCondition, addExitCondition, deleteEntryCondition, deleteExitCondition
// updateEntryConditionFields, updateExitConditionFields, updateScalingFields
// updateNumberedQuantifier, updateNumberedN, addNumberedItem, deleteNumberedItem
// choosePosition, cloneNode, deepCloneForCompression

// Tree compression utilities imported from @/features/backtest:
// countNodesInTree, isEmptyAllocation, pruneEmptyBranches, collapseSingleChildren,
// computeSubtreeHash, mergeGateChains, CompressionStats, compressTreeForBacktest

// Ticker search utilities imported from @/features/builder

// ValidationError helpers imported from @/features/backtest (as BacktestValidationError)

// downloadEquityCsv, downloadAllocationsCsv, downloadRebalancesCsv imported from @/features/backtest

// normalizeChoice, isEmptyChoice, parseRatioTicker, expandTickerComponents imported from @/shared
// Allocation, allocEntries, sumAlloc, normalizeAlloc, mergeAlloc imported from @/features/backtest
// isoFromUtcSeconds, mdyFromUtcSeconds imported from @/features/backtest

// Engine functions imported from @/features/backtest

// computeMetrics, computeMonthlyReturns, and computeBacktestSummary imported from @/features/backtest
// fetchOhlcSeries, fetchOhlcSeriesBatch imported from @/features/data
// buildPriceDb imported from @/features/backtest

// expandToNode imported from @/features/builder

function App() {
  const [deviceTheme] = useState<ThemeMode>(() => loadDeviceThemeMode())

  // Ticker search modal hook
  // UI Store - ticker modal
  const tickerModalOpen = useUIStore(s => s.tickerModalOpen)
  const tickerModalCallback = useUIStore(s => s.tickerModalCallback)
  const tickerModalRestriction = useUIStore(s => s.tickerModalRestriction)
  const tickerModalModes = useUIStore(s => s.tickerModalModes)
  const tickerModalNodeKind = useUIStore(s => s.tickerModalNodeKind)
  const tickerModalInitialValue = useUIStore(s => s.tickerModalInitialValue)
  const tickerModalNodeId = useUIStore(s => s.tickerModalNodeId)
  const tickerModalNodeDepth = useUIStore(s => s.tickerModalNodeDepth)
  const setTickerModalOpen = useUIStore(s => s.setTickerModalOpen)

  // Ticker lists for Forge optimization (Phase 3)
  const { tickerLists, refetch: refetchTickerLists } = useTickerLists()
  const forgeSubtab = useUIStore(s => s.forgeSubtab)

  // Refetch ticker lists when switching to Builder subtab
  useEffect(() => {
    if (forgeSubtab === 'Builder') {
      refetchTickerLists()
    }
  }, [forgeSubtab, refetchTickerLists])

  // Indicator overlay hook
  // Backtest Store - indicator overlays (migrated from useIndicatorOverlays, Phase 2N-13d)
  const enabledOverlays = useBacktestStore(s => s.enabledOverlays)
  const setIndicatorOverlayData = useBacktestStore(s => s.setIndicatorOverlayData)

  // UI Store - save menu
  const saveMenuOpen = useUIStore(s => s.saveMenuOpen)
  const setSaveMenuOpen = useUIStore(s => s.setSaveMenuOpen)
  const saveNewWatchlistName = useUIStore(s => s.saveNewWatchlistName)
  const setSaveNewWatchlistName = useUIStore(s => s.setSaveNewWatchlistName)
  const justSavedFeedback = useUIStore(s => s.justSavedFeedback)
  const setJustSavedFeedback = useUIStore(s => s.setJustSavedFeedback)
  const setAddToWatchlistBotId = useUIStore(s => s.setAddToWatchlistBotId)

  // Auth store - for debounced availability check
  const displayNameInput = useAuthStore(s => s.displayNameInput)
  const setDisplayNameAvailable = useAuthStore(s => s.setDisplayNameAvailable)
  const checkDisplayNameAvailability = useAuthStore(s => s.checkDisplayNameAvailability)

  // Debounced availability check for display name
  useEffect(() => {
    if (!displayNameInput.trim()) {
      setDisplayNameAvailable(null)
      return
    }
    const timeoutId = setTimeout(() => {
      checkDisplayNameAvailability(displayNameInput)
    }, 500)
    return () => clearTimeout(timeoutId)
  }, [displayNameInput, checkDisplayNameAvailability, setDisplayNameAvailable])

  // Dashboard Store state - moved to useDashboardHandlers hook (Phase 2N-18)
  // Phase 2N-14c: UI-only state (timePeriod, botExpanded, buyBotDropdownOpen) used via store in DashboardPanel

  // Load initial user from stored user object (set by LoginScreen)
  const initialUserId: UserId | null = (() => {
    try {
      const userJson = localStorage.getItem('user')
      if (userJson) {
        const user = JSON.parse(userJson)
        return user.id as UserId
      }
      // Fallback for legacy local-only mode
      const v = localStorage.getItem(CURRENT_USER_KEY)
      if (v === '1' || v === '9' || v === 'admin') return v as UserId

      // Default to local user for no-auth mode
      return 'local-user' as UserId
    } catch {
      return 'local-user' as UserId
    }
  })()

  // Load user role from stored user object
  const initialUserRole: string | null = (() => {
    try {
      const userJson = localStorage.getItem('user')
      if (userJson) {
        const user = JSON.parse(userJson)
        return user.role || null
      }
      // Default to admin role for no-auth mode
      return 'admin'
    } catch {
      return 'admin'
    }
  })()

  // Load display name from stored user object
  const initialDisplayName: string | null = (() => {
    try {
      const userJson = localStorage.getItem('user')
      if (userJson) {
        const user = JSON.parse(userJson)
        return user.displayName || null
      }
      // Default display name for no-auth mode
      return 'Local User'
    } catch {
      return 'Local User'
    }
  })()

  const initialUserData: UserData = (() => {
    if (!initialUserId) {
      return { savedBots: [], watchlists: ensureDefaultWatchlist([]), callChains: [], ui: defaultUiState() }
    }
    return loadUserData(initialUserId)
  })()

  const [userId, setUserId] = useState<UserId | null>(() => initialUserId)
  const [userRole, setUserRole] = useState<string | null>(() => initialUserRole)
  const [userDisplayName, setUserDisplayName] = useState<string | null>(() => initialDisplayName)

  // Role hierarchy checks
  // Admin = sub_admin, main_admin, or legacy 'admin' role
  const isAdmin = true // Always admin for local development
  // Engineer access = engineer or higher (for Databases tab)
  const hasEngineerAccess = true // Always engineer access for local development

  // Sync local auth state to useAuthStore so components using the store see the same values
  const setAuthUser = useAuthStore(s => s.setUser)
  useEffect(() => {
    setAuthUser(userId, userRole, userDisplayName)
  }, [userId, userRole, userDisplayName, setAuthUser])

  // Bot Store - saved bots and watchlists (migrated from useState in Phase 2N-13c)
  const savedBots = useBotStore(s => s.savedBots)
  const setSavedBots = useBotStore(s => s.setSavedBots)
  const watchlists = useBotStore(s => s.watchlists)
  const setWatchlists = useBotStore(s => s.setWatchlists)
  // NOTE: callChains is now per-bot (stored in BotSession.callChains), not global state
  const [uiState, setUiState] = useState<UserUiState>(() => initialUserData.ui || defaultUiState())

  // Initialize saved bots and watchlists from localStorage on mount
  useEffect(() => {
    setSavedBots(initialUserData.savedBots)
    setWatchlists(initialUserData.watchlists)
  }, [setSavedBots, setWatchlists])
  // Dashboard Store - portfolio state (migrated from useState, Phase 2N-13e)
  const dashboardPortfolio = useDashboardStore(s => s.dashboardPortfolio)
  const setDashboardPortfolio = useDashboardStore(s => s.setDashboardPortfolio)
  // portfolioLoading moved to useUserDataSync hook (Phase 2N-21)

  // Backtest Store - analyze state (migrated from useState, Phase 2N-13d)
  // Most setters moved to useAnalyzeRunner hook (Phase 2N-17), but some still used for reset/clear
  const analyzeBacktests = useBacktestStore(s => s.analyzeBacktests)
  const setAnalyzeBacktests = useBacktestStore(s => s.setAnalyzeBacktests)
  const analyzeTickerContrib = useBacktestStore(s => s.analyzeTickerContrib)
  const sanityReports = useBacktestStore(s => s.sanityReports)
  const setSanityReports = useBacktestStore(s => s.setSanityReports)
  const benchmarkMetrics = useBacktestStore(s => s.benchmarkMetrics)

  // Cross-user Nexus bots for Nexus tab (populated via API in useEffect)
  // Migrated from useState to useBotStore in Phase 2N-13c
  const allNexusBots = useBotStore(s => s.allNexusBots)
  const setAllNexusBots = useBotStore(s => s.setAllNexusBots)

  // Correlation hook for Analyze tab (manages correlation state internally)
  const correlation = useCorrelation({
    savedBots,
    allNexusBots,
    analyzeBacktests,
  })

  const theme = userId ? uiState.theme : deviceTheme

  // Backtest Store - ETF/backtest settings (migrated from useState, Phase 2N-13d)
  // Note: setters moved to ModelTab via useBacktestStore (Phase 2N-14)
  // backtestBenchmark now used only in useBacktestRunner hook (Phase 2N-16)
  const etfsOnlyMode = useBacktestStore(s => s.etfsOnlyMode)
  const backtestMode = useBacktestStore(s => s.backtestMode)
  const backtestCostBps = useBacktestStore(s => s.backtestCostBps)
  // Per-bot backtest state moved to BotSession.backtest - see derived values after activeBot

  // Phase 2N-22: Ticker manager hook (loading, metadata, filtering)
  const {
    setAvailableTickers,
    tickerMetadata,
    tickerApiError,
    tickerOptions,
  } = useTickerManager({ etfsOnlyMode })

  // Phase 2N-21: User data sync hook (bots, portfolio, watchlists, preferences, Nexus bots)
  const { refreshAllNexusBots } = useUserDataSync({
    userId,
    setSavedBots,
    setWatchlists,  // Pass directly - Zustand setters are stable
    setDashboardPortfolio,
    setUiState,
    setAllNexusBots,
    savedBots,
    uiState,
    loadUserData,
  })

  // Default tab is set in useUIStore (Dashboard)

  // Watchlists, preferences, and Nexus bots loading moved to useUserDataSync hook (Phase 2N-21)
  // Ticker loading, metadata, and filtering moved to useTickerManager hook (Phase 2N-22)
  // NOTE: Call chains are now stored per-bot (in BotSession.callChains) instead of globally
  // They are saved with the bot payload when saving to watchlist

  // Bot Store - bot sessions (migrated from useState in Phase 2N-13c)
  // createBotSession is now in the store
  const createBotSession = useBotStore(s => s.createBotSession)
  const bots = useBotStore(s => s.bots)
  const setBots = useBotStore(s => s.setBots)
  const activeBotId = useBotStore(s => s.activeBotId)
  const setActiveBotId = useBotStore(s => s.setActiveBotId)
  const activeForgeBotId = useBotStore(s => s.activeForgeBotId)
  const setActiveForgeBotId = useBotStore(s => s.setActiveForgeBotId)
  const activeModelBotId = useBotStore(s => s.activeModelBotId)
  const setActiveModelBotId = useBotStore(s => s.setActiveModelBotId)
  const setActiveShapingBotId = useBotStore(s => s.setActiveShapingBotId)
  const setActiveCombineBotId = useBotStore(s => s.setActiveCombineBotId)
  const setActiveWalkForwardBotId = useBotStore(s => s.setActiveWalkForwardBotId)
  // setClipboard, setCopiedNodeId moved to useBotOperations (Phase 2N-19)
  const isImporting = useBotStore(s => s.isImporting)
  const setIsImporting = useBotStore(s => s.setIsImporting)

  // Safety: clear isImporting on mount in case it got stuck
  useEffect(() => {
    setIsImporting(false)
  }, [setIsImporting])
  // UI Store - tabs and navigation
  const tab = useUIStore(s => s.tab)
  const setTab = useUIStore(s => s.setTab)
  const dashboardSubtab = useUIStore(s => s.dashboardSubtab)
  // Note: setDashboardSubtab now accessed directly by DashboardPanel via store (Phase 2N-14c)
  // Note: adminTab, setAdminTab now accessed directly by AdminPanel via store (Phase 2N-14f)
  const databasesTab = useUIStore(s => s.databasesTab)
  const setDatabasesTab = useUIStore(s => s.setDatabasesTab)
  const helpTab = useUIStore(s => s.helpTab)
  const setHelpTab = useUIStore(s => s.setHelpTab)
  const changelogContent = useUIStore(s => s.changelogContent)
  const setChangelogContent = useUIStore(s => s.setChangelogContent)
  const changelogLoading = useUIStore(s => s.changelogLoading)
  const setChangelogLoading = useUIStore(s => s.setChangelogLoading)

  // Eligibility requirements (fetched for Admin tab and Partner Program page)
  const [appEligibilityRequirements, setAppEligibilityRequirements] = useState<EligibilityRequirement[]>([])

  // UI Store - collapse states (setCallbackNodesCollapsed moved to useCallChainHandlers, Phase 2N-24)

  // Flowchart scroll state for floating scrollbar
  const flowchartScrollRef = useRef<HTMLDivElement>(null)
  const floatingScrollRef = useRef<HTMLDivElement>(null)
  // Scroll dimensions stored in useUIStore, set by ModelTab, read by scrollbar
  const setFlowchartScrollWidth = useUIStore(s => s.setFlowchartScrollWidth)
  const setFlowchartClientWidth = useUIStore(s => s.setFlowchartClientWidth)

  // Update scroll dimensions when tab changes or window resizes
  useEffect(() => {
    if (tab !== 'Model' && tab !== 'Forge') return

    const updateScrollDimensions = () => {
      if (flowchartScrollRef.current) {
        const sw = flowchartScrollRef.current.scrollWidth
        const cw = flowchartScrollRef.current.clientWidth
        // Only update if values are valid (> 0) and changed
        if (sw > 0) setFlowchartScrollWidth(sw)
        if (cw > 0) setFlowchartClientWidth(cw)
      }
    }

    // Initial update with multiple retries to ensure DOM is ready
    const timers = [100, 500, 1000].map(delay =>
      setTimeout(updateScrollDimensions, delay)
    )

    // Also update on window resize
    window.addEventListener('resize', updateScrollDimensions)

    return () => {
      timers.forEach(clearTimeout)
      window.removeEventListener('resize', updateScrollDimensions)
    }
  }, [tab, setFlowchartScrollWidth, setFlowchartClientWidth])

  // Nexus buy state moved to useDashboardHandlers hook (Phase 2N-18)
  // Phase 2N-14d: UI state used via store in NexusPanel/AnalyzePanel

  const activeBot = useMemo(() => {
    return bots.find((b) => b.id === activeBotId) ?? bots[0]
  }, [bots, activeBotId])

  const activeForgeBot = useMemo(() => {
    return bots.find((b) => b.id === activeForgeBotId && b.tabContext === 'Forge')
  }, [bots, activeForgeBotId])

  const activeModelBot = useMemo(() => {
    return bots.find((b) => b.id === activeModelBotId && b.tabContext === 'Model')
  }, [bots, activeModelBotId])

  // Tree state synced with useTreeStore (Phase 2N-15b)
  // Note: We derive current directly from activeBot instead of using global useTreeSync()
  // because ForgeTab and ModelTab handle their own independent tree syncing
  const current = useMemo(() => {
    if (!activeBot) {
      // Fallback: create a basic start node
      return createNode('basic', 'Start')
    }
    return activeBot.history[activeBot.historyIndex] ?? createNode('basic', 'Start')
  }, [activeBot])

  // Per-bot call chains (derived from activeBot)
  const callChains = activeBot.callChains

  // Update active bot's call chains
  const setCallChains = useCallback((updater: CallChain[] | ((prev: CallChain[]) => CallChain[])) => {
    setBots((prev) =>
      prev.map((b) => {
        if (b.id !== activeBotId) return b
        const newCallChains = typeof updater === 'function' ? updater(b.callChains) : updater
        return { ...b, callChains: newCallChains }
      }),
    )
  }, [activeBotId])

  // Per-bot backtest state (derived from activeBot)
  const backtestStatus = activeBot.backtest.status
  const backtestErrors = activeBot.backtest.errors
  const backtestResult = activeBot.backtest.result
  const backtestFocusNodeId = activeBot.backtest.focusNodeId

  // Forge-specific state (independent from Model)
  const forgeCallChains = activeForgeBot?.callChains ?? []
  const setForgeCallChains = useCallback((updater: CallChain[] | ((prev: CallChain[]) => CallChain[])) => {
    if (!activeForgeBot) return
    setBots((prev) =>
      prev.map((b) => {
        if (b.id !== activeForgeBotId) return b
        const newCallChains = typeof updater === 'function' ? updater(b.callChains) : updater
        return { ...b, callChains: newCallChains }
      }),
    )
  }, [activeForgeBotId, activeForgeBot])

  const forgeBacktestStatus = activeForgeBot?.backtest.status ?? 'idle'
  const forgeBacktestErrors = activeForgeBot?.backtest.errors ?? []
  const forgeBacktestResult = activeForgeBot?.backtest.result ?? null
  const forgeBacktestFocusNodeId = activeForgeBot?.backtest.focusNodeId ?? null

  // Model-specific state (independent from Forge)
  const modelCallChains = activeModelBot?.callChains ?? []
  const setModelCallChains = useCallback((updater: CallChain[] | ((prev: CallChain[]) => CallChain[])) => {
    if (!activeModelBot) return
    setBots((prev) =>
      prev.map((b) => {
        if (b.id !== activeModelBotId) return b
        const newCallChains = typeof updater === 'function' ? updater(b.callChains) : updater
        return { ...b, callChains: newCallChains }
      }),
    )
  }, [activeModelBotId, activeModelBot])

  const modelBacktestStatus = activeModelBot?.backtest.status ?? 'idle'
  const modelBacktestErrors = activeModelBot?.backtest.errors ?? []
  const modelBacktestResult = activeModelBot?.backtest.result ?? null
  const modelBacktestFocusNodeId = activeModelBot?.backtest.focusNodeId ?? null

  // Fetch indicator overlay data when enabled overlays change
  useEffect(() => {
    // Only fetch if we have enabled overlays and a backtest result
    if (enabledOverlays.size === 0 || !backtestResult) {
      setIndicatorOverlayData([])
      return
    }

    // Collect enabled conditions from the tree
    const conditions = collectEnabledConditions(current, enabledOverlays)
    if (conditions.length === 0) {
      setIndicatorOverlayData([])
      return
    }

    // Fetch indicator series from server
    // Send the full payload so server can resolve branch references
    const fetchOverlays = async () => {
      try {
        const res = await fetch(API_BASE + "/indicator-series", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conditions, mode: backtestMode, payload: current })
        })
        if (!res.ok) throw new Error("Failed to fetch indicator series")
        const data = await res.json()
        setIndicatorOverlayData(data.indicatorOverlays || [])
      } catch (err) {
        console.error("Failed to fetch indicator overlays:", err)
        setIndicatorOverlayData([])
      }
    }
    fetchOverlays()
  }, [enabledOverlays, backtestResult, current, backtestMode])

  // Fetch changelog when viewing Help tab
  useEffect(() => {
    console.log('[changelog] useEffect triggered:', { tab, helpTab, hasContent: !!changelogContent })
    if (tab !== 'Help/Support' || helpTab !== 'Changelog') return
    if (changelogContent) return // Already loaded

    console.log('[changelog] Fetching changelog...')
    setChangelogLoading(true)
    fetch('/api/changelog')
      .then(res => {
        console.log('[changelog] Response status:', res.status)
        return res.text()
      })
      .then(content => {
        console.log('[changelog] Loaded content length:', content.length)
        setChangelogContent(content)
        setChangelogLoading(false)
      })
      .catch(err => {
        console.error('Failed to fetch changelog:', err)
        setChangelogLoading(false)
      })
  }, [tab, helpTab, changelogContent])

  // Fetch eligibility requirements when viewing Partner Program page
  useEffect(() => {
    if (tab !== 'Dashboard' || dashboardSubtab !== 'Partner Program') return
    // Don't fetch if already loaded
    if (appEligibilityRequirements.length > 0) return
    let cancelled = false

    const fetchEligibility = async () => {
      try {
        const res = await fetch('/api/admin/eligibility')
        if (!res.ok) return
        const data = (await res.json()) as { eligibilityRequirements: EligibilityRequirement[] }
        if (cancelled) return
        setAppEligibilityRequirements(data.eligibilityRequirements || [])
      } catch (e) {
        console.error('Failed to fetch eligibility for Partner Program:', e)
      }
    }

    fetchEligibility()
    return () => { cancelled = true }
  }, [tab, dashboardSubtab, appEligibilityRequirements.length])

  const backtestErrorNodeIds = useMemo(() => new Set(backtestErrors.map((e) => e.nodeId)), [backtestErrors])

  const callChainsById = useMemo(() => new Map(callChains.map((c) => [c.id, c])), [callChains])

  // Phase 2N-16: Backtest runner hook
  const { runBacktestForNode } = useBacktestRunner({ callChainsById, customIndicators: activeBot?.customIndicators })

  // Phase 2N-17: Analyze runner hook
  const {
    runAnalyzeBacktest,
    runSanityReport,
    fetchBenchmarkMetrics,
    runModelRobustness,
    runAnalyzeTickerContribution,
  } = useAnalyzeRunner({
    runBacktestForNode,
    savedBots,
    setSavedBots,
    userId,
    isAdmin,
    uiState,
    setUiState,
    activeBot,
    current,
  })

  // Phase 2N-18: Dashboard handlers hook
  const {
    dashboardCash,
    dashboardInvestmentsWithPnl,
    dashboardTotalValue,
    dashboardTotalPnl,
    dashboardTotalPnlPct,
    dashboardEquityCurve,
    dashboardBotSeries,
    handleDashboardBuy,
    handleDashboardSell,
    handleDashboardBuyMore,
    handleNexusBuy,
  } = useDashboardHandlers({ userId })

  // Phase 2N-19: Bot operations hook
  const {
    push,
    handleCloseBot,
    handleJumpToBacktestError,
    handleRunBacktest,
    handleNewBot,
    handleDuplicateBot,
    handleExport,
    handleExportBot,
    handleOpenBot,
    handleCopySaved,
    handleCopyToNew,
    handleDeleteSaved,
    handleOpenSaved,
    handleImport,
  } = useBotOperations({
    userId,
    isAdmin,
    bots,
    setBots,
    activeBotId,
    setActiveBotId,
    activeForgeBotId,
    setActiveForgeBotId,
    activeModelBotId,
    setActiveModelBotId,
    current,
    setSavedBots,
    setWatchlists,
    createBotSession,
    runBacktestForNode,
    tab,
    setTab,
    setIsImporting,
  })

  // Dashboard investment logic
  // Combine savedBots + allNexusBots (de-duped) for eligible bots
  const eligibleBots = useMemo(() => {
    if (!userId) return []
    // Combine savedBots and allNexusBots, preferring savedBots for duplicates
    const savedBotIds = new Set(savedBots.map(b => b.id))
    const combinedBots = [
      ...savedBots,
      ...allNexusBots.filter(b => !savedBotIds.has(b.id))
    ]
    return getEligibleBots(combinedBots, userId)
  }, [savedBots, allNexusBots, userId])

  // Sync portfolio summary to server for admin aggregation
  useEffect(() => {
    if (!userId || isAdmin) return

    const syncPortfolioSummary = async () => {
      try {
        // Calculate categorized investments based on bot tags
        let investedAtlas = 0
        let investedNexus = 0
        let investedPrivate = 0

        dashboardInvestmentsWithPnl.forEach(inv => {
          // Look in both savedBots and allNexusBots to find the bot
          const bot = savedBots.find(b => b.id === inv.botId)
            ?? allNexusBots.find(b => b.id === inv.botId)
          const tags = bot?.tags || []
          if (tags.includes('Atlas')) {
            investedAtlas += inv.currentValue
          } else if (tags.includes('Nexus')) {
            investedNexus += inv.currentValue
          } else {
            investedPrivate += inv.currentValue
          }
        })

        await fetch(`/api/user/${userId}/portfolio-summary`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            totalValue: dashboardTotalValue,
            totalInvested: dashboardTotalValue - dashboardCash,
            investmentCount: dashboardInvestmentsWithPnl.length,
            investedAtlas,
            investedNexus,
            investedPrivate
          })
        })
      } catch (e) {
        // Silent fail - admin aggregation is non-critical
        console.warn('Failed to sync portfolio summary:', e)
      }
    }

    // Sync on mount and when portfolio changes
    syncPortfolioSummary()

    // Also sync periodically (every 5 minutes)
    const interval = setInterval(syncPortfolioSummary, 300000)
    return () => clearInterval(interval)
  }, [userId, dashboardTotalValue, dashboardCash, dashboardInvestmentsWithPnl, savedBots, allNexusBots])

  // Bot operations moved to useBotOperations hook (Phase 2N-19)

  // Helper for activeSavedBotId (used by watchlist hook)
  const activeSavedBotId = activeBot?.savedBotId

  // Phase 2N-20: Watchlist callbacks hook
  const {
    // addBotToWatchlist - used internally by handleSaveToWatchlist
    removeBotFromWatchlist,
    handleSaveToWatchlist,
  } = useWatchlistCallbacks({
    userId,
    isAdmin,
    current,
    activeBotId,
    activeSavedBotId,
    activeBot,
    watchlists,
    savedBots,
    callChainsById,
    tickerMetadata,
    backtestMode,
    backtestCostBps,
    setWatchlists,
    setSavedBots,
    setBots,
    setAnalyzeBacktests,
    setSaveMenuOpen,
    setSaveNewWatchlistName,
    setJustSavedFeedback,
  })

  // Watchlist callbacks moved to useWatchlistCallbacks hook (Phase 2N-20)
  // resolveWatchlistId, addBotToWatchlist, removeBotFromWatchlist,
  // computeEtfsOnlyTag, handleSaveToWatchlist


  useEffect(() => {
    savedBots.forEach((bot) => {
      if (uiState.analyzeCollapsedByBotId?.[bot.id] === false) {
        // Auto-run backtest when card is expanded
        const state = analyzeBacktests[bot.id]
        if (!state || state.status === 'idle') {
          runAnalyzeBacktest(bot)
        }
        // Also auto-fetch sanity report (MC/KF) when card is expanded
        const sanityState = sanityReports[bot.id]
        if (!sanityState || sanityState.status === 'idle') {
          runSanityReport(bot)
        }
      }
    })
    // Also fetch benchmark metrics if not already loaded (needed for comparison table)
    if (benchmarkMetrics.status === 'idle') {
      fetchBenchmarkMetrics()
    }
  }, [savedBots, uiState.analyzeCollapsedByBotId, analyzeBacktests, runAnalyzeBacktest, sanityReports, runSanityReport, benchmarkMetrics.status, fetchBenchmarkMetrics])

  // Auto-run backtests for invested bots so their equity curves show in portfolio chart
  useEffect(() => {
    dashboardPortfolio.investments.forEach((inv) => {
      const state = analyzeBacktests[inv.botId]
      if (!state || state.status === 'idle' || state.status === 'error') {
        // Find bot in savedBots or allNexusBots
        const bot = savedBots.find((b) => b.id === inv.botId)
          ?? allNexusBots.find((b) => b.id === inv.botId)
        if (bot) {
          runAnalyzeBacktest(bot)
        }
      }
    })
  }, [dashboardPortfolio.investments, savedBots, allNexusBots, analyzeBacktests, runAnalyzeBacktest])

  useEffect(() => {
    for (const bot of savedBots) {
      if (uiState.analyzeCollapsedByBotId?.[bot.id] !== false) continue
      const state = analyzeBacktests[bot.id]
      if (!state || state.status !== 'done') continue
      const botResult = state.result
      if (!botResult) continue
      try {
        const prepared = normalizeNodeForBacktest(ensureSlots(cloneNode(bot.payload)))
        const tickers = collectPositionTickers(prepared, callChainsById).filter((t) => t && t !== 'Empty' && t !== 'CASH')
        for (const t of tickers) {
          const key = `${bot.id}:${t}:${backtestMode}:${botResult.metrics.startDate}:${botResult.metrics.endDate}`
          const existing = analyzeTickerContrib[key]
          if (existing && existing.status !== 'idle') continue
          runAnalyzeTickerContribution(key, t, botResult)
        }
      } catch {
        // ignore
      }
    }
  }, [savedBots, uiState.analyzeCollapsedByBotId, analyzeBacktests, analyzeTickerContrib, runAnalyzeTickerContribution, callChainsById, backtestMode])

  // Phase 2N-24: Call chain handlers hook
  const {
    handleAddCallChain,
    handleRenameCallChain,
    handleToggleCallChainCollapse,
    handleDeleteCallChain,
    pushCallChain,
  } = useCallChainHandlers({ callChains, setCallChains })

  // Saved bot operations + import moved to useBotOperations hook (Phase 2N-19)

  const handleLogin = (nextUser: UserId) => {
    try {
      localStorage.setItem(CURRENT_USER_KEY, nextUser)
    } catch {
      // ignore
    }
    // Load role and display name from stored user object
    try {
      const userJson = localStorage.getItem('user')
      if (userJson) {
        const user = JSON.parse(userJson)
        setUserRole(user.role || null)
        setUserDisplayName(user.displayName || null)
      }
    } catch {
      // ignore
    }
    const data = loadUserData(nextUser)
    setUserId(nextUser)
    // Bots, watchlists, and preferences will be loaded from database API via useEffects when userId changes
    // Set defaults here, the useEffects will replace with API data
    // NOTE: Call chains are now per-bot (stored in BotSession.callChains), not global
    setSavedBots(data.savedBots) // Initial from localStorage, then replaced by API
    setWatchlists(ensureDefaultWatchlist([])) // Empty default, will be loaded from API
    setUiState(defaultUiState()) // Default, will be loaded from API
    // Portfolio will be loaded from database API via useEffect when userId changes
    setDashboardPortfolio(defaultDashboardPortfolio())
    setAnalyzeBacktests({})
    // Reset bot store to ensure clean state
    console.log('[App] handleLogin: Creating fresh bot sessions (Forge and Model)')
    const forgeBot = createBotSession('Forge System', 'Forge')
    const modelBot = createBotSession('Algo Name Here', 'Model')
    setBots([forgeBot, modelBot])
    setActiveForgeBotId(forgeBot.id)
    setActiveModelBotId(modelBot.id)
    setTab('Dashboard')
  }

  const handleLogout = () => {
    try {
      localStorage.removeItem(CURRENT_USER_KEY)
      localStorage.removeItem('user')
      localStorage.removeItem('accessToken')
      localStorage.removeItem('refreshToken')
      sessionStorage.removeItem('accessToken')
      sessionStorage.removeItem('refreshToken')
    } catch {
      // ignore
    }
    setUserId(null)
    setUserRole(null)
    setUserDisplayName(null)
    setSavedBots([])
    setWatchlists([])
    // NOTE: Call chains are now per-bot, reset via setBots
    const forgeBot = createBotSession('Forge System', 'Forge')
    const modelBot = createBotSession('Algo Name Here', 'Model')
    setBots([forgeBot, modelBot])
    setActiveForgeBotId(forgeBot.id)
    setActiveModelBotId(modelBot.id)
    setUiState(defaultUiState())
    setDashboardPortfolio(defaultDashboardPortfolio())
    setAnalyzeBacktests({})
    setTab('Dashboard')
    setSaveMenuOpen(false)
    setAddToWatchlistBotId(null)
  }

  const colorTheme = uiState.colorTheme ?? 'slate'

  // Helper to find fund slot from uiState.fundZones (used in Dashboard and Nexus)
  const getFundSlotForBot = (botId: string): number | null => {
    for (let i = 1; i <= 5; i++) {
      const key = `fund${i}` as keyof FundZones
      if (uiState.fundZones?.[key] === botId) return i
    }
    return null
  }

  // Login check - show login screen if not authenticated
  if (!userId) {
    return (
      <div className={cn('app min-h-screen bg-bg text-text font-sans', `theme-${colorTheme}`, theme === 'dark' && 'theme-dark dark')}>
        <LoginScreen onLogin={handleLogin} />
      </div>
    )
  }

  return (
    <div className={cn('app h-screen flex flex-col bg-bg text-text font-sans', `theme-${colorTheme}`, theme === 'dark' && 'theme-dark dark')}>
      {/* Import loading overlay */}
      {isImporting && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-surface rounded-lg p-6 shadow-xl flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-4 border-accent-border border-t-transparent rounded-full animate-spin" />
            <div className="text-lg font-medium">Importing large file...</div>
            <div className="text-sm text-muted">This may take a few seconds</div>
          </div>
        </div>
      )}
      <header className="border-b border-border bg-surface shrink-0 z-10">
        {/* Grid layout: Logo spans all rows on right when Model active */}
        <div
          className="grid"
          style={{
            gridTemplateColumns: (tab === 'Model' || tab === 'Forge') ? '1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 3fr 1fr' : '1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 3fr 1fr',
            gridTemplateRows: (tab === 'Model' || tab === 'Forge') ? 'auto auto' : 'auto',
          }}
        >
          {/* Row 1: Main tabs */}
          {(['Dashboard', 'Nexus', 'Model', 'Forge', 'Analyze', 'Help/Support', ...(hasEngineerAccess ? ['Databases'] : []), ...(isAdmin ? ['Admin'] : [])] as ('Dashboard' | 'Nexus' | 'Model' | 'Forge' | 'Analyze' | 'Help/Support' | 'Databases' | 'Admin')[]).map((t) => (
            <button
              key={t}
              className={`px-4 py-3 text-sm font-bold border-r-2 border-border transition-colors h-20 ${
                tab === t
                  ? 'text-white'
                  : 'bg-surface hover:bg-muted/50 text-foreground'
              }`}
              style={{ backgroundColor: tab === t ? 'var(--color-accent)' : undefined }}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
          {/* QN Logo - spans 2 rows when Model active */}
          <div
            className="border-2 border-border"
            style={{
              gridColumn: '9 / 10',
              gridRow: (tab === 'Model' || tab === 'Forge') ? '1 / 3' : '1 / 2',
            }}
          >
            <div
              style={{
                width: '100%',
                height: '100%',
                backgroundImage: 'url(/quantnexus-header.png)',
                backgroundSize: 'cover',
                backgroundPosition: 'center center',
                backgroundRepeat: 'no-repeat',
                backgroundColor: theme === 'dark' ? 'rgb(30, 41, 59)' : 'rgb(241, 245, 249)',
                filter: theme === 'dark'
                  ? `invert(1) hue-rotate(180deg) brightness(1.2) sepia(0.3) hue-rotate(${
                      colorTheme === 'ocean' || colorTheme === 'cyan' ? '190deg' : colorTheme === 'emerald' || colorTheme === 'lime' ? '90deg' : colorTheme === 'violet' || colorTheme === 'indigo' || colorTheme === 'fuchsia' ? '260deg' : colorTheme === 'amber' || colorTheme === 'rose' ? '350deg' : '0deg'
                    }) saturate(1.5)`
                  : `sepia(0.2) hue-rotate(${
                      colorTheme === 'ocean' || colorTheme === 'cyan' ? '190deg' : colorTheme === 'emerald' || colorTheme === 'lime' ? '90deg' : colorTheme === 'violet' || colorTheme === 'indigo' || colorTheme === 'fuchsia' ? '260deg' : colorTheme === 'amber' || colorTheme === 'rose' ? '20deg' : '0deg'
                    }) saturate(1.2)`
              }}
            />
          </div>
          {/* Logout button - shows username, spans 2 rows on Model tab */}
          <button
            className="px-4 py-3 text-sm font-bold bg-surface hover:bg-muted/50 text-foreground flex flex-col items-center justify-center border-l border-border"
            style={{ gridColumn: '10 / 11', gridRow: (tab === 'Model' || tab === 'Forge') ? '1 / 3' : '1 / 2' }}
            onClick={handleLogout}
          >
            <span className="text-xs text-muted">{userDisplayName || 'User'}</span>
            <span>Logout</span>
          </button>
          {/* Row 2: Model sub-buttons (only when Model tab active) - flex container spans columns 1-9 */}
          {tab === 'Model' && (
            <div className="flex items-stretch border-t border-border" style={{ gridColumn: '1 / 9', gridRow: '2 / 3' }}>
              <Button onClick={handleNewBot} className="flex-1 rounded-none border-r border-border h-10">New System</Button>
              <div className="relative flex-1">
                <Button
                  onClick={() => setSaveMenuOpen(!saveMenuOpen)}
                  title="Save this system to a watchlist"
                  variant={justSavedFeedback ? 'accent' : 'default'}
                  className={`w-full h-full rounded-none border-r border-border ${justSavedFeedback ? 'transition-colors duration-300' : ''}`}
                >
                  {justSavedFeedback ? '✓ Saved!' : 'Save to Watchlist'}
                </Button>
                {saveMenuOpen ? (
                  <Card
                    className="absolute top-full left-0 z-[200] min-w-60 p-1.5 mt-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex flex-col gap-1">
                      {watchlists.map((w) => (
                        <Button key={w.id} variant="ghost" className="justify-start" onClick={() => handleSaveToWatchlist(w.id)}>
                          {w.name}
                        </Button>
                      ))}
                    </div>
                    <div className="p-2.5 border-t border-border-soft mt-1">
                      <div className="text-xs font-bold mb-1.5">New watchlist</div>
                      <Input
                        value={saveNewWatchlistName}
                        placeholder="Type a name…"
                        onChange={(e) => setSaveNewWatchlistName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveToWatchlist(saveNewWatchlistName)
                        }}
                        className="w-full"
                      />
                      <div className="flex gap-2 mt-2">
                        <Button onClick={() => handleSaveToWatchlist(saveNewWatchlistName)} className="flex-1">
                          Save
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setSaveMenuOpen(false)
                            setSaveNewWatchlistName('')
                          }}
                          className="flex-1"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  </Card>
                ) : null}
              </div>
              <Button onClick={() => setTab('Analyze')} className="flex-1 rounded-none border-r border-border h-10">Open</Button>
              <Button onClick={handleImport} disabled={isImporting} className="flex-1 rounded-none border-r border-border h-10">
                {isImporting ? 'Importing...' : 'Import'}
              </Button>
              <Button onClick={handleExport} className="flex-1 rounded-none h-10">Export</Button>
            </div>
          )}
          {/* Row 2: Forge subtabs (only when Forge tab active) */}
          {tab === 'Forge' && (
            <div className="flex items-stretch border-t border-border" style={{ gridColumn: '1 / 9', gridRow: '2 / 3' }}>
              <Button
                onClick={() => useUIStore.getState().setForgeSubtab('Data')}
                variant={forgeSubtab === 'Data' ? 'accent' : 'secondary'}
                className="flex-1 rounded-none border-r border-border h-10"
              >
                Data
              </Button>
              <Button
                onClick={() => useUIStore.getState().setForgeSubtab('Shaping')}
                variant={forgeSubtab === 'Shaping' ? 'accent' : 'secondary'}
                className="flex-1 rounded-none border-r border-border h-10"
              >
                Shaping
              </Button>
              {IS_DEV_MODE && (
                <Button
                  onClick={() => useUIStore.getState().setForgeSubtab('Walk Forward')}
                  variant={forgeSubtab === 'Walk Forward' ? 'accent' : 'secondary'}
                  className="flex-1 rounded-none border-r border-border h-10"
                >
                  Walk Forward
                </Button>
              )}
              <Button
                onClick={() => useUIStore.getState().setForgeSubtab('Shards')}
                variant={forgeSubtab === 'Shards' ? 'accent' : 'secondary'}
                className="flex-1 rounded-none border-r border-border h-10"
              >
                Shards
              </Button>
              <Button
                onClick={() => useUIStore.getState().setForgeSubtab('Combine')}
                variant={forgeSubtab === 'Combine' ? 'accent' : 'secondary'}
                className="flex-1 rounded-none h-10"
              >
                Combine
              </Button>
            </div>
          )}
        </div>
        {/* Row 3: Algo tabs (only when Model or Forge Combine subtabs active) */}
        {((tab === 'Model') || (tab === 'Forge' && forgeSubtab === 'Combine')) && (
          <div className="flex gap-2 py-2 px-2 border-t border-border">
              {bots.filter(b => {
                if (tab === 'Model') {
                  return b.tabContext === 'Model'
                } else if (tab === 'Forge') {
                  // Filter by both tabContext and subtabContext for Forge tabs
                  return b.tabContext === 'Forge' && b.subtabContext === forgeSubtab
                }
                return false
              }).map((b) => {
                const root = b.history[b.historyIndex] ?? b.history[0]
                const label = root?.title || 'Untitled'
                const isActive = (tab === 'Forge' && b.id === activeForgeBotId) || (tab === 'Model' && b.id === activeModelBotId)
                // Look up backtestMode from saved bot if this session is linked to one
                const savedBot = b.savedBotId ? savedBots.find(sb => sb.id === b.savedBotId) : null
                const backtestMode = savedBot?.backtestMode
                return (
                  <div
                    key={b.id}
                    className={cn(
                      'flex flex-col border rounded-lg p-2 min-w-[120px] max-w-[200px]',
                      isActive
                        ? 'bg-accent-bg border-accent-border text-accent-text'
                        : 'bg-surface border-border'
                    )}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-center font-medium truncate"
                      onClick={() => {
                        if (tab === 'Forge') {
                          setActiveForgeBotId(b.id)
                          // Also update the subtab-specific active bot ID
                          if (forgeSubtab === 'Shaping') {
                            setActiveShapingBotId(b.id)
                          } else if (forgeSubtab === 'Combine') {
                            setActiveCombineBotId(b.id)
                          } else if (forgeSubtab === 'Walk Forward') {
                            setActiveWalkForwardBotId(b.id)
                          }
                        } else {
                          setActiveModelBotId(b.id)
                        }
                        // Note: DO NOT set activeBotId here - Forge and Model tabs are independent
                      }}
                    >
                      {label}
                    </Button>
                    <div className="flex gap-1 mt-1 justify-center items-center flex-wrap">
                      {backtestMode && <BacktestModeTag mode={backtestMode} />}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs px-2 h-6"
                        title="Open new copy"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDuplicateBot(b.id)
                        }}
                      >
                        Copy
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-danger px-2 h-6 text-xs"
                        title="Close"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleCloseBot(b.id)
                        }}
                      >
                        ✕
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        {tab === 'Help/Support' && (
          <div className="flex gap-2 py-2 px-2 border-t border-border">
            {(['Changelog', 'Settings'] as const).map((t) => (
              <Button
                key={t}
                variant={helpTab === t ? 'accent' : 'secondary'}
                size="sm"
                onClick={() => setHelpTab(t)}
              >
                {t}
              </Button>
            ))}
          </div>
        )}
      </header>
      {tickerApiError && (
        <Alert variant="destructive" className="rounded-none border-x-0">
          <AlertDescription>{tickerApiError}</AlertDescription>
        </Alert>
      )}
      <TickerDatalist id={TICKER_DATALIST_ID} options={tickerOptions} />
      <TickerSearchModal
        open={tickerModalOpen}
        onClose={() => setTickerModalOpen(false)}
        onSelect={(ticker) => {
          tickerModalCallback?.(ticker)
          setTickerModalOpen(false)
        }}
        tickerOptions={tickerOptions}
        tickerMetadata={tickerMetadata}
        restrictToTickers={tickerModalRestriction}
        allowedModes={tickerModalModes}
        nodeKind={tickerModalNodeKind}
        initialValue={tickerModalInitialValue}
        tickerLists={tickerLists}
        nodeId={tickerModalNodeId}
        nodeDepth={tickerModalNodeDepth}
      />
      <main className={`flex-1 overflow-hidden min-h-0 ${tab === 'Model' || tab === 'Forge' ? 'pb-4' : ''}`}>
        {tab === 'Dashboard' ? (
          <Suspense fallback={<div className="p-4 text-muted">Loading Dashboard...</div>}>
            <DashboardTab
              // UI state
              uiState={uiState}
              setUiState={setUiState}
              // Computed/derived dashboard values
              eligibleBots={eligibleBots}
              dashboardCash={dashboardCash}
              dashboardTotalValue={dashboardTotalValue}
              dashboardTotalPnl={dashboardTotalPnl}
              dashboardTotalPnlPct={dashboardTotalPnlPct}
              dashboardInvestmentsWithPnl={dashboardInvestmentsWithPnl}
              dashboardEquityCurve={dashboardEquityCurve}
              dashboardBotSeries={dashboardBotSeries}
              // Action callbacks
              handleDashboardBuy={handleDashboardBuy}
              handleDashboardSell={handleDashboardSell}
              handleDashboardBuyMore={handleDashboardBuyMore}
              handleNexusBuy={handleNexusBuy}
              runAnalyzeBacktest={runAnalyzeBacktest}
              runSanityReport={runSanityReport}
              updateBotInApi={updateBotInApi}
              handleCopyToNew={handleCopyToNew}
              handleOpenSaved={handleOpenSaved}
              // Helpers
              getFundSlotForBot={getFundSlotForBot}
              // Eligibility requirements
              appEligibilityRequirements={appEligibilityRequirements}
            />
          </Suspense>
        ) : tab === 'Forge' ? (
          <Suspense fallback={<div className="p-4 text-muted">Loading Forge...</div>}>
            <ForgeTab
              // Backtest panel props (derived or callback)
              tickerOptions={tickerOptions}
              backtestStatus={forgeBacktestStatus}
              backtestResult={forgeBacktestResult}
              backtestErrors={forgeBacktestErrors}
              handleRunBacktest={handleRunBacktest}
              handleJumpToBacktestError={handleJumpToBacktestError}
              theme={uiState.theme}
              fetchBenchmarkMetrics={fetchBenchmarkMetrics}
              runModelRobustness={runModelRobustness}
              activeBot={activeForgeBot}
              // Call chain props
              callChains={forgeCallChains}
              setCallChains={setForgeCallChains}
              handleAddCallChain={handleAddCallChain}
              handleRenameCallChain={handleRenameCallChain}
              handleToggleCallChainCollapse={handleToggleCallChainCollapse}
              handleDeleteCallChain={handleDeleteCallChain}
              pushCallChain={pushCallChain}
              // Watchlist props
              watchlists={watchlists}
              savedBots={savedBots}
              setWatchlists={setWatchlists}
              setSavedBots={setSavedBots}
              setBots={setBots}
              setAnalyzeBacktests={setAnalyzeBacktests}
              callChainsById={callChainsById}
              tickerMetadata={tickerMetadata}
              // Backtest visual state
              backtestErrorNodeIds={backtestErrorNodeIds}
              backtestFocusNodeId={forgeBacktestFocusNodeId}
              // Refs
              flowchartScrollRef={flowchartScrollRef}
              floatingScrollRef={floatingScrollRef}
            />
          </Suspense>
        ) : tab === 'Model' ? (
          <Suspense fallback={<div className="p-4 text-muted">Loading Model...</div>}>
            <ModelTab
              // Backtest panel props (derived or callback)
              tickerOptions={tickerOptions}
              backtestStatus={modelBacktestStatus}
              backtestResult={modelBacktestResult}
              backtestErrors={modelBacktestErrors}
              handleRunBacktest={handleRunBacktest}
              handleJumpToBacktestError={handleJumpToBacktestError}
              theme={uiState.theme}
              fetchBenchmarkMetrics={fetchBenchmarkMetrics}
              runModelRobustness={runModelRobustness}
              activeBot={activeModelBot}
              // Call chain props
              callChains={modelCallChains}
              setCallChains={setModelCallChains}
              handleAddCallChain={handleAddCallChain}
              handleRenameCallChain={handleRenameCallChain}
              handleToggleCallChainCollapse={handleToggleCallChainCollapse}
              handleDeleteCallChain={handleDeleteCallChain}
              pushCallChain={pushCallChain}
              // Watchlist props
              watchlists={watchlists}
              savedBots={savedBots}
              setWatchlists={setWatchlists}
              setSavedBots={setSavedBots}
              tickerMetadata={tickerMetadata}
              callChainsById={callChainsById}
              // Backtest visual state
              backtestErrorNodeIds={backtestErrorNodeIds}
              backtestFocusNodeId={modelBacktestFocusNodeId}
              // Refs
              flowchartScrollRef={flowchartScrollRef}
              floatingScrollRef={floatingScrollRef}
            />
          </Suspense>
        ) : tab === 'Help/Support' ? (
          <Suspense fallback={<div className="p-4 text-muted">Loading Help...</div>}>
            <HelpTab
              // UI state (API-persisted)
              uiState={uiState}
              setUiState={setUiState}
              // Callbacks
              savePreferencesToApi={savePreferencesToApi}
              // Changelog API state
              changelogLoading={changelogLoading}
              changelogContent={changelogContent}
            />
          </Suspense>
        ) : tab === 'Admin' ? (
          <Suspense fallback={<div className="p-4 text-muted">Loading Admin...</div>}>
            <AdminTab
              // Callbacks
              onTickersUpdated={(next) => {
                setAvailableTickers(next)
              }}
              onRefreshNexusBots={refreshAllNexusBots}
              onPrewarmComplete={() => {
                // Clear frontend state so tabs will refetch fresh cached data
                setAnalyzeBacktests({})
                setSanityReports({})
                // Refresh Nexus bots from API to get updated metrics
                void refreshAllNexusBots()
              }}
              updateBotInApi={updateBotInApi}
            />
          </Suspense>
        ) : tab === 'Databases' ? (
          <Suspense fallback={<div className="p-4 text-muted">Loading Databases...</div>}>
            <DatabasesTab
              databasesTab={databasesTab}
              setDatabasesTab={setDatabasesTab}
              onOpenBot={isAdmin ? handleOpenBot : undefined}
              onExportBot={isAdmin ? handleExportBot : undefined}
              isAdmin={isAdmin}
            />
          </Suspense>
        ) : tab === 'Analyze' ? (
          <Suspense fallback={<div className="p-4 text-muted">Loading Analyze...</div>}>
            <AnalyzeTab
              // UI state (persisted to API)
              uiState={uiState}
              setUiState={setUiState}
              // Dashboard integration
              dashboardCash={dashboardCash}
              dashboardInvestmentsWithPnl={dashboardInvestmentsWithPnl}
              // Action callbacks
              handleNexusBuy={handleNexusBuy}
              removeBotFromWatchlist={removeBotFromWatchlist}
              runAnalyzeBacktest={runAnalyzeBacktest}
              handleCopyToNew={handleCopyToNew}
              handleOpenSaved={handleOpenSaved}
              handleCopySaved={handleCopySaved}
              handleDeleteSaved={handleDeleteSaved}
              runSanityReport={runSanityReport}
              fetchBenchmarkMetrics={fetchBenchmarkMetrics}
              // Correlation hook
              correlation={correlation}
              // Call chains
              callChainsById={callChainsById}
            />
          </Suspense>
        ) : tab === 'Nexus' ? (
          <Suspense fallback={<div className="p-4 text-muted">Loading Nexus...</div>}>
            <NexusTab />
          </Suspense>
        ) : null}
      </main>
    </div>
  )
}

export default App
