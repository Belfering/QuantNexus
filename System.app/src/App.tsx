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
import './App.css'
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  createChart,
  createSeriesMarkers,
  type AutoscaleInfo,
  type BusinessDay,
  type CandlestickData,
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

type BlockKind = 'basic' | 'function' | 'indicator' | 'numbered' | 'position' | 'call'
type SlotId = 'next' | 'then' | 'else'
type PositionChoice = string
type MetricChoice =
  | 'Current Price'
  | 'Simple Moving Average'
  | 'Exponential Moving Average'
  | 'Relative Strength Index'
  | 'Max Drawdown'
  | 'Standard Deviation'
type RankChoice = 'Bottom' | 'Top'
type ComparatorChoice = 'lt' | 'gt'

type WeightMode = 'equal' | 'defined' | 'inverse' | 'pro' | 'capped'

type UserId = '1' | '9'
type ThemeMode = 'light' | 'dark'

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
    children: { ...node.children },
  }
  for (const slot of SLOT_ORDER[node.kind]) {
    const arr = node.children[slot] ?? [null]
    next.children[slot] = arr.map((c) => (c ? normalizeNodeForBacktest(c) : c))
  }
  return next
}

type NumberedQuantifier = 'all' | 'none' | 'exactly' | 'atLeast' | 'atMost'

type NumberedItem = {
  id: string
  conditions: ConditionLine[]
}

const TICKER_DATALIST_ID = 'systemapp-tickers'

const CURRENT_USER_KEY = 'systemapp.currentUser'
const userDataKey = (userId: UserId) => `systemapp.user.${userId}.data.v1`
const LEGACY_THEME_KEY = 'systemapp.theme'

const loadDeviceThemeMode = (): ThemeMode => {
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

const loadInitialThemeMode = (): ThemeMode => {
  try {
    const raw = localStorage.getItem(LEGACY_THEME_KEY)
    if (raw === 'light' || raw === 'dark') return raw
  } catch {
    // ignore
  }
  return loadDeviceThemeMode()
}

const newKeyId = () => `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const defaultUiState = (): UserUiState => ({
  theme: loadInitialThemeMode(),
  analyzeCollapsedByBotId: {},
  analyzeFilterWatchlistId: null,
  communitySelectedWatchlistId: null,
  communityWatchlistSlot1Id: null,
  communityWatchlistSlot2Id: null,
})

const ensureDefaultWatchlist = (watchlists: Watchlist[]): Watchlist[] => {
  const hasDefault = watchlists.some((w) => w.name === 'Default')
  if (hasDefault) return watchlists
  return [{ id: `wl-${newKeyId()}`, name: 'Default', botIds: [] }, ...watchlists]
}

const loadUserData = (userId: UserId): UserData => {
  try {
    const raw = localStorage.getItem(userDataKey(userId))
    if (!raw) {
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
          const ensured = ensureSlots(rawPayload)
          const payload = hasLegacyIdsOrDuplicates(ensured) ? ensureSlots(regenerateIds(ensured)) : ensured
          return {
            id: String(b.id || ''),
            name: String(b.name || 'Untitled'),
            builderId: (b.builderId === '1' || b.builderId === '9' ? b.builderId : userId) as UserId,
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
          const ensured = ensureSlots(rawRoot)
          const root = hasLegacyIdsOrDuplicates(ensured) ? ensureSlots(regenerateIds(ensured)) : ensured
          return {
            id: String(c.id || `call-${newKeyId()}`),
            name: String(c.name || 'Call'),
            root,
            collapsed: Boolean(c.collapsed ?? false),
          }
        }) as CallChain[])
      : []
    const ui = parsed.ui ? ({ ...defaultUiState(), ...(parsed.ui as Partial<UserUiState>) } as UserUiState) : defaultUiState()
    return { savedBots, watchlists, callChains, ui }
  } catch {
    return { savedBots: [], watchlists: ensureDefaultWatchlist([]), callChains: [], ui: defaultUiState() }
  }
}

const saveUserData = (userId: UserId, data: UserData) => {
  localStorage.setItem(userDataKey(userId), JSON.stringify(data))
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

function TickerDatalist({ id, options }: { id: string; options: string[] }) {
  return (
    <datalist id={id}>
      {options.map((t) => (
        <option key={t} value={t} />
      ))}
    </datalist>
  )
}

function LoginScreen({ onLogin }: { onLogin: (userId: UserId) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    const u = String(username || '').trim()
    const p = String(password || '')
    const ok = (u === '1' && p === '1') || (u === '9' && p === '9')
    if (!ok) {
      setError('Invalid username/password.')
      return
    }
    setError(null)
    onLogin(u as UserId)
  }

  return (
    <div style={{ padding: 24 }}>
      <div
        style={{
          maxWidth: 420,
          margin: '64px auto',
          border: '1px solid var(--border-soft)',
          borderRadius: 14,
          padding: 18,
          background: 'var(--surface)',
          boxShadow: '0 12px 28px rgba(15, 23, 42, 0.12)',
        }}
      >
        <div className="eyebrow">Admin Login</div>
        <h1 style={{ margin: '6px 0 14px' }}>System.app</h1>
        <div style={{ display: 'grid', gap: 10 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontWeight: 700, fontSize: 12 }}>Username</div>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontWeight: 700, fontSize: 12 }}>Password</div>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
          </label>
          {error ? <div style={{ color: 'var(--danger)', fontWeight: 700 }}>{error}</div> : null}
          <button onClick={submit}>Login</button>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Valid accounts: 1/1 and 9/9.</div>
        </div>
      </div>
    </div>
  )
}

type BotSession = {
  id: string
  history: FlowNode[]
  historyIndex: number
  savedBotId?: string
}

type AdminStatus = {
  root: string
  tickersPath: string
  parquetDir: string
  tickersExists: boolean
  parquetDirExists: boolean
}

type AdminCandlesResponse = {
  ticker: string
  candles: Array<{ time: number; open: number; high: number; low: number; close: number }>
  preview: Array<{ Date: string; Open: number; High: number; Low: number; Close: number }>
}

type AdminDownloadJob = {
  id: string
  status: 'running' | 'done' | 'error'
  startedAt: number
  finishedAt: number | null
  error: string | null
  config?: { batchSize: number; sleepSeconds: number; maxRetries: number; threads: boolean; limit: number }
  events?: Array<Record<string, unknown>>
  logs?: string[]
}

type BotVisibility = 'private' | 'community'

type SavedBot = {
  id: string
  name: string
  builderId: UserId
  payload: FlowNode
  visibility: BotVisibility
  createdAt: number
}

type Watchlist = {
  id: string
  name: string
  botIds: string[]
}

type PortfolioBotRow = {
  id: string
  name: string
  allocation: number
  capital: number
  pnl: number
  tags: string[]
  readonly?: boolean
}

type PortfolioSnapshot = {
  accountValue: number
  cash: number
  totalPnl: number
  totalPnlPct: number
  todaysChange: number
  todaysChangePct: number
  positions: Array<{
    ticker: string
    value: number
    costBasis: number
    todaysChange: number
    allocation: number
    pnl: number
    pnlPct: number
  }>
  bots: PortfolioBotRow[]
}

type UserUiState = {
  theme: ThemeMode
  analyzeCollapsedByBotId: Record<string, boolean>
  analyzeFilterWatchlistId: string | null
  communitySelectedWatchlistId: string | null
  communityWatchlistSlot1Id: string | null
  communityWatchlistSlot2Id: string | null
}

type UserData = {
  savedBots: SavedBot[]
  watchlists: Watchlist[]
  callChains: CallChain[]
  ui: UserUiState
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
}

const SLOT_ORDER: Record<BlockKind, SlotId[]> = {
  basic: ['next'],
  function: ['next'],
  indicator: ['then', 'else', 'next'],
  numbered: ['then', 'else', 'next'],
  position: [],
  call: [],
}

const newId = (() => {
  let counter = 1
  return () => {
    const rand = Math.random().toString(36).slice(2, 8)
    const id = `node-${Date.now()}-${counter}-${rand}`
    counter += 1
    return id
  }
})()

const createNode = (kind: BlockKind): FlowNode => {
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
                : 'Basic',
    children: {},
    weighting: 'equal',
    weightingThen: kind === 'indicator' || kind === 'numbered' ? 'equal' : undefined,
    weightingElse: kind === 'indicator' || kind === 'numbered' ? 'equal' : undefined,
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
  return { ...node, children }
}

const hasLegacyIdsOrDuplicates = (node: FlowNode): boolean => {
  const seen = new Set<string>()
  let legacy = false
  const walk = (n: FlowNode) => {
    if (/^node-\d+$/.test(n.id) || seen.has(n.id)) legacy = true
    seen.add(n.id)
    SLOT_ORDER[n.kind].forEach((slot) => {
      n.children[slot]?.forEach((c) => {
        if (c) walk(c)
      })
    })
  }
  walk(node)
  return legacy
}

const regenerateIds = (node: FlowNode): FlowNode => {
  const nextId = newId()
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  SLOT_ORDER[node.kind].forEach((slot) => {
    const arr = node.children[slot]
    children[slot] = arr ? arr.map((c) => (c ? regenerateIds(c) : null)) : [null]
  })
  return {
    ...node,
    id: nextId,
    children,
  }
}

function AdminTickerList({
  status,
  tickers,
  tickersText,
  onTickersTextChange,
  error,
  onSaveTickers,
  saveDisabled,
  saveStatus,
  downloadConfig,
  onChangeDownloadConfig,
  onDownload,
  downloadDisabled,
  downloadStatus,
}: {
  status: AdminStatus | null
  tickers: string[]
  tickersText: string
  onTickersTextChange: (next: string) => void
  error: string | null
  onSaveTickers: () => void
  saveDisabled: boolean
  saveStatus: string | null
  downloadConfig: { batchSize: number; sleepSeconds: number; maxRetries: number; threads: boolean; limit: number }
  onChangeDownloadConfig: (
    next: Partial<{ batchSize: number; sleepSeconds: number; maxRetries: number; threads: boolean; limit: number }>,
  ) => void
  onDownload: () => void
  downloadDisabled: boolean
  downloadStatus: string | null
}) {
  return (
    <div>
      <div style={{ display: 'grid', gap: 6 }}>
        <div>
          <strong>Ticker data root:</strong> {status?.root || '...'}
        </div>
        <div>
          <strong>tickers.txt:</strong> {status?.tickersPath || '...'} {status ? (status.tickersExists ? '✓' : '✗') : ''}
        </div>
        <div>
          <strong>Parquet dir:</strong> {status?.parquetDir || '...'} {status ? (status.parquetDirExists ? '✓' : '✗') : ''}
        </div>
      </div>

      {error && <div style={{ marginTop: 10, color: '#b91c1c', fontWeight: 700 }}>{error}</div>}

      <div style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 800 }}>Tickers ({tickers.length})</div>

        <div style={{ marginTop: 8 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Edit tickers.txt</div>
          <textarea
            value={tickersText}
            onChange={(e) => onTickersTextChange(e.target.value)}
            rows={10}
            spellCheck={false}
            style={{
              width: '100%',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              padding: 10,
              borderRadius: 12,
              border: '1px solid #cbd5e1',
            }}
          />
          <div style={{ marginTop: 8, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={onSaveTickers} disabled={saveDisabled}>
              Save tickers.txt
            </button>
            {saveStatus ? <div style={{ color: '#4b5563' }}>{saveStatus}</div> : null}
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Download settings</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontWeight: 700 }}>Batch size</span>
              <input
                type="number"
                min={1}
                max={500}
                value={downloadConfig.batchSize}
                onChange={(e) => onChangeDownloadConfig({ batchSize: Number(e.target.value) })}
              />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontWeight: 700 }}>Sleep seconds</span>
              <input
                type="number"
                min={0}
                max={60}
                step={0.5}
                value={downloadConfig.sleepSeconds}
                onChange={(e) => onChangeDownloadConfig({ sleepSeconds: Number(e.target.value) })}
              />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontWeight: 700 }}>Max retries</span>
              <input
                type="number"
                min={0}
                max={10}
                value={downloadConfig.maxRetries}
                onChange={(e) => onChangeDownloadConfig({ maxRetries: Number(e.target.value) })}
              />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontWeight: 700 }}>Limit tickers (0 = no limit)</span>
              <input
                type="number"
                min={0}
                max={100000}
                value={downloadConfig.limit}
                onChange={(e) => onChangeDownloadConfig({ limit: Number(e.target.value) })}
              />
            </label>
            <label style={{ display: 'flex', gap: 10, alignItems: 'center', paddingTop: 26 }}>
              <input
                type="checkbox"
                checked={downloadConfig.threads}
                onChange={(e) => onChangeDownloadConfig({ threads: e.target.checked })}
              />
              <span style={{ fontWeight: 700 }}>Threads inside batch</span>
            </label>
          </div>
        </div>

        <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={onDownload} disabled={downloadDisabled}>
            Download
          </button>
          {downloadStatus ? <div style={{ color: '#4b5563' }}>{downloadStatus}</div> : null}
        </div>

        <pre
          style={{
            marginTop: 10,
            maxHeight: 340,
            overflow: 'auto',
            padding: 10,
            borderRadius: 12,
            border: '1px solid #cbd5e1',
            background: '#fff',
          }}
        >
          {tickers.join('\n') || 'No tickers found.'}
        </pre>
      </div>
    </div>
  )
}

function CandlesChart({ candles }: { candles: CandlestickData[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)

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

    const chart = createChart(el, {
      width: Math.floor(innerWidth()),
      height: 420,
      layout: { background: { type: ColorType.Solid, color: '#ffffff' }, textColor: '#0f172a' },
      grid: { vertLines: { color: '#eef2f7' }, horzLines: { color: '#eef2f7' } },
      rightPriceScale: { borderColor: '#cbd5e1' },
      timeScale: { borderColor: '#cbd5e1' },
    })
    const series = chart.addSeries(CandlestickSeries)
    chartRef.current = chart
    seriesRef.current = series

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: Math.floor(innerWidth()) })
    })
    ro.observe(el)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!seriesRef.current) return
    seriesRef.current.setData(candles)
    chartRef.current?.timeScale().fitContent()
  }, [candles])

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: 420,
        borderRadius: 14,
        border: '1px solid #cbd5e1',
        overflow: 'hidden',
      }}
    />
  )
}

type EquityPoint = LineData<UTCTimestamp>
type EquityMarker = { time: UTCTimestamp; text: string }

type VisibleRange = IRange<UTCTimestamp>

const EMPTY_EQUITY_POINTS: EquityPoint[] = []

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

const nextCommunitySort = (prev: CommunitySort, key: CommunitySortKey): CommunitySort => {
  if (prev.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
  const dir: SortDir = key === 'name' || key === 'tags' ? 'asc' : 'desc'
  return { key, dir }
}

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
}: {
  points: EquityPoint[]
  benchmarkPoints?: EquityPoint[]
  markers: EquityMarker[]
  visibleRange?: VisibleRange
  onVisibleRangeChange?: (range: VisibleRange) => void
  logScale?: boolean
  showCursorStats?: boolean
  heightPx?: number
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const benchRef = useRef<ISeriesApi<'Line'> | null>(null)
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const baseLineRef = useRef<IPriceLine | null>(null)
  const baseEquityRef = useRef<number>(1)
  const pointsRef = useRef<EquityPoint[]>([])
  const visibleRangeRef = useRef<VisibleRange | undefined>(visibleRange)
  const onVisibleRangeChangeRef = useRef<((range: VisibleRange) => void) | undefined>(onVisibleRangeChange)
  const lastEmittedRangeKeyRef = useRef<string>('')

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

    const chart = createChart(el, {
      width: Math.floor(innerWidth()),
      height: chartHeight,
      layout: { background: { type: ColorType.Solid, color: '#ffffff' }, textColor: '#0f172a' },
      grid: { vertLines: { color: '#eef2f7' }, horzLines: { color: '#eef2f7' } },
      crosshair: { vertLine: { labelVisible: false }, horzLine: { labelVisible: false } },
      rightPriceScale: { borderColor: '#cbd5e1', mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal },
      timeScale: { borderColor: '#cbd5e1', rightOffset: 0, fixLeftEdge: true, fixRightEdge: true },
      handleScroll: false,
      handleScale: false,
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
    chartRef.current = chart
    seriesRef.current = series
    benchRef.current = bench
    markersRef.current = createSeriesMarkers(series, [])

    const overlay = document.createElement('div')
    overlay.className = 'chart-hover-overlay'
    el.appendChild(overlay)
    overlayRef.current = overlay

    chart.subscribeCrosshairMove((param: MouseEventParams<Time>) => {
      if (!showCursorStats) return
      const time = toUtcSeconds(param.time)
      if (!time) {
        overlay.style.display = 'none'
        return
      }
      const stats = computeWindowStats(time)
      overlay.style.display = 'block'
      overlay.innerHTML = `<div class="chart-hover-date">${isoFromUtcSeconds(time)}</div>
<div class="chart-hover-stats">
  <div class="chart-hover-stat"><span class="chart-hover-label">CAGR</span> <span class="chart-hover-value">${stats ? formatPct(stats.cagr) : '—'}</span></div>
  <div class="chart-hover-stat"><span class="chart-hover-label">MaxDD</span> <span class="chart-hover-value">${stats ? formatPct(stats.maxDD) : '—'}</span></div>
</div>`

      // keep overlay centered; only its values change with the cursor
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
      chart.applyOptions({ width: Math.floor(innerWidth()) })
    })
    ro.observe(el)

    return () => {
      ro.disconnect()
      try {
        overlay.remove()
      } catch {
        // ignore
      }
      chart.timeScale().unsubscribeVisibleTimeRangeChange(handleVisibleRangeChange)
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      benchRef.current = null
      try {
        markersRef.current?.detach()
      } catch {
        // ignore
      }
      markersRef.current = null
      overlayRef.current = null
      baseLineRef.current = null
    }
  }, [computeWindowStats, formatReturnFromBase, logScale, showCursorStats, chartHeight])

  useEffect(() => {
    if (!seriesRef.current) return
    const main = sanitizeSeriesPoints(points)
    if (main.length > 0) baseEquityRef.current = main[0].value
    seriesRef.current.setData(main)
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
    if (visibleRange) {
      chart.timeScale().setVisibleRange(visibleRange)
      return
    }
    if (main.length > 1) {
      chart.timeScale().setVisibleRange({ from: main[0].time, to: main[main.length - 1].time })
      return
    }
    chart.timeScale().fitContent()
  }, [points, benchmarkPoints, markers, visibleRange, logScale])

  return (
    <div
      ref={containerRef}
      style={{
      width: '100%',
      height: chartHeight,
      borderRadius: 14,
      border: '1px solid #cbd5e1',
      overflow: 'hidden',
    }}
  />
  )
}

function DrawdownChart({
  points,
  visibleRange,
  onVisibleRangeChange,
}: {
  points: EquityPoint[]
  visibleRange?: VisibleRange
  onVisibleRangeChange?: (range: VisibleRange) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null)
  const onVisibleRangeChangeRef = useRef(onVisibleRangeChange)
  const lastEmittedRangeKeyRef = useRef<string>('')

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

    const chart = createChart(el, {
      width: Math.floor(innerWidth()),
      height: 130,
      layout: { background: { type: ColorType.Solid, color: '#ffffff' }, textColor: '#0f172a' },
      grid: { vertLines: { color: '#eef2f7' }, horzLines: { color: '#eef2f7' } },
      rightPriceScale: { borderColor: '#cbd5e1' },
      timeScale: { borderColor: '#cbd5e1', rightOffset: 0, fixLeftEdge: true, fixRightEdge: true },
      handleScroll: false,
      handleScale: false,
    })
    const series = chart.addSeries(AreaSeries, {
      lineColor: '#ef4444',
      topColor: 'rgba(239, 68, 68, 0.22)',
      bottomColor: 'rgba(239, 68, 68, 0.02)',
      lineWidth: 2,
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
      chart.applyOptions({ width: Math.floor(innerWidth()) })
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
    if (visibleRange) {
      chart.timeScale().setVisibleRange(visibleRange)
      return
    }
    if (dd.length > 1) {
      chart.timeScale().setVisibleRange({ from: dd[0].time, to: dd[dd.length - 1].time })
      return
    }
    chart.timeScale().fitContent()
  }, [points, visibleRange])

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: 130,
        borderRadius: 14,
        border: '1px solid #cbd5e1',
        overflow: 'hidden',
      }}
    />
  )
}

function RangeNavigator({
  points,
  range,
  onChange,
}: {
  points: EquityPoint[]
  range: VisibleRange
  onChange: (range: VisibleRange) => void
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

    const rect = el.getBoundingClientRect()
    const fromCoord = chart.timeScale().timeToCoordinate(rangeRef.current.from)
    const toCoord = chart.timeScale().timeToCoordinate(rangeRef.current.to)
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

    const chart = createChart(el, {
      width: Math.floor(innerWidth()),
      height: 110,
      layout: { background: { type: ColorType.Solid, color: '#ffffff' }, textColor: '#0f172a' },
      grid: { vertLines: { color: '#eef2f7' }, horzLines: { color: '#eef2f7' } },
      rightPriceScale: { visible: false },
      leftPriceScale: { visible: false },
      timeScale: { visible: false, borderColor: '#cbd5e1', fixLeftEdge: true, fixRightEdge: true },
      handleScroll: false,
      handleScale: false,
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
          className="navigator-chart"
          style={{
            width: '100%',
            height: 110,
            borderRadius: 14,
            border: '1px solid #cbd5e1',
            overflow: 'hidden',
          }}
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
}: {
  series: Array<{ name: string; color: string; points: EquityPoint[] }>
  visibleRange?: VisibleRange
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRefs = useRef<Array<ISeriesApi<'Line'>>>([])

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

    const chart = createChart(el, {
      width: Math.floor(innerWidth()),
      height: 240,
      layout: { background: { type: ColorType.Solid, color: '#ffffff' }, textColor: '#0f172a' },
      grid: { vertLines: { color: '#eef2f7' }, horzLines: { color: '#eef2f7' } },
      rightPriceScale: { borderColor: '#cbd5e1' },
      timeScale: { borderColor: '#cbd5e1', rightOffset: 0, fixLeftEdge: true, fixRightEdge: true },
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
  }, [])

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

    for (const s of series) {
      const line = chart.addSeries(LineSeries, {
        color: s.color,
        lineWidth: 2,
        priceFormat: { type: 'percent', precision: 2, minMove: 0.01 },
      })
      line.setData(sanitizeSeriesPoints(s.points, { clampMin: 0, clampMax: 1 }))
      seriesRefs.current.push(line)
    }

    if (visibleRange) {
      chart.timeScale().setVisibleRange(visibleRange)
    } else {
      chart.timeScale().fitContent()
    }
  }, [series, visibleRange])

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: 240,
        borderRadius: 14,
        border: '1px solid #cbd5e1',
        overflow: 'hidden',
      }}
    />
  )
}

function AdminDataPanel({
  tickers,
  error,
}: {
  tickers: string[]
  error: string | null
}) {
  const [selected, setSelected] = useState<string>(() => tickers[0] || '')
  const [loading, setLoading] = useState(false)
  const [dataError, setDataError] = useState<string | null>(null)
  const [candles, setCandles] = useState<CandlestickData[]>([])
  const [preview, setPreview] = useState<AdminCandlesResponse['preview']>([])

  const load = useCallback(
    async (ticker: string) => {
      if (!ticker) return
      setLoading(true)
      setDataError(null)
      try {
        const res = await fetch(`/api/candles/${encodeURIComponent(ticker)}?limit=1500`)
        const payload = (await res.json()) as AdminCandlesResponse | { error: string }
        if (!res.ok) throw new Error('error' in payload ? payload.error : `Request failed (${res.status})`)
        const p = payload as AdminCandlesResponse
        setPreview(p.preview || [])
        setCandles(
          (p.candles || []).map((c) => ({
            time: c.time as UTCTimestamp,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          })),
        )
      } catch (e) {
        setCandles([])
        setPreview([])
        setDataError(String((e as Error)?.message || e))
      } finally {
        setLoading(false)
      }
    },
    [setCandles],
  )

  useEffect(() => {
    if (!selected && tickers[0]) setSelected(tickers[0])
  }, [selected, tickers])

  useEffect(() => {
    if (!selected) return
    void load(selected)
  }, [selected, load])

  const combinedError = error || dataError

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 800 }}>Ticker</div>
        <select value={selected} onChange={(e) => setSelected(e.target.value)} style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid #cbd5e1' }}>
          {tickers.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button onClick={() => void load(selected)} disabled={!selected || loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {combinedError && <div style={{ marginTop: 10, color: '#b91c1c', fontWeight: 700 }}>{combinedError}</div>}

      <div style={{ marginTop: 12 }}>
        <CandlesChart candles={candles} />
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Ticker data preview (last 50 rows)</div>
        <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid #cbd5e1', borderRadius: 14, background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Date', 'Open', 'High', 'Low', 'Close'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #eef2f7', position: 'sticky', top: 0, background: '#fff' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.map((r, idx) => (
                <tr key={idx}>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid #eef2f7', whiteSpace: 'nowrap' }}>{r.Date}</td>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid #eef2f7' }}>{r.Open}</td>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid #eef2f7' }}>{r.High}</td>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid #eef2f7' }}>{r.Low}</td>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid #eef2f7' }}>{r.Close}</td>
                </tr>
              ))}
              {preview.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: 10, color: '#4b5563' }}>
                    No data loaded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function AdminPanel({
  adminTab,
  setAdminTab,
  onTickersUpdated,
}: {
  adminTab: 'Ticker List' | 'Data'
  setAdminTab: (t: 'Ticker List' | 'Data') => void
  onTickersUpdated?: (tickers: string[]) => void
}) {
  const [status, setStatus] = useState<AdminStatus | null>(null)
  const [tickers, setTickers] = useState<string[]>([])
  const [tickersText, setTickersText] = useState<string>('')
  const [tickersDirty, setTickersDirty] = useState(false)
  const [tickersSaving, setTickersSaving] = useState(false)
  const [tickersSaveMsg, setTickersSaveMsg] = useState<string | null>(null)
  const [downloadConfig, setDownloadConfig] = useState<{ batchSize: number; sleepSeconds: number; maxRetries: number; threads: boolean; limit: number }>(() => ({
    batchSize: 100,
    sleepSeconds: 2,
    maxRetries: 3,
    threads: true,
    limit: 0,
  }))
  const [parquetTickers, setParquetTickers] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [downloadJob, setDownloadJob] = useState<AdminDownloadJob | null>(null)
  const [downloadMsg, setDownloadMsg] = useState<string | null>(null)

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
        if (!tickersDirty) {
          try {
            const rawRes = await fetch('/api/tickers/raw')
            const rawPayload = (await rawRes.json()) as { text: string } | { error: string }
            if (rawRes.ok && 'text' in rawPayload) {
              setTickersText(String(rawPayload.text ?? ''))
            } else {
              setTickersText(tickersList.join('\n'))
            }
            setTickersDirty(false)
          } catch {
            setTickersText(tickersList.join('\n'))
            setTickersDirty(false)
          }
        }
      } catch (e) {
        if (cancelled) return
        setError(String((e as Error)?.message || e))
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [tickersDirty, onTickersUpdated])

  const startDownload = useCallback(async () => {
    setDownloadMsg(null)
    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(downloadConfig),
      })
      const payload = (await res.json()) as { jobId: string } | { error: string }
      if (!res.ok) throw new Error('error' in payload ? payload.error : `Download failed (${res.status})`)
      if (!('jobId' in payload)) throw new Error(payload.error || 'Download failed.')
      setDownloadJob({ id: payload.jobId, status: 'running', startedAt: Date.now(), finishedAt: null, error: null })
      setDownloadMsg('Starting download…')
    } catch (e) {
      setDownloadMsg(String((e as Error)?.message || e))
    }
  }, [downloadConfig])

  const saveTickers = useCallback(async () => {
    setTickersSaveMsg(null)
    setTickersSaving(true)
    try {
      const res = await fetch('/api/tickers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: tickersText }),
      })
      const payload = (await res.json()) as { tickers: string[] } | { error: string }
      if (!res.ok) throw new Error('error' in payload ? payload.error : `Save failed (${res.status})`)
      if (!('tickers' in payload)) throw new Error('Save failed.')
      setTickers(payload.tickers || [])
      onTickersUpdated?.(payload.tickers || [])
      setTickersDirty(false)
      setTickersSaveMsg('Saved.')
      try {
        const s = await fetch('/api/status')
        const sPayload = (await s.json()) as AdminStatus
        if (s.ok) setStatus(sPayload)
      } catch {
        // ignore refresh failures
      }
    } catch (e) {
      setTickersSaveMsg(String((e as Error)?.message || e))
    } finally {
      setTickersSaving(false)
    }
  }, [tickersText, onTickersUpdated])

  useEffect(() => {
    if (adminTab !== 'Data') return
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
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [adminTab])

  useEffect(() => {
    if (!downloadJob?.id) return
    if (downloadJob.status !== 'running') return
    let cancelled = false
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/download/${encodeURIComponent(downloadJob.id)}`)
        const payload = (await res.json()) as AdminDownloadJob | { error: string }
        if (!res.ok) {
          const errMsg = (payload as { error?: unknown })?.error
          throw new Error(typeof errMsg === 'string' ? errMsg : `Job poll failed (${res.status})`)
        }
        if (cancelled) return
        const job = payload as AdminDownloadJob
        setDownloadJob(job)
        const last = (job.events || []).slice(-1)[0] as Record<string, unknown> | undefined
        if (job.status === 'running') {
          const type = String(last?.type || 'running')
          if (type === 'ticker_saved') {
            setDownloadMsg(`Downloading… saved ${String(last?.saved ?? '')}`)
          } else if (type === 'batch_start') {
            setDownloadMsg(`Downloading… batch ${String(last?.batch_index ?? '')}/${String(last?.batches_total ?? '')}`)
          } else {
            setDownloadMsg('Downloading…')
          }
        } else if (job.status === 'done') {
          setDownloadMsg('Download complete.')
          // refresh tickers list + status (and Data view options)
          try {
            const [s, t] = await Promise.all([fetch('/api/status'), fetch('/api/tickers')])
            const sPayload = (await s.json()) as AdminStatus
            const tPayload = (await t.json()) as { tickers: string[] }
            if (s.ok) setStatus(sPayload)
            if (t.ok) {
              setTickers(tPayload.tickers || [])
              onTickersUpdated?.(tPayload.tickers || [])
            }
            try {
              const p = await fetch('/api/parquet-tickers')
              const pPayload = (await p.json()) as { tickers: string[] }
              if (p.ok) setParquetTickers(pPayload.tickers || [])
            } catch {
              // ignore parquet refresh failures
            }
          } catch {
            // ignore refresh failures
          }
        } else if (job.status === 'error') {
          setDownloadMsg(job.error ?? 'Download failed.')
        }
      } catch (e) {
        if (cancelled) return
        setDownloadMsg(String((e as Error)?.message || e))
      }
    }, 1000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [downloadJob?.id, downloadJob?.status, onTickersUpdated])

  return (
    <div className="placeholder">
      <div className="tabs">
        {(['Ticker List', 'Data'] as const).map((t) => (
          <button key={t} className={`tab-btn ${adminTab === t ? 'active' : ''}`} onClick={() => setAdminTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <div style={{ marginTop: 16 }}>
        {adminTab === 'Ticker List' ? (
          <AdminTickerList
            status={status}
            tickers={tickers}
            tickersText={tickersText}
            onTickersTextChange={(next) => {
              setTickersText(next)
              setTickersDirty(true)
              setTickersSaveMsg(null)
            }}
            error={error}
            onSaveTickers={() => void saveTickers()}
            saveDisabled={tickersSaving || !tickersDirty}
            saveStatus={tickersSaveMsg}
            downloadConfig={downloadConfig}
            onChangeDownloadConfig={(next) => setDownloadConfig((prev) => ({ ...prev, ...next }))}
            onDownload={startDownload}
            downloadDisabled={!status?.tickersExists || downloadJob?.status === 'running'}
            downloadStatus={downloadMsg}
          />
        ) : (
          <AdminDataPanel tickers={parquetTickers.length ? parquetTickers : tickers} error={error} />
        )}
        {adminTab === 'Ticker List' && downloadJob?.logs?.length ? (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Downloader log</div>
            <pre style={{ maxHeight: 260, overflow: 'auto', padding: 10, borderRadius: 12, border: '1px solid #cbd5e1', background: '#fff' }}>
              {downloadJob.logs.join('\n')}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
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
  SLOT_ORDER[node.kind].forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? replaceSlot(c, parentId, slot, index, child) : c)) : arr
  })
  return { ...node, children }
}

const appendPlaceholder = (node: FlowNode, targetId: string, slot: SlotId): FlowNode => {
  if (node.id === targetId) {
    const arr = node.children[slot] ?? [null]
    return { ...node, children: { ...node.children, [slot]: [...arr, null] } }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  SLOT_ORDER[node.kind].forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? appendPlaceholder(c, targetId, slot) : c)) : arr
  })
  return { ...node, children }
}

const deleteNode = (node: FlowNode, targetId: string): FlowNode => {
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  SLOT_ORDER[node.kind].forEach((s) => {
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
  SLOT_ORDER[node.kind].forEach((s) => {
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
  SLOT_ORDER[node.kind].forEach((s) => {
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
  SLOT_ORDER[node.kind].forEach((s) => {
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
  SLOT_ORDER[node.kind].forEach((s) => {
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
  SLOT_ORDER[node.kind].forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateFunctionWindow(c, id, value) : c)) : arr
  })
  return { ...node, children }
}

const updateFunctionBottom = (node: FlowNode, id: string, value: number): FlowNode => {
  if (node.id === id && node.kind === 'function') return { ...node, bottom: value }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  SLOT_ORDER[node.kind].forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateFunctionBottom(c, id, value) : c)) : arr
  })
  return { ...node, children }
}

const updateFunctionMetric = (node: FlowNode, id: string, metric: MetricChoice): FlowNode => {
  if (node.id === id && node.kind === 'function') return { ...node, metric }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  SLOT_ORDER[node.kind].forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateFunctionMetric(c, id, metric) : c)) : arr
  })
  return { ...node, children }
}

const updateFunctionRank = (node: FlowNode, id: string, rank: RankChoice): FlowNode => {
  if (node.id === id && node.kind === 'function') return { ...node, rank }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  SLOT_ORDER[node.kind].forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateFunctionRank(c, id, rank) : c)) : arr
  })
  return { ...node, children }
}

const updateCollapse = (node: FlowNode, id: string, collapsed: boolean): FlowNode => {
  if (node.id === id) return { ...node, collapsed }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  SLOT_ORDER[node.kind].forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateCollapse(c, id, collapsed) : c)) : arr
  })
  return { ...node, children }
}

const updateColor = (node: FlowNode, id: string, color?: string): FlowNode => {
  if (node.id === id) return { ...node, bgColor: color }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  SLOT_ORDER[node.kind].forEach((s) => {
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
  SLOT_ORDER[node.kind].forEach((s) => {
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
  SLOT_ORDER[node.kind].forEach((s) => {
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
  SLOT_ORDER[node.kind].forEach((s) => {
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
  SLOT_ORDER[node.kind].forEach((s) => {
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
  SLOT_ORDER[node.kind].forEach((s) => {
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
  SLOT_ORDER[node.kind].forEach((s) => {
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
  SLOT_ORDER[node.kind].forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateConditionFields(c, id, condId, updates, itemId) : c)) : arr
  })
  return { ...node, children }
}

const updateNumberedQuantifier = (node: FlowNode, id: string, quantifier: NumberedQuantifier): FlowNode => {
  if (node.id === id && node.kind === 'numbered' && node.numbered) {
    return { ...node, numbered: { ...node.numbered, quantifier } }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  SLOT_ORDER[node.kind].forEach((s) => {
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
  SLOT_ORDER[node.kind].forEach((s) => {
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
  SLOT_ORDER[node.kind].forEach((s) => {
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
  SLOT_ORDER[node.kind].forEach((s) => {
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
  SLOT_ORDER[node.kind].forEach((s) => {
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
  }
  SLOT_ORDER[node.kind].forEach((slot) => {
    const arr = node.children[slot]
    cloned.children[slot] = arr ? arr.map((c) => (c ? cloneNode(c) : null)) : [null]
  })
  return cloned
}

const findNode = (node: FlowNode, id: string): FlowNode | null => {
  if (node.id === id) return node
  for (const slot of SLOT_ORDER[node.kind]) {
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
  }
}

type CardProps = {
  node: FlowNode
  depth: number
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
  onRename: (id: string, title: string) => void
  onWeightChange: (id: string, weight: WeightMode, branch?: 'then' | 'else') => void
  onUpdateCappedFallback: (id: string, choice: PositionChoice, branch?: 'then' | 'else') => void
  onUpdateVolWindow: (id: string, days: number, branch?: 'then' | 'else') => void
  onColorChange: (id: string, color?: string) => void
  onToggleCollapse: (id: string, collapsed: boolean) => void
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
    }>,
    itemId?: string,
  ) => void
  onAddPosition: (id: string) => void
  onRemovePosition: (id: string, index: number) => void
  onChoosePosition: (id: string, index: number, choice: PositionChoice) => void
  clipboard: FlowNode | null
  callChains: CallChain[]
  onUpdateCallRef: (id: string, callId: string | null) => void
}

const NodeCard = ({
  node,
  depth,
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
  onRename,
  onWeightChange,
  onUpdateCappedFallback,
  onUpdateVolWindow,
  onColorChange,
  onToggleCollapse,
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
  callChains,
  onUpdateCallRef,
}: CardProps) => {
  const [addRowOpen, setAddRowOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(node.title)
  const [positionDrafts, setPositionDrafts] = useState<Record<string, string>>({})
  const [weightMainOpen, setWeightMainOpen] = useState(false)
  const [weightThenOpen, setWeightThenOpen] = useState(false)
  const [weightElseOpen, setWeightElseOpen] = useState(false)
  const [colorOpen, setColorOpen] = useState(false)

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
      return (
        <div className="slot-block" key={`${node.id}-${slot}`}>
          <div className="line">
            <div
              className="indent with-line"
              style={{ width: depthPx * 1 + 14 + (slot === 'then' || slot === 'else' ? 14 : 0) }}
            />
            <div className="add-row">
              <button
                className="add-more"
                onClick={(e) => {
                  e.stopPropagation()
                  setAddRowOpen((v) => (v === key ? null : key))
                }}
              >
                + insert Node here
              </button>
              {addRowOpen === key ? (
                <div
                  className="menu"
                  onClick={(e) => {
                    e.stopPropagation()
                  }}
                >
                  <button
                    onClick={() => {
                      onAdd(node.id, slot, 0, 'basic')
                      setAddRowOpen(null)
                    }}
                  >
                    Add Basic
                  </button>
                  <button
                    onClick={() => {
                      onAdd(node.id, slot, 0, 'function')
                      setAddRowOpen(null)
                    }}
                  >
                    Add Sort
                  </button>
                  <button
                    onClick={() => {
                      onAdd(node.id, slot, 0, 'indicator')
                      setAddRowOpen(null)
                    }}
                  >
                    Add Indicator
                  </button>
                  <button
                    onClick={() => {
                      onAdd(node.id, slot, 0, 'numbered')
                      setAddRowOpen(null)
                    }}
                  >
                    Add Numbered
                  </button>
                  <button
                    onClick={() => {
                      onAdd(node.id, slot, 0, 'position')
                      setAddRowOpen(null)
                    }}
                  >
                    Add Position
                  </button>
                  <button
                    onClick={() => {
                      onAdd(node.id, slot, 0, 'call')
                      setAddRowOpen(null)
                    }}
                  >
                    Add Call Reference
                  </button>
                  {clipboard && (
                    <button
                      onClick={() => {
                        onPaste(node.id, slot, 0, clipboard)
                        setAddRowOpen(null)
                      }}
                    >
                      Paste
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )
    }
    return (
      <div className="slot-block" key={`${node.id}-${slot}`}>
        {indexedChildren.map(({ c: child, i: originalIndex }, index) => (
          <div key={`${slot}-${originalIndex}`}>
            <div className="line">
              <div
                className="indent with-line"
                style={{
                  width: (depth + 1) * 14 + 8,
                }}
              />
              <div className="slot-body">
                <NodeCard
                  node={child}
                  depth={depth + 1}
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
                    onRename={onRename}
                    onWeightChange={onWeightChange}
                    onUpdateCappedFallback={onUpdateCappedFallback}
                    onUpdateVolWindow={onUpdateVolWindow}
                    onColorChange={onColorChange}
                    onToggleCollapse={onToggleCollapse}
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
                  callChains={callChains}
                  onUpdateCallRef={onUpdateCallRef}
                />
                {node.kind === 'function' && slot === 'next' && index > 0 ? (
                  <button className="icon-btn delete inline" onClick={() => onRemoveSlotEntry(node.id, slot, index)}>
                    X
                  </button>
                ) : null}
              </div>
            </div>
            {!(node.kind === 'function' && slot === 'next' && index < indexedChildren.length - 1) ? (
              <div className="line">
                <div
                  className="indent with-line"
                  style={{
                    width: (depth + 1) * 14 + 8,
                  }}
                />
                <div className="add-row">
                  <button
                    className="add-more"
                    onClick={(e) => {
                      e.stopPropagation()
                      const key = `${slot}-ins-${originalIndex}`
                      setAddRowOpen((v) => (v === key ? null : key))
                    }}
                  >
                    + insert Node here
                  </button>
                  {addRowOpen === `${slot}-ins-${originalIndex}` ? (
                    <div
                      className="menu"
                      onClick={(e) => {
                        e.stopPropagation()
                      }}
                    >
                      <button
                        onClick={() => {
                          onAdd(node.id, slot, originalIndex + 1, 'basic')
                          setAddRowOpen(null)
                        }}
                      >
                        Add Basic
                      </button>
                      <button
                        onClick={() => {
                          onAdd(node.id, slot, originalIndex + 1, 'function')
                          setAddRowOpen(null)
                        }}
                      >
                      Add Sort
                      </button>
                      <button
                        onClick={() => {
                          onAdd(node.id, slot, originalIndex + 1, 'indicator')
                          setAddRowOpen(null)
                        }}
                      >
                        Add Indicator
                      </button>
                      <button
                        onClick={() => {
                          onAdd(node.id, slot, originalIndex + 1, 'numbered')
                          setAddRowOpen(null)
                        }}
                      >
                        Add Numbered
                      </button>
                      <button
                        onClick={() => {
                          onAdd(node.id, slot, originalIndex + 1, 'position')
                          setAddRowOpen(null)
                        }}
                      >
                        Add Position
                      </button>
                      <button
                        onClick={() => {
                          onAdd(node.id, slot, originalIndex + 1, 'call')
                          setAddRowOpen(null)
                        }}
                      >
                        Add Call Reference
                      </button>
                      {clipboard && (
                        <button
                          onClick={() => {
                            onPaste(node.id, slot, originalIndex + 1, clipboard)
                            setAddRowOpen(null)
                          }}
                        >
                          Paste
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    )
  }

  const renderPosition = () => {
    if (node.kind !== 'position' || !node.positions) return null
    return (
      <div className="positions">
        {node.positions.map((p, idx) => (
          <div className="position-row" key={`${node.id}-pos-${idx}`}>
            <div className="indent" style={{ width: 14 }} />
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
                    style={{ width: 120 }}
                  />
                )
              })()}
            </div>
            {idx > 0 && (
              <button className="icon-btn delete inline" onClick={() => onRemovePosition(node.id, idx)}>
                X
              </button>
            )}
          </div>
        ))}
        <div className="position-row">
          <div className="indent" style={{ width: 14 }} />
          <button className="add-more" onClick={() => onAddPosition(node.id)}>
            +
          </button>
        </div>
      </div>
    )
  }

  const renderCallReference = () => {
    if (node.kind !== 'call') return null
    const linked = node.callRefId ? callChainMap.get(node.callRefId) : null
    return (
      <div className="line">
        <div className="indent with-line" style={{ width: 14 }} />
        <div className="call-ref-wrap">
          {callChains.length === 0 ? (
            <div style={{ color: '#64748b', fontWeight: 700 }}>Create a Call in the side panel first.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <select
                value={node.callRefId ?? ''}
                onChange={(e) => onUpdateCallRef(node.id, e.target.value || null)}
                style={{ maxWidth: 260 }}
              >
                <option value="">Select a call chain…</option>
                {callChains.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {linked ? (
                <div style={{ fontSize: 12, color: '#475569', fontWeight: 800 }}>Linked to: {linked.name}</div>
              ) : (
                <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 700 }}>No call selected.</div>
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
        <div className="chip tag capped-chip">
          <span>Fallback</span>
          <input
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
            style={{ width: 120 }}
          />
        </div>
      )
    }

    return (
      <div className="chip tag capped-chip">
        <span>of the last</span>
        <input
          className="inline-number"
          type="number"
          value={volDays ?? 20}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onUpdateVolWindow(node.id, Number(e.target.value), branch)}
          style={{ width: 70 }}
          min={1}
        />
        <span>days</span>
      </div>
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
      <div className="condition-row" key={cond.id}>
        <div className="chip">
          {prefix}
          {cond.metric === 'Current Price' ? null : (
            <>
              <input
                className="inline-number"
                type="number"
                value={cond.window}
                onChange={(e) => onUpdateCondition(ownerId, cond.id, { window: Number(e.target.value) }, itemId)}
              />
              d{' '}
            </>
          )}
          <select
            className="inline-select"
            value={cond.metric}
            onChange={(e) => onUpdateCondition(ownerId, cond.id, { metric: e.target.value as MetricChoice }, itemId)}
          >
            <option value="Current Price">Current Price</option>
            <option value="Simple Moving Average">Simple Moving Average</option>
            <option value="Exponential Moving Average">Exponential Moving Average</option>
            <option value="Relative Strength Index">Relative Strength Index</option>
            <option value="Max Drawdown">Max Drawdown</option>
            <option value="Standard Deviation">Standard Deviation</option>
          </select>
          {' of '}
          <select
            className="inline-select"
            value={cond.ticker}
            onChange={(e) => onUpdateCondition(ownerId, cond.id, { ticker: e.target.value as PositionChoice }, itemId)}
          >
            {[cond.ticker, ...tickerOptions.filter((t) => t !== cond.ticker)].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>{' '}
          is{' '}
          <select
            className="inline-select"
            value={cond.comparator}
            onChange={(e) =>
              onUpdateCondition(ownerId, cond.id, { comparator: e.target.value as ComparatorChoice }, itemId)
            }
          >
            <option value="lt">Less Than</option>
            <option value="gt">Greater Than</option>
          </select>{' '}
          {cond.expanded ? null : (
            <input
              className="inline-number"
              type="number"
              value={cond.threshold}
              onChange={(e) => onUpdateCondition(ownerId, cond.id, { threshold: Number(e.target.value) }, itemId)}
            />
          )}
          {cond.expanded ? (
            <>
              {' '}
              the{' '}
              {cond.rightMetric === 'Current Price' ? null : (
                <>
                  <input
                    className="inline-number"
                    type="number"
                    value={cond.rightWindow ?? 14}
                    onChange={(e) => onUpdateCondition(ownerId, cond.id, { rightWindow: Number(e.target.value) }, itemId)}
                  />
                  d{' '}
                </>
              )}
              <select
                className="inline-select"
                value={cond.rightMetric ?? 'Relative Strength Index'}
                onChange={(e) => onUpdateCondition(ownerId, cond.id, { rightMetric: e.target.value as MetricChoice }, itemId)}
              >
                <option value="Current Price">Current Price</option>
                <option value="Simple Moving Average">Simple Moving Average</option>
                <option value="Exponential Moving Average">Exponential Moving Average</option>
                <option value="Relative Strength Index">Relative Strength Index</option>
                <option value="Max Drawdown">Max Drawdown</option>
                <option value="Standard Deviation">Standard Deviation</option>
              </select>{' '}
              of{' '}
              <select
                className="inline-select"
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
              </select>{' '}
            </>
          ) : null}
          <button
            className="icon-btn inline"
            onClick={(e) => {
              e.stopPropagation()
              onUpdateCondition(ownerId, cond.id, { expanded: !cond.expanded }, itemId)
            }}
            title="Flip condition"
          >
            ↔
          </button>
        </div>
        {((total > 1 && (idx > 0 || allowDeleteFirst)) || (allowDeleteFirst && isSingleLineItem)) ? (
          <button
            className="icon-btn delete inline"
            onClick={() => {
              if (allowDeleteFirst && isSingleLineItem && itemId) {
                onDeleteNumberedItem(ownerId, itemId)
                return
              }
              onDeleteCondition(ownerId, cond.id, itemId)
            }}
          >
            X
          </button>
        ) : null}
      </div>
    )
  }

  const hasBacktestError = Boolean(errorNodeIds?.has(node.id))
  const hasBacktestFocus = Boolean(focusNodeId && focusNodeId === node.id)

  return (
    <div
      id={`node-${node.id}`}
      className={`node-card${hasBacktestError ? ' backtest-error' : ''}${hasBacktestFocus ? ' backtest-focus' : ''}`}
      style={{ marginLeft: depth * 18, background: node.bgColor || undefined }}
    >
      <div className="node-head">
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
        <div className="head-actions">
          <button
            className="icon-btn"
            onClick={(e) => {
              e.stopPropagation()
              onCopy(node.id)
            }}
          >
            Copy
          </button>
          <button
            className="icon-btn"
            onClick={(e) => {
              e.stopPropagation()
              onToggleCollapse(node.id, !collapsed)
            }}
          >
            {collapsed ? 'Expand' : 'Collapse'}
          </button>
          <div className="color-picker">
            <button
              className="icon-btn"
              onClick={(e) => {
                e.stopPropagation()
                setColorOpen((v) => !v)
              }}
            >
              Color
            </button>
            {colorOpen ? (
              <div
                className="color-menu"
                onClick={(e) => {
                  e.stopPropagation()
                }}
              >
                {palette.map((c) => (
                  <button
                    key={c}
                    className="color-swatch"
                    style={{ background: c }}
                    onClick={() => {
                      onColorChange(node.id, c)
                      setColorOpen(false)
                    }}
                    aria-label={`Select color ${c}`}
                  />
                ))}
                <button
                  className="color-swatch reset"
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
          <button
            className="icon-btn delete"
            onClick={(e) => {
              e.stopPropagation()
              onDelete(node.id)
            }}
          >
            Delete
          </button>
        </div>
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
                  return (
                    <div className="line" key={cond.id}>
                      <div className="indent with-line" style={{ width: 14 }} />
                      <div className="chip">
                        {prefix}
                        {cond.metric === 'Current Price' ? null : (
                          <>
                            <input
                              className="inline-number"
                              type="number"
                              value={cond.window}
                              onChange={(e) => onUpdateCondition(node.id, cond.id, { window: Number(e.target.value) })}
                            />
                            d{' '}
                          </>
                        )}
                        <select
                          className="inline-select"
                          value={cond.metric}
                          onChange={(e) =>
                            onUpdateCondition(node.id, cond.id, { metric: e.target.value as MetricChoice })
                          }
                        >
                          <option value="Current Price">Current Price</option>
                          <option value="Simple Moving Average">Simple Moving Average</option>
                          <option value="Exponential Moving Average">Exponential Moving Average</option>
                          <option value="Relative Strength Index">Relative Strength Index</option>
                          <option value="Max Drawdown">Max Drawdown</option>
                          <option value="Standard Deviation">Standard Deviation</option>
                        </select>
                        {' of '}
                        <select
                          className="inline-select"
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
                        </select>{' '}
                        is{' '}
                        <select
                          className="inline-select"
                          value={cond.comparator}
                          onChange={(e) =>
                            onUpdateCondition(node.id, cond.id, { comparator: e.target.value as ComparatorChoice })
                          }
                        >
                          <option value="lt">Less Than</option>
                          <option value="gt">Greater Than</option>
                        </select>{' '}
                        {cond.expanded ? null : (
                          <input
                            className="inline-number"
                            type="number"
                            value={cond.threshold}
                            onChange={(e) => onUpdateCondition(node.id, cond.id, { threshold: Number(e.target.value) })}
                          />
                        )}
                        {cond.expanded ? (
                          <>
                            {' '}
                            the{' '}
                            {cond.rightMetric === 'Current Price' ? null : (
                              <>
                                <input
                                  className="inline-number"
                                  type="number"
                                  value={cond.rightWindow ?? 14}
                                  onChange={(e) =>
                                    onUpdateCondition(node.id, cond.id, { rightWindow: Number(e.target.value) })
                                  }
                                />
                                d{' '}
                              </>
                            )}
                            <select
                              className="inline-select"
                              value={cond.rightMetric ?? 'Relative Strength Index'}
                              onChange={(e) =>
                                onUpdateCondition(node.id, cond.id, { rightMetric: e.target.value as MetricChoice })
                              }
                            >
                              <option value="Current Price">Current Price</option>
                              <option value="Simple Moving Average">Simple Moving Average</option>
                              <option value="Exponential Moving Average">Exponential Moving Average</option>
                              <option value="Relative Strength Index">Relative Strength Index</option>
                              <option value="Max Drawdown">Max Drawdown</option>
                              <option value="Standard Deviation">Standard Deviation</option>
                            </select>{' '}
                            of{' '}
                            <select
                              className="inline-select"
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
                            </select>{' '}
                          </>
                        ) : null}
                        <button
                          className="icon-btn inline"
                          onClick={(e) => {
                            e.stopPropagation()
                            onUpdateCondition(node.id, cond.id, { expanded: !cond.expanded })
                          }}
                          title="Flip condition"
                        >
                          ⇆
                        </button>
                      </div>
                      {idx > 0 ? (
                        <button className="icon-btn delete inline" onClick={() => onDeleteCondition(node.id, cond.id)}>
                          X
                        </button>
                      ) : null}
                    </div>
                  )
                })}
                </div>
                <div className="line">
                  <div className="indent with-line" style={{ width: 14 }} />
                  <div className="add-row">
                    <button className="add-more" onClick={(e) => { e.stopPropagation(); onAddCondition(node.id, 'and') }}>
                      And If
                    </button>
                    <button className="add-more" onClick={(e) => { e.stopPropagation(); onAddCondition(node.id, 'or') }}>
                      Or If
                    </button>
                  </div>
                </div>

                <div className="line">
                  <div className="indent with-line" style={{ width: 2 * 14 }} />
                  <div className="chip title">Then</div>
                </div>
                <div className="line">
                  <div className="indent with-line" style={{ width: 3 * 14 }} />
                  <div className="weight-wrap">
                  <button
                    className="chip tag"
                    onClick={(e) => {
                      e.stopPropagation()
                      setWeightThenOpen((v) => !v)
                      setWeightElseOpen(false)
                      setWeightMainOpen(false)
                    }}
                  >
                    {weightLabel(node.weightingThen ?? node.weighting)}
                  </button>
                  {renderWeightDetailChip('then')}
                  {weightThenOpen ? (
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
                            onWeightChange(node.id, w, 'then')
                            if (w !== 'capped') {
                              setWeightThenOpen(false)
                              setWeightElseOpen(false)
                              setWeightMainOpen(false)
                            }
                          }}
                        >
                          {weightLabel(w)}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
                {renderSlot('then', 3 * 14)}
                <div className="line">
                  <div className="indent with-line" style={{ width: 2 * 14 }} />
                  <div className="chip title">Else</div>
                </div>
                <div className="line">
                  <div className="indent with-line" style={{ width: 3 * 14 }} />
                  <div className="weight-wrap">
                  <button
                    className="chip tag"
                    onClick={(e) => {
                      e.stopPropagation()
                      setWeightElseOpen((v) => !v)
                      setWeightThenOpen(false)
                      setWeightMainOpen(false)
                    }}
                  >
                    {weightLabel(node.weightingElse ?? node.weighting)}
                  </button>
                  {renderWeightDetailChip('else')}
                  {weightElseOpen ? (
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
                            onWeightChange(node.id, w, 'else')
                            if (w !== 'capped') {
                              setWeightElseOpen(false)
                              setWeightThenOpen(false)
                              setWeightMainOpen(false)
                            }
                          }}
                        >
                          {weightLabel(w)}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
                {renderSlot('else', 3 * 14)}
              </>
            ) : node.kind === 'numbered' ? (
              <>
                <div className="line">
                  <div className="indent with-line" style={{ width: 14 }} />
                  <div className="chip">
                    If{' '}
                    <select
                      className="inline-select"
                      value={node.numbered?.quantifier ?? 'all'}
                      onChange={(e) => onNumberedQuantifier(node.id, e.target.value as NumberedQuantifier)}
                    >
                      <option value="all">All</option>
                      <option value="none">None</option>
                      <option value="exactly">Exactly</option>
                      <option value="atLeast">At Least</option>
                      <option value="atMost">At Most</option>
                    </select>{' '}
                    {node.numbered?.quantifier === 'exactly' ||
                    node.numbered?.quantifier === 'atLeast' ||
                    node.numbered?.quantifier === 'atMost' ? (
                      <>
                        <input
                          className="inline-number"
                          type="number"
                          value={node.numbered?.n ?? 1}
                          onChange={(e) => onNumberedN(node.id, Number(e.target.value))}
                        />{' '}
                      </>
                    ) : null}
                    of the following conditions are true
                  </div>
                </div>

                {(node.numbered?.items ?? []).map((item, idx) => (
                  <div key={item.id}>
                    <div className="line">
                      <div className="indent with-line" style={{ width: 14 }} />
                      <div className="chip title">Indicator</div>
                    </div>
                    <div className="line condition-block">
                      <div className="indent with-line" style={{ width: 2 * 14 }} />
                      <div className="condition-bubble">
                        {item.conditions.map((cond, condIdx) =>
                          renderConditionRow(node.id, cond, condIdx, item.conditions.length, item.id, idx > 0),
                        )}
                      </div>
                    </div>
                    <div className="line">
                      <div className="indent with-line" style={{ width: 2 * 14 }} />
                      <div className="add-row">
                        <button
                          className="add-more"
                          onClick={(e) => {
                            e.stopPropagation()
                            onAddCondition(node.id, 'and', item.id)
                          }}
                        >
                          And If
                        </button>
                        <button
                          className="add-more"
                          onClick={(e) => {
                            e.stopPropagation()
                            onAddCondition(node.id, 'or', item.id)
                          }}
                        >
                          Or If
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                <div className="line">
                  <div className="indent with-line" style={{ width: 14 }} />
                  <div className="add-row">
                    <button
                      className="add-more"
                      onClick={(e) => {
                        e.stopPropagation()
                        onAddNumberedItem(node.id)
                      }}
                    >
                      Add Indicator
                    </button>
                  </div>
                </div>

                <div className="line">
                  <div className="indent with-line" style={{ width: 2 * 14 }} />
                  <div className="chip title">Then</div>
                </div>
                <div className="line">
                  <div className="indent with-line" style={{ width: 3 * 14 }} />
                  <div className="weight-wrap">
                    <button
                      className="chip tag"
                      onClick={(e) => {
                        e.stopPropagation()
                        setWeightThenOpen((v) => !v)
                        setWeightElseOpen(false)
                        setWeightMainOpen(false)
                      }}
                    >
                      {weightLabel(node.weightingThen ?? node.weighting)}
                    </button>
                    {renderWeightDetailChip('then')}
                    {weightThenOpen ? (
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
                              onWeightChange(node.id, w, 'then')
                              if (w !== 'capped') {
                                setWeightThenOpen(false)
                                setWeightElseOpen(false)
                                setWeightMainOpen(false)
                              }
                            }}
                          >
                            {weightLabel(w)}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                {renderSlot('then', 3 * 14)}

                <div className="line">
                  <div className="indent with-line" style={{ width: 2 * 14 }} />
                  <div className="chip title">Else</div>
                </div>
                <div className="line">
                  <div className="indent with-line" style={{ width: 3 * 14 }} />
                  <div className="weight-wrap">
                    <button
                      className="chip tag"
                      onClick={(e) => {
                        e.stopPropagation()
                        setWeightElseOpen((v) => !v)
                        setWeightThenOpen(false)
                        setWeightMainOpen(false)
                      }}
                    >
                      {weightLabel(node.weightingElse ?? node.weighting)}
                    </button>
                    {renderWeightDetailChip('else')}
                    {weightElseOpen ? (
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
                              onWeightChange(node.id, w, 'else')
                              if (w !== 'capped') {
                                setWeightElseOpen(false)
                                setWeightThenOpen(false)
                                setWeightMainOpen(false)
                              }
                            }}
                          >
                            {weightLabel(w)}
                          </button>
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
                        <div className="chip">
                          Of the{' '}
                          {node.metric === 'Current Price' ? null : (
                            <>
                              <input
                                className="inline-number"
                                type="number"
                                value={node.window ?? 10}
                                onChange={(e) => onFunctionWindow(node.id, Number(e.target.value))}
                              />
                              d{' '}
                            </>
                          )}
                          <select
                            className="inline-select"
                            value={node.metric ?? 'Relative Strength Index'}
                            onChange={(e) => onFunctionMetric(node.id, e.target.value as MetricChoice)}
                          >
                            <option value="Current Price">Current Price</option>
                            <option value="Simple Moving Average">Simple Moving Average</option>
                            <option value="Exponential Moving Average">Exponential Moving Average</option>
                            <option value="Relative Strength Index">Relative Strength Index</option>
                            <option value="Max Drawdown">Max Drawdown</option>
                            <option value="Standard Deviation">Standard Deviation</option>
                          </select>
                          {node.metric === 'Current Price' ? ' pick the ' : 's pick the '}
                          <select
                            className="inline-select"
                            value={node.rank ?? 'Bottom'}
                            onChange={(e) => onFunctionRank(node.id, e.target.value as RankChoice)}
                          >
                            <option value="Bottom">Bottom</option>
                            <option value="Top">Top</option>
                          </select>{' '}
                          <input
                            className="inline-number"
                            type="number"
                          value={node.bottom ?? 1}
                            onChange={(e) => onFunctionBottom(node.id, Number(e.target.value))}
                          />
                        </div>
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
  kind: 'indicator' | 'numbered' | 'numbered-item'
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
    sharpe: number
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

const formatPct = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : '—')

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
) => {
  const years = Array.from(
    new Set(
      (days || [])
        .map((d) => new Date(Number(d.time) * 1000).getUTCFullYear())
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
  const bgFor = (v: number) => {
    if (!Number.isFinite(v)) return { background: '#ffffff', color: '#94a3b8' }
    if (Math.abs(v) < 1e-12) return { background: '#ffffff', color: '#475569' }

    if (v > 0) {
      const t = maxPos > 0 ? Math.min(1, v / maxPos) : 0
      const r = mix(255, 22, t)
      const g = mix(255, 163, t)
      const b = mix(255, 74, t)
      return { background: `rgb(${r}, ${g}, ${b})`, color: '#064e3b' }
    }

    const t = minNeg < 0 ? Math.min(1, v / minNeg) : 0
    const r = mix(255, 220, t)
    const g = mix(255, 38, t)
    const b = mix(255, 38, t)
    return { background: `rgb(${r}, ${g}, ${b})`, color: '#881337' }
  }

  const yearStats = new Map<number, { cagr: number; maxDD: number } | null>()
  for (const y of years) {
    const rows = (days || []).filter((d) => new Date(Number(d.time) * 1000).getUTCFullYear() === y)
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
                const style = v == null ? { background: '#ffffff', color: '#94a3b8' } : bgFor(v)
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

const isoFromUtcSeconds = (t: number) => new Date(Number(t) * 1000).toISOString().slice(0, 10)

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
    tickers.add(norm)
    if (!tickerRefs.has(norm)) tickerRefs.set(norm, { nodeId, field })
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
    if (cond.metric !== 'Current Price') {
      if (!Number.isFinite(cond.window) || cond.window < 1) addError(ownerId, `${baseField}.window`, 'Indicator window must be >= 1.')
      maxLookback = Math.max(maxLookback, Math.floor(cond.window || 0))
    }
    if (cond.expanded) {
      const rt = normalizeChoice(cond.rightTicker ?? '')
      if (rt === 'Empty') addError(ownerId, `${baseField}.rightTicker`, 'Right-side ticker is missing.')
      else addTicker(rt, ownerId, `${baseField}.rightTicker`)
      const rw = Number(cond.rightWindow ?? cond.window)
      if ((cond.rightMetric ?? cond.metric) !== 'Current Price') {
        if (!Number.isFinite(rw) || rw < 1) addError(ownerId, `${baseField}.rightWindow`, 'Right-side window must be >= 1.')
        maxLookback = Math.max(maxLookback, Math.floor(rw || 0))
      }
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
      const win = metric === 'Current Price' ? 0 : Math.floor(Number(node.window ?? 10))
      if (metric !== 'Current Price' && (!(win >= 1) || !Number.isFinite(win))) {
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

    // weight-mode-specific validations for the node's active slots
    const slotsToCheck: SlotId[] =
      node.kind === 'indicator' || node.kind === 'numbered' ? ['then', 'else'] : node.kind === 'position' ? [] : ['next']

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
          if (!Number.isFinite(v) || v <= 0) {
            addError(child.id, 'window', `${mode === 'capped' ? 'Cap' : 'Weight'} % is missing for "${child.title}".`)
          } else if (mode === 'capped' && v > 100) {
            addError(child.id, 'window', `Cap % must be <= 100 for "${child.title}".`)
          }
        }
      }
    }

    for (const slot of SLOT_ORDER[node.kind]) {
      const arr = node.children[slot] || []
      for (const c of arr) if (c) walk(c, callStack)
    }
  }

  walk(root, [])

  return { tickers: Array.from(tickers).sort(), tickerRefs, maxLookback, errors }
}

type PriceDB = {
  dates: UTCTimestamp[]
  open: Record<string, Array<number | null>>
  close: Record<string, Array<number | null>>
}

type IndicatorCache = {
  rsi: Map<string, Map<number, Array<number | null>>>
  sma: Map<string, Map<number, Array<number | null>>>
  ema: Map<string, Map<number, Array<number | null>>>
  std: Map<string, Map<number, Array<number | null>>>
  maxdd: Map<string, Map<number, Array<number | null>>>
}

const emptyCache = (): IndicatorCache => ({
  rsi: new Map(),
  sma: new Map(),
  ema: new Map(),
  std: new Map(),
  maxdd: new Map(),
})

const getSeriesKey = (ticker: string) => normalizeChoice(ticker)

const buildCloseArray = (db: PriceDB, ticker: string) => (db.close[getSeriesKey(ticker)] || []).map((v) => (v == null ? NaN : v))

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
      out[i] = Math.sqrt(variance)
    }
  }
  return out
}

const rollingMaxDrawdown = (values: number[], period: number): Array<number | null> => {
  const out: Array<number | null> = new Array(values.length).fill(null)
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) continue
    let peak = -Infinity
    let maxDd = 0
    for (let j = i - period + 1; j <= i; j++) {
      const v = values[j]
      if (Number.isNaN(v)) {
        peak = -Infinity
        maxDd = 0
        continue
      }
      if (v > peak) peak = v
      if (peak > 0) {
        const dd = v / peak - 1
        if (dd < maxDd) maxDd = dd
      }
    }
    out[i] = maxDd
  }
  return out
}

const getCachedSeries = (cache: IndicatorCache, kind: keyof IndicatorCache, ticker: string, period: number, compute: () => Array<number | null>) => {
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
  const closes = buildCloseArray(ctx.db, t)
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
      const rets = closes.map((v, idx) => {
        if (idx === 0) return NaN
        const prev = closes[idx - 1]
        if (Number.isNaN(prev) || Number.isNaN(v) || prev === 0) return NaN
        return v / prev - 1
      })
      const series = getCachedSeries(ctx.cache, 'std', t, w, () => rollingStdDev(rets, w))
      return series[i] ?? null
    }
    case 'Max Drawdown': {
      const series = getCachedSeries(ctx.cache, 'maxdd', t, w, () => rollingMaxDrawdown(closes, w))
      return series[i] ?? null
    }
  }
}

const conditionExpr = (cond: ConditionLine): string => {
  const leftPrefix = cond.metric === 'Current Price' ? '' : `${Math.floor(Number(cond.window || 0))}d `
  const left = `${leftPrefix}${cond.metric} of ${normalizeChoice(cond.ticker)}`
  const cmp = normalizeComparatorChoice(cond.comparator) === 'lt' ? '<' : '>'
  if (!cond.expanded) return `${left} ${cmp} ${String(cond.threshold)}`

  const rightMetric = cond.rightMetric ?? cond.metric
  const rightTicker = normalizeChoice(cond.rightTicker ?? cond.ticker)
  const rightWindow = Math.floor(Number((cond.rightWindow ?? cond.window) || 0))
  const rightPrefix = rightMetric === 'Current Price' ? '' : `${rightWindow}d `
  const right = `${rightPrefix}${rightMetric} of ${rightTicker}`
  return `${left} ${cmp} ${right}`
}

const createBacktestTraceCollector = (): BacktestTraceCollector => {
  const branches = new Map<string, { thenCount: number; elseCount: number; kind: BacktestNodeTrace['kind'] }>()
  const conditionsByOwner = new Map<string, Map<string, BacktestConditionTrace>>()

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

  return { recordBranch, recordCondition, toResult }
}

const evalCondition = (ctx: EvalCtx, ownerId: string, traceOwnerId: string, cond: ConditionLine): boolean => {
  const cmp = normalizeComparatorChoice(cond.comparator)
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
      const ok =
        q === 'all'
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
      const win = metric === 'Current Price' ? 1 : Math.floor(Number(node.window ?? 10))
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

const computeBacktestSummary = (points: EquityPoint[], drawdowns: number[], days: BacktestDayRow[]) => {
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

  const winRate = returns.length ? returns.filter((r) => r > 0).length / returns.length : 0
  const bestDay = returns.length ? Math.max(...returns) : 0
  const worstDay = returns.length ? Math.min(...returns) : 0
  const avgTurnover = days.length ? days.reduce((a, d) => a + d.turnover, 0) / days.length : 0
  const avgHoldings = days.length ? days.reduce((a, d) => a + d.holdings.length, 0) / days.length : 0

  const startDate = points.length ? isoFromUtcSeconds(points[0].time) : ''
  const endDate = points.length ? isoFromUtcSeconds(points[points.length - 1].time) : ''
  const maxDrawdown = drawdowns.length ? Math.min(...drawdowns) : 0

  return {
    startDate,
    endDate,
    days: base.days,
    years,
    totalReturn,
    cagr: base.cagr,
    vol,
    maxDrawdown,
    sharpe: base.sharpe,
    winRate,
    bestDay,
    worstDay,
    avgTurnover,
    avgHoldings,
  }
}

const fetchOhlcSeries = async (ticker: string, limit: number): Promise<Array<{ time: UTCTimestamp; open: number; close: number }>> => {
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
  return candles.map((c) => ({ time: c.time as UTCTimestamp, open: Number(c.open), close: Number(c.close) }))
}

const buildPriceDb = (series: Array<{ ticker: string; bars: Array<{ time: UTCTimestamp; open: number; close: number }> }>): PriceDB => {
  const byTicker = new Map<string, Map<number, { open: number; close: number }>>()
  let overlapStart = 0
  let overlapEnd = Number.POSITIVE_INFINITY

  for (const s of series) {
    const t = getSeriesKey(s.ticker)
    const map = new Map<number, { open: number; close: number }>()
    for (const b of s.bars) map.set(Number(b.time), { open: Number(b.open), close: Number(b.close) })
    byTicker.set(t, map)

    const times = s.bars.map((b) => Number(b.time)).sort((a, b) => a - b)
    if (times.length === 0) continue
    overlapStart = Math.max(overlapStart, times[0])
    overlapEnd = Math.min(overlapEnd, times[times.length - 1])
  }

  if (!(overlapEnd >= overlapStart)) return { dates: [], open: {}, close: {} }

  let intersection: Set<number> | null = null
  for (const [, map] of byTicker) {
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

  const open: Record<string, Array<number | null>> = {}
  const close: Record<string, Array<number | null>> = {}
  for (const [ticker, map] of byTicker) {
    open[ticker] = dates.map((d) => (map.get(Number(d))?.open ?? null))
    close[ticker] = dates.map((d) => (map.get(Number(d))?.close ?? null))
  }

  return { dates, open, close }
}

const expandToNode = (node: FlowNode, targetId: string): { next: FlowNode; found: boolean } => {
  if (node.id === targetId) {
    return { next: node.collapsed ? { ...node, collapsed: false } : node, found: true }
  }
  let found = false
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  for (const slot of SLOT_ORDER[node.kind]) {
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
}: BacktesterPanelProps) {
  const [tab, setTab] = useState<'Overview' | 'Allocations' | 'Rebalances' | 'Warnings'>('Overview')
  const [selectedRange, setSelectedRange] = useState<VisibleRange | null>(null)
  const [logScale, setLogScale] = useState(true)
  const [rangePickerOpen, setRangePickerOpen] = useState(false)
  const [rangeStart, setRangeStart] = useState<string>('')
  const [rangeEnd, setRangeEnd] = useState<string>('')
  const rangePickerRef = useRef<HTMLDivElement | null>(null)
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

  const handleRun = useCallback(() => {
    // Reset to full period ("max") on each run.
    setSelectedRange(null)
    setRangePickerOpen(false)
    setRangeStart('')
    setRangeEnd('')
    onRun()
  }, [onRun])

  useEffect(() => {
    if (!rangePickerOpen) return
    const onDown = (e: MouseEvent) => {
      const el = rangePickerRef.current
      if (!el) return
      if (e.target && el.contains(e.target as Node)) return
      setRangePickerOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [rangePickerOpen])

  const rangeLabel = useMemo(() => {
    if (!visibleRange) return { start: '', end: '' }
    return { start: isoFromUtcSeconds(visibleRange.from), end: isoFromUtcSeconds(visibleRange.to) }
  }, [visibleRange])

  const applyPreset = (preset: '1m' | '3m' | '6m' | 'ytd' | '1y' | '5y' | 'max') => {
    if (!points.length) return
    if (preset === 'max') {
      setSelectedRange({ from: points[0].time, to: points[points.length - 1].time })
      return
    }

    const endTime = visibleRange?.to ?? points[points.length - 1].time
    const endDate = new Date(Number(endTime) * 1000)
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
  }

  const handleChartVisibleRangeChange = useCallback(
    (r: VisibleRange) => {
      if (!points.length) return
      const next = clampVisibleRangeToPoints(points, r)
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
    setRangePickerOpen(false)
  }, [points, rangeEnd, rangeStart])

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
    <section className="backtester-card">
      <div className="backtester-head">
        <div>
          <div className="eyebrow">Build</div>
          <h2 className="backtester-title">Backtester</h2>
        </div>
        <div className="backtester-controls">
          <label className="backtester-field">
            <span>Mode</span>
            <select value={mode} onChange={(e) => setMode(e.target.value as BacktesterPanelProps['mode'])}>
              <option value="CC">Close→Close</option>
              <option value="OO">Open→Open</option>
              <option value="OC">Open→Close</option>
              <option value="CO">Close→Open</option>
            </select>
          </label>
          <label className="backtester-field">
            <span>Cost (bps)</span>
            <input
              type="number"
              min={0}
              step={1}
              value={Number.isFinite(costBps) ? costBps : 0}
              onChange={(e) => setCostBps(Number(e.target.value || 0))}
            />
          </label>
          <label className="backtester-field">
            <span>Benchmark</span>
            <input
              list={TICKER_DATALIST_ID}
              value={benchmark}
              onChange={(e) => setBenchmark(e.target.value)}
              placeholder="SPY"
              spellCheck={false}
              style={{ width: 120 }}
            />
          </label>
          {!benchmarkKnown && benchmark.trim() ? (
            <div style={{ color: '#b91c1c', fontWeight: 800, fontSize: 12 }}>Unknown ticker</div>
          ) : null}
          <label className="backtester-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={showBenchmark} onChange={(e) => setShowBenchmark(e.target.checked)} />
            <span>Show benchmark</span>
          </label>
          <button onClick={handleRun} disabled={status === 'running'}>
            {status === 'running' ? 'Running…' : 'Run Backtest'}
          </button>
        </div>
      </div>
      <div className="backtester-body">
        <div className="backtester-tabs">
          {(['Overview', 'Allocations', 'Rebalances', 'Warnings'] as const).map((t) => (
            <button key={t} className={`tab-btn ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>

        {errors.length > 0 && (
          <div className="backtester-message" style={{ borderColor: '#fecaca', background: '#fef2f2', color: '#991b1b' }}>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Fix these errors before running:</div>
            <div style={{ display: 'grid', gap: 6 }}>
              {errors.map((e, idx) => (
                <button
                  key={`${e.nodeId}-${e.field}-${idx}`}
                  className="link-btn"
                  style={{ textAlign: 'left', color: 'inherit' }}
                  onClick={() => onJumpToError(e)}
                >
                  {e.message}
                </button>
              ))}
            </div>
          </div>
        )}

        {result && tab === 'Overview' ? (
          <>
            <div className="backtester-summary">
              <div className="stat-card">
                <div className="stat-label">Date range</div>
                <div className="stat-value">
                  {result.metrics.startDate} → {result.metrics.endDate}
                </div>
                <div className="stat-sub">{result.metrics.days} trading days</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Total return</div>
                <div className="stat-value">{formatPct(result.metrics.totalReturn)}</div>
                <div className="stat-sub">{result.metrics.years.toFixed(2)} yrs</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">CAGR</div>
                <div className="stat-value">{formatPct(result.metrics.cagr)}</div>
                <div className="stat-sub">Annualized (252)</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Max drawdown</div>
                <div className="stat-value">{formatPct(result.metrics.maxDrawdown)}</div>
                <div className="stat-sub">Peak-to-trough</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Sharpe</div>
                <div className="stat-value">{Number.isFinite(result.metrics.sharpe) ? result.metrics.sharpe.toFixed(2) : '—'}</div>
                <div className="stat-sub">Annualized (252)</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Vol (ann.)</div>
                <div className="stat-value">{formatPct(result.metrics.vol)}</div>
                <div className="stat-sub">Std dev × √252</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Win rate</div>
                <div className="stat-value">{formatPct(result.metrics.winRate)}</div>
                <div className="stat-sub">Daily</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Avg turnover</div>
                <div className="stat-value">{formatPct(result.metrics.avgTurnover)}</div>
                <div className="stat-sub">Per day</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Avg holdings</div>
                <div className="stat-value">{result.metrics.avgHoldings.toFixed(2)}</div>
                <div className="stat-sub">Tickers/day</div>
              </div>
            </div>

            <div className="equity-wrap">
              <div className="chart-toolbar">
                <div className="chart-presets">
                  <button onClick={() => applyPreset('1m')}>1m</button>
                  <button onClick={() => applyPreset('3m')}>3m</button>
                  <button onClick={() => applyPreset('6m')}>6m</button>
                  <button onClick={() => applyPreset('ytd')}>YTD</button>
                  <button onClick={() => applyPreset('1y')}>1yr</button>
                  <button onClick={() => applyPreset('5y')}>5yr</button>
                  <button onClick={() => applyPreset('max')}>Max</button>
                  <button className={logScale ? 'active' : ''} onClick={() => setLogScale((v) => !v)}>
                    Log
                  </button>
                </div>
              </div>
              <EquityChart
                points={result.points}
                benchmarkPoints={showBenchmark ? result.benchmarkPoints : undefined}
                markers={result.markers}
                visibleRange={visibleRange}
                logScale={logScale}
              />
            </div>

            <div className="drawdown-wrap">
              <div className="drawdown-head">
                <div style={{ fontWeight: 900 }}>Drawdown</div>
                <div className="range-picker" ref={rangePickerRef}>
                  <button
                    className="range-pill"
                    onClick={() => {
                      if (!rangePickerOpen && visibleRange) {
                        setRangeStart(isoFromUtcSeconds(visibleRange.from))
                        setRangeEnd(isoFromUtcSeconds(visibleRange.to))
                      }
                      setRangePickerOpen((v) => !v)
                    }}
                  >
                    {rangeLabel.start} → {rangeLabel.end}
                  </button>
                  {rangePickerOpen ? (
                    <div className="range-popover" role="dialog" aria-label="Choose date range">
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
                    </div>
                  ) : null}
                </div>
              </div>
              <DrawdownChart
                points={result.drawdownPoints}
                visibleRange={visibleRange}
              />
              {visibleRange ? (
                <RangeNavigator points={result.points} range={visibleRange} onChange={handleChartVisibleRangeChange} />
              ) : null}
            </div>

            {result.warnings.length > 0 && (
              <div className="backtester-message" style={{ borderColor: '#fde68a', background: '#fffbeb', color: '#92400e' }}>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>
                  Warnings ({result.warnings.length})
                </div>
                <div style={{ maxHeight: 140, overflow: 'auto', display: 'grid', gap: 4 }}>
                  {result.warnings.slice(0, 50).map((w, idx) => (
                    <div key={`${w.time}-${idx}`}>
                      {w.date}: {w.message}
                    </div>
                  ))}
                  {result.warnings.length > 50 ? <div>…</div> : null}
                </div>
              </div>
            )}

          </>
        ) : result && tab === 'Allocations' ? (
          <>
            <div className="saved-item">
              <div style={{ fontWeight: 900, marginBottom: 6 }}>Monthly returns</div>
              <div className="monthly-heatmap">{renderMonthlyHeatmap(result.monthly, result.days)}</div>
            </div>
            <div className="saved-item">
              <div style={{ fontWeight: 900, marginBottom: 6 }}>Allocation over time (top 10 + cash)</div>
              <AllocationChart series={allocationSeries} visibleRange={visibleRange} />
              <div className="backtester-legend">
                {allocationSeries.map((s) => (
                  <div key={s.name} className="legend-item">
                    <span className="legend-swatch" style={{ background: s.color }} />
                    <span>{s.name}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="saved-item">
              <div style={{ fontWeight: 900, marginBottom: 6 }}>Allocations (recent)</div>
              <div style={{ maxHeight: 280, overflow: 'auto', fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 12 }}>
                {(result.allocations || []).slice(-300).map((row) => (
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
              <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={() => downloadEquityCsv(result, mode, costBps, benchmark, showBenchmark)}>Download equity CSV</button>
                <button onClick={() => downloadAllocationsCsv(result)}>Download allocations CSV</button>
                <button onClick={() => downloadRebalancesCsv(result)}>Download rebalances CSV</button>
              </div>
            </div>
          </>
        ) : result && tab === 'Rebalances' ? (
          <div className="saved-item">
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Rebalance days ({rebalanceDays.length})</div>
            <div className="backtester-table">
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
                    <div style={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 12 }}>
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
        ) : result && tab === 'Warnings' ? (
          <div className="saved-item">
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Warnings ({result.warnings.length})</div>
            {groupedWarnings.length === 0 ? (
              <div style={{ color: '#475569' }}>No warnings.</div>
            ) : (
              <div className="backtester-table">
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

            {result.trace ? (
              <div style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ fontWeight: 900 }}>Condition trace (debug)</div>
                  <button onClick={() => downloadTextFile('backtest_trace.json', JSON.stringify(result.trace, null, 2), 'application/json')}>
                    Download trace JSON
                  </button>
                </div>
                <div style={{ marginTop: 8 }} className="backtester-table">
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
                        <div style={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 12 }}>{n.nodeId}</div>
                        <div>{n.kind}</div>
                        <div>{n.thenCount}</div>
                        <div>{n.elseCount}</div>
                        <div style={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 12 }}>
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
                  <div style={{ marginTop: 6, color: '#475569' }}>Showing first 80 nodes. Use Download trace JSON for the full set.</div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : status === 'running' ? (
          <div className="backtester-chart-placeholder">Running backtest…</div>
        ) : (
          <div className="backtester-chart-placeholder">
            Tip: Start `npm run api` so tickers and candles load. Use the tabs to see allocations and rebalances after running.
          </div>
        )}
      </div>
    </section>
  )
}

function App() {
  const [deviceTheme] = useState<ThemeMode>(() => loadDeviceThemeMode())

  const initialUserId: UserId | null = (() => {
    try {
      const v = localStorage.getItem(CURRENT_USER_KEY)
      return v === '1' || v === '9' ? (v as UserId) : null
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

  const [savedBots, setSavedBots] = useState<SavedBot[]>(() => initialUserData.savedBots)
  const [watchlists, setWatchlists] = useState<Watchlist[]>(() => initialUserData.watchlists)
  const [callChains, setCallChains] = useState<CallChain[]>(() => initialUserData.callChains)
  const [uiState, setUiState] = useState<UserUiState>(() => initialUserData.ui)
  const [analyzeBacktests, setAnalyzeBacktests] = useState<Record<string, AnalyzeBacktestState>>({})

  const theme = userId ? uiState.theme : deviceTheme

  const [availableTickers, setAvailableTickers] = useState<string[]>([])
  const [tickerApiError, setTickerApiError] = useState<string | null>(null)
  const [backtestMode, setBacktestMode] = useState<BacktestMode>('CC')
  const [backtestCostBps, setBacktestCostBps] = useState<number>(5)
  const [backtestBenchmark, setBacktestBenchmark] = useState<string>('SPY')
  const [backtestShowBenchmark, setBacktestShowBenchmark] = useState<boolean>(true)
  const [backtestStatus, setBacktestStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [backtestErrors, setBacktestErrors] = useState<BacktestError[]>([])
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null)
  const [backtestFocusNodeId, setBacktestFocusNodeId] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) return
    saveUserData(userId, { savedBots, watchlists, callChains, ui: uiState })
  }, [userId, savedBots, watchlists, callChains, uiState])


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

  const tickerOptions = useMemo(() => normalizeTickersForUi(availableTickers), [availableTickers])
  const backtestErrorNodeIds = useMemo(() => new Set(backtestErrors.map((e) => e.nodeId)), [backtestErrors])

  const createBotSession = useCallback((title: string): BotSession => {
    const root = ensureSlots(createNode('basic'))
    root.title = title
    return { id: `bot-${newId()}`, history: [root], historyIndex: 0 }
  }, [])

  const initialBot = useMemo(() => createBotSession('Algo Name Here'), [createBotSession])
  const [bots, setBots] = useState<BotSession[]>(() => [initialBot])
  const [activeBotId, setActiveBotId] = useState<string>(() => initialBot.id)
  const [clipboard, setClipboard] = useState<FlowNode | null>(null)
  const [tab, setTab] = useState<'Portfolio' | 'Community' | 'Analyze' | 'Build' | 'Admin'>('Build')
  const [analyzeSubtab, setAnalyzeSubtab] = useState<'Bots' | 'Correlation Tool'>('Bots')
  const [adminTab, setAdminTab] = useState<'Ticker List' | 'Data'>('Ticker List')
  const [saveMenuOpen, setSaveMenuOpen] = useState(false)
  const [saveNewWatchlistName, setSaveNewWatchlistName] = useState('')
  const [addToWatchlistBotId, setAddToWatchlistBotId] = useState<string | null>(null)
  const [addToWatchlistNewName, setAddToWatchlistNewName] = useState('')
  const [callPanelOpen, setCallPanelOpen] = useState(false)
  const [communityTopSort, setCommunityTopSort] = useState<CommunitySort>({ key: 'oosCagr', dir: 'desc' })
  const [communityWatchlistSort1, setCommunityWatchlistSort1] = useState<CommunitySort>({ key: 'name', dir: 'asc' })
  const [communityWatchlistSort2, setCommunityWatchlistSort2] = useState<CommunitySort>({ key: 'name', dir: 'asc' })

  const activeBot = useMemo(() => {
    return bots.find((b) => b.id === activeBotId) ?? bots[0]
  }, [bots, activeBotId])

  const current = activeBot.history[activeBot.historyIndex]

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

  const portfolioSnapshot = useMemo<PortfolioSnapshot>(() => {
    const basePositions = [
      { ticker: 'SPY', value: 42000, costBasis: 38000, todaysChange: 320 },
      { ticker: 'QQQ', value: 28500, costBasis: 25250, todaysChange: 210 },
      { ticker: 'IWM', value: 18200, costBasis: 19500, todaysChange: -140 },
      { ticker: 'TLT', value: 12500, costBasis: 11000, todaysChange: 65 },
    ]
    const cash = 9500
    const positionsValue = basePositions.reduce((sum, pos) => sum + pos.value, 0)
    const investedCapital = basePositions.reduce((sum, pos) => sum + pos.costBasis, 0)
    const enrichedPositions = basePositions.map((pos) => {
      const pnl = pos.value - pos.costBasis
      const allocation = positionsValue > 0 ? pos.value / positionsValue : 0
      const pnlPct = pos.costBasis > 0 ? pnl / pos.costBasis : 0
      return { ...pos, allocation, pnl, pnlPct }
    })
    const totalPnl = enrichedPositions.reduce((sum, pos) => sum + pos.pnl, 0)
    const accountValue = cash + positionsValue
    const todaysChange = basePositions.reduce((sum, pos) => sum + pos.todaysChange, 0)
    const previousValue = accountValue - todaysChange
    const todaysChangePct = previousValue > 0 ? todaysChange / previousValue : 0

    const sampleBots: PortfolioBotRow[] = [
      { id: 'sample-alpha', name: 'Momentum Swing', allocation: 0.32, capital: 36000, pnl: 3100, tags: ['Default'] },
      { id: 'sample-beta', name: 'Rate Hedge', allocation: 0.24, capital: 27000, pnl: -850, tags: ['Hedges'] },
      { id: 'sample-gamma', name: 'Rotation Grid', allocation: 0.22, capital: 24500, pnl: 1400, tags: ['Default'] },
      { id: 'sample-delta', name: 'Vol Carry', allocation: 0.18, capital: 21000, pnl: 620, tags: ['Growth'] },
    ]

    const saved = savedBots.slice(0, sampleBots.length)
    const bots: PortfolioBotRow[] = saved.length
      ? saved.map((bot, index) => {
          const template = sampleBots[index % sampleBots.length]
          const tagNames = (watchlistsByBotId.get(bot.id) ?? []).map((wl) => wl.name)
          return {
            ...template,
            id: bot.id,
            name: bot.name,
            tags: tagNames.length ? tagNames : template.tags,
            readonly: bot.visibility === 'community',
          }
        })
      : sampleBots

    return {
      accountValue,
      cash,
      totalPnl,
      totalPnlPct: investedCapital > 0 ? totalPnl / investedCapital : 0,
      todaysChange,
      todaysChangePct,
      positions: enrichedPositions,
      bots,
    }
  }, [savedBots, watchlistsByBotId])

  const {
    accountValue,
    cash,
    totalPnl,
    totalPnlPct,
    todaysChange,
    todaysChangePct,
    positions,
    bots: investedBots,
  } = portfolioSnapshot

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
      const next = replaceSlot(current, parentId, slot, index, ensureSlots(createNode(kind)))
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
          return [nb]
        }
        if (botId === activeBotId) {
          setActiveBotId(filtered[0].id)
          setClipboard(null)
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
    },
    [current],
  )

  const handlePaste = useCallback(
    (parentId: string, slot: SlotId, index: number, child: FlowNode) => {
      const next = replaceSlot(current, parentId, slot, index, ensureSlots(regenerateIds(cloneNode(child))))
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

  const handleJumpToBacktestError = useCallback(
    (err: BacktestError) => {
      setBacktestFocusNodeId(err.nodeId)
      const expanded = expandToNode(current, err.nodeId)
      if (expanded.found) push(expanded.next)
      setTimeout(() => {
        document.getElementById(`node-${err.nodeId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 30)
    },
    [current, push],
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

      const loaded = await Promise.all(inputs.tickers.map(async (t) => ({ ticker: t, bars: await fetchOhlcSeries(t, limit) })))
      const benchSettled = benchPromise ? await Promise.allSettled([benchPromise]) : []

      const db = buildPriceDb(loaded)
      if (db.dates.length < 3) {
        throw makeValidationError([{ nodeId: prepared.id, field: 'data', message: 'Not enough overlapping price data to run a backtest.' }])
      }

      const cache = emptyCache()
      const warnings: BacktestWarning[] = []
      const trace = createBacktestTraceCollector()

      let benchBars: Array<{ time: UTCTimestamp; open: number; close: number }> | null = null
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

      const benchMap = new Map<number, { open: number; close: number }>()
      if (benchBars) {
        for (const b of benchBars) benchMap.set(Number(b.time), { open: b.open, close: b.close })
      }

      const allocationsAt: Allocation[] = Array.from({ length: db.dates.length }, () => ({}))
      const lookback = Math.max(0, Math.floor(Number(inputs.maxLookback || 0)))
      const startEvalIndex = decisionPrice === 'open' ? (lookback > 0 ? lookback + 1 : 0) : lookback

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
      }

      const startTradeIndex = startEvalIndex
      const startPointIndex = backtestMode === 'OC' ? Math.max(0, startTradeIndex - 1) : startTradeIndex
      const points: EquityPoint[] = [{ time: db.dates[startPointIndex], value: 1 }]
      const benchmarkPoints: EquityPoint[] = benchMap.size ? [{ time: db.dates[startPointIndex], value: 1 }] : []
      const drawdownPoints: EquityPoint[] = [{ time: db.dates[startPointIndex], value: 0 }]
      const markers: EquityMarker[] = []
      const allocations: BacktestAllocationRow[] = []
      const returns: number[] = []
      const days: BacktestDayRow[] = []

      let equity = 1
      let peak = 1
      let benchEquity = 1
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
          const entry =
            backtestMode === 'OO'
              ? openArr?.[start]
              : backtestMode === 'CC'
                ? closeArr?.[start]
                : backtestMode === 'CO'
                  ? closeArr?.[start]
                  : openArr?.[start]
          const exit =
            backtestMode === 'OO'
              ? openArr?.[end]
              : backtestMode === 'CC'
                ? closeArr?.[end]
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

        allocations.push({
          date: isoFromUtcSeconds(db.dates[end]),
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
                ? startBar?.close
                : backtestMode === 'CO'
                  ? startBar?.close
                  : startBar?.open
          const exitBench =
            backtestMode === 'OO'
              ? endBar?.open
              : backtestMode === 'CC'
                ? endBar?.close
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
        })
      }

      const metrics = computeBacktestSummary(points, days.map((d) => d.drawdown), days)
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
    setBacktestStatus('running')
    setBacktestFocusNodeId(null)
    setBacktestResult(null)
    setBacktestErrors([])
    try {
      const { result } = await runBacktestForNode(current)
      setBacktestResult(result)
      setBacktestStatus('done')
    } catch (e) {
      if (isValidationError(e)) {
        setBacktestErrors(e.errors)
      } else {
        const msg = String((e as Error)?.message || e)
        const friendly = msg.includes('Failed to fetch') ? `${msg}. Is the backend running? (npm run api)` : msg
        setBacktestErrors([{ nodeId: current.id, field: 'backtest', message: friendly }])
      }
      setBacktestStatus('error')
    }
  }, [current, runBacktestForNode])
  const handleNewBot = () => {
    const bot = createBotSession('Algo Name Here')
    setBots((prev) => [...prev, bot])
    setActiveBotId(bot.id)
    setClipboard(null)
  }

  const handleExport = useCallback(() => {
    if (!current) return
    const json = JSON.stringify(current, null, 2)
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

  const resolveWatchlistId = useCallback(
    (watchlistNameOrId: string): string => {
      const raw = String(watchlistNameOrId || '').trim()
      if (!raw) return watchlists.find((w) => w.name === 'Default')?.id ?? watchlists[0]?.id ?? `wl-${newId()}`
      const byId = watchlists.find((w) => w.id === raw)
      if (byId) return byId.id
      const byName = watchlists.find((w) => w.name.toLowerCase() === raw.toLowerCase())
      if (byName) return byName.id
      const id = `wl-${newId()}`
      setWatchlists((prev) => ensureDefaultWatchlist([{ id, name: raw, botIds: [] }, ...prev]))
      return id
    },
    [watchlists],
  )

  const addBotToWatchlist = useCallback((botId: string, watchlistId: string) => {
    setWatchlists((prev) =>
      prev.map((w) => {
        if (w.id !== watchlistId) return w
        if (w.botIds.includes(botId)) return w
        return { ...w, botIds: [...w.botIds, botId] }
      }),
    )
  }, [])

  const removeBotFromWatchlist = useCallback((botId: string, watchlistId: string) => {
    setWatchlists((prev) =>
      prev.map((w) => (w.id === watchlistId ? { ...w, botIds: w.botIds.filter((id) => id !== botId) } : w)),
    )
  }, [])

  const activeSavedBotId = activeBot?.savedBotId

  const handleSaveToWatchlist = useCallback(
    (watchlistNameOrId: string) => {
      if (!current) return
      if (!userId) return
      const watchlistId = resolveWatchlistId(watchlistNameOrId)
      const payload = ensureSlots(cloneNode(current))
      const now = Date.now()

      let savedBotId = activeSavedBotId

      if (!savedBotId) {
        savedBotId = `saved-${newId()}`
        const entry: SavedBot = {
          id: savedBotId,
          name: current.title || 'Algo',
          builderId: userId,
          payload,
          visibility: 'private',
          createdAt: now,
        }
        setSavedBots((prev) => [entry, ...prev])
        setBots((prev) => prev.map((b) => (b.id === activeBotId ? { ...b, savedBotId } : b)))
      } else {
        setSavedBots((prev) =>
          prev.map((b) =>
            b.id === savedBotId
              ? { ...b, payload, name: current.title || b.name || 'Algo', builderId: b.builderId ?? userId }
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
    },
    [current, activeBotId, activeSavedBotId, resolveWatchlistId, addBotToWatchlist, userId],
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
    async (bot: SavedBot) => {
      setAnalyzeBacktests((prev) => {
        if (prev[bot.id]?.status === 'loading') return prev
        return { ...prev, [bot.id]: { status: 'loading' } }
      })
      try {
        const { result } = await runBacktestForNode(bot.payload)
        setAnalyzeBacktests((prev) => ({ ...prev, [bot.id]: { status: 'done', result } }))
      } catch (err) {
        let message = String((err as Error)?.message || err)
        if (isValidationError(err)) {
          message = err.errors.map((e: BacktestError) => e.message).join(', ')
        }
        setAnalyzeBacktests((prev) => ({ ...prev, [bot.id]: { status: 'error', error: message } }))
      }
    },
    [runBacktestForNode],
  )

  useEffect(() => {
    savedBots.forEach((bot) => {
      if (uiState.analyzeCollapsedByBotId[bot.id] === false) {
        const state = analyzeBacktests[bot.id]
        if (!state || state.status === 'idle' || state.status === 'error') {
          runAnalyzeBacktest(bot)
        }
      }
    })
  }, [savedBots, uiState.analyzeCollapsedByBotId, analyzeBacktests, runAnalyzeBacktest])

  const handleAddCallChain = useCallback(() => {
    const id = `call-${newId()}`
    const root = ensureSlots(createNode('basic'))
    root.title = 'Call'
    const name = `Call ${callChains.length + 1}`
    setCallChains((prev) => [{ id, name, root, collapsed: false }, ...prev])
    setCallPanelOpen(true)
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
        alert('Community bots cannot be copied/exported.')
        return
      }
      const ensured = ensureSlots(cloneNode(bot.payload))
      setClipboard(ensured)
      const json = JSON.stringify(bot.payload, null, 2)
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

  const handleDeleteSaved = useCallback((id: string) => {
    setSavedBots((prev) => prev.filter((b) => b.id !== id))
    setWatchlists((prev) => prev.map((w) => ({ ...w, botIds: w.botIds.filter((x) => x !== id) })))
  }, [])

  const handleOpenSaved = useCallback(
    (bot: SavedBot) => {
      if (bot.visibility === 'community') {
        alert('Community bots cannot be opened in Build.')
        return
      }
      const payload = ensureSlots(cloneNode(bot.payload))
      const session: BotSession = { id: `bot-${newId()}`, history: [payload], historyIndex: 0, savedBotId: bot.id }
      setBots((prev) => [...prev, session])
      setActiveBotId(session.id)
      setTab('Build')
    },
    [setTab],
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
        const text = await file.text()
        const parsed = JSON.parse(text) as FlowNode
        const ensured = ensureSlots(parsed)
        setBots((prev) =>
          prev.map((b) => (b.id === activeBot.id ? { ...b, history: [ensured], historyIndex: 0 } : b)),
        )
        setClipboard(null)
      } catch {
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
    const data = loadUserData(nextUser)
    setUserId(nextUser)
    setSavedBots(data.savedBots)
    setWatchlists(data.watchlists)
    setCallChains(data.callChains)
    setUiState(data.ui)
    setAnalyzeBacktests({})
    setTab('Build')
  }

  const handleLogout = () => {
    try {
      localStorage.removeItem(CURRENT_USER_KEY)
    } catch {
      // ignore
    }
    setUserId(null)
    setSavedBots([])
    setWatchlists([])
    setCallChains([])
    setUiState(defaultUiState())
    setAnalyzeBacktests({})
    setTab('Build')
    setSaveMenuOpen(false)
    setAddToWatchlistBotId(null)
  }

  if (!userId) {
    return (
      <div className={`app ${theme === 'dark' ? 'theme-dark' : ''}`}>
        <LoginScreen onLogin={handleLogin} />
      </div>
    )
  }

  return (
    <div className={`app ${theme === 'dark' ? 'theme-dark' : ''}`}>
      <header className="app-header">
        <div>
          <div className="eyebrow">System</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ marginRight: 4 }}>System.app</h1>
            <button
              onClick={() => setUiState((prev) => ({ ...prev, theme: prev.theme === 'dark' ? 'light' : 'dark' }))}
              style={{ padding: '6px 10px', fontSize: 12 }}
              title="Toggle light/dark mode"
            >
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </button>
          </div>
          <p className="lede">Click any Node or + to extend with Basic, Function, Indicator, or Position. Paste uses the last copied node.</p>
          <div className="tabs">
            {(['Portfolio', 'Community', 'Analyze', 'Build', 'Admin'] as const).map((t) => (
              <button key={t} className={`tab-btn ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              Logged in as <span style={{ fontWeight: 800 }}>{userId}</span>
            </div>
            <button
              onClick={() => {
                if (!confirm(`Clear saved data for user ${userId}? This will remove saved bots, watchlists, and UI state.`)) return
                try {
                  localStorage.removeItem(userDataKey(userId))
                } catch {
                  // ignore
                }
                const data = loadUserData(userId)
                setSavedBots(data.savedBots)
                setWatchlists(data.watchlists)
                setCallChains(data.callChains)
                setUiState(data.ui)
                setAnalyzeBacktests({})
              }}
              style={{ padding: '6px 10px', fontSize: 12 }}
              title="Clear all locally saved data for this user"
            >
              Clear Data
            </button>
            <button onClick={handleLogout} style={{ padding: '6px 10px', fontSize: 12 }}>
              Logout
            </button>
          </div>
          {tab === 'Build' && (
            <div className="build-actions">
              <button onClick={handleNewBot}>New Bot</button>
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <button
                  onClick={() => setSaveMenuOpen((v) => !v)}
                  title="Save this bot to a watchlist"
                >
                  Save to Watchlist
                </button>
                {saveMenuOpen ? (
                  <div
                    className="menu"
                    style={{ position: 'absolute', top: '100%', left: 0, zIndex: 50, minWidth: 240 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {watchlists.map((w) => (
                      <button key={w.id} onClick={() => handleSaveToWatchlist(w.id)}>
                        {w.name}
                      </button>
                    ))}
                    <div style={{ padding: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>New watchlist</div>
                      <input
                        value={saveNewWatchlistName}
                        placeholder="Type a name…"
                        onChange={(e) => setSaveNewWatchlistName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveToWatchlist(saveNewWatchlistName)
                        }}
                        style={{ width: '100%' }}
                      />
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <button onClick={() => handleSaveToWatchlist(saveNewWatchlistName)} style={{ flex: 1 }}>
                          Save
                        </button>
                        <button
                          onClick={() => {
                            setSaveMenuOpen(false)
                            setSaveNewWatchlistName('')
                          }}
                          style={{ flex: 1 }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
              <button onClick={() => setTab('Analyze')}>Open</button>
              <button onClick={handleImport}>Import</button>
              <button onClick={handleExport}>Export</button>
            </div>
          )}
          {tab === 'Build' && (
            <div className="bot-tabs">
              {bots.map((b) => {
                const root = b.history[b.historyIndex] ?? b.history[0]
                const label = root?.title || 'Untitled'
                return (
                  <div key={b.id} className={`bot-tab-wrapper ${b.id === activeBotId ? 'active' : ''}`}>
                    <button
                      className="bot-tab-btn"
                      onClick={() => setActiveBotId(b.id)}
                    >
                      {label}
                    </button>
                    <button
                      className="bot-tab-close"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleCloseBot(b.id)
                      }}
                    >
                      ✕
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <div className="header-actions">
          <button onClick={undo} disabled={!activeBot || activeBot.historyIndex === 0}>
            Undo
          </button>
          <button
            onClick={redo}
            disabled={!activeBot || activeBot.historyIndex === activeBot.history.length - 1}
          >
            Redo
          </button>
        </div>
      </header>
      {tickerApiError && (
        <div className="api-warning">
          <span>{tickerApiError}</span>
        </div>
      )}
      <TickerDatalist id={TICKER_DATALIST_ID} options={tickerOptions} />
      <main className="canvas">
        {tab === 'Build' ? (
          <div className="build-layout">
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
             />
            <div
              className="build-code-zone-scroll"
              onWheel={(e) => {
                if (!e.shiftKey) return
                e.preventDefault()
                e.currentTarget.scrollLeft += e.deltaY
              }}
              title="Tip: hold Shift and use mouse wheel to scroll horizontally"
            >
              <div style={{ position: 'relative' }}>
                <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, zIndex: 4, pointerEvents: 'none' }}>
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      right: 0,
                      width: 56,
                      bottom: 0,
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderLeft: callPanelOpen ? 'none' : '1px solid var(--border)',
                      borderRadius: callPanelOpen ? '0 14px 14px 0' : '14px',
                      boxShadow: '0 12px 28px rgba(15, 23, 42, 0.12)',
                      overflow: 'hidden',
                      zIndex: 2,
                      pointerEvents: 'auto',
                    }}
                  >
                    <button
                      onClick={() => setCallPanelOpen((v) => !v)}
                      style={{
                        width: '100%',
                        height: '100%',
                        border: 'none',
                        borderRadius: 0,
                        background: 'var(--surface)',
                        color: 'var(--text)',
                        fontWeight: 900,
                        writingMode: 'vertical-rl',
                        textOrientation: 'mixed',
                        letterSpacing: '0.08em',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      title={callPanelOpen ? 'Collapse call node zone' : 'Open call node zone'}
                    >
                      <div style={{ pointerEvents: 'none' }}>Callback Node Zone</div>
                    </button>
                  </div>

                  {callPanelOpen ? (
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        right: 56,
                        width: 'min(90vw, 1400px)',
                        bottom: 0,
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRight: 'none',
                        borderRadius: '14px 0 0 14px',
                        boxShadow: '0 12px 28px rgba(15, 23, 42, 0.12)',
                        padding: 12,
                        overflow: 'auto',
                        zIndex: 1,
                        pointerEvents: 'auto',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ fontWeight: 900 }}>Calls</div>
                        <button className="icon-btn" onClick={() => setCallPanelOpen(false)} title="Collapse">
                          Collapse
                        </button>
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        <button onClick={handleAddCallChain}>Make new Call</button>
                      </div>
                      <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
                        {callChains.length === 0 ? (
                          <div style={{ color: '#64748b' }}>No call chains yet.</div>
                        ) : (
                          callChains.map((c) => (
                            <div key={c.id} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 10 }}>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <input value={c.name} onChange={(e) => handleRenameCallChain(c.id, e.target.value)} style={{ flex: 1 }} />
                                <button className="icon-btn" onClick={() => handleToggleCallChainCollapse(c.id)}>
                                  {c.collapsed ? 'Expand' : 'Collapse'}
                                </button>
                                <button
                                  className="icon-btn"
                                  onClick={async () => {
                                    try {
                                      await navigator.clipboard.writeText(c.id)
                                    } catch {
                                      // ignore
                                    }
                                  }}
                                  title="Copy call ID"
                                >
                                  Copy ID
                                </button>
                                <button
                                  className="icon-btn delete"
                                  onClick={() => {
                                    if (!confirm(`Delete call chain "${c.name}"?`)) return
                                    handleDeleteCallChain(c.id)
                                  }}
                                  title="Delete call chain"
                                >
                                  X
                                </button>
                              </div>
                              <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>ID: {c.id}</div>
                              {!c.collapsed ? (
                                <div style={{ marginTop: 10 }}>
                                  <NodeCard
                                    node={c.root}
                                    depth={0}
                                    tickerOptions={tickerOptions}
                                    onAdd={(parentId, slot, index, kind) => {
                                      const next = replaceSlot(c.root, parentId, slot, index, ensureSlots(createNode(kind)))
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
                                      const next = replaceSlot(c.root, parentId, slot, index, ensureSlots(regenerateIds(cloneNode(child))))
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
                                    callChains={callChains}
                                    onUpdateCallRef={(id, callId) => {
                                      const next = updateCallReference(c.root, id, callId)
                                      pushCallChain(c.id, next)
                                    }}
                                  />
                                </div>
                              ) : null}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div style={{ overflow: 'auto' }}>
                  <NodeCard
                    node={current}
                    depth={0}
                    errorNodeIds={backtestErrorNodeIds}
                    focusNodeId={backtestFocusNodeId}
                    tickerOptions={tickerOptions}
                    onAdd={handleAdd}
                    onAppend={handleAppend}
                    onRemoveSlotEntry={handleRemoveSlotEntry}
                    onDelete={handleDelete}
                    onCopy={handleCopy}
                    onPaste={handlePaste}
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
                    callChains={callChains}
                    onUpdateCallRef={handleUpdateCallRef}
                  />
                </div>
              </div>
            </div>
          </div>
        ) : tab === 'Admin' ? (
          <AdminPanel
            adminTab={adminTab}
            setAdminTab={setAdminTab}
            onTickersUpdated={(next) => {
              setAvailableTickers(next)
            }}
          />
        ) : tab === 'Analyze' ? (
          <div className="placeholder">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 900 }}>Analyze</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['Bots', 'Correlation Tool'] as const).map((t) => (
                    <button
                      key={t}
                      className={`tab-btn ${analyzeSubtab === t ? 'active' : ''}`}
                      onClick={() => setAnalyzeSubtab(t)}
                      style={{ padding: '6px 10px', fontSize: 12 }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>Filter</div>
                <select
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
                </select>
              </label>
            </div>

            {analyzeSubtab === 'Correlation Tool' ? (
              <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                <div className="saved-item" style={{ display: 'grid', placeItems: 'center', minHeight: 220, fontWeight: 900 }}>
                  Placeholder Text: Invested Systems
                </div>
                <div className="saved-item" style={{ display: 'grid', placeItems: 'center', minHeight: 220, fontWeight: 900 }}>
                  Placeholder Text: Community suggestions based on filters (Beta, Correlation, Volatility weighting)
                </div>
                <div className="saved-item" style={{ display: 'grid', placeItems: 'center', minHeight: 220, fontWeight: 900 }}>
                  Combined portfolio and allocations based on suggestions
                </div>
              </div>
            ) : null}

            {analyzeSubtab !== 'Bots' ? null : (
              <>
                {analyzeVisibleBotIds.length === 0 ? (
              <div style={{ marginTop: 12, color: 'var(--muted)' }}>No bots in your watchlists yet.</div>
            ) : (
              <div className="saved-list" style={{ marginTop: 12 }}>
                {analyzeVisibleBotIds
                  .map((id) => savedBots.find((b) => b.id === id))
                  .filter((b): b is SavedBot => Boolean(b))
                  .map((b) => {
                    const collapsed = uiState.analyzeCollapsedByBotId[b.id] ?? true
                    const analyzeState = analyzeBacktests[b.id]
                    const tags = watchlistsByBotId.get(b.id) ?? []
                    return (
                      <div key={b.id} className="saved-item" style={{ display: 'grid', gap: 10 }}>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                          <button
                            onClick={() => {
                              const next = !(uiState.analyzeCollapsedByBotId[b.id] ?? true)
                              setUiState((prev) => ({
                                ...prev,
                                analyzeCollapsedByBotId: { ...prev.analyzeCollapsedByBotId, [b.id]: next },
                              }))
                              if (!next) runAnalyzeBacktest(b)
                            }}
                            style={{ padding: '6px 10px' }}
                          >
                            {collapsed ? 'Expand' : 'Collapse'}
                          </button>
                          <div style={{ fontWeight: 900 }}>{b.name}</div>
                          <span className={`bot-tag ${b.visibility === 'community' ? 'muted' : ''}`}>
                            {b.visibility === 'community' ? 'Community' : 'Private'}
                          </span>
                          <span className="bot-tag">Builder: {b.builderId}</span>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {tags.map((w) => (
                              <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 999, background: '#eff6ff', fontSize: 12, fontWeight: 800 }}>
                                {w.name}
                                <button
                                  className="icon-btn delete inline"
                                  onClick={() => removeBotFromWatchlist(b.id, w.id)}
                                  title={`Remove from ${w.name}`}
                                >
                                  X
                                </button>
                              </div>
                            ))}
                          </div>
                          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {b.visibility !== 'community' ? (
                              <button onClick={() => handleOpenSaved(b)}>Open in Build</button>
                            ) : null}
                            <button
                              onClick={() => {
                                setAddToWatchlistBotId(b.id)
                                setAddToWatchlistNewName('')
                              }}
                            >
                              Add to Watchlist
                            </button>
                            {b.visibility !== 'community' ? (
                              <button onClick={() => handleCopySaved(b)}>Copy</button>
                            ) : null}
                            <button onClick={() => handleDeleteSaved(b.id)}>Delete</button>
                          </div>
                        </div>

                        {!collapsed ? (
                          <div style={{ display: 'grid', gap: 14 }}>
                            {analyzeState?.status === 'loading' ? (
                              <div style={{ color: '#64748b' }}>Running backtest…</div>
                            ) : analyzeState?.status === 'error' ? (
                              <div style={{ display: 'grid', gap: 8 }}>
                                <div style={{ color: '#b91c1c', fontWeight: 800 }}>{analyzeState.error ?? 'Failed to run backtest.'}</div>
                                <button onClick={() => runAnalyzeBacktest(b)}>Retry</button>
                              </div>
                            ) : analyzeState?.status === 'done' ? (
                              <>
                                <div>
                                  <div style={{ fontWeight: 900, marginBottom: 8 }}>OOS Stats</div>
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                                    <div>
                                      <div className="stat-label">Total Return</div>
                                      <div className="stat-value">{formatPct(0)}</div>
                                    </div>
                                    <div>
                                      <div className="stat-label">CAGR</div>
                                      <div className="stat-value">{formatPct(0)}</div>
                                    </div>
                                    <div>
                                      <div className="stat-label">Max Drawdown</div>
                                      <div className="stat-value">{formatPct(0)}</div>
                                    </div>
                                    <div>
                                      <div className="stat-label">Sharpe</div>
                                      <div className="stat-value">{(0).toFixed(2)}</div>
                                    </div>
                                  </div>
                                </div>

                                <div>
                                  <div style={{ fontWeight: 900, marginBottom: 6 }}>Backtest Snapshot</div>
                                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>Benchmark: {backtestBenchmark}</div>
                                  <EquityChart
                                    points={analyzeState.result?.points ?? []}
                                    benchmarkPoints={analyzeState.result?.benchmarkPoints}
                                    markers={analyzeState.result?.markers ?? []}
                                    logScale
                                    showCursorStats={false}
                                    heightPx={390}
                                  />
                                  <div style={{ marginTop: 10 }}>
                                    <DrawdownChart points={analyzeState.result?.drawdownPoints ?? []} />
                                  </div>
                                </div>

                                <div>
                                  <div style={{ fontWeight: 900, marginBottom: 8 }}>Hist Stats</div>
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(160px, 1fr))', gap: 10, overflowX: 'auto' }}>
                                    <div>
                                      <div className="stat-label">CAGR</div>
                                      <div className="stat-value">{formatPct(analyzeState.result?.metrics.cagr ?? NaN)}</div>
                                    </div>
                                    <div>
                                      <div className="stat-label">MaxDD</div>
                                      <div className="stat-value">{formatPct(analyzeState.result?.metrics.maxDrawdown ?? NaN)}</div>
                                    </div>
                                    <div>
                                      <div className="stat-label">Sharpe</div>
                                      <div className="stat-value">
                                        {Number.isFinite(analyzeState.result?.metrics.sharpe ?? NaN)
                                          ? (analyzeState.result?.metrics.sharpe ?? 0).toFixed(2)
                                          : '—'}
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
                                          : '—'}
                                      </div>
                                    </div>
                                    <div>
                                      <div className="stat-label">Trading Days</div>
                                      <div className="stat-value">{analyzeState.result?.metrics.days ?? '—'}</div>
                                    </div>
                                  </div>
                                  <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
                                    Period: {analyzeState.result?.metrics.startDate ?? '—'} — {analyzeState.result?.metrics.endDate ?? '—'}
                                  </div>
                                </div>
                              </>
                            ) : (
                              <button onClick={() => runAnalyzeBacktest(b)}>Run backtest</button>
                            )}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
              </div>
            )}
              </>
            )}
          </div>
        ) : tab === 'Community' ? (
          <div className="placeholder">
            {(() => {
              const firstWatchlistId = watchlists[0]?.id ?? null
              const secondWatchlistId = watchlists[1]?.id ?? firstWatchlistId

              const slot1Id =
                uiState.communityWatchlistSlot1Id && watchlistsById.has(uiState.communityWatchlistSlot1Id)
                  ? uiState.communityWatchlistSlot1Id
                  : firstWatchlistId
              const slot2Id =
                uiState.communityWatchlistSlot2Id && watchlistsById.has(uiState.communityWatchlistSlot2Id)
                  ? uiState.communityWatchlistSlot2Id
                  : secondWatchlistId

              const rowsForWatchlist = (watchlistId: string | null): CommunityBotRow[] => {
                if (!watchlistId) return []
                const wl = watchlistsById.get(watchlistId)
                if (!wl) return []
                const out: CommunityBotRow[] = []
                for (const botId of wl.botIds || []) {
                  const bot = savedBots.find((b) => b.id === botId)
                  if (!bot) continue
                  const tagNames = (watchlistsByBotId.get(bot.id) ?? []).map((w) => w.name)
                  const tags = [bot.visibility === 'community' ? 'Community' : 'Private', `Builder: ${bot.builderId}`, ...tagNames]
                  out.push({
                    id: bot.id,
                    name: bot.name,
                    tags,
                    oosCagr: 0,
                    oosMaxdd: 0,
                    oosSharpe: 0,
                  })
                }
                return out
              }

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

              const renderTable = (
                rows: CommunityBotRow[],
                sort: CommunitySort,
                setSort: Dispatch<SetStateAction<CommunitySort>>,
                opts?: { emptyMessage?: string; headerOnly?: boolean },
              ) => {
                const arrow = (k: CommunitySortKey) => (sort.key === k ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '')
                const sorted = sortRows(rows, sort)
                return (
                  <table className="portfolio-table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => setSort((p) => nextCommunitySort(p, 'name'))}>
                          Name{arrow('name')}
                        </th>
                        <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => setSort((p) => nextCommunitySort(p, 'tags'))}>
                          Tags{arrow('tags')}
                        </th>
                        <th
                          style={{ cursor: 'pointer', userSelect: 'none', textAlign: 'right' }}
                          onClick={() => setSort((p) => nextCommunitySort(p, 'oosCagr'))}
                        >
                          OOS CAGR{arrow('oosCagr')}
                        </th>
                        <th
                          style={{ cursor: 'pointer', userSelect: 'none', textAlign: 'right' }}
                          onClick={() => setSort((p) => nextCommunitySort(p, 'oosMaxdd'))}
                        >
                          OOS MaxDD{arrow('oosMaxdd')}
                        </th>
                        <th
                          style={{ cursor: 'pointer', userSelect: 'none', textAlign: 'right' }}
                          onClick={() => setSort((p) => nextCommunitySort(p, 'oosSharpe'))}
                        >
                          OOS Sharpe{arrow('oosSharpe')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {opts?.headerOnly
                        ? null
                        : sorted.length === 0
                          ? (
                              <tr>
                                <td colSpan={5} style={{ color: 'var(--muted)' }}>
                                  {opts?.emptyMessage ?? 'No bots yet.'}
                                </td>
                              </tr>
                            )
                          : sorted.map((r) => (
                              <tr key={r.id}>
                                <td>{r.name}</td>
                                <td>
                                  <div className="bot-tags" style={{ marginTop: 0 }}>
                                    {r.tags.map((t) => (
                                      <span key={`${r.id}-${t}`} className={`bot-tag ${t === 'Community' ? 'muted' : ''}`}>
                                        {t}
                                      </span>
                                    ))}
                                  </div>
                                </td>
                                <td style={{ textAlign: 'right' }}>{formatPct(r.oosCagr)}</td>
                                <td style={{ textAlign: 'right' }}>{formatPct(r.oosMaxdd)}</td>
                                <td style={{ textAlign: 'right' }}>{Number.isFinite(r.oosSharpe) ? r.oosSharpe.toFixed(2) : '—'}</td>
                              </tr>
                            ))}
                    </tbody>
                  </table>
                )
              }

              const watchlistSelect = (currentId: string | null, onChange: (id: string | null) => void) => (
                <select
                  value={currentId ?? ''}
                  onChange={(e) => onChange(e.target.value ? e.target.value : null)}
                  style={{ padding: '6px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
                >
                  {watchlists.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              )

              return (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: 12,
                    minHeight: 'calc(100vh - 260px)',
                    alignItems: 'stretch',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ fontWeight: 900 }}>Top Community Bots</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
                      <div
                        className="saved-item"
                        style={{
                          flex: 1,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'stretch',
                          justifyContent: 'flex-start',
                          gap: 10,
                          overflow: 'hidden',
                        }}
                      >
                        <div style={{ fontWeight: 900 }}>Top community bots by CAGR</div>
                        {renderTable([], communityTopSort, setCommunityTopSort, { headerOnly: true })}
                      </div>
                      <div
                        className="saved-item"
                        style={{
                          flex: 1,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'stretch',
                          justifyContent: 'flex-start',
                          gap: 10,
                          overflow: 'hidden',
                        }}
                      >
                        <div style={{ fontWeight: 900 }}>Top community bots by Calmar Ratio</div>
                        {renderTable([], communityTopSort, setCommunityTopSort, { headerOnly: true })}
                      </div>
                      <div
                        className="saved-item"
                        style={{
                          flex: 1,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'stretch',
                          justifyContent: 'flex-start',
                          gap: 10,
                          overflow: 'hidden',
                        }}
                      >
                        <div style={{ fontWeight: 900 }}>Top community bots by Sharpe Ratio</div>
                        {renderTable([], communityTopSort, setCommunityTopSort, { headerOnly: true })}
                      </div>
                    </div>
                  </div>

                  <div style={{ gridColumn: '2 / span 2', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div className="saved-item" style={{ flex: 2, display: 'grid', placeItems: 'center', fontWeight: 900 }}>
                      News and Select Bots
                    </div>
                    <div className="saved-item" style={{ flex: 1, display: 'grid', placeItems: 'center', fontWeight: 900 }}>
                      Search for other community bots by metrics or by Builder's names.
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ fontWeight: 900 }}>Personal Watchlists</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
                      <div
                        className="saved-item"
                        style={{
                          flex: 1,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'stretch',
                          justifyContent: 'flex-start',
                          gap: 10,
                          overflow: 'auto',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                          <div style={{ fontWeight: 900 }}>Watchlist Zone #1</div>
                          {watchlistSelect(slot1Id, (id) => setUiState((p) => ({ ...p, communityWatchlistSlot1Id: id })))}
                        </div>
                        {renderTable(rowsForWatchlist(slot1Id), communityWatchlistSort1, setCommunityWatchlistSort1, {
                          emptyMessage: 'No bots in this watchlist.',
                        })}
                      </div>
                      <div
                        className="saved-item"
                        style={{
                          flex: 1,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'stretch',
                          justifyContent: 'flex-start',
                          gap: 10,
                          overflow: 'auto',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                          <div style={{ fontWeight: 900 }}>Watchlist Zone #2</div>
                          {watchlistSelect(slot2Id, (id) => setUiState((p) => ({ ...p, communityWatchlistSlot2Id: id })))}
                        </div>
                        {renderTable(rowsForWatchlist(slot2Id), communityWatchlistSort2, setCommunityWatchlistSort2, {
                          emptyMessage: 'No bots in this watchlist.',
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })()}
          </div>
        ) : tab === 'Portfolio' ? (
          <div className="placeholder">
            <div className="portfolio-grid">
              <div className="summary-cards">
                <div className="summary-card">
                  <div className="stat-label">Account value</div>
                  <div className="summary-value">{formatUsd(accountValue)}</div>
                  <div className="stat-label">Cash available {formatUsd(cash)}</div>
                </div>
                <div className="summary-card">
                  <div className="stat-label">Total PnL</div>
                  <div className={`summary-value ${totalPnl >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
                    {formatSignedUsd(totalPnl)}
                  </div>
                  <div className="stat-label">{formatPct(totalPnlPct)}</div>
                </div>
                <div className="summary-card">
                  <div className="stat-label">Day change</div>
                  <div className={`summary-value ${todaysChange >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
                    {formatSignedUsd(todaysChange)}
                  </div>
                  <div className="stat-label">{formatPct(todaysChangePct)}</div>
                </div>
              </div>

              <div className="panel-grid">
                <div className="panel-card">
                  <div className="panel-title">Current positions</div>
                  <table className="portfolio-table">
                    <thead>
                      <tr>
                        <th>Ticker</th>
                        <th>Allocation</th>
                        <th>Value</th>
                        <th>PnL</th>
                        <th>PnL %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map((pos) => (
                        <tr key={pos.ticker}>
                          <td>{pos.ticker}</td>
                          <td>{formatPct(pos.allocation)}</td>
                          <td>{formatUsd(pos.value)}</td>
                          <td className={pos.pnl >= 0 ? 'pnl-positive' : 'pnl-negative'}>{formatSignedUsd(pos.pnl)}</td>
                          <td className={pos.pnl >= 0 ? 'pnl-positive' : 'pnl-negative'}>{formatPct(pos.pnlPct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="panel-card">
                  <div className="panel-title">Bots invested in</div>
                  {investedBots.length === 0 ? (
                    <div style={{ color: '#64748b' }}>No bots saved yet.</div>
                  ) : (
                    <div className="bot-list">
                      {investedBots.map((bot) => (
                        <div key={bot.id} className="bot-row">
                          <div style={{ flex: 1 }}>
                            <div className="bot-row-title">
                              {bot.name}
                              {bot.readonly ? <span className="bot-tag muted">Community</span> : null}
                            </div>
                            <div className="bot-row-meta">
                              Allocation {formatPct(bot.allocation)} · Capital {formatUsd(bot.capital)}
                            </div>
                            <div className="bot-tags">
                              {(bot.tags.length ? bot.tags : ['Unassigned']).map((tag) => (
                                <span key={tag} className="bot-tag">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div className={`bot-row-pnl ${bot.pnl >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
                            {formatSignedUsd(bot.pnl)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="placeholder" />
        )}

        {addToWatchlistBotId ? (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(15, 23, 42, 0.35)',
              display: 'grid',
              placeItems: 'center',
              zIndex: 200,
            }}
            onClick={() => setAddToWatchlistBotId(null)}
          >
            <div
              style={{ width: 420, background: 'white', borderRadius: 12, padding: 12, border: '1px solid #e5e7eb' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ fontWeight: 900, marginBottom: 10 }}>Add to Watchlist</div>
              <div style={{ display: 'grid', gap: 8 }}>
                {watchlists.map((w) => (
                  <button
                    key={w.id}
                    onClick={() => {
                      if (addToWatchlistBotId) handleConfirmAddToWatchlist(addToWatchlistBotId, w.id)
                    }}
                  >
                    {w.name}
                  </button>
                ))}
                <div style={{ marginTop: 4, paddingTop: 10, borderTop: '1px solid #e5e7eb' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Create new</div>
                  <input
                    value={addToWatchlistNewName}
                    placeholder="Watchlist name…"
                    onChange={(e) => setAddToWatchlistNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        if (addToWatchlistBotId) handleConfirmAddToWatchlist(addToWatchlistBotId, addToWatchlistNewName)
                      }
                    }}
                    style={{ width: '100%' }}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button
                      onClick={() => {
                        if (addToWatchlistBotId) handleConfirmAddToWatchlist(addToWatchlistBotId, addToWatchlistNewName)
                      }}
                      style={{ flex: 1 }}
                    >
                      Add
                    </button>
                    <button onClick={() => setAddToWatchlistBotId(null)} style={{ flex: 1 }}>
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  )
}

export default App
