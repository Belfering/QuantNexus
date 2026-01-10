// src/features/backtest/utils/downloads.ts
// CSV download helpers for backtest results

import type { BacktestMode, BacktestResult } from '@/types'
import { csvEscape, downloadTextFile } from '@/shared/utils'

/**
 * Normalize a ticker choice - uppercase and handle empty
 */
const normalizeChoice = (raw: string): string => {
  const s = String(raw ?? '').trim().toUpperCase()
  if (!s || s === 'EMPTY') return 'Empty'
  return s
}

/**
 * Download equity curve as CSV file
 */
export const downloadEquityCsv = (
  result: BacktestResult,
  mode: BacktestMode,
  costBps: number,
  benchmark: string,
  showBenchmark: boolean
) => {
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

/**
 * Download allocations as CSV file
 */
export const downloadAllocationsCsv = (result: BacktestResult) => {
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

/**
 * Download rebalances (days with turnover) as CSV file
 */
export const downloadRebalancesCsv = (result: BacktestResult) => {
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
