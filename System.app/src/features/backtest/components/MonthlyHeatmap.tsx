// src/features/backtest/components/MonthlyHeatmap.tsx
// Monthly returns heatmap with yearly CAGR and MaxDD

import type { BacktestDayRow } from '@/types'
import { formatPct } from '@/shared/utils'

export interface MonthlyHeatmapProps {
  monthly: Array<{ year: number; month: number; value: number }>
  days: BacktestDayRow[]
  theme?: 'dark' | 'light'
}

export function MonthlyHeatmap({
  monthly,
  days,
  theme = 'light',
}: MonthlyHeatmapProps) {
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

/**
 * Helper function for legacy usage - renders the monthly heatmap as JSX
 */
export const renderMonthlyHeatmap = (
  monthly: Array<{ year: number; month: number; value: number }>,
  days: BacktestDayRow[],
  theme: 'dark' | 'light' = 'light',
) => {
  return <MonthlyHeatmap monthly={monthly} days={days} theme={theme} />
}
