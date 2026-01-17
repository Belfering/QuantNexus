// src/components/Forge/MetricInfoPopover.tsx
// Popover component to display metric information with formulas

import { useState, useRef } from 'react'
import { METRIC_LABELS, type EligibilityMetric } from '@/types/admin'

interface MetricInfo {
  name: string
  description: string
  formula: string
}

// Comprehensive metric information
const METRIC_INFO: Record<EligibilityMetric, MetricInfo> = {
  sharpe: {
    name: 'Sharpe Ratio',
    description: 'Excess return per unit of total risk',
    formula: '(Return - Risk Free) / Volatility'
  },
  sortino: {
    name: 'Sortino Ratio',
    description: 'Excess return per unit of downside risk',
    formula: '(Return - Risk Free) / Downside Deviation'
  },
  treynor: {
    name: 'Treynor Ratio',
    description: 'Excess return per unit of systematic risk',
    formula: '(Return - Risk Free) / Beta'
  },
  cagr: {
    name: 'CAGR',
    description: 'Compound Annual Growth Rate - annualized return',
    formula: '(Ending/Beginning)^(1/Years) - 1'
  },
  calmar: {
    name: 'Calmar Ratio',
    description: 'Return to max drawdown ratio',
    formula: 'CAGR / |Max Drawdown|'
  },
  tim: {
    name: 'Time in Market',
    description: 'Percentage of time holding positions',
    formula: '(Days Invested / Total Days) × 100'
  },
  timar: {
    name: 'TIM Adjusted Returns',
    description: 'CAGR adjusted for time in market',
    formula: 'CAGR × (TIM / 100)'
  },
  maxDrawdown: {
    name: 'Max Drawdown',
    description: 'Largest peak-to-trough decline',
    formula: 'Max((Peak - Trough) / Peak) × 100'
  },
  vol: {
    name: 'Volatility',
    description: 'Annualized standard deviation of returns',
    formula: 'StdDev(Daily Returns) × √252'
  },
  beta: {
    name: 'Beta',
    description: 'Correlation to market (SPY)',
    formula: 'Covariance(Strategy, SPY) / Variance(SPY)'
  },
  winRate: {
    name: 'Win Rate',
    description: 'Percentage of profitable periods',
    formula: '(Winning Days / Total Days) × 100'
  },
  avgTurnover: {
    name: 'Average Turnover',
    description: 'Portfolio turnover per rebalance',
    formula: 'Sum(|Position Changes|) / Rebalances'
  },
  avgHoldings: {
    name: 'Average Holdings',
    description: 'Average number of positions held',
    formula: 'Mean(Daily Position Count)'
  }
}

interface MetricInfoPopoverProps {
  metrics?: EligibilityMetric[] // Optional: show only specific metrics. If not provided, shows all
  className?: string
}

export function MetricInfoPopover({ metrics, className = '' }: MetricInfoPopoverProps) {
  const [show, setShow] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const triggerRef = useRef<HTMLSpanElement>(null)

  const metricsToShow = metrics || (Object.keys(METRIC_LABELS) as EligibilityMetric[])

  const handleMouseEnter = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPos({ x: rect.right + 8, y: rect.top + rect.height / 2 })
    }
    setShow(true)
  }

  return (
    <div
      className={`inline-flex items-center ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setShow(false)}
    >
      <span
        ref={triggerRef}
        className="w-3.5 h-3.5 rounded-full border border-muted-foreground/50 text-muted-foreground text-[9px] flex items-center justify-center cursor-help hover:border-foreground hover:text-foreground transition-colors"
      >
        ?
      </span>
      {show && (
        <div
          className="fixed z-[9999] bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-md shadow-xl p-3 min-w-[320px] max-w-[400px] max-h-[500px] overflow-y-auto"
          style={{ left: pos.x, top: pos.y, transform: 'translateY(-50%)' }}
        >
          <div className="text-xs font-bold mb-3 text-zinc-900 dark:text-zinc-100">
            Metric Definitions
          </div>
          <div className="space-y-3">
            {metricsToShow.map((metric) => {
              const info = METRIC_INFO[metric]
              return (
                <div key={metric} className="border-b border-zinc-200 dark:border-zinc-700 pb-2 last:border-0">
                  <div className="text-xs font-semibold mb-1 text-zinc-900 dark:text-zinc-100">
                    {info.name}
                  </div>
                  <div className="text-[11px] text-zinc-600 dark:text-zinc-400 mb-1.5 leading-relaxed">
                    {info.description}
                  </div>
                  <div className="text-[10px] font-mono bg-zinc-100 dark:bg-zinc-800 px-2 py-1.5 rounded text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700">
                    {info.formula}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
