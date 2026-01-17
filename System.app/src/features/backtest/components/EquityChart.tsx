// src/features/backtest/components/EquityChart.tsx
// Equity curve chart with benchmark overlay and cursor stats

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ColorType,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  createChart,
  createSeriesMarkers,
  type AutoscaleInfo,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineData,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
  type TimeRangeChangeEventHandler,
  type UTCTimestamp,
} from 'lightweight-charts'
import type { EquityPoint, EquityMarker, IndicatorOverlayData } from '@/types'
import { formatPct } from '@/shared/utils'
import { isoFromUtcSeconds } from '../utils/metrics'
import {
  type VisibleRange,
  toUtcSeconds,
  sanitizeSeriesPoints,
} from '../utils/chartHelpers'

export interface EquityChartProps {
  points: EquityPoint[]
  benchmarkPoints?: EquityPoint[]
  markers: EquityMarker[]
  oosStartDate?: string // OOS start date in YYYY-MM-DD format
  visibleRange?: VisibleRange
  onVisibleRangeChange?: (range: VisibleRange) => void
  logScale?: boolean
  showCursorStats?: boolean
  heightPx?: number
  indicatorOverlays?: IndicatorOverlayData[]
  theme?: 'dark' | 'light'
}

export function EquityChart({
  points,
  benchmarkPoints,
  markers,
  oosStartDate,
  visibleRange,
  onVisibleRangeChange,
  logScale,
  showCursorStats = true,
  heightPx,
  indicatorOverlays,
  theme = 'light',
}: EquityChartProps) {
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

  // Update chart colors when theme changes (without recreating the chart)
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const isDark = theme === 'dark'
    const bgColor = isDark ? '#1e293b' : '#ffffff'
    const textColor = isDark ? '#e2e8f0' : '#0f172a'
    const gridColor = isDark ? '#334155' : '#eef2f7'
    const borderColor = isDark ? '#475569' : '#cbd5e1'
    chart.applyOptions({
      layout: { background: { type: ColorType.Solid, color: bgColor }, textColor },
      grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
      rightPriceScale: { borderColor },
      timeScale: { borderColor },
    })
  }, [theme])

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
    // Build markers array including trade markers and OOS marker
    const allMarkers: SeriesMarker<Time>[] = []

    // Add trade markers (limit to 80 for performance)
    allMarkers.push(...(markers || []).slice(0, 80).map((m) => ({
      time: m.time,
      position: 'aboveBar' as const,
      color: '#b91c1c',
      shape: 'circle' as const,
      text: m.text,
    })))

    // Add OOS marker if present (black circular marker)
    if (oosStartDate) {
      const oosTime = toUtcSeconds(oosStartDate)
      if (oosTime) {
        allMarkers.push({
          time: oosTime,
          position: 'aboveBar' as const,
          color: '#000000',
          shape: 'circle' as const,
          text: 'OOS',
        })
      }
    }

    // Sort by time and apply
    allMarkers.sort((a, b) => Number(a.time) - Number(b.time))
    markersRef.current?.setMarkers(allMarkers as SeriesMarker<Time>[])
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
  }, [points, benchmarkPoints, markers, oosStartDate, visibleRange, logScale])

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
