/**
 * Range Config Popover Component
 * Phase 3: QuantNexus Redesign - Configure optimization ranges (min/max/step)
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { VisualParameter } from '@/types/flowchart';

interface RangeConfigPopoverProps {
  parameter: VisualParameter;
  onSave: (range: { min: number; max: number; step: number }) => void;
  onDisable: () => void;
}

export function RangeConfigPopover({ parameter, onSave, onDisable }: RangeConfigPopoverProps) {
  const current = parameter.currentValue as number;
  const [min, setMin] = useState(parameter.min || current - 5);
  const [max, setMax] = useState(parameter.max || current + 5);
  const [step, setStep] = useState(parameter.step || 1);

  const branchCount = Math.floor((max - min) / step) + 1;
  const isValid = min < max && step > 0;

  return (
    <div className="space-y-3 p-3 w-64">
      {/* Current Value Display */}
      <div>
        <label className="text-xs font-medium text-muted-foreground">Current Value</label>
        <div className="text-lg font-bold">{current}</div>
      </div>

      {/* Range Inputs */}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-xs font-medium">Min</label>
          <Input
            type="number"
            value={min}
            onChange={(e) => setMin(Number(e.target.value))}
            className="h-8"
          />
        </div>
        <div>
          <label className="text-xs font-medium">Max</label>
          <Input
            type="number"
            value={max}
            onChange={(e) => setMax(Number(e.target.value))}
            className="h-8"
          />
        </div>
        <div>
          <label className="text-xs font-medium">Step</label>
          <Input
            type="number"
            value={step}
            onChange={(e) => setStep(Number(e.target.value))}
            className="h-8"
            min={1}
          />
        </div>
      </div>

      {/* Branch Count Estimate */}
      {isValid && (
        <div className="text-xs text-muted-foreground">
          Will test <span className="font-semibold">{branchCount}</span> values
        </div>
      )}

      {!isValid && (
        <div className="text-xs text-destructive">
          Invalid range: min must be less than max, step must be positive
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2">
        {parameter.optimizationEnabled ? (
          <Button
            size="sm"
            variant="outline"
            onClick={onDisable}
            className="flex-1"
          >
            Disable Optimization
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onSave({ min: current, max: current, step: 1 })}
            className="flex-1"
          >
            Use Current Only
          </Button>
        )}

        <Button
          size="sm"
          onClick={() => onSave({ min, max, step })}
          disabled={!isValid}
          className="flex-1"
        >
          Save Range
        </Button>
      </div>
    </div>
  );
}
