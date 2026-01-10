# Phase 0: Branch Generator and Bug Fixes

**Status**: COMPLETE (2026-01-09)

## Requirements
- Run branch generator and fix bugs

## What Was Completed
1. **Fixed branch parameter application** - ID preservation bug resolved
   - Changed from `cloneNode()` to `deepCloneForCompression()`
   - Each branch now gets different parameter values applied correctly
   - Previously all branches produced identical results due to ID mismatch

2. **Fixed OOS Volatility and Sortino calculation**
   - Added bounds check when filtering IS/OOS returns
   - Fixed array index bug (points array has 1 more element than returns)
   - Prevented undefined/NaN propagation through calculations

3. **Added TIM and TIMAR metrics**
   - Time in Market (TIM): % of days with non-cash positions
   - TIM Adjusted Returns (TIMAR): CAGR / TIM
   - Available for both IS and OOS periods

## Files Modified
- System.app/server/backtest.mjs
- System.app/src/features/optimization/services/branchGenerator.ts
- System.app/src/features/optimization/hooks/useBatchBacktest.ts
