# FRD-034: Analyze Tab Card Improvements

## Priority: MEDIUM

## Problem
1. Benchmark and Robustness tabs missing from expanded watchlist cards
2. Builder ID shown instead of display name
3. Watchlist tags clutter collapsed view (should be single line)

## Current State
- **Expanded Cards**: Have 3 tabs (Overview, Advanced, Robustness) in `AnalyzePanel.tsx`
- **Builder Display**: Shows `builderId` with fallback to `builderDisplayName` (lines 1095)
- **Tags**: Rendered inline in collapsed card header

## Solution

### Part A: Builder Display Name Priority
```typescript
// Fix: prioritize displayName over ID
{b.builderDisplayName || userDisplayNameMap[b.builderId] || b.builderId}
```

### Part B: Move Watchlist Tags to Expanded View
```typescript
// Collapsed card: Remove tags, keep single line
<div className="collapsed-card flex items-center gap-2">
  <span>{bot.name}</span>
  <Button onClick={expand}>Expand</Button>
  <Button onClick={openInModel}>Open in Model</Button>
</div>

// Expanded card: Show tags at top
<div className="expanded-header">
  <div className="flex gap-1">
    {watchlistTags.map(tag => <Badge key={tag.id}>{tag.name}</Badge>)}
  </div>
  // ... rest of expanded content
</div>
```

### Part C: Add Benchmark/Robustness to Cards
The expanded cards already have these tabs. Verify they're working and data populates correctly.

### Files to Modify
| File | Change |
|------|--------|
| `src/features/analyze/components/AnalyzePanel.tsx` | Fix builder name, move tags |
