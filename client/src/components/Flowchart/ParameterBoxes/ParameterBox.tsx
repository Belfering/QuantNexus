/**
 * Parameter Box Component
 * Phase 3: QuantNexus Redesign - Individual colored parameter box
 */

import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select } from '@/components/ui/select';
import type { VisualParameter, ParameterField, MetricChoice, ComparatorChoice } from '@/types/flowchart';
import { RangeConfigPopover } from './RangeConfigPopover';
import { IndicatorDropdown } from '../IndicatorDropdown';

interface ParameterBoxProps {
  parameter: VisualParameter;
  onUpdate: (field: ParameterField, value: any) => void;
  onEnableOptimization: (enabled: boolean, range?: { min: number; max: number; step: number }) => void;
}

function getFieldLabel(field: ParameterField): string {
  switch (field) {
    case 'window':
      return 'Period';
    case 'metric':
      return 'Indicator';
    case 'comparator':
      return 'Compare';
    case 'ticker':
      return 'Ticker';
    case 'threshold':
      return 'Value';
  }
}

export function ParameterBox({ parameter, onUpdate, onEnableOptimization }: ParameterBoxProps) {
  const [showRangeConfig, setShowRangeConfig] = useState(false);

  const isOptimizable = parameter.field === 'window' || parameter.field === 'threshold';
  const label = getFieldLabel(parameter.field);

  // Handle click for optimizable fields
  const handleClick = () => {
    if (isOptimizable) {
      setShowRangeConfig(true);
    }
  };

  return (
    <Popover open={showRangeConfig} onOpenChange={setShowRangeConfig}>
      <PopoverTrigger asChild>
        <div
          className={`
            inline-flex flex-col gap-1 px-3 py-2 rounded-lg min-w-[80px]
            shadow-sm hover:shadow-md transition-shadow
            ${isOptimizable ? 'cursor-pointer' : 'cursor-default'}
            ${parameter.optimizationEnabled ? 'ring-2 ring-primary ring-offset-1' : ''}
          `}
          style={{ backgroundColor: parameter.nodeColor }}
          onClick={handleClick}
        >
          <label className="text-[10px] font-semibold uppercase opacity-80">
            {label}
          </label>

          {/* Metric Dropdown */}
          {parameter.field === 'metric' && (
            <div onClick={(e) => e.stopPropagation()}>
              <IndicatorDropdown
                value={parameter.currentValue as MetricChoice}
                onChange={(val) => onUpdate('metric', val)}
                className="bg-white/90 border-black/10 h-7 text-xs"
              />
            </div>
          )}

          {/* Comparator Dropdown */}
          {parameter.field === 'comparator' && (
            <div onClick={(e) => e.stopPropagation()}>
              <Select
                value={parameter.currentValue as ComparatorChoice}
                onChange={(e) => onUpdate('comparator', e.target.value as ComparatorChoice)}
                className="bg-white/90 border-black/10 h-7 text-xs"
              >
                <option value="lt">Less Than</option>
                <option value="gt">Greater Than</option>
                <option value="crossAbove">Cross Above</option>
                <option value="crossBelow">Cross Below</option>
              </Select>
            </div>
          )}

          {/* Simple Value Display (window, ticker, threshold) */}
          {(parameter.field === 'window' || parameter.field === 'ticker' || parameter.field === 'threshold') && (
            <span className="text-sm font-medium">
              {parameter.currentValue}
              {parameter.optimizationEnabled && (
                <span className="ml-1 text-[10px] font-bold text-primary">OPT</span>
              )}
            </span>
          )}
        </div>
      </PopoverTrigger>

      {/* Range Configuration Popover (for optimizable fields only) */}
      {isOptimizable && (
        <PopoverContent className="w-auto p-0" align="start">
          <RangeConfigPopover
            parameter={parameter}
            onSave={(range) => {
              onEnableOptimization(true, range);
              setShowRangeConfig(false);
            }}
            onDisable={() => {
              onEnableOptimization(false);
              setShowRangeConfig(false);
            }}
          />
        </PopoverContent>
      )}
    </Popover>
  );
}
