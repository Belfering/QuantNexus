// src/features/dashboard/components/DashboardEquityChart.tsx
// Dashboard equity chart with portfolio returns and individual bot lines

import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  AreaSeries,
  ColorType,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts'
import type { EquityCurvePoint } from '@/types'
import type { DashboardEquityChartProps } from '../types'

/**
 * Dashboard Equity + Drawdown Chart Component
 * Displays portfolio returns (% based) with multiple bot lines and synchronized drawdown chart
 */
export function DashboardEquityChart({
  portfolioData,
  botSeries,
  theme,
}: DashboardEquityChartProps) {
  const equityContainerRef = useRef<HTMLDivElement>(null)
  const drawdownContainerRef = useRef<HTMLDivElement>(null)
  const equityChartRef = useRef<IChartApi | null>(null)
  const drawdownChartRef = useRef<IChartApi | null>(null)
  const portfolioSeriesRef = useRef<ISeriesApi<'Area'> | null>(null)
  const botSeriesRefs = useRef<ISeriesApi<'Line'>[]>([])
  const drawdownSeriesRef = useRef<ISeriesApi<'Area'> | null>(null)

  // Convert equity to % returns (rebased to 0%)
  const toReturns = useCallback((data: EquityCurvePoint[]) => {
    if (data.length === 0) return []
    const startValue = data[0].value
    return data.map((p) => ({
      time: p.time,
      value: startValue > 0 ? ((p.value - startValue) / startValue) * 100 : 0,
    }))
  }, [])

  const portfolioReturns = useMemo(() => toReturns(portfolioData), [portfolioData, toReturns])

  // Compute drawdown from portfolio data (unified)
  const drawdownData = useMemo(() => {
    if (portfolioData.length === 0) return []
    let peak = portfolioData[0].value
    return portfolioData.map((p) => {
      if (p.value > peak) peak = p.value
      const dd = peak > 0 ? (p.value - peak) / peak : 0
      return { time: p.time, value: dd * 100 } // percentage
    })
  }, [portfolioData])

  useEffect(() => {
    const equityEl = equityContainerRef.current
    const drawdownEl = drawdownContainerRef.current
    if (!equityEl || !drawdownEl) return

    const isDark = theme === 'dark'
    const bgColor = isDark ? '#1e293b' : '#ffffff'
    const textColor = isDark ? '#e2e8f0' : '#0f172a'
    const gridColor = isDark ? '#334155' : '#eef2f7'
    const borderColor = isDark ? '#475569' : '#cbd5e1'

    // Returns chart
    const equityChart = createChart(equityEl, {
      width: equityEl.clientWidth,
      height: 200,
      layout: { background: { type: ColorType.Solid, color: bgColor }, textColor },
      grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
      rightPriceScale: { borderColor },
      timeScale: { borderColor, visible: false }, // Hide time scale on returns chart
      handleScroll: false,
      handleScale: false
    })

    // Portfolio returns series (main area)
    const portfolioSeries = equityChart.addSeries(AreaSeries, {
      lineColor: '#3b82f6',
      topColor: 'rgba(59, 130, 246, 0.3)',
      bottomColor: 'rgba(59, 130, 246, 0.0)',
      lineWidth: 1,
      priceFormat: { type: 'custom', formatter: (v: number) => `${v.toFixed(1)}%` },
    })

    // Add bot lines
    const newBotSeriesRefs: ISeriesApi<'Line'>[] = []
    botSeries.forEach((bot) => {
      const series = equityChart.addSeries(LineSeries, {
        color: bot.color,
        lineWidth: 1,
        priceFormat: { type: 'custom', formatter: (v: number) => `${v.toFixed(1)}%` },
      })
      newBotSeriesRefs.push(series)
    })

    // Drawdown chart
    const drawdownChart = createChart(drawdownEl, {
      width: drawdownEl.clientWidth,
      height: 80,
      layout: { background: { type: ColorType.Solid, color: bgColor }, textColor },
      grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
      rightPriceScale: { borderColor },
      timeScale: { borderColor },
      handleScroll: false,
      handleScale: false
    })

    const drawdownSeries = drawdownChart.addSeries(AreaSeries, {
      lineColor: '#ef4444',
      topColor: 'rgba(239, 68, 68, 0.0)',
      bottomColor: 'rgba(239, 68, 68, 0.4)',
      lineWidth: 1,
      invertFilledArea: true,
      priceFormat: { type: 'custom', formatter: (v: number) => `${v.toFixed(1)}%` },
    })

    equityChartRef.current = equityChart
    drawdownChartRef.current = drawdownChart
    portfolioSeriesRef.current = portfolioSeries
    botSeriesRefs.current = newBotSeriesRefs
    drawdownSeriesRef.current = drawdownSeries

    // Synchronize time scales
    const syncTimeScale = (sourceChart: IChartApi, targetChart: IChartApi) => {
      sourceChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range) {
          targetChart.timeScale().setVisibleLogicalRange(range)
        }
      })
    }

    syncTimeScale(equityChart, drawdownChart)
    syncTimeScale(drawdownChart, equityChart)

    // Resize observer
    const ro = new ResizeObserver(() => {
      equityChart.applyOptions({ width: equityEl.clientWidth })
      drawdownChart.applyOptions({ width: drawdownEl.clientWidth })
    })
    ro.observe(equityEl)

    return () => {
      ro.disconnect()
      equityChart.remove()
      drawdownChart.remove()
      equityChartRef.current = null
      drawdownChartRef.current = null
      portfolioSeriesRef.current = null
      botSeriesRefs.current = []
      drawdownSeriesRef.current = null
    }
  }, [botSeries.length])

  // Update chart colors when theme changes (without recreating the charts)
  useEffect(() => {
    const equityChart = equityChartRef.current
    const drawdownChart = drawdownChartRef.current
    if (!equityChart || !drawdownChart) return
    const isDark = theme === 'dark'
    const bgColor = isDark ? '#1e293b' : '#ffffff'
    const textColor = isDark ? '#e2e8f0' : '#0f172a'
    const gridColor = isDark ? '#334155' : '#eef2f7'
    const borderColor = isDark ? '#475569' : '#cbd5e1'
    equityChart.applyOptions({
      layout: { background: { type: ColorType.Solid, color: bgColor }, textColor },
      grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
      rightPriceScale: { borderColor },
      timeScale: { borderColor },
    })
    drawdownChart.applyOptions({
      layout: { background: { type: ColorType.Solid, color: bgColor }, textColor },
      grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
      rightPriceScale: { borderColor },
      timeScale: { borderColor },
    })
  }, [theme])

  useEffect(() => {
    if (!portfolioSeriesRef.current || !drawdownSeriesRef.current) return

    // Set portfolio returns
    portfolioSeriesRef.current.setData(portfolioReturns)

    // Set bot series data
    botSeries.forEach((bot, idx) => {
      const series = botSeriesRefs.current[idx]
      if (series) {
        series.setData(toReturns(bot.data))
      }
    })

    drawdownSeriesRef.current.setData(drawdownData)
    equityChartRef.current?.timeScale().fitContent()
    drawdownChartRef.current?.timeScale().fitContent()
  }, [portfolioReturns, botSeries, drawdownData, toReturns])

  return (
    <div className="w-full flex flex-col gap-1">
      <div ref={equityContainerRef} className="w-full h-[200px] rounded-t-lg border border-b-0 border-border overflow-hidden" />

      {/* Legend */}
      <div className="flex items-center gap-3 flex-wrap px-2 py-1 text-xs">
        {/* Portfolio line */}
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-0.5 rounded-full" style={{ backgroundColor: '#3b82f6' }} />
          <span className="font-semibold text-text">Portfolio</span>
        </div>

        {/* Bot lines */}
        {botSeries.map((bot) => (
          <div key={bot.id} className="flex items-center gap-1.5">
            <div className="w-3 h-0.5 rounded-full" style={{ backgroundColor: bot.color }} />
            <span className="text-muted">{bot.name}</span>
          </div>
        ))}
      </div>

      <div className="text-[10px] text-muted font-bold px-1">Drawdown</div>
      <div ref={drawdownContainerRef} className="w-full h-[80px] rounded-b-lg border border-border overflow-hidden" />
    </div>
  )
}
