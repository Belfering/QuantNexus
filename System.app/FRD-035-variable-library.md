# FRD-035: Variable Library Database

## Priority: LOW (Documentation/reference feature)

## Problem
No centralized documentation of variables used in metric calculations. Developers need to know exact variable names as they appear in code.

## Solution

### New Database Table
```sql
CREATE TABLE metric_variables (
  id INTEGER PRIMARY KEY,
  variable_name TEXT NOT NULL UNIQUE,  -- Exact name in code (e.g., 'cagr', 'maxDd')
  display_name TEXT,                    -- Human readable (e.g., 'CAGR', 'Max Drawdown')
  description TEXT,                     -- What it calculates
  formula TEXT,                         -- Calculation formula
  source_file TEXT,                     -- Where it's calculated
  created_at TEXT
);
```

### Initial Data (from `server/backtest.mjs:3024-3059`)
| variable_name | display_name | description | formula |
|---------------|--------------|-------------|---------|
| `cagr` | CAGR | Compound Annual Growth Rate | `final^(252/days) - 1` |
| `maxDd` | Max Drawdown | Largest peak-to-trough decline | `min(equity[i]/peak - 1)` |
| `sharpe` | Sharpe Ratio | Risk-adjusted return | `(sqrt(252) * mean) / std` |
| `sortino` | Sortino Ratio | Downside risk-adjusted return | `annualizedMean / downsideStd` |
| `calmar` | Calmar Ratio | CAGR / MaxDD | `cagr / abs(maxDd)` |
| `volatility` | Volatility | Annualized standard deviation | `std * sqrt(252)` |

### Admin UI
Add "Variable Library" tab in Admin > Databases panel showing this table with search/filter.

### Files to Modify
| File | Change |
|------|--------|
| `server/db/schema.ts` | Add `metric_variables` table |
| `server/db/index.mjs` | CRUD for variables |
| `src/features/admin/components/AdminPanel.tsx` | Add Variable Library tab |
