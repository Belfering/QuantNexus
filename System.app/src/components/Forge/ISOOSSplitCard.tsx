// src/components/Forge/ISOOSSplitCard.tsx
// IS/OOS split configuration component for optimization

import { type ISOOSSplitConfig, type SplitStrategy } from '@/types/split'

interface ISOOSSplitCardProps {
  splitConfig?: ISOOSSplitConfig
  onSplitConfigChange: (config: ISOOSSplitConfig) => void
}

export function ISOOSSplitCard({ splitConfig, onSplitConfigChange }: ISOOSSplitCardProps) {
  const enabled = splitConfig?.enabled ?? false
  const strategy = splitConfig?.strategy ?? 'chronological'
  const chronologicalPercent = splitConfig?.chronologicalPercent ?? 50
  const rollingWindowMonths = splitConfig?.rollingWindowMonths ?? 12

  const handleEnabledChange = (checked: boolean) => {
    onSplitConfigChange({
      enabled: checked,
      strategy,
      chronologicalPercent: strategy === 'chronological' ? chronologicalPercent : undefined,
      rollingWindowMonths: strategy === 'rolling' ? rollingWindowMonths : undefined
    })
  }

  const handleStrategyChange = (newStrategy: SplitStrategy) => {
    onSplitConfigChange({
      enabled,
      strategy: newStrategy,
      chronologicalPercent: newStrategy === 'chronological' ? 50 : undefined,
      rollingWindowMonths: newStrategy === 'rolling' ? 12 : undefined
    })
  }

  const handlePercentChange = (percent: number) => {
    onSplitConfigChange({
      enabled,
      strategy,
      chronologicalPercent: percent,
      rollingWindowMonths
    })
  }

  const handleRollingWindowChange = (months: number) => {
    onSplitConfigChange({
      enabled,
      strategy,
      chronologicalPercent,
      rollingWindowMonths: months
    })
  }

  const getStrategyDescription = () => {
    if (strategy === 'chronological') {
      return `First ${chronologicalPercent}% of data is In-Sample, last ${100 - chronologicalPercent}% is Out-of-Sample`
    } else if (strategy === 'rolling') {
      return `Uses a rolling ${rollingWindowMonths}-month window for IS/OOS validation`
    }
    return ''
  }

  return (
    <div className="space-y-3">
      {/* Enable Checkbox */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="is-oos-split-enabled"
          checked={enabled}
          onChange={(e) => handleEnabledChange(e.target.checked)}
          className="h-4 w-4 rounded border-border"
        />
        <label
          htmlFor="is-oos-split-enabled"
          className="text-sm font-medium cursor-pointer"
        >
          Enable IS/OOS Split
        </label>
      </div>

      {/* Strategy Dropdown */}
      {enabled && (
        <>
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
                <option value={60}>60/40</option>
                <option value={70}>70/30</option>
              </select>
            </div>
          )}

          {/* Rolling Window Size */}
          {strategy === 'rolling' && (
            <div>
              <label htmlFor="rolling-window" className="text-xs text-muted block mb-1">
                Rolling Window (months)
              </label>
              <input
                type="number"
                id="rolling-window"
                min="1"
                max="60"
                value={rollingWindowMonths}
                onChange={(e) => handleRollingWindowChange(Number(e.target.value))}
                className="w-full px-2 py-1 rounded border border-border bg-background text-sm"
              />
            </div>
          )}

          {/* Strategy Description */}
          <div className="text-xs text-muted">
            {getStrategyDescription()}
          </div>
        </>
      )}
    </div>
  )
}
