// src/features/parameters/components/RangeConfigPopover.tsx
// Configure optimization ranges (min/max/step) for parameters

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { VisualParameter } from '../types'

interface RangeConfigPopoverProps {
  parameter: VisualParameter
  onSave: (range: { min: number; max: number; step: number }) => void
  onDisable: () => void
}

export function RangeConfigPopover({ parameter, onSave, onDisable }: RangeConfigPopoverProps) {
  const current = parameter.currentValue as number
  const [min, setMin] = useState(parameter.min || current - 5)
  const [max, setMax] = useState(parameter.max || current + 5)

  const step = 1 // Fixed step value
  const branchCount = Math.floor((max - min) / step) + 1
  const isValid = min < max

  return (
    <div className="space-y-3 p-3 w-48">
      {/* Range Inputs */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-medium text-center block">Min</label>
          <Input
            type="number"
            value={min}
            onChange={(e) => setMin(Number(e.target.value))}
            className="h-8"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-center block">Max</label>
          <Input
            type="number"
            value={max}
            onChange={(e) => setMax(Number(e.target.value))}
            className="h-8"
          />
        </div>
      </div>

      {/* Branch Count Estimate */}
      {isValid && (
        <div className="text-xs text-muted-foreground text-center">
          Will test <span className="font-semibold">{branchCount}</span> values
        </div>
      )}

      {!isValid && (
        <div className="text-xs text-destructive text-center">
          Invalid: min must be less than max
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
