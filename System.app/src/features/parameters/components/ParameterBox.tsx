// src/features/parameters/components/ParameterBox.tsx
// Individual colored parameter box with inline editing

import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select } from '@/components/ui/select'
import type { VisualParameter, ParameterField } from '../types'
import type { MetricChoice } from '@/types/flowNode'
import { RangeConfigPopover } from './RangeConfigPopover'
import { IndicatorDropdown } from '@/features/builder/components/IndicatorDropdown'

interface ParameterBoxProps {
  parameter: VisualParameter
  onUpdate: (field: ParameterField, value: any) => void
  onEnableOptimization: (enabled: boolean, range?: { min: number; max: number; step: number }) => void
}

function getFieldLabel(field: string): string {
  switch (field) {
    case 'window':
      return 'Period'
    case 'metric':
      return 'Indicator'
    case 'comparator':
      return 'Compare'
    case 'ticker':
      return 'Ticker'
    case 'threshold':
      return 'Value'
    case 'rightWindow':
      return 'Right Period'
    case 'rightMetric':
      return 'Right Indicator'
    case 'rightTicker':
      return 'Right Ticker'
    case 'forDays':
      return 'For Days'
    case 'bottom':
      return 'Count'
    case 'scaleWindow':
      return 'Scale Period'
    case 'scaleFrom':
      return 'From'
    case 'scaleTo':
      return 'To'
    default:
      return field
  }
}

const COMPARATOR_OPTIONS = [
  { value: 'lt', label: 'Less Than' },
  { value: 'gt', label: 'Greater Than' },
  { value: 'crossAbove', label: 'Cross Above' },
  { value: 'crossBelow', label: 'Cross Below' },
]

export function ParameterBox({ parameter, onUpdate, onEnableOptimization }: ParameterBoxProps) {
  const [showRangeConfig, setShowRangeConfig] = useState(false)

  const isOptimizable = parameter.field === 'window' || parameter.field === 'threshold' || parameter.field === 'rightWindow' || parameter.field === 'forDays' || parameter.field === 'bottom' || parameter.field === 'scaleWindow' || parameter.field === 'scaleFrom' || parameter.field === 'scaleTo'
  const label = getFieldLabel(parameter.field)

  // Handle click for optimizable fields
  const handleClick = () => {
    if (isOptimizable) {
      setShowRangeConfig(true)
    }
  }

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
          {(parameter.field === 'metric' || parameter.field === 'rightMetric') && (
            <div onClick={(e) => e.stopPropagation()}>
              <IndicatorDropdown
                value={parameter.currentValue as MetricChoice}
                onChange={(metric) => onUpdate(parameter.field as any, metric)}
                className="w-full"
              />
            </div>
          )}

          {/* Comparator Dropdown */}
          {parameter.field === 'comparator' && (
            <div onClick={(e) => e.stopPropagation()}>
              <Select
                value={parameter.currentValue as string}
                onChange={(e) => onUpdate('comparator', e.target.value)}
                className="bg-white/90 border-black/10 h-7 text-xs"
              >
                {COMPARATOR_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {/* Simple Value Display (window, ticker, threshold, rightWindow, rightTicker, forDays, bottom, scaleWindow, scaleFrom, scaleTo) */}
          {(parameter.field === 'window' || parameter.field === 'ticker' || parameter.field === 'threshold' || parameter.field === 'rightWindow' || parameter.field === 'rightTicker' || parameter.field === 'forDays' || parameter.field === 'bottom' || parameter.field === 'scaleWindow' || parameter.field === 'scaleFrom' || parameter.field === 'scaleTo') && (
            <>
              {parameter.optimizationEnabled && parameter.min !== undefined && parameter.max !== undefined ? (
                <span className="h-7 px-2 flex items-center border border-primary rounded bg-primary/10 text-sm font-medium text-primary">
                  {parameter.min}-{parameter.max}
                </span>
              ) : (
                <span className="text-sm font-medium">
                  {parameter.currentValue}
                </span>
              )}
            </>
          )}
        </div>
      </PopoverTrigger>

      {/* Range Configuration Popover (for optimizable fields only) */}
      {isOptimizable && (
        <PopoverContent className="w-auto p-0" align="start">
          <RangeConfigPopover
            parameter={parameter}
            onSave={(range) => {
              onEnableOptimization(true, range)
              setShowRangeConfig(false)
            }}
            onDisable={() => {
              onEnableOptimization(false)
              setShowRangeConfig(false)
            }}
          />
        </PopoverContent>
      )}
    </Popover>
  )
}
