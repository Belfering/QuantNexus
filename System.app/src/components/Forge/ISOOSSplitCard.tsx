// src/components/Forge/ISOOSSplitCard.tsx
// IS/OOS split configuration component for optimization

import { useEffect } from 'react'
import { type ISOOSSplitConfig, type SplitStrategy, type RollingWindowPeriod } from '@/types/split'

interface ISOOSSplitCardProps {
  splitConfig?: ISOOSSplitConfig
  onSplitConfigChange: (config: ISOOSSplitConfig) => void
}

export function ISOOSSplitCard({ splitConfig, onSplitConfigChange }: ISOOSSplitCardProps) {
  const strategy = splitConfig?.strategy ?? 'chronological'
  const chronologicalPercent = splitConfig?.chronologicalPercent ?? 50
  const rollingWindowPeriod = splitConfig?.rollingWindowPeriod ?? 'monthly'
  const minYears = splitConfig?.minYears ?? 5
  const rollingStartYear = splitConfig?.rollingStartYear ?? 1996
  const minWarmUpYears = splitConfig?.minWarmUpYears ?? 3
  const rankBy = splitConfig?.rankBy ?? 'Sharpe Ratio'

  // Initialize splitConfig with defaults if it's undefined (for existing bots)
  useEffect(() => {
    if (!splitConfig) {
      onSplitConfigChange({
        enabled: true,
        strategy: 'chronological',
        chronologicalPercent: 50,
        minYears: 5
      })
    }
  }, [splitConfig, onSplitConfigChange]) // Run when splitConfig changes

  const handleStrategyChange = (newStrategy: SplitStrategy) => {
    onSplitConfigChange({
      enabled: true,
      strategy: newStrategy,
      chronologicalPercent: newStrategy === 'chronological' ? 50 : undefined,
      rollingWindowPeriod: newStrategy === 'rolling' ? 'monthly' : undefined,
      minYears: newStrategy === 'chronological' ? 5 : undefined,
      rollingStartYear: newStrategy === 'rolling' ? 1996 : undefined,
      minWarmUpYears: newStrategy === 'rolling' ? 3 : undefined,
      rankBy: newStrategy === 'rolling' ? 'Sharpe Ratio' : undefined
    })
  }

  const handlePercentChange = (percent: number) => {
    onSplitConfigChange({
      ...splitConfig,
      enabled: true,
      strategy,
      chronologicalPercent: percent
    })
  }

  const handleRollingWindowChange = (period: RollingWindowPeriod) => {
    onSplitConfigChange({
      ...splitConfig,
      enabled: true,
      strategy,
      rollingWindowPeriod: period
    })
  }

  const handleMinYearsChange = (years: number) => {
    onSplitConfigChange({
      ...splitConfig,
      enabled: true,
      strategy,
      minYears: years
    })
  }

  const handleRollingStartYearChange = (year: number) => {
    onSplitConfigChange({
      ...splitConfig,
      enabled: true,
      strategy,
      rollingStartYear: year
    })
  }

  const handleMinWarmUpYearsChange = (years: number) => {
    onSplitConfigChange({
      ...splitConfig,
      enabled: true,
      strategy,
      minWarmUpYears: years
    })
  }

  const handleRankByChange = (metric: string) => {
    onSplitConfigChange({
      ...splitConfig,
      enabled: true,
      strategy,
      rankBy: metric
    })
  }

  const getStrategyDescription = () => {
    if (strategy === 'chronological') {
      return `First ${chronologicalPercent}% of data is In-Sample, last ${100 - chronologicalPercent}% is Out-of-Sample`
    } else if (strategy === 'rolling') {
      return `Uses a rolling ${rollingWindowPeriod} window for IS/OOS validation`
    }
    return ''
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Left Card - Strategy Selection */}
      <div className="space-y-3 p-3 rounded border border-border bg-muted/20">
        {/* Strategy Dropdown */}
        <div>
          <label htmlFor="split-strategy" className="text-xs text-muted block mb-1">
            Split Strategy
          </label>
          <select
            id="split-strategy"
            value={strategy}
            onChange={(e) => handleStrategyChange(e.target.value as SplitStrategy)}
            className="w-full px-2 py-1 rounded border border-border bg-background text-sm"
          >
            <option value="chronological">Chronological</option>
            <option value="rolling">Rolling</option>
          </select>
        </div>

        {/* Chronological Percentage (50/50, 60/40, 70/30) */}
        {strategy === 'chronological' && (
          <div>
            <label htmlFor="chronological-percent" className="text-xs text-muted block mb-1">
              IS/OOS Split
            </label>
            <select
              id="chronological-percent"
              value={chronologicalPercent}
              onChange={(e) => handlePercentChange(Number(e.target.value))}
              className="w-full px-2 py-1 rounded border border-border bg-background text-sm"
            >
              <option value={50}>50/50 (Half IS, Half OOS)</option>
              <option value={60}>60/40 (60% IS, 40% OOS)</option>
              <option value={70}>70/30 (70% IS, 30% OOS)</option>
            </select>
          </div>
        )}

        {/* Rolling Window Period */}
        {strategy === 'rolling' && (
          <>
            <div>
              <label htmlFor="rolling-window" className="text-xs text-muted block mb-1">
                Rolling Window Period
              </label>
              <select
                id="rolling-window"
                value={rollingWindowPeriod}
                onChange={(e) => handleRollingWindowChange(e.target.value as RollingWindowPeriod)}
                className="w-full px-2 py-1 rounded border border-border bg-background text-sm"
              >
                <option value="yearly">Yearly</option>
                <option value="monthly">Monthly</option>
                <option value="daily">Daily</option>
              </select>
            </div>

            <div>
              <label htmlFor="rank-by" className="text-xs text-muted block mb-1">
                Rank By
              </label>
              <select
                id="rank-by"
                value={rankBy}
                onChange={(e) => handleRankByChange(e.target.value)}
                className="w-full px-2 py-1 rounded border border-border bg-background text-sm"
              >
                <option value="CAGR">CAGR</option>
                <option value="Max Drawdown">Max Drawdown</option>
                <option value="Calmar Ratio">Calmar Ratio</option>
                <option value="Sharpe Ratio">Sharpe Ratio</option>
                <option value="Sortino Ratio">Sortino Ratio</option>
                <option value="Treynor Ratio">Treynor Ratio</option>
                <option value="Beta">Beta</option>
                <option value="Volatility">Volatility</option>
                <option value="Win Rate">Win Rate</option>
                <option value="Avg Turnover">Avg Turnover</option>
                <option value="Avg Holdings">Avg Holdings</option>
                <option value="Time in Market">Time in Market</option>
                <option value="TIM Adjusted Returns">TIM Adjusted Returns</option>
              </select>
            </div>
          </>
        )}

        {/* Strategy Description */}
        <div className="text-xs text-muted">
          {getStrategyDescription()}
        </div>
      </div>

      {/* Right Card - Additional Configuration */}
      <div className="space-y-3 p-3 rounded border border-border bg-muted/20">
        {strategy === 'chronological' && (
          <>
            {/* Minimum Number of Years */}
            <div>
              <label htmlFor="min-years" className="text-xs text-muted block mb-1">
                Minimum Number of Years
              </label>
              <select
                id="min-years"
                value={minYears}
                onChange={(e) => handleMinYearsChange(Number(e.target.value))}
                className="w-full px-2 py-1 rounded border border-border bg-background text-sm"
              >
                {[5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
                <option value={15}>15+</option>
              </select>
            </div>
          </>
        )}

        {strategy === 'rolling' && (
          <>
            {/* Rolling Start Year */}
            <div>
              <label htmlFor="rolling-start-year" className="text-xs text-muted block mb-1">
                Rolling Start Year
              </label>
              <select
                id="rolling-start-year"
                value={rollingStartYear}
                onChange={(e) => handleRollingStartYearChange(Number(e.target.value))}
                className="w-full px-2 py-1 rounded border border-border bg-background text-sm"
              >
                {Array.from({ length: 31 }, (_, i) => 1996 + i).map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </div>

            {/* Minimum Warm Up Years */}
            <div>
              <label htmlFor="min-warmup-years" className="text-xs text-muted block mb-1">
                Minimum Warm Up Years
              </label>
              <select
                id="min-warmup-years"
                value={minWarmUpYears}
                onChange={(e) => handleMinWarmUpYearsChange(Number(e.target.value))}
                className="w-full px-2 py-1 rounded border border-border bg-background text-sm"
              >
                {[3, 4, 5, 6, 7, 8, 9].map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
                <option value={10}>10+</option>
              </select>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
