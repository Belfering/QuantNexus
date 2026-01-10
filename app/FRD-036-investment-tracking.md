# FRD-036: Investment Tracking Databases

## Priority: MEDIUM

## Problem
Need visibility into:
1. All bots being invested in and total money per bot
2. Every user's portfolio details (cash, allocations, uninvested)

## Current State
- **Tables exist**: `portfolios`, `portfolio_positions` in schema
- **Functions exist**: `getPortfolio()`, `getAggregatedStats()` in `db/index.mjs`
- **Missing**: Comprehensive admin views and export functionality

## Solution

### Database View 1: Bot Investment Summary
```sql
CREATE VIEW bot_investment_summary AS
SELECT
  b.id as bot_id,
  b.name as bot_name,
  b.builderId as builder_id,
  COUNT(DISTINCT pp.portfolio_id) as investor_count,
  COALESCE(SUM(pp.cost_basis), 0) as total_invested,
  COALESCE(SUM(pp.shares), 0) as total_shares
FROM bots b
LEFT JOIN portfolio_positions pp ON pp.bot_id = b.id AND pp.exit_date IS NULL
GROUP BY b.id;
```

### Database View 2: User Portfolio Details
```sql
CREATE VIEW user_portfolio_details AS
SELECT
  u.id as user_id,
  u.username,
  u.displayName,
  p.cash_balance as uninvested_cash,
  COALESCE(SUM(pp.cost_basis), 0) as total_invested,
  p.cash_balance + COALESCE(SUM(pp.cost_basis), 0) as total_portfolio_value,
  GROUP_CONCAT(pp.bot_id || ':' || pp.cost_basis, ',') as allocations
FROM users u
LEFT JOIN portfolios p ON p.owner_id = u.id
LEFT JOIN portfolio_positions pp ON pp.portfolio_id = p.id AND pp.exit_date IS NULL
GROUP BY u.id;
```

### API Endpoints
```javascript
// Get all bot investments (admin only)
GET /api/admin/investments/bots
// Response: [{ botId, botName, investorCount, totalInvested }]

// Get all user portfolios (admin only)
GET /api/admin/investments/users
// Response: [{ userId, username, cashBalance, totalInvested, allocations }]

// Export endpoints
GET /api/admin/investments/bots/export?format=csv
GET /api/admin/investments/users/export?format=csv
```

### Admin UI
Add "Investment Tracking" section in Admin panel with:
- Bot investment summary table (sortable)
- User portfolio table (sortable)
- Export CSV/JSON buttons

### Files to Modify
| File | Change |
|------|--------|
| `server/db/schema.ts` | Add views |
| `server/db/index.mjs` | Add query functions |
| `server/index.mjs` | Add API endpoints |
| `src/features/admin/components/AdminPanel.tsx` | Add Investment Tracking tab |
