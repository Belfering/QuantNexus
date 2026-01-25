// src/features/backtest/components/AllocationChart.tsx
// Stacked allocation chart showing position weights over time

import { useEffect, useRef, useState } from 'react'
import {
  AreaSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type UTCTimestamp,
} from 'lightweight-charts'
import type { EquityPoint } from '@/types'
import { type VisibleRange, sanitizeSeriesPoints } from '../utils/chartHelpers'

export interface AllocationSeriesData {
  name: string
  color: string
  points: EquityPoint[]
}

export interface AllocationChartProps {
  series: AllocationSeriesData[]
  visibleRange?: VisibleRange
  theme?: 'dark' | 'light'
}

export function AllocationChart({
  series,
  visibleRange,
  theme = 'light',
}: AllocationChartProps) {
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
        topColor: 'transparent', // No fill
        bottomColor: 'transparent', // No fill
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
  }, [series, visibleRange])

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
                {legendData.allocations.map((a, idx) => (
                  <div key={`${a.name}-${idx}`} className="flex items-center gap-2 text-sm">
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
                {defaultLegend.map((s, idx) => (
                  <div key={`${s.name}-${idx}`} className="flex items-center gap-2 text-sm">
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
