/**
 * Interactive NodeCard Component
 * Phase 2: Full editing capabilities
 * Enhanced from Phase 1 basic rendering with CRUD operations
 */

import { useState } from 'react';
import type { FlowNode, SlotId } from '@/types/flowchart';
import { SLOT_ORDER } from '@/types/flowchart';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useFlowchartStore } from '@/stores/useFlowchartStore';
import { ConditionEditor } from '../ConditionEditor';
import { InsertMenu } from '../InsertMenu';

interface InteractiveNodeCardProps {
  node: FlowNode;
  depth?: number;
}

export function InteractiveNodeCard({ node, depth = 0 }: InteractiveNodeCardProps) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(node.title);
  const [insertMenuOpen, setInsertMenuOpen] = useState<string | null>(null);

  // Zustand actions
  const addNode = useFlowchartStore((state) => state.addNode);
  const deleteNode = useFlowchartStore((state) => state.deleteNode);
  const renameNode = useFlowchartStore((state) => state.renameNode);
  const addCondition = useFlowchartStore((state) => state.addCondition);
  const deleteCondition = useFlowchartStore((state) => state.deleteCondition);
  const updateCondition = useFlowchartStore((state) => state.updateCondition);

  // Get slots for this node type
  const slots = SLOT_ORDER[node.kind];

  // Handle title save
  const handleSaveTitle = () => {
    if (titleDraft.trim() !== node.title) {
      renameNode(node.id, titleDraft.trim());
    }
    setIsEditingTitle(false);
  };

  // Render placeholder slot with insert button
  const renderPlaceholder = (slot: SlotId, slotIndex: number) => {
    const menuKey = `${node.id}-${slot}-${slotIndex}`;
    const isMenuOpen = insertMenuOpen === menuKey;

    return (
      <div key={menuKey} className="relative my-2 ml-4">
        <div className="border-2 border-dashed border-muted rounded-lg p-4 text-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setInsertMenuOpen(isMenuOpen ? null : menuKey)}
          >
            + Add Block
          </Button>

          {isMenuOpen && (
            <div className="mt-2">
              <InsertMenu
                parentId={node.id}
                parentSlot={slot}
                index={slotIndex}
                onAdd={addNode}
                onClose={() => setInsertMenuOpen(null)}
              />
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="ml-4 my-2">
      <Card
        className={`${depth === 0 ? 'border-2 border-primary' : ''}`}
        style={{ backgroundColor: node.bgColor || undefined }}
      >
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 flex-1">
              <Badge variant="outline">{node.kind}</Badge>

              {/* Editable title */}
              {isEditingTitle ? (
                <div className="flex items-center gap-2 flex-1">
                  <Input
                    className="h-8 text-sm"
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onBlur={handleSaveTitle}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveTitle();
                      if (e.key === 'Escape') {
                        setTitleDraft(node.title);
                        setIsEditingTitle(false);
                      }
                    }}
                    autoFocus
                  />
                </div>
              ) : (
                <span
                  className="font-semibold cursor-pointer hover:text-primary"
                  onClick={() => setIsEditingTitle(true)}
                  title="Click to edit"
                >
                  {node.title}
                </span>
              )}
            </div>

            {/* Delete button (only for non-root nodes) */}
            {depth > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive"
                onClick={() => deleteNode(node.id)}
                title="Delete node"
              >
                ×
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="pt-2">
          {/* Indicator block: Show condition editor */}
          {node.kind === 'indicator' && (
            <div className="space-y-2">
              {node.conditions?.map((cond, idx) => (
                <ConditionEditor
                  key={cond.id}
                  condition={cond}
                  index={idx}
                  total={node.conditions?.length || 0}
                  onUpdate={(updates) => updateCondition(node.id, cond.id, updates)}
                  onDelete={() => deleteCondition(node.id, cond.id)}
                />
              ))}

              {/* Add condition buttons */}
              <div className="flex gap-2 mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => addCondition(node.id, 'and')}
                >
                  + AND
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => addCondition(node.id, 'or')}
                >
                  + OR
                </Button>
              </div>
            </div>
          )}

          {/* Position block: Show positions */}
          {node.kind === 'position' && (
            <div className="text-sm text-muted-foreground">
              Positions: {node.positions?.join(', ') || 'None'}
              {/* Phase 5: Add position editor */}
            </div>
          )}

          {/* Numbered block: Show quantifier info */}
          {node.kind === 'numbered' && node.numbered && (
            <div className="text-sm text-muted-foreground">
              {node.numbered.quantifier} of {node.numbered.items.length} items
              {/* Phase 5: Add numbered editor */}
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
                        <InteractiveNodeCard node={child} depth={depth + 1} />
                      ) : (
                        renderPlaceholder(slot, idx)
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
