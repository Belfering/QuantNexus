// src/features/parameters/components/FunctionParameterControl.tsx
// Control for function node parameters (window, metric, bottom, rank)

import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import type { FunctionParameter, StrategyParameter } from '../types'
import type { MetricChoice } from '@/types/flowNode'
import { IndicatorDropdown } from '@/features/builder/components/IndicatorDropdown'

interface FunctionParameterControlProps {
  parameter: FunctionParameter
  nodeId: string
  onUpdate: (nodeId: string, parameter: StrategyParameter, value: any) => void
}

const RANK_OPTIONS = [
  { value: 'Top', label: 'Top' },
  { value: 'Bottom', label: 'Bottom' }
]

export function FunctionParameterControl({ parameter, nodeId, onUpdate }: FunctionParameterControlProps) {
  const getLabel = () => {
    switch (parameter.field) {
      case 'window': return 'Period'
      case 'metric': return 'Metric'
      case 'bottom': return 'Count'
      case 'rank': return 'Rank'
    }
  }

  return (
    <div className="inline-flex flex-col gap-1 px-3 py-2 rounded-lg min-w-[100px] bg-muted/20">
      <label className="text-[10px] font-semibold uppercase opacity-80 whitespace-nowrap">
        {getLabel()}
      </label>

      {/* Window/Bottom - numeric input */}
      {(parameter.field === 'window' || parameter.field === 'bottom') && (
        <Input
          type="number"
          value={parameter.currentValue as number}
          onChange={(e) => onUpdate(nodeId, parameter, parseInt(e.target.value) || 0)}
          className="bg-white/90 border-black/10 h-7 text-xs w-16"
          min={parameter.field === 'bottom' ? 1 : 0}
        />
      )}

      {/* Metric - dropdown */}
      {parameter.field === 'metric' && (
        <IndicatorDropdown
          value={parameter.currentValue as MetricChoice}
          onChange={(metric) => onUpdate(nodeId, parameter, metric)}
          className="w-full"
        />
      )}

      {/* Rank - dropdown */}
      {parameter.field === 'rank' && (
        <Select
          value={parameter.currentValue as string}
          onChange={(e) => onUpdate(nodeId, parameter, e.target.value)}
          className="bg-white/90 border-black/10 h-7 text-xs w-full"
        >
          {RANK_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      )}
    </div>
  )
}
