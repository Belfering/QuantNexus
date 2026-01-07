/**
 * Flowchart Strategy Editor
 * Phase 3: Visual flowchart builder with parameter extraction
 */

import { Card } from '@/components/ui/card';
import { useFlowchartStore } from '@/stores/useFlowchartStore';
import { FlowchartToolbar } from '@/components/Flowchart/FlowchartToolbar';
import { InteractiveNodeCard } from '@/components/Flowchart/NodeCard/InteractiveNodeCard';
import { ParameterBoxPanel } from '@/components/Flowchart/ParameterBoxes/ParameterBoxPanel';
import { useFlowchartPersistence } from '@/hooks/useFlowchartPersistence';
import type { ForgeConfig } from '@/types/forge';
import { useEffect } from 'react';
import { getNodeColorAssignments } from '@/lib/flowchart/colors';

interface FlowchartStrategyEditorProps {
  config: ForgeConfig;
  updateConfig: (updates: Partial<ForgeConfig>) => void;
}

export function FlowchartStrategyEditor({ config, updateConfig }: FlowchartStrategyEditorProps) {
  const root = useFlowchartStore((state) => state.root);
  const updateColor = useFlowchartStore((state) => state.updateColor);

  // Auto-assign colors to indicator nodes (Phase 1: QuantNexus visual redesign)
  useEffect(() => {
    const assignments = getNodeColorAssignments(root);
    assignments.forEach(({ nodeId, color }) => {
      updateColor(nodeId, color);
    });
  }, [root, updateColor]);

  // Persist flowchart to localStorage
  useFlowchartPersistence(config, updateConfig);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <Card className="overflow-hidden">
        <FlowchartToolbar />
      </Card>

      {/* Colored Parameter Boxes (QuantNexus Style) */}
      <ParameterBoxPanel config={config} updateConfig={updateConfig} />

      {/* Flowchart Canvas */}
      <Card className="p-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold">Strategy Flowchart</h3>
          <p className="text-sm text-muted-foreground">
            Build your strategy visually. Click parameter boxes above to configure optimization ranges.
          </p>
        </div>

        {/* Render the flowchart tree */}
        <div className="bg-muted/20 rounded-lg p-4 overflow-auto max-h-[600px]">
          <InteractiveNodeCard node={root} />
        </div>
      </Card>

      {/* Instructions */}
      <Card className="p-4 bg-blue-50 dark:bg-blue-950">
        <h4 className="font-semibold mb-2">💡 How to use:</h4>
        <ul className="text-sm space-y-1 list-disc list-inside">
          <li>Click "+ Add Block" to insert indicators, positions, or logic blocks</li>
          <li>Edit conditions in the flowchart tree</li>
          <li>Click colored boxes above to set optimization ranges</li>
          <li>Configure pass/fail criteria below, then click "Start Forge"</li>
        </ul>
      </Card>
    </div>
  );
}
