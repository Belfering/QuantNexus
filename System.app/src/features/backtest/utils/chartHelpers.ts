// src/features/backtest/utils/chartHelpers.ts
// Chart helper utilities for backtest visualization

import type { Time, BusinessDay, UTCTimestamp, IRange } from 'lightweight-charts'
import type { EquityPoint } from '@/types'

/**
 * Visible range type for chart viewport
 */
export type VisibleRange = IRange<UTCTimestamp>

/**
 * Empty equity points array constant
 */
export const EMPTY_EQUITY_POINTS: EquityPoint[] = []

/**
 * Convert various Time types to UTCTimestamp (seconds since epoch)
 */
export const toUtcSeconds = (t: Time | null | undefined): UTCTimestamp | null => {
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

/**
 * Clamp a visible range to the bounds of the equity points array
 * Snaps to closest existing data points to keep charts aligned
 */
export const clampVisibleRangeToPoints = (points: EquityPoint[], range: VisibleRange): VisibleRange => {
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

/**
 * Sanitize and normalize equity points for chart rendering
 * - Removes points with invalid time/value
 * - Ensures monotonic time sequence (removes duplicates)
 * - Optionally clamps values to min/max bounds
 */
export const sanitizeSeriesPoints = (
  points: EquityPoint[],
  opts?: { clampMin?: number; clampMax?: number }
): EquityPoint[] => {
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
