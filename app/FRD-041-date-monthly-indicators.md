# FRD-041: Date/Monthly Indicator Support

## Priority: TBD (User to provide details)

## Problem
Need support for date-based or monthly indicators in the condition system.

## Potential Use Cases
- "If month is January/December" (seasonality)
- "If day of month < 5" (month-start effects)
- "If day of week is Monday" (weekly patterns)
- "If date is within first/last week of month"
- Monthly rebalancing triggers

## Implementation Notes
Waiting for user specification on exact requirements.

## Files Likely Affected
| File | Change |
|------|--------|
| `src/types/indicators.ts` | Add date-based MetricChoice options |
| `src/features/backtest/engine/conditions.ts` | Evaluate date conditions |
| `server/backtest.mjs` | Server-side date evaluation |
| `src/features/builder/components/ConditionEditor.tsx` | UI for date selection |
