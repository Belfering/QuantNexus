/**
 * Flowchart Store with Undo/Redo Support
 * Zustand store using zundo temporal middleware
 * Ported from Flowchart app for Atlas Forge Phase 1.5
 */

import { create } from 'zustand';
import { temporal } from 'zundo';
import type {
  FlowNode,
  BlockKind,
  SlotId,
  WeightMode,
  PositionChoice,
  MetricChoice,
  ComparatorChoice,
  NumberedQuantifier,
} from '@/types/flowchart';

import { createDefaultRoot, ensureSlots, createNode } from '@/lib/flowchart/helpers';
import {
  replaceSlot,
  insertAtSlot,
  appendPlaceholder,
  deleteNode as deleteNodeOp,
  removeSlotEntry as removeSlotEntryOp,
  updateTitle as updateTitleOp,
  updateWeight as updateWeightOp,
  updateCollapse as updateCollapseOp,
  setAllCollapsed as setAllCollapsedOp,
  updateColor as updateColorOp,
  addPositionRow as addPositionRowOp,
  removePositionRow as removePositionRowOp,
  choosePosition as choosePositionOp,
  addConditionLine as addConditionLineOp,
  deleteConditionLine as deleteConditionLineOp,
  updateConditionFields as updateConditionFieldsOp,
  updateNumberedQuantifier as updateNumberedQuantifierOp,
  updateNumberedN as updateNumberedNOp,
  addNumberedItem as addNumberedItemOp,
  deleteNumberedItem as deleteNumberedItemOp,
  expandToNode as expandToNodeOp,
} from '@/lib/flowchart/treeOperations';

// ============================================================================
// Store State Interface
// ============================================================================

interface FlowchartState {
  root: FlowNode;

  // Direct setter
  setRoot: (root: FlowNode) => void;

  // Node CRUD
  addNode: (parentId: string, slot: SlotId, index: number, kind: BlockKind) => void;
  insertNode: (parentId: string, slot: SlotId, index: number, kind: BlockKind) => void;
  appendPlaceholder: (targetId: string, slot: SlotId) => void;
  deleteNode: (nodeId: string) => void;
  removeSlotEntry: (targetId: string, slot: SlotId, index: number) => void;

  // Node properties
  renameNode: (nodeId: string, title: string) => void;
  updateWeight: (nodeId: string, weighting: WeightMode, branch?: 'then' | 'else') => void;
  toggleCollapse: (nodeId: string, collapsed: boolean) => void;
  collapseAll: (collapsed: boolean) => void;
  updateColor: (nodeId: string, color?: string) => void;

  // Position node
  addPosition: (nodeId: string) => void;
  removePosition: (nodeId: string, index: number) => void;
  choosePosition: (nodeId: string, index: number, choice: PositionChoice) => void;

  // Indicator/condition
  addCondition: (nodeId: string, type: 'and' | 'or', itemId?: string) => void;
  deleteCondition: (nodeId: string, condId: string, itemId?: string) => void;
  updateCondition: (
    nodeId: string,
    condId: string,
    updates: Partial<{
      window: number;
      metric: MetricChoice;
      comparator: ComparatorChoice;
      ticker: PositionChoice;
      threshold: number;
      expanded: boolean;
      rightWindow: number;
      rightMetric: MetricChoice;
      rightTicker: PositionChoice;
    }>,
    itemId?: string
  ) => void;

  // Numbered node
  updateNumberedQuantifier: (nodeId: string, quantifier: NumberedQuantifier) => void;
  updateNumberedN: (nodeId: string, n: number) => void;
  addNumberedItem: (nodeId: string) => void;
  deleteNumberedItem: (nodeId: string, itemId: string) => void;

  // Tree navigation
  expandToNode: (targetId: string) => boolean;
}

// ============================================================================
// Store Creation with Temporal Middleware
// ============================================================================

export const useFlowchartStore = create<FlowchartState>()(
  temporal(
    (set, get) => ({
      root: createDefaultRoot(),

      // Direct setter
      setRoot: (root) => set({ root: ensureSlots(root) }),

      // Node CRUD operations
      addNode: (parentId, slot, index, kind) =>
        set((state) => ({
          root: replaceSlot(state.root, parentId, slot, index, createNode(kind)),
        })),

      insertNode: (parentId, slot, index, kind) =>
        set((state) => ({
          root: insertAtSlot(state.root, parentId, slot, index, createNode(kind)),
        })),

      appendPlaceholder: (targetId, slot) =>
        set((state) => ({
          root: appendPlaceholder(state.root, targetId, slot),
        })),

      deleteNode: (nodeId) =>
        set((state) => ({
          root: deleteNodeOp(state.root, nodeId),
        })),

      removeSlotEntry: (targetId, slot, index) =>
        set((state) => ({
          root: removeSlotEntryOp(state.root, targetId, slot, index),
        })),

      // Node property updates
      renameNode: (nodeId, title) =>
        set((state) => ({
          root: updateTitleOp(state.root, nodeId, title),
        })),

      updateWeight: (nodeId, weighting, branch) =>
        set((state) => ({
          root: updateWeightOp(state.root, nodeId, weighting, branch),
        })),

      toggleCollapse: (nodeId, collapsed) =>
        set((state) => ({
          root: updateCollapseOp(state.root, nodeId, collapsed),
        })),

      collapseAll: (collapsed) =>
        set((state) => ({
          root: setAllCollapsedOp(state.root, collapsed),
        })),

      updateColor: (nodeId, color) =>
        set((state) => ({
          root: updateColorOp(state.root, nodeId, color),
        })),

      // Position node operations
      addPosition: (nodeId) =>
        set((state) => ({
          root: addPositionRowOp(state.root, nodeId),
        })),

      removePosition: (nodeId, index) =>
        set((state) => ({
          root: removePositionRowOp(state.root, nodeId, index),
        })),

      choosePosition: (nodeId, index, choice) =>
        set((state) => ({
          root: choosePositionOp(state.root, nodeId, index, choice),
        })),

      // Condition operations
      addCondition: (nodeId, type, itemId) =>
        set((state) => ({
          root: addConditionLineOp(state.root, nodeId, type, itemId),
        })),

      deleteCondition: (nodeId, condId, itemId) =>
        set((state) => ({
          root: deleteConditionLineOp(state.root, nodeId, condId, itemId),
        })),

      updateCondition: (nodeId, condId, updates, itemId) =>
        set((state) => ({
          root: updateConditionFieldsOp(state.root, nodeId, condId, updates, itemId),
        })),

      // Numbered node operations
      updateNumberedQuantifier: (nodeId, quantifier) =>
        set((state) => ({
          root: updateNumberedQuantifierOp(state.root, nodeId, quantifier),
        })),

      updateNumberedN: (nodeId, n) =>
        set((state) => ({
          root: updateNumberedNOp(state.root, nodeId, n),
        })),

      addNumberedItem: (nodeId) =>
        set((state) => ({
          root: addNumberedItemOp(state.root, nodeId),
        })),

      deleteNumberedItem: (nodeId, itemId) =>
        set((state) => ({
          root: deleteNumberedItemOp(state.root, nodeId, itemId),
        })),

      // Tree navigation
      expandToNode: (targetId) => {
        const result = expandToNodeOp(get().root, targetId);
        if (result.found) {
          set({ root: result.next });
        }
        return result.found;
      },
    }),
    {
      limit: 100, // Maximum undo levels
      equality: (a, b) => a.root === b.root, // Only track root changes
    }
  )
);

// ============================================================================
// Undo/Redo Selectors
// ============================================================================

/**
 * Hook to access undo/redo functionality
 * @example
 * const { undo, redo, canUndo, canRedo, clear } = useFlowchartUndo();
 */
export const useFlowchartUndo = () => {
  const { undo, redo, clear, pastStates, futureStates } = useFlowchartStore.temporal.getState();

  return {
    undo,
    redo,
    clear,
    canUndo: pastStates.length > 0,
    canRedo: futureStates.length > 0,
  };
};
