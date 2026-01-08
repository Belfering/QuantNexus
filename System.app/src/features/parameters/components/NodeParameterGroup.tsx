// src/features/parameters/components/NodeParameterGroup.tsx
// Group parameter boxes by node with colored header

import type { VisualParameter, ParameterField } from '../types'
import { ParameterBox } from './ParameterBox'

interface NodeParameterGroupProps {
  nodeId: string
  nodeTitle: string
  nodeColor: string
  parameters: VisualParameter[]
  onUpdate: (paramId: string, field: ParameterField, value: any) => void
  onEnableOptimization: (paramId: string, enabled: boolean, range?: { min: number; max: number; step: number }) => void
}

export function NodeParameterGroup({
  nodeTitle,
  nodeColor,
  parameters,
  onUpdate,
  onEnableOptimization,
}: NodeParameterGroupProps) {
  return (
    <div
      className="flex items-center gap-2 p-3 rounded-lg border-2"
      style={{ borderColor: nodeColor }}
    >
      {/* Node Label */}
      <div
        className="text-xs font-semibold px-2 py-1 rounded-md whitespace-nowrap"
        style={{ backgroundColor: nodeColor }}
      >
        {nodeTitle}
      </div>

      {/* Parameter Boxes - all on one line */}
      {parameters.map((param) => (
        <ParameterBox
          key={param.id}
          parameter={param}
          onUpdate={(field, val) => onUpdate(param.id, field, val)}
          onEnableOptimization={(enabled, range) => onEnableOptimization(param.id, enabled, range)}
        />
      ))}
    </div>
  )
}
