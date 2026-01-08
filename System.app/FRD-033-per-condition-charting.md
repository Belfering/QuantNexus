# FRD-033: Per-Condition Charting & Isolated Backtest

## Priority: MEDIUM

## Problem
1. Entry/exit condition zones in AltExit nodes lack the "chart values" overlay button that exists for regular conditions
2. Users want to see backtest returns for a single condition in isolation (all other branches become cash)

## Current State
- **Overlay System**: `indicatorOverlayData` in `useBacktestStore` renders condition values on equity chart
- **AltExitBody.tsx**: Has `entryConditions` and `exitConditions` arrays but no chart button
- **Condition charting**: Only available in regular ConditionEditor, not in AltExitBody

## Solution

### Part A: Add Chart Button to Entry/Exit Conditions

**File**: `src/features/builder/components/NodeCard/AltExitBody.tsx`

Add chart icon button next to each entry/exit condition that:
1. Calculates the indicator series for that condition
2. Adds overlay to `indicatorOverlayData` store
3. Displays on equity chart with threshold line

### Part B: Isolated Condition Backtest

**New Feature**: "Run Isolated" button on conditions

**Logic**:
1. User clicks "Run Isolated" on a specific condition
2. Create modified payload where:
   - Target condition branch → original investment (e.g., SPY)
   - ALL other branches → cash position (BIL)
3. Run backtest with simplified settings (no Monte Carlo, no K-Folds)
4. Display results in mini panel or modal

**Implementation**:
```typescript
// Create isolated payload
const createIsolatedPayload = (
  originalPayload: FlowNode,
  targetConditionId: string
): FlowNode => {
  // Deep clone payload
  // Walk tree, replace all position nodes with BIL except those
  // that are direct children of the target condition's branch
  // Return modified tree
}
```

### Files to Modify
| File | Change |
|------|--------|
| `src/features/builder/components/NodeCard/AltExitBody.tsx` | Add chart + isolated run buttons |
| `src/features/backtest/hooks/useBacktestEngine.ts` | Add `runIsolatedConditionBacktest()` |
| `src/stores/useBacktestStore.ts` | Store isolated backtest results |
