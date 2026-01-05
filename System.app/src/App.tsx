import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import './App.css'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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
  ConditionLine,
  TickerInstance,
  IndicatorOverlayData,
  FlowNode,
  CallChain,
  NumberedQuantifier,
  ThemeMode,
  ColorTheme,
  UserId,
  BacktestMode,
  BacktestError,
  BacktestWarning,
  BacktestResult,
  BacktestDayRow,
  BacktestAllocationRow,
  BacktestConditionTrace,
  BacktestNodeTrace,
  BacktestTraceCollector,
  EquityPoint,
  EquityMarker,
  BotBacktestState,
  AnalyzeBacktestState,
  TickerContributionState,
  BotVisibility,
  SavedBot,
  Watchlist,
  BotSession,
  DashboardTimePeriod,
  EquityCurvePoint,
  DashboardInvestment,
  DashboardPortfolio,
  DbPosition,
  AdminCandlesResponse,
  EligibilityRequirement,
  FundZones,
  UserUiState,
  UserData,
} from './types'
import { SLOT_ORDER, STARTING_CAPITAL, defaultDashboardPortfolio, METRIC_LABELS } from './types'
import {
  isWindowlessIndicator,
  getIndicatorLookback,
  COLOR_THEMES,
  API_BASE,
  TICKER_DATALIST_ID,
  USED_TICKERS_DATALIST_ID,
  CURRENT_USER_KEY,
  userDataKey,
  OHLC_CACHE_TTL,
} from './constants'
import {
  formatPct,
  formatUsd,
  formatSignedUsd,
} from './shared/utils'
import {
  // Helpers
  getAllSlotsForNode,
  newId,
  // Node factory
  createNode,
  ensureSlots,
  normalizeForImport,
  // Tree operations
  normalizeComparatorChoice,
  insertAtSlot,
  appendPlaceholder,
  deleteNode,
  removeSlotEntry,
  updateTitle,
  updateWeight,
  updateCappedFallback,
  updateVolWindow,
  updateCollapse,
  setCollapsedBelow,
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
  updateConditionFields,
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
  // Components
  NodeCard,
  cloneAndNormalize,
} from './features/builder'
import {
  // Backtest utilities
  compressTreeForBacktest,
  computeMonthlyReturns,
  computeBacktestSummary,
  isoFromUtcSeconds,
  // Indicator utilities
  type PriceDB,
  type IndicatorCache,
  emptyCache,
  getSeriesKey,
  getCachedCloseArray,
  getCachedReturnsArray,
  getCachedSeries,
  rollingSma,
  rollingEma,
  rollingWilderRsi,
  rollingStdDev,
  rollingMaxDrawdown,
  rollingCumulativeReturn,
  rollingSmaOfReturns,
  rollingStdDevOfPrices,
  rolling13612W,
  rolling13612U,
  rollingSMA12Momentum,
  rollingDrawdown,
  rollingAroonUp,
  rollingAroonDown,
  rollingAroonOscillator,
  rollingMACD,
  rollingPPO,
  rollingTrendClarity,
  rollingUltimateSmoother,
  // Backtest types
  type ComparisonMetrics,
  type SanityReport,
  type SanityReportState,
  // Backtest components
  EquityChart,
  DrawdownChart,
  BacktesterPanel,
} from './features/backtest'
import {
  type BotReturnSeries,
  DashboardEquityChart,
  PartnerTBillChart,
} from './features/dashboard'
import {
  type AdminSubtab,
  type DatabasesSubtab,
  AdminPanel,
  DatabasesPanel,
} from './features/admin'
import {
  fetchNexusBotsFromApi,
  loadBotsFromApi,
  createBotInApi,
  updateBotInApi,
  deleteBotFromApi,
  syncBotMetricsToApi,
} from './features/bots'
import {
  detectImportFormat,
  parseComposerSymphony,
  yieldToMain,
} from './features/data'
import {
  TickerSearchModal,
  TickerDatalist,
  normalizeChoice,
  isEmptyChoice,
  expandTickerComponents,
} from './shared'
import type { UTCTimestamp } from 'lightweight-charts'

// Helper functions that use imported types

const normalizeConditionType = (value: unknown, fallback: ConditionLine['type']): ConditionLine['type'] => {
  if (value === 'if' || value === 'and' || value === 'or') return value
  const s = String(value || '').trim().toLowerCase()
  if (!s) return fallback
  if (s === 'and if' || s === 'andif' || s.startsWith('and')) return 'and'
  if (s === 'or if' || s === 'orif' || s.startsWith('or')) return 'or'
  if (s.startsWith('if')) return 'if'
  if (s.includes('and')) return 'and'
  if (s.includes('or')) return 'or'
  if (s.includes('if')) return 'if'
  return fallback
}

// normalizeComparatorChoice imported from @/features/builder

const normalizeConditions = (conditions: ConditionLine[] | undefined): ConditionLine[] | undefined => {
  if (!conditions) return conditions
  return conditions.map((c, idx) => ({
    ...c,
    type: idx === 0 ? 'if' : normalizeConditionType((c as unknown as { type?: unknown })?.type, 'and'),
    comparator: normalizeComparatorChoice((c as unknown as { comparator?: unknown })?.comparator),
    threshold: Number.isFinite(Number((c as unknown as { threshold?: unknown })?.threshold))
      ? Number((c as unknown as { threshold?: unknown })?.threshold)
      : 0,
    window: Number.isFinite(Number((c as unknown as { window?: unknown })?.window))
      ? Math.max(1, Math.floor(Number((c as unknown as { window?: unknown })?.window)))
      : 14,
    rightWindow: Number.isFinite(Number((c as unknown as { rightWindow?: unknown })?.rightWindow))
      ? Math.max(1, Math.floor(Number((c as unknown as { rightWindow?: unknown })?.rightWindow)))
      : c.rightWindow,
  }))
}

const normalizeNodeForBacktest = (node: FlowNode): FlowNode => {
  const next: FlowNode = {
    ...node,
    conditions: normalizeConditions(node.conditions),
    numbered: node.numbered
      ? {
          ...node.numbered,
          items: node.numbered.items.map((item) => ({ ...item, conditions: normalizeConditions(item.conditions) ?? item.conditions })),
        }
      : undefined,
    // Alt Exit conditions
    entryConditions: normalizeConditions(node.entryConditions),
    exitConditions: normalizeConditions(node.exitConditions),
    children: { ...node.children },
  }
  // Get slots including ladder slots for numbered nodes
  const slots = [...SLOT_ORDER[node.kind]]
  if (node.kind === 'numbered' && node.numbered?.quantifier === 'ladder') {
    Object.keys(node.children).forEach((key) => {
      if (key.startsWith('ladder-') && !slots.includes(key as SlotId)) {
        slots.push(key as SlotId)
      }
    })
  }
  for (const slot of slots) {
    const arr = node.children[slot] ?? [null]
    next.children[slot] = arr.map((c) => (c ? normalizeNodeForBacktest(c) : c))
  }
  return next
}

const loadDeviceThemeMode = (): ThemeMode => {
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

// Bot API functions imported from './features/bots'

// ============================================================================
// WATCHLIST API FUNCTIONS
// ============================================================================

// Load all watchlists for a user from the database
const loadWatchlistsFromApi = async (userId: UserId): Promise<Watchlist[]> => {
  try {
    const res = await fetch(`${API_BASE}/watchlists?userId=${userId}`)
    if (!res.ok) return []
    const { watchlists } = await res.json() as { watchlists: Array<{
      id: string
      ownerId: string
      name: string
      isDefault: boolean
      bots?: Array<{ botId: string }>
    }> }
    return watchlists.map((wl) => ({
      id: wl.id,
      name: wl.name,
      botIds: (wl.bots || []).map(b => b.botId),
      isDefault: wl.isDefault,
    }))
  } catch (err) {
    console.warn('[API] Failed to load watchlists from API:', err)
    return []
  }
}

// Create a new watchlist in the database
const createWatchlistInApi = async (userId: UserId, name: string): Promise<string | null> => {
  try {
    const res = await fetch(`${API_BASE}/watchlists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, name }),
    })
    if (!res.ok) return null
    const { watchlist } = await res.json() as { watchlist: { id: string } }
    return watchlist.id
  } catch (err) {
    console.warn('[API] Failed to create watchlist:', err)
    return null
  }
}

// Add a bot to a watchlist in the database
const addBotToWatchlistInApi = async (watchlistId: string, botId: string): Promise<boolean> => {
  try {
    const res = await fetch(`${API_BASE}/watchlists/${watchlistId}/bots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botId }),
    })
    return res.ok
  } catch (err) {
    console.warn('[API] Failed to add bot to watchlist:', err)
    return false
  }
}

// Remove a bot from a watchlist in the database
const removeBotFromWatchlistInApi = async (watchlistId: string, botId: string): Promise<boolean> => {
  try {
    const res = await fetch(`${API_BASE}/watchlists/${watchlistId}/bots/${botId}`, {
      method: 'DELETE',
    })
    return res.ok
  } catch (err) {
    console.warn('[API] Failed to remove bot from watchlist:', err)
    return false
  }
}

// ============================================================================
// USER PREFERENCES API FUNCTIONS
// ============================================================================

type DbPreferences = {
  userId: string
  theme: string
  colorScheme: string
  uiState: string | null
}

// Load user preferences from the database
const loadPreferencesFromApi = async (userId: UserId): Promise<UserUiState | null> => {
  try {
    const res = await fetch(`${API_BASE}/preferences?userId=${userId}`)
    if (!res.ok) return null
    const { preferences } = await res.json() as { preferences: DbPreferences | null }
    if (!preferences || !preferences.uiState) return null
    const parsed = JSON.parse(preferences.uiState) as Partial<UserUiState>
    return {
      theme: (parsed.theme as ThemeMode) || 'dark',
      colorTheme: parsed.colorTheme || 'slate',
      analyzeCollapsedByBotId: parsed.analyzeCollapsedByBotId || {},
      communityCollapsedByBotId: parsed.communityCollapsedByBotId || {},
      analyzeBotCardTab: parsed.analyzeBotCardTab || {},
      analyzeFilterWatchlistId: parsed.analyzeFilterWatchlistId ?? null,
      communitySelectedWatchlistId: parsed.communitySelectedWatchlistId ?? null,
      communityWatchlistSlot1Id: parsed.communityWatchlistSlot1Id ?? null,
      communityWatchlistSlot2Id: parsed.communityWatchlistSlot2Id ?? null,
      fundZones: parsed.fundZones || { fund1: null, fund2: null, fund3: null, fund4: null, fund5: null },
    }
  } catch (err) {
    console.warn('[API] Failed to load preferences:', err)
    return null
  }
}

// Save user preferences to the database
const savePreferencesToApi = async (userId: UserId, uiState: UserUiState): Promise<boolean> => {
  try {
    const res = await fetch(`${API_BASE}/preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        theme: uiState.theme,
        colorScheme: uiState.colorTheme,
        uiState: JSON.stringify(uiState),
      }),
    })
    return res.ok
  } catch (err) {
    console.warn('[API] Failed to save preferences:', err)
    return false
  }
}

// ============================================================================
// CALL CHAIN API FUNCTIONS
// ============================================================================

type DbCallChain = {
  id: string
  ownerId: string
  name: string
  root: string // JSON string
  collapsed: boolean
  createdAt: number
  updatedAt: number
}

// Load all call chains for a user from the database
const loadCallChainsFromApi = async (userId: UserId): Promise<CallChain[]> => {
  try {
    const res = await fetch(`${API_BASE}/call-chains?userId=${userId}`)
    if (!res.ok) return []
    const { callChains } = await res.json() as { callChains: DbCallChain[] }
    return callChains.map((cc) => ({
      id: cc.id,
      name: cc.name,
      root: JSON.parse(cc.root) as FlowNode,
      collapsed: cc.collapsed,
    }))
  } catch (err) {
    console.warn('[API] Failed to load call chains:', err)
    return []
  }
}

// NOTE: Call chain API functions removed - call chains are now stored per-bot in the bot payload
// They are saved when the bot is saved to a watchlist, not synced separately

// syncBotMetricsToApi imported from './features/bots'

// ============================================================================

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


type CommunitySortKey = 'name' | 'tags' | 'oosCagr' | 'oosMaxdd' | 'oosSharpe'
type SortDir = 'asc' | 'desc'
type CommunitySort = { key: CommunitySortKey; dir: SortDir }

type CommunityBotRow = {
  id: string
  name: string
  tags: string[]
  oosCagr: number
  oosMaxdd: number
  oosSharpe: number
}

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

const findNode = (node: FlowNode, id: string): FlowNode | null => {
  if (node.id === id) return node
  for (const slot of getAllSlotsForNode(node)) {
    const arr = node.children[slot]
    if (!arr) continue
    for (const child of arr) {
      if (!child) continue
      const found = findNode(child, id)
      if (found) return found
    }
  }
  return null
}

// Find all instances of a ticker in the tree
const findTickerInstances = (
  root: FlowNode,
  ticker: string,
  includePositions: boolean,
  includeIndicators: boolean,
  callChainId?: string
): TickerInstance[] => {
  const instances: TickerInstance[] = []
  if (!ticker.trim()) return instances
  const normalized = ticker.trim().toUpperCase()

  const traverse = (node: FlowNode) => {
    // Check positions (Trade Tickers)
    if (includePositions && node.positions) {
      node.positions.forEach((p, idx) => {
        if (p.toUpperCase() === normalized) {
          instances.push({ nodeId: node.id, field: 'position', index: idx, callChainId })
        }
      })
    }

    // Check conditions (Indicator Tickers)
    if (includeIndicators && node.conditions) {
      node.conditions.forEach((cond, idx) => {
        if (cond.ticker?.toUpperCase() === normalized) {
          instances.push({ nodeId: node.id, field: 'condition', index: idx, callChainId })
        }
        if (cond.rightTicker?.toUpperCase() === normalized) {
          instances.push({ nodeId: node.id, field: 'rightCondition', index: idx, callChainId })
        }
      })
    }

    // Check numbered items
    if (includeIndicators && node.numbered?.items) {
      node.numbered.items.forEach(item => {
        item.conditions?.forEach((cond, idx) => {
          if (cond.ticker?.toUpperCase() === normalized) {
            instances.push({ nodeId: node.id, field: 'condition', index: idx, itemId: item.id, callChainId })
          }
          if (cond.rightTicker?.toUpperCase() === normalized) {
            instances.push({ nodeId: node.id, field: 'rightCondition', index: idx, itemId: item.id, callChainId })
          }
        })
      })
    }

    // Check entry/exit conditions (Alt Exit nodes)
    if (includeIndicators && node.entryConditions) {
      node.entryConditions.forEach((cond, idx) => {
        if (cond.ticker?.toUpperCase() === normalized) {
          instances.push({ nodeId: node.id, field: 'entry', index: idx, callChainId })
        }
        if (cond.rightTicker?.toUpperCase() === normalized) {
          instances.push({ nodeId: node.id, field: 'rightCondition', index: idx, callChainId })
        }
      })
    }
    if (includeIndicators && node.exitConditions) {
      node.exitConditions.forEach((cond, idx) => {
        if (cond.ticker?.toUpperCase() === normalized) {
          instances.push({ nodeId: node.id, field: 'exit', index: idx, callChainId })
        }
        if (cond.rightTicker?.toUpperCase() === normalized) {
          instances.push({ nodeId: node.id, field: 'rightCondition', index: idx, callChainId })
        }
      })
    }

    // Check scaleTicker
    if (includeIndicators && node.scaleTicker?.toUpperCase() === normalized) {
      instances.push({ nodeId: node.id, field: 'scaleTicker', callChainId })
    }

    // Check capped fallbacks (considered as positions)
    if (includePositions) {
      if (node.cappedFallback?.toUpperCase() === normalized) {
        instances.push({ nodeId: node.id, field: 'cappedFallback', callChainId })
      }
      if (node.cappedFallbackThen?.toUpperCase() === normalized) {
        instances.push({ nodeId: node.id, field: 'cappedFallback', callChainId })
      }
      if (node.cappedFallbackElse?.toUpperCase() === normalized) {
        instances.push({ nodeId: node.id, field: 'cappedFallback', callChainId })
      }
    }

    // Recurse into children
    for (const slot of getAllSlotsForNode(node)) {
      const arr = node.children[slot]
      if (arr) {
        arr.forEach(child => { if (child) traverse(child) })
      }
    }
  }

  traverse(root)
  return instances
}


// Collect all unique tickers used in the tree (for Find/Replace autocomplete)
const collectUsedTickers = (root: FlowNode, callChains?: { id: string; root: string | FlowNode }[]): string[] => {
  const tickers = new Set<string>()

  const traverse = (node: FlowNode) => {
    // Positions
    if (node.positions) {
      node.positions.forEach(p => {
        if (p && p !== 'Empty') tickers.add(p.toUpperCase())
      })
    }

    // Conditions (ticker and rightTicker)
    if (node.conditions) {
      node.conditions.forEach(cond => {
        if (cond.ticker) tickers.add(cond.ticker.toUpperCase())
        if (cond.rightTicker) tickers.add(cond.rightTicker.toUpperCase())
      })
    }

    // Numbered items
    if (node.numbered?.items) {
      node.numbered.items.forEach(item => {
        item.conditions?.forEach(cond => {
          if (cond.ticker) tickers.add(cond.ticker.toUpperCase())
          if (cond.rightTicker) tickers.add(cond.rightTicker.toUpperCase())
        })
      })
    }

    // Entry/Exit conditions (Alt Exit nodes)
    if (node.entryConditions) {
      node.entryConditions.forEach(cond => {
        if (cond.ticker) tickers.add(cond.ticker.toUpperCase())
        if (cond.rightTicker) tickers.add(cond.rightTicker.toUpperCase())
      })
    }
    if (node.exitConditions) {
      node.exitConditions.forEach(cond => {
        if (cond.ticker) tickers.add(cond.ticker.toUpperCase())
        if (cond.rightTicker) tickers.add(cond.rightTicker.toUpperCase())
      })
    }

    // scaleTicker
    if (node.scaleTicker) tickers.add(node.scaleTicker.toUpperCase())

    // Capped fallbacks
    if (node.cappedFallback && node.cappedFallback !== 'Empty') tickers.add(node.cappedFallback.toUpperCase())
    if (node.cappedFallbackThen && node.cappedFallbackThen !== 'Empty') tickers.add(node.cappedFallbackThen.toUpperCase())
    if (node.cappedFallbackElse && node.cappedFallbackElse !== 'Empty') tickers.add(node.cappedFallbackElse.toUpperCase())

    // Recurse into children
    for (const slot of getAllSlotsForNode(node)) {
      const arr = node.children[slot]
      if (arr) {
        arr.forEach(child => { if (child) traverse(child) })
      }
    }
  }

  traverse(root)

  // Also check call chains if provided
  if (callChains) {
    callChains.forEach(chain => {
      try {
        const chainRoot = typeof chain.root === 'string' ? JSON.parse(chain.root) : chain.root
        traverse(chainRoot)
      } catch { /* ignore parse errors */ }
    })
  }

  return [...tickers].sort()
}

// Collect enabled conditions from the tree for indicator overlay
const collectEnabledConditions = (
  root: FlowNode,
  enabledSet: Set<string>
): ConditionLine[] => {
  const conditions: ConditionLine[] = []
  if (enabledSet.size === 0) return conditions

  const traverse = (node: FlowNode) => {
    // Check regular conditions
    if (node.conditions) {
      node.conditions.forEach(cond => {
        const key = `${node.id}:${cond.id}`
        if (enabledSet.has(key)) {
          conditions.push(cond)
        }
      })
    }

    // Check numbered items
    if (node.numbered?.items) {
      node.numbered.items.forEach(item => {
        item.conditions?.forEach(cond => {
          const key = `${node.id}:${item.id}:${cond.id}`
          if (enabledSet.has(key)) {
            conditions.push(cond)
          }
        })
      })
    }

    // Check entry/exit conditions (Alt Exit nodes)
    if (node.entryConditions) {
      node.entryConditions.forEach(cond => {
        const key = `${node.id}:entry:${cond.id}`
        if (enabledSet.has(key)) {
          conditions.push(cond)
        }
      })
    }
    if (node.exitConditions) {
      node.exitConditions.forEach(cond => {
        const key = `${node.id}:exit:${cond.id}`
        if (enabledSet.has(key)) {
          conditions.push(cond)
        }
      })
    }

    // Recurse into children
    for (const slot of getAllSlotsForNode(node)) {
      const arr = node.children[slot]
      if (arr) {
        arr.forEach(child => { if (child) traverse(child) })
      }
    }
  }

  traverse(root)
  return conditions
}

// Replace all instances of a ticker in the tree (returns new tree)
const replaceTickerInTree = (
  root: FlowNode,
  fromTicker: string,
  toTicker: string,
  includePositions: boolean,
  includeIndicators: boolean
): FlowNode => {
  const from = fromTicker.trim().toUpperCase()
  const to = toTicker.trim().toUpperCase() || 'Empty'

  const replaceInNode = (node: FlowNode): FlowNode => {
    const next = { ...node }

    // Replace in positions
    if (includePositions && next.positions) {
      next.positions = next.positions.map(p =>
        p.toUpperCase() === from ? to : p
      )
    }

    // Replace in conditions
    if (includeIndicators && next.conditions) {
      next.conditions = next.conditions.map(c => ({
        ...c,
        ticker: c.ticker?.toUpperCase() === from ? to : c.ticker,
        rightTicker: c.rightTicker?.toUpperCase() === from ? to : c.rightTicker,
      }))
    }

    // Replace in numbered items
    if (includeIndicators && next.numbered?.items) {
      next.numbered = {
        ...next.numbered,
        items: next.numbered.items.map(item => ({
          ...item,
          conditions: item.conditions?.map(c => ({
            ...c,
            ticker: c.ticker?.toUpperCase() === from ? to : c.ticker,
            rightTicker: c.rightTicker?.toUpperCase() === from ? to : c.rightTicker,
          }))
        }))
      }
    }

    // Replace in entry/exit conditions
    if (includeIndicators && next.entryConditions) {
      next.entryConditions = next.entryConditions.map(c => ({
        ...c,
        ticker: c.ticker?.toUpperCase() === from ? to : c.ticker,
        rightTicker: c.rightTicker?.toUpperCase() === from ? to : c.rightTicker,
      }))
    }
    if (includeIndicators && next.exitConditions) {
      next.exitConditions = next.exitConditions.map(c => ({
        ...c,
        ticker: c.ticker?.toUpperCase() === from ? to : c.ticker,
        rightTicker: c.rightTicker?.toUpperCase() === from ? to : c.rightTicker,
      }))
    }

    // Replace scaleTicker
    if (includeIndicators && next.scaleTicker?.toUpperCase() === from) {
      next.scaleTicker = to
    }

    // Replace capped fallbacks
    if (includePositions) {
      if (next.cappedFallback?.toUpperCase() === from) next.cappedFallback = to
      if (next.cappedFallbackThen?.toUpperCase() === from) next.cappedFallbackThen = to
      if (next.cappedFallbackElse?.toUpperCase() === from) next.cappedFallbackElse = to
    }

    // Recurse into children
    if (next.children) {
      const newChildren: typeof next.children = {}
      for (const slot of getAllSlotsForNode(node)) {
        const arr = next.children[slot]
        newChildren[slot] = arr?.map(child =>
          child ? replaceInNode(child) : child
        )
      }
      next.children = newChildren
    }

    return next
  }

  return replaceInNode(root)
}

// NodeCard, CardProps, buildLines imported from @/features/builder

type ValidationError = Error & { type: 'validation'; errors: BacktestError[] }

const makeValidationError = (errors: BacktestError[]): ValidationError =>
  Object.assign(new Error('validation'), { type: 'validation' as const, errors })

const isValidationError = (e: unknown): e is ValidationError =>
  typeof e === 'object' && e !== null && (e as { type?: unknown }).type === 'validation' && Array.isArray((e as { errors?: unknown }).errors)

// downloadEquityCsv, downloadAllocationsCsv, downloadRebalancesCsv imported from @/features/backtest

// normalizeChoice, isEmptyChoice, parseRatioTicker, expandTickerComponents imported from @/shared

type Allocation = Record<string, number>

const allocEntries = (alloc: Allocation): Array<{ ticker: string; weight: number }> => {
  return Object.entries(alloc)
    .filter(([, w]) => w > 0)
    .map(([ticker, weight]) => ({ ticker, weight }))
}

const sumAlloc = (alloc: Allocation) => Object.values(alloc).reduce((a, b) => a + b, 0)

const normalizeAlloc = (alloc: Allocation): Allocation => {
  const total = sumAlloc(alloc)
  if (!(total > 0)) return {}
  const out: Allocation = {}
  for (const [k, v] of Object.entries(alloc)) {
    if (v <= 0) continue
    out[k] = v / total
  }
  return out
}

const mergeAlloc = (base: Allocation, add: Allocation, scale: number) => {
  if (!(scale > 0)) return
  for (const [t, w] of Object.entries(add)) {
    if (!(w > 0)) continue
    base[t] = (base[t] || 0) + w * scale
  }
}

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

type TickerRef = { nodeId: string; field: string }

type BacktestInputs = {
  tickers: string[]
  tickerRefs: Map<string, TickerRef>
  maxLookback: number
  errors: BacktestError[]
}

const getSlotConfig = (node: FlowNode, slot: SlotId) => {
  if ((node.kind === 'indicator' || node.kind === 'numbered') && (slot === 'then' || slot === 'else')) {
    const mode = slot === 'then' ? (node.weightingThen ?? node.weighting) : (node.weightingElse ?? node.weighting)
    const volWindow = slot === 'then' ? (node.volWindowThen ?? node.volWindow ?? 20) : (node.volWindowElse ?? node.volWindow ?? 20)
    const cappedFallback =
      slot === 'then' ? (node.cappedFallbackThen ?? node.cappedFallback ?? 'Empty') : (node.cappedFallbackElse ?? node.cappedFallback ?? 'Empty')
    return { mode, volWindow, cappedFallback }
  }
  return { mode: node.weighting, volWindow: node.volWindow ?? 20, cappedFallback: node.cappedFallback ?? 'Empty' }
}

const collectBacktestInputs = (root: FlowNode, callMap: Map<string, CallChain>): BacktestInputs => {
  const errors: BacktestError[] = []
  const tickers = new Set<string>()
  const tickerRefs = new Map<string, TickerRef>()
  let maxLookback = 0

  const addTicker = (t: PositionChoice, nodeId: string, field: string) => {
    const norm = normalizeChoice(t)
    if (norm === 'Empty') return
    // For ratio tickers like "JNK/XLP", add both components for fetching
    const components = expandTickerComponents(norm)
    for (const c of components) {
      tickers.add(c)
      if (!tickerRefs.has(c)) tickerRefs.set(c, { nodeId, field })
    }
  }

  const addError = (nodeId: string, field: string, message: string) => errors.push({ nodeId, field, message })

  const validateCondition = (ownerId: string, fieldPrefix: string, cond: ConditionLine) => {
    const baseField = `${fieldPrefix}.${cond.id}`
    const ticker = normalizeChoice(cond.ticker)
    if (ticker === 'Empty') {
      addError(ownerId, `${baseField}.ticker`, 'Indicator condition is missing a ticker.')
    } else {
      addTicker(ticker, ownerId, `${baseField}.ticker`)
    }
    // forDays adds extra lookback (we need to check N consecutive days)
    const forDaysOffset = Math.max(0, (cond.forDays || 1) - 1)
    if (cond.metric !== 'Current Price' && !isWindowlessIndicator(cond.metric)) {
      if (!Number.isFinite(cond.window) || cond.window < 1) addError(ownerId, `${baseField}.window`, 'Indicator window must be >= 1.')
    }
    // Use actual indicator lookback (e.g., 252 for momentum indicators)
    maxLookback = Math.max(maxLookback, getIndicatorLookback(cond.metric, cond.window || 0) + forDaysOffset)
    if (cond.expanded) {
      const rt = normalizeChoice(cond.rightTicker ?? '')
      if (rt === 'Empty') addError(ownerId, `${baseField}.rightTicker`, 'Right-side ticker is missing.')
      else addTicker(rt, ownerId, `${baseField}.rightTicker`)
      const rw = Number(cond.rightWindow ?? cond.window)
      const rightMetric = (cond.rightMetric ?? cond.metric) as MetricChoice
      if (rightMetric !== 'Current Price' && !isWindowlessIndicator(rightMetric)) {
        if (!Number.isFinite(rw) || rw < 1) addError(ownerId, `${baseField}.rightWindow`, 'Right-side window must be >= 1.')
      }
      // Use actual indicator lookback for right side
      maxLookback = Math.max(maxLookback, getIndicatorLookback(rightMetric, rw || 0) + forDaysOffset)
    }
  }

  const walk = (node: FlowNode, callStack: string[]) => {
    if (node.kind === 'call') {
      const callId = node.callRefId
      if (!callId) {
        addError(node.id, 'callRefId', 'Select a call chain to reference.')
        return
      }
      if (callStack.includes(callId)) {
        addError(node.id, 'callRefId', 'Call references cannot form a loop.')
        return
      }
      const target = callMap.get(callId)
      if (!target) {
        addError(node.id, 'callRefId', 'Call chain not found.')
        return
      }
      const cloned = ensureSlots(cloneNode(target.root))
      walk(cloned, [...callStack, callId])
      return
    }

    if (node.kind === 'indicator' && node.conditions) {
      node.conditions.forEach((c) => validateCondition(node.id, 'conditions', c))
    }
    if (node.kind === 'numbered' && node.numbered) {
      node.numbered.items.forEach((item) => {
        item.conditions.forEach((c) => validateCondition(node.id, `numbered.items.${item.id}.conditions`, c))
      })
    }
    if (node.kind === 'position') {
      for (const p of node.positions || []) addTicker(p, node.id, 'positions')
    }

    if (node.kind === 'function') {
      const metric = node.metric ?? 'Relative Strength Index'
      const win = isWindowlessIndicator(metric) ? 0 : Math.floor(Number(node.window ?? 10))
      if (!isWindowlessIndicator(metric) && (!(win >= 1) || !Number.isFinite(win))) {
        addError(node.id, 'window', 'Sort window must be >= 1.')
      }
      maxLookback = Math.max(maxLookback, win || 0)
      const pickN = Math.floor(Number(node.bottom ?? 1))
      if (!(pickN >= 1) || !Number.isFinite(pickN)) addError(node.id, 'bottom', 'Pick count must be >= 1.')
      const nextChildren = (node.children.next ?? []).filter((c): c is FlowNode => Boolean(c))
      if (Number.isFinite(pickN) && pickN >= 1 && nextChildren.length < pickN) {
        addError(node.id, 'bottom', `Pick count is ${pickN} but only ${nextChildren.length} child nodes exist.`)
      }
    }

    // Alt Exit node - validate entry/exit conditions and add their tickers
    if (node.kind === 'altExit') {
      if (node.entryConditions) {
        node.entryConditions.forEach((c) => validateCondition(node.id, 'entryConditions', c))
      }
      if (node.exitConditions) {
        node.exitConditions.forEach((c) => validateCondition(node.id, 'exitConditions', c))
      }
    }

    // Scaling node - validate and add the scale ticker
    if (node.kind === 'scaling') {
      const scaleTicker = normalizeChoice(node.scaleTicker ?? 'SPY')
      if (scaleTicker === 'Empty') {
        addError(node.id, 'scaleTicker', 'Scaling node is missing a ticker.')
      } else {
        addTicker(scaleTicker, node.id, 'scaleTicker')
      }
      const scaleMetric = node.scaleMetric ?? 'Relative Strength Index'
      const scaleWin = isWindowlessIndicator(scaleMetric) ? 0 : Math.floor(Number(node.scaleWindow ?? 14))
      if (!isWindowlessIndicator(scaleMetric) && (!(scaleWin >= 1) || !Number.isFinite(scaleWin))) {
        addError(node.id, 'scaleWindow', 'Scale window must be >= 1.')
      }
      maxLookback = Math.max(maxLookback, scaleWin || 0)
    }

    // weight-mode-specific validations for the node's active slots
    const slotsToCheck: SlotId[] =
      node.kind === 'indicator' || node.kind === 'numbered' || node.kind === 'altExit' || node.kind === 'scaling' ? ['then', 'else'] : node.kind === 'position' ? [] : ['next']

    for (const slot of slotsToCheck) {
      const { mode, volWindow, cappedFallback } = getSlotConfig(node, slot)
      if ((mode === 'inverse' || mode === 'pro') && (!Number.isFinite(volWindow) || volWindow < 1)) {
        addError(node.id, `volWindow.${slot}`, 'Volatility window must be >= 1.')
      }
      if (mode === 'inverse' || mode === 'pro') {
        maxLookback = Math.max(maxLookback, Math.floor(Number(volWindow || 0)))
      }
      if (mode === 'capped') addTicker(cappedFallback, node.id, `cappedFallback.${slot}`)
      const children = (node.children[slot] ?? []).filter((c): c is FlowNode => Boolean(c))
      if (mode === 'defined' || mode === 'capped') {
        for (const child of children) {
          const v = Number(child.window)
          // Allow 0% weight (valid choice to not allocate to a branch)
          // Only error if undefined/NaN or negative
          if (!Number.isFinite(v) || v < 0) {
            addError(child.id, 'window', `${mode === 'capped' ? 'Cap' : 'Weight'} % is missing for "${child.title}".`)
          } else if (mode === 'capped' && v > 100) {
            addError(child.id, 'window', `Cap % must be <= 100 for "${child.title}".`)
          }
        }
      }
    }

    for (const slot of getAllSlotsForNode(node)) {
      const arr = node.children[slot] || []
      for (const c of arr) if (c) walk(c, callStack)
    }
  }

  walk(root, [])

  return { tickers: Array.from(tickers).sort(), tickerRefs, maxLookback, errors }
}

const collectPositionTickers = (root: FlowNode, callMap: Map<string, CallChain>): string[] => {
  const tickers = new Set<string>()

  const addTicker = (t: PositionChoice) => {
    const norm = normalizeChoice(t)
    if (norm === 'Empty') return
    tickers.add(norm)
  }

  const walk = (node: FlowNode, callStack: string[]) => {
    if (node.kind === 'call') {
      const callId = node.callRefId
      if (!callId) return
      if (callStack.includes(callId)) return
      const target = callMap.get(callId)
      if (!target) return
      const cloned = ensureSlots(cloneNode(target.root))
      walk(cloned, [...callStack, callId])
      return
    }

    if (node.kind === 'position') {
      for (const p of node.positions || []) addTicker(p)
    }

    for (const slot of getAllSlotsForNode(node)) {
      const arr = node.children[slot] || []
      for (const c of arr) if (c) walk(c, callStack)
    }
  }

  walk(root, [])

  return Array.from(tickers).sort()
}

// Check if a bot only contains ETF positions
// Returns true if all position tickers are ETFs, false if any are stocks or unknown
const isEtfsOnlyBot = (
  root: FlowNode,
  callMap: Map<string, CallChain>,
  tickerMetadata: Map<string, { assetType?: string; name?: string }>
): boolean => {
  const positionTickers = collectPositionTickers(root, callMap)

  // Exclude special values that aren't real tickers
  const realTickers = positionTickers.filter(t =>
    t !== 'Empty' && t !== 'CASH' && t !== 'BIL'
  )

  // If no real tickers, consider it ETF-only (vacuously true)
  if (realTickers.length === 0) return true

  // Check if all tickers are ETFs
  return realTickers.every(ticker => {
    const meta = tickerMetadata.get(ticker.toUpperCase())
    // If we don't have metadata for the ticker, assume it's not an ETF (be conservative)
    return meta?.assetType === 'ETF'
  })
}

// Collect only indicator tickers (from conditions, function nodes, scaling nodes)
// Excludes position tickers since those can have shorter history without affecting indicator calculations
const collectIndicatorTickers = (root: FlowNode, callMap: Map<string, CallChain>): string[] => {
  const tickers = new Set<string>()

  const addTicker = (t: PositionChoice) => {
    const norm = normalizeChoice(t)
    if (norm === 'Empty') return
    // For ratio tickers like "JNK/XLP", add both components
    const components = expandTickerComponents(norm)
    for (const c of components) tickers.add(c)
  }

  const collectFromCondition = (cond: ConditionLine) => {
    const ticker = normalizeChoice(cond.ticker)
    if (ticker !== 'Empty') addTicker(ticker)
    if (cond.expanded) {
      const rt = normalizeChoice(cond.rightTicker ?? '')
      if (rt !== 'Empty') addTicker(rt)
    }
  }

  const walk = (node: FlowNode, callStack: string[]) => {
    if (node.kind === 'call') {
      const callId = node.callRefId
      if (!callId) return
      if (callStack.includes(callId)) return
      const target = callMap.get(callId)
      if (!target) return
      const cloned = ensureSlots(cloneNode(target.root))
      walk(cloned, [...callStack, callId])
      return
    }

    // Indicator nodes have conditions with tickers
    if (node.kind === 'indicator' && node.conditions) {
      node.conditions.forEach((c) => collectFromCondition(c))
    }

    // Numbered nodes have items with conditions
    if (node.kind === 'numbered' && node.numbered) {
      node.numbered.items.forEach((item) => {
        item.conditions.forEach((c) => collectFromCondition(c))
      })
    }

    // Alt Exit nodes have entry/exit conditions
    if (node.kind === 'altExit') {
      if (node.entryConditions) node.entryConditions.forEach((c) => collectFromCondition(c))
      if (node.exitConditions) node.exitConditions.forEach((c) => collectFromCondition(c))
    }

    // Scaling nodes have a scale ticker
    if (node.kind === 'scaling') {
      const scaleTicker = normalizeChoice(node.scaleTicker ?? 'SPY')
      if (scaleTicker !== 'Empty') addTicker(scaleTicker)
    }

    // Function nodes sort by a metric on their children (the children are usually positions)
    // The function node itself may reference tickers in the metric context
    // (but typically uses the children's tickers which are position tickers)
    // We don't add function node tickers here since those are in the children

    // Walk all children (including ladder slots)
    for (const slot of getAllSlotsForNode(node)) {
      const arr = node.children[slot] || []
      for (const c of arr) if (c) walk(c, callStack)
    }
  }

  walk(root, [])

  return Array.from(tickers).sort()
}

// PriceDB, IndicatorCache, IndicatorCacheSeriesKey, emptyCache, getSeriesKey,
// getCachedCloseArray, getCachedReturnsArray, getCachedSeries, and all rolling*
// indicator functions are now imported from @/features/backtest

type EvalCtx = {
  db: PriceDB
  cache: IndicatorCache
  decisionIndex: number
  indicatorIndex: number
  decisionPrice: 'open' | 'close'
  warnings: BacktestWarning[]
  resolveCall: (id: string) => FlowNode | null
  trace?: BacktestTraceCollector
}

// Evaluate metric at a specific index (for forDays consecutive day checks)
const metricAtIndex = (ctx: EvalCtx, ticker: string, metric: MetricChoice, window: number, index: number): number | null => {
  const t = getSeriesKey(ticker)
  if (!t || t === 'Empty') return null

  if (metric === 'Current Price') {
    const arr = ctx.decisionPrice === 'open' ? ctx.db.open[t] : ctx.db.close[t]
    const v = arr?.[index]
    return v == null ? null : v
  }

  if (index < 0) return null
  // Use cached close array to avoid rebuilding on every call
  const closes = getCachedCloseArray(ctx.cache, ctx.db, t)
  const w = Math.max(1, Math.floor(Number(window || 0)))

  switch (metric) {
    case 'Simple Moving Average': {
      const series = getCachedSeries(ctx.cache, 'sma', t, w, () => rollingSma(closes, w))
      return series[index] ?? null
    }
    case 'Exponential Moving Average': {
      const series = getCachedSeries(ctx.cache, 'ema', t, w, () => rollingEma(closes, w))
      return series[index] ?? null
    }
    case 'Relative Strength Index': {
      const series = getCachedSeries(ctx.cache, 'rsi', t, w, () => rollingWilderRsi(closes, w))
      return series[index] ?? null
    }
    case 'Standard Deviation': {
      // Use cached returns array to avoid rebuilding on every call
      const rets = getCachedReturnsArray(ctx.cache, ctx.db, t)
      const series = getCachedSeries(ctx.cache, 'std', t, w, () => rollingStdDev(rets, w))
      return series[index] ?? null
    }
    case 'Max Drawdown': {
      const series = getCachedSeries(ctx.cache, 'maxdd', t, w, () => rollingMaxDrawdown(closes, w))
      return series[index] ?? null
    }
    case 'Standard Deviation of Price': {
      const series = getCachedSeries(ctx.cache, 'stdPrice', t, w, () => rollingStdDevOfPrices(closes, w))
      return series[index] ?? null
    }
    case 'Cumulative Return': {
      const series = getCachedSeries(ctx.cache, 'cumRet', t, w, () => rollingCumulativeReturn(closes, w))
      return series[index] ?? null
    }
    case 'SMA of Returns': {
      const series = getCachedSeries(ctx.cache, 'smaRet', t, w, () => rollingSmaOfReturns(closes, w))
      return series[index] ?? null
    }
    // Momentum indicators (no window - fixed lookbacks)
    case 'Momentum (Weighted)': {
      const series = getCachedSeries(ctx.cache, 'mom13612w', t, 0, () => rolling13612W(closes))
      return series[index] ?? null
    }
    case 'Momentum (Unweighted)': {
      const series = getCachedSeries(ctx.cache, 'mom13612u', t, 0, () => rolling13612U(closes))
      return series[index] ?? null
    }
    case 'Momentum (12-Month SMA)': {
      const series = getCachedSeries(ctx.cache, 'momsma12', t, 0, () => rollingSMA12Momentum(closes))
      return series[index] ?? null
    }
    // Drawdown from ATH (no window)
    case 'Drawdown': {
      const series = getCachedSeries(ctx.cache, 'drawdown', t, 0, () => rollingDrawdown(closes))
      return series[index] ?? null
    }
    // Aroon indicators (need high/low prices)
    case 'Aroon Up': {
      const highs = ctx.db.high?.[t]
      if (!highs) return null
      const series = getCachedSeries(ctx.cache, 'aroonUp', t, w, () => rollingAroonUp(highs, w))
      return series[index] ?? null
    }
    case 'Aroon Down': {
      const lows = ctx.db.low?.[t]
      if (!lows) return null
      const series = getCachedSeries(ctx.cache, 'aroonDown', t, w, () => rollingAroonDown(lows, w))
      return series[index] ?? null
    }
    case 'Aroon Oscillator': {
      const highs = ctx.db.high?.[t]
      const lows = ctx.db.low?.[t]
      if (!highs || !lows) return null
      const series = getCachedSeries(ctx.cache, 'aroonOsc', t, w, () => rollingAroonOscillator(highs, lows, w))
      return series[index] ?? null
    }
    // MACD & PPO (fixed 12/26/9 periods)
    case 'MACD Histogram': {
      const series = getCachedSeries(ctx.cache, 'macd', t, 0, () => rollingMACD(closes))
      return series[index] ?? null
    }
    case 'PPO Histogram': {
      const series = getCachedSeries(ctx.cache, 'ppo', t, 0, () => rollingPPO(closes))
      return series[index] ?? null
    }
    // Trend Clarity (R²)
    case 'Trend Clarity': {
      const series = getCachedSeries(ctx.cache, 'trendClarity', t, w, () => rollingTrendClarity(closes, w))
      return series[index] ?? null
    }
    // Ultimate Smoother
    case 'Ultimate Smoother': {
      const series = getCachedSeries(ctx.cache, 'ultSmooth', t, w, () => rollingUltimateSmoother(closes, w))
      return series[index] ?? null
    }
  }
  return null
}

const metricAt = (ctx: EvalCtx, ticker: string, metric: MetricChoice, window: number): number | null => {
  const t = getSeriesKey(ticker)
  if (!t || t === 'Empty') return null

  if (metric === 'Current Price') {
    const arr = ctx.decisionPrice === 'open' ? ctx.db.open[t] : ctx.db.close[t]
    const v = arr?.[ctx.decisionIndex]
    return v == null ? null : v
  }

  const i = ctx.indicatorIndex
  if (i < 0) return null
  // Use cached close array to avoid rebuilding on every call
  const closes = getCachedCloseArray(ctx.cache, ctx.db, t)
  const w = Math.max(1, Math.floor(Number(window || 0)))

  switch (metric) {
    case 'Simple Moving Average': {
      const series = getCachedSeries(ctx.cache, 'sma', t, w, () => rollingSma(closes, w))
      return series[i] ?? null
    }
    case 'Exponential Moving Average': {
      const series = getCachedSeries(ctx.cache, 'ema', t, w, () => rollingEma(closes, w))
      return series[i] ?? null
    }
    case 'Relative Strength Index': {
      const series = getCachedSeries(ctx.cache, 'rsi', t, w, () => rollingWilderRsi(closes, w))
      return series[i] ?? null
    }
    case 'Standard Deviation': {
      // Use cached returns array to avoid rebuilding on every call
      const rets = getCachedReturnsArray(ctx.cache, ctx.db, t)
      const series = getCachedSeries(ctx.cache, 'std', t, w, () => rollingStdDev(rets, w))
      return series[i] ?? null
    }
    case 'Max Drawdown': {
      const series = getCachedSeries(ctx.cache, 'maxdd', t, w, () => rollingMaxDrawdown(closes, w))
      return series[i] ?? null
    }
    case 'Standard Deviation of Price': {
      const series = getCachedSeries(ctx.cache, 'stdPrice', t, w, () => rollingStdDevOfPrices(closes, w))
      return series[i] ?? null
    }
    case 'Cumulative Return': {
      const series = getCachedSeries(ctx.cache, 'cumRet', t, w, () => rollingCumulativeReturn(closes, w))
      return series[i] ?? null
    }
    case 'SMA of Returns': {
      const series = getCachedSeries(ctx.cache, 'smaRet', t, w, () => rollingSmaOfReturns(closes, w))
      return series[i] ?? null
    }
    // Momentum indicators (no window - fixed lookbacks)
    case 'Momentum (Weighted)': {
      const series = getCachedSeries(ctx.cache, 'mom13612w', t, 0, () => rolling13612W(closes))
      return series[i] ?? null
    }
    case 'Momentum (Unweighted)': {
      const series = getCachedSeries(ctx.cache, 'mom13612u', t, 0, () => rolling13612U(closes))
      return series[i] ?? null
    }
    case 'Momentum (12-Month SMA)': {
      const series = getCachedSeries(ctx.cache, 'momsma12', t, 0, () => rollingSMA12Momentum(closes))
      return series[i] ?? null
    }
    // Drawdown from ATH (no window)
    case 'Drawdown': {
      const series = getCachedSeries(ctx.cache, 'drawdown', t, 0, () => rollingDrawdown(closes))
      return series[i] ?? null
    }
    // Aroon indicators (need high/low prices)
    case 'Aroon Up': {
      const highs = ctx.db.high?.[t]
      if (!highs) return null
      const series = getCachedSeries(ctx.cache, 'aroonUp', t, w, () => rollingAroonUp(highs, w))
      return series[i] ?? null
    }
    case 'Aroon Down': {
      const lows = ctx.db.low?.[t]
      if (!lows) return null
      const series = getCachedSeries(ctx.cache, 'aroonDown', t, w, () => rollingAroonDown(lows, w))
      return series[i] ?? null
    }
    case 'Aroon Oscillator': {
      const highs = ctx.db.high?.[t]
      const lows = ctx.db.low?.[t]
      if (!highs || !lows) return null
      const series = getCachedSeries(ctx.cache, 'aroonOsc', t, w, () => rollingAroonOscillator(highs, lows, w))
      return series[i] ?? null
    }
    // MACD & PPO (fixed 12/26/9 periods)
    case 'MACD Histogram': {
      const series = getCachedSeries(ctx.cache, 'macd', t, 0, () => rollingMACD(closes))
      return series[i] ?? null
    }
    case 'PPO Histogram': {
      const series = getCachedSeries(ctx.cache, 'ppo', t, 0, () => rollingPPO(closes))
      return series[i] ?? null
    }
    // Trend Clarity (R²)
    case 'Trend Clarity': {
      const series = getCachedSeries(ctx.cache, 'trendClarity', t, w, () => rollingTrendClarity(closes, w))
      return series[i] ?? null
    }
    // Ultimate Smoother
    case 'Ultimate Smoother': {
      const series = getCachedSeries(ctx.cache, 'ultSmooth', t, w, () => rollingUltimateSmoother(closes, w))
      return series[i] ?? null
    }
  }
  return null
}

const conditionExpr = (cond: ConditionLine): string => {
  const leftPrefix = isWindowlessIndicator(cond.metric) ? '' : `${Math.floor(Number(cond.window || 0))}d `
  const left = `${leftPrefix}${cond.metric} of ${normalizeChoice(cond.ticker)}`
  const cmp = normalizeComparatorChoice(cond.comparator) === 'lt' ? '<' : '>'
  const forDaysSuffix = cond.forDays && cond.forDays > 1 ? ` for ${cond.forDays} days` : ''
  if (!cond.expanded) return `${left} ${cmp} ${String(cond.threshold)}${forDaysSuffix}`

  const rightMetric = cond.rightMetric ?? cond.metric
  const rightTicker = normalizeChoice(cond.rightTicker ?? cond.ticker)
  const rightWindow = Math.floor(Number((cond.rightWindow ?? cond.window) || 0))
  const rightPrefix = isWindowlessIndicator(rightMetric) ? '' : `${rightWindow}d `
  const right = `${rightPrefix}${rightMetric} of ${rightTicker}`
  return `${left} ${cmp} ${right}${forDaysSuffix}`
}

const createBacktestTraceCollector = (): BacktestTraceCollector => {
  const branches = new Map<string, { thenCount: number; elseCount: number; kind: BacktestNodeTrace['kind'] }>()
  const conditionsByOwner = new Map<string, Map<string, BacktestConditionTrace>>()
  const altExitStates = new Map<string, 'then' | 'else'>()

  const recordBranch: BacktestTraceCollector['recordBranch'] = (nodeId, kind, ok) => {
    const cur = branches.get(nodeId) ?? { thenCount: 0, elseCount: 0, kind }
    cur.kind = kind
    if (ok) cur.thenCount += 1
    else cur.elseCount += 1
    branches.set(nodeId, cur)
  }

  const recordCondition: BacktestTraceCollector['recordCondition'] = (traceOwnerId, cond, ok, sample) => {
    let byCond = conditionsByOwner.get(traceOwnerId)
    if (!byCond) {
      byCond = new Map()
      conditionsByOwner.set(traceOwnerId, byCond)
    }
    const existing =
      byCond.get(cond.id) ??
      ({
        id: cond.id,
        type: normalizeConditionType(cond.type, 'and'),
        expr: conditionExpr(cond),
        trueCount: 0,
        falseCount: 0,
      } satisfies BacktestConditionTrace)

    existing.expr = conditionExpr(cond)
    existing.type = normalizeConditionType(cond.type, existing.type)

    if (ok) {
      existing.trueCount += 1
      if (!existing.firstTrue) existing.firstTrue = sample
    } else {
      existing.falseCount += 1
      if (!existing.firstFalse) existing.firstFalse = sample
    }
    byCond.set(cond.id, existing)
  }

  const toResult: BacktestTraceCollector['toResult'] = () => {
    const nodes: BacktestNodeTrace[] = []
    const owners = new Set<string>([...branches.keys(), ...conditionsByOwner.keys()])
    for (const owner of owners) {
      const branch = branches.get(owner) ?? {
        thenCount: 0,
        elseCount: 0,
        kind: owner.includes(':') ? 'numbered-item' : 'indicator',
      }
      const conds = conditionsByOwner.get(owner)
      nodes.push({
        nodeId: owner,
        kind: branch.kind,
        thenCount: branch.thenCount,
        elseCount: branch.elseCount,
        conditions: conds ? Array.from(conds.values()) : [],
      })
    }
    nodes.sort((a, b) => b.thenCount + b.elseCount - (a.thenCount + a.elseCount))
    return { nodes }
  }

  const getAltExitState: BacktestTraceCollector['getAltExitState'] = (nodeId) => {
    return altExitStates.get(nodeId) ?? null
  }

  const setAltExitState: BacktestTraceCollector['setAltExitState'] = (nodeId, state) => {
    altExitStates.set(nodeId, state)
  }

  return { recordBranch, recordCondition, toResult, getAltExitState, setAltExitState }
}

// Evaluate a single condition at a specific index (for forDays support)
const evalConditionAtIndex = (ctx: EvalCtx, cond: ConditionLine, index: number): boolean => {
  const cmp = normalizeComparatorChoice(cond.comparator)
  const left = metricAtIndex(ctx, cond.ticker, cond.metric, cond.window, index)
  if (cond.expanded) {
    const rightMetric = cond.rightMetric ?? cond.metric
    const rightTicker = cond.rightTicker ?? cond.ticker
    const rightWindow = cond.rightWindow ?? cond.window
    const right = metricAtIndex(ctx, rightTicker, rightMetric, rightWindow, index)
    if (left == null || right == null) return false
    return cmp === 'lt' ? left < right : left > right
  }
  if (left == null) return false
  return cmp === 'lt' ? left < cond.threshold : left > cond.threshold
}

const evalCondition = (ctx: EvalCtx, ownerId: string, traceOwnerId: string, cond: ConditionLine): boolean => {
  const forDays = cond.forDays || 1
  const cmp = normalizeComparatorChoice(cond.comparator)

  // For forDays > 1, check that the condition was true for the past N consecutive days
  if (forDays > 1) {
    for (let dayOffset = 0; dayOffset < forDays; dayOffset++) {
      const checkIndex = ctx.indicatorIndex - dayOffset
      if (checkIndex < 0) {
        // Not enough history to check
        ctx.trace?.recordCondition(traceOwnerId, cond, false, {
          date: isoFromUtcSeconds(ctx.db.dates[ctx.decisionIndex]),
          left: null,
          threshold: cond.threshold,
        })
        return false
      }
      if (!evalConditionAtIndex(ctx, cond, checkIndex)) {
        // Condition failed on one of the days
        const left = metricAtIndex(ctx, cond.ticker, cond.metric, cond.window, ctx.indicatorIndex)
        ctx.trace?.recordCondition(traceOwnerId, cond, false, {
          date: isoFromUtcSeconds(ctx.db.dates[ctx.decisionIndex]),
          left,
          threshold: cond.threshold,
        })
        return false
      }
    }
    // All days passed
    const left = metricAtIndex(ctx, cond.ticker, cond.metric, cond.window, ctx.indicatorIndex)
    ctx.trace?.recordCondition(traceOwnerId, cond, true, {
      date: isoFromUtcSeconds(ctx.db.dates[ctx.decisionIndex]),
      left,
      threshold: cond.threshold,
    })
    return true
  }

  // Standard single-day evaluation (forDays = 1)
  const left = metricAt(ctx, cond.ticker, cond.metric, cond.window)
  if (cond.expanded) {
    const rightMetric = cond.rightMetric ?? cond.metric
    const rightTicker = cond.rightTicker ?? cond.ticker
    const rightWindow = cond.rightWindow ?? cond.window
    const right = metricAt(ctx, rightTicker, rightMetric, rightWindow)

    if (left == null || right == null) {
      ctx.warnings.push({
        time: ctx.db.dates[ctx.decisionIndex],
        date: isoFromUtcSeconds(ctx.db.dates[ctx.decisionIndex]),
        message: `Missing data for condition on ${ownerId}.`,
      })
      ctx.trace?.recordCondition(traceOwnerId, cond, false, {
        date: isoFromUtcSeconds(ctx.db.dates[ctx.decisionIndex]),
        left,
        right,
      })
      return false
    }
    const ok = cmp === 'lt' ? left < right : left > right
    ctx.trace?.recordCondition(traceOwnerId, cond, ok, {
      date: isoFromUtcSeconds(ctx.db.dates[ctx.decisionIndex]),
      left,
      right,
    })
    return ok
  }

  if (left == null) {
    ctx.warnings.push({
      time: ctx.db.dates[ctx.decisionIndex],
      date: isoFromUtcSeconds(ctx.db.dates[ctx.decisionIndex]),
      message: `Missing data for condition on ${ownerId}.`,
    })
    ctx.trace?.recordCondition(traceOwnerId, cond, false, {
      date: isoFromUtcSeconds(ctx.db.dates[ctx.decisionIndex]),
      left,
      threshold: cond.threshold,
    })
    return false
  }
  const ok = cmp === 'lt' ? left < cond.threshold : left > cond.threshold
  ctx.trace?.recordCondition(traceOwnerId, cond, ok, {
    date: isoFromUtcSeconds(ctx.db.dates[ctx.decisionIndex]),
    left,
    threshold: cond.threshold,
  })
  return ok
}

const evalConditions = (
  ctx: EvalCtx,
  ownerId: string,
  conditions: ConditionLine[] | undefined,
  traceOwnerId: string = ownerId,
): boolean => {
  if (!conditions || conditions.length === 0) return false

  // Standard boolean precedence: AND binds tighter than OR.
  // Example: `A or B and C` => `A || (B && C)`.
  let currentAnd: boolean | null = null
  const orTerms: boolean[] = []

  for (const c of conditions) {
    const v = evalCondition(ctx, ownerId, traceOwnerId, c)
    const t = normalizeConditionType(c.type, 'and')
    if (t === 'if') {
      if (currentAnd !== null) orTerms.push(currentAnd)
      currentAnd = v
      continue
    }

    if (currentAnd === null) {
      currentAnd = v
      continue
    }

    if (t === 'and') {
      currentAnd = currentAnd && v
      continue
    }

    if (t === 'or') {
      orTerms.push(currentAnd)
      currentAnd = v
      continue
    }

    currentAnd = v
  }

  if (currentAnd !== null) orTerms.push(currentAnd)
  return orTerms.some(Boolean)
}

const volForAlloc = (ctx: EvalCtx, alloc: Allocation, window: number): number | null => {
  const w = Math.max(1, Math.floor(Number(window || 0)))
  let sumSq = 0
  let any = false
  for (const [ticker, weight] of Object.entries(alloc)) {
    if (!(weight > 0)) continue
    const std = metricAt(ctx, ticker, 'Standard Deviation', w)
    if (std == null) continue
    any = true
    sumSq += (weight * std) ** 2
  }
  return any ? Math.sqrt(sumSq) : null
}

const weightChildren = (
  ctx: EvalCtx,
  parent: FlowNode,
  slot: SlotId,
  children: FlowNode[],
  allocs: Allocation[],
): Array<{ child: FlowNode; alloc: Allocation; share: number }> => {
  const { mode, volWindow, cappedFallback } = getSlotConfig(parent, slot)

  const active = children
    .map((child, idx) => ({ child, alloc: allocs[idx] }))
    .filter((x) => Object.keys(x.alloc).length > 0)

  if (active.length === 0) return []

  if (mode === 'equal') {
    const share = 1 / active.length
    return active.map((x) => ({ ...x, share }))
  }

  if (mode === 'defined') {
    const weights = active.map((x) => Math.max(0, Number(x.child.window || 0)))
    const total = weights.reduce((a, b) => a + b, 0)
    if (!(total > 0)) return active.map((x) => ({ ...x, share: 0 }))
    return active.map((x, i) => ({ ...x, share: weights[i] / total }))
  }

  if (mode === 'inverse' || mode === 'pro') {
    const vols = active.map((x) => volForAlloc(ctx, x.alloc, volWindow) ?? null)
    const rawWeights = vols.map((v) => {
      if (!v || !(v > 0)) return 0
      return mode === 'inverse' ? 1 / v : v
    })
    const total = rawWeights.reduce((a, b) => a + b, 0)
    if (!(total > 0)) {
      const share = 1 / active.length
      return active.map((x) => ({ ...x, share }))
    }
    return active.map((x, i) => ({ ...x, share: rawWeights[i] / total }))
  }

  // capped
  let remaining = 1
  const out: Array<{ child: FlowNode; alloc: Allocation; share: number }> = []
  for (const x of active) {
    if (!(remaining > 0)) break
    const capPct = Math.max(0, Number(x.child.window || 0))
    const cap = Math.min(1, capPct / 100)
    if (!(cap > 0)) continue
    const share = Math.min(cap, remaining)
    remaining -= share
    out.push({ ...x, share })
  }

  if (remaining > 0 && !isEmptyChoice(cappedFallback)) {
    out.push({
      child: { ...parent, id: `${parent.id}-capped-fallback` } as FlowNode,
      alloc: { [getSeriesKey(cappedFallback)]: 1 },
      share: remaining,
    })
  }

  return out
}

const evaluateNode = (ctx: EvalCtx, node: FlowNode, callStack: string[] = []): Allocation => {
  switch (node.kind) {
    case 'position': {
      const tickers = (node.positions || []).map(normalizeChoice).filter((t) => t !== 'Empty')
      if (tickers.length === 0) return {}
      const unique = Array.from(new Set(tickers))
      const share = 1 / unique.length
      const alloc: Allocation = {}
      for (const t of unique) alloc[t] = (alloc[t] || 0) + share
      return alloc
    }
    case 'call': {
      const callId = node.callRefId
      if (!callId) return {}
      if (callStack.includes(callId)) {
        ctx.warnings.push({
          time: ctx.db.dates[ctx.decisionIndex],
          date: isoFromUtcSeconds(ctx.db.dates[ctx.decisionIndex]),
          message: `Call "${callId}" is referencing itself.`,
        })
        return {}
      }
      const resolved = ctx.resolveCall(callId)
      if (!resolved) {
        ctx.warnings.push({
          time: ctx.db.dates[ctx.decisionIndex],
          date: isoFromUtcSeconds(ctx.db.dates[ctx.decisionIndex]),
          message: `Call "${callId}" could not be found.`,
        })
        return {}
      }
      return evaluateNode(ctx, resolved, [...callStack, callId])
    }
    case 'basic': {
      const children = (node.children.next || []).filter((c): c is FlowNode => Boolean(c))
      const childAllocs = children.map((c) => evaluateNode(ctx, c, callStack))
      const weighted = weightChildren(ctx, node, 'next', children, childAllocs)
      const out: Allocation = {}
      for (const w of weighted) mergeAlloc(out, w.alloc, w.share)
      return normalizeAlloc(out)
    }
    case 'indicator': {
      const ok = evalConditions(ctx, node.id, node.conditions)
      ctx.trace?.recordBranch(node.id, 'indicator', ok)
      const slot: SlotId = ok ? 'then' : 'else'
      const children = (node.children[slot] || []).filter((c): c is FlowNode => Boolean(c))
      const childAllocs = children.map((c) => evaluateNode(ctx, c, callStack))
      const weighted = weightChildren(ctx, node, slot, children, childAllocs)
      const out: Allocation = {}
      for (const w of weighted) mergeAlloc(out, w.alloc, w.share)
      return normalizeAlloc(out)
    }
    case 'numbered': {
      const items = node.numbered?.items || []
      const itemTruth = items.map((it) => evalConditions(ctx, node.id, it.conditions, `${node.id}:${it.id}`))
      const nTrue = itemTruth.filter(Boolean).length
      const q = node.numbered?.quantifier ?? 'all'
      const n = Math.max(0, Math.floor(Number(node.numbered?.n ?? 0)))

      // Handle ladder mode: select ladder-N slot based on how many conditions are true
      if (q === 'ladder') {
        const slotKey = `ladder-${nTrue}` as SlotId
        ctx.trace?.recordBranch(node.id, 'numbered', nTrue > 0)
        const children = (node.children[slotKey] || []).filter((c): c is FlowNode => Boolean(c))
        const childAllocs = children.map((c) => evaluateNode(ctx, c, callStack))
        const weighted = weightChildren(ctx, node, slotKey, children, childAllocs)
        const out: Allocation = {}
        for (const w of weighted) mergeAlloc(out, w.alloc, w.share)
        return normalizeAlloc(out)
      }

      const ok =
        q === 'any'
          ? nTrue >= 1
          : q === 'all'
            ? nTrue === items.length
            : q === 'none'
              ? nTrue === 0
              : q === 'exactly'
                ? nTrue === n
                : q === 'atLeast'
                  ? nTrue >= n
                  : nTrue <= n
      ctx.trace?.recordBranch(node.id, 'numbered', ok)
      const slot: SlotId = ok ? 'then' : 'else'
      const children = (node.children[slot] || []).filter((c): c is FlowNode => Boolean(c))
      const childAllocs = children.map((c) => evaluateNode(ctx, c, callStack))
      const weighted = weightChildren(ctx, node, slot, children, childAllocs)
      const out: Allocation = {}
      for (const w of weighted) mergeAlloc(out, w.alloc, w.share)
      return normalizeAlloc(out)
    }
    case 'function': {
      const children = (node.children.next || []).filter((c): c is FlowNode => Boolean(c))
      const candidateAllocs = children.map((c) => evaluateNode(ctx, c, callStack))
      const candidates = children
        .map((child, idx) => ({ child, alloc: candidateAllocs[idx] }))
        .filter((x) => Object.keys(x.alloc).length > 0)

      const metric = node.metric ?? 'Relative Strength Index'
      const win = isWindowlessIndicator(metric) ? 1 : Math.floor(Number(node.window ?? 10))
      const pickN = Math.max(1, Math.floor(Number(node.bottom ?? 1)))
      const rank = node.rank ?? 'Bottom'

      const scored = candidates
        .map((c) => {
          const vals: number[] = []
          for (const [t, w] of Object.entries(c.alloc)) {
            if (!(w > 0)) continue
            const mv = metricAt(ctx, t, metric, win)
            if (mv == null) continue
            vals.push(mv * w)
          }
          const score = vals.reduce((a, b) => a + b, 0)
          return { ...c, score: Number.isFinite(score) ? score : null }
        })
        .filter((x) => x.score != null)

      if (scored.length === 0) return {}

      scored.sort((a, b) => (a.score as number) - (b.score as number))
      const selected = rank === 'Bottom' ? scored.slice(0, pickN) : scored.slice(-pickN)

      const selChildren = selected.map((s) => s.child)
      const selAllocs = selected.map((s) => s.alloc)
      const weighted = weightChildren(ctx, node, 'next', selChildren, selAllocs)
      const out: Allocation = {}
      for (const w of weighted) mergeAlloc(out, w.alloc, w.share)
      return normalizeAlloc(out)
    }
    case 'altExit': {
      // Evaluate both entry and exit conditions
      const entryOk = evalConditions(ctx, node.id, node.entryConditions, `${node.id}:entry`)
      const exitOk = evalConditions(ctx, node.id, node.exitConditions, `${node.id}:exit`)

      // Get previous state from trace (or null for first bar)
      const prevState = ctx.trace?.getAltExitState(node.id) ?? null

      let currentState: 'then' | 'else'
      if (prevState === null) {
        // First bar: entry takes priority
        currentState = entryOk ? 'then' : 'else'
      } else if (prevState === 'then') {
        // In THEN: only exit condition can change us
        currentState = exitOk ? 'else' : 'then'
      } else {
        // In ELSE: only entry condition can change us
        currentState = entryOk ? 'then' : 'else'
      }

      // Store current state for next bar
      ctx.trace?.setAltExitState(node.id, currentState)
      ctx.trace?.recordBranch(node.id, 'altExit', currentState === 'then')

      const slot: SlotId = currentState
      const children = (node.children[slot] || []).filter((c): c is FlowNode => Boolean(c))
      const childAllocs = children.map((c) => evaluateNode(ctx, c, callStack))
      const weighted = weightChildren(ctx, node, slot, children, childAllocs)
      const out: Allocation = {}
      for (const w of weighted) mergeAlloc(out, w.alloc, w.share)
      return normalizeAlloc(out)
    }
    case 'scaling': {
      const metric = node.scaleMetric ?? 'Relative Strength Index'
      const win = Math.floor(Number(node.scaleWindow ?? 14))
      const ticker = node.scaleTicker ?? 'SPY'
      const fromVal = Number(node.scaleFrom ?? 30)
      const toVal = Number(node.scaleTo ?? 70)

      const currentVal = metricAt(ctx, ticker, metric, win)

      // Calculate weights
      let thenWeight: number
      let elseWeight: number

      if (currentVal == null) {
        // No data available - default to 50/50
        thenWeight = 0.5
        elseWeight = 0.5
      } else {
        const isInverted = fromVal > toVal
        const low = isInverted ? toVal : fromVal
        const high = isInverted ? fromVal : toVal

        if (currentVal <= low) {
          thenWeight = isInverted ? 0 : 1
          elseWeight = isInverted ? 1 : 0
        } else if (currentVal >= high) {
          thenWeight = isInverted ? 1 : 0
          elseWeight = isInverted ? 0 : 1
        } else {
          const ratio = (currentVal - low) / (high - low)
          elseWeight = isInverted ? (1 - ratio) : ratio
          thenWeight = 1 - elseWeight
        }
      }

      ctx.trace?.recordBranch(node.id, 'scaling', thenWeight > 0.5)

      // Evaluate both branches and blend allocations
      const thenChildren = (node.children.then || []).filter((c): c is FlowNode => Boolean(c))
      const elseChildren = (node.children.else || []).filter((c): c is FlowNode => Boolean(c))

      const thenAllocs = thenChildren.map((c) => evaluateNode(ctx, c, callStack))
      const elseAllocs = elseChildren.map((c) => evaluateNode(ctx, c, callStack))

      const thenWeighted = weightChildren(ctx, node, 'then', thenChildren, thenAllocs)
      const elseWeighted = weightChildren(ctx, node, 'else', elseChildren, elseAllocs)

      const out: Allocation = {}
      for (const w of thenWeighted) mergeAlloc(out, w.alloc, w.share * thenWeight)
      for (const w of elseWeighted) mergeAlloc(out, w.alloc, w.share * elseWeight)
      return normalizeAlloc(out)
    }
  }
}

// Trace which position nodes contributed to an allocation
// Returns array of { nodeId, title, weight } for each contributing position node
type PositionContribution = { nodeId: string; title: string; weight: number }

const tracePositionContributions = (
  ctx: EvalCtx,
  node: FlowNode,
  parentWeight: number = 1,
  callStack: string[] = [],
): PositionContribution[] => {
  if (parentWeight < 0.0001) return []

  switch (node.kind) {
    case 'position': {
      const tickers = (node.positions || []).map(normalizeChoice).filter((t) => t !== 'Empty')
      if (tickers.length === 0) return []
      return [{
        nodeId: node.id,
        title: node.title || tickers.join(', '),
        weight: parentWeight,
      }]
    }
    case 'call': {
      const callId = node.callRefId
      if (!callId || callStack.includes(callId)) return []
      const resolved = ctx.resolveCall(callId)
      if (!resolved) return []
      return tracePositionContributions(ctx, resolved, parentWeight, [...callStack, callId])
    }
    case 'basic': {
      const children = (node.children.next || []).filter((c): c is FlowNode => Boolean(c))
      const childAllocs = children.map((c) => evaluateNode(ctx, c, callStack))
      const weighted = weightChildren(ctx, node, 'next', children, childAllocs)
      const result: PositionContribution[] = []
      for (const w of weighted) {
        const childIdx = children.indexOf(w.child)
        if (childIdx >= 0) {
          result.push(...tracePositionContributions(ctx, w.child, parentWeight * w.share, callStack))
        }
      }
      return result
    }
    case 'indicator': {
      const ok = evalConditions(ctx, node.id, node.conditions)
      const slot: SlotId = ok ? 'then' : 'else'
      const children = (node.children[slot] || []).filter((c): c is FlowNode => Boolean(c))
      const childAllocs = children.map((c) => evaluateNode(ctx, c, callStack))
      const weighted = weightChildren(ctx, node, slot, children, childAllocs)
      const result: PositionContribution[] = []
      for (const w of weighted) {
        result.push(...tracePositionContributions(ctx, w.child, parentWeight * w.share, callStack))
      }
      return result
    }
    case 'numbered': {
      const items = node.numbered?.items || []
      const itemTruth = items.map((it) => evalConditions(ctx, node.id, it.conditions, `${node.id}:${it.id}`))
      const nTrue = itemTruth.filter(Boolean).length
      const q = node.numbered?.quantifier ?? 'all'
      const n = Math.max(0, Math.floor(Number(node.numbered?.n ?? 0)))

      let slot: SlotId
      if (q === 'ladder') {
        slot = `ladder-${nTrue}` as SlotId
      } else {
        const ok =
          q === 'any' ? nTrue >= 1
          : q === 'all' ? nTrue === items.length
          : q === 'none' ? nTrue === 0
          : q === 'exactly' ? nTrue === n
          : q === 'atLeast' ? nTrue >= n
          : nTrue <= n
        slot = ok ? 'then' : 'else'
      }

      const children = (node.children[slot] || []).filter((c): c is FlowNode => Boolean(c))
      const childAllocs = children.map((c) => evaluateNode(ctx, c, callStack))
      const weighted = weightChildren(ctx, node, slot, children, childAllocs)
      const result: PositionContribution[] = []
      for (const w of weighted) {
        result.push(...tracePositionContributions(ctx, w.child, parentWeight * w.share, callStack))
      }
      return result
    }
    case 'function': {
      const children = (node.children.next || []).filter((c): c is FlowNode => Boolean(c))
      const candidateAllocs = children.map((c) => evaluateNode(ctx, c, callStack))
      const candidates = children
        .map((child, idx) => ({ child, alloc: candidateAllocs[idx] }))
        .filter((x) => Object.keys(x.alloc).length > 0)

      const metric = node.metric ?? 'Relative Strength Index'
      const win = isWindowlessIndicator(metric) ? 1 : Math.floor(Number(node.window ?? 10))
      const pickN = Math.max(1, Math.floor(Number(node.bottom ?? 1)))
      const rank = node.rank ?? 'Bottom'

      const scored = candidates
        .map((c) => {
          const vals: number[] = []
          for (const [t, w] of Object.entries(c.alloc)) {
            if (!(w > 0)) continue
            const mv = metricAt(ctx, t, metric, win)
            if (mv == null) continue
            vals.push(mv * w)
          }
          const score = vals.reduce((a, b) => a + b, 0)
          return { ...c, score: Number.isFinite(score) ? score : null }
        })
        .filter((x) => x.score != null)

      if (scored.length === 0) return []

      scored.sort((a, b) => (a.score as number) - (b.score as number))
      const selected = rank === 'Bottom' ? scored.slice(0, pickN) : scored.slice(-pickN)

      const selChildren = selected.map((s) => s.child)
      const selAllocs = selected.map((s) => s.alloc)
      const weighted = weightChildren(ctx, node, 'next', selChildren, selAllocs)
      const result: PositionContribution[] = []
      for (const w of weighted) {
        const origChild = selected.find((s) => s.child === w.child)?.child
        if (origChild) {
          result.push(...tracePositionContributions(ctx, origChild, parentWeight * w.share, callStack))
        }
      }
      return result
    }
    case 'altExit': {
      const entryOk = evalConditions(ctx, node.id, node.entryConditions, `${node.id}:entry`)
      const exitOk = evalConditions(ctx, node.id, node.exitConditions, `${node.id}:exit`)
      const prevState = ctx.trace?.getAltExitState(node.id) ?? null
      let currentState: 'then' | 'else'
      if (prevState === null) {
        currentState = entryOk ? 'then' : 'else'
      } else if (prevState === 'then') {
        currentState = exitOk ? 'else' : 'then'
      } else {
        currentState = entryOk ? 'then' : 'else'
      }
      const slot: SlotId = currentState
      const children = (node.children[slot] || []).filter((c): c is FlowNode => Boolean(c))
      const childAllocs = children.map((c) => evaluateNode(ctx, c, callStack))
      const weighted = weightChildren(ctx, node, slot, children, childAllocs)
      const result: PositionContribution[] = []
      for (const w of weighted) {
        result.push(...tracePositionContributions(ctx, w.child, parentWeight * w.share, callStack))
      }
      return result
    }
    case 'scaling': {
      const metric = node.scaleMetric ?? 'Relative Strength Index'
      const win = Math.floor(Number(node.scaleWindow ?? 14))
      const ticker = node.scaleTicker ?? 'SPY'
      const fromVal = Number(node.scaleFrom ?? 30)
      const toVal = Number(node.scaleTo ?? 70)
      const currentVal = metricAt(ctx, ticker, metric, win)

      let thenWeight: number
      let elseWeight: number
      if (currentVal == null) {
        thenWeight = 0.5
        elseWeight = 0.5
      } else {
        const isInverted = fromVal > toVal
        const low = isInverted ? toVal : fromVal
        const high = isInverted ? fromVal : toVal
        if (currentVal <= low) {
          thenWeight = isInverted ? 0 : 1
          elseWeight = isInverted ? 1 : 0
        } else if (currentVal >= high) {
          thenWeight = isInverted ? 1 : 0
          elseWeight = isInverted ? 0 : 1
        } else {
          const ratio = (currentVal - low) / (high - low)
          elseWeight = isInverted ? (1 - ratio) : ratio
          thenWeight = 1 - elseWeight
        }
      }

      const result: PositionContribution[] = []
      const thenChildren = (node.children.then || []).filter((c): c is FlowNode => Boolean(c))
      const elseChildren = (node.children.else || []).filter((c): c is FlowNode => Boolean(c))

      const thenAllocs = thenChildren.map((c) => evaluateNode(ctx, c, callStack))
      const elseAllocs = elseChildren.map((c) => evaluateNode(ctx, c, callStack))

      const thenWeighted = weightChildren(ctx, node, 'then', thenChildren, thenAllocs)
      const elseWeighted = weightChildren(ctx, node, 'else', elseChildren, elseAllocs)

      for (const w of thenWeighted) {
        result.push(...tracePositionContributions(ctx, w.child, parentWeight * thenWeight * w.share, callStack))
      }
      for (const w of elseWeighted) {
        result.push(...tracePositionContributions(ctx, w.child, parentWeight * elseWeight * w.share, callStack))
      }
      return result
    }
    default:
      return []
  }
}

const turnoverFraction = (prev: Allocation, next: Allocation) => {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next), '__CASH__'])
  const prevTotal = sumAlloc(prev)
  const nextTotal = sumAlloc(next)
  const prevCash = Math.max(0, 1 - prevTotal)
  const nextCash = Math.max(0, 1 - nextTotal)
  let sumAbs = 0
  for (const k of keys) {
    const a = k === '__CASH__' ? prevCash : prev[k] || 0
    const b = k === '__CASH__' ? nextCash : next[k] || 0
    sumAbs += Math.abs(a - b)
  }
  return sumAbs / 2
}

// computeMetrics, computeMonthlyReturns, and computeBacktestSummary imported from @/features/backtest

const fetchOhlcSeries = async (ticker: string, limit: number): Promise<Array<{ time: UTCTimestamp; open: number; close: number; adjClose: number }>> => {
  const t = encodeURIComponent(getSeriesKey(ticker))
  const res = await fetch(`/api/candles/${t}?limit=${encodeURIComponent(String(limit))}`)
  const text = await res.text()
  let payload: unknown = null
  try {
    payload = text ? (JSON.parse(text) as unknown) : null
  } catch {
    throw new Error(`Failed to load ${ticker} candles. Non-JSON response: ${text ? text.slice(0, 200) : '<empty>'}`)
  }
  if (!res.ok) {
    const err = payload && typeof payload === 'object' && 'error' in payload ? String((payload as { error?: unknown }).error) : `HTTP ${res.status}`
    throw new Error(`Failed to load ${ticker} candles. ${err}`)
  }
  const candles = (payload as AdminCandlesResponse).candles || []
  return candles.map((c) => ({ time: c.time as UTCTimestamp, open: Number(c.open), close: Number(c.close), adjClose: Number((c as unknown as { adjClose?: number }).adjClose ?? c.close) }))
}

// Client-side ticker data cache for faster subsequent backtests
type CachedOhlcData = Array<{ time: UTCTimestamp; open: number; close: number; adjClose: number }>
const ohlcDataCache = new Map<string, { data: CachedOhlcData; limit: number; timestamp: number }>()

// Batch fetch multiple tickers in a single request (much faster than individual fetches)
const fetchOhlcSeriesBatch = async (
  tickers: string[],
  limit: number
): Promise<Map<string, CachedOhlcData>> => {
  const results = new Map<string, CachedOhlcData>()
  const now = Date.now()
  const tickersToFetch: string[] = []

  // Check cache first
  for (const ticker of tickers) {
    const key = getSeriesKey(ticker)
    const cached = ohlcDataCache.get(key)
    if (cached && cached.limit >= limit && now - cached.timestamp < OHLC_CACHE_TTL) {
      results.set(ticker, cached.data)
    } else {
      tickersToFetch.push(ticker)
    }
  }

  if (tickersToFetch.length === 0) {
    console.log(`[Backtest] All ${tickers.length} tickers served from cache`)
    return results
  }

  console.log(`[Backtest] Fetching ${tickersToFetch.length} tickers via batch API (${results.size} from cache)`)

  // Batch fetch in chunks of 500 (server limit)
  const BATCH_SIZE = 500
  for (let i = 0; i < tickersToFetch.length; i += BATCH_SIZE) {
    const batch = tickersToFetch.slice(i, i + BATCH_SIZE)
    const normalizedBatch = batch.map((t) => getSeriesKey(t))

    try {
      const res = await fetch('/api/candles/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: normalizedBatch, limit }),
      })

      if (!res.ok) {
        throw new Error(`Batch fetch failed: HTTP ${res.status}`)
      }

      const payload = (await res.json()) as {
        success: boolean
        results: Record<string, Array<{ time: number; open: number; close: number; adjClose: number }>>
        errors?: string[]
      }

      // Process results and cache them
      for (const [tickerKey, candles] of Object.entries(payload.results)) {
        const data = candles.map((c) => ({
          time: c.time as UTCTimestamp,
          open: Number(c.open),
          close: Number(c.close),
          adjClose: Number(c.adjClose ?? c.close),
        }))
        // Find original ticker (might have different case)
        const originalTicker = batch.find((t) => getSeriesKey(t) === tickerKey) || tickerKey
        results.set(originalTicker, data)
        ohlcDataCache.set(tickerKey, { data, limit, timestamp: now })
      }

      if (payload.errors && payload.errors.length > 0) {
        console.warn('[Backtest] Batch fetch errors:', payload.errors)
      }
    } catch (err) {
      console.error('[Backtest] Batch fetch failed, falling back to individual fetches:', err)
      // Fallback to individual fetches for this batch
      await Promise.all(
        batch.map(async (ticker) => {
          try {
            const data = await fetchOhlcSeries(ticker, limit)
            results.set(ticker, data)
            ohlcDataCache.set(getSeriesKey(ticker), { data, limit, timestamp: now })
          } catch (e) {
            console.warn(`[Backtest] Failed to fetch ${ticker}:`, e)
          }
        })
      )
    }
  }

  return results
}

// Build price database from series data
// dateIntersectionTickers: if provided, only these tickers are used to calculate the date intersection
// This allows indicator tickers (with longer history) to set the date range, while position tickers
// (which may have shorter history) just get null values for dates before their data starts
const buildPriceDb = (
  series: Array<{ ticker: string; bars: Array<{ time: UTCTimestamp; open: number; close: number; adjClose: number }> }>,
  dateIntersectionTickers?: string[]
): PriceDB => {
  const byTicker = new Map<string, Map<number, { open: number; close: number; adjClose: number }>>()
  const tickerCounts: Record<string, number> = {}
  let overlapStart = 0
  let overlapEnd = Number.POSITIVE_INFINITY
  let limitingTicker: string | undefined

  // Build the set of tickers to use for date intersection
  const intersectionSet = dateIntersectionTickers
    ? new Set(dateIntersectionTickers.map((t) => getSeriesKey(t)))
    : null

  for (const s of series) {
    const t = getSeriesKey(s.ticker)
    const map = new Map<number, { open: number; close: number; adjClose: number }>()
    for (const b of s.bars) map.set(Number(b.time), { open: Number(b.open), close: Number(b.close), adjClose: Number(b.adjClose) })
    byTicker.set(t, map)
    tickerCounts[t] = s.bars.length

    // Only use tickers in intersectionSet (if provided) for date range calculation
    if (intersectionSet && !intersectionSet.has(t)) continue

    const times = s.bars.map((b) => Number(b.time)).sort((a, b) => a - b)
    if (times.length === 0) continue

    // Track which ticker is setting the overlap start (newest first date = limiting ticker)
    if (times[0] > overlapStart) {
      overlapStart = times[0]
      limitingTicker = t
    }
    overlapEnd = Math.min(overlapEnd, times[times.length - 1])
  }

  if (!(overlapEnd >= overlapStart)) return { dates: [], open: {}, close: {}, adjClose: {}, tickerCounts }

  // Build date intersection using only the intersection tickers (if provided)
  let intersection: Set<number> | null = null
  for (const [ticker, map] of byTicker) {
    // Only use tickers in intersectionSet for building the date intersection
    if (intersectionSet && !intersectionSet.has(ticker)) continue

    const set = new Set<number>()
    for (const time of map.keys()) {
      if (time >= overlapStart && time <= overlapEnd) set.add(time)
    }
    if (intersection == null) {
      intersection = set
    } else {
      const next = new Set<number>()
      for (const t of intersection) if (set.has(t)) next.add(t)
      intersection = next
    }
  }
  const dates = Array.from(intersection ?? new Set<number>()).sort((a, b) => a - b) as UTCTimestamp[]

  // Build price arrays for ALL tickers (not just intersection tickers)
  // Non-intersection tickers may have nulls for dates before their data starts
  const open: Record<string, Array<number | null>> = {}
  const close: Record<string, Array<number | null>> = {}
  const adjClose: Record<string, Array<number | null>> = {}
  for (const [ticker, map] of byTicker) {
    open[ticker] = dates.map((d) => (map.get(Number(d))?.open ?? null))
    close[ticker] = dates.map((d) => (map.get(Number(d))?.close ?? null))
    adjClose[ticker] = dates.map((d) => (map.get(Number(d))?.adjClose ?? null))
  }

  return { dates, open, close, adjClose, limitingTicker, tickerCounts }
}

const expandToNode = (node: FlowNode, targetId: string): { next: FlowNode; found: boolean } => {
  if (node.id === targetId) {
    return { next: node.collapsed ? { ...node, collapsed: false } : node, found: true }
  }
  let found = false
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  for (const slot of getAllSlotsForNode(node)) {
    const arr = node.children[slot] ?? [null]
    children[slot] = arr.map((c) => {
      if (!c) return c
      const r = expandToNode(c, targetId)
      if (r.found) found = true
      return r.next
    })
  }
  const self = found && node.collapsed ? { ...node, collapsed: false } : node
  return found ? { next: { ...self, children }, found: true } : { next: node, found: false }
}

function App() {
  const [deviceTheme] = useState<ThemeMode>(() => loadDeviceThemeMode())

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

  const [savedBots, setSavedBots] = useState<SavedBot[]>(() => initialUserData.savedBots)
  const [watchlists, setWatchlists] = useState<Watchlist[]>(() => initialUserData.watchlists)
  // NOTE: callChains is now per-bot (stored in BotSession.callChains), not global state
  const [uiState, setUiState] = useState<UserUiState>(() => initialUserData.ui)
  // Portfolio is now loaded from database API, start with default
  const [dashboardPortfolio, setDashboardPortfolio] = useState<DashboardPortfolio>(defaultDashboardPortfolio)
  const [_portfolioLoading, setPortfolioLoading] = useState(false) // TODO: show loading state in UI
  const [analyzeBacktests, setAnalyzeBacktests] = useState<Record<string, AnalyzeBacktestState>>({})
  const [analyzeTickerContrib, setAnalyzeTickerContrib] = useState<Record<string, TickerContributionState>>({})
  const [sanityReports, setSanityReports] = useState<Record<string, SanityReportState>>({})

  // Benchmark metrics state (fetched once, reused across all cards)
  const [benchmarkMetrics, setBenchmarkMetrics] = useState<{
    status: 'idle' | 'loading' | 'done' | 'error'
    data?: Record<string, ComparisonMetrics>
    error?: string
  }>({ status: 'idle' })

  // Model tab sanity report state (for unsaved models being built)
  const [modelSanityReport, setModelSanityReport] = useState<SanityReportState>({ status: 'idle' })

  // Cross-user Nexus bots for Nexus tab (populated via API in useEffect)
  const [allNexusBots, setAllNexusBots] = useState<SavedBot[]>([])
  const [analyzeTickerSort, setAnalyzeTickerSort] = useState<{ column: string; dir: 'asc' | 'desc' }>({
    column: 'ticker',
    dir: 'asc',
  })

  // Correlation Tool state
  const [correlationSelectedBotIds, setCorrelationSelectedBotIds] = useState<string[]>([])
  const [correlationOptimizationMetric, setCorrelationOptimizationMetric] = useState<'correlation' | 'volatility' | 'beta' | 'sharpe'>('correlation')
  const [correlationTimePeriod, setCorrelationTimePeriod] = useState<'full' | '1y' | '3y' | '5y'>('full')
  const [correlationMaxWeight, setCorrelationMaxWeight] = useState<number>(40)
  const [correlationMatrix, setCorrelationMatrix] = useState<number[][] | null>(null)
  const [correlationWeights, setCorrelationWeights] = useState<Record<string, number>>({})
  const [correlationPortfolioMetrics, setCorrelationPortfolioMetrics] = useState<{
    cagr: number
    volatility: number
    sharpe: number
    maxDrawdown: number
    beta: number
  } | null>(null)
  const [correlationLoading, setCorrelationLoading] = useState(false)
  const [correlationError, setCorrelationError] = useState<string | null>(null)
  const [correlationValidBotIds, setCorrelationValidBotIds] = useState<string[]>([])
  const [correlationUserRecommendations, setCorrelationUserRecommendations] = useState<Array<{ botId: string; score: number; correlation: number; metrics: { cagr?: number; sharpe?: number } }>>([])
  const [correlationNexusRecommendations, setCorrelationNexusRecommendations] = useState<Array<{ botId: string; score: number; correlation: number; metrics: { cagr?: number; sharpe?: number } }>>([])
  // Performance filters
  const [correlationMinCagr, setCorrelationMinCagr] = useState<number | ''>('')
  const [correlationMaxDrawdown, setCorrelationMaxDrawdown] = useState<number | ''>('')
  const [correlationMinSharpe, setCorrelationMinSharpe] = useState<number | ''>(``)

  // Search filters for correlation panels
  const [correlationUserSearch, setCorrelationUserSearch] = useState('')
  const [correlationNexusSearch, setCorrelationNexusSearch] = useState('')

  // Filter function for bots based on performance criteria
  const passesCorrelationFilters = (metrics: { cagr?: number; maxDrawdown?: number; sharpe?: number; sharpeRatio?: number } | null | undefined): boolean => {
    if (!metrics) return false
    if (correlationMinCagr !== '' && (metrics.cagr ?? 0) * 100 < correlationMinCagr) return false
    if (correlationMaxDrawdown !== '' && Math.abs(metrics.maxDrawdown ?? 0) * 100 > correlationMaxDrawdown) return false
    if (correlationMinSharpe !== '' && (metrics.sharpe ?? metrics.sharpeRatio ?? 0) < correlationMinSharpe) return false
    return true
  }

  // Search filter for user's bots (by name or tags)
  const passesUserSearch = (bot: SavedBot): boolean => {
    if (!correlationUserSearch.trim()) return true
    const search = correlationUserSearch.toLowerCase().trim()
    if (bot.name.toLowerCase().includes(search)) return true
    if (bot.tags?.some(tag => tag.toLowerCase().includes(search))) return true
    return false
  }

  // Search filter for Nexus bots (by name, tags, or builder display name)
  const passesNexusSearch = (bot: SavedBot): boolean => {
    if (!correlationNexusSearch.trim()) return true
    const search = correlationNexusSearch.toLowerCase().trim()
    if (bot.name.toLowerCase().includes(search)) return true
    if (bot.tags?.some(tag => tag.toLowerCase().includes(search))) return true
    if (bot.builderDisplayName?.toLowerCase().includes(search)) return true
    return false
  }

  // Call optimization API when correlation parameters change
  useEffect(() => {
    if (correlationSelectedBotIds.length < 2) {
      setCorrelationMatrix(null)
      setCorrelationWeights({})
      setCorrelationPortfolioMetrics(null)
      setCorrelationValidBotIds([])
      setCorrelationError(null)
      return
    }

    const fetchOptimization = async () => {
      setCorrelationLoading(true)
      setCorrelationError(null)
      try {
        const token = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken')
        const res = await fetch('/api/correlation/optimize', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            botIds: correlationSelectedBotIds,
            metric: correlationOptimizationMetric,
            period: correlationTimePeriod,
            maxWeight: correlationMaxWeight / 100
          })
        })
        const data = await res.json()
        if (!res.ok) {
          throw new Error(data.error || 'Optimization failed')
        }

        // Convert weights array to object keyed by botId
        const weightsObj: Record<string, number> = {}
        data.validBotIds.forEach((botId: string, i: number) => {
          weightsObj[botId] = (data.weights[i] ?? 0) * 100
        })

        setCorrelationWeights(weightsObj)
        setCorrelationMatrix(data.correlationMatrix)
        setCorrelationValidBotIds(data.validBotIds)
        setCorrelationPortfolioMetrics({
          cagr: data.portfolioMetrics.cagr,
          volatility: data.portfolioMetrics.volatility,
          sharpe: data.portfolioMetrics.sharpe,
          maxDrawdown: data.portfolioMetrics.maxDrawdown,
          beta: data.portfolioMetrics.beta
        })
      } catch (err) {
        console.error('[Correlation] Optimization error:', err)
        setCorrelationError(err instanceof Error ? err.message : String(err))
      } finally {
        setCorrelationLoading(false)
      }
    }

    fetchOptimization()
  }, [correlationSelectedBotIds, correlationOptimizationMetric, correlationTimePeriod, correlationMaxWeight])

  // Fetch recommendations for user bots and nexus bots
  useEffect(() => {
    const fetchRecommendations = async () => {
      const token = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken')
      if (!token) return

      // Get user bot IDs with backtest data
      const userBotIds = savedBots
        .filter(b => b.backtestResult || analyzeBacktests[b.id]?.result)
        .filter(b => passesUserSearch(b)).filter(b => !correlationSelectedBotIds.includes(b.id))
        .map(b => b.id)

      // Get nexus bot IDs with backtest data
      const nexusBotIds = allNexusBots
        .filter(b => b.backtestResult)
        .filter(b => passesNexusSearch(b)).filter(b => !correlationSelectedBotIds.includes(b.id))
        .map(b => b.id)

      // Fetch user recommendations
      if (userBotIds.length > 0) {
        try {
          const res = await fetch('/api/correlation/recommend', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              currentBotIds: correlationSelectedBotIds,
              candidateBotIds: userBotIds,
              metric: correlationOptimizationMetric,
              period: correlationTimePeriod,
              limit: 3
            })
          })
          const data = await res.json()
          if (res.ok && data.recommendations) {
            setCorrelationUserRecommendations(data.recommendations)
          }
        } catch (err) {
          console.error('[Correlation] User recommendations error:', err)
        }
      } else {
        setCorrelationUserRecommendations([])
      }

      // Fetch nexus recommendations
      if (nexusBotIds.length > 0) {
        try {
          const res = await fetch('/api/correlation/recommend', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              currentBotIds: correlationSelectedBotIds,
              candidateBotIds: nexusBotIds,
              metric: correlationOptimizationMetric,
              period: correlationTimePeriod,
              limit: 3
            })
          })
          const data = await res.json()
          if (res.ok && data.recommendations) {
            setCorrelationNexusRecommendations(data.recommendations)
          }
        } catch (err) {
          console.error('[Correlation] Nexus recommendations error:', err)
        }
      } else {
        setCorrelationNexusRecommendations([])
      }
    }

    fetchRecommendations()
  }, [correlationSelectedBotIds, correlationOptimizationMetric, correlationTimePeriod, savedBots, allNexusBots, analyzeBacktests])

  const theme = userId ? uiState.theme : deviceTheme

  const [availableTickers, setAvailableTickers] = useState<string[]>([])
  const [tickerMetadata, setTickerMetadata] = useState<Map<string, { assetType?: string; name?: string; exchange?: string }>>(new Map())
  const [tickerApiError, setTickerApiError] = useState<string | null>(null)
  const [etfsOnlyMode, setEtfsOnlyMode] = useState(false)
  const [backtestMode, setBacktestMode] = useState<BacktestMode>('CC')
  const [backtestCostBps, setBacktestCostBps] = useState<number>(5)
  const [backtestBenchmark, setBacktestBenchmark] = useState<string>('SPY')
  const [backtestShowBenchmark, setBacktestShowBenchmark] = useState<boolean>(true)
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

  const createBotSession = useCallback((title: string): BotSession => {
    const root = ensureSlots(createNode('basic'))
    root.title = title
    return {
      id: `bot-${newId()}`,
      history: [root],
      historyIndex: 0,
      backtest: { status: 'idle', errors: [], result: null, focusNodeId: null },
      callChains: [], // Per-bot call chains (stored with bot payload)
    }
  }, [])

  const initialBot = useMemo(() => createBotSession('Algo Name Here'), [createBotSession])
  const [bots, setBots] = useState<BotSession[]>(() => [initialBot])
  const [activeBotId, setActiveBotId] = useState<string>(() => initialBot.id)
  const [clipboard, setClipboard] = useState<FlowNode | null>(null)
  const [copiedNodeId, setCopiedNodeId] = useState<string | null>(null) // Track original node ID that was copied
  const [copiedCallChainId, setCopiedCallChainId] = useState<string | null>(null) // Track copied Call Chain ID
  const [isImporting, setIsImporting] = useState(false)
  const [tab, setTab] = useState<'Dashboard' | 'Nexus' | 'Analyze' | 'Model' | 'Help/Support' | 'Admin' | 'Databases'>('Model')
  const [dashboardSubtab, setDashboardSubtab] = useState<'Portfolio' | 'Partner Program'>('Portfolio')
  const [analyzeSubtab, setAnalyzeSubtab] = useState<'Systems' | 'Correlation Tool'>('Systems')
  const [adminTab, setAdminTab] = useState<AdminSubtab>('Atlas Overview')
  const [databasesTab, setDatabasesTab] = useState<DatabasesSubtab>('Systems')
  const [helpTab, setHelpTab] = useState<'Changelog' | 'Settings'>('Changelog')
  const [changelogContent, setChangelogContent] = useState<string>('')
  const [changelogLoading, setChangelogLoading] = useState(false)

  // Ticker search modal state
  const [tickerModalOpen, setTickerModalOpen] = useState(false)
  const [tickerModalCallback, setTickerModalCallback] = useState<((ticker: string) => void) | null>(null)
  const [tickerModalRestriction, setTickerModalRestriction] = useState<string[] | undefined>(undefined)
  const [displayNameInput, setDisplayNameInput] = useState<string>('')
  const [displayNameSaving, setDisplayNameSaving] = useState(false)
  const [displayNameError, setDisplayNameError] = useState<string | null>(null)
  const [displayNameSuccess, setDisplayNameSuccess] = useState(false)
  const [displayNameAvailable, setDisplayNameAvailable] = useState<boolean | null>(null)
  const [displayNameChecking, setDisplayNameChecking] = useState(false)

  // Eligibility requirements (fetched for Admin tab and Partner Program page)
  const [appEligibilityRequirements, setAppEligibilityRequirements] = useState<EligibilityRequirement[]>([])
  const [saveMenuOpen, setSaveMenuOpen] = useState(false)
  const [saveNewWatchlistName, setSaveNewWatchlistName] = useState('')
  const [justSavedFeedback, setJustSavedFeedback] = useState(false)
  const [addToWatchlistBotId, setAddToWatchlistBotId] = useState<string | null>(null)
  const [addToWatchlistNewName, setAddToWatchlistNewName] = useState('')
  const [callbackNodesCollapsed, setCallbackNodesCollapsed] = useState(true)
  const [customIndicatorsCollapsed, setCustomIndicatorsCollapsed] = useState(true)

  // Flowchart scroll state for floating scrollbar
  const flowchartScrollRef = useRef<HTMLDivElement>(null)
  const floatingScrollRef = useRef<HTMLDivElement>(null)
  const [flowchartScrollWidth, setFlowchartScrollWidth] = useState(0)
  const [flowchartClientWidth, setFlowchartClientWidth] = useState(0)

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

  const [communityTopSort, setCommunityTopSort] = useState<CommunitySort>({ key: 'oosCagr', dir: 'desc' })
  const [communitySearchFilters, setCommunitySearchFilters] = useState<Array<{ id: string; mode: 'builder' | 'cagr' | 'sharpe' | 'calmar' | 'maxdd'; comparison: 'greater' | 'less'; value: string }>>([
    { id: 'filter-0', mode: 'builder', comparison: 'greater', value: '' }
  ])
  const [communitySearchSort, setCommunitySearchSort] = useState<CommunitySort>({ key: 'oosCagr', dir: 'desc' })
  const [atlasSort, setAtlasSort] = useState<CommunitySort>({ key: 'oosCagr', dir: 'desc' })

  // Dashboard state
  const [dashboardTimePeriod, setDashboardTimePeriod] = useState<DashboardTimePeriod>('1Y')
  const [dashboardBotExpanded, setDashboardBotExpanded] = useState<Record<string, boolean>>({})
  const [dashboardBuyBotId, setDashboardBuyBotId] = useState<string>('')
  const [dashboardBuyBotSearch, setDashboardBuyBotSearch] = useState<string>('')
  const [dashboardBuyBotDropdownOpen, setDashboardBuyBotDropdownOpen] = useState(false)
  const [dashboardBuyAmount, setDashboardBuyAmount] = useState<string>('')
  const [dashboardBuyMode, setDashboardBuyMode] = useState<'$' | '%'>('$')
  const [dashboardSellBotId, setDashboardSellBotId] = useState<string | null>(null)
  const [dashboardSellAmount, setDashboardSellAmount] = useState<string>('')
  const [dashboardSellMode, setDashboardSellMode] = useState<'$' | '%'>('$')
  const [dashboardBuyMoreBotId, setDashboardBuyMoreBotId] = useState<string | null>(null)
  const [dashboardBuyMoreAmount, setDashboardBuyMoreAmount] = useState<string>('')
  const [dashboardBuyMoreMode, setDashboardBuyMoreMode] = useState<'$' | '%'>('$')

  // Inline buy state for Nexus bots (in Analyze tab, Nexus, watchlists)
  const [nexusBuyBotId, setNexusBuyBotId] = useState<string | null>(null)
  const [nexusBuyAmount, setNexusBuyAmount] = useState<string>('')
  const [nexusBuyMode, setNexusBuyMode] = useState<'$' | '%'>('$')

  // Find/Replace ticker state
  const [findTicker, setFindTicker] = useState('')
  const [replaceTicker, setReplaceTicker] = useState('')
  const [includePositions, setIncludePositions] = useState(true)
  const [includeIndicators, setIncludeIndicators] = useState(true)
  const [includeCallChains, setIncludeCallChains] = useState(false)
  const [foundInstances, setFoundInstances] = useState<TickerInstance[]>([])
  const [currentInstanceIndex, setCurrentInstanceIndex] = useState(-1)
  const [highlightedInstance, setHighlightedInstance] = useState<TickerInstance | null>(null)

  // Indicator overlay state - set of condition IDs to show on chart
  // Format: `${nodeId}:${conditionId}` or `${nodeId}:entry:${condId}` for altExit
  const [enabledOverlays, setEnabledOverlays] = useState<Set<string>>(new Set())

  // Indicator overlay data fetched from server
  const [indicatorOverlayData, setIndicatorOverlayData] = useState<IndicatorOverlayData[]>([])

  // Toggle an indicator overlay on/off
  const handleToggleOverlay = useCallback((key: string) => {
    setEnabledOverlays(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

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

  const watchlistsById = useMemo(() => new Map(watchlists.map((w) => [w.id, w])), [watchlists])
  const watchlistsByBotId = useMemo(() => {
    const map = new Map<string, Watchlist[]>()
    for (const wl of watchlists) {
      for (const botId of wl.botIds) {
        const arr = map.get(botId) ?? []
        arr.push(wl)
        map.set(botId, arr)
      }
    }
    return map
  }, [watchlists])

  const allWatchlistedBotIds = useMemo(() => {
    const set = new Set<string>()
    for (const wl of watchlists) for (const id of wl.botIds) set.add(id)
    return Array.from(set)
  }, [watchlists])

  const analyzeVisibleBotIds = useMemo(() => {
    const filterId = uiState.analyzeFilterWatchlistId
    if (!filterId) return allWatchlistedBotIds
    const wl = watchlistsById.get(filterId)
    return wl ? wl.botIds : []
  }, [allWatchlistedBotIds, uiState.analyzeFilterWatchlistId, watchlistsById])

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
        throw makeValidationError([{ nodeId: prepared.id, field: 'tree', message: 'Strategy is empty after compression (all branches lead to Empty).' }])
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
        throw makeValidationError(inputs.errors)
      }
      if (inputs.tickers.length === 0) {
        throw makeValidationError([{ nodeId: prepared.id, field: 'tickers', message: 'No tickers found in this strategy.' }])
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
        throw makeValidationError([{ nodeId: prepared.id, field: 'data', message: 'Not enough overlapping price data to run a backtest.' }])
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
      if (isValidationError(e)) {
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

  // Open ticker search modal
  const openTickerModal = useCallback((onSelect: (ticker: string) => void, restrictTo?: string[]) => {
    setTickerModalCallback(() => onSelect)
    setTickerModalRestriction(restrictTo)
    setTickerModalOpen(true)
  }, [])

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

  const removeBotFromWatchlist = useCallback((botId: string, watchlistId: string) => {
    // Update local state immediately for responsive UI
    setWatchlists((prev) =>
      prev.map((w) => (w.id === watchlistId ? { ...w, botIds: w.botIds.filter((id) => id !== botId) } : w)),
    )
    // Sync to database in background
    removeBotFromWatchlistInApi(watchlistId, botId).catch(err =>
      console.warn('[API] Failed to remove bot from watchlist:', err)
    )
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

  const handleConfirmAddToWatchlist = useCallback(
    (botId: string, watchlistNameOrId: string) => {
      const wlId = resolveWatchlistId(watchlistNameOrId)
      addBotToWatchlist(botId, wlId)
      setAddToWatchlistBotId(null)
      setAddToWatchlistNewName('')
    },
    [resolveWatchlistId, addBotToWatchlist],
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
        if (isValidationError(err)) {
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

  const handleSaveDisplayName = async () => {
    if (!displayNameInput.trim()) {
      setDisplayNameError('Display name cannot be empty')
      return
    }
    setDisplayNameSaving(true)
    setDisplayNameError(null)
    setDisplayNameSuccess(false)

    try {
      const token = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken')
      const res = await fetch('/api/user/display-name', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ displayName: displayNameInput.trim() })
      })

      const data = await res.json()
      if (!res.ok) {
        setDisplayNameError(data.error || 'Failed to update display name')
        return
      }

      // Update state and localStorage
      setUserDisplayName(data.displayName)
      setDisplayNameSuccess(true)

      // Update the stored user object
      try {
        const userJson = localStorage.getItem('user')
        if (userJson) {
          const user = JSON.parse(userJson)
          user.displayName = data.displayName
          localStorage.setItem('user', JSON.stringify(user))
        }
      } catch {
        // ignore
      }

      // Clear success message after 3 seconds
      setTimeout(() => setDisplayNameSuccess(false), 3000)
    } catch {
      setDisplayNameError('Network error. Please try again.')
    } finally {
      setDisplayNameSaving(false)
    }
  }

  // Check display name availability (debounced)
  const checkDisplayNameAvailability = useCallback(async (name: string) => {
    if (!name.trim() || name.trim().length < 2) {
      setDisplayNameAvailable(null)
      return
    }

    setDisplayNameChecking(true)
    try {
      const token = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken')
      const res = await fetch(`/api/user/display-name/check?name=${encodeURIComponent(name.trim())}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      })
      const data = await res.json()
      if (data.available !== undefined) {
        setDisplayNameAvailable(data.available)
        if (!data.available && data.reason) {
          setDisplayNameError(data.reason)
        }
      }
    } catch {
      // Ignore network errors during availability check
    } finally {
      setDisplayNameChecking(false)
    }
  }, [])

  // Debounced availability check effect
  useEffect(() => {
    if (!displayNameInput.trim()) {
      setDisplayNameAvailable(null)
      return
    }

    const timeoutId = setTimeout(() => {
      checkDisplayNameAvailability(displayNameInput)
    }, 500) // 500ms debounce

    return () => clearTimeout(timeoutId)
  }, [displayNameInput, checkDisplayNameAvailability])

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
                  onClick={() => setSaveMenuOpen((v) => !v)}
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
          <Card className="h-full flex flex-col overflow-hidden mx-2 my-4">
            <CardContent className="flex-1 flex flex-col gap-4 p-4 overflow-auto min-h-0">
              {/* Top Zone - Backtester */}
              <div className="shrink-0 border-b border-border pb-4">
                <BacktesterPanel
                  mode={backtestMode}
                  setMode={setBacktestMode}
                  costBps={backtestCostBps}
                  setCostBps={setBacktestCostBps}
                  benchmark={backtestBenchmark}
                  setBenchmark={setBacktestBenchmark}
                  showBenchmark={backtestShowBenchmark}
                  setShowBenchmark={setBacktestShowBenchmark}
                  tickerOptions={tickerOptions}
                  status={backtestStatus}
                  result={backtestResult}
                  errors={backtestErrors}
                  onRun={handleRunBacktest}
                  onJumpToError={handleJumpToBacktestError}
                  indicatorOverlays={indicatorOverlayData}
                  theme={uiState.theme}
                  benchmarkMetrics={benchmarkMetrics}
                  onFetchBenchmarks={fetchBenchmarkMetrics}
                  modelSanityReport={modelSanityReport}
                  onFetchRobustness={runModelRobustness}
                  onUndo={undo}
                  onRedo={redo}
                  canUndo={activeBot && activeBot.historyIndex > 0}
                  canRedo={activeBot && activeBot.historyIndex < activeBot.history.length - 1}
                  openTickerModal={openTickerModal}
                />
              </div>

              {/* Bottom Row - 2 Zones Side by Side */}
              <div className="flex gap-4 flex-1">
                {/* Bottom Left Zone - Sticky Labels + Content */}
                <div className={`flex items-start transition-all ${callbackNodesCollapsed && customIndicatorsCollapsed ? 'w-auto' : 'w-1/2'}`}>
                  {/* Left Side - Labels and Buttons (sticky, fills visible height, split 50/50) */}
                  <div className="flex flex-col w-auto border border-border rounded-l-lg sticky top-4 z-10" style={{ height: 'calc(100vh - 240px)', backgroundColor: 'color-mix(in srgb, var(--color-muted) 40%, var(--color-card))' }}>
                    {/* Callback Nodes Label/Button Zone - takes 50% */}
                    <div className="flex-1 flex flex-col items-center justify-center border-b border-border">
                      <button
                        onClick={() => setCallbackNodesCollapsed(!callbackNodesCollapsed)}
                        className={`px-2 py-2 transition-colors rounded active:bg-accent/30 ${!callbackNodesCollapsed ? 'bg-accent/20' : 'hover:bg-accent/10'}`}
                        title={callbackNodesCollapsed ? 'Expand' : 'Collapse'}
                      >
                        <div className="text-xs font-bold" style={{ writingMode: 'vertical-lr', textOrientation: 'mixed', transform: 'rotate(180deg)' }}>
                          {callbackNodesCollapsed ? 'Expand' : 'Collapse'}
                        </div>
                      </button>
                      <div className="px-2 py-2">
                        <div className="font-black text-lg tracking-wide" style={{ writingMode: 'vertical-lr', textOrientation: 'mixed', transform: 'rotate(180deg)' }}>
                          Callback Nodes
                        </div>
                      </div>
                    </div>

                    {/* Custom Indicators Label/Button Zone - takes 50% */}
                    <div className="flex-1 flex flex-col items-center justify-center">
                      <button
                        onClick={() => setCustomIndicatorsCollapsed(!customIndicatorsCollapsed)}
                        className={`px-2 py-2 transition-colors rounded active:bg-accent/30 ${!customIndicatorsCollapsed ? 'bg-accent/20' : 'hover:bg-accent/10'}`}
                        title={customIndicatorsCollapsed ? 'Expand' : 'Collapse'}
                      >
                        <div className="text-xs font-bold" style={{ writingMode: 'vertical-lr', textOrientation: 'mixed', transform: 'rotate(180deg)' }}>
                          {customIndicatorsCollapsed ? 'Expand' : 'Collapse'}
                        </div>
                      </button>
                      <div className="px-2 py-2">
                        <div className="font-black text-lg tracking-wide" style={{ writingMode: 'vertical-lr', textOrientation: 'mixed', transform: 'rotate(180deg)' }}>
                          Custom Indicators
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Side - Content Area (dynamic based on expanded state) */}
                  <div
                    className="flex-1 grid overflow-hidden border border-l-0 border-border rounded-r-lg sticky top-4 z-10"
                    style={{
                      backgroundColor: 'color-mix(in srgb, var(--color-muted) 40%, var(--color-card))',
                      gridTemplateRows:
                        callbackNodesCollapsed && customIndicatorsCollapsed ? '0fr 0fr' :
                        callbackNodesCollapsed && !customIndicatorsCollapsed ? '0fr 1fr' :
                        !callbackNodesCollapsed && customIndicatorsCollapsed ? '1fr 0fr' :
                        '1fr 1fr',
                      height: 'calc(100vh - 240px)'
                    }}
                  >
                    {/* Callback Nodes Content */}
                    {!callbackNodesCollapsed && (
                      <div className="overflow-auto p-4 border-b border-border">
                      <div className="flex gap-2 mb-4">
                        <Button onClick={handleAddCallChain}>Make new Call</Button>
                      </div>
                      <div className="grid gap-2.5">
                    {callChains.length === 0 ? (
                      <div className="text-muted">No call chains yet.</div>
                    ) : (
                      callChains.map((c) => (
                        <Card key={c.id}>
                          <div className="flex gap-2 items-center">
                            <Input value={c.name} onChange={(e) => handleRenameCallChain(c.id, e.target.value)} className="flex-1" />
                            <Button
                              variant="ghost"
                              size="sm"
                              className={`active:bg-accent/30 ${!c.collapsed ? 'bg-accent/20' : ''}`}
                              onClick={() => handleToggleCallChainCollapse(c.id)}
                            >
                              {c.collapsed ? 'Expand' : 'Collapse'}
                            </Button>
                            <Button
                              variant={copiedCallChainId === c.id ? 'accent' : 'ghost'}
                              size="sm"
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(c.id)
                                  setCopiedCallChainId(c.id)
                                } catch {
                                  // ignore
                                }
                              }}
                              title={copiedCallChainId === c.id ? 'Call ID copied!' : 'Copy call ID'}
                            >
                              {copiedCallChainId === c.id ? 'Copied!' : 'Copy ID'}
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => {
                                if (!confirm(`Delete call chain "${c.name}"?`)) return
                                handleDeleteCallChain(c.id)
                              }}
                              title="Delete call chain"
                            >
                              X
                            </Button>
                          </div>
                          <div className="text-xs text-muted mt-1.5">ID: {c.id}</div>
                          {!c.collapsed ? (
                            <div className="mt-2.5">
                              <NodeCard
                                node={c.root}
                                depth={0}
                                parentId={null}
                                parentSlot={null}
                                myIndex={0}
                                tickerOptions={tickerOptions}
                                onAdd={(parentId, slot, index, kind) => {
                                  const next = insertAtSlot(c.root, parentId, slot, index, ensureSlots(createNode(kind)))
                                  pushCallChain(c.id, next)
                                }}
                                onAppend={(parentId, slot) => {
                                  const next = appendPlaceholder(c.root, parentId, slot)
                                  pushCallChain(c.id, next)
                                }}
                                onRemoveSlotEntry={(parentId, slot, index) => {
                                  const next = removeSlotEntry(c.root, parentId, slot, index)
                                  pushCallChain(c.id, next)
                                }}
                                onDelete={(id) => {
                                  const next = deleteNode(c.root, id)
                                  pushCallChain(c.id, next)
                                }}
                                onCopy={(id) => {
                                  const found = findNode(c.root, id)
                                  if (!found) return
                                  setClipboard(cloneNode(found))
                                }}
                                onPaste={(parentId, slot, index, child) => {
                                  // Use single-pass clone + normalize for better performance
                                  const next = insertAtSlot(c.root, parentId, slot, index, cloneAndNormalize(child))
                                  pushCallChain(c.id, next)
                                }}
                                onPasteCallRef={(parentId, slot, index, callChainId) => {
                                  const callNode = createNode('call')
                                  callNode.callRefId = callChainId
                                  const next = insertAtSlot(c.root, parentId, slot, index, ensureSlots(callNode))
                                  pushCallChain(c.id, next)
                                }}
                                onRename={(id, title) => {
                                  const next = updateTitle(c.root, id, title)
                                  pushCallChain(c.id, next)
                                }}
                                onWeightChange={(id, weight, branch) => {
                                  const next = updateWeight(c.root, id, weight, branch)
                                  pushCallChain(c.id, next)
                                }}
                                onUpdateCappedFallback={(id, choice, branch) => {
                                  const next = updateCappedFallback(c.root, id, choice, branch)
                                  pushCallChain(c.id, next)
                                }}
                                onUpdateVolWindow={(id, days, branch) => {
                                  const next = updateVolWindow(c.root, id, days, branch)
                                  pushCallChain(c.id, next)
                                }}
                                onColorChange={(id, color) => {
                                  const next = updateColor(c.root, id, color)
                                  pushCallChain(c.id, next)
                                }}
                                onToggleCollapse={(id, collapsed) => {
                                  const next = updateCollapse(c.root, id, collapsed)
                                  pushCallChain(c.id, next)
                                }}
                                onNumberedQuantifier={(id, quantifier) => {
                                  const next = updateNumberedQuantifier(c.root, id, quantifier)
                                  pushCallChain(c.id, next)
                                }}
                                onNumberedN={(id, n) => {
                                  const next = updateNumberedN(c.root, id, n)
                                  pushCallChain(c.id, next)
                                }}
                                onAddNumberedItem={(id) => {
                                  const next = addNumberedItem(c.root, id)
                                  pushCallChain(c.id, next)
                                }}
                                onDeleteNumberedItem={(id, itemId) => {
                                  const next = deleteNumberedItem(c.root, id, itemId)
                                  pushCallChain(c.id, next)
                                }}
                                onAddCondition={(id, type, itemId) => {
                                  const next = addConditionLine(c.root, id, type, itemId)
                                  pushCallChain(c.id, next)
                                }}
                                onDeleteCondition={(id, condId, itemId) => {
                                  const next = deleteConditionLine(c.root, id, condId, itemId)
                                  pushCallChain(c.id, next)
                                }}
                                onFunctionWindow={(id, value) => {
                                  const next = updateFunctionWindow(c.root, id, value)
                                  pushCallChain(c.id, next)
                                }}
                                onFunctionBottom={(id, value) => {
                                  const next = updateFunctionBottom(c.root, id, value)
                                  pushCallChain(c.id, next)
                                }}
                                onFunctionMetric={(id, metric) => {
                                  const next = updateFunctionMetric(c.root, id, metric)
                                  pushCallChain(c.id, next)
                                }}
                                onFunctionRank={(id, rank) => {
                                  const next = updateFunctionRank(c.root, id, rank)
                                  pushCallChain(c.id, next)
                                }}
                                onUpdateCondition={(id, condId, updates, itemId) => {
                                  const next = updateConditionFields(c.root, id, condId, updates, itemId)
                                  pushCallChain(c.id, next)
                                }}
                                onAddPosition={(id) => {
                                  const next = addPositionRow(c.root, id)
                                  pushCallChain(c.id, next)
                                }}
                                onRemovePosition={(id, index) => {
                                  const next = removePositionRow(c.root, id, index)
                                  pushCallChain(c.id, next)
                                }}
                                onChoosePosition={(id, index, choice) => {
                                  const next = choosePosition(c.root, id, index, choice)
                                  pushCallChain(c.id, next)
                                }}
                                clipboard={clipboard}
                                copiedNodeId={copiedNodeId}
                                copiedCallChainId={copiedCallChainId}
                                callChains={callChains}
                                onUpdateCallRef={(id, callId) => {
                                  const next = updateCallReference(c.root, id, callId)
                                  pushCallChain(c.id, next)
                                }}
                                onAddEntryCondition={(id, type) => {
                                  const next = addEntryCondition(c.root, id, type)
                                  pushCallChain(c.id, next)
                                }}
                                onAddExitCondition={(id, type) => {
                                  const next = addExitCondition(c.root, id, type)
                                  pushCallChain(c.id, next)
                                }}
                                onDeleteEntryCondition={(id, condId) => {
                                  const next = deleteEntryCondition(c.root, id, condId)
                                  pushCallChain(c.id, next)
                                }}
                                onDeleteExitCondition={(id, condId) => {
                                  const next = deleteExitCondition(c.root, id, condId)
                                  pushCallChain(c.id, next)
                                }}
                                onUpdateEntryCondition={(id, condId, updates) => {
                                  const next = updateEntryConditionFields(c.root, id, condId, updates)
                                  pushCallChain(c.id, next)
                                }}
                                onUpdateExitCondition={(id, condId, updates) => {
                                  const next = updateExitConditionFields(c.root, id, condId, updates)
                                  pushCallChain(c.id, next)
                                }}
                                onUpdateScaling={(id, updates) => {
                                  const next = updateScalingFields(c.root, id, updates)
                                  pushCallChain(c.id, next)
                                }}
                                onExpandAllBelow={(id, currentlyCollapsed) => {
                                  const next = setCollapsedBelow(c.root, id, !currentlyCollapsed)
                                  pushCallChain(c.id, next)
                                }}
                                highlightedInstance={highlightedInstance}
                                enabledOverlays={enabledOverlays}
                                onToggleOverlay={handleToggleOverlay}
                              />
                            </div>
                          ) : null}
                        </Card>
                      ))
                    )}
                      </div>
                      </div>
                    )}

                    {/* Custom Indicators Content */}
                    {!customIndicatorsCollapsed && (
                      <div className="overflow-auto p-4">
                        <div className="text-muted text-sm">Coming soon...</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Bottom Right Zone - Flow Tree Builder with Floating Toolbar */}
                <div className={`flex flex-col transition-all relative min-h-0 overflow-hidden ${callbackNodesCollapsed && customIndicatorsCollapsed ? 'flex-1' : 'w-1/2'}`}>
                  {/* ETFs Only Toggle + Find/Replace - FLOATING TOOLBAR (sticky like Callback Nodes) */}
                  <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center px-4 py-2 border border-border rounded-lg mb-2 sticky top-4 z-20" style={{ backgroundColor: 'color-mix(in srgb, var(--color-muted) 60%, var(--color-card))' }}>
                    {/* Left section: ETFs Only checkbox + ticker count */}
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={etfsOnlyMode}
                          onChange={(e) => setEtfsOnlyMode(e.target.checked)}
                          className="w-4 h-4 rounded border-border cursor-pointer"
                        />
                        <span className="text-sm font-semibold">ETFs Only</span>
                      </label>
                      <span className="text-xs text-muted">
                        {etfsOnlyMode
                          ? `Showing ${tickerOptions.length} ETFs`
                          : `Showing all ${tickerOptions.length} tickers`}
                      </span>
                    </div>
                    {/* Center section: Find/Replace Controls */}
                    <div className="flex items-center gap-2">
                      <datalist id={USED_TICKERS_DATALIST_ID}>
                        {collectUsedTickers(current, includeCallChains ? callChains : undefined).map(t => (
                          <option key={t} value={t} />
                        ))}
                      </datalist>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted">Replace</span>
                        <button
                          className="h-7 w-24 px-2 border border-border rounded bg-card text-xs font-mono hover:bg-muted/50 text-left truncate"
                          onClick={() => openTickerModal((ticker) => {
                            setFindTicker(ticker)
                            let instances = findTickerInstances(current, ticker, includePositions, includeIndicators)
                            if (includeCallChains && callChains.length > 0) {
                              callChains.forEach(chain => {
                                try {
                                  const chainRoot = typeof chain.root === 'string' ? JSON.parse(chain.root) : chain.root
                                  const chainInstances = findTickerInstances(chainRoot, ticker, includePositions, includeIndicators, chain.id)
                                  instances = [...instances, ...chainInstances]
                                } catch { /* ignore parse errors */ }
                              })
                            }
                            setFoundInstances(instances)
                            setCurrentInstanceIndex(instances.length > 0 ? 0 : -1)
                            setHighlightedInstance(instances.length > 0 ? instances[0] : null)
                          }, collectUsedTickers(current, includeCallChains ? callChains : undefined))}
                        >
                          {findTicker || 'Ticker'}
                        </button>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted">With</span>
                        <button
                          className="h-7 w-24 px-2 border border-border rounded bg-card text-xs font-mono hover:bg-muted/50 text-left truncate"
                          onClick={() => openTickerModal((ticker) => setReplaceTicker(ticker))}
                        >
                          {replaceTicker || 'Ticker'}
                        </button>
                        {findTicker && foundInstances.length > 0 && (
                          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                            {foundInstances.length} {foundInstances.length === 1 ? 'instance' : 'instances'}
                          </span>
                        )}
                      </div>
                      <label className="flex items-center gap-1 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={includePositions}
                          onChange={(e) => {
                            setIncludePositions(e.target.checked)
                            let instances = findTickerInstances(current, findTicker, e.target.checked, includeIndicators)
                            if (includeCallChains && callChains.length > 0) {
                              callChains.forEach(chain => {
                                try {
                                  const chainRoot = typeof chain.root === 'string' ? JSON.parse(chain.root) : chain.root
                                  instances = [...instances, ...findTickerInstances(chainRoot, findTicker, e.target.checked, includeIndicators, chain.id)]
                                } catch { /* ignore */ }
                              })
                            }
                            setFoundInstances(instances)
                            setCurrentInstanceIndex(instances.length > 0 ? 0 : -1)
                          }}
                        />
                        Trade Tickers
                      </label>
                      <label className="flex items-center gap-1 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={includeIndicators}
                          onChange={(e) => {
                            setIncludeIndicators(e.target.checked)
                            let instances = findTickerInstances(current, findTicker, includePositions, e.target.checked)
                            if (includeCallChains && callChains.length > 0) {
                              callChains.forEach(chain => {
                                try {
                                  const chainRoot = typeof chain.root === 'string' ? JSON.parse(chain.root) : chain.root
                                  instances = [...instances, ...findTickerInstances(chainRoot, findTicker, includePositions, e.target.checked, chain.id)]
                                } catch { /* ignore */ }
                              })
                            }
                            setFoundInstances(instances)
                            setCurrentInstanceIndex(instances.length > 0 ? 0 : -1)
                          }}
                        />
                        Indicator Tickers
                      </label>
                      <label className="flex items-center gap-1 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={includeCallChains}
                          onChange={(e) => {
                            setIncludeCallChains(e.target.checked)
                            let instances = findTickerInstances(current, findTicker, includePositions, includeIndicators)
                            if (e.target.checked && callChains.length > 0) {
                              callChains.forEach(chain => {
                                try {
                                  const chainRoot = typeof chain.root === 'string' ? JSON.parse(chain.root) : chain.root
                                  instances = [...instances, ...findTickerInstances(chainRoot, findTicker, includePositions, includeIndicators, chain.id)]
                                } catch { /* ignore */ }
                              })
                            }
                            setFoundInstances(instances)
                            setCurrentInstanceIndex(instances.length > 0 ? 0 : -1)
                          }}
                        />
                        Call Chains
                      </label>
                      <Button
                        variant="outline"
                        size="sm"
                        className="active:bg-accent/30"
                        disabled={foundInstances.length === 0}
                        onClick={() => {
                          const newIdx = (currentInstanceIndex - 1 + foundInstances.length) % foundInstances.length
                          setCurrentInstanceIndex(newIdx)
                          const instance = foundInstances[newIdx]
                          setHighlightedInstance(instance)
                          const nodeEl = document.querySelector(`[data-node-id="${instance.nodeId}"]`)
                          if (nodeEl) nodeEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
                        }}
                      >
                        ◀ Prev
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="active:bg-accent/30"
                        disabled={foundInstances.length === 0}
                        onClick={() => {
                          const newIdx = (currentInstanceIndex + 1) % foundInstances.length
                          setCurrentInstanceIndex(newIdx)
                          const instance = foundInstances[newIdx]
                          setHighlightedInstance(instance)
                          const nodeEl = document.querySelector(`[data-node-id="${instance.nodeId}"]`)
                          if (nodeEl) nodeEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
                        }}
                      >
                        Next ▶
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        className="active:bg-accent/50"
                        disabled={!findTicker || !replaceTicker || foundInstances.length === 0}
                        onClick={() => {
                          const nextRoot = replaceTickerInTree(current, findTicker, replaceTicker, includePositions, includeIndicators)
                          push(nextRoot)
                          if (includeCallChains && callChains.length > 0) {
                            callChains.forEach(chain => {
                              try {
                                const chainRoot = typeof chain.root === 'string' ? JSON.parse(chain.root) : chain.root
                                const updatedRoot = replaceTickerInTree(chainRoot, findTicker, replaceTicker, includePositions, includeIndicators)
                                fetch(`/api/call-chains/${chain.id}`, {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ root: JSON.stringify(updatedRoot) })
                                }).then(() => loadCallChainsFromApi(userId).then(setCallChains))
                              } catch { /* ignore parse errors */ }
                            })
                          }
                          setFindTicker('')
                          setReplaceTicker('')
                          setFoundInstances([])
                          setCurrentInstanceIndex(-1)
                          setHighlightedInstance(null)
                        }}
                      >
                        Replace{foundInstances.length > 0 ? ` (${foundInstances.length})` : ''}
                      </Button>
                    </div>
                    {/* Right section: Undo/Redo */}
                    <div className="flex gap-2 justify-end">
                      <Button
                        variant="secondary"
                        className="px-4 py-2 text-sm font-semibold active:bg-accent/30"
                        onClick={undo}
                        disabled={!activeBot || activeBot.historyIndex <= 0}
                      >
                        Undo
                      </Button>
                      <Button
                        variant="secondary"
                        className="px-4 py-2 text-sm font-semibold active:bg-accent/30"
                        onClick={redo}
                        disabled={!activeBot || activeBot.historyIndex >= activeBot.history.length - 1}
                      >
                        Redo
                      </Button>
                    </div>
                  </div>
                  {/* Flowchart Card - separate from toolbar */}
                  <div className="flex-1 border border-border rounded-lg bg-card min-h-0 p-4 relative" style={{ height: 'calc(100vh - 340px)', overflow: 'hidden' }}>
                    <div
                      ref={flowchartScrollRef}
                      style={{
                        width: '100%',
                        height: 'calc(100% + 20px)',
                        marginBottom: '-20px',
                        overflowY: 'auto',
                        overflowX: 'scroll',
                      }}
                      onScroll={(e) => {
                        if (floatingScrollRef.current) {
                          floatingScrollRef.current.scrollLeft = e.currentTarget.scrollLeft
                        }
                      }}
                    >
                      <NodeCard
                    node={current}
                    depth={0}
                    parentId={null}
                    parentSlot={null}
                    myIndex={0}
                    errorNodeIds={backtestErrorNodeIds}
                    focusNodeId={backtestFocusNodeId}
                    tickerOptions={tickerOptions}
                    onAdd={handleAdd}
                    onAppend={handleAppend}
                    onRemoveSlotEntry={handleRemoveSlotEntry}
                    onDelete={handleDelete}
                    onCopy={handleCopy}
                    onPaste={handlePaste}
                    onPasteCallRef={handlePasteCallRef}
                    onRename={handleRename}
                    onWeightChange={handleWeightChange}
                    onUpdateCappedFallback={handleUpdateCappedFallback}
                    onUpdateVolWindow={handleUpdateVolWindow}
                    onColorChange={handleColorChange}
                    onToggleCollapse={handleToggleCollapse}
                    onNumberedQuantifier={handleNumberedQuantifier}
                    onNumberedN={handleNumberedN}
                    onAddNumberedItem={handleAddNumberedItem}
                    onDeleteNumberedItem={handleDeleteNumberedItem}
                    onAddCondition={handleAddCondition}
                    onDeleteCondition={handleDeleteCondition}
                    onFunctionWindow={handleFunctionWindow}
                    onFunctionBottom={handleFunctionBottom}
                    onFunctionMetric={handleFunctionMetric}
                    onFunctionRank={handleFunctionRank}
                    onUpdateCondition={(id, condId, updates, itemId) => {
                      const next = updateConditionFields(current, id, condId, updates, itemId)
                      push(next)
                    }}
                    onAddPosition={handleAddPos}
                    onRemovePosition={handleRemovePos}
                    onChoosePosition={handleChoosePos}
                    openTickerModal={openTickerModal}
                    clipboard={clipboard}
                    copiedNodeId={copiedNodeId}
                    copiedCallChainId={copiedCallChainId}
                    callChains={callChains}
                    onUpdateCallRef={handleUpdateCallRef}
                    onAddEntryCondition={handleAddEntryCondition}
                    onAddExitCondition={handleAddExitCondition}
                    onDeleteEntryCondition={handleDeleteEntryCondition}
                    onDeleteExitCondition={handleDeleteExitCondition}
                    onUpdateEntryCondition={handleUpdateEntryCondition}
                    onUpdateExitCondition={handleUpdateExitCondition}
                    onUpdateScaling={handleUpdateScaling}
                    onExpandAllBelow={(id, currentlyCollapsed) => {
                      const next = setCollapsedBelow(current, id, !currentlyCollapsed)
                      push(next)
                    }}
                    highlightedInstance={highlightedInstance}
                    enabledOverlays={enabledOverlays}
                    onToggleOverlay={handleToggleOverlay}
                  />
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : tab === 'Help/Support' ? (
          <Card className="h-full flex flex-col overflow-hidden m-4">
            <CardContent className="p-6 flex flex-col h-full overflow-auto">
              {helpTab === 'Settings' ? (
                <div className="max-w-3xl mx-auto w-full">
                  <h2 className="text-xl font-bold mb-4">Settings</h2>

                  <div className="mb-8 p-4 border border-border rounded-lg">
                    <h3 className="font-bold mb-2">Display Name</h3>
                    <p className="text-muted text-sm mb-3">
                      Choose a unique display name that will be shown in the header and on your systems.
                      {userDisplayName && <span className="block mt-1">Current: <span className="font-semibold text-foreground">{userDisplayName}</span></span>}
                    </p>
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <Input
                          className={`h-8 text-sm w-64 pr-8 ${
                            displayNameInput.trim().length >= 2
                              ? displayNameAvailable === true
                                ? 'border-green-500 focus:ring-green-500'
                                : displayNameAvailable === false
                                  ? 'border-red-500 focus:ring-red-500'
                                  : ''
                              : ''
                          }`}
                          value={displayNameInput}
                          onChange={(e) => {
                            setDisplayNameInput(e.target.value)
                            setDisplayNameError(null)
                            setDisplayNameAvailable(null)
                          }}
                          placeholder={userDisplayName || 'Enter a display name'}
                          maxLength={30}
                        />
                        {/* Availability indicator */}
                        <div className="absolute right-2 top-1/2 -translate-y-1/2">
                          {displayNameChecking ? (
                            <span className="text-muted text-xs">...</span>
                          ) : displayNameInput.trim().length >= 2 ? (
                            displayNameAvailable === true ? (
                              <span className="text-green-500 text-sm font-bold">✓</span>
                            ) : displayNameAvailable === false ? (
                              <span className="text-red-500 text-sm font-bold">✗</span>
                            ) : null
                          ) : null}
                        </div>
                      </div>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={handleSaveDisplayName}
                        disabled={displayNameSaving || !displayNameInput.trim() || displayNameAvailable === false}
                      >
                        {displayNameSaving ? 'Saving...' : 'Save'}
                      </Button>
                    </div>
                    {/* Availability status message */}
                    {displayNameInput.trim().length >= 2 && !displayNameError && (
                      displayNameAvailable === true ? (
                        <p className="text-green-500 text-sm mt-2">This name is available!</p>
                      ) : displayNameAvailable === false ? (
                        <p className="text-red-500 text-sm mt-2">This name is not available</p>
                      ) : displayNameChecking ? (
                        <p className="text-muted text-sm mt-2">Checking availability...</p>
                      ) : null
                    )}
                    {displayNameError && (
                      <p className="text-red-500 text-sm mt-2">{displayNameError}</p>
                    )}
                    {displayNameSuccess && (
                      <p className="text-green-500 text-sm mt-2">Display name updated successfully!</p>
                    )}
                    <p className="text-muted text-xs mt-2">2-30 characters. Letters, numbers, spaces, underscores, and hyphens only.</p>
                  </div>

                  <div className="mb-8 p-4 border border-border rounded-lg">
                    <h3 className="font-bold mb-2">Theme</h3>
                    <div className="flex items-center gap-3">
                      <Select
                        className="h-8 text-xs"
                        value={colorTheme}
                        onChange={(e) => setUiState((prev) => ({ ...prev, colorTheme: e.target.value as ColorTheme }))}
                        title="Select color theme"
                      >
                        {COLOR_THEMES.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </Select>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => setUiState((prev) => ({ ...prev, theme: prev.theme === 'dark' ? 'light' : 'dark' }))}
                        title="Toggle light/dark mode"
                      >
                        {theme === 'dark' ? 'Light mode' : 'Dark mode'}
                      </Button>
                      <Button
                        variant="accent"
                        size="sm"
                        onClick={async () => {
                          const success = await savePreferencesToApi(userId, uiState)
                          if (success) {
                            alert('Theme preferences saved!')
                          } else {
                            alert('Failed to save preferences')
                          }
                        }}
                        title="Save theme preferences"
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="max-w-3xl mx-auto w-full">
                  <h2 className="text-xl font-bold mb-4">Help & Support</h2>

                  <div className="mb-8 p-4 border border-border rounded-lg">
                    <h3 className="font-bold mb-2">Contact</h3>
                    <p className="text-muted text-sm">Message me on Discord</p>
                  </div>

                  <div className="space-y-6">
                    <h3 className="text-lg font-bold border-b border-border pb-2">Changelog</h3>

                    {changelogLoading ? (
                      <div className="text-muted text-sm">Loading changelog...</div>
                    ) : changelogContent ? (
                      <div className="space-y-4">
                        {(() => {
                          // Parse markdown changelog into sections
                          const sections: { version: string; content: { type: string; items: string[] }[] }[] = []
                          let currentSection: typeof sections[0] | null = null
                          let currentType: { type: string; items: string[] } | null = null

                          console.log('[changelog] Parsing content, length:', changelogContent.length)

                          // Normalize line endings (Windows \r\n -> \n)
                          const normalizedContent = changelogContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

                          for (const line of normalizedContent.split('\n')) {
                            // Version header: ## [1.2.0] - 2026-01-01
                            const versionMatch = line.match(/^## \[(.+?)\] - (.+)$/)
                            if (versionMatch) {
                              console.log('[changelog] Found version:', versionMatch[1])
                              if (currentSection) sections.push(currentSection)
                              currentSection = { version: `[${versionMatch[1]}] - ${versionMatch[2]}`, content: [] }
                              currentType = null
                              continue
                            }
                            // Section header: ### Added, ### Fixed, etc.
                            const typeMatch = line.match(/^### (.+)$/)
                            if (typeMatch && currentSection) {
                              currentType = { type: typeMatch[1], items: [] }
                              currentSection.content.push(currentType)
                              continue
                            }
                            // List item: - Some change
                            const itemMatch = line.match(/^- (.+)$/)
                            if (itemMatch && currentType) {
                              currentType.items.push(itemMatch[1])
                            }
                          }
                          if (currentSection) sections.push(currentSection)
                          console.log('[changelog] Parsed sections:', sections.length, sections)

                          const getTypeColor = (type: string) => {
                            switch (type.toLowerCase()) {
                              case 'added': return 'text-green-600 dark:text-green-400'
                              case 'fixed': return 'text-amber-600 dark:text-amber-400'
                              case 'changed': return 'text-blue-600 dark:text-blue-400'
                              case 'performance': return 'text-purple-600 dark:text-purple-400'
                              case 'features': return 'text-green-600 dark:text-green-400'
                              default: return 'text-muted'
                            }
                          }

                          return sections.map((section, i) => (
                            <div key={i}>
                              <h4 className="font-bold text-sm text-muted mb-2">{section.version}</h4>
                              <div className="pl-4 space-y-3">
                                {section.content.map((typeBlock, j) => (
                                  <div key={j}>
                                    <div className={`font-semibold text-sm ${getTypeColor(typeBlock.type)}`}>
                                      {typeBlock.type}
                                    </div>
                                    <ul className="list-disc list-inside text-sm text-muted ml-2 space-y-0.5">
                                      {typeBlock.items.map((item, k) => (
                                        <li key={k}>{item}</li>
                                      ))}
                                    </ul>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))
                        })()}
                      </div>
                    ) : (
                      <div className="text-muted text-sm">Failed to load changelog</div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ) : tab === 'Admin' ? (
          <Card className="h-full flex flex-col overflow-hidden m-4">
            <CardContent className="p-6 flex flex-col h-full overflow-auto">
              <AdminPanel
                adminTab={adminTab}
                setAdminTab={setAdminTab}
                onTickersUpdated={(next) => {
                  setAvailableTickers(next)
                }}
                savedBots={savedBots}
                setSavedBots={setSavedBots}
                onRefreshNexusBots={refreshAllNexusBots}
                onPrewarmComplete={() => {
                  // Clear frontend state so tabs will refetch fresh cached data
                  setAnalyzeBacktests({})
                  setSanityReports({})
                  // Refresh Nexus bots from API to get updated metrics
                  void refreshAllNexusBots()
                }}
                userId={userId || ''}
                updateBotInApi={updateBotInApi}
              />
            </CardContent>
          </Card>
        ) : tab === 'Databases' ? (
          <Card className="h-full flex flex-col overflow-hidden m-4">
            <CardContent className="p-6 flex flex-col h-full overflow-auto">
              <DatabasesPanel
                databasesTab={databasesTab}
                setDatabasesTab={setDatabasesTab}
                onOpenBot={isAdmin ? handleOpenBot : undefined}
                onExportBot={isAdmin ? handleExportBot : undefined}
                isAdmin={isAdmin}
              />
            </CardContent>
          </Card>
        ) : tab === 'Analyze' ? (
          <Card className="h-full flex flex-col overflow-hidden m-4">
            <CardContent className="p-4 flex flex-col h-full overflow-auto">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2.5 flex-wrap">
                <div className="font-black">Analyze</div>
                <div className="flex gap-2">
                  {(['Systems', 'Correlation Tool'] as const).map((t) => (
                    <Button
                      key={t}
                      variant={analyzeSubtab === t ? 'accent' : 'secondary'}
                      size="sm"
                      onClick={() => setAnalyzeSubtab(t)}
                    >
                      {t}
                    </Button>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2">
                <div className="text-xs font-bold text-muted">Filter</div>
                <Select
                  value={uiState.analyzeFilterWatchlistId ?? ''}
                  onChange={(e) =>
                    setUiState((prev) => ({ ...prev, analyzeFilterWatchlistId: e.target.value ? e.target.value : null }))
                  }
                >
                  <option value="">All watchlists</option>
                  {watchlists.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </Select>
              </label>
            </div>

            {analyzeSubtab === 'Correlation Tool' ? (
              <div className="mt-3 flex flex-col gap-3 flex-1 min-h-0">
                {/* Filters Bar */}
                <Card className="p-3 flex items-center gap-4 flex-wrap">
                  <label className="flex items-center gap-2">
                    <span className="text-xs font-bold text-muted">Optimize for</span>
                    <Select
                      value={correlationOptimizationMetric}
                      onChange={(e) => setCorrelationOptimizationMetric(e.target.value as typeof correlationOptimizationMetric)}
                      className="text-sm"
                    >
                      <option value="correlation">Min Correlation</option>
                      <option value="volatility">Min Volatility</option>
                      <option value="beta">Min Beta</option>
                      <option value="sharpe">Max Sharpe</option>
                    </Select>
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="text-xs font-bold text-muted">Period</span>
                    <Select
                      value={correlationTimePeriod}
                      onChange={(e) => setCorrelationTimePeriod(e.target.value as typeof correlationTimePeriod)}
                      className="text-sm"
                    >
                      <option value="full">Full History</option>
                      <option value="1y">1 Year</option>
                      <option value="3y">3 Years</option>
                      <option value="5y">5 Years</option>
                    </Select>
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="text-xs font-bold text-muted">Max Weight</span>
                    <input
                      type="number"
                      value={correlationMaxWeight}
                      onChange={(e) => setCorrelationMaxWeight(Math.min(100, Math.max(10, parseInt(e.target.value) || 40)))}
                      className="w-16 px-2 py-1 rounded border border-border bg-background text-sm"
                      min={10}
                      max={100}
                    />
                    <span className="text-xs text-muted">%</span>
                  </label>
                  <div className="w-px h-6 bg-border" />
                  <label className="flex items-center gap-2">
                    <span className="text-xs font-bold text-muted">Min CAGR</span>
                    <input
                      type="number"
                      value={correlationMinCagr}
                      onChange={(e) => setCorrelationMinCagr(e.target.value === '' ? '' : parseFloat(e.target.value))}
                      className="w-14 px-2 py-1 rounded border border-border bg-background text-sm"
                      placeholder="--"
                    />
                    <span className="text-xs text-muted">%</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="text-xs font-bold text-muted">Max DD</span>
                    <input
                      type="number"
                      value={correlationMaxDrawdown}
                      onChange={(e) => setCorrelationMaxDrawdown(e.target.value === '' ? '' : parseFloat(e.target.value))}
                      className="w-14 px-2 py-1 rounded border border-border bg-background text-sm"
                      placeholder="--"
                    />
                    <span className="text-xs text-muted">%</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="text-xs font-bold text-muted">Min Sharpe</span>
                    <input
                      type="number"
                      step="0.1"
                      value={correlationMinSharpe}
                      onChange={(e) => setCorrelationMinSharpe(e.target.value === '' ? '' : parseFloat(e.target.value))}
                      className="w-14 px-2 py-1 rounded border border-border bg-background text-sm"
                      placeholder="--"
                    />
                  </label>
                </Card>

                {/* Three Panel Layout */}
                <div className="grid grid-cols-3 gap-3 flex-1 min-h-0">
                  {/* Left Panel: Your Systems */}
                  <Card className="flex flex-col min-h-[400px] max-h-[600px]">
                    <div className="p-3 border-b border-border">
                      <div className="flex items-center gap-2"><div className="font-bold text-sm shrink-0">Your Systems</div><Input placeholder="Search..." value={correlationUserSearch} onChange={(e) => setCorrelationUserSearch(e.target.value)} className="h-6 text-xs flex-1" /></div>
                    </div>
                    <div className="flex-1 overflow-hidden flex flex-col">
                      {savedBots.filter(b => b.backtestResult || analyzeBacktests[b.id]?.result).length === 0 ? (
                        <div className="text-sm text-muted p-2">No backtested systems yet. Run backtests in the Analyze tab first.</div>
                      ) : (
                        <>
                          {/* Top 3 Recommended - Fixed Section (always visible) */}
                          <div className="p-2 border-b border-border bg-green-500/5 shrink-0">
                            <div className="text-xs font-bold text-green-600 mb-2">Top 3 Recommended</div>
                            <div className="grid gap-1">
                              {(() => {
                                // Get filtered bots not already in portfolio
                                const filteredBots = savedBots
                                  .filter(b => b.backtestResult || analyzeBacktests[b.id]?.result)
                                  .filter(b => {
                                    const metrics = analyzeBacktests[b.id]?.result?.metrics ?? b.backtestResult
                                    return passesCorrelationFilters(metrics)
                                  })
                                  .filter(b => passesUserSearch(b)).filter(b => !correlationSelectedBotIds.includes(b.id))

                                // If we have API recommendations, use those; otherwise sort by Sharpe
                                let top3: typeof filteredBots = []
                                if (correlationUserRecommendations.length > 0) {
                                  top3 = correlationUserRecommendations
                                    .slice(0, 3)
                                    .map(rec => filteredBots.find(b => b.id === rec.botId))
                                    .filter((b): b is NonNullable<typeof b> => b != null)
                                } else {
                                  top3 = [...filteredBots]
                                    .sort((a, b) => {
                                      const aMetrics = analyzeBacktests[a.id]?.result?.metrics ?? a.backtestResult
                                      const bMetrics = analyzeBacktests[b.id]?.result?.metrics ?? b.backtestResult
                                      return (bMetrics?.sharpe ?? 0) - (aMetrics?.sharpe ?? 0)
                                    })
                                    .slice(0, 3)
                                }

                                if (top3.length === 0) {
                                  return <div className="text-xs text-muted">No recommendations available</div>
                                }

                                return top3.map(bot => {
                                  const metrics = analyzeBacktests[bot.id]?.result?.metrics ?? bot.backtestResult
                                  const rec = correlationUserRecommendations.find(r => r.botId === bot.id)
                                  return (
                                    <div
                                      key={bot.id}
                                      className="flex items-center justify-between p-2 rounded text-sm border border-green-500/30 bg-background hover:bg-green-500/10"
                                    >
                                      <div className="flex flex-col min-w-0 flex-1">
                                        <div className="font-medium truncate">{bot.name}</div>
                                        <div className="text-xs text-muted">
                                          {rec ? `Corr: ${rec.correlation.toFixed(2)} | ` : ''}CAGR: {((metrics?.cagr ?? 0) * 100).toFixed(1)}%
                                        </div>
                                      </div>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => setCorrelationSelectedBotIds(prev => [...prev, bot.id])}
                                      >
                                        +
                                      </Button>
                                    </div>
                                  )
                                })
                              })()}
                            </div>
                          </div>

                          {/* All Your Bots - Scrollable Section */}
                          <div className="flex-1 overflow-auto p-2">
                            <div className="text-xs font-bold text-muted mb-2">All Systems</div>
                            <div className="grid gap-1">
                              {savedBots
                                .filter(b => b.backtestResult || analyzeBacktests[b.id]?.result)
                                .filter(b => {
                                  const metrics = analyzeBacktests[b.id]?.result?.metrics ?? b.backtestResult
                                  return passesCorrelationFilters(metrics)
                                })
                                .filter(b => passesUserSearch(b))
                                .map(bot => {
                                  const metrics = analyzeBacktests[bot.id]?.result?.metrics ?? bot.backtestResult
                                  const isSelected = correlationSelectedBotIds.includes(bot.id)
                                  return (
                                    <div
                                      key={bot.id}
                                      className={`flex items-center justify-between p-2 rounded text-sm ${isSelected ? 'bg-accent/20 opacity-50' : 'hover:bg-accent/10'}`}
                                    >
                                      <div className="flex flex-col min-w-0 flex-1">
                                        <div className="font-medium truncate">{bot.name}</div>
                                        <div className="text-xs text-muted">
                                          CAGR: {((metrics?.cagr ?? 0) * 100).toFixed(1)}% | DD: {((metrics?.maxDrawdown ?? 0) * 100).toFixed(1)}%
                                        </div>
                                      </div>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        disabled={isSelected}
                                        onClick={() => setCorrelationSelectedBotIds(prev => [...prev, bot.id])}
                                      >
                                        +
                                      </Button>
                                    </div>
                                  )
                                })}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </Card>

                  {/* Middle Panel: Nexus Systems */}
                  <Card className="flex flex-col min-h-[400px] max-h-[600px]">
                    <div className="p-3 border-b border-border">
                      <div className="flex items-center gap-2"><div className="font-bold text-sm shrink-0">Nexus Systems</div><Input placeholder="Search..." value={correlationNexusSearch} onChange={(e) => setCorrelationNexusSearch(e.target.value)} className="h-6 text-xs flex-1" /></div>
                    </div>
                    <div className="flex-1 overflow-hidden flex flex-col">
                      {allNexusBots.filter(b => b.backtestResult).length === 0 ? (
                        <div className="text-sm text-muted p-2">No Nexus systems with metrics available.</div>
                      ) : (
                        <>
                          {/* Top 3 Recommended - Fixed Section (always visible) */}
                          <div className="p-2 border-b border-border bg-green-500/5 shrink-0">
                            <div className="text-xs font-bold text-green-600 mb-2">Top 3 Recommended</div>
                            <div className="grid gap-1">
                              {(() => {
                                // Get filtered bots not already in portfolio
                                const filteredBots = allNexusBots
                                  .filter(b => b.backtestResult)
                                  .filter(b => passesCorrelationFilters(b.backtestResult))
                                  .filter(b => passesNexusSearch(b)).filter(b => !correlationSelectedBotIds.includes(b.id))

                                // If we have API recommendations, use those; otherwise sort by Sharpe
                                let top3: typeof filteredBots = []
                                if (correlationNexusRecommendations.length > 0) {
                                  top3 = correlationNexusRecommendations
                                    .slice(0, 3)
                                    .map(rec => filteredBots.find(b => b.id === rec.botId))
                                    .filter((b): b is NonNullable<typeof b> => b != null)
                                } else {
                                  top3 = [...filteredBots]
                                    .sort((a, b) => (b.backtestResult?.sharpe ?? 0) - (a.backtestResult?.sharpe ?? 0))
                                    .slice(0, 3)
                                }

                                if (top3.length === 0) {
                                  return <div className="text-xs text-muted">No recommendations available</div>
                                }

                                return top3.map(bot => {
                                  const metrics = bot.backtestResult
                                  const rec = correlationNexusRecommendations.find(r => r.botId === bot.id)
                                  return (
                                    <div
                                      key={bot.id}
                                      className="flex items-center justify-between p-2 rounded text-sm border border-green-500/30 bg-background hover:bg-green-500/10"
                                    >
                                      <div className="flex flex-col min-w-0 flex-1">
                                        <div className="font-medium truncate">{bot.name}</div>
                                        <div className="text-xs text-muted">
                                          {rec ? `Corr: ${rec.correlation.toFixed(2)} | ` : ''}CAGR: {((metrics?.cagr ?? 0) * 100).toFixed(1)}%
                                        </div>
                                      </div>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => setCorrelationSelectedBotIds(prev => [...prev, bot.id])}
                                      >
                                        +
                                      </Button>
                                    </div>
                                  )
                                })
                              })()}
                            </div>
                          </div>

                          {/* All Nexus Bots - Scrollable Section */}
                          <div className="flex-1 overflow-auto p-2">
                            <div className="text-xs font-bold text-muted mb-2">All Systems</div>
                            <div className="grid gap-1">
                              {allNexusBots
                                .filter(b => b.backtestResult)
                                .filter(b => passesCorrelationFilters(b.backtestResult))
                                .filter(b => passesNexusSearch(b))
                                .map(bot => {
                                  const metrics = bot.backtestResult
                                  const isSelected = correlationSelectedBotIds.includes(bot.id)
                                  return (
                                    <div
                                      key={bot.id}
                                      className={`flex items-center justify-between p-2 rounded text-sm ${isSelected ? 'bg-accent/20 opacity-50' : 'hover:bg-accent/10'}`}
                                    >
                                      <div className="flex flex-col min-w-0 flex-1">
                                        <div className="font-medium truncate">{bot.name}</div>
                                        <div className="text-xs text-muted">
                                          {bot.builderDisplayName && <span className="mr-2">by {bot.builderDisplayName}</span>}
                                          CAGR: {((metrics?.cagr ?? 0) * 100).toFixed(1)}%
                                        </div>
                                      </div>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        disabled={isSelected}
                                        onClick={() => setCorrelationSelectedBotIds(prev => [...prev, bot.id])}
                                      >
                                        +
                                      </Button>
                                    </div>
                                  )
                                })}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </Card>

                  {/* Right Panel: Portfolio Builder */}
                  <Card className="flex flex-col min-h-[400px] max-h-[600px]">
                    <div className="p-3 border-b border-border flex items-center justify-between">
                      <div className="font-bold text-sm">Portfolio Builder</div>
                      <div className="flex items-center gap-2">
                        {/* Load Watchlist */}
                        <Select
                          value=""
                          onChange={async (e) => {
                            const watchlistId = e.target.value
                            if (!watchlistId) return
                            const watchlist = watchlists.find(w => w.id === watchlistId)
                            if (!watchlist) return
                            // Get bot IDs from watchlist
                            const botIds = watchlist.botIds || []
                            setCorrelationSelectedBotIds(botIds)
                          }}
                          className="text-xs h-7"
                        >
                          <option value="">Load watchlist...</option>
                          {watchlists.map(w => (
                            <option key={w.id} value={w.id}>{w.name}</option>
                          ))}
                        </Select>
                        {/* Save as Watchlist */}
                        {correlationSelectedBotIds.length > 0 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-xs h-7"
                            onClick={async () => {
                              const name = prompt('Enter watchlist name:')
                              if (!name || !userId) return
                              try {
                                const token = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken')
                                const res = await fetch('/api/watchlists', {
                                  method: 'POST',
                                  headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${token}`
                                  },
                                  body: JSON.stringify({
                                    name,
                                    userId,
                                    botIds: correlationSelectedBotIds
                                  })
                                })
                                if (res.ok) {
                                  const data = await res.json()
                                  setWatchlists(prev => [...prev, data.watchlist])
                                  alert('Portfolio saved as watchlist!')
                                }
                              } catch (err) {
                                console.error('Failed to save watchlist:', err)
                              }
                            }}
                          >
                            Save
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="flex-1 overflow-auto p-2">
                      {correlationSelectedBotIds.length === 0 ? (
                        <div className="text-sm text-muted p-2">Add systems from the left panels or load a watchlist to build your portfolio.</div>
                      ) : (
                        <div className="grid gap-3">
                          {/* Selected Bots */}
                          <div>
                            <div className="text-xs font-bold text-muted mb-2">Selected Systems</div>
                            <div className="grid gap-1">
                              {correlationSelectedBotIds.map(botId => {
                                const bot = savedBots.find(b => b.id === botId) ?? allNexusBots.find(b => b.id === botId)
                                if (!bot) return null
                                const weight = correlationWeights[botId] ?? (100 / correlationSelectedBotIds.length)
                                return (
                                  <div key={botId} className="flex items-center justify-between p-2 rounded bg-accent/10 text-sm">
                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                      <span className="font-medium truncate">{bot.name}</span>
                                      <span className="text-xs text-muted">{weight.toFixed(1)}%</span>
                                    </div>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => setCorrelationSelectedBotIds(prev => prev.filter(id => id !== botId))}
                                    >
                                      ×
                                    </Button>
                                  </div>
                                )
                              })}
                            </div>
                          </div>

                          {/* Loading/Error State */}
                          {correlationLoading && (
                            <div className="text-xs text-muted p-2 text-center">
                              Calculating optimal weights...
                            </div>
                          )}
                          {correlationError && (
                            <div className="text-xs text-red-500 p-2 bg-red-500/10 rounded">
                              {correlationError}
                            </div>
                          )}

                          {/* Correlation Matrix */}
                          {correlationSelectedBotIds.length >= 2 && correlationMatrix && correlationValidBotIds.length >= 2 && (
                            <div>
                              <div className="text-xs font-bold text-muted mb-2">Correlation Matrix</div>
                              <div className="overflow-x-auto">
                                <table className="text-xs w-full">
                                  <thead>
                                    <tr>
                                      <th className="p-1 text-left"></th>
                                      {correlationValidBotIds.map(id => {
                                        const bot = savedBots.find(b => b.id === id) ?? allNexusBots.find(b => b.id === id)
                                        return (
                                          <th key={id} className="p-1 text-center font-medium truncate max-w-[60px]" title={bot?.name}>
                                            {bot?.name?.slice(0, 6) ?? id.slice(0, 6)}
                                          </th>
                                        )
                                      })}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {correlationValidBotIds.map((rowId, i) => {
                                      const rowBot = savedBots.find(b => b.id === rowId) ?? allNexusBots.find(b => b.id === rowId)
                                      return (
                                        <tr key={rowId}>
                                          <td className="p-1 font-medium truncate max-w-[60px]" title={rowBot?.name}>
                                            {rowBot?.name?.slice(0, 6) ?? rowId.slice(0, 6)}
                                          </td>
                                          {correlationValidBotIds.map((colId, j) => {
                                            const corr = correlationMatrix[i]?.[j] ?? 0
                                            // Color: green (negative/low) -> yellow (0.5) -> red (high positive)
                                            const hue = Math.max(0, 120 - corr * 120) // 120=green, 0=red
                                            const bgColor = i === j ? 'transparent' : `hsl(${hue}, 70%, 85%)`
                                            return (
                                              <td
                                                key={colId}
                                                className="p-1 text-center"
                                                style={{ backgroundColor: bgColor }}
                                              >
                                                {i === j ? '1.00' : corr.toFixed(2)}
                                              </td>
                                            )
                                          })}
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}

                          {/* Portfolio Metrics */}
                          <div>
                            <div className="text-xs font-bold text-muted mb-2">Portfolio Metrics</div>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className="bg-accent/5 p-2 rounded">
                                <div className="text-muted">Expected CAGR</div>
                                <div className="font-bold">
                                  {correlationPortfolioMetrics ? `${(correlationPortfolioMetrics.cagr * 100).toFixed(1)}%` : '--'}
                                </div>
                              </div>
                              <div className="bg-accent/5 p-2 rounded">
                                <div className="text-muted">Volatility</div>
                                <div className="font-bold">
                                  {correlationPortfolioMetrics ? `${(correlationPortfolioMetrics.volatility * 100).toFixed(1)}%` : '--'}
                                </div>
                              </div>
                              <div className="bg-accent/5 p-2 rounded">
                                <div className="text-muted">Sharpe Ratio</div>
                                <div className="font-bold">
                                  {correlationPortfolioMetrics ? correlationPortfolioMetrics.sharpe.toFixed(2) : '--'}
                                </div>
                              </div>
                              <div className="bg-accent/5 p-2 rounded">
                                <div className="text-muted">Max Drawdown</div>
                                <div className="font-bold">
                                  {correlationPortfolioMetrics ? `${(correlationPortfolioMetrics.maxDrawdown * 100).toFixed(1)}%` : '--'}
                                </div>
                              </div>
                              <div className="bg-accent/5 p-2 rounded col-span-2">
                                <div className="text-muted">Portfolio Beta</div>
                                <div className="font-bold">
                                  {correlationPortfolioMetrics ? correlationPortfolioMetrics.beta.toFixed(2) : '--'}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </Card>
                </div>
              </div>
            ) : null}

            {analyzeSubtab !== 'Systems' ? null : (
              <>
                {analyzeVisibleBotIds.length === 0 ? (
              <div className="mt-3 text-muted">No systems in your watchlists yet.</div>
            ) : (
              <div className="grid gap-3 mt-3">
                {analyzeVisibleBotIds
                  .map((id) => savedBots.find((b) => b.id === id))
                  .filter((b): b is SavedBot => Boolean(b))
                  .map((b) => {
                    const collapsed = uiState.analyzeCollapsedByBotId[b.id] ?? true
                    const analyzeState = analyzeBacktests[b.id]
                    const tags = watchlistsByBotId.get(b.id) ?? []
                    return (
                      <Card key={b.id} className="grid gap-2.5">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              const next = !(uiState.analyzeCollapsedByBotId[b.id] ?? true)
                              setUiState((prev) => ({
                                ...prev,
                                analyzeCollapsedByBotId: { ...prev.analyzeCollapsedByBotId, [b.id]: next },
                              }))
                              if (!next) runAnalyzeBacktest(b)
                            }}
                          >
                            {collapsed ? 'Expand' : 'Collapse'}
                          </Button>
                          <div className="font-black">{b.name}</div>
                          <Badge variant={b.tags?.includes('Nexus') ? 'default' : b.tags?.includes('Atlas') ? 'default' : 'accent'}>
                            {b.tags?.includes('Nexus') ? 'Nexus' : b.tags?.includes('Atlas') ? 'Atlas' : 'Private'}
                          </Badge>
                          {b.tags?.includes('Nexus Eligible') && (
                            <Badge variant="secondary">Nexus Eligible</Badge>
                          )}
                          <Badge variant="default">{b.builderDisplayName || (b.builderId === userId ? userDisplayName : null) || b.builderId}</Badge>
                          <div className="flex gap-1.5 flex-wrap">
                            {tags.map((w) => (
                              <Badge key={w.id} variant="accent" className="gap-1.5">
                                {w.name}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-4 w-4 p-0 hover:bg-transparent"
                                  onClick={() => removeBotFromWatchlist(b.id, w.id)}
                                  title={`Remove from ${w.name}`}
                                >
                                  X
                                </Button>
                              </Badge>
                            ))}
                          </div>
                          <div className="ml-auto flex gap-2 flex-wrap">
                            {/* FRD-012: Show Copy to New for published systems, Open in Build for private */}
                            {b.builderId === userId && b.visibility !== 'community' && (
                              (b.tags?.includes('Nexus') || b.tags?.includes('Atlas')) ? (
                                <Button size="sm" onClick={() => handleCopyToNew(b)}>Copy to New System</Button>
                              ) : (
                                <Button size="sm" onClick={() => handleOpenSaved(b)}>Open in Build</Button>
                              )
                            )}
                            <Button
                              size="sm"
                              onClick={() => {
                                setAddToWatchlistBotId(b.id)
                                setAddToWatchlistNewName('')
                              }}
                            >
                              Add to Watchlist
                            </Button>
                            {/* Only show Copy to clipboard for bot owners (IP protection) */}
                            {b.builderId === userId && b.visibility !== 'community' && (
                              <Button size="sm" onClick={() => handleCopySaved(b)}>Copy JSON</Button>
                            )}
                            {/* Only show Delete for bot owners - but NOT for published systems */}
                            {b.builderId === userId && !(b.tags?.includes('Nexus') || b.tags?.includes('Atlas')) && (
                              <Button variant="destructive" size="sm" onClick={() => handleDeleteSaved(b.id)}>Delete</Button>
                            )}
                          </div>
                        </div>

                        {!collapsed ? (
                          <div className="flex flex-col gap-2.5 w-full">
                            {/* Tab Navigation */}
                            <div className="flex gap-2 border-b border-border pb-2">
                              <Button
                                size="sm"
                                variant={(uiState.analyzeBotCardTab[b.id] ?? 'overview') === 'overview' ? 'default' : 'outline'}
                                onClick={() => setUiState((prev) => ({
                                  ...prev,
                                  analyzeBotCardTab: { ...prev.analyzeBotCardTab, [b.id]: 'overview' },
                                }))}
                              >
                                Overview
                              </Button>
                              <Button
                                size="sm"
                                variant={(uiState.analyzeBotCardTab[b.id] ?? 'overview') === 'advanced' ? 'default' : 'outline'}
                                onClick={() => setUiState((prev) => ({
                                  ...prev,
                                  analyzeBotCardTab: { ...prev.analyzeBotCardTab, [b.id]: 'advanced' },
                                }))}
                              >
                                Benchmarks
                              </Button>
                              <Button
                                size="sm"
                                variant={(uiState.analyzeBotCardTab[b.id] ?? 'overview') === 'robustness' ? 'default' : 'outline'}
                                onClick={() => setUiState((prev) => ({
                                  ...prev,
                                  analyzeBotCardTab: { ...prev.analyzeBotCardTab, [b.id]: 'robustness' },
                                }))}
                              >
                                Robustness
                              </Button>
                            </div>

                            {/* Overview Tab Content */}
                            {(uiState.analyzeBotCardTab[b.id] ?? 'overview') === 'overview' && (
                              <div className="grid w-full max-w-full grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-2.5 items-stretch overflow-x-hidden">
                                <div className="saved-item grid grid-cols-1 gap-3.5 h-full w-full min-w-0 overflow-hidden items-stretch justify-items-stretch">
                                  {analyzeState?.status === 'loading' ? (
                                  <div className="text-muted">Running backtest…</div>
                                ) : analyzeState?.status === 'error' ? (
                                  <div className="grid gap-2">
                                    <div className="text-danger font-extrabold">{analyzeState.error ?? 'Failed to run backtest.'}</div>
                                    <Button onClick={() => runAnalyzeBacktest(b)}>Retry</Button>
                                  </div>
                                ) : analyzeState?.status === 'done' ? (
                                  <div className="grid grid-cols-1 gap-2.5 min-w-0 w-full">
                                    {/* Buy System Section */}
                                    <div className="border-b border-border pb-3 mb-1">
                                      <div className="font-bold mb-2">Buy System</div>
                                      <div className="text-sm mb-2">
                                        <span className="text-muted">Cash Available:</span>{' '}
                                        <span className="font-bold">{formatUsd(dashboardCash)}</span>
                                        {nexusBuyBotId === b.id && nexusBuyMode === '%' && nexusBuyAmount && (
                                          <span className="text-muted"> · Amount: {formatUsd((parseFloat(nexusBuyAmount) / 100) * dashboardCash)}</span>
                                        )}
                                      </div>
                                      <div className="flex gap-2 items-center">
                                        <Button
                                          size="sm"
                                          onClick={() => handleNexusBuy(b.id)}
                                          disabled={nexusBuyBotId !== b.id || !nexusBuyAmount}
                                          className="h-8 px-4"
                                        >
                                          Buy
                                        </Button>
                                        <div className="flex gap-1">
                                          <Button
                                            size="sm"
                                            variant={nexusBuyBotId === b.id && nexusBuyMode === '$' ? 'accent' : 'outline'}
                                            className="h-8 w-8 p-0"
                                            onClick={() => { setNexusBuyBotId(b.id); setNexusBuyMode('$') }}
                                          >
                                            $
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant={nexusBuyBotId === b.id && nexusBuyMode === '%' ? 'accent' : 'outline'}
                                            className="h-8 w-8 p-0"
                                            onClick={() => { setNexusBuyBotId(b.id); setNexusBuyMode('%') }}
                                          >
                                            %
                                          </Button>
                                        </div>
                                        <Input
                                          type="number"
                                          placeholder={nexusBuyBotId === b.id && nexusBuyMode === '%' ? '% of cash' : 'Amount'}
                                          value={nexusBuyBotId === b.id ? nexusBuyAmount : ''}
                                          onChange={(e) => { setNexusBuyBotId(b.id); setNexusBuyAmount(e.target.value) }}
                                          className="h-8 flex-1"
                                        />
                                      </div>
                                    </div>

                                    <div className="base-stats-grid w-full self-stretch grid grid-cols-1 grid-rows-[auto_auto_auto] gap-3">
                                      {(() => {
                                        // Get investment data for this bot from dashboard portfolio
                                        const investment = dashboardInvestmentsWithPnl.find((inv) => inv.botId === b.id)
                                        const isInvested = !!investment
                                        const amountInvested = investment?.costBasis ?? 0
                                        const currentValue = investment?.currentValue ?? 0
                                        const pnlPct = investment?.pnlPercent ?? 0

                                        // Calculate CAGR since investment if invested
                                        let liveCagr = 0
                                        if (investment) {
                                          const daysSinceInvestment = (Date.now() - investment.buyDate) / (1000 * 60 * 60 * 24)
                                          const yearsSinceInvestment = daysSinceInvestment / 365
                                          if (yearsSinceInvestment > 0 && amountInvested > 0) {
                                            liveCagr = (Math.pow(currentValue / amountInvested, 1 / yearsSinceInvestment) - 1)
                                          }
                                        }

                                        return (
                                          <div className="base-stats-card w-full min-w-0 max-w-full flex flex-col items-stretch text-center">
                                            <div className="font-black mb-2 text-center">Live Stats</div>
                                            {isInvested ? (
                                              <div className="grid grid-cols-4 gap-2.5 justify-items-center w-full">
                                                <div>
                                                  <div className="stat-label">Invested</div>
                                                  <div className="stat-value">{formatUsd(amountInvested)}</div>
                                                </div>
                                                <div>
                                                  <div className="stat-label">Current Value</div>
                                                  <div className="stat-value">{formatUsd(currentValue)}</div>
                                                </div>
                                                <div>
                                                  <div className="stat-label">P&L</div>
                                                  <div className={cn("stat-value", pnlPct >= 0 ? 'text-success' : 'text-danger')}>
                                                    {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                                                  </div>
                                                </div>
                                                <div>
                                                  <div className="stat-label">CAGR</div>
                                                  <div className={cn("stat-value", liveCagr >= 0 ? 'text-success' : 'text-danger')}>
                                                    {formatPct(liveCagr)}
                                                  </div>
                                                </div>
                                              </div>
                                            ) : (
                                              <div className="text-muted text-sm">Not invested in this system. Buy from Dashboard to track live stats.</div>
                                            )}
                                          </div>
                                        )
                                      })()}

                                      <div className="base-stats-card w-full min-w-0 text-center self-stretch">
                                        <div className="w-full">
                                      <div className="font-black mb-1.5">Backtest Snapshot</div>
                                      <div className="text-xs text-muted mb-2.5">Benchmark: {backtestBenchmark}</div>
                                      <div className="w-full max-w-full overflow-hidden">
                                        <EquityChart
                                          points={analyzeState.result?.points ?? []}
                                          benchmarkPoints={analyzeState.result?.benchmarkPoints}
                                          markers={analyzeState.result?.markers ?? []}
                                          logScale
                                          showCursorStats={false}
                                          heightPx={390}
                                          theme={uiState.theme}
                                        />
                                      </div>
                                          <div className="mt-2.5 w-full">
                                            <DrawdownChart points={analyzeState.result?.drawdownPoints ?? []} theme={uiState.theme} />
                                          </div>
                                        </div>
                                      </div>

                                      <div className="base-stats-card w-full min-w-0 text-center self-stretch">
                                        <div className="w-full">
                                          <div className="flex items-center justify-center gap-2 mb-2">
                                            <div className="font-black">Historical Stats</div>
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              className="h-6 px-2 text-xs"
                                              onClick={() => runAnalyzeBacktest(b, true)}
                                              title="Refresh backtest (bypass cache)"
                                            >
                                              ↻
                                            </Button>
                                          </div>
                                          <div className="grid grid-cols-[repeat(4,minmax(140px,1fr))] gap-2.5 justify-items-center overflow-x-auto max-w-full w-full">
                                            <div>
                                              <div className="stat-label">CAGR</div>
                                              <div className="stat-value">{formatPct(analyzeState.result?.metrics.cagr ?? NaN)}</div>
                                            </div>
                                            <div>
                                              <div className="stat-label">Max DD</div>
                                              <div className="stat-value">{formatPct(analyzeState.result?.metrics.maxDrawdown ?? NaN)}</div>
                                            </div>
                                            <div>
                                              <div className="stat-label">Calmar Ratio</div>
                                              <div className="stat-value">
                                                {Number.isFinite(analyzeState.result?.metrics.calmar ?? NaN)
                                                  ? (analyzeState.result?.metrics.calmar ?? 0).toFixed(2)
                                                  : '--'}
                                              </div>
                                            </div>
                                            <div>
                                              <div className="stat-label">Sharpe Ratio</div>
                                              <div className="stat-value">
                                                {Number.isFinite(analyzeState.result?.metrics.sharpe ?? NaN)
                                                  ? (analyzeState.result?.metrics.sharpe ?? 0).toFixed(2)
                                                  : '--'}
                                              </div>
                                            </div>
                                            <div>
                                              <div className="stat-label">Sortino Ratio</div>
                                              <div className="stat-value">
                                                {Number.isFinite(analyzeState.result?.metrics.sortino ?? NaN)
                                                  ? (analyzeState.result?.metrics.sortino ?? 0).toFixed(2)
                                                  : '--'}
                                              </div>
                                            </div>
                                            <div>
                                              <div className="stat-label">Treynor Ratio</div>
                                              <div className="stat-value">
                                                {Number.isFinite(analyzeState.result?.metrics.treynor ?? NaN)
                                                  ? (analyzeState.result?.metrics.treynor ?? 0).toFixed(2)
                                                  : '--'}
                                              </div>
                                            </div>
                                            <div>
                                              <div className="stat-label">Beta</div>
                                              <div className="stat-value">
                                                {Number.isFinite(analyzeState.result?.metrics.beta ?? NaN)
                                                  ? (analyzeState.result?.metrics.beta ?? 0).toFixed(2)
                                                  : '--'}
                                              </div>
                                            </div>
                                            <div>
                                              <div className="stat-label">Volatility</div>
                                              <div className="stat-value">{formatPct(analyzeState.result?.metrics.vol ?? NaN)}</div>
                                            </div>
                                            <div>
                                              <div className="stat-label">Win Rate</div>
                                              <div className="stat-value">{formatPct(analyzeState.result?.metrics.winRate ?? NaN)}</div>
                                            </div>
                                            <div>
                                              <div className="stat-label">Turnover</div>
                                              <div className="stat-value">{formatPct(analyzeState.result?.metrics.avgTurnover ?? NaN)}</div>
                                            </div>
                                            <div>
                                              <div className="stat-label">Avg Holdings</div>
                                              <div className="stat-value">
                                                {Number.isFinite(analyzeState.result?.metrics.avgHoldings ?? NaN)
                                                  ? (analyzeState.result?.metrics.avgHoldings ?? 0).toFixed(1)
                                                  : '--'}
                                              </div>
                                            </div>
                                            <div>
                                              <div className="stat-label">Trading Days</div>
                                              <div className="stat-value">{analyzeState.result?.metrics.days ?? '--'}</div>
                                            </div>
                                          </div>
                                          <div className="mt-2 text-xs text-muted">
                                            Period: {analyzeState.result?.metrics.startDate ?? '--'} to {analyzeState.result?.metrics.endDate ?? '--'}
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  <button onClick={() => runAnalyzeBacktest(b)}>Run backtest</button>
                                )}

                                </div>

                                <div className="saved-item flex flex-col gap-2.5 h-full min-w-0">
                                  <div className="font-black">Information</div>
                                  <div className="text-xs text-muted font-extrabold">Placeholder text: Information, tickers, etc</div>
                                  <div className="font-black mt-1.5">Tickers</div>
                                  <div className="flex-1 overflow-auto border border-border rounded-xl max-w-full">
                                    {(() => {
                                      try {
                                        if (analyzeState?.status !== 'done' || !analyzeState.result) {
                                          return <div className="p-2.5 text-muted">Run a backtest to populate historical stats.</div>
                                        }
                                        const botRes = analyzeState.result
                                        const prepared = normalizeNodeForBacktest(ensureSlots(cloneNode(b.payload)))
                                        const positionTickers = collectPositionTickers(prepared, callChainsById).filter(
                                          (t) => t && t !== 'Empty' && t !== 'CASH',
                                        )
                                        positionTickers.sort()
                                        const tickers = [...positionTickers, 'CASH']

                                        const days = botRes.days || []
                                        const denom = days.length || 1
                                        const allocSum = new Map<string, number>()
                                        for (const d of days) {
                                          let dayTotal = 0
                                          let sawCash = false
                                          for (const h of d.holdings || []) {
                                            const key = normalizeChoice(h.ticker)
                                            if (key === 'Empty') continue
                                            const w = Number(h.weight || 0)
                                            allocSum.set(key, (allocSum.get(key) || 0) + w)
                                            dayTotal += w
                                            if (key === 'CASH') sawCash = true
                                          }
                                          if (!sawCash) {
                                            const impliedCash = Math.max(0, 1 - dayTotal)
                                            allocSum.set('CASH', (allocSum.get('CASH') || 0) + impliedCash)
                                          }
                                        }
                                        const histAlloc = (ticker: string) => (allocSum.get(ticker) || 0) / denom

                                        const toggleSort = (column: string) => {
                                          setAnalyzeTickerSort((prev) => {
                                            if (prev.column === column) return { column, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                                            return { column, dir: column === 'ticker' ? 'asc' : 'desc' }
                                          })
                                        }

                                        const sortGlyph = (column: string) =>
                                          analyzeTickerSort.column === column ? (analyzeTickerSort.dir === 'asc' ? ' ▲' : ' ▼') : ''

                                        const rows = tickers.map((t) => {
                                          const display = t === 'CASH' ? 'Cash' : t
                                          const key = `${b.id}:${t}:${backtestMode}:${botRes.metrics.startDate}:${botRes.metrics.endDate}`
                                          const st = t === 'CASH' ? null : analyzeTickerContrib[key]
                                          return { t, display, key, st, histAllocation: histAlloc(t) }
                                        })

                                        const sortedRows = [...rows].sort((a, b) => {
                                          if (a.t === 'CASH' && b.t !== 'CASH') return 1
                                          if (b.t === 'CASH' && a.t !== 'CASH') return -1

                                          const col = analyzeTickerSort.column
                                          const mult = analyzeTickerSort.dir === 'asc' ? 1 : -1

                                          if (col === 'ticker') return mult * a.display.localeCompare(b.display)

                                          const aVal =
                                            col === 'histAllocation'
                                              ? a.histAllocation
                                              : col === 'histReturnPct'
                                                ? a.st?.status === 'done'
                                                  ? a.st.returnPct ?? NaN
                                                  : NaN
                                                : col === 'histExpectancy'
                                                  ? a.st?.status === 'done'
                                                    ? a.st.expectancy ?? NaN
                                                    : NaN
                                                  : 0
                                          const bVal =
                                            col === 'histAllocation'
                                              ? b.histAllocation
                                              : col === 'histReturnPct'
                                                ? b.st?.status === 'done'
                                                  ? b.st.returnPct ?? NaN
                                                  : NaN
                                                : col === 'histExpectancy'
                                                  ? b.st?.status === 'done'
                                                    ? b.st.expectancy ?? NaN
                                                    : NaN
                                                  : 0

                                          const aOk = Number.isFinite(aVal)
                                          const bOk = Number.isFinite(bVal)
                                          if (!aOk && !bOk) return a.display.localeCompare(b.display)
                                          if (!aOk) return 1
                                          if (!bOk) return -1
                                          return mult * ((aVal as number) - (bVal as number))
                                        })

                                        return (
                                          <table className="analyze-ticker-table">
                                            <thead>
                                              <tr>
                                                <th />
                                                <th colSpan={3} className="text-center">
                                                  Live
                                                </th>
                                                <th colSpan={3} className="text-center">
                                                  Historical
                                                </th>
                                              </tr>
                                              <tr>
                                                <th onClick={() => toggleSort('ticker')} className="cursor-pointer">
                                                  Tickers{sortGlyph('ticker')}
                                                </th>
                                                <th onClick={() => toggleSort('liveAllocation')} className="cursor-pointer">
                                                  Allocation{sortGlyph('liveAllocation')}
                                                </th>
                                                <th onClick={() => toggleSort('liveCagr')} className="cursor-pointer">
                                                  CAGR{sortGlyph('liveCagr')}
                                                </th>
                                                <th onClick={() => toggleSort('liveExpectancy')} className="cursor-pointer">
                                                  Expectancy{sortGlyph('liveExpectancy')}
                                                </th>
                                                <th onClick={() => toggleSort('histAllocation')} className="cursor-pointer">
                                                  Allocation{sortGlyph('histAllocation')}
                                                </th>
                                                <th onClick={() => toggleSort('histReturnPct')} className="cursor-pointer">
                                                  Return %{sortGlyph('histReturnPct')}
                                                </th>
                                                <th onClick={() => toggleSort('histExpectancy')} className="cursor-pointer">
                                                  Expectancy{sortGlyph('histExpectancy')}
                                                </th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {sortedRows.map((row) => {
                                                const t = row.t
                                                const st =
                                                  t === 'CASH' ? ({ status: 'done', returnPct: 0, expectancy: 0 } as TickerContributionState) : row.st
                                                const histReturn =
                                                  !st
                                                    ? '...'
                                                    : st.status === 'done'
                                                      ? formatPct(st.returnPct ?? NaN)
                                                      : st.status === 'loading'
                                                        ? '...'
                                                        : '—'
                                                const histExpectancy =
                                                  !st
                                                    ? '...'
                                                    : st.status === 'done'
                                                      ? formatPct(st.expectancy ?? NaN)
                                                      : st.status === 'loading'
                                                        ? '...'
                                                        : '—'
                                                return (
                                                  <tr key={t}>
                                                    <td className="font-black">{row.display}</td>
                                                    <td>{formatPct(0)}</td>
                                                    <td>{formatPct(0)}</td>
                                                    <td>{formatPct(0)}</td>
                                                    <td>{formatPct(row.histAllocation)}</td>
                                                    <td>{histReturn}</td>
                                                    <td>{histExpectancy}</td>
                                                  </tr>
                                                )
                                              })}
                                            </tbody>
                                          </table>
                                        )
                                      } catch {
                                        return <div className="p-2.5 text-muted">Unable to read tickers.</div>
                                      }
                                    })()}
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Advanced Tab Content */}
                            {(uiState.analyzeBotCardTab[b.id] ?? 'overview') === 'advanced' && (
                              <div className="saved-item flex flex-col gap-2.5 h-full min-w-0">
                                <div className="flex items-center justify-between gap-2.5">
                                  <div className="font-black">Advanced Stats</div>
                                  <Button
                                    size="sm"
                                    onClick={() => {
                                      // Run both sanity report (for MC/KF) and benchmark fetch
                                      runSanityReport(b)
                                      fetchBenchmarkMetrics()
                                    }}
                                    disabled={sanityReports[b.id]?.status === 'loading' || benchmarkMetrics.status === 'loading'}
                                  >
                                    {sanityReports[b.id]?.status === 'loading' || benchmarkMetrics.status === 'loading' ? 'Running...' : 'Run'}
                                  </Button>
                                </div>
                                <div className="font-black">Comparison Table</div>
                                <div className="flex-1 overflow-auto border border-border rounded-xl max-w-full">
                                  {(() => {
                                    const sanityState = sanityReports[b.id]
                                    const mcMetrics = sanityState?.report?.pathRisk?.comparisonMetrics?.monteCarlo
                                    const kfMetrics = sanityState?.report?.pathRisk?.comparisonMetrics?.kfold
                                    const benchmarks = benchmarkMetrics.data ?? {}
                                    // Strategy betas vs each benchmark ticker
                                    const strategyBetas: Record<string, number> = (sanityState?.report as { strategyBetas?: Record<string, number> })?.strategyBetas ?? {}

                                    // Helper to format metrics for display
                                    const fmt = (v: number | undefined, isPct = false, isRatio = false) => {
                                      if (v === undefined || !Number.isFinite(v)) return '—'
                                      if (isPct) return `${(v * 100).toFixed(1)}%`
                                      if (isRatio) return v.toFixed(2)
                                      return v.toFixed(2)
                                    }

                                    // Helper to format alpha difference with color
                                    // MC is the baseline - shows how much better MC is vs the row
                                    // For "higher is better" metrics (CAGR, Sharpe): if MC > row, green (strategy beats benchmark)
                                    // For "lower is better" metrics (MaxDD, Volatility): if MC > row, green (less negative = better)
                                    // Note: MaxDD values are negative, so MC -16% vs benchmark -18% gives diff +2%, which is better
                                    const fmtAlpha = (mcVal: number | undefined, rowVal: number | undefined, isPct = false, isHigherBetter = true) => {
                                      if (mcVal === undefined || rowVal === undefined || !Number.isFinite(mcVal) || !Number.isFinite(rowVal)) return null
                                      const diff = mcVal - rowVal // MC minus row value
                                      // For drawdown metrics (negative values where less negative is better), positive diff = MC is better
                                      // For volatility/beta (positive values where lower is better), negative diff = MC is better
                                      // Simplified: for "lower is better", flip the comparison for negative metrics like MaxDD
                                      const mcIsBetter = isHigherBetter ? diff > 0 : (mcVal < 0 ? diff > 0 : diff < 0)
                                      const color = mcIsBetter ? 'text-success' : diff === 0 ? 'text-muted' : 'text-danger'
                                      const sign = diff > 0 ? '+' : ''
                                      const formatted = isPct ? `${sign}${(diff * 100).toFixed(1)}%` : `${sign}${diff.toFixed(2)}`
                                      return <span className={`${color} text-xs ml-1`}>({formatted})</span>
                                    }

                                    // Build row data - MC is baseline (no alpha), all others show alpha vs MC
                                    type RowData = { label: string; metrics: ComparisonMetrics | undefined; isBaseline?: boolean; ticker?: string }
                                    const rowData: RowData[] = [
                                      { label: 'Monte Carlo Comparison', metrics: mcMetrics, isBaseline: true },
                                      { label: 'K-Fold Comparison', metrics: kfMetrics },
                                      { label: 'Benchmark VTI', metrics: benchmarks['VTI'], ticker: 'VTI' },
                                      { label: 'Benchmark SPY', metrics: benchmarks['SPY'], ticker: 'SPY' },
                                      { label: 'Benchmark QQQ', metrics: benchmarks['QQQ'], ticker: 'QQQ' },
                                      { label: 'Benchmark DIA', metrics: benchmarks['DIA'], ticker: 'DIA' },
                                      { label: 'Benchmark DBC', metrics: benchmarks['DBC'], ticker: 'DBC' },
                                      { label: 'Benchmark DBO', metrics: benchmarks['DBO'], ticker: 'DBO' },
                                      { label: 'Benchmark GLD', metrics: benchmarks['GLD'], ticker: 'GLD' },
                                      { label: 'Benchmark BND', metrics: benchmarks['BND'], ticker: 'BND' },
                                      { label: 'Benchmark TLT', metrics: benchmarks['TLT'], ticker: 'TLT' },
                                      { label: 'Benchmark GBTC', metrics: benchmarks['GBTC'], ticker: 'GBTC' },
                                    ]

                                    // Define columns with "higher is better" flag for alpha coloring
                                    const cols: { key: keyof ComparisonMetrics; label: string; isPct?: boolean; isRatio?: boolean; higherBetter?: boolean }[] = [
                                      { key: 'cagr50', label: 'CAGR-50', isPct: true, higherBetter: true },
                                      { key: 'maxdd50', label: 'MaxDD-DD50', isPct: true, higherBetter: false }, // Less negative is better
                                      { key: 'maxdd95', label: 'Tail Risk-DD95', isPct: true, higherBetter: false },
                                      { key: 'calmar50', label: 'Calmar Ratio-50', isRatio: true, higherBetter: true },
                                      { key: 'calmar95', label: 'Calmar Ratio-95', isRatio: true, higherBetter: true },
                                      { key: 'sharpe', label: 'Sharpe Ratio', isRatio: true, higherBetter: true },
                                      { key: 'sortino', label: 'Sortino Ratio', isRatio: true, higherBetter: true },
                                      { key: 'treynor', label: 'Treynor Ratio', isRatio: true, higherBetter: true },
                                      { key: 'beta', label: 'Beta', isRatio: true, higherBetter: false }, // Lower beta = less volatile
                                      { key: 'volatility', label: 'Volatility', isPct: true, higherBetter: false }, // Lower vol is better
                                      { key: 'winRate', label: 'Win Rate', isPct: true, higherBetter: true },
                                    ]

                                    return (
                                      <table className="analyze-compare-table">
                                        <thead>
                                          <tr>
                                            <th>Comparison</th>
                                            {cols.map((c) => (
                                              <th key={c.key}>{c.label}</th>
                                            ))}
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {rowData.map((row) => (
                                            <tr key={row.label}>
                                              <td>{row.label}</td>
                                              {cols.map((c) => {
                                                // For Beta column in benchmark rows, show strategy beta vs that ticker
                                                let val = row.metrics?.[c.key]
                                                if (c.key === 'beta' && row.ticker && strategyBetas[row.ticker] !== undefined) {
                                                  val = strategyBetas[row.ticker]
                                                }
                                                // Show alpha vs MC for all non-baseline rows
                                                const showAlpha = !row.isBaseline && mcMetrics
                                                const mcVal = mcMetrics?.[c.key]
                                                const alpha = showAlpha ? fmtAlpha(mcVal, val, c.isPct ?? false, c.higherBetter ?? true) : null
                                                return (
                                                  <td key={c.key}>
                                                    {fmt(val, c.isPct ?? false, c.isRatio ?? false)}
                                                    {alpha}
                                                  </td>
                                                )
                                              })}
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    )
                                  })()}
                                </div>
                              </div>
                            )}

                            {/* Robustness Tab Content */}
                            {(uiState.analyzeBotCardTab[b.id] ?? 'overview') === 'robustness' && (
                              <div className="saved-item flex flex-col gap-2.5 h-full min-w-0">
                                {(() => {
                                  const sanityState = sanityReports[b.id] ?? { status: 'idle' as const }
                                  const getLevelColor = (level: string) => {
                                    if (level === 'Low') return 'text-success'
                                    if (level === 'Medium') return 'text-warning'
                                    if (level === 'High' || level === 'Fragile') return 'text-danger'
                                    return 'text-muted'
                                  }
                                  const getLevelIcon = (level: string) => {
                                    if (level === 'Low') return '🟢'
                                    if (level === 'Medium') return '🟡'
                                    if (level === 'High' || level === 'Fragile') return '🔴'
                                    return '⚪'
                                  }
                                  const formatPctVal = (v: number) => Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '--'
                                  const formatDDPct = (v: number) => Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '--'

                                  return (
                                    <>
                                      <div className="flex items-center justify-between gap-2.5">
                                        <div className="font-black">Robustness Analysis</div>
                                        <Button
                                          size="sm"
                                          onClick={() => runSanityReport(b)}
                                          disabled={sanityState.status === 'loading'}
                                        >
                                          {sanityState.status === 'loading' ? 'Running...' : sanityState.status === 'done' ? 'Re-run' : 'Generate'}
                                        </Button>
                                      </div>

                                      {sanityState.status === 'idle' && (
                                        <div className="text-muted text-sm p-4 border border-border rounded-xl text-center">
                                          Click "Generate" to run bootstrap simulations and fragility analysis.
                                          <br />
                                          <span className="text-xs">This may take 10-30 seconds.</span>
                                        </div>
                                      )}

                                      {sanityState.status === 'loading' && (
                                        <div className="text-muted text-sm p-4 border border-border rounded-xl text-center">
                                          <div className="animate-pulse">Running bootstrap simulations...</div>
                                          <div className="text-xs mt-1">Monte Carlo + K-Fold analysis in progress</div>
                                        </div>
                                      )}

                                      {sanityState.status === 'error' && (
                                        <div className="text-danger text-sm p-4 border border-danger rounded-xl">
                                          Error: {sanityState.error}
                                        </div>
                                      )}

                                      {sanityState.status === 'done' && sanityState.report && (
                                        <>
                                          {/* 4-Column Grid Layout */}
                                          <div className="grid grid-cols-4 gap-3 w-full h-full">
                                            {/* Left Card: Summary & Fragility */}
                                            <div className="border border-border rounded-xl p-3 flex flex-col gap-3 h-full">
                                              {/* Summary */}
                                              <div>
                                                <div className="text-xs font-bold mb-1.5 text-center">Summary</div>
                                                {sanityState.report.summary.length > 0 ? (
                                                  <ul className="text-xs space-y-0.5">
                                                    {sanityState.report.summary.map((s, i) => (
                                                      <li key={i} className="flex items-start gap-1.5">
                                                        <span className="text-warning">•</span>
                                                        <span>{s}</span>
                                                      </li>
                                                    ))}
                                                  </ul>
                                                ) : (
                                                  <div className="text-xs text-muted">No major red flags detected.</div>
                                                )}
                                              </div>

                                              {/* Fragility Table (Condensed) */}
                                              <div>
                                                <div className="text-xs font-bold mb-1.5 text-center">Fragility Fingerprints</div>
                                                <div className="space-y-1">
                                                  {[
                                                    { name: 'Sub-Period', data: sanityState.report.fragility.subPeriodStability, tooltip: 'Consistency of returns across different time periods. Low = stable across all periods.' },
                                                    { name: 'Profit Conc.', data: sanityState.report.fragility.profitConcentration, tooltip: 'How concentrated profits are in a few big days. Low = profits spread evenly.' },
                                                    { name: 'Smoothness', data: sanityState.report.fragility.smoothnessScore, tooltip: 'How smooth the equity curve is. Normal = acceptable volatility in growth.' },
                                                    { name: 'Thinning', data: sanityState.report.fragility.thinningFragility, tooltip: 'Sensitivity to removing random trades. Robust = performance holds when trades removed.' },
                                                  ].map(({ name, data, tooltip }) => (
                                                    <div key={name} className="flex items-center gap-2 text-xs" title={tooltip}>
                                                      <span className="w-20 truncate text-muted cursor-help">{name}</span>
                                                      <span className={cn("w-16", getLevelColor(data.level))}>
                                                        {getLevelIcon(data.level)} {data.level}
                                                      </span>
                                                    </div>
                                                  ))}
                                                </div>
                                              </div>

                                              {/* DD Probabilities */}
                                              <div>
                                                <div className="text-xs font-bold mb-1.5 text-center">DD Probability</div>
                                                <div className="space-y-0.5 text-xs">
                                                  <div><span className="font-semibold">{formatPctVal(sanityState.report.pathRisk.drawdownProbabilities.gt20)}</span> chance of 20% DD</div>
                                                  <div><span className="font-semibold">{formatPctVal(sanityState.report.pathRisk.drawdownProbabilities.gt30)}</span> chance of 30% DD</div>
                                                  <div><span className="font-semibold">{formatPctVal(sanityState.report.pathRisk.drawdownProbabilities.gt40)}</span> chance of 40% DD</div>
                                                  <div><span className="font-semibold">{formatPctVal(sanityState.report.pathRisk.drawdownProbabilities.gt50)}</span> chance of 50% DD</div>
                                                </div>
                                              </div>
                                            </div>

                                            {/* Middle Card: Monte Carlo */}
                                            <div className="border border-border rounded-xl p-3 flex flex-col h-full">
                                              <div className="text-xs font-bold mb-2 text-center">Monte Carlo (2000 years)</div>

                                              {/* MC Drawdown Distribution */}
                                              <div className="mb-3">
                                                <div className="text-xs text-muted mb-1 cursor-help text-center" title="Distribution of maximum drawdowns across 400 simulated 5-year paths (2000 total years). Shows worst-case (P5), median, and best-case (P95) scenarios.">Max Drawdown Distribution</div>
                                                {(() => {
                                                  const dd = sanityState.report.pathRisk.monteCarlo.drawdowns
                                                  // Drawdowns are negative: p95 is worst (most negative), p5 is best (least negative)
                                                  // Scale: worst (p95) on left at 0%, best (p5) on right at 100%
                                                  const minVal = dd.p95 // Most negative = left side
                                                  const maxVal = dd.p5  // Least negative = right side
                                                  const range = maxVal - minVal || 0.01
                                                  const toPos = (v: number) => Math.max(0, Math.min(100, ((v - minVal) / range) * 100))
                                                  return (
                                                    <>
                                                      <div className="relative h-4 bg-muted/30 rounded overflow-hidden">
                                                        {/* P25-P75 range */}
                                                        <div
                                                          className="absolute h-full bg-danger/40"
                                                          style={{ left: `${toPos(dd.p75)}%`, width: `${Math.abs(toPos(dd.p25) - toPos(dd.p75))}%` }}
                                                        />
                                                        {/* P50 marker */}
                                                        <div
                                                          className="absolute h-full w-0.5 bg-danger"
                                                          style={{ left: `${toPos(dd.p50)}%` }}
                                                        />
                                                      </div>
                                                      <div className="flex justify-between text-xs mt-0.5">
                                                        <span className="text-danger">P95: {formatDDPct(dd.p5)}</span>
                                                        <span className="font-semibold">P50: {formatDDPct(dd.p50)}</span>
                                                        <span className="text-success">P5: {formatDDPct(dd.p95)}</span>
                                                      </div>
                                                    </>
                                                  )
                                                })()}
                                              </div>

                                              {/* MC CAGR Distribution */}
                                              <div>
                                                <div className="text-xs text-muted mb-1 cursor-help text-center" title="Distribution of annualized returns (CAGR) across 200 simulated 5-year paths. P5 is worst, P95 is best expected returns.">CAGR Distribution</div>
                                                {(() => {
                                                  const cagr = sanityState.report.pathRisk.monteCarlo.cagrs
                                                  const minVal = Math.min(cagr.p5, cagr.p95)
                                                  const maxVal = Math.max(cagr.p5, cagr.p95)
                                                  const range = maxVal - minVal || 1
                                                  const toPos = (v: number) => ((v - minVal) / range) * 100
                                                  return (
                                                    <>
                                                      <div className="relative h-4 bg-muted/30 rounded overflow-hidden">
                                                        {/* P25-P75 range */}
                                                        <div
                                                          className="absolute h-full bg-success/40"
                                                          style={{ left: `${toPos(cagr.p25)}%`, width: `${toPos(cagr.p75) - toPos(cagr.p25)}%` }}
                                                        />
                                                        {/* P50 marker */}
                                                        <div
                                                          className="absolute h-full w-0.5 bg-success"
                                                          style={{ left: `${toPos(cagr.p50)}%` }}
                                                        />
                                                      </div>
                                                      <div className="flex justify-between text-xs mt-0.5">
                                                        <span className="text-danger">P5: {formatDDPct(cagr.p5)}</span>
                                                        <span className="font-semibold">P50: {formatDDPct(cagr.p50)}</span>
                                                        <span className="text-success">P95: {formatDDPct(cagr.p95)}</span>
                                                      </div>
                                                    </>
                                                  )
                                                })()}
                                              </div>

                                              {/* MC Sharpe Distribution */}
                                              {sanityState.report.pathRisk.monteCarlo.sharpes && (
                                                <div className="mb-3">
                                                  <div className="text-xs text-muted mb-1 cursor-help text-center" title="Distribution of Sharpe ratios across Monte Carlo simulations. Higher is better.">Sharpe Distribution</div>
                                                  {(() => {
                                                    const sh = sanityState.report.pathRisk.monteCarlo.sharpes
                                                    // Sharpe: higher is better, so P5 (worst) on left, P95 (best) on right
                                                    const minVal = sh.p5
                                                    const maxVal = sh.p95
                                                    const range = maxVal - minVal || 0.01
                                                    const toPos = (v: number) => Math.max(0, Math.min(100, ((v - minVal) / range) * 100))
                                                    const hasP25P75 = sh.p25 != null && sh.p75 != null
                                                    return (
                                                      <>
                                                        <div className="relative h-4 bg-muted/30 rounded overflow-hidden">
                                                          {/* P25-P75 range (green for good Sharpe) - only if we have p25/p75 */}
                                                          {hasP25P75 && (
                                                            <div
                                                              className="absolute h-full bg-success/40"
                                                              style={{ left: `${toPos(sh.p25)}%`, width: `${toPos(sh.p75) - toPos(sh.p25)}%` }}
                                                            />
                                                          )}
                                                          {/* P50 marker */}
                                                          <div
                                                            className="absolute h-full w-0.5 bg-success"
                                                            style={{ left: `${toPos(sh.p50)}%` }}
                                                          />
                                                        </div>
                                                        <div className="flex justify-between text-xs mt-0.5">
                                                          <span className="text-danger">P5: {sh.p5?.toFixed(2) ?? '-'}</span>
                                                          <span className="font-semibold">P50: {sh.p50?.toFixed(2) ?? '-'}</span>
                                                          <span className="text-success">P95: {sh.p95?.toFixed(2) ?? '-'}</span>
                                                        </div>
                                                      </>
                                                    )
                                                  })()}
                                                </div>
                                              )}

                                              {/* MC Volatility Distribution */}
                                              {sanityState.report.pathRisk.monteCarlo.volatilities && (
                                                <div>
                                                  <div className="text-xs text-muted mb-1 cursor-help text-center" title="Distribution of annualized volatility across Monte Carlo simulations. Lower is generally better.">Volatility Distribution</div>
                                                  {(() => {
                                                    const vol = sanityState.report.pathRisk.monteCarlo.volatilities
                                                    // Volatility: lower is better, so flip - P95 (worst/high vol) on left, P5 (best/low vol) on right
                                                    const minVal = vol.p95 // High vol = left side (bad)
                                                    const maxVal = vol.p5  // Low vol = right side (good)
                                                    const range = maxVal - minVal || 0.01
                                                    const toPos = (v: number) => Math.max(0, Math.min(100, ((v - minVal) / range) * 100))
                                                    const hasP25P75 = vol.p25 != null && vol.p75 != null
                                                    return (
                                                      <>
                                                        <div className="relative h-4 bg-muted/30 rounded overflow-hidden">
                                                          {/* P25-P75 range (red for volatility since it's bad) - only if we have p25/p75 */}
                                                          {hasP25P75 && (
                                                            <div
                                                              className="absolute h-full bg-danger/40"
                                                              style={{ left: `${toPos(vol.p75)}%`, width: `${toPos(vol.p25) - toPos(vol.p75)}%` }}
                                                            />
                                                          )}
                                                          {/* P50 marker */}
                                                          <div
                                                            className="absolute h-full w-0.5 bg-danger"
                                                            style={{ left: `${toPos(vol.p50)}%` }}
                                                          />
                                                        </div>
                                                        <div className="flex justify-between text-xs mt-0.5">
                                                          <span className="text-danger">P95: {formatDDPct(vol.p95)}</span>
                                                          <span className="font-semibold">P50: {formatDDPct(vol.p50)}</span>
                                                          <span className="text-success">P5: {formatDDPct(vol.p5)}</span>
                                                        </div>
                                                      </>
                                                    )
                                                  })()}
                                                </div>
                                              )}
                                            </div>

                                            {/* Distribution Curves Card */}
                                            <div className="border border-border rounded-xl p-3 flex flex-col gap-3 h-full">
                                              <div className="text-xs font-bold mb-1 text-center">Distribution Curves</div>

                                              {/* CAGR Distribution Bar Chart */}
                                              <div>
                                                <div className="text-xs text-muted mb-1 cursor-help text-center" title="Distribution of CAGR values across 200 Monte Carlo simulations. Each bar represents a bucket of CAGR values.">CAGR Distribution</div>
                                                {(() => {
                                                  const histogram = sanityState.report.pathRisk.monteCarlo.cagrs.histogram
                                                  if (!histogram || histogram.length === 0) return <div className="text-xs text-muted">No histogram data</div>
                                                  const maxCount = Math.max(...histogram.map((b: { count: number }) => b.count))
                                                  return (
                                                    <div className="flex items-end gap-px h-16">
                                                      {histogram.map((bucket: { midpoint: number; count: number; min: number; max: number }, i: number) => {
                                                        const heightPct = maxCount > 0 ? (bucket.count / maxCount) * 100 : 0
                                                        const isPositive = bucket.midpoint >= 0
                                                        return (
                                                          <div
                                                            key={i}
                                                            className={`flex-1 rounded-t ${isPositive ? 'bg-success/60' : 'bg-danger/60'}`}
                                                            style={{ height: `${heightPct}%`, minHeight: bucket.count > 0 ? '2px' : '0' }}
                                                            title={`${(bucket.min * 100).toFixed(1)}% to ${(bucket.max * 100).toFixed(1)}%: ${bucket.count} sims`}
                                                          />
                                                        )
                                                      })}
                                                    </div>
                                                  )
                                                })()}
                                                <div className="flex justify-between text-xs mt-0.5">
                                                  <span className="text-muted">{((sanityState.report.pathRisk.monteCarlo.cagrs.histogram?.[0]?.min ?? 0) * 100).toFixed(0)}%</span>
                                                  <span className="text-muted">{((sanityState.report.pathRisk.monteCarlo.cagrs.histogram?.[sanityState.report.pathRisk.monteCarlo.cagrs.histogram.length - 1]?.max ?? 0) * 100).toFixed(0)}%</span>
                                                </div>
                                              </div>

                                              {/* MaxDD Distribution Bar Chart */}
                                              <div>
                                                <div className="text-xs text-muted mb-1 cursor-help text-center" title="Distribution of Max Drawdown values across 200 Monte Carlo simulations. Each bar represents a bucket of drawdown values.">Max Drawdown Distribution</div>
                                                {(() => {
                                                  const histogram = sanityState.report.pathRisk.monteCarlo.drawdowns.histogram
                                                  if (!histogram || histogram.length === 0) return <div className="text-xs text-muted">No histogram data</div>
                                                  const maxCount = Math.max(...histogram.map((b: { count: number }) => b.count))
                                                  return (
                                                    <div className="flex items-end gap-px h-16">
                                                      {histogram.map((bucket: { midpoint: number; count: number; min: number; max: number }, i: number) => {
                                                        const heightPct = maxCount > 0 ? (bucket.count / maxCount) * 100 : 0
                                                        // Drawdowns are all negative, use gradient from danger to warning
                                                        const severity = Math.abs(bucket.midpoint)
                                                        const bgClass = severity > 0.4 ? 'bg-danger/80' : severity > 0.25 ? 'bg-danger/60' : 'bg-warning/60'
                                                        return (
                                                          <div
                                                            key={i}
                                                            className={`flex-1 rounded-t ${bgClass}`}
                                                            style={{ height: `${heightPct}%`, minHeight: bucket.count > 0 ? '2px' : '0' }}
                                                            title={`${(bucket.min * 100).toFixed(1)}% to ${(bucket.max * 100).toFixed(1)}%: ${bucket.count} sims`}
                                                          />
                                                        )
                                                      })}
                                                    </div>
                                                  )
                                                })()}
                                                <div className="flex justify-between text-xs mt-0.5">
                                                  <span className="text-muted">{((sanityState.report.pathRisk.monteCarlo.drawdowns.histogram?.[0]?.min ?? 0) * 100).toFixed(0)}%</span>
                                                  <span className="text-muted">{((sanityState.report.pathRisk.monteCarlo.drawdowns.histogram?.[sanityState.report.pathRisk.monteCarlo.drawdowns.histogram.length - 1]?.max ?? 0) * 100).toFixed(0)}%</span>
                                                </div>
                                              </div>
                                            </div>

                                            {/* Right Card: K-Fold */}
                                            <div className="border border-border rounded-xl p-3 flex flex-col h-full">
                                              <div className="text-xs font-bold mb-2 text-center">K-Fold (200 Folds)</div>

                                              {/* KF Drawdown Distribution */}
                                              <div className="mb-3">
                                                <div className="text-xs text-muted mb-1 cursor-help text-center" title="Distribution of maximum drawdowns across 200 K-Fold subsets (90% of data each). Tests stability when portions of history are removed.">Max Drawdown Distribution</div>
                                                {(() => {
                                                  const dd = sanityState.report.pathRisk.kfold.drawdowns
                                                  // Drawdowns are negative: p95 is worst (most negative), p5 is best (least negative)
                                                  // Scale: worst (p95) on left at 0%, best (p5) on right at 100%
                                                  const minVal = dd.p95 // Most negative = left side
                                                  const maxVal = dd.p5  // Least negative = right side
                                                  const range = maxVal - minVal || 0.01
                                                  const toPos = (v: number) => Math.max(0, Math.min(100, ((v - minVal) / range) * 100))
                                                  return (
                                                    <>
                                                      <div className="relative h-4 bg-muted/30 rounded overflow-hidden">
                                                        {/* P25-P75 range */}
                                                        <div
                                                          className="absolute h-full bg-danger/40"
                                                          style={{ left: `${toPos(dd.p75)}%`, width: `${Math.abs(toPos(dd.p25) - toPos(dd.p75))}%` }}
                                                        />
                                                        {/* P50 marker */}
                                                        <div
                                                          className="absolute h-full w-0.5 bg-danger"
                                                          style={{ left: `${toPos(dd.p50)}%` }}
                                                        />
                                                      </div>
                                                      <div className="flex justify-between text-xs mt-0.5">
                                                        <span className="text-danger">P95: {formatDDPct(dd.p5)}</span>
                                                        <span className="font-semibold">P50: {formatDDPct(dd.p50)}</span>
                                                        <span className="text-success">P5: {formatDDPct(dd.p95)}</span>
                                                      </div>
                                                    </>
                                                  )
                                                })()}
                                              </div>

                                              {/* KF CAGR Distribution */}
                                              <div>
                                                <div className="text-xs text-muted mb-1 cursor-help text-center" title="Distribution of annualized returns across 200 K-Fold subsets. Tests how consistent CAGR is when portions of history are removed.">CAGR Distribution</div>
                                                {(() => {
                                                  const cagr = sanityState.report.pathRisk.kfold.cagrs
                                                  const minVal = Math.min(cagr.p5, cagr.p95)
                                                  const maxVal = Math.max(cagr.p5, cagr.p95)
                                                  const range = maxVal - minVal || 1
                                                  const toPos = (v: number) => ((v - minVal) / range) * 100
                                                  return (
                                                    <>
                                                      <div className="relative h-4 bg-muted/30 rounded overflow-hidden">
                                                        {/* P25-P75 range */}
                                                        <div
                                                          className="absolute h-full bg-success/40"
                                                          style={{ left: `${toPos(cagr.p25)}%`, width: `${toPos(cagr.p75) - toPos(cagr.p25)}%` }}
                                                        />
                                                        {/* P50 marker */}
                                                        <div
                                                          className="absolute h-full w-0.5 bg-success"
                                                          style={{ left: `${toPos(cagr.p50)}%` }}
                                                        />
                                                      </div>
                                                      <div className="flex justify-between text-xs mt-0.5">
                                                        <span className="text-danger">P5: {formatDDPct(cagr.p5)}</span>
                                                        <span className="font-semibold">P50: {formatDDPct(cagr.p50)}</span>
                                                        <span className="text-success">P95: {formatDDPct(cagr.p95)}</span>
                                                      </div>
                                                    </>
                                                  )
                                                })()}
                                              </div>

                                              {/* KF Sharpe Distribution */}
                                              {sanityState.report.pathRisk.kfold.sharpes && (
                                                <div className="mb-3">
                                                  <div className="text-xs text-muted mb-1 cursor-help text-center" title="Distribution of Sharpe ratios across K-Fold subsets. Higher is better.">Sharpe Distribution</div>
                                                  {(() => {
                                                    const sh = sanityState.report.pathRisk.kfold.sharpes
                                                    // Sharpe: higher is better, so P5 (worst) on left, P95 (best) on right
                                                    const minVal = sh.p5
                                                    const maxVal = sh.p95
                                                    const range = maxVal - minVal || 0.01
                                                    const toPos = (v: number) => Math.max(0, Math.min(100, ((v - minVal) / range) * 100))
                                                    const hasP25P75 = sh.p25 != null && sh.p75 != null
                                                    return (
                                                      <>
                                                        <div className="relative h-4 bg-muted/30 rounded overflow-hidden">
                                                          {/* P25-P75 range (green for good Sharpe) - only if we have p25/p75 */}
                                                          {hasP25P75 && (
                                                            <div
                                                              className="absolute h-full bg-success/40"
                                                              style={{ left: `${toPos(sh.p25)}%`, width: `${toPos(sh.p75) - toPos(sh.p25)}%` }}
                                                            />
                                                          )}
                                                          <div
                                                            className="absolute h-full w-0.5 bg-success"
                                                            style={{ left: `${toPos(sh.p50)}%` }}
                                                          />
                                                        </div>
                                                        <div className="flex justify-between text-xs mt-0.5">
                                                          <span className="text-danger">P5: {sh.p5?.toFixed(2) ?? '-'}</span>
                                                          <span className="font-semibold">P50: {sh.p50?.toFixed(2) ?? '-'}</span>
                                                          <span className="text-success">P95: {sh.p95?.toFixed(2) ?? '-'}</span>
                                                        </div>
                                                      </>
                                                    )
                                                  })()}
                                                </div>
                                              )}

                                              {/* KF Volatility Distribution */}
                                              {sanityState.report.pathRisk.kfold.volatilities && (
                                                <div>
                                                  <div className="text-xs text-muted mb-1 cursor-help text-center" title="Distribution of annualized volatility across K-Fold subsets. Lower is generally better.">Volatility Distribution</div>
                                                  {(() => {
                                                    const vol = sanityState.report.pathRisk.kfold.volatilities
                                                    // Volatility: lower is better, so flip - P95 (worst/high vol) on left, P5 (best/low vol) on right
                                                    const minVal = vol.p95 // High vol = left side (bad)
                                                    const maxVal = vol.p5  // Low vol = right side (good)
                                                    const range = maxVal - minVal || 0.01
                                                    const toPos = (v: number) => Math.max(0, Math.min(100, ((v - minVal) / range) * 100))
                                                    const hasP25P75 = vol.p25 != null && vol.p75 != null
                                                    return (
                                                      <>
                                                        <div className="relative h-4 bg-muted/30 rounded overflow-hidden">
                                                          {/* P25-P75 range (red for volatility since it's bad) - only if we have p25/p75 */}
                                                          {hasP25P75 && (
                                                            <div
                                                              className="absolute h-full bg-danger/40"
                                                              style={{ left: `${toPos(vol.p75)}%`, width: `${toPos(vol.p25) - toPos(vol.p75)}%` }}
                                                            />
                                                          )}
                                                          <div
                                                            className="absolute h-full w-0.5 bg-danger"
                                                            style={{ left: `${toPos(vol.p50)}%` }}
                                                          />
                                                        </div>
                                                        <div className="flex justify-between text-xs mt-0.5">
                                                          <span className="text-danger">P95: {formatDDPct(vol.p95)}</span>
                                                          <span className="font-semibold">P50: {formatDDPct(vol.p50)}</span>
                                                          <span className="text-success">P5: {formatDDPct(vol.p5)}</span>
                                                        </div>
                                                      </>
                                                    )
                                                  })()}
                                                </div>
                                              )}
                                            </div>
                                          </div>

                                        </>
                                      )}
                                    </>
                                  )
                                })()}
                              </div>
                            )}
                          </div>
                        ) : null}
                      </Card>
                    )
                  })}
              </div>
            )}
              </>
            )}
            </CardContent>
          </Card>
        ) : tab === 'Nexus' ? (
          <Card className="h-full flex flex-col overflow-hidden m-4">
            <CardContent className="p-4 flex flex-col h-full overflow-auto">
            {(() => {
              // Generate rows for Nexus bots from ALL users (cross-account)
              const communityBotRows: CommunityBotRow[] = allNexusBots.map((bot) => {
                  const tagNames = (watchlistsByBotId.get(bot.id) ?? []).map((w) => w.name)
                  // Since this is specifically for Nexus bots, primary tag is always Nexus
                  const builderName = bot.builderDisplayName || (bot.builderId === userId ? userDisplayName : null) || bot.builderId
                  const tags = ['Nexus', builderName, ...tagNames]
                  // Use frontend-cached metrics if available, otherwise fall back to API-provided backtestResult
                  const metrics = analyzeBacktests[bot.id]?.result?.metrics ?? bot.backtestResult
                  // Display anonymized name: "X's Fund #Y" instead of actual bot name
                  // Use fundSlot from bot, or look up from fundZones as fallback
                  const fundSlot = bot.fundSlot ?? getFundSlotForBot(bot.id)
                  const displayName = fundSlot
                    ? `${builderName}'s Fund #${fundSlot}`
                    : `${builderName}'s Fund`
                  return {
                    id: bot.id,
                    name: displayName,
                    tags,
                    oosCagr: metrics?.cagr ?? 0,
                    oosMaxdd: metrics?.maxDrawdown ?? 0,
                    oosSharpe: metrics?.sharpe ?? 0,
                  }
                })

              // Atlas sponsored systems (from admin) - use allNexusBots which includes Atlas-tagged bots from API
              const atlasBotRows: CommunityBotRow[] = allNexusBots
                .filter(bot => bot.tags?.includes('Atlas'))
                .map((bot) => {
                  const tagNames = (watchlistsByBotId.get(bot.id) ?? []).map((w) => w.name)
                  const tags = ['Atlas', 'Sponsored', ...tagNames]
                  // Use frontend-cached metrics if available, otherwise fall back to API-provided backtestResult
                  const metrics = analyzeBacktests[bot.id]?.result?.metrics ?? bot.backtestResult
                  return {
                    id: bot.id,
                    name: bot.name, // Atlas systems show real names, not anonymized
                    tags,
                    oosCagr: metrics?.cagr ?? 0,
                    oosMaxdd: metrics?.maxDrawdown ?? 0,
                    oosSharpe: metrics?.sharpe ?? 0,
                  }
                })

              // Top 100 by CAGR (descending)
              const topByCagr = [...communityBotRows]
                .sort((a, b) => b.oosCagr - a.oosCagr)
                .slice(0, 100)

              // Top 100 by Calmar (CAGR / MaxDD) - we'll compute Calmar from existing metrics
              const topByCalmar = [...communityBotRows]
                .map((r) => ({
                  ...r,
                  calmar: r.oosMaxdd !== 0 ? Math.abs(r.oosCagr / r.oosMaxdd) : 0,
                }))
                .sort((a, b) => b.calmar - a.calmar)
                .slice(0, 100)

              // Top 100 by Sharpe (descending)
              const topBySharpe = [...communityBotRows]
                .sort((a, b) => b.oosSharpe - a.oosSharpe)
                .slice(0, 100)

              // Get unique builder names for autocomplete (now just the display name, not "Builder: X")
              const allBuilderIds = [...new Set(communityBotRows.map((r) => {
                // The builder name is now the 2nd tag (index 1) - 'Nexus', 'BrianE', ...
                return r.tags[1] ?? ''
              }).filter(Boolean))]

              // Search results - filter by multiple criteria (AND logic)
              // Includes: all Nexus bots + current user's private bots
              const searchedBots = (() => {
                // Check if any filter has a value
                const activeFilters = communitySearchFilters.filter(f => f.value.trim())
                if (activeFilters.length === 0) return []

                // Get current user's private bots (non-Nexus)
                const nexusBotIds = new Set(allNexusBots.map(b => b.id))
                // For private bots, use the current user's display name
                const currentUserDisplayName = userDisplayName || userId
                const myPrivateBotRows: CommunityBotRow[] = savedBots
                  .filter(bot => bot.builderId === userId && !nexusBotIds.has(bot.id))
                  .map((bot) => {
                    const tagNames = (watchlistsByBotId.get(bot.id) ?? []).map((w) => w.name)
                    const tags = ['Private', bot.builderDisplayName || currentUserDisplayName, ...tagNames]
                    // Use frontend-cached metrics if available, otherwise fall back to API-provided backtestResult
                    const metrics = analyzeBacktests[bot.id]?.result?.metrics ?? bot.backtestResult
                    return {
                      id: bot.id,
                      name: bot.name,
                      tags,
                      oosCagr: metrics?.cagr ?? 0,
                      oosMaxdd: metrics?.maxDrawdown ?? 0,
                      oosSharpe: metrics?.sharpe ?? 0,
                    }
                  })

                // Combine Nexus bots + user's private bots for search
                const allSearchableBots = [...communityBotRows, ...myPrivateBotRows]

                // Start with all bots, add calmar
                let result = allSearchableBots.map((r) => ({
                  ...r,
                  calmar: r.oosMaxdd !== 0 ? Math.abs(r.oosCagr / r.oosMaxdd) : 0,
                }))

                // Apply each filter (AND logic)
                for (const filter of activeFilters) {
                  const searchVal = filter.value.trim().toLowerCase()
                  const isGreater = filter.comparison === 'greater'

                  if (filter.mode === 'builder') {
                    result = result.filter((r) => {
                      // Builder name is now at index 1 (after 'Nexus' or 'Private')
                      const builderName = (r.tags[1] ?? '').toLowerCase()
                      return builderName.includes(searchVal) || r.name.toLowerCase().includes(searchVal)
                    })
                  } else {
                    const threshold = parseFloat(filter.value)
                    if (isNaN(threshold)) continue

                    switch (filter.mode) {
                      case 'cagr':
                        result = result.filter((r) => isGreater ? r.oosCagr * 100 >= threshold : r.oosCagr * 100 <= threshold)
                        break
                      case 'sharpe':
                        result = result.filter((r) => isGreater ? r.oosSharpe >= threshold : r.oosSharpe <= threshold)
                        break
                      case 'calmar':
                        result = result.filter((r) => isGreater ? r.calmar >= threshold : r.calmar <= threshold)
                        break
                      case 'maxdd':
                        // MaxDD is typically negative, so we compare absolute values
                        result = result.filter((r) => isGreater ? Math.abs(r.oosMaxdd * 100) >= threshold : Math.abs(r.oosMaxdd * 100) <= threshold)
                        break
                    }
                  }
                }

                return result
              })()

              const sortRows = (rows: CommunityBotRow[], sort: CommunitySort): CommunityBotRow[] => {
                const dir = sort.dir === 'asc' ? 1 : -1
                const arr = [...rows]
                arr.sort((a, b) => {
                  let cmp = 0
                  if (sort.key === 'name') cmp = a.name.localeCompare(b.name)
                  else if (sort.key === 'tags') cmp = a.tags.join(',').localeCompare(b.tags.join(','))
                  else if (sort.key === 'oosCagr') cmp = a.oosCagr - b.oosCagr
                  else if (sort.key === 'oosMaxdd') cmp = a.oosMaxdd - b.oosMaxdd
                  else cmp = a.oosSharpe - b.oosSharpe
                  return dir * (cmp || a.id.localeCompare(b.id))
                })
                return arr
              }

              const renderBotCards = (
                rows: CommunityBotRow[],
                sort: CommunitySort,
                _setSort: Dispatch<SetStateAction<CommunitySort>>,
                opts?: { emptyMessage?: string; showCollapsedMetrics?: boolean },
              ) => {
                const sorted = sortRows(rows, sort)
                if (sorted.length === 0) {
                  return <div className="text-muted p-3">{opts?.emptyMessage ?? 'No systems yet.'}</div>
                }
                return (
                  <div className="flex flex-col gap-2.5">
                    {sorted.map((r) => {
                      const collapsed = uiState.communityCollapsedByBotId[r.id] ?? true
                      // Look up from allNexusBots first (for cross-user bots), then fall back to savedBots
                      const b = allNexusBots.find((bot) => bot.id === r.id) ?? savedBots.find((bot) => bot.id === r.id)
                      const analyzeState = analyzeBacktests[r.id]
                      const wlTags = watchlistsByBotId.get(r.id) ?? []

                      const toggleCollapse = () => {
                        const next = !collapsed
                        setUiState((prev) => ({
                          ...prev,
                          communityCollapsedByBotId: { ...prev.communityCollapsedByBotId, [r.id]: next },
                        }))
                        if (!next && b) {
                          if (!analyzeState || analyzeState.status === 'idle' || analyzeState.status === 'error') {
                            runAnalyzeBacktest(b)
                          }
                        }
                      }

                      if (!b) return null

                      // Use anonymized display name for Nexus bots in Community tab
                      // Use fundSlot from bot, or look up from fundZones as fallback
                      const fundSlot = b.fundSlot ?? getFundSlotForBot(b.id)
                      const builderName = b.builderDisplayName || (b.builderId === userId ? userDisplayName : null) || b.builderId
                      const displayName = b.tags?.includes('Nexus') && fundSlot
                        ? `${builderName}'s Fund #${fundSlot}`
                        : b.tags?.includes('Nexus')
                          ? `${builderName}'s Fund`
                          : b.name

                      return (
                        <Card key={r.id} className="grid gap-2.5">
                          <div className="flex items-center gap-2.5 flex-wrap">
                            <Button variant="ghost" size="sm" onClick={toggleCollapse}>
                              {collapsed ? 'Expand' : 'Collapse'}
                            </Button>
                            <div className="font-black">{displayName}</div>
                            <Badge variant={b.tags?.includes('Nexus') ? 'default' : b.tags?.includes('Atlas') ? 'default' : 'accent'}>
                              {b.tags?.includes('Nexus') ? 'Nexus' : b.tags?.includes('Atlas') ? 'Atlas' : 'Private'}
                            </Badge>
                            {b.tags?.includes('Nexus Eligible') && (
                              <Badge variant="secondary">Nexus Eligible</Badge>
                            )}
                            <Badge variant="default">{b.builderDisplayName || (b.builderId === userId ? userDisplayName : null) || b.builderId}</Badge>
                            <div className="flex gap-1.5 flex-wrap">
                              {wlTags.map((w) => (
                                <Badge key={w.id} variant="accent" className="gap-1.5">
                                  {w.name}
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-4 w-4 p-0 hover:bg-transparent"
                                    onClick={() => removeBotFromWatchlist(b.id, w.id)}
                                    title={`Remove from ${w.name}`}
                                  >
                                    X
                                  </Button>
                                </Badge>
                              ))}
                            </div>
                            <div className="ml-auto flex gap-2 flex-wrap items-center">
                              {/* FRD-025: Show key metrics when collapsed (only for Atlas Sponsored) */}
                              {collapsed && opts?.showCollapsedMetrics && r.oosCagr != null && (
                                <div className="flex gap-3 mr-4 text-xs">
                                  <span className={r.oosCagr >= 0 ? 'text-success' : 'text-danger'}>
                                    CAGR: {(r.oosCagr * 100).toFixed(1)}%
                                  </span>
                                  <span className={r.oosSharpe >= 1 ? 'text-success' : 'text-muted'}>
                                    Sharpe: {r.oosSharpe?.toFixed(2) ?? '--'}
                                  </span>
                                  <span className="text-danger">
                                    MaxDD: {((r.oosMaxdd ?? 0) * 100).toFixed(1)}%
                                  </span>
                                </div>
                              )}
                              {/* FRD-023: Export JSON for owner/admin */}
                              {(b.builderId === userId || isAdmin) && b.payload && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    const blob = new Blob([typeof b.payload === 'string' ? b.payload : JSON.stringify(b.payload, null, 2)], { type: 'application/json' })
                                    const url = URL.createObjectURL(blob)
                                    const a = document.createElement('a')
                                    a.href = url
                                    a.download = `${b.name || 'system'}.json`
                                    a.click()
                                    URL.revokeObjectURL(url)
                                  }}
                                >
                                  Export JSON
                                </Button>
                              )}
                              {/* FRD-023: Open in Model (respects IP) */}
                              {b.payload && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    try {
                                      const parsed = typeof b.payload === 'string' ? JSON.parse(b.payload) : b.payload
                                      push(parsed)
                                      setTab('Model')
                                    } catch (e) {
                                      console.error('Failed to open model:', e)
                                    }
                                  }}
                                >
                                  Open in Model
                                </Button>
                              )}
                              {/* FRD-012: Show Copy to New for published systems (Nexus/Atlas are always published) */}
                              {b.builderId === userId && (
                                <Button size="sm" onClick={() => handleCopyToNew(b)}>Copy to New System</Button>
                              )}
                              <Button
                                size="sm"
                                onClick={() => {
                                  setAddToWatchlistBotId(b.id)
                                  setAddToWatchlistNewName('')
                                }}
                              >
                                Add to Watchlist
                              </Button>
                            </div>
                          </div>

                          {!collapsed && (
                            <div className="flex flex-col gap-2.5 w-full">
                              {/* Simplified view for Nexus - Base Stats only, no tabs, no Information */}
                              <div className="saved-item grid grid-cols-1 gap-3.5 h-full w-full min-w-0 overflow-hidden items-stretch justify-items-stretch">
                                {analyzeState?.status === 'loading' ? (
                                  <div className="text-muted">Running backtest…</div>
                                ) : analyzeState?.status === 'error' ? (
                                  <div className="grid gap-2">
                                    <div className="text-muted">{analyzeState.error ?? 'Failed to run backtest.'}</div>
                                    {/* Only show Retry for own bots (those with payload) */}
                                    {b?.payload && <Button onClick={() => runAnalyzeBacktest(b)}>Retry</Button>}
                                  </div>
                                ) : analyzeState?.status === 'done' ? (
                                  <div className="grid grid-cols-1 gap-2.5 min-w-0 w-full">
                                    {/* Buy System Section */}
                                    <div className="border-b border-border pb-3 mb-1">
                                      <div className="font-bold mb-2">Buy System</div>
                                      <div className="text-sm mb-2">
                                        <span className="text-muted">Cash Available:</span>{' '}
                                        <span className="font-bold">{formatUsd(dashboardCash)}</span>
                                        {nexusBuyBotId === b.id && nexusBuyMode === '%' && nexusBuyAmount && (
                                          <span className="text-muted"> · Amount: {formatUsd((parseFloat(nexusBuyAmount) / 100) * dashboardCash)}</span>
                                        )}
                                      </div>
                                      <div className="flex gap-2 items-center">
                                        <Button
                                          size="sm"
                                          onClick={() => handleNexusBuy(b.id)}
                                          disabled={nexusBuyBotId !== b.id || !nexusBuyAmount}
                                          className="h-8 px-4"
                                        >
                                          Buy
                                        </Button>
                                        <div className="flex gap-1">
                                          <Button
                                            size="sm"
                                            variant={nexusBuyBotId === b.id && nexusBuyMode === '$' ? 'accent' : 'outline'}
                                            className="h-8 w-8 p-0"
                                            onClick={() => { setNexusBuyBotId(b.id); setNexusBuyMode('$') }}
                                          >
                                            $
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant={nexusBuyBotId === b.id && nexusBuyMode === '%' ? 'accent' : 'outline'}
                                            className="h-8 w-8 p-0"
                                            onClick={() => { setNexusBuyBotId(b.id); setNexusBuyMode('%') }}
                                          >
                                            %
                                          </Button>
                                        </div>
                                        <Input
                                          type="number"
                                          placeholder={nexusBuyBotId === b.id && nexusBuyMode === '%' ? '% of cash' : 'Amount'}
                                          value={nexusBuyBotId === b.id ? nexusBuyAmount : ''}
                                          onChange={(e) => { setNexusBuyBotId(b.id); setNexusBuyAmount(e.target.value) }}
                                          className="h-8 flex-1"
                                        />
                                      </div>
                                    </div>

                                    <div className="base-stats-grid w-full self-stretch grid grid-cols-1 grid-rows-[auto_auto_auto] gap-3">
                                      {(() => {
                                        const investment = dashboardInvestmentsWithPnl.find((inv) => inv.botId === b.id)
                                        const isInvested = !!investment
                                        const amountInvested = investment?.costBasis ?? 0
                                        const currentValue = investment?.currentValue ?? 0
                                        const pnlPct = investment?.pnlPercent ?? 0
                                        let liveCagr = 0
                                        if (investment) {
                                          const daysSinceInvestment = (Date.now() - investment.buyDate) / (1000 * 60 * 60 * 24)
                                          const yearsSinceInvestment = daysSinceInvestment / 365
                                          if (yearsSinceInvestment > 0 && amountInvested > 0) {
                                            liveCagr = (Math.pow(currentValue / amountInvested, 1 / yearsSinceInvestment) - 1)
                                          }
                                        }
                                        return (
                                          <div className="base-stats-card w-full min-w-0 max-w-full flex flex-col items-stretch text-center">
                                            <div className="font-black mb-2 text-center">Live Stats</div>
                                            {isInvested ? (
                                              <div className="grid grid-cols-4 gap-2.5 justify-items-center w-full">
                                                <div>
                                                  <div className="stat-label">Invested</div>
                                                  <div className="stat-value">{formatUsd(amountInvested)}</div>
                                                </div>
                                                <div>
                                                  <div className="stat-label">Current Value</div>
                                                  <div className="stat-value">{formatUsd(currentValue)}</div>
                                                </div>
                                                <div>
                                                  <div className="stat-label">P&L</div>
                                                  <div className={cn("stat-value", pnlPct >= 0 ? 'text-success' : 'text-danger')}>
                                                    {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                                                  </div>
                                                </div>
                                                <div>
                                                  <div className="stat-label">CAGR</div>
                                                  <div className={cn("stat-value", liveCagr >= 0 ? 'text-success' : 'text-danger')}>
                                                    {formatPct(liveCagr)}
                                                  </div>
                                                </div>
                                              </div>
                                            ) : (
                                              <div className="text-muted text-sm">Not invested in this system. Buy from Dashboard to track live stats.</div>
                                            )}
                                          </div>
                                        )
                                      })()}

                                      <div className="base-stats-card w-full min-w-0 text-center self-stretch">
                                        <div className="w-full">
                                          <div className="font-black mb-1.5">Backtest Snapshot</div>
                                          <div className="text-xs text-muted mb-2.5">Benchmark: {backtestBenchmark}</div>
                                          <div className="w-full max-w-full overflow-hidden">
                                            <EquityChart
                                              points={analyzeState.result?.points ?? []}
                                              benchmarkPoints={analyzeState.result?.benchmarkPoints}
                                              markers={analyzeState.result?.markers ?? []}
                                              logScale
                                              showCursorStats={false}
                                              heightPx={390}
                                              theme={uiState.theme}
                                            />
                                          </div>
                                          <div className="mt-2.5 w-full">
                                            <DrawdownChart points={analyzeState.result?.drawdownPoints ?? []} theme={uiState.theme} />
                                          </div>
                                        </div>
                                      </div>

                                      <div className="base-stats-card w-full min-w-0 text-center self-stretch">
                                        <div className="w-full">
                                          <div className="font-black mb-2">Historical Stats</div>
                                          <div className="grid grid-cols-[repeat(4,minmax(140px,1fr))] gap-2.5 justify-items-center overflow-x-auto max-w-full w-full">
                                            <div>
                                              <div className="stat-label">CAGR</div>
                                              <div className="stat-value">{formatPct(analyzeState.result?.metrics.cagr ?? NaN)}</div>
                                            </div>
                                            <div>
                                              <div className="stat-label">Max DD</div>
                                              <div className="stat-value">{formatPct(analyzeState.result?.metrics.maxDrawdown ?? NaN)}</div>
                                            </div>
                                            <div>
                                              <div className="stat-label">Calmar Ratio</div>
                                              <div className="stat-value">
                                                {Number.isFinite(analyzeState.result?.metrics.calmar ?? NaN)
                                                  ? (analyzeState.result?.metrics.calmar ?? 0).toFixed(2)
                                                  : '--'}
                                              </div>
                                            </div>
                                            <div>
                                              <div className="stat-label">Sharpe Ratio</div>
                                              <div className="stat-value">
                                                {Number.isFinite(analyzeState.result?.metrics.sharpe ?? NaN)
                                                  ? (analyzeState.result?.metrics.sharpe ?? 0).toFixed(2)
                                                  : '--'}
                                              </div>
                                            </div>
                                            <div>
                                              <div className="stat-label">Sortino Ratio</div>
                                              <div className="stat-value">
                                                {Number.isFinite(analyzeState.result?.metrics.sortino ?? NaN)
                                                  ? (analyzeState.result?.metrics.sortino ?? 0).toFixed(2)
                                                  : '--'}
                                              </div>
                                            </div>
                                            <div>
                                              <div className="stat-label">Treynor Ratio</div>
                                              <div className="stat-value">
                                                {Number.isFinite(analyzeState.result?.metrics.treynor ?? NaN)
                                                  ? (analyzeState.result?.metrics.treynor ?? 0).toFixed(2)
                                                  : '--'}
                                              </div>
                                            </div>
                                            <div>
                                              <div className="stat-label">Beta</div>
                                              <div className="stat-value">
                                                {Number.isFinite(analyzeState.result?.metrics.beta ?? NaN)
                                                  ? (analyzeState.result?.metrics.beta ?? 0).toFixed(2)
                                                  : '--'}
                                              </div>
                                            </div>
                                            <div>
                                              <div className="stat-label">Volatility</div>
                                              <div className="stat-value">{formatPct(analyzeState.result?.metrics.vol ?? NaN)}</div>
                                            </div>
                                            <div>
                                              <div className="stat-label">Win Rate</div>
                                              <div className="stat-value">{formatPct(analyzeState.result?.metrics.winRate ?? NaN)}</div>
                                            </div>
                                            <div>
                                              <div className="stat-label">Turnover</div>
                                              <div className="stat-value">{formatPct(analyzeState.result?.metrics.avgTurnover ?? NaN)}</div>
                                            </div>
                                            <div>
                                              <div className="stat-label">Avg Holdings</div>
                                              <div className="stat-value">
                                                {Number.isFinite(analyzeState.result?.metrics.avgHoldings ?? NaN)
                                                  ? (analyzeState.result?.metrics.avgHoldings ?? 0).toFixed(1)
                                                  : '--'}
                                              </div>
                                            </div>
                                            <div>
                                              <div className="stat-label">Trading Days</div>
                                              <div className="stat-value">{analyzeState.result?.metrics.days ?? '--'}</div>
                                            </div>
                                          </div>
                                          <div className="mt-2 text-xs text-muted">
                                            Period: {analyzeState.result?.metrics.startDate ?? '--'} to {analyzeState.result?.metrics.endDate ?? '--'}
                                          </div>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Prompt to add to watchlist for more details */}
                                    <div className="text-center text-xs text-muted mt-2">
                                      Add to a watchlist to view more details in the Analyze tab.
                                    </div>
                                  </div>
                                ) : (
                                  <button onClick={() => runAnalyzeBacktest(b)}>Run backtest</button>
                                )}
                              </div>

                            </div>
                          )}
                        </Card>
                      )
                    })}
                  </div>
                )
              }

              return (
                <div className="grid grid-cols-2 gap-4 min-h-[calc(100vh-260px)] items-stretch">
                  {/* Left Column - Atlas Systems and Search */}
                  <Card className="flex flex-col gap-4 p-4">
                    <Card className="flex-[2] flex flex-col p-4 border-2 overflow-auto">
                      <div className="flex items-center justify-between mb-3">
                        <div className="font-bold">Atlas Sponsored Systems</div>
                        {/* FRD-023: Sort dropdown */}
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted">Sort:</span>
                          <select
                            className="h-7 px-2 rounded border border-border bg-background text-xs"
                            value={`${atlasSort.key}-${atlasSort.dir}`}
                            onChange={(e) => {
                              const [key, dir] = e.target.value.split('-')
                              setAtlasSort({ key: key as CommunitySortKey, dir: dir as SortDir })
                            }}
                          >
                            <option value="oosCagr-desc">CAGR (High-Low)</option>
                            <option value="oosCagr-asc">CAGR (Low-High)</option>
                            <option value="oosSharpe-desc">Sharpe (High-Low)</option>
                            <option value="oosSharpe-asc">Sharpe (Low-High)</option>
                            <option value="oosMaxdd-desc">MaxDD (Low-High)</option>
                            <option value="oosMaxdd-asc">MaxDD (High-Low)</option>
                            <option value="name-asc">Name (A-Z)</option>
                            <option value="name-desc">Name (Z-A)</option>
                          </select>
                        </div>
                      </div>
                      {renderBotCards(atlasBotRows, atlasSort, setAtlasSort, {
                        emptyMessage: 'No Atlas sponsored systems yet.',
                        showCollapsedMetrics: true,
                      })}
                    </Card>
                    <Card className="flex-1 flex flex-col p-3 border-2">
                      <div className="font-bold text-center mb-2">Search Nexus Strategies</div>
                      <div className="flex flex-col gap-2 mb-2">
                        {communitySearchFilters.map((filter, idx) => (
                          <div key={filter.id} className="flex gap-2 items-center">
                            <select
                              className="h-8 px-2 rounded border border-border bg-background text-sm"
                              value={filter.mode}
                              onChange={(e) => {
                                setCommunitySearchFilters(prev => prev.map((f, i) =>
                                  i === idx ? { ...f, mode: e.target.value as typeof filter.mode, value: '' } : f
                                ))
                              }}
                            >
                              <option value="builder">Builder Name</option>
                              <option value="cagr">CAGR</option>
                              <option value="sharpe">Sharpe</option>
                              <option value="calmar">Calmar</option>
                              <option value="maxdd">Max Drawdown</option>
                            </select>
                            {filter.mode !== 'builder' && (
                              <select
                                className="h-8 px-2 rounded border border-border bg-background text-sm"
                                value={filter.comparison}
                                onChange={(e) => {
                                  setCommunitySearchFilters(prev => prev.map((f, i) =>
                                    i === idx ? { ...f, comparison: e.target.value as 'greater' | 'less' } : f
                                  ))
                                }}
                              >
                                <option value="greater">Greater Than</option>
                                <option value="less">Less Than</option>
                              </select>
                            )}
                            {filter.mode === 'builder' ? (
                              <div className="flex-1 relative">
                                <Input
                                  type="text"
                                  list={`builder-list-${filter.id}`}
                                  placeholder="Search builder..."
                                  value={filter.value}
                                  onChange={(e) => {
                                    setCommunitySearchFilters(prev => prev.map((f, i) =>
                                      i === idx ? { ...f, value: e.target.value } : f
                                    ))
                                  }}
                                  className="h-8 w-full"
                                />
                                <datalist id={`builder-list-${filter.id}`}>
                                  {allBuilderIds.map((id) => (
                                    <option key={id} value={id} />
                                  ))}
                                </datalist>
                              </div>
                            ) : (
                              <Input
                                type="number"
                                placeholder={
                                  filter.mode === 'cagr'
                                    ? 'CAGR %'
                                    : filter.mode === 'sharpe'
                                      ? 'Sharpe'
                                      : filter.mode === 'calmar'
                                        ? 'Calmar'
                                        : 'Max DD %'
                                }
                                value={filter.value}
                                onChange={(e) => {
                                  setCommunitySearchFilters(prev => prev.map((f, i) =>
                                    i === idx ? { ...f, value: e.target.value } : f
                                  ))
                                }}
                                className="flex-1 h-8"
                              />
                            )}
                            {communitySearchFilters.length > 1 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 text-muted hover:text-danger"
                                onClick={() => {
                                  setCommunitySearchFilters(prev => prev.filter((_, i) => i !== idx))
                                }}
                                title="Remove filter"
                              >
                                ✕
                              </Button>
                            )}
                          </div>
                        ))}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs self-start"
                          onClick={() => {
                            setCommunitySearchFilters(prev => [
                              ...prev,
                              { id: `filter-${Date.now()}`, mode: 'cagr', comparison: 'greater', value: '' }
                            ])
                          }}
                        >
                          + Add Filter
                        </Button>
                      </div>
                      {/* FRD-023: Sort dropdown for search results */}
                      {communitySearchFilters.some(f => f.value.trim()) && searchedBots.length > 0 && (
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-sm font-bold">Results: {searchedBots.length} systems</div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted">Sort:</span>
                            <select
                              className="h-7 px-2 rounded border border-border bg-background text-xs"
                              value={`${communitySearchSort.key}-${communitySearchSort.dir}`}
                              onChange={(e) => {
                                const [key, dir] = e.target.value.split('-')
                                setCommunitySearchSort({ key: key as CommunitySortKey, dir: dir as SortDir })
                              }}
                            >
                              <option value="oosCagr-desc">CAGR (High-Low)</option>
                              <option value="oosCagr-asc">CAGR (Low-High)</option>
                              <option value="oosSharpe-desc">Sharpe (High-Low)</option>
                              <option value="oosSharpe-asc">Sharpe (Low-High)</option>
                              <option value="oosMaxdd-desc">MaxDD (Low-High)</option>
                              <option value="oosMaxdd-asc">MaxDD (High-Low)</option>
                              <option value="name-asc">Name (A-Z)</option>
                              <option value="name-desc">Name (Z-A)</option>
                            </select>
                          </div>
                        </div>
                      )}
                      <div className="flex-1 overflow-auto">
                        {communitySearchFilters.some(f => f.value.trim()) ? (
                          searchedBots.length > 0 ? (
                            renderBotCards(searchedBots.slice(0, 20), communitySearchSort, setCommunitySearchSort, {
                              emptyMessage: 'No matching systems found.',
                            })
                          ) : (
                            <div className="text-muted text-center p-3">
                              No systems match these criteria.
                            </div>
                          )
                        ) : (
                          <div className="text-muted text-center p-3">
                            Enter filter values to search.
                          </div>
                        )}
                      </div>
                    </Card>
                  </Card>

                  {/* Right Column - Nexus Select Zone */}
                  <Card className="flex flex-col p-4">
                    <div className="font-black text-center mb-4">Nexus Select Zone</div>
                    <div className="flex flex-col gap-4 flex-1">
                      <Card className="flex-1 flex flex-col p-3 border-2">
                        <div className="font-bold text-center mb-2">Top Systems by CAGR</div>
                        <div className="flex-1 overflow-auto max-h-[400px]">
                          {renderBotCards(topByCagr, communityTopSort, setCommunityTopSort, {
                            emptyMessage: 'No Nexus systems with backtest data.',
                          })}
                        </div>
                      </Card>
                      <Card className="flex-1 flex flex-col p-3 border-2">
                        <div className="font-bold text-center mb-2">Top Systems by Calmar Ratio</div>
                        <div className="flex-1 overflow-auto max-h-[400px]">
                          {renderBotCards(topByCalmar, communityTopSort, setCommunityTopSort, {
                            emptyMessage: 'No Nexus systems with backtest data.',
                          })}
                        </div>
                      </Card>
                      <Card className="flex-1 flex flex-col p-3 border-2">
                        <div className="font-bold text-center mb-2">Top Systems by Sharpe Ratio</div>
                        <div className="flex-1 overflow-auto max-h-[400px]">
                          {renderBotCards(topBySharpe, communityTopSort, setCommunityTopSort, {
                            emptyMessage: 'No Nexus systems with backtest data.',
                          })}
                        </div>
                      </Card>
                    </div>
                  </Card>
                </div>
              )
            })()}
            </CardContent>
          </Card>
        ) : tab === 'Dashboard' ? (
          <Card className="h-full flex flex-col overflow-hidden m-4">
            <CardContent className="p-4 flex flex-col h-full overflow-auto">
            <div className="flex gap-2.5 items-center flex-wrap">
              {(['Portfolio', 'Partner Program'] as const).map((t) => (
                <button
                  key={t}
                  className={`tab-btn ${dashboardSubtab === t ? 'active' : ''}`}
                  onClick={() => setDashboardSubtab(t)}
                >
                  {t}
                </button>
              ))}
            </div>

            {dashboardSubtab === 'Portfolio' ? (
              <div className="mt-3 flex flex-col gap-4">
                {/* 6 Stat Bubbles - Using Dashboard Portfolio */}
                <div className="grid grid-cols-6 gap-3">
                  <Card className="p-3 text-center">
                    <div className="text-[10px] font-bold text-muted">Account Value</div>
                    <div className="text-lg font-black">{formatUsd(dashboardTotalValue)}</div>
                  </Card>
                  <Card className="p-3 text-center">
                    <div className="text-[10px] font-bold text-muted">Cash Available</div>
                    <div className="text-lg font-black">{formatUsd(dashboardCash)}</div>
                  </Card>
                  <Card className="p-3 text-center">
                    <div className="text-[10px] font-bold text-muted">Total PnL ($)</div>
                    <div className={cn("text-lg font-black", dashboardTotalPnl >= 0 ? 'text-success' : 'text-danger')}>
                      {formatSignedUsd(dashboardTotalPnl)}
                    </div>
                  </Card>
                  <Card className="p-3 text-center">
                    <div className="text-[10px] font-bold text-muted">Total PnL (%)</div>
                    <div className={cn("text-lg font-black", dashboardTotalPnlPct >= 0 ? 'text-success' : 'text-danger')}>
                      {dashboardTotalPnlPct >= 0 ? '+' : ''}{dashboardTotalPnlPct.toFixed(2)}%
                    </div>
                  </Card>
                  <Card className="p-3 text-center">
                    <div className="text-[10px] font-bold text-muted">Invested</div>
                    <div className="text-lg font-black">{formatUsd(dashboardTotalValue - dashboardCash)}</div>
                  </Card>
                  <Card className="p-3 text-center">
                    <div className="text-[10px] font-bold text-muted">Positions</div>
                    <div className="text-lg font-black">{dashboardInvestmentsWithPnl.length}</div>
                  </Card>
                </div>

                {/* Full-Width Portfolio Performance Chart */}
                <Card className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-4">
                      <div className="font-black">Portfolio Performance</div>
                      {/* Legend for bot lines */}
                      <div className="flex items-center gap-3 text-xs">
                        <div className="flex items-center gap-1.5">
                          <div className="w-3 h-0.5 rounded" style={{ backgroundColor: '#3b82f6' }} />
                          <span className="text-muted font-bold">Portfolio</span>
                        </div>
                        {dashboardBotSeries.map((bot) => (
                          <div key={bot.id} className="flex items-center gap-1.5">
                            <div className="w-3 h-0.5 rounded" style={{ backgroundColor: bot.color }} />
                            <span className="text-muted font-bold">{bot.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {(['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y', 'ALL'] as DashboardTimePeriod[]).map((period) => (
                        <Button
                          key={period}
                          size="sm"
                          variant={dashboardTimePeriod === period ? 'accent' : 'ghost'}
                          className="h-6 px-2 text-xs"
                          onClick={() => setDashboardTimePeriod(period)}
                        >
                          {period}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <DashboardEquityChart
                    portfolioData={dashboardEquityCurve}
                    botSeries={dashboardBotSeries}
                    theme={uiState.theme}
                  />
                </Card>

                {/* Bottom Zone: Buy System + Invested Systems (left 2/3) | Portfolio Allocation (right 1/3) */}
                <div className="grid grid-cols-3 gap-4">
                  {/* Left Panel: Buy System + Systems Invested In (2/3 width) */}
                  <Card className="col-span-2 p-4">
                    {/* Buy System Section */}
                    <div className="font-black mb-3">Buy System</div>
                    <div className="grid gap-2 mb-4">
                      {/* Cash available line */}
                      <div className="text-sm">
                        <span className="text-muted">Cash Available:</span>{' '}
                        <span className="font-bold">{formatUsd(dashboardCash)}</span>
                        {dashboardBuyMode === '%' && dashboardBuyAmount && (
                          <span className="text-muted"> · Amount: {formatUsd((parseFloat(dashboardBuyAmount) / 100) * dashboardCash)}</span>
                        )}
                      </div>

                      {/* Buy button, $/% toggle, amount input */}
                      <div className="flex gap-2 items-center">
                        <Button
                          onClick={handleDashboardBuy}
                          disabled={!dashboardBuyBotId || !dashboardBuyAmount}
                          className="h-8 px-4"
                        >
                          Buy
                        </Button>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant={dashboardBuyMode === '$' ? 'accent' : 'outline'}
                            className="h-8 w-8 p-0"
                            onClick={() => setDashboardBuyMode('$')}
                          >
                            $
                          </Button>
                          <Button
                            size="sm"
                            variant={dashboardBuyMode === '%' ? 'accent' : 'outline'}
                            className="h-8 w-8 p-0"
                            onClick={() => setDashboardBuyMode('%')}
                          >
                            %
                          </Button>
                        </div>
                        <Input
                          type="number"
                          placeholder={dashboardBuyMode === '$' ? 'Amount' : '% of cash'}
                          value={dashboardBuyAmount}
                          onChange={(e) => setDashboardBuyAmount(e.target.value)}
                          className="h-8 flex-1"
                        />
                      </div>

                      {/* System selector with search */}
                      <div className="relative">
                        <Input
                          type="text"
                          placeholder="Search and select a system..."
                          value={dashboardBuyBotSearch}
                          onChange={(e) => {
                            setDashboardBuyBotSearch(e.target.value)
                            setDashboardBuyBotDropdownOpen(true)
                          }}
                          onFocus={() => setDashboardBuyBotDropdownOpen(true)}
                          className="h-8 w-full"
                        />
                        {dashboardBuyBotDropdownOpen && (
                          <>
                            <div
                              className="fixed inset-0 z-[199]"
                              onClick={() => setDashboardBuyBotDropdownOpen(false)}
                            />
                            <div className="absolute top-full left-0 right-0 z-[200] mt-1 max-h-48 overflow-y-auto bg-card border border-border rounded-md shadow-lg">
                              {(() => {
                                const availableBots = eligibleBots.filter(
                                  (bot) => !dashboardPortfolio.investments.some((inv) => inv.botId === bot.id)
                                )
                                const searchLower = dashboardBuyBotSearch.toLowerCase()
                                const filteredBots = availableBots.filter(
                                  (bot) =>
                                    bot.name.toLowerCase().includes(searchLower) ||
                                    bot.tags?.some((t) => t.toLowerCase().includes(searchLower))
                                )

                                if (filteredBots.length === 0) {
                                  return (
                                    <div className="px-3 py-2 text-sm text-muted">
                                      {availableBots.length === 0
                                        ? 'No eligible systems available'
                                        : 'No matching systems found'}
                                    </div>
                                  )
                                }

                                return filteredBots.map((bot) => (
                                  <div
                                    key={bot.id}
                                    className={cn(
                                      'px-3 py-2 text-sm cursor-pointer hover:bg-muted/50',
                                      dashboardBuyBotId === bot.id && 'bg-muted'
                                    )}
                                    onClick={() => {
                                      setDashboardBuyBotId(bot.id)
                                      setDashboardBuyBotSearch(bot.name)
                                      setDashboardBuyBotDropdownOpen(false)
                                    }}
                                  >
                                    <div className="font-bold">{bot.name}</div>
                                    {bot.tags && bot.tags.length > 0 && (
                                      <div className="text-xs text-muted">{bot.tags.join(', ')}</div>
                                    )}
                                  </div>
                                ))
                              })()}
                            </div>
                          </>
                        )}
                        {dashboardBuyBotId && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0 text-muted hover:text-foreground"
                            onClick={() => {
                              setDashboardBuyBotId('')
                              setDashboardBuyBotSearch('')
                            }}
                          >
                            ×
                          </Button>
                        )}
                      </div>

                      {eligibleBots.length === 0 && (
                        <div className="text-xs text-muted">
                          No eligible systems. Your private systems or systems tagged "Atlas"/"Nexus" will appear here.
                        </div>
                      )}
                    </div>

                    {/* Divider */}
                    <div className="border-t border-border my-3" />

                    {/* Systems Invested In Section - Uses same card format as Nexus */}
                    <div className="font-black mb-3">Systems Invested In ({dashboardInvestmentsWithPnl.length})</div>
                    {dashboardInvestmentsWithPnl.length === 0 ? (
                      <div className="text-muted text-center py-4">No investments yet.</div>
                    ) : (
                      <div className="flex flex-col gap-2.5">
                        {dashboardInvestmentsWithPnl.map((inv, idx) => {
                          const isExpanded = dashboardBotExpanded[inv.botId] ?? false
                          const isSelling = dashboardSellBotId === inv.botId
                          const isBuyingMore = dashboardBuyMoreBotId === inv.botId
                          const botColor = BOT_CHART_COLORS[idx % BOT_CHART_COLORS.length]
                          const allocation = dashboardTotalValue > 0 ? (inv.currentValue / dashboardTotalValue) * 100 : 0
                          // Look up bot from savedBots or allNexusBots
                          const b = savedBots.find((bot) => bot.id === inv.botId)
                            ?? allNexusBots.find((bot) => bot.id === inv.botId)
                          const analyzeState = analyzeBacktests[inv.botId]
                          const wlTags = watchlistsByBotId.get(inv.botId) ?? []

                          const toggleCollapse = () => {
                            const next = !isExpanded
                            setDashboardBotExpanded((prev) => ({ ...prev, [inv.botId]: next }))
                            // Run backtest if expanding and not already done
                            if (next && b) {
                              if (!analyzeState || analyzeState.status === 'idle' || analyzeState.status === 'error') {
                                runAnalyzeBacktest(b)
                              }
                            }
                          }

                          // Use anonymized display name for Nexus bots from other users
                          const fundSlot = b?.fundSlot ?? getFundSlotForBot(inv.botId)
                          const builderName = b?.builderDisplayName || (b?.builderId === userId ? userDisplayName : null) || b?.builderId
                          const displayName = b?.tags?.includes('Nexus') && b?.builderId !== userId && fundSlot
                            ? `${builderName}'s Fund #${fundSlot}`
                            : b?.tags?.includes('Nexus') && b?.builderId !== userId
                              ? `${builderName}'s Fund`
                              : inv.botName

                          return (
                            <Card key={inv.botId} className="grid gap-2.5">
                              <div className="flex items-center gap-2.5 flex-wrap">
                                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: botColor }} />
                                <Button variant="ghost" size="sm" onClick={toggleCollapse}>
                                  {isExpanded ? 'Collapse' : 'Expand'}
                                </Button>
                                <div className="font-black">{displayName}</div>
                                <Badge variant={b?.tags?.includes('Nexus') ? 'default' : b?.tags?.includes('Atlas') ? 'default' : 'accent'}>
                                  {b?.tags?.includes('Nexus') ? 'Nexus' : b?.tags?.includes('Atlas') ? 'Atlas' : 'Private'}
                                </Badge>
                                {(b?.builderDisplayName || b?.builderId) && <Badge variant="default">{b?.builderDisplayName || (b?.builderId === userId ? userDisplayName : null) || b?.builderId}</Badge>}
                                <div className="flex gap-1.5 flex-wrap">
                                  {wlTags.map((w) => (
                                    <Badge key={w.id} variant="accent" className="gap-1.5">
                                      {w.name}
                                    </Badge>
                                  ))}
                                </div>
                                <div className="ml-auto flex items-center gap-2.5 flex-wrap">
                                  <div className="text-sm text-muted">
                                    {formatUsd(inv.costBasis)} → {formatUsd(inv.currentValue)}
                                  </div>
                                  <div className={cn("font-bold min-w-[80px] text-right", inv.pnl >= 0 ? 'text-success' : 'text-danger')}>
                                    {formatSignedUsd(inv.pnl)} ({inv.pnlPercent >= 0 ? '+' : ''}{inv.pnlPercent.toFixed(1)}%)
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setDashboardSellBotId(null)
                                      setDashboardBuyMoreBotId(isBuyingMore ? null : inv.botId)
                                    }}
                                  >
                                    Buy More
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setDashboardBuyMoreBotId(null)
                                      setDashboardSellBotId(isSelling ? null : inv.botId)
                                    }}
                                  >
                                    Sell
                                  </Button>
                                </div>
                              </div>

                              {/* Buy More inline form */}
                              {isBuyingMore && (
                                <div className="pt-3 border-t border-border flex gap-2 items-center flex-wrap">
                                  <div className="flex gap-1">
                                    <Button
                                      size="sm"
                                      variant={dashboardBuyMoreMode === '$' ? 'accent' : 'outline'}
                                      className="h-8 w-8 p-0"
                                      onClick={() => setDashboardBuyMoreMode('$')}
                                    >
                                      $
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant={dashboardBuyMoreMode === '%' ? 'accent' : 'outline'}
                                      className="h-8 w-8 p-0"
                                      onClick={() => setDashboardBuyMoreMode('%')}
                                    >
                                      %
                                    </Button>
                                  </div>
                                  <Input
                                    type="number"
                                    placeholder={dashboardBuyMoreMode === '$' ? 'Amount' : '% of cash'}
                                    value={dashboardBuyMoreAmount}
                                    onChange={(e) => setDashboardBuyMoreAmount(e.target.value)}
                                    className="h-8 w-32"
                                  />
                                  <Button
                                    size="sm"
                                    variant="default"
                                    onClick={() => handleDashboardBuyMore(inv.botId)}
                                  >
                                    Buy More
                                  </Button>
                                  <span className="text-sm text-muted">Cash: {formatUsd(dashboardCash)}</span>
                                </div>
                              )}

                              {/* Sell inline form */}
                              {isSelling && (
                                <div className="pt-3 border-t border-border flex gap-2 items-center flex-wrap">
                                  <div className="flex gap-1">
                                    <Button
                                      size="sm"
                                      variant={dashboardSellMode === '$' ? 'accent' : 'outline'}
                                      className="h-8 w-8 p-0"
                                      onClick={() => setDashboardSellMode('$')}
                                    >
                                      $
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant={dashboardSellMode === '%' ? 'accent' : 'outline'}
                                      className="h-8 w-8 p-0"
                                      onClick={() => setDashboardSellMode('%')}
                                    >
                                      %
                                    </Button>
                                  </div>
                                  <Input
                                    type="number"
                                    placeholder={dashboardSellMode === '$' ? 'Amount' : 'Percent'}
                                    value={dashboardSellAmount}
                                    onChange={(e) => setDashboardSellAmount(e.target.value)}
                                    className="h-8 w-32"
                                  />
                                  <Button
                                    size="sm"
                                    variant="default"
                                    onClick={() => handleDashboardSell(inv.botId, false)}
                                  >
                                    Sell
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    onClick={() => handleDashboardSell(inv.botId, true)}
                                  >
                                    Sell All
                                  </Button>
                                </div>
                              )}

                              {/* Expanded view - same format as Nexus cards */}
                              {isExpanded && !isSelling && !isBuyingMore && (
                                <div className="flex flex-col gap-2.5 w-full">
                                  <div className="saved-item grid grid-cols-1 gap-3.5 h-full w-full min-w-0 overflow-hidden items-stretch justify-items-stretch">
                                    {analyzeState?.status === 'loading' ? (
                                      <div className="text-muted">Running backtest…</div>
                                    ) : analyzeState?.status === 'error' ? (
                                      <div className="grid gap-2">
                                        <div className="text-muted">{analyzeState.error ?? 'Failed to run backtest.'}</div>
                                        {b?.payload && <Button onClick={() => runAnalyzeBacktest(b)}>Retry</Button>}
                                      </div>
                                    ) : analyzeState?.status === 'done' ? (
                                      <div className="grid grid-cols-1 gap-2.5 min-w-0 w-full">
                                        {/* Live Stats */}
                                        <div className="base-stats-card w-full min-w-0 max-w-full flex flex-col items-stretch text-center">
                                          <div className="font-black mb-2 text-center">Live Stats</div>
                                          <div className="grid grid-cols-4 gap-2.5 justify-items-center w-full">
                                            <div>
                                              <div className="stat-label">Allocation</div>
                                              <div className="stat-value">{allocation.toFixed(1)}%</div>
                                            </div>
                                            <div>
                                              <div className="stat-label">Cost Basis</div>
                                              <div className="stat-value">{formatUsd(inv.costBasis)}</div>
                                            </div>
                                            <div>
                                              <div className="stat-label">Current Value</div>
                                              <div className="stat-value">{formatUsd(inv.currentValue)}</div>
                                            </div>
                                            <div>
                                              <div className="stat-label">P&L</div>
                                              <div className={cn("stat-value", inv.pnl >= 0 ? 'text-success' : 'text-danger')}>
                                                {formatSignedUsd(inv.pnl)} ({inv.pnlPercent >= 0 ? '+' : ''}{inv.pnlPercent.toFixed(1)}%)
                                              </div>
                                            </div>
                                          </div>
                                        </div>

                                        {/* Backtest Snapshot */}
                                        <div className="base-stats-card w-full min-w-0 text-center self-stretch">
                                          <div className="w-full">
                                            <div className="font-black mb-1.5">Backtest Snapshot</div>
                                            <div className="text-xs text-muted mb-2.5">Benchmark: {backtestBenchmark}</div>
                                            <div className="w-full max-w-full overflow-hidden">
                                              <EquityChart
                                                points={analyzeState.result?.points ?? []}
                                                benchmarkPoints={analyzeState.result?.benchmarkPoints}
                                                markers={analyzeState.result?.markers ?? []}
                                                logScale
                                                showCursorStats={false}
                                                heightPx={390}
                                                theme={uiState.theme}
                                              />
                                            </div>
                                            <div className="mt-2.5 w-full">
                                              <DrawdownChart points={analyzeState.result?.drawdownPoints ?? []} theme={uiState.theme} />
                                            </div>
                                          </div>
                                        </div>

                                        {/* Historical Stats */}
                                        <div className="base-stats-card w-full min-w-0 text-center self-stretch">
                                          <div className="w-full">
                                            <div className="font-black mb-2">Historical Stats</div>
                                            <div className="grid grid-cols-[repeat(4,minmax(140px,1fr))] gap-2.5 justify-items-center overflow-x-auto max-w-full w-full">
                                              <div>
                                                <div className="stat-label">CAGR</div>
                                                <div className="stat-value">{formatPct(analyzeState.result?.metrics.cagr ?? NaN)}</div>
                                              </div>
                                              <div>
                                                <div className="stat-label">Max DD</div>
                                                <div className="stat-value">{formatPct(analyzeState.result?.metrics.maxDrawdown ?? NaN)}</div>
                                              </div>
                                              <div>
                                                <div className="stat-label">Calmar Ratio</div>
                                                <div className="stat-value">
                                                  {Number.isFinite(analyzeState.result?.metrics.calmar ?? NaN)
                                                    ? (analyzeState.result?.metrics.calmar ?? 0).toFixed(2)
                                                    : '--'}
                                                </div>
                                              </div>
                                              <div>
                                                <div className="stat-label">Sharpe Ratio</div>
                                                <div className="stat-value">
                                                  {Number.isFinite(analyzeState.result?.metrics.sharpe ?? NaN)
                                                    ? (analyzeState.result?.metrics.sharpe ?? 0).toFixed(2)
                                                    : '--'}
                                                </div>
                                              </div>
                                              <div>
                                                <div className="stat-label">Sortino Ratio</div>
                                                <div className="stat-value">
                                                  {Number.isFinite(analyzeState.result?.metrics.sortino ?? NaN)
                                                    ? (analyzeState.result?.metrics.sortino ?? 0).toFixed(2)
                                                    : '--'}
                                                </div>
                                              </div>
                                              <div>
                                                <div className="stat-label">Treynor Ratio</div>
                                                <div className="stat-value">
                                                  {Number.isFinite(analyzeState.result?.metrics.treynor ?? NaN)
                                                    ? (analyzeState.result?.metrics.treynor ?? 0).toFixed(2)
                                                    : '--'}
                                                </div>
                                              </div>
                                              <div>
                                                <div className="stat-label">Beta</div>
                                                <div className="stat-value">
                                                  {Number.isFinite(analyzeState.result?.metrics.beta ?? NaN)
                                                    ? (analyzeState.result?.metrics.beta ?? 0).toFixed(2)
                                                    : '--'}
                                                </div>
                                              </div>
                                              <div>
                                                <div className="stat-label">Volatility</div>
                                                <div className="stat-value">{formatPct(analyzeState.result?.metrics.vol ?? NaN)}</div>
                                              </div>
                                              <div>
                                                <div className="stat-label">Win Rate</div>
                                                <div className="stat-value">{formatPct(analyzeState.result?.metrics.winRate ?? NaN)}</div>
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="text-muted">Click Expand to load backtest data.</div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </Card>
                          )
                        })}
                      </div>
                    )}
                  </Card>

                  {/* Right Panel: Portfolio Allocation Pie Chart */}
                  <Card className="p-4">
                    <div className="font-black mb-3">Portfolio Allocation</div>
                    <div className="flex items-start gap-4">
                      {/* Pie Chart SVG */}
                      <svg viewBox="0 0 100 100" className="w-40 h-40 flex-shrink-0">
                        {(() => {
                          const cashAlloc = dashboardTotalValue > 0 ? dashboardCash / dashboardTotalValue : 1
                          const slices: Array<{ color: string; percent: number; label: string }> = []

                          // Add bot slices
                          dashboardInvestmentsWithPnl.forEach((inv, idx) => {
                            const pct = dashboardTotalValue > 0 ? inv.currentValue / dashboardTotalValue : 0
                            if (pct > 0) {
                              slices.push({
                                color: BOT_CHART_COLORS[idx % BOT_CHART_COLORS.length],
                                percent: pct,
                                label: inv.botName,
                              })
                            }
                          })

                          // Add cash slice
                          if (cashAlloc > 0) {
                            slices.push({ color: '#94a3b8', percent: cashAlloc, label: 'Cash' })
                          }

                          // Draw pie slices
                          let cumulativePercent = 0
                          return slices.map((slice, i) => {
                            const startAngle = cumulativePercent * 360
                            cumulativePercent += slice.percent
                            const endAngle = cumulativePercent * 360

                            const startRad = ((startAngle - 90) * Math.PI) / 180
                            const endRad = ((endAngle - 90) * Math.PI) / 180

                            const x1 = 50 + 45 * Math.cos(startRad)
                            const y1 = 50 + 45 * Math.sin(startRad)
                            const x2 = 50 + 45 * Math.cos(endRad)
                            const y2 = 50 + 45 * Math.sin(endRad)

                            const largeArc = slice.percent > 0.5 ? 1 : 0

                            // Handle full circle case
                            if (slices.length === 1) {
                              return (
                                <circle
                                  key={i}
                                  cx="50"
                                  cy="50"
                                  r="45"
                                  fill={slice.color}
                                />
                              )
                            }

                            return (
                              <path
                                key={i}
                                d={`M 50 50 L ${x1} ${y1} A 45 45 0 ${largeArc} 1 ${x2} ${y2} Z`}
                                fill={slice.color}
                              />
                            )
                          })
                        })()}
                      </svg>

                      {/* Legend */}
                      <div className="flex-1 grid gap-1.5 text-sm">
                        {dashboardInvestmentsWithPnl.map((inv, idx) => {
                          const pct = dashboardTotalValue > 0 ? (inv.currentValue / dashboardTotalValue) * 100 : 0
                          return (
                            <div key={inv.botId} className="flex items-center gap-2">
                              <div
                                className="w-3 h-3 rounded-sm flex-shrink-0"
                                style={{ backgroundColor: BOT_CHART_COLORS[idx % BOT_CHART_COLORS.length] }}
                              />
                              <span className="flex-1 truncate font-bold">{inv.botName}</span>
                              <span className="text-muted">{pct.toFixed(1)}%</span>
                              <span className="font-bold">{formatUsd(inv.currentValue)}</span>
                            </div>
                          )
                        })}
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-sm flex-shrink-0 bg-slate-400" />
                          <span className="flex-1 font-bold">Cash</span>
                          <span className="text-muted">
                            {dashboardTotalValue > 0 ? ((dashboardCash / dashboardTotalValue) * 100).toFixed(1) : '100.0'}%
                          </span>
                          <span className="font-bold">{formatUsd(dashboardCash)}</span>
                        </div>
                        <div className="border-t border-border pt-1.5 mt-1 flex items-center gap-2">
                          <div className="w-3 h-3" />
                          <span className="flex-1 font-black">Total</span>
                          <span className="text-muted">100%</span>
                          <span className="font-black">{formatUsd(dashboardTotalValue)}</span>
                        </div>
                      </div>
                    </div>
                  </Card>
                </div>
              </div>
            ) : (
              <div className="mt-3 space-y-4">
                {/* Nexus Eligibility Requirements Section */}
                <Card className="p-4">
                  <div className="font-black mb-3">Nexus Eligibility Requirements</div>
                  <div className="p-3 bg-muted/30 rounded-lg text-sm space-y-2">
                    {appEligibilityRequirements.length === 0 ? (
                      <div className="text-muted">No eligibility requirements set. Contact admin for more information.</div>
                    ) : (
                      <ul className="list-disc list-inside space-y-1">
                        {appEligibilityRequirements.map((req) => (
                          <li key={req.id}>
                            {req.type === 'live_months' ? (
                              <>System must be live for at least {req.value} months</>
                            ) : req.type === 'etfs_only' ? (
                              <>System must only contain ETF positions (no individual stocks)</>
                            ) : (
                              <>System must have {METRIC_LABELS[req.metric!]} of {req.comparison === 'at_least' ? 'at least' : 'at most'} {req.value}</>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="text-xs text-muted mt-2 pt-2 border-t border-border">
                      Systems that meet all requirements above can be added to the Nexus Fund to earn partner program revenue.
                    </div>
                  </div>
                </Card>

                {/* T-Bill Zone at Top with working equity chart */}
                <Card className="p-4">
                  <div className="font-black mb-3">T-Bill Performance</div>
                  {(() => {
                    // Calculate total gains from all funds
                    const fundGains = ([1, 2, 3, 4, 5] as const).map(n => {
                      const fundKey = `fund${n}` as keyof FundZones
                      const botId = uiState.fundZones[fundKey]
                      if (!botId) return 0
                      const investment = dashboardPortfolio.investments.find(inv => inv.botId === botId)
                      if (!investment) return 0
                      const currentValue = analyzeBacktests[botId]?.result?.metrics?.cagr
                        ? investment.costBasis * (1 + (analyzeBacktests[botId]?.result?.metrics?.cagr ?? 0))
                        : investment.costBasis
                      return currentValue - investment.costBasis
                    })
                    const totalGains = fundGains.reduce((sum, g) => sum + g, 0)

                    // Generate equity curve data for T-Bill (simulated 4.5% annual return)
                    const now = Date.now()
                    const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000
                    const tBillEquityData: { time: UTCTimestamp; value: number }[] = []
                    const startValue = 100000 // Starting with $100k
                    const dailyReturn = Math.pow(1.045, 1/365) - 1 // 4.5% annual = daily compounded

                    for (let d = 0; d <= 365; d += 7) { // Weekly data points
                      const date = new Date(oneYearAgo + d * 24 * 60 * 60 * 1000)
                      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
                      const value = startValue * Math.pow(1 + dailyReturn, d)
                      tBillEquityData.push({
                        time: dateStr as unknown as UTCTimestamp,
                        value: ((value - startValue) / startValue) * 100 // % return
                      })
                    }

                    return (
                      <>
                        <div className="grid grid-cols-2 gap-4 mb-4">
                          <div className="p-3 bg-emerald-500/10 rounded-lg border border-emerald-500/30">
                            <div className="text-xs text-muted mb-1">T-Bill Yield (Annual)</div>
                            <div className="text-xl font-black text-emerald-500">4.50%</div>
                          </div>
                          <div className="p-3 bg-blue-500/10 rounded-lg border border-blue-500/30">
                            <div className="text-xs text-muted mb-1">Total Fund Gains</div>
                            <div className={cn("text-xl font-black", totalGains >= 0 ? "text-emerald-500" : "text-red-500")}>
                              {totalGains >= 0 ? '+' : ''}{formatUsd(totalGains)}
                            </div>
                          </div>
                        </div>
                        <PartnerTBillChart data={tBillEquityData} theme={uiState.theme} />
                      </>
                    )
                  })()}
                </Card>

                {/* 5 Fund Zones - Each as its own card */}
                <div className="grid grid-cols-5 gap-3">
                  {([1, 2, 3, 4, 5] as const).map(n => {
                    const fundKey = `fund${n}` as keyof FundZones
                    const botId = uiState.fundZones[fundKey]
                    const bot = botId ? savedBots.find(b => b.id === botId) : null

                    // Calculate fund gains
                    let fundGain = 0
                    let fundCagr = 0
                    if (botId) {
                      const investment = dashboardPortfolio.investments.find(inv => inv.botId === botId)
                      const metrics = analyzeBacktests[botId]?.result?.metrics
                      fundCagr = metrics?.cagr ?? 0
                      if (investment) {
                        const currentValue = metrics?.cagr
                          ? investment.costBasis * (1 + metrics.cagr)
                          : investment.costBasis
                        fundGain = currentValue - investment.costBasis
                      }
                    }

                    return (
                      <Card key={n} className="p-3">
                        <div className="text-xs font-bold text-muted mb-2">Fund #{n}</div>
                        {bot ? (
                          <div className="space-y-2">
                            <div className="font-bold text-sm truncate" title={bot.name}>{bot.name}</div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full h-6 text-xs text-red-500 hover:text-red-600"
                              onClick={async () => {
                                // Remove from fund, re-evaluate eligibility
                                setUiState(prev => ({
                                  ...prev,
                                  fundZones: { ...prev.fundZones, [fundKey]: null }
                                }))
                                // Change tag from Nexus back to Private + Nexus Eligible, clear fundSlot
                                const baseTags = (bot.tags || []).filter(t => t !== 'Nexus' && t !== 'Private' && t !== 'Nexus Eligible')
                                const updatedBot: SavedBot = { ...bot, tags: ['Private', 'Nexus Eligible', ...baseTags], fundSlot: null }
                                setSavedBots(prev => prev.map(b => b.id !== botId ? b : updatedBot))
                                // Sync to database - this will set visibility to 'nexus_eligible' (not 'nexus')
                                await updateBotInApi(userId, updatedBot)
                              }}
                            >
                              Remove
                            </Button>
                            <div className="border-t border-border pt-2 mt-2">
                              <div className="text-[10px] text-muted">Returns</div>
                              <div className={cn("text-sm font-bold", fundGain >= 0 ? "text-emerald-500" : "text-red-500")}>
                                {fundGain >= 0 ? '+' : ''}{formatUsd(fundGain)}
                              </div>
                              <div className={cn("text-xs", fundCagr >= 0 ? "text-emerald-400" : "text-red-400")}>
                                CAGR: {formatPct(fundCagr)}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="text-xs text-muted text-center py-6">
                            Empty
                          </div>
                        )}
                      </Card>
                    )
                  })}
                </div>

                {/* Nexus Eligible Systems */}
                <Card className="p-4">
                  <div className="font-black mb-3">Nexus Eligible Systems</div>
                  {(() => {
                    // Filter bots owned by current user with Nexus or Nexus Eligible tags
                    const eligibleBotsList = savedBots.filter(
                      b => b.builderId === userId && (b.tags?.includes('Nexus') || b.tags?.includes('Nexus Eligible'))
                    )

                    if (eligibleBotsList.length === 0) {
                      return (
                        <div className="text-center text-muted py-8">
                          No eligible systems. Systems become eligible when they meet the Partner Program requirements.
                        </div>
                      )
                    }

                    return (
                      <div className="flex flex-col gap-2.5">
                        {eligibleBotsList.map(b => {
                          const collapsed = uiState.communityCollapsedByBotId[b.id] ?? true
                          const analyzeState = analyzeBacktests[b.id]
                          const isInFund = Object.values(uiState.fundZones).includes(b.id)
                          const wlTags = watchlistsByBotId.get(b.id) ?? []

                          const toggleCollapse = () => {
                            const next = !collapsed
                            setUiState(prev => ({
                              ...prev,
                              communityCollapsedByBotId: { ...prev.communityCollapsedByBotId, [b.id]: next }
                            }))
                            if (!next && (!analyzeState || analyzeState.status === 'idle' || analyzeState.status === 'error')) {
                              runAnalyzeBacktest(b)
                            }
                          }

                          return (
                            <Card key={b.id} className="grid gap-2.5">
                              <div className="flex items-center gap-2.5 flex-wrap">
                                <Button variant="ghost" size="sm" onClick={toggleCollapse}>
                                  {collapsed ? 'Expand' : 'Collapse'}
                                </Button>
                                <div className="font-black">{b.name}</div>
                                <Badge variant={b.tags?.includes('Nexus') ? 'default' : b.tags?.includes('Atlas') ? 'default' : 'accent'}>
                                  {b.tags?.includes('Nexus') ? 'Nexus' : b.tags?.includes('Atlas') ? 'Atlas' : 'Private'}
                                </Badge>
                                {b.tags?.includes('Nexus Eligible') && (
                                  <Badge variant="secondary">Nexus Eligible</Badge>
                                )}
                                <Badge variant="default">{b.builderDisplayName || (b.builderId === userId ? userDisplayName : null) || b.builderId}</Badge>
                                <div className="flex gap-1.5 flex-wrap">
                                  {wlTags.map((w) => (
                                    <Badge key={w.id} variant="accent" className="gap-1.5">
                                      {w.name}
                                    </Badge>
                                  ))}
                                </div>
                                <div className="ml-auto flex gap-2 flex-wrap items-center">
                                  {isInFund ? (
                                    <Badge variant="muted">In Fund</Badge>
                                  ) : (
                                    <select
                                      className="text-xs px-2 py-1 rounded border border-border bg-background"
                                      value=""
                                      onChange={(e) => {
                                        const fundKey = e.target.value as keyof FundZones
                                        if (!fundKey) return
                                        // Extract fund number from key (e.g., 'fund1' -> 1)
                                        const fundNum = parseInt(fundKey.replace('fund', '')) as 1 | 2 | 3 | 4 | 5
                                        setUiState(prev => ({
                                          ...prev,
                                          fundZones: { ...prev.fundZones, [fundKey]: b.id }
                                        }))
                                        setSavedBots(prev => prev.map(bot => {
                                          if (bot.id !== b.id) return bot
                                          // Remove Private, Nexus Eligible; add Nexus (keep other tags like Atlas if any)
                                          const baseTags = (bot.tags || []).filter(t => t !== 'Private' && t !== 'Nexus Eligible' && t !== 'Nexus')
                                          const updatedBot = { ...bot, tags: ['Nexus', ...baseTags], fundSlot: fundNum }
                                          // Sync to database for cross-user visibility
                                          if (userId) updateBotInApi(userId, updatedBot).catch(() => {})
                                          return updatedBot
                                        }))
                                      }}
                                    >
                                      <option value="">Add to Fund...</option>
                                      {([1, 2, 3, 4, 5] as const).map(n => {
                                        const fundKey = `fund${n}` as keyof FundZones
                                        const isEmpty = !uiState.fundZones[fundKey]
                                        return (
                                          <option key={n} value={fundKey} disabled={!isEmpty}>
                                            Fund #{n} {isEmpty ? '' : '(occupied)'}
                                          </option>
                                        )
                                      })}
                                    </select>
                                  )}
                                  {/* FRD-012: Show Copy to New for published systems, Open in Build for private */}
                                  {(b.tags?.includes('Nexus') || b.tags?.includes('Atlas')) ? (
                                    <Button size="sm" onClick={() => handleCopyToNew(b)}>Copy to New System</Button>
                                  ) : (
                                    <Button size="sm" onClick={() => handleOpenSaved(b)}>Open in Build</Button>
                                  )}
                                  <Button
                                    size="sm"
                                    onClick={() => {
                                      setAddToWatchlistBotId(b.id)
                                      setAddToWatchlistNewName('')
                                    }}
                                  >
                                    Add to Watchlist
                                  </Button>
                                </div>
                              </div>

                              {!collapsed && (
                                <div className="flex flex-col gap-2.5 w-full">
                                  {/* Tab Navigation */}
                                  <div className="flex gap-2 border-b border-border pb-2">
                                    <Button
                                      size="sm"
                                      variant={(uiState.analyzeBotCardTab[b.id] ?? 'overview') === 'overview' ? 'default' : 'outline'}
                                      onClick={() => setUiState((prev) => ({
                                        ...prev,
                                        analyzeBotCardTab: { ...prev.analyzeBotCardTab, [b.id]: 'overview' },
                                      }))}
                                    >
                                      Overview
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant={(uiState.analyzeBotCardTab[b.id] ?? 'overview') === 'advanced' ? 'default' : 'outline'}
                                      onClick={() => setUiState((prev) => ({
                                        ...prev,
                                        analyzeBotCardTab: { ...prev.analyzeBotCardTab, [b.id]: 'advanced' },
                                      }))}
                                    >
                                      Benchmarks
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant={(uiState.analyzeBotCardTab[b.id] ?? 'overview') === 'robustness' ? 'default' : 'outline'}
                                      onClick={() => setUiState((prev) => ({
                                        ...prev,
                                        analyzeBotCardTab: { ...prev.analyzeBotCardTab, [b.id]: 'robustness' },
                                      }))}
                                    >
                                      Robustness
                                    </Button>
                                  </div>

                                  {/* Overview Tab Content */}
                                  {(uiState.analyzeBotCardTab[b.id] ?? 'overview') === 'overview' && (
                                    <div className="grid w-full max-w-full grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-2.5 items-stretch overflow-x-hidden">
                                      <div className="saved-item grid grid-cols-1 gap-3.5 h-full w-full min-w-0 overflow-hidden items-stretch justify-items-stretch">
                                        {analyzeState?.status === 'loading' ? (
                                          <div className="text-muted">Running backtest…</div>
                                        ) : analyzeState?.status === 'error' ? (
                                          <div className="grid gap-2">
                                            <div className="text-danger font-extrabold">{analyzeState.error ?? 'Failed to run backtest.'}</div>
                                            <Button onClick={() => runAnalyzeBacktest(b)}>Retry</Button>
                                          </div>
                                        ) : analyzeState?.status === 'done' ? (
                                          <div className="grid grid-cols-1 gap-2.5 min-w-0 w-full">
                                            {/* Buy System Section */}
                                            <div className="border-b border-border pb-3 mb-1">
                                              <div className="font-bold mb-2">Buy System</div>
                                              <div className="text-sm mb-2">
                                                <span className="text-muted">Cash Available:</span>{' '}
                                                <span className="font-bold">{formatUsd(dashboardCash)}</span>
                                                {nexusBuyBotId === b.id && nexusBuyMode === '%' && nexusBuyAmount && (
                                                  <span className="text-muted"> · Amount: {formatUsd((parseFloat(nexusBuyAmount) / 100) * dashboardCash)}</span>
                                                )}
                                              </div>
                                              <div className="flex gap-2 items-center">
                                                <Button
                                                  size="sm"
                                                  onClick={() => handleNexusBuy(b.id)}
                                                  disabled={nexusBuyBotId !== b.id || !nexusBuyAmount}
                                                  className="h-8 px-4"
                                                >
                                                  Buy
                                                </Button>
                                                <div className="flex gap-1">
                                                  <Button
                                                    size="sm"
                                                    variant={nexusBuyBotId === b.id && nexusBuyMode === '$' ? 'accent' : 'outline'}
                                                    className="h-8 w-8 p-0"
                                                    onClick={() => { setNexusBuyBotId(b.id); setNexusBuyMode('$') }}
                                                  >
                                                    $
                                                  </Button>
                                                  <Button
                                                    size="sm"
                                                    variant={nexusBuyBotId === b.id && nexusBuyMode === '%' ? 'accent' : 'outline'}
                                                    className="h-8 w-8 p-0"
                                                    onClick={() => { setNexusBuyBotId(b.id); setNexusBuyMode('%') }}
                                                  >
                                                    %
                                                  </Button>
                                                </div>
                                                <Input
                                                  type="number"
                                                  placeholder={nexusBuyBotId === b.id && nexusBuyMode === '%' ? '% of cash' : 'Amount'}
                                                  value={nexusBuyBotId === b.id ? nexusBuyAmount : ''}
                                                  onChange={(e) => { setNexusBuyBotId(b.id); setNexusBuyAmount(e.target.value) }}
                                                  className="h-8 flex-1"
                                                />
                                              </div>
                                            </div>

                                            <div className="base-stats-grid w-full self-stretch grid grid-cols-1 grid-rows-[auto_auto_auto] gap-3">
                                              {(() => {
                                                const investment = dashboardInvestmentsWithPnl.find((inv) => inv.botId === b.id)
                                                const isInvested = !!investment
                                                const amountInvested = investment?.costBasis ?? 0
                                                const currentValue = investment?.currentValue ?? 0
                                                const pnlPct = investment?.pnlPercent ?? 0
                                                let liveCagr = 0
                                                if (investment) {
                                                  const daysSinceInvestment = (Date.now() - investment.buyDate) / (1000 * 60 * 60 * 24)
                                                  const yearsSinceInvestment = daysSinceInvestment / 365
                                                  if (yearsSinceInvestment > 0 && amountInvested > 0) {
                                                    liveCagr = (Math.pow(currentValue / amountInvested, 1 / yearsSinceInvestment) - 1)
                                                  }
                                                }
                                                return (
                                                  <div className="base-stats-card w-full min-w-0 max-w-full flex flex-col items-stretch text-center">
                                                    <div className="font-black mb-2 text-center">Live Stats</div>
                                                    {isInvested ? (
                                                      <div className="grid grid-cols-4 gap-2.5 justify-items-center w-full">
                                                        <div>
                                                          <div className="stat-label">Invested</div>
                                                          <div className="stat-value">{formatUsd(amountInvested)}</div>
                                                        </div>
                                                        <div>
                                                          <div className="stat-label">Current Value</div>
                                                          <div className="stat-value">{formatUsd(currentValue)}</div>
                                                        </div>
                                                        <div>
                                                          <div className="stat-label">P&L</div>
                                                          <div className={cn("stat-value", pnlPct >= 0 ? 'text-success' : 'text-danger')}>
                                                            {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                                                          </div>
                                                        </div>
                                                        <div>
                                                          <div className="stat-label">CAGR</div>
                                                          <div className={cn("stat-value", liveCagr >= 0 ? 'text-success' : 'text-danger')}>
                                                            {formatPct(liveCagr)}
                                                          </div>
                                                        </div>
                                                      </div>
                                                    ) : (
                                                      <div className="text-muted text-sm">Not invested in this system. Buy from Dashboard to track live stats.</div>
                                                    )}
                                                  </div>
                                                )
                                              })()}

                                              <div className="base-stats-card w-full min-w-0 text-center self-stretch">
                                                <div className="w-full">
                                                  <div className="font-black mb-1.5">Backtest Snapshot</div>
                                                  <div className="text-xs text-muted mb-2.5">Benchmark: {backtestBenchmark}</div>
                                                  <div className="w-full max-w-full overflow-hidden">
                                                    <EquityChart
                                                      points={analyzeState.result?.points ?? []}
                                                      benchmarkPoints={analyzeState.result?.benchmarkPoints}
                                                      markers={analyzeState.result?.markers ?? []}
                                                      logScale
                                                      showCursorStats={false}
                                                      heightPx={390}
                                                      theme={uiState.theme}
                                                    />
                                                  </div>
                                                  <div className="mt-2.5 w-full">
                                                    <DrawdownChart points={analyzeState.result?.drawdownPoints ?? []} theme={uiState.theme} />
                                                  </div>
                                                </div>
                                              </div>

                                              <div className="base-stats-card w-full min-w-0 text-center self-stretch">
                                                <div className="w-full">
                                                  <div className="font-black mb-2">Historical Stats</div>
                                                  <div className="grid grid-cols-[repeat(4,minmax(140px,1fr))] gap-2.5 justify-items-center overflow-x-auto max-w-full w-full">
                                                    <div>
                                                      <div className="stat-label">CAGR</div>
                                                      <div className="stat-value">{formatPct(analyzeState.result?.metrics.cagr ?? NaN)}</div>
                                                    </div>
                                                    <div>
                                                      <div className="stat-label">Max DD</div>
                                                      <div className="stat-value">{formatPct(analyzeState.result?.metrics.maxDrawdown ?? NaN)}</div>
                                                    </div>
                                                    <div>
                                                      <div className="stat-label">Calmar Ratio</div>
                                                      <div className="stat-value">
                                                        {Number.isFinite(analyzeState.result?.metrics.calmar ?? NaN)
                                                          ? (analyzeState.result?.metrics.calmar ?? 0).toFixed(2)
                                                          : '--'}
                                                      </div>
                                                    </div>
                                                    <div>
                                                      <div className="stat-label">Sharpe Ratio</div>
                                                      <div className="stat-value">
                                                        {Number.isFinite(analyzeState.result?.metrics.sharpe ?? NaN)
                                                          ? (analyzeState.result?.metrics.sharpe ?? 0).toFixed(2)
                                                          : '--'}
                                                      </div>
                                                    </div>
                                                    <div>
                                                      <div className="stat-label">Sortino Ratio</div>
                                                      <div className="stat-value">
                                                        {Number.isFinite(analyzeState.result?.metrics.sortino ?? NaN)
                                                          ? (analyzeState.result?.metrics.sortino ?? 0).toFixed(2)
                                                          : '--'}
                                                      </div>
                                                    </div>
                                                    <div>
                                                      <div className="stat-label">Treynor Ratio</div>
                                                      <div className="stat-value">
                                                        {Number.isFinite(analyzeState.result?.metrics.treynor ?? NaN)
                                                          ? (analyzeState.result?.metrics.treynor ?? 0).toFixed(2)
                                                          : '--'}
                                                      </div>
                                                    </div>
                                                    <div>
                                                      <div className="stat-label">Beta</div>
                                                      <div className="stat-value">
                                                        {Number.isFinite(analyzeState.result?.metrics.beta ?? NaN)
                                                          ? (analyzeState.result?.metrics.beta ?? 0).toFixed(2)
                                                          : '--'}
                                                      </div>
                                                    </div>
                                                    <div>
                                                      <div className="stat-label">Volatility</div>
                                                      <div className="stat-value">{formatPct(analyzeState.result?.metrics.vol ?? NaN)}</div>
                                                    </div>
                                                    <div>
                                                      <div className="stat-label">Win Rate</div>
                                                      <div className="stat-value">{formatPct(analyzeState.result?.metrics.winRate ?? NaN)}</div>
                                                    </div>
                                                    <div>
                                                      <div className="stat-label">Turnover</div>
                                                      <div className="stat-value">{formatPct(analyzeState.result?.metrics.avgTurnover ?? NaN)}</div>
                                                    </div>
                                                    <div>
                                                      <div className="stat-label">Avg Holdings</div>
                                                      <div className="stat-value">
                                                        {Number.isFinite(analyzeState.result?.metrics.avgHoldings ?? NaN)
                                                          ? (analyzeState.result?.metrics.avgHoldings ?? 0).toFixed(1)
                                                          : '--'}
                                                      </div>
                                                    </div>
                                                    <div>
                                                      <div className="stat-label">Trading Days</div>
                                                      <div className="stat-value">{analyzeState.result?.metrics.days ?? '--'}</div>
                                                    </div>
                                                  </div>
                                                  <div className="mt-2 text-xs text-muted">
                                                    Period: {analyzeState.result?.metrics.startDate ?? '--'} to {analyzeState.result?.metrics.endDate ?? '--'}
                                                  </div>
                                                </div>
                                              </div>
                                            </div>
                                          </div>
                                        ) : (
                                          <button onClick={() => runAnalyzeBacktest(b)}>Run backtest</button>
                                        )}
                                      </div>

                                      <div className="saved-item flex flex-col gap-2.5 h-full min-w-0">
                                        <div className="font-black">Information</div>
                                        <div className="text-xs text-muted font-extrabold">Placeholder text: Information, tickers, etc</div>
                                      </div>
                                    </div>
                                  )}

                                  {/* Robustness Tab Content */}
                                  {(uiState.analyzeBotCardTab[b.id] ?? 'overview') === 'robustness' && (
                                    <div className="saved-item flex flex-col gap-2.5 h-full min-w-0">
                                      {(() => {
                                        const sanityState = sanityReports[b.id] ?? { status: 'idle' as const }
                                        const getLevelColor = (level: string) => {
                                          if (level === 'Low') return 'text-success'
                                          if (level === 'Medium') return 'text-warning'
                                          if (level === 'High' || level === 'Fragile') return 'text-danger'
                                          return 'text-muted'
                                        }
                                        const getLevelIcon = (level: string) => {
                                          if (level === 'Low') return '🟢'
                                          if (level === 'Medium') return '🟡'
                                          if (level === 'High' || level === 'Fragile') return '🔴'
                                          return '⚪'
                                        }
                                        const formatPctVal = (v: number) => Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '--'
                                        const formatDDPct = (v: number) => Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '--'

                                        return (
                                          <>
                                            <div className="flex items-center justify-between gap-2.5">
                                              <div className="font-black">Robustness Analysis</div>
                                              <Button
                                                size="sm"
                                                onClick={() => runSanityReport(b)}
                                                disabled={sanityState.status === 'loading'}
                                              >
                                                {sanityState.status === 'loading' ? 'Running...' : sanityState.status === 'done' ? 'Re-run' : 'Generate'}
                                              </Button>
                                            </div>

                                            {sanityState.status === 'idle' && (
                                              <div className="text-muted text-sm p-4 border border-border rounded-xl text-center">
                                                Click "Generate" to run bootstrap simulations and fragility analysis.
                                                <br />
                                                <span className="text-xs">This may take 10-30 seconds.</span>
                                              </div>
                                            )}

                                            {sanityState.status === 'loading' && (
                                              <div className="text-muted text-sm p-4 border border-border rounded-xl text-center">
                                                <div className="animate-pulse">Running bootstrap simulations...</div>
                                                <div className="text-xs mt-1">Monte Carlo + K-Fold analysis in progress</div>
                                              </div>
                                            )}

                                            {sanityState.status === 'error' && (
                                              <div className="text-danger text-sm p-4 border border-danger rounded-xl">
                                                Error: {sanityState.error}
                                              </div>
                                            )}

                                            {sanityState.status === 'done' && sanityState.report && (
                                              <>
                                                {/* 4-Column Grid Layout */}
                                                <div className="grid grid-cols-4 gap-3 w-full h-full">
                                                  {/* Left Card: Summary & Fragility */}
                                                  <div className="border border-border rounded-xl p-3 flex flex-col gap-3 h-full">
                                                    {/* Summary */}
                                                    <div>
                                                      <div className="text-xs font-bold mb-1.5 text-center">Summary</div>
                                                      {sanityState.report.summary.length > 0 ? (
                                                        <ul className="text-xs space-y-0.5">
                                                          {sanityState.report.summary.map((s, i) => (
                                                            <li key={i} className="flex items-start gap-1.5">
                                                              <span className="text-warning">•</span>
                                                              <span>{s}</span>
                                                            </li>
                                                          ))}
                                                        </ul>
                                                      ) : (
                                                        <div className="text-xs text-muted">No major red flags detected.</div>
                                                      )}
                                                    </div>

                                                    {/* Fragility Table (Condensed) */}
                                                    <div>
                                                      <div className="text-xs font-bold mb-1.5 text-center">Fragility Fingerprints</div>
                                                      <div className="space-y-1">
                                                        {[
                                                          { name: 'Sub-Period', data: sanityState.report.fragility.subPeriodStability, tooltip: 'Consistency of returns across different time periods. Low = stable across all periods.' },
                                                          { name: 'Profit Conc.', data: sanityState.report.fragility.profitConcentration, tooltip: 'How concentrated profits are in a few big days. Low = profits spread evenly.' },
                                                          { name: 'Smoothness', data: sanityState.report.fragility.smoothnessScore, tooltip: 'How smooth the equity curve is. Normal = acceptable volatility in growth.' },
                                                          { name: 'Thinning', data: sanityState.report.fragility.thinningFragility, tooltip: 'Sensitivity to removing random trades. Robust = performance holds when trades removed.' },
                                                        ].map(({ name, data, tooltip }) => (
                                                          <div key={name} className="flex items-center gap-2 text-xs" title={tooltip}>
                                                            <span className="w-20 truncate text-muted cursor-help">{name}</span>
                                                            <span className={cn("w-16", getLevelColor(data.level))}>
                                                              {getLevelIcon(data.level)} {data.level}
                                                            </span>
                                                          </div>
                                                        ))}
                                                      </div>
                                                    </div>

                                                    {/* DD Probabilities */}
                                                    <div>
                                                      <div className="text-xs font-bold mb-1.5 text-center">DD Probability</div>
                                                      <div className="space-y-0.5 text-xs">
                                                        <div><span className="font-semibold">{formatPctVal(sanityState.report.pathRisk.drawdownProbabilities.gt20)}</span> chance of 20% DD</div>
                                                        <div><span className="font-semibold">{formatPctVal(sanityState.report.pathRisk.drawdownProbabilities.gt30)}</span> chance of 30% DD</div>
                                                        <div><span className="font-semibold">{formatPctVal(sanityState.report.pathRisk.drawdownProbabilities.gt40)}</span> chance of 40% DD</div>
                                                        <div><span className="font-semibold">{formatPctVal(sanityState.report.pathRisk.drawdownProbabilities.gt50)}</span> chance of 50% DD</div>
                                                      </div>
                                                    </div>
                                                  </div>

                                                  {/* Middle Card: Monte Carlo */}
                                                  <div className="border border-border rounded-xl p-3 flex flex-col h-full">
                                                    <div className="text-xs font-bold mb-2 text-center">Monte Carlo (2000 years)</div>

                                                    {/* MC Drawdown Distribution */}
                                                    <div className="mb-3">
                                                      <div className="text-xs text-muted mb-1 cursor-help text-center" title="Distribution of maximum drawdowns across 400 simulated 5-year paths (2000 total years). Shows worst-case (P5), median, and best-case (P95) scenarios.">Max Drawdown Distribution</div>
                                                      {(() => {
                                                        const dd = sanityState.report.pathRisk.monteCarlo.drawdowns
                                                        // Drawdowns are negative: p95 is worst (most negative), p5 is best (least negative)
                                                        // Scale: worst (p95) on left at 0%, best (p5) on right at 100%
                                                        const minVal = dd.p95 // Most negative = left side
                                                        const maxVal = dd.p5  // Least negative = right side
                                                        const range = maxVal - minVal || 0.01
                                                        const toPos = (v: number) => Math.max(0, Math.min(100, ((v - minVal) / range) * 100))
                                                        return (
                                                          <>
                                                            <div className="relative h-4 bg-muted/30 rounded overflow-hidden">
                                                              {/* P25-P75 range */}
                                                              <div
                                                                className="absolute h-full bg-danger/40"
                                                                style={{ left: `${toPos(dd.p75)}%`, width: `${Math.abs(toPos(dd.p25) - toPos(dd.p75))}%` }}
                                                              />
                                                              {/* P50 marker */}
                                                              <div
                                                                className="absolute h-full w-0.5 bg-danger"
                                                                style={{ left: `${toPos(dd.p50)}%` }}
                                                              />
                                                            </div>
                                                            <div className="flex justify-between text-xs mt-0.5">
                                                              <span className="text-danger">P95: {formatDDPct(dd.p5)}</span>
                                                              <span className="font-semibold">P50: {formatDDPct(dd.p50)}</span>
                                                              <span className="text-success">P5: {formatDDPct(dd.p95)}</span>
                                                            </div>
                                                          </>
                                                        )
                                                      })()}
                                                    </div>

                                                    {/* MC CAGR Distribution */}
                                                    <div>
                                                      <div className="text-xs text-muted mb-1 cursor-help text-center" title="Distribution of annualized returns (CAGR) across 200 simulated 5-year paths. P5 is worst, P95 is best expected returns.">CAGR Distribution</div>
                                                      {(() => {
                                                        const cagr = sanityState.report.pathRisk.monteCarlo.cagrs
                                                        const minVal = Math.min(cagr.p5, cagr.p95)
                                                        const maxVal = Math.max(cagr.p5, cagr.p95)
                                                        const range = maxVal - minVal || 1
                                                        const toPos = (v: number) => ((v - minVal) / range) * 100
                                                        return (
                                                          <>
                                                            <div className="relative h-4 bg-muted/30 rounded overflow-hidden">
                                                              {/* P25-P75 range */}
                                                              <div
                                                                className="absolute h-full bg-success/40"
                                                                style={{ left: `${toPos(cagr.p25)}%`, width: `${toPos(cagr.p75) - toPos(cagr.p25)}%` }}
                                                              />
                                                              {/* P50 marker */}
                                                              <div
                                                                className="absolute h-full w-0.5 bg-success"
                                                                style={{ left: `${toPos(cagr.p50)}%` }}
                                                              />
                                                            </div>
                                                            <div className="flex justify-between text-xs mt-0.5">
                                                              <span className="text-danger">P5: {formatDDPct(cagr.p5)}</span>
                                                              <span className="font-semibold">P50: {formatDDPct(cagr.p50)}</span>
                                                              <span className="text-success">P95: {formatDDPct(cagr.p95)}</span>
                                                            </div>
                                                          </>
                                                        )
                                                      })()}
                                                    </div>

                                                    {/* MC Sharpe Distribution */}
                                                    {sanityState.report.pathRisk.monteCarlo.sharpes && (
                                                      <div className="mb-3">
                                                        <div className="text-xs text-muted mb-1 cursor-help text-center" title="Distribution of Sharpe ratios across Monte Carlo simulations. Higher is better.">Sharpe Distribution</div>
                                                        {(() => {
                                                          const sh = sanityState.report.pathRisk.monteCarlo.sharpes
                                                          // Sharpe: higher is better, so P5 (worst) on left, P95 (best) on right
                                                          const minVal = sh.p5
                                                          const maxVal = sh.p95
                                                          const range = maxVal - minVal || 0.01
                                                          const toPos = (v: number) => Math.max(0, Math.min(100, ((v - minVal) / range) * 100))
                                                          const hasP25P75 = sh.p25 != null && sh.p75 != null
                                                          return (
                                                            <>
                                                              <div className="relative h-4 bg-muted/30 rounded overflow-hidden">
                                                                {/* P25-P75 range (green for good Sharpe) - only if we have p25/p75 */}
                                                                {hasP25P75 && <div className="absolute h-full bg-success/40" style={{ left: `${toPos(sh.p25)}%`, width: `${toPos(sh.p75) - toPos(sh.p25)}%` }} />}
                                                                <div className="absolute h-full w-0.5 bg-success" style={{ left: `${toPos(sh.p50)}%` }} />
                                                              </div>
                                                              <div className="flex justify-between text-xs mt-0.5">
                                                                <span className="text-danger">P5: {sh.p5?.toFixed(2) ?? '-'}</span>
                                                                <span className="font-semibold">P50: {sh.p50?.toFixed(2) ?? '-'}</span>
                                                                <span className="text-success">P95: {sh.p95?.toFixed(2) ?? '-'}</span>
                                                              </div>
                                                            </>
                                                          )
                                                        })()}
                                                      </div>
                                                    )}

                                                    {/* MC Volatility Distribution */}
                                                    {sanityState.report.pathRisk.monteCarlo.volatilities && (
                                                      <div>
                                                        <div className="text-xs text-muted mb-1 cursor-help text-center" title="Distribution of annualized volatility across Monte Carlo simulations. Lower is generally better.">Volatility Distribution</div>
                                                        {(() => {
                                                          const vol = sanityState.report.pathRisk.monteCarlo.volatilities
                                                          // Volatility: lower is better, so flip - P95 (worst/high vol) on left, P5 (best/low vol) on right
                                                          const minVal = vol.p95 // High vol = left side (bad)
                                                          const maxVal = vol.p5  // Low vol = right side (good)
                                                          const range = maxVal - minVal || 0.01
                                                          const toPos = (v: number) => Math.max(0, Math.min(100, ((v - minVal) / range) * 100))
                                                          const hasP25P75 = vol.p25 != null && vol.p75 != null
                                                          return (
                                                            <>
                                                              <div className="relative h-4 bg-muted/30 rounded overflow-hidden">
                                                                {/* P25-P75 range (red for volatility since it's bad) - only if we have p25/p75 */}
                                                                {hasP25P75 && <div className="absolute h-full bg-danger/40" style={{ left: `${toPos(vol.p75)}%`, width: `${toPos(vol.p25) - toPos(vol.p75)}%` }} />}
                                                                <div className="absolute h-full w-0.5 bg-danger" style={{ left: `${toPos(vol.p50)}%` }} />
                                                              </div>
                                                              <div className="flex justify-between text-xs mt-0.5">
                                                                <span className="text-danger">P95: {formatDDPct(vol.p95)}</span>
                                                                <span className="font-semibold">P50: {formatDDPct(vol.p50)}</span>
                                                                <span className="text-success">P5: {formatDDPct(vol.p5)}</span>
                                                              </div>
                                                            </>
                                                          )
                                                        })()}
                                                      </div>
                                                    )}
                                                  </div>

                                                  {/* Distribution Curves Card */}
                                                  <div className="border border-border rounded-xl p-3 flex flex-col gap-3 h-full">
                                                    <div className="text-xs font-bold mb-1 text-center">Distribution Curves</div>

                                                    {/* CAGR Distribution Bar Chart */}
                                                    <div>
                                                      <div className="text-xs text-muted mb-1 cursor-help text-center" title="Distribution of CAGR values across 200 Monte Carlo simulations. Each bar represents a bucket of CAGR values.">CAGR Distribution</div>
                                                      {(() => {
                                                        const histogram = sanityState.report.pathRisk.monteCarlo.cagrs.histogram
                                                        if (!histogram || histogram.length === 0) return <div className="text-xs text-muted">No histogram data</div>
                                                        const maxCount = Math.max(...histogram.map((b: { count: number }) => b.count))
                                                        return (
                                                          <div className="flex items-end gap-px h-16">
                                                            {histogram.map((bucket: { midpoint: number; count: number; min: number; max: number }, i: number) => {
                                                              const heightPct = maxCount > 0 ? (bucket.count / maxCount) * 100 : 0
                                                              const isPositive = bucket.midpoint >= 0
                                                              return (
                                                                <div
                                                                  key={i}
                                                                  className={`flex-1 rounded-t ${isPositive ? 'bg-success/60' : 'bg-danger/60'}`}
                                                                  style={{ height: `${heightPct}%`, minHeight: bucket.count > 0 ? '2px' : '0' }}
                                                                  title={`${(bucket.min * 100).toFixed(1)}% to ${(bucket.max * 100).toFixed(1)}%: ${bucket.count} sims`}
                                                                />
                                                              )
                                                            })}
                                                          </div>
                                                        )
                                                      })()}
                                                      <div className="flex justify-between text-xs mt-0.5">
                                                        <span className="text-muted">{((sanityState.report.pathRisk.monteCarlo.cagrs.histogram?.[0]?.min ?? 0) * 100).toFixed(0)}%</span>
                                                        <span className="text-muted">{((sanityState.report.pathRisk.monteCarlo.cagrs.histogram?.[sanityState.report.pathRisk.monteCarlo.cagrs.histogram.length - 1]?.max ?? 0) * 100).toFixed(0)}%</span>
                                                      </div>
                                                    </div>

                                                    {/* MaxDD Distribution Bar Chart */}
                                                    <div>
                                                      <div className="text-xs text-muted mb-1 cursor-help text-center" title="Distribution of Max Drawdown values across 200 Monte Carlo simulations. Each bar represents a bucket of drawdown values.">Max Drawdown Distribution</div>
                                                      {(() => {
                                                        const histogram = sanityState.report.pathRisk.monteCarlo.drawdowns.histogram
                                                        if (!histogram || histogram.length === 0) return <div className="text-xs text-muted">No histogram data</div>
                                                        const maxCount = Math.max(...histogram.map((b: { count: number }) => b.count))
                                                        return (
                                                          <div className="flex items-end gap-px h-16">
                                                            {histogram.map((bucket: { midpoint: number; count: number; min: number; max: number }, i: number) => {
                                                              const heightPct = maxCount > 0 ? (bucket.count / maxCount) * 100 : 0
                                                              // Drawdowns are all negative, use gradient from danger to warning
                                                              const severity = Math.abs(bucket.midpoint)
                                                              const bgClass = severity > 0.4 ? 'bg-danger/80' : severity > 0.25 ? 'bg-danger/60' : 'bg-warning/60'
                                                              return (
                                                                <div
                                                                  key={i}
                                                                  className={`flex-1 rounded-t ${bgClass}`}
                                                                  style={{ height: `${heightPct}%`, minHeight: bucket.count > 0 ? '2px' : '0' }}
                                                                  title={`${(bucket.min * 100).toFixed(1)}% to ${(bucket.max * 100).toFixed(1)}%: ${bucket.count} sims`}
                                                                />
                                                              )
                                                            })}
                                                          </div>
                                                        )
                                                      })()}
                                                      <div className="flex justify-between text-xs mt-0.5">
                                                        <span className="text-muted">{((sanityState.report.pathRisk.monteCarlo.drawdowns.histogram?.[0]?.min ?? 0) * 100).toFixed(0)}%</span>
                                                        <span className="text-muted">{((sanityState.report.pathRisk.monteCarlo.drawdowns.histogram?.[sanityState.report.pathRisk.monteCarlo.drawdowns.histogram.length - 1]?.max ?? 0) * 100).toFixed(0)}%</span>
                                                      </div>
                                                    </div>
                                                  </div>

                                                  {/* Right Card: K-Fold */}
                                                  <div className="border border-border rounded-xl p-3 flex flex-col h-full">
                                                    <div className="text-xs font-bold mb-2 text-center">K-Fold (200 Folds)</div>

                                                    {/* KF Drawdown Distribution */}
                                                    <div className="mb-3">
                                                      <div className="text-xs text-muted mb-1 cursor-help text-center" title="Distribution of maximum drawdowns across 200 K-Fold subsets (90% of data each). Tests stability when portions of history are removed.">Max Drawdown Distribution</div>
                                                      {(() => {
                                                        const dd = sanityState.report.pathRisk.kfold.drawdowns
                                                        // Drawdowns are negative: p95 is worst (most negative), p5 is best (least negative)
                                                        // Scale: worst (p95) on left at 0%, best (p5) on right at 100%
                                                        const minVal = dd.p95 // Most negative = left side
                                                        const maxVal = dd.p5  // Least negative = right side
                                                        const range = maxVal - minVal || 0.01
                                                        const toPos = (v: number) => Math.max(0, Math.min(100, ((v - minVal) / range) * 100))
                                                        return (
                                                          <>
                                                            <div className="relative h-4 bg-muted/30 rounded overflow-hidden">
                                                              {/* P25-P75 range */}
                                                              <div
                                                                className="absolute h-full bg-danger/40"
                                                                style={{ left: `${toPos(dd.p75)}%`, width: `${Math.abs(toPos(dd.p25) - toPos(dd.p75))}%` }}
                                                              />
                                                              {/* P50 marker */}
                                                              <div
                                                                className="absolute h-full w-0.5 bg-danger"
                                                                style={{ left: `${toPos(dd.p50)}%` }}
                                                              />
                                                            </div>
                                                            <div className="flex justify-between text-xs mt-0.5">
                                                              <span className="text-danger">P95: {formatDDPct(dd.p5)}</span>
                                                              <span className="font-semibold">P50: {formatDDPct(dd.p50)}</span>
                                                              <span className="text-success">P5: {formatDDPct(dd.p95)}</span>
                                                            </div>
                                                          </>
                                                        )
                                                      })()}
                                                    </div>

                                                    {/* KF CAGR Distribution */}
                                                    <div>
                                                      <div className="text-xs text-muted mb-1 cursor-help text-center" title="Distribution of annualized returns across 200 K-Fold subsets. Tests how consistent CAGR is when portions of history are removed.">CAGR Distribution</div>
                                                      {(() => {
                                                        const cagr = sanityState.report.pathRisk.kfold.cagrs
                                                        const minVal = Math.min(cagr.p5, cagr.p95)
                                                        const maxVal = Math.max(cagr.p5, cagr.p95)
                                                        const range = maxVal - minVal || 1
                                                        const toPos = (v: number) => ((v - minVal) / range) * 100
                                                        return (
                                                          <>
                                                            <div className="relative h-4 bg-muted/30 rounded overflow-hidden">
                                                              {/* P25-P75 range */}
                                                              <div
                                                                className="absolute h-full bg-success/40"
                                                                style={{ left: `${toPos(cagr.p25)}%`, width: `${toPos(cagr.p75) - toPos(cagr.p25)}%` }}
                                                              />
                                                              {/* P50 marker */}
                                                              <div
                                                                className="absolute h-full w-0.5 bg-success"
                                                                style={{ left: `${toPos(cagr.p50)}%` }}
                                                              />
                                                            </div>
                                                            <div className="flex justify-between text-xs mt-0.5">
                                                              <span className="text-danger">P5: {formatDDPct(cagr.p5)}</span>
                                                              <span className="font-semibold">P50: {formatDDPct(cagr.p50)}</span>
                                                              <span className="text-success">P95: {formatDDPct(cagr.p95)}</span>
                                                            </div>
                                                          </>
                                                        )
                                                      })()}
                                                    </div>

                                                    {/* KF Sharpe Distribution */}
                                                    {sanityState.report.pathRisk.kfold.sharpes && (
                                                      <div className="mb-3">
                                                        <div className="text-xs text-muted mb-1 cursor-help text-center" title="Distribution of Sharpe ratios across K-Fold subsets. Higher is better.">Sharpe Distribution</div>
                                                        {(() => {
                                                          const sh = sanityState.report.pathRisk.kfold.sharpes
                                                          // Sharpe: higher is better, so P5 (worst) on left, P95 (best) on right
                                                          const minVal = sh.p5
                                                          const maxVal = sh.p95
                                                          const range = maxVal - minVal || 0.01
                                                          const toPos = (v: number) => Math.max(0, Math.min(100, ((v - minVal) / range) * 100))
                                                          const hasP25P75 = sh.p25 != null && sh.p75 != null
                                                          return (
                                                            <>
                                                              <div className="relative h-4 bg-muted/30 rounded overflow-hidden">
                                                                {/* P25-P75 range (green for good Sharpe) - only if we have p25/p75 */}
                                                                {hasP25P75 && <div className="absolute h-full bg-success/40" style={{ left: `${toPos(sh.p25)}%`, width: `${toPos(sh.p75) - toPos(sh.p25)}%` }} />}
                                                                <div className="absolute h-full w-0.5 bg-success" style={{ left: `${toPos(sh.p50)}%` }} />
                                                              </div>
                                                              <div className="flex justify-between text-xs mt-0.5">
                                                                <span className="text-danger">P5: {sh.p5?.toFixed(2) ?? '-'}</span>
                                                                <span className="font-semibold">P50: {sh.p50?.toFixed(2) ?? '-'}</span>
                                                                <span className="text-success">P95: {sh.p95?.toFixed(2) ?? '-'}</span>
                                                              </div>
                                                            </>
                                                          )
                                                        })()}
                                                      </div>
                                                    )}

                                                    {/* KF Volatility Distribution */}
                                                    {sanityState.report.pathRisk.kfold.volatilities && (
                                                      <div>
                                                        <div className="text-xs text-muted mb-1 cursor-help text-center" title="Distribution of annualized volatility across K-Fold subsets. Lower is generally better.">Volatility Distribution</div>
                                                        {(() => {
                                                          const vol = sanityState.report.pathRisk.kfold.volatilities
                                                          // Volatility: lower is better, so flip - P95 (worst/high vol) on left, P5 (best/low vol) on right
                                                          const minVal = vol.p95 // High vol = left side (bad)
                                                          const maxVal = vol.p5  // Low vol = right side (good)
                                                          const range = maxVal - minVal || 0.01
                                                          const toPos = (v: number) => Math.max(0, Math.min(100, ((v - minVal) / range) * 100))
                                                          const hasP25P75 = vol.p25 != null && vol.p75 != null
                                                          return (
                                                            <>
                                                              <div className="relative h-4 bg-muted/30 rounded overflow-hidden">
                                                                {/* P25-P75 range (red for volatility since it's bad) - only if we have p25/p75 */}
                                                                {hasP25P75 && <div className="absolute h-full bg-danger/40" style={{ left: `${toPos(vol.p75)}%`, width: `${toPos(vol.p25) - toPos(vol.p75)}%` }} />}
                                                                <div className="absolute h-full w-0.5 bg-danger" style={{ left: `${toPos(vol.p50)}%` }} />
                                                              </div>
                                                              <div className="flex justify-between text-xs mt-0.5">
                                                                <span className="text-danger">P95: {formatDDPct(vol.p95)}</span>
                                                                <span className="font-semibold">P50: {formatDDPct(vol.p50)}</span>
                                                                <span className="text-success">P5: {formatDDPct(vol.p5)}</span>
                                                              </div>
                                                            </>
                                                          )
                                                        })()}
                                                      </div>
                                                    )}
                                                  </div>
                                                </div>

                                              </>
                                            )}
                                          </>
                                        )
                                      })()}
                                    </div>
                                  )}
                                </div>
                              )}
                            </Card>
                          )
                        })}
                      </div>
                    )
                  })()}
                </Card>
              </div>
            )}
            </CardContent>
          </Card>
        ) : (
          <div className="placeholder" />
        )}

        {addToWatchlistBotId ? (
          <div
            className="fixed inset-0 bg-slate-900/35 grid place-items-center z-[200]"
            onClick={() => setAddToWatchlistBotId(null)}
          >
            <Card className="w-[420px]" onClick={(e) => e.stopPropagation()}>
              <CardContent className="p-3">
                <div className="font-black mb-2.5">Add to Watchlist</div>
                <div className="grid gap-2">
                  {watchlists.map((w) => (
                    <Button
                      key={w.id}
                      variant="secondary"
                      onClick={() => {
                        if (addToWatchlistBotId) handleConfirmAddToWatchlist(addToWatchlistBotId, w.id)
                      }}
                    >
                      {w.name}
                    </Button>
                  ))}
                  <div className="mt-1 pt-2.5 border-t border-border">
                    <div className="text-xs font-bold mb-1.5">Create new</div>
                    <Input
                      value={addToWatchlistNewName}
                      placeholder="Watchlist name…"
                      onChange={(e) => setAddToWatchlistNewName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          if (addToWatchlistBotId) handleConfirmAddToWatchlist(addToWatchlistBotId, addToWatchlistNewName)
                        }
                      }}
                    />
                    <div className="flex gap-2 mt-2">
                      <Button
                        className="flex-1"
                        onClick={() => {
                          if (addToWatchlistBotId) handleConfirmAddToWatchlist(addToWatchlistBotId, addToWatchlistNewName)
                        }}
                      >
                        Add
                      </Button>
                      <Button variant="secondary" className="flex-1" onClick={() => setAddToWatchlistBotId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                </div>
            </CardContent>
          </Card>
          </div>
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
