# FRD Status Report
Generated: 2025-12-26 (Updated)

## Executive Summary

**Total FRDs**: 23 active documents
**Completed**: 21 (FRD-001 through FRD-008, FRD-012-014, FRD-016-019, FRD-021-025, Admin features)
**In Progress**: 0
**Deferred (OFF)**: 3 (FRD-011, FRD-026, FRD-027)
**Ongoing**: 1 (FRD-020)
**Pending**: 0
**Completion Rate**: 91%

### Session 4 Updates (2025-12-27)
- **COMPLETED**: FRD-017 (Payload Compression) - Gzip compression for payloads >1MB, automatic decompress on read
- **COMPLETED**: FRD-023 (Atlas Improvements) - Sort dropdowns, Export JSON, Open Model buttons, collapsed stats preview
- **COMPLETED**: FRD-025 (Atlas Zone) - Expandable cards, Add to Watchlist, IP protection verified
- **COMPLETED**: FRD-022 (Extended Indicators) - 43+ indicators now available:
  - 40+ already implemented (Hull MA, Bollinger, Stochastic, ADX, ATR, etc.)
  - Added Volume-based: Money Flow Index, OBV Rate of Change, VWAP Ratio

### Latest Updates (2025-12-26)
- **COMPLETED**: FRD-021 (Model Tab UI) - Renamed Build→Model, 60px insert button, accent-tinted bars, fixed font sizes
- **COMPLETED**: FRD-024 (Nexus Rename) - Community Nexus→Nexus, Top Nexus Systems→Nexus Select Zone
- **ADDED**: FRD-020 (QuantMage Verification) - ONGOING manual verification
- **ADDED**: FRD-022 (Extended Indicators) - OFF, future implementation
- **ADDED**: FRD-023 (Separate Atlas Database) - PENDING
- **ADDED**: FRD-025 (Atlas Zone Improvements) - PENDING
- **ADDED**: FRD-026 (Advanced Analytics) - OFF, future implementation
- **ADDED**: FRD-027 (Tiingo Data Pipeline) - OFF, future implementation

### Session 2 Updates (2025-12-26)
- **COMPLETED**: FRD-003 (Testing) - Vitest framework with 34 tests for AND/OR/IF conditional logic
- **COMPLETED**: FRD-008 (Password Hashing) - bcrypt implementation with auto-migration of existing passwords
- **COMPLETED**: FRD-007 (Database Migration) - Full migration complete, deprecated localStorage code removed

### Previous Updates (2025-12-22)
- **COMPLETED**: FRD-018 (Alt Exit & Scaling) - Two new node types with stateful/gradient allocation
- **COMPLETED**: FRD-019 (Auto-Detect Import) - Unified import with Atlas/Composer/QuantMage detection
- **COMPLETED**: FRD-012 (Fund Lock) - Published systems are immutable, "Copy to New" available
- **COMPLETED**: FRD-013 (Rename to Systems) - UI strings updated from "Bot" to "System"
- **COMPLETED**: FRD-014 (Backtest Caching) - Separate cache DB, daily refresh on first login
- **COMPLETED**: FRD-016 (Beta Metric) - Beta vs SPY added to backtest metrics
- **DEFERRED**: FRD-011 (Atlas Sponsored) - Needs further investigation

---

## COMPLETED FRDs

### FRD-001: Analyze Tab (Collapsible Bot Cards + Performance)
**Status**: COMPLETE
**Priority**: #1 (Highest)

#### What Was Completed:
- Tab label reads "Analyze"
- Bot list entries render as collapsible cards, default collapsed
- Filter by watchlist works ("All" shows all bots across user's watchlists)
- Collapsed card shows bot name, expand/collapse, watchlist tags with remove, and actions
- Expanded card shows:
  - Live Stats zone with real investment data (Invested, Current Value, P&L, CAGR since investment)
  - Shows "Not invested" message when user hasn't bought the bot
  - Backtest Snapshot with equity chart (log scale enabled) and drawdown chart
  - Historical Stats: CAGR, MaxDD, Calmar, Sharpe, Sortino, Treynor, Beta, Volatility, Win Rate, Turnover, Avg Holdings, Trading Days
- "Open in Build Tab" visible while collapsed
- "Add to Watchlist" offers create-new and existing watchlists
- Correlation Tool subtab exists with three placeholder columns

---

### FRD-002: Community Tab (Watchlists View)
**Status**: COMPLETE
**Priority**: #2

#### What Was Completed:
- Community Nexus tab exists in navigation
- 4-column grid layout with proper structure
- "Top Community Systems" left column with 3 tables:
  - Top community systems by CAGR (sorted, top 10)
  - Top community systems by Calmar Ratio (sorted, top 10)
  - Top community systems by Sharpe Ratio (sorted, top 10)
- Tables pull real backtest data from `analyzeBacktests`
- Personal Watchlists right column with 2 watchlist zones
- Watchlist dropdown selectors in right zones
- Sortable table headers (Name, Tags, OOS CAGR, OOS MaxDD, OOS Sharpe)
- Middle placeholder for News and Search

---

### FRD-004 (Backlog): Theming Toggle + Per-Profile Persistence
**Status**: COMPLETE
**Priority**: #4

#### What Was Completed:
- Light/dark theme toggle exists in header
- 10 color themes available (Ruby, Emerald, Sapphire, Amber, etc.)
- Theme persists per-profile via localStorage with `userDataKey(userId)`
- Dark mode CSS variables work across all components
- Per-profile saved bots, watchlists, and UI state
- Clear Data button in Admin > Ticker Data tab

---

### FRD-005 (Backlog): Branding (Atlas Engine)
**Status**: COMPLETE
**Priority**: #7

#### What Was Completed:
- Document title: "Atlas Engine" (in index.html)
- Custom favicon: favicon.svg with "AE" initials in blue rounded square
- Header shows "Atlas Engine" branding

---

### FRD-006: Tailwind CSS + shadcn/ui Refactor
**Status**: COMPLETE (87% inline styles eliminated)
**Priority**: Backlog item

#### What Was Completed:
- Tailwind CSS v4 installed and configured
- shadcn/ui components installed (Button, Input, Select, Card, Table, Tabs, Alert, Badge)
- 87% of inline styles converted (168 of 193)
- All shadcn components integrated across Build, Analyze, Portfolio, Community tabs
- Dark mode support via Tailwind `dark:` variants
- Build passing with no TypeScript errors
- Code reduction: 438 lines removed (52% reduction)

---

### FRD-012: Fund Lock (No Edit for Published Systems)
**Status**: COMPLETE
**Priority**: High

#### What Was Completed:
- Systems with "Nexus" or "Atlas" tags are immutable (no edit button)
- "Copy to New System" button allows creating editable copies
- Copy adds " (Copy)" suffix to name
- Protects investors - the system they bought doesn't change
- Maintains integrity of published metrics

---

### FRD-013: Rename "Bots" to "Systems"
**Status**: COMPLETE
**Priority**: Medium

#### What Was Completed:
- All UI strings updated: "Bot" → "System", "Bots" → "Systems"
- Type aliases created for backwards compatibility (SavedBot = SavedSystem)
- Dashboard labels: "Buy System", "Systems Invested In"
- Analyze labels: "Not invested in this system"
- Community labels: "Top Nexus Systems"

---

### FRD-014: Backtest Caching & Daily Refresh
**Status**: COMPLETE
**Priority**: High

#### What Was Completed:
- Separate SQLite database for cache (`backtest_cache.db`)
- Cache key: bot_id + payload_hash + data_date
- Cache stores full backtest results (metrics, equityCurve, benchmarkCurve, allocations)
- Cache invalidation triggers:
  - Payload hash mismatch (system changed)
  - Data date mismatch (new ticker data downloaded)
  - First-user-login-of-day (daily refresh)
- Admin endpoints:
  - `GET /api/admin/cache/stats` - Cache statistics
  - `POST /api/admin/cache/invalidate` - Manual invalidation
  - `POST /api/admin/cache/refresh` - Force daily refresh
- Backtest endpoint supports `forceRefresh: true` to bypass cache
- Only completed backtests are cached (errors are not)

---

### FRD-016: Beta Metric
**Status**: COMPLETE
**Priority**: Medium

#### What Was Completed:
- Beta (vs SPY) calculated in backtest engine
- Formula: Cov(system, SPY) / Var(SPY)
- Added to metrics object returned by backtest
- Displayed in Build tab metrics panel
- Displayed in Analyze tab expanded view
- Displayed in System Cards (Historical Stats)

---

### FRD-018: Alt Exit & Scaling Node Types
**Status**: COMPLETE
**Priority**: Medium

#### What Was Completed:
- **Alt Exit Node**: Stateful toggle with distinct entry/exit conditions
  - "Latches" in THEN state until exit condition triggers
  - Then stays in ELSE until entry condition triggers again
  - Supports AND/OR condition chains for both entry and exit
  - First bar evaluates both conditions, entry takes priority
- **Scaling Node**: Gradient allocation based on indicator position in range
  - Single indicator only (e.g., RSI 14 of SPY)
  - FROM/TO range defines gradient (inverted ranges supported)
  - At or below FROM = 100% THEN, at or above TO = 100% ELSE
  - In range = proportional blend between branches
- Both node types added to createNode(), evaluateNode(), NodeCard UI
- SLOT_ORDER updated: both use `['then', 'else']` (no 'next' slot)

---

### FRD-019: Auto-Detect Import (Atlas/Composer/QuantMage)
**Status**: COMPLETE
**Priority**: High

#### What Was Completed:
- Unified Import button auto-detects format:
  - **Atlas**: Native JSON format (has `kind`, `id`, `children` fields)
  - **Composer**: Symphony export format (has `step` field)
  - **QuantMage**: Placeholder for future (detected but shows "not yet supported")
- **Composer Parser** (`parseComposerSymphony`):
  - Maps `asset` → Position node
  - Maps `filter` → Sort/Function node
  - Maps `if`/`if-child` → Indicator node with conditions
  - Maps `group`/`wt-cash-equal`/`root` → Basic node
  - Flattens `wt-cash-equal` wrapper nodes
  - Threshold detection via `rhs-fixed-value?` field
  - Indicator vs indicator comparison support (`expanded: true`)
- **Metric Mapping**: standard-deviation-return → Standard Deviation, etc.
- **Comparator Mapping**: crosses-above → crossAbove, etc.
- Console logging for debugging: `[Import] Detected format: composer`
- File name inference for untitled strategies

---

### Admin Account & Atlas Overview
**Status**: COMPLETE
**Priority**: Custom request

#### What Was Completed:
- Admin account (admin/admin) with exclusive Admin tab access
- Non-admin users cannot see Admin tab
- Atlas Overview tab with:
  - Total Dollars In Accounts aggregation
  - Total Dollars Invested aggregation
  - Configurable Atlas Fee % and Partner Program Share %
  - Treasury Bill Holdings section with equity chart
- Nexus Maintenance tab with 3 placeholder watchlist tables
- Backend API endpoints for admin data persistence
- Portfolio sync for cross-account aggregation

---

### FRD-007: Database Architecture & Migration
**Status**: COMPLETE
**Priority**: Critical

#### What Was Completed:
- SQLite + Drizzle ORM architecture implemented
- Database schema: users, bots, watchlists, portfolios, positions, metrics, call_chains, user_preferences
- CRUD API endpoints for all entities
- Server-side backtest with IP protection
- Full migration from localStorage to database:
  - Portfolios with positions load/save via API
  - Watchlists with bot associations via API
  - User preferences (theme, color scheme) via API
  - Call chains via API with debounced auto-save
- Deprecated localStorage code removed (~115 lines)
- Automatic migration of legacy localStorage data on first login

---

### FRD-003: Conditional Logic Validation (AND/IF, OR/IF)
**Status**: COMPLETE
**Priority**: #3

#### What Was Completed:
- Vitest testing framework installed and configured
- Test files located in `__tests__/` directory
- 34 automated tests covering:
  - Basic AND/OR operations
  - Boolean precedence: `A OR B AND C` = `A OR (B AND C)` (standard precedence)
  - Mixed AND/OR with precedence verification
  - Complex nested expressions
  - Null propagation handling
  - IF type handling (starts new condition chains)
- Run tests with `npm run test` or `npm run test:run`

---

### FRD-008: User Data Security Best Practices
**Status**: COMPLETE
**Priority**: High

#### What Was Completed:
- bcrypt password hashing with 10 salt rounds
- Secure password comparison using `bcrypt.compare()`
- Auto-migration of existing plain-text passwords to bcrypt hashes on server startup
- Passwords in database now stored as `$2b$10$...` bcrypt hashes
- `hashPassword()` utility function exported for future use
- Login continues to work seamlessly (passwords: 1/1, 3/3, 5/5, 7/7, 9/9, admin/admin)

---

### FRD-021: Model Tab UI Improvements
**Status**: COMPLETE
**Priority**: Medium

#### What Was Completed:
- **Tab Rename**: "Build" tab renamed to "Model" throughout App.tsx
- **Insert Button**: Enlarged from 20px to 60px (3x larger) for better usability
  - Border-radius increased to 12px
  - Font size increased to 32px
- **Node Head Theming**: Added subtle accent tint using CSS `color-mix()`
  - Base: 8% accent color + 92% surface-2
  - Hover: 15% accent color + 85% surface
  - Left border: 3px solid accent color
- **Font Fixes**: Reduced oversized fonts
  - `.title-input`: font-size 13px, padding 4px 6px, width 160px
  - `.inline-number`: font-size 12px, width 48px, padding 2px 4px

---

### FRD-024: Nexus Label Rename
**Status**: COMPLETE
**Priority**: Low

#### What Was Completed:
- "Community Nexus" tab renamed to "Nexus"
- "Top Nexus Systems" zone renamed to "Nexus Select Zone"
- All references updated in App.tsx type annotations and conditionals

---

## ONGOING FRDs

### FRD-020: QuantMage Block Verification
**Status**: ONGOING (manual verification)
**Priority**: Low

#### Description:
Manual verification that QuantMage import nodes are transferring correctly to Atlas Engine node structure.

#### Notes:
- User manually verifies imported strategies
- No automated implementation needed
- Track issues as they arise

---

## DEFERRED FRDs (OFF)

### FRD-011: Atlas Sponsored Systems
**Status**: OFF (Deferred)
**Priority**: High

#### What's Blocking:
- Admin systems not appearing in Atlas dropdown - root cause unclear
- Possibly related to savedBots not containing admin's bots when AdminPanel renders
- Possibly database `ownerId` mismatch
- Needs further investigation

#### Ready to Implement Once Fixed:
- Admin creates system → Tagged `[Private, Atlas Eligible]`
- Admin adds to Atlas Fund slot → Tag changes to `Atlas`
- Atlas systems appear in "News and Select Systems" card (not in Top tables)
- Atlas systems unlimited slots (expandable)

---

### FRD-022: Extended Indicator Support
**Status**: OFF (Deferred)
**Priority**: Medium

#### Current Indicators (22 total):
SMA, EMA, RSI (Wilder's), Standard Deviation, Max Drawdown, Cumulative Return, SMA of Returns, Aroon Up/Down/Oscillator, Trend Clarity, Ultimate Smoother, 13612W/U Momentum, Drawdown, Current Price, MACD Histogram, PPO Histogram

#### Proposed New Indicators:
- **RSI Variants**: Volume Weighted RSI, Laguerre RSI, RSI (SMA/EMA/Hull smoothing)
- **Moving Averages**: Hull MA, Wilders MA, Weighted MA
- **Volatility**: Bollinger Bands (Upper, Lower, %B, Bandwidth)
- **Momentum**: Rate of Change, Money Flow Index (requires volume)
- **Other**: Stochastic (Fast/Slow), ADX, ATR, OBV, CCI, Williams %R

#### Implementation Notes:
- Add to `backtest.mjs` indicator functions section
- Add to `emptyCache()` and `metricAt()` switch
- Update frontend dropdown menus in NodeCard

---

### FRD-026: Advanced Analytics Suite
**Status**: OFF (Deferred)
**Priority**: Future

#### Planned Analytics:
1. **Monte Carlo Simulation** - Randomize trade order for robustness testing
2. **K-Folds Cross Validation** - Split backtest into K periods
3. **Sub-Period Consistency** - Yearly/quarterly performance breakdown
4. **Top Concentration/Consistency** - Return from top N trades analysis
5. **Hit Rate vs Payoff Asymmetry** - Expectancy analysis
6. **Sharpe vs Benchmark (SPY)** - Information ratio
7. **Smoothness vs Randomness (MC Block=1)** - Equity curve analysis
8. **Thinning Sensitivity** - Test with subset of signals

#### Notes:
- Will add to Analyze tab as new subtab
- Consider caching results like backtests

---

### FRD-027: Tiingo API Integration & Data Pipeline
**Status**: OFF (Deferred)
**Priority**: High (when ready)

#### Current State:
- Yahoo Finance via Python `yfinance` library
- Individual Parquet files per ticker
- DuckDB queries parquet files

#### Proposed Architecture:
- **Primary Source**: Tiingo API (daily batch download)
- **Fallback**: Yahoo Finance
- **Storage**: Unified SQLite database instead of parquet files

#### Performance Optimizations:
1. LRU cache for frequently-used tickers
2. Pre-calculate common indicators on download
3. Date range indexing for fast queries
4. Incremental updates (only download new data)

---

## PENDING FRDs

### FRD-017: Payload Storage Optimization
**Status**: PENDING
**Priority**: Low (deferred until scale needed)

#### Requirements Gathered:
- Motivations: speed, space, scalability
- Storage format: industry standard, efficient, private
- Options: GZIP compression, MessagePack/CBOR, JSONB

#### Will Implement When:
- Payload sizes become a bottleneck
- Database size becomes a concern
- Performance profiling indicates need

---

### FRD-023: Separate Atlas Database
**Status**: PENDING
**Priority**: High

#### Current State:
- Atlas bots stored in same `bots` table as user bots
- Distinguished only by `visibility: 'atlas'` and `tags: ['Atlas']`
- All owned by `admin` user

#### Proposed Changes:
1. **Create new `atlas_bots` table** - Same schema but separate storage
2. **Add "Live Stats" display** - CAGR, Sharpe, MaxDD, Sortino in all bot views
3. **Click-to-sort all columns** - A-Z/Z-A for text, High-Low for numbers
4. **Add "Export JSON" button** - Admin/owner-only export
5. **Add "Open Model" button** - Opens bot in Model tab (respects IP protection)

#### Files to Modify:
- `System.app/server/db/schema.mjs` - New atlas_bots table
- `System.app/server/db/index.mjs` - CRUD for atlas_bots
- `System.app/server/index.mjs` - New API endpoints
- `System.app/src/App.tsx` - UI for Live Stats, sorting, buttons

---

### FRD-025: Atlas Zone Improvements
**Status**: PENDING
**Priority**: Medium

#### Requirements:
1. **Expandable cards** - Show full stats when expanded, keep CAGR/Sharpe/MaxDD visible collapsed
2. **"Add to Watchlist" button** - Allow users to track Atlas systems in personal watchlists
3. **Verify IP protection** - Users cannot copy or see bot code for Atlas bots

#### Files to Modify:
- `System.app/src/App.tsx` - Card expansion, buttons
- Verify `getNexusBots()` strips payload (currently at db/index.mjs lines 348-374)

---

## Summary

### What Was Done Today (2025-12-26 Session 3):
1. **FRD-021 (Model Tab UI)**: Complete UI improvements
   - Renamed "Build" tab to "Model" throughout App.tsx
   - Enlarged insert (+) button from 20px to 60px (3x larger)
   - Added subtle accent tint to node-head using CSS color-mix()
   - Fixed oversized fonts in .title-input (13px) and .inline-number (12px)
2. **FRD-024 (Nexus Rename)**: Label updates
   - "Community Nexus" tab → "Nexus"
   - "Top Nexus Systems" → "Nexus Select Zone"

### What Was Done (2025-12-26 Session 2):
1. **FRD-003 (Testing)**: Vitest framework with 34 tests for AND/OR/IF logic
2. **FRD-008 (Password Hashing)**: bcrypt with auto-migration
3. **FRD-007 (Database Migration)**: Full migration, deprecated code removed

### Files Modified Today:
- `System.app/src/App.tsx` - Tab renames (Build→Model, Community Nexus→Nexus), label updates
- `System.app/src/App.css` - Insert button sizing, node-head theming, font fixes
- `frd/FRD-STATUS-REPORT.md` - Added 8 new FRDs (FRD-020 through FRD-027)

### Pending FRDs (Next Steps):
1. **FRD-023** (Separate Atlas Database) - High priority
2. **FRD-025** (Atlas Zone Improvements) - Medium priority
3. **FRD-017** (Payload Storage Optimization) - Low priority

### Deferred FRDs (OFF - Future Implementation):
- **FRD-022**: Extended Indicators (full list to be implemented later)
- **FRD-026**: Advanced Analytics Suite (Monte Carlo, K-Folds, etc.)
- **FRD-027**: Tiingo Data Pipeline (replace Yahoo Finance)
