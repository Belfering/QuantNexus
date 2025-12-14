# Money System App - Draft Spec

This document captures the initial model and UX behaviors for a flowchart app focused on money flow.

## Core Concepts
- Root chart holds a `name` and `startAmount` (e.g., `$10,000`). One root, no incoming edges.
- Nodes are “bubbles” with `id`, `title`, `kind` (`asset | indicator | function | group`), optional `metadata`.
- Edges carry allocations from parent to child. Allocation is stored on the edge, not the node.
- Nested graphs are allowed via `group` nodes, which can contain their own nodes/edges and be collapsible in the UI.

## Data Model (proposed)
```ts
type Allocation = { mode: 'percent'; value: number }; // percent authoring; absolute is computed for display

type Edge = {
  id: string;
  from: string; // parent node id
  to: string;   // child node id
  allocation: Allocation; // percent of parent inflow
};

type Node = {
  id: string;
  title: string;
  kind: 'asset' | 'indicator' | 'function' | 'group';
  metadata?: Record<string, any>;
  children?: Chart; // present when kind === 'group' for nested subgraph
};

type Chart = {
  id: string;
  name: string;
  startAmount: number; // root inflow
  nodes: Node[];
  edges: Edge[];
};
```

### Derived values
- For any node, inflow = sum of incoming edges’ computed amounts (root uses `startAmount`).
- For each outgoing edge, computed amount = `parentInflow * allocation.value / 100`.
- Display both percent (authoring) and computed absolute amounts on edges/nodes.

### Validation rules
- Outgoing allocations from a node must sum to exactly 100% (always full allocation).
- No cycles (treat the graph as a DAG).
- A `group` node’s internal subgraph obeys the same rules; collapse/expand should not break flow integrity.

## UI/Interaction Requirements
- Canvas: pan/zoom (mouse/touch), scrollable space; minimap optional later.
- Fit-to-root button to recenter/zoom to the root node if the user gets lost.
- Node actions: add/edit title/kind, delete, drag to move, connect edges by drag from handle.
- Edge actions: set allocation percent; show computed amount when known.
- Nested graphs: group nodes are collapsible/expandable; when collapsed, show aggregated allocation in/out.
- Editing safety: prevent saving invalid allocation sums; surface validation messages per node.

## Implementation Steps (high level)
1) Scaffold app (e.g., React + TS + React Flow), set up state for `Chart/Node/Edge`.
2) Render root chart with pan/zoom and fit-to-root control.
3) Add node/edge creation with percent allocations; compute/display absolute amounts.
4) Enforce validation: 100% outgoing per node, no cycles.
5) Add `group` nodes with collapsible nested charts.
6) Persist/load chart JSON (local-first), then consider backend syncing later.

Future: define behaviors for `asset`, `indicator`, `function` kinds; add keyboard shortcuts, minimap, theming, and auto-layout.
