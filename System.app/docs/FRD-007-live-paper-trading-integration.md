# FRD-007: Live/Paper Trading Integration

## Metadata
- ID: FRD-007
- Title: Live/Paper Trading Integration with Alpaca
- Status: draft
- Priority: High
- Created: 2026-01-20

## Reference Implementation
**CRITICAL**: Always reference `C:\Users\Trader\Desktop\Alpaca Trading\Master Script\Master.py` for trading patterns, safety features, and error handling before implementing any trading logic.

---

## Summary
Connect the Dashboard's bot investment functionality with real Alpaca trading. Users can "invest" in bots for paper or live trading, and the system executes trades automatically X minutes before market close using allocations computed by the Model tab's backtest engine.

**KEY INSIGHT**: The flowchart IS the allocation engine. The executor only handles running backtests, merging bots, applying global filters, and executing orders safely.

---

## Goals
1. Track which bots a user has "invested" in (paper vs live separately)
2. Run backtests to get today's allocations from flowchart models
3. Merge multiple bot allocations by investment weight
4. Execute trades via Alpaca X minutes before market close
5. Show invested bots and execution results on Dashboard

## Non-goals
- Rebuilding allocation logic (flowchart handles caps, conditions, weighting)
- Intraday trading (only end-of-day execution)
- Fractional shares support
- Multiple brokers (Alpaca only)

---

## Architecture

### Core Principle
The **flowchart is the allocation engine**. All allocation logic (per-ticker caps, indicator conditions, weighting modes) is defined in Model tab flowchart nodes. The trading executor does NOT duplicate this logic.

### Executor Responsibilities (from Master.py)
| Feature | Description |
|---------|-------------|
| Run Backtests | Call existing backtest API for each invested bot |
| Merge Bots | Combine allocations weighted by investment amounts |
| Paired Ticker Filter | Global setting - remove conflicting hedges |
| 99% Total Cap | Safety margin - never exceed 99% |
| Price Fallback | Quote → Trade → 1-Day Bar |
| Sell Before Buy | Generate cash first |
| Integer Shares | Math.floor, skip if < 1 share |
| Order Cancellation | Cancel pending before trading |
| Bot Failure Fallback | Failed backtest → fallback ticker |

---

## Data Model

### New Tables

```sql
-- Track bot investments per user/mode
CREATE TABLE user_bot_investments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  credential_type TEXT NOT NULL DEFAULT 'paper',  -- 'paper' | 'live'
  bot_id TEXT NOT NULL,
  investment_amount REAL NOT NULL,
  weight_mode TEXT DEFAULT 'dollars',  -- 'dollars' | 'percent'
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  UNIQUE(user_id, credential_type, bot_id)
);

-- Global trading settings per user
CREATE TABLE trading_settings (
  user_id TEXT PRIMARY KEY,
  order_type TEXT DEFAULT 'limit',           -- 'limit' | 'market'
  limit_percent REAL DEFAULT 1.0,            -- % above current for limits
  fallback_ticker TEXT DEFAULT 'SGOV',       -- where overflow/failures go
  cash_reserve_mode TEXT DEFAULT 'dollars',  -- 'dollars' | 'percent'
  cash_reserve_amount REAL DEFAULT 0,
  minutes_before_close INTEGER DEFAULT 10,
  paired_tickers TEXT DEFAULT '',            -- JSON: [["SPY","SH"],["QQQ","PSQ"]]
  enabled BOOLEAN DEFAULT 0                  -- scheduler on/off
);

-- Execution audit log
CREATE TABLE trade_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  credential_type TEXT NOT NULL,
  execution_date TEXT NOT NULL,
  status TEXT NOT NULL,  -- 'success' | 'partial' | 'failed'
  target_allocations TEXT,  -- JSON
  executed_orders TEXT,     -- JSON
  errors TEXT,              -- JSON
  created_at INTEGER DEFAULT (unixepoch())
);

-- Individual order records
CREATE TABLE trade_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  execution_id INTEGER REFERENCES trade_executions(id),
  side TEXT NOT NULL,
  symbol TEXT NOT NULL,
  qty INTEGER NOT NULL,
  price REAL,
  order_type TEXT,
  status TEXT,
  alpaca_order_id TEXT,
  error TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);
```

---

## API Endpoints

### Investment Management
- `GET /api/admin/trading/investments?mode=paper|live` - List user's bot investments
- `POST /api/admin/trading/investments` - Add/update bot investment
- `DELETE /api/admin/trading/investments/:botId?mode=paper|live` - Remove investment

### Settings
- `GET /api/admin/trading/settings` - Get trading settings
- `POST /api/admin/trading/settings` - Update trading settings

### Execution
- `POST /api/admin/trading/execute?mode=paper|live&dryRun=true|false` - Manual execute
- `GET /api/admin/trading/executions` - List execution history

---

## Execution Flow

```
1. Trigger (scheduler or manual)
   ↓
2. For each invested bot:
   a. Load bot's flowchart from database
   b. Call backtest API with endDate='today'
   c. Extract last day's positions { ticker: percent }
   d. If backtest fails → use fallback ticker for that bot's weight
   ↓
3. Merge all bot results:
   - Weight by investment amount (dollars or percent)
   - Combined allocation = sum of (bot_alloc * bot_weight)
   ↓
4. Apply global filters:
   - Paired ticker filtering (from trading_settings)
   - Normalize to 99% max total
   ↓
5. Get current Alpaca positions:
   - Calculate current allocation %
   ↓
6. Calculate trades:
   - Sells: current% > target% (liquidate excess)
   - Buys: target% > current% (add positions)
   ↓
7. Execute orders:
   a. Cancel all pending orders
   b. Execute sells (market orders) - generates cash
   c. Get fresh prices with 3-tier fallback
   d. Execute buys (limit orders, 1% buffer)
   ↓
8. Log results to trade_executions table
```

---

## File Structure

```
server/live/
├── broker-alpaca.mjs        (existing - enhance price fallbacks)
├── trade-executor.mjs       (REWRITE - backtest-driven)
├── backtest-allocator.mjs   (NEW - calls backtest, merges bots)
└── paired-tickers.mjs       (NEW - global filter logic)
```

---

## UX / UI

### Dashboard Panel (Live/Paper Mode)
1. **Buy Bot Section**
   - Shows Alpaca cash balance as available
   - Bot selector dropdown
   - Investment amount input
   - Weight mode toggle (dollars/percent)
   - "Invest" button

2. **Invested Bots List**
   - Table: Bot name, amount, weight mode, remove button

### Admin Tab - Trading Settings Panel
- Minutes before close input
- Order type toggle (limit/market)
- Limit percent input (for limit orders)
- Fallback ticker selector (SGOV, CASH, custom)
- Cash reserve settings (dollars or percent)
- Paired tickers editor
- Enable/disable scheduler toggle
- Manual "Execute Now" button (with dry-run option)
- Recent executions log

---

## Safety Requirements

### Executor-Level (from Master.py)
1. **Never exceed 99% allocation** - always keep 1% buffer
2. **Sell before buy** - generate cash first
3. **Cancel pending orders** - clean slate before trading
4. **Bot failure isolation** - failed backtest → fallback ticker
5. **Price validation** - 3-tier fallback, skip if all fail
6. **Integer shares** - no fractional, skip if < 1 share
7. **Paired ticker filtering** - global setting, applied after merge

### Flowchart-Level (already in Model tab)
- Per-ticker caps → flowchart nodes
- Allocation weighting → flowchart weighting modes
- Indicator conditions → flowchart indicator nodes
- Position sizing → flowchart position nodes

---

## Implementation Phases

| Phase | Description | Priority |
|-------|-------------|----------|
| 1 | Database tables + investment CRUD APIs | HIGH |
| 2 | Backtest-driven executor + price fallbacks | HIGH |
| 3 | Market close scheduler | HIGH |
| 4 | Dashboard UI integration | MEDIUM |
| 5 | Logging & audit trail | LOW |

---

## Files to Modify

| File | Changes |
|------|---------|
| `server/routes/live.mjs` | Add tables, investment/settings CRUD, execute endpoint |
| `server/live/backtest-allocator.mjs` | NEW - calls backtest, merges bots |
| `server/live/paired-tickers.mjs` | NEW - global paired filter |
| `server/live/broker-alpaca.mjs` | Add 3-tier price fallback |
| `server/live/trade-executor.mjs` | Rewrite to use backtest-allocator |
| `server/scheduler.mjs` | Add market-close trading task |
| `src/features/dashboard/components/DashboardPanel.tsx` | Show investments UI |
| `src/features/dashboard/hooks/useAlpacaPortfolio.ts` | Add investment methods |
| `src/features/admin/` | Add trading settings panel |

---

## Acceptance Criteria

### Phase 1: Foundation
- [ ] Can create/read/update/delete bot investments
- [ ] Trading settings persist correctly
- [ ] Paper and live investments tracked separately

### Phase 2: Trade Executor
- [ ] Backtest runs for each invested bot
- [ ] Multiple bot allocations merge correctly by weight
- [ ] Price fallback chain works (quote → trade → bar)
- [ ] Paired tickers filtered correctly
- [ ] 99% max allocation enforced
- [ ] Integer shares only (no fractional)
- [ ] Sells execute before buys

### Phase 3: Scheduler
- [ ] Scheduler fires at configured minutes before close
- [ ] Paper/live execute with correct credentials
- [ ] Bot failures don't crash system
- [ ] Logging captures all activity

### Phase 4: Dashboard UI
- [ ] "Buy Bot" shows in Live/Paper mode
- [ ] Can add/remove bot investments
- [ ] Invested bots list displays correctly
- [ ] Trading settings panel works

### Phase 5: Logging
- [ ] All trades logged to database
- [ ] Can view execution history
- [ ] Errors captured with context

---

## CLAUDE.md Update

Add to `C:\Users\Trader\CLAUDE.md`:

```markdown
### Alpaca Trading Reference
- **Path:** `C:\Users\Trader\Desktop\Alpaca Trading`
- **Purpose:** Reference implementation for live/paper trading features
- **Key Files:**
  - `Master Script/Master.py` - Main orchestrator with safety features
  - `App.py` - GUI scheduler
  - `settings.json` - Configuration patterns
- **ALWAYS** check this folder first when implementing trading features
- Contains: fallback tickers, paired ticker filtering, error handling, execution patterns
```
