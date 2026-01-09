// src/components/Forge/ISOOSSplitCard.tsx
// IS/OOS split configuration component for optimization

import { type ISOOSSplitConfig, type SplitStrategy } from '@/types/split'

interface ISOOSSplitCardProps {
  splitConfig?: ISOOSSplitConfig
  onSplitConfigChange: (config: ISOOSSplitConfig) => void
}

const STRATEGY_DESCRIPTIONS: Record<SplitStrategy, string> = {
  even_odd_month: 'Odd months (Jan, Mar, May, Jul, Sep, Nov) are In-Sample. Even months (Feb, Apr, Jun, Aug, Oct, Dec) are Out-of-Sample.',
  even_odd_year: 'Odd years (2019, 2021, 2023, etc.) are In-Sample. Even years (2020, 2022, 2024, etc.) are Out-of-Sample.',
  chronological: 'Data before the threshold date is In-Sample. Data after the threshold date is Out-of-Sample.'
}

export function ISOOSSplitCard({ splitConfig, onSplitConfigChange }: ISOOSSplitCardProps) {
  const enabled = splitConfig?.enabled ?? false
  const strategy = splitConfig?.strategy ?? 'even_odd_month'
  const chronologicalDate = splitConfig?.chronologicalDate ?? ''

  const handleEnabledChange = (checked: boolean) => {
    onSplitConfigChange({
      enabled: checked,
      strategy,
      chronologicalDate: strategy === 'chronological' ? chronologicalDate : undefined
    })
  }

  const handleStrategyChange = (newStrategy: SplitStrategy) => {
    onSplitConfigChange({
      enabled,
      strategy: newStrategy,
      chronologicalDate: newStrategy === 'chronological' ? chronologicalDate || '2020-01-01' : undefined
    })
  }

  const handleDateChange = (date: string) => {
    onSplitConfigChange({
      enabled,
      strategy,
      chronologicalDate: date
    })
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
              <option value="even_odd_month">Even/Odd Month</option>
              <option value="even_odd_year">Even/Odd Year</option>
              <option value="chronological">Chronological</option>
            </select>
          </div>

          {/* Strategy Description */}
          <div className="text-xs text-muted">
            {STRATEGY_DESCRIPTIONS[strategy]}
          </div>

          {/* Date Picker (only for chronological strategy) */}
          {strategy === 'chronological' && (
            <div>
              <label htmlFor="chronological-date" className="text-xs text-muted block mb-1">
                Threshold Date
              </label>
              <input
                type="date"
                id="chronological-date"
                value={chronologicalDate}
                onChange={(e) => handleDateChange(e.target.value)}
                className="w-full px-2 py-1 rounded border border-border bg-background text-sm"
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
