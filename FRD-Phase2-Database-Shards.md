# Phase 2: Database and Shards

**Status**: COMPLETE (2026-01-09)

## Requirements
1. Add many more metrics to IS/OOS calculations
2. Add metrics to Pass/Fail criteria (IS stats only)
3. Prefix all requirements with "IS" in display
4. Exportable results
5. Renamable runs with unique IDs
6. Timestamps for when runs started

## What Was Completed
1. **Enhanced IS/OOS Metrics**
   - Added TIM (Time in Market) for both IS and OOS
   - Added TIMAR (TIM Adjusted Returns) for both IS and OOS
   - Added MaxDD (Maximum Drawdown) for both IS and OOS
   - Fixed OOS Volatility and Sortino calculations
   - All metrics now properly calculated and displayed

2. **Pass/Fail Criteria (IS Stats Only)**
   - All eligibility requirements calculated on IS metrics only
   - Metrics dropdown includes: CAGR, MaxDrawdown, Calmar, Sharpe, Sortino, Treynor, Beta, Vol, WinRate, AvgTurnover, AvgHoldings, TIM, TIMAR
   - Requirements display with "IS" prefix: "IS CAGR ≥ 0 %"
   - Percentage metrics formatted with % suffix

3. **Database and Results Persistence**
   - Optimization jobs stored in SQLite database
   - Each job has unique ID with timestamp
   - All branch results saved with IS/OOS metrics
   - Job metadata includes: botId, botName, status, totalBranches, passingBranches, startTime, endTime
   - Results queryable by job ID via API endpoint

4. **UI Improvements**
   - Settings panel with horizontal layout for adding requirements
   - Current requirements displayed in bold with proper formatting
   - Optimization results panel with sortable columns
   - Branch generation progress persists across tab changes

## Files Modified
- System.app/server/db/index.mjs - Database schema and queries
- System.app/server/routes/optimizationResults.mjs - API endpoints
- System.app/server/backtest.mjs - Enhanced metrics calculation
- System.app/src/components/SettingsPanel.tsx - Requirements UI
- System.app/src/features/optimization/components/OptimizationResultsPanel.tsx - Results display
- System.app/src/types/admin.ts - Added TIM/TIMAR to eligibility metrics
- System.app/src/stores/useBotStore.ts - Job state management
