/**
 * Flowchart Helper Utilities
 * Ported from Flowchart app for Atlas Forge Phase 1.5
 */

import type { FlowNode, BlockKind, SlotId } from '@/types/flowchart';
import { SLOT_ORDER, DEFAULT_TITLES } from '@/types/flowchart';

/**
 * Get all slot keys for a node, including dynamic ladder slots for numbered nodes
 */
export const getAllSlotsForNode = (node: FlowNode): SlotId[] => {
  const slots = [...SLOT_ORDER[node.kind]];

  // For numbered nodes with ladder quantifier, include dynamic ladder slots
  if (node.kind === 'numbered' && node.numbered?.quantifier === 'ladder') {
    Object.keys(node.children).forEach((key) => {
      if (key.startsWith('ladder-') && !slots.includes(key as SlotId)) {
        slots.push(key as SlotId);
      }
    });
  }

  return slots;
};

/**
 * Performance-optimized ID generator
 * Refreshes timestamp and random suffix every 1000 IDs instead of every call
 */
export const newId = (() => {
  let counter = 0;
  let batchTs = Date.now();
  let batchRand = Math.random().toString(36).slice(2, 10);

  return () => {
    // Refresh batch values periodically to maintain uniqueness across sessions
    if (counter % 1000 === 0) {
      batchTs = Date.now();
      batchRand = Math.random().toString(36).slice(2, 10);
    }
    counter += 1;
    return `node-${batchTs}-${counter}-${batchRand}`;
  };
})();

/**
 * Create a new condition line with default values
 */
export const createCondition = (type: 'if' | 'and' | 'or' = 'if') => ({
  id: newId(),
  type,
  window: 14,
  metric: 'Relative Strength Index' as const,
  comparator: 'lt' as const,
  ticker: 'SPY',
  threshold: 30,
});

/**
 * Create a new node of the specified kind with default values
 */
export const createNode = (kind: BlockKind): FlowNode => {
  const needsThenElseWeighting = kind === 'indicator' || kind === 'numbered' || kind === 'altExit' || kind === 'scaling';

  const base: FlowNode = {
    id: newId(),
    kind,
    title: DEFAULT_TITLES[kind],
    children: {},
    weighting: 'equal',
    weightingThen: needsThenElseWeighting ? 'equal' : undefined,
    weightingElse: needsThenElseWeighting ? 'equal' : undefined,
  };

  // Add kind-specific fields
  if (kind === 'indicator') {
    base.conditions = [createCondition('if')];
  } else if (kind === 'numbered') {
    base.numbered = {
      quantifier: 'all',
      n: 1,
      items: [{
        id: newId(),
        conditions: [createCondition('if')],
      }],
    };
  } else if (kind === 'position') {
    base.positions = ['SPY'];
  } else if (kind === 'function') {
    base.metric = 'Relative Strength Index';
    base.window = 14;
    base.bottom = 5;
    base.rank = 'Top';
  }

  return ensureSlots(base);
};

/**
 * Ensure a node has all required slot arrays (even if empty)
 * This prevents undefined errors when accessing children
 */
export const ensureSlots = (node: FlowNode): FlowNode => {
  const slots = SLOT_ORDER[node.kind];

  // Initialize missing slots with empty arrays
  slots.forEach((slot) => {
    if (!node.children[slot]) {
      node.children[slot] = [];
    }
  });

  // Recursively ensure slots for all children
  for (const slot in node.children) {
    const children = node.children[slot as SlotId];
    if (children) {
      node.children[slot as SlotId] = children.map(
        child => child ? ensureSlots(child) : null
      );
    }
  }

  return node;
};

/**
 * Create default root node (basic block with placeholder)
 */
export const createDefaultRoot = (): FlowNode => {
  const root = createNode('basic');
  root.children.next = [null]; // Placeholder for first child
  return root;
};

/**
 * Find a node by ID in the tree
 */
export const findNodeById = (root: FlowNode, targetId: string): FlowNode | null => {
  if (root.id === targetId) {
    return root;
  }

  for (const slot in root.children) {
    const children = root.children[slot as SlotId];
    if (children) {
      for (const child of children) {
        if (child) {
          const found = findNodeById(child, targetId);
          if (found) return found;
        }
      }
    }
  }

  return null;
};

/**
 * Deep clone a node with new IDs
 */
export const cloneNode = (node: FlowNode): FlowNode => {
  const cloned: FlowNode = {
    ...node,
    id: newId(),
    children: {},
  };

  // Clone conditions with new IDs
  if (node.conditions) {
    cloned.conditions = node.conditions.map(cond => ({
      ...cond,
      id: newId(),
    }));
  }

  // Clone numbered items with new IDs
  if (node.numbered) {
    cloned.numbered = {
      ...node.numbered,
      items: node.numbered.items.map(item => ({
        ...item,
        id: newId(),
        conditions: item.conditions.map(cond => ({
          ...cond,
          id: newId(),
        })),
      })),
    };
  }

  // Clone children recursively
  for (const slot in node.children) {
    const children = node.children[slot as SlotId];
    if (children) {
      cloned.children[slot as SlotId] = children.map(
        child => child ? cloneNode(child) : null
      );
    }
  }

  return cloned;
};
