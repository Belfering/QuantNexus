// src/features/backtest/components/RangeNavigator.tsx
// Draggable range navigator for selecting chart viewport

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import {
  ColorType,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts'
import type { EquityPoint } from '@/types'
import {
  type VisibleRange,
  toUtcSeconds,
  sanitizeSeriesPoints,
  clampVisibleRangeToPoints,
} from '../utils/chartHelpers'

export interface RangeNavigatorProps {
  points: EquityPoint[]
  range: VisibleRange
  onChange: (range: VisibleRange) => void
  theme?: 'dark' | 'light'
}

export function RangeNavigator({
  points,
  range,
  onChange,
  theme = 'light',
}: RangeNavigatorProps) {
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

    const rangeFrom = rangeRef.current?.from
    const rangeTo = rangeRef.current?.to
    if (!rangeFrom || !rangeTo) return

    const rect = el.getBoundingClientRect()
    const fromCoord = chart.timeScale().timeToCoordinate(rangeFrom)
    const toCoord = chart.timeScale().timeToCoordinate(rangeTo)
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

    const isDark = theme === 'dark'
    const bgColor = isDark ? '#1e293b' : '#ffffff'
    const textColor = isDark ? '#e2e8f0' : '#0f172a'
    const gridColor = isDark ? '#334155' : '#eef2f7'
    const borderColor = isDark ? '#475569' : '#cbd5e1'

    const chart = createChart(el, {
      width: Math.floor(innerWidth()),
      height: 110,
      layout: { background: { type: ColorType.Solid, color: bgColor }, textColor },
      grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
      rightPriceScale: { visible: false },
      leftPriceScale: { visible: false },
      timeScale: { visible: false, borderColor, fixLeftEdge: true, fixRightEdge: true },
      handleScroll: false,
      handleScale: false
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
      const from = (clicked - half) as import('lightweight-charts').UTCTimestamp
      const to = (clicked + half) as import('lightweight-charts').UTCTimestamp
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
          className="navigator-chart w-full h-[110px] rounded-xl border border-border overflow-hidden"
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
