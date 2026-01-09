// src/components/Forge/ISOOSSplitCard.tsx
// IS/OOS split configuration component for optimization

import { type ISOOSSplitConfig, type SplitStrategy, type RollingWindowPeriod } from '@/types/split'

interface ISOOSSplitCardProps {
  splitConfig?: ISOOSSplitConfig
  onSplitConfigChange: (config: ISOOSSplitConfig) => void
}

export function ISOOSSplitCard({ splitConfig, onSplitConfigChange }: ISOOSSplitCardProps) {
  const strategy = splitConfig?.strategy ?? 'chronological'
  const chronologicalPercent = splitConfig?.chronologicalPercent ?? 50
  const rollingWindowPeriod = splitConfig?.rollingWindowPeriod ?? 'monthly'

  const handleStrategyChange = (newStrategy: SplitStrategy) => {
    onSplitConfigChange({
      enabled: true,
      strategy: newStrategy,
      chronologicalPercent: newStrategy === 'chronological' ? 50 : undefined,
      rollingWindowPeriod: newStrategy === 'rolling' ? 'monthly' : undefined
    })
  }

  const handlePercentChange = (percent: number) => {
    onSplitConfigChange({
      enabled: true,
      strategy,
      chronologicalPercent: percent,
      rollingWindowPeriod
    })
  }

  const handleRollingWindowChange = (period: RollingWindowPeriod) => {
    onSplitConfigChange({
      enabled: true,
      strategy,
      chronologicalPercent,
      rollingWindowPeriod: period
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
    <div className="space-y-3">
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
      )}

      {/* Strategy Description */}
      <div className="text-xs text-muted">
        {getStrategyDescription()}
      </div>
    </div>
  )
}
