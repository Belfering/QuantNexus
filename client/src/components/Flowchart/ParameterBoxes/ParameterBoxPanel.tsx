/**
 * Parameter Box Panel Component
 * Phase 3: QuantNexus Redesign - Main container for colored parameter boxes
 */

import { Card } from '@/components/ui/card';
import { useFlowchartStore } from '@/stores/useFlowchartStore';
import { useVisualParameters } from '@/hooks/useVisualParameters';
import { useFlowchartEstimate } from '@/hooks/useFlowchartEstimate';
import { NodeParameterGroup } from './NodeParameterGroup';
import type { ParameterField, ParameterRange } from '@/types/flowchart';
import type { ForgeConfig } from '@/types/forge';

interface ParameterBoxPanelProps {
  config: ForgeConfig;
  updateConfig: (updates: Partial<ForgeConfig>) => void;
}

export function ParameterBoxPanel({ config, updateConfig }: ParameterBoxPanelProps) {
  const root = useFlowchartStore((state) => state.root);
  const updateCondition = useFlowchartStore((state) => state.updateCondition);

  // Extract all parameters grouped by node
  const parametersByNode = useVisualParameters(root);

  // Calculate branch estimate
  const estimate = useFlowchartEstimate(config.parameterRanges || [], config.tickers.length);

  // Handle updating a parameter value in the flowchart
  const handleUpdate = (paramId: string, field: ParameterField, value: any) => {
    // Parse paramId: ${nodeId}-${condId}-${field}
    const parts = paramId.split('-');
    const nodeId = parts[0];
    const condId = parts[1];

    // Update flowchart tree via Zustand
    updateCondition(nodeId, condId, { [field]: value });
  };

  // Handle enabling/disabling optimization for a parameter
  const handleEnableOptimization = (
    paramId: string,
    enabled: boolean,
    range?: { min: number; max: number; step: number }
  ) => {
    const updatedRanges = [...(config.parameterRanges || [])];

    if (enabled && range) {
      // Find or create parameter range
      const existingIndex = updatedRanges.findIndex((r) => r.id === paramId);

      // Parse paramId to get metadata
      const parts = paramId.split('-');
      const nodeId = parts[0];
      const condId = parts[1];
      const field = parts[2] as 'window' | 'threshold';

      // Get parameter from visual parameters
      let paramPath = '';
      let currentValue = 0;
      parametersByNode.forEach((params) => {
        const param = params.find((p) => p.id === paramId);
        if (param) {
          paramPath = param.path;
          currentValue = param.currentValue as number;
        }
      });

      const parameterRange: ParameterRange = {
        id: paramId,
        type: field === 'window' ? 'period' : 'threshold',
        nodeId,
        conditionId: condId,
        path: paramPath,
        currentValue,
        enabled: true,
        min: range.min,
        max: range.max,
        step: range.step,
      };

      if (existingIndex !== -1) {
        // Update existing
        updatedRanges[existingIndex] = parameterRange;
      } else {
        // Add new
        updatedRanges.push(parameterRange);
      }
    } else {
      // Disable optimization
      const existingIndex = updatedRanges.findIndex((r) => r.id === paramId);
      if (existingIndex !== -1) {
        updatedRanges[existingIndex] = {
          ...updatedRanges[existingIndex],
          enabled: false,
        };
      }
    }

    updateConfig({ parameterRanges: updatedRanges });
  };

  // Sync optimization config from ForgeConfig back to visual parameters
  const getEnrichedParameters = () => {
    const enriched = new Map<string, any[]>();
    parametersByNode.forEach((params, nodeId) => {
      const enrichedParams = params.map((param) => {
        // Find matching ParameterRange in config
        const range = config.parameterRanges?.find((r) => r.id === param.id);
        if (range) {
          return {
            ...param,
            optimizationEnabled: range.enabled,
            min: range.min,
            max: range.max,
            step: range.step,
          };
        }
        return param;
      });
      enriched.set(nodeId, enrichedParams);
    });
    return enriched;
  };

  const enrichedParameters = getEnrichedParameters();

  if (enrichedParameters.size === 0) {
    return (
      <Card className="p-6 text-center text-muted-foreground">
        <p>Add indicator blocks to your flowchart to see parameters here.</p>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-4">
        {/* Node Parameter Groups */}
        {Array.from(enrichedParameters.entries()).map(([nodeId, params]) => {
          if (params.length === 0) return null;

          return (
            <NodeParameterGroup
              key={nodeId}
              nodeId={nodeId}
              nodeTitle={params[0].nodeTitle}
              nodeColor={params[0].nodeColor}
              parameters={params}
              onUpdate={handleUpdate}
              onEnableOptimization={handleEnableOptimization}
            />
          );
        })}

        {/* Branch Estimate */}
        {estimate && estimate.totalBranches > 1 && (
          <div className="mt-4 pt-4 border-t">
            <div className="text-sm font-medium">
              Estimate:{' '}
              <span className="text-lg font-bold">{estimate.totalBranches.toLocaleString()}</span>{' '}
              branches ≈ {estimate.estimatedMinutes} min
            </div>
            {estimate.totalBranches > 10000 && (
              <div className="text-xs text-destructive mt-1">
                ⚠️ Warning: {estimate.totalBranches.toLocaleString()} branches may take a long time
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
