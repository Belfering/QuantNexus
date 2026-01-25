// src/components/Forge/MetricDropdown.tsx
// Custom dropdown for metrics with individual help icons per metric

import { useState, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { METRIC_LABELS, type EligibilityMetric } from '@/types/admin'

interface MetricInfo {
  name: string
  description: string
  formula: string
}

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
  },
  timarMaxDDRatio: {
    name: 'TIMAR/MaxDD',
    description: 'Reward-to-risk ratio',
    formula: 'TIMAR / Max Drawdown'
  },
  timarTimarMaxDD: {
    name: 'TIMAR × (TIMAR/MaxDD)',
    description: 'Squared reward/risk metric',
    formula: '(TIMAR × 100) × (TIMAR / MaxDD)'
  },
  cagrCalmar: {
    name: 'CAGR × CALMAR',
    description: 'Combined growth and risk metric',
    formula: '(CAGR × 100) × Calmar'
  }
}

// Tooltip component for individual metrics
const MetricTooltip = ({ metric }: { metric: EligibilityMetric }) => {
  const [show, setShow] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const triggerRef = useRef<HTMLSpanElement>(null)
  const info = METRIC_INFO[metric]

  const handleMouseEnter = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPos({ x: rect.right + 8, y: rect.top + rect.height / 2 })
    }
    setShow(true)
  }

  return (
    <div
      className="inline-flex items-center"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setShow(false)}
    >
      <span
        ref={triggerRef}
        className="w-3.5 h-3.5 rounded-full border border-muted-foreground/50 text-muted-foreground text-[9px] flex items-center justify-center cursor-help hover:border-foreground hover:text-foreground transition-colors"
      >
        ?
      </span>
      {show && info && (
        <div
          className="fixed z-[9999] bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-md shadow-xl p-2.5 min-w-[240px] max-w-[300px]"
          style={{ left: pos.x, top: pos.y, transform: 'translateY(-50%)' }}
        >
          <div className="text-xs font-semibold mb-1.5 text-zinc-900 dark:text-zinc-100">{info.name}</div>
          <div className="text-[11px] text-zinc-600 dark:text-zinc-400 mb-2 leading-relaxed">{info.description}</div>
          <div className="text-[10px] font-mono bg-zinc-100 dark:bg-zinc-800 px-2 py-1.5 rounded text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700">
            {info.formula}
          </div>
        </div>
      )}
    </div>
  )
}

interface MetricDropdownProps {
  value: EligibilityMetric
  onChange: (metric: EligibilityMetric) => void
  className?: string
  disabled?: boolean
}

export function MetricDropdown({ value, onChange, className, disabled }: MetricDropdownProps) {
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open])

  const allMetrics = Object.keys(METRIC_LABELS) as EligibilityMetric[]

  return (
    <div ref={dropdownRef} className={cn('relative inline-block', className)}>
      <button
        type="button"
        className="w-full h-8 px-2 text-sm border border-border rounded bg-background text-left flex items-center gap-1 hover:bg-accent/50 disabled:opacity-50 disabled:cursor-not-allowed"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
      >
        <span className="truncate flex-1">{METRIC_LABELS[value]}</span>
        <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && !disabled && (
        <div className="absolute z-[200] mt-1 bg-background border border-border rounded shadow-lg min-w-full w-max max-h-[300px] overflow-y-auto">
          {allMetrics.map((metric) => (
            <div
              key={metric}
              className={cn(
                'px-3 py-1.5 text-sm cursor-pointer flex items-center justify-between gap-2',
                metric === value ? 'bg-accent font-medium' : 'hover:bg-accent/50'
              )}
              onClick={() => {
                onChange(metric)
                setOpen(false)
              }}
            >
              <span className="truncate">{METRIC_LABELS[metric]}</span>
              <MetricTooltip metric={metric} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
