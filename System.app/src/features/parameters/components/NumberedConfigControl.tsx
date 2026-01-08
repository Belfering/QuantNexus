// src/features/parameters/components/NumberedConfigControl.tsx
// Control for numbered node configuration (quantifier, n)

import { useState } from 'react'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { RangeConfigPopover } from './RangeConfigPopover'
import type { NumberedConfigParameter, StrategyParameter, VisualParameter } from '../types'
import type { NumberedQuantifier } from '@/types/flowNode'

interface NumberedConfigControlProps {
  parameter: NumberedConfigParameter
  nodeId: string
  onUpdate: (nodeId: string, parameter: StrategyParameter, value: any) => void
  onEnableOptimization: (paramId: string, nodeId: string, parameter: StrategyParameter, enabled: boolean, range?: { min: number; max: number; step: number }) => void
}

const QUANTIFIER_OPTIONS: { value: NumberedQuantifier; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'all', label: 'All' },
  { value: 'none', label: 'None' },
  { value: 'exactly', label: 'Exactly' },
  { value: 'atLeast', label: 'At Least' },
  { value: 'atMost', label: 'At Most' },
  { value: 'ladder', label: 'Ladder' }
]

export function NumberedConfigControl({ parameter, nodeId, onUpdate, onEnableOptimization }: NumberedConfigControlProps) {
  const [showRangeConfig, setShowRangeConfig] = useState(false)

  const getLabel = () => {
    switch (parameter.field) {
      case 'quantifier': return 'Quantifier'
      case 'n': return 'Count'
    }
  }

  const paramId = `${nodeId}-numbered-n`

  return (
    <div className="inline-flex flex-col gap-1 px-3 py-2 rounded-lg min-w-[120px] bg-muted/20">
      <label className="text-[10px] font-semibold uppercase opacity-80 whitespace-nowrap">
        {getLabel()}
      </label>

      {/* Quantifier - dropdown */}
      {parameter.field === 'quantifier' && (
        <Select
          value={parameter.currentValue as NumberedQuantifier}
          onChange={(e) => onUpdate(nodeId, parameter, e.target.value)}
          className="bg-white/90 border-black/10 h-7 text-xs w-full"
        >
          {QUANTIFIER_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      )}

      {/* N - numeric input or range badge with clickable popover */}
      {parameter.field === 'n' && (
        <Popover open={showRangeConfig} onOpenChange={setShowRangeConfig}>
          <PopoverTrigger asChild>
            <div className="cursor-pointer" onClick={() => setShowRangeConfig(true)}>
              {parameter.optimizationEnabled && parameter.min !== undefined && parameter.max !== undefined ? (
                <span className="h-7 px-2 flex items-center border border-primary rounded bg-primary/10 text-sm font-medium text-primary">
                  {parameter.min}-{parameter.max}
                </span>
              ) : (
                <Input
                  type="number"
                  value={parameter.currentValue as number}
                  onChange={(e) => onUpdate(nodeId, parameter, parseInt(e.target.value) || 0)}
                  className="bg-white/90 border-black/10 h-7 text-xs w-16"
                  min={0}
                />
              )}
            </div>
          </PopoverTrigger>

          <PopoverContent className="w-auto p-0" align="start">
            <RangeConfigPopover
              parameter={{
                id: paramId,
                field: 'n' as any,
                currentValue: parameter.currentValue as number,
                nodeId,
                nodeTitle: '',
                conditionId: '',
                nodeColor: '',
                path: '',
                optimizationEnabled: parameter.optimizationEnabled,
                min: parameter.min,
                max: parameter.max,
                step: parameter.step
              } as VisualParameter}
              onSave={(range) => {
                onEnableOptimization(paramId, nodeId, parameter, true, range)
                setShowRangeConfig(false)
              }}
              onDisable={() => {
                onEnableOptimization(paramId, nodeId, parameter, false)
                setShowRangeConfig(false)
              }}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
