/**
 * Node Parameter Group Component
 * Phase 3: QuantNexus Redesign - Group parameter boxes by node
 */

import type { VisualParameter, ParameterField } from '@/types/flowchart';
import { ParameterBox } from './ParameterBox';

interface NodeParameterGroupProps {
  nodeId: string;
  nodeTitle: string;
  nodeColor: string;
  parameters: VisualParameter[];
  onUpdate: (paramId: string, field: ParameterField, value: any) => void;
  onEnableOptimization: (paramId: string, enabled: boolean, range?: { min: number; max: number; step: number }) => void;
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
      className="flex flex-col gap-2 p-3 rounded-lg border-2"
      style={{ borderColor: nodeColor }}
    >
      {/* Node Label */}
      <div
        className="text-xs font-semibold px-2 py-1 rounded-md w-fit"
        style={{ backgroundColor: nodeColor }}
      >
        {nodeTitle}
      </div>

      {/* Parameter Boxes Row */}
      <div className="flex flex-wrap gap-2">
        {parameters.map((param) => (
          <ParameterBox
            key={param.id}
            parameter={param}
            onUpdate={(field, val) => onUpdate(param.id, field, val)}
            onEnableOptimization={(enabled, range) => onEnableOptimization(param.id, enabled, range)}
          />
        ))}
      </div>
    </div>
  );
}
