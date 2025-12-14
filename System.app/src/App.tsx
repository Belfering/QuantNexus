import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { CandlestickSeries, ColorType, createChart, type CandlestickData, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts'

type BlockKind = 'basic' | 'function' | 'indicator' | 'position'
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

const TICKER_DATALIST_ID = 'systemapp-tickers'

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

type BotSession = {
  id: string
  history: FlowNode[]
  historyIndex: number
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

type SavedBot = {
  id: string
  name: string
  payload: FlowNode
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
  bgColor?: string
  collapsed?: boolean
  conditions?: {
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
  }[]
  metric?: MetricChoice
  window?: number
  bottom?: number
  rank?: RankChoice
}

const SLOT_ORDER: Record<BlockKind, SlotId[]> = {
  basic: ['next'],
  function: ['next'],
  indicator: ['then', 'else', 'next'],
  position: [],
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
    title: kind === 'function' ? 'Sort' : kind === 'indicator' ? 'Indicator' : kind === 'position' ? 'Position' : 'Basic',
    children: {},
    weighting: 'equal',
    weightingThen: kind === 'indicator' ? 'equal' : undefined,
    weightingElse: kind === 'indicator' ? 'equal' : undefined,
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
    metric: kind === 'function' ? 'Relative Strength Index' : undefined,
    window: undefined,
    bottom: kind === 'function' ? 2 : undefined,
    rank: kind === 'function' ? 'Bottom' : undefined,
    collapsed: false,
  }
  SLOT_ORDER[kind].forEach((slot) => {
    base.children[slot] = [null]
  })
  if (kind === 'position') {
    base.positions = ['Empty']
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
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace',
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

    const chart = createChart(el, {
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
      const { width } = el.getBoundingClientRect()
      chart.applyOptions({ width: Math.floor(width) })
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

  return <div ref={containerRef} style={{ width: '100%', borderRadius: 14, border: '1px solid #cbd5e1', overflow: 'hidden' }} />
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
  }, [tickersDirty])

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
  }, [tickersText])

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
  }, [downloadJob?.id, downloadJob?.status])

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
    if (node.kind === 'indicator' && branch) {
      return branch === 'then' ? { ...node, weightingThen: weighting } : { ...node, weightingElse: weighting }
    }
    return { ...node, weighting }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  SLOT_ORDER[node.kind].forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateWeight(c, id, weighting, branch) : c)) : arr
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

const addConditionLine = (node: FlowNode, id: string, type: 'and' | 'or'): FlowNode => {
  if (node.id === id && node.kind === 'indicator') {
    const last = node.conditions && node.conditions.length ? node.conditions[node.conditions.length - 1] : null
    const next = [
      ...(node.conditions ?? []),
      {
        id: newId(),
        type,
        window: last?.window ?? 14,
        metric: (last?.metric as MetricChoice) ?? 'Relative Strength Index',
        comparator: last?.comparator ?? 'lt',
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
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  SLOT_ORDER[node.kind].forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? addConditionLine(c, id, type) : c)) : arr
  })
  return { ...node, children }
}

const deleteConditionLine = (node: FlowNode, id: string, condId: string): FlowNode => {
  if (node.id === id && node.kind === 'indicator' && node.conditions) {
    const keep = node.conditions.filter((c, idx) => idx === 0 || c.id !== condId)
    return { ...node, conditions: keep.length ? keep : node.conditions }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  SLOT_ORDER[node.kind].forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? deleteConditionLine(c, id, condId) : c)) : arr
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
): FlowNode => {
  if (node.id === id && node.kind === 'indicator' && node.conditions) {
    const next = node.conditions.map((c) => (c.id === condId ? { ...c, ...updates } : c))
    return { ...node, conditions: next }
  }
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
  SLOT_ORDER[node.kind].forEach((s) => {
    const arr = node.children[s]
    children[s] = arr ? arr.map((c) => (c ? updateConditionFields(c, id, condId, updates) : c)) : arr
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
  conditions: node.conditions ? node.conditions.map((c) => ({ ...c })) : undefined,
  metric: node.metric,
  window: node.window,
  bottom: node.bottom,
  rank: node.rank,
  bgColor: node.bgColor,
  collapsed: node.collapsed,
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
        { id: `${node.id}-tag1`, depth: 0, kind: 'text', text: 'Equal Weight', tone: 'tag' },
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
    case 'position':
      return [
        { id: `${node.id}-tag1`, depth: 0, kind: 'text', text: 'Equal Weight', tone: 'tag' },
      ]
  }
}

type CardProps = {
  node: FlowNode
  depth: number
  inheritedWeight?: number
  weightMode?: WeightMode
  tickerOptions: string[]
  onAdd: (parentId: string, slot: SlotId, index: number, kind: BlockKind) => void
  onAppend: (parentId: string, slot: SlotId) => void
  onRemoveSlotEntry: (parentId: string, slot: SlotId, index: number) => void
  onDelete: (id: string) => void
  onCopy: (id: string) => void
  onPaste: (parentId: string, slot: SlotId, index: number, child: FlowNode) => void
  onRename: (id: string, title: string) => void
  onWeightChange: (id: string, weight: WeightMode, branch?: 'then' | 'else') => void
  onColorChange: (id: string, color?: string) => void
  onToggleCollapse: (id: string, collapsed: boolean) => void
  onAddCondition: (id: string, type: 'and' | 'or') => void
  onDeleteCondition: (id: string, condId: string) => void
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
  ) => void
  onAddPosition: (id: string) => void
  onRemovePosition: (id: string, index: number) => void
  onChoosePosition: (id: string, index: number, choice: PositionChoice) => void
  clipboard: FlowNode | null
}

const NodeCard = ({
  node,
  depth,
  inheritedWeight,
  weightMode,
  tickerOptions,
  onAdd,
  onAppend,
  onRemoveSlotEntry,
  onDelete,
  onCopy,
  onPaste,
  onRename,
  onWeightChange,
  onColorChange,
  onToggleCollapse,
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
}: CardProps) => {
  const [addRowOpen, setAddRowOpen] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(node.collapsed ?? false)
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

  useEffect(() => setDraft(node.title), [node.title])
  useEffect(() => setCollapsed(node.collapsed ?? false), [node.collapsed])

  const renderSlot = (slot: SlotId, depthPx: number) => {
    const arr = node.children[slot] ?? [null]
    const indexedChildren = arr
      .map((c, i) => ({ c, i }))
      .filter((entry): entry is { c: FlowNode; i: number } => Boolean(entry.c))
    const slotWeighting =
      node.kind === 'indicator' && (slot === 'then' || slot === 'else')
        ? slot === 'then'
          ? node.weightingThen ?? node.weighting
          : node.weightingElse ?? node.weighting
        : node.weighting
    const childCount = indexedChildren.length
    const autoShare =
      slotWeighting === 'equal' ? (childCount > 0 ? Number((100 / childCount).toFixed(2)) : 100) : undefined
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
                      onAdd(node.id, slot, 0, 'position')
                      setAddRowOpen(null)
                    }}
                  >
                    Add Position
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
              <div className="indent with-line" style={{ width: depthPx * 1 }} />
              <div className="slot-body">
                <NodeCard
                  node={child}
                  depth={depth + 1}
                  inheritedWeight={autoShare}
                  weightMode={slotWeighting}
                  tickerOptions={tickerOptions}
                  onAdd={onAdd}
                  onAppend={onAppend}
                  onRemoveSlotEntry={onRemoveSlotEntry}
                  onDelete={onDelete}
                  onCopy={onCopy}
                onPaste={onPaste}
                onRename={onRename}
                onWeightChange={onWeightChange}
                onColorChange={onColorChange}
                onToggleCollapse={onToggleCollapse}
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
                />
                {node.kind === 'function' && slot === 'next' && index > 0 ? (
                  <button className="icon-btn delete inline" onClick={() => onRemoveSlotEntry(node.id, slot, index)}>
                    X
                  </button>
                ) : null}
              </div>
            </div>
            <div className="line">
              <div
                className="indent with-line"
                style={{
                  width:
                    depthPx * 1 +
                    14 +
                    (slot === 'then' || slot === 'else' ? 14 : 0) +
                    (node.kind === 'function' && slot === 'next' ? 4 * 14 : 0) +
                    (node.kind === 'basic' && slot === 'next' ? 3 * 14 : 0) +
                    (node.kind === 'indicator' && (slot === 'then' || slot === 'else') ? 2 * 14 : 0),
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
                        onAdd(node.id, slot, originalIndex + 1, 'position')
                        setAddRowOpen(null)
                      }}
                    >
                      Add Position
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

  return (
    <div className="node-card" style={{ marginLeft: depth * 18, background: node.bgColor || undefined }}>
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
          <div className="node-title" onClick={() => setEditing(true)}>
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
                % {node.title}
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
              setCollapsed((v) => {
                const next = !v
                onToggleCollapse(node.id, next)
                return next
              })
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
                              setWeightThenOpen(false)
                              setWeightElseOpen(false)
                              setWeightMainOpen(false)
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
                              setWeightElseOpen(false)
                              setWeightThenOpen(false)
                              setWeightMainOpen(false)
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
                                    setWeightMainOpen(false)
                                    setWeightThenOpen(false)
                                    setWeightElseOpen(false)
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
                            value={node.bottom ?? 2}
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

function App() {
  const initialBotRef = useRef<BotSession | null>(null)

  const [availableTickers, setAvailableTickers] = useState<string[]>([])

  const loadAvailableTickers = useCallback(async () => {
    const tryLoad = async (url: string) => {
      const res = await fetch(url)
      const payload = (await res.json()) as { tickers: string[] } | { error: string }
      if (!res.ok) throw new Error('error' in payload ? payload.error : `Tickers failed (${res.status})`)
      if (!('tickers' in payload)) throw new Error('Tickers failed.')
      return payload.tickers || []
    }

    try {
      setAvailableTickers(await tryLoad('/api/tickers'))
    } catch {
      try {
        setAvailableTickers(await tryLoad('http://localhost:8787/api/tickers'))
      } catch {
        setAvailableTickers([])
      }
    }
  }, [])

  useEffect(() => {
    void loadAvailableTickers()
  }, [loadAvailableTickers])

  const tickerOptions = useMemo(() => normalizeTickersForUi(availableTickers), [availableTickers])

  const createBotSession = useCallback((title: string): BotSession => {
    const root = ensureSlots(createNode('basic'))
    root.title = title
    return { id: `bot-${newId()}`, history: [root], historyIndex: 0 }
  }, [])

  const [bots, setBots] = useState<BotSession[]>(() => {
    const bot = initialBotRef.current ?? createBotSession('Algo Name Here')
    initialBotRef.current = bot
    return [bot]
  })
  const [activeBotId, setActiveBotId] = useState<string>(() => initialBotRef.current?.id ?? '')
  const [clipboard, setClipboard] = useState<FlowNode | null>(null)
  const [tab, setTab] = useState<'Portfolio' | 'Community' | 'Bot Database' | 'Build' | 'Admin'>('Build')
  const [adminTab, setAdminTab] = useState<'Ticker List' | 'Data'>('Ticker List')
  const [savedBots, setSavedBots] = useState<SavedBot[]>([])

  const activeBot = useMemo(() => {
    return bots.find((b) => b.id === activeBotId) ?? bots[0]
  }, [bots, activeBotId])

  const current = activeBot.history[activeBot.historyIndex]

  useEffect(() => {
    if (!activeBot) return
    if (!hasLegacyIdsOrDuplicates(current)) return
    const refreshed = ensureSlots(regenerateIds(current))
    setBots((prev) =>
      prev.map((b) => (b.id === activeBot.id ? { ...b, history: [refreshed], historyIndex: 0 } : b)),
    )
    setClipboard(null)
  }, [activeBot?.id, current])

  const push = (next: FlowNode) => {
    if (!activeBot) return
    setBots((prev) =>
      prev.map((b) => {
        if (b.id !== activeBot.id) return b
        const trimmed = b.history.slice(0, b.historyIndex + 1)
        trimmed.push(ensureSlots(next))
        return { ...b, history: trimmed, historyIndex: trimmed.length - 1 }
      }),
    )
  }

  const handleAdd = useCallback(
    (parentId: string, slot: SlotId, index: number, kind: BlockKind) => {
      const next = replaceSlot(current, parentId, slot, index, ensureSlots(createNode(kind)))
      push(next)
    },
    [current],
  )

  const handleAppend = useCallback(
    (parentId: string, slot: SlotId) => {
      const next = appendPlaceholder(current, parentId, slot)
      push(next)
    },
    [current],
  )

  const handleRemoveSlotEntry = useCallback(
    (parentId: string, slot: SlotId, index: number) => {
      const next = removeSlotEntry(current, parentId, slot, index)
      push(next)
    },
    [current],
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
    [current, handleCloseBot, activeBotId],
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
      const next = replaceSlot(current, parentId, slot, index, ensureSlots(cloneNode(child)))
      push(next)
    },
    [current],
  )

  const handleRename = useCallback(
    (id: string, title: string) => {
      const next = updateTitle(current, id, title)
      push(next)
    },
    [current],
  )

const handleWeightChange = useCallback(
  (id: string, weight: WeightMode, branch?: 'then' | 'else') => {
    const next = updateWeight(current, id, weight, branch)
    push(next)
  },
  [current],
)

const handleFunctionWindow = useCallback(
  (id: string, value: number) => {
    const next = updateFunctionWindow(current, id, value)
      push(next)
    },
    [current],
  )

  const handleFunctionBottom = useCallback(
    (id: string, value: number) => {
      const next = updateFunctionBottom(current, id, value)
      push(next)
    },
    [current],
  )

const handleFunctionMetric = useCallback(
  (id: string, metric: MetricChoice) => {
    const next = updateFunctionMetric(current, id, metric)
    push(next)
  },
  [current],
)

const handleFunctionRank = useCallback(
  (id: string, rank: RankChoice) => {
    const next = updateFunctionRank(current, id, rank)
    push(next)
  },
  [current],
)

const handleColorChange = useCallback(
  (id: string, color?: string) => {
    const next = updateColor(current, id, color)
    push(next)
  },
  [current],
)

  const handleToggleCollapse = useCallback(
    (id: string, isCollapsed: boolean) => {
      const next = updateCollapse(current, id, isCollapsed)
      push(next)
    },
    [current],
  )

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

  const handleSave = useCallback(() => {
    if (!current) return
    const now = new Date()
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate(),
    ).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const name = `${current.title || 'Algo'} - ${timestamp}`
    const payload = ensureSlots(cloneNode(current))
    const entry: SavedBot = { id: `saved-${newId()}`, name, payload }
    setSavedBots((prev) => [entry, ...prev])
  }, [current])

  const handleCopySaved = useCallback(
    async (bot: SavedBot) => {
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
  }, [])

  const handleOpenSaved = useCallback(
    (bot: SavedBot) => {
      const payload = ensureSlots(cloneNode(bot.payload))
      const session: BotSession = { id: `bot-${newId()}`, history: [payload], historyIndex: 0 }
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
      } catch (err) {
        alert('Failed to Import due to an error in the JSON')
      }
    }
    input.click()
  }, [activeBot, setBots])

  const handleAddCondition = useCallback(
    (id: string, type: 'and' | 'or') => {
      const next = addConditionLine(current, id, type)
      push(next)
    },
    [current],
  )

  const handleDeleteCondition = useCallback(
    (id: string, condId: string) => {
      const next = deleteConditionLine(current, id, condId)
      push(next)
    },
    [current],
  )

  const handleAddPos = useCallback(
    (id: string) => {
      const next = addPositionRow(current, id)
      push(next)
    },
    [current],
  )

  const handleRemovePos = useCallback(
    (id: string, index: number) => {
      const next = removePositionRow(current, id, index)
      push(next)
    },
    [current],
  )

  const handleChoosePos = useCallback(
    (id: string, index: number, choice: PositionChoice) => {
      const next = choosePosition(current, id, index, choice)
      push(next)
    },
    [current],
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

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <div className="eyebrow">System</div>
          <h1>System.app</h1>
          <p className="lede">Click any Node or + to extend with Basic, Function, Indicator, or Position. Paste uses the last copied node.</p>
          <div className="tabs">
            {(['Portfolio', 'Community', 'Bot Database', 'Build', 'Admin'] as const).map((t) => (
              <button key={t} className={`tab-btn ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </div>
          {tab === 'Build' && (
            <div className="build-actions">
              <button onClick={handleNewBot}>New Bot</button>
              <button onClick={handleSave}>Save</button>
              <button>Open</button>
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
      <TickerDatalist id={TICKER_DATALIST_ID} options={tickerOptions} />
      <main className="canvas">
        {tab === 'Build' ? (
          <NodeCard
            node={current}
            depth={0}
            tickerOptions={tickerOptions}
            onAdd={handleAdd}
            onAppend={handleAppend}
            onRemoveSlotEntry={handleRemoveSlotEntry}
            onDelete={handleDelete}
            onCopy={handleCopy}
            onPaste={handlePaste}
            onRename={handleRename}
            onWeightChange={handleWeightChange}
            onColorChange={handleColorChange}
            onToggleCollapse={handleToggleCollapse}
            onAddCondition={handleAddCondition}
            onDeleteCondition={handleDeleteCondition}
            onFunctionWindow={handleFunctionWindow}
            onFunctionBottom={handleFunctionBottom}
            onFunctionMetric={handleFunctionMetric}
            onFunctionRank={handleFunctionRank}
            onUpdateCondition={(id, condId, updates) => {
              const next = updateConditionFields(current, id, condId, updates)
              push(next)
            }}
            onAddPosition={handleAddPos}
            onRemovePosition={handleRemovePos}
            onChoosePosition={handleChoosePos}
            clipboard={clipboard}
          />
        ) : tab === 'Admin' ? (
          <AdminPanel
            adminTab={adminTab}
            setAdminTab={setAdminTab}
            onTickersUpdated={(next) => {
              setAvailableTickers(next)
            }}
          />
        ) : (
          <div className="placeholder">
            {tab === 'Portfolio'
              ? 'Portfolio content coming soon.'
              : tab === 'Community'
                ? 'Community content coming soon.'
                : savedBots.length === 0
                  ? 'No saved bots yet.'
                  : null}
            {tab === 'Bot Database' && savedBots.length > 0 && (
              <div className="saved-list">
                {savedBots.map((b) => (
                  <div key={b.id} className="saved-item">
                    <button
                      className="link-btn"
                      onClick={() => {
                        handleOpenSaved(b)
                      }}
                    >
                      {b.name}
                    </button>
                    <div className="saved-actions">
                      <button onClick={() => handleCopySaved(b)}>Copy</button>
                      <button onClick={() => handleDeleteSaved(b.id)}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

export default App
