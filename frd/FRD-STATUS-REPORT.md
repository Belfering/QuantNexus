# FRD Status Report
Generated: 2025-12-19

## Executive Summary

**Total FRDs**: 10 active documents
**Completed**: 1 (FRD-006: Tailwind/shadcn refactor)
**In Progress**: 9 (all draft status)
**Completion Rate**: 10%

### New FRDs Added (2025-12-19)
- FRD-007: Database Architecture & Migration
- FRD-008: User Data Security Best Practices
- FRD-009: Technology Stack Selection

---

## ✅ COMPLETED FRDs

### FRD-006: Tailwind CSS + shadcn/ui Refactor
**Status**: ✅ **COMPLETE** (87% inline styles eliminated)
**Priority**: Backlog item
**Owner**: Unassigned

#### What Was Completed:
- ✅ Tailwind CSS v4 installed and configured
- ✅ shadcn/ui components installed (Button, Input, Select, Card, Table, Tabs, Alert, Badge)
- ✅ 87% of inline styles converted (168 of 193)
- ✅ All shadcn components integrated across Build, Analyze, Portfolio, Community tabs
- ✅ Dark mode support via Tailwind `dark:` variants
- ✅ Build passing with no TypeScript errors
- ✅ Code reduction: 438 lines removed (52% reduction)

#### What Remains (Optional Enhancement):
- ❌ App.css still exists (~1,250 lines) - could be further converted to Tailwind
- ⚠️ 25 dynamic inline styles remain (must stay - computed from data)
- ❌ DropdownMenu component not yet added (still using basic menus)
- ❌ Popover component not fully utilized
- ❌ ScrollArea component not installed

**Recommendation**: Mark as COMPLETE. Remaining items are optional enhancements, not requirements.

---

## 🚧 IN-PROGRESS FRDs

### FRD-001: Analyze Tab (Collapsible Bot Cards + Performance)
**Status**: 🟡 **PARTIALLY IMPLEMENTED** (~30% complete)
**Priority**: #1 (Highest)
**Owner**: Unassigned
**Dependencies**: Watchlists + backtest metrics (✅ implemented)

#### Current Implementation Status:

✅ **Implemented:**
- Tab exists as "Analyze" in navigation
- Basic bot card structure exists
- Collapsible cards with expand/collapse
- "Open in Build Tab" button functional
- Watchlist filtering dropdown present
- Basic backtest metrics display

❌ **Missing Critical Features:**
1. **Real Stats Zone**: Not implemented
   - Amount invested tracking
   - Buy/sell buttons
   - CAGR since investment
   - MaxDD since investment
2. **Historical Stats**: Incomplete
   - OOS metrics showing placeholder `0` values
   - Metrics not separated into OOS vs Hist blocks
   - Display labels still include prefixes
3. **Charts**: Not matching spec
   - Equity chart not at 75% height of Build tab
   - Log scale not enabled by default
   - Benchmark label may not match Build styling
4. **Watchlist Management**: Incomplete
   - "Add to Watchlist" button exists but flow incomplete
   - Watchlist tags with `x` remove not fully wired
   - Create new watchlist inline not implemented
5. **Correlation Tool Subtab**: Not implemented
   - No subtab exists
   - Three-column layout not present

#### Questions to Execute FRD-001:

1. **Real Stats Zone**:
   - Where should investment amount data come from? (New data model needed?)
   - Should buy/sell buttons trigger actual trades or just update local state?
   - How to calculate "CAGR since investment started" - from what date/event?

2. **OOS vs Historical Metrics**:
   - What is the source of OOS (Out-of-Sample) data? Live trading returns?
   - Should we create mock OOS data for development, or wait for live trading integration?
   - Confirm metric display order: `CAGR, MaxDD, Sharpe, Volatility` then `Win Rate, Turnover, Avg holdings, Trading days`

3. **Correlation Tool**:
   - What should the three columns actually do beyond placeholder text?
   - Is this a future phase or should it be stubbed out now?
   - Any specific calculations needed for "Beta, Correlation, Volatility weighting"?

4. **Auto-run Backtest on Expand**:
   - Should this be debounced/throttled?
   - How to handle cache invalidation?
   - What loading state to show during backtest?

---

### FRD-002: Community Tab (Watchlists View)
**Status**: 🟡 **PARTIALLY IMPLEMENTED** (~40% complete)
**Priority**: #2
**Owner**: Unassigned
**Dependencies**: Watchlists data model + backtest metrics (✅ implemented)

#### Current Implementation Status:

✅ **Implemented:**
- Community tab exists in navigation
- 4-column grid layout structure present
- "Top Community Bots" left column header
- "Personal Watchlists" right column with 2 zones
- Watchlist dropdown selectors in right zones
- Sortable table headers (Name, Tags, metrics)
- Middle placeholder text for News and Search

❌ **Missing Critical Features:**
1. **Top Community Bots Tables**: Empty
   - "Top community bots by CAGR" - no data
   - "Top community bots by Calmar Ratio" - no data
   - "Top community bots by Sharpe Ratio" - no data
   - Sortable headers present but no rows
2. **Predefined Watchlists**: Not wired
   - `BrianE`, `Best CAGR`, `Best Sharpe`, `Best CAGR/DD` not computed
3. **OOS Stats Only**:
   - Tables may show historical metrics instead of OOS
   - OOS data source unclear
4. **Community Bot Restrictions**: Not enforced
   - "Go to Build" may still appear for community bots
   - Code hiding mechanism not implemented
5. **Actions**: Incomplete
   - "Add to my watchlist" from community bots
   - "View in Analyze" routing

#### Questions to Execute FRD-002:

1. **System Watchlists Computation**:
   - How to compute `Best CAGR`, `Best Sharpe`, `Best CAGR/DD`?
   - From which bot pool? (All saved bots? Only community-marked bots?)
   - How many bots per list (top 10, 20, 50)?
   - Should these auto-update when new bots are saved?

2. **Community Bot Marking**:
   - How to mark a bot as "community" vs "private"?
   - UI for marking/unmarking?
   - Is there a `readonly` or `communityMarked` flag in the bot model?

3. **BrianE Watchlist**:
   - Is this a specific user's curated list?
   - Should it be hardcoded or dynamically fetched?

4. **News and Select Bots**:
   - What should the middle bubbles actually display?
   - External news feed integration?
   - Search functionality implementation details?

5. **OOS Data Source**:
   - Same question as FRD-001 - where do OOS metrics come from?
   - Mock data acceptable for now?

---

### FRD-003: Conditional Logic Validation (AND/IF, OR/IF)
**Status**: 🔴 **NOT STARTED** (0% complete)
**Priority**: #3
**Owner**: Unassigned
**Dependencies**: Backtesting engine integration (✅ implemented)

#### Current Implementation Status:

✅ **Baseline Exists:**
- Indicator nodes with conditions exist in Build tab
- AND/OR conditions can be added to nodes
- Backtesting engine executes strategies

❌ **Missing All Validation/Testing:**
1. No automated tests for AND/IF logic
2. No automated tests for OR/IF logic
3. No validation of nested AND/OR combinations
4. No short-circuit evaluation testing
5. No debug overlay/logging for condition evaluation
6. No inline validation warnings for misconfigured conditions

#### Questions to Execute FRD-003:

1. **Test Framework**:
   - What testing framework to use? (Jest, Vitest, Mocha?)
   - Where to place test files? (`__tests__/`, `*.test.ts`?)
   - Should tests be unit tests or integration tests?

2. **Boolean Logic Precedence**:
   - Confirm: `A OR B AND C` should evaluate as `A OR (B AND C)`?
   - Should parentheses be supported for explicit grouping?
   - How to handle complex nesting (e.g., `(A OR B) AND (C OR D)`)?

3. **Short-Circuit Evaluation**:
   - Should AND stop evaluating after first false?
   - Should OR stop evaluating after first true?
   - Any performance benchmarks needed?

4. **Debug/Inspect UI**:
   - Should condition evaluation state show in UI?
   - Tooltip with "last evaluated: true/false"?
   - Dev-mode only or production feature?
   - How to store/display evaluation history?

5. **Validation Warnings**:
   - What constitutes a "misconfigured" condition?
   - Missing ticker? Invalid metric? Empty expression?
   - Show warnings in Build tab or only during backtest?

6. **Fixtures/Test Data**:
   - Should we create sample strategies specifically for testing?
   - Need historical price data fixtures for deterministic tests?

---

### FRD-004: Custom Indicator Zone
**Status**: 🔴 **NOT STARTED** (0% complete)
**Priority**: #5
**Owner**: Unassigned
**Dependencies**: Call Node Zone UI (✅ exists), backtest metrics (✅ exists)

#### Current Implementation Status:

✅ **Prerequisites:**
- Call Node Zone exists and functional
- Build tab has space below Call Node Zone

❌ **Nothing Implemented:**
1. No Custom Indicator Zone UI
2. No custom indicator data model
3. No create/rename/delete actions
4. No reference mechanism from nodes to custom indicators
5. No indicator definition format

#### Questions to Execute FRD-004:

1. **Indicator Definition Format** (CRITICAL):
   - Formula DSL (e.g., `SMA(close, 20) > EMA(close, 50)`)?
   - Node graph (visual builder like main strategy)?
   - JavaScript/Python snippet?
   - JSON configuration?
   - **This must be decided before implementation can start**

2. **Indicator Parameters**:
   - Should indicators accept parameters (window length, ticker, etc.)?
   - How to specify required vs optional parameters?
   - Type system for parameters?

3. **Indicator Evaluation**:
   - How/when are indicators calculated?
   - Cached like built-in metrics or computed on-demand?
   - Access to same data as built-in metrics (OHLCV, volume)?

4. **Referencing Indicators**:
   - Add to existing metric dropdown in Indicator nodes?
   - Separate "Custom Indicators" dropdown?
   - Syntax for referencing (by name, by ID)?

5. **Validation & Errors**:
   - How to validate indicator definitions before use?
   - Error messages during backtest if indicator fails?
   - Warnings in Build tab for undefined/broken indicators?

6. **Scope**:
   - Per-user or shared across users?
   - Can indicators reference other custom indicators?
   - Version control or change history?

---

### FRD-005: Composer Symphony Integration
**Status**: 🔴 **NOT STARTED** (0% complete)
**Priority**: #6
**Owner**: Unassigned
**Dependencies**: None

#### Current Implementation Status:

❌ **Nothing Implemented:**
1. No integration module exists
2. No export/import functionality
3. No UI action for "Sync to Composer Symphony"
4. No adapter interface defined
5. No payload schema documented

#### Questions to Execute FRD-005:

1. **What is Composer Symphony?** (CRITICAL):
   - Is this an external service/API?
   - Internal module to be built?
   - Third-party platform?
   - **Cannot proceed without this information**

2. **Integration Type**:
   - One-way export only?
   - Two-way sync?
   - Import only?
   - Real-time updates or manual trigger?

3. **Data Mapping**:
   - How do FlowNodes map to Composer Symphony format?
   - How to handle call chains?
   - How to handle custom indicators?
   - What happens to unsupported features?

4. **Authentication**:
   - API key required?
   - OAuth flow?
   - No auth (internal only)?

5. **Error Handling**:
   - What if sync fails?
   - Retry mechanism?
   - Conflict resolution (if two-way sync)?

6. **Payload Schema**:
   - JSON format?
   - Example payload needed to design serialization
   - Versioning strategy for schema changes?

---

### FRD-004 (Backlog): Theming Toggle + Per-Profile Persistence
**Status**: 🟢 **MOSTLY IMPLEMENTED** (~80% complete)
**Priority**: #4
**Owner**: Unassigned

#### Current Implementation Status:

✅ **Implemented:**
- Light/dark theme toggle exists (based on shadcn/ui implementation)
- Theme persists via localStorage
- Dark mode CSS variables work across components
- Per-profile saved bots exist
- Login system with simulated users

⚠️ **Partially Implemented:**
- Theme toggle location may not be "next to System.app brand"
- Theme persistence may be global, not per-profile

❌ **Missing Features:**
1. **Per-Profile Theme**: Theme should restore per profile, not global
2. **Clear Data UI**: No visible "Clear saved data" control per profile
3. **Profile-Aware Storage**: Storage may not be fully scoped per profile
4. **Load Toast**: No toast on load showing saved data status

#### Questions to Execute FRD-004:

1. **Theme Toggle Location**:
   - Where exactly should it be? (Header left? Header right?)
   - Icon-only or text label?
   - Should it be prominent or subtle?

2. **Storage Implementation**:
   - Currently using localStorage - is this sufficient?
   - Need filesystem JSON instead?
   - IndexedDB for larger datasets?

3. **Profile Scoping**:
   - How to scope all state per profile?
   - Single unified storage key or multiple keys?
   - Migration path for existing data?

4. **Clear Data UI**:
   - Where to place "Clear saved data" button?
   - Settings panel? User dropdown? Admin tab?
   - Confirmation dialog wording?

5. **Data Folder Exclusion**:
   - Should we create `System.app/userData/` folder?
   - Already git-ignored or need to add to `.gitignore`?

---

### FRD-005 (Backlog): Branding (Atlas Nexus)
**Status**: 🟡 **PARTIALLY IMPLEMENTED** (~20% complete)
**Priority**: #7 (Lowest)
**Owner**: Unassigned

#### Current Implementation Status:

⚠️ **Current State:**
- Header shows "System.app" in some areas
- No "Atlas Nexus" branding visible
- Generic browser tab title
- No favicon (likely default Vite icon)

❌ **Missing All Branding:**
1. No "Atlas Nexus" in header
2. No updated document title
3. No custom favicon
4. No brand consistency across docs

#### Questions to Execute FRD-005:

1. **Brand Name Decision** (CRITICAL):
   - Use "Atlas Nexus" as primary brand?
   - Use "System.app" as primary with "Atlas Nexus" as company?
   - Use "Atlas Nexus System.app" combined?
   - **Must decide before implementing**

2. **Header Layout**:
   - "Atlas Nexus" alone?
   - "Atlas Nexus — System.app"?
   - Logo + text or text only?

3. **Favicon**:
   - Icon design needed?
   - Use initials "AN"?
   - Generic geometric shape?

4. **Tagline**:
   - Should there be a tagline?
   - Where to display it?
   - Examples: "Build. Backtest. Trade." or "Algorithmic Trading Made Visual"

5. **Scope**:
   - Update README.md?
   - Update package.json name/description?
   - Update GitHub repo description?

---

### FRD-007: Database Architecture & Migration
**Status**: 🔴 **NOT STARTED** (0% complete)
**Priority**: Critical
**Owner**: Unassigned
**Dependencies**: None

#### Summary:
Migrate user data persistence from browser localStorage to a server-side database, enabling cross-device access, proper backup/restore, and production-ready data management.

#### Key Deliverables:
1. Database schema for users, bots, watchlists, call_chains, ui_state
2. CRUD API endpoints for user data
3. Seed data management (load/clear endpoints)
4. Frontend migration from localStorage to API calls

#### Questions to Execute:
1. Should we support migration from existing localStorage data?
2. Sync strategy: automatic background sync or manual "sync" button?
3. How to handle conflicts from multiple devices?

---

### FRD-008: User Data Security Best Practices
**Status**: 🔴 **NOT STARTED** (0% complete)
**Priority**: High
**Owner**: Unassigned
**Dependencies**: FRD-007

#### Summary:
Implement security best practices for storing and managing user data, including authentication, authorization, encryption, and audit logging.

#### Key Deliverables:
1. Password hashing with bcrypt
2. JWT authentication with proper expiration
3. Authorization middleware for user data isolation
4. Rate limiting on login attempts
5. Audit logging for security events
6. Environment variable management (.env.example)

#### Questions to Execute:
1. Should we implement password reset via email?
2. Account lockout after N failed attempts?
3. Data retention policy for audit logs?

---

### FRD-009: Technology Stack Selection
**Status**: 🔴 **NOT STARTED** (0% complete)
**Priority**: High
**Owner**: Unassigned
**Dependencies**: None

#### Summary:
Evaluate and recommend technology choices for database, ORM, authentication, and hosting infrastructure.

#### Recommended Stack:
| Layer | Technology | Reason |
|-------|------------|--------|
| Database (prod) | PostgreSQL | Industry standard, JSONB support |
| Database (dev) | SQLite | Zero config, easy setup |
| ORM | Drizzle ORM | TypeScript-native, lightweight |
| Auth | Custom JWT | Simple, full control |
| Migrations | Drizzle Kit | Integrated with ORM |
| Hosting | Railway or Render | Easy full-stack deployment |

#### Questions to Execute:
1. Connection pooling for PostgreSQL?
2. Database backup automation?
3. Should we use Supabase Auth instead of custom JWT?

---

## Summary of Questions by Category

### Data Model / Architecture (11 questions)
1. Investment tracking data model for Analyze tab Real Stats
2. OOS (out-of-sample) metrics data source
3. Custom indicator definition format
4. Composer Symphony payload schema
5. Community bot marking mechanism
6. Profile-scoped storage implementation
7. System watchlists computation logic
8. Buy/sell button behavior (local vs actual trades)
9. Indicator parameter system
10. Integration adapter interface design
11. Profile theme persistence scope

### UI/UX Decisions (8 questions)
1. Chart height ratios (Analyze vs Build)
2. Correlation Tool column functionality
3. Theme toggle placement
4. Clear data button location
5. Brand name choice (Atlas Nexus vs System.app)
6. Favicon design
7. Debug overlay for condition evaluation
8. Validation warning display locations

### Implementation Details (9 questions)
1. Auto-run backtest debouncing strategy
2. Test framework selection
3. Boolean logic precedence rules
4. Short-circuit evaluation behavior
5. OOS vs Hist metric separation
6. Community bot code hiding mechanism
7. Condition evaluation history storage
8. Storage medium (localStorage/IndexedDB/filesystem)
9. Error handling for failed integrations

### External Dependencies (3 questions)
1. What is Composer Symphony? (service/API/platform)
2. Composer Symphony authentication method
3. News feed integration source

---

## Recommended Execution Order

### Phase 1: Complete Partially-Implemented Features (Weeks 1-2)
**Goal**: Bring FRD-001, FRD-002, FRD-004 to 100%

1. **FRD-004 (Theming)**: Finish per-profile theme + clear data UI
   - Low complexity, high user experience impact
   - Answers needed: Theme toggle location, storage scoping

2. **FRD-001 (Analyze Tab)**: Complete missing features
   - High priority, partially done
   - Answers needed: OOS data source, Real Stats data model, auto-run strategy

3. **FRD-002 (Community Tab)**: Wire system watchlists + OOS stats
   - Medium priority, depends on FRD-001 OOS decisions
   - Answers needed: Watchlist computation, community bot marking

### Phase 2: Add Testing & Validation (Week 3)
**Goal**: Complete FRD-003

4. **FRD-003 (Conditional Logic)**: Add comprehensive tests
   - Critical for reliability, no UI work
   - Answers needed: Test framework, boolean precedence, debug UI

### Phase 3: New Features (Weeks 4-5)
**Goal**: Implement FRD-004 (Custom Indicators)

5. **FRD-004 (Custom Indicators)**: Design + implement zone
   - High value, requires architectural decisions
   - Answers needed: **Definition format (blocking)**, evaluation strategy

### Phase 4: Integration & Polish (Week 6+)
**Goal**: FRD-005 (Composer) + FRD-005 (Branding)

6. **FRD-005 (Branding)**: Quick branding pass
   - Low complexity, cosmetic
   - Answers needed: Brand name decision

7. **FRD-005 (Composer Symphony)**: Integration
   - Depends on external system knowledge
   - Answers needed: **What is Composer Symphony? (blocking)**

---

## Critical Blockers

### Immediate Blockers (Cannot proceed without answers):
1. **OOS Data Source**: Multiple FRDs depend on this (FRD-001, FRD-002)
   - Should we mock OOS data for development?
   - When will live trading data be available?

2. **Custom Indicator Definition Format**: FRD-004 completely blocked
   - Formula DSL, node graph, JS snippet, or JSON?
   - Need architectural decision before any implementation

3. **Composer Symphony Specification**: FRD-005 completely blocked
   - What is it? External service? Internal module?
   - API documentation needed

### Design Decisions Needed:
1. Brand name: Atlas Nexus vs System.app vs combined
2. Theme toggle location in header
3. Boolean logic precedence and short-circuit rules
4. Test framework selection

---

## Files to Update Based on FRD Completion

### When Completing FRD-001:
- `System.app/src/App.tsx`: Analyze tab component
- `System.app/src/App.css` or Tailwind: Chart height adjustments
- Data model for investment tracking (new file or extend existing)

### When Completing FRD-002:
- `System.app/src/App.tsx`: Community tab component
- Data model for community bot marking
- System watchlist computation logic (new file or function)

### When Completing FRD-003:
- `System.app/src/__tests__/` (new directory)
- `System.app/src/conditionalLogic.test.ts` (new file)
- `System.app/src/App.tsx`: Add debug overlay UI

### When Completing FRD-004:
- `System.app/src/App.tsx`: Custom Indicator Zone UI
- `System.app/src/indicators.ts` (new file): Indicator engine
- `System.app/src/types.ts`: CustomIndicator type
- Data model for custom indicators

### When Completing FRD-005 (Composer):
- `System.app/src/integrations/` (new directory)
- `System.app/src/integrations/composerSymphony.ts` (new file)
- `System.app/src/App.tsx`: Sync UI action

### When Completing FRD-004 (Theming):
- `System.app/src/App.tsx`: Theme toggle location
- `System.app/src/storage.ts` or similar: Profile-scoped persistence
- `System.app/src/App.tsx`: Clear data UI

### When Completing FRD-005 (Branding):
- `System.app/src/App.tsx`: Header brand text
- `System.app/index.html`: Document title, favicon
- `README.md`: Brand references
- `System.app/package.json`: Name, description
