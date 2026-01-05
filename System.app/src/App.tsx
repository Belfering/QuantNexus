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
const NexusTab = lazy(() => import('./tabs/NexusTab'))
const DashboardTab = lazy(() => import('./tabs/DashboardTab'))
const AdminTab = lazy(() => import('./tabs/AdminTab'))
const DatabasesTab = lazy(() => import('./tabs/DatabasesTab'))
const HelpTab = lazy(() => import('./tabs/HelpTab'))
const ModelTab = lazy(() => import('./tabs/ModelTab'))
import './App.css'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { LoginScreen } from '@/components/LoginScreen'
import { cn } from '@/lib/utils'
import type {
  BlockKind,
  SlotId,
  PositionChoice,
  MetricChoice,
  RankChoice,
  ComparatorChoice,
  WeightMode,
  FlowNode,
  CallChain,
  NumberedQuantifier,
  ThemeMode,
  UserId,
  BacktestError,
  BacktestWarning,
  BacktestResult,
  BacktestDayRow,
  BacktestAllocationRow,
  EquityPoint,
  EquityMarker,
  BotBacktestState,
  BotVisibility,
  SavedBot,
  Watchlist,
  BotSession,
  EquityCurvePoint,
  DashboardInvestment,
  DbPosition,
  EligibilityRequirement,
  FundZones,
  UserUiState,
  UserData,
} from './types'
import { STARTING_CAPITAL, defaultDashboardPortfolio } from './types'
import {
  API_BASE,
  TICKER_DATALIST_ID,
  CURRENT_USER_KEY,
  userDataKey,
} from './constants'
import {
  // Helpers
  newId,
  // Node factory
  createNode,
  ensureSlots,
  normalizeForImport,
  // Tree operations
  insertAtSlot,
  appendPlaceholder,
  deleteNode,
  removeSlotEntry,
  updateTitle,
  updateWeight,
  updateCappedFallback,
  updateVolWindow,
  updateCollapse,
  updateColor,
  updateCallReference,
  updateFunctionWindow,
  updateFunctionBottom,
  updateFunctionMetric,
  updateFunctionRank,
  addPositionRow,
  removePositionRow,
  choosePosition,
  addConditionLine,
  deleteConditionLine,
  addEntryCondition,
  addExitCondition,
  deleteEntryCondition,
  deleteExitCondition,
  updateEntryConditionFields,
  updateExitConditionFields,
  updateScalingFields,
  updateNumberedQuantifier,
  updateNumberedN,
  addNumberedItem,
  deleteNumberedItem,
  cloneNode,
  cloneAndNormalize,
  expandToNode,
  findNode,
  collectEnabledConditions,
} from './features/builder'
import {
  // Backtest utilities
  compressTreeForBacktest,
  computeMonthlyReturns,
  computeBacktestSummary,
  isoFromUtcSeconds,
  // Indicator utilities
  emptyCache,
  getSeriesKey,
  buildPriceDb,
  // Input collection
  collectBacktestInputs,
  collectPositionTickers,
  isEtfsOnlyBot,
  collectIndicatorTickers,
  // Validation helpers
  makeBacktestValidationError,
  isBacktestValidationError,
  // Backtest engine functions
  type EvalCtx,
  type Allocation,
  type PositionContribution,
  allocEntries,
  turnoverFraction,
  createBacktestTraceCollector,
  normalizeNodeForBacktest,
  evaluateNode,
  tracePositionContributions,
  // Backtest types
  type ComparisonMetrics,
  type SanityReport,
} from './features/backtest'
import { type BotReturnSeries } from './features/dashboard'
import { useCorrelation } from './features/nexus'
// AdminSubtab, DatabasesSubtab types now used via useUIStore
import {
  fetchNexusBotsFromApi,
  loadBotsFromApi,
  createBotInApi,
  updateBotInApi,
  deleteBotFromApi,
  syncBotMetricsToApi,
  loadWatchlistsFromApi,
  createWatchlistInApi,
  addBotToWatchlistInApi,
  removeBotFromWatchlistInApi,
} from './features/bots'
import {
  loadPreferencesFromApi,
  savePreferencesToApi,
} from './features/auth'
import {
  detectImportFormat,
  parseComposerSymphony,
  yieldToMain,
  fetchOhlcSeries,
  fetchOhlcSeriesBatch,
} from './features/data'
import {
  TickerSearchModal,
  TickerDatalist,
  normalizeChoice,
} from './shared'
// useTickerModal - migrated to stores/useUIStore.ts (Phase 2N-13b)
// useFindReplace - migrated to stores/useBotStore.ts (Phase 2N-13c)
// useIndicatorOverlays - migrated to stores/useBacktestStore.ts (Phase 2N-13d)
// useSaveMenu - migrated to stores/useUIStore.ts (Phase 2N-13b)
import { useAuthStore, useUIStore, useBotStore, useBacktestStore, useDashboardStore } from './stores'
// useCommunityState - migrated to stores/useDashboardStore.ts (Phase 2N-13e)
// useDashboardUIState - migrated to stores/useDashboardStore.ts (Phase 2N-13e)
import type { UTCTimestamp } from 'lightweight-charts'

// Normalization functions imported from @/features/backtest

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
})

const ensureDefaultWatchlist = (watchlists: Watchlist[]): Watchlist[] => {
  // Check for a watchlist marked as default (from database)
  // or named "Default" or "My Watchlist" (legacy localStorage)
  const hasDefault = watchlists.some((w) => w.isDefault || w.name === 'Default' || w.name === 'My Watchlist')
  if (hasDefault) return watchlists
  // No default found - this shouldn't happen with database (backend creates default on user creation)
  // Only create a placeholder for offline/error cases
  return [{ id: `wl-${newKeyId()}`, name: 'My Watchlist', botIds: [], isDefault: true }, ...watchlists]
}

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

// Dashboard investment helpers
const getEligibleBots = (allBots: SavedBot[], userId: UserId): SavedBot[] => {
  return allBots.filter(
    (bot) =>
      bot.builderId === userId || // own private bots
      bot.tags?.includes('Atlas') ||
      bot.tags?.includes('Nexus'),
  )
}

const calculateInvestmentPnl = (
  investment: DashboardInvestment,
  equityCurve: Array<{ date: number; value: number }>,
): { currentValue: number; pnl: number; pnlPercent: number } => {
  if (!equityCurve || equityCurve.length < 2) {
    return { currentValue: investment.costBasis, pnl: 0, pnlPercent: 0 }
  }

  // Find the equity value at or after the buy date
  const buyDateEquityPoint = equityCurve.find((pt) => pt.date >= investment.buyDate)
  const buyDateEquity = buyDateEquityPoint?.value ?? equityCurve[0]?.value ?? 100

  // Get the latest equity value
  const latestEquity = equityCurve[equityCurve.length - 1]?.value ?? buyDateEquity

  // Calculate growth ratio and apply to cost basis
  const growthRatio = buyDateEquity > 0 ? latestEquity / buyDateEquity : 1
  const currentValue = investment.costBasis * growthRatio
  const pnl = currentValue - investment.costBasis
  const pnlPercent = investment.costBasis > 0 ? (pnl / investment.costBasis) * 100 : 0

  return { currentValue, pnl, pnlPercent }
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
// isoFromUtcSeconds imported from @/features/backtest

// Format date as M/D/YYYY (matching QuantMage display format)
const mdyFromUtcSeconds = (t: number) => {
  const ms = Number(t) * 1000
  if (!Number.isFinite(ms)) return '1/1/1970'
  try {
    const d = new Date(ms)
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`
  } catch {
    return '1/1/1970'
  }
}

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
  const setTickerModalOpen = useUIStore(s => s.setTickerModalOpen)

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

  // Dashboard Store - values and setters needed by callbacks
  // Phase 2N-14c: Removed UI-only state (timePeriod, botExpanded, buyBotDropdownOpen) - now used via store in DashboardPanel
  const dashboardBuyBotId = useDashboardStore(s => s.dashboardBuyBotId)
  const setDashboardBuyBotId = useDashboardStore(s => s.setDashboardBuyBotId)
  const setDashboardBuyBotSearch = useDashboardStore(s => s.setDashboardBuyBotSearch)
  const dashboardBuyAmount = useDashboardStore(s => s.dashboardBuyAmount)
  const setDashboardBuyAmount = useDashboardStore(s => s.setDashboardBuyAmount)
  const dashboardBuyMode = useDashboardStore(s => s.dashboardBuyMode)
  const setDashboardSellBotId = useDashboardStore(s => s.setDashboardSellBotId)
  const dashboardSellAmount = useDashboardStore(s => s.dashboardSellAmount)
  const setDashboardSellAmount = useDashboardStore(s => s.setDashboardSellAmount)
  const dashboardSellMode = useDashboardStore(s => s.dashboardSellMode)
  const setDashboardBuyMoreBotId = useDashboardStore(s => s.setDashboardBuyMoreBotId)
  const dashboardBuyMoreAmount = useDashboardStore(s => s.dashboardBuyMoreAmount)
  const setDashboardBuyMoreAmount = useDashboardStore(s => s.setDashboardBuyMoreAmount)
  const dashboardBuyMoreMode = useDashboardStore(s => s.dashboardBuyMoreMode)

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
      return v === '1' || v === '9' || v === 'admin' ? (v as UserId) : null
    } catch {
      return null
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
      return null
    } catch {
      return null
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
      return null
    } catch {
      return null
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
  const isAdmin = userRole === 'admin' || userRole === 'main_admin' || userRole === 'sub_admin'
  // Engineer access = engineer or higher (for Databases tab)
  const hasEngineerAccess = userRole === 'engineer' || userRole === 'sub_admin' || userRole === 'main_admin' || userRole === 'admin'

  // Bot Store - saved bots and watchlists (migrated from useState in Phase 2N-13c)
  const savedBots = useBotStore(s => s.savedBots)
  const setSavedBots = useBotStore(s => s.setSavedBots)
  const watchlists = useBotStore(s => s.watchlists)
  const setWatchlists = useBotStore(s => s.setWatchlists)
  // NOTE: callChains is now per-bot (stored in BotSession.callChains), not global state
  const [uiState, setUiState] = useState<UserUiState>(() => initialUserData.ui)

  // Initialize saved bots and watchlists from localStorage on mount
  useEffect(() => {
    setSavedBots(initialUserData.savedBots)
    setWatchlists(initialUserData.watchlists)
  }, [setSavedBots, setWatchlists])
  // Dashboard Store - portfolio state (migrated from useState, Phase 2N-13e)
  const dashboardPortfolio = useDashboardStore(s => s.dashboardPortfolio)
  const setDashboardPortfolio = useDashboardStore(s => s.setDashboardPortfolio)
  const [_portfolioLoading, setPortfolioLoading] = useState(false) // TODO: show loading state in UI

  // Backtest Store - analyze state (migrated from useState, Phase 2N-13d)
  const analyzeBacktests = useBacktestStore(s => s.analyzeBacktests)
  const setAnalyzeBacktests = useBacktestStore(s => s.setAnalyzeBacktests)
  const analyzeTickerContrib = useBacktestStore(s => s.analyzeTickerContrib)
  const setAnalyzeTickerContrib = useBacktestStore(s => s.setAnalyzeTickerContrib)
  const sanityReports = useBacktestStore(s => s.sanityReports)
  const setSanityReports = useBacktestStore(s => s.setSanityReports)
  const benchmarkMetrics = useBacktestStore(s => s.benchmarkMetrics)
  const setBenchmarkMetrics = useBacktestStore(s => s.setBenchmarkMetrics)
  const setModelSanityReport = useBacktestStore(s => s.setModelSanityReport)

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

  const [availableTickers, setAvailableTickers] = useState<string[]>([])
  const [tickerMetadata, setTickerMetadata] = useState<Map<string, { assetType?: string; name?: string; exchange?: string }>>(new Map())
  const [tickerApiError, setTickerApiError] = useState<string | null>(null)

  // Backtest Store - ETF/backtest settings (migrated from useState, Phase 2N-13d)
  // Note: setters moved to ModelTab via useBacktestStore (Phase 2N-14)
  const etfsOnlyMode = useBacktestStore(s => s.etfsOnlyMode)
  const backtestMode = useBacktestStore(s => s.backtestMode)
  const backtestCostBps = useBacktestStore(s => s.backtestCostBps)
  const backtestBenchmark = useBacktestStore(s => s.backtestBenchmark)
  // Per-bot backtest state moved to BotSession.backtest - see derived values after activeBot

  // Load bots from API on mount/user change (database is source of truth)
  const [_botsLoadedFromApi, setBotsLoadedFromApi] = useState(false)
  useEffect(() => {
    if (!userId) return
    setBotsLoadedFromApi(false)
    loadBotsFromApi(userId).then(async (apiBots) => {
      // Check localStorage for any bots that aren't in the API yet (migration)
      const localData = loadUserData(userId)
      const apiBotIds = new Set(apiBots.map(b => b.id))
      const localBotsNotInApi = localData.savedBots.filter(b => !apiBotIds.has(b.id))

      if (localBotsNotInApi.length > 0) {
        // Migrate localStorage bots that don't exist in API
        console.log('[Migration] Migrating', localBotsNotInApi.length, 'bots to API...')
        await Promise.all(localBotsNotInApi.map(bot => createBotInApi(userId, bot)))
        console.log('[Migration] Bots migrated successfully')
        // Merge: API bots + migrated local bots
        setSavedBots([...apiBots, ...localBotsNotInApi])
      } else {
        // No migration needed, just use API bots
        setSavedBots(apiBots)
      }
      setBotsLoadedFromApi(true)
    }).catch((err) => {
      console.warn('[API] Failed to load bots, using localStorage fallback:', err)
      // Fallback to localStorage if API fails
      const localData = loadUserData(userId)
      if (localData.savedBots.length > 0) {
        setSavedBots(localData.savedBots)
      }
      setBotsLoadedFromApi(true)
    })
  }, [userId])

  // Load portfolio from database API when user logs in
  useEffect(() => {
    if (!userId) return

    const loadPortfolio = async () => {
      setPortfolioLoading(true)
      try {
        const res = await fetch(`/api/portfolio?userId=${userId}`)
        if (res.ok) {
          const { portfolio } = await res.json()
          if (portfolio) {
            setDashboardPortfolio({
              cash: portfolio.cashBalance,
              investments: (portfolio.positions || []).map((p: DbPosition) => ({
                botId: p.botId,
                botName: p.bot?.name || 'Unknown',
                buyDate: p.entryDate ? new Date(p.entryDate).getTime() : Date.now(),
                costBasis: p.costBasis,
              })),
            })
          } else {
            // No portfolio in DB yet, use default
            setDashboardPortfolio(defaultDashboardPortfolio())
          }
        } else {
          console.warn('[Portfolio] Failed to load from API, using default')
          setDashboardPortfolio(defaultDashboardPortfolio())
        }
      } catch (e) {
        console.error('[Portfolio] Error loading portfolio:', e)
        setDashboardPortfolio(defaultDashboardPortfolio())
      } finally {
        setPortfolioLoading(false)
      }
    }

    loadPortfolio()
  }, [userId])

  // Set Dashboard as default tab for logged-in users (only on initial mount)
  const [hasSetInitialTab, setHasSetInitialTab] = useState(false)
  useEffect(() => {
    if (userId && !hasSetInitialTab) {
      setTab('Dashboard')
      setHasSetInitialTab(true)
    }
  }, [userId, hasSetInitialTab])

  // Load watchlists from database API when user logs in
  const [_watchlistsLoadedFromApi, setWatchlistsLoadedFromApi] = useState(false)
  useEffect(() => {
    if (!userId) return
    setWatchlistsLoadedFromApi(false)
    loadWatchlistsFromApi(userId).then(async (apiWatchlists) => {
      // Check localStorage for any watchlists that aren't in the API yet (migration)
      const localData = loadUserData(userId)
      const apiWatchlistNames = new Set(apiWatchlists.map(w => w.name.toLowerCase()))
      // Skip migration for default watchlists (they're auto-created by backend)
      // Compare by NAME not ID, since localStorage IDs (wl-xxx) differ from API IDs (watchlist-xxx-default)
      const localWatchlistsNotInApi = localData.watchlists.filter(w => {
        const nameLower = w.name.toLowerCase()
        // Skip default watchlist names - backend already provides these
        if (nameLower === 'default' || nameLower === 'my watchlist') return false
        // Skip if a watchlist with this name already exists in API
        return !apiWatchlistNames.has(nameLower)
      })

      if (localWatchlistsNotInApi.length > 0) {
        // Migrate localStorage watchlists that don't exist in API
        console.log('[Migration] Migrating', localWatchlistsNotInApi.length, 'watchlists to API...')
        for (const wl of localWatchlistsNotInApi) {
          const newId = await createWatchlistInApi(userId, wl.name)
          if (newId) {
            // Add bots to the newly created watchlist
            for (const botId of wl.botIds) {
              await addBotToWatchlistInApi(newId, botId)
            }
          }
        }
        console.log('[Migration] Watchlists migrated successfully')
        // Reload from API to get fresh data with server IDs
        const refreshedWatchlists = await loadWatchlistsFromApi(userId)
        setWatchlists(ensureDefaultWatchlist(refreshedWatchlists))
      } else if (apiWatchlists.length > 0) {
        // No migration needed, just use API watchlists
        setWatchlists(ensureDefaultWatchlist(apiWatchlists))
      }
      // If both are empty, keep the default watchlist from initial state
      setWatchlistsLoadedFromApi(true)
    }).catch((err) => {
      console.warn('[API] Failed to load watchlists, using localStorage fallback:', err)
      // Fallback to localStorage if API fails
      const localData = loadUserData(userId)
      if (localData.watchlists.length > 0) {
        setWatchlists(ensureDefaultWatchlist(localData.watchlists))
      }
      setWatchlistsLoadedFromApi(true)
    })
  }, [userId])

  // Load UI preferences from database API when user logs in
  const [prefsLoadedFromApi, setPrefsLoadedFromApi] = useState(false)
  useEffect(() => {
    if (!userId) return
    setPrefsLoadedFromApi(false)
    loadPreferencesFromApi(userId).then((apiPrefs) => {
      if (apiPrefs) {
        setUiState(apiPrefs)
        console.log('[Preferences] Loaded from API:', apiPrefs.theme, apiPrefs.colorTheme)
      } else {
        // No API prefs yet, check localStorage for migration
        const localData = loadUserData(userId)
        if (localData.ui && localData.ui.theme) {
          // Migrate localStorage preferences to API
          console.log('[Preferences] Migrating from localStorage:', localData.ui.theme, localData.ui.colorTheme)
          setUiState(localData.ui) // Apply localStorage prefs immediately
          savePreferencesToApi(userId, localData.ui).catch(err =>
            console.warn('[API] Failed to migrate preferences:', err)
          )
        }
      }
      setPrefsLoadedFromApi(true)
    }).catch((err) => {
      console.warn('[API] Failed to load preferences:', err)
      setPrefsLoadedFromApi(true)
    })
  }, [userId])

  // Save UI preferences to database API when they change (debounced)
  // Only save AFTER preferences have been loaded to avoid overwriting with defaults
  const uiStateRef = useRef(uiState)
  useEffect(() => {
    uiStateRef.current = uiState
  }, [uiState])

  useEffect(() => {
    if (!userId) return
    // IMPORTANT: Don't save until preferences have been loaded from API
    // This prevents overwriting saved preferences with defaults on login
    if (!prefsLoadedFromApi) return
    // Debounce preferences save to avoid excessive API calls
    const timer = setTimeout(() => {
      console.log('[Preferences] Saving to API:', uiStateRef.current.theme, uiStateRef.current.colorTheme)
      savePreferencesToApi(userId, uiStateRef.current).catch(err =>
        console.warn('[API] Failed to save preferences:', err)
      )
    }, 1000) // 1 second debounce
    return () => clearTimeout(timer)
  }, [userId, uiState, prefsLoadedFromApi])

  // NOTE: Call chains are now stored per-bot (in BotSession.callChains) instead of globally
  // They are saved with the bot payload when saving to watchlist

  // Manual refresh function for allNexusBots (called after Atlas slot changes)
  const refreshAllNexusBots = useCallback(async () => {
    if (!userId) return
    try {
      const apiBots = await fetchNexusBotsFromApi()
      // Merge user's local Nexus bots with API bots (deduplicated)
      // Prefer API bots as they have builderDisplayName populated from the database
      const localNexusBots = savedBots.filter((bot) => bot.tags?.includes('Nexus'))
      const apiBotIds = new Set(apiBots.map((b) => b.id))
      const localBotsNotInApi = localNexusBots.filter((lb) => !apiBotIds.has(lb.id))
      const merged = [...apiBots, ...localBotsNotInApi]
      const seen = new Set<string>()
      const deduplicated = merged.filter((bot) => {
        if (seen.has(bot.id)) return false
        seen.add(bot.id)
        return true
      })
      setAllNexusBots(deduplicated)
    } catch {
      // Fallback to just user's local Nexus bots if API fails
      setAllNexusBots(savedBots.filter((bot) => bot.tags?.includes('Nexus')))
    }
  }, [userId, savedBots])

  // Refresh cross-user Nexus bots when user changes or their own savedBots change
  // (their saved bots may now have Nexus tag)
  // Uses API for scalable cross-user visibility, falls back to localStorage
  useEffect(() => {
    void refreshAllNexusBots()
  }, [refreshAllNexusBots])

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
            const map = new Map<string, { assetType?: string; name?: string; exchange?: string }>()
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

  // Bot Store - bot sessions (migrated from useState in Phase 2N-13c)
  // createBotSession is now in the store
  const createBotSession = useBotStore(s => s.createBotSession)
  const bots = useBotStore(s => s.bots)
  const setBots = useBotStore(s => s.setBots)
  const activeBotId = useBotStore(s => s.activeBotId)
  const setActiveBotId = useBotStore(s => s.setActiveBotId)
  const setClipboard = useBotStore(s => s.setClipboard)
  const setCopiedNodeId = useBotStore(s => s.setCopiedNodeId)
  const isImporting = useBotStore(s => s.isImporting)
  const setIsImporting = useBotStore(s => s.setIsImporting)
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

  // UI Store - collapse states (setCallbackNodesCollapsed still needed in App.tsx)
  const setCallbackNodesCollapsed = useUIStore(s => s.setCallbackNodesCollapsed)

  // Flowchart scroll state for floating scrollbar
  const flowchartScrollRef = useRef<HTMLDivElement>(null)
  const floatingScrollRef = useRef<HTMLDivElement>(null)
  const flowchartScrollWidth = useUIStore(s => s.flowchartScrollWidth)
  const setFlowchartScrollWidth = useUIStore(s => s.setFlowchartScrollWidth)
  const flowchartClientWidth = useUIStore(s => s.flowchartClientWidth)
  const setFlowchartClientWidth = useUIStore(s => s.setFlowchartClientWidth)

  // Update scroll dimensions when tab changes or window resizes
  useEffect(() => {
    if (tab !== 'Model') return

    const updateScrollDimensions = () => {
      if (flowchartScrollRef.current) {
        const sw = flowchartScrollRef.current.scrollWidth
        const cw = flowchartScrollRef.current.clientWidth
        setFlowchartScrollWidth(sw)
        setFlowchartClientWidth(cw)
      }
    }

    // Initial update after delays to ensure DOM is ready
    const timer1 = setTimeout(updateScrollDimensions, 100)
    const timer2 = setTimeout(updateScrollDimensions, 500)
    const timer3 = setTimeout(updateScrollDimensions, 1000)

    // Also update on window resize
    window.addEventListener('resize', updateScrollDimensions)

    // Use MutationObserver to detect DOM changes inside flowchart
    let observer: MutationObserver | null = null
    if (flowchartScrollRef.current) {
      observer = new MutationObserver(updateScrollDimensions)
      observer.observe(flowchartScrollRef.current, { childList: true, subtree: true })
    }

    return () => {
      clearTimeout(timer1)
      clearTimeout(timer2)
      clearTimeout(timer3)
      window.removeEventListener('resize', updateScrollDimensions)
      observer?.disconnect()
    }
  }, [tab])

  // Inline buy state for Nexus bots (in Analyze tab, Nexus, watchlists)
  // Migrated from useState to useUIStore in Phase 2N-14b
  // Phase 2N-14d: Removed nexusBuyBotId, setNexusBuyMode - now used via store in NexusPanel/AnalyzePanel
  const setNexusBuyBotId = useUIStore(s => s.setNexusBuyBotId)
  const nexusBuyAmount = useUIStore(s => s.nexusBuyAmount)
  const setNexusBuyAmount = useUIStore(s => s.setNexusBuyAmount)
  const nexusBuyMode = useUIStore(s => s.nexusBuyMode)

  const activeBot = useMemo(() => {
    return bots.find((b) => b.id === activeBotId) ?? bots[0]
  }, [bots, activeBotId])

  const current = activeBot.history[activeBot.historyIndex]

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
    const fetchOverlays = async () => {
      try {
        const res = await fetch(API_BASE + "/indicator-series", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conditions, mode: backtestMode })
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

  const dashboardCash = dashboardPortfolio.cash

  // Calculate live P&L for investments using real backtest data
  const dashboardInvestmentsWithPnl = useMemo(() => {
    return dashboardPortfolio.investments.map((inv) => {
      // Get backtest result for this bot from analyzeBacktests
      const backtestState = analyzeBacktests[inv.botId]
      const backtestResult = backtestState?.result

      // Convert backtest equity points to the format expected by calculateInvestmentPnl
      let equityCurve: Array<{ date: number; value: number }> = []
      if (backtestResult?.points && backtestResult.points.length > 0) {
        equityCurve = backtestResult.points.map((pt) => ({
          date: (typeof pt.time === 'number' ? pt.time : Date.parse(pt.time as string) / 1000) * 1000,
          value: pt.value,
        }))
      } else {
        // Fallback: mock data if no backtest available
        equityCurve = [
          { date: inv.buyDate, value: 100 },
          { date: Date.now(), value: 100 },
        ]
      }

      const { currentValue, pnl, pnlPercent } = calculateInvestmentPnl(inv, equityCurve)
      return { ...inv, currentValue, pnl, pnlPercent }
    })
  }, [dashboardPortfolio.investments, analyzeBacktests])

  const dashboardTotalValue = dashboardCash + dashboardInvestmentsWithPnl.reduce((sum, inv) => sum + inv.currentValue, 0)
  const dashboardTotalPnl = dashboardInvestmentsWithPnl.reduce((sum, inv) => sum + inv.pnl, 0)
  const dashboardTotalPnlPct = STARTING_CAPITAL > 0 ? (dashboardTotalPnl / STARTING_CAPITAL) * 100 : 0

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

  const handleDashboardBuy = async () => {
    if (!dashboardBuyBotId || !userId) return
    // Look in both savedBots and allNexusBots to find the bot
    const bot = savedBots.find((b) => b.id === dashboardBuyBotId)
      ?? allNexusBots.find((b) => b.id === dashboardBuyBotId)
    if (!bot) return

    // Calculate amount
    let amount = 0
    if (dashboardBuyMode === '$') {
      amount = parseFloat(dashboardBuyAmount) || 0
    } else {
      const pct = parseFloat(dashboardBuyAmount) || 0
      amount = (pct / 100) * dashboardCash
    }

    // Validate
    if (amount < 100) {
      alert('Minimum investment is $100')
      return
    }
    if (amount > dashboardCash) {
      alert('Insufficient cash')
      return
    }
    // Check if already invested
    if (dashboardPortfolio.investments.some((inv) => inv.botId === dashboardBuyBotId)) {
      alert('Already invested in this system. Sell first to reinvest.')
      return
    }

    // Call API to persist the purchase
    try {
      const res = await fetch('/api/portfolio/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, botId: bot.id, amount }),
      })
      if (!res.ok) {
        const { error } = await res.json()
        alert(error || 'Failed to buy')
        return
      }

      // Update local state after successful API call
      const newInvestment: DashboardInvestment = {
        botId: bot.id,
        botName: bot.name,
        buyDate: Date.now(),
        costBasis: amount,
      }

      setDashboardPortfolio((prev) => ({
        cash: prev.cash - amount,
        investments: [...prev.investments, newInvestment],
      }))
      setDashboardBuyBotId('')
      setDashboardBuyBotSearch('')
      setDashboardBuyAmount('')
    } catch (e) {
      console.error('[Portfolio] Buy failed:', e)
      alert('Network error - failed to buy')
    }
  }

  const handleDashboardSell = async (botId: string, sellAll: boolean) => {
    if (!userId) return
    const investment = dashboardPortfolio.investments.find((inv) => inv.botId === botId)
    if (!investment) return

    const invWithPnl = dashboardInvestmentsWithPnl.find((inv) => inv.botId === botId)
    if (!invWithPnl) return

    let sellAmount = invWithPnl.currentValue
    if (!sellAll) {
      if (dashboardSellMode === '$') {
        sellAmount = Math.min(parseFloat(dashboardSellAmount) || 0, invWithPnl.currentValue)
      } else {
        const pct = parseFloat(dashboardSellAmount) || 0
        sellAmount = (pct / 100) * invWithPnl.currentValue
      }
    }

    if (sellAmount <= 0) return

    // Call API to persist the sale
    try {
      const res = await fetch('/api/portfolio/sell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, botId, amount: sellAmount }),
      })
      if (!res.ok) {
        const { error } = await res.json()
        alert(error || 'Failed to sell')
        return
      }

      // Update local state after successful API call
      // If selling all or selling more than 99% of position, remove investment
      if (sellAmount >= invWithPnl.currentValue * 0.99) {
        setDashboardPortfolio((prev) => ({
          cash: prev.cash + invWithPnl.currentValue,
          investments: prev.investments.filter((inv) => inv.botId !== botId),
        }))
      } else {
        // Partial sell - reduce cost basis proportionally
        const sellRatio = sellAmount / invWithPnl.currentValue
        const newCostBasis = investment.costBasis * (1 - sellRatio)
        setDashboardPortfolio((prev) => ({
          cash: prev.cash + sellAmount,
          investments: prev.investments.map((inv) =>
            inv.botId === botId ? { ...inv, costBasis: newCostBasis } : inv,
          ),
        }))
      }

      setDashboardSellBotId(null)
      setDashboardSellAmount('')
    } catch (e) {
      console.error('[Portfolio] Sell failed:', e)
      alert('Network error - failed to sell')
    }
  }

  const handleDashboardBuyMore = async (botId: string) => {
    if (!userId) return
    const investment = dashboardPortfolio.investments.find((inv) => inv.botId === botId)
    if (!investment) return

    // Calculate amount
    let amount = 0
    if (dashboardBuyMoreMode === '$') {
      amount = parseFloat(dashboardBuyMoreAmount) || 0
    } else {
      const pct = parseFloat(dashboardBuyMoreAmount) || 0
      amount = (pct / 100) * dashboardCash
    }

    // Validate
    if (amount < 100) {
      alert('Minimum investment is $100')
      return
    }
    if (amount > dashboardCash) {
      alert('Insufficient cash')
      return
    }

    // Call API to persist the additional purchase
    try {
      const res = await fetch('/api/portfolio/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, botId, amount }),
      })
      if (!res.ok) {
        const { error } = await res.json()
        alert(error || 'Failed to buy more')
        return
      }

      // Add to existing position
      setDashboardPortfolio((prev) => ({
        cash: prev.cash - amount,
        investments: prev.investments.map((inv) =>
          inv.botId === botId
            ? { ...inv, costBasis: inv.costBasis + amount, buyDate: Date.now() }
            : inv,
        ),
      }))

      setDashboardBuyMoreBotId(null)
      setDashboardBuyMoreAmount('')
    } catch (e) {
      console.error('[Portfolio] Buy more failed:', e)
      alert('Network error - failed to buy more')
    }
  }

  // Handle buying Nexus bots from inline buy UI (Analyze tab, Nexus, watchlists)
  const handleNexusBuy = async (botId: string) => {
    if (!userId) return
    // Look in both savedBots and allNexusBots to find the bot
    const bot = savedBots.find((b) => b.id === botId)
      ?? allNexusBots.find((b) => b.id === botId)
    if (!bot) return

    // Calculate amount
    let amount = 0
    if (nexusBuyMode === '$') {
      amount = parseFloat(nexusBuyAmount) || 0
    } else {
      const pct = parseFloat(nexusBuyAmount) || 0
      amount = (pct / 100) * dashboardCash
    }

    // Validate
    if (amount < 100) {
      alert('Minimum investment is $100')
      return
    }
    if (amount > dashboardCash) {
      alert('Insufficient cash')
      return
    }

    // Call API to persist the purchase
    try {
      const res = await fetch('/api/portfolio/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, botId: bot.id, amount }),
      })
      if (!res.ok) {
        const { error } = await res.json()
        alert(error || 'Failed to buy')
        return
      }

      // Update local state after successful API call
      // Check if already invested - if so, add to position
      const existingInvestment = dashboardPortfolio.investments.find((inv) => inv.botId === botId)
      if (existingInvestment) {
        // Add to existing position
        setDashboardPortfolio((prev) => ({
          cash: prev.cash - amount,
          investments: prev.investments.map((inv) =>
            inv.botId === botId
              ? { ...inv, costBasis: inv.costBasis + amount, buyDate: Date.now() }
              : inv,
          ),
        }))
      } else {
        // Create new investment
        const newInvestment: DashboardInvestment = {
          botId: bot.id,
          botName: bot.name,
          buyDate: Date.now(),
          costBasis: amount,
        }
        setDashboardPortfolio((prev) => ({
          cash: prev.cash - amount,
          investments: [...prev.investments, newInvestment],
        }))
      }

      // Reset state
      setNexusBuyBotId(null)
      setNexusBuyAmount('')
    } catch (e) {
      console.error('[Portfolio] Nexus buy failed:', e)
      alert('Network error - failed to buy')
    }
  }

  // Bot colors for chart lines
  const BOT_CHART_COLORS = ['#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1']

  // Generate equity curves from actual invested bot backtest data
  const { dashboardEquityCurve, dashboardBotSeries } = useMemo(() => {
    const investments = dashboardInvestmentsWithPnl

    if (investments.length === 0) {
      // No investments - show flat line at starting capital
      const now = Date.now()
      const oneDay = 24 * 60 * 60 * 1000
      const portfolioPoints: EquityCurvePoint[] = []
      for (let i = 30; i >= 0; i--) {
        const timestamp = Math.floor((now - i * oneDay) / 1000) as UTCTimestamp
        portfolioPoints.push({ time: timestamp, value: STARTING_CAPITAL })
      }
      return { dashboardEquityCurve: portfolioPoints, dashboardBotSeries: [] }
    }

    // Build bot series from real backtest data (full historical data, scaled by cost basis)
    const botSeries: BotReturnSeries[] = []
    const botEquityByTime = new Map<number, Map<string, { value: number; costBasis: number }>>()

    investments.forEach((inv, botIdx) => {
      const backtestState = analyzeBacktests[inv.botId]
      const backtestResult = backtestState?.result

      if (backtestResult?.points && backtestResult.points.length > 0) {
        // Use start of backtest as baseline (value = 1 at start)
        const startEquity = backtestResult.points[0].value
        const botPoints: EquityCurvePoint[] = []

        for (const pt of backtestResult.points) {
          const timeSec = typeof pt.time === 'number' ? pt.time : Math.floor(Date.parse(pt.time as string) / 1000)

          // Scale backtest equity to cost basis (if you invested $20k at start, show growth from $20k)
          const growthRatio = startEquity > 0 ? pt.value / startEquity : 1
          const currentValue = inv.costBasis * growthRatio

          botPoints.push({ time: timeSec as UTCTimestamp, value: currentValue })

          // Track for portfolio aggregation
          if (!botEquityByTime.has(timeSec)) {
            botEquityByTime.set(timeSec, new Map())
          }
          botEquityByTime.get(timeSec)!.set(inv.botId, { value: currentValue, costBasis: inv.costBasis })
        }

        if (botPoints.length > 0) {
          botSeries.push({
            id: inv.botId,
            name: inv.botName,
            color: BOT_CHART_COLORS[botIdx % BOT_CHART_COLORS.length],
            data: botPoints,
          })
        }
      }
    })

    // Build portfolio equity curve by summing all bot values + remaining cash at each time point
    const sortedTimes = Array.from(botEquityByTime.keys()).sort((a, b) => a - b)
    const portfolioPoints: EquityCurvePoint[] = []
    const lastKnownValues = new Map<string, number>()

    // Initialize with cost basis values for each investment
    investments.forEach((inv) => {
      lastKnownValues.set(inv.botId, inv.costBasis)
    })

    for (const timeSec of sortedTimes) {
      const timeData = botEquityByTime.get(timeSec)!

      // Update last known values for bots that have data at this time
      for (const [botId, data] of timeData) {
        lastKnownValues.set(botId, data.value)
      }

      // Sum all bot values at this time point
      let totalBotValue = 0
      for (const value of lastKnownValues.values()) {
        totalBotValue += value
      }

      // Total portfolio = cash + all bot values
      const portfolioValue = dashboardCash + totalBotValue
      portfolioPoints.push({ time: timeSec as UTCTimestamp, value: portfolioValue })
    }

    // If no portfolio points generated, create a simple curve
    if (portfolioPoints.length === 0) {
      const now = Date.now()
      const oneDay = 24 * 60 * 60 * 1000
      for (let i = 30; i >= 0; i--) {
        const timestamp = Math.floor((now - i * oneDay) / 1000) as UTCTimestamp
        portfolioPoints.push({ time: timestamp, value: dashboardTotalValue })
      }
    }

    return { dashboardEquityCurve: portfolioPoints, dashboardBotSeries: botSeries }
  }, [dashboardInvestmentsWithPnl, analyzeBacktests, dashboardCash, dashboardTotalValue])

  const push = useCallback(
    (next: FlowNode) => {
      setBots((prev) =>
        prev.map((b) => {
          if (b.id !== activeBotId) return b
          const trimmed = b.history.slice(0, b.historyIndex + 1)
          trimmed.push(ensureSlots(next))
          return { ...b, history: trimmed, historyIndex: trimmed.length - 1 }
        }),
      )
    },
    [activeBotId],
  )

  const handleAdd = useCallback(
    (parentId: string, slot: SlotId, index: number, kind: BlockKind) => {
      const next = insertAtSlot(current, parentId, slot, index, ensureSlots(createNode(kind)))
      push(next)
    },
    [current, push],
  )

  const handleAppend = useCallback(
    (parentId: string, slot: SlotId) => {
      const next = appendPlaceholder(current, parentId, slot)
      push(next)
    },
    [current, push],
  )

  const handleRemoveSlotEntry = useCallback(
    (parentId: string, slot: SlotId, index: number) => {
      const next = removeSlotEntry(current, parentId, slot, index)
      push(next)
    },
    [current, push],
  )

  const handleCloseBot = useCallback(
    (botId: string) => {
      setBots((prev) => {
        const filtered = prev.filter((b) => b.id !== botId)
        if (filtered.length === 0) {
          const nb = createBotSession('Algo Name Here')
          setActiveBotId(nb.id)
          setClipboard(null)
          setCopiedNodeId(null)
          return [nb]
        }
        if (botId === activeBotId) {
          setActiveBotId(filtered[0].id)
          setClipboard(null)
          setCopiedNodeId(null)
        }
        return filtered
      })
    },
    [activeBotId, createBotSession],
  )

  const handleDelete = useCallback(
    (id: string) => {
      if (current.id === id) {
        handleCloseBot(activeBotId)
        return
      }
      const next = deleteNode(current, id)
      push(next)
    },
    [current, push, handleCloseBot, activeBotId],
  )

  const handleCopy = useCallback(
    (id: string) => {
      const found = findNode(current, id)
      if (!found) return
      setClipboard(cloneNode(found))
      setCopiedNodeId(id) // Track the original node ID
    },
    [current],
  )

  const handlePaste = useCallback(
    (parentId: string, slot: SlotId, index: number, child: FlowNode) => {
      // Use single-pass clone + normalize for better performance
      const next = insertAtSlot(current, parentId, slot, index, cloneAndNormalize(child))
      push(next)
    },
    [current, push],
  )

  const handlePasteCallRef = useCallback(
    (parentId: string, slot: SlotId, index: number, callChainId: string) => {
      // Create a call node with the callRefId pre-set
      const callNode = createNode('call')
      callNode.callRefId = callChainId
      const next = insertAtSlot(current, parentId, slot, index, ensureSlots(callNode))
      push(next)
    },
    [current, push],
  )

  const handleRename = useCallback(
    (id: string, title: string) => {
      const next = updateTitle(current, id, title)
      push(next)
    },
    [current, push],
  )

  const handleWeightChange = useCallback(
    (id: string, weight: WeightMode, branch?: 'then' | 'else') => {
      const next = updateWeight(current, id, weight, branch)
      push(next)
    },
    [current, push],
  )

  const handleUpdateCappedFallback = useCallback(
    (id: string, choice: PositionChoice, branch?: 'then' | 'else') => {
      const next = updateCappedFallback(current, id, choice, branch)
      push(next)
    },
    [current, push],
  )

  const handleUpdateVolWindow = useCallback(
    (id: string, days: number, branch?: 'then' | 'else') => {
      const next = updateVolWindow(current, id, days, branch)
      push(next)
    },
    [current, push],
  )

  const handleFunctionWindow = useCallback(
    (id: string, value: number) => {
      const next = updateFunctionWindow(current, id, value)
      push(next)
    },
    [current, push],
  )

  const handleFunctionBottom = useCallback(
    (id: string, value: number) => {
      const next = updateFunctionBottom(current, id, value)
      push(next)
    },
    [current, push],
  )

  const handleFunctionMetric = useCallback(
    (id: string, metric: MetricChoice) => {
      const next = updateFunctionMetric(current, id, metric)
      push(next)
    },
    [current, push],
  )

  const handleFunctionRank = useCallback(
    (id: string, rank: RankChoice) => {
      const next = updateFunctionRank(current, id, rank)
      push(next)
    },
    [current, push],
  )

  const handleColorChange = useCallback(
    (id: string, color?: string) => {
      const next = updateColor(current, id, color)
      push(next)
    },
    [current, push],
  )

  const handleUpdateCallRef = useCallback(
    (id: string, callId: string | null) => {
      const next = updateCallReference(current, id, callId)
      push(next)
    },
    [current, push],
  )

  const handleToggleCollapse = useCallback(
    (id: string, isCollapsed: boolean) => {
      const next = updateCollapse(current, id, isCollapsed)
      push(next)
    },
    [current, push],
  )

  // Helper to update backtest state for the active bot
  const updateActiveBotBacktest = useCallback((update: Partial<BotBacktestState>) => {
    setBots((prev) =>
      prev.map((b) =>
        b.id === activeBotId ? { ...b, backtest: { ...b.backtest, ...update } } : b,
      ),
    )
  }, [activeBotId])

  const handleJumpToBacktestError = useCallback(
    (err: BacktestError) => {
      updateActiveBotBacktest({ focusNodeId: err.nodeId })
      const expanded = expandToNode(current, err.nodeId)
      if (expanded.found) push(expanded.next)
      setTimeout(() => {
        document.getElementById(`node-${err.nodeId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 30)
    },
    [current, push, updateActiveBotBacktest],
  )

  const runBacktestForNode = useCallback(
    async (node: FlowNode) => {
      const backtestStartTime = performance.now()
      const timings: Record<string, number> = {}

      // Phase 1: Tree preparation & compression
      const prepStartTime = performance.now()
      const prepared = normalizeNodeForBacktest(ensureSlots(cloneNode(node)))

      // Compress tree for faster evaluation
      const { tree: compressedTree, stats: compressionStats } = compressTreeForBacktest(prepared)
      if (!compressedTree) {
        throw makeBacktestValidationError([{ nodeId: prepared.id, field: 'tree', message: 'Strategy is empty after compression (all branches lead to Empty).' }])
      }
      timings['1_preparation'] = performance.now() - prepStartTime

      // Log compression stats to console
      console.log(
        `[Backtest] Tree compression: ${compressionStats.originalNodes} → ${compressionStats.compressedNodes} nodes ` +
          `(${compressionStats.nodesRemoved} removed, ${compressionStats.gateChainsMerged} gates merged) in ${compressionStats.compressionTimeMs.toFixed(1)}ms`
      )

      // Phase 2: Input collection & validation
      const inputStartTime = performance.now()
      // Use compressed tree for backtest, but original for validation/ticker collection
      const inputs = collectBacktestInputs(prepared, callChainsById)
      if (inputs.errors.length > 0) {
        throw makeBacktestValidationError(inputs.errors)
      }
      if (inputs.tickers.length === 0) {
        throw makeBacktestValidationError([{ nodeId: prepared.id, field: 'tickers', message: 'No tickers found in this strategy.' }])
      }
      timings['2_inputCollection'] = performance.now() - inputStartTime

      // Phase 3: Data fetching (using batch API for 5-10x speedup)
      const fetchStartTime = performance.now()
      const decisionPrice: EvalCtx['decisionPrice'] = backtestMode === 'CC' || backtestMode === 'CO' ? 'close' : 'open'
      const limit = 20000
      const benchTicker = normalizeChoice(backtestBenchmark)
      const needsBench = benchTicker && benchTicker !== 'Empty' && !inputs.tickers.includes(benchTicker)
      const needsSpy = !inputs.tickers.includes('SPY') && benchTicker !== 'SPY'

      // Build list of all tickers to fetch (including benchmark and SPY if needed)
      const allTickersToFetch = [...inputs.tickers]
      if (needsBench && benchTicker) allTickersToFetch.push(benchTicker)
      if (needsSpy) allTickersToFetch.push('SPY')

      // Batch fetch all tickers at once (much faster than individual fetches)
      const batchResults = await fetchOhlcSeriesBatch(allTickersToFetch, limit)

      // Convert batch results to the expected format
      const loaded = inputs.tickers.map((t) => ({
        ticker: t,
        bars: batchResults.get(t) || [],
      }))

      // Extract benchmark and SPY data from batch results
      const benchBarsFromBatch = needsBench && benchTicker ? batchResults.get(benchTicker) || null : null
      const spyBarsFromBatch = needsSpy ? batchResults.get('SPY') || null : null

      timings['3_dataFetching'] = performance.now() - fetchStartTime
      console.log(`[Backtest] Fetched ${inputs.tickers.length} tickers in ${timings['3_dataFetching'].toFixed(1)}ms`)

      // Phase 4: Build price DB
      const dbBuildStartTime = performance.now()
      // Collect indicator tickers (for date intersection) vs position tickers (can start later)
      const indicatorTickers = collectIndicatorTickers(prepared, callChainsById)
      const positionTickers = collectPositionTickers(prepared, callChainsById)

      // Build price DB using only indicator tickers for date intersection
      // This allows position tickers with shorter history (like UVXY) to not limit the date range
      const db = buildPriceDb(loaded, indicatorTickers.length > 0 ? indicatorTickers : undefined)
      if (db.dates.length < 3) {
        throw makeBacktestValidationError([{ nodeId: prepared.id, field: 'data', message: 'Not enough overlapping price data to run a backtest.' }])
      }
      timings['4_dbBuild'] = performance.now() - dbBuildStartTime
      console.log(`[Backtest] Built price DB: ${db.dates.length} dates, ${Object.keys(db.close).length} tickers in ${timings['4_dbBuild'].toFixed(1)}ms`)

      // Phase 5: Setup before evaluation
      const setupStartTime = performance.now()
      const cache = emptyCache()
      const warnings: BacktestWarning[] = []
      const trace = createBacktestTraceCollector()

      // Get benchmark bars (either from main data or separately fetched)
      let benchBars: Array<{ time: UTCTimestamp; open: number; close: number; adjClose: number }> | null = null
      if (benchTicker && benchTicker !== 'Empty') {
        const already = loaded.find((x) => getSeriesKey(x.ticker) === benchTicker)
        if (already && already.bars.length > 0) {
          benchBars = already.bars
        } else if (benchBarsFromBatch && benchBarsFromBatch.length > 0) {
          benchBars = benchBarsFromBatch
        } else {
          warnings.push({
            time: db.dates[0],
            date: isoFromUtcSeconds(db.dates[0]),
            message: `Benchmark ${benchTicker} failed to load`,
          })
        }
      }

      const benchMap = new Map<number, { open: number; close: number; adjClose: number }>()
      if (benchBars) {
        for (const b of benchBars) benchMap.set(Number(b.time), { open: b.open, close: b.close, adjClose: b.adjClose })
      }

      // SPY data for Treynor Ratio (always uses SPY as systematic risk benchmark)
      let spyBars: Array<{ time: UTCTimestamp; open: number; close: number; adjClose: number }> | null = null
      if (benchTicker === 'SPY' && benchBars) {
        spyBars = benchBars
      } else {
        const alreadySpy = loaded.find((x) => getSeriesKey(x.ticker) === 'SPY')
        if (alreadySpy && alreadySpy.bars.length > 0) {
          spyBars = alreadySpy.bars
        } else if (spyBarsFromBatch && spyBarsFromBatch.length > 0) {
          spyBars = spyBarsFromBatch
        }
      }

      const spyMap = new Map<number, { open: number; close: number; adjClose: number }>()
      if (spyBars) {
        for (const b of spyBars) spyMap.set(Number(b.time), { open: b.open, close: b.close, adjClose: b.adjClose })
      }

      // Find first index where all position tickers have valid close prices
      // This prevents allocating to tickers before their data starts
      let firstValidPosIndex = 0
      if (positionTickers.length > 0) {
        for (let i = 0; i < db.dates.length; i++) {
          let allValid = true
          for (const ticker of positionTickers) {
            const t = getSeriesKey(ticker)
            const closeVal = db.close[t]?.[i]
            if (closeVal == null) {
              allValid = false
              break
            }
          }
          if (allValid) {
            firstValidPosIndex = i
            break
          }
        }
      }

      const allocationsAt: Allocation[] = Array.from({ length: db.dates.length }, () => ({}))
      const contributionsAt: PositionContribution[][] = Array.from({ length: db.dates.length }, () => [])
      const lookback = Math.max(0, Math.floor(Number(inputs.maxLookback || 0)))
      const baseLookbackIndex = decisionPrice === 'open' ? (lookback > 0 ? lookback + 1 : 0) : lookback
      // Start evaluation at the later of: lookback requirement OR first valid position ticker date
      const startEvalIndex = Math.max(baseLookbackIndex, firstValidPosIndex)

      // Check if we have enough data for the lookback period
      if (startEvalIndex >= db.dates.length) {
        const limitingInfo = db.limitingTicker
          ? ` ${db.limitingTicker} has only ${db.tickerCounts?.[db.limitingTicker] ?? 0} days of data and is limiting the overlap.`
          : ''
        throw new Error(
          `Not enough historical data: strategy requires ${lookback} days of lookback, ` +
            `but only ${db.dates.length} days of overlapping data available.${limitingInfo} ` +
            `Need at least ${startEvalIndex + 1} days.`
        )
      }

      const callNodeCache = new Map<string, FlowNode>()
      const resolveCallNode = (id: string) => {
        const chain = callChainsById.get(id)
        if (!chain) return null
        if (!callNodeCache.has(id)) {
          callNodeCache.set(id, normalizeNodeForBacktest(ensureSlots(cloneNode(chain.root))))
        }
        return callNodeCache.get(id) ?? null
      }
      timings['5_evalSetup'] = performance.now() - setupStartTime

      // Phase 6: Main evaluation loop (the core backtest)
      const evalLoopStartTime = performance.now()
      const numBarsToEval = db.dates.length - startEvalIndex
      for (let i = startEvalIndex; i < db.dates.length; i++) {
        const indicatorIndex = decisionPrice === 'open' ? i - 1 : i
        const ctx: EvalCtx = {
          db,
          cache,
          decisionIndex: i,
          indicatorIndex,
          decisionPrice,
          warnings,
          resolveCall: resolveCallNode,
          trace,
        }
        allocationsAt[i] = evaluateNode(ctx, compressedTree)
        contributionsAt[i] = tracePositionContributions(ctx, compressedTree)
      }
      timings['6_evalLoop'] = performance.now() - evalLoopStartTime
      const evalPerBar = numBarsToEval > 0 ? timings['6_evalLoop'] / numBarsToEval : 0
      console.log(`[Backtest] Evaluation loop: ${numBarsToEval} bars in ${timings['6_evalLoop'].toFixed(1)}ms (${evalPerBar.toFixed(3)}ms/bar)`)

      // Phase 7: Return calculation loop
      const returnCalcStartTime = performance.now()
      const startTradeIndex = startEvalIndex
      const startPointIndex = backtestMode === 'OC' ? Math.max(0, startTradeIndex - 1) : startTradeIndex
      const points: EquityPoint[] = [{ time: db.dates[startPointIndex], value: 1 }]
      const benchmarkPoints: EquityPoint[] = benchMap.size ? [{ time: db.dates[startPointIndex], value: 1 }] : []
      const spyBenchmarkPoints: EquityPoint[] = spyMap.size ? [{ time: db.dates[startPointIndex], value: 1 }] : []
      const drawdownPoints: EquityPoint[] = [{ time: db.dates[startPointIndex], value: 0 }]
      const markers: EquityMarker[] = []
      const allocations: BacktestAllocationRow[] = []
      const returns: number[] = []
      const days: BacktestDayRow[] = []

      let equity = 1
      let peak = 1
      let benchEquity = 1
      let spyEquity = 1
      const startEnd = backtestMode === 'OC' ? startTradeIndex : startTradeIndex + 1
      for (let end = startEnd; end < db.dates.length; end++) {
        let start = end - 1
        if (backtestMode === 'OC') start = end
        if (start < 0 || start >= db.dates.length) continue
        if (backtestMode === 'OC' && end === 0) continue

        const alloc = allocationsAt[start] || {}
        const prevAlloc = start - 1 >= 0 ? allocationsAt[start - 1] || {} : {}
        const turnover = turnoverFraction(prevAlloc, alloc)
        const cost = (Math.max(0, backtestCostBps) / 10000) * turnover

        let gross = 0
        for (const [ticker, w] of Object.entries(alloc)) {
          if (!(w > 0)) continue
          const t = getSeriesKey(ticker)
          const openArr = db.open[t]
          const closeArr = db.close[t]
          const adjCloseArr = db.adjClose[t]
          const entry =
            backtestMode === 'OO'
              ? openArr?.[start]
              : backtestMode === 'CC'
                ? adjCloseArr?.[start]  // Use adjClose for dividend-adjusted returns
                : backtestMode === 'CO'
                  ? closeArr?.[start]
                  : openArr?.[start]
          const exit =
            backtestMode === 'OO'
              ? openArr?.[end]
              : backtestMode === 'CC'
                ? adjCloseArr?.[end]  // Use adjClose for dividend-adjusted returns
                : backtestMode === 'CO'
                  ? openArr?.[end]
                  : closeArr?.[start]
          if (entry == null || exit == null || !(entry > 0) || !(exit > 0)) {
            const date = isoFromUtcSeconds(db.dates[end])
            warnings.push({ time: db.dates[end], date, message: `Broken ticker ${t} on ${date} (missing price). Return forced to 0.` })
            markers.push({ time: db.dates[end], text: `Missing ${t}` })
            continue
          }
          gross += w * (exit / entry - 1)
        }

        if (!Number.isFinite(gross)) {
          const date = isoFromUtcSeconds(db.dates[end])
          warnings.push({ time: db.dates[end], date, message: `Non-finite gross return on ${date}. Return forced to 0.` })
          markers.push({ time: db.dates[end], text: 'Bad gross' })
          gross = 0
        }

        let net = gross - cost
        if (!Number.isFinite(net) || net < -0.9999) {
          const date = isoFromUtcSeconds(db.dates[end])
          warnings.push({ time: db.dates[end], date, message: `Non-finite net return on ${date}. Return forced to 0.` })
          markers.push({ time: db.dates[end], text: 'Bad net' })
          net = 0
        }
        equity *= 1 + net
        if (equity > peak) peak = equity
        const ddRaw = peak > 0 && Number.isFinite(equity) ? equity / peak - 1 : 0
        const dd = Math.min(0, Math.max(-0.9999, ddRaw))
        points.push({ time: db.dates[end], value: equity })
        drawdownPoints.push({ time: db.dates[end], value: dd })
        returns.push(net)

        // Show decision date (when you buy at close), matching QuantMage convention
        // In CC mode: start is the decision day, end is when we measure the return
        allocations.push({
          date: mdyFromUtcSeconds(db.dates[start]),
          entries: allocEntries(alloc),
        })

        if (benchMap.size) {
          const startTime = Number(db.dates[start])
          const endTime = Number(db.dates[end])
          const startBar = benchMap.get(startTime)
          const endBar = benchMap.get(endTime)
          const entryBench =
            backtestMode === 'OO'
              ? startBar?.open
              : backtestMode === 'CC'
                ? startBar?.adjClose  // Use adjClose for dividend-adjusted benchmark
                : backtestMode === 'CO'
                  ? startBar?.close
                  : startBar?.open
          const exitBench =
            backtestMode === 'OO'
              ? endBar?.open
              : backtestMode === 'CC'
                ? endBar?.adjClose  // Use adjClose for dividend-adjusted benchmark
                : backtestMode === 'CO'
                  ? endBar?.open
                  : startBar?.close
          if (entryBench != null && exitBench != null && entryBench > 0 && exitBench > 0) {
            benchEquity *= 1 + (exitBench / entryBench - 1)
            benchmarkPoints.push({ time: db.dates[end], value: benchEquity })
          } else {
            benchmarkPoints.push({ time: db.dates[end], value: benchEquity })
          }
        }

        // SPY tracking for Treynor Ratio calculation
        if (spyMap.size) {
          const startTime = Number(db.dates[start])
          const endTime = Number(db.dates[end])
          const startBar = spyMap.get(startTime)
          const endBar = spyMap.get(endTime)
          const entrySpy =
            backtestMode === 'OO'
              ? startBar?.open
              : backtestMode === 'CC'
                ? startBar?.adjClose  // Use adjClose for dividend-adjusted benchmark
                : backtestMode === 'CO'
                  ? startBar?.close
                  : startBar?.open
          const exitSpy =
            backtestMode === 'OO'
              ? endBar?.open
              : backtestMode === 'CC'
                ? endBar?.adjClose  // Use adjClose for dividend-adjusted benchmark
                : backtestMode === 'CO'
                  ? endBar?.open
                  : startBar?.close
          if (entrySpy != null && exitSpy != null && entrySpy > 0 && exitSpy > 0) {
            spyEquity *= 1 + (exitSpy / entrySpy - 1)
            spyBenchmarkPoints.push({ time: db.dates[end], value: spyEquity })
          } else {
            spyBenchmarkPoints.push({ time: db.dates[end], value: spyEquity })
          }
        }

        days.push({
          time: db.dates[end],
          date: isoFromUtcSeconds(db.dates[end]),
          equity,
          drawdown: dd,
          grossReturn: gross,
          netReturn: net,
          turnover,
          cost,
          holdings: allocEntries(alloc),
          endNodes: contributionsAt[start] || [],
        })
      }

      timings['7_returnCalc'] = performance.now() - returnCalcStartTime

      // Phase 8: Compute metrics
      const metricsStartTime = performance.now()
      const metrics = computeBacktestSummary(points, days.map((d) => d.drawdown), days, spyBenchmarkPoints.length > 0 ? spyBenchmarkPoints : undefined)
      const monthly = computeMonthlyReturns(days)
      timings['8_metrics'] = performance.now() - metricsStartTime

      // Total time
      const totalTime = performance.now() - backtestStartTime
      timings['total'] = totalTime

      // Print timing summary
      console.log(`[Backtest] ═══════════════════════════════════════════════════════`)
      console.log(`[Backtest] TIMING SUMMARY (${compressionStats.compressedNodes} nodes, ${numBarsToEval} bars):`)
      console.log(`[Backtest]   1. Preparation & Compression: ${timings['1_preparation'].toFixed(1)}ms`)
      console.log(`[Backtest]   2. Input Collection:          ${timings['2_inputCollection'].toFixed(1)}ms`)
      console.log(`[Backtest]   3. Data Fetching:             ${timings['3_dataFetching'].toFixed(1)}ms`)
      console.log(`[Backtest]   4. Price DB Build:            ${timings['4_dbBuild'].toFixed(1)}ms`)
      console.log(`[Backtest]   5. Evaluation Setup:          ${timings['5_evalSetup'].toFixed(1)}ms`)
      console.log(`[Backtest]   6. Evaluation Loop:           ${timings['6_evalLoop'].toFixed(1)}ms (${evalPerBar.toFixed(3)}ms/bar)`)
      console.log(`[Backtest]   7. Return Calculation:        ${timings['7_returnCalc'].toFixed(1)}ms`)
      console.log(`[Backtest]   8. Metrics Computation:       ${timings['8_metrics'].toFixed(1)}ms`)
      console.log(`[Backtest] ───────────────────────────────────────────────────────`)
      console.log(`[Backtest]   TOTAL:                        ${totalTime.toFixed(1)}ms (${(totalTime/1000).toFixed(2)}s)`)
      console.log(`[Backtest] ═══════════════════════════════════════════════════════`)

      return {
        result: {
          points,
          benchmarkPoints: benchmarkPoints.length ? benchmarkPoints : undefined,
          drawdownPoints,
          markers,
          metrics,
          days,
          allocations,
          warnings,
          monthly,
          trace: trace.toResult(),
        },
      }
    },
    [backtestMode, backtestBenchmark, backtestCostBps, callChainsById],
  )

  const handleRunBacktest = useCallback(async () => {
    updateActiveBotBacktest({ status: 'running', focusNodeId: null, result: null, errors: [] })
    try {
      const { result } = await runBacktestForNode(current)
      updateActiveBotBacktest({ result, status: 'done' })
    } catch (e) {
      if (isBacktestValidationError(e)) {
        updateActiveBotBacktest({ errors: e.errors, status: 'error' })
      } else {
        const msg = String((e as Error)?.message || e)
        const friendly = msg.includes('Failed to fetch') ? `${msg}. Is the backend running? (npm run api)` : msg
        updateActiveBotBacktest({ errors: [{ nodeId: current.id, field: 'backtest', message: friendly }], status: 'error' })
      }
    }
  }, [current, runBacktestForNode, updateActiveBotBacktest])
  const handleNewBot = () => {
    const bot = createBotSession('Algo Name Here')
    setBots((prev) => [...prev, bot])
    setActiveBotId(bot.id)
    setClipboard(null)
    setCopiedNodeId(null)
  }

  const handleDuplicateBot = useCallback((botId: string) => {
    const sourceBotSession = bots.find(b => b.id === botId)
    if (!sourceBotSession) return
    const sourceRoot = sourceBotSession.history[sourceBotSession.historyIndex] ?? sourceBotSession.history[0]
    if (!sourceRoot) return
    const clonedRoot = cloneNode(sourceRoot)
    clonedRoot.title = `${sourceRoot.title || 'Untitled'} (Copy)`
    const newBot: BotSession = {
      id: `bot-${newId()}`,
      history: [clonedRoot],
      historyIndex: 0,
      backtest: { status: 'idle', errors: [], result: null, focusNodeId: null },
      callChains: sourceBotSession.callChains.map(cc => ({ ...cc, id: `call-${newId()}` })), // Clone call chains with new IDs
    }
    setBots((prev) => [...prev, newBot])
    setActiveBotId(newBot.id)
    setClipboard(null)
    setCopiedNodeId(null)
  }, [bots])

  const handleExport = useCallback(() => {
    if (!current) return
    const json = JSON.stringify(current) // Minified for smaller file size
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const name = (current.title || 'algo').replace(/\s+/g, '_')
    a.href = url
    a.download = `${name}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }, [current])

  // Export a specific bot by ID (for admin panel)
  const handleExportBot = useCallback(async (botId: string) => {
    try {
      const res = await fetch(`${API_BASE}/bots/${botId}?userId=${userId}`)
      if (!res.ok) throw new Error('Failed to fetch bot')
      const { bot } = await res.json()
      if (!bot) throw new Error('Bot not found')
      const json = JSON.stringify(bot, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${(bot.name || 'bot').replace(/\s+/g, '_')}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('Export failed:', e)
      alert('Failed to export bot: ' + String((e as Error)?.message || e))
    }
  }, [userId])

  // Open a specific bot by ID in the Model tab
  const handleOpenBot = useCallback(async (botId: string) => {
    try {
      const res = await fetch(`${API_BASE}/bots/${botId}?userId=${userId}`)
      if (!res.ok) throw new Error('Failed to fetch bot')
      const { bot } = await res.json()
      if (!bot || !bot.payload) throw new Error('Bot payload not available (IP protected)')
      // Parse payload if it's a string
      const payload = typeof bot.payload === 'string' ? JSON.parse(bot.payload) : bot.payload
      // Parse callChains if it's a string
      const loadedCallChains: CallChain[] = typeof bot.callChains === 'string'
        ? JSON.parse(bot.callChains)
        : (bot.callChains || [])
      // Update the active bot with the loaded flowchart and callChains
      setBots((prev) =>
        prev.map((b) => {
          if (b.id !== activeBotId) return b
          const trimmed = b.history.slice(0, b.historyIndex + 1)
          trimmed.push(ensureSlots(payload))
          return {
            ...b,
            history: trimmed,
            historyIndex: trimmed.length - 1,
            savedBotId: botId, // Link to the saved bot
            callChains: loadedCallChains,
          }
        }),
      )
      setTab('Model')
    } catch (e) {
      console.error('Open failed:', e)
      alert('Failed to open bot: ' + String((e as Error)?.message || e))
    }
  }, [userId, activeBotId])

  const resolveWatchlistId = useCallback(
    (watchlistNameOrId: string): string => {
      const raw = String(watchlistNameOrId || '').trim()
      if (!raw) return watchlists.find((w) => w.name === 'Default')?.id ?? watchlists[0]?.id ?? `wl-${newId()}`
      const byId = watchlists.find((w) => w.id === raw)
      if (byId) return byId.id
      const byName = watchlists.find((w) => w.name.toLowerCase() === raw.toLowerCase())
      if (byName) return byName.id
      // Create new watchlist with temporary local ID
      const tempId = `wl-${newId()}`
      setWatchlists((prev) => ensureDefaultWatchlist([{ id: tempId, name: raw, botIds: [] }, ...prev]))
      // Create in database asynchronously (will use different ID, but local state works for now)
      if (userId) {
        createWatchlistInApi(userId, raw).then(serverId => {
          if (serverId && serverId !== tempId) {
            // Update local state with server-assigned ID
            setWatchlists((prev) => prev.map(w => w.id === tempId ? { ...w, id: serverId } : w))
          }
        }).catch(err => console.warn('[API] Failed to create watchlist:', err))
      }
      return tempId
    },
    [watchlists, userId],
  )

  const addBotToWatchlist = useCallback((botId: string, watchlistId: string) => {
    // Update local state immediately for responsive UI
    setWatchlists((prev) =>
      prev.map((w) => {
        if (w.id !== watchlistId) return w
        if (w.botIds.includes(botId)) return w
        return { ...w, botIds: [...w.botIds, botId] }
      }),
    )
    // Sync to database in background
    addBotToWatchlistInApi(watchlistId, botId).catch(err =>
      console.warn('[API] Failed to add bot to watchlist:', err)
    )
  }, [])

  const removeBotFromWatchlist = useCallback(async (botId: string, watchlistId: string): Promise<void> => {
    // Update local state immediately for responsive UI
    setWatchlists((prev) =>
      prev.map((w) => (w.id === watchlistId ? { ...w, botIds: w.botIds.filter((id) => id !== botId) } : w)),
    )
    // Sync to database in background
    try {
      await removeBotFromWatchlistInApi(watchlistId, botId)
    } catch (err) {
      console.warn('[API] Failed to remove bot from watchlist:', err)
    }
  }, [])

  const activeSavedBotId = activeBot?.savedBotId

  // Compute ETFs Only tag for a bot payload
  const computeEtfsOnlyTag = useCallback((payload: FlowNode, existingTags: string[]): string[] => {
    const isEtfOnly = isEtfsOnlyBot(payload, callChainsById, tickerMetadata)
    const hasTag = existingTags.includes('ETFs Only')

    if (isEtfOnly && !hasTag) {
      return [...existingTags, 'ETFs Only']
    } else if (!isEtfOnly && hasTag) {
      return existingTags.filter(t => t !== 'ETFs Only')
    }
    return existingTags
  }, [callChainsById, tickerMetadata])

  const handleSaveToWatchlist = useCallback(
    async (watchlistNameOrId: string) => {
      if (!current) return
      if (!userId) return
      const watchlistId = resolveWatchlistId(watchlistNameOrId)
      const payload = ensureSlots(cloneNode(current))
      const now = Date.now()

      let savedBotId = activeSavedBotId

      if (!savedBotId) {
        // Create new bot - save to API first
        savedBotId = `saved-${newId()}`
        // Admin bots get 'Atlas Eligible' tag by default, others get 'Private'
        const defaultTags = isAdmin ? ['Private', 'Atlas Eligible'] : ['Private']
        // Auto-tag with "ETFs Only" if all positions are ETFs
        const tagsWithEtf = computeEtfsOnlyTag(payload, defaultTags)
        const entry: SavedBot = {
          id: savedBotId,
          name: current.title || 'Algo',
          builderId: userId,
          payload,
          callChains: activeBot?.callChains || [],
          visibility: 'private',
          createdAt: now,
          tags: tagsWithEtf,
          backtestMode,
          backtestCostBps,
        }
        // Save to API first (database is source of truth)
        const createdId = await createBotInApi(userId, entry)
        if (createdId) {
          savedBotId = createdId // Use server-assigned ID if different
          entry.id = createdId
        }
        setSavedBots((prev) => [entry, ...prev])
        setBots((prev) => prev.map((b) => (b.id === activeBotId ? { ...b, savedBotId } : b)))
      } else {
        // Update existing bot - save to API first
        const existingBot = savedBots.find((b) => b.id === savedBotId)
        // Auto-update "ETFs Only" tag based on current positions
        const existingTags = existingBot?.tags || []
        const tagsWithEtf = computeEtfsOnlyTag(payload, existingTags)
        const updatedBot: SavedBot = {
          ...(existingBot || { id: savedBotId, createdAt: now, visibility: 'private' as const }),
          payload,
          callChains: activeBot?.callChains || [],
          name: current.title || existingBot?.name || 'Algo',
          builderId: existingBot?.builderId ?? userId,
          tags: tagsWithEtf,
          backtestMode,
          backtestCostBps,
        }
        // Save to API first
        await updateBotInApi(userId, updatedBot)
        setSavedBots((prev) =>
          prev.map((b) =>
            b.id === savedBotId
              ? updatedBot
              : b,
          ),
        )
      }

      addBotToWatchlist(savedBotId, watchlistId)
      setSaveMenuOpen(false)
      setSaveNewWatchlistName('')
      if (savedBotId) {
        setAnalyzeBacktests((prev) => ({ ...prev, [savedBotId]: { status: 'idle' } }))
      }
      // Show visual feedback
      setJustSavedFeedback(true)
      setTimeout(() => setJustSavedFeedback(false), 1500)
    },
    [current, activeBotId, activeSavedBotId, activeBot, resolveWatchlistId, addBotToWatchlist, userId, savedBots, backtestMode, backtestCostBps, computeEtfsOnlyTag],
  )

  const runAnalyzeBacktest = useCallback(
    async (bot: SavedBot, forceRefresh = false) => {
      setAnalyzeBacktests((prev) => {
        if (prev[bot.id]?.status === 'loading') return prev
        return { ...prev, [bot.id]: { status: 'loading' } }
      })

      // FRD-014: Always try server-side cached backtest first
      // This uses the backtest cache for instant results on repeated requests
      // Pass forceRefresh=true to bypass cache and recalculate
      try {
        const res = await fetch(`${API_BASE}/bots/${bot.id}/run-backtest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: bot.backtestMode || 'CC', costBps: bot.backtestCostBps ?? 5, forceRefresh }),
        })

        if (res.ok) {
          const { metrics, equityCurve, benchmarkCurve, allocations: serverAllocations, cached: wasCached, compression } = await res.json() as {
            metrics: {
              cagr: number
              maxDrawdown: number
              calmarRatio: number
              sharpeRatio: number
              sortinoRatio: number
              treynorRatio?: number
              beta?: number
              volatility: number
              winRate?: number
              avgTurnover?: number
              avgHoldings?: number
              bestDay?: number
              worstDay?: number
              tradingDays: number
            }
            equityCurve?: { date: string; equity: number }[]
            benchmarkCurve?: { date: string; equity: number }[]
            allocations?: { date: string; alloc: Record<string, number> }[]
            cached?: boolean
            compression?: {
              originalNodes: number
              compressedNodes: number
              nodesRemoved: number
              gatesMerged: number
              compressionTimeMs: number
            }
          }

          if (wasCached) {
            console.log(`[Backtest] Cache hit for ${bot.name}`)
          } else if (compression) {
            console.log(`[Backtest] Tree compression: ${compression.originalNodes} → ${compression.compressedNodes} nodes (${compression.nodesRemoved} removed, ${compression.gatesMerged} gates merged) in ${compression.compressionTimeMs}ms`)
          }

          // Convert equity curve from server format to frontend format
          // Convert date strings to Unix timestamps (seconds) for Lightweight Charts
          const safeParseDate = (dateStr: string | undefined): number => {
            if (!dateStr) return 0
            const d = new Date(dateStr)
            const t = d.getTime()
            return Number.isFinite(t) ? t / 1000 : 0
          }
          const points: EquityPoint[] = (equityCurve || [])
            .filter((p) => p.date && !isNaN(new Date(p.date).getTime()))
            .map((p) => ({
              time: safeParseDate(p.date) as UTCTimestamp,
              value: p.equity,
            }))
          // Convert benchmark curve (SPY) to frontend format
          const benchmarkPoints: EquityPoint[] = (benchmarkCurve || [])
            .filter((p) => p.date && !isNaN(new Date(p.date).getTime()))
            .map((p) => ({
              time: safeParseDate(p.date) as UTCTimestamp,
              value: p.equity,
            }))
          // Compute drawdown points from equity curve
          let peak = 1
          const drawdownPoints: EquityPoint[] = points.map((p) => {
            if (p.value > peak) peak = p.value
            const dd = (p.value - peak) / peak
            return { time: p.time, value: dd }
          })
          const startDate = equityCurve?.[0]?.date || ''
          const endDate = equityCurve?.[equityCurve.length - 1]?.date || ''
          const totalReturn = points.length > 0 ? points[points.length - 1].value - 1 : 0
          const years = metrics.tradingDays / 252

          // Convert server allocations to frontend format
          const allocations: BacktestAllocationRow[] = (serverAllocations || []).map((a) => ({
            date: a.date,
            entries: Object.entries(a.alloc)
              .filter(([, w]) => w > 0)
              .map(([ticker, weight]) => ({ ticker, weight })),
          }))

          // Build days array from allocations for ticker stats table
          const days: BacktestDayRow[] = allocations.map((a, i) => ({
            time: safeParseDate(a.date) as UTCTimestamp,
            date: a.date,
            equity: points[i]?.value ?? 1,
            drawdown: drawdownPoints[i]?.value ?? 0,
            grossReturn: 0,
            netReturn: 0,
            turnover: 0,
            cost: 0,
            holdings: a.entries.map((e) => ({ ticker: e.ticker, weight: e.weight })),
          }))

          const result: BacktestResult = {
            points,
            benchmarkPoints,
            drawdownPoints,
            markers: [],
            metrics: {
              startDate,
              endDate,
              days: metrics.tradingDays,
              years,
              totalReturn,
              cagr: metrics.cagr,
              maxDrawdown: metrics.maxDrawdown,
              calmar: metrics.calmarRatio,
              sharpe: metrics.sharpeRatio,
              sortino: metrics.sortinoRatio,
              vol: metrics.volatility,
              treynor: metrics.treynorRatio ?? 0,
              beta: metrics.beta ?? 0,
              winRate: metrics.winRate ?? 0,
              bestDay: metrics.bestDay ?? 0,
              worstDay: metrics.worstDay ?? 0,
              avgTurnover: metrics.avgTurnover ?? 0,
              avgHoldings: metrics.avgHoldings ?? 0,
            },
            days,
            allocations,
            warnings: [],
            monthly: [],
          }

          setAnalyzeBacktests((prev) => ({
            ...prev,
            [bot.id]: { status: 'done', result },
          }))

          // Auto eligibility tagging (for all logged-in users)
          if (userId && result?.metrics) {
          console.log('[Eligibility] Checking bot:', bot.name, 'userId:', userId, 'isAdmin:', isAdmin)
          try {
            // Fetch eligibility requirements
            const eligRes = await fetch('/api/admin/eligibility')
            console.log('[Eligibility] Fetch status:', eligRes.status)
            if (eligRes.ok) {
              const { eligibilityRequirements } = await eligRes.json() as { eligibilityRequirements: EligibilityRequirement[] }
              console.log('[Eligibility] Requirements:', eligibilityRequirements)

              // Check if bot is already in a Fund zone
              const isInFundZone = Object.values(uiState.fundZones).includes(bot.id)
              console.log('[Eligibility] isInFundZone:', isInFundZone)

              // Check live months requirement
              const liveMonthsReq = eligibilityRequirements.find(r => r.type === 'live_months')
              const botAgeMonths = (Date.now() - bot.createdAt) / (1000 * 60 * 60 * 24 * 30)
              const passesLiveMonths = !liveMonthsReq || botAgeMonths >= liveMonthsReq.value
              console.log('[Eligibility] passesLiveMonths:', passesLiveMonths)

              // Check metric requirements
              // Metrics stored as decimals but entered/displayed as percentages
              const percentMetrics = ['cagr', 'maxDrawdown', 'vol', 'winRate', 'avgTurnover']
              const metricReqs = eligibilityRequirements.filter(r => r.type === 'metric')
              const passesMetrics = metricReqs.every(req => {
                const metricValue = result.metrics[req.metric as keyof typeof result.metrics]
                console.log('[Eligibility] Checking metric:', req.metric, 'value:', metricValue, 'reqValue:', req.value, 'compareValue:', percentMetrics.includes(req.metric || '') ? req.value / 100 : req.value)
                if (typeof metricValue !== 'number' || !Number.isFinite(metricValue)) return false
                // Convert requirement value to decimal for percent-based metrics
                const compareValue = percentMetrics.includes(req.metric || '') ? req.value / 100 : req.value
                const passes = req.comparison === 'at_least' ? metricValue >= compareValue : req.comparison === 'at_most' ? metricValue <= compareValue : true
                console.log('[Eligibility] Metric passes:', passes)
                if (req.comparison === 'at_least') return metricValue >= compareValue
                if (req.comparison === 'at_most') return metricValue <= compareValue
                return true
              })

              const passesAll = passesLiveMonths && passesMetrics
              console.log('[Eligibility] passesAll:', passesAll)

              // Detect stale fund zone reference (bot in zone but missing Nexus tag)
              const botTags = savedBots.find(b => b.id === bot.id)?.tags || []
              const hasNexusTag = botTags.includes('Nexus')
              const isStaleRef = isInFundZone && !hasNexusTag
              if (isStaleRef) {
                // Clear the stale fund zone reference
                setUiState(prev => {
                  const newFundZones = { ...prev.fundZones }
                  for (const key of Object.keys(newFundZones) as (keyof FundZones)[]) {
                    if (newFundZones[key] === bot.id) {
                      newFundZones[key] = null
                    }
                  }
                  return { ...prev, fundZones: newFundZones }
                })
              }

              console.log('[Eligibility] About to update tags, passesAll:', passesAll, 'isInFundZone:', isInFundZone, 'isStaleRef:', isStaleRef)
              let updatedBotForSync: SavedBot | null = null
              setSavedBots(prev => prev.map(b => {
                if (b.id !== bot.id) return b
                const currentTags = b.tags || []
                const hasNexus = currentTags.includes('Nexus')
                const hasNexusEligible = currentTags.includes('Nexus Eligible')
                const hasPrivate = currentTags.includes('Private')
                console.log('[Eligibility] Bot found, currentTags:', currentTags, 'hasNexus:', hasNexus, 'hasNexusEligible:', hasNexusEligible)

                if (passesAll) {
                  console.log('[Eligibility] passesAll=true, checking add condition...')
                  // If passes and not in fund zone (or stale ref), add Nexus Eligible alongside Private
                  if ((!isInFundZone || isStaleRef) && !hasNexus && !hasNexusEligible) {
                    console.log('[Eligibility] ADDING Nexus Eligible tag!')
                    // Ensure Private tag exists, add Nexus Eligible
                    const baseTags = currentTags.filter(t => t !== 'Nexus' && t !== 'Atlas')
                    const newTags = hasPrivate ? [...baseTags, 'Nexus Eligible'] : ['Private', ...baseTags, 'Nexus Eligible']
                    updatedBotForSync = { ...b, tags: newTags }
                    return updatedBotForSync
                  }
                  console.log('[Eligibility] Condition not met')
                } else {
                  // If fails, remove Nexus Eligible; if was Nexus, demote to Private
                  if (hasNexus || hasNexusEligible) {
                    // Remove Nexus and Nexus Eligible, ensure Private exists
                    const baseTags = currentTags.filter(t => t !== 'Nexus' && t !== 'Nexus Eligible' && t !== 'Private' && t !== 'Atlas')
                    const newTags = ['Private', ...baseTags]
                    console.log('[Eligibility] Removing Nexus tags, new tags:', newTags)
                    updatedBotForSync = { ...b, tags: newTags }
                    return updatedBotForSync
                  }
                }
                return b
              }))
              // Sync tag changes to API
              if (updatedBotForSync && userId) {
                updateBotInApi(userId, updatedBotForSync).catch(err => console.warn('[API] Failed to sync bot tags:', err))
              }
            }
          } catch (eligErr) {
            console.warn('Failed to check eligibility:', eligErr)
          }
        }

          // Sync metrics to database for Nexus bots (scalable cross-user visibility)
          if (result?.metrics && bot.tags?.includes('Nexus')) {
            syncBotMetricsToApi(bot.id, {
              cagr: result.metrics.cagr,
              maxDrawdown: result.metrics.maxDrawdown,
              calmarRatio: result.metrics.calmar,
              sharpeRatio: result.metrics.sharpe,
              sortinoRatio: result.metrics.sortino,
              treynorRatio: result.metrics.treynor,
              volatility: result.metrics.vol,
              winRate: result.metrics.winRate,
              avgTurnover: result.metrics.avgTurnover,
              avgHoldings: result.metrics.avgHoldings,
              tradingDays: result.metrics.days,
            }).catch((err) => console.warn('[API] Failed to sync metrics:', err))
          }

          return // Success - exit early
        }

        // Server returned error - show error message
        const errorData = await res.json().catch(() => ({ error: 'Server backtest failed' }))
        setAnalyzeBacktests((prev) => ({
          ...prev,
          [bot.id]: { status: 'error', error: errorData.error || 'Failed to run backtest' },
        }))
      } catch (err) {
        let message = String((err as Error)?.message || err)
        if (isBacktestValidationError(err)) {
          message = err.errors.map((e: BacktestError) => e.message).join(', ')
        }
        setAnalyzeBacktests((prev) => ({ ...prev, [bot.id]: { status: 'error', error: message } }))
      }
    },
    [runBacktestForNode, userId, uiState.fundZones, backtestMode, backtestCostBps],
  )

  const runSanityReport = useCallback(
    async (bot: SavedBot) => {
      setSanityReports((prev) => {
        if (prev[bot.id]?.status === 'loading') return prev
        return { ...prev, [bot.id]: { status: 'loading' } }
      })

      try {
        const res = await fetch(`${API_BASE}/bots/${bot.id}/sanity-report`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: bot.backtestMode || 'CC', costBps: bot.backtestCostBps ?? 5 }),
        })

        if (res.ok) {
          const data = await res.json() as { success: boolean; report: SanityReport; cached: boolean; cachedAt?: number }
          setSanityReports((prev) => ({
            ...prev,
            [bot.id]: { status: 'done', report: data.report },
          }))
          return
        }

        const errorData = await res.json().catch(() => ({ error: 'Server sanity report failed' }))
        setSanityReports((prev) => ({
          ...prev,
          [bot.id]: { status: 'error', error: errorData.error || 'Failed to generate sanity report' },
        }))
      } catch (err) {
        const message = String((err as Error)?.message || err)
        setSanityReports((prev) => ({ ...prev, [bot.id]: { status: 'error', error: message } }))
      }
    },
    [backtestMode, backtestCostBps],
  )

  // Fetch benchmark metrics (called from Advanced tab Run button)
  const fetchBenchmarkMetrics = useCallback(async () => {
    if (benchmarkMetrics.status === 'loading') return // Already loading

    setBenchmarkMetrics({ status: 'loading' })

    try {
      const res = await fetch(`${API_BASE}/benchmarks/metrics`)
      if (res.ok) {
        const data = await res.json() as { success: boolean; benchmarks: Record<string, ComparisonMetrics>; errors?: string[] }
        setBenchmarkMetrics({ status: 'done', data: data.benchmarks })
      } else {
        const errorData = await res.json().catch(() => ({ error: 'Failed to fetch benchmarks' }))
        setBenchmarkMetrics({ status: 'error', error: errorData.error || 'Failed to fetch benchmark metrics' })
      }
    } catch (err) {
      const message = String((err as Error)?.message || err)
      setBenchmarkMetrics({ status: 'error', error: message })
    }
  }, [benchmarkMetrics.status])

  // Run robustness analysis for the Model tab (works with saved or unsaved strategies)
  const runModelRobustness = useCallback(async () => {
    const savedBotId = activeBot?.savedBotId

    setModelSanityReport({ status: 'loading' })

    try {
      let res: Response

      if (savedBotId) {
        // Use saved bot endpoint (cached)
        res = await fetch(`${API_BASE}/bots/${savedBotId}/sanity-report`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: backtestMode, costBps: backtestCostBps }),
        })
      } else {
        // Use direct payload endpoint for unsaved strategies
        // Send the current tree as the payload (same format as saved bots)
        const payload = JSON.stringify(ensureSlots(cloneNode(current)))
        res = await fetch(`${API_BASE}/sanity-report`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payload, mode: backtestMode, costBps: backtestCostBps }),
        })
      }

      if (res.ok) {
        const data = await res.json() as { success: boolean; report: SanityReport; cached: boolean; cachedAt?: number }
        setModelSanityReport({ status: 'done', report: data.report })
      } else {
        const errorData = await res.json().catch(() => ({ error: 'Server sanity report failed' }))
        setModelSanityReport({ status: 'error', error: errorData.error || 'Failed to generate sanity report' })
      }
    } catch (err) {
      const message = String((err as Error)?.message || err)
      setModelSanityReport({ status: 'error', error: message })
    }
  }, [activeBot?.savedBotId, current, callChains, backtestMode, backtestCostBps])

  const runAnalyzeTickerContribution = useCallback(
    async (key: string, ticker: string, botResult: BacktestResult) => {
      setAnalyzeTickerContrib((prev) => {
        if (prev[key]?.status === 'loading') return prev
        return { ...prev, [key]: { status: 'loading' } }
      })
      try {
        const bars = await fetchOhlcSeries(ticker, 20000)
        const barMap = new Map<number, { open: number; close: number; adjClose: number }>()
        for (const b of bars) barMap.set(Number(b.time), { open: Number(b.open), close: Number(b.close), adjClose: Number(b.adjClose) })

        const days = botResult.days || []
        const points = botResult.points || []
        let cumulative = 0
        let winCount = 0
        let lossCount = 0
        let sumWins = 0
        let sumLossAbs = 0

        for (let i = 0; i < days.length; i++) {
          const day = days[i]
          const prevBotEquity = i === 0 ? 1 : days[i - 1]?.equity ?? 1
          const weight = day.holdings?.find((h) => normalizeChoice(h.ticker) === normalizeChoice(ticker))?.weight ?? 0
          if (!(Number.isFinite(weight) && weight > 0)) {
            continue
          }

          const endTime = day.time
          const prevTime = points[i]?.time ?? endTime
          const startBar = barMap.get(Number(prevTime))
          const endBar = barMap.get(Number(endTime))
          const entry =
            backtestMode === 'OC'
              ? endBar?.open
              : backtestMode === 'OO'
                ? startBar?.open
                : backtestMode === 'CC'
                  ? startBar?.adjClose  // CC mode: use adjClose for dividend-adjusted returns
                  : backtestMode === 'CO'
                    ? startBar?.close
                    : startBar?.open
          const exit =
            backtestMode === 'OC'
              ? endBar?.close
              : backtestMode === 'OO'
                ? endBar?.open
                : backtestMode === 'CC'
                  ? endBar?.adjClose  // CC mode: use adjClose for dividend-adjusted returns
                  : backtestMode === 'CO'
                    ? endBar?.open
                    : endBar?.close
          if (entry == null || exit == null || !(entry > 0) || !(exit > 0)) {
            continue
          }

          const r = exit / entry - 1
          const investedWeight = (day.holdings || []).reduce((sum, h) => {
            const t = normalizeChoice(h.ticker)
            if (t === 'CASH' || t === 'Empty') return sum
            const w = Number(h.weight || 0)
            return sum + (Number.isFinite(w) ? w : 0)
          }, 0)
          const costShare = investedWeight > 0 ? (day.cost || 0) * (weight / investedWeight) : 0
          const contribPct = weight * r - costShare

          if (contribPct > 0) {
            winCount += 1
            sumWins += contribPct
          } else if (contribPct < 0) {
            lossCount += 1
            sumLossAbs += Math.abs(contribPct)
          }

          const dailyDollar = prevBotEquity * contribPct
          if (Number.isFinite(dailyDollar)) cumulative += dailyDollar
        }

        const botTotal = days.length ? (days[days.length - 1].equity ?? 1) - 1 : 0
        const returnPct = botTotal !== 0 ? cumulative / botTotal : 0
        const totalCount = winCount + lossCount
        const winRate = totalCount > 0 ? winCount / totalCount : 0
        const lossRate = totalCount > 0 ? lossCount / totalCount : 0
        const avgWin = winCount > 0 ? sumWins / winCount : 0
        const avgLoss = lossCount > 0 ? sumLossAbs / lossCount : 0
        const expectancy = winRate * avgWin - lossRate * avgLoss
        setAnalyzeTickerContrib((prev) => ({ ...prev, [key]: { status: 'done', returnPct, expectancy } }))
      } catch (err) {
        const message = String((err as Error)?.message || err)
        setAnalyzeTickerContrib((prev) => ({ ...prev, [key]: { status: 'error', error: message } }))
      }
    },
    [backtestMode],
  )

  useEffect(() => {
    savedBots.forEach((bot) => {
      if (uiState.analyzeCollapsedByBotId[bot.id] === false) {
        // Auto-run backtest when card is expanded
        const state = analyzeBacktests[bot.id]
        if (!state || state.status === 'idle' || state.status === 'error') {
          runAnalyzeBacktest(bot)
        }
        // Also auto-fetch sanity report (MC/KF) when card is expanded
        const sanityState = sanityReports[bot.id]
        if (!sanityState || sanityState.status === 'idle' || sanityState.status === 'error') {
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
      if (uiState.analyzeCollapsedByBotId[bot.id] !== false) continue
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

  const handleAddCallChain = useCallback(() => {
    const id = `call-${newId()}`
    const root = ensureSlots(createNode('basic'))
    root.title = 'Call'
    const name = `Call ${callChains.length + 1}`
    setCallChains((prev) => [{ id, name, root, collapsed: false }, ...prev])
    // Auto-expand Callback Nodes when new call is created
    setCallbackNodesCollapsed(false)
  }, [callChains.length])

  const handleRenameCallChain = useCallback((id: string, name: string) => {
    setCallChains((prev) => prev.map((c) => (c.id === id ? { ...c, name: name || c.name } : c)))
  }, [])

  const handleToggleCallChainCollapse = useCallback((id: string) => {
    setCallChains((prev) => prev.map((c) => (c.id === id ? { ...c, collapsed: !c.collapsed } : c)))
  }, [])

  const handleDeleteCallChain = useCallback((id: string) => {
    setCallChains((prev) => prev.filter((c) => c.id !== id))
  }, [])

  const pushCallChain = useCallback((id: string, next: FlowNode) => {
    setCallChains((prev) => prev.map((c) => (c.id === id ? { ...c, root: ensureSlots(next) } : c)))
  }, [])

  const handleCopySaved = useCallback(
    async (bot: SavedBot) => {
      if (bot.visibility === 'community') {
        alert('Community systems cannot be copied/exported.')
        return
      }
      const ensured = ensureSlots(cloneNode(bot.payload))
      setClipboard(ensured)
      const json = JSON.stringify(bot.payload) // Minified for smaller clipboard size
      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(json)
        }
      } catch {
        // ignore system clipboard failure; in-app clipboard is already set
      }
    },
    [setClipboard],
  )

  // FRD-012: Copy to New System - for Nexus/Atlas bots that can't be edited
  const handleCopyToNew = useCallback(
    async (bot: SavedBot) => {
      if (!userId) return

      // Clone the payload with new IDs
      const clonedPayload = ensureSlots(cloneNode(bot.payload))

      // Create new bot with (Copy) suffix, stripped of Fund tags
      // Admin bots get 'Atlas Eligible' tag by default, others get 'Private'
      const defaultTags = isAdmin ? ['Private', 'Atlas Eligible'] : ['Private']
      const newBot: SavedBot = {
        id: `saved-bot-${Date.now()}`,
        name: `${bot.name} (Copy)`,
        payload: clonedPayload,
        visibility: 'private',
        tags: defaultTags,
        builderId: userId,
        createdAt: Date.now(),
        fundSlot: undefined,
        backtestMode: bot.backtestMode || 'CC',
        backtestCostBps: bot.backtestCostBps ?? 5,
      }

      // Add to savedBots and sync to API
      setSavedBots((prev) => [...prev, newBot])
      await createBotInApi(userId, newBot)

      // Open in Build tab
      const session: BotSession = {
        id: `bot-${newId()}`,
        history: [clonedPayload],
        historyIndex: 0,
        savedBotId: newBot.id,
        backtest: { status: 'idle', errors: [], result: null, focusNodeId: null },
        callChains: (bot.callChains || []).map(cc => ({ ...cc, id: `call-${newId()}` })), // Clone call chains from source
      }
      setBots((prev) => [...prev, session])
      setActiveBotId(session.id)
      setTab('Model')
    },
    [userId, setTab],
  )

  const handleDeleteSaved = useCallback(async (id: string) => {
    // Delete from API first (database is source of truth)
    if (userId) {
      await deleteBotFromApi(userId, id)
    }
    setSavedBots((prev) => prev.filter((b) => b.id !== id))
    setWatchlists((prev) => prev.map((w) => ({ ...w, botIds: w.botIds.filter((x) => x !== id) })))
  }, [userId])

  const handleOpenSaved = useCallback(
    (bot: SavedBot) => {
      // FRD-012: Block ALL Nexus/Atlas bots from being edited (even by owner)
      // Owners should use "Copy to New System" instead
      const isPublished = bot.tags?.includes('Nexus') || bot.tags?.includes('Atlas')
      if (isPublished) {
        alert('Published systems cannot be edited. Use "Copy to New System" to create an editable copy.')
        return
      }
      // Block non-owners from opening any bot (IP protection)
      if (bot.builderId !== userId) {
        alert('You cannot open other users\' systems.')
        return
      }
      if (bot.visibility === 'community') {
        alert('Community systems cannot be opened in Build.')
        return
      }
      const payload = ensureSlots(cloneNode(bot.payload))
      const session: BotSession = {
        id: `bot-${newId()}`,
        history: [payload],
        historyIndex: 0,
        savedBotId: bot.id,
        backtest: { status: 'idle', errors: [], result: null, focusNodeId: null },
        callChains: bot.callChains || [], // Load call chains from saved bot
      }
      setBots((prev) => [...prev, session])
      setActiveBotId(session.id)
      setTab('Model')
    },
    [setTab, userId],
  )

  const handleImport = useCallback(() => {
    if (!activeBot) return
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return

      try {
        // Show loading state for large files
        setIsImporting(true)
        // Yield to let React render the loading state
        await yieldToMain()

        const text = await file.text()
        const parsed = JSON.parse(text) as unknown

        // Detect import format (Atlas, Composer, QuantMage)
        const format = detectImportFormat(parsed)
        console.log(`[Import] Detected format: ${format}`)

        // Apply format-specific file size limits
        // Composer files are much larger due to verbose JSON structure (UUIDs, nested weights, etc.)
        const MAX_COMPOSER_SIZE = 20 * 1024 * 1024 // 20MB for Composer
        const MAX_OTHER_SIZE = 1.5 * 1024 * 1024 // 1.5MB for Atlas/QuantMage
        const maxSize = format === 'composer' ? MAX_COMPOSER_SIZE : MAX_OTHER_SIZE
        const maxSizeLabel = format === 'composer' ? '20MB' : '1.5MB'

        if (file.size > maxSize) {
          setIsImporting(false)
          alert(`File too large (${(file.size / 1024 / 1024).toFixed(2)}MB). Maximum allowed size for ${format} format is ${maxSizeLabel}.`)
          return
        }

        let root0: FlowNode

        if (format === 'composer') {
          // Parse Composer Symphony format
          root0 = parseComposerSymphony(parsed as Record<string, unknown>)
          console.log('[Import] Parsed Composer Symphony:', root0)
        } else if (format === 'quantmage') {
          // Use Web Worker for large QuantMage files to prevent UI freeze
          const workerResult = await new Promise<FlowNode>((resolve, reject) => {
            const worker = new Worker(new URL('./importWorker.ts', import.meta.url), { type: 'module' })
            worker.onmessage = (e) => {
              worker.terminate()
              if (e.data.type === 'success') {
                resolve(e.data.result as FlowNode)
              } else {
                reject(new Error(e.data.error || 'Worker parsing failed'))
              }
            }
            worker.onerror = (err) => {
              worker.terminate()
              reject(err)
            }
            worker.postMessage({ type: 'parse', data: parsed, format: 'quantmage', filename: file.name })
          })
          root0 = workerResult
          console.log('[Import] Parsed QuantMage Strategy via Worker:', root0)
        } else if (format === 'atlas') {
          // Atlas native format - use existing extraction logic
          const isFlowNodeLike = (v: unknown): v is FlowNode => {
            if (!v || typeof v !== 'object') return false
            const o = v as Partial<FlowNode>
            return typeof o.id === 'string' && typeof o.kind === 'string' && typeof o.title === 'string' && typeof o.children === 'object'
          }

          const extractRoot = (v: unknown): FlowNode => {
            if (isFlowNodeLike(v)) return v
            if (v && typeof v === 'object') {
              const o = v as { payload?: unknown; root?: unknown; name?: unknown }
              if (isFlowNodeLike(o.payload)) {
                const name = typeof o.name === 'string' ? o.name.trim() : ''
                return name ? { ...o.payload, title: name } : o.payload
              }
              if (isFlowNodeLike(o.root)) return o.root
            }
            throw new Error('Invalid JSON shape for bot import.')
          }
          root0 = extractRoot(parsed)
        } else {
          setIsImporting(false)
          alert('Unknown import format. Please use Atlas, Composer, or QuantMage JSON files.')
          return
        }

        // For non-worker imports, still need to normalize
        let ensured: FlowNode
        if (format === 'quantmage') {
          // Worker already normalized
          ensured = root0
        } else {
          const inferredTitle = file.name.replace(/\.json$/i, '').replace(/_/g, ' ').trim()
          const hasTitle = Boolean(root0.title?.trim())
          const shouldInfer = !hasTitle || (root0.title.trim() === 'Algo Name Here' && inferredTitle && inferredTitle !== 'Algo Name Here')
          const root1 = shouldInfer ? { ...root0, title: inferredTitle || 'Imported System' } : root0
          ensured = normalizeForImport(root1)
        }

        // Add imported tree to history (preserving previous state for undo)
        setBots((prev) =>
          prev.map((b) => {
            if (b.id !== activeBot.id) return b
            // Truncate any redo history and append the imported tree
            const newHistory = [...b.history.slice(0, b.historyIndex + 1), ensured]
            return {
              ...b,
              history: newHistory,
              historyIndex: newHistory.length - 1,
              backtest: { status: 'idle', errors: [], result: null, focusNodeId: null }, // Clear previous backtest results when importing new algo
            }
          }),
        )
        setClipboard(null)
        setCopiedNodeId(null)
        setIsImporting(false)
        console.log(`[Import] Successfully imported ${format} format as: ${ensured.title}`)
      } catch (err) {
        setIsImporting(false)
        console.error('[Import] Error:', err)
        alert('Failed to Import due to an error in the JSON')
      }
    }
    input.click()
  }, [activeBot, setBots])

  const handleAddCondition = useCallback(
    (id: string, type: 'and' | 'or', itemId?: string) => {
      const next = addConditionLine(current, id, type, itemId)
      push(next)
    },
    [current, push],
  )

  const handleDeleteCondition = useCallback(
    (id: string, condId: string, itemId?: string) => {
      const next = deleteConditionLine(current, id, condId, itemId)
      push(next)
    },
    [current, push],
  )

  const handleNumberedQuantifier = useCallback(
    (id: string, quantifier: NumberedQuantifier) => {
      const next = updateNumberedQuantifier(current, id, quantifier)
      push(next)
    },
    [current, push],
  )

  const handleNumberedN = useCallback(
    (id: string, n: number) => {
      const next = updateNumberedN(current, id, n)
      push(next)
    },
    [current, push],
  )

  const handleAddNumberedItem = useCallback(
    (id: string) => {
      const next = addNumberedItem(current, id)
      push(next)
    },
    [current, push],
  )

  const handleDeleteNumberedItem = useCallback(
    (id: string, itemId: string) => {
      const next = deleteNumberedItem(current, id, itemId)
      push(next)
    },
    [current, push],
  )

  // Alt Exit handlers
  const handleAddEntryCondition = useCallback(
    (id: string, type: 'and' | 'or') => {
      const next = addEntryCondition(current, id, type)
      push(next)
    },
    [current, push],
  )

  const handleAddExitCondition = useCallback(
    (id: string, type: 'and' | 'or') => {
      const next = addExitCondition(current, id, type)
      push(next)
    },
    [current, push],
  )

  const handleDeleteEntryCondition = useCallback(
    (id: string, condId: string) => {
      const next = deleteEntryCondition(current, id, condId)
      push(next)
    },
    [current, push],
  )

  const handleDeleteExitCondition = useCallback(
    (id: string, condId: string) => {
      const next = deleteExitCondition(current, id, condId)
      push(next)
    },
    [current, push],
  )

  const handleUpdateEntryCondition = useCallback(
    (
      id: string,
      condId: string,
      updates: Partial<{
        window: number
        metric: MetricChoice
        comparator: ComparatorChoice
        ticker: PositionChoice
        threshold: number
        expanded?: boolean
        rightWindow?: number
        rightMetric?: MetricChoice
        rightTicker?: PositionChoice
      }>,
    ) => {
      const next = updateEntryConditionFields(current, id, condId, updates)
      push(next)
    },
    [current, push],
  )

  const handleUpdateExitCondition = useCallback(
    (
      id: string,
      condId: string,
      updates: Partial<{
        window: number
        metric: MetricChoice
        comparator: ComparatorChoice
        ticker: PositionChoice
        threshold: number
        expanded?: boolean
        rightWindow?: number
        rightMetric?: MetricChoice
        rightTicker?: PositionChoice
      }>,
    ) => {
      const next = updateExitConditionFields(current, id, condId, updates)
      push(next)
    },
    [current, push],
  )

  // Scaling handlers
  const handleUpdateScaling = useCallback(
    (
      id: string,
      updates: Partial<{
        scaleMetric: MetricChoice
        scaleWindow: number
        scaleTicker: string
        scaleFrom: number
        scaleTo: number
      }>,
    ) => {
      const next = updateScalingFields(current, id, updates)
      push(next)
    },
    [current, push],
  )

  const handleAddPos = useCallback(
    (id: string) => {
      const next = addPositionRow(current, id)
      push(next)
    },
    [current, push],
  )

  const handleRemovePos = useCallback(
    (id: string, index: number) => {
      const next = removePositionRow(current, id, index)
      push(next)
    },
    [current, push],
  )

  const handleChoosePos = useCallback(
    (id: string, index: number, choice: PositionChoice) => {
      const next = choosePosition(current, id, index, choice)
      push(next)
    },
    [current, push],
  )

  const undo = () => {
    if (!activeBot) return
    setBots((prev) =>
      prev.map((b) => (b.id === activeBot.id ? { ...b, historyIndex: Math.max(0, b.historyIndex - 1) } : b)),
    )
  }
  const redo = () => {
    if (!activeBot) return
    setBots((prev) =>
      prev.map((b) =>
        b.id === activeBot.id ? { ...b, historyIndex: Math.min(b.history.length - 1, b.historyIndex + 1) } : b,
      ),
    )
  }

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
    setTab('Model')
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
    setBots([createBotSession('Algo Name Here')])
    setUiState(defaultUiState())
    setDashboardPortfolio(defaultDashboardPortfolio())
    setAnalyzeBacktests({})
    setTab('Model')
    setSaveMenuOpen(false)
    setAddToWatchlistBotId(null)
  }

  const colorTheme = uiState.colorTheme ?? 'slate'

  // Helper to find fund slot from uiState.fundZones (used in Dashboard and Nexus)
  const getFundSlotForBot = (botId: string): number | null => {
    for (let i = 1; i <= 5; i++) {
      const key = `fund${i}` as keyof FundZones
      if (uiState.fundZones[key] === botId) return i
    }
    return null
  }

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
            gridTemplateColumns: tab === 'Model' ? '1fr 1fr 1fr 1fr 1fr 1fr 1fr 3fr 1fr' : '1fr 1fr 1fr 1fr 1fr 1fr 1fr 3fr 1fr',
            gridTemplateRows: tab === 'Model' ? 'auto auto' : 'auto',
          }}
        >
          {/* Row 1: Main tabs */}
          {(['Dashboard', 'Nexus', 'Analyze', 'Model', 'Help/Support', ...(isAdmin ? ['Admin'] : []), ...(hasEngineerAccess ? ['Databases'] : [])] as ('Dashboard' | 'Nexus' | 'Analyze' | 'Model' | 'Help/Support' | 'Admin' | 'Databases')[]).map((t) => (
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
              gridColumn: '8 / 9',
              gridRow: tab === 'Model' ? '1 / 3' : '1 / 2',
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
            style={{ gridColumn: '9 / 10', gridRow: tab === 'Model' ? '1 / 3' : '1 / 2' }}
            onClick={handleLogout}
          >
            <span className="text-xs text-muted">{userDisplayName || 'User'}</span>
            <span>Logout</span>
          </button>
          {/* Row 2: Model sub-buttons (only when Model tab active) - flex container spans columns 1-8 */}
          {tab === 'Model' && (
            <div className="flex items-stretch border-t border-border" style={{ gridColumn: '1 / 8', gridRow: '2 / 3' }}>
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
        </div>
        {/* Row 3: Algo tabs (only when Model tab active) */}
        {tab === 'Model' && (
          <div className="flex gap-2 py-2 px-2 border-t border-border">
              {bots.map((b) => {
                const root = b.history[b.historyIndex] ?? b.history[0]
                const label = root?.title || 'Untitled'
                return (
                  <div
                    key={b.id}
                    className={cn(
                      'flex flex-col border rounded-lg p-2 min-w-[120px]',
                      b.id === activeBotId
                        ? 'bg-accent-bg border-accent-border text-accent-text'
                        : 'bg-surface border-border'
                    )}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-center font-medium"
                      onClick={() => setActiveBotId(b.id)}
                    >
                      {label}
                    </Button>
                    <div className="flex gap-1 mt-1 justify-center">
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
      />
      <main className="flex-1 overflow-hidden min-h-0">
        {tab === 'Model' ? (
          <Suspense fallback={<div className="p-4 text-muted">Loading Model...</div>}>
            <ModelTab
              // Backtest panel props (derived or callback)
              tickerOptions={tickerOptions}
              backtestStatus={backtestStatus}
              backtestResult={backtestResult}
              backtestErrors={backtestErrors}
              handleRunBacktest={handleRunBacktest}
              handleJumpToBacktestError={handleJumpToBacktestError}
              theme={uiState.theme}
              fetchBenchmarkMetrics={fetchBenchmarkMetrics}
              runModelRobustness={runModelRobustness}
              undo={undo}
              redo={redo}
              activeBot={activeBot}
              // Call chain props
              callChains={callChains}
              setCallChains={setCallChains}
              handleAddCallChain={handleAddCallChain}
              handleRenameCallChain={handleRenameCallChain}
              handleToggleCallChainCollapse={handleToggleCallChainCollapse}
              handleDeleteCallChain={handleDeleteCallChain}
              pushCallChain={pushCallChain}
              // Main flowchart
              current={current}
              push={push}
              backtestErrorNodeIds={backtestErrorNodeIds}
              backtestFocusNodeId={backtestFocusNodeId}
              handleAdd={handleAdd}
              handleAppend={handleAppend}
              handleRemoveSlotEntry={handleRemoveSlotEntry}
              handleDelete={handleDelete}
              handleCopy={handleCopy}
              handlePaste={handlePaste}
              handlePasteCallRef={handlePasteCallRef}
              handleRename={handleRename}
              handleWeightChange={handleWeightChange}
              handleUpdateCappedFallback={handleUpdateCappedFallback}
              handleUpdateVolWindow={handleUpdateVolWindow}
              handleColorChange={handleColorChange}
              handleToggleCollapse={handleToggleCollapse}
              handleNumberedQuantifier={handleNumberedQuantifier}
              handleNumberedN={handleNumberedN}
              handleAddNumberedItem={handleAddNumberedItem}
              handleDeleteNumberedItem={handleDeleteNumberedItem}
              handleAddCondition={handleAddCondition}
              handleDeleteCondition={handleDeleteCondition}
              handleFunctionWindow={handleFunctionWindow}
              handleFunctionBottom={handleFunctionBottom}
              handleFunctionMetric={handleFunctionMetric}
              handleFunctionRank={handleFunctionRank}
              handleAddPos={handleAddPos}
              handleRemovePos={handleRemovePos}
              handleChoosePos={handleChoosePos}
              handleUpdateCallRef={handleUpdateCallRef}
              handleAddEntryCondition={handleAddEntryCondition}
              handleAddExitCondition={handleAddExitCondition}
              handleDeleteEntryCondition={handleDeleteEntryCondition}
              handleDeleteExitCondition={handleDeleteExitCondition}
              handleUpdateEntryCondition={handleUpdateEntryCondition}
              handleUpdateExitCondition={handleUpdateExitCondition}
              handleUpdateScaling={handleUpdateScaling}
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
            <NexusTab
              // UI state (persisted to API)
              uiState={uiState}
              setUiState={setUiState}
              // Dashboard integration (computed from API data)
              dashboardCash={dashboardCash}
              dashboardInvestmentsWithPnl={dashboardInvestmentsWithPnl}
              // Callbacks
              handleNexusBuy={handleNexusBuy}
              removeBotFromWatchlist={removeBotFromWatchlist}
              push={push}
              runAnalyzeBacktest={runAnalyzeBacktest}
              handleCopyToNew={handleCopyToNew}
              // Helpers
              getFundSlotForBot={getFundSlotForBot}
            />
          </Suspense>
        
        ) : tab === 'Dashboard' ? (
          <Suspense fallback={<div className="p-4 text-muted">Loading Dashboard...</div>}>
            <DashboardTab
              // UI state (persisted to API)
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
        
        ) : null}
      </main>
      {/* Floating horizontal scrollbar for flowchart - only visible on Model tab when content is wider than container */}
      {tab === 'Model' && flowchartScrollWidth > flowchartClientWidth && (
        <div
          ref={floatingScrollRef}
          className="fixed bottom-0 left-0 right-0 z-50 bg-surface border-t border-border"
          style={{
            height: '14px',
            overflowX: 'scroll',
            overflowY: 'hidden',
          }}
          onScroll={(e) => {
            if (flowchartScrollRef.current) {
              flowchartScrollRef.current.scrollLeft = e.currentTarget.scrollLeft
            }
          }}
        >
          <div style={{ width: flowchartScrollWidth, height: '1px' }} />
        </div>
      )}
    </div>
  )
}

export default App
