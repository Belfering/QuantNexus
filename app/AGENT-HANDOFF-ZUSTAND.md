# Agent Handoff: Phase 2N-15 - Tree Store Migration with zundo

## Handoff Prompt

```
Continue FRD-030 Phase 2N-15a: Create useTreeStore.ts with zundo.

Status:
- Phase 2N-14 (Tab Store Integration): ✅ COMPLETE
- Phase 2N-15 (Tree Store Migration): ⏳ Starting
- zundo package: ✅ Installed

Current metrics:
- App.tsx: 3,920 lines (target after this phase: ~1,800-2,000)
- Tree handlers in App.tsx: 58 (~2,000 lines to migrate)

Reference: System.app/AGENT-HANDOFF-ZUSTAND.md

Task: Create src/stores/useTreeStore.ts with temporal middleware from zundo.

Steps:
1. Read src/features/builder/utils/treeOperations.ts for pure functions to wrap
2. Create src/stores/useTreeStore.ts with temporal middleware
3. Wrap all tree operations as store methods
4. Add export to src/stores/index.ts
5. Verify build passes: npm run build
6. DO NOT modify App.tsx yet - just create the store
```

---

## Current State

- **Branch**: `feature/frd-030-architecture-overhaul`
- **Last Commit**: `54b7016` - Phase 2N-14 complete, Phase 2N-15 planned
- **zundo installed**: Yes (`npm install zundo` done)

---

## Your Task: Create useTreeStore.ts (Phase 2N-15a)

Create `/Users/carter/Code/Flowchart/System.app/src/stores/useTreeStore.ts`

### Key Files to Reference

1. **Pure functions to wrap**: `src/features/builder/utils/treeOperations.ts` (906 lines)
2. **Node factory**: `src/features/builder/utils/nodeFactory.ts`
3. **Types**: `src/types/flowNode.ts`
4. **Existing store pattern**: `src/stores/useBotStore.ts`
5. **Full plan**: `frd/FRD-030-Scalable-Architecture-Overhaul.md` (search for "Phase 2N-15")

### Store Template

```typescript
// src/stores/useTreeStore.ts
import { create } from 'zustand'
import { temporal } from 'zundo'
import type {
  FlowNode, BlockKind, SlotId, WeightMode, PositionChoice,
  MetricChoice, ComparatorChoice, NumberedQuantifier
} from '@/types'
import { createDefaultRoot, ensureSlots, createNode } from '@/features/builder'
import {
  replaceSlot,
  insertAtSlot,
  appendPlaceholder,
  deleteNode,
  removeSlotEntry,
  updateTitle,
  updateWeight,
  updateCappedFallback,
  updateVolWindow,
  updateCollapse,
  setAllCollapsed,
  setCollapsedBelow,
  updateColor,
  updateCallReference,
  updateFunctionWindow,
  updateFunctionBottom,
  updateFunctionMetric,
  updateFunctionRank,
  addPositionRow,
  removePositionRow,
  choosePosition,
  addConditionLine,
  deleteConditionLine,
  updateConditionFields,
  addEntryCondition,
  addExitCondition,
  deleteEntryCondition,
  deleteExitCondition,
  updateEntryConditionFields,
  updateExitConditionFields,
  updateScalingFields,
  updateNumberedQuantifier,
  updateNumberedN,
  addNumberedItem,
  deleteNumberedItem,
  cloneNode,
  findNode,
  expandToNode,
} from '@/features/builder/utils/treeOperations'

interface TreeState {
  root: FlowNode

  // Direct setter
  setRoot: (root: FlowNode) => void

  // Node CRUD
  addNode: (parentId: string, slot: SlotId, index: number, kind: BlockKind) => void
  insertNode: (parentId: string, slot: SlotId, index: number, kind: BlockKind) => void
  appendPlaceholder: (targetId: string, slot: SlotId) => void
  deleteNode: (nodeId: string) => void
  removeSlotEntry: (targetId: string, slot: SlotId, index: number) => void

  // Node properties
  renameNode: (nodeId: string, title: string) => void
  updateWeight: (nodeId: string, weighting: WeightMode, branch?: 'then' | 'else') => void
  updateCappedFallback: (nodeId: string, choice: PositionChoice, branch?: 'then' | 'else') => void
  updateVolWindow: (nodeId: string, days: number, branch?: 'then' | 'else') => void
  toggleCollapse: (nodeId: string, collapsed: boolean) => void
  collapseAll: (collapsed: boolean) => void
  collapseBelow: (targetId: string, collapsed: boolean) => void
  updateColor: (nodeId: string, color?: string) => void
  updateCallReference: (nodeId: string, callId: string | null) => void

  // Function node
  updateFunctionWindow: (nodeId: string, value: number) => void
  updateFunctionBottom: (nodeId: string, value: number) => void
  updateFunctionMetric: (nodeId: string, metric: MetricChoice) => void
  updateFunctionRank: (nodeId: string, rank: 'Top' | 'Bottom') => void

  // Position node
  addPosition: (nodeId: string) => void
  removePosition: (nodeId: string, index: number) => void
  choosePosition: (nodeId: string, index: number, choice: PositionChoice) => void

  // Indicator/condition
  addCondition: (nodeId: string, type: 'and' | 'or', itemId?: string) => void
  deleteCondition: (nodeId: string, condId: string, itemId?: string) => void
  updateCondition: (
    nodeId: string,
    condId: string,
    updates: Partial<{
      window: number
      metric: MetricChoice
      comparator: ComparatorChoice
      ticker: PositionChoice
      threshold: number
      expanded?: boolean
      rightWindow?: number
      rightMetric?: MetricChoice
      rightTicker?: PositionChoice
    }>,
    itemId?: string
  ) => void

  // Alt Exit conditions
  addEntryCondition: (nodeId: string, type: 'and' | 'or') => void
  addExitCondition: (nodeId: string, type: 'and' | 'or') => void
  deleteEntryCondition: (nodeId: string, condId: string) => void
  deleteExitCondition: (nodeId: string, condId: string) => void
  updateEntryCondition: (nodeId: string, condId: string, updates: Record<string, unknown>) => void
  updateExitCondition: (nodeId: string, condId: string, updates: Record<string, unknown>) => void

  // Scaling node
  updateScaling: (nodeId: string, updates: Partial<{
    scaleMetric: MetricChoice
    scaleWindow: number
    scaleTicker: string
    scaleFrom: number
    scaleTo: number
  }>) => void

  // Numbered node
  updateNumberedQuantifier: (nodeId: string, quantifier: NumberedQuantifier) => void
  updateNumberedN: (nodeId: string, n: number) => void
  addNumberedItem: (nodeId: string) => void
  deleteNumberedItem: (nodeId: string, itemId: string) => void

  // Tree navigation
  expandToNode: (targetId: string) => boolean
}

export const useTreeStore = create<TreeState>()(
  temporal(
    (set, get) => ({
      root: createDefaultRoot(),

      setRoot: (root) => set({ root: ensureSlots(root) }),

      // Node CRUD
      addNode: (parentId, slot, index, kind) => set((state) => ({
        root: replaceSlot(state.root, parentId, slot, index, createNode(kind))
      })),

      insertNode: (parentId, slot, index, kind) => set((state) => ({
        root: insertAtSlot(state.root, parentId, slot, index, createNode(kind))
      })),

      appendPlaceholder: (targetId, slot) => set((state) => ({
        root: appendPlaceholder(state.root, targetId, slot)
      })),

      deleteNode: (nodeId) => set((state) => ({
        root: deleteNode(state.root, nodeId)
      })),

      removeSlotEntry: (targetId, slot, index) => set((state) => ({
        root: removeSlotEntry(state.root, targetId, slot, index)
      })),

      // Node properties
      renameNode: (nodeId, title) => set((state) => ({
        root: updateTitle(state.root, nodeId, title)
      })),

      updateWeight: (nodeId, weighting, branch) => set((state) => ({
        root: updateWeight(state.root, nodeId, weighting, branch)
      })),

      updateCappedFallback: (nodeId, choice, branch) => set((state) => ({
        root: updateCappedFallback(state.root, nodeId, choice, branch)
      })),

      updateVolWindow: (nodeId, days, branch) => set((state) => ({
        root: updateVolWindow(state.root, nodeId, days, branch)
      })),

      toggleCollapse: (nodeId, collapsed) => set((state) => ({
        root: updateCollapse(state.root, nodeId, collapsed)
      })),

      collapseAll: (collapsed) => set((state) => ({
        root: setAllCollapsed(state.root, collapsed)
      })),

      collapseBelow: (targetId, collapsed) => set((state) => ({
        root: setCollapsedBelow(state.root, targetId, collapsed)
      })),

      updateColor: (nodeId, color) => set((state) => ({
        root: updateColor(state.root, nodeId, color)
      })),

      updateCallReference: (nodeId, callId) => set((state) => ({
        root: updateCallReference(state.root, nodeId, callId)
      })),

      // Function node
      updateFunctionWindow: (nodeId, value) => set((state) => ({
        root: updateFunctionWindow(state.root, nodeId, value)
      })),

      updateFunctionBottom: (nodeId, value) => set((state) => ({
        root: updateFunctionBottom(state.root, nodeId, value)
      })),

      updateFunctionMetric: (nodeId, metric) => set((state) => ({
        root: updateFunctionMetric(state.root, nodeId, metric)
      })),

      updateFunctionRank: (nodeId, rank) => set((state) => ({
        root: updateFunctionRank(state.root, nodeId, rank)
      })),

      // Position node
      addPosition: (nodeId) => set((state) => ({
        root: addPositionRow(state.root, nodeId)
      })),

      removePosition: (nodeId, index) => set((state) => ({
        root: removePositionRow(state.root, nodeId, index)
      })),

      choosePosition: (nodeId, index, choice) => set((state) => ({
        root: choosePosition(state.root, nodeId, index, choice)
      })),

      // Conditions
      addCondition: (nodeId, type, itemId) => set((state) => ({
        root: addConditionLine(state.root, nodeId, type, itemId)
      })),

      deleteCondition: (nodeId, condId, itemId) => set((state) => ({
        root: deleteConditionLine(state.root, nodeId, condId, itemId)
      })),

      updateCondition: (nodeId, condId, updates, itemId) => set((state) => ({
        root: updateConditionFields(state.root, nodeId, condId, updates, itemId)
      })),

      // Alt Exit conditions
      addEntryCondition: (nodeId, type) => set((state) => ({
        root: addEntryCondition(state.root, nodeId, type)
      })),

      addExitCondition: (nodeId, type) => set((state) => ({
        root: addExitCondition(state.root, nodeId, type)
      })),

      deleteEntryCondition: (nodeId, condId) => set((state) => ({
        root: deleteEntryCondition(state.root, nodeId, condId)
      })),

      deleteExitCondition: (nodeId, condId) => set((state) => ({
        root: deleteExitCondition(state.root, nodeId, condId)
      })),

      updateEntryCondition: (nodeId, condId, updates) => set((state) => ({
        root: updateEntryConditionFields(state.root, nodeId, condId, updates)
      })),

      updateExitCondition: (nodeId, condId, updates) => set((state) => ({
        root: updateExitConditionFields(state.root, nodeId, condId, updates)
      })),

      // Scaling
      updateScaling: (nodeId, updates) => set((state) => ({
        root: updateScalingFields(state.root, nodeId, updates)
      })),

      // Numbered
      updateNumberedQuantifier: (nodeId, quantifier) => set((state) => ({
        root: updateNumberedQuantifier(state.root, nodeId, quantifier)
      })),

      updateNumberedN: (nodeId, n) => set((state) => ({
        root: updateNumberedN(state.root, nodeId, n)
      })),

      addNumberedItem: (nodeId) => set((state) => ({
        root: addNumberedItem(state.root, nodeId)
      })),

      deleteNumberedItem: (nodeId, itemId) => set((state) => ({
        root: deleteNumberedItem(state.root, nodeId, itemId)
      })),

      // Tree navigation
      expandToNode: (targetId) => {
        const result = expandToNode(get().root, targetId)
        if (result.found) {
          set({ root: result.next })
        }
        return result.found
      },
    }),
    {
      limit: 100,
      equality: (a, b) => a.root === b.root,
    }
  )
)

// Export temporal controls for undo/redo
export const useTreeHistory = () => useTreeStore.temporal.getState()
```

### After Creating Store

1. **Add export to `/System.app/src/stores/index.ts`**:
```typescript
export { useAuthStore } from './useAuthStore'
export { useUIStore } from './useUIStore'
export { useBotStore } from './useBotStore'
export { useBacktestStore } from './useBacktestStore'
export { useDashboardStore } from './useDashboardStore'
export { useTreeStore, useTreeHistory } from './useTreeStore'  // ADD THIS
```

2. **Verify build passes**:
```bash
cd System.app && npm run build
```

---

## Important Notes

- **DO NOT modify App.tsx yet** - just create the store
- The existing `useBotStore` has manual undo/redo in `push()`, `undo()`, `redo()` - this will eventually be replaced by zundo's automatic tracking
- Pure functions are already extracted - this is a straightforward wrapping exercise
- Follow the existing store pattern in `useBotStore.ts`

---

## Success Criteria

- [ ] `useTreeStore.ts` created with temporal middleware
- [ ] All tree operations from `treeOperations.ts` wrapped as store methods
- [ ] Export added to `stores/index.ts`
- [ ] Build passes: `npm run build`

---

## What Comes After (Phase 2N-15b+)

Once the store is created and building, the next agent will:
1. Integrate store into App.tsx (replace 58 handlers with store calls)
2. Update ModelTab to use store directly
3. Test undo/redo functionality
4. Remove manual history code from useBotStore

See FRD-030 Phase 2N-15 for full migration plan.
