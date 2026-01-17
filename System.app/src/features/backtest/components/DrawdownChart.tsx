// src/features/backtest/components/DrawdownChart.tsx
// Drawdown visualization chart

import { useEffect, useRef } from 'react'
import {
  AreaSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type TimeRangeChangeEventHandler,
} from 'lightweight-charts'
import type { EquityPoint } from '@/types'
import {
  type VisibleRange,
  toUtcSeconds,
  sanitizeSeriesPoints,
} from '../utils/chartHelpers'

export interface DrawdownChartProps {
  points: EquityPoint[]
  oosStartDate?: string // OOS start date in YYYY-MM-DD format
  visibleRange?: VisibleRange
  onVisibleRangeChange?: (range: VisibleRange) => void
  theme?: 'dark' | 'light'
}

export function DrawdownChart({
  points,
  oosStartDate,
  visibleRange,
  onVisibleRangeChange,
  theme = 'light',
}: DrawdownChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null)
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
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

    // Initialize markers plugin for OOS indicator
    markersRef.current = createSeriesMarkers(series, [])

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
      try {
        markersRef.current?.detach()
      } catch {
        // ignore
      }
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      markersRef.current = null
    }
  }, [])

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
    const dd = sanitizeSeriesPoints(points, { clampMin: -0.9999, clampMax: 0 })
    seriesRef.current.setData(dd)

    // Update markers with OOS indicator (black circular marker)
    if (oosStartDate) {
      const oosTime = toUtcSeconds(oosStartDate)
      if (oosTime) {
        markersRef.current?.setMarkers([{
          time: oosTime,
          position: 'aboveBar' as const,
          color: '#000000',
          shape: 'circle' as const,
          text: 'OOS',
        }] as SeriesMarker<Time>[])
      }
    } else {
      markersRef.current?.setMarkers([])
    }

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
  }, [points, oosStartDate, visibleRange])

  return (
    <div
      ref={containerRef}
      className="w-full h-[130px] rounded-xl border border-border overflow-hidden"
    />
  )
}
