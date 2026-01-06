# FRD-032: Crosses Above/Below Comparators

## Priority: HIGH (Core functionality gap)

## Problem
The comparator system only supports `gt` (greater than) and `lt` (less than). Users need "Crosses Above" and "Crosses Below" for momentum signals where the trigger is the crossing event, not just being above/below.

## Current State
- **Type**: `ComparatorChoice = 'lt' | 'gt'` in `src/types/indicators.ts:64`
- **UI**: Only "Less Than" and "Greater Than" options in `ConditionEditor.tsx`
- **Evaluation**: Simple `left < threshold` or `left > threshold` in `conditions.ts`

## Solution

### Type Extension
```typescript
// src/types/indicators.ts
export type ComparatorChoice = 'lt' | 'gt' | 'crossAbove' | 'crossBelow'
```

### Condition Evaluation Logic
```typescript
// src/features/backtest/engine/conditions.ts

// For crossAbove: yesterday < threshold AND today >= threshold
// For crossBelow: yesterday > threshold AND today <= threshold

const evaluateCrossing = (
  ctx: BacktestContext,
  ticker: string,
  metric: MetricChoice,
  window: number,
  index: number,
  threshold: number,
  isCrossAbove: boolean
): boolean => {
  if (index < 1) return false  // Need previous day

  const today = metricAtIndex(ctx, ticker, metric, window, index)
  const yesterday = metricAtIndex(ctx, ticker, metric, window, index - 1)

  if (today === null || yesterday === null) return false

  if (isCrossAbove) {
    return yesterday < threshold && today >= threshold
  } else {
    return yesterday > threshold && today <= threshold
  }
}
```

### UI Update
```typescript
// src/features/builder/components/ConditionEditor.tsx
<Select value={cond.comparator} onChange={...}>
  <option value="lt">Less Than</option>
  <option value="gt">Greater Than</option>
  <option value="crossAbove">Crosses Above</option>
  <option value="crossBelow">Crosses Below</option>
</Select>
```

### Files to Modify
| File | Change |
|------|--------|
| `src/types/indicators.ts` | Extend ComparatorChoice type |
| `src/features/backtest/engine/conditions.ts` | Add crossing logic |
| `src/features/builder/components/ConditionEditor.tsx` | Add dropdown options |
| `src/features/builder/utils/treeOperations.ts` | Update normalizeComparatorChoice |
