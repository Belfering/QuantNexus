// src/features/analyze/components/OverviewTabContent.tsx
// Overview tab content for bot analysis cards

import { type Dispatch, type SetStateAction, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { formatPct, formatUsd, normalizeChoice } from '@/shared/utils'
import { EquityChart, DrawdownChart, collectPositionTickers } from '@/features/backtest'
import { cloneNode, ensureSlots } from '@/features/builder'
import type {
  FlowNode,
  CallChain,
  SavedBot,
  AnalyzeBacktestState,
  TickerContributionState,
  UserUiState,
  BacktestMode,
} from '@/types'
import type { InvestmentWithPnl } from '@/features/dashboard/hooks/useDashboardInvestments'

interface OverviewTabContentProps {
  bot: SavedBot
  analyzeState: AnalyzeBacktestState | undefined
  uiState: UserUiState
  analyzeTickerSort: { column: string; dir: 'asc' | 'desc' }
  setAnalyzeTickerSort: Dispatch<SetStateAction<{ column: string; dir: 'asc' | 'desc' }>>
  analyzeTickerContrib: Record<string, TickerContributionState>
  backtestMode: BacktestMode
  backtestBenchmark: string
  dashboardCash: number
  dashboardInvestmentsWithPnl: InvestmentWithPnl[]
  nexusBuyBotId: string | null
  setNexusBuyBotId: (id: string | null) => void
  nexusBuyAmount: string
  setNexusBuyAmount: (amount: string) => void
  nexusBuyMode: '$' | '%'
  setNexusBuyMode: (mode: '$' | '%') => void
  handleNexusBuy: (botId: string) => Promise<void>
  runAnalyzeBacktest: (bot: SavedBot, force?: boolean) => void
  callChainsById: Map<string, CallChain>
  normalizeNodeForBacktest: (node: FlowNode) => FlowNode
}

export function OverviewTabContent(props: OverviewTabContentProps) {
  const {
    bot: b,
    analyzeState,
    uiState,
    analyzeTickerSort,
    setAnalyzeTickerSort,
    analyzeTickerContrib,
    backtestMode,
    backtestBenchmark,
    dashboardCash,
    dashboardInvestmentsWithPnl,
    nexusBuyBotId,
    setNexusBuyBotId,
    nexusBuyAmount,
    setNexusBuyAmount,
    nexusBuyMode,
    setNexusBuyMode,
    handleNexusBuy,
    runAnalyzeBacktest,
    callChainsById,
    normalizeNodeForBacktest,
  } = props

  // Memoize current time to avoid impure Date.now() calls during render
  // eslint-disable-next-line react-hooks/purity -- Date.now() is intentionally captured once at mount
  const now = useMemo(() => Date.now(), [])

  return (
    <div className="grid w-full max-w-full grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-2.5 items-stretch overflow-x-hidden">
      <div className="saved-item grid grid-cols-1 gap-3.5 h-full w-full min-w-0 overflow-hidden items-stretch justify-items-stretch">
        {analyzeState?.status === 'loading' ? (
          <div className="text-muted">Running backtest...</div>
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
              {/* Live Stats */}
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
                  const daysSinceInvestment = (now - investment.buyDate) / (1000 * 60 * 60 * 24)
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

      <div className="saved-item flex flex-col gap-2.5 min-w-0">
        <div className="font-black">Tickers</div>
        <div className="max-h-[800px] overflow-y-auto border border-border rounded-xl max-w-full">
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
  )
}
