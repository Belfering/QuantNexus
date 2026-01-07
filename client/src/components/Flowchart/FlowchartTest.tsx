/**
 * Flowchart Test Component
 * Simple test page to verify Phase 1 implementation
 */

import { useFlowchartStore, useFlowchartUndo } from '@/stores/useFlowchartStore';
import { NodeCard } from './NodeCard/NodeCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function FlowchartTest() {
  const root = useFlowchartStore((state) => state.root);
  const addNode = useFlowchartStore((state) => state.addNode);
  const { undo, redo, canUndo, canRedo } = useFlowchartUndo();

  // Test function: Add an indicator node as first child
  const handleAddIndicator = () => {
    addNode(root.id, 'next', 0, 'indicator');
  };

  // Test function: Add a position node
  const handleAddPosition = () => {
    // Find first child and add after it
    const firstChild = root.children.next?.[0];
    if (firstChild) {
      addNode(firstChild.id, 'next', 0, 'position');
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Flowchart Phase 1 Test</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Controls */}
          <div className="flex gap-2 flex-wrap">
            <Button onClick={handleAddIndicator} size="sm">
              Add Indicator Node
            </Button>
            <Button onClick={handleAddPosition} size="sm" variant="outline">
              Add Position Node
            </Button>
            <Button onClick={() => undo()} disabled={!canUndo} size="sm" variant="secondary">
              Undo
            </Button>
            <Button onClick={() => redo()} disabled={!canRedo} size="sm" variant="secondary">
              Redo
            </Button>
          </div>

          {/* Stats */}
          <div className="text-sm text-muted-foreground">
            <div>Root Node ID: {root.id}</div>
            <div>Root Node Kind: {root.kind}</div>
            <div>Can Undo: {canUndo ? 'Yes' : 'No'}</div>
            <div>Can Redo: {canRedo ? 'Yes' : 'No'}</div>
          </div>
        </CardContent>
      </Card>

      {/* Flowchart Rendering */}
      <Card>
        <CardHeader>
          <CardTitle>Flowchart Tree</CardTitle>
        </CardHeader>
        <CardContent>
          <NodeCard node={root} />
        </CardContent>
      </Card>

      {/* JSON View */}
      <Card>
        <CardHeader>
          <CardTitle>JSON Structure</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="text-xs bg-muted p-4 rounded overflow-auto max-h-96">
            {JSON.stringify(root, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
