// src/features/parameters/components/WeightDropdown.tsx
// Dropdown control for weight parameters

import { Select } from '@/components/ui/select'
import type { WeightParameter, StrategyParameter } from '../types'
import type { WeightMode } from '@/types/flowNode'

interface WeightDropdownProps {
  parameter: WeightParameter
  nodeId: string
  onUpdate: (nodeId: string, parameter: StrategyParameter, value: any) => void
}

const WEIGHT_OPTIONS: { value: WeightMode; label: string }[] = [
  { value: 'equal', label: 'Equal' },
  { value: 'defined', label: 'Defined' },
  { value: 'inverse', label: 'Inverse' },
  { value: 'pro', label: 'Pro-Rata' },
  { value: 'capped', label: 'Capped' }
]

export function WeightDropdown({ parameter, nodeId, onUpdate }: WeightDropdownProps) {
  const label = parameter.branch
    ? `Weight (${parameter.branch})`
    : 'Weight'

  return (
    <div className="inline-flex flex-col gap-1 px-3 py-2 rounded-lg min-w-[100px] bg-muted/20">
      <label className="text-[10px] font-semibold uppercase opacity-80">
        {label}
      </label>
      <Select
        value={parameter.currentValue}
        onChange={(e) => onUpdate(nodeId, parameter, e.target.value)}
        className="bg-white/90 border-black/10 h-7 text-xs"
      >
        {WEIGHT_OPTIONS.map(opt => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </Select>
    </div>
  )
}
