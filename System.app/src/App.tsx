import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from 'react'
import { createPortal } from 'react-dom'
import './App.css'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { LoginScreen } from '@/components/LoginScreen'
import { cn } from '@/lib/utils'
import {
  AreaSeries,
  ColorType,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  createChart,
  createSeriesMarkers,
  type AutoscaleInfo,
  type BusinessDay,
  type IChartApi,
  type IPriceLine,
  type IRange,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineData,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
  type TimeRangeChangeEventHandler,
  type UTCTimestamp,
} from 'lightweight-charts'

type BlockKind = 'basic' | 'function' | 'indicator' | 'numbered' | 'position' | 'call' | 'altExit' | 'scaling'
type SlotId = 'next' | 'then' | 'else' | `ladder-${number}`
type PositionChoice = string
type MetricChoice =
  // Price
  | 'Current Price'
  // Moving Averages
  | 'Simple Moving Average'
  | 'Exponential Moving Average'
  | 'Hull Moving Average'
  | 'Weighted Moving Average'
  | 'Wilder Moving Average'
  | 'DEMA'
  | 'TEMA'
  | 'KAMA'
  // RSI & Variants
  | 'Relative Strength Index'
  | 'RSI (SMA)'
  | 'RSI (EMA)'
  | 'Stochastic RSI'
  | 'Laguerre RSI'
  // Momentum indicators
  | 'Momentum (Weighted)'      // 13612W: 1/3/6/12 month weighted
  | 'Momentum (Unweighted)'    // 13612U: 1/3/6/12 month unweighted
  | 'Momentum (12-Month SMA)'  // SMA12: 12-month SMA based
  | 'Rate of Change'
  | 'Williams %R'
  | 'CCI'
  | 'Stochastic %K'
  | 'Stochastic %D'
  | 'ADX'
  // Volatility
  | 'Max Drawdown'
  | 'Standard Deviation'
  | 'Standard Deviation of Price'
  | 'Drawdown'                 // Current drawdown from ATH (no window)
  | 'Bollinger %B'
  | 'Bollinger Bandwidth'
  | 'ATR'
  | 'ATR %'
  | 'Historical Volatility'
  | 'Ulcer Index'
  // Trend
  | 'Cumulative Return'
  | 'SMA of Returns'
  | 'Ultimate Smoother'        // Ehlers filter
  | 'Trend Clarity'            // R² of linear regression
  | 'Linear Reg Slope'
  | 'Linear Reg Value'
  | 'Price vs SMA'
  // Aroon
  | 'Aroon Up'                 // Days since high
  | 'Aroon Down'               // Days since low
  | 'Aroon Oscillator'         // Up - Down
  // MACD/PPO
  | 'MACD Histogram'           // Fixed 12/26/9
  | 'PPO Histogram'            // Percentage version of MACD
  // Volume-based indicators
  | 'Money Flow Index'         // Volume-weighted RSI (0-100)
  | 'OBV Rate of Change'       // Momentum of On-Balance Volume
  | 'VWAP Ratio'               // Price vs VWAP (100 = at VWAP)
type RankChoice = 'Bottom' | 'Top'
type ComparatorChoice = 'lt' | 'gt'

// Indicators that don't require a window input (fixed lookback or uses all history)
const WINDOWLESS_INDICATORS: MetricChoice[] = [
  'Current Price',
  'Momentum (Weighted)',      // Fixed 1/3/6/12 month
  'Momentum (Unweighted)',    // Fixed 1/3/6/12 month
  'Momentum (12-Month SMA)',  // Fixed 12 month
  'Drawdown',                 // Uses all history from ATH
  'MACD Histogram',           // Fixed 12/26/9
  'PPO Histogram',            // Fixed 12/26/9
  'Laguerre RSI',             // Uses gamma instead of window
]
const isWindowlessIndicator = (metric: MetricChoice): boolean => WINDOWLESS_INDICATORS.includes(metric)

// Get the actual lookback period needed for an indicator (for warm-up calculations)
const getIndicatorLookback = (metric: MetricChoice, window: number): number => {
  switch (metric) {
    case 'Current Price':
      return 0
    case 'Momentum (Weighted)':
    case 'Momentum (Unweighted)':
      return 252 // 12 months of trading days
    case 'Momentum (12-Month SMA)':
      return 252 // 12 months
    case 'Drawdown':
      return 0 // Uses all history, no fixed lookback needed for warm-up
    case 'MACD Histogram':
    case 'PPO Histogram':
      return 35 // 26 + 9 for signal line
    case 'Laguerre RSI':
      return 10 // Minimal lookback, uses recursive filter
    case 'DEMA':
      return Math.max(1, Math.floor(window || 0)) * 2
    case 'TEMA':
      return Math.max(1, Math.floor(window || 0)) * 3
    case 'KAMA':
      return Math.max(1, Math.floor(window || 0)) + 30 // window + slow period
    case 'ADX':
      return Math.max(1, Math.floor(window || 0)) * 2 // Extra for smoothing
    default:
      return Math.max(1, Math.floor(window || 0))
  }
}

type WeightMode = 'equal' | 'defined' | 'inverse' | 'pro' | 'capped'

// Indicator metadata with descriptions and formulas
const INDICATOR_INFO: Record<MetricChoice, { desc: string; formula: string }> = {
  // Price
  'Current Price': { desc: 'The current closing price of the asset', formula: 'Price = Close' },

  // Moving Averages
  'Simple Moving Average': { desc: 'Average price over N periods, equal weight to all', formula: 'SMA = Σ(Close) / N' },
  'Exponential Moving Average': { desc: 'Weighted average giving more weight to recent prices', formula: 'EMA = α×Close + (1-α)×EMA_prev, α=2/(N+1)' },
  'Hull Moving Average': { desc: 'Reduced lag MA using weighted MAs', formula: 'HMA = WMA(2×WMA(N/2) - WMA(N), √N)' },
  'Weighted Moving Average': { desc: 'Linear weighted average, recent prices weighted more', formula: 'WMA = Σ(i×Close_i) / Σ(i), i=1..N' },
  'Wilder Moving Average': { desc: 'Smoothed MA used in RSI, slower response', formula: 'WilderMA = (Prev×(N-1) + Close) / N' },
  'DEMA': { desc: 'Double EMA reduces lag vs single EMA', formula: 'DEMA = 2×EMA - EMA(EMA)' },
  'TEMA': { desc: 'Triple EMA for even less lag', formula: 'TEMA = 3×EMA - 3×EMA² + EMA³' },
  'KAMA': { desc: 'Adapts smoothing based on market noise', formula: 'KAMA = KAMA_prev + SC²×(Close - KAMA_prev)' },

  // RSI & Variants
  'Relative Strength Index': { desc: "Wilder's RSI, momentum oscillator 0-100", formula: 'RSI = 100 - 100/(1 + AvgGain/AvgLoss)' },
  'RSI (SMA)': { desc: 'RSI using simple moving average smoothing', formula: 'RSI_SMA = 100 - 100/(1 + SMA(Gains)/SMA(Losses))' },
  'RSI (EMA)': { desc: 'RSI using exponential moving average smoothing', formula: 'RSI_EMA = 100 - 100/(1 + EMA(Gains)/EMA(Losses))' },
  'Stochastic RSI': { desc: 'Stochastic applied to RSI values, more sensitive', formula: 'StochRSI = (RSI - RSI_Low) / (RSI_High - RSI_Low)' },
  'Laguerre RSI': { desc: "Ehlers' Laguerre filter RSI, smoother", formula: 'Uses 4-element Laguerre filter with gamma' },

  // Momentum
  'Momentum (Weighted)': { desc: '13612W weighted momentum score', formula: '12×M1 + 4×M3 + 2×M6 + M12 (1/3/6/12 month returns)' },
  'Momentum (Unweighted)': { desc: '13612U unweighted momentum score', formula: 'M1 + M3 + M6 + M12 (equal weight)' },
  'Momentum (12-Month SMA)': { desc: 'SMA of 12-month returns', formula: 'SMA(12-month return, N)' },
  'Rate of Change': { desc: 'Percent change over N periods', formula: 'ROC = (Close - Close_N) / Close_N × 100' },
  'Williams %R': { desc: 'Momentum indicator, inverse of Fast Stochastic', formula: '%R = (High_N - Close) / (High_N - Low_N) × -100' },
  'CCI': { desc: 'Measures price deviation from average', formula: 'CCI = (TP - SMA(TP)) / (0.015 × MeanDev)' },
  'Stochastic %K': { desc: 'Fast Stochastic, price position in range', formula: '%K = (Close - Low_N) / (High_N - Low_N) × 100' },
  'Stochastic %D': { desc: 'Slow Stochastic, SMA of %K', formula: '%D = SMA(%K, 3)' },
  'ADX': { desc: 'Trend strength indicator 0-100', formula: 'ADX = SMA(|+DI - -DI| / (+DI + -DI) × 100)' },

  // Volatility
  'Standard Deviation': { desc: 'Volatility of returns over N periods', formula: 'StdDev = √(Σ(r - r̄)² / N)' },
  'Standard Deviation of Price': { desc: 'Volatility of price levels', formula: 'StdDev = √(Σ(P - P̄)² / N)' },
  'Max Drawdown': { desc: 'Largest peak-to-trough decline over N periods', formula: 'MaxDD = max((Peak - Trough) / Peak)' },
  'Drawdown': { desc: 'Current decline from recent peak', formula: 'DD = (Peak - Current) / Peak' },
  'Bollinger %B': { desc: 'Position within Bollinger Bands (0-1)', formula: '%B = (Close - LowerBand) / (UpperBand - LowerBand)' },
  'Bollinger Bandwidth': { desc: 'Width of Bollinger Bands as % of middle', formula: 'BW = (Upper - Lower) / Middle × 100' },
  'ATR': { desc: 'Average True Range, volatility measure', formula: 'ATR = SMA(max(H-L, |H-C_prev|, |L-C_prev|))' },
  'ATR %': { desc: 'ATR as percentage of price', formula: 'ATR% = ATR / Close × 100' },
  'Historical Volatility': { desc: 'Annualized standard deviation of returns', formula: 'HV = StdDev(returns) × √252' },
  'Ulcer Index': { desc: 'Measures downside volatility/drawdown pain', formula: 'UI = √(Σ(DD²) / N)' },

  // Trend
  'Cumulative Return': { desc: 'Total return over N periods', formula: 'CumRet = (Close / Close_N) - 1' },
  'SMA of Returns': { desc: 'Smoothed average of daily returns', formula: 'SMA(daily returns, N)' },
  'Trend Clarity': { desc: 'R² of price regression, trend strength', formula: 'R² = 1 - (SS_res / SS_tot)' },
  'Ultimate Smoother': { desc: "Ehlers' low-lag smoother", formula: '3-pole Butterworth filter' },
  'Linear Reg Slope': { desc: 'Slope of best-fit line through prices', formula: 'Slope = Σ((x-x̄)(y-ȳ)) / Σ(x-x̄)²' },
  'Linear Reg Value': { desc: 'Current value on regression line', formula: 'Value = Intercept + Slope × N' },
  'Price vs SMA': { desc: 'Ratio of price to its moving average', formula: 'Ratio = Close / SMA(Close, N)' },

  // Aroon
  'Aroon Up': { desc: 'Days since highest high (0-100)', formula: 'AroonUp = ((N - DaysSinceHigh) / N) × 100' },
  'Aroon Down': { desc: 'Days since lowest low (0-100)', formula: 'AroonDown = ((N - DaysSinceLow) / N) × 100' },
  'Aroon Oscillator': { desc: 'Difference between Aroon Up and Down', formula: 'AroonOsc = AroonUp - AroonDown' },

  // MACD/PPO
  'MACD Histogram': { desc: 'MACD minus signal line', formula: 'Hist = (EMA12 - EMA26) - EMA9(EMA12 - EMA26)' },
  'PPO Histogram': { desc: 'Percentage Price Oscillator histogram', formula: 'PPO = ((EMA12 - EMA26) / EMA26) × 100' },

  // Volume-based
  'Money Flow Index': { desc: 'Volume-weighted RSI, measures buying/selling pressure', formula: 'MFI = 100 - 100/(1 + PosMF/NegMF)' },
  'OBV Rate of Change': { desc: 'Momentum of cumulative On-Balance Volume', formula: 'OBV ROC = (OBV - OBV_N) / |OBV_N| × 100' },
  'VWAP Ratio': { desc: 'Price vs Volume-Weighted Avg Price (100 = at VWAP)', formula: 'Ratio = Close / VWAP × 100' },
}

// Indicator categories for submenu dropdown
const INDICATOR_CATEGORIES: Record<string, MetricChoice[]> = {
  'Price': ['Current Price'],
  'Moving Averages': [
    'Simple Moving Average',
    'Exponential Moving Average',
    'Hull Moving Average',
    'Weighted Moving Average',
    'Wilder Moving Average',
    'DEMA',
    'TEMA',
    'KAMA',
  ],
  'RSI & Variants': [
    'Relative Strength Index',
    'RSI (SMA)',
    'RSI (EMA)',
    'Stochastic RSI',
    'Laguerre RSI',
  ],
  'Momentum': [
    'Momentum (Weighted)',
    'Momentum (Unweighted)',
    'Momentum (12-Month SMA)',
    'Rate of Change',
    'Williams %R',
    'CCI',
    'Stochastic %K',
    'Stochastic %D',
    'ADX',
  ],
  'Volatility': [
    'Standard Deviation',
    'Standard Deviation of Price',
    'Max Drawdown',
    'Drawdown',
    'Bollinger %B',
    'Bollinger Bandwidth',
    'ATR',
    'ATR %',
    'Historical Volatility',
    'Ulcer Index',
  ],
  'Trend': [
    'Cumulative Return',
    'SMA of Returns',
    'Trend Clarity',
    'Ultimate Smoother',
    'Linear Reg Slope',
    'Linear Reg Value',
    'Price vs SMA',
  ],
  'Aroon': [
    'Aroon Up',
    'Aroon Down',
    'Aroon Oscillator',
  ],
  'MACD/PPO': [
    'MACD Histogram',
    'PPO Histogram',
  ],
  'Volume': [
    'Money Flow Index',
    'OBV Rate of Change',
    'VWAP Ratio',
  ],
}

type UserId = string
type ThemeMode = 'light' | 'dark'
type ColorTheme = 'slate' | 'ocean' | 'emerald' | 'violet' | 'rose' | 'amber' | 'cyan' | 'indigo' | 'lime' | 'fuchsia'

const COLOR_THEMES: { id: ColorTheme; name: string; accent: string }[] = [
  { id: 'slate', name: 'Slate', accent: '#3b82f6' },
  { id: 'ocean', name: 'Ocean', accent: '#0ea5e9' },
  { id: 'emerald', name: 'Emerald', accent: '#10b981' },
  { id: 'violet', name: 'Violet', accent: '#8b5cf6' },
  { id: 'rose', name: 'Rose', accent: '#f43f5e' },
  { id: 'amber', name: 'Amber', accent: '#f59e0b' },
  { id: 'cyan', name: 'Cyan', accent: '#06b6d4' },
  { id: 'indigo', name: 'Indigo', accent: '#6366f1' },
  { id: 'lime', name: 'Lime', accent: '#84cc16' },
  { id: 'fuchsia', name: 'Fuchsia', accent: '#d946ef' },
]

type ConditionLine = {
  id: string
  type: 'if' | 'and' | 'or'
  window: number
  metric: MetricChoice
  comparator: ComparatorChoice
  ticker: PositionChoice
  threshold: number
  expanded?: boolean
  rightWindow?: number
  rightMetric?: MetricChoice
  rightTicker?: PositionChoice
  forDays?: number // Condition must be true for N consecutive days (default: 1)
}

// Find/Replace ticker instance tracking
type TickerInstance = {
  nodeId: string
  field: 'position' | 'condition' | 'rightCondition' | 'scaleTicker' | 'cappedFallback' | 'entry' | 'exit'
  index?: number      // For arrays (positions, conditions)
  itemId?: string     // For numbered items
  callChainId?: string // If found in a call chain
}

// Indicator overlay data from server
type IndicatorOverlayData = {
  conditionId: string
  label: string
  leftSeries: Array<{ date: string; value: number | null }>
  rightSeries?: Array<{ date: string; value: number | null }> | null
  rightLabel?: string | null
  threshold?: number | null
  comparator?: string
  color: string
}

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

const normalizeComparatorChoice = (value: unknown): ComparatorChoice => {
  if (value === 'gt' || value === 'lt') return value
  const s = String(value || '').trim().toLowerCase()
  if (!s) return 'lt'
  if (s === 'greater than' || s === 'greater' || s === 'gt') return 'gt'
  if (s === 'less than' || s === 'less' || s === 'lt') return 'lt'
  if (s.includes('greater')) return 'gt'
  if (s.includes('less')) return 'lt'
  return 'lt'
}

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

type NumberedQuantifier = 'any' | 'all' | 'none' | 'exactly' | 'atLeast' | 'atMost' | 'ladder'

type NumberedItem = {
  id: string
  conditions: ConditionLine[]
  groupLogic?: 'and' | 'or'  // How conditions within this item combine (for AnyOf/AllOf imports)
}

// Dashboard types
type DashboardTimePeriod = '1D' | '1W' | '1M' | '3M' | '6M' | 'YTD' | '1Y' | 'ALL'

type EquityCurvePoint = {
  time: UTCTimestamp
  value: number
}

const TICKER_DATALIST_ID = 'systemapp-tickers'
const USED_TICKERS_DATALIST_ID = 'findreplace-used-tickers'

const CURRENT_USER_KEY = 'systemapp.currentUser'
const userDataKey = (userId: UserId) => `systemapp.user.${userId}.data.v1`

const loadDeviceThemeMode = (): ThemeMode => {
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

// ============================================================================
// Database API Helpers (for cross-user Nexus bots and scalable persistence)
// ============================================================================
const API_BASE = '/api'

// API type for Nexus bots (no payload for IP protection)
type NexusBotFromApi = {
  id: string
  ownerId: string
  name: string
  visibility: string
  tags: string | null
  fundSlot: number | null
  createdAt: string
  owner?: { id: string; displayName: string } | null
  metrics?: {
    cagr?: number
    maxDrawdown?: number
    calmarRatio?: number
    sharpeRatio?: number
    sortinoRatio?: number
  } | null
}

// Fetch all Nexus bots from the database (cross-user, no payload)
const fetchNexusBotsFromApi = async (): Promise<SavedBot[]> => {
  try {
    const res = await fetch(`${API_BASE}/nexus/bots`)
    if (!res.ok) return []
    const { bots } = await res.json() as { bots: NexusBotFromApi[] }
    return bots.map((bot) => ({
      id: bot.id,
      name: bot.name,
      builderId: bot.ownerId as UserId,
      payload: null as unknown as FlowNode, // IP protection: no payload
      visibility: 'community' as BotVisibility,
      tags: bot.tags ? JSON.parse(bot.tags) : undefined,
      createdAt: new Date(bot.createdAt).getTime(),
      fundSlot: bot.fundSlot,
      backtestResult: bot.metrics ? {
        cagr: bot.metrics.cagr ?? 0,
        maxDrawdown: bot.metrics.maxDrawdown ?? 0,
        calmar: bot.metrics.calmarRatio ?? 0,
        sharpe: bot.metrics.sharpeRatio ?? 0,
        sortino: bot.metrics.sortinoRatio ?? 0,
      } : undefined,
    })) as SavedBot[]
  } catch (err) {
    console.warn('[API] Failed to fetch Nexus bots:', err)
    return []
  }
}

// Load all bots for a user from the database
const loadBotsFromApi = async (userId: UserId): Promise<SavedBot[]> => {
  try {
    const res = await fetch(`${API_BASE}/bots?userId=${userId}`)
    if (!res.ok) return []
    const { bots } = await res.json() as { bots: Array<{
      id: string
      ownerId: string
      name: string
      payload: string
      visibility: string
      tags: string | null
      fundSlot: number | null
      backtestMode: string | null
      backtestCostBps: number | null
      createdAt: string
      metrics?: {
        cagr?: number
        maxDrawdown?: number
        calmarRatio?: number
        sharpeRatio?: number
        sortinoRatio?: number
        treynorRatio?: number
        beta?: number
        volatility?: number
        winRate?: number
        avgTurnover?: number
        avgHoldings?: number
      } | null
    }> }
    return bots.map((bot) => {
      const rawPayload = bot.payload ? JSON.parse(bot.payload) as FlowNode : {
        id: `node-${Date.now()}`,
        kind: 'basic' as const,
        title: 'Basic',
        children: { next: [null] },
        weighting: 'equal' as const,
        collapsed: false,
      }
      // Use single-pass normalization for better performance
      const payload = normalizeForImport(rawPayload)
      return {
        id: bot.id,
        name: bot.name,
        builderId: bot.ownerId as UserId,
        payload,
        visibility: (bot.visibility === 'nexus' || bot.visibility === 'nexus_eligible' ? 'community' : 'private') as BotVisibility,
        tags: bot.tags ? JSON.parse(bot.tags) : undefined,
        createdAt: new Date(bot.createdAt).getTime(),
        fundSlot: bot.fundSlot ?? undefined,
        backtestMode: (bot.backtestMode as BacktestMode) || 'CC',
        backtestCostBps: bot.backtestCostBps ?? 5,
        backtestResult: bot.metrics ? {
          cagr: bot.metrics.cagr ?? 0,
          maxDrawdown: bot.metrics.maxDrawdown ?? 0,
          calmar: bot.metrics.calmarRatio ?? 0,
          sharpe: bot.metrics.sharpeRatio ?? 0,
          sortino: bot.metrics.sortinoRatio ?? 0,
          treynor: bot.metrics.treynorRatio ?? 0,
          beta: bot.metrics.beta ?? 0,
          volatility: bot.metrics.volatility ?? 0,
          winRate: bot.metrics.winRate ?? 0,
          avgTurnover: bot.metrics.avgTurnover ?? 0,
          avgHoldings: bot.metrics.avgHoldings ?? 0,
        } : undefined,
      } as SavedBot
    })
  } catch (err) {
    console.warn('[API] Failed to load bots from API:', err)
    return []
  }
}

// Save a new bot to the database
const createBotInApi = async (userId: UserId, bot: SavedBot): Promise<string | null> => {
  try {
    const payload = JSON.stringify(bot.payload)
    const tags = bot.tags || []
    const visibility = bot.tags?.includes('Nexus') ? 'nexus' : bot.tags?.includes('Nexus Eligible') ? 'nexus_eligible' : 'private'

    const res = await fetch(`${API_BASE}/bots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: bot.id,
        ownerId: userId,
        name: bot.name,
        payload,
        visibility,
        tags,
        fundSlot: bot.fundSlot,
        backtestMode: bot.backtestMode || 'CC',
        backtestCostBps: bot.backtestCostBps ?? 5,
      }),
    })
    if (!res.ok) return null
    const { id } = await res.json() as { id: string }
    return id
  } catch (err) {
    console.warn('[API] Failed to create bot:', err)
    return null
  }
}

// Update an existing bot in the database
const updateBotInApi = async (userId: UserId, bot: SavedBot): Promise<boolean> => {
  try {
    const payload = JSON.stringify(bot.payload)
    const tags = bot.tags || []
    const visibility = bot.tags?.includes('Nexus') ? 'nexus' : bot.tags?.includes('Nexus Eligible') ? 'nexus_eligible' : 'private'

    const res = await fetch(`${API_BASE}/bots/${bot.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerId: userId,
        name: bot.name,
        payload,
        visibility,
        tags,
        fundSlot: bot.fundSlot,
        backtestMode: bot.backtestMode,
        backtestCostBps: bot.backtestCostBps,
      }),
    })
    return res.ok
  } catch (err) {
    console.warn('[API] Failed to update bot:', err)
    return false
  }
}

// Delete a bot from the database
const deleteBotFromApi = async (userId: UserId, botId: string): Promise<boolean> => {
  try {
    const res = await fetch(`${API_BASE}/bots/${botId}?ownerId=${userId}`, {
      method: 'DELETE',
    })
    return res.ok
  } catch (err) {
    console.warn('[API] Failed to delete bot:', err)
    return false
  }
}

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

// Create a new call chain in the database
const createCallChainInApi = async (userId: UserId, callChain: CallChain): Promise<string | null> => {
  try {
    const res = await fetch(`${API_BASE}/call-chains`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        name: callChain.name,
        root: JSON.stringify(callChain.root),
      }),
    })
    if (!res.ok) return null
    const { callChain: created } = await res.json() as { callChain: { id: string } }
    return created.id
  } catch (err) {
    console.warn('[API] Failed to create call chain:', err)
    return null
  }
}

// Update a call chain in the database
const updateCallChainInApi = async (userId: UserId, callChain: CallChain): Promise<boolean> => {
  try {
    const res = await fetch(`${API_BASE}/call-chains/${callChain.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        name: callChain.name,
        root: JSON.stringify(callChain.root),
        collapsed: callChain.collapsed,
      }),
    })
    return res.ok
  } catch (err) {
    console.warn('[API] Failed to update call chain:', err)
    return false
  }
}

// Delete a call chain from the database
const deleteCallChainInApi = async (userId: UserId, callChainId: string): Promise<boolean> => {
  try {
    const res = await fetch(`${API_BASE}/call-chains/${callChainId}?userId=${userId}`, {
      method: 'DELETE',
    })
    return res.ok
  } catch (err) {
    console.warn('[API] Failed to delete call chain:', err)
    return false
  }
}

// ============================================================================

// Update bot metrics in the database after backtest
const syncBotMetricsToApi = async (botId: string, metrics: {
  cagr?: number
  maxDrawdown?: number
  calmarRatio?: number
  sharpeRatio?: number
  sortinoRatio?: number
  treynorRatio?: number
  volatility?: number
  winRate?: number
  avgTurnover?: number
  avgHoldings?: number
  tradingDays?: number
}): Promise<boolean> => {
  try {
    await fetch(`${API_BASE}/bots/${botId}/metrics`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metrics),
    })
    return true
  } catch (err) {
    console.warn('[API] Failed to sync metrics:', err)
    return false
  }
}

// ============================================================================

const loadInitialThemeMode = (): ThemeMode => {
  // Theme now comes from user preferences (database), so just use device preference as default
  return loadDeviceThemeMode()
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

// ============================================
// INDICATOR DROPDOWN WITH SUBMENUS
// ============================================

// Info tooltip component for indicators - uses fixed positioning to escape overflow containers
function IndicatorTooltip({ indicator }: { indicator: MetricChoice }) {
  const [show, setShow] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const triggerRef = useRef<HTMLSpanElement>(null)
  const info = INDICATOR_INFO[indicator]

  const handleMouseEnter = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPos({ x: rect.right + 8, y: rect.top + rect.height / 2 })
    }
    setShow(true)
  }

  return (
    <div
      className="inline-flex items-center"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setShow(false)}
    >
      <span
        ref={triggerRef}
        className="w-3.5 h-3.5 rounded-full border border-muted-foreground/50 text-muted-foreground text-[9px] flex items-center justify-center cursor-help hover:border-foreground hover:text-foreground"
      >
        ?
      </span>
      {show && info && (
        <div
          className="fixed z-[9999] bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-md shadow-xl p-2.5 min-w-[240px] max-w-[300px]"
          style={{ left: pos.x, top: pos.y, transform: 'translateY(-50%)' }}
        >
          <div className="text-xs font-semibold mb-1.5 text-zinc-900 dark:text-zinc-100">{indicator}</div>
          <div className="text-[11px] text-zinc-600 dark:text-zinc-400 mb-2 leading-relaxed">{info.desc}</div>
          <div className="text-[10px] font-mono bg-zinc-100 dark:bg-zinc-800 px-2 py-1.5 rounded text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700">{info.formula}</div>
        </div>
      )}
    </div>
  )
}

function IndicatorDropdown({
  value,
  onChange,
  className,
}: {
  value: MetricChoice
  onChange: (metric: MetricChoice) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [hoveredCategory, setHoveredCategory] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open])

  // Find which category the current value belongs to
  const findCategoryForValue = (v: MetricChoice): string => {
    for (const [cat, indicators] of Object.entries(INDICATOR_CATEGORIES)) {
      if (indicators.includes(v)) return cat
    }
    return 'Moving Averages'
  }

  return (
    <div ref={dropdownRef} className={cn('relative inline-block', className)}>
      <button
        type="button"
        className="h-8 px-2 text-xs border border-border rounded bg-card text-left flex items-center gap-1 hover:bg-accent/50 min-w-[140px]"
        onClick={() => setOpen(!open)}
      >
        <span className="truncate flex-1">{value}</span>
        <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-[200] mt-1 bg-card border border-border rounded shadow-lg min-w-[160px] left-0">
          {Object.entries(INDICATOR_CATEGORIES).map(([category, indicators]) => (
            <div
              key={category}
              className="relative"
              onMouseEnter={() => setHoveredCategory(category)}
              onMouseLeave={() => setHoveredCategory(null)}
            >
              <div
                className={cn(
                  'px-3 py-1.5 text-xs cursor-pointer flex justify-between items-center',
                  hoveredCategory === category ? 'bg-accent' : 'hover:bg-accent/50',
                  findCategoryForValue(value) === category && 'font-medium'
                )}
              >
                <span>{category}</span>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>

              {hoveredCategory === category && (
                <div className="absolute left-full top-0 z-[201] bg-card border border-border rounded shadow-lg min-w-[200px] max-h-[300px] overflow-y-auto">
                  {indicators.map((ind) => (
                    <div
                      key={ind}
                      className={cn(
                        'px-3 py-1.5 text-xs cursor-pointer flex items-center justify-between gap-2',
                        ind === value ? 'bg-accent font-medium' : 'hover:bg-accent/50'
                      )}
                      onClick={() => {
                        onChange(ind)
                        setOpen(false)
                      }}
                    >
                      <span className="truncate">{ind}</span>
                      <IndicatorTooltip indicator={ind} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TickerDatalist({ id, options }: { id: string; options: string[] }) {
  return (
    <datalist id={id}>
      {options.map((t) => (
        <option key={t} value={t} />
      ))}
    </datalist>
  )
}

/**
 * FlowchartScrollWrapper - Wrapper with fixed horizontal scrollbar at viewport bottom
 * The scrollbar floats at the bottom of the screen when the flowchart is visible
 */
function FlowchartScrollWrapper({
  children,
  className
}: {
  children: React.ReactNode
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const scrollbarRef = useRef<HTMLDivElement>(null)
  const [contentWidth, setContentWidth] = useState(0)
  const [containerWidth, setContainerWidth] = useState(0)
  const [containerRect, setContainerRect] = useState<{ left: number; right: number; top: number; bottom: number } | null>(null)
  const [isVisible, setIsVisible] = useState(false)

  // Update content width and container position
  useEffect(() => {
    const content = contentRef.current
    const container = containerRef.current
    if (!content || !container) return

    const updateDimensions = () => {
      setContentWidth(content.scrollWidth)
      setContainerWidth(content.clientWidth)
      const rect = container.getBoundingClientRect()
      setContainerRect({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })
      // Scrollbar visible if container is on screen and content is wider
      const onScreen = rect.top < window.innerHeight && rect.bottom > 0
      setIsVisible(onScreen && content.scrollWidth > content.clientWidth)
    }

    updateDimensions()

    // Track resize
    const resizeObserver = new ResizeObserver(updateDimensions)
    resizeObserver.observe(content)
    resizeObserver.observe(container)

    // Track scroll to update visibility
    const handleScroll = () => updateDimensions()
    window.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', handleScroll, { passive: true })

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleScroll)
    }
  }, [children])

  // Sync scrollbar scroll to content
  const handleScrollbarScroll = () => {
    if (contentRef.current && scrollbarRef.current) {
      contentRef.current.scrollLeft = scrollbarRef.current.scrollLeft
    }
  }

  // Sync content scroll to scrollbar
  const handleContentScroll = () => {
    if (contentRef.current && scrollbarRef.current) {
      scrollbarRef.current.scrollLeft = contentRef.current.scrollLeft
    }
  }

  const needsScroll = contentWidth > containerWidth

  return (
    <div ref={containerRef} className={className} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Scrollable content area */}
      <div
        ref={contentRef}
        onScroll={handleContentScroll}
        style={{
          flex: 1,
          overflowX: 'auto',
          overflowY: 'visible',
          // Hide scrollbar on content, we use custom one
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
        className="[&::-webkit-scrollbar]:hidden"
      >
        <div style={{ minWidth: 'max-content' }}>
          {children}
        </div>
      </div>

      {/* Fixed scrollbar at bottom of viewport - positioned to match container width */}
      {needsScroll && isVisible && containerRect && (
        <div
          ref={scrollbarRef}
          onScroll={handleScrollbarScroll}
          className="flowchart-scrollbar-fixed"
          style={{
            position: 'fixed',
            bottom: 0,
            left: containerRect.left,
            width: containerRect.right - containerRect.left,
            zIndex: 100,
          }}
        >
          <div
            className="flowchart-scrollbar-inner"
            style={{ width: contentWidth }}
          />
        </div>
      )}
    </div>
  )
}


type BotBacktestState = {
  status: 'idle' | 'running' | 'done' | 'error'
  errors: BacktestError[]
  result: BacktestResult | null
  focusNodeId: string | null
}

type BotSession = {
  id: string
  history: FlowNode[]
  historyIndex: number
  savedBotId?: string
  backtest: BotBacktestState
}

type AdminStatus = {
  root: string
  tickersPath: string
  parquetDir: string
  tickersExists: boolean
  parquetDirExists: boolean
  parquetFileCount: number
}

type AdminCandlesResponse = {
  ticker: string
  candles: Array<{ time: number; open: number; high: number; low: number; close: number }>
  preview: Array<{ Date: string; Open: number; High: number; Low: number; Close: number }>
}

type SystemVisibility = 'private' | 'community'
type BotVisibility = SystemVisibility // Backwards compat alias

type SavedSystem = {
  id: string
  name: string
  builderId: UserId
  payload: FlowNode
  visibility: BotVisibility
  createdAt: number
  tags?: string[] // e.g., ['Atlas', 'Nexus']
  fundSlot?: 1 | 2 | 3 | 4 | 5 | null // Which fund slot this system is in (for Nexus systems)
  backtestMode?: BacktestMode // Official backtest mode for this system (default: 'CC')
  backtestCostBps?: number // Official transaction cost in bps for this system (default: 5)
  backtestResult?: { // Cached metrics from API for cross-user Nexus systems
    cagr: number
    maxDrawdown: number
    calmar: number
    sharpe: number
    sortino: number
    treynor: number
    beta: number
    volatility: number
    winRate: number
    avgTurnover: number
    avgHoldings: number
  }
}
type SavedBot = SavedSystem // Backwards compat alias

type Watchlist = {
  id: string
  name: string
  botIds: string[]
  isDefault?: boolean
}

// Dashboard investment types
type DashboardInvestment = {
  botId: string
  botName: string
  buyDate: number // timestamp when purchased
  costBasis: number // amount invested (dollars)
}

type DashboardPortfolio = {
  cash: number // remaining uninvested cash (starts at $100,000)
  investments: DashboardInvestment[]
}

// Type for database portfolio position (from API)
type DbPosition = {
  botId: string
  costBasis: number
  shares: number
  entryDate: string
  bot?: { name: string }
}

// Admin types for Atlas Overview
type EligibilityMetric = 'cagr' | 'maxDrawdown' | 'calmar' | 'sharpe' | 'sortino' | 'treynor' | 'beta' | 'vol' | 'winRate' | 'avgTurnover' | 'avgHoldings'

type EligibilityRequirement = {
  id: string
  type: 'live_months' | 'metric' | 'etfs_only'
  metric?: EligibilityMetric
  comparison?: 'at_least' | 'at_most'
  value: number
}

// Labels for eligibility metrics (used in both AdminPanel and Partner Program)
const METRIC_LABELS: Record<EligibilityMetric, string> = {
  cagr: 'CAGR',
  maxDrawdown: 'Max Drawdown',
  calmar: 'Calmar Ratio',
  sharpe: 'Sharpe Ratio',
  sortino: 'Sortino Ratio',
  treynor: 'Treynor Ratio',
  beta: 'Beta',
  vol: 'Volatility',
  winRate: 'Win Rate',
  avgTurnover: 'Avg Turnover',
  avgHoldings: 'Avg Holdings'
}

type AdminConfig = {
  atlasFeePercent: number
  partnerProgramSharePercent: number
  eligibilityRequirements: EligibilityRequirement[]
  atlasFundSlots: string[] // Array of bot IDs for Atlas Sponsored systems
}

type TreasuryEntry = {
  id: string
  date: number
  type: 'fee_deposit' | 'withdrawal' | 'interest'
  amount: number
  description: string
}

type TreasuryState = {
  balance: number
  entries: TreasuryEntry[]
}

type AdminAggregatedStats = {
  totalDollarsInAccounts: number
  totalDollarsInvested: number
  totalPortfolioValue: number
  totalInvestedAtlas: number
  totalInvestedNexus: number
  totalInvestedPrivate: number
  userCount: number
  lastUpdated: number
}

type TreasuryFeeBreakdown = {
  atlasFeesTotal: number
  privateFeesTotal: number
  nexusFeesTotal: number
  nexusPartnerPaymentsTotal: number
}

type FundZones = {
  fund1: string | null
  fund2: string | null
  fund3: string | null
  fund4: string | null
  fund5: string | null
}

const STARTING_CAPITAL = 100000

const defaultDashboardPortfolio = (): DashboardPortfolio => ({
  cash: STARTING_CAPITAL,
  investments: [],
})

type UserUiState = {
  theme: ThemeMode
  colorTheme: ColorTheme
  analyzeCollapsedByBotId: Record<string, boolean>
  communityCollapsedByBotId: Record<string, boolean>
  analyzeBotCardTab: Record<string, 'overview' | 'advanced' | 'robustness'>
  analyzeFilterWatchlistId: string | null
  communitySelectedWatchlistId: string | null
  communityWatchlistSlot1Id: string | null
  communityWatchlistSlot2Id: string | null
  fundZones: FundZones
}

type UserData = {
  savedBots: SavedBot[]
  watchlists: Watchlist[]
  callChains: CallChain[]
  ui: UserUiState
  dashboardPortfolio?: DashboardPortfolio
}

type AnalyzeBacktestState = {
  status: 'idle' | 'loading' | 'error' | 'done'
  result?: BacktestResult
  warnings?: BacktestWarning[]
  error?: string
}

type CallChain = {
  id: string
  name: string
  root: FlowNode
  collapsed: boolean
}

type FlowNode = {
  id: string
  kind: BlockKind
  title: string
  children: Partial<Record<SlotId, Array<FlowNode | null>>>
  positions?: PositionChoice[]
  weighting: WeightMode
  weightingThen?: WeightMode
  weightingElse?: WeightMode
  cappedFallback?: PositionChoice
  cappedFallbackThen?: PositionChoice
  cappedFallbackElse?: PositionChoice
  volWindow?: number
  volWindowThen?: number
  volWindowElse?: number
  bgColor?: string
  collapsed?: boolean
  conditions?: ConditionLine[]
  numbered?: {
    quantifier: NumberedQuantifier
    n: number
    items: NumberedItem[]
  }
  metric?: MetricChoice
  window?: number
  bottom?: number
  rank?: RankChoice
  callRefId?: string
  // Alt Exit node properties
  entryConditions?: ConditionLine[]
  exitConditions?: ConditionLine[]
  // Scaling node properties
  scaleMetric?: MetricChoice
  scaleWindow?: number
  scaleTicker?: string
  scaleFrom?: number
  scaleTo?: number
}

const SLOT_ORDER: Record<BlockKind, SlotId[]> = {
  basic: ['next'],
  function: ['next'],
  indicator: ['then', 'else', 'next'],
  numbered: ['then', 'else', 'next'],
  position: [],
  call: [],
  altExit: ['then', 'else'],
  scaling: ['then', 'else'],
}

// Helper to get all slots for a node, including dynamic ladder slots for numbered nodes
const getAllSlotsForNode = (node: FlowNode): SlotId[] => {
  const slots = [...SLOT_ORDER[node.kind]]
  if (node.kind === 'numbered' && node.numbered?.quantifier === 'ladder') {
    Object.keys(node.children).forEach((key) => {
      if (key.startsWith('ladder-') && !slots.includes(key as SlotId)) {
        slots.push(key as SlotId)
      }
    })
  }
  return slots
}

// ============================================
// COMPOSER IMPORT PARSER (FRD-019)
// ============================================

type ImportFormat = 'atlas' | 'composer' | 'quantmage' | 'unknown'

// Detect which format the imported JSON is in
const detectImportFormat = (data: unknown): ImportFormat => {
  if (!data || typeof data !== 'object') return 'unknown'
  const obj = data as Record<string, unknown>

  // Atlas format: has kind, id, children as object with slots
  if (typeof obj.kind === 'string' && typeof obj.id === 'string' && typeof obj.children === 'object') {
    return 'atlas'
  }

  // Composer format: has step field (root, wt-cash-equal, if, asset, filter, group)
  if (typeof obj.step === 'string') {
    return 'composer'
  }

  // Check if it's a wrapped format (e.g., { payload: FlowNode })
  if (obj.payload && typeof obj.payload === 'object') {
    const payload = obj.payload as Record<string, unknown>
    if (typeof payload.kind === 'string') return 'atlas'
    if (typeof payload.step === 'string') return 'composer'
  }

  // QuantMage format: has incantation field with incantation_type
  if (obj.incantation && typeof obj.incantation === 'object') {
    const inc = obj.incantation as Record<string, unknown>
    if (typeof inc.incantation_type === 'string') return 'quantmage'
  }

  return 'unknown'
}

// Map Composer metric names to Atlas MetricChoice
const mapComposerMetric = (fn: string): MetricChoice => {
  const mapping: Record<string, MetricChoice> = {
    'relative-strength-index': 'Relative Strength Index',
    'simple-moving-average': 'Simple Moving Average',
    'simple-moving-average-price': 'Simple Moving Average',
    'moving-average-price': 'Simple Moving Average',
    'exponential-moving-average': 'Exponential Moving Average',
    'exponential-moving-average-price': 'Exponential Moving Average',
    'cumulative-return': 'Cumulative Return',
    'moving-average-return': 'Cumulative Return', // Map to closest equivalent
    'current-price': 'Current Price',
    'max-drawdown': 'Max Drawdown',
    'standard-deviation-return': 'Standard Deviation',
    'standard-deviation-price': 'Standard Deviation of Price',
    'moving-average-deviation': 'Standard Deviation',
  }
  return mapping[fn] || 'Relative Strength Index'
}

// Map Composer comparators to Atlas
const mapComposerComparator = (comp: string): ComparatorChoice => {
  if (comp === 'gte') return 'gt'
  if (comp === 'lte') return 'lt'
  return (comp === 'gt' || comp === 'lt') ? comp : 'gt'
}

// Map Composer rank to Atlas
const mapComposerRank = (selectFn: string): RankChoice => {
  return selectFn === 'bottom' ? 'Bottom' : 'Top'
}

// ID generator for Composer imports (performance optimized)
const createComposerIdGenerator = () => {
  let nodeCounter = 0
  let condCounter = 0
  const batchTs = Date.now()
  const batchRand = Math.random().toString(36).slice(2, 10)
  return {
    nodeId: () => `node-${batchTs}-${++nodeCounter}-${batchRand}`,
    condId: () => `cond-${++condCounter}`,
  }
}

// Parse a Composer node recursively
const parseComposerNode = (
  node: Record<string, unknown>,
  idGen: ReturnType<typeof createComposerIdGenerator>
): FlowNode | null => {
  const step = node.step as string

  // Asset -> Position
  if (step === 'asset') {
    const ticker = (node.ticker as string) || 'SPY'
    return {
      id: idGen.nodeId(),
      kind: 'position',
      title: 'Position',
      collapsed: false,
      positions: [ticker as PositionChoice],
      weighting: 'equal',
      children: {},
    }
  }

  // Filter -> Sort (function)
  if (step === 'filter') {
    const sortByFn = (node['sort-by-fn'] as string) || 'cumulative-return'
    const sortByParams = (node['sort-by-fn-params'] as Record<string, unknown>) || {}
    const selectFn = (node['select-fn'] as string) || 'top'
    const selectN = parseInt(String(node['select-n'] || '1'), 10)
    const children = (node.children as unknown[]) || []

    const parsedChildren = children
      .map((c) => parseComposerNode(c as Record<string, unknown>, idGen))
      .filter((c): c is FlowNode => c !== null)

    return {
      id: idGen.nodeId(),
      kind: 'function',
      title: 'Sort',
      collapsed: false,
      weighting: 'equal',
      metric: mapComposerMetric(sortByFn),
      window: (sortByParams.window as number) || 14,
      rank: mapComposerRank(selectFn),
      bottom: selectN,
      children: { next: parsedChildren },
    }
  }

  // If -> Indicator
  if (step === 'if') {
    const ifChildren = (node.children as unknown[]) || []
    let condition: ConditionLine | null = null
    let thenBranch: FlowNode[] = []
    let elseBranch: FlowNode[] = []

    for (const child of ifChildren) {
      const ifChild = child as Record<string, unknown>
      if (ifChild.step !== 'if-child') continue

      const isElse = ifChild['is-else-condition?'] === true
      const childNodes = (ifChild.children as unknown[]) || []

      if (!isElse && !condition) {
        // This is the THEN branch with the condition
        const lhsFn = (ifChild['lhs-fn'] as string) || 'relative-strength-index'
        const lhsParams = (ifChild['lhs-fn-params'] as Record<string, unknown>) || {}
        const lhsVal = (ifChild['lhs-val'] as string) || 'SPY'
        const comparator = (ifChild.comparator as string) || 'gt'
        const rhsFixedValue = ifChild['rhs-fixed-value?'] === true
        const rhsVal = ifChild['rhs-val']
        const rhsFn = ifChild['rhs-fn'] as string | undefined
        const rhsParams = (ifChild['rhs-fn-params'] as Record<string, unknown>) || {}

        condition = {
          id: idGen.condId(),
          type: 'if',
          metric: mapComposerMetric(lhsFn),
          window: (lhsParams.window as number) || 14,
          ticker: lhsVal as PositionChoice,
          comparator: mapComposerComparator(comparator),
          threshold: rhsFixedValue ? parseFloat(String(rhsVal)) : 0,
          expanded: !rhsFixedValue,
          rightMetric: rhsFn ? mapComposerMetric(rhsFn) : undefined,
          rightWindow: rhsFn ? ((rhsParams.window as number) || 14) : undefined,
          rightTicker: !rhsFixedValue ? (rhsVal as PositionChoice) : undefined,
        }

        thenBranch = childNodes
          .map((c) => parseComposerNode(c as Record<string, unknown>, idGen))
          .filter((c): c is FlowNode => c !== null)
      } else if (isElse) {
        elseBranch = childNodes
          .map((c) => parseComposerNode(c as Record<string, unknown>, idGen))
          .filter((c): c is FlowNode => c !== null)
      }
    }

    if (!condition) {
      // Fallback if no condition found
      condition = {
        id: idGen.condId(),
        type: 'if',
        metric: 'Relative Strength Index',
        window: 14,
        ticker: 'SPY',
        comparator: 'gt',
        threshold: 50,
        expanded: false,
      }
    }

    return {
      id: idGen.nodeId(),
      kind: 'indicator',
      title: 'Indicator',
      collapsed: false,
      weighting: 'equal',
      weightingThen: 'equal',
      weightingElse: 'equal',
      conditions: [condition],
      children: {
        then: thenBranch.length > 0 ? thenBranch : [null],
        else: elseBranch.length > 0 ? elseBranch : [null],
        next: [null],
      },
    }
  }

  // Group / wt-cash-equal / wt-cash-specified / wt-inverse-vol / root -> Basic (container)
  if (step === 'group' || step === 'wt-cash-equal' || step === 'wt-cash-specified' || step === 'wt-inverse-vol' || step === 'root') {
    const name = (node.name as string) || 'Basic'
    const children = (node.children as unknown[]) || []

    // Determine weighting mode
    // Note: wt-cash-specified has explicit weights but we can't transfer per-child weights
    // Default to 'equal' for specified weights - user can adjust after import
    let weighting: WeightMode = 'equal'
    if (step === 'wt-inverse-vol') {
      weighting = 'inverse'
    }
    // wt-cash-specified would be 'defined' but we default to 'equal' since we can't set per-child weights

    // Flatten wt-cash-equal wrappers and collect weights for specified mode
    const flattenedChildren: FlowNode[] = []
    const specifiedWeights: number[] = []
    for (const child of children) {
      const childNode = child as Record<string, unknown>
      // Extract weight for wt-cash-specified
      if (step === 'wt-cash-specified' && childNode.weight) {
        const w = childNode.weight as { num?: number | string; den?: number | string }
        const num = parseFloat(String(w.num || 0))
        const den = parseFloat(String(w.den || 100))
        specifiedWeights.push(den > 0 ? (num / den) * 100 : 0)
      }
      if (childNode.step === 'wt-cash-equal' || childNode.step === 'wt-cash-specified' || childNode.step === 'wt-inverse-vol') {
        // Unwrap and process inner children
        const innerChildren = (childNode.children as unknown[]) || []
        for (const inner of innerChildren) {
          const parsed = parseComposerNode(inner as Record<string, unknown>, idGen)
          if (parsed) flattenedChildren.push(parsed)
        }
      } else {
        const parsed = parseComposerNode(childNode, idGen)
        if (parsed) flattenedChildren.push(parsed)
      }
    }

    // Note: 'defined' weighting requires per-child weight configuration in UI
    // For now, import as 'defined' mode and user can set weights after import
    const result: FlowNode = {
      id: idGen.nodeId(),
      kind: 'basic',
      title: step === 'root' ? (name || 'Imported System') : (name || 'Basic'),
      collapsed: false,
      weighting,
      children: { next: flattenedChildren.length > 0 ? flattenedChildren : [null] },
    }

    return result
  }

  // Unknown step type
  console.warn(`[ComposerParser] Unknown step type: ${step}`)
  return null
}

// Main entry point: parse entire Composer Symphony JSON
const parseComposerSymphony = (data: Record<string, unknown>): FlowNode => {
  const idGen = createComposerIdGenerator()
  const name = (data.name as string) || 'Imported System'

  // Parse starting from root
  const parsed = parseComposerNode(data, idGen)

  if (!parsed) {
    // Return a basic fallback node
    return {
      id: idGen.nodeId(),
      kind: 'basic',
      title: name,
      collapsed: false,
      weighting: 'equal',
      children: { next: [null] },
    }
  }

  // Override title with the symphony name if it's the root
  if (parsed.kind === 'basic' && name) {
    parsed.title = name
  }

  return parsed
}

// ============================================
// END COMPOSER IMPORT PARSER
// ============================================

// ============================================
// QUANTMAGE IMPORT PARSER
// ============================================

// Map QuantMage indicator types to Atlas MetricChoice
const mapQuantMageIndicator = (type: string): MetricChoice => {
  const mapping: Record<string, MetricChoice> = {
    'CurrentPrice': 'Current Price',
    'MovingAverage': 'Simple Moving Average',
    'ExponentialMovingAverage': 'Exponential Moving Average',
    'RelativeStrengthIndex': 'Relative Strength Index',
    'CumulativeReturn': 'Cumulative Return',
    'Volatility': 'Standard Deviation',
    'MaxDrawdown': 'Max Drawdown',
    // Momentum indicators
    '13612wMomentum': 'Momentum (Weighted)',
    '13612uMomentum': 'Momentum (Unweighted)',
    'SMA12Momentum': 'Momentum (12-Month SMA)',
    // Additional indicators
    'UltimateSmoother': 'Ultimate Smoother',
    'Drawdown': 'Drawdown',
    'AroonUp': 'Aroon Up',
    'AroonDown': 'Aroon Down',
    'Aroon': 'Aroon Oscillator',
    'MACD': 'MACD Histogram',
    'PPO': 'PPO Histogram',
    'TrendClarity': 'Trend Clarity',
    'MovingAverageReturn': 'SMA of Returns',
  }
  return mapping[type] || 'Relative Strength Index'
}

// Async helper: yields to main thread to keep UI responsive during heavy processing
const yieldToMain = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

// ID generator for QuantMage imports (performance optimized)
const createQuantMageIdGenerator = () => {
  let nodeCounter = 0
  let condCounter = 0
  const batchTs = Date.now()
  const batchRand = Math.random().toString(36).slice(2, 10)
  return {
    nodeId: () => `node-${batchTs}-${++nodeCounter}-${batchRand}`,
    condId: () => `cond-${++condCounter}`,
  }
}

// Parse a QuantMage condition into Atlas ConditionLine(s)
const parseQuantMageCondition = (
  condition: Record<string, unknown>,
  idGen: ReturnType<typeof createQuantMageIdGenerator>
): ConditionLine[] => {
  const condType = condition.condition_type as string

  if (condType === 'SingleCondition') {
    const lhIndicator = condition.lh_indicator as { type: string; window: number } | undefined
    const rhIndicator = condition.rh_indicator as { type: string; window: number } | undefined
    const compType = condition.type as string // 'IndicatorAndNumber' or 'BothIndicators'
    const greaterThan = condition.greater_than as boolean
    const forDays = (condition.for_days as number) || 1

    const cond: ConditionLine = {
      id: idGen.condId(),
      type: 'if',
      metric: lhIndicator ? mapQuantMageIndicator(lhIndicator.type) : 'Relative Strength Index',
      window: lhIndicator?.window || 14,
      ticker: (condition.lh_ticker_symbol as PositionChoice) || 'SPY',
      comparator: greaterThan ? 'gt' : 'lt',
      threshold: 0,
      expanded: false,
      forDays: forDays > 1 ? forDays : undefined, // Only store if > 1
    }

    if (compType === 'IndicatorAndNumber') {
      // Threshold comparison
      cond.threshold = parseFloat(String(condition.rh_value || 0))
      cond.expanded = false
    } else if (compType === 'BothIndicators') {
      // Indicator vs indicator
      cond.expanded = true
      cond.rightMetric = rhIndicator ? mapQuantMageIndicator(rhIndicator.type) : 'Relative Strength Index'
      cond.rightWindow = rhIndicator?.window || 14
      cond.rightTicker = (condition.rh_ticker_symbol as PositionChoice) || 'SPY'
    }

    return [cond]
  }

  if (condType === 'AnyOf' || condType === 'AllOf') {
    const conditions = (condition.conditions as Record<string, unknown>[]) || []
    const result: ConditionLine[] = []

    for (let i = 0; i < conditions.length; i++) {
      const parsed = parseQuantMageCondition(conditions[i], idGen)
      for (const cond of parsed) {
        // Mark as 'and' for AllOf, 'or' for AnyOf (skip first)
        if (i > 0 || result.length > 0) {
          cond.type = condType === 'AllOf' ? 'and' : 'or'
        }
        result.push(cond)
      }
    }
    return result
  }

  // Unknown condition type
  return [{
    id: idGen.condId(),
    type: 'if',
    metric: 'Relative Strength Index',
    window: 14,
    ticker: 'SPY',
    comparator: 'gt',
    threshold: 50,
    expanded: false,
  }]
}

// Parse a QuantMage incantation node recursively
const parseQuantMageIncantation = (
  node: Record<string, unknown>,
  idGen: ReturnType<typeof createQuantMageIdGenerator>
): FlowNode | null => {
  const incType = node.incantation_type as string

  // Ticker -> Position
  if (incType === 'Ticker') {
    const symbol = (node.symbol as string) || 'SPY'
    return {
      id: idGen.nodeId(),
      kind: 'position',
      title: 'Position',
      collapsed: false,
      positions: [symbol as PositionChoice],
      weighting: 'equal',
      children: {},
    }
  }

  // IfElse -> Indicator
  if (incType === 'IfElse') {
    const condition = node.condition as Record<string, unknown> | undefined
    const thenInc = node.then_incantation as Record<string, unknown> | undefined
    const elseInc = node.else_incantation as Record<string, unknown> | undefined

    const conditions = condition ? parseQuantMageCondition(condition, idGen) : [{
      id: idGen.condId(),
      type: 'if' as const,
      metric: 'Relative Strength Index' as MetricChoice,
      window: 14,
      ticker: 'SPY' as PositionChoice,
      comparator: 'gt' as ComparatorChoice,
      threshold: 50,
      expanded: false,
    }]

    const thenBranch = thenInc ? parseQuantMageIncantation(thenInc, idGen) : null
    const elseBranch = elseInc ? parseQuantMageIncantation(elseInc, idGen) : null

    return {
      id: idGen.nodeId(),
      kind: 'indicator',
      title: (node.name as string) || 'Indicator',
      collapsed: false,
      weighting: 'equal',
      weightingThen: 'equal',
      weightingElse: 'equal',
      conditions,
      children: {
        then: thenBranch ? [thenBranch] : [null],
        else: elseBranch ? [elseBranch] : [null],
        next: [null],
      },
    }
  }

  // Weighted -> Basic
  if (incType === 'Weighted') {
    const weightType = node.type as string // 'Equal', 'InverseVolatility', or 'Custom'
    const incantations = (node.incantations as Record<string, unknown>[]) || []
    const customWeights = (node.weights as number[]) || []

    // Determine weighting mode: Custom -> defined, InverseVolatility -> inverse, else equal
    const weighting: WeightMode = weightType === 'Custom' ? 'defined'
      : weightType === 'InverseVolatility' ? 'inverse'
      : 'equal'

    const children = incantations
      .map((inc, idx) => {
        const child = parseQuantMageIncantation(inc, idGen)
        // For 'defined' weighting, store the weight in the child's window property
        if (child && weighting === 'defined' && customWeights[idx] !== undefined) {
          child.window = customWeights[idx]
        }
        return child
      })
      .filter((c): c is FlowNode => c !== null)

    const result: FlowNode = {
      id: idGen.nodeId(),
      kind: 'basic',
      title: (node.name as string) || 'Basic',
      collapsed: false,
      weighting,
      children: { next: children.length > 0 ? children : [null] },
    }

    return result
  }

  // Filtered -> Sort (function)
  if (incType === 'Filtered') {
    const sortIndicator = node.sort_indicator as { type: string; window: number } | undefined
    const count = (node.count as number) || 1
    const bottom = (node.bottom as boolean) || false
    const incantations = (node.incantations as Record<string, unknown>[]) || []

    const children = incantations
      .map((inc) => parseQuantMageIncantation(inc, idGen))
      .filter((c): c is FlowNode => c !== null)

    return {
      id: idGen.nodeId(),
      kind: 'function',
      title: 'Sort',
      collapsed: false,
      weighting: 'equal',
      metric: sortIndicator ? mapQuantMageIndicator(sortIndicator.type) : 'Relative Strength Index',
      window: sortIndicator?.window || 14,
      rank: bottom ? 'Bottom' : 'Top',
      bottom: count,
      children: { next: children.length > 0 ? children : [null] },
    }
  }

  // Switch -> Nested Indicators (case/when logic)
  if (incType === 'Switch') {
    const conditions = (node.conditions as Record<string, unknown>[]) || []
    const incantations = (node.incantations as Record<string, unknown>[]) || []

    // Convert Switch to nested if/else structure
    // Last incantation is the "else" fallback if there are more incantations than conditions
    const buildNestedIndicator = (idx: number): FlowNode | null => {
      if (idx >= conditions.length) {
        // No more conditions, return the fallback incantation if it exists
        if (idx < incantations.length && incantations[idx]) {
          return parseQuantMageIncantation(incantations[idx], idGen)
        }
        return null
      }

      const cond = conditions[idx]
      const thenInc = incantations[idx]
      const parsedConds = cond ? parseQuantMageCondition(cond, idGen) : [{
        id: idGen.condId(),
        type: 'if' as const,
        metric: 'Relative Strength Index' as MetricChoice,
        window: 14,
        ticker: 'SPY' as PositionChoice,
        comparator: 'gt' as ComparatorChoice,
        threshold: 50,
        expanded: false,
      }]
      const thenBranch = thenInc ? parseQuantMageIncantation(thenInc, idGen) : null
      const elseBranch = buildNestedIndicator(idx + 1)

      return {
        id: idGen.nodeId(),
        kind: 'indicator',
        title: (node.name as string) || 'Switch Case',
        collapsed: false,
        weighting: 'equal',
        weightingThen: 'equal',
        weightingElse: 'equal',
        conditions: parsedConds,
        children: {
          then: thenBranch ? [thenBranch] : [null],
          else: elseBranch ? [elseBranch] : [null],
          next: [null],
        },
      }
    }

    return buildNestedIndicator(0)
  }

  // Mixed -> Scaling
  if (incType === 'Mixed') {
    const indicator = node.indicator as { type: string; window: number } | undefined
    const tickerSymbol = (node.ticker_symbol as string) || 'SPY'
    const fromValue = (node.from_value as number) || 0
    const toValue = (node.to_value as number) || 100
    const fromInc = node.from_incantation as Record<string, unknown> | undefined
    const toInc = node.to_incantation as Record<string, unknown> | undefined

    const thenBranch = fromInc ? parseQuantMageIncantation(fromInc, idGen) : null
    const elseBranch = toInc ? parseQuantMageIncantation(toInc, idGen) : null

    // Create scaling condition
    const condition: ConditionLine = {
      id: idGen.condId(),
      type: 'if',
      metric: indicator ? mapQuantMageIndicator(indicator.type) : 'Relative Strength Index',
      window: indicator?.window || 14,
      ticker: tickerSymbol as PositionChoice,
      comparator: 'gt',
      threshold: 0,
      expanded: false,
    }

    return {
      id: idGen.nodeId(),
      kind: 'scaling',
      title: (node.name as string) || 'Scaling',
      collapsed: false,
      weighting: 'equal',
      weightingThen: 'equal',
      weightingElse: 'equal',
      conditions: [condition],
      // Set scaling-specific fields (used by backtest evaluation)
      scaleMetric: indicator ? mapQuantMageIndicator(indicator.type) : 'Relative Strength Index',
      scaleWindow: indicator?.window || 14,
      scaleTicker: tickerSymbol,
      scaleFrom: fromValue,
      scaleTo: toValue,
      children: {
        then: thenBranch ? [thenBranch] : [null],
        else: elseBranch ? [elseBranch] : [null],
      },
    }
  }

  // Unknown incantation type
  console.warn(`[QuantMageParser] Unknown incantation_type: ${incType}`)
  return null
}

// ============================================
// END QUANTMAGE IMPORT PARSER
// ============================================

// Performance optimization: Batch ID generation
// Refreshes timestamp and random suffix every 1000 IDs instead of every call
const newId = (() => {
  let counter = 0
  let batchTs = Date.now()
  let batchRand = Math.random().toString(36).slice(2, 10)

  return () => {
    // Refresh batch values periodically to maintain uniqueness across sessions
    if (counter % 1000 === 0) {
      batchTs = Date.now()
      batchRand = Math.random().toString(36).slice(2, 10)
    }
    counter += 1
    return `node-${batchTs}-${counter}-${batchRand}`
  }
})()

const createNode = (kind: BlockKind): FlowNode => {
  const needsThenElseWeighting = kind === 'indicator' || kind === 'numbered' || kind === 'altExit' || kind === 'scaling'
  const base: FlowNode = {
    id: newId(),
    kind,
    title:
      kind === 'function'
        ? 'Sort'
        : kind === 'indicator'
          ? 'Indicator'
          : kind === 'numbered'
            ? 'Numbered'
            : kind === 'position'
              ? 'Position'
              : kind === 'call'
                ? 'Call Reference'
                : kind === 'altExit'
                  ? 'Alt Exit'
                  : kind === 'scaling'
                    ? 'Scaling'
                    : 'Basic',
    children: {},
    weighting: 'equal',
    weightingThen: needsThenElseWeighting ? 'equal' : undefined,
    weightingElse: needsThenElseWeighting ? 'equal' : undefined,
    cappedFallback: undefined,
    cappedFallbackThen: undefined,
    cappedFallbackElse: undefined,
    volWindow: undefined,
    volWindowThen: undefined,
    volWindowElse: undefined,
    bgColor: undefined,
    conditions:
      kind === 'indicator'
        ? [
            {
              id: newId(),
              type: 'if',
              window: 14,
              metric: 'Relative Strength Index',
              comparator: 'lt',
              ticker: 'SPY',
              threshold: 30,
            },
          ]
        : undefined,
    numbered:
      kind === 'numbered'
        ? {
            quantifier: 'all',
            n: 1,
            items: [
              {
                id: newId(),
                conditions: [
                  {
                    id: newId(),
                    type: 'if',
                    window: 14,
                    metric: 'Relative Strength Index',
                    comparator: 'lt',
                    ticker: 'SPY',
                    threshold: 30,
                    expanded: false,
                    rightWindow: 14,
                    rightMetric: 'Relative Strength Index',
                    rightTicker: 'SPY',
                  },
                ],
              },
            ],
          }
        : undefined,
    metric: kind === 'function' ? 'Relative Strength Index' : undefined,
    window: undefined,
  bottom: kind === 'function' ? 1 : undefined,
    rank: kind === 'function' ? 'Bottom' : undefined,
    collapsed: false,
    // Alt Exit properties
    entryConditions:
      kind === 'altExit'
        ? [
            {
              id: newId(),
              type: 'if',
              window: 14,
              metric: 'Relative Strength Index',
              comparator: 'gt',
              ticker: 'SPY',
              threshold: 30,
            },
          ]
        : undefined,
    exitConditions:
      kind === 'altExit'
        ? [
            {
              id: newId(),
              type: 'if',
              window: 14,
              metric: 'Relative Strength Index',
              comparator: 'lt',
              ticker: 'SPY',
              threshold: 70,
            },
          ]
        : undefined,
    // Scaling properties
    scaleMetric: kind === 'scaling' ? 'Relative Strength Index' : undefined,
    scaleWindow: kind === 'scaling' ? 14 : undefined,
    scaleTicker: kind === 'scaling' ? 'SPY' : undefined,
    scaleFrom: kind === 'scaling' ? 30 : undefined,
    scaleTo: kind === 'scaling' ? 70 : undefined,
  }
  SLOT_ORDER[kind].forEach((slot) => {
    base.children[slot] = [null]
  })
  if (kind === 'position') {
    base.positions = ['Empty']
  }
  if (kind === 'call') {
    base.callRefId = undefined
  }
  return base
}

const ensureSlots = (node: FlowNode): FlowNode => {
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  SLOT_ORDER[node.kind].forEach((slot) => {
    const arr = node.children[slot] ?? [null]
    children[slot] = arr.map((c) => (c ? ensureSlots(c) : c))
  })
  // Preserve ladder slots for numbered nodes in ladder mode
  if (node.kind === 'numbered' && node.numbered?.quantifier === 'ladder') {
    Object.keys(node.children).forEach((key) => {
      if (key.startsWith('ladder-')) {
        const slotKey = key as SlotId
        const arr = node.children[slotKey] ?? [null]
        children[slotKey] = arr.map((c) => (c ? ensureSlots(c) : c))
      }
    })
  }
  return { ...node, children }
}

// Performance optimization: Single-pass import normalization
// Combines hasLegacyIdsOrDuplicates + ensureSlots + regenerateIds into one traversal
// Also collapses all nodes except root for performance with large imports
const normalizeForImport = (node: FlowNode): FlowNode => {
  const seen = new Set<string>()
  let needsNewIds = false

  // Helper to get all slot keys for a node (including ladder slots)
  const getAllSlots = (n: FlowNode): SlotId[] => {
    const slots = [...SLOT_ORDER[n.kind]]
    if (n.kind === 'numbered' && n.numbered?.quantifier === 'ladder') {
      Object.keys(n.children).forEach((key) => {
        if (key.startsWith('ladder-') && !slots.includes(key as SlotId)) {
          slots.push(key as SlotId)
        }
      })
    }
    return slots
  }

  // First pass: detect if we need to regenerate IDs
  const detectLegacy = (n: FlowNode) => {
    if (/^node-\d+$/.test(n.id) || seen.has(n.id)) needsNewIds = true
    seen.add(n.id)
    getAllSlots(n).forEach((slot) => {
      n.children[slot]?.forEach((c) => {
        if (c) detectLegacy(c)
      })
    })
  }
  detectLegacy(node)

  // Second pass: normalize, optionally regenerate IDs, and collapse all nodes
  const walk = (n: FlowNode): FlowNode => {
    const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
    const slots = getAllSlots(n)
    slots.forEach((slot) => {
      const arr = n.children[slot] ?? [null]
      children[slot] = arr.map((c) => (c ? walk(c) : c))
    })
    return {
      ...n,
      id: needsNewIds ? newId() : n.id,
      collapsed: true, // Collapse all nodes for performance
      children,
    }
  }
  const result = walk(node)
  // Root node should be expanded so user can see the tree structure
  result.collapsed = false
  return result
}

// Performance optimization: Single-pass clone + normalize + regenerate for paste operations
// Always generates new IDs (used for paste/duplicate where we always need new IDs)
const cloneAndNormalize = (node: FlowNode): FlowNode => {
  // Helper to get all slot keys for a node (including ladder slots)
  const getAllSlots = (n: FlowNode): SlotId[] => {
    const slots = [...SLOT_ORDER[n.kind]]
    if (n.kind === 'numbered' && n.numbered?.quantifier === 'ladder') {
      Object.keys(n.children).forEach((key) => {
        if (key.startsWith('ladder-') && !slots.includes(key as SlotId)) {
          slots.push(key as SlotId)
        }
      })
    }
    return slots
  }

  const walk = (n: FlowNode): FlowNode => {
    const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
    getAllSlots(n).forEach((slot) => {
      const arr = n.children[slot] ?? [null]
      children[slot] = arr.map((c) => (c ? walk(c) : c))
    })
    return { ...n, id: newId(), children }
  }
  return walk(node)
}

type EquityPoint = LineData<UTCTimestamp>
type EquityMarker = { time: UTCTimestamp; text: string }

type VisibleRange = IRange<UTCTimestamp>

const EMPTY_EQUITY_POINTS: EquityPoint[] = []

// Bot return series type
type BotReturnSeries = {
  id: string
  name: string
  color: string
  data: EquityCurvePoint[]
}

// Dashboard Equity + Drawdown Chart Component (% based with multiple bot lines)
const DashboardEquityChart = ({
  portfolioData,
  botSeries,
  theme,
}: {
  portfolioData: EquityCurvePoint[]
  botSeries: BotReturnSeries[]
  theme: ThemeMode
}) => {
  const equityContainerRef = useRef<HTMLDivElement>(null)
  const drawdownContainerRef = useRef<HTMLDivElement>(null)
  const equityChartRef = useRef<IChartApi | null>(null)
  const drawdownChartRef = useRef<IChartApi | null>(null)
  const portfolioSeriesRef = useRef<ISeriesApi<'Area'> | null>(null)
  const botSeriesRefs = useRef<ISeriesApi<'Line'>[]>([])
  const drawdownSeriesRef = useRef<ISeriesApi<'Area'> | null>(null)

  // Convert equity to % returns (rebased to 0%)
  const toReturns = useCallback((data: EquityCurvePoint[]) => {
    if (data.length === 0) return []
    const startValue = data[0].value
    return data.map((p) => ({
      time: p.time,
      value: startValue > 0 ? ((p.value - startValue) / startValue) * 100 : 0,
    }))
  }, [])

  const portfolioReturns = useMemo(() => toReturns(portfolioData), [portfolioData, toReturns])

  // Compute drawdown from portfolio data (unified)
  const drawdownData = useMemo(() => {
    if (portfolioData.length === 0) return []
    let peak = portfolioData[0].value
    return portfolioData.map((p) => {
      if (p.value > peak) peak = p.value
      const dd = peak > 0 ? (p.value - peak) / peak : 0
      return { time: p.time, value: dd * 100 } // percentage
    })
  }, [portfolioData])

  useEffect(() => {
    const equityEl = equityContainerRef.current
    const drawdownEl = drawdownContainerRef.current
    if (!equityEl || !drawdownEl) return

    const isDark = theme === 'dark'
    const bgColor = isDark ? '#1e293b' : '#ffffff'
    const textColor = isDark ? '#e2e8f0' : '#0f172a'
    const gridColor = isDark ? '#334155' : '#eef2f7'
    const borderColor = isDark ? '#475569' : '#cbd5e1'

    // Returns chart
    const equityChart = createChart(equityEl, {
      width: equityEl.clientWidth,
      height: 200,
      layout: { background: { type: ColorType.Solid, color: bgColor }, textColor },
      grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
      rightPriceScale: { borderColor },
      timeScale: { borderColor, visible: false }, // Hide time scale on returns chart
      handleScroll: false,
      handleScale: false
    })

    // Portfolio returns series (main area)
    const portfolioSeries = equityChart.addSeries(AreaSeries, {
      lineColor: '#3b82f6',
      topColor: 'rgba(59, 130, 246, 0.3)',
      bottomColor: 'rgba(59, 130, 246, 0.0)',
      lineWidth: 1,
      priceFormat: { type: 'custom', formatter: (v: number) => `${v.toFixed(1)}%` },
    })

    // Add bot lines
    const newBotSeriesRefs: ISeriesApi<'Line'>[] = []
    botSeries.forEach((bot) => {
      const series = equityChart.addSeries(LineSeries, {
        color: bot.color,
        lineWidth: 1,
        priceFormat: { type: 'custom', formatter: (v: number) => `${v.toFixed(1)}%` },
      })
      newBotSeriesRefs.push(series)
    })

    // Drawdown chart
    const drawdownChart = createChart(drawdownEl, {
      width: drawdownEl.clientWidth,
      height: 80,
      layout: { background: { type: ColorType.Solid, color: bgColor }, textColor },
      grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
      rightPriceScale: { borderColor },
      timeScale: { borderColor },
      handleScroll: false,
      handleScale: false
    })

    const drawdownSeries = drawdownChart.addSeries(AreaSeries, {
      lineColor: '#ef4444',
      topColor: 'rgba(239, 68, 68, 0.0)',
      bottomColor: 'rgba(239, 68, 68, 0.4)',
      lineWidth: 1,
      invertFilledArea: true,
      priceFormat: { type: 'custom', formatter: (v: number) => `${v.toFixed(1)}%` },
    })

    equityChartRef.current = equityChart
    drawdownChartRef.current = drawdownChart
    portfolioSeriesRef.current = portfolioSeries
    botSeriesRefs.current = newBotSeriesRefs
    drawdownSeriesRef.current = drawdownSeries

    // Synchronize time scales
    const syncTimeScale = (sourceChart: IChartApi, targetChart: IChartApi) => {
      sourceChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range) {
          targetChart.timeScale().setVisibleLogicalRange(range)
        }
      })
    }

    syncTimeScale(equityChart, drawdownChart)
    syncTimeScale(drawdownChart, equityChart)

    // Resize observer
    const ro = new ResizeObserver(() => {
      equityChart.applyOptions({ width: equityEl.clientWidth })
      drawdownChart.applyOptions({ width: drawdownEl.clientWidth })
    })
    ro.observe(equityEl)

    return () => {
      ro.disconnect()
      equityChart.remove()
      drawdownChart.remove()
      equityChartRef.current = null
      drawdownChartRef.current = null
      portfolioSeriesRef.current = null
      botSeriesRefs.current = []
      drawdownSeriesRef.current = null
    }
  }, [theme, botSeries.length])

  useEffect(() => {
    if (!portfolioSeriesRef.current || !drawdownSeriesRef.current) return

    // Set portfolio returns
    portfolioSeriesRef.current.setData(portfolioReturns)

    // Set bot series data
    botSeries.forEach((bot, idx) => {
      const series = botSeriesRefs.current[idx]
      if (series) {
        series.setData(toReturns(bot.data))
      }
    })

    drawdownSeriesRef.current.setData(drawdownData)
    equityChartRef.current?.timeScale().fitContent()
    drawdownChartRef.current?.timeScale().fitContent()
  }, [portfolioReturns, botSeries, drawdownData, toReturns])

  return (
    <div className="w-full flex flex-col gap-1">
      <div ref={equityContainerRef} className="w-full h-[200px] rounded-t-lg border border-b-0 border-border overflow-hidden" />
      <div className="text-[10px] text-muted font-bold px-1">Drawdown</div>
      <div ref={drawdownContainerRef} className="w-full h-[80px] rounded-b-lg border border-border overflow-hidden" />
    </div>
  )
}

// Partner Program T-Bill Equity Chart Component
const PartnerTBillChart = ({
  data,
  theme,
}: {
  data: { time: UTCTimestamp; value: number }[]
  theme: ThemeMode
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const isDark = theme === 'dark'
    const bgColor = isDark ? '#1e293b' : '#ffffff'
    const textColor = isDark ? '#e2e8f0' : '#0f172a'
    const gridColor = isDark ? '#334155' : '#eef2f7'
    const borderColor = isDark ? '#475569' : '#cbd5e1'

    const chart = createChart(el, {
      width: el.clientWidth,
      height: 160,
      layout: { background: { type: ColorType.Solid, color: bgColor }, textColor },
      grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
      rightPriceScale: { borderColor },
      timeScale: { borderColor, rightOffset: 0, fixLeftEdge: true, fixRightEdge: true },
      handleScroll: false,
      handleScale: false
    })

    const series = chart.addSeries(AreaSeries, {
      lineColor: '#10b981', // emerald-500
      topColor: 'rgba(16, 185, 129, 0.3)',
      bottomColor: 'rgba(16, 185, 129, 0.0)',
      lineWidth: 1,
      priceFormat: { type: 'custom', formatter: (v: number) => `${v.toFixed(2)}%` },
    })

    chartRef.current = chart
    seriesRef.current = series

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth })
    })
    ro.observe(el)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [theme])

  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return
    seriesRef.current.setData(data)
    chartRef.current.timeScale().fitContent()
  }, [data])

  return (
    <div ref={containerRef} className="w-full h-[160px] rounded-lg border border-border overflow-hidden" />
  )
}

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

// Sanity & Risk Report Types
type SanityReportPercentiles = { p5: number; p25: number; p50: number; p75: number; p95: number; histogram?: { min: number; max: number; midpoint: number; count: number }[] }
type ComparisonMetrics = {
  cagr50: number
  maxdd50: number
  maxdd95: number
  calmar50: number
  calmar95: number
  sharpe: number
  sortino: number
  volatility: number
  winRate: number
  beta: number
  treynor: number
}
type SanityReportPathRisk = {
  monteCarlo: { drawdowns: SanityReportPercentiles; cagrs: SanityReportPercentiles; sharpes?: SanityReportPercentiles; volatilities?: SanityReportPercentiles }
  kfold: { drawdowns: SanityReportPercentiles; cagrs: SanityReportPercentiles; sharpes?: SanityReportPercentiles; volatilities?: SanityReportPercentiles }
  drawdownProbabilities: { gt20: number; gt30: number; gt40: number; gt50: number }
  comparisonMetrics?: { monteCarlo: ComparisonMetrics; kfold: ComparisonMetrics }
}
type SanityReportFragility = {
  subPeriodStability: { level: string; concentrationPct: number; detail: string; blockReturns: number[] }
  profitConcentration: { level: string; top5DaysPct: number; top10DaysPct: number; detail: string }
  smoothnessScore: { level: string; actualMaxDD: number; shuffledP50: number; ratio: number; detail: string }
  thinningFragility: { level: string; originalCagr: number; medianThinnedCagr: number; cagrDrop: number; detail: string }
}
type SanityReport = {
  original: { cagr: number; maxDD: number; tradingDays: number }
  pathRisk: SanityReportPathRisk
  fragility: SanityReportFragility
  summary: string[]
  meta: { mcSimulations: number; kfFolds: number; generatedAt: string }
}
type SanityReportState = { status: 'idle' | 'loading' | 'done' | 'error'; report?: SanityReport; error?: string }

const toUtcSeconds = (t: Time | null | undefined): UTCTimestamp | null => {
  if (t == null) return null
  if (typeof t === 'number' && Number.isFinite(t)) return t as UTCTimestamp
  if (typeof t === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t)
    const ms = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : Date.parse(t)
    return Number.isFinite(ms) ? (Math.floor(ms / 1000) as UTCTimestamp) : null
  }
  const bd = t as BusinessDay
  const y = Number(bd.year)
  const m = Number(bd.month)
  const d = Number(bd.day)
  if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
    const ms = Date.UTC(y, m - 1, d)
    return Math.floor(ms / 1000) as UTCTimestamp
  }
  return null
}

const clampVisibleRangeToPoints = (points: EquityPoint[], range: VisibleRange): VisibleRange => {
  const times = (points || []).map((p) => Number(p.time)).filter(Number.isFinite)
  if (times.length === 0) return range
  const minT = times[0]
  const maxT = times[times.length - 1]
  let from = Math.max(minT, Math.min(maxT, Number(range.from)))
  let to = Math.max(minT, Math.min(maxT, Number(range.to)))
  if (to < from) [from, to] = [to, from]

  // snap to closest existing points so charts stay aligned to bars
  const snap = (t: number) => {
    let best = times[0]
    let bestDist = Math.abs(times[0] - t)
    // linear scan is OK for daily-sized arrays (<= ~20k); if this grows, switch to binary search
    for (const x of times) {
      const d = Math.abs(x - t)
      if (d < bestDist) {
        best = x
        bestDist = d
      }
    }
    return best
  }
  from = snap(from)
  to = snap(to)
  if (to < from) [from, to] = [to, from]
  return { from: from as UTCTimestamp, to: to as UTCTimestamp }
}

const sanitizeSeriesPoints = (points: EquityPoint[], opts?: { clampMin?: number; clampMax?: number }) => {
  const out: EquityPoint[] = []
  let lastTime = -Infinity
  const min = opts?.clampMin
  const max = opts?.clampMax
  for (const p of points || []) {
    const time = Number(p.time)
    let value = Number(p.value)
    if (!Number.isFinite(time) || !Number.isFinite(value)) continue
    if (time <= lastTime) continue
    if (min != null) value = Math.max(min, value)
    if (max != null) value = Math.min(max, value)
    out.push({ time: time as UTCTimestamp, value })
    lastTime = time
  }
  return out
}

function EquityChart({
  points,
  benchmarkPoints,
  markers,
  visibleRange,
  onVisibleRangeChange,
  logScale,
  showCursorStats = true,
  heightPx,
  indicatorOverlays,
  theme = 'light',
}: {
  points: EquityPoint[]
  benchmarkPoints?: EquityPoint[]
  markers: EquityMarker[]
  visibleRange?: VisibleRange
  onVisibleRangeChange?: (range: VisibleRange) => void
  logScale?: boolean
  showCursorStats?: boolean
  heightPx?: number
  indicatorOverlays?: IndicatorOverlayData[]
  theme?: 'dark' | 'light'
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const benchRef = useRef<ISeriesApi<'Line'> | null>(null)
  const cursorSegRef = useRef<ISeriesApi<'Line'> | null>(null)
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const indicatorSeriesRef = useRef<Array<{ left: ISeriesApi<'Line'>; right?: ISeriesApi<'Line'>; threshold?: ISeriesApi<'Line'> }>>([])
  const indicatorOverlaysRef = useRef<IndicatorOverlayData[]>([])
  const [overlayValuesAtCursor, setOverlayValuesAtCursor] = useState<Array<{ label: string; value: number | null; rightLabel?: string | null; rightValue?: number | null; threshold?: number | null; color: string }>>([])

  const baseLineRef = useRef<IPriceLine | null>(null)
  const baseEquityRef = useRef<number>(1)
  const pointsRef = useRef<EquityPoint[]>([])
  const visibleRangeRef = useRef<VisibleRange | undefined>(visibleRange)
  const onVisibleRangeChangeRef = useRef<((range: VisibleRange) => void) | undefined>(onVisibleRangeChange)
  const lastEmittedRangeKeyRef = useRef<string>('')
  const lastCursorTimeRef = useRef<UTCTimestamp | null>(null)
  const segRafRef = useRef<number | null>(null)
  const segKeyRef = useRef<string>('')
  const isUpdatingSegRef = useRef<boolean>(false)

  const chartHeight = heightPx ?? 520

  useEffect(() => {
    pointsRef.current = points || []
  }, [points])

  useEffect(() => {
    visibleRangeRef.current = visibleRange
  }, [visibleRange])

  useEffect(() => {
    onVisibleRangeChangeRef.current = onVisibleRangeChange
  }, [onVisibleRangeChange])

  const formatReturnFromBase = useCallback((equity: number) => {
    const base = baseEquityRef.current || 1
    if (!(Number.isFinite(equity) && Number.isFinite(base) && base > 0)) return '—'
    return `${(((equity / base) - 1) * 100).toFixed(2)}%`
  }, [])

  const computeWindowStats = useCallback((cursorTime: UTCTimestamp): { cagr: number; maxDD: number } | null => {
    const pts = pointsRef.current
    if (!pts || pts.length < 2) return null

    const vr = visibleRangeRef.current
    const startTime = vr?.from ?? pts[0].time
    const endTime = cursorTime
    if (!(Number(startTime) <= Number(endTime))) return null

    let startIdx = 0
    while (startIdx < pts.length && Number(pts[startIdx].time) < Number(startTime)) startIdx++
    let endIdx = startIdx
    while (endIdx < pts.length && Number(pts[endIdx].time) <= Number(endTime)) endIdx++
    endIdx = Math.max(startIdx, endIdx - 1)
    if (endIdx <= startIdx) return null

    const startEquity = pts[startIdx].value
    const endEquity = pts[endIdx].value
    const periods = Math.max(1, endIdx - startIdx)
    const cagr = startEquity > 0 && endEquity > 0 ? Math.pow(endEquity / startEquity, 252 / periods) - 1 : 0

    let peak = -Infinity
    let maxDD = 0
    for (let i = startIdx; i <= endIdx; i++) {
      const v = pts[i].value
      if (!Number.isFinite(v)) continue
      if (v > peak) peak = v
      if (peak > 0) {
        const dd = v / peak - 1
        if (dd < maxDD) maxDD = dd
      }
    }

    return { cagr, maxDD }
  }, [])

  const updateCursorSegment = useCallback((cursorTime: UTCTimestamp) => {
    const seg = cursorSegRef.current
    const pts = pointsRef.current
    if (!seg || !pts || pts.length < 2) return
    if (isUpdatingSegRef.current) return // Prevent infinite recursion

    const vr = visibleRangeRef.current
    const startTime = vr?.from ?? pts[0].time
    const endTime = cursorTime
    if (!(Number(startTime) <= Number(endTime))) {
      isUpdatingSegRef.current = true
      try { seg.setData([]) } finally { isUpdatingSegRef.current = false }
      return
    }

    const key = `${Number(startTime)}:${Number(endTime)}`
    if (key === segKeyRef.current) return
    segKeyRef.current = key

    if (segRafRef.current != null) cancelAnimationFrame(segRafRef.current)
    segRafRef.current = requestAnimationFrame(() => {
      segRafRef.current = null
      if (isUpdatingSegRef.current) return

      let startIdx = 0
      while (startIdx < pts.length && Number(pts[startIdx].time) < Number(startTime)) startIdx++
      let endIdx = startIdx
      while (endIdx < pts.length && Number(pts[endIdx].time) <= Number(endTime)) endIdx++
      endIdx = Math.max(startIdx, endIdx - 1)
      if (endIdx <= startIdx) {
        isUpdatingSegRef.current = true
        try { seg.setData([]) } finally { isUpdatingSegRef.current = false }
        return
      }

      isUpdatingSegRef.current = true
      try { seg.setData(pts.slice(startIdx, endIdx + 1) as unknown as LineData<Time>[]) } finally { isUpdatingSegRef.current = false }
    })
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    el.style.position = 'relative'

    const innerWidth = () => {
      const { width } = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      const border =
        parseFloat(cs.borderLeftWidth || '0') +
        parseFloat(cs.borderRightWidth || '0') +
        parseFloat(cs.paddingLeft || '0') +
        parseFloat(cs.paddingRight || '0')
      return Math.max(0, width - border)
    }

    const isDark = theme === 'dark'
    const bgColor = isDark ? '#1e293b' : '#ffffff'
    const textColor = isDark ? '#e2e8f0' : '#0f172a'
    const gridColor = isDark ? '#334155' : '#eef2f7'
    const borderColor = isDark ? '#475569' : '#cbd5e1'

    const chart = createChart(el, {
      width: Math.floor(innerWidth()),
      height: chartHeight,
      layout: { background: { type: ColorType.Solid, color: bgColor }, textColor },
      grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
      crosshair: { vertLine: { labelVisible: false }, horzLine: { labelVisible: false } },
      rightPriceScale: { borderColor, mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal },
      timeScale: { borderColor, rightOffset: 0, fixLeftEdge: true, fixRightEdge: true },
      handleScroll: false,
      handleScale: false
    })
    const series = chart.addSeries(LineSeries, {
      color: '#0ea5e9',
      lineWidth: 2,
      priceFormat: { type: 'custom', formatter: (v: number) => formatReturnFromBase(v) },
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
        const o = original()
        const base = baseEquityRef.current || 1
        if (!o || !o.priceRange || !(Number.isFinite(base) && base > 0)) return o
        const { minValue, maxValue } = o.priceRange
        return {
          ...o,
          priceRange: {
            minValue: Math.min(base, minValue),
            maxValue: Math.max(base, maxValue),
          },
        }
      },
    })
    const bench = chart.addSeries(LineSeries, {
      color: '#64748b',
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceFormat: { type: 'custom', formatter: (v: number) => formatReturnFromBase(v) },
    })
    const cursorSeg = chart.addSeries(LineSeries, {
      color: '#16a34a',
      lineWidth: 3,
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: { type: 'custom', formatter: (v: number) => formatReturnFromBase(v) },
    })
    chartRef.current = chart
    seriesRef.current = series
    benchRef.current = bench
    cursorSegRef.current = cursorSeg
    markersRef.current = createSeriesMarkers(series, [])

    // Only create overlay if showCursorStats is true
    if (showCursorStats) {
      const overlay = document.createElement('div')
      overlay.className = 'chart-hover-overlay'
      el.appendChild(overlay)
      overlayRef.current = overlay

      // Always show overlay in center with stats
      overlay.style.display = 'block'
      overlay.innerHTML = `<div class="chart-hover-date">Hover to see stats</div>
<div class="chart-hover-stats">
  <div class="chart-hover-stat"><span class="chart-hover-label">CAGR</span> <span class="chart-hover-value">—</span></div>
  <div class="chart-hover-stat"><span class="chart-hover-label">Max DD</span> <span class="chart-hover-value">—</span></div>
</div>`
    }

    chart.subscribeCrosshairMove((param: MouseEventParams<Time>) => {
      if (!showCursorStats) return
      if (isUpdatingSegRef.current) return // Prevent infinite recursion
      const overlay = overlayRef.current
      if (!overlay) return
      const time = toUtcSeconds(param.time)
      if (!time) {
        // Keep overlay visible but show placeholder when not hovering
        lastCursorTimeRef.current = null
        segKeyRef.current = ''
        isUpdatingSegRef.current = true
        try { cursorSeg.setData([]) } finally { isUpdatingSegRef.current = false }
        return
      }
      lastCursorTimeRef.current = time
      const stats = computeWindowStats(time)
      updateCursorSegment(time)
      overlay.innerHTML = `<div class="chart-hover-date">${isoFromUtcSeconds(time)}</div>
<div class="chart-hover-stats">
  <div class="chart-hover-stat"><span class="chart-hover-label">CAGR</span> <span class="chart-hover-value">${stats ? formatPct(stats.cagr) : '—'}</span></div>
  <div class="chart-hover-stat"><span class="chart-hover-label">Max DD</span> <span class="chart-hover-value">${stats ? formatPct(stats.maxDD) : '—'}</span></div>
</div>`
    })

    const handleVisibleRangeChange: TimeRangeChangeEventHandler<Time> = (r) => {
      const cb = onVisibleRangeChangeRef.current
      if (!cb || !r) return
      const from = toUtcSeconds(r.from)
      const to = toUtcSeconds(r.to)
      if (!from || !to) return
      const next = { from, to }
      const key = `${Number(next.from)}:${Number(next.to)}`
      if (key === lastEmittedRangeKeyRef.current) return
      lastEmittedRangeKeyRef.current = key
      cb(next)
    }
    chart.timeScale().subscribeVisibleTimeRangeChange(handleVisibleRangeChange)

    const ro = new ResizeObserver(() => {
      if (!chartRef.current) return // Guard against disposed chart
      chart.applyOptions({ width: Math.floor(innerWidth()) })
      const vr = visibleRangeRef.current
      if (vr) {
        try {
          chart.timeScale().setVisibleRange(vr)
        } catch {
          // ignore
        }
      }
    })
    ro.observe(el)

    return () => {
      ro.disconnect()
      if (segRafRef.current != null) cancelAnimationFrame(segRafRef.current)
      segRafRef.current = null
      try {
        overlayRef.current?.remove()
      } catch {
        // ignore
      }
      // Detach markers BEFORE removing chart to avoid "Object is disposed" error
      try {
        markersRef.current?.detach()
      } catch {
        // ignore
      }
      markersRef.current = null
      chart.timeScale().unsubscribeVisibleTimeRangeChange(handleVisibleRangeChange)
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      benchRef.current = null
      cursorSegRef.current = null
      overlayRef.current = null
      baseLineRef.current = null
    }
  }, [computeWindowStats, formatReturnFromBase, logScale, showCursorStats, chartHeight, updateCursorSegment])

  useEffect(() => {
    if (!seriesRef.current) return
    const main = sanitizeSeriesPoints(points)
    // Set base to first point in visible range (or first point if no range)
    if (main.length > 0) {
      if (visibleRange) {
        const fromTime = Number(visibleRange.from)
        const firstVisibleIdx = main.findIndex(p => Number(p.time) >= fromTime)
        baseEquityRef.current = firstVisibleIdx >= 0 ? main[firstVisibleIdx].value : main[0].value
      } else {
        baseEquityRef.current = main[0].value
      }
    }
    seriesRef.current.setData(main)
    cursorSegRef.current?.setData([])
    segKeyRef.current = ''
    lastCursorTimeRef.current = null
    const base = baseEquityRef.current
    if (Number.isFinite(base) && base > 0) {
      const existing = baseLineRef.current
      if (!existing) {
        baseLineRef.current = seriesRef.current.createPriceLine({
          price: base,
          color: '#0f172a',
          lineWidth: 3,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: '0%',
        })
      } else if (existing?.applyOptions) {
        existing.applyOptions({ price: base })
      }
    }
    markersRef.current?.setMarkers(
      (markers || []).slice(0, 80).map((m) => ({
        time: m.time,
        position: 'aboveBar',
        color: '#b91c1c',
        shape: 'circle',
        text: m.text,
      })) as SeriesMarker<Time>[],
    )
    if (benchRef.current) {
      if (benchmarkPoints && benchmarkPoints.length > 0) {
        benchRef.current.setData(sanitizeSeriesPoints(benchmarkPoints))
      } else {
        benchRef.current.setData([])
      }
    }
    const chart = chartRef.current
    if (!chart) return
    if (visibleRange && visibleRange.from && visibleRange.to) {
      chart.timeScale().setVisibleRange(visibleRange)
      return
    }
    if (main.length > 1 && main[0]?.time && main[main.length - 1]?.time) {
      chart.timeScale().setVisibleRange({ from: main[0].time, to: main[main.length - 1].time })
      return
    }
    chart.timeScale().fitContent()
  }, [points, benchmarkPoints, markers, visibleRange, logScale])

  useEffect(() => {
    if (!showCursorStats) return
    const time = lastCursorTimeRef.current
    if (!time) return
    const overlay = overlayRef.current
    if (!overlay) return
    const stats = computeWindowStats(time)

    // Build indicator overlay values HTML
    const overlayHtml = overlayValuesAtCursor.map(ov => {
      const leftVal = ov.value != null ? ov.value.toFixed(2) : '—'
      if (ov.rightLabel && ov.rightValue != null) {
        // Two-indicator comparison
        return `<div class="chart-hover-stat" style="border-left: 3px solid ${ov.color}; padding-left: 6px;">
          <span class="chart-hover-label" style="color: ${ov.color}">${ov.label}</span> <span class="chart-hover-value">${leftVal}</span>
          <span class="chart-hover-label" style="color: ${ov.color}; margin-left: 8px;">${ov.rightLabel}</span> <span class="chart-hover-value">${ov.rightValue.toFixed(2)}</span>
        </div>`
      } else if (ov.threshold != null) {
        // Threshold comparison
        return `<div class="chart-hover-stat" style="border-left: 3px solid ${ov.color}; padding-left: 6px;">
          <span class="chart-hover-label" style="color: ${ov.color}">${ov.label}</span> <span class="chart-hover-value">${leftVal}</span>
          <span class="chart-hover-label" style="margin-left: 8px;">Thresh</span> <span class="chart-hover-value">${ov.threshold}</span>
        </div>`
      }
      return `<div class="chart-hover-stat" style="border-left: 3px solid ${ov.color}; padding-left: 6px;">
        <span class="chart-hover-label" style="color: ${ov.color}">${ov.label}</span> <span class="chart-hover-value">${leftVal}</span>
      </div>`
    }).join('')

    overlay.innerHTML = `<div class="chart-hover-date">${isoFromUtcSeconds(time)}</div>
<div class="chart-hover-stats">
  <div class="chart-hover-stat"><span class="chart-hover-label">CAGR</span> <span class="chart-hover-value">${stats ? formatPct(stats.cagr) : '—'}</span></div>
  <div class="chart-hover-stat"><span class="chart-hover-label">Max DD</span> <span class="chart-hover-value">${stats ? formatPct(stats.maxDD) : '—'}</span></div>
  ${overlayHtml}
</div>`
    updateCursorSegment(time)
  }, [computeWindowStats, showCursorStats, updateCursorSegment, visibleRange, overlayValuesAtCursor])

  // Handle indicator overlay series creation/updates
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    // Store current overlays ref
    indicatorOverlaysRef.current = indicatorOverlays || []

    // Remove old indicator series
    indicatorSeriesRef.current.forEach(s => {
      try { chart.removeSeries(s.left) } catch { /* ignore */ }
      if (s.right) try { chart.removeSeries(s.right) } catch { /* ignore */ }
      if (s.threshold) try { chart.removeSeries(s.threshold) } catch { /* ignore */ }
    })
    indicatorSeriesRef.current = []

    // Add new indicator series
    if (!indicatorOverlays || indicatorOverlays.length === 0) {
      setOverlayValuesAtCursor([])
      return
    }

    // Helper to get a contrasting color for the right indicator
    const colorPairs: Record<string, string> = {
      '#f59e0b': '#8b5cf6', // Amber -> Violet
      '#10b981': '#ec4899', // Emerald -> Pink
      '#8b5cf6': '#f59e0b', // Violet -> Amber
      '#ec4899': '#10b981', // Pink -> Emerald
      '#06b6d4': '#f97316', // Cyan -> Orange
      '#f97316': '#06b6d4', // Orange -> Cyan
    }
    const getContrastingColor = (color: string): string => {
      return colorPairs[color] || '#8b5cf6'
    }

    indicatorOverlays.forEach((overlay) => {
      // Convert date strings to timestamps and filter null values
      const leftData = overlay.leftSeries
        .filter(p => p.value != null)
        .map(p => ({
          time: (new Date(p.date).getTime() / 1000) as UTCTimestamp,
          value: p.value as number
        }))

      // Create left series with separate left Y-axis
      const leftSeries = chart.addSeries(LineSeries, {
        color: overlay.color,
        lineWidth: 1,
        priceScaleId: 'left',
        priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      })
      leftSeries.setData(leftData as LineData<UTCTimestamp>[])

      const seriesEntry: { left: ISeriesApi<'Line'>; right?: ISeriesApi<'Line'>; threshold?: ISeriesApi<'Line'> } = { left: leftSeries }

      // Create right series if expanded mode
      if (overlay.rightSeries && overlay.rightSeries.length > 0) {
        const rightData = overlay.rightSeries
          .filter(p => p.value != null)
          .map(p => ({
            time: (new Date(p.date).getTime() / 1000) as UTCTimestamp,
            value: p.value as number
          }))

        const rightColor = getContrastingColor(overlay.color)
        const rightSeries = chart.addSeries(LineSeries, {
          color: rightColor,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          priceScaleId: 'left',
          priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
        })
        rightSeries.setData(rightData as LineData<UTCTimestamp>[])
        seriesEntry.right = rightSeries
      }

      // Create threshold line if not expanded
      if (overlay.threshold != null && !overlay.rightSeries) {
        const thresholdData = leftData.map(p => ({
          time: p.time,
          value: overlay.threshold as number
        }))
        const thresholdSeries = chart.addSeries(LineSeries, {
          color: overlay.color,
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          priceScaleId: 'left',
          priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
        })
        thresholdSeries.setData(thresholdData as LineData<UTCTimestamp>[])
        seriesEntry.threshold = thresholdSeries
      }

      indicatorSeriesRef.current.push(seriesEntry)
    })

    // Enable left price scale if we have overlays
    chart.applyOptions({
      leftPriceScale: {
        visible: true,
        borderColor: '#cbd5e1',
      }
    })
  }, [indicatorOverlays])

  // Update overlay values on crosshair move
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    if (!indicatorOverlays || indicatorOverlays.length === 0) return

    const handleCrosshair = (param: MouseEventParams<Time>) => {
      if (!param.time) {
        setOverlayValuesAtCursor([])
        return
      }

      const cursorTime = param.time as UTCTimestamp
      const isoDate = isoFromUtcSeconds(cursorTime)

      const values = indicatorOverlays.map(overlay => {
        const leftPoint = overlay.leftSeries.find(p => p.date === isoDate)
        const rightPoint = overlay.rightSeries?.find(p => p.date === isoDate)

        return {
          label: overlay.label,
          value: leftPoint?.value ?? null,
          rightLabel: overlay.rightLabel,
          rightValue: rightPoint?.value ?? null,
          threshold: overlay.threshold,
          color: overlay.color
        }
      })

      setOverlayValuesAtCursor(values)
    }

    chart.subscribeCrosshairMove(handleCrosshair)
    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshair)
    }
  }, [indicatorOverlays])

  return (
    <div
      ref={containerRef}
      className="w-full rounded-xl border border-border overflow-hidden"
      style={{ height: chartHeight }}
  />
  )
}

function DrawdownChart({
  points,
  visibleRange,
  onVisibleRangeChange,
  theme = 'light',
}: {
  points: EquityPoint[]
  visibleRange?: VisibleRange
  onVisibleRangeChange?: (range: VisibleRange) => void
  theme?: 'dark' | 'light'
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null)
  const visibleRangeRef = useRef<VisibleRange | undefined>(visibleRange)
  const onVisibleRangeChangeRef = useRef(onVisibleRangeChange)
  const lastEmittedRangeKeyRef = useRef<string>('')

  useEffect(() => {
    visibleRangeRef.current = visibleRange
  }, [visibleRange])

  useEffect(() => {
    onVisibleRangeChangeRef.current = onVisibleRangeChange
  }, [onVisibleRangeChange])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const innerWidth = () => {
      const { width } = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      const border =
        parseFloat(cs.borderLeftWidth || '0') +
        parseFloat(cs.borderRightWidth || '0') +
        parseFloat(cs.paddingLeft || '0') +
        parseFloat(cs.paddingRight || '0')
      return Math.max(0, width - border)
    }

    const isDark = theme === 'dark'
    const bgColor = isDark ? '#1e293b' : '#ffffff'
    const textColor = isDark ? '#e2e8f0' : '#0f172a'
    const gridColor = isDark ? '#334155' : '#eef2f7'
    const borderColor = isDark ? '#475569' : '#cbd5e1'

    const chart = createChart(el, {
      width: Math.floor(innerWidth()),
      height: 130,
      layout: { background: { type: ColorType.Solid, color: bgColor }, textColor },
      grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
      rightPriceScale: { borderColor },
      timeScale: { borderColor, rightOffset: 0, fixLeftEdge: true, fixRightEdge: true },
      handleScroll: false,
      handleScale: false
    })
    const series = chart.addSeries(AreaSeries, {
      lineColor: '#ef4444',
      topColor: 'rgba(239, 68, 68, 0.22)',
      bottomColor: 'rgba(239, 68, 68, 0.02)',
      lineWidth: 1,
      priceFormat: {
        type: 'custom',
        formatter: (v: number) => {
          if (!Number.isFinite(v)) return '—'
          const pct = Math.round(v * 100)
          if (pct === 0 && v < 0) return '-0%'
          return `${pct}%`
        },
      },
    })
    chartRef.current = chart
    seriesRef.current = series

    const handleVisibleRangeChange: TimeRangeChangeEventHandler<Time> = (r) => {
      const cb = onVisibleRangeChangeRef.current
      if (!cb || !r) return
      const from = toUtcSeconds(r.from)
      const to = toUtcSeconds(r.to)
      if (!from || !to) return
      const next = { from, to }
      const key = `${Number(next.from)}:${Number(next.to)}`
      if (key === lastEmittedRangeKeyRef.current) return
      lastEmittedRangeKeyRef.current = key
      cb(next)
    }
    chart.timeScale().subscribeVisibleTimeRangeChange(handleVisibleRangeChange)

    const ro = new ResizeObserver(() => {
      if (!chartRef.current) return // Guard against disposed chart
      chart.applyOptions({ width: Math.floor(innerWidth()) })
      const vr = visibleRangeRef.current
      if (vr) {
        try {
          chart.timeScale().setVisibleRange(vr)
        } catch {
          // ignore
        }
      }
    })
    ro.observe(el)

    return () => {
      ro.disconnect()
      chart.timeScale().unsubscribeVisibleTimeRangeChange(handleVisibleRangeChange)
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!seriesRef.current) return
    const dd = sanitizeSeriesPoints(points, { clampMin: -0.9999, clampMax: 0 })
    seriesRef.current.setData(dd)
    const chart = chartRef.current
    if (!chart) return
    if (visibleRange && visibleRange.from && visibleRange.to) {
      chart.timeScale().setVisibleRange(visibleRange)
      return
    }
    if (dd.length > 1 && dd[0]?.time && dd[dd.length - 1]?.time) {
      chart.timeScale().setVisibleRange({ from: dd[0].time, to: dd[dd.length - 1].time })
      return
    }
    chart.timeScale().fitContent()
  }, [points, visibleRange])

  return (
    <div
      ref={containerRef}
      className="w-full h-[130px] rounded-xl border border-border overflow-hidden"
    />
  )
}

function RangeNavigator({
  points,
  range,
  onChange,
  theme = 'light',
}: {
  points: EquityPoint[]
  range: VisibleRange
  onChange: (range: VisibleRange) => void
  theme?: 'dark' | 'light'
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const windowRef = useRef<HTMLDivElement | null>(null)
  const shadeLeftRef = useRef<HTMLDivElement | null>(null)
  const shadeRightRef = useRef<HTMLDivElement | null>(null)
  const rangeRef = useRef<VisibleRange>(range)
  const pointsRef = useRef<EquityPoint[]>(points)
  const onChangeRef = useRef(onChange)
  const rafRef = useRef<number | null>(null)

  const dragRef = useRef<
    | null
    | {
        kind: 'move' | 'left' | 'right'
        startClientX: number
        startFromX: number
        startToX: number
        containerLeft: number
        containerWidth: number
      }
  >(null)

  useEffect(() => {
    rangeRef.current = range
  }, [range])

  useEffect(() => {
    pointsRef.current = points || []
  }, [points])

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const syncOverlay = useCallback(() => {
    const chart = chartRef.current
    const el = containerRef.current
    const win = windowRef.current
    const shadeL = shadeLeftRef.current
    const shadeR = shadeRightRef.current
    if (!chart || !el || !win || !shadeL || !shadeR) return

    const rangeFrom = rangeRef.current?.from
    const rangeTo = rangeRef.current?.to
    if (!rangeFrom || !rangeTo) return

    const rect = el.getBoundingClientRect()
    const fromCoord = chart.timeScale().timeToCoordinate(rangeFrom)
    const toCoord = chart.timeScale().timeToCoordinate(rangeTo)
    if (fromCoord == null || toCoord == null) return
    const fromX = Number(fromCoord)
    const toX = Number(toCoord)

    const left = Math.max(0, Math.min(rect.width, Math.min(fromX, toX)))
    const right = Math.max(0, Math.min(rect.width, Math.max(fromX, toX)))
    const width = Math.max(20, right - left)
    const clampedRight = Math.min(rect.width, left + width)

    win.style.left = `${Math.round(left)}px`
    win.style.width = `${Math.round(clampedRight - left)}px`

    shadeL.style.left = '0px'
    shadeL.style.width = `${Math.round(left)}px`

    shadeR.style.left = `${Math.round(clampedRight)}px`
    shadeR.style.width = `${Math.round(Math.max(0, rect.width - clampedRight))}px`
  }, [])

  const scheduleSync = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      syncOverlay()
    })
  }, [syncOverlay])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    el.style.position = 'relative'

    const innerWidth = () => {
      const { width } = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      const border =
        parseFloat(cs.borderLeftWidth || '0') +
        parseFloat(cs.borderRightWidth || '0') +
        parseFloat(cs.paddingLeft || '0') +
        parseFloat(cs.paddingRight || '0')
      return Math.max(0, width - border)
    }

    const isDark = theme === 'dark'
    const bgColor = isDark ? '#1e293b' : '#ffffff'
    const textColor = isDark ? '#e2e8f0' : '#0f172a'
    const gridColor = isDark ? '#334155' : '#eef2f7'
    const borderColor = isDark ? '#475569' : '#cbd5e1'

    const chart = createChart(el, {
      width: Math.floor(innerWidth()),
      height: 110,
      layout: { background: { type: ColorType.Solid, color: bgColor }, textColor },
      grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
      rightPriceScale: { visible: false },
      leftPriceScale: { visible: false },
      timeScale: { visible: false, borderColor, fixLeftEdge: true, fixRightEdge: true },
      handleScroll: false,
      handleScale: false
    })
    const series = chart.addSeries(LineSeries, { color: '#94a3b8', lineWidth: 1 })
    chartRef.current = chart
    seriesRef.current = series

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: Math.floor(innerWidth()) })
      scheduleSync()
    })
    ro.observe(el)

    scheduleSync()

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [scheduleSync])

  useEffect(() => {
    const chart = chartRef.current
    const series = seriesRef.current
    if (!chart || !series) return
    const data = sanitizeSeriesPoints(points)
    series.setData(data)
    chart.timeScale().fitContent()
    scheduleSync()
  }, [points, scheduleSync])

  useEffect(() => {
    scheduleSync()
  }, [range, scheduleSync])

  const handleWindowPointerMove = useCallback((e: PointerEvent) => {
    const chart = chartRef.current
    const el = containerRef.current
    const drag = dragRef.current
    if (!chart || !el || !drag) return

    const x = e.clientX
    const dx = x - drag.startClientX
    const minWidthPx = 20

    let fromX = drag.startFromX
    let toX = drag.startToX
    if (drag.kind === 'move') {
      fromX += dx
      toX += dx
    } else if (drag.kind === 'left') {
      fromX += dx
    } else {
      toX += dx
    }

    fromX = Math.max(0, Math.min(drag.containerWidth, fromX))
    toX = Math.max(0, Math.min(drag.containerWidth, toX))

    if (Math.abs(toX - fromX) < minWidthPx) {
      if (drag.kind === 'left') fromX = toX - minWidthPx
      else if (drag.kind === 'right') toX = fromX + minWidthPx
      else toX = fromX + minWidthPx
      fromX = Math.max(0, Math.min(drag.containerWidth, fromX))
      toX = Math.max(0, Math.min(drag.containerWidth, toX))
    }

    const fromT = toUtcSeconds(chart.timeScale().coordinateToTime(fromX))
    const toT = toUtcSeconds(chart.timeScale().coordinateToTime(toX))
    if (!fromT || !toT) return

    const pts = pointsRef.current
    if (!pts.length) return
    const next = clampVisibleRangeToPoints(pts, { from: fromT, to: toT })
    onChangeRef.current(next)
  }, [])

  const handleWindowPointerUp = useCallback(() => {
    dragRef.current = null
    window.removeEventListener('pointermove', handleWindowPointerMove)
  }, [handleWindowPointerMove])

  const stopDragging = useCallback(() => {
    dragRef.current = null
    window.removeEventListener('pointermove', handleWindowPointerMove)
    window.removeEventListener('pointerup', handleWindowPointerUp)
  }, [handleWindowPointerMove, handleWindowPointerUp])

  useEffect(() => {
    return () => {
      stopDragging()
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [stopDragging])

  const beginDrag = useCallback((kind: 'move' | 'left' | 'right', e: ReactPointerEvent<HTMLDivElement>) => {
    const chart = chartRef.current
    const el = containerRef.current
    if (!chart || !el) return

    e.preventDefault()
    e.stopPropagation()

    const rect = el.getBoundingClientRect()
    const fromCoord = chart.timeScale().timeToCoordinate(rangeRef.current.from)
    const toCoord = chart.timeScale().timeToCoordinate(rangeRef.current.to)
    if (fromCoord == null || toCoord == null) return
    const fromX = Number(fromCoord)
    const toX = Number(toCoord)

    dragRef.current = {
      kind,
      startClientX: e.clientX,
      startFromX: Number(fromX),
      startToX: Number(toX),
      containerLeft: rect.left,
      containerWidth: rect.width,
    }

    window.addEventListener('pointermove', handleWindowPointerMove)
    window.addEventListener('pointerup', handleWindowPointerUp, { once: true })
    scheduleSync()
  }, [handleWindowPointerMove, handleWindowPointerUp, scheduleSync])

  const handleBackgroundPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (windowRef.current && windowRef.current.contains(e.target as Node)) return
      const chart = chartRef.current
      const el = containerRef.current
      if (!chart || !el) return
      const rect = el.getBoundingClientRect()
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left))
      const clicked = toUtcSeconds(chart.timeScale().coordinateToTime(x))
      if (!clicked) return

      const prev = rangeRef.current
      const half = (Number(prev.to) - Number(prev.from)) / 2
      const from = (clicked - half) as UTCTimestamp
      const to = (clicked + half) as UTCTimestamp
      const pts = pointsRef.current
      if (!pts.length) return
      onChangeRef.current(clampVisibleRangeToPoints(pts, { from, to }))
    },
    [],
  )

  return (
    <div className="navigator-wrap">
      <div className="navigator-chart-wrap">
        <div
          ref={containerRef}
          className="navigator-chart w-full h-[110px] rounded-xl border border-border overflow-hidden"
        />
        <div className="navigator-overlay" onPointerDown={handleBackgroundPointerDown}>
          <div ref={shadeLeftRef} className="navigator-shade" />
          <div ref={shadeRightRef} className="navigator-shade" />
          <div ref={windowRef} className="navigator-window" onPointerDown={(e) => beginDrag('move', e)}>
            <div className="navigator-handle left" onPointerDown={(e) => beginDrag('left', e)} />
            <div className="navigator-handle right" onPointerDown={(e) => beginDrag('right', e)} />
          </div>
        </div>
      </div>
    </div>
  )
}

function AllocationChart({
  series,
  visibleRange,
  theme = 'light',
}: {
  series: Array<{ name: string; color: string; points: EquityPoint[] }>
  visibleRange?: VisibleRange
  theme?: 'dark' | 'light'
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRefs = useRef<Array<ISeriesApi<'Line'>>>([])
  const [legendData, setLegendData] = useState<{ time: string; allocations: Array<{ name: string; color: string; pct: number }> } | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const innerWidth = () => {
      const { width } = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      const border =
        parseFloat(cs.borderLeftWidth || '0') +
        parseFloat(cs.borderRightWidth || '0') +
        parseFloat(cs.paddingLeft || '0') +
        parseFloat(cs.paddingRight || '0')
      return Math.max(100, width - border) // Minimum 100px to avoid zero-width chart
    }

    const isDark = theme === 'dark'
    const bgColor = isDark ? '#1e293b' : '#ffffff'
    const textColor = isDark ? '#e2e8f0' : '#0f172a'
    const gridColor = isDark ? '#334155' : '#eef2f7'
    const borderColor = isDark ? '#475569' : '#cbd5e1'

    const chart = createChart(el, {
      width: Math.floor(innerWidth()),
      height: 240,
      layout: { background: { type: ColorType.Solid, color: bgColor }, textColor },
      grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
      rightPriceScale: {
        borderColor,
        scaleMargins: { top: 0, bottom: 0 },
      },
      timeScale: { borderColor, rightOffset: 0, fixLeftEdge: true, fixRightEdge: true },
      localization: {
        priceFormatter: (price: number) => `${(price * 100).toFixed(0)}%`,
      },
      crosshair: {
        horzLine: { visible: false, labelVisible: false },
        vertLine: { visible: true, labelVisible: true },
      },
    })
    chartRef.current = chart

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: Math.floor(innerWidth()) })
    })
    ro.observe(el)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRefs.current = []
    }
  }, [theme])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    for (const s of seriesRefs.current) {
      try {
        chart.removeSeries(s)
      } catch {
        // ignore
      }
    }
    seriesRefs.current = []

    // Build stacked data: each series shows cumulative allocation from bottom
    // We need to stack in reverse order (last series at bottom)
    const reversedSeries = [...series].reverse()

    // Build a map of time -> cumulative values for stacking
    const timeMap = new Map<number, number[]>()
    for (let i = 0; i < reversedSeries.length; i++) {
      for (const pt of reversedSeries[i].points) {
        const time = pt.time as number
        if (!timeMap.has(time)) {
          timeMap.set(time, new Array(reversedSeries.length).fill(0))
        }
        timeMap.get(time)![i] = pt.value
      }
    }

    // Compute cumulative sums for stacking
    const stackedData: Array<{ color: string; topColor: string; bottomColor: string; points: EquityPoint[] }> = []
    for (let i = 0; i < reversedSeries.length; i++) {
      const points: EquityPoint[] = []
      for (const [time, values] of timeMap) {
        let cumulative = 0
        for (let j = 0; j <= i; j++) {
          cumulative += values[j]
        }
        points.push({ time: time as UTCTimestamp, value: cumulative })
      }
      points.sort((a, b) => (a.time as number) - (b.time as number))
      const baseColor = reversedSeries[i].color
      stackedData.push({
        color: baseColor,
        topColor: baseColor + '80', // 50% opacity
        bottomColor: baseColor + '20', // 12% opacity
        points,
      })
    }

    // Add series from top to bottom (highest cumulative first)
    // The stacking works by drawing from back (100%) to front (smallest allocation)
    for (let i = stackedData.length - 1; i >= 0; i--) {
      const s = stackedData[i]
      const area = chart.addSeries(AreaSeries, {
        lineColor: s.color,
        topColor: s.topColor,
        bottomColor: s.bottomColor,
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false,
      })
      area.setData(sanitizeSeriesPoints(s.points, { clampMin: 0, clampMax: 1 }))
      seriesRefs.current.push(area as unknown as ISeriesApi<'Line'>)
    }

    if (visibleRange && visibleRange.from && visibleRange.to) {
      chart.timeScale().setVisibleRange(visibleRange)
    } else {
      chart.timeScale().fitContent()
    }

    // Add crosshair move handler for dynamic legend
    chart.subscribeCrosshairMove((param: MouseEventParams) => {
      if (!param.time || param.point === undefined) {
        setLegendData(null)
        return
      }

      const time = param.time as number
      const dateStr = new Date(time * 1000).toISOString().slice(0, 10)

      // Get allocations for this time point from original series (not stacked)
      const allocations: Array<{ name: string; color: string; pct: number }> = []
      for (const s of series) {
        const pt = s.points.find(p => (p.time as number) === time)
        if (pt && pt.value > 0.001) {
          allocations.push({ name: s.name, color: s.color, pct: pt.value * 100 })
        }
      }

      // Sort by percentage descending
      allocations.sort((a, b) => b.pct - a.pct)

      // Calculate cash (remaining to 100%)
      const totalPct = allocations.reduce((sum, a) => sum + a.pct, 0)
      const cashPct = Math.max(0, 100 - totalPct)
      if (cashPct > 0.1) {
        allocations.push({ name: 'Cash', color: '#64748b', pct: cashPct })
      }

      if (allocations.length > 0) {
        setLegendData({ time: dateStr, allocations })
      } else {
        setLegendData(null)
      }
    })
  }, [series, visibleRange, theme])

  const isDark = theme === 'dark'

  // Build default legend from series (when not hovering)
  const defaultLegend = series.map(s => ({ name: s.name, color: s.color }))

  return (
    <div className="flex gap-4" style={{ width: '100%' }}>
      <div
        ref={containerRef}
        className="h-[240px] rounded-xl border border-border overflow-hidden"
        style={{ flex: '1 1 0', minWidth: 0 }}
      />
      <div
        className="rounded-xl border border-border p-3 overflow-auto h-[240px]"
        style={{
          width: '200px',
          flexShrink: 0,
          background: isDark ? '#1e293b' : '#ffffff',
        }}
      >
          {legendData ? (
            <>
              <div className="font-bold text-sm mb-2 pb-2 border-b border-border">{legendData.time}</div>
              <div className="grid gap-1">
                {legendData.allocations.map((a) => (
                  <div key={a.name} className="flex items-center gap-2 text-sm">
                    <span className="w-3 h-3 rounded flex-shrink-0" style={{ background: a.color }} />
                    <span className="font-medium flex-1">{a.name}</span>
                    <span className="font-mono tabular-nums">{a.pct.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="font-bold text-sm mb-2 pb-2 border-b border-border text-muted">Hover for details</div>
              <div className="grid gap-1">
                {defaultLegend.map((s) => (
                  <div key={s.name} className="flex items-center gap-2 text-sm">
                    <span className="w-3 h-3 rounded flex-shrink-0" style={{ background: s.color }} />
                    <span className="font-medium">{s.name}</span>
                  </div>
                ))}
                <div className="flex items-center gap-2 text-sm">
                  <span className="w-3 h-3 rounded flex-shrink-0" style={{ background: '#64748b' }} />
                  <span className="font-medium">Cash</span>
                </div>
              </div>
            </>
          )}
      </div>
    </div>
  )
}

type TickerSearchResult = {
  ticker: string
  name: string | null
  description: string | null
  assetType: string | null
}

function AdminDataPanel({
  tickers,
  error,
}: {
  tickers: string[]
  error: string | null
}) {
  const [selected, setSelected] = useState<string>(() => tickers[0] || '')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [searchResults, setSearchResults] = useState<TickerSearchResult[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [dataError, setDataError] = useState<string | null>(null)
  const [preview, setPreview] = useState<AdminCandlesResponse['preview']>([])

  // Search tickers by metadata
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setSearchResults([])
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/tickers/registry/search?q=${encodeURIComponent(searchQuery)}&limit=10`, {
          signal: controller.signal
        })
        if (res.ok) {
          const data = await res.json() as TickerSearchResult[]
          setSearchResults(data)
        }
      } catch {
        // Ignore abort errors
      }
    }, 200) // Debounce

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [searchQuery])

  const load = useCallback(
    async (ticker: string) => {
      if (!ticker) return
      setLoading(true)
      setDataError(null)
      try {
        const res = await fetch(`/api/candles/${encodeURIComponent(ticker)}?limit=50`)
        const payload = (await res.json()) as AdminCandlesResponse | { error: string }
        if (!res.ok) throw new Error('error' in payload ? payload.error : `Request failed (${res.status})`)
        const p = payload as AdminCandlesResponse
        setPreview(p.preview || [])
      } catch (e) {
        setPreview([])
        setDataError(String((e as Error)?.message || e))
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    if (!selected && tickers[0]) setSelected(tickers[0])
  }, [selected, tickers])

  useEffect(() => {
    if (!selected) return
    void load(selected)
  }, [selected, load])

  const selectTicker = (ticker: string) => {
    setSelected(ticker)
    setSearchQuery('')
    setSearchResults([])
    setSearchOpen(false)
  }

  const combinedError = error || dataError

  return (
    <div>
      <div className="flex gap-2.5 items-center flex-wrap">
        <div className="font-extrabold">Search</div>
        <div className="relative">
          <Input
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              setSearchOpen(true)
            }}
            onFocus={() => setSearchOpen(true)}
            placeholder="Search by ticker, name, or description..."
            className="w-72"
          />
          {searchOpen && searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-lg z-50 max-h-60 overflow-auto">
              {searchResults.map((r) => (
                <button
                  key={r.ticker}
                  className="w-full px-3 py-2 text-left hover:bg-muted border-b border-border last:border-b-0"
                  onClick={() => selectTicker(r.ticker)}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-bold">{r.ticker}</span>
                    {r.assetType && (
                      <span className="text-xs px-1 py-0.5 bg-primary/10 text-primary rounded">
                        {r.assetType}
                      </span>
                    )}
                  </div>
                  {r.name && <div className="text-sm text-muted-foreground truncate">{r.name}</div>}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="font-extrabold">Selected:</div>
        <div className="font-mono bg-muted px-2 py-1 rounded">{selected || 'None'}</div>
        <Button onClick={() => void load(selected)} disabled={!selected || loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </Button>
      </div>

      {combinedError && <div className="mt-2.5 text-danger font-bold">{combinedError}</div>}

      <div className="mt-3">
        <div className="font-extrabold mb-1.5">Ticker data preview (last 50 rows)</div>
        <div className="max-h-[320px] overflow-auto border border-border rounded-xl bg-surface">
          <Table>
            <TableHeader>
              <TableRow>
                {['Date', 'Open', 'High', 'Low', 'Close'].map((h) => (
                  <TableHead key={h} className="sticky top-0 bg-surface">
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.map((r, idx) => (
                <TableRow key={idx}>
                  <TableCell className="whitespace-nowrap">{r.Date}</TableCell>
                  <TableCell>{r.Open}</TableCell>
                  <TableCell>{r.High}</TableCell>
                  <TableCell>{r.Low}</TableCell>
                  <TableCell>{r.Close}</TableCell>
                </TableRow>
              ))}
              {preview.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted">
                    No data loaded yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}

type AdminSubtab = 'Atlas Overview' | 'Nexus Maintenance' | 'Ticker Data' | 'User Management'

function AdminPanel({
  adminTab,
  setAdminTab,
  onTickersUpdated,
  savedBots,
  setSavedBots,
  onRefreshNexusBots,
  onPrewarmComplete,
  userId,
}: {
  adminTab: AdminSubtab
  setAdminTab: (t: AdminSubtab) => void
  onTickersUpdated?: (tickers: string[]) => void
  savedBots: SavedBot[]
  setSavedBots: React.Dispatch<React.SetStateAction<SavedBot[]>>
  onRefreshNexusBots?: () => Promise<void>
  onPrewarmComplete?: () => void
  userId: string
}) {
  const [, setStatus] = useState<AdminStatus | null>(null)
  const [, setTickers] = useState<string[]>([])
  const [parquetTickers, setParquetTickers] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  // Atlas Overview state
  const [adminStats, setAdminStats] = useState<AdminAggregatedStats | null>(null)
  const [adminConfig, setAdminConfig] = useState<AdminConfig>({ atlasFeePercent: 0, partnerProgramSharePercent: 0, eligibilityRequirements: [], atlasFundSlots: [] })
  const [savedConfig, setSavedConfig] = useState<AdminConfig>({ atlasFeePercent: 0, partnerProgramSharePercent: 0, eligibilityRequirements: [], atlasFundSlots: [] })
  const [feeBreakdown, setFeeBreakdown] = useState<TreasuryFeeBreakdown>({ atlasFeesTotal: 0, privateFeesTotal: 0, nexusFeesTotal: 0, nexusPartnerPaymentsTotal: 0 })
  const [treasury, setTreasury] = useState<TreasuryState>({ balance: 100000, entries: [] })
  const [configSaving, setConfigSaving] = useState(false)
  const [treasuryPeriod, setTreasuryPeriod] = useState<'1D' | '1M' | '3M' | '6M' | 'YTD' | '1Y' | 'ALL'>('ALL')

  // Eligibility requirements state
  const [eligibilityRequirements, setEligibilityRequirements] = useState<EligibilityRequirement[]>([])
  const [liveMonthsValue, setLiveMonthsValue] = useState(0)
  const [newMetric, setNewMetric] = useState<EligibilityMetric>('cagr')
  const [newComparison, setNewComparison] = useState<'at_least' | 'at_most'>('at_least')
  const [newMetricValue, setNewMetricValue] = useState(0)
  const [eligibilitySaving, setEligibilitySaving] = useState(false)

  // FRD-014: Cache management state
  const [cacheStats, setCacheStats] = useState<{ entryCount: number; totalSizeBytes: number; lastRefreshDate: string | null; currentDataDate: string } | null>(null)
  const [cacheRefreshing, setCacheRefreshing] = useState(false)
  const [prewarmRunning, setPrewarmRunning] = useState(false)

  // Ticker Registry state
  const [registryStats, setRegistryStats] = useState<{ total: number; active: number; syncedToday: number; pending: number; lastSync: string | null } | null>(null)
  const [registrySyncing, setRegistrySyncing] = useState(false)
  const [registryMsg, setRegistryMsg] = useState<string | null>(null)

  // Tiingo API Key state
  const [tiingoKeyStatus, setTiingoKeyStatus] = useState<{ hasKey: boolean; loading: boolean }>({ hasKey: false, loading: true })
  const [tiingoKeyInput, setTiingoKeyInput] = useState('')
  const [tiingoKeySaving, setTiingoKeySaving] = useState(false)

  // Sync Schedule state (for simplified admin panel)
  const [syncSchedule, setSyncSchedule] = useState<{
    config: { enabled: boolean; updateTime: string; timezone: string; batchSize?: number; sleepSeconds?: number }
    lastSync: { date: string; status: string; syncedCount?: number; tickerCount?: number; timestamp?: string } | null
    status: { isRunning: boolean; schedulerActive: boolean; currentJob?: { pid: number; syncedCount: number; tickerCount: number; startedAt: number } }
  } | null>(null)
  const [syncKilling, setSyncKilling] = useState(false)

  // Registry tickers (all tickers from Tiingo master list)
  const [registryTickers, setRegistryTickers] = useState<string[]>([])

  // Missing tickers download state
  const [missingDownloadJob, setMissingDownloadJob] = useState<{ jobId: string; status: string; saved: number; total: number } | null>(null)

  // User Management state (super admin only)
  type AdminUser = { id: string; username: string; email: string; displayName: string | null; role: string; status: string; createdAt: number; lastLoginAt: number | null; isSuperAdmin: boolean }
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([])
  const [adminUsersLoading, setAdminUsersLoading] = useState(false)
  const [adminUsersError, setAdminUsersError] = useState<string | null>(null)

  // Compute missing tickers (in registry but not in parquet files)
  const missingTickers = useMemo(() => {
    if (registryTickers.length === 0) return []
    const parquetSet = new Set(parquetTickers.map(t => t.toUpperCase()))
    return registryTickers.filter(t => !parquetSet.has(t.toUpperCase())).sort()
  }, [registryTickers, parquetTickers])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setError(null)
      try {
        const [s, t] = await Promise.all([fetch('/api/status'), fetch('/api/tickers')])
        const sPayload = (await s.json()) as AdminStatus | { error: string }
        const tPayload = (await t.json()) as { tickers: string[] } | { error: string }
        if (cancelled) return
        if (!s.ok) throw new Error('error' in sPayload ? sPayload.error : `Status failed (${s.status})`)
        if (!t.ok) throw new Error('error' in tPayload ? tPayload.error : `Tickers failed (${t.status})`)
        const tickersList = (tPayload as { tickers: string[] }).tickers || []
        setStatus(sPayload as AdminStatus)
        setTickers(tickersList)
        onTickersUpdated?.(tickersList)
      } catch (e) {
        if (cancelled) return
        setError(String((e as Error)?.message || e))
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])


  useEffect(() => {
    if (adminTab !== 'Ticker Data') return
    let cancelled = false
    const run = async () => {
      try {
        const res = await fetch('/api/parquet-tickers')
        const payload = (await res.json()) as { tickers: string[] } | { error: string }
        if (!res.ok) return
        if (cancelled) return
        setParquetTickers(('tickers' in payload ? payload.tickers : []) || [])
      } catch {
        if (cancelled) return
        setParquetTickers([])
      }

      // FRD-014: Also fetch cache stats
      try {
        const cacheRes = await fetch(`${API_BASE}/admin/cache/stats`)
        if (cacheRes.ok && !cancelled) {
          setCacheStats(await cacheRes.json())
        }
      } catch {
        // Ignore cache stats errors
      }

      // Fetch ticker registry stats
      try {
        const regRes = await fetch('/api/tickers/registry/stats')
        if (regRes.ok && !cancelled) {
          setRegistryStats(await regRes.json())
        }
      } catch {
        // Ignore registry stats errors
      }

      // Fetch Tiingo API key status
      try {
        const keyRes = await fetch('/api/admin/tiingo-key')
        if (keyRes.ok && !cancelled) {
          const keyData = await keyRes.json()
          setTiingoKeyStatus({ hasKey: keyData.hasKey, loading: false })
        } else {
          setTiingoKeyStatus({ hasKey: false, loading: false })
        }
      } catch {
        setTiingoKeyStatus({ hasKey: false, loading: false })
      }

      // Fetch sync schedule status
      try {
        const schedRes = await fetch('/api/admin/sync-schedule')
        if (schedRes.ok && !cancelled) {
          setSyncSchedule(await schedRes.json())
        }
      } catch {
        // Ignore schedule errors
      }

      // Fetch all registry tickers (for missing tickers calculation)
      try {
        const regMetaRes = await fetch('/api/tickers/registry/metadata')
        if (regMetaRes.ok && !cancelled) {
          const data = await regMetaRes.json()
          if (data.tickers) {
            setRegistryTickers(data.tickers.map((t: { ticker: string }) => t.ticker))
          }
        }
      } catch {
        // Ignore errors
      }
    }
    void run()

    // Poll sync status every 5 seconds when running
    const pollInterval = setInterval(async () => {
      try {
        const schedRes = await fetch('/api/admin/sync-schedule')
        if (schedRes.ok) {
          const data = await schedRes.json()
          setSyncSchedule(data)
          // Also refresh registry stats if job is running
          if (data.status?.isRunning) {
            const regRes = await fetch('/api/tickers/registry/stats')
            if (regRes.ok) {
              setRegistryStats(await regRes.json())
            }
          }
        }
      } catch {
        // Ignore errors
      }
    }, 5000)

    return () => {
      cancelled = true
      clearInterval(pollInterval)
    }
  }, [adminTab])

  // Check if current user is super admin and fetch users for User Management tab
  useEffect(() => {
    // Check super admin status on mount
    const checkSuperAdmin = async () => {
      try {
        const res = await fetch('/api/admin/me', {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('accessToken')}` }
        })
        if (res.ok) {
          const data = await res.json()
          setIsSuperAdmin(data.isSuperAdmin === true)
        }
      } catch {
        setIsSuperAdmin(false)
      }
    }
    void checkSuperAdmin()
  }, [])

  useEffect(() => {
    if (adminTab !== 'User Management' || !isSuperAdmin) return
    let cancelled = false

    const fetchAdminUsers = async () => {
      setAdminUsersLoading(true)
      setAdminUsersError(null)
      try {
        const res = await fetch('/api/admin/users', {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('accessToken')}` }
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error || 'Failed to fetch users')
        }
        if (cancelled) return
        const data = await res.json()
        setAdminUsers(data.users || [])
      } catch (e) {
        if (cancelled) return
        setAdminUsersError(String((e as Error)?.message || e))
      } finally {
        if (!cancelled) setAdminUsersLoading(false)
      }
    }
    void fetchAdminUsers()

    return () => { cancelled = true }
  }, [adminTab, isSuperAdmin])

  // Fetch admin data for Atlas Overview
  useEffect(() => {
    if (adminTab !== 'Atlas Overview') return
    let cancelled = false

    const fetchAdminData = async () => {
      try {
        const [statsRes, treasuryRes] = await Promise.all([
          fetch('/api/admin/aggregated-stats'),
          fetch('/api/admin/treasury')
        ])

        if (cancelled) return

        const statsData = (await statsRes.json()) as { stats: AdminAggregatedStats; config: AdminConfig; feeBreakdown: TreasuryFeeBreakdown } | { error: string }
        const treasuryData = (await treasuryRes.json()) as { treasury: TreasuryState } | { error: string }

        if (statsRes.ok && 'stats' in statsData) {
          setAdminStats(statsData.stats)
          const config = statsData.config || { atlasFeePercent: 0, partnerProgramSharePercent: 0, eligibilityRequirements: [] }
          setAdminConfig(config)
          setSavedConfig(config)
          if (statsData.feeBreakdown) {
            setFeeBreakdown(statsData.feeBreakdown)
          }
        }
        if (treasuryRes.ok && 'treasury' in treasuryData) {
          setTreasury(treasuryData.treasury)
        }
      } catch (e) {
        console.error('Failed to fetch admin data:', e)
      }
    }

    fetchAdminData()
    // Poll every 30 seconds
    const interval = setInterval(fetchAdminData, 30000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [adminTab])

  const handleSaveConfig = useCallback(async () => {
    setConfigSaving(true)
    try {
      const res = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(adminConfig)
      })
      if (!res.ok) throw new Error('Failed to save config')
      setSavedConfig({ ...adminConfig })
    } catch (e) {
      console.error('Failed to save config:', e)
    } finally {
      setConfigSaving(false)
    }
  }, [adminConfig])

  // Atlas Fund Slot handlers
  const handleAddAtlasSlot = useCallback(async (botId: string) => {
    // Add to Atlas Fund Slots
    const newSlots = [...adminConfig.atlasFundSlots, botId]
    setAdminConfig(prev => ({ ...prev, atlasFundSlots: newSlots }))

    // Update bot tags: remove 'Private', add 'Atlas'
    const bot = savedBots.find(b => b.id === botId)
    if (!bot) return

    const updatedBot: SavedBot = {
      ...bot,
      tags: [...(bot.tags || []).filter(t => t !== 'Private' && t !== 'Atlas Eligible'), 'Atlas']
    }
    setSavedBots(prev => prev.map(b => b.id === botId ? updatedBot : b))

    // Sync bot tags to API
    try {
      await updateBotInApi(userId, updatedBot)
    } catch (e) {
      console.error('Failed to sync Atlas bot tags:', e)
    }

    // Save config to server
    try {
      await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...adminConfig, atlasFundSlots: newSlots })
      })
      setSavedConfig(prev => ({ ...prev, atlasFundSlots: newSlots }))
    } catch (e) {
      console.error('Failed to save Atlas slots:', e)
    }

    // Refresh allNexusBots after API updates complete so other users see the new Atlas system
    if (onRefreshNexusBots) {
      try {
        await onRefreshNexusBots()
      } catch (e) {
        console.error('Failed to refresh Nexus bots:', e)
      }
    }
  }, [adminConfig, savedBots, onRefreshNexusBots, userId])

  const handleRemoveAtlasSlot = useCallback(async (botId: string) => {
    // Remove from Atlas Fund Slots
    const newSlots = adminConfig.atlasFundSlots.filter(id => id !== botId)
    setAdminConfig(prev => ({ ...prev, atlasFundSlots: newSlots }))

    // Update bot tags: remove 'Atlas', add 'Private'
    const bot = savedBots.find(b => b.id === botId)
    if (!bot) return

    const updatedBot: SavedBot = {
      ...bot,
      tags: [...(bot.tags || []).filter(t => t !== 'Atlas'), 'Private']
    }
    setSavedBots(prev => prev.map(b => b.id === botId ? updatedBot : b))

    // Sync bot tags to API
    try {
      await updateBotInApi(userId, updatedBot)
    } catch (e) {
      console.error('Failed to sync Atlas bot tags:', e)
    }

    // Save config to server
    try {
      await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...adminConfig, atlasFundSlots: newSlots })
      })
      setSavedConfig(prev => ({ ...prev, atlasFundSlots: newSlots }))
    } catch (e) {
      console.error('Failed to save Atlas slots:', e)
    }

    // Refresh allNexusBots after API updates complete so other users see the removal
    if (onRefreshNexusBots) {
      try {
        await onRefreshNexusBots()
      } catch (e) {
        console.error('Failed to refresh Nexus bots:', e)
      }
    }
  }, [adminConfig, savedBots, onRefreshNexusBots, userId])

  // Get admin's bots that are available to add to Atlas Fund
  // Show ALL admin bots that aren't already tagged as Atlas
  const adminBots = savedBots.filter(b => b.builderId === userId && !b.tags?.includes('Atlas'))
  const availableForAtlas = adminBots.filter(b => !adminConfig.atlasFundSlots.includes(b.id))
  const atlasFundBots = adminConfig.atlasFundSlots
    .map(id => savedBots.find(b => b.id === id))
    .filter((b): b is SavedBot => b !== undefined)

  // Fetch eligibility requirements for Nexus Maintenance tab
  useEffect(() => {
    if (adminTab !== 'Nexus Maintenance') return
    let cancelled = false

    const fetchEligibility = async () => {
      try {
        const res = await fetch('/api/admin/eligibility')
        if (!res.ok) return
        const data = (await res.json()) as { eligibilityRequirements: EligibilityRequirement[] }
        if (cancelled) return
        setEligibilityRequirements(data.eligibilityRequirements || [])
        // Set live months value from existing requirement
        const liveMonthsReq = data.eligibilityRequirements.find(r => r.type === 'live_months')
        if (liveMonthsReq) setLiveMonthsValue(liveMonthsReq.value)
      } catch (e) {
        console.error('Failed to fetch eligibility:', e)
      }
    }

    fetchEligibility()
    return () => { cancelled = true }
  }, [adminTab])

  const saveEligibilityRequirements = useCallback(async (reqs: EligibilityRequirement[]) => {
    setEligibilitySaving(true)
    try {
      const res = await fetch('/api/admin/eligibility', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eligibilityRequirements: reqs })
      })
      if (!res.ok) throw new Error('Failed to save eligibility')
      setEligibilityRequirements(reqs)
    } catch (e) {
      console.error('Failed to save eligibility:', e)
    } finally {
      setEligibilitySaving(false)
    }
  }, [])

  const handleSaveLiveMonths = useCallback(() => {
    const existingReqs = eligibilityRequirements.filter(r => r.type !== 'live_months')
    const newReqs: EligibilityRequirement[] = [
      { id: 'live_months', type: 'live_months', value: liveMonthsValue },
      ...existingReqs
    ]
    saveEligibilityRequirements(newReqs)
  }, [liveMonthsValue, eligibilityRequirements, saveEligibilityRequirements])

  const handleAddMetricRequirement = useCallback(() => {
    const newReq: EligibilityRequirement = {
      id: `metric-${Date.now()}`,
      type: 'metric',
      metric: newMetric,
      comparison: newComparison,
      value: newMetricValue
    }
    const newReqs = [...eligibilityRequirements, newReq]
    saveEligibilityRequirements(newReqs)
  }, [newMetric, newComparison, newMetricValue, eligibilityRequirements, saveEligibilityRequirements])

  const handleRemoveRequirement = useCallback((id: string) => {
    const newReqs = eligibilityRequirements.filter(r => r.id !== id)
    saveEligibilityRequirements(newReqs)
  }, [eligibilityRequirements, saveEligibilityRequirements])

  // User Management: Change user role (main_admin or sub_admin)
  const handleChangeRole = useCallback(async (targetUserId: string, newRole: string) => {
    try {
      const res = await fetch(`/api/admin/users/${targetUserId}/role`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ role: newRole })
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to change role')
      }
      // Update local state
      setAdminUsers(prev => prev.map(u => u.id === targetUserId ? { ...u, role: newRole } : u))
    } catch (e) {
      setAdminUsersError(String((e as Error)?.message || e))
    }
  }, [])



  return (
    <>
      {/* Subtab Navigation */}
      <div className="flex gap-2 mb-6">
        {(['Atlas Overview', 'Nexus Maintenance', 'Ticker Data'] as const).map((t) => (
          <button
            key={t}
            className={`tab-btn ${adminTab === t ? 'active' : ''}`}
            onClick={() => setAdminTab(t)}
          >
            {t}
          </button>
        ))}
        {/* User Management tab - only visible to super admin */}
        {isSuperAdmin && (
          <button
            className={`tab-btn ${adminTab === 'User Management' ? 'active' : ''}`}
            onClick={() => setAdminTab('User Management')}
          >
            User Management
          </button>
        )}
      </div>

      {adminTab === 'Atlas Overview' && (
        <div className="space-y-6">
          <div className="font-black text-lg">Atlas Overview</div>

          {/* Fee Configuration Section */}
          <Card className="p-6">
            <div className="font-bold mb-4">Fee Configuration</div>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <div className="text-sm text-muted mb-1">Atlas Fee %</div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={adminConfig.atlasFeePercent}
                    onChange={(e) => setAdminConfig(prev => ({
                      ...prev,
                      atlasFeePercent: parseFloat(e.target.value) || 0
                    }))}
                    className="w-20 px-2 py-1 rounded border border-border bg-background text-sm"
                  />
                  <span>%</span>
                  <Button
                    size="sm"
                    onClick={() => void handleSaveConfig()}
                    disabled={configSaving}
                  >
                    {configSaving ? 'Saving...' : 'Save'}
                  </Button>
                </div>
                <div className="text-xs text-muted mt-1">
                  Currently: {savedConfig.atlasFeePercent}%
                </div>
              </div>
              <div>
                <div className="text-sm text-muted mb-1">Partner Program Share %</div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={adminConfig.partnerProgramSharePercent}
                    onChange={(e) => setAdminConfig(prev => ({
                      ...prev,
                      partnerProgramSharePercent: parseFloat(e.target.value) || 0
                    }))}
                    className="w-20 px-2 py-1 rounded border border-border bg-background text-sm"
                  />
                  <span>%</span>
                  <Button
                    size="sm"
                    onClick={() => void handleSaveConfig()}
                    disabled={configSaving}
                  >
                    {configSaving ? 'Saving...' : 'Save'}
                  </Button>
                </div>
                <div className="text-xs text-muted mt-1">
                  Currently: {savedConfig.partnerProgramSharePercent}%
                </div>
              </div>
            </div>
          </Card>

          {/* Atlas Fund Zones - Admin Sponsored Systems */}
          <Card className="p-6">
            <div className="font-bold mb-4">Atlas Sponsored Systems</div>
            <div className="space-y-4">
              {/* Current Atlas Fund Slots */}
              <div className="grid grid-cols-5 gap-3">
                {atlasFundBots.length === 0 ? (
                  <div className="col-span-5 text-center py-6 text-muted border border-dashed border-border rounded-lg">
                    No Atlas systems yet. Add systems from the dropdown below.
                  </div>
                ) : (
                  atlasFundBots.map((bot, idx) => (
                    <div key={bot.id} className="p-3 bg-blue-500/10 rounded-lg border border-blue-500/30">
                      <div className="text-xs text-muted mb-1">Atlas #{idx + 1}</div>
                      <div className="font-bold text-sm truncate" title={bot.name}>{bot.name}</div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 w-full text-xs"
                        onClick={() => void handleRemoveAtlasSlot(bot.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  ))
                )}
              </div>

              {/* Add New Atlas System */}
              <div className="flex items-center gap-3">
                <select
                  className="flex-1 px-3 py-2 rounded border border-border bg-background text-sm"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) void handleAddAtlasSlot(e.target.value)
                  }}
                  disabled={availableForAtlas.length === 0}
                >
                  <option value="">
                    {availableForAtlas.length === 0
                      ? 'No systems available (create systems in Build tab first)'
                      : 'Select a system to add as Atlas...'}
                  </option>
                  {availableForAtlas.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>

              <div className="text-xs text-muted">
                Atlas systems appear in the "Select Systems" section of Nexus. Unlike Nexus systems, Atlas systems do not require eligibility metrics.
              </div>
            </div>
          </Card>

          {/* 5 Totals Grid */}
          <Card className="p-6">
            <div className="font-bold mb-4">System Statistics</div>
            <div className="grid grid-cols-5 gap-4">
              <div className="text-center p-4 bg-muted/30 rounded-lg">
                <div className="text-xs text-muted mb-1">Total Portfolio Values</div>
                <div className="text-lg font-black">
                  ${(adminStats?.totalPortfolioValue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </div>
              </div>
              <div className="text-center p-4 bg-muted/30 rounded-lg">
                <div className="text-xs text-muted mb-1">Total Invested (All)</div>
                <div className="text-lg font-black">
                  ${(adminStats?.totalDollarsInvested ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </div>
              </div>
              <div className="text-center p-4 bg-blue-500/10 rounded-lg border border-blue-500/30">
                <div className="text-xs text-muted mb-1">Invested in Atlas</div>
                <div className="text-lg font-black text-blue-500">
                  ${(adminStats?.totalInvestedAtlas ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </div>
              </div>
              <div className="text-center p-4 bg-purple-500/10 rounded-lg border border-purple-500/30">
                <div className="text-xs text-muted mb-1">Invested in Nexus</div>
                <div className="text-lg font-black text-purple-500">
                  ${(adminStats?.totalInvestedNexus ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </div>
              </div>
              <div className="text-center p-4 bg-gray-500/10 rounded-lg border border-gray-500/30">
                <div className="text-xs text-muted mb-1">Invested in Private</div>
                <div className="text-lg font-black text-gray-400">
                  ${(adminStats?.totalInvestedPrivate ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </div>
              </div>
            </div>
            {adminStats && (
              <div className="text-xs text-muted mt-4">
                Last updated: {new Date(adminStats.lastUpdated).toLocaleString()} | Active users: {adminStats.userCount}
              </div>
            )}
          </Card>

          {/* Treasury Bill Holdings Section */}
          <Card className="p-6">
            <div className="font-bold mb-4">Treasury Bill Holdings</div>
            <div className="mb-4">
              <div className="text-sm text-muted mb-1">Current Balance</div>
              <div className="text-2xl font-black text-emerald-500">
                ${treasury.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>

            {/* Time Period Buttons */}
            <div className="flex gap-1 mb-4">
              {(['1D', '1M', '3M', '6M', 'YTD', '1Y', 'ALL'] as const).map((period) => (
                <Button
                  key={period}
                  size="sm"
                  variant={treasuryPeriod === period ? 'accent' : 'ghost'}
                  className="h-6 px-2 text-xs"
                  onClick={() => setTreasuryPeriod(period)}
                >
                  {period}
                </Button>
              ))}
            </div>

            {/* Treasury Equity Chart placeholder */}
            <div className="h-[200px] border border-border rounded-lg bg-muted/30 flex items-center justify-center text-muted text-sm mb-4">
              Treasury Equity Chart - Balance: ${treasury.balance.toLocaleString()}
              {treasury.entries.length > 0 && ` (${treasury.entries.length} entries)`}
            </div>

            {/* Fee Breakdowns */}
            <div className="grid grid-cols-4 gap-4 mb-6">
              <div className="p-3 bg-blue-500/10 rounded-lg border border-blue-500/30">
                <div className="text-xs text-muted mb-1">Returns from Atlas Fees</div>
                <div className="text-lg font-bold text-emerald-500">
                  +${feeBreakdown.atlasFeesTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="p-3 bg-gray-500/10 rounded-lg border border-gray-500/30">
                <div className="text-xs text-muted mb-1">Returns from Private Fees</div>
                <div className="text-lg font-bold text-emerald-500">
                  +${feeBreakdown.privateFeesTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="p-3 bg-purple-500/10 rounded-lg border border-purple-500/30">
                <div className="text-xs text-muted mb-1">Returns from Nexus Fees</div>
                <div className="text-lg font-bold text-emerald-500">
                  +${feeBreakdown.nexusFeesTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="p-3 bg-red-500/10 rounded-lg border border-red-500/30">
                <div className="text-xs text-muted mb-1">Nexus Partner Payments</div>
                <div className="text-lg font-bold text-red-500">
                  -${feeBreakdown.nexusPartnerPaymentsTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>

            {/* Recent Fee Deposits */}
            <div>
              <div className="font-bold mb-2">Recent Transactions</div>
              <div className="max-h-[200px] overflow-auto border border-border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Date</th>
                      <th className="text-left px-3 py-2 font-medium">Type</th>
                      <th className="text-right px-3 py-2 font-medium">Amount</th>
                      <th className="text-left px-3 py-2 font-medium">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {treasury.entries.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-4 text-center text-muted">
                          No transactions yet
                        </td>
                      </tr>
                    ) : (
                      treasury.entries.slice(-10).reverse().map((entry) => (
                        <tr key={entry.id} className="border-t border-border">
                          <td className="px-3 py-2">{new Date(entry.date).toLocaleDateString()}</td>
                          <td className="px-3 py-2 capitalize">{entry.type.replace('_', ' ')}</td>
                          <td className={`px-3 py-2 text-right ${entry.amount >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                            {entry.amount >= 0 ? '+' : ''}${entry.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="px-3 py-2 text-muted">{entry.description || '-'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>
        </div>
      )}

      {adminTab === 'Nexus Maintenance' && (
        <div className="space-y-6">
          <div className="font-black text-lg">Nexus Maintenance</div>

          {/* Partner Program Eligibility Requirements */}
          <Card className="p-6">
            <div className="font-bold mb-4">Partner Program Eligibility Requirements</div>
            <div className="grid grid-cols-2 gap-6">
              {/* Left Half - Add/Edit Requirements */}
              <div className="space-y-4">
                {/* Live Months Requirement */}
                <div className="p-4 bg-muted/30 rounded-lg">
                  <div className="text-sm font-medium mb-2">Live Duration Requirement</div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm">Must Be Live for</span>
                    <input
                      type="number"
                      min="0"
                      value={liveMonthsValue}
                      onChange={(e) => setLiveMonthsValue(parseInt(e.target.value) || 0)}
                      className="w-16 px-2 py-1 rounded border border-border bg-background text-sm"
                    />
                    <span className="text-sm">Months</span>
                    <Button
                      size="sm"
                      onClick={handleSaveLiveMonths}
                      disabled={eligibilitySaving}
                    >
                      {eligibilitySaving ? 'Saving...' : 'Save'}
                    </Button>
                  </div>
                </div>

                {/* Add Metric Requirement */}
                <div className="p-4 bg-muted/30 rounded-lg">
                  <div className="text-sm font-medium mb-2">Add Metric Requirement</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm">Must have</span>
                    <select
                      value={newMetric}
                      onChange={(e) => setNewMetric(e.target.value as EligibilityMetric)}
                      className="px-2 py-1 rounded border border-border bg-background text-sm"
                    >
                      {(Object.keys(METRIC_LABELS) as EligibilityMetric[]).map(m => (
                        <option key={m} value={m}>{METRIC_LABELS[m]}</option>
                      ))}
                    </select>
                    <span className="text-sm">of</span>
                    <select
                      value={newComparison}
                      onChange={(e) => setNewComparison(e.target.value as 'at_least' | 'at_most')}
                      className="px-2 py-1 rounded border border-border bg-background text-sm"
                    >
                      <option value="at_least">at least</option>
                      <option value="at_most">at most</option>
                    </select>
                    <input
                      type="number"
                      step="0.01"
                      value={newMetricValue}
                      onChange={(e) => setNewMetricValue(parseFloat(e.target.value) || 0)}
                      className="w-20 px-2 py-1 rounded border border-border bg-background text-sm"
                    />
                    <Button
                      size="sm"
                      onClick={handleAddMetricRequirement}
                      disabled={eligibilitySaving}
                    >
                      Add
                    </Button>
                  </div>
                </div>

                {/* ETFs Only Requirement */}
                <div className="p-4 bg-muted/30 rounded-lg">
                  <div className="text-sm font-medium mb-2">Asset Type Requirement</div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={eligibilityRequirements.some(r => r.type === 'etfs_only')}
                      onChange={(e) => {
                        if (e.target.checked) {
                          // Add ETFs Only requirement
                          const newReq: EligibilityRequirement = {
                            id: `etfs-only-${Date.now()}`,
                            type: 'etfs_only',
                            value: 1 // Just a placeholder value
                          }
                          saveEligibilityRequirements([...eligibilityRequirements, newReq])
                        } else {
                          // Remove ETFs Only requirement
                          saveEligibilityRequirements(eligibilityRequirements.filter(r => r.type !== 'etfs_only'))
                        }
                      }}
                      disabled={eligibilitySaving}
                      className="w-4 h-4 rounded border-border cursor-pointer"
                    />
                    <span className="text-sm">Require ETFs Only</span>
                  </label>
                  <div className="text-xs text-muted mt-1">
                    Systems must only contain ETF positions (no individual stocks)
                  </div>
                </div>
              </div>

              {/* Right Half - Saved Requirements List */}
              <div className="p-4 bg-muted/30 rounded-lg">
                <div className="text-sm font-medium mb-2">Current Requirements</div>
                {eligibilityRequirements.length === 0 ? (
                  <div className="text-sm text-muted">No requirements set</div>
                ) : (
                  <ol className="list-decimal list-inside space-y-2 text-sm">
                    {eligibilityRequirements.map((req) => (
                      <li key={req.id} className="flex items-center justify-between">
                        <span>
                          {req.type === 'live_months' ? (
                            <>Must be live for {req.value} months</>
                          ) : req.type === 'etfs_only' ? (
                            <>Must only contain ETF positions</>
                          ) : (
                            <>Must have {METRIC_LABELS[req.metric!]} of {req.comparison === 'at_least' ? 'at least' : 'at most'} {req.value}</>
                          )}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-red-500 hover:text-red-600"
                          onClick={() => handleRemoveRequirement(req.id)}
                        >
                          ×
                        </Button>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-3 gap-4">
            {/* Top 500 Nexus Systems */}
            <Card className="p-4 flex flex-col">
              <div className="font-bold text-center mb-3">Top 500 Nexus Systems by [metric]</div>
              <div className="flex-1 overflow-auto border border-border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1.5 font-medium">Name</th>
                      <th className="text-right px-2 py-1.5 font-medium">CAGR</th>
                      <th className="text-right px-2 py-1.5 font-medium">MaxDD</th>
                      <th className="text-right px-2 py-1.5 font-medium">Sharpe</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td colSpan={4} className="px-2 py-8 text-center text-muted">
                        No Nexus systems yet
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Top 500 Private Systems */}
            <Card className="p-4 flex flex-col">
              <div className="font-bold text-center mb-3">Top 500 Private Systems by [metric]</div>
              <div className="flex-1 overflow-auto border border-border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1.5 font-medium">Name</th>
                      <th className="text-right px-2 py-1.5 font-medium">CAGR</th>
                      <th className="text-right px-2 py-1.5 font-medium">MaxDD</th>
                      <th className="text-right px-2 py-1.5 font-medium">Sharpe</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td colSpan={4} className="px-2 py-8 text-center text-muted">
                        No Private systems yet
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Top 500 All Systems */}
            <Card className="p-4 flex flex-col">
              <div className="font-bold text-center mb-3">Top 500 All Systems by [metric]</div>
              <div className="flex-1 overflow-auto border border-border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1.5 font-medium">Name</th>
                      <th className="text-right px-2 py-1.5 font-medium">CAGR</th>
                      <th className="text-right px-2 py-1.5 font-medium">MaxDD</th>
                      <th className="text-right px-2 py-1.5 font-medium">Sharpe</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td colSpan={4} className="px-2 py-8 text-center text-muted">
                        No systems yet
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      )}

      {adminTab === 'Ticker Data' && (
        <div className="space-y-6">
          {/* ========== STATUS OVERVIEW ========== */}
          <div className="grid grid-cols-3 gap-4">
            {/* Files Card */}
            <div className="p-4 rounded-lg bg-muted">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Parquet Files</div>
              <div className="text-3xl font-black">{parquetTickers.length.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground mt-1">
                Available for queries
              </div>
            </div>

            {/* Last Updated Card */}
            <div className="p-4 rounded-lg bg-muted">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Last Sync</div>
              <div className="text-lg font-bold">
                {syncSchedule?.lastSync?.date ?? registryStats?.lastSync ?? 'Never'}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {syncSchedule?.lastSync?.status === 'success' && syncSchedule?.lastSync?.syncedCount != null
                  ? `${syncSchedule.lastSync.syncedCount.toLocaleString()} tickers updated`
                  : syncSchedule?.lastSync?.status === 'error'
                  ? 'Last sync failed'
                  : 'No recent sync'}
              </div>
            </div>

            {/* Pending Card */}
            <div className="p-4 rounded-lg bg-muted">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Pending Download</div>
              <div className={`text-3xl font-black ${(registryStats?.pending ?? 0) > 0 ? 'text-warning' : 'text-success'}`}>
                {registryStats?.pending?.toLocaleString() ?? '...'}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                of {registryStats?.active?.toLocaleString() ?? '...'} active tickers
              </div>
            </div>
          </div>

          {/* ========== CURRENT JOB STATUS ========== */}
          {syncSchedule?.status?.isRunning && syncSchedule?.status?.currentJob && (
            <div className="p-4 rounded-lg bg-primary/10 border border-primary">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse"></div>
                  <span className="font-bold">Download In Progress</span>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={syncKilling}
                  onClick={async () => {
                    if (!confirm('Are you sure you want to stop the current download?')) return
                    setSyncKilling(true)
                    try {
                      const res = await fetch('/api/admin/sync-schedule/kill', { method: 'POST' })
                      const data = await res.json()
                      if (res.ok) {
                        setRegistryMsg(`Job stopped: ${data.message}`)
                        // Refresh status
                        const schedRes = await fetch('/api/admin/sync-schedule')
                        if (schedRes.ok) setSyncSchedule(await schedRes.json())
                      } else {
                        setRegistryMsg(`Error: ${data.error}`)
                      }
                    } catch (e) {
                      setRegistryMsg(`Error: ${e}`)
                    } finally {
                      setSyncKilling(false)
                    }
                  }}
                >
                  {syncKilling ? 'Stopping...' : 'Stop Download'}
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground text-xs">Progress</div>
                  <div className="font-bold">
                    {syncSchedule.status.currentJob.syncedCount.toLocaleString()} / {syncSchedule.status.currentJob.tickerCount.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">Elapsed</div>
                  <div className="font-bold">
                    {Math.round((Date.now() - syncSchedule.status.currentJob.startedAt) / 1000 / 60)} min
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">Rate</div>
                  <div className="font-bold">
                    {(() => {
                      const elapsed = (Date.now() - syncSchedule.status.currentJob.startedAt) / 1000
                      const rate = elapsed > 0 ? syncSchedule.status.currentJob.syncedCount / elapsed : 0
                      return `${rate.toFixed(1)}/sec`
                    })()}
                  </div>
                </div>
              </div>
              {/* Progress bar */}
              <div className="mt-3 h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-500"
                  style={{ width: `${Math.min(100, (syncSchedule.status.currentJob.syncedCount / syncSchedule.status.currentJob.tickerCount) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* ========== ACTIONS ========== */}
          <div className="flex gap-3 flex-wrap">
            {/* Refresh Ticker List */}
            <Button
              variant="outline"
              disabled={registrySyncing || syncSchedule?.status?.isRunning}
              onClick={async () => {
                setRegistrySyncing(true)
                setRegistryMsg(null)
                try {
                  const res = await fetch('/api/tickers/registry/sync', { method: 'POST' })
                  const data = await res.json()
                  if (res.ok) {
                    setRegistryMsg(`Registry updated: ${data.imported?.toLocaleString() ?? 0} tickers`)
                    const statsRes = await fetch('/api/tickers/registry/stats')
                    if (statsRes.ok) setRegistryStats(await statsRes.json())
                  } else {
                    setRegistryMsg(`Error: ${data.error}`)
                  }
                } catch (e) {
                  setRegistryMsg(`Error: ${e}`)
                } finally {
                  setRegistrySyncing(false)
                }
              }}
            >
              {registrySyncing ? 'Syncing...' : 'Refresh Tickers'}
            </Button>

            {/* yFinance Download - downloads all parquet tickers */}
            <Button
              variant="default"
              disabled={syncSchedule?.status?.isRunning}
              onClick={async () => {
                if (!confirm(`Download/update ${parquetTickers.length.toLocaleString()} tickers from yFinance?`)) return
                setRegistryMsg('Starting yFinance download...')
                try {
                  const res = await fetch('/api/admin/sync-schedule/run-now', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ source: 'yfinance', tickers: parquetTickers })
                  })
                  const data = await res.json()
                  if (res.ok) {
                    setRegistryMsg(data.message || 'yFinance download started')
                    const schedRes = await fetch('/api/admin/sync-schedule')
                    if (schedRes.ok) setSyncSchedule(await schedRes.json())
                  } else {
                    setRegistryMsg(`Error: ${data.error}`)
                  }
                } catch (e) {
                  setRegistryMsg(`Error: ${e}`)
                }
              }}
            >
              {syncSchedule?.status?.isRunning ? 'Running...' : `yFinance (${parquetTickers.length.toLocaleString()})`}
            </Button>

            {/* Tiingo Download - fills gaps from yFinance */}
            <Button
              variant="default"
              disabled={syncSchedule?.status?.isRunning || !tiingoKeyStatus.hasKey}
              onClick={async () => {
                if (!confirm(`Download missing data and metadata from Tiingo for ${parquetTickers.length.toLocaleString()} tickers?`)) return
                setRegistryMsg('Starting Tiingo download (fills gaps + metadata)...')
                try {
                  const res = await fetch('/api/admin/sync-schedule/run-now', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ source: 'tiingo', tickers: parquetTickers, fillGaps: true })
                  })
                  const data = await res.json()
                  if (res.ok) {
                    setRegistryMsg(data.message || 'Tiingo download started')
                    const schedRes = await fetch('/api/admin/sync-schedule')
                    if (schedRes.ok) setSyncSchedule(await schedRes.json())
                  } else {
                    setRegistryMsg(`Error: ${data.error}`)
                  }
                } catch (e) {
                  setRegistryMsg(`Error: ${e}`)
                }
              }}
              title={!tiingoKeyStatus.hasKey ? 'Configure Tiingo API key first' : undefined}
            >
              {syncSchedule?.status?.isRunning ? 'Running...' : `Tiingo (${parquetTickers.length.toLocaleString()})`}
            </Button>

            {/* Refresh Stats */}
            <Button
              variant="ghost"
              onClick={async () => {
                const [statsRes, schedRes, parquetRes] = await Promise.all([
                  fetch('/api/tickers/registry/stats'),
                  fetch('/api/admin/sync-schedule'),
                  fetch('/api/parquet-tickers')
                ])
                if (statsRes.ok) setRegistryStats(await statsRes.json())
                if (schedRes.ok) setSyncSchedule(await schedRes.json())
                if (parquetRes.ok) {
                  const data = await parquetRes.json()
                  setParquetTickers(data.tickers || [])
                }
                setRegistryMsg('Stats refreshed')
              }}
            >
              Refresh Stats
            </Button>
          </div>

          {/* ========== BATCH & PAUSE SETTINGS ========== */}
          <div className="flex items-center gap-6 px-1">
            <div className="flex items-center gap-2">
              <label className="text-sm text-muted-foreground whitespace-nowrap">Batch Size:</label>
              <input
                type="number"
                min="1"
                max="500"
                value={syncSchedule?.config?.batchSize ?? 100}
                onChange={async (e) => {
                  const val = Math.max(1, Math.min(500, parseInt(e.target.value) || 100))
                  try {
                    const res = await fetch('/api/admin/sync-schedule', {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ batchSize: val })
                    })
                    if (res.ok) {
                      const schedRes = await fetch('/api/admin/sync-schedule')
                      if (schedRes.ok) setSyncSchedule(await schedRes.json())
                    }
                  } catch {
                    setRegistryMsg('Error updating batch size')
                  }
                }}
                className="w-20 px-2 py-1 rounded border border-border bg-background text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-muted-foreground whitespace-nowrap">Pause (sec):</label>
              <input
                type="number"
                min="0"
                max="60"
                step="0.5"
                value={syncSchedule?.config?.sleepSeconds ?? 2}
                onChange={async (e) => {
                  const val = Math.max(0, Math.min(60, parseFloat(e.target.value) || 2))
                  try {
                    const res = await fetch('/api/admin/sync-schedule', {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ sleepSeconds: val })
                    })
                    if (res.ok) {
                      const schedRes = await fetch('/api/admin/sync-schedule')
                      if (schedRes.ok) setSyncSchedule(await schedRes.json())
                    }
                  } catch {
                    setRegistryMsg('Error updating pause time')
                  }
                }}
                className="w-20 px-2 py-1 rounded border border-border bg-background text-sm"
              />
            </div>
            <span className="text-xs text-muted-foreground">
              Download {syncSchedule?.config?.batchSize ?? 100} tickers, then wait {syncSchedule?.config?.sleepSeconds ?? 2}s
            </span>
          </div>

          {/* ========== SCHEDULE SETTINGS ========== */}
          <div className="p-4 rounded-lg bg-muted/50 border border-border">
            <div className="flex items-center justify-between mb-3">
              <div className="font-bold text-sm">Auto-Download Schedule</div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={syncSchedule?.config?.enabled ?? true}
                  onChange={async (e) => {
                    try {
                      const res = await fetch('/api/admin/sync-schedule', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ enabled: e.target.checked })
                      })
                      if (res.ok) {
                        const schedRes = await fetch('/api/admin/sync-schedule')
                        if (schedRes.ok) setSyncSchedule(await schedRes.json())
                        setRegistryMsg(e.target.checked ? 'Schedule enabled' : 'Schedule disabled')
                      }
                    } catch {
                      setRegistryMsg('Error updating schedule')
                    }
                  }}
                  className="w-4 h-4"
                />
                <span className="text-sm">{syncSchedule?.config?.enabled ? 'Enabled' : 'Disabled'}</span>
              </label>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-sm text-muted-foreground">Daily at:</label>
                <input
                  type="time"
                  value={syncSchedule?.config?.updateTime ?? '18:00'}
                  onChange={async (e) => {
                    const newTime = e.target.value
                    try {
                      const res = await fetch('/api/admin/sync-schedule', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ updateTime: newTime })
                      })
                      if (res.ok) {
                        const schedRes = await fetch('/api/admin/sync-schedule')
                        if (schedRes.ok) setSyncSchedule(await schedRes.json())
                        setRegistryMsg(`Schedule updated to ${newTime}`)
                      }
                    } catch {
                      setRegistryMsg('Error updating schedule time')
                    }
                  }}
                  className="px-2 py-1 rounded border border-border bg-background text-sm"
                />
              </div>
              <span className="text-xs text-muted-foreground">
                {syncSchedule?.config?.timezone ?? 'America/New_York'} (weekdays only)
              </span>
            </div>
          </div>

          {/* Status message */}
          {registryMsg && (
            <div className={`text-sm ${registryMsg.includes('Error') ? 'text-destructive' : 'text-success'}`}>
              {registryMsg}
            </div>
          )}

          {/* ========== COLLAPSIBLE SECTIONS ========== */}
          <details className="group">
            <summary className="cursor-pointer font-bold text-sm py-2 hover:text-primary">
              API Key Settings
            </summary>
            <div className="mt-2 p-3 bg-muted rounded-lg text-sm space-y-3">
              <div className="flex items-center gap-2">
                <strong>Tiingo API Key:</strong>
                {tiingoKeyStatus.loading ? (
                  <span className="text-muted-foreground">Checking...</span>
                ) : tiingoKeyStatus.hasKey ? (
                  <span className="text-success">Configured</span>
                ) : (
                  <span className="text-destructive">Not configured</span>
                )}
              </div>
              {!tiingoKeyStatus.hasKey && (
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={tiingoKeyInput}
                    onChange={(e) => setTiingoKeyInput(e.target.value)}
                    className="flex-1 px-3 py-2 rounded border border-border bg-background text-sm"
                    placeholder="Enter Tiingo API key"
                  />
                  <Button
                    size="sm"
                    disabled={!tiingoKeyInput.trim() || tiingoKeySaving}
                    onClick={async () => {
                      setTiingoKeySaving(true)
                      try {
                        const res = await fetch('/api/admin/tiingo-key', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ key: tiingoKeyInput.trim() })
                        })
                        if (res.ok) {
                          setTiingoKeyStatus({ hasKey: true, loading: false })
                          setTiingoKeyInput('')
                        }
                      } finally {
                        setTiingoKeySaving(false)
                      }
                    }}
                  >
                    Save
                  </Button>
                </div>
              )}
              {tiingoKeyStatus.hasKey && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    if (!confirm('Remove API key?')) return
                    const res = await fetch('/api/admin/tiingo-key', { method: 'DELETE' })
                    if (res.ok) setTiingoKeyStatus({ hasKey: false, loading: false })
                  }}
                >
                  Remove Key
                </Button>
              )}
            </div>
          </details>

          <details className="group">
            <summary className="cursor-pointer font-bold text-sm py-2 hover:text-primary">
              Cache Management
            </summary>
            <div className="mt-2 p-3 bg-muted rounded-lg text-sm space-y-3">
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div><strong>Cached:</strong> {cacheStats?.entryCount ?? 0} systems</div>
                <div><strong>Size:</strong> {cacheStats?.totalSizeBytes ? `${(cacheStats.totalSizeBytes / 1024).toFixed(1)} KB` : '0'}</div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={cacheRefreshing}
                  onClick={async () => {
                    if (!confirm('Clear all cached backtest results?')) return
                    setCacheRefreshing(true)
                    try {
                      await fetch(`${API_BASE}/admin/cache/invalidate`, { method: 'POST' })
                      const res = await fetch(`${API_BASE}/admin/cache/stats`)
                      if (res.ok) setCacheStats(await res.json())
                    } finally {
                      setCacheRefreshing(false)
                    }
                  }}
                >
                  Clear Cache
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  disabled={prewarmRunning}
                  onClick={async () => {
                    if (!confirm('Run backtests for all systems?')) return
                    setPrewarmRunning(true)
                    try {
                      await fetch(`${API_BASE}/admin/cache/prewarm`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ includeSanity: true })
                      })
                      onPrewarmComplete?.()
                    } finally {
                      setPrewarmRunning(false)
                    }
                  }}
                >
                  {prewarmRunning ? 'Running...' : 'Prewarm Cache'}
                </Button>
              </div>
            </div>
          </details>

          <details className="group">
            <summary className="cursor-pointer font-bold text-sm py-2 hover:text-primary">
              Available Tickers ({parquetTickers.length.toLocaleString()})
            </summary>
            <div className="mt-2 max-h-[200px] overflow-auto border rounded-lg p-2 bg-background text-xs font-mono">
              {parquetTickers.join(', ') || 'No tickers available'}
            </div>
          </details>

          <details className="group">
            <summary className="cursor-pointer font-bold text-sm py-2 hover:text-primary">
              <span className={missingTickers.length > 0 ? 'text-warning' : ''}>
                Missing Tickers ({missingTickers.length.toLocaleString()})
              </span>
              {missingTickers.length > 0 && (
                <span className="ml-2 text-xs text-muted-foreground">
                  (in registry but no parquet file)
                </span>
              )}
            </summary>
            <div className="mt-2 space-y-2">
              <div className="text-xs text-muted-foreground">
                Registry: {registryTickers.length.toLocaleString()} tickers |
                Parquet: {parquetTickers.length.toLocaleString()} files |
                Missing: {missingTickers.length.toLocaleString()}
              </div>
              {missingTickers.length > 0 && (
                <div className="flex items-center gap-2 my-2">
                  <Button
                    variant="default"
                    size="sm"
                    disabled={missingDownloadJob?.status === 'running' || syncSchedule?.status?.isRunning}
                    onClick={async () => {
                      if (!confirm(`Download ${missingTickers.length.toLocaleString()} missing tickers? This may take a while.`)) return
                      setRegistryMsg('Starting download of missing tickers...')
                      try {
                        const res = await fetch('/api/tickers/download-specific', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ tickers: missingTickers })
                        })
                        const data = await res.json()
                        if (res.ok && data.jobId) {
                          setMissingDownloadJob({ jobId: data.jobId, status: 'running', saved: 0, total: data.tickerCount })
                          setRegistryMsg(`Download started (Job: ${data.jobId})`)
                          // Poll for job status
                          const poll = setInterval(async () => {
                            try {
                              const jobRes = await fetch(`/api/jobs/${data.jobId}`)
                              if (jobRes.ok) {
                                const job = await jobRes.json()
                                const saved = job.syncedTickers?.length ?? 0
                                setMissingDownloadJob(prev => prev ? { ...prev, status: job.status, saved } : null)
                                if (job.status === 'done' || job.status === 'error') {
                                  clearInterval(poll)
                                  setRegistryMsg(job.status === 'done'
                                    ? `Download complete: ${saved} tickers saved`
                                    : `Download failed: ${job.error || 'Unknown error'}`)
                                  // Refresh parquet list
                                  const parquetRes = await fetch('/api/parquet-tickers')
                                  if (parquetRes.ok) {
                                    const pData = await parquetRes.json()
                                    setParquetTickers(pData.tickers || [])
                                  }
                                }
                              }
                            } catch { /* ignore polling errors */ }
                          }, 2000)
                        } else {
                          setRegistryMsg(`Error: ${data.error || 'Failed to start download'}`)
                        }
                      } catch (e) {
                        setRegistryMsg(`Error: ${e}`)
                      }
                    }}
                  >
                    {missingDownloadJob?.status === 'running'
                      ? `Downloading... (${missingDownloadJob.saved}/${missingDownloadJob.total})`
                      : `Download Missing (${missingTickers.length.toLocaleString()})`}
                  </Button>
                  {missingDownloadJob?.status === 'running' && (
                    <span className="text-xs text-muted-foreground">
                      {((missingDownloadJob.saved / missingDownloadJob.total) * 100).toFixed(0)}% complete
                    </span>
                  )}
                </div>
              )}
              {missingTickers.length > 0 ? (
                <div className="max-h-[200px] overflow-auto border rounded-lg p-2 bg-background text-xs font-mono">
                  {missingTickers.join(', ')}
                </div>
              ) : registryTickers.length === 0 ? (
                <div className="text-muted-foreground text-sm">Loading registry...</div>
              ) : (
                <div className="text-success text-sm">All registry tickers have parquet files!</div>
              )}
            </div>
          </details>

          <details className="group">
            <summary className="cursor-pointer font-bold text-sm py-2 hover:text-primary">
              Data Viewer
            </summary>
            <div className="mt-2">
              {parquetTickers.length > 0 ? (
                <AdminDataPanel tickers={parquetTickers} error={error} />
              ) : (
                <div className="text-muted-foreground text-sm">No parquet files available</div>
              )}
            </div>
          </details>
        </div>
      )}

      {/* User Management Tab - Super Admin Only */}
      {adminTab === 'User Management' && isSuperAdmin && (
        <div className="space-y-6">
          <div className="font-black text-lg">User Management</div>
          <p className="text-sm text-muted-foreground">
            As super admin, you can grant or revoke admin privileges for other users.
            Other admins cannot modify each other's roles.
          </p>

          {adminUsersError && (
            <div className="text-destructive text-sm p-3 bg-destructive/10 rounded-lg">
              {adminUsersError}
            </div>
          )}

          {adminUsersLoading ? (
            <div className="text-muted-foreground">Loading users...</div>
          ) : (
            <Card className="p-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Username</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Last Login</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {adminUsers.map(user => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">
                        {user.displayName || user.username}
                        {user.isSuperAdmin && (
                          <span className="ml-2 text-xs bg-purple-500/20 text-purple-500 px-1 py-0.5 rounded">
                            Main Admin
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{user.email}</TableCell>
                      <TableCell>
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          user.role === 'main_admin' || user.role === 'admin' ? 'bg-purple-500/20 text-purple-500' :
                          user.role === 'sub_admin' ? 'bg-amber-500/20 text-amber-500' :
                          user.role === 'engineer' ? 'bg-blue-500/20 text-blue-500' :
                          user.role === 'partner' ? 'bg-green-500/20 text-green-500' :
                          'bg-muted text-muted-foreground'
                        }`}>
                          {user.role === 'main_admin' || user.role === 'admin' ? 'main_admin' : user.role}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {user.lastLoginAt
                          ? new Date(user.lastLoginAt).toLocaleDateString()
                          : 'Never'}
                      </TableCell>
                      <TableCell className="text-right">
                        {user.isSuperAdmin ? (
                          <span className="text-xs text-muted-foreground italic">Protected</span>
                        ) : (
                          <select
                            className="w-32 h-7 text-xs px-2 rounded border border-border bg-background"
                            value={user.role === 'admin' ? 'main_admin' : user.role}
                            onChange={(e) => void handleChangeRole(user.id, e.target.value)}
                          >
                            <option value="user">user</option>
                            <option value="partner">partner</option>
                            <option value="engineer">engineer</option>
                            <option value="sub_admin">sub_admin</option>
                          </select>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </div>
      )}
    </>
  )
}

// ============================================
// DATABASES PANEL - View all database tables
// ============================================
type DatabasesSubtab = 'Users' | 'Systems' | 'Portfolios' | 'Cache' | 'Admin Config' | 'Tickers'
type DbSortConfig = { col: string; dir: 'asc' | 'desc' }

function DatabasesPanel({
  databasesTab,
  setDatabasesTab,
  onOpenBot,
  onExportBot,
}: {
  databasesTab: DatabasesSubtab
  setDatabasesTab: (t: DatabasesSubtab) => void
  onOpenBot?: (botId: string) => void
  onExportBot?: (botId: string) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<Record<string, unknown>[] | null>(null)
  const [columns, setColumns] = useState<string[]>([])
  const [sortConfig, setSortConfig] = useState<DbSortConfig>({ col: '', dir: 'desc' })

  const fetchTable = useCallback(async (table: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/admin/db/${table}`)
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || `Failed to fetch ${table}`)
      }
      const result = await res.json()
      setData(result.rows || [])
      setColumns(result.columns || [])
    } catch (e) {
      setError(String((e as Error)?.message || e))
      setData(null)
      setColumns([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const tableMap: Record<DatabasesSubtab, string> = {
      'Users': 'users',
      'Systems': 'bots',
      'Portfolios': 'portfolios',
      'Cache': 'cache',
      'Admin Config': 'admin_config',
      'Tickers': 'ticker_registry',
    }
    fetchTable(tableMap[databasesTab])
  }, [databasesTab, fetchTable])

  const formatValue = (val: unknown): string => {
    if (val === null || val === undefined) return '—'
    if (typeof val === 'object') {
      const str = JSON.stringify(val)
      return str.length > 100 ? str.substring(0, 100) + '...' : str
    }
    const str = String(val)
    return str.length > 100 ? str.substring(0, 100) + '...' : str
  }

  return (
    <>
      <div className="flex items-center gap-3 mb-6">
        <div className="font-black text-lg">Databases</div>
        <div className="flex gap-2">
          {(['Users', 'Systems', 'Portfolios', 'Cache', 'Admin Config', 'Tickers'] as const).map((t) => (
            <Button
              key={t}
              variant={databasesTab === t ? 'accent' : 'secondary'}
              size="sm"
              onClick={() => setDatabasesTab(t)}
            >
              {t}
            </Button>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const tableMap: Record<DatabasesSubtab, string> = {
              'Users': 'users',
              'Systems': 'bots',
              'Portfolios': 'portfolios',
              'Cache': 'cache',
              'Admin Config': 'admin_config',
              'Tickers': 'ticker_registry',
            }
            fetchTable(tableMap[databasesTab])
          }}
          disabled={loading}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </Button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-destructive/10 border border-destructive rounded text-destructive text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-muted text-center py-8">Loading...</div>
      ) : data && data.length > 0 ? (
        (() => {
          // Sort data if sort config is set
          const sortedData = sortConfig.col
            ? [...data].sort((a, b) => {
                const aVal = a[sortConfig.col]
                const bVal = b[sortConfig.col]
                // Handle null/undefined
                if (aVal == null && bVal == null) return 0
                if (aVal == null) return sortConfig.dir === 'asc' ? -1 : 1
                if (bVal == null) return sortConfig.dir === 'asc' ? 1 : -1
                // Numeric comparison for stats columns
                if (typeof aVal === 'number' && typeof bVal === 'number') {
                  return sortConfig.dir === 'asc' ? aVal - bVal : bVal - aVal
                }
                // String comparison
                const strA = String(aVal).toLowerCase()
                const strB = String(bVal).toLowerCase()
                return sortConfig.dir === 'asc' ? strA.localeCompare(strB) : strB.localeCompare(strA)
              })
            : data

          const handleSort = (col: string) => {
            if (sortConfig.col === col) {
              setSortConfig({ col, dir: sortConfig.dir === 'asc' ? 'desc' : 'asc' })
            } else {
              setSortConfig({ col, dir: 'desc' })
            }
          }

          // Add Actions column for Systems tab
          const showActions = databasesTab === 'Systems' && (onOpenBot || onExportBot)
          const displayColumns = showActions ? [...columns, 'Actions'] : columns

          return (
            <div className="border rounded-lg overflow-auto max-h-[calc(100vh-300px)]">
              <table className="w-full text-sm">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    {displayColumns.map((col) => (
                      <th
                        key={col}
                        className={`px-3 py-2 text-left font-semibold border-b whitespace-nowrap ${col !== 'Actions' ? 'cursor-pointer hover:bg-accent/20 select-none' : ''}`}
                        onClick={() => col !== 'Actions' && handleSort(col)}
                      >
                        <div className="flex items-center gap-1">
                          {col}
                          {col !== 'Actions' && sortConfig.col === col && (
                            <span className="text-accent">{sortConfig.dir === 'asc' ? '↑' : '↓'}</span>
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedData.map((row, i) => (
                    <tr key={i} className="hover:bg-muted/50 border-b border-border/50">
                      {columns.map((col) => (
                        <td key={col} className="px-3 py-2 font-mono text-xs whitespace-nowrap max-w-[300px] overflow-hidden text-ellipsis">
                          {formatValue(row[col])}
                        </td>
                      ))}
                      {showActions && (
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="flex gap-1">
                            {onExportBot && (
                              <Button size="sm" variant="outline" onClick={() => onExportBot(String(row['id']))}>
                                Export
                              </Button>
                            )}
                            {onOpenBot && (
                              <Button size="sm" variant="outline" onClick={() => onOpenBot(String(row['id']))}>
                                Open
                              </Button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })()
      ) : data && data.length === 0 ? (
        <div className="text-muted text-center py-8">No records found</div>
      ) : null}

      {data && (
        <div className="mt-3 text-xs text-muted">
          Showing {data.length} record{data.length !== 1 ? 's' : ''}
        </div>
      )}
    </>
  )
}

const replaceSlot = (node: FlowNode, parentId: string, slot: SlotId, index: number, child: FlowNode): FlowNode => {
  if (node.id === parentId) {
    const arr = node.children[slot] ?? [null]
    const next = arr.slice()
    next[index] = child
    return { ...node, children: { ...node.children, [slot]: next } }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? replaceSlot(c, parentId, slot, index, child) : c)) : arr
  })
  return { ...node, children }
}

// Insert a node at a specific index (shifts existing nodes down, doesn't replace)
const insertAtSlot = (node: FlowNode, parentId: string, slot: SlotId, index: number, child: FlowNode): FlowNode => {
  if (node.id === parentId) {
    const arr = node.children[slot] ?? [null]
    const next = arr.slice()
    next.splice(index, 0, child)
    return { ...node, children: { ...node.children, [slot]: next } }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? insertAtSlot(c, parentId, slot, index, child) : c)) : arr
  })
  return { ...node, children }
}

const appendPlaceholder = (node: FlowNode, targetId: string, slot: SlotId): FlowNode => {
  if (node.id === targetId) {
    const arr = node.children[slot] ?? [null]
    return { ...node, children: { ...node.children, [slot]: [...arr, null] } }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? appendPlaceholder(c, targetId, slot) : c)) : arr
  })
  return { ...node, children }
}

const deleteNode = (node: FlowNode, targetId: string): FlowNode => {
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    if (!arr) return
    const filtered = arr
      .map((c) => (c ? deleteNode(c, targetId) : c))
      .filter((c) => (c ? c.id !== targetId : true))
    children[s] = filtered.length ? filtered : [null]
  })
  return { ...node, children }
}

const updateTitle = (node: FlowNode, id: string, title: string): FlowNode => {
  if (node.id === id) return { ...node, title }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateTitle(c, id, title) : c)) : arr
  })
  return { ...node, children }
}

const updateWeight = (node: FlowNode, id: string, weighting: WeightMode, branch?: 'then' | 'else'): FlowNode => {
  if (node.id === id) {
    if ((node.kind === 'indicator' || node.kind === 'numbered') && branch) {
      if (branch === 'then') {
        const next: FlowNode = { ...node, weightingThen: weighting }
        if (weighting === 'capped' && !next.cappedFallbackThen) next.cappedFallbackThen = 'Empty'
        if ((weighting === 'inverse' || weighting === 'pro') && !next.volWindowThen) next.volWindowThen = 20
        return next
      }
      const next: FlowNode = { ...node, weightingElse: weighting }
      if (weighting === 'capped' && !next.cappedFallbackElse) next.cappedFallbackElse = 'Empty'
      if ((weighting === 'inverse' || weighting === 'pro') && !next.volWindowElse) next.volWindowElse = 20
      return next
    }
    const next: FlowNode = { ...node, weighting }
    if (weighting === 'capped' && !next.cappedFallback) next.cappedFallback = 'Empty'
    if ((weighting === 'inverse' || weighting === 'pro') && !next.volWindow) next.volWindow = 20
    return next
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateWeight(c, id, weighting, branch) : c)) : arr
  })
  return { ...node, children }
}

const updateCappedFallback = (node: FlowNode, id: string, choice: PositionChoice, branch?: 'then' | 'else'): FlowNode => {
  if (node.id === id) {
    if (branch === 'then') return { ...node, cappedFallbackThen: choice }
    if (branch === 'else') return { ...node, cappedFallbackElse: choice }
    return { ...node, cappedFallback: choice }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateCappedFallback(c, id, choice, branch) : c)) : arr
  })
  return { ...node, children }
}

const updateVolWindow = (node: FlowNode, id: string, days: number, branch?: 'then' | 'else'): FlowNode => {
  if (node.id === id) {
    const nextDays = Math.max(1, Math.floor(Number(days) || 0))
    if (branch === 'then') return { ...node, volWindowThen: nextDays }
    if (branch === 'else') return { ...node, volWindowElse: nextDays }
    return { ...node, volWindow: nextDays }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateVolWindow(c, id, days, branch) : c)) : arr
  })
  return { ...node, children }
}

const updateFunctionWindow = (node: FlowNode, id: string, value: number): FlowNode => {
  if (node.id === id) {
    if (Number.isNaN(value)) return { ...node, window: undefined }
    return { ...node, window: value }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateFunctionWindow(c, id, value) : c)) : arr
  })
  return { ...node, children }
}

const updateFunctionBottom = (node: FlowNode, id: string, value: number): FlowNode => {
  if (node.id === id && node.kind === 'function') return { ...node, bottom: value }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateFunctionBottom(c, id, value) : c)) : arr
  })
  return { ...node, children }
}

const updateFunctionMetric = (node: FlowNode, id: string, metric: MetricChoice): FlowNode => {
  if (node.id === id && node.kind === 'function') return { ...node, metric }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateFunctionMetric(c, id, metric) : c)) : arr
  })
  return { ...node, children }
}

const updateFunctionRank = (node: FlowNode, id: string, rank: RankChoice): FlowNode => {
  if (node.id === id && node.kind === 'function') return { ...node, rank }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateFunctionRank(c, id, rank) : c)) : arr
  })
  return { ...node, children }
}

const updateCollapse = (node: FlowNode, id: string, collapsed: boolean): FlowNode => {
  if (node.id === id) return { ...node, collapsed }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateCollapse(c, id, collapsed) : c)) : arr
  })
  return { ...node, children }
}

// Set collapsed state for all nodes in the tree
const setAllCollapsed = (node: FlowNode, collapsed: boolean): FlowNode => {
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? setAllCollapsed(c, collapsed) : c)) : arr
  })
  return { ...node, collapsed, children }
}

// Set collapsed state for a specific node and all its descendants
const setCollapsedBelow = (root: FlowNode, targetId: string, collapsed: boolean): FlowNode => {
  if (root.id === targetId) {
    // Found the target - collapse/expand it and all descendants
    return setAllCollapsed(root, collapsed)
  }
  // Not the target - recurse to find it
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(root).forEach((s) => {
    const arr = root.children[s]
    children[s] = arr ? arr.map((c) => (c ? setCollapsedBelow(c, targetId, collapsed) : c)) : arr
  })
  return { ...root, children }
}

const updateColor = (node: FlowNode, id: string, color?: string): FlowNode => {
  if (node.id === id) return { ...node, bgColor: color }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateColor(c, id, color) : c)) : arr
  })
  return { ...node, children }
}

const updateCallReference = (node: FlowNode, id: string, callId: string | null): FlowNode => {
  if (node.id === id) {
    return { ...node, callRefId: callId || undefined }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateCallReference(c, id, callId) : c)) : arr
  })
  return { ...node, children }
}

const addPositionRow = (node: FlowNode, id: string): FlowNode => {
  if (node.id === id && node.positions) {
    return { ...node, positions: [...node.positions, 'Empty'] }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? addPositionRow(c, id) : c)) : arr
  })
  return { ...node, children }
}

const removePositionRow = (node: FlowNode, id: string, index: number): FlowNode => {
  if (node.id === id && node.positions) {
    const next = node.positions.slice()
    next.splice(index, 1)
    return { ...node, positions: next.length ? next : ['Empty'] }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? removePositionRow(c, id, index) : c)) : arr
  })
  return { ...node, children }
}

const removeSlotEntry = (node: FlowNode, targetId: string, slot: SlotId, index: number): FlowNode => {
  if (node.id === targetId) {
    const arr = node.children[slot] ?? []
    const next = arr.slice()
    next.splice(index, 1)
    return { ...node, children: { ...node.children, [slot]: next.length ? next : [null] } }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? removeSlotEntry(c, targetId, slot, index) : c)) : arr
  })
  return { ...node, children }
}

const addConditionLine = (node: FlowNode, id: string, type: 'and' | 'or', itemId?: string): FlowNode => {
  if (node.id === id && node.kind === 'indicator') {
    const last = node.conditions && node.conditions.length ? node.conditions[node.conditions.length - 1] : null
    const next = [
      ...(node.conditions ?? []),
      {
        id: newId(),
        type,
        window: last?.window ?? 14,
        metric: (last?.metric as MetricChoice) ?? 'Relative Strength Index',
        comparator: normalizeComparatorChoice(last?.comparator ?? 'lt'),
        ticker: last?.ticker ?? 'SPY',
        threshold: last?.threshold ?? 30,
        expanded: false,
        rightWindow: last?.rightWindow ?? 14,
        rightMetric: (last?.rightMetric as MetricChoice) ?? 'Relative Strength Index',
        rightTicker: last?.rightTicker ?? 'SPY',
      },
    ]
    return { ...node, conditions: next }
  }
  if (node.id === id && node.kind === 'numbered' && node.numbered && itemId) {
    const nextItems = node.numbered.items.map((item) => {
      if (item.id !== itemId) return item
      const last = item.conditions.length ? item.conditions[item.conditions.length - 1] : null
      return {
        ...item,
        conditions: [
          ...item.conditions,
          {
            id: newId(),
            type,
            window: last?.window ?? 14,
            metric: (last?.metric as MetricChoice) ?? 'Relative Strength Index',
            comparator: normalizeComparatorChoice(last?.comparator ?? 'lt'),
            ticker: last?.ticker ?? 'SPY',
            threshold: last?.threshold ?? 30,
            expanded: false,
            rightWindow: last?.rightWindow ?? 14,
            rightMetric: (last?.rightMetric as MetricChoice) ?? 'Relative Strength Index',
            rightTicker: last?.rightTicker ?? 'SPY',
          },
        ],
      }
    })
    return { ...node, numbered: { ...node.numbered, items: nextItems } }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? addConditionLine(c, id, type, itemId) : c)) : arr
  })
  return { ...node, children }
}

const deleteConditionLine = (node: FlowNode, id: string, condId: string, itemId?: string): FlowNode => {
  if (node.id === id && node.kind === 'indicator' && node.conditions) {
    const keep = node.conditions.filter((c, idx) => idx === 0 || c.id !== condId)
    return { ...node, conditions: keep.length ? keep : node.conditions }
  }
  if (node.id === id && node.kind === 'numbered' && node.numbered && itemId) {
    const nextItems = node.numbered.items.map((item) => {
      if (item.id !== itemId) return item
      const keep = item.conditions.filter((c) => c.id !== condId)
      return { ...item, conditions: keep.length ? keep : item.conditions }
    })
    return { ...node, numbered: { ...node.numbered, items: nextItems } }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? deleteConditionLine(c, id, condId, itemId) : c)) : arr
  })
  return { ...node, children }
}

const updateConditionFields = (
  node: FlowNode,
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
  itemId?: string,
): FlowNode => {
  if (node.id === id && node.kind === 'indicator' && node.conditions) {
    const next = node.conditions.map((c) => (c.id === condId ? { ...c, ...updates } : c))
    return { ...node, conditions: next }
  }
  if (node.id === id && node.kind === 'numbered' && node.numbered && itemId) {
    const nextItems = node.numbered.items.map((item) => {
      if (item.id !== itemId) return item
      const next = item.conditions.map((c) => (c.id === condId ? { ...c, ...updates } : c))
      return { ...item, conditions: next }
    })
    return { ...node, numbered: { ...node.numbered, items: nextItems } }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateConditionFields(c, id, condId, updates, itemId) : c)) : arr
  })
  return { ...node, children }
}

// ============================================
// ALT EXIT CONDITION FUNCTIONS
// ============================================

const addEntryCondition = (node: FlowNode, id: string, type: 'and' | 'or'): FlowNode => {
  if (node.id === id && node.kind === 'altExit') {
    const last = node.entryConditions && node.entryConditions.length ? node.entryConditions[node.entryConditions.length - 1] : null
    const next = [
      ...(node.entryConditions ?? []),
      {
        id: newId(),
        type,
        window: last?.window ?? 14,
        metric: (last?.metric as MetricChoice) ?? 'Relative Strength Index',
        comparator: normalizeComparatorChoice(last?.comparator ?? 'gt'),
        ticker: last?.ticker ?? 'SPY',
        threshold: last?.threshold ?? 30,
        expanded: false,
        rightWindow: last?.rightWindow ?? 14,
        rightMetric: (last?.rightMetric as MetricChoice) ?? 'Relative Strength Index',
        rightTicker: last?.rightTicker ?? 'SPY',
      },
    ]
    return { ...node, entryConditions: next }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? addEntryCondition(c, id, type) : c)) : arr
  })
  return { ...node, children }
}

const addExitCondition = (node: FlowNode, id: string, type: 'and' | 'or'): FlowNode => {
  if (node.id === id && node.kind === 'altExit') {
    const last = node.exitConditions && node.exitConditions.length ? node.exitConditions[node.exitConditions.length - 1] : null
    const next = [
      ...(node.exitConditions ?? []),
      {
        id: newId(),
        type,
        window: last?.window ?? 14,
        metric: (last?.metric as MetricChoice) ?? 'Relative Strength Index',
        comparator: normalizeComparatorChoice(last?.comparator ?? 'lt'),
        ticker: last?.ticker ?? 'SPY',
        threshold: last?.threshold ?? 70,
        expanded: false,
        rightWindow: last?.rightWindow ?? 14,
        rightMetric: (last?.rightMetric as MetricChoice) ?? 'Relative Strength Index',
        rightTicker: last?.rightTicker ?? 'SPY',
      },
    ]
    return { ...node, exitConditions: next }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? addExitCondition(c, id, type) : c)) : arr
  })
  return { ...node, children }
}

const deleteEntryCondition = (node: FlowNode, id: string, condId: string): FlowNode => {
  if (node.id === id && node.kind === 'altExit' && node.entryConditions) {
    const keep = node.entryConditions.filter((c, idx) => idx === 0 || c.id !== condId)
    return { ...node, entryConditions: keep.length ? keep : node.entryConditions }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? deleteEntryCondition(c, id, condId) : c)) : arr
  })
  return { ...node, children }
}

const deleteExitCondition = (node: FlowNode, id: string, condId: string): FlowNode => {
  if (node.id === id && node.kind === 'altExit' && node.exitConditions) {
    const keep = node.exitConditions.filter((c, idx) => idx === 0 || c.id !== condId)
    return { ...node, exitConditions: keep.length ? keep : node.exitConditions }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? deleteExitCondition(c, id, condId) : c)) : arr
  })
  return { ...node, children }
}

const updateEntryConditionFields = (
  node: FlowNode,
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
): FlowNode => {
  if (node.id === id && node.kind === 'altExit' && node.entryConditions) {
    const next = node.entryConditions.map((c) => (c.id === condId ? { ...c, ...updates } : c))
    return { ...node, entryConditions: next }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateEntryConditionFields(c, id, condId, updates) : c)) : arr
  })
  return { ...node, children }
}

const updateExitConditionFields = (
  node: FlowNode,
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
): FlowNode => {
  if (node.id === id && node.kind === 'altExit' && node.exitConditions) {
    const next = node.exitConditions.map((c) => (c.id === condId ? { ...c, ...updates } : c))
    return { ...node, exitConditions: next }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateExitConditionFields(c, id, condId, updates) : c)) : arr
  })
  return { ...node, children }
}

// ============================================
// SCALING NODE FUNCTIONS
// ============================================

const updateScalingFields = (
  node: FlowNode,
  id: string,
  updates: Partial<{
    scaleMetric: MetricChoice
    scaleWindow: number
    scaleTicker: string
    scaleFrom: number
    scaleTo: number
  }>,
): FlowNode => {
  if (node.id === id && node.kind === 'scaling') {
    return { ...node, ...updates }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateScalingFields(c, id, updates) : c)) : arr
  })
  return { ...node, children }
}

const updateNumberedQuantifier = (node: FlowNode, id: string, quantifier: NumberedQuantifier): FlowNode => {
  if (node.id === id && node.kind === 'numbered' && node.numbered) {
    return { ...node, numbered: { ...node.numbered, quantifier } }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateNumberedQuantifier(c, id, quantifier) : c)) : arr
  })
  return { ...node, children }
}

const updateNumberedN = (node: FlowNode, id: string, n: number): FlowNode => {
  if (node.id === id && node.kind === 'numbered' && node.numbered) {
    const next = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : node.numbered.n
    return { ...node, numbered: { ...node.numbered, n: next } }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateNumberedN(c, id, n) : c)) : arr
  })
  return { ...node, children }
}

const addNumberedItem = (node: FlowNode, id: string): FlowNode => {
  if (node.id === id && node.kind === 'numbered' && node.numbered) {
    const lastItem = node.numbered.items.length ? node.numbered.items[node.numbered.items.length - 1] : null
    const lastCond = lastItem?.conditions?.length ? lastItem.conditions[lastItem.conditions.length - 1] : null
    const newItem: NumberedItem = {
      id: newId(),
      conditions: [
        {
          id: newId(),
          type: 'if',
          window: lastCond?.window ?? 14,
          metric: (lastCond?.metric as MetricChoice) ?? 'Relative Strength Index',
          comparator: normalizeComparatorChoice(lastCond?.comparator ?? 'lt'),
          ticker: lastCond?.ticker ?? 'SPY',
          threshold: lastCond?.threshold ?? 30,
          expanded: lastCond?.expanded ?? false,
          rightWindow: lastCond?.rightWindow ?? 14,
          rightMetric: (lastCond?.rightMetric as MetricChoice) ?? 'Relative Strength Index',
          rightTicker: lastCond?.rightTicker ?? 'SPY',
        },
      ],
    }
    return { ...node, numbered: { ...node.numbered, items: [...node.numbered.items, newItem] } }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? addNumberedItem(c, id) : c)) : arr
  })
  return { ...node, children }
}

const deleteNumberedItem = (node: FlowNode, id: string, itemId: string): FlowNode => {
  if (node.id === id && node.kind === 'numbered' && node.numbered) {
    const nextItems = node.numbered.items.filter((item, idx) => idx === 0 || item.id !== itemId)
    return { ...node, numbered: { ...node.numbered, items: nextItems.length ? nextItems : node.numbered.items } }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? deleteNumberedItem(c, id, itemId) : c)) : arr
  })
  return { ...node, children }
}

const choosePosition = (node: FlowNode, id: string, index: number, choice: PositionChoice): FlowNode => {
  if (node.id === id && node.positions) {
    const next = node.positions.map((p, i) => (i === index ? choice : p))
    return { ...node, positions: next }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? choosePosition(c, id, index, choice) : c)) : arr
  })
  return { ...node, children }
}

const cloneNode = (node: FlowNode): FlowNode => {
  const cloned: FlowNode = {
    id: newId(),
    kind: node.kind,
    title: node.title,
    children: {},
    positions: node.positions ? [...node.positions] : undefined,
    weighting: node.weighting,
    weightingThen: node.weightingThen,
    weightingElse: node.weightingElse,
    cappedFallback: node.cappedFallback,
    cappedFallbackThen: node.cappedFallbackThen,
    cappedFallbackElse: node.cappedFallbackElse,
    volWindow: node.volWindow,
    volWindowThen: node.volWindowThen,
    volWindowElse: node.volWindowElse,
    conditions: node.conditions ? node.conditions.map((c) => ({ ...c })) : undefined,
    numbered: node.numbered
      ? {
          quantifier: node.numbered.quantifier,
          n: node.numbered.n,
          items: node.numbered.items.map((item) => ({ ...item, conditions: item.conditions.map((c) => ({ ...c })) })),
        }
      : undefined,
    metric: node.metric,
    window: node.window,
    bottom: node.bottom,
    rank: node.rank,
    bgColor: node.bgColor,
    collapsed: node.collapsed,
    callRefId: node.callRefId,
    // Alt Exit properties
    entryConditions: node.entryConditions ? node.entryConditions.map((c) => ({ ...c })) : undefined,
    exitConditions: node.exitConditions ? node.exitConditions.map((c) => ({ ...c })) : undefined,
    // Scaling properties
    scaleMetric: node.scaleMetric,
    scaleWindow: node.scaleWindow,
    scaleTicker: node.scaleTicker,
    scaleFrom: node.scaleFrom,
    scaleTo: node.scaleTo,
  }
  getAllSlotsForNode(node).forEach((slot) => {
    const arr = node.children[slot]
    cloned.children[slot] = arr ? arr.map((c) => (c ? cloneNode(c) : null)) : [null]
  })
  return cloned
}

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

type LineView =
  | { id: string; depth: number; kind: 'text'; text: string; tone?: 'tag' | 'title' }
  | { id: string; depth: number; kind: 'slot'; slot: SlotId }

const buildLines = (node: FlowNode): LineView[] => {
  switch (node.kind) {
    case 'basic':
      return [
        { id: `${node.id}-tag1`, depth: 0, kind: 'text', text: 'Equal Weight', tone: 'tag' },
        { id: `${node.id}-slot`, depth: 1, kind: 'slot', slot: 'next' },
      ]
    case 'function':
      return [
        { id: `${node.id}-desc`, depth: 1, kind: 'text', text: 'Of the 10d RSIs Pick the Bottom 2' },
        { id: `${node.id}-slot`, depth: 2, kind: 'slot', slot: 'next' },
      ]
    case 'indicator':
      return [
        { id: `${node.id}-tag1`, depth: 0, kind: 'text', text: 'Equal Weight', tone: 'tag' },
        { id: `${node.id}-then`, depth: 2, kind: 'text', text: 'Then', tone: 'title' },
        { id: `${node.id}-slot-then`, depth: 3, kind: 'slot', slot: 'then' },
        { id: `${node.id}-else`, depth: 2, kind: 'text', text: 'Else', tone: 'title' },
        { id: `${node.id}-slot-else`, depth: 3, kind: 'slot', slot: 'else' },
      ]
    case 'numbered':
      return [
        { id: `${node.id}-tag1`, depth: 0, kind: 'text', text: 'Equal Weight', tone: 'tag' },
        { id: `${node.id}-then`, depth: 2, kind: 'text', text: 'Then', tone: 'title' },
        { id: `${node.id}-slot-then`, depth: 3, kind: 'slot', slot: 'then' },
        { id: `${node.id}-else`, depth: 2, kind: 'text', text: 'Else', tone: 'title' },
        { id: `${node.id}-slot-else`, depth: 3, kind: 'slot', slot: 'else' },
      ]
    case 'position':
      return [
        { id: `${node.id}-tag1`, depth: 0, kind: 'text', text: 'Equal Weight', tone: 'tag' },
      ]
    case 'call':
      return [{ id: `${node.id}-call`, depth: 1, kind: 'text', text: 'Call reference', tone: 'title' }]
    case 'altExit':
      return [
        { id: `${node.id}-tag1`, depth: 0, kind: 'text', text: 'Equal Weight', tone: 'tag' },
        { id: `${node.id}-then`, depth: 2, kind: 'text', text: 'Then', tone: 'title' },
        { id: `${node.id}-slot-then`, depth: 3, kind: 'slot', slot: 'then' },
        { id: `${node.id}-else`, depth: 2, kind: 'text', text: 'Else', tone: 'title' },
        { id: `${node.id}-slot-else`, depth: 3, kind: 'slot', slot: 'else' },
      ]
    case 'scaling':
      return [
        { id: `${node.id}-tag1`, depth: 0, kind: 'text', text: 'Equal Weight', tone: 'tag' },
        { id: `${node.id}-then`, depth: 2, kind: 'text', text: 'Then (Low)', tone: 'title' },
        { id: `${node.id}-slot-then`, depth: 3, kind: 'slot', slot: 'then' },
        { id: `${node.id}-else`, depth: 2, kind: 'text', text: 'Else (High)', tone: 'title' },
        { id: `${node.id}-slot-else`, depth: 3, kind: 'slot', slot: 'else' },
      ]
  }
}

// Insert menu for adding sibling nodes
const InsertMenu = ({
  parentId,
  parentSlot,
  index,
  onAdd,
  onPaste,
  onPasteCallRef,
  clipboard,
  copiedCallChainId,
  onClose,
}: {
  parentId: string
  parentSlot: SlotId
  index: number
  onAdd: (parentId: string, slot: SlotId, index: number, kind: BlockKind) => void
  onPaste: (parentId: string, slot: SlotId, index: number, child: FlowNode) => void
  onPasteCallRef: (parentId: string, slot: SlotId, index: number, callChainId: string) => void
  clipboard: FlowNode | null
  copiedCallChainId: string | null
  onClose: () => void
}) => (
  <div className="insert-menu" onClick={(e) => e.stopPropagation()}>
    <button onClick={() => { onAdd(parentId, parentSlot, index, 'position'); onClose() }}>
      Ticker
    </button>
    <button onClick={() => { onAdd(parentId, parentSlot, index, 'basic'); onClose() }}>
      Weighted
    </button>
    <button onClick={() => { onAdd(parentId, parentSlot, index, 'function'); onClose() }}>
      Filtered
    </button>
    <button onClick={() => { onAdd(parentId, parentSlot, index, 'indicator'); onClose() }}>
      If/Else
    </button>
    <button onClick={() => { onAdd(parentId, parentSlot, index, 'numbered'); onClose() }}>
      Numbered
    </button>
    {copiedCallChainId && (
      <button onClick={() => { onPasteCallRef(parentId, parentSlot, index, copiedCallChainId); onClose() }}>
        Paste Call Reference
      </button>
    )}
    <button onClick={() => { onAdd(parentId, parentSlot, index, 'altExit'); onClose() }}>
      Enter/Exit
    </button>
    <button onClick={() => { onAdd(parentId, parentSlot, index, 'scaling'); onClose() }}>
      Mixed
    </button>
    {clipboard && (
      <button onClick={() => { onPaste(parentId, parentSlot, index, clipboard); onClose() }}>
        Paste
      </button>
    )}
  </div>
)

type CardProps = {
  node: FlowNode
  depth: number
  // Parent context for sibling insertion
  parentId: string | null
  parentSlot: SlotId | null
  myIndex: number
  inheritedWeight?: number
  weightMode?: WeightMode
  isSortChild?: boolean
  errorNodeIds?: Set<string>
  focusNodeId?: string | null
  tickerOptions: string[]
  onAdd: (parentId: string, slot: SlotId, index: number, kind: BlockKind) => void
  onAppend: (parentId: string, slot: SlotId) => void
  onRemoveSlotEntry: (parentId: string, slot: SlotId, index: number) => void
  onDelete: (id: string) => void
  onCopy: (id: string) => void
  onPaste: (parentId: string, slot: SlotId, index: number, child: FlowNode) => void
  onPasteCallRef: (parentId: string, slot: SlotId, index: number, callChainId: string) => void
  onRename: (id: string, title: string) => void
  onWeightChange: (id: string, weight: WeightMode, branch?: 'then' | 'else') => void
  onUpdateCappedFallback: (id: string, choice: PositionChoice, branch?: 'then' | 'else') => void
  onUpdateVolWindow: (id: string, days: number, branch?: 'then' | 'else') => void
  onColorChange: (id: string, color?: string) => void
  onToggleCollapse: (id: string, collapsed: boolean) => void
  onExpandAllBelow: (id: string, collapsed: boolean) => void
  onNumberedQuantifier: (id: string, quantifier: NumberedQuantifier) => void
  onNumberedN: (id: string, n: number) => void
  onAddNumberedItem: (id: string) => void
  onDeleteNumberedItem: (id: string, itemId: string) => void
  onAddCondition: (id: string, type: 'and' | 'or', itemId?: string) => void
  onDeleteCondition: (id: string, condId: string, itemId?: string) => void
  onFunctionWindow: (id: string, value: number) => void
  onFunctionBottom: (id: string, value: number) => void
  onFunctionMetric: (id: string, metric: MetricChoice) => void
  onFunctionRank: (id: string, rank: RankChoice) => void
  onUpdateCondition: (
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
      forDays?: number
    }>,
    itemId?: string,
  ) => void
  onAddPosition: (id: string) => void
  onRemovePosition: (id: string, index: number) => void
  onChoosePosition: (id: string, index: number, choice: PositionChoice) => void
  clipboard: FlowNode | null
  copiedNodeId: string | null
  copiedCallChainId: string | null
  callChains: CallChain[]
  onUpdateCallRef: (id: string, callId: string | null) => void
  // Alt Exit handlers
  onAddEntryCondition: (id: string, type: 'and' | 'or') => void
  onAddExitCondition: (id: string, type: 'and' | 'or') => void
  onDeleteEntryCondition: (id: string, condId: string) => void
  onDeleteExitCondition: (id: string, condId: string) => void
  onUpdateEntryCondition: (
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
  ) => void
  onUpdateExitCondition: (
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
  ) => void
  // Scaling handlers
  onUpdateScaling: (
    id: string,
    updates: Partial<{
      scaleMetric: MetricChoice
      scaleWindow: number
      scaleTicker: string
      scaleFrom: number
      scaleTo: number
    }>,
  ) => void
  // Find/Replace highlighting
  highlightedInstance?: TickerInstance | null
  // Indicator overlay toggle
  enabledOverlays?: Set<string>
  onToggleOverlay?: (key: string) => void
}

// Check if all descendants of a node are collapsed
const areAllDescendantsCollapsed = (node: FlowNode): boolean => {
  const slots = getAllSlotsForNode(node)
  for (const slot of slots) {
    const children = node.children[slot]
    if (!children) continue
    for (const child of children) {
      if (!child) continue
      // If any child is expanded, return false
      if (!child.collapsed) return false
      // Recursively check children
      if (!areAllDescendantsCollapsed(child)) return false
    }
  }
  return true
}

const NodeCard = ({
  node,
  depth,
  parentId: _parentId,
  parentSlot: _parentSlot,
  myIndex: _myIndex,
  inheritedWeight,
  weightMode,
  isSortChild,
  errorNodeIds,
  focusNodeId,
  tickerOptions,
  onAdd,
  onAppend,
  onRemoveSlotEntry,
  onDelete,
  onCopy,
  onPaste,
  onPasteCallRef,
  onRename,
  onWeightChange,
  onUpdateCappedFallback,
  onUpdateVolWindow,
  onColorChange,
  onToggleCollapse,
  onExpandAllBelow,
  onNumberedQuantifier,
  onNumberedN,
  onAddNumberedItem,
  onDeleteNumberedItem,
  onAddCondition,
  onDeleteCondition,
  onFunctionWindow,
  onFunctionBottom,
  onFunctionMetric,
  onFunctionRank,
  onUpdateCondition,
  onAddPosition,
  onRemovePosition,
  onChoosePosition,
  clipboard,
  copiedNodeId,
  copiedCallChainId,
  callChains,
  onUpdateCallRef,
  onAddEntryCondition,
  onAddExitCondition,
  onDeleteEntryCondition,
  onDeleteExitCondition,
  onUpdateEntryCondition,
  onUpdateExitCondition,
  onUpdateScaling,
  highlightedInstance,
  enabledOverlays,
  onToggleOverlay,
}: CardProps) => {
  const [addRowOpen, setAddRowOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(node.title)
  const [positionDrafts, setPositionDrafts] = useState<Record<string, string>>({})
  const [weightMainOpen, setWeightMainOpen] = useState(false)
  const [weightThenOpen, setWeightThenOpen] = useState(false)
  const [weightElseOpen, setWeightElseOpen] = useState(false)
  const [colorOpen, setColorOpen] = useState(false)
  const [expandedLadderRows, setExpandedLadderRows] = useState<Set<string>>(() => new Set())

  const lines = useMemo(() => buildLines(node), [node])
  const palette = useMemo(
    () => ['#F8E1E7', '#E5F2FF', '#E3F6F5', '#FFF4D9', '#EDE7FF', '#E1F0DA', '#F9EBD7', '#E7F7FF', '#F3E8FF', '#EAF3FF'],
    [],
  )
  const callChainMap = useMemo(() => new Map(callChains.map((c) => [c.id, c])), [callChains])

  useEffect(() => {
    const close = () => {
      setWeightMainOpen(false)
      setWeightThenOpen(false)
      setWeightElseOpen(false)
      setAddRowOpen(null)
      setColorOpen(false)
    }
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  const collapsed = node.collapsed ?? false

  const renderSlot = (slot: SlotId, depthPx: number) => {
    const arr = node.children[slot] ?? [null]
    const indexedChildren = arr
      .map((c, i) => ({ c, i }))
      .filter((entry): entry is { c: FlowNode; i: number } => Boolean(entry.c))
    const slotWeighting =
      (node.kind === 'indicator' || node.kind === 'numbered') && (slot === 'then' || slot === 'else')
        ? slot === 'then'
          ? node.weightingThen ?? node.weighting
          : node.weightingElse ?? node.weighting
        : node.weighting
    const childCount = indexedChildren.length
    // For Sort (function) nodes, default equal share is 100 / bottom (Top/Bottom N),
    // otherwise fall back to splitting by actual child count.
    const targetCount =
      node.kind === 'function' && slot === 'next'
        ? Math.max(1, Number((node.bottom ?? childCount) || 1))
        : Math.max(1, childCount || 1)
    const autoShare = slotWeighting === 'equal' ? Number((100 / targetCount).toFixed(2)) : undefined
    if (childCount === 0) {
      const key = `${slot}-empty`
      const indentWidth = depthPx * 1 + 14 + (slot === 'then' || slot === 'else' ? 14 : 0)
      return (
        <div className="slot-block" key={`${node.id}-${slot}`}>
          <div className="line insert-empty-line">
            <div
              className="indent with-line insert-line-anchor"
              style={{ width: indentWidth }}
            >
              <div className="insert-empty-container" style={{ left: indentWidth }}>
                <button
                  className="insert-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    setAddRowOpen((v) => (v === key ? null : key))
                  }}
                  title="Insert node"
                >
                  +
                </button>
                {addRowOpen === key && (
                  <InsertMenu
                    parentId={node.id}
                    parentSlot={slot}
                    index={0}
                    onAdd={onAdd}
                    onPaste={onPaste}
                    onPasteCallRef={onPasteCallRef}
                    clipboard={clipboard}
                    copiedCallChainId={copiedCallChainId}
                    onClose={() => setAddRowOpen(null)}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )
    }
    return (
      <div className="slot-block" key={`${node.id}-${slot}`}>
        {indexedChildren.map(({ c: child, i: originalIndex }, index) => {
          // Fixed indent width so all cards align at the same horizontal position
          const fixedIndentWidth = 15
          const connectorWidth = 170
          return (
          <div key={`${slot}-${originalIndex}`}>
            {/* Node card line with Insert Above button on the horizontal connector */}
            <div className="line node-line">
              <div className="connector-h-line" style={{ left: fixedIndentWidth, width: connectorWidth }} />
              <div
                className="indent with-line insert-line-anchor"
                style={{ width: fixedIndentWidth }}
              >
                <div className="insert-above-container" style={{ left: fixedIndentWidth }}>
                  <button
                    className="insert-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      const key = `${slot}-above-${originalIndex}`
                      setAddRowOpen((v) => (v === key ? null : key))
                    }}
                    title="Insert node above"
                  >
                    +
                  </button>
                  {addRowOpen === `${slot}-above-${originalIndex}` && (
                    <InsertMenu
                      parentId={node.id}
                      parentSlot={slot}
                      index={originalIndex}
                      onAdd={onAdd}
                      onPaste={onPaste}
                      onPasteCallRef={onPasteCallRef}
                      clipboard={clipboard}
                      copiedCallChainId={copiedCallChainId}
                      onClose={() => setAddRowOpen(null)}
                    />
                  )}
                </div>
              </div>
              <div className="slot-body">
                <NodeCard
                  node={child}
                  depth={depth + 1}
                  parentId={node.id}
                  parentSlot={slot}
                  myIndex={originalIndex}
                    inheritedWeight={autoShare}
                    weightMode={slotWeighting}
                    isSortChild={node.kind === 'function' && slot === 'next'}
                    errorNodeIds={errorNodeIds}
                    focusNodeId={focusNodeId}
                    tickerOptions={tickerOptions}
                    onAdd={onAdd}
                    onAppend={onAppend}
                    onRemoveSlotEntry={onRemoveSlotEntry}
                    onDelete={onDelete}
                    onCopy={onCopy}
                    onPaste={onPaste}
                    onPasteCallRef={onPasteCallRef}
                    onRename={onRename}
                    onWeightChange={onWeightChange}
                    onUpdateCappedFallback={onUpdateCappedFallback}
                    onUpdateVolWindow={onUpdateVolWindow}
                    onColorChange={onColorChange}
                    onToggleCollapse={onToggleCollapse}
                    onExpandAllBelow={onExpandAllBelow}
                    onNumberedQuantifier={onNumberedQuantifier}
                    onNumberedN={onNumberedN}
                    onAddNumberedItem={onAddNumberedItem}
                    onDeleteNumberedItem={onDeleteNumberedItem}
                    onAddCondition={onAddCondition}
                    onDeleteCondition={onDeleteCondition}
                    onFunctionWindow={onFunctionWindow}
                    onFunctionBottom={onFunctionBottom}
                    onFunctionMetric={onFunctionMetric}
                    onFunctionRank={onFunctionRank}
                    onUpdateCondition={onUpdateCondition}
                    onAddPosition={onAddPosition}
                    onRemovePosition={onRemovePosition}
                  onChoosePosition={onChoosePosition}
                  clipboard={clipboard}
                  copiedNodeId={copiedNodeId}
                  copiedCallChainId={copiedCallChainId}
                  callChains={callChains}
                  onUpdateCallRef={onUpdateCallRef}
                  onAddEntryCondition={onAddEntryCondition}
                  onAddExitCondition={onAddExitCondition}
                  onDeleteEntryCondition={onDeleteEntryCondition}
                  onDeleteExitCondition={onDeleteExitCondition}
                  onUpdateEntryCondition={onUpdateEntryCondition}
                  onUpdateExitCondition={onUpdateExitCondition}
                  onUpdateScaling={onUpdateScaling}
                  highlightedInstance={highlightedInstance}
                  enabledOverlays={enabledOverlays}
                  onToggleOverlay={onToggleOverlay}
                />
                {node.kind === 'function' && slot === 'next' && index > 0 ? (
                  <Button variant="destructive" size="icon" className="h-7 w-7" onClick={() => onRemoveSlotEntry(node.id, slot, index)}>
                    X
                  </Button>
                ) : null}
              </div>
            </div>
            {/* Insert Below - only show after the last node in the slot */}
            {index === indexedChildren.length - 1 && (
              <div className="line insert-below-line">
                <div className="connector-h-line" style={{ left: fixedIndentWidth, width: connectorWidth }} />
                <div
                  className="indent with-line insert-line-anchor"
                  style={{ width: fixedIndentWidth }}
                >
                  <div className="insert-below-container" style={{ left: fixedIndentWidth }}>
                    <button
                      className="insert-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        const key = `${slot}-below-${originalIndex}`
                        setAddRowOpen((v) => (v === key ? null : key))
                      }}
                      title="Insert node below"
                    >
                      +
                    </button>
                    {addRowOpen === `${slot}-below-${originalIndex}` && (
                      <InsertMenu
                        parentId={node.id}
                        parentSlot={slot}
                        index={originalIndex + 1}
                        onAdd={onAdd}
                        onPaste={onPaste}
                        onPasteCallRef={onPasteCallRef}
                        clipboard={clipboard}
                        copiedCallChainId={copiedCallChainId}
                        onClose={() => setAddRowOpen(null)}
                      />
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )})}
      </div>
    )
  }

  const renderPosition = () => {
    if (node.kind !== 'position' || !node.positions) return null
    return (
      <div className="positions">
        {node.positions.map((p, idx) => (
          <div className="position-row" key={`${node.id}-pos-${idx}`}>
            <div className="indent w-3.5" />
            <div className="pill-select">
              {(() => {
                const key = `${node.id}-pos-${idx}`
                const draftValue = Object.prototype.hasOwnProperty.call(positionDrafts, key) ? positionDrafts[key] : undefined
                const shown = draftValue ?? p
                const commit = (raw: string) => {
                  const normalized = String(raw || '').trim().toUpperCase()
                  const next = !normalized ? 'Empty' : normalized === 'EMPTY' ? 'Empty' : normalized
                  onChoosePosition(node.id, idx, next)
                }

                return (
                  <input
                    list={TICKER_DATALIST_ID}
                    value={shown}
                    onFocus={(e) => {
                      e.currentTarget.select()
                      if ((draftValue ?? p) === 'Empty') {
                        setPositionDrafts((prev) => ({ ...prev, [key]: '' }))
                      }
                    }}
                    onChange={(e) => {
                      setPositionDrafts((prev) => ({ ...prev, [key]: e.target.value }))
                    }}
                    onBlur={(e) => {
                      commit(e.target.value)
                      setPositionDrafts((prev) => {
                        const next = { ...prev }
                        delete next[key]
                        return next
                      })
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
                      if (e.key === 'Escape') {
                        setPositionDrafts((prev) => {
                          const next = { ...prev }
                          delete next[key]
                          return next
                        })
                      }
                    }}
                    placeholder="Ticker"
                    spellCheck={false}
                    className="w-[120px]"
                  />
                )
              })()}
            </div>
            {idx > 0 && (
              <Button variant="destructive" size="icon" className="h-7 w-7" onClick={() => onRemovePosition(node.id, idx)}>
                X
              </Button>
            )}
          </div>
        ))}
        <div className="flex items-center gap-2">
          <div className="w-3.5" />
          <Button variant="outline" size="sm" onClick={() => onAddPosition(node.id)}>
            +
          </Button>
        </div>
      </div>
    )
  }

  const renderCallReference = () => {
    if (node.kind !== 'call') return null
    const linked = node.callRefId ? callChainMap.get(node.callRefId) : null
    return (
      <div className="flex items-center gap-2">
        <div className="w-3.5 h-full border-l border-border" />
        <div className="py-2">
          {callChains.length === 0 ? (
            <div className="text-muted font-bold">Create a Call in the side panel first.</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Select
                value={node.callRefId ?? ''}
                onChange={(e) => onUpdateCallRef(node.id, e.target.value || null)}
                className="max-w-64"
              >
                <option value="">Select a call chain…</option>
                {callChains.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              {linked ? (
                <div className="text-xs text-slate-600 font-extrabold">Linked to: {linked.name}</div>
              ) : (
                <div className="text-xs text-muted font-bold">No call selected.</div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  const renderWeightDetailChip = (branch?: 'then' | 'else') => {
    const mode =
      branch === 'then'
        ? node.weightingThen ?? node.weighting
        : branch === 'else'
          ? node.weightingElse ?? node.weighting
          : node.weighting
    if (mode !== 'capped' && mode !== 'inverse' && mode !== 'pro') return null

    const volDays =
      mode === 'inverse' || mode === 'pro'
        ? branch === 'then'
          ? node.volWindowThen ?? node.volWindow ?? 20
          : branch === 'else'
            ? node.volWindowElse ?? node.volWindow ?? 20
            : node.volWindow ?? 20
        : null

    if (mode === 'capped') {
      const choice =
        branch === 'then'
          ? node.cappedFallbackThen ?? 'Empty'
          : branch === 'else'
            ? node.cappedFallbackElse ?? 'Empty'
            : node.cappedFallback ?? 'Empty'

      const key = `${node.id}-capfb-${branch ?? 'main'}`
      const draftValue = Object.prototype.hasOwnProperty.call(positionDrafts, key) ? positionDrafts[key] : undefined
      const shown = draftValue ?? choice
      const commit = (raw: string) => {
        const normalized = String(raw || '').trim().toUpperCase()
        const next = !normalized ? 'Empty' : normalized === 'EMPTY' ? 'Empty' : normalized
        onUpdateCappedFallback(node.id, next, branch)
      }

      return (
        <Badge variant="default" className="gap-1.5 py-1 px-2.5">
          <span>Fallback</span>
          <Input
            list={TICKER_DATALIST_ID}
            value={shown}
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => {
              e.stopPropagation()
              e.currentTarget.select()
              if ((draftValue ?? choice) === 'Empty') {
                setPositionDrafts((prev) => ({ ...prev, [key]: '' }))
              }
            }}
            onChange={(e) => {
              e.stopPropagation()
              setPositionDrafts((prev) => ({ ...prev, [key]: e.target.value }))
            }}
            onBlur={(e) => {
              e.stopPropagation()
              commit(e.target.value)
              setPositionDrafts((prev) => {
                const next = { ...prev }
                delete next[key]
                return next
              })
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
              if (e.key === 'Escape') {
                setPositionDrafts((prev) => {
                  const next = { ...prev }
                  delete next[key]
                  return next
                })
              }
            }}
            placeholder="Ticker"
            spellCheck={false}
            className="w-[120px] h-7 px-1.5 inline-flex"
          />
        </Badge>
      )
    }

    return (
      <Badge variant="default" className="gap-1.5 py-1 px-2.5">
        <span>of the last</span>
        <Input
          type="number"
          value={volDays ?? 20}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onUpdateVolWindow(node.id, Number(e.target.value), branch)}
          className="w-[70px] h-7 px-1.5 inline-flex"
          min={1}
        />
        <span>days</span>
      </Badge>
    )
  }

  const renderConditionRow = (
    ownerId: string,
    cond: ConditionLine,
    idx: number,
    total: number,
    itemId?: string,
    allowDeleteFirst?: boolean,
  ) => {
    const prefix = cond.type === 'and' ? 'And if the ' : cond.type === 'or' ? 'Or if the ' : 'If the '
    const isSingleLineItem = total === 1
    return (
      <div className="flex items-center gap-2" key={cond.id}>
        <Badge variant="default" className="gap-1 py-1 px-2.5">
          {prefix}
          {isWindowlessIndicator(cond.metric) ? null : (
            <>
              <Input
                className="w-14 h-8 px-1.5 mx-1 inline-flex"
                type="number"
                value={cond.window}
                onChange={(e) => onUpdateCondition(ownerId, cond.id, { window: Number(e.target.value) }, itemId)}
              />
              d{' '}
            </>
          )}
          <IndicatorDropdown
            value={cond.metric}
            onChange={(m) => onUpdateCondition(ownerId, cond.id, { metric: m }, itemId)}
            className="h-8 px-1.5 mx-1"
          />
          {' of '}
          <Select
            className="h-8 px-1.5 mx-1"
            value={cond.ticker}
            onChange={(e) => onUpdateCondition(ownerId, cond.id, { ticker: e.target.value as PositionChoice }, itemId)}
          >
            {[cond.ticker, ...tickerOptions.filter((t) => t !== cond.ticker)].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>{' '}
          is{' '}
          <Select
            className="h-8 px-1.5 mx-1"
            value={cond.comparator}
            onChange={(e) =>
              onUpdateCondition(ownerId, cond.id, { comparator: e.target.value as ComparatorChoice }, itemId)
            }
          >
            <option value="lt">Less Than</option>
            <option value="gt">Greater Than</option>
          </Select>{' '}
          {cond.expanded ? null : (
            <Input
              className="w-14 h-8 px-1.5 mx-1 inline-flex"
              type="number"
              value={cond.threshold}
              onChange={(e) => onUpdateCondition(ownerId, cond.id, { threshold: Number(e.target.value) }, itemId)}
            />
          )}
          {cond.expanded ? (
            <>
              {' '}
              the{' '}
              {isWindowlessIndicator(cond.rightMetric ?? 'Relative Strength Index') ? null : (
                <>
                  <Input
                    className="w-14 h-8 px-1.5 mx-1 inline-flex"
                    type="number"
                    value={cond.rightWindow ?? 14}
                    onChange={(e) => onUpdateCondition(ownerId, cond.id, { rightWindow: Number(e.target.value) }, itemId)}
                  />
                  d{' '}
                </>
              )}
              <IndicatorDropdown
                value={cond.rightMetric ?? 'Relative Strength Index'}
                onChange={(m) => onUpdateCondition(ownerId, cond.id, { rightMetric: m }, itemId)}
                className="h-8 px-1.5 mx-1"
              />{' '}
              of{' '}
              <Select
                className="h-8 px-1.5 mx-1"
                value={cond.rightTicker ?? 'SPY'}
                onChange={(e) =>
                  onUpdateCondition(ownerId, cond.id, { rightTicker: e.target.value as PositionChoice }, itemId)
                }
              >
                {[cond.rightTicker ?? 'SPY', ...tickerOptions.filter((t) => t !== (cond.rightTicker ?? 'SPY'))].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>{' '}
            </>
          ) : null}
          {/* For X consecutive days input */}
          {' '}for{' '}
          <Input
            className="w-12 h-7 px-1.5 mx-1 inline-flex text-center"
            type="number"
            min={1}
            value={cond.forDays ?? 1}
            onChange={(e) => {
              const val = Math.max(1, Number(e.target.value) || 1)
              onUpdateCondition(ownerId, cond.id, { forDays: val > 1 ? val : undefined }, itemId)
            }}
          />
          {' '}day{(cond.forDays ?? 1) !== 1 ? 's' : ''}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 p-0"
            onClick={(e) => {
              e.stopPropagation()
              onUpdateCondition(ownerId, cond.id, { expanded: !cond.expanded }, itemId)
            }}
            title="Flip condition"
          >
            ↔
          </Button>
        </Badge>
        {((total > 1 && (idx > 0 || allowDeleteFirst)) || (allowDeleteFirst && isSingleLineItem)) ? (
          <Button
            variant="destructive"
            size="icon"
            className="h-7 w-7 p-0"
            onClick={() => {
              if (allowDeleteFirst && isSingleLineItem && itemId) {
                onDeleteNumberedItem(ownerId, itemId)
                return
              }
              onDeleteCondition(ownerId, cond.id, itemId)
            }}
          >
            X
          </Button>
        ) : null}
      </div>
    )
  }

  const hasBacktestError = Boolean(errorNodeIds?.has(node.id))
  const hasBacktestFocus = Boolean(focusNodeId && focusNodeId === node.id)

  return (
    <div
      id={`node-${node.id}`}
      data-node-id={node.id}
      className={`node-card${hasBacktestError ? ' backtest-error' : ''}${hasBacktestFocus ? ' backtest-focus' : ''}${highlightedInstance?.nodeId === node.id ? ' find-highlight' : ''}`}
      style={{ background: node.bgColor || undefined }}
    >
      <div className="node-head" onClick={() => onToggleCollapse(node.id, !collapsed)}>
        {/* Action buttons - left aligned */}
        <div className="flex items-center gap-1.5">
          {/* Delete button - bold red X */}
          <Button
            variant="ghost"
            size="sm"
            className="text-red-600 font-bold hover:text-red-700 hover:bg-red-100"
            onClick={(e) => {
              e.stopPropagation()
              onDelete(node.id)
            }}
            title="Delete this node"
          >
            ✕
          </Button>
          {/* Collapse/Expand All descendants */}
          {node.kind !== 'position' && node.kind !== 'call' && (() => {
            // "All" is active only when this node AND all descendants are collapsed
            const allCollapsed = collapsed && areAllDescendantsCollapsed(node)
            return (
              <Button
                variant={allCollapsed ? 'accent' : 'ghost'}
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  onExpandAllBelow(node.id, allCollapsed)
                }}
                title={allCollapsed ? 'Expand this node and all descendants' : 'Collapse this node and all descendants'}
              >
                {allCollapsed ? '⊞' : '⊟'}
              </Button>
            )
          })()}
          {/* Copy button - filled when this node is copied */}
          <Button
            variant={copiedNodeId === node.id ? 'accent' : 'ghost'}
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onCopy(node.id)
            }}
            title={copiedNodeId === node.id ? 'This node is copied' : 'Copy this node'}
          >
            ⧉
          </Button>
          {/* Color picker button - filled when color is set */}
          <div className="relative">
            <Button
              variant={node.bgColor ? 'accent' : 'ghost'}
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                setColorOpen((v) => !v)
              }}
              title={node.bgColor ? 'Change color (color is set)' : 'Set color'}
            >
              ◐
            </Button>
            {colorOpen ? (
              <div
                className="absolute top-full mt-1 left-0 flex gap-1 p-2 bg-surface border border-border rounded-lg shadow-lg z-[200]"
                onClick={(e) => {
                  e.stopPropagation()
                }}
              >
                {palette.map((c) => (
                  <button
                    key={c}
                    className="w-6 h-6 rounded border border-border hover:scale-110 transition-transform"
                    style={{ background: c }}
                    onClick={() => {
                      onColorChange(node.id, c)
                      setColorOpen(false)
                    }}
                    aria-label={`Select color ${c}`}
                  />
                ))}
                <button
                  className="w-6 h-6 rounded border border-border hover:scale-110 transition-transform bg-surface text-muted flex items-center justify-center text-xs"
                  onClick={() => {
                    onColorChange(node.id, undefined)
                    setColorOpen(false)
                  }}
                  aria-label="Reset color"
                >
                  ⨯
                </button>
              </div>
            ) : null}
          </div>
        </div>
        {/* Title and weight - after buttons */}
        {editing ? (
          <input
            className="title-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              onRename(node.id, draft || node.title)
              setEditing(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onRename(node.id, draft || node.title)
                setEditing(false)
              }
            }}
            autoFocus
          />
        ) : (
          <div
            className="node-title"
            onClick={() => {
              setDraft(node.title)
              setEditing(true)
            }}
          >
            {depth === 0 ? (
              node.title
            ) : (
              <>
                {(() => {
                  const mode = weightMode ?? node.weighting
                  const isEqual = mode === 'equal'
                  const isVol = mode === 'inverse' || mode === 'pro'
                  const isDefined = mode === 'defined' || mode === 'capped'
                  const displayValue = isVol
                    ? '???'
                    : isEqual
                      ? String(inheritedWeight ?? 100)
                      : isDefined
                        ? node.window !== undefined
                          ? String(node.window)
                          : ''
                        : node.window !== undefined
                          ? String(node.window)
                          : ''
                  const readOnly = isEqual || isVol
                  const inputType = 'text'
                  return (
                    <input
                      className="inline-number"
                      type={inputType}
                      value={displayValue}
                      readOnly={readOnly}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        if (readOnly) return
                        const raw = e.target.value
                        if (raw === '') {
                          onFunctionWindow(node.id, NaN as unknown as number)
                          return
                        }
                        const val = Number(raw)
                        if (!Number.isNaN(val)) onFunctionWindow(node.id, val)
                      }}
                    />
                  )
                })()}{' '}
                {isSortChild ? '%?' : '%'} {node.title}
              </>
            )}
          </div>
        )}
        {/* Node ID badge - top right */}
        <span className="node-id-badge">{shortNodeId(node.id)}</span>
      </div>

      {!collapsed && (
        <>
          <div className="lines">
            {node.kind === 'indicator' ? (
              <>
                <div className="condition-bubble">
                {node.conditions?.map((cond, idx) => {
                  const prefix =
                    cond.type === 'and' ? 'And if the ' : cond.type === 'or' ? 'Or if the ' : 'If the '
                  const overlayKey = `${node.id}:${cond.id}`
                  const isOverlayActive = enabledOverlays?.has(overlayKey)
                  return (
                    <div className="flex items-center gap-2" key={cond.id}>
                      <div className="w-3.5 h-full border-l border-border" />
                      {/* Indicator overlay toggle button */}
                      {onToggleOverlay && idx === 0 && (
                        <Button
                          variant={isOverlayActive ? 'accent' : 'ghost'}
                          size="sm"
                          className={`h-6 w-6 p-0 text-xs ${isOverlayActive ? 'ring-2 ring-accent' : ''}`}
                          onClick={() => onToggleOverlay(overlayKey)}
                          title={isOverlayActive ? 'Hide indicator on chart' : 'Show indicator on chart'}
                        >
                          📈
                        </Button>
                      )}
                      <Badge variant="default" className="gap-1 py-1 px-2.5">
                        {prefix}
                        {isWindowlessIndicator(cond.metric) ? null : (
                          <>
                            <Input
                              className="w-14 h-8 px-1.5 mx-1 inline-flex"
                              type="number"
                              value={cond.window}
                              onChange={(e) => onUpdateCondition(node.id, cond.id, { window: Number(e.target.value) })}
                            />
                            d{' '}
                          </>
                        )}
                        <IndicatorDropdown
                          value={cond.metric}
                          onChange={(m) => onUpdateCondition(node.id, cond.id, { metric: m })}
                          className="h-8 px-1.5 mx-1"
                        />
                        {' of '}
                        <Select
                          className="h-8 px-1.5 mx-1"
                          value={cond.ticker}
                          onChange={(e) =>
                            onUpdateCondition(node.id, cond.id, { ticker: e.target.value as PositionChoice })
                          }
                        >
                          {[cond.ticker, ...tickerOptions.filter((t) => t !== cond.ticker)].map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </Select>{' '}
                        is{' '}
                        <Select
                          className="h-8 px-1.5 mx-1"
                          value={cond.comparator}
                          onChange={(e) =>
                            onUpdateCondition(node.id, cond.id, { comparator: e.target.value as ComparatorChoice })
                          }
                        >
                          <option value="lt">Less Than</option>
                          <option value="gt">Greater Than</option>
                        </Select>{' '}
                        {cond.expanded ? null : (
                          <Input
                            className="w-14 h-8 px-1.5 mx-1 inline-flex"
                            type="number"
                            value={cond.threshold}
                            onChange={(e) => onUpdateCondition(node.id, cond.id, { threshold: Number(e.target.value) })}
                          />
                        )}
                        {cond.expanded ? (
                          <>
                            {' '}
                            the{' '}
                            {isWindowlessIndicator(cond.rightMetric ?? 'Relative Strength Index') ? null : (
                              <>
                                <Input
                                  className="w-14 h-8 px-1.5 mx-1 inline-flex"
                                  type="number"
                                  value={cond.rightWindow ?? 14}
                                  onChange={(e) =>
                                    onUpdateCondition(node.id, cond.id, { rightWindow: Number(e.target.value) })
                                  }
                                />
                                d{' '}
                              </>
                            )}
                            <IndicatorDropdown
                              value={cond.rightMetric ?? 'Relative Strength Index'}
                              onChange={(m) => onUpdateCondition(node.id, cond.id, { rightMetric: m })}
                              className="h-8 px-1.5 mx-1"
                            />{' '}
                            of{' '}
                            <Select
                              className="h-8 px-1.5 mx-1"
                              value={cond.rightTicker ?? 'SPY'}
                              onChange={(e) =>
                                onUpdateCondition(node.id, cond.id, { rightTicker: e.target.value as PositionChoice })
                              }
                            >
                              {[
                                cond.rightTicker ?? 'SPY',
                                ...tickerOptions.filter((t) => t !== (cond.rightTicker ?? 'SPY')),
                              ].map((t) => (
                                <option key={t} value={t}>
                                  {t}
                                </option>
                              ))}
                            </Select>{' '}
                          </>
                        ) : null}
                        {/* For X consecutive days input */}
                        {' '}for{' '}
                        <Input
                          className="w-12 h-7 px-1.5 mx-1 inline-flex text-center"
                          type="number"
                          min={1}
                          value={cond.forDays ?? 1}
                          onChange={(e) => {
                            const val = Math.max(1, Number(e.target.value) || 1)
                            onUpdateCondition(node.id, cond.id, { forDays: val > 1 ? val : undefined })
                          }}
                        />
                        {' '}day{(cond.forDays ?? 1) !== 1 ? 's' : ''}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 p-0"
                          onClick={(e) => {
                            e.stopPropagation()
                            onUpdateCondition(node.id, cond.id, { expanded: !cond.expanded })
                          }}
                          title="Flip condition"
                        >
                          ⇆
                        </Button>
                      </Badge>
                      {idx > 0 ? (
                        <Button variant="destructive" size="icon" className="h-7 w-7 p-0" onClick={() => onDeleteCondition(node.id, cond.id)}>
                          X
                        </Button>
                      ) : null}
                    </div>
                  )
                })}
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3.5 h-full border-l border-border" />
                  <div className="flex items-center gap-1.5">
                    <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); onAddCondition(node.id, 'and') }}>
                      And If
                    </Button>
                    <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); onAddCondition(node.id, 'or') }}>
                      Or If
                    </Button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="w-7 h-full border-l border-border" />
                  <div className="text-sm font-extrabold">Then</div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="indent with-line" style={{ width: 3 * 14 }} />
                  <div className="relative flex items-center gap-2">
                  <Badge
                    variant="default"
                    className="cursor-pointer gap-1 py-1 px-2.5"
                    onClick={(e) => {
                      e.stopPropagation()
                      setWeightThenOpen((v) => !v)
                      setWeightElseOpen(false)
                      setWeightMainOpen(false)
                    }}
                  >
                    {weightLabel(node.weightingThen ?? node.weighting)}
                  </Badge>
                  {renderWeightDetailChip('then')}
                  {weightThenOpen ? (
                    <div
                      className="absolute top-full mt-1 left-0 flex flex-col bg-surface border border-border rounded-lg shadow-lg z-[200] min-w-[120px]"
                      onClick={(e) => {
                        e.stopPropagation()
                      }}
                    >
                      {(['equal', 'defined', 'inverse', 'pro', 'capped'] as WeightMode[]).map((w) => (
                        <Button
                          key={w}
                          variant="ghost"
                          className="justify-start rounded-none first:rounded-t-lg last:rounded-b-lg"
                          onClick={() => {
                            onWeightChange(node.id, w, 'then')
                            if (w !== 'capped') {
                              setWeightThenOpen(false)
                              setWeightElseOpen(false)
                              setWeightMainOpen(false)
                            }
                          }}
                        >
                          {weightLabel(w)}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
                {renderSlot('then', 3 * 14)}
                <div className="flex items-center gap-2">
                  <div className="indent with-line" style={{ width: 2 * 14 }} />
                  <div className="text-sm font-extrabold">Else</div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="indent with-line" style={{ width: 3 * 14 }} />
                  <div className="relative flex items-center gap-2">
                  <Badge
                    variant="default"
                    className="cursor-pointer gap-1 py-1 px-2.5"
                    onClick={(e) => {
                      e.stopPropagation()
                      setWeightElseOpen((v) => !v)
                      setWeightThenOpen(false)
                      setWeightMainOpen(false)
                    }}
                  >
                    {weightLabel(node.weightingElse ?? node.weighting)}
                  </Badge>
                  {renderWeightDetailChip('else')}
                  {weightElseOpen ? (
                    <div
                      className="absolute top-full mt-1 left-0 flex flex-col bg-surface border border-border rounded-lg shadow-lg z-[200] min-w-[120px]"
                      onClick={(e) => {
                        e.stopPropagation()
                      }}
                    >
                      {(['equal', 'defined', 'inverse', 'pro', 'capped'] as WeightMode[]).map((w) => (
                        <Button
                          key={w}
                          variant="ghost"
                          className="justify-start rounded-none first:rounded-t-lg last:rounded-b-lg"
                          onClick={() => {
                            onWeightChange(node.id, w, 'else')
                            if (w !== 'capped') {
                              setWeightElseOpen(false)
                              setWeightThenOpen(false)
                              setWeightMainOpen(false)
                            }
                          }}
                        >
                          {weightLabel(w)}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
                {renderSlot('else', 3 * 14)}
              </>
            ) : node.kind === 'numbered' ? (
              <>
                <div className="flex items-center gap-2">
                  <div className="indent with-line" style={{ width: 14 }} />
                  <Badge variant="default" className="gap-1.5 py-1 px-2.5">
                    If{' '}
                    <Select
                      className="h-7 px-1.5 mx-1 inline-flex"
                      value={node.numbered?.quantifier ?? 'all'}
                      onChange={(e) => onNumberedQuantifier(node.id, e.target.value as NumberedQuantifier)}
                    >
                      <option value="any">Any</option>
                      <option value="all">All</option>
                      <option value="none">None</option>
                      <option value="exactly">Exactly</option>
                      <option value="atLeast">At Least</option>
                      <option value="atMost">At Most</option>
                      <option value="ladder">Ladder</option>
                    </Select>{' '}
                    {node.numbered?.quantifier === 'exactly' ||
                    node.numbered?.quantifier === 'atLeast' ||
                    node.numbered?.quantifier === 'atMost' ? (
                      <>
                        <Input
                          type="number"
                          className="w-14 h-7 px-1.5 inline-flex"
                          value={node.numbered?.n ?? 1}
                          onChange={(e) => onNumberedN(node.id, Number(e.target.value))}
                        />{' '}
                      </>
                    ) : null}
                    of the following conditions are true
                  </Badge>
                </div>

                {node.numbered?.quantifier === 'ladder' ? (
                  <>
                    {/* Ladder mode: full condition editing (same as original) */}
                    {(node.numbered?.items ?? []).map((item, idx) => (
                      <div key={item.id}>
                        <div className="flex items-center gap-2">
                          <div className="indent with-line" style={{ width: 14 }} />
                          <div className="text-sm font-extrabold">Indicator</div>
                          {item.groupLogic === 'or' && item.conditions.length > 1 && (
                            <span className="text-xs text-muted-foreground italic">(any)</span>
                          )}
                          {item.groupLogic === 'and' && item.conditions.length > 1 && (
                            <span className="text-xs text-muted-foreground italic">(all)</span>
                          )}
                        </div>
                        <div className="line condition-block">
                          <div className="indent with-line" style={{ width: 2 * 14 }} />
                          <div className="condition-bubble">
                            {item.conditions.map((cond, condIdx) =>
                              renderConditionRow(node.id, cond, condIdx, item.conditions.length, item.id, idx > 0),
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="indent with-line" style={{ width: 2 * 14 }} />
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation()
                                onAddCondition(node.id, 'and', item.id)
                              }}
                            >
                              And If
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation()
                                onAddCondition(node.id, 'or', item.id)
                              }}
                            >
                              Or If
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}

                    <div className="flex items-center gap-2">
                      <div className="indent with-line" style={{ width: 14 }} />
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            onAddNumberedItem(node.id)
                          }}
                        >
                          Add Indicator
                        </Button>
                      </div>
                    </div>

                    {/* Ladder rows: All (N), N-1, ..., None */}
                    {(() => {
                      const totalConds = (node.numbered?.items ?? []).length
                      const rows = []
                      for (let i = totalConds; i >= 0; i--) {
                        const slotKey = `ladder-${i}` as SlotId
                        const label = getLadderSlotLabel(i, totalConds)
                        const isExpanded = expandedLadderRows.has(slotKey)
                        rows.push(
                          <div key={slotKey}>
                            <div
                              className="flex items-center gap-2 cursor-pointer hover:bg-accent/50 rounded px-1 py-0.5"
                              onClick={(e) => {
                                e.stopPropagation()
                                setExpandedLadderRows((prev) => {
                                  const next = new Set(prev)
                                  if (next.has(slotKey)) {
                                    next.delete(slotKey)
                                  } else {
                                    next.add(slotKey)
                                  }
                                  return next
                                })
                              }}
                            >
                              <div className="indent with-line" style={{ width: 14 }} />
                              <span className="text-sm font-extrabold">{isExpanded ? '▼' : '▶'} {label}</span>
                            </div>
                            {isExpanded && renderSlot(slotKey, 2 * 14)}
                          </div>,
                        )
                      }
                      return rows
                    })()}
                  </>
                ) : (
                  <>
                    {/* Original mode: full conditions + Then/Else */}
                    {(node.numbered?.items ?? []).map((item, idx) => (
                  <div key={item.id}>
                    <div className="flex items-center gap-2">
                      <div className="indent with-line" style={{ width: 14 }} />
                      <div className="text-sm font-extrabold">Indicator</div>
                      {item.groupLogic === 'or' && item.conditions.length > 1 && (
                        <span className="text-xs text-muted-foreground italic">(any)</span>
                      )}
                      {item.groupLogic === 'and' && item.conditions.length > 1 && (
                        <span className="text-xs text-muted-foreground italic">(all)</span>
                      )}
                    </div>
                    <div className="line condition-block">
                      <div className="indent with-line" style={{ width: 2 * 14 }} />
                      <div className="condition-bubble">
                        {item.conditions.map((cond, condIdx) =>
                          renderConditionRow(node.id, cond, condIdx, item.conditions.length, item.id, idx > 0),
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="indent with-line" style={{ width: 2 * 14 }} />
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            onAddCondition(node.id, 'and', item.id)
                          }}
                        >
                          And If
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            onAddCondition(node.id, 'or', item.id)
                          }}
                        >
                          Or If
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}

                <div className="flex items-center gap-2">
                  <div className="indent with-line" style={{ width: 14 }} />
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        onAddNumberedItem(node.id)
                      }}
                    >
                      Add Indicator
                    </Button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="indent with-line" style={{ width: 2 * 14 }} />
                  <div className="text-sm font-extrabold">Then</div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="indent with-line" style={{ width: 3 * 14 }} />
                  <div className="relative flex items-center gap-2">
                    <Badge
                      variant="default"
                      className="cursor-pointer gap-1 py-1 px-2.5"
                      onClick={(e) => {
                        e.stopPropagation()
                        setWeightThenOpen((v) => !v)
                        setWeightElseOpen(false)
                        setWeightMainOpen(false)
                      }}
                    >
                      {weightLabel(node.weightingThen ?? node.weighting)}
                    </Badge>
                    {renderWeightDetailChip('then')}
                    {weightThenOpen ? (
                      <div
                        className="absolute top-full mt-1 left-0 flex flex-col bg-surface border border-border rounded-lg shadow-lg z-[200] min-w-[120px]"
                        onClick={(e) => {
                          e.stopPropagation()
                        }}
                      >
                        {(['equal', 'defined', 'inverse', 'pro', 'capped'] as WeightMode[]).map((w) => (
                          <Button
                            key={w}
                            variant="ghost"
                            className="justify-start rounded-none first:rounded-t-lg last:rounded-b-lg"
                            onClick={() => {
                              onWeightChange(node.id, w, 'then')
                              if (w !== 'capped') {
                                setWeightThenOpen(false)
                                setWeightElseOpen(false)
                                setWeightMainOpen(false)
                              }
                            }}
                          >
                            {weightLabel(w)}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                {renderSlot('then', 3 * 14)}

                <div className="flex items-center gap-2">
                  <div className="indent with-line" style={{ width: 2 * 14 }} />
                  <div className="text-sm font-extrabold">Else</div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="indent with-line" style={{ width: 3 * 14 }} />
                  <div className="relative flex items-center gap-2">
                    <Badge
                      variant="default"
                      className="cursor-pointer gap-1 py-1 px-2.5"
                      onClick={(e) => {
                        e.stopPropagation()
                        setWeightElseOpen((v) => !v)
                        setWeightThenOpen(false)
                        setWeightMainOpen(false)
                      }}
                    >
                      {weightLabel(node.weightingElse ?? node.weighting)}
                    </Badge>
                    {renderWeightDetailChip('else')}
                    {weightElseOpen ? (
                      <div
                        className="absolute top-full mt-1 left-0 flex flex-col bg-surface border border-border rounded-lg shadow-lg z-[200] min-w-[120px]"
                        onClick={(e) => {
                          e.stopPropagation()
                        }}
                      >
                        {(['equal', 'defined', 'inverse', 'pro', 'capped'] as WeightMode[]).map((w) => (
                          <Button
                            key={w}
                            variant="ghost"
                            className="justify-start rounded-none first:rounded-t-lg last:rounded-b-lg"
                            onClick={() => {
                              onWeightChange(node.id, w, 'else')
                              if (w !== 'capped') {
                                setWeightElseOpen(false)
                                setWeightThenOpen(false)
                                setWeightMainOpen(false)
                              }
                            }}
                          >
                            {weightLabel(w)}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                    {renderSlot('else', 3 * 14)}
                  </>
                )}
              </>
            ) : node.kind === 'altExit' ? (
              <>
                {/* ENTER IF conditions */}
                <div className="condition-bubble">
                  {node.entryConditions?.map((cond, idx) => {
                    const prefix = cond.type === 'and' ? 'And if the ' : cond.type === 'or' ? 'Or if the ' : 'If the '
                    return (
                      <div className="flex items-center gap-2" key={cond.id}>
                        <div className="w-3.5 h-full border-l border-border" />
                        <Badge variant="default" className="gap-1 py-1 px-2.5">
                          {prefix}
                          {isWindowlessIndicator(cond.metric) ? null : (
                            <>
                              <Input
                                className="w-14 h-8 px-1.5 mx-1 inline-flex"
                                type="number"
                                value={cond.window}
                                onChange={(e) => onUpdateEntryCondition(node.id, cond.id, { window: Number(e.target.value) })}
                              />
                              d{' '}
                            </>
                          )}
                          <IndicatorDropdown
                            value={cond.metric}
                            onChange={(m) => onUpdateEntryCondition(node.id, cond.id, { metric: m })}
                            className="h-8 px-1.5 mx-1"
                          />
                          {' of '}
                          <Select
                            className="h-8 px-1.5 mx-1"
                            value={cond.ticker}
                            onChange={(e) => onUpdateEntryCondition(node.id, cond.id, { ticker: e.target.value as PositionChoice })}
                          >
                            {[cond.ticker, ...tickerOptions.filter((t) => t !== cond.ticker)].map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </Select>{' '}
                          is{' '}
                          <Select
                            className="h-8 px-1.5 mx-1"
                            value={cond.comparator}
                            onChange={(e) => onUpdateEntryCondition(node.id, cond.id, { comparator: e.target.value as ComparatorChoice })}
                          >
                            <option value="lt">Less Than</option>
                            <option value="gt">Greater Than</option>
                          </Select>{' '}
                          {cond.expanded ? null : (
                            <Input
                              className="w-14 h-8 px-1.5 mx-1 inline-flex"
                              type="number"
                              value={cond.threshold}
                              onChange={(e) => onUpdateEntryCondition(node.id, cond.id, { threshold: Number(e.target.value) })}
                            />
                          )}
                          {cond.expanded ? (
                            <>
                              {' '}the{' '}
                              {isWindowlessIndicator(cond.rightMetric ?? 'Relative Strength Index') ? null : (
                                <>
                                  <Input
                                    className="w-14 h-8 px-1.5 mx-1 inline-flex"
                                    type="number"
                                    value={cond.rightWindow ?? 14}
                                    onChange={(e) => onUpdateEntryCondition(node.id, cond.id, { rightWindow: Number(e.target.value) })}
                                  />
                                  d{' '}
                                </>
                              )}
                              <IndicatorDropdown
                                value={cond.rightMetric ?? 'Relative Strength Index'}
                                onChange={(m) => onUpdateEntryCondition(node.id, cond.id, { rightMetric: m })}
                                className="h-8 px-1.5 mx-1"
                              />{' '}
                              of{' '}
                              <Select
                                className="h-8 px-1.5 mx-1"
                                value={cond.rightTicker ?? 'SPY'}
                                onChange={(e) => onUpdateEntryCondition(node.id, cond.id, { rightTicker: e.target.value as PositionChoice })}
                              >
                                {[cond.rightTicker ?? 'SPY', ...tickerOptions.filter((t) => t !== (cond.rightTicker ?? 'SPY'))].map((t) => (
                                  <option key={t} value={t}>{t}</option>
                                ))}
                              </Select>{' '}
                            </>
                          ) : null}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 p-0"
                            onClick={(e) => {
                              e.stopPropagation()
                              onUpdateEntryCondition(node.id, cond.id, { expanded: !cond.expanded })
                            }}
                            title="Flip condition"
                          >
                            ⇆
                          </Button>
                        </Badge>
                        {idx > 0 ? (
                          <Button variant="destructive" size="icon" className="h-7 w-7 p-0" onClick={() => onDeleteEntryCondition(node.id, cond.id)}>
                            X
                          </Button>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3.5 h-full border-l border-border" />
                  <div className="flex items-center gap-1.5">
                    <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); onAddEntryCondition(node.id, 'and') }}>
                      And If
                    </Button>
                    <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); onAddEntryCondition(node.id, 'or') }}>
                      Or If
                    </Button>
                  </div>
                </div>

                {/* THEN slot */}
                <div className="flex items-center gap-2">
                  <div className="w-7 h-full border-l border-border" />
                  <div className="text-sm font-extrabold">Then Enter</div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="indent with-line" style={{ width: 3 * 14 }} />
                  <div className="relative flex items-center gap-2">
                    <Badge
                      variant="default"
                      className="cursor-pointer gap-1 py-1 px-2.5"
                      onClick={(e) => {
                        e.stopPropagation()
                        setWeightThenOpen((v) => !v)
                        setWeightElseOpen(false)
                        setWeightMainOpen(false)
                      }}
                    >
                      {weightLabel(node.weightingThen ?? node.weighting)}
                    </Badge>
                    {renderWeightDetailChip('then')}
                    {weightThenOpen ? (
                      <div
                        className="absolute top-full mt-1 left-0 flex flex-col bg-surface border border-border rounded-lg shadow-lg z-[200] min-w-[120px]"
                        onClick={(e) => { e.stopPropagation() }}
                      >
                        {(['equal', 'defined', 'inverse', 'pro', 'capped'] as WeightMode[]).map((w) => (
                          <Button
                            key={w}
                            variant="ghost"
                            className="justify-start rounded-none first:rounded-t-lg last:rounded-b-lg"
                            onClick={() => {
                              onWeightChange(node.id, w, 'then')
                              if (w !== 'capped') {
                                setWeightThenOpen(false)
                                setWeightElseOpen(false)
                                setWeightMainOpen(false)
                              }
                            }}
                          >
                            {weightLabel(w)}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                {renderSlot('then', 3 * 14)}

                {/* EXIT IF conditions */}
                <div className="flex items-center gap-2">
                  <div className="indent with-line" style={{ width: 14 }} />
                  <div className="text-sm font-extrabold text-red-500">Exit If</div>
                </div>
                <div className="condition-bubble">
                  {node.exitConditions?.map((cond, idx) => {
                    const prefix = cond.type === 'and' ? 'And if the ' : cond.type === 'or' ? 'Or if the ' : 'If the '
                    return (
                      <div className="flex items-center gap-2" key={cond.id}>
                        <div className="w-3.5 h-full border-l border-border" />
                        <Badge variant="default" className="gap-1 py-1 px-2.5">
                          {prefix}
                          {isWindowlessIndicator(cond.metric) ? null : (
                            <>
                              <Input
                                className="w-14 h-8 px-1.5 mx-1 inline-flex"
                                type="number"
                                value={cond.window}
                                onChange={(e) => onUpdateExitCondition(node.id, cond.id, { window: Number(e.target.value) })}
                              />
                              d{' '}
                            </>
                          )}
                          <IndicatorDropdown
                            value={cond.metric}
                            onChange={(m) => onUpdateExitCondition(node.id, cond.id, { metric: m })}
                            className="h-8 px-1.5 mx-1"
                          />
                          {' of '}
                          <Select
                            className="h-8 px-1.5 mx-1"
                            value={cond.ticker}
                            onChange={(e) => onUpdateExitCondition(node.id, cond.id, { ticker: e.target.value as PositionChoice })}
                          >
                            {[cond.ticker, ...tickerOptions.filter((t) => t !== cond.ticker)].map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </Select>{' '}
                          is{' '}
                          <Select
                            className="h-8 px-1.5 mx-1"
                            value={cond.comparator}
                            onChange={(e) => onUpdateExitCondition(node.id, cond.id, { comparator: e.target.value as ComparatorChoice })}
                          >
                            <option value="lt">Less Than</option>
                            <option value="gt">Greater Than</option>
                          </Select>{' '}
                          {cond.expanded ? null : (
                            <Input
                              className="w-14 h-8 px-1.5 mx-1 inline-flex"
                              type="number"
                              value={cond.threshold}
                              onChange={(e) => onUpdateExitCondition(node.id, cond.id, { threshold: Number(e.target.value) })}
                            />
                          )}
                          {cond.expanded ? (
                            <>
                              {' '}the{' '}
                              {isWindowlessIndicator(cond.rightMetric ?? 'Relative Strength Index') ? null : (
                                <>
                                  <Input
                                    className="w-14 h-8 px-1.5 mx-1 inline-flex"
                                    type="number"
                                    value={cond.rightWindow ?? 14}
                                    onChange={(e) => onUpdateExitCondition(node.id, cond.id, { rightWindow: Number(e.target.value) })}
                                  />
                                  d{' '}
                                </>
                              )}
                              <IndicatorDropdown
                                value={cond.rightMetric ?? 'Relative Strength Index'}
                                onChange={(m) => onUpdateExitCondition(node.id, cond.id, { rightMetric: m })}
                                className="h-8 px-1.5 mx-1"
                              />{' '}
                              of{' '}
                              <Select
                                className="h-8 px-1.5 mx-1"
                                value={cond.rightTicker ?? 'SPY'}
                                onChange={(e) => onUpdateExitCondition(node.id, cond.id, { rightTicker: e.target.value as PositionChoice })}
                              >
                                {[cond.rightTicker ?? 'SPY', ...tickerOptions.filter((t) => t !== (cond.rightTicker ?? 'SPY'))].map((t) => (
                                  <option key={t} value={t}>{t}</option>
                                ))}
                              </Select>{' '}
                            </>
                          ) : null}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 p-0"
                            onClick={(e) => {
                              e.stopPropagation()
                              onUpdateExitCondition(node.id, cond.id, { expanded: !cond.expanded })
                            }}
                            title="Flip condition"
                          >
                            ⇆
                          </Button>
                        </Badge>
                        {idx > 0 ? (
                          <Button variant="destructive" size="icon" className="h-7 w-7 p-0" onClick={() => onDeleteExitCondition(node.id, cond.id)}>
                            X
                          </Button>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3.5 h-full border-l border-border" />
                  <div className="flex items-center gap-1.5">
                    <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); onAddExitCondition(node.id, 'and') }}>
                      And If
                    </Button>
                    <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); onAddExitCondition(node.id, 'or') }}>
                      Or If
                    </Button>
                  </div>
                </div>

                {/* EXIT INTO slot */}
                <div className="flex items-center gap-2">
                  <div className="indent with-line" style={{ width: 2 * 14 }} />
                  <div className="text-sm font-extrabold">Exit Into</div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="indent with-line" style={{ width: 3 * 14 }} />
                  <div className="relative flex items-center gap-2">
                    <Badge
                      variant="default"
                      className="cursor-pointer gap-1 py-1 px-2.5"
                      onClick={(e) => {
                        e.stopPropagation()
                        setWeightElseOpen((v) => !v)
                        setWeightThenOpen(false)
                        setWeightMainOpen(false)
                      }}
                    >
                      {weightLabel(node.weightingElse ?? node.weighting)}
                    </Badge>
                    {renderWeightDetailChip('else')}
                    {weightElseOpen ? (
                      <div
                        className="absolute top-full mt-1 left-0 flex flex-col bg-surface border border-border rounded-lg shadow-lg z-[200] min-w-[120px]"
                        onClick={(e) => { e.stopPropagation() }}
                      >
                        {(['equal', 'defined', 'inverse', 'pro', 'capped'] as WeightMode[]).map((w) => (
                          <Button
                            key={w}
                            variant="ghost"
                            className="justify-start rounded-none first:rounded-t-lg last:rounded-b-lg"
                            onClick={() => {
                              onWeightChange(node.id, w, 'else')
                              if (w !== 'capped') {
                                setWeightElseOpen(false)
                                setWeightThenOpen(false)
                                setWeightMainOpen(false)
                              }
                            }}
                          >
                            {weightLabel(w)}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                {renderSlot('else', 3 * 14)}
              </>
            ) : node.kind === 'scaling' ? (
              <>
                {/* SCALE BY indicator */}
                <div className="flex items-center gap-2">
                  <div className="indent with-line" style={{ width: 14 }} />
                  <Badge variant="default" className="gap-1.5 py-1 px-2.5">
                    Scale by{' '}
                    {isWindowlessIndicator(node.scaleMetric ?? 'Relative Strength Index') ? null : (
                      <>
                        <Input
                          type="number"
                          className="w-14 h-7 px-1.5 inline-flex"
                          value={node.scaleWindow ?? 14}
                          onChange={(e) => onUpdateScaling(node.id, { scaleWindow: Number(e.target.value) })}
                        />
                        d{' '}
                      </>
                    )}
                    <Select
                      className="h-7 px-1.5 mx-1 inline-flex"
                      value={node.scaleMetric ?? 'Relative Strength Index'}
                      onChange={(e) => onUpdateScaling(node.id, { scaleMetric: e.target.value as MetricChoice })}
                    >
                      <option value="Current Price">Current Price</option>
                      <option value="Simple Moving Average">Simple Moving Average</option>
                      <option value="Exponential Moving Average">Exponential Moving Average</option>
                      <option value="Relative Strength Index">Relative Strength Index</option>
                      <option value="Max Drawdown">Max Drawdown</option>
                      <option value="Standard Deviation">Standard Deviation</option>
                      <option value="Standard Deviation of Price">Standard Deviation of Price</option>
                      <option value="Cumulative Return">Cumulative Return</option>
                      <option value="SMA of Returns">SMA of Returns</option>
                      <option value="Momentum (Weighted)">Momentum (Weighted)</option>
                      <option value="Momentum (Unweighted)">Momentum (Unweighted)</option>
                      <option value="Momentum (12-Month SMA)">Momentum (12-Month SMA)</option>
                      <option value="Drawdown">Drawdown</option>
                      <option value="Aroon Up">Aroon Up</option>
                      <option value="Aroon Down">Aroon Down</option>
                      <option value="Aroon Oscillator">Aroon Oscillator</option>
                      <option value="MACD Histogram">MACD Histogram</option>
                      <option value="PPO Histogram">PPO Histogram</option>
                      <option value="Trend Clarity">Trend Clarity</option>
                      <option value="Ultimate Smoother">Ultimate Smoother</option>
                      <option value="Money Flow Index">Money Flow Index</option>
                      <option value="OBV Rate of Change">OBV Rate of Change</option>
                      <option value="VWAP Ratio">VWAP Ratio</option>
                    </Select>
                    {' of '}
                    <Select
                      className="h-7 px-1.5 mx-1 inline-flex"
                      value={node.scaleTicker ?? 'SPY'}
                      onChange={(e) => onUpdateScaling(node.id, { scaleTicker: e.target.value })}
                    >
                      {[node.scaleTicker ?? 'SPY', ...tickerOptions.filter((t) => t !== (node.scaleTicker ?? 'SPY'))].map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </Select>
                  </Badge>
                </div>

                {/* FROM / TO range */}
                <div className="flex items-center gap-2">
                  <div className="indent with-line" style={{ width: 14 }} />
                  <Badge variant="default" className="gap-1.5 py-1 px-2.5">
                    From{' '}
                    <Input
                      type="number"
                      className="w-16 h-7 px-1.5 inline-flex"
                      value={node.scaleFrom ?? 30}
                      onChange={(e) => onUpdateScaling(node.id, { scaleFrom: Number(e.target.value) })}
                    />
                    {' (100% Then) to '}
                    <Input
                      type="number"
                      className="w-16 h-7 px-1.5 inline-flex"
                      value={node.scaleTo ?? 70}
                      onChange={(e) => onUpdateScaling(node.id, { scaleTo: Number(e.target.value) })}
                    />
                    {' (100% Else)'}
                  </Badge>
                </div>

                {/* THEN (Low) slot */}
                <div className="flex items-center gap-2">
                  <div className="w-7 h-full border-l border-border" />
                  <div className="text-sm font-extrabold">Then (Low)</div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="indent with-line" style={{ width: 3 * 14 }} />
                  <div className="relative flex items-center gap-2">
                    <Badge
                      variant="default"
                      className="cursor-pointer gap-1 py-1 px-2.5"
                      onClick={(e) => {
                        e.stopPropagation()
                        setWeightThenOpen((v) => !v)
                        setWeightElseOpen(false)
                        setWeightMainOpen(false)
                      }}
                    >
                      {weightLabel(node.weightingThen ?? node.weighting)}
                    </Badge>
                    {renderWeightDetailChip('then')}
                    {weightThenOpen ? (
                      <div
                        className="absolute top-full mt-1 left-0 flex flex-col bg-surface border border-border rounded-lg shadow-lg z-[200] min-w-[120px]"
                        onClick={(e) => { e.stopPropagation() }}
                      >
                        {(['equal', 'defined', 'inverse', 'pro', 'capped'] as WeightMode[]).map((w) => (
                          <Button
                            key={w}
                            variant="ghost"
                            className="justify-start rounded-none first:rounded-t-lg last:rounded-b-lg"
                            onClick={() => {
                              onWeightChange(node.id, w, 'then')
                              if (w !== 'capped') {
                                setWeightThenOpen(false)
                                setWeightElseOpen(false)
                                setWeightMainOpen(false)
                              }
                            }}
                          >
                            {weightLabel(w)}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                {renderSlot('then', 3 * 14)}

                {/* ELSE (High) slot */}
                <div className="flex items-center gap-2">
                  <div className="indent with-line" style={{ width: 2 * 14 }} />
                  <div className="text-sm font-extrabold">Else (High)</div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="indent with-line" style={{ width: 3 * 14 }} />
                  <div className="relative flex items-center gap-2">
                    <Badge
                      variant="default"
                      className="cursor-pointer gap-1 py-1 px-2.5"
                      onClick={(e) => {
                        e.stopPropagation()
                        setWeightElseOpen((v) => !v)
                        setWeightThenOpen(false)
                        setWeightMainOpen(false)
                      }}
                    >
                      {weightLabel(node.weightingElse ?? node.weighting)}
                    </Badge>
                    {renderWeightDetailChip('else')}
                    {weightElseOpen ? (
                      <div
                        className="absolute top-full mt-1 left-0 flex flex-col bg-surface border border-border rounded-lg shadow-lg z-[200] min-w-[120px]"
                        onClick={(e) => { e.stopPropagation() }}
                      >
                        {(['equal', 'defined', 'inverse', 'pro', 'capped'] as WeightMode[]).map((w) => (
                          <Button
                            key={w}
                            variant="ghost"
                            className="justify-start rounded-none first:rounded-t-lg last:rounded-b-lg"
                            onClick={() => {
                              onWeightChange(node.id, w, 'else')
                              if (w !== 'capped') {
                                setWeightElseOpen(false)
                                setWeightThenOpen(false)
                                setWeightMainOpen(false)
                              }
                            }}
                          >
                            {weightLabel(w)}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                {renderSlot('else', 3 * 14)}
              </>
            ) : (
              lines.map((line) => {
                if (line.kind === 'text') {
                  const isTag = line.tone === 'tag'
                  const isFunctionDesc = node.kind === 'function' && line.id.endsWith('-desc')
                  return (
                    <div className="line" key={line.id}>
                      <div className="indent with-line" style={{ width: line.depth * 14 }} />
                      {isTag ? (
                        <div className="weight-wrap">
                          <button
                            className="chip tag"
                            onClick={(e) => {
                              e.stopPropagation()
                              setWeightMainOpen((v) => !v)
                              setWeightThenOpen(false)
                              setWeightElseOpen(false)
                            }}
                          >
                            {weightLabel(node.weighting)}
                          </button>
                          {renderWeightDetailChip()}
                          {weightMainOpen ? (
                            <div
                              className="menu"
                              onClick={(e) => {
                                e.stopPropagation()
                              }}
                            >
                              {(['equal', 'defined', 'inverse', 'pro', 'capped'] as WeightMode[]).map((w) => (
                                <button
                                  key={w}
                                  onClick={() => {
                                    onWeightChange(node.id, w)
                                    if (w !== 'capped') {
                                      setWeightMainOpen(false)
                                      setWeightThenOpen(false)
                                      setWeightElseOpen(false)
                                    }
                                  }}
                                >
                                  {weightLabel(w)}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : isFunctionDesc ? (
                        <Badge variant="default" className="gap-1.5 py-1 px-2.5">
                          Of the{' '}
                          {isWindowlessIndicator(node.metric ?? 'Relative Strength Index') ? null : (
                            <>
                              <Input
                                type="number"
                                className="w-14 h-7 px-1.5 inline-flex"
                                value={node.window ?? 10}
                                onChange={(e) => onFunctionWindow(node.id, Number(e.target.value))}
                              />
                              d{' '}
                            </>
                          )}
                          <Select
                            className="h-7 px-1.5 mx-1 inline-flex"
                            value={node.metric ?? 'Relative Strength Index'}
                            onChange={(e) => onFunctionMetric(node.id, e.target.value as MetricChoice)}
                          >
                            <option value="Current Price">Current Price</option>
                            <option value="Simple Moving Average">Simple Moving Average</option>
                            <option value="Exponential Moving Average">Exponential Moving Average</option>
                            <option value="Relative Strength Index">Relative Strength Index</option>
                            <option value="Max Drawdown">Max Drawdown</option>
                            <option value="Standard Deviation">Standard Deviation</option>
                            <option value="Standard Deviation of Price">Standard Deviation of Price</option>
                            <option value="Cumulative Return">Cumulative Return</option>
                            <option value="SMA of Returns">SMA of Returns</option>
                            <option value="Momentum (Weighted)">Momentum (Weighted)</option>
                            <option value="Momentum (Unweighted)">Momentum (Unweighted)</option>
                            <option value="Momentum (12-Month SMA)">Momentum (12-Month SMA)</option>
                            <option value="Drawdown">Drawdown</option>
                            <option value="Aroon Up">Aroon Up</option>
                            <option value="Aroon Down">Aroon Down</option>
                            <option value="Aroon Oscillator">Aroon Oscillator</option>
                            <option value="MACD Histogram">MACD Histogram</option>
                            <option value="PPO Histogram">PPO Histogram</option>
                            <option value="Trend Clarity">Trend Clarity</option>
                            <option value="Ultimate Smoother">Ultimate Smoother</option>
                            <option value="Money Flow Index">Money Flow Index</option>
                            <option value="OBV Rate of Change">OBV Rate of Change</option>
                            <option value="VWAP Ratio">VWAP Ratio</option>
                          </Select>
                          {isWindowlessIndicator(node.metric ?? 'Relative Strength Index') ? ' pick the ' : 's pick the '}
                          <Select
                            className="h-7 px-1.5 mx-1 inline-flex"
                            value={node.rank ?? 'Bottom'}
                            onChange={(e) => onFunctionRank(node.id, e.target.value as RankChoice)}
                          >
                            <option value="Bottom">Bottom</option>
                            <option value="Top">Top</option>
                          </Select>{' '}
                          <Input
                            type="number"
                            className="w-14 h-7 px-1.5 inline-flex"
                          value={node.bottom ?? 1}
                            onChange={(e) => onFunctionBottom(node.id, Number(e.target.value))}
                          />
                        </Badge>
                      ) : (
                        <div className={`chip ${line.tone ?? ''}`}>{line.text}</div>
                      )}
                    </div>
                  )
                }
                const depthPx = line.depth * 14
                return renderSlot(line.slot, depthPx)
              })
            )}
          </div>
          {renderPosition()}
          {renderCallReference()}
        </>
      )}
    </div>
  )
}

const weightLabel = (mode: WeightMode) => {
  switch (mode) {
    case 'equal':
      return 'Equal Weight'
    case 'defined':
      return 'Defined'
    case 'inverse':
      return 'Inverse Volatility'
    case 'pro':
      return 'Pro Volatility'
    case 'capped':
      return 'Capped'
  }
}

// Generate ladder slot labels for N conditions: "All (N)", "N-1 of N", ..., "None"
const getLadderSlotLabel = (matchCount: number, totalConditions: number): string => {
  if (matchCount === totalConditions) return `All (${totalConditions})`
  if (matchCount === 0) return 'None'
  return `${matchCount} of ${totalConditions}`
}

type BacktestMode = 'CC' | 'OO' | 'OC' | 'CO'

type BacktestError = {
  nodeId: string
  field: string
  message: string
}

type ValidationError = Error & { type: 'validation'; errors: BacktestError[] }

const makeValidationError = (errors: BacktestError[]): ValidationError =>
  Object.assign(new Error('validation'), { type: 'validation' as const, errors })

const isValidationError = (e: unknown): e is ValidationError =>
  typeof e === 'object' && e !== null && (e as { type?: unknown }).type === 'validation' && Array.isArray((e as { errors?: unknown }).errors)

type BacktestWarning = {
  time: UTCTimestamp
  date: string
  message: string
}

type BacktestAllocationRow = {
  date: string
  entries: Array<{ ticker: string; weight: number }>
}

type BacktestDayRow = {
  time: UTCTimestamp
  date: string
  equity: number
  drawdown: number
  grossReturn: number
  netReturn: number
  turnover: number
  cost: number
  holdings: Array<{ ticker: string; weight: number }>
  endNodes?: Array<{ nodeId: string; title: string; weight: number }>
}

type BacktestTraceSample = {
  date: string
  left: number | null
  right?: number | null
  threshold?: number
}

type BacktestConditionTrace = {
  id: string
  type: ConditionLine['type']
  expr: string
  trueCount: number
  falseCount: number
  firstTrue?: BacktestTraceSample
  firstFalse?: BacktestTraceSample
}

type BacktestNodeTrace = {
  nodeId: string
  kind: 'indicator' | 'numbered' | 'numbered-item' | 'altExit' | 'scaling'
  thenCount: number
  elseCount: number
  conditions: BacktestConditionTrace[]
}

type BacktestTrace = {
  nodes: BacktestNodeTrace[]
}

type BacktestTraceCollector = {
  recordBranch: (nodeId: string, kind: BacktestNodeTrace['kind'], ok: boolean) => void
  recordCondition: (traceOwnerId: string, cond: ConditionLine, ok: boolean, sample: BacktestTraceSample) => void
  toResult: () => BacktestTrace
  // Alt Exit state tracking
  getAltExitState: (nodeId: string) => 'then' | 'else' | null
  setAltExitState: (nodeId: string, state: 'then' | 'else') => void
}

type BacktestResult = {
  points: EquityPoint[]
  benchmarkPoints?: EquityPoint[]
  drawdownPoints: EquityPoint[]
  markers: EquityMarker[]
  metrics: {
    startDate: string
    endDate: string
    days: number
    years: number
    totalReturn: number
    cagr: number
    vol: number
    maxDrawdown: number
    calmar: number
    sharpe: number
    sortino: number
    treynor: number
    beta: number
    winRate: number
    bestDay: number
    worstDay: number
    avgTurnover: number
    avgHoldings: number
  }
  days: BacktestDayRow[]
  allocations: BacktestAllocationRow[]
  warnings: BacktestWarning[]
  monthly: Array<{ year: number; month: number; value: number }>
  trace?: BacktestTrace
}

type TickerContributionState = {
  status: 'idle' | 'loading' | 'error' | 'done'
  returnPct?: number
  expectancy?: number
  error?: string
}

const formatPct = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : '—')

// Extract short node ID for display (e.g., "node-5" → "#5", "qm-1766627075188-151-epw4uzff" → "#151")
const shortNodeId = (id: string): string => {
  if (id.startsWith('node-')) {
    return '#' + id.slice(5)
  }
  // Import IDs are like "qm-timestamp-counter-random", extract the counter (index 2)
  const parts = id.split('-')
  if (parts.length >= 3 && (parts[0] === 'qm' || parts[0] === 'qmc')) {
    return '#' + parts[2]
  }
  // Fallback for other formats
  if (parts.length >= 2) {
    return '#' + parts[1]
  }
  return '#' + id.slice(0, 6)
}

const formatUsd = (v: number, options?: Intl.NumberFormatOptions) => {
  if (!Number.isFinite(v)) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
    ...options,
  }).format(v)
}

const formatSignedUsd = (v: number, options?: Intl.NumberFormatOptions) => {
  if (!Number.isFinite(v)) return '—'
  const formatted = formatUsd(Math.abs(v), options)
  return v >= 0 ? `+${formatted}` : `-${formatted}`
}

const csvEscape = (v: unknown) => {
  const s = String(v ?? '')
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

const downloadTextFile = (filename: string, text: string, mime = 'text/plain') => {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

const downloadEquityCsv = (result: BacktestResult, mode: BacktestMode, costBps: number, benchmark: string, showBenchmark: boolean) => {
  const benchByTime = new Map<number, number>()
  for (const p of result.benchmarkPoints || []) benchByTime.set(Number(p.time), Number(p.value))
  const lines: string[] = []
  lines.push(
    [
      'date',
      'equity',
      'drawdown',
      'gross_return',
      'net_return',
      'turnover',
      'cost',
      showBenchmark ? 'benchmark_equity' : null,
      'holdings',
    ]
      .filter(Boolean)
      .join(','),
  )
  for (const d of result.days) {
    const holdings = d.holdings
      .slice()
      .sort((a, b) => b.weight - a.weight)
      .map((h) => `${h.ticker}:${(h.weight * 100).toFixed(2)}%`)
      .join(' | ')
    const row: Array<string | number | null> = [
      d.date,
      d.equity,
      d.drawdown,
      d.grossReturn,
      d.netReturn,
      d.turnover,
      d.cost,
      showBenchmark ? benchByTime.get(Number(d.time)) ?? null : null,
      holdings,
    ]
    lines.push(row.filter((_, i) => (showBenchmark ? true : i !== 7)).map(csvEscape).join(','))
  }
  const name = `equity_${mode}_cost${Math.max(0, costBps)}bps_${normalizeChoice(benchmark || 'SPY')}.csv`
  downloadTextFile(name, `${lines.join('\n')}\n`, 'text/csv')
}

const downloadAllocationsCsv = (result: BacktestResult) => {
  const maxPairs = Math.max(0, ...(result.allocations || []).map((r) => r.entries.length))
  const header: string[] = ['date']
  for (let i = 1; i <= maxPairs; i++) {
    header.push(`ticker_${i}`, `weight_${i}`)
  }
  const lines: string[] = [header.join(',')]
  for (const row of result.allocations || []) {
    const sorted = row.entries.slice().sort((a, b) => b.weight - a.weight)
    const flat: Array<string | number> = [row.date]
    for (let i = 0; i < maxPairs; i++) {
      const e = sorted[i]
      flat.push(e ? e.ticker : '', e ? e.weight : '')
    }
    lines.push(flat.map(csvEscape).join(','))
  }
  downloadTextFile('allocations.csv', `${lines.join('\n')}\n`, 'text/csv')
}

const downloadRebalancesCsv = (result: BacktestResult) => {
  const rebalances = (result.days || []).filter((d) => d.turnover > 0.0001)
  const lines: string[] = ['date,net_return,turnover,cost,holdings']
  for (const d of rebalances) {
    const holdings = d.holdings
      .slice()
      .sort((a, b) => b.weight - a.weight)
      .map((h) => `${h.ticker}:${(h.weight * 100).toFixed(2)}%`)
      .join(' | ')
    lines.push([d.date, d.netReturn, d.turnover, d.cost, holdings].map(csvEscape).join(','))
  }
  downloadTextFile('rebalances.csv', `${lines.join('\n')}\n`, 'text/csv')
}

const renderMonthlyHeatmap = (
  monthly: Array<{ year: number; month: number; value: number }>,
  days: BacktestDayRow[],
  theme: 'dark' | 'light' = 'light',
) => {
  const isDark = theme === 'dark'
  const safeGetYear = (ts: number) => {
    const ms = Number(ts) * 1000
    if (!Number.isFinite(ms)) return NaN
    try {
      return new Date(ms).getUTCFullYear()
    } catch {
      return NaN
    }
  }
  const years = Array.from(
    new Set(
      (days || [])
        .map((d) => safeGetYear(d.time))
        .filter((y) => Number.isFinite(y)),
    ),
  ).sort((a, b) => a - b)

  const byKey = new Map<string, number>()
  for (const m of monthly) byKey.set(`${m.year}-${m.month}`, m.value)

  const pos = monthly.map((m) => m.value).filter((v) => Number.isFinite(v) && v > 0) as number[]
  const neg = monthly.map((m) => m.value).filter((v) => Number.isFinite(v) && v < 0) as number[]
  const maxPos = pos.length ? Math.max(...pos) : 0
  const minNeg = neg.length ? Math.min(...neg) : 0

  const mix = (a: number, b: number, t: number) => Math.round(a + (b - a) * Math.max(0, Math.min(1, t)))
  const neutralBg = isDark ? '#1e293b' : '#ffffff'
  const neutralText = isDark ? '#94a3b8' : '#94a3b8'
  const zeroText = isDark ? '#94a3b8' : '#475569'
  const bgFor = (v: number) => {
    if (!Number.isFinite(v)) return { background: neutralBg, color: neutralText }
    if (Math.abs(v) < 1e-12) return { background: neutralBg, color: zeroText }

    if (v > 0) {
      const t = maxPos > 0 ? Math.min(1, v / maxPos) : 0
      // Green gradient - in dark mode start from dark slate, in light mode from white
      const baseR = isDark ? 30 : 255
      const baseG = isDark ? 41 : 255
      const baseB = isDark ? 59 : 255
      const r = mix(baseR, 22, t)
      const g = mix(baseG, 163, t)
      const b = mix(baseB, 74, t)
      return { background: `rgb(${r}, ${g}, ${b})`, color: isDark ? '#86efac' : '#064e3b' }
    }

    const t = minNeg < 0 ? Math.min(1, v / minNeg) : 0
    // Red gradient - in dark mode start from dark slate, in light mode from white
    const baseR = isDark ? 30 : 255
    const baseG = isDark ? 41 : 255
    const baseB = isDark ? 59 : 255
    const r = mix(baseR, 220, t)
    const g = mix(baseG, 38, t)
    const b = mix(baseB, 38, t)
    return { background: `rgb(${r}, ${g}, ${b})`, color: isDark ? '#fda4af' : '#881337' }
  }

  const yearStats = new Map<number, { cagr: number; maxDD: number } | null>()
  for (const y of years) {
    const rows = (days || []).filter((d) => safeGetYear(d.time) === y)
    if (rows.length < 2) {
      yearStats.set(y, null)
      continue
    }
    const start = rows[0].equity
    const end = rows[rows.length - 1].equity
    const periods = Math.max(1, rows.length - 1)
    const cagr = start > 0 && end > 0 ? Math.pow(end / start, 252 / periods) - 1 : 0
    let peak = -Infinity
    let maxDD = 0
    for (const r of rows) {
      const v = r.equity
      if (!Number.isFinite(v)) continue
      if (v > peak) peak = v
      if (peak > 0) {
        const dd = v / peak - 1
        if (dd < maxDD) maxDD = dd
      }
    }
    yearStats.set(y, { cagr, maxDD })
  }

  const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return (
    <table className="monthly-table monthly-table-v2">
      <thead>
        <tr>
          <th className="monthly-title" colSpan={15}>
            Monthly Returns
          </th>
        </tr>
        <tr>
          <th className="monthly-group" colSpan={3}>
            Year
          </th>
          <th className="monthly-group" colSpan={12}>
            Monthly
          </th>
        </tr>
        <tr>
          <th>Year</th>
          <th>CAGR</th>
          <th>MaxDD</th>
          {monthLabels.map((m) => (
            <th key={m}>{m}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {years.map((y) => {
          const ys = yearStats.get(y) ?? null
          return (
            <tr key={y}>
              <td className="year-cell">{y}</td>
              <td className="year-metric">{ys ? formatPct(ys.cagr) : ''}</td>
              <td className="year-metric">{ys ? formatPct(ys.maxDD) : ''}</td>
              {monthLabels.map((_, idx) => {
                const month = idx + 1
                const v = byKey.get(`${y}-${month}`)
                const style = v == null ? { background: neutralBg, color: neutralText } : bgFor(v)
                return (
                  <td key={`${y}-${month}`} className="month-cell" style={{ background: style.background, color: style.color }}>
                    {v == null ? '' : `${(v * 100).toFixed(1)}%`}
                  </td>
                )
              })}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

const normalizeChoice = (raw: PositionChoice): string => {
  const s = String(raw ?? '').trim().toUpperCase()
  if (!s || s === 'EMPTY') return 'Empty'
  return s
}

const isEmptyChoice = (raw: PositionChoice) => normalizeChoice(raw) === 'Empty'

// Parse ratio ticker into component tickers
const parseRatioTicker = (ticker: string): { numerator: string; denominator: string } | null => {
  const norm = normalizeChoice(ticker)
  const parts = norm.split('/')
  if (parts.length !== 2) return null
  const [numerator, denominator] = parts.map((p) => p.trim())
  if (!numerator || !denominator) return null
  return { numerator, denominator }
}

// Expand ticker to all component tickers needed for fetching
// For "JNK/XLP" returns ["JNK", "XLP"], for "SPY" returns ["SPY"]
const expandTickerComponents = (ticker: string): string[] => {
  const ratio = parseRatioTicker(ticker)
  if (ratio) return [ratio.numerator, ratio.denominator]
  const norm = normalizeChoice(ticker)
  return norm === 'Empty' ? [] : [norm]
}

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

const isoFromUtcSeconds = (t: number) => {
  const ms = Number(t) * 1000
  if (!Number.isFinite(ms)) return '1970-01-01'
  try {
    return new Date(ms).toISOString().slice(0, 10)
  } catch {
    return '1970-01-01'
  }
}

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

type PriceDB = {
  dates: UTCTimestamp[]
  open: Record<string, Array<number | null>>
  close: Record<string, Array<number | null>>
  adjClose: Record<string, Array<number | null>>  // For indicator calculations
  high?: Record<string, Array<number | null>>   // For Aroon indicators
  low?: Record<string, Array<number | null>>    // For Aroon indicators
  limitingTicker?: string // Ticker with fewest data points that limits the intersection
  tickerCounts?: Record<string, number> // Data point count for each ticker
}

type IndicatorCache = {
  rsi: Map<string, Map<number, Array<number | null>>>
  sma: Map<string, Map<number, Array<number | null>>>
  ema: Map<string, Map<number, Array<number | null>>>
  std: Map<string, Map<number, Array<number | null>>>
  maxdd: Map<string, Map<number, Array<number | null>>>
  stdPrice: Map<string, Map<number, Array<number | null>>>
  cumRet: Map<string, Map<number, Array<number | null>>>
  smaRet: Map<string, Map<number, Array<number | null>>>
  // New indicators
  mom13612w: Map<string, Map<number, Array<number | null>>>
  mom13612u: Map<string, Map<number, Array<number | null>>>
  momsma12: Map<string, Map<number, Array<number | null>>>
  drawdown: Map<string, Map<number, Array<number | null>>>
  aroonUp: Map<string, Map<number, Array<number | null>>>
  aroonDown: Map<string, Map<number, Array<number | null>>>
  aroonOsc: Map<string, Map<number, Array<number | null>>>
  macd: Map<string, Map<number, Array<number | null>>>
  ppo: Map<string, Map<number, Array<number | null>>>
  trendClarity: Map<string, Map<number, Array<number | null>>>
  ultSmooth: Map<string, Map<number, Array<number | null>>>
  // Performance optimization: cache close and returns arrays to avoid rebuilding per-call
  closeArrays: Map<string, number[]>
  returnsArrays: Map<string, number[]>
}

const emptyCache = (): IndicatorCache => ({
  rsi: new Map(),
  sma: new Map(),
  ema: new Map(),
  std: new Map(),
  maxdd: new Map(),
  stdPrice: new Map(),
  cumRet: new Map(),
  smaRet: new Map(),
  mom13612w: new Map(),
  mom13612u: new Map(),
  momsma12: new Map(),
  drawdown: new Map(),
  aroonUp: new Map(),
  aroonDown: new Map(),
  aroonOsc: new Map(),
  macd: new Map(),
  ppo: new Map(),
  trendClarity: new Map(),
  ultSmooth: new Map(),
  closeArrays: new Map(),
  returnsArrays: new Map(),
})

const getSeriesKey = (ticker: string) => normalizeChoice(ticker)

// Cached version - avoids rebuilding array on every metricAt() call
// Handles ratio tickers like "JNK/XLP" by computing numerator / denominator prices
// IMPORTANT: Uses adjClose for all indicator calculations (accurate historical signals)
const getCachedCloseArray = (cache: IndicatorCache, db: PriceDB, ticker: string): number[] => {
  const t = getSeriesKey(ticker)
  const existing = cache.closeArrays.get(t)
  if (existing) return existing

  // Check if this is a ratio ticker
  const ratio = parseRatioTicker(t)
  if (ratio) {
    // Compute ratio prices from component tickers using adjClose for indicators
    const numAdjClose = db.adjClose[ratio.numerator] || []
    const denAdjClose = db.adjClose[ratio.denominator] || []
    const len = Math.max(numAdjClose.length, denAdjClose.length)
    const arr = new Array(len).fill(NaN)
    for (let i = 0; i < len; i++) {
      const num = numAdjClose[i]
      const den = denAdjClose[i]
      if (num != null && den != null && den !== 0) {
        arr[i] = num / den
      }
    }
    cache.closeArrays.set(t, arr)
    return arr
  }

  // Regular ticker - use adjClose for indicator calculations
  const arr = (db.adjClose[t] || []).map((v) => (v == null ? NaN : v))
  cache.closeArrays.set(t, arr)
  return arr
}

// Cached returns array - avoids rebuilding for Standard Deviation calculations
const getCachedReturnsArray = (cache: IndicatorCache, db: PriceDB, ticker: string): number[] => {
  const t = getSeriesKey(ticker)
  const existing = cache.returnsArrays.get(t)
  if (existing) return existing
  const closes = getCachedCloseArray(cache, db, t)
  const returns = new Array(closes.length).fill(NaN)
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1]
    const cur = closes[i]
    if (!Number.isNaN(prev) && !Number.isNaN(cur) && prev !== 0) {
      returns[i] = cur / prev - 1
    }
  }
  cache.returnsArrays.set(t, returns)
  return returns
}

const rollingSma = (values: number[], period: number): Array<number | null> => {
  const out: Array<number | null> = new Array(values.length).fill(null)
  let sum = 0
  let missing = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (Number.isNaN(v)) missing += 1
    else sum += v
    if (i >= period) {
      const prev = values[i - period]
      if (Number.isNaN(prev)) missing -= 1
      else sum -= prev
    }
    if (i >= period - 1 && missing === 0) out[i] = sum / period
  }
  return out
}

const rollingEma = (values: number[], period: number): Array<number | null> => {
  const out: Array<number | null> = new Array(values.length).fill(null)
  const alpha = 2 / (period + 1)
  let ema: number | null = null
  let readyCount = 0
  let seedSum = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (Number.isNaN(v)) {
      ema = null
      readyCount = 0
      seedSum = 0
      continue
    }
    if (ema == null) {
      seedSum += v
      readyCount += 1
      if (readyCount === period) {
        ema = seedSum / period
        out[i] = ema
      }
      continue
    }
    ema = alpha * v + (1 - alpha) * ema
    out[i] = ema
  }
  return out
}

const rollingWilderRsi = (closes: number[], period: number): Array<number | null> => {
  const out: Array<number | null> = new Array(closes.length).fill(null)
  let avgGain: number | null = null
  let avgLoss: number | null = null
  let seedG = 0
  let seedL = 0
  let seedCount = 0
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1]
    const cur = closes[i]
    if (Number.isNaN(prev) || Number.isNaN(cur)) {
      avgGain = null
      avgLoss = null
      seedG = 0
      seedL = 0
      seedCount = 0
      continue
    }
    const change = cur - prev
    const gain = change > 0 ? change : 0
    const loss = change < 0 ? -change : 0
    if (avgGain == null || avgLoss == null) {
      seedG += gain
      seedL += loss
      seedCount += 1
      if (seedCount === period) {
        avgGain = seedG / period
        avgLoss = seedL / period
        const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss
        out[i] = 100 - 100 / (1 + rs)
      }
      continue
    }
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss
    out[i] = 100 - 100 / (1 + rs)
  }
  return out
}

const rollingStdDev = (values: number[], period: number): Array<number | null> => {
  const out: Array<number | null> = new Array(values.length).fill(null)
  let sum = 0
  let sumSq = 0
  let missing = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (Number.isNaN(v)) {
      missing += 1
    } else {
      sum += v
      sumSq += v * v
    }
    if (i >= period) {
      const prev = values[i - period]
      if (Number.isNaN(prev)) missing -= 1
      else {
        sum -= prev
        sumSq -= prev * prev
      }
    }
    if (i >= period - 1 && missing === 0) {
      const mean = sum / period
      const variance = Math.max(0, sumSq / period - mean * mean)
      out[i] = Math.sqrt(variance) * 100 // Return as percentage (e.g., 2.5 = 2.5%)
    }
  }
  return out
}

// Optimized rolling max drawdown - avoid O(n*period) by tracking window state
const rollingMaxDrawdown = (values: number[], period: number): Array<number | null> => {
  const n = values.length
  const out: Array<number | null> = new Array(n).fill(null)
  if (period <= 0 || n === 0) return out

  // For small periods or short arrays, use simple approach
  if (period <= 50 || n < period * 2) {
    for (let i = period - 1; i < n; i++) {
      let peak = -Infinity
      let maxDd = 0
      let valid = true
      for (let j = i - period + 1; j <= i && valid; j++) {
        const v = values[j]
        if (Number.isNaN(v)) {
          valid = false
          break
        }
        if (v > peak) peak = v
        if (peak > 0) {
          const dd = v / peak - 1
          if (dd < maxDd) maxDd = dd
        }
      }
      if (valid) out[i] = Math.abs(maxDd) // Return positive value
    }
    return out
  }

  // For larger periods, use incremental approach with periodic recalculation
  // Recalculate from scratch every `period` steps to avoid drift
  const recalcInterval = Math.max(period, 100)
  let cachedPeak = -Infinity
  let cachedMaxDd = 0
  let lastRecalc = -1

  for (let i = period - 1; i < n; i++) {
    const windowStart = i - period + 1

    // Check if window contains NaN (quick scan for recent values)
    let hasNan = false
    for (let j = Math.max(windowStart, lastRecalc + 1); j <= i; j++) {
      if (Number.isNaN(values[j])) {
        hasNan = true
        break
      }
    }

    if (hasNan || i - lastRecalc >= recalcInterval || lastRecalc < windowStart) {
      // Full recalculation
      let peak = -Infinity
      let maxDd = 0
      let valid = true
      for (let j = windowStart; j <= i; j++) {
        const v = values[j]
        if (Number.isNaN(v)) {
          valid = false
          break
        }
        if (v > peak) peak = v
        if (peak > 0) {
          const dd = v / peak - 1
          if (dd < maxDd) maxDd = dd
        }
      }
      if (valid) {
        out[i] = Math.abs(maxDd) // Return positive value
        cachedPeak = peak
        cachedMaxDd = maxDd
        lastRecalc = i
      }
    } else {
      // Incremental update: just check new value
      const v = values[i]
      if (!Number.isNaN(v)) {
        if (v > cachedPeak) cachedPeak = v
        if (cachedPeak > 0) {
          const dd = v / cachedPeak - 1
          if (dd < cachedMaxDd) cachedMaxDd = dd
        }
        out[i] = Math.abs(cachedMaxDd) // Return positive value
      }
    }
  }
  return out
}

// Cumulative Return: (current - start) / start over window
const rollingCumulativeReturn = (values: number[], period: number): Array<number | null> => {
  const out: Array<number | null> = new Array(values.length).fill(null)
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) continue
    const startIdx = i - period + 1
    const startVal = values[startIdx]
    const endVal = values[i]
    if (Number.isNaN(startVal) || Number.isNaN(endVal) || startVal === 0) continue
    out[i] = (endVal - startVal) / startVal
  }
  return out
}

// SMA of Returns: smoothed daily returns over window
const rollingSmaOfReturns = (values: number[], period: number): Array<number | null> => {
  // First compute daily returns
  const returns: number[] = new Array(values.length).fill(NaN)
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1]
    const cur = values[i]
    if (!Number.isNaN(prev) && !Number.isNaN(cur) && prev !== 0) {
      returns[i] = cur / prev - 1
    }
  }
  // Then compute SMA of returns
  return rollingSma(returns, period)
}

// Standard Deviation of Prices (absolute price volatility)
const rollingStdDevOfPrices = (values: number[], period: number): Array<number | null> => {
  return rollingStdDev(values, period)
}

// 13612W Weighted Momentum (no window - fixed formula)
// (12*(p0/p1-1) + 4*(p0/p3-1) + 2*(p0/p6-1) + (p0/p12-1)) / 19
// Where pN = price N months ago (~21 trading days per month)
const rolling13612W = (closes: number[]): Array<number | null> => {
  const out: Array<number | null> = new Array(closes.length).fill(null)
  const m1 = 21, m3 = 63, m6 = 126, m12 = 252
  for (let i = m12; i < closes.length; i++) {
    const p0 = closes[i]
    const p1 = closes[i - m1]
    const p3 = closes[i - m3]
    const p6 = closes[i - m6]
    const p12 = closes[i - m12]
    if (p1 && p3 && p6 && p12 && !Number.isNaN(p0) && !Number.isNaN(p1) && !Number.isNaN(p3) && !Number.isNaN(p6) && !Number.isNaN(p12)) {
      out[i] = (12 * (p0 / p1 - 1) + 4 * (p0 / p3 - 1) + 2 * (p0 / p6 - 1) + (p0 / p12 - 1)) / 19
    }
  }
  return out
}

// 13612U Unweighted Momentum
const rolling13612U = (closes: number[]): Array<number | null> => {
  const out: Array<number | null> = new Array(closes.length).fill(null)
  const m1 = 21, m3 = 63, m6 = 126, m12 = 252
  for (let i = m12; i < closes.length; i++) {
    const p0 = closes[i]
    const p1 = closes[i - m1]
    const p3 = closes[i - m3]
    const p6 = closes[i - m6]
    const p12 = closes[i - m12]
    if (p1 && p3 && p6 && p12 && !Number.isNaN(p0) && !Number.isNaN(p1) && !Number.isNaN(p3) && !Number.isNaN(p6) && !Number.isNaN(p12)) {
      out[i] = ((p0 / p1 - 1) + (p0 / p3 - 1) + (p0 / p6 - 1) + (p0 / p12 - 1)) / 4
    }
  }
  return out
}

// SMA12 Momentum: 13*P0 / (P0+P1+...+P12) - 1
const rollingSMA12Momentum = (closes: number[]): Array<number | null> => {
  const out: Array<number | null> = new Array(closes.length).fill(null)
  const m = 21 // monthly
  for (let i = 12 * m; i < closes.length; i++) {
    let sum = 0
    let valid = true
    for (let j = 0; j <= 12; j++) {
      const v = closes[i - j * m]
      if (Number.isNaN(v)) { valid = false; break }
      sum += v
    }
    if (valid && sum !== 0) {
      out[i] = 13 * closes[i] / sum - 1
    }
  }
  return out
}

// Drawdown from ATH (no window - uses all history)
const rollingDrawdown = (closes: number[]): Array<number | null> => {
  const out: Array<number | null> = new Array(closes.length).fill(null)
  let peak = closes[0] || 0
  for (let i = 0; i < closes.length; i++) {
    const v = closes[i]
    if (Number.isNaN(v)) continue
    if (v > peak) peak = v
    out[i] = peak > 0 ? (peak - v) / peak : 0
  }
  return out
}

// Aroon Up: ((n - days since n-day high) / n) * 100
const rollingAroonUp = (highs: Array<number | null>, period: number): Array<number | null> => {
  const out: Array<number | null> = new Array(highs.length).fill(null)
  for (let i = period; i < highs.length; i++) {
    let maxIdx = i - period
    let maxVal = highs[maxIdx] ?? -Infinity
    for (let j = i - period; j <= i; j++) {
      const v = highs[j]
      if (v != null && !Number.isNaN(v) && v >= maxVal) {
        maxVal = v
        maxIdx = j
      }
    }
    out[i] = ((period - (i - maxIdx)) / period) * 100
  }
  return out
}

// Aroon Down: ((n - days since n-day low) / n) * 100
const rollingAroonDown = (lows: Array<number | null>, period: number): Array<number | null> => {
  const out: Array<number | null> = new Array(lows.length).fill(null)
  for (let i = period; i < lows.length; i++) {
    let minIdx = i - period
    let minVal = lows[minIdx] ?? Infinity
    for (let j = i - period; j <= i; j++) {
      const v = lows[j]
      if (v != null && !Number.isNaN(v) && v <= minVal) {
        minVal = v
        minIdx = j
      }
    }
    out[i] = ((period - (i - minIdx)) / period) * 100
  }
  return out
}

// Aroon Oscillator: Aroon Up - Aroon Down
const rollingAroonOscillator = (highs: Array<number | null>, lows: Array<number | null>, period: number): Array<number | null> => {
  const up = rollingAroonUp(highs, period)
  const down = rollingAroonDown(lows, period)
  return up.map((u, i) => (u != null && down[i] != null ? u - down[i]! : null))
}

// MACD Histogram (fixed 12/26/9)
const rollingMACD = (closes: number[]): Array<number | null> => {
  const ema12 = rollingEma(closes, 12)
  const ema26 = rollingEma(closes, 26)
  const macdLine = ema12.map((v, i) => v != null && ema26[i] != null ? v - ema26[i]! : null)
  const macdFiltered = macdLine.map(v => v ?? NaN)
  const signal = rollingEma(macdFiltered, 9)
  return macdLine.map((v, i) => v != null && signal[i] != null ? v - signal[i]! : null)
}

// PPO Histogram (fixed 12/26/9) - percentage version
const rollingPPO = (closes: number[]): Array<number | null> => {
  const ema12 = rollingEma(closes, 12)
  const ema26 = rollingEma(closes, 26)
  const ppoLine = ema12.map((v, i) => v != null && ema26[i] != null && ema26[i]! !== 0
    ? ((v - ema26[i]!) / ema26[i]!) * 100 : null)
  const ppoFiltered = ppoLine.map(v => v ?? NaN)
  const signal = rollingEma(ppoFiltered, 9)
  return ppoLine.map((v, i) => v != null && signal[i] != null ? v - signal[i]! : null)
}

// Trend Clarity (R² of linear regression)
const rollingTrendClarity = (values: number[], period: number): Array<number | null> => {
  const out: Array<number | null> = new Array(values.length).fill(null)
  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1)
    if (slice.some(v => Number.isNaN(v))) continue
    // Calculate R² of linear regression
    const n = slice.length
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0
    for (let j = 0; j < n; j++) {
      sumX += j
      sumY += slice[j]
      sumXY += j * slice[j]
      sumX2 += j * j
      sumY2 += slice[j] * slice[j]
    }
    const num = n * sumXY - sumX * sumY
    const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY))
    const r = den === 0 ? 0 : num / den
    out[i] = r * r * 100 // R² as percentage
  }
  return out
}

// Ultimate Smoother (Ehlers)
const rollingUltimateSmoother = (values: number[], period: number): Array<number | null> => {
  const out: Array<number | null> = new Array(values.length).fill(null)
  const a = Math.exp(-1.414 * Math.PI / period)
  const b = 2 * a * Math.cos(1.414 * Math.PI / period)
  const c2 = b
  const c3 = -a * a
  const c1 = (1 + c2 - c3) / 4

  for (let i = 2; i < values.length; i++) {
    if (i < period) continue
    if (Number.isNaN(values[i]) || Number.isNaN(values[i - 1]) || Number.isNaN(values[i - 2])) continue
    out[i] = c1 * (values[i] + 2 * values[i - 1] + values[i - 2])
           + c2 * (out[i - 1] ?? values[i - 1])
           + c3 * (out[i - 2] ?? values[i - 2])
  }
  return out
}

type IndicatorCacheSeriesKey = 'rsi' | 'sma' | 'ema' | 'std' | 'maxdd' | 'stdPrice' | 'cumRet' | 'smaRet' | 'mom13612w' | 'mom13612u' | 'momsma12' | 'drawdown' | 'aroonUp' | 'aroonDown' | 'aroonOsc' | 'macd' | 'ppo' | 'trendClarity' | 'ultSmooth'

const getCachedSeries = (cache: IndicatorCache, kind: IndicatorCacheSeriesKey, ticker: string, period: number, compute: () => Array<number | null>) => {
  const t = getSeriesKey(ticker)
  const map = cache[kind]
  let byTicker = map.get(t)
  if (!byTicker) {
    byTicker = new Map()
    map.set(t, byTicker)
  }
  const existing = byTicker.get(period)
  if (existing) return existing
  const next = compute()
  byTicker.set(period, next)
  return next
}

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

const computeMetrics = (equity: number[], returns: number[]) => {
  const days = returns.length
  const final = equity.length ? equity[equity.length - 1] : 1
  const cagr = days > 0 && final > 0 ? final ** (252 / days) - 1 : 0
  let peak = -Infinity
  let maxDd = 0
  for (const v of equity) {
    if (v > peak) peak = v
    if (peak > 0) {
      const dd = v / peak - 1
      if (dd < maxDd) maxDd = dd
    }
  }
  const mean = days > 0 ? returns.reduce((a, b) => a + b, 0) / days : 0
  const variance = days > 1 ? returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (days - 1) : 0
  const std = Math.sqrt(Math.max(0, variance))
  const sharpe = std > 0 ? (Math.sqrt(252) * mean) / std : 0
  return { cagr, maxDrawdown: maxDd, sharpe, days }
}

const computeMonthlyReturns = (days: BacktestDayRow[]) => {
  const buckets = new Map<string, { year: number; month: number; acc: number }>()
  for (const d of days) {
    const dt = d.date
    const year = Number(dt.slice(0, 4))
    const month = Number(dt.slice(5, 7))
    const key = `${year}-${month}`
    const prev = buckets.get(key) || { year, month, acc: 1 }
    prev.acc *= 1 + (Number.isFinite(d.netReturn) ? d.netReturn : 0)
    buckets.set(key, prev)
  }
  return Array.from(buckets.values())
    .map((b) => ({ year: b.year, month: b.month, value: b.acc - 1 }))
    .sort((a, b) => (a.year - b.year) || (a.month - b.month))
}

const computeBacktestSummary = (points: EquityPoint[], drawdowns: number[], days: BacktestDayRow[], benchmarkPoints?: EquityPoint[]) => {
  const equity = points.map((p) => p.value)
  const returns = days.map((d) => d.netReturn)
  const base = computeMetrics(equity, returns)

  const totalReturn = equity.length ? equity[equity.length - 1] - 1 : 0
  const years = base.days / 252

  const mean = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0
  const variance =
    returns.length > 1 ? returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1) : 0
  const dailyStd = Math.sqrt(Math.max(0, variance))
  const vol = dailyStd * Math.sqrt(252)

  // Sortino: uses downside deviation (squared negative returns relative to 0)
  // Calculate downside deviation using all returns, but only penalizing negative ones
  const downsideSquaredSum = returns.reduce((sum, r) => sum + (r < 0 ? r * r : 0), 0)
  const downsideVariance = returns.length > 1 ? downsideSquaredSum / (returns.length - 1) : 0
  const downsideStd = Math.sqrt(Math.max(0, downsideVariance))
  const annualizedDownsideStd = downsideStd * Math.sqrt(252)
  const annualizedMean = mean * 252
  const sortino = annualizedDownsideStd > 0 ? annualizedMean / annualizedDownsideStd : 0

  // Treynor Ratio: (Portfolio Return - Risk-Free Rate) / Beta
  // Beta = Cov(Rp, Rm) / Var(Rm)
  let treynor = 0
  let beta = 0
  if (benchmarkPoints && benchmarkPoints.length > 1 && returns.length > 1) {
    // Calculate benchmark returns from benchmark equity points
    const benchReturns: number[] = []
    for (let i = 1; i < benchmarkPoints.length; i++) {
      const prev = benchmarkPoints[i - 1].value
      const curr = benchmarkPoints[i].value
      if (prev > 0) {
        benchReturns.push(curr / prev - 1)
      }
    }

    // Align returns arrays (use minimum length)
    const minLen = Math.min(returns.length, benchReturns.length)
    if (minLen > 1) {
      const portReturns = returns.slice(0, minLen)
      const mktReturns = benchReturns.slice(0, minLen)

      const portMean = portReturns.reduce((a, b) => a + b, 0) / minLen
      const mktMean = mktReturns.reduce((a, b) => a + b, 0) / minLen

      // Covariance of portfolio and market
      let cov = 0
      let mktVar = 0
      for (let i = 0; i < minLen; i++) {
        cov += (portReturns[i] - portMean) * (mktReturns[i] - mktMean)
        mktVar += (mktReturns[i] - mktMean) ** 2
      }
      cov /= (minLen - 1)
      mktVar /= (minLen - 1)

      // Beta = Cov(Rp, Rm) / Var(Rm)
      beta = mktVar > 0 ? cov / mktVar : 0

      // Treynor = annualized excess return / beta (assuming 0% risk-free rate)
      if (beta !== 0) {
        treynor = annualizedMean / beta
      }
    }
  }

  const winRate = returns.length ? returns.filter((r) => r > 0).length / returns.length : 0
  const bestDay = returns.length ? Math.max(...returns) : 0
  const worstDay = returns.length ? Math.min(...returns) : 0
  const avgTurnover = days.length ? days.reduce((a, d) => a + d.turnover, 0) / days.length : 0
  const avgHoldings = days.length ? days.reduce((a, d) => a + d.holdings.length, 0) / days.length : 0

  const startDate = points.length ? isoFromUtcSeconds(points[0].time) : ''
  const endDate = points.length ? isoFromUtcSeconds(points[points.length - 1].time) : ''
  const maxDrawdown = drawdowns.length ? Math.min(...drawdowns) : 0

  // Calmar: CAGR / abs(maxDrawdown)
  const calmar = maxDrawdown !== 0 ? base.cagr / Math.abs(maxDrawdown) : 0

  return {
    startDate,
    endDate,
    days: base.days,
    years,
    totalReturn,
    cagr: base.cagr,
    vol,
    maxDrawdown,
    calmar,
    sharpe: base.sharpe,
    sortino,
    treynor,
    beta,
    winRate,
    bestDay,
    worstDay,
    avgTurnover,
    avgHoldings,
  }
}

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

type BacktesterPanelProps = {
  mode: BacktestMode
  setMode: (mode: BacktestMode) => void
  costBps: number
  setCostBps: (bps: number) => void
  benchmark: string
  setBenchmark: (ticker: string) => void
  showBenchmark: boolean
  setShowBenchmark: (show: boolean) => void
  tickerOptions: string[]
  status: 'idle' | 'running' | 'done' | 'error'
  result: BacktestResult | null
  errors: BacktestError[]
  onRun: () => void
  onJumpToError: (err: BacktestError) => void
  indicatorOverlays?: IndicatorOverlayData[]
  theme?: 'dark' | 'light'
  // Benchmarks tab
  benchmarkMetrics?: { status: 'idle' | 'loading' | 'done' | 'error'; data?: Record<string, ComparisonMetrics>; error?: string }
  onFetchBenchmarks?: () => void
  // Robustness tab
  modelSanityReport?: SanityReportState
  onFetchRobustness?: () => void
}

function BacktesterPanel({
  mode,
  setMode,
  costBps,
  setCostBps,
  benchmark,
  setBenchmark,
  showBenchmark,
  setShowBenchmark,
  tickerOptions,
  status,
  result,
  errors,
  onRun,
  onJumpToError,
  indicatorOverlays,
  theme = 'light',
  benchmarkMetrics,
  onFetchBenchmarks,
  modelSanityReport,
  onFetchRobustness,
}: BacktesterPanelProps) {
  const [tab, setTab] = useState<'Overview' | 'In Depth' | 'Benchmarks' | 'Robustness'>('Overview')
  const [selectedRange, setSelectedRange] = useState<VisibleRange | null>(null)
  const [logScale, setLogScale] = useState(true)
  const [activePreset, setActivePreset] = useState<'1m' | '3m' | '6m' | 'ytd' | '1y' | '5y' | 'max' | 'custom'>('max')
  const [rangePickerOpen, setRangePickerOpen] = useState(false)
  const [rangeStart, setRangeStart] = useState<string>('')
  const [rangeEnd, setRangeEnd] = useState<string>('')
  const rangePickerRef = useRef<HTMLDivElement | null>(null)
  const rangePopoverRef = useRef<HTMLDivElement | null>(null)
  const [rangePopoverPos, setRangePopoverPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const benchmarkKnown = useMemo(() => {
    const t = normalizeChoice(benchmark)
    if (!t || t === 'Empty') return false
    return tickerOptions.includes(t)
  }, [benchmark, tickerOptions])

  const points = result?.points ?? EMPTY_EQUITY_POINTS
  const visibleRange = useMemo<VisibleRange | undefined>(() => {
    if (!points.length) return undefined
    const full = { from: points[0].time, to: points[points.length - 1].time }
    const r = selectedRange ?? full
    return clampVisibleRangeToPoints(points, r)
  }, [points, selectedRange])

  // Rebase points so the first visible point = 1 (0%)
  const rebasedPoints = useMemo(() => {
    if (!points.length || !visibleRange) return points
    const fromTime = Number(visibleRange.from)
    // Find the first point at or after the visible range start
    const firstVisibleIdx = points.findIndex(p => Number(p.time) >= fromTime)
    if (firstVisibleIdx < 0) return points
    const baseValue = points[firstVisibleIdx].value
    if (!baseValue || baseValue <= 0) return points
    return points.map(p => ({ ...p, value: p.value / baseValue }))
  }, [points, visibleRange])

  // Also rebase benchmark points
  const rebasedBenchmarkPoints = useMemo(() => {
    const benchPts = result?.benchmarkPoints
    if (!benchPts?.length || !visibleRange) return benchPts
    const fromTime = Number(visibleRange.from)
    const firstVisibleIdx = benchPts.findIndex(p => Number(p.time) >= fromTime)
    if (firstVisibleIdx < 0) return benchPts
    const baseValue = benchPts[firstVisibleIdx].value
    if (!baseValue || baseValue <= 0) return benchPts
    return benchPts.map(p => ({ ...p, value: p.value / baseValue }))
  }, [result?.benchmarkPoints, visibleRange])

  const handleRun = useCallback(() => {
    // Reset to full period ("max") on each run.
    setSelectedRange(null)
    setActivePreset('max')
    setRangePickerOpen(false)
    setRangeStart('')
    setRangeEnd('')
    onRun()
  }, [onRun])

  const computeRangePopoverPos = useCallback(() => {
    const anchor = rangePickerRef.current
    if (!anchor) return null
    const rect = anchor.getBoundingClientRect()
    const width = 360
    const padding = 10
    const top = rect.bottom + 8
    let left = rect.right - width
    left = Math.max(padding, Math.min(left, window.innerWidth - width - padding))
    return { top, left, width }
  }, [])

  useEffect(() => {
    if (!rangePickerOpen) return
    const onDown = (e: MouseEvent) => {
      const el = rangePickerRef.current
      const pop = rangePopoverRef.current
      if (!el) return
      if (e.target && el.contains(e.target as Node)) return
      if (pop && e.target && pop.contains(e.target as Node)) return
      setRangePickerOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    const onPos = () => setRangePopoverPos(computeRangePopoverPos())
    window.addEventListener('resize', onPos)
    window.addEventListener('scroll', onPos, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('resize', onPos)
      window.removeEventListener('scroll', onPos, true)
    }
  }, [computeRangePopoverPos, rangePickerOpen])

  const rangeLabel = useMemo(() => {
    if (!visibleRange) return { start: '', end: '' }
    return { start: isoFromUtcSeconds(visibleRange.from), end: isoFromUtcSeconds(visibleRange.to) }
  }, [visibleRange])

  const tradingDaysInRange = useMemo(() => {
    if (!result || !visibleRange) return 0
    const from = Number(visibleRange.from)
    const to = Number(visibleRange.to)
    if (!(Number.isFinite(from) && Number.isFinite(to) && from <= to)) return 0
    const nPoints = points.filter((p) => {
      const t = Number(p.time)
      return t >= from && t <= to
    }).length
    return Math.max(0, nPoints - 1)
  }, [result, visibleRange, points])

  const applyPreset = (preset: '1m' | '3m' | '6m' | 'ytd' | '1y' | '5y' | 'max') => {
    if (!points.length) return
    setActivePreset(preset)
    if (preset === 'max') {
      setSelectedRange(null)
      return
    }

    try {
      const endTime = visibleRange?.to ?? points[points.length - 1].time
      const endMs = Number(endTime) * 1000
      if (!Number.isFinite(endMs)) return
      const endDate = new Date(endMs)
    let startDate: Date
    switch (preset) {
      case '1m':
        startDate = new Date(endDate)
        startDate.setUTCMonth(startDate.getUTCMonth() - 1)
        break
      case '3m':
        startDate = new Date(endDate)
        startDate.setUTCMonth(startDate.getUTCMonth() - 3)
        break
      case '6m':
        startDate = new Date(endDate)
        startDate.setUTCMonth(startDate.getUTCMonth() - 6)
        break
      case 'ytd':
        startDate = new Date(Date.UTC(endDate.getUTCFullYear(), 0, 1))
        break
      case '1y':
        startDate = new Date(endDate)
        startDate.setUTCFullYear(startDate.getUTCFullYear() - 1)
        break
      case '5y':
        startDate = new Date(endDate)
        startDate.setUTCFullYear(startDate.getUTCFullYear() - 5)
        break
    }
    const startSec = Math.floor(startDate.getTime() / 1000)
    let startTime = points[0].time
    for (let i = 0; i < points.length; i++) {
      if (Number(points[i].time) >= startSec) {
        startTime = points[i].time
        break
      }
    }
    setSelectedRange(clampVisibleRangeToPoints(points, { from: startTime, to: endTime }))
    } catch {
      // Invalid date - ignore preset
    }
  }

  const handleChartVisibleRangeChange = useCallback(
    (r: VisibleRange) => {
      if (!points.length) return
      const next = clampVisibleRangeToPoints(points, r)
      setActivePreset('custom')
      setSelectedRange((prev) => {
        if (!prev) return next
        if (Number(prev.from) === Number(next.from) && Number(prev.to) === Number(next.to)) return prev
        return next
      })
    },
    [points],
  )

  const applyCustomRange = useCallback(() => {
    if (!points.length) return
    if (!rangeStart || !rangeEnd) return
    const parse = (s: string) => {
      const [yy, mm, dd] = s.split('-').map((x) => Number(x))
      if (!(Number.isFinite(yy) && Number.isFinite(mm) && Number.isFinite(dd))) return null
      return Math.floor(Date.UTC(yy, mm - 1, dd) / 1000) as UTCTimestamp
    }
    const from0 = parse(rangeStart)
    const to0 = parse(rangeEnd)
    if (!from0 || !to0) return
    const clamped = clampVisibleRangeToPoints(points, { from: from0, to: to0 })
    setSelectedRange(clamped)
    setActivePreset('custom')
    setRangePickerOpen(false)
  }, [points, rangeEnd, rangeStart])

  const rangePopover = rangePickerOpen
    ? createPortal(
        <div
          ref={rangePopoverRef}
          className="range-popover"
          role="dialog"
          aria-label="Choose date range"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: rangePopoverPos?.top ?? 0,
            left: rangePopoverPos?.left ?? 0,
            width: rangePopoverPos?.width ?? 360,
            right: 'auto',
            zIndex: 500,
          }}
        >
          <div className="range-popover-row">
            <label className="range-field">
              <span>Start</span>
              <input type="date" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} />
            </label>
            <label className="range-field">
              <span>End</span>
              <input type="date" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} />
            </label>
          </div>
          <div className="range-popover-actions">
            <button onClick={() => setRangePickerOpen(false)}>Cancel</button>
            <button onClick={applyCustomRange}>Apply</button>
          </div>
        </div>,
        document.body,
      )
    : null

  const allocationSeries = useMemo(() => {
    const days = result?.days || []
    if (days.length === 0) return []
    const totals = new Map<string, number>()
    for (const d of days) {
      for (const h of d.holdings) totals.set(h.ticker, (totals.get(h.ticker) || 0) + h.weight)
    }
    const ranked = Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([t]) => t)

    const palette = ['#0ea5e9', '#7c3aed', '#16a34a', '#f97316', '#db2777', '#0891b2', '#eab308', '#dc2626', '#475569', '#4f46e5']
    const series = ranked.map((ticker, i) => ({
      name: ticker,
      color: palette[i % palette.length],
      points: days.map((d) => ({
        time: d.time,
        value: d.holdings.find((h) => h.ticker === ticker)?.weight ?? 0,
      })) as EquityPoint[],
    }))

    series.push({
      name: 'Cash',
      color: '#94a3b8',
      points: days.map((d) => {
        const invested = d.holdings.reduce((a, b) => a + b.weight, 0)
        return { time: d.time, value: Math.max(0, 1 - invested) }
      }) as EquityPoint[],
    })

    return series
  }, [result])

  const groupedWarnings = useMemo(() => {
    const out = new Map<string, { message: string; count: number; first?: BacktestWarning; last?: BacktestWarning }>()
    for (const w of result?.warnings || []) {
      const key = w.message
      const prev = out.get(key)
      if (!prev) out.set(key, { message: key, count: 1, first: w, last: w })
      else out.set(key, { ...prev, count: prev.count + 1, last: w })
    }
    return Array.from(out.values()).sort((a, b) => b.count - a.count)
  }, [result])

  const rebalanceDays = useMemo(() => {
    return (result?.days || []).filter((d) => d.turnover > 0.0001)
  }, [result])

  return (
    <Card>
      <CardHeader>
        <div>
          <div className="text-xs tracking-widest uppercase text-muted mb-1">Build</div>
          <h2 className="text-xl font-black">Backtester</h2>
        </div>
        <div className="flex flex-wrap gap-3 items-end mt-2">
          <label className="grid gap-1">
            <span className="text-sm font-bold">Mode</span>
            <Select value={mode} onChange={(e) => setMode(e.target.value as BacktesterPanelProps['mode'])}>
              <option value="CC">Close→Close</option>
              <option value="OO">Open→Open</option>
              <option value="OC">Open→Close</option>
              <option value="CO">Close→Open</option>
            </Select>
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-bold">Cost (bps)</span>
            <Input
              type="number"
              min={0}
              step={1}
              value={Number.isFinite(costBps) ? costBps : 0}
              onChange={(e) => setCostBps(Number(e.target.value || 0))}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-bold">Benchmark</span>
            <Input
              list={TICKER_DATALIST_ID}
              value={benchmark}
              onChange={(e) => setBenchmark(e.target.value)}
              placeholder="SPY"
              spellCheck={false}
              className="w-[120px]"
            />
          </label>
          {!benchmarkKnown && benchmark.trim() ? (
            <div className="text-danger font-extrabold text-xs">Unknown ticker</div>
          ) : null}
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showBenchmark} onChange={(e) => setShowBenchmark(e.target.checked)} />
            <span className="text-sm font-bold">Show benchmark</span>
          </label>
          <Button onClick={handleRun} disabled={status === 'running'}>
            {status === 'running' ? 'Running…' : 'Run Backtest'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex gap-2">
          {(['Overview', 'In Depth', 'Benchmarks', 'Robustness'] as const).map((t) => (
            <Button key={t} variant={tab === t ? 'accent' : 'secondary'} size="sm" onClick={() => setTab(t)}>
              {t}
            </Button>
          ))}
        </div>

        {errors.length > 0 && (
          <Alert variant="destructive">
            <AlertTitle>Fix these errors before running:</AlertTitle>
            <AlertDescription>
              <div className="grid gap-1.5">
                {errors.map((e, idx) => (
                  <Button
                    key={`${e.nodeId}-${e.field}-${idx}`}
                    variant="link"
                    className="justify-start h-auto p-0 text-inherit"
                    onClick={() => onJumpToError(e)}
                  >
                    {e.message}
                  </Button>
                ))}
              </div>
            </AlertDescription>
          </Alert>
        )}

        {result && tab === 'Overview' ? (
          <>
            <div className="grid grid-cols-10 gap-2">
              <Card
                ref={rangePickerRef}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (!rangePickerOpen && visibleRange) {
                    setRangeStart(isoFromUtcSeconds(visibleRange.from))
                    setRangeEnd(isoFromUtcSeconds(visibleRange.to))
                  }
                  setRangePopoverPos(computeRangePopoverPos())
                  setRangePickerOpen((v) => !v)
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return
                  e.preventDefault()
                  if (!rangePickerOpen && visibleRange) {
                    setRangeStart(isoFromUtcSeconds(visibleRange.from))
                    setRangeEnd(isoFromUtcSeconds(visibleRange.to))
                  }
                  setRangePopoverPos(computeRangePopoverPos())
                  setRangePickerOpen((v) => !v)
                }}
                className="cursor-pointer relative p-2 text-center"
                title="Click to set a custom date range"
              >
                <div className="text-[10px] font-bold text-muted">Date range</div>
                <div className="text-sm font-black">{rangeLabel.start} → {rangeLabel.end}</div>
                <div className="text-[10px] text-muted">{tradingDaysInRange} days</div>
              </Card>
              <Card className="p-2 text-center">
                <div className="text-[10px] font-bold text-muted">CAGR</div>
                <div className="text-sm font-black">{formatPct(result.metrics.cagr)}</div>
              </Card>
              <Card className="p-2 text-center">
                <div className="text-[10px] font-bold text-muted">Max DD</div>
                <div className="text-sm font-black">{formatPct(result.metrics.maxDrawdown)}</div>
              </Card>
              <Card className="p-2 text-center">
                <div className="text-[10px] font-bold text-muted">Calmar Ratio</div>
                <div className="text-sm font-black">{Number.isFinite(result.metrics.calmar) ? result.metrics.calmar.toFixed(2) : '—'}</div>
              </Card>
              <Card className="p-2 text-center">
                <div className="text-[10px] font-bold text-muted">Sharpe Ratio</div>
                <div className="text-sm font-black">{Number.isFinite(result.metrics.sharpe) ? result.metrics.sharpe.toFixed(2) : '—'}</div>
              </Card>
              <Card className="p-2 text-center">
                <div className="text-[10px] font-bold text-muted">Sortino Ratio</div>
                <div className="text-sm font-black">{Number.isFinite(result.metrics.sortino) ? result.metrics.sortino.toFixed(2) : '—'}</div>
              </Card>
              <Card className="p-2 text-center">
                <div className="text-[10px] font-bold text-muted">Treynor Ratio</div>
                <div className="text-sm font-black">{Number.isFinite(result.metrics.treynor) ? result.metrics.treynor.toFixed(2) : '—'}</div>
              </Card>
              <Card className="p-2 text-center">
                <div className="text-[10px] font-bold text-muted">Beta</div>
                <div className="text-sm font-black">{Number.isFinite(result.metrics.beta) ? result.metrics.beta.toFixed(2) : '—'}</div>
              </Card>
              <Card className="p-2 text-center">
                <div className="text-[10px] font-bold text-muted">Vol</div>
                <div className="text-sm font-black">{formatPct(result.metrics.vol)}</div>
              </Card>
              <Card className="p-2 text-center">
                <div className="text-[10px] font-bold text-muted">Win rate</div>
                <div className="text-sm font-black">{formatPct(result.metrics.winRate)}</div>
              </Card>
              <Card className="p-2 text-center">
                <div className="text-[10px] font-bold text-muted">Turnover</div>
                <div className="text-sm font-black">{formatPct(result.metrics.avgTurnover)}</div>
              </Card>
              <Card className="p-2 text-center">
                <div className="text-[10px] font-bold text-muted">Avg # Holdings</div>
                <div className="text-sm font-black">{result.metrics.avgHoldings.toFixed(2)}</div>
              </Card>
            </div>

              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex gap-1">
                    <Button variant={activePreset === '1m' ? 'accent' : 'secondary'} size="sm" onClick={() => applyPreset('1m')}>
                      1m
                    </Button>
                    <Button variant={activePreset === '3m' ? 'accent' : 'secondary'} size="sm" onClick={() => applyPreset('3m')}>
                      3m
                    </Button>
                    <Button variant={activePreset === '6m' ? 'accent' : 'secondary'} size="sm" onClick={() => applyPreset('6m')}>
                      6m
                    </Button>
                    <Button variant={activePreset === 'ytd' ? 'accent' : 'secondary'} size="sm" onClick={() => applyPreset('ytd')}>
                      YTD
                    </Button>
                    <Button variant={activePreset === '1y' ? 'accent' : 'secondary'} size="sm" onClick={() => applyPreset('1y')}>
                      1yr
                    </Button>
                    <Button variant={activePreset === '5y' ? 'accent' : 'secondary'} size="sm" onClick={() => applyPreset('5y')}>
                      5yr
                    </Button>
                    <Button variant={activePreset === 'max' ? 'accent' : 'secondary'} size="sm" onClick={() => applyPreset('max')}>
                      Max
                    </Button>
                    <Button variant={logScale ? 'accent' : 'secondary'} size="sm" onClick={() => setLogScale((v) => !v)}>
                      Log
                    </Button>
                  </div>
                </div>
                <EquityChart
                  points={rebasedPoints}
                  benchmarkPoints={showBenchmark ? rebasedBenchmarkPoints : undefined}
                  markers={result.markers}
                  visibleRange={visibleRange}
                  logScale={logScale}
                  indicatorOverlays={indicatorOverlays}
                  theme={theme}
                />
              </div>
              {rangePopover}

            <div>
              <div className="mb-2">
                <div className="font-black">Drawdown</div>
              </div>
              <DrawdownChart
                points={result.drawdownPoints}
                visibleRange={visibleRange}
                theme={theme}
              />
              {visibleRange ? (
                <RangeNavigator points={result.points} range={visibleRange} onChange={handleChartVisibleRangeChange} theme={theme} />
              ) : null}
            </div>

            {result.warnings.length > 0 && (
              <Alert variant="warning">
                <AlertTitle>
                  Warnings ({result.warnings.length})
                </AlertTitle>
                <AlertDescription>
                <div className="max-h-[140px] overflow-auto grid gap-1">
                  {result.warnings.slice(0, 50).map((w, idx) => (
                    <div key={`${w.time}-${idx}`}>
                      {w.date}: {w.message}
                    </div>
                  ))}
                  {result.warnings.length > 50 ? <div>…</div> : null}
                </div>
                </AlertDescription>
              </Alert>
            )}

          </>
        ) : result && tab === 'In Depth' ? (
          <>
            <div className="saved-item grid grid-cols-2 gap-4 items-stretch">
              <div className="border border-border rounded-lg p-3 flex flex-col" style={{ height: '320px' }}>
                <div className="font-black mb-1.5">Monthly Returns</div>
                <div className="flex-1 overflow-auto min-h-0">
                  {renderMonthlyHeatmap(result.monthly, result.days, theme)}
                </div>
              </div>
              <div className="border border-border rounded-lg p-3 flex flex-col" style={{ height: '320px' }}>
                <div className="font-black mb-1.5">Allocations (recent)</div>
                <div className="flex-1 overflow-auto font-mono text-xs min-h-0">
                  {(result.allocations || []).slice(-300).reverse().map((row) => (
                    <div key={row.date}>
                      {row.date} —{' '}
                      {row.entries.length === 0
                        ? 'Cash'
                        : row.entries
                            .slice()
                            .sort((a, b) => b.weight - a.weight)
                            .map((e) => `${e.ticker} ${(e.weight * 100).toFixed(2)}%`)
                            .join(', ')}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="saved-item">
              <AllocationChart series={allocationSeries} visibleRange={visibleRange} theme={theme} />
            </div>
            <div className="saved-item grid grid-cols-2 gap-4 items-start">
              <div className="border border-border rounded-lg p-3 flex flex-col" style={{ height: '280px' }}>
                <div className="font-black mb-1.5">Rebalance days ({rebalanceDays.length})</div>
                <div className="backtester-table flex-1 overflow-auto min-h-0">
                  <div className="backtester-row backtester-head-row">
                    <div>Date</div>
                    <div>Net</div>
                    <div>Turnover</div>
                    <div>Cost</div>
                    <div>Holdings</div>
                  </div>
                  <div className="backtester-body-rows">
                    {rebalanceDays.slice(-400).reverse().map((d) => (
                      <div key={d.date} className="backtester-row">
                        <div>{d.date}</div>
                        <div>{formatPct(d.netReturn)}</div>
                        <div>{formatPct(d.turnover)}</div>
                        <div>{formatPct(d.cost)}</div>
                        <div className="font-mono text-xs">
                          {d.holdings.length === 0
                            ? 'Cash'
                            : d.holdings
                                .slice()
                                .sort((a, b) => b.weight - a.weight)
                                .map((h) => `${h.ticker} ${(h.weight * 100).toFixed(1)}%`)
                                .join(', ')}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="border border-border rounded-lg p-3 flex flex-col" style={{ height: '280px' }}>
                <div className="font-black mb-1.5">Warnings ({result.warnings.length})</div>
                {groupedWarnings.length === 0 ? (
                  <div className="text-muted flex-1 flex items-center justify-center">No warnings.</div>
                ) : (
                  <div className="backtester-table flex-1 overflow-auto min-h-0">
                    <div className="backtester-row backtester-head-row">
                      <div>Count</div>
                      <div>Message</div>
                      <div>First</div>
                      <div>Last</div>
                    </div>
                    <div className="backtester-body-rows">
                      {groupedWarnings.map((g) => (
                        <div key={g.message} className="backtester-row">
                          <div>{g.count}</div>
                          <div>{g.message}</div>
                          <div>{g.first?.date ?? '—'}</div>
                          <div>{g.last?.date ?? '—'}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {result.trace ? (
              <div className="saved-item">
                <div className="flex gap-2.5 items-center flex-wrap">
                  <div className="font-black">Condition trace (debug)</div>
                  <Button onClick={() => downloadTextFile('backtest_trace.json', JSON.stringify(result.trace, null, 2), 'application/json')}>
                    Download trace JSON
                  </Button>
                </div>
                <div className="mt-2 backtester-table max-h-[300px] overflow-auto">
                  <div className="backtester-row backtester-head-row">
                    <div>Node</div>
                    <div>Kind</div>
                    <div>Then</div>
                    <div>Else</div>
                    <div>Conditions</div>
                  </div>
                  <div className="backtester-body-rows">
                    {result.trace.nodes.slice(0, 80).map((n) => (
                      <div key={n.nodeId} className="backtester-row">
                        <div className="font-mono text-xs">{n.nodeId}</div>
                        <div>{n.kind}</div>
                        <div>{n.thenCount}</div>
                        <div>{n.elseCount}</div>
                        <div className="font-mono text-xs">
                          {n.conditions.length === 0
                            ? '—'
                            : n.conditions
                                .slice(0, 4)
                                .map((c) => `${c.type.toUpperCase()} ${c.expr} [T:${c.trueCount} F:${c.falseCount}]`)
                                .join(' | ')}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {result.trace.nodes.length > 80 ? (
                  <div className="mt-1.5 text-muted">Showing first 80 nodes. Use Download trace JSON for the full set.</div>
                ) : null}
              </div>
            ) : null}

            <Card>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" onClick={() => downloadEquityCsv(result, mode, costBps, benchmark, showBenchmark)}>Download equity CSV</Button>
                <Button size="sm" onClick={() => downloadAllocationsCsv(result)}>Download allocations CSV</Button>
                <Button size="sm" onClick={() => downloadRebalancesCsv(result)}>Download rebalances CSV</Button>
              </div>
            </Card>
          </>
        ) : result && tab === 'Benchmarks' ? (
          <div className="saved-item flex flex-col gap-2.5 h-full min-w-0">
            <div className="flex items-center justify-between gap-2.5">
              <div className="font-black">Benchmark Comparison</div>
              <Button
                size="sm"
                onClick={() => onFetchBenchmarks?.()}
                disabled={benchmarkMetrics?.status === 'loading'}
              >
                {benchmarkMetrics?.status === 'loading' ? 'Loading...' : benchmarkMetrics?.status === 'done' ? 'Refresh' : 'Load Benchmarks'}
              </Button>
            </div>
            {benchmarkMetrics?.status === 'idle' && (
              <div className="text-muted text-sm p-4 border border-border rounded-xl text-center">
                Click "Load Benchmarks" to compare your strategy against major indices (VTI, SPY, QQQ, etc.).
              </div>
            )}
            {benchmarkMetrics?.status === 'loading' && (
              <div className="text-muted text-sm p-4 border border-border rounded-xl text-center">
                <div className="animate-pulse">Loading benchmark data...</div>
              </div>
            )}
            {benchmarkMetrics?.status === 'error' && (
              <div className="text-danger text-sm p-4 border border-danger rounded-xl">
                Error: {benchmarkMetrics.error}
              </div>
            )}
            {benchmarkMetrics?.status === 'done' && benchmarkMetrics.data && (
              <div className="flex-1 overflow-auto border border-border rounded-xl max-w-full">
                {(() => {
                  const benchmarks = benchmarkMetrics.data
                  const strategyMetrics = result.metrics

                  // Helper to format metrics for display
                  const fmt = (v: number | undefined, isPct = false, isRatio = false) => {
                    if (v === undefined || !Number.isFinite(v)) return '—'
                    if (isPct) return `${(v * 100).toFixed(1)}%`
                    if (isRatio) return v.toFixed(2)
                    return v.toFixed(2)
                  }

                  // Helper to format alpha difference with color
                  const fmtAlpha = (stratVal: number | undefined, rowVal: number | undefined, isPct = false, isHigherBetter = true) => {
                    if (stratVal === undefined || rowVal === undefined || !Number.isFinite(stratVal) || !Number.isFinite(rowVal)) return null
                    const diff = stratVal - rowVal
                    const stratIsBetter = isHigherBetter ? diff > 0 : (stratVal < 0 ? diff > 0 : diff < 0)
                    const color = stratIsBetter ? 'text-success' : diff === 0 ? 'text-muted' : 'text-danger'
                    const sign = diff > 0 ? '+' : ''
                    const formatted = isPct ? `${sign}${(diff * 100).toFixed(1)}%` : `${sign}${diff.toFixed(2)}`
                    return <span className={`${color} text-xs ml-1`}>({formatted})</span>
                  }

                  // Get Monte Carlo and K-Fold metrics if available from modelSanityReport
                  const mcMetrics = modelSanityReport?.report?.pathRisk?.comparisonMetrics?.monteCarlo
                  const kfMetrics = modelSanityReport?.report?.pathRisk?.comparisonMetrics?.kfold
                  const strategyBetas: Record<string, number> = (modelSanityReport?.report as { strategyBetas?: Record<string, number> })?.strategyBetas ?? {}

                  // Build row data - MC is baseline if available, otherwise Your Strategy
                  type RowData = { label: string; metrics: ComparisonMetrics | undefined; isBaseline?: boolean; ticker?: string }
                  const rowData: RowData[] = [
                    { label: mcMetrics ? 'Monte Carlo Comparison' : 'Your Strategy', metrics: mcMetrics ?? { cagr50: strategyMetrics.cagr, maxdd50: strategyMetrics.maxDrawdown, maxdd95: strategyMetrics.maxDrawdown, calmar50: strategyMetrics.calmar, calmar95: strategyMetrics.calmar, sharpe: strategyMetrics.sharpe, sortino: strategyMetrics.sortino, treynor: strategyMetrics.treynor ?? 0, beta: strategyMetrics.beta ?? 1, volatility: strategyMetrics.vol, winRate: strategyMetrics.winRate }, isBaseline: true },
                    ...(kfMetrics ? [{ label: 'K-Fold Comparison', metrics: kfMetrics }] : []),
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
                    { key: 'maxdd50', label: 'MaxDD-50', isPct: true, higherBetter: false },
                    { key: 'maxdd95', label: 'Tail Risk-DD95', isPct: true, higherBetter: false },
                    { key: 'calmar50', label: 'Calmar-50', isRatio: true, higherBetter: true },
                    { key: 'calmar95', label: 'Calmar-95', isRatio: true, higherBetter: true },
                    { key: 'sharpe', label: 'Sharpe', isRatio: true, higherBetter: true },
                    { key: 'sortino', label: 'Sortino', isRatio: true, higherBetter: true },
                    { key: 'treynor', label: 'Treynor', isRatio: true, higherBetter: true },
                    { key: 'beta', label: 'Beta', isRatio: true, higherBetter: false },
                    { key: 'volatility', label: 'Volatility', isPct: true, higherBetter: false },
                    { key: 'winRate', label: 'Win Rate', isPct: true, higherBetter: true },
                  ]

                  const stratMetrics = rowData[0].metrics

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
                            <td className={row.isBaseline ? 'font-bold' : ''}>{row.label}</td>
                            {cols.map((c) => {
                              // For Beta column in benchmark rows, show strategy beta vs that ticker
                              let val = row.metrics?.[c.key]
                              if (c.key === 'beta' && row.ticker && strategyBetas[row.ticker] !== undefined) {
                                val = strategyBetas[row.ticker]
                              }
                              // Show alpha vs MC/Strategy for all non-baseline rows
                              const showAlpha = !row.isBaseline && stratMetrics
                              const mcVal = stratMetrics?.[c.key]
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
            )}
          </div>
        ) : result && tab === 'Robustness' ? (
          <div className="saved-item flex flex-col gap-2.5 h-full min-w-0">
            {(() => {
              const sanityState = modelSanityReport ?? { status: 'idle' as const }
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

              return (
                <>
                  <div className="flex items-center justify-between gap-2.5">
                    <div className="font-black">Robustness Analysis</div>
                    <Button
                      size="sm"
                      onClick={() => onFetchRobustness?.()}
                      disabled={sanityState.status === 'loading'}
                    >
                      {sanityState.status === 'loading' ? 'Running...' : sanityState.status === 'done' ? 'Re-run' : 'Generate'}
                    </Button>
                  </div>

                  {sanityState.status === 'idle' && (
                    <div className="text-muted text-sm p-4 border border-border rounded-xl text-center">
                      Click "Generate" to run bootstrap simulations and fragility analysis.
                      <br />
                      <span className="text-xs">Note: Save the bot first to run robustness analysis via the API.</span>
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
                              const minVal = dd.p95
                              const maxVal = dd.p5
                              const range = maxVal - minVal || 0.01
                              const toPos = (v: number) => Math.max(0, Math.min(100, ((v - minVal) / range) * 100))
                              return (
                                <>
                                  <div className="relative h-4 bg-muted/30 rounded overflow-hidden">
                                    <div
                                      className="absolute h-full bg-danger/40"
                                      style={{ left: `${toPos(dd.p75)}%`, width: `${Math.abs(toPos(dd.p25) - toPos(dd.p75))}%` }}
                                    />
                                    <div
                                      className="absolute h-full w-0.5 bg-danger"
                                      style={{ left: `${toPos(dd.p50)}%` }}
                                    />
                                  </div>
                                  <div className="flex justify-between text-xs mt-0.5">
                                    <span className="text-danger">P95: {formatPctVal(dd.p5)}</span>
                                    <span className="font-semibold">P50: {formatPctVal(dd.p50)}</span>
                                    <span className="text-success">P5: {formatPctVal(dd.p95)}</span>
                                  </div>
                                </>
                              )
                            })()}
                          </div>

                          {/* MC CAGR Distribution */}
                          <div className="mb-3">
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
                                    <div
                                      className="absolute h-full bg-success/40"
                                      style={{ left: `${toPos(cagr.p25)}%`, width: `${toPos(cagr.p75) - toPos(cagr.p25)}%` }}
                                    />
                                    <div
                                      className="absolute h-full w-0.5 bg-success"
                                      style={{ left: `${toPos(cagr.p50)}%` }}
                                    />
                                  </div>
                                  <div className="flex justify-between text-xs mt-0.5">
                                    <span className="text-danger">P5: {formatPctVal(cagr.p5)}</span>
                                    <span className="font-semibold">P50: {formatPctVal(cagr.p50)}</span>
                                    <span className="text-success">P95: {formatPctVal(cagr.p95)}</span>
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
                                const minVal = sh.p5
                                const maxVal = sh.p95
                                const range = maxVal - minVal || 0.01
                                const toPos = (v: number) => Math.max(0, Math.min(100, ((v - minVal) / range) * 100))
                                const hasP25P75 = sh.p25 != null && sh.p75 != null
                                return (
                                  <>
                                    <div className="relative h-4 bg-muted/30 rounded overflow-hidden">
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

                          {/* MC Volatility Distribution */}
                          {sanityState.report.pathRisk.monteCarlo.volatilities && (
                            <div>
                              <div className="text-xs text-muted mb-1 cursor-help text-center" title="Distribution of annualized volatility across Monte Carlo simulations. Lower is generally better.">Volatility Distribution</div>
                              {(() => {
                                const vol = sanityState.report.pathRisk.monteCarlo.volatilities
                                const minVal = vol.p95
                                const maxVal = vol.p5
                                const range = maxVal - minVal || 0.01
                                const toPos = (v: number) => Math.max(0, Math.min(100, ((v - minVal) / range) * 100))
                                const hasP25P75 = vol.p25 != null && vol.p75 != null
                                return (
                                  <>
                                    <div className="relative h-4 bg-muted/30 rounded overflow-hidden">
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
                                      <span className="text-danger">P95: {formatPctVal(vol.p95)}</span>
                                      <span className="font-semibold">P50: {formatPctVal(vol.p50)}</span>
                                      <span className="text-success">P5: {formatPctVal(vol.p5)}</span>
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
                              const minVal = dd.p95
                              const maxVal = dd.p5
                              const range = maxVal - minVal || 0.01
                              const toPos = (v: number) => Math.max(0, Math.min(100, ((v - minVal) / range) * 100))
                              return (
                                <>
                                  <div className="relative h-4 bg-muted/30 rounded overflow-hidden">
                                    <div
                                      className="absolute h-full bg-danger/40"
                                      style={{ left: `${toPos(dd.p75)}%`, width: `${Math.abs(toPos(dd.p25) - toPos(dd.p75))}%` }}
                                    />
                                    <div
                                      className="absolute h-full w-0.5 bg-danger"
                                      style={{ left: `${toPos(dd.p50)}%` }}
                                    />
                                  </div>
                                  <div className="flex justify-between text-xs mt-0.5">
                                    <span className="text-danger">P95: {formatPctVal(dd.p5)}</span>
                                    <span className="font-semibold">P50: {formatPctVal(dd.p50)}</span>
                                    <span className="text-success">P5: {formatPctVal(dd.p95)}</span>
                                  </div>
                                </>
                              )
                            })()}
                          </div>

                          {/* KF CAGR Distribution */}
                          <div className="mb-3">
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
                                    <div
                                      className="absolute h-full bg-success/40"
                                      style={{ left: `${toPos(cagr.p25)}%`, width: `${toPos(cagr.p75) - toPos(cagr.p25)}%` }}
                                    />
                                    <div
                                      className="absolute h-full w-0.5 bg-success"
                                      style={{ left: `${toPos(cagr.p50)}%` }}
                                    />
                                  </div>
                                  <div className="flex justify-between text-xs mt-0.5">
                                    <span className="text-danger">P5: {formatPctVal(cagr.p5)}</span>
                                    <span className="font-semibold">P50: {formatPctVal(cagr.p50)}</span>
                                    <span className="text-success">P95: {formatPctVal(cagr.p95)}</span>
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
                                const minVal = sh.p5
                                const maxVal = sh.p95
                                const range = maxVal - minVal || 0.01
                                const toPos = (v: number) => Math.max(0, Math.min(100, ((v - minVal) / range) * 100))
                                const hasP25P75 = sh.p25 != null && sh.p75 != null
                                return (
                                  <>
                                    <div className="relative h-4 bg-muted/30 rounded overflow-hidden">
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
                                const minVal = vol.p95
                                const maxVal = vol.p5
                                const range = maxVal - minVal || 0.01
                                const toPos = (v: number) => Math.max(0, Math.min(100, ((v - minVal) / range) * 100))
                                const hasP25P75 = vol.p25 != null && vol.p75 != null
                                return (
                                  <>
                                    <div className="relative h-4 bg-muted/30 rounded overflow-hidden">
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
                                      <span className="text-danger">P95: {formatPctVal(vol.p95)}</span>
                                      <span className="font-semibold">P50: {formatPctVal(vol.p50)}</span>
                                      <span className="text-success">P5: {formatPctVal(vol.p5)}</span>
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
        ) : status === 'running' ? (
          <div className="text-muted font-bold p-4 text-center">Running backtest…</div>
        ) : (
          <div className="text-muted font-bold p-4 text-center">
            Tip: Start `npm run api` so tickers and candles load. Use the tabs to see allocations and rebalances after running.
          </div>
        )}
      </CardContent>
    </Card>
  )
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

  const initialUserData: UserData = (() => {
    if (!initialUserId) {
      return { savedBots: [], watchlists: ensureDefaultWatchlist([]), callChains: [], ui: defaultUiState() }
    }
    return loadUserData(initialUserId)
  })()

  const [userId, setUserId] = useState<UserId | null>(() => initialUserId)
  const [userRole, setUserRole] = useState<string | null>(() => initialUserRole)

  // Role hierarchy checks
  // Admin = sub_admin, main_admin, or legacy 'admin' role
  const isAdmin = userRole === 'admin' || userRole === 'main_admin' || userRole === 'sub_admin'
  // Engineer access = engineer or higher (for Databases tab)
  const hasEngineerAccess = userRole === 'engineer' || userRole === 'sub_admin' || userRole === 'main_admin' || userRole === 'admin'

  const [savedBots, setSavedBots] = useState<SavedBot[]>(() => initialUserData.savedBots)
  const [watchlists, setWatchlists] = useState<Watchlist[]>(() => initialUserData.watchlists)
  const [callChains, setCallChains] = useState<CallChain[]>(() => initialUserData.callChains)
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

  const theme = userId ? uiState.theme : deviceTheme

  const [availableTickers, setAvailableTickers] = useState<string[]>([])
  const [tickerMetadata, setTickerMetadata] = useState<Map<string, { assetType?: string; name?: string }>>(new Map())
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
  const [_prefsLoadedFromApi, setPrefsLoadedFromApi] = useState(false)
  useEffect(() => {
    if (!userId) return
    setPrefsLoadedFromApi(false)
    loadPreferencesFromApi(userId).then((apiPrefs) => {
      if (apiPrefs) {
        setUiState(apiPrefs)
        console.log('[Preferences] Loaded from API')
      } else {
        // No API prefs yet, check localStorage for migration
        const localData = loadUserData(userId)
        if (localData.ui && localData.ui.theme) {
          // Migrate localStorage preferences to API
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
  const uiStateRef = useRef(uiState)
  useEffect(() => {
    uiStateRef.current = uiState
  }, [uiState])

  useEffect(() => {
    if (!userId) return
    // Debounce preferences save to avoid excessive API calls
    const timer = setTimeout(() => {
      savePreferencesToApi(userId, uiStateRef.current).catch(err =>
        console.warn('[API] Failed to save preferences:', err)
      )
    }, 1000) // 1 second debounce
    return () => clearTimeout(timer)
  }, [userId, uiState])

  // Load call chains from database API when user logs in
  const [_callChainsLoadedFromApi, setCallChainsLoadedFromApi] = useState(false)
  useEffect(() => {
    if (!userId) return
    setCallChainsLoadedFromApi(false)
    loadCallChainsFromApi(userId).then(async (apiCallChains) => {
      // Check localStorage for any call chains that aren't in the API yet (migration)
      const localData = loadUserData(userId)
      const apiCallChainIds = new Set(apiCallChains.map(cc => cc.id))
      const localCallChainsNotInApi = localData.callChains.filter(cc => !apiCallChainIds.has(cc.id))

      if (localCallChainsNotInApi.length > 0) {
        // Migrate localStorage call chains that don't exist in API
        console.log('[Migration] Migrating', localCallChainsNotInApi.length, 'call chains to API...')
        for (const cc of localCallChainsNotInApi) {
          await createCallChainInApi(userId, cc)
        }
        console.log('[Migration] Call chains migrated successfully')
        // Reload from API to get fresh data with server IDs
        const refreshedCallChains = await loadCallChainsFromApi(userId)
        setCallChains(refreshedCallChains)
      } else if (apiCallChains.length > 0) {
        // No migration needed, just use API call chains
        setCallChains(apiCallChains)
      }
      setCallChainsLoadedFromApi(true)
    }).catch((err) => {
      console.warn('[API] Failed to load call chains, using localStorage fallback:', err)
      const localData = loadUserData(userId)
      if (localData.callChains.length > 0) {
        setCallChains(localData.callChains)
      }
      setCallChainsLoadedFromApi(true)
    })
  }, [userId])

  // Track call chain changes and sync to API
  const callChainsRef = useRef(callChains)
  const prevCallChainsRef = useRef<CallChain[]>([])
  useEffect(() => {
    callChainsRef.current = callChains
  }, [callChains])

  // Save call chains to database when they change (debounced)
  useEffect(() => {
    if (!userId) return
    // Debounce call chain saves
    const timer = setTimeout(async () => {
      const current = callChainsRef.current
      const previous = prevCallChainsRef.current

      // Find new call chains (in current but not in previous)
      const previousIds = new Set(previous.map(cc => cc.id))
      const newCallChains = current.filter(cc => !previousIds.has(cc.id))
      for (const cc of newCallChains) {
        await createCallChainInApi(userId, cc)
      }

      // Find updated call chains (in both but different)
      for (const cc of current) {
        const prev = previous.find(p => p.id === cc.id)
        if (prev && (prev.name !== cc.name || JSON.stringify(prev.root) !== JSON.stringify(cc.root) || prev.collapsed !== cc.collapsed)) {
          await updateCallChainInApi(userId, cc)
        }
      }

      // Find deleted call chains (in previous but not in current)
      const currentIds = new Set(current.map(cc => cc.id))
      const deletedCallChains = previous.filter(cc => !currentIds.has(cc.id))
      for (const cc of deletedCallChains) {
        await deleteCallChainInApi(userId, cc.id)
      }

      prevCallChainsRef.current = [...current]
    }, 1000) // 1 second debounce
    return () => clearTimeout(timer)
  }, [userId, callChains])

  // Manual refresh function for allNexusBots (called after Atlas slot changes)
  const refreshAllNexusBots = useCallback(async () => {
    if (!userId) return
    try {
      const apiBots = await fetchNexusBotsFromApi()
      // Merge user's local Nexus bots with API bots (deduplicated)
      const localNexusBots = savedBots.filter((bot) => bot.tags?.includes('Nexus'))
      const localBotIds = new Set(localNexusBots.map((b) => b.id))
      const apiBotsMerged = apiBots.filter((ab) => !localBotIds.has(ab.id))
      const merged = [...localNexusBots, ...apiBotsMerged]
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
            const map = new Map<string, { assetType?: string; name?: string }>()
            for (const t of data.tickers) {
              if (t.ticker) {
                map.set(t.ticker.toUpperCase(), { assetType: t.assetType, name: t.name })
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
  const [databasesTab, setDatabasesTab] = useState<DatabasesSubtab>('Users')

  // Eligibility requirements (fetched for Admin tab and Partner Program page)
  const [appEligibilityRequirements, setAppEligibilityRequirements] = useState<EligibilityRequirement[]>([])
  const [saveMenuOpen, setSaveMenuOpen] = useState(false)
  const [saveNewWatchlistName, setSaveNewWatchlistName] = useState('')
  const [justSavedFeedback, setJustSavedFeedback] = useState(false)
  const [addToWatchlistBotId, setAddToWatchlistBotId] = useState<string | null>(null)
  const [addToWatchlistNewName, setAddToWatchlistNewName] = useState('')
  const [callbackNodesCollapsed, setCallbackNodesCollapsed] = useState(true)
  const [customIndicatorsCollapsed, setCustomIndicatorsCollapsed] = useState(true)
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
      const prepared = normalizeNodeForBacktest(ensureSlots(cloneNode(node)))
      const inputs = collectBacktestInputs(prepared, callChainsById)
      if (inputs.errors.length > 0) {
        throw makeValidationError(inputs.errors)
      }
      if (inputs.tickers.length === 0) {
        throw makeValidationError([{ nodeId: prepared.id, field: 'tickers', message: 'No tickers found in this strategy.' }])
      }

      const decisionPrice: EvalCtx['decisionPrice'] = backtestMode === 'CC' || backtestMode === 'CO' ? 'close' : 'open'
      const limit = 20000
      const benchTicker = normalizeChoice(backtestBenchmark)
      const needsBench = benchTicker && benchTicker !== 'Empty' && !inputs.tickers.includes(benchTicker)
      const benchPromise = needsBench ? fetchOhlcSeries(benchTicker, limit) : null

      // Always fetch SPY for Treynor Ratio calculation (fixed benchmark)
      const needsSpy = !inputs.tickers.includes('SPY') && benchTicker !== 'SPY'
      const spyPromise = needsSpy ? fetchOhlcSeries('SPY', limit) : null

      const loaded = await Promise.all(inputs.tickers.map(async (t) => ({ ticker: t, bars: await fetchOhlcSeries(t, limit) })))
      const benchSettled = benchPromise ? await Promise.allSettled([benchPromise]) : []
      const spySettled = spyPromise ? await Promise.allSettled([spyPromise]) : []

      // Collect indicator tickers (for date intersection) vs position tickers (can start later)
      const indicatorTickers = collectIndicatorTickers(prepared, callChainsById)
      const positionTickers = collectPositionTickers(prepared, callChainsById)

      // Build price DB using only indicator tickers for date intersection
      // This allows position tickers with shorter history (like UVXY) to not limit the date range
      const db = buildPriceDb(loaded, indicatorTickers.length > 0 ? indicatorTickers : undefined)
      if (db.dates.length < 3) {
        throw makeValidationError([{ nodeId: prepared.id, field: 'data', message: 'Not enough overlapping price data to run a backtest.' }])
      }

      const cache = emptyCache()
      const warnings: BacktestWarning[] = []
      const trace = createBacktestTraceCollector()

      let benchBars: Array<{ time: UTCTimestamp; open: number; close: number; adjClose: number }> | null = null
      if (benchTicker && benchTicker !== 'Empty') {
        const already = loaded.find((x) => getSeriesKey(x.ticker) === benchTicker)
        if (already) {
          benchBars = already.bars
        } else if (benchSettled.length && benchSettled[0].status === 'fulfilled') {
          benchBars = benchSettled[0].value
        } else if (benchSettled.length && benchSettled[0].status === 'rejected') {
          warnings.push({
            time: db.dates[0],
            date: isoFromUtcSeconds(db.dates[0]),
            message: `Benchmark ${benchTicker} failed to load: ${String(benchSettled[0].reason?.message || benchSettled[0].reason)}`,
          })
          benchBars = null
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
        if (alreadySpy) {
          spyBars = alreadySpy.bars
        } else if (spySettled.length && spySettled[0].status === 'fulfilled') {
          spyBars = spySettled[0].value
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
        allocationsAt[i] = evaluateNode(ctx, prepared)
        contributionsAt[i] = tracePositionContributions(ctx, prepared)
      }

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

      const metrics = computeBacktestSummary(points, days.map((d) => d.drawdown), days, spyBenchmarkPoints.length > 0 ? spyBenchmarkPoints : undefined)
      const monthly = computeMonthlyReturns(days)

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
      push(ensureSlots(payload))
      setTab('Model')
    } catch (e) {
      console.error('Open failed:', e)
      alert('Failed to open bot: ' + String((e as Error)?.message || e))
    }
  }, [userId])

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
    [current, activeBotId, activeSavedBotId, resolveWatchlistId, addBotToWatchlist, userId, savedBots, backtestMode, backtestCostBps, computeEtfsOnlyTag],
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
          const { metrics, equityCurve, benchmarkCurve, allocations: serverAllocations, cached: wasCached } = await res.json() as {
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
          }

          if (wasCached) {
            console.log(`[Backtest] Cache hit for ${bot.name}`)
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

          // Auto eligibility tagging (only for regular users, not admin)
          if (userId && !isAdmin && result?.metrics) {
          console.log('[Eligibility] Checking bot:', bot.name, 'userId:', userId)
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
        const MAX_OTHER_SIZE = 1 * 1024 * 1024 // 1MB for Atlas/QuantMage
        const maxSize = format === 'composer' ? MAX_COMPOSER_SIZE : MAX_OTHER_SIZE
        const maxSizeLabel = format === 'composer' ? '20MB' : '1MB'

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
    // Load role from stored user object
    try {
      const userJson = localStorage.getItem('user')
      if (userJson) {
        const user = JSON.parse(userJson)
        setUserRole(user.role || null)
      }
    } catch {
      // ignore
    }
    const data = loadUserData(nextUser)
    setUserId(nextUser)
    // Bots, watchlists, call chains, and preferences will be loaded from database API via useEffects when userId changes
    // Set defaults here, the useEffects will replace with API data
    setSavedBots(data.savedBots) // Initial from localStorage, then replaced by API
    setWatchlists(ensureDefaultWatchlist([])) // Empty default, will be loaded from API
    setCallChains([]) // Empty default, will be loaded from API
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
    setSavedBots([])
    setWatchlists([])
    setCallChains([])
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
      <header className="flex items-center justify-between px-4 py-3.5 border-b border-border bg-surface shrink-0 z-10">
        <div>
          <div className="text-xs tracking-widest uppercase text-muted mb-1">System</div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="m-0 text-2xl font-extrabold tracking-tight mr-1">Atlas Engine</h1>
            <div className="flex items-center gap-1.5">
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
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            {(['Dashboard', 'Nexus', 'Analyze', 'Model', 'Help/Support', ...(isAdmin ? ['Admin'] : []), ...(hasEngineerAccess ? ['Databases'] : [])] as ('Dashboard' | 'Nexus' | 'Analyze' | 'Model' | 'Help/Support' | 'Admin' | 'Databases')[]).map((t) => (
              <Button
                key={t}
                variant={tab === t ? 'accent' : 'secondary'}
                onClick={() => setTab(t)}
              >
                {t}
              </Button>
            ))}
          </div>
          {tab === 'Model' && (
            <div className="flex gap-2 mt-3">
              <Button onClick={handleNewBot}>New System</Button>
              <div className="relative inline-block">
                <Button
                  onClick={() => setSaveMenuOpen((v) => !v)}
                  title="Save this system to a watchlist"
                  variant={justSavedFeedback ? 'accent' : 'default'}
                  className={justSavedFeedback ? 'transition-colors duration-300' : ''}
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
              <Button onClick={() => setTab('Analyze')}>Open</Button>
              <Button onClick={handleImport} disabled={isImporting}>
                {isImporting ? 'Importing...' : 'Import'}
              </Button>
              <Button onClick={handleExport}>Export</Button>
            </div>
          )}
          {tab === 'Model' && (
            <div className="flex gap-2 mt-3">
              {bots.map((b) => {
                const root = b.history[b.historyIndex] ?? b.history[0]
                const label = root?.title || 'Untitled'
                return (
                  <div
                    key={b.id}
                    className={cn(
                      'flex items-center gap-1 border rounded-lg p-1 pr-1.5',
                      b.id === activeBotId
                        ? 'bg-accent-bg border-accent-border text-accent-text'
                        : 'bg-surface border-border'
                    )}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setActiveBotId(b.id)}
                    >
                      {label}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-danger px-1 h-auto"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleCloseBot(b.id)
                      }}
                    >
                      ✕
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
          {/* Find/Replace Ticker Panel - Model tab only */}
          {tab === 'Model' && (
            <div className="flex items-center gap-2 mt-3 px-3 py-2 bg-surface border border-border rounded-lg">
              {/* Datalist for used tickers autocomplete */}
              <datalist id={USED_TICKERS_DATALIST_ID}>
                {collectUsedTickers(current, includeCallChains ? callChains : undefined).map(t => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted">From</span>
                <Input
                  list={USED_TICKERS_DATALIST_ID}
                  className="h-7 w-24 text-xs"
                  placeholder="Ticker"
                  value={findTicker}
                  onChange={(e) => {
                    const val = e.target.value.toUpperCase()
                    setFindTicker(val)
                    // Auto-search on change
                    let instances = findTickerInstances(current, val, includePositions, includeIndicators)
                    // Include call chains if enabled
                    if (includeCallChains && callChains.length > 0) {
                      callChains.forEach(chain => {
                        try {
                          const chainRoot = typeof chain.root === 'string' ? JSON.parse(chain.root) : chain.root
                          const chainInstances = findTickerInstances(chainRoot, val, includePositions, includeIndicators, chain.id)
                          instances = [...instances, ...chainInstances]
                        } catch { /* ignore parse errors */ }
                      })
                    }
                    setFoundInstances(instances)
                    setCurrentInstanceIndex(instances.length > 0 ? 0 : -1)
                    setHighlightedInstance(instances.length > 0 ? instances[0] : null)
                  }}
                />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted">To</span>
                <Input
                  className="h-7 w-24 text-xs"
                  placeholder="Ticker"
                  value={replaceTicker}
                  onChange={(e) => setReplaceTicker(e.target.value.toUpperCase())}
                />
              </div>
              <label className="flex items-center gap-1 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={includePositions}
                  onChange={(e) => {
                    setIncludePositions(e.target.checked)
                    // Re-search with new settings
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
                    // Re-search with new settings
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
                    // Re-search with new settings
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
              {findTicker && (
                <span className="text-xs text-muted ml-2">
                  {foundInstances.length} found
                  {currentInstanceIndex >= 0 && foundInstances.length > 0 && ` (${currentInstanceIndex + 1}/${foundInstances.length})`}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={foundInstances.length === 0}
                onClick={() => {
                  const newIdx = (currentInstanceIndex - 1 + foundInstances.length) % foundInstances.length
                  setCurrentInstanceIndex(newIdx)
                  const instance = foundInstances[newIdx]
                  setHighlightedInstance(instance)
                  // Scroll to node
                  const nodeEl = document.querySelector(`[data-node-id="${instance.nodeId}"]`)
                  if (nodeEl) {
                    nodeEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  }
                }}
              >
                ◀ Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={foundInstances.length === 0}
                onClick={() => {
                  const newIdx = (currentInstanceIndex + 1) % foundInstances.length
                  setCurrentInstanceIndex(newIdx)
                  const instance = foundInstances[newIdx]
                  setHighlightedInstance(instance)
                  // Scroll to node
                  const nodeEl = document.querySelector(`[data-node-id="${instance.nodeId}"]`)
                  if (nodeEl) {
                    nodeEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  }
                }}
              >
                Next ▶
              </Button>
              <Button
                variant="default"
                size="sm"
                disabled={!findTicker || !replaceTicker || foundInstances.length === 0}
                onClick={() => {
                  // Replace in main tree
                  const nextRoot = replaceTickerInTree(current, findTicker, replaceTicker, includePositions, includeIndicators)
                  push(nextRoot)
                  // Replace in call chains if enabled
                  if (includeCallChains && callChains.length > 0) {
                    callChains.forEach(chain => {
                      try {
                        const chainRoot = typeof chain.root === 'string' ? JSON.parse(chain.root) : chain.root
                        const updatedRoot = replaceTickerInTree(chainRoot, findTicker, replaceTicker, includePositions, includeIndicators)
                        // Update call chain via API
                        fetch(`/api/call-chains/${chain.id}`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ root: JSON.stringify(updatedRoot) })
                        }).then(() => loadCallChainsFromApi(userId).then(setCallChains))
                      } catch { /* ignore parse errors */ }
                    })
                  }
                  // Clear state
                  setFindTicker('')
                  setReplaceTicker('')
                  setFoundInstances([])
                  setCurrentInstanceIndex(-1)
                  setHighlightedInstance(null)
                }}
              >
                Replace
              </Button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex gap-2">
            <Button onClick={undo} disabled={!activeBot || activeBot.historyIndex === 0}>
              Undo
            </Button>
            <Button
              onClick={redo}
              disabled={!activeBot || activeBot.historyIndex === activeBot.history.length - 1}
            >
              Redo
            </Button>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="text-xs text-muted">
              Logged in as <span className="font-extrabold">{userId}</span>
            </div>
            <Button variant="default" size="sm" onClick={handleLogout}>
              Logout
            </Button>
          </div>
        </div>
      </header>
      {tickerApiError && (
        <Alert variant="destructive" className="rounded-none border-x-0">
          <AlertDescription>{tickerApiError}</AlertDescription>
        </Alert>
      )}
      <TickerDatalist id={TICKER_DATALIST_ID} options={tickerOptions} />
      <main className="flex-1 overflow-hidden min-h-0">
        {tab === 'Model' ? (
          <Card className="h-full flex flex-col overflow-hidden m-4">
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
                />
              </div>

              {/* Bottom Row - 2 Zones Side by Side */}
              <div className="flex gap-4 flex-1">
                {/* Bottom Left Zone - Sticky Labels + Content */}
                <div className={`flex items-start transition-all ${callbackNodesCollapsed && customIndicatorsCollapsed ? 'w-auto' : 'w-1/2'}`}>
                  {/* Left Side - Labels and Buttons (sticky, fills visible height, split 50/50) */}
                  <div className="flex flex-col w-auto border border-border rounded-l-lg bg-card sticky top-4 z-10" style={{ height: 'calc(100vh - 240px)' }}>
                    {/* Callback Nodes Label/Button Zone - takes 50% */}
                    <div className="flex-1 flex flex-col items-center justify-center border-b border-border">
                      <button
                        onClick={() => setCallbackNodesCollapsed(!callbackNodesCollapsed)}
                        className="px-2 py-2 hover:bg-accent/10 transition-colors rounded"
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
                        className="px-2 py-2 hover:bg-accent/10 transition-colors rounded"
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
                    className="flex-1 grid overflow-hidden border border-l-0 border-border rounded-r-lg bg-card sticky top-4 z-10"
                    style={{
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
                            <Button variant="ghost" size="sm" onClick={() => handleToggleCallChainCollapse(c.id)}>
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

                {/* Bottom Right Zone - Flow Tree Builder with Sticky Scrollbar */}
                <div className={`flex flex-col border border-border rounded-lg bg-card transition-all ${callbackNodesCollapsed && customIndicatorsCollapsed ? 'flex-1' : 'w-1/2'}`}>
                  {/* ETFs Only Toggle - near ticker dropdown */}
                  <div className="flex items-center gap-3 px-4 pt-3 pb-2 border-b border-border shrink-0">
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
                  <FlowchartScrollWrapper className="flex-1 p-4">
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
                  </FlowchartScrollWrapper>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : tab === 'Help/Support' ? (
          <Card className="h-full flex flex-col overflow-hidden m-4">
            <CardContent className="p-6 flex flex-col h-full overflow-auto">
              <div className="max-w-3xl mx-auto w-full">
                <h2 className="text-xl font-bold mb-4">Help & Support</h2>

                <div className="mb-8 p-4 border border-border rounded-lg">
                  <h3 className="font-bold mb-2">Contact</h3>
                  <p className="text-muted text-sm">Message me on Discord</p>
                </div>

                <div className="space-y-6">
                  <h3 className="text-lg font-bold border-b border-border pb-2">Changelog</h3>

                  <div className="space-y-4">
                    <div>
                      <h4 className="font-bold text-sm text-muted mb-2">[Unreleased]</h4>
                      <div className="pl-4 space-y-3">
                        <div>
                          <div className="font-semibold text-sm text-green-600 dark:text-green-400">Added</div>
                          <ul className="list-disc list-inside text-sm text-muted ml-2 space-y-0.5">
                            <li>Role hierarchy system: main_admin, sub_admin, engineer, user, partner</li>
                            <li>Engineers can now access the Databases tab</li>
                            <li>Role management dropdown in User Management (main admins can change roles)</li>
                            <li>Main admin protection - role cannot be changed by anyone</li>
                            <li>Model tab Benchmark Comparison now includes K-Fold row and all 10 benchmarks</li>
                            <li>Model tab Robustness now has full 4-column layout with distribution charts</li>
                            <li>Added DBC, DBO, GBTC to Model tab benchmarks</li>
                            <li>Added MaxDD-95, Calmar-95, Treynor columns to Model tab</li>
                            <li>Tickers tab in Databases panel to view ticker registry</li>
                            <li>Batch size and pause settings for yFinance/Tiingo downloads</li>
                          </ul>
                        </div>
                        <div>
                          <div className="font-semibold text-sm text-blue-600 dark:text-blue-400">Changed</div>
                          <ul className="list-disc list-inside text-sm text-muted ml-2 space-y-0.5">
                            <li>TradingView charts now match app theme (dark/light mode)</li>
                            <li>Monthly Returns heatmap now respects dark/light theme</li>
                            <li>Time period selector now respects dark/light theme</li>
                            <li>Hidden TradingView watermark from all charts</li>
                            <li>yFinance/Tiingo download buttons always enabled</li>
                            <li>User Management now shows color-coded role badges</li>
                          </ul>
                        </div>
                        <div>
                          <div className="font-semibold text-sm text-amber-600 dark:text-amber-400">Fixed</div>
                          <ul className="list-disc list-inside text-sm text-muted ml-2 space-y-0.5">
                            <li>Save to Watchlist button now shows visual feedback</li>
                            <li>Analyze tab benchmarks now load correctly (on-demand ticker loading)</li>
                            <li>Beta and Treynor values now calculate properly</li>
                            <li>Benchmark cache invalidation now includes benchmark_metrics_cache</li>
                          </ul>
                        </div>
                      </div>
                    </div>

                    <div>
                      <h4 className="font-bold text-sm text-muted mb-2">[1.0.0] - 2025-12-30</h4>
                      <div className="pl-4">
                        <div className="font-semibold text-sm text-green-600 dark:text-green-400">Initial Release</div>
                        <ul className="list-disc list-inside text-sm text-muted ml-2 space-y-0.5">
                          <li>Visual flowchart-based trading algorithm builder</li>
                          <li>Multiple node types: Basic, Function, Indicator, Position, Call</li>
                          <li>Backtesting with equity curves and performance metrics</li>
                          <li>Benchmark comparisons (SPY, QQQ, VTI, etc.)</li>
                          <li>Robustness analysis with bootstrap simulations</li>
                          <li>User authentication and preferences</li>
                          <li>Watchlists for organizing trading systems</li>
                          <li>Admin panel for ticker data management</li>
                          <li>Dark/Light theme support with multiple color schemes</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
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
              <div className="mt-3 grid grid-cols-3 gap-3">
                <Card className="grid place-items-center min-h-[220px] font-black">
                  Placeholder Text: Invested Systems
                </Card>
                <Card className="grid place-items-center min-h-[220px] font-black">
                  Placeholder Text: Community suggestions based on filters (Beta, Correlation, Volatility weighting)
                </Card>
                <Card className="grid place-items-center min-h-[220px] font-black">
                  Combined portfolio and allocations based on suggestions
                </Card>
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
                          <Badge variant="default">Builder: {b.builderId}</Badge>
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
                  const tags = ['Nexus', `Builder: ${bot.builderId}`, ...tagNames]
                  // Use frontend-cached metrics if available, otherwise fall back to API-provided backtestResult
                  const metrics = analyzeBacktests[bot.id]?.result?.metrics ?? bot.backtestResult
                  // Display anonymized name: "X's Fund #Y" instead of actual bot name
                  // Use fundSlot from bot, or look up from fundZones as fallback
                  const fundSlot = bot.fundSlot ?? getFundSlotForBot(bot.id)
                  const displayName = fundSlot
                    ? `${bot.builderId}'s Fund #${fundSlot}`
                    : `${bot.builderId}'s Fund`
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

              // Get unique builder IDs for autocomplete
              const allBuilderIds = [...new Set(communityBotRows.map((r) => {
                const builderTag = r.tags.find((t) => t.startsWith('Builder: '))
                return builderTag?.replace('Builder: ', '') ?? ''
              }).filter(Boolean))]

              // Search results - filter by multiple criteria (AND logic)
              // Includes: all Nexus bots + current user's private bots
              const searchedBots = (() => {
                // Check if any filter has a value
                const activeFilters = communitySearchFilters.filter(f => f.value.trim())
                if (activeFilters.length === 0) return []

                // Get current user's private bots (non-Nexus)
                const nexusBotIds = new Set(allNexusBots.map(b => b.id))
                const myPrivateBotRows: CommunityBotRow[] = savedBots
                  .filter(bot => bot.builderId === userId && !nexusBotIds.has(bot.id))
                  .map((bot) => {
                    const tagNames = (watchlistsByBotId.get(bot.id) ?? []).map((w) => w.name)
                    const tags = ['Private', `Builder: ${bot.builderId}`, ...tagNames]
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
                      const builderTag = r.tags.find((t) => t.startsWith('Builder: '))
                      const builderId = builderTag?.replace('Builder: ', '').toLowerCase() ?? ''
                      return builderId.includes(searchVal) || r.name.toLowerCase().includes(searchVal)
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
                      const displayName = b.tags?.includes('Nexus') && fundSlot
                        ? `${b.builderId}'s Fund #${fundSlot}`
                        : b.tags?.includes('Nexus')
                          ? `${b.builderId}'s Fund`
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
                            <Badge variant="default">Builder: {b.builderId}</Badge>
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
                          const displayName = b?.tags?.includes('Nexus') && b?.builderId !== userId && fundSlot
                            ? `${b.builderId}'s Fund #${fundSlot}`
                            : b?.tags?.includes('Nexus') && b?.builderId !== userId
                              ? `${b.builderId}'s Fund`
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
                                {b?.builderId && <Badge variant="default">Builder: {b.builderId}</Badge>}
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
                                <Badge variant="default">Builder: {b.builderId}</Badge>
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
    </div>
  )
}

export default App
