// src/features/parameters/components/RangeConfigPopover.tsx
// Configure optimization ranges (min/max/step) for parameters

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { VisualParameter } from '../types'
import type { IndicatorConfig } from '@/constants/indicatorDefaults'
import { getPriceRelativeRange } from '@/constants/indicatorDefaults'

interface RangeConfigPopoverProps {
  parameter: VisualParameter
  onSave: (range: { min: number; max: number; step: number }) => void
  onDisable: () => void
  indicatorConfig?: IndicatorConfig  // NEW: indicator-specific config
}

export function RangeConfigPopover({ parameter, onSave, onDisable, indicatorConfig }: RangeConfigPopoverProps) {
  const current = parameter.currentValue as number

  // Use indicator-specific defaults if available
  // For price-relative indicators, calculate dynamic ranges
  const getDefaults = () => {
    if (indicatorConfig?.isPriceRelative && current) {
      return getPriceRelativeRange(indicatorConfig, current)
    }
    return {
      min: indicatorConfig?.min ?? (current + 5),
      max: indicatorConfig?.max ?? (current + 10),
      step: indicatorConfig?.step ?? 1,
    }
  }

  const defaults = getDefaults()

  // Always initialize from current value or indicator defaults
  const [min, setMin] = useState(defaults.min)
  const [max, setMax] = useState(defaults.max)
  const [step, setStep] = useState(defaults.step)

  const branchCount = step > 0 ? Math.floor((max - min) / step) + 1 : 0
  const isValid = min <= max && step > 0

  return (
    <div className="space-y-3 p-3 w-52">
      {/* Range Inputs */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-medium text-center block">Min</label>
          <Input
            type="number"
            value={min}
            onChange={(e) => setMin(Number(e.target.value))}
            className="h-8"
            step={step}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-center block">Max</label>
          <Input
            type="number"
            value={max}
            onChange={(e) => setMax(Number(e.target.value))}
            className="h-8"
            step={step}
          />
        </div>
      </div>

      {/* Step Input */}
      <div>
        <label className="text-xs font-medium text-center block">Incrementally by</label>
        <Input
          type="number"
          value={step}
          onChange={(e) => setStep(Math.max(0.001, Number(e.target.value)))}
          className="h-8"
          step={0.1}
          min={0.001}
        />
      </div>

      {/* Branch Count Estimate */}
      {isValid && (
        <div className="text-xs text-muted-foreground text-center">
          Will test <span className="font-semibold">{branchCount}</span> value{branchCount !== 1 ? 's' : ''}
        </div>
      )}

      {!isValid && (
        <div className="text-xs text-destructive text-center">
          {step <= 0 ? 'Step must be greater than 0' : 'Min must be less than max'}
        </div>
      )}

      {/* Tooltip with range description */}
      {indicatorConfig?.rangeDescription && (
        <div className="text-xs text-muted-foreground p-2 bg-muted/30 rounded border border-border">
          <div className="font-medium mb-1">Suggested Range:</div>
          {indicatorConfig.rangeDescription}
        </div>
      )}

      {/* Save Button */}
      <Button
        size="sm"
        onClick={() => onSave({ min, max, step })}
        disabled={!isValid}
        className="w-full"
      >
        Save Range
      </Button>
    </div>
  )
}
