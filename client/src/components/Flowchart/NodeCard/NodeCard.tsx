/**
 * NodeCard Component - Basic Flowchart Node Rendering
 * Phase 1: Basic rendering only (editing in Phase 2)
 * Ported from Flowchart app for Atlas Forge Phase 1.5
 */

import type { FlowNode } from '@/types/flowchart';
import { SLOT_ORDER } from '@/types/flowchart';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface NodeCardProps {
  node: FlowNode;
  depth?: number;
}

export function NodeCard({ node, depth = 0 }: NodeCardProps) {
  // Get slots for this node type
  const slots = SLOT_ORDER[node.kind];

  return (
    <div className="ml-4 my-2">
      <Card className={`${depth === 0 ? 'border-2' : ''}`}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant="outline">{node.kind}</Badge>
              <span className="font-semibold">{node.title}</span>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-2">
          {/* Render node-specific content */}
          {node.kind === 'indicator' && (
            <div className="space-y-1 text-sm">
              {node.conditions?.map((cond) => (
                <div key={cond.id} className="text-muted-foreground">
                  <span className="font-mono text-xs">{cond.type.toUpperCase()}</span>{' '}
                  {cond.window}d {cond.metric} {cond.comparator} {cond.threshold}
                </div>
              ))}
            </div>
          )}

          {node.kind === 'position' && (
            <div className="text-sm text-muted-foreground">
              Positions: {node.positions?.join(', ') || 'None'}
            </div>
          )}

          {node.kind === 'numbered' && node.numbered && (
            <div className="text-sm text-muted-foreground">
              {node.numbered.quantifier} of {node.numbered.items.length} items
            </div>
          )}

          {/* Render children slots */}
          {slots.map((slot) => {
            const children = node.children[slot];
            if (!children || children.length === 0) return null;

            return (
              <div key={slot} className="mt-3">
                <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">
                  {slot}
                </div>
                <div className="border-l-2 pl-2">
                  {children.map((child, idx) => (
                    <div key={idx}>
                      {child ? (
                        <NodeCard node={child} depth={depth + 1} />
                      ) : (
                        <div className="text-sm text-muted-foreground italic my-2">
                          [Empty slot]
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
