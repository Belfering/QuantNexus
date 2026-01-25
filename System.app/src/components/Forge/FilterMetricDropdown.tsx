// src/components/Forge/FilterMetricDropdown.tsx
// Custom dropdown for filter metrics (includes computed metrics)

import { useState, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

type FilterMetric = 'sharpe' | 'sortino' | 'treynor' | 'cagr' | 'calmar' | 'tim' | 'timar' | 'maxDrawdown' | 'vol' | 'beta' | 'winRate' | 'avgTurnover' | 'avgHoldings' | 'timarMaxDDRatio' | 'timarTimarMaxDD' | 'cagrCalmar'

interface MetricInfo {
  name: string
  description: string
  formula: string
}

const FILTER_METRIC_LABELS: Record<FilterMetric, string> = {
  sharpe: 'Sharpe',
  sortino: 'Sortino',
  treynor: 'Treynor',
  cagr: 'CAGR',
  calmar: 'Calmar',
  tim: 'TIM',
  timar: 'TIMAR',
  maxDrawdown: 'Max Drawdown',
  vol: 'Volatility',
  beta: 'Beta',
  winRate: 'Win Rate',
  avgTurnover: 'Avg Turnover',
  avgHoldings: 'Avg Holdings',
  timarMaxDDRatio: 'TIMAR/MaxDD',
  timarTimarMaxDD: 'TIMAR x (TIMAR/MaxDD)',
  cagrCalmar: 'CAGR x CALMAR'
}

const FILTER_METRIC_INFO: Record<FilterMetric, MetricInfo> = {
  sharpe: {
    name: 'Sharpe Ratio',
    description: 'Excess return per unit of total risk. Higher is better.',
    formula: '(Return - Risk Free) / Volatility'
  },
  sortino: {
    name: 'Sortino Ratio',
    description: 'Excess return per unit of downside risk. Penalizes only negative volatility.',
    formula: '(Return - Risk Free) / Downside Deviation'
  },
  treynor: {
    name: 'Treynor Ratio',
    description: 'Excess return per unit of systematic risk. Measures return relative to market risk.',
    formula: '(Return - Risk Free) / Beta'
  },
  cagr: {
    name: 'CAGR',
    description: 'Compound Annual Growth Rate - annualized return over the period.',
    formula: '(Ending Value / Beginning Value)^(1/Years) - 1'
  },
  calmar: {
    name: 'Calmar Ratio',
    description: 'Return to max drawdown ratio. Measures return per unit of worst loss.',
    formula: 'CAGR / |Max Drawdown|'
  },
  tim: {
    name: 'Time in Market',
    description: 'Percentage of time holding positions vs cash. Higher means more market exposure.',
    formula: '(Days Invested / Total Days) × 100'
  },
  timar: {
    name: 'TIMAR',
    description: 'Time in Market Adjusted Returns. Rewards both returns and efficiency.',
    formula: 'CAGR × (TIM / 100)'
  },
  maxDrawdown: {
    name: 'Max Drawdown',
    description: 'Largest peak-to-trough decline. Lower is better (less risk).',
    formula: 'Max((Peak - Trough) / Peak) × 100'
  },
  vol: {
    name: 'Volatility',
    description: 'Annualized standard deviation of returns. Lower is better (less volatile).',
    formula: 'StdDev(Daily Returns) × √252'
  },
  beta: {
    name: 'Beta',
    description: 'Correlation to market (SPY). 1.0 = matches market, >1 = more volatile, <1 = less volatile.',
    formula: 'Covariance(Strategy, SPY) / Variance(SPY)'
  },
  winRate: {
    name: 'Win Rate',
    description: 'Percentage of profitable periods. Higher means more consistent gains.',
    formula: '(Winning Days / Total Days) × 100'
  },
  avgTurnover: {
    name: 'Average Turnover',
    description: 'Average portfolio turnover per rebalance. Higher means more trading.',
    formula: '(Sum of |Position Changes|) / Number of Rebalances'
  },
  avgHoldings: {
    name: 'Average Holdings',
    description: 'Average number of positions held. Higher means more diversification.',
    formula: 'Mean(Daily Position Count)'
  },
  timarMaxDDRatio: {
    name: 'TIMAR/MaxDD',
    description: 'Reward-to-risk ratio. Higher means better risk-adjusted returns considering time efficiency.',
    formula: 'TIMAR / Max Drawdown'
  },
  timarTimarMaxDD: {
    name: 'TIMAR × (TIMAR/MaxDD)',
    description: 'Squared reward/risk metric. Emphasizes both high returns and low drawdowns.',
    formula: '(TIMAR × 100) × (TIMAR / MaxDD)'
  },
  cagrCalmar: {
    name: 'CAGR × CALMAR',
    description: 'Combined growth and risk metric. Rewards strategies with high growth and controlled drawdowns.',
    formula: '(CAGR × 100) × Calmar'
  }
}

// Tooltip component for individual metrics
const MetricTooltip = ({ metric }: { metric: FilterMetric }) => {
  const [show, setShow] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const triggerRef = useRef<HTMLSpanElement>(null)
  const info = FILTER_METRIC_INFO[metric]

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

interface FilterMetricDropdownProps {
  value: FilterMetric
  onChange: (metric: FilterMetric) => void
  className?: string
  disabled?: boolean
}

export function FilterMetricDropdown({ value, onChange, className, disabled }: FilterMetricDropdownProps) {
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

  const allMetrics = Object.keys(FILTER_METRIC_LABELS) as FilterMetric[]

  return (
    <div ref={dropdownRef} className={cn('relative inline-block', className)}>
      <button
        type="button"
        className="w-full h-8 px-2 text-sm border border-border rounded bg-background text-left flex items-center gap-1 hover:bg-accent/50 disabled:opacity-50 disabled:cursor-not-allowed"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
      >
        <span className="truncate flex-1">{FILTER_METRIC_LABELS[value]}</span>
        <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && !disabled && (
        <div className="absolute z-[200] mt-1 bg-background border border-border rounded shadow-lg min-w-full w-max max-h-[400px] overflow-y-auto">
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
              <span className="truncate">{FILTER_METRIC_LABELS[metric]}</span>
              <MetricTooltip metric={metric} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
