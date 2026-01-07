/**
 * Tree Operations for Flowchart Manipulation
 * Pure functions for immutable tree transformations
 * Ported from Flowchart app for Atlas Forge Phase 1.5
 */

import type {
  FlowNode,
  SlotId,
  WeightMode,
  PositionChoice,
  MetricChoice,
  ComparatorChoice,
  NumberedQuantifier,
} from '@/types/flowchart';
import { getAllSlotsForNode, newId } from './helpers';

/**
 * Normalize comparator value to valid type
 */
export const normalizeComparatorChoice = (value: unknown): ComparatorChoice => {
  if (value === 'gt' || value === 'lt' || value === 'crossAbove' || value === 'crossBelow') return value;
  const s = String(value || '').trim().toLowerCase();
  if (!s) return 'lt';
  if (s === 'crossabove' || s === 'crosses above' || s === 'cross above') return 'crossAbove';
  if (s === 'crossbelow' || s === 'crosses below' || s === 'cross below') return 'crossBelow';
  if (s === 'greater than' || s === 'greater' || s === 'gt') return 'gt';
  if (s === 'less than' || s === 'less' || s === 'lt') return 'lt';
  if (s.includes('cross') && s.includes('above')) return 'crossAbove';
  if (s.includes('cross') && s.includes('below')) return 'crossBelow';
  if (s.includes('greater')) return 'gt';
  if (s.includes('less')) return 'lt';
  return 'lt';
};

// ============================================================================
// CORE TREE OPERATIONS
// ============================================================================

/**
 * Replace a child node at a specific slot and index
 */
export const replaceSlot = (
  node: FlowNode,
  parentId: string,
  slot: SlotId,
  index: number,
  child: FlowNode
): FlowNode => {
  if (node.id === parentId) {
    const arr = node.children[slot] ?? [null];
    const next = arr.slice();
    next[index] = child;
    return { ...node, children: { ...node.children, [slot]: next } };
  }

  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {};
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s];
    children[s] = arr ? arr.map((c) => (c ? replaceSlot(c, parentId, slot, index, child) : c)) : arr;
  });

  return { ...node, children };
};

/**
 * Insert a node at a specific index (shifts existing nodes down)
 */
export const insertAtSlot = (
  node: FlowNode,
  parentId: string,
  slot: SlotId,
  index: number,
  child: FlowNode
): FlowNode => {
  if (node.id === parentId) {
    const arr = node.children[slot] ?? [null];
    const next = arr.slice();
    next.splice(index, 0, child);
    return { ...node, children: { ...node.children, [slot]: next } };
  }

  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {};
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s];
    children[s] = arr ? arr.map((c) => (c ? insertAtSlot(c, parentId, slot, index, child) : c)) : arr;
  });

  return { ...node, children };
};

/**
 * Append a null placeholder to a slot
 */
export const appendPlaceholder = (node: FlowNode, targetId: string, slot: SlotId): FlowNode => {
  if (node.id === targetId) {
    const arr = node.children[slot] ?? [null];
    return { ...node, children: { ...node.children, [slot]: [...arr, null] } };
  }

  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {};
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s];
    children[s] = arr ? arr.map((c) => (c ? appendPlaceholder(c, targetId, slot) : c)) : arr;
  });

  return { ...node, children };
};

/**
 * Delete a node by ID (recursively removes from tree)
 */
export const deleteNode = (node: FlowNode, targetId: string): FlowNode => {
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {};

  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s];
    if (!arr) return;

    const filtered = arr
      .map((c) => (c ? deleteNode(c, targetId) : c))
      .filter((c) => (c ? c.id !== targetId : true));

    children[s] = filtered.length ? filtered : [null];
  });

  return { ...node, children };
};

/**
 * Remove a slot entry at specific index
 */
export const removeSlotEntry = (
  node: FlowNode,
  targetId: string,
  slot: SlotId,
  index: number
): FlowNode => {
  if (node.id === targetId) {
    const arr = node.children[slot] ?? [];
    const next = arr.slice();
    next.splice(index, 1);
    return { ...node, children: { ...node.children, [slot]: next.length ? next : [null] } };
  }

  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {};
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s];
    children[s] = arr ? arr.map((c) => (c ? removeSlotEntry(c, targetId, slot, index) : c)) : arr;
  });

  return { ...node, children };
};

// ============================================================================
// NODE PROPERTY UPDATES
// ============================================================================

/**
 * Update node title
 */
export const updateTitle = (node: FlowNode, id: string, title: string): FlowNode => {
  if (node.id === id) return { ...node, title };

  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {};
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s];
    children[s] = arr ? arr.map((c) => (c ? updateTitle(c, id, title) : c)) : arr;
  });

  return { ...node, children };
};

/**
 * Update node weighting mode
 */
export const updateWeight = (
  node: FlowNode,
  id: string,
  weighting: WeightMode,
  branch?: 'then' | 'else'
): FlowNode => {
  if (node.id === id) {
    if (branch === 'then') return { ...node, weightingThen: weighting };
    if (branch === 'else') return { ...node, weightingElse: weighting };
    return { ...node, weighting };
  }

  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {};
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s];
    children[s] = arr ? arr.map((c) => (c ? updateWeight(c, id, weighting, branch) : c)) : arr;
  });

  return { ...node, children };
};

/**
 * Toggle node collapse state
 */
export const updateCollapse = (node: FlowNode, id: string, collapsed: boolean): FlowNode => {
  if (node.id === id) return { ...node, collapsed };

  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {};
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s];
    children[s] = arr ? arr.map((c) => (c ? updateCollapse(c, id, collapsed) : c)) : arr;
  });

  return { ...node, children };
};

/**
 * Set all nodes to collapsed/expanded
 */
export const setAllCollapsed = (node: FlowNode, collapsed: boolean): FlowNode => {
  const next = { ...node, collapsed };

  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {};
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s];
    children[s] = arr ? arr.map((c) => (c ? setAllCollapsed(c, collapsed) : c)) : arr;
  });

  return { ...next, children };
};

/**
 * Update node background color
 */
export const updateColor = (node: FlowNode, id: string, color?: string): FlowNode => {
  if (node.id === id) return { ...node, bgColor: color };

  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {};
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s];
    children[s] = arr ? arr.map((c) => (c ? updateColor(c, id, color) : c)) : arr;
  });

  return { ...node, children };
};

// ============================================================================
// POSITION NODE OPERATIONS
// ============================================================================

/**
 * Add a position row
 */
export const addPositionRow = (node: FlowNode, id: string): FlowNode => {
  if (node.id === id && node.kind === 'position') {
    const next = [...(node.positions ?? []), 'SPY'];
    return { ...node, positions: next };
  }

  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {};
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s];
    children[s] = arr ? arr.map((c) => (c ? addPositionRow(c, id) : c)) : arr;
  });

  return { ...node, children };
};

/**
 * Remove a position row
 */
export const removePositionRow = (node: FlowNode, id: string, index: number): FlowNode => {
  if (node.id === id && node.kind === 'position') {
    const next = (node.positions ?? []).filter((_, i) => i !== index);
    return { ...node, positions: next.length ? next : ['SPY'] };
  }

  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {};
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s];
    children[s] = arr ? arr.map((c) => (c ? removePositionRow(c, id, index) : c)) : arr;
  });

  return { ...node, children };
};

/**
 * Update a position choice
 */
export const choosePosition = (
  node: FlowNode,
  id: string,
  index: number,
  choice: PositionChoice
): FlowNode => {
  if (node.id === id && node.kind === 'position') {
    const next = [...(node.positions ?? [])];
    next[index] = choice;
    return { ...node, positions: next };
  }

  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {};
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s];
    children[s] = arr ? arr.map((c) => (c ? choosePosition(c, id, index, choice) : c)) : arr;
  });

  return { ...node, children };
};

// ============================================================================
// CONDITION OPERATIONS
// ============================================================================

/**
 * Add a condition line (for indicator or numbered node items)
 */
export const addConditionLine = (
  node: FlowNode,
  id: string,
  type: 'and' | 'or',
  itemId?: string
): FlowNode => {
  // Add condition to indicator node
  if (node.id === id && node.kind === 'indicator') {
    const last = node.conditions && node.conditions.length ? node.conditions[node.conditions.length - 1] : null;
    const next = [
      ...(node.conditions ?? []),
      {
        id: newId(),
        type,
        window: last?.window ?? 14,
        metric: (last?.metric as MetricChoice) ?? 'Relative Strength Index',
        comparator: normalizeComparatorChoice(last?.comparator ?? 'lt'),
        ticker: last?.ticker ?? 'SPY',
        threshold: last?.threshold ?? 30,
      },
    ];
    return { ...node, conditions: next };
  }

  // Add condition to numbered node item
  if (node.id === id && node.kind === 'numbered' && node.numbered && itemId) {
    const nextItems = node.numbered.items.map((item) => {
      if (item.id !== itemId) return item;

      const last = item.conditions.length ? item.conditions[item.conditions.length - 1] : null;
      return {
        ...item,
        conditions: [
          ...item.conditions,
          {
            id: newId(),
            type,
            window: last?.window ?? 14,
            metric: (last?.metric as MetricChoice) ?? 'Relative Strength Index',
            comparator: normalizeComparatorChoice(last?.comparator ?? 'lt'),
            ticker: last?.ticker ?? 'SPY',
            threshold: last?.threshold ?? 30,
          },
        ],
      };
    });
    return { ...node, numbered: { ...node.numbered, items: nextItems } };
  }

  // Recurse through children
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {};
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s];
    children[s] = arr ? arr.map((c) => (c ? addConditionLine(c, id, type, itemId) : c)) : arr;
  });

  return { ...node, children };
};

/**
 * Delete a condition line (prevents deleting the first condition)
 */
export const deleteConditionLine = (
  node: FlowNode,
  id: string,
  condId: string,
  itemId?: string
): FlowNode => {
  // Delete from indicator node
  if (node.id === id && node.kind === 'indicator' && node.conditions) {
    const keep = node.conditions.filter((c, idx) => idx === 0 || c.id !== condId);
    return { ...node, conditions: keep.length ? keep : node.conditions };
  }

  // Delete from numbered node item
  if (node.id === id && node.kind === 'numbered' && node.numbered && itemId) {
    const nextItems = node.numbered.items.map((item) => {
      if (item.id !== itemId) return item;
      const keep = item.conditions.filter((c) => c.id !== condId);
      return { ...item, conditions: keep.length ? keep : item.conditions };
    });
    return { ...node, numbered: { ...node.numbered, items: nextItems } };
  }

  // Recurse through children
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {};
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s];
    children[s] = arr ? arr.map((c) => (c ? deleteConditionLine(c, id, condId, itemId) : c)) : arr;
  });

  return { ...node, children };
};

/**
 * Update condition fields
 */
export const updateConditionFields = (
  node: FlowNode,
  id: string,
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
): FlowNode => {
  // Update condition in indicator node
  if (node.id === id && node.kind === 'indicator' && node.conditions) {
    const next = node.conditions.map((c) => (c.id === condId ? { ...c, ...updates } : c));
    return { ...node, conditions: next };
  }

  // Update condition in numbered node item
  if (node.id === id && node.kind === 'numbered' && node.numbered && itemId) {
    const nextItems = node.numbered.items.map((item) => {
      if (item.id !== itemId) return item;
      const nextConditions = item.conditions.map((c) => (c.id === condId ? { ...c, ...updates } : c));
      return { ...item, conditions: nextConditions };
    });
    return { ...node, numbered: { ...node.numbered, items: nextItems } };
  }

  // Recurse through children
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {};
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s];
    children[s] = arr ? arr.map((c) => (c ? updateConditionFields(c, id, condId, updates, itemId) : c)) : arr;
  });

  return { ...node, children };
};

// ============================================================================
// NUMBERED NODE OPERATIONS
// ============================================================================

/**
 * Update numbered node quantifier
 */
export const updateNumberedQuantifier = (
  node: FlowNode,
  id: string,
  quantifier: NumberedQuantifier
): FlowNode => {
  if (node.id === id && node.kind === 'numbered' && node.numbered) {
    return { ...node, numbered: { ...node.numbered, quantifier } };
  }

  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {};
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s];
    children[s] = arr ? arr.map((c) => (c ? updateNumberedQuantifier(c, id, quantifier) : c)) : arr;
  });

  return { ...node, children };
};

/**
 * Update numbered node N value
 */
export const updateNumberedN = (node: FlowNode, id: string, n: number): FlowNode => {
  if (node.id === id && node.kind === 'numbered' && node.numbered) {
    return { ...node, numbered: { ...node.numbered, n } };
  }

  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {};
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s];
    children[s] = arr ? arr.map((c) => (c ? updateNumberedN(c, id, n) : c)) : arr;
  });

  return { ...node, children };
};

/**
 * Add a numbered item
 */
export const addNumberedItem = (node: FlowNode, id: string): FlowNode => {
  if (node.id === id && node.kind === 'numbered' && node.numbered) {
    const newItem = {
      id: newId(),
      conditions: [
        {
          id: newId(),
          type: 'if' as const,
          window: 14,
          metric: 'Relative Strength Index' as MetricChoice,
          comparator: 'lt' as ComparatorChoice,
          ticker: 'SPY',
          threshold: 30,
        },
      ],
    };
    return { ...node, numbered: { ...node.numbered, items: [...node.numbered.items, newItem] } };
  }

  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {};
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s];
    children[s] = arr ? arr.map((c) => (c ? addNumberedItem(c, id) : c)) : arr;
  });

  return { ...node, children };
};

/**
 * Delete a numbered item
 */
export const deleteNumberedItem = (node: FlowNode, id: string, itemId: string): FlowNode => {
  if (node.id === id && node.kind === 'numbered' && node.numbered) {
    const items = node.numbered.items.filter((item) => item.id !== itemId);
    return { ...node, numbered: { ...node.numbered, items: items.length ? items : node.numbered.items } };
  }

  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {};
  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s];
    children[s] = arr ? arr.map((c) => (c ? deleteNumberedItem(c, id, itemId) : c)) : arr;
  });

  return { ...node, children };
};

// ============================================================================
// TREE NAVIGATION
// ============================================================================

/**
 * Expand all nodes in the path to target node
 */
export const expandToNode = (node: FlowNode, targetId: string): { next: FlowNode; found: boolean } => {
  if (node.id === targetId) {
    return { next: { ...node, collapsed: false }, found: true };
  }

  let found = false;
  const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {};

  getAllSlotsForNode(node).forEach((s) => {
    const arr = node.children[s];
    if (!arr) return;

    children[s] = arr.map((c) => {
      if (!c) return c;
      const result = expandToNode(c, targetId);
      if (result.found) found = true;
      return result.next;
    });
  });

  return {
    next: found ? { ...node, collapsed: false, children } : { ...node, children },
    found,
  };
};
