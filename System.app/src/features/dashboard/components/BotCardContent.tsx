// src/features/dashboard/components/BotCardContent.tsx
// Expanded bot card content component - extracted to allow useBotPositions hook usage

import { formatPct } from '@/shared/utils'
import { EquityChart, DrawdownChart } from '@/features/backtest'
import { BotPositionsTable } from './BotPositionsTable'
import { useBotPositions } from '../hooks'
import type { PortfolioMode } from '@/types'
import type { UserUiState } from '@/types'

interface BotCardContentProps {
  botId: string
  portfolioMode: PortfolioMode
  analyzeState: any
  hasPositions: boolean
  investmentAmount: number
  allocation: number
  displayCostBasis: number
  displayCurrentValue: number
  pnl: number
  pnlPercent: number
  backtestBenchmark: string
  uiState: UserUiState
}

export function BotCardContent({
  botId,
  portfolioMode,
  analyzeState,
  hasPositions,
  investmentAmount,
  allocation,
  displayCostBasis,
  displayCurrentValue,
  pnl,
  pnlPercent,
  backtestBenchmark,
  uiState,
}: BotCardContentProps) {
  // Fetch bot positions from ledger
  const botPositions = useBotPositions(botId, portfolioMode, true)

  return (
    <div className="w-full flex flex-col gap-2.5">
      {/* Live Stats */}
      <div className="base-stats-card w-full min-w-0 text-center self-stretch">
        <div className="w-full">
          <div className="font-black mb-2">Live Stats</div>
          {hasPositions ? (
            <div className="grid grid-cols-[repeat(4,minmax(140px,1fr))] gap-2.5 justify-items-center overflow-x-auto max-w-full w-full">
              <div>
                <div className="stat-label">Allocation</div>
                <div className="stat-value">{formatPct(allocation)}</div>
              </div>
              <div>
                <div className="stat-label">Cost Basis</div>
                <div className="stat-value">${displayCostBasis.toFixed(2)}</div>
              </div>
              <div>
                <div className="stat-label">Current Value</div>
                <div className="stat-value">${displayCurrentValue.toFixed(2)}</div>
              </div>
              <div>
                <div className="stat-label">P&L</div>
                <div className={`stat-value ${pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                  ${pnl.toFixed(2)} ({pnlPercent.toFixed(2)}%)
                </div>
              </div>
            </div>
          ) : (
            <div className="text-muted text-sm">
              Trades will execute at next scheduled window. Investment: ${investmentAmount.toFixed(2)}
            </div>
          )}
        </div>
      </div>

      {/* Backtest Snapshot */}
      {analyzeState?.result && (
        <div className="base-stats-card w-full min-w-0 text-center self-stretch">
          <div className="w-full">
            <div className="font-black mb-2">Backtest Snapshot</div>
            <div className="text-xs text-muted mb-2">Benchmark: {backtestBenchmark}</div>
            <div className="w-full">
              <EquityChart
                points={analyzeState.result.points ?? []}
                benchmarkPoints={analyzeState.result.benchmarkPoints ?? []}
                markers={analyzeState.result.markers ?? []}
                logScale
                width={800}
                height={390}
                theme={uiState.theme}
              />
            </div>
            <div className="mt-2.5 w-full">
              <DrawdownChart points={analyzeState.result?.drawdownPoints ?? []} theme={uiState.theme} />
            </div>
          </div>
        </div>
      )}

      {/* Current Positions (if bot has positions in ledger) */}
      {botPositions.positions.length > 0 && (
        <div className="base-stats-card w-full min-w-0 text-center self-stretch">
          <div className="w-full">
            <div className="font-black mb-2">Current Positions</div>
            <BotPositionsTable
              positions={botPositions.positions}
              totalValue={botPositions.totalValue}
            />
          </div>
        </div>
      )}

      {/* Historical Stats (only if no positions yet) */}
      {botPositions.positions.length === 0 && analyzeState?.result && (
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
      )}
    </div>
  )
}
