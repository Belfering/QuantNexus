# FRD-020: Nested Condition Groups (AnyOf/AllOf) in Numbered Nodes

## Metadata
- ID: FRD-020
- Title: Nested Condition Groups in Numbered Nodes
- Status: approved
- Owner: System
- Depends on: None
- Supersedes: None
- Created: 2025-12-24
- Last updated: 2025-12-24

## Summary

Enable Atlas to properly import QuantMage Switch nodes that use nested `AnyOf`/`AllOf` condition groups. Currently, Atlas flattens these groups into individual items, losing the hierarchical structure. After this change, each group becomes a single numbered item with the appropriate OR/AND logic.

## Goals

1. Import QM Switch ladders with nested AnyOf/AllOf groups correctly
2. Preserve the 2-level logic structure: top-level "Among N signals" + per-item "any/all"
3. Display visual indicators showing which items use OR vs AND logic
4. Produce correct backtest results matching QM behavior

## Non-goals

1. UI controls to manually create/edit condition groups (future enhancement)
2. Drag-and-drop reordering of conditions within groups
3. Deeply nested groups (AnyOf containing AllOf containing AnyOf)

## User Stories

1. As a user, when I import "5D OB Switch.json", I want to see "Among 3 signals below" with 3 groups, not "Among 20 signals" with 20 individual conditions.
2. As a user, I want to see "(any)" labels on items that use OR logic so I understand how conditions combine.
3. As a user, I want backtests to produce the same allocations as QM for strategies with nested groups.

## UX / UI

### Copy (exact strings):
- "(any)" - displayed after item header when groupLogic is 'or'
- "(all)" - displayed after item header when groupLogic is 'and' and multiple conditions exist

### Components:
- `NodeCard` - existing component, add groupLogic indicator

### States:
- Default: no groupLogic (backward compatible with existing items)
- OR mode: groupLogic === 'or', shows "(any)"
- AND mode: groupLogic === 'and', shows "(all)" when 2+ conditions

### Interactions:
- Read-only indicator for imported strategies
- Future: dropdown to toggle between Any/All

## Data Model / State

### NumberedItem Type Change

**Before:**
```typescript
type NumberedItem = {
  id: string
  conditions: ConditionLine[]
}
```

**After:**
```typescript
type NumberedItem = {
  id: string
  conditions: ConditionLine[]
  groupLogic?: 'and' | 'or'  // How conditions within this item combine
}
```

### QM Import Mapping

| QM condition_type | Atlas groupLogic | Condition types |
|-------------------|------------------|-----------------|
| `AnyOf` | `'or'` | First: 'if', rest: 'or' |
| `AllOf` | `'and'` | First: 'if', rest: 'and' |
| `SingleCondition` | undefined | Single 'if' |

## Behavioral Spec

### Happy paths:
1. Import Switch with 3 AnyOf groups → 3 numbered items, each with groupLogic: 'or'
2. Import Switch with AllOf groups → items with groupLogic: 'and'
3. Import Switch with mixed types → appropriate groupLogic per item
4. Backtest evaluates items correctly based on groupLogic

### Edge cases:
1. Empty AnyOf/AllOf → fallback to default RSI condition
2. Single condition in AnyOf → groupLogic: 'or' but only one condition
3. Existing bots without groupLogic → continue using boolean precedence

### Errors / validation:
- No validation errors expected; graceful fallback for unknown types

## Acceptance Criteria

1. [ ] Import "5D OB Switch.json" shows "Among 3 signals below"
2. [ ] Each signal displays "(any)" indicator
3. [ ] Each signal contains 7/6/7 RSI conditions respectively
4. [ ] Ladder shows 4 outputs: all=UVXY, 2=VIXY, 1=VIXM, 0=nothing
5. [ ] Backtest produces correct allocations (verify against QM)
6. [ ] Existing bots without groupLogic continue to work

## Files to Modify

| File | Changes |
|------|---------|
| `System.app/src/App.tsx` | Add `groupLogic` to NumberedItem type, UI display |
| `System.app/src/importWorker.ts` | Parse nested AnyOf/AllOf in Switch conditions |
| `System.app/server/backtest.mjs` | Evaluate items with groupLogic (if needed) |

## Open Questions

None - approach is validated.
