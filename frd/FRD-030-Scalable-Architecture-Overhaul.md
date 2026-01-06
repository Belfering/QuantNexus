# FRD-030: Scalable Architecture Overhaul

## Metadata
- **ID**: FRD-030
- **Title**: Scalable Architecture Overhaul
- **Status**: IN PROGRESS
- **Priority**: Critical (Infrastructure)
- **Owner**: System
- **Created**: 2025-01-03
- **Last Updated**: 2026-01-05 (Phase 2N-25 COMPLETED - React hooks/purity fixes)
- **Depends On**: FRD-028 (Development Workflow)

---

## Executive Summary

This FRD covers a comprehensive overhaul of System Block Chain to support 500+ concurrent users. It includes:

1. **Codebase Restructure** - From monolithic to feature-based architecture
2. **Data Pipeline** - IndexedDB client caching + delta updates
3. **Server Caching** - Redis for shared indicator/backtest cache
4. **Database Migration** - SQLite to PostgreSQL
5. **Security Hardening** - Rate limiting, validation, auth improvements
6. **Nexus Optimization** - Pre-computed correlations

---

## Problem Statement

### Current Pain Points

| Issue | Impact | Root Cause |
|-------|--------|------------|
| Slow data loading | Users wait 30+ seconds on cold start | No persistent client cache |
| Redundant calculations | Same indicators computed repeatedly | No cross-backtest cache |
| No shared cache | Each server instance has own memory | No Redis |
| Scale limits | SQLite can't handle concurrent writes | Wrong database for scale |
| Monolithic code | Hard to maintain, slow agent context | 3000+ line files |
| Nexus slowness | Correlations computed on every request | No pre-computation |

### Current Architecture

```
System.app/
├── src/
│   └── App.tsx                 ← 20,945 lines, everything mixed
├── server/
│   └── index.mjs               ← 3500+ lines, all endpoints
└── (SQLite, in-memory cache, no Redis)
```

---

## Goals

1. **Performance**: Cold start < 1 second, backtest < 100ms
2. **Scale**: Support 500+ concurrent users
3. **Maintainability**: Feature-based structure, small focused files
4. **Agent-Friendly**: Clear boundaries for AI agents to work independently
5. **Security**: Rate limiting, input validation, proper auth

## Non-Goals

1. Microservices architecture (overkill for current scale)
2. Real-time data streaming (EOD data is sufficient)
3. Mobile app (web-only for now)
4. Multi-region deployment (single region is fine)

---

## Target Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           USER'S BROWSER                                │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  IndexedDB: Persistent ticker data (survives refresh)          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    RAILWAY SERVERS (2-3 replicas)                       │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Express API + Feature-based routes                             │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
              ┌──────────┐  ┌──────────┐  ┌──────────────┐
              │  Redis   │  │ Postgres │  │ Parquet Files│
              │ (Cache)  │  │ (Data)   │  │ (Source)     │
              └──────────┘  └──────────┘  └──────────────┘
```

### Codebase Structure (Feature-Based)

```
System.app/
│
├── src/                              # FRONTEND
│   │
│   ├── features/                     # Feature modules
│   │   │
│   │   ├── builder/                  # System tree builder
│   │   │   ├── README.md             # Feature overview for agents
│   │   │   ├── index.ts              # Barrel export
│   │   │   ├── types.ts              # FlowNode, BlockKind, etc.
│   │   │   ├── components/
│   │   │   │   ├── NodeCard.tsx
│   │   │   │   ├── AddNodeMenu.tsx
│   │   │   │   ├── ConditionEditor.tsx
│   │   │   │   ├── PositionSelector.tsx
│   │   │   │   └── TreeRenderer.tsx
│   │   │   ├── hooks/
│   │   │   │   ├── useTreeState.ts   # Tree, history, undo/redo
│   │   │   │   └── useClipboard.ts
│   │   │   └── utils/
│   │   │       ├── treeOperations.ts # replaceSlot, deleteNode, etc.
│   │   │       └── nodeFactory.ts    # createNode, cloneNode
│   │   │
│   │   ├── backtest/                 # Backtest & charts
│   │   │   ├── README.md
│   │   │   ├── index.ts
│   │   │   ├── types.ts
│   │   │   ├── components/
│   │   │   │   ├── EquityChart.tsx
│   │   │   │   ├── MetricsTable.tsx
│   │   │   │   ├── BacktestControls.tsx
│   │   │   │   └── SanityReport.tsx
│   │   │   └── hooks/
│   │   │       └── useBacktest.ts
│   │   │
│   │   ├── watchlist/                # Saved systems
│   │   │   ├── README.md
│   │   │   ├── index.ts
│   │   │   ├── components/
│   │   │   │   ├── WatchlistPanel.tsx
│   │   │   │   ├── BotCard.tsx
│   │   │   │   └── WatchlistSelector.tsx
│   │   │   └── hooks/
│   │   │       └── useWatchlist.ts
│   │   │
│   │   ├── nexus/                    # Community/sharing
│   │   │   ├── README.md
│   │   │   ├── index.ts
│   │   │   ├── components/
│   │   │   │   ├── NexusBrowser.tsx
│   │   │   │   ├── CorrelationMatrix.tsx
│   │   │   │   └── PortfolioBuilder.tsx
│   │   │   └── hooks/
│   │   │       ├── useNexus.ts
│   │   │       └── useCorrelation.ts
│   │   │
│   │   ├── data/                     # Ticker data management
│   │   │   ├── README.md
│   │   │   ├── index.ts
│   │   │   ├── tickerCache.ts        # IndexedDB operations
│   │   │   ├── deltaSync.ts          # Fetch only new data
│   │   │   └── hooks/
│   │   │       └── useTickerData.ts
│   │   │
│   │   └── auth/                     # Authentication
│   │       ├── README.md
│   │       ├── index.ts
│   │       ├── components/
│   │       │   ├── LoginForm.tsx
│   │       │   └── RegisterForm.tsx
│   │       ├── hooks/
│   │       │   └── useAuth.ts
│   │       └── context/
│   │           └── AuthProvider.tsx
│   │
│   ├── shared/                       # Cross-feature shared code
│   │   ├── components/
│   │   │   ├── Button.tsx
│   │   │   ├── Modal.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── Tooltip.tsx
│   │   │   ├── ErrorBoundary.tsx
│   │   │   └── LoadingSpinner.tsx
│   │   ├── hooks/
│   │   │   ├── useLocalStorage.ts
│   │   │   └── useDebounce.ts
│   │   └── utils/
│   │       ├── formatters.ts
│   │       └── validators.ts
│   │
│   ├── App.tsx                       # Just wiring (~100-200 lines)
│   ├── main.tsx                      # Entry point
│   └── styles/
│       └── globals.css
│
├── server/                           # BACKEND
│   │
│   ├── features/                     # Feature modules
│   │   │
│   │   ├── bots/                     # Bot CRUD
│   │   │   ├── README.md
│   │   │   ├── index.mjs             # Barrel export
│   │   │   ├── routes.mjs            # /api/bots/* endpoints
│   │   │   ├── service.mjs           # Business logic
│   │   │   ├── validation.mjs        # Zod schemas
│   │   │   └── types.ts
│   │   │
│   │   ├── backtest/                 # Backtest engine
│   │   │   ├── README.md
│   │   │   ├── index.mjs
│   │   │   ├── routes.mjs            # /api/bots/:id/run-backtest
│   │   │   ├── engine.mjs            # Main backtest logic
│   │   │   ├── indicators.mjs        # All indicator calculations
│   │   │   ├── priceDb.mjs           # Price database builder
│   │   │   └── cache.mjs             # Redis indicator cache
│   │   │
│   │   ├── nexus/                    # Community features
│   │   │   ├── README.md
│   │   │   ├── index.mjs
│   │   │   ├── routes.mjs            # /api/nexus/* endpoints
│   │   │   ├── correlation.mjs       # Correlation engine
│   │   │   └── service.mjs
│   │   │
│   │   ├── data/                     # Ticker data
│   │   │   ├── README.md
│   │   │   ├── index.mjs
│   │   │   ├── routes.mjs            # /api/candles/* endpoints
│   │   │   └── parquet.mjs           # DuckDB/parquet operations
│   │   │
│   │   ├── watchlist/                # Watchlist management
│   │   │   ├── README.md
│   │   │   ├── index.mjs
│   │   │   ├── routes.mjs            # /api/watchlists/* endpoints
│   │   │   └── service.mjs
│   │   │
│   │   └── auth/                     # Authentication
│   │       ├── README.md
│   │       ├── index.mjs
│   │       ├── routes.mjs            # /api/auth/* endpoints
│   │       ├── middleware.mjs        # Auth middleware
│   │       └── service.mjs
│   │
│   ├── jobs/                         # Cron jobs
│   │   ├── index.mjs                 # Cron entry point
│   │   ├── download-data.mjs         # Nightly parquet download
│   │   ├── prewarm-indicators.mjs    # Dynamic indicator pre-warming
│   │   └── prewarm-correlations.mjs  # Correlation matrix pre-compute
│   │
│   ├── lib/                          # Shared utilities
│   │   ├── redis.mjs                 # Redis client wrapper
│   │   ├── db.mjs                    # Database connection (PostgreSQL)
│   │   └── logger.mjs                # Structured logging
│   │
│   ├── middleware/                   # Express middleware
│   │   ├── rateLimit.mjs             # Per-user rate limiting
│   │   ├── validation.mjs            # Request validation
│   │   ├── auth.mjs                  # Auth verification
│   │   └── errorHandler.mjs          # Global error handler
│   │
│   ├── db/                           # Database (existing, keep)
│   │   ├── index.mjs
│   │   ├── schema.ts
│   │   └── migrations/
│   │
│   └── index.mjs                     # Express app setup (slim)
│
├── railway.json                      # Cron configuration
├── drizzle.config.ts                 # Database config
└── package.json
```

---

## Data Flow

### Nightly Cron Pipeline (9 PM ET)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 1: Download Fresh Data                                    ~15 min │
│  server/jobs/download-data.mjs                                          │
│  • Run download.py for all tickers in tickers.txt                       │
│  • Yahoo Finance → parquet files                                        │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 2: Clear Stale Cache                                       ~1 sec │
│  • Redis: DEL indicator:* candles:* backtest:*                          │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 3: Scan All Bots in Database                               ~5 sec │
│  server/jobs/prewarm-indicators.mjs                                     │
│  • Query all bots from PostgreSQL                                       │
│  • Extract unique (ticker, indicator, period) from conditions           │
│  • Extract position tickers                                             │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 4: Pre-Compute Indicators                                 ~60 sec │
│  • For each (ticker, indicator, period):                                │
│    - Load closes from parquet                                           │
│    - Compute indicator series (RSI, SMA, etc.)                          │
│    - Store in Redis: SET indicator:SPY:RSI:14 "[...]" EX 86400          │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 5: Pre-Compute Correlations                               ~30 sec │
│  server/jobs/prewarm-correlations.mjs                                   │
│  • Get all Nexus bots                                                   │
│  • For each pair, compute correlation                                   │
│  • Store in nexus_correlations table                                    │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  COMPLETE @ ~9:05 PM ET                                                 │
│  All users get instant results tomorrow                                 │
└─────────────────────────────────────────────────────────────────────────┘
```

### User Backtest Flow

```
User clicks "Run Backtest"
         │
         ▼
┌─────────────────────────────┐
│ POST /api/bots/:id/run-backtest
│ server/features/backtest/routes.mjs
└─────────────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│ Check Redis backtest cache  │
│ GET backtest:botId:hash     │
│ HIT? → Return cached result │
└─────────────────────────────┘
         │ (MISS)
         ▼
┌─────────────────────────────┐
│ Load price data from Redis  │
│ GET candles:SPY, candles:QQQ│
│ (Pre-warmed by cron)        │
└─────────────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│ Get indicators from Redis   │
│ GET indicator:SPY:RSI:14    │
│ (Pre-warmed by cron)        │
└─────────────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│ Run backtest engine         │
│ Walk tree day-by-day        │
│ Evaluate conditions         │
│ Build equity curve          │
└─────────────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│ Cache result in Redis       │
│ Store equity in PostgreSQL  │
│ Return to user              │
└─────────────────────────────┘
```

---

## Database: PostgreSQL Migration

### Why PostgreSQL (Even with Redis + Vertical Scaling)

| Benefit | Description |
|---------|-------------|
| **JSONB for Payloads** | Query bots by content: "Find all bots using RSI(14)" |
| **Cron Job Separation** | Background jobs connect via network, no file locks |
| **Time-Series Optimization** | Better indexing and aggregations for equity curves |
| **Observability** | `pg_stat_statements` shows slow queries |
| **Managed Backups** | Railway handles automatic backups |
| **Partial Indexes** | Index only Nexus bots for fast leaderboard queries |
| **Materialized Views** | Database-level caching for correlation matrix |
| **Stronger ACID** | Better transaction isolation for financial data |
| **Future Extensions** | `pgvector` for AI, `timescaledb` for time-series |

**Cost**: ~$5-10/month on Railway

### Drizzle ORM Migration

Already installed: `drizzle-orm`, `pg`, `@types/pg`

**Schema changes** (`server/db/schema.ts`):

```typescript
// BEFORE (SQLite)
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

export const bots = sqliteTable('bots', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id'),
  payload: text('payload'),  // JSON as text
  // ...
})

// AFTER (PostgreSQL)
import { pgTable, text, serial, real, jsonb, timestamp } from 'drizzle-orm/pg-core'

export const bots = pgTable('bots', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id'),
  payload: jsonb('payload'),  // Native JSONB - queryable!
  // ...
})
```

**Connection changes** (`server/db/index.mjs`):

```javascript
// BEFORE
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
const sqlite = new Database('./data/atlas.db')
export const db = drizzle(sqlite, { schema })

// AFTER
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
export const db = drizzle(pool, { schema })
```

**Queries stay the same** - Drizzle handles SQL dialect differences:

```typescript
// Works identically on SQLite and PostgreSQL
const userBots = await db.select()
  .from(bots)
  .where(eq(bots.ownerId, userId))
  .orderBy(desc(bots.createdAt))
```

### New PostgreSQL-Specific Features

**JSONB queries for bot payloads:**
```typescript
// Find bots using specific indicator (PostgreSQL only)
const rsiBot = await db.execute(sql`
  SELECT * FROM bots
  WHERE payload @> '{"conditions": [{"text": "RSI"}]}'
`)
```

**Partial index for Nexus leaderboard:**
```sql
CREATE INDEX idx_nexus_leaderboard ON bots(cagr DESC)
WHERE visibility = 'nexus';
```

**Materialized view for correlations:**
```sql
CREATE MATERIALIZED VIEW nexus_correlation_matrix AS
SELECT
  b1.id as bot1_id,
  b2.id as bot2_id,
  calculate_correlation(b1.equity_curve, b2.equity_curve) as correlation
FROM bots b1
CROSS JOIN bots b2
WHERE b1.visibility = 'nexus' AND b2.visibility = 'nexus';

-- Refresh nightly after cron
REFRESH MATERIALIZED VIEW CONCURRENTLY nexus_correlation_matrix;
```

### New Table: nexus_correlations

```sql
CREATE TABLE nexus_correlations (
  id SERIAL PRIMARY KEY,
  bot1_id TEXT NOT NULL,
  bot2_id TEXT NOT NULL,
  correlation REAL NOT NULL,
  period TEXT DEFAULT 'full',  -- 'full', '1y', '3y', '5y'
  computed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(bot1_id, bot2_id, period)
);

CREATE INDEX idx_corr_lookup ON nexus_correlations(bot1_id, bot2_id, period);
```

### Environment-Based Database Selection

```javascript
// server/lib/db.mjs
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres'
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3'
import pg from 'pg'
import Database from 'better-sqlite3'
import * as schema from '../db/schema.mjs'

export const db = process.env.DATABASE_URL
  ? drizzlePg(new pg.Pool({ connectionString: process.env.DATABASE_URL }), { schema })
  : drizzleSqlite(new Database('./data/atlas.db'), { schema })
```

**Local dev**: SQLite (no setup needed)
**Production**: PostgreSQL (Railway provides `DATABASE_URL`)

### admin-data.json → Database Migration

Currently `admin-data.json` stores user balances, treasury, and config as a flat file. This is risky for financial data.

**Move to PostgreSQL:**

```sql
-- New tables for admin-data.json content

CREATE TABLE app_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE treasury (
  id SERIAL PRIMARY KEY,
  balance REAL NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE treasury_entries (
  id SERIAL PRIMARY KEY,
  amount REAL NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE user_balances (
  user_id TEXT PRIMARY KEY,
  total_value REAL DEFAULT 0,
  total_invested REAL DEFAULT 0,
  investment_count INTEGER DEFAULT 0,
  invested_atlas REAL DEFAULT 0,
  invested_nexus REAL DEFAULT 0,
  invested_private REAL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Migration script:**
```javascript
// scripts/migrate-admin-data.mjs
import adminData from '../ticker-data/admin-data.json'

// Migrate config
await db.insert(appConfig).values({
  key: 'atlas_settings',
  value: adminData.config
})

// Migrate treasury
await db.insert(treasury).values({
  balance: adminData.treasury.balance
})

// Migrate user balances
for (const [userId, summary] of Object.entries(adminData.userSummaries)) {
  await db.insert(userBalances).values({
    userId,
    ...summary
  })
}
```

---

## Data Migration Strategy: Fresh Start

Given only a few users, fresh start is cleanest approach.

### What Happens to Existing Data

| Data | Action | Reason |
|------|--------|--------|
| **Users** | Fresh start | Re-invite few users, clean slate |
| **Bots/Strategies** | Export to JSON | Users can re-import their strategies |
| **Watchlists** | Recreate | Low effort, user creates again |
| **Equity curves** | Regenerate | Backtests will recreate these |
| **Backtest cache** | Discard | Redis handles this now |
| **admin-data.json config** | Migrate | Keep atlas settings, fund slots |
| **admin-data.json balances** | Fresh start | Users start with clean balances |

### Bot Export (Before Migration)

```javascript
// scripts/export-bots.mjs
// Run this BEFORE migration to let users save their strategies

const bots = await db.select().from(botsTable)

for (const bot of bots) {
  const filename = `exports/${bot.ownerId}/${bot.name}.json`
  await fs.writeFile(filename, JSON.stringify(bot.payload, null, 2))
}

console.log(`Exported ${bots.length} bots`)
```

Users can then re-import their strategies via the UI after migration.

---

## Redis Cache Schema

| Key Pattern | Value | TTL | Purpose |
|-------------|-------|-----|---------|
| `candles:{ticker}` | JSON array of OHLC | 24h | Pre-warmed ticker data |
| `indicator:{ticker}:{type}:{period}` | JSON array of values | 24h | Pre-warmed indicators |
| `backtest:{botId}:{hash}` | JSON backtest result | 24h | Cached backtest results |
| `session:{userId}` | JSON session data | 1h | User sessions |

---

## Implementation Phases

### Phase 0: Setup (Day 1) ✅ COMPLETE
- [x] Create folder structure
- [x] Set up path aliases in tsconfig
- [x] Install new dependencies (ioredis, zod, pg, express-rate-limit)
- [x] Create README.md template for features

### Phase 1: Backend Restructure (Days 2-4) ✅ COMPLETE
- [x] Create `server/lib/` utilities (config, duckdb, logger, jobs)
- [x] Extract `server/features/auth/` from index.mjs
- [x] Extract `server/features/bots/` from index.mjs
- [x] Extract `server/features/data/` from index.mjs
- [ ] Extract `server/features/backtest/` from backtest.mjs (deferred)
- [x] Extract `server/features/nexus/` from index.mjs + correlation.mjs
- [x] Extract `server/features/watchlist/` from index.mjs
- [x] Slim down index.mjs to just route wiring
- [x] Add middleware (validation, errorHandler)
- [x] Test all endpoints still work

### Phase 2: Frontend Restructure 🔄 IN PROGRESS

**NOTE: App.tsx is 20,945 lines (not 832 as originally estimated). This phase is broken into sub-phases.**

#### Phase 2A: Foundation ✅ COMPLETE
- [x] Extract types to `src/types/`
- [x] Extract constants (indicators, themes) to `src/constants/`
- [x] Create `src/shared/` utilities and components

#### Phase 2B: Builder Utils ✅ COMPLETE
- [x] Extract `builder/utils/treeOperations.ts`
- [x] Extract `builder/utils/nodeFactory.ts`
- [x] Extract `builder/utils/helpers.ts`

#### Phase 2C: Backtest Utils ✅ COMPLETE
- [x] Extract `backtest/utils/metrics.ts`
- [x] Extract `backtest/utils/compression.ts`
- [x] Extract `backtest/utils/downloads.ts`
- [x] Extract `backtest/utils/validation.ts`
- [x] Extract `backtest/components/BacktestModeDropdown.tsx`

#### Phase 2D: Watchlist Feature ✅ COMPLETE
- [x] Extract `watchlist/api/index.ts` (API functions)
- [x] Extract `watchlist/utils/helpers.ts`
- [x] Extract `watchlist/hooks/useWatchlist.ts`

#### Phase 2E: Builder Components ✅ COMPLETE
- [x] Extract `builder/components/InsertMenu.tsx`
- [x] Extract `builder/components/NodeCard/` - All sub-components
  - NodeCard.tsx, NodeHeader.tsx, DefaultBody.tsx, IndicatorBody.tsx
  - PositionBody.tsx, NumberedBody.tsx, AltExitBody.tsx, ScalingBody.tsx
  - CallReferenceBody.tsx, buildLines.ts, types.ts
- [x] Extract `builder/components/WeightPicker.tsx`
- [x] Extract `builder/components/WeightDetailChip.tsx`
- [x] Extract `builder/components/IndicatorDropdown.tsx`
- [x] Extract `builder/components/ConditionEditor.tsx`
- [x] Extract `builder/components/ColorPicker.tsx`
- [x] Extract `builder/hooks/useTreeState.ts`
- [x] Extract `builder/hooks/useClipboard.ts`
- [x] Extract `builder/hooks/useNodeCallbacks.ts`

#### Phase 2F: Backtest Components ✅ COMPLETE
- [x] `backtest/components/EquityChart.tsx`
- [x] `backtest/components/DrawdownChart.tsx`
- [x] `backtest/components/RangeNavigator.tsx`
- [x] `backtest/components/AllocationChart.tsx`
- [x] `backtest/components/MonthlyHeatmap.tsx`
- [x] `backtest/components/BacktesterPanel.tsx`
- [x] `backtest/utils/chartHelpers.ts`

#### Phase 2G: Dashboard Components ✅ COMPLETE
- [x] `dashboard/components/DashboardEquityChart.tsx`
- [x] `dashboard/components/PartnerTBillChart.tsx`
- [x] `dashboard/types.ts`
- [x] `dashboard/index.ts`

#### Phase 2H: Admin Features ✅ COMPLETE
- [x] `admin/components/AdminDataPanel.tsx`
- [x] `admin/components/AdminPanel.tsx`
- [x] `admin/components/DatabasesPanel.tsx`
- [x] `admin/types.ts`
- [x] `admin/index.ts`

#### Phase 2I: Recent Extractions ✅ COMPLETE
- [x] `features/bots/api/index.ts` - Bot CRUD API functions (~200 lines)
- [x] `features/data/utils/importParsers.ts` - Composer/QuantMage parsers (~660 lines)
- [x] `shared/components/TickerSearchModal.tsx` - Ticker search modal (~180 lines)
- [x] `shared/utils/ticker.ts` - Ticker normalization utilities (~30 lines)
- [x] `features/backtest/utils/indicators.ts` - All rolling indicator functions (~540 lines)

**Current App.tsx: 3,505 lines (down from ~21,000 original, 9,392 at start of Phase 2N)**

#### Phase 2J: Backtest Engine Extraction ✅ COMPLETE

**2J-1: EvalCtx and Metric Functions**
- [x] `backtest/engine/evalContext.ts` - EvalCtx type, metricAtIndex, metricAt functions

**2J-2: Condition Evaluation**
- [x] `backtest/engine/conditions.ts` - conditionExpr, evalConditionAtIndex, evalCondition, evalConditions

**2J-3: Trace Collector**
- [x] `backtest/engine/traceCollector.ts` - createBacktestTraceCollector

**2J-4: Allocation Functions**
- [x] `backtest/engine/allocation.ts` - volForAlloc, weightChildren, turnoverFraction

**2J-5: Node Evaluation**
- [x] `backtest/engine/evaluator.ts` - evaluateNode
- [x] `backtest/engine/traceContributions.ts` - tracePositionContributions

**2J-6: Engine Barrel Export**
- [x] `backtest/engine/index.ts` - Export all engine functions

#### Phase 2K: Nexus Feature ✅ COMPLETE

**2K-1: Nexus API**
- [x] `nexus/api/index.ts` - optimizeCorrelation, getCorrelationRecommendations (~124 lines)

**2K-2: Nexus Hooks**
- [x] `nexus/hooks/useCorrelation.ts` - Full correlation state, effects, and actions (~299 lines)
- [x] `nexus/index.ts` - Barrel export (~26 lines)

**App.tsx Integration:**
- [x] Import from `'./features/nexus'`
- [x] Hook call: `const correlation = useCorrelation({ savedBots, allNexusBots, analyzeBacktests })`
- [x] Updated ~30 JSX references to use `correlation.*` pattern

**Net reduction: ~190 lines from App.tsx**

#### Phase 2L: Auth Feature ✅ COMPLETE

**2L-1: Auth Hook**
- [x] `auth/hooks/useAuth.ts` - Auth state management (~260 lines)
  - userId, userRole, userDisplayName state
  - isAdmin, hasEngineerAccess derived values
  - login(), logout() actions
  - Display name editing (input, save, availability check)
- [x] `auth/index.ts` - Barrel export (~13 lines)

**App.tsx Integration:**
- [x] Import from `'./features/auth'`
- [x] Hook call: `const auth = useAuth()`
- [x] Destructure: `{ userId, userDisplayName, isAdmin, hasEngineerAccess }`
- [x] Updated displayName UI to use `auth.*` pattern
- [x] Wrapper functions for handleLogin/handleLogout (App-specific state reset)

**Net reduction: ~110 lines from App.tsx**

#### Phase 2M: Data/Import Feature (⬜ PENDING)

**2M-1: Client-Side Caching (new)**
- [ ] `data/tickerCache.ts` - IndexedDB operations
- [ ] `data/deltaSync.ts` - Fetch only new data since last sync

**2M-2: Data Hooks**
- [ ] `data/hooks/useTickerData.ts` - Load/cache ticker data

#### Phase 2N: Tab Extraction + Code Splitting 🔄 IN PROGRESS

**Goal**: App.tsx → ~4,000 lines, Bundle → ~1,100 KB initial load

**Approach**: React.lazy + minimal context (props for most state)

**2N-1: Create AppContext** ✅ COMPLETE
- [x] `src/context/AppContext.tsx` - Minimal context (auth only)
- [x] `src/context/index.ts` - Barrel export
- Note: Simplified to auth-only context. Other state passed as props to tabs.

**2N-2: Extract Dashboard Hook** ✅ COMPLETE
- [x] `features/dashboard/hooks/useDashboardInvestments.ts` - Investment actions (~500 lines)
- Note: Refactored to accept params instead of using context (more flexible)

**2N-3: Extract Tab Components + Lazy Loading**
| Tab | Status | File | Chunk Size |
|-----|--------|------|------------|
| Admin | ✅ Fully integrated | `src/tabs/AdminTab.tsx` | 124 KB |
| Databases | ✅ Fully integrated | `src/tabs/DatabasesTab.tsx` | 11 KB |
| Nexus | ✅ Fully integrated | `src/tabs/NexusTab.tsx` + `features/nexus/components/NexusPanel.tsx` | 29 KB |
| Dashboard | ✅ Fully integrated | `src/tabs/DashboardTab.tsx` + `features/dashboard/components/DashboardPanel.tsx` | 91 KB |
| Analyze | ✅ Fully integrated | `src/tabs/AnalyzeTab.tsx` + `features/analyze/components/AnalyzePanel.tsx` | 123 KB |
| Help | ✅ Fully integrated | `src/tabs/HelpTab.tsx` | 12 KB |
| Model | ✅ Fully integrated | `src/tabs/ModelTab.tsx` | 200 KB |

**Results (as of 2026-01-05):**
- App.tsx: 9,392 → 3,505 lines (-5,887 lines from start of Phase 2N, **63% reduction**)
- Main bundle: 925 KB (gzip: 241 KB) - down from 1,279 KB (-28%)
- Lazy-loaded chunks:
  - AdminTab: 124 KB (gzip: 16 KB)
  - DatabasesTab: 11 KB (gzip: 3 KB)
  - NexusTab: 29 KB (gzip: 5 KB)
  - DashboardTab: 91 KB (gzip: 12 KB)
  - AnalyzeTab: 123 KB (gzip: 14 KB)
  - HelpTab: 12 KB (gzip: 3 KB)
  - ModelTab: 200 KB (gzip: 31 KB)
- All tabs lazy loaded
- Correlation hook extracted to `features/nexus/hooks/useCorrelation.ts`
- Duplicate backtest engine code removed (~850 lines)
- Ticker search utilities extracted to `features/builder/utils/tickerSearch.ts`
- Tree store with zundo extracted to `stores/useTreeStore.ts` (Phase 2N-15)

**2N-4: Configure Vite Chunking** ⏳ PENDING
```ts
// vite.config.ts - optional, only if more splitting needed
manualChunks: {
  'charts': ['lightweight-charts'],
  'flowchart': ['reactflow'],
  'indicators': ['technicalindicators'],
}
```

**2N-5: API Function Consolidation** ✅ COMPLETE
- [x] Move watchlist API functions to `features/bots/api/watchlists.ts`
- [x] Move preferences API functions to `features/auth/api/preferences.ts`
- [x] Import `calculateInvestmentPnl` from `features/dashboard`
- [x] Import `findNode`, `expandToNode` from `features/builder`
- Result: App.tsx 9,474 → 9,261 lines (-213 lines)

**2N-6: Extract Remaining Tabs** ⏳ IN PROGRESS

Pattern established with Nexus extraction - apply same pattern to remaining tabs:

**Step-by-step for each tab:**
1. Create `src/features/{feature}/components/{Tab}Panel.tsx` with props interface
2. Create `src/features/{feature}/components/index.ts` barrel export
3. Update `src/features/{feature}/index.ts` to export component
4. Create `src/tabs/{Tab}Tab.tsx` thin wrapper
5. Add lazy import in App.tsx: `const {Tab}Tab = lazy(() => import('./tabs/{Tab}Tab'))`
6. Replace inline JSX with `<Suspense><{Tab}Tab {...props} /></Suspense>`
7. Remove unused types/imports from App.tsx

**Dashboard Tab** ✅ COMPLETE
- [x] Create `features/dashboard/components/DashboardPanel.tsx`
- [x] Create `src/tabs/DashboardTab.tsx`
- [x] Uses `useDashboardInvestments` hook internally
- Actual reduction: ~1,700 lines from App.tsx

**Analyze Tab** ✅ COMPLETE
- [x] Create `features/analyze/` feature folder
- [x] Create `features/analyze/components/AnalyzePanel.tsx` with subtab components:
  - `OverviewTabContent.tsx` - Live stats, equity charts, historical stats
  - `AdvancedTabContent.tsx` - Benchmarks comparison table
  - `RobustnessTabContent.tsx` - Fragility fingerprints, drawdown probabilities
- [x] Create `src/tabs/AnalyzeTab.tsx`
- [x] Integrated `useCorrelation` hook from `features/nexus`
- [x] Removed duplicate correlation state management from App.tsx
- Actual reduction: ~1,800 lines from App.tsx

**Model Tab** ✅ COMPLETE
- [x] Created `src/tabs/ModelTab.tsx` thin wrapper
- [x] Model tab remains tightly coupled to builder state (by design)
- [x] Uses props pattern for state injection
- Actual chunk size: 200 KB

**Help Tab** ✅ COMPLETE
- [x] Created `src/tabs/HelpTab.tsx` with full settings + changelog
- [x] Mostly static content with minimal props
- Actual chunk size: 12 KB

**Current State (after Phase 2N-15):**
- App.tsx: 3,505 lines (down from ~21,000 original, **83% reduction**)
- All 7 tabs lazy-loaded
- Main bundle: 925 KB (gzip: 241 KB)
- Duplicate code eliminated
- Pure functions extracted to feature modules
- OHLC API, preferences API, watchlist API fully extracted
- Tree store with zundo for automatic undo/redo
- ModelTab uses useTreeStore directly for all tree operations

#### Phase 2N-7: Integrate Remaining Tab Wrappers ✅ COMPLETE
All tabs integrated and lazy-loaded:
1. Add lazy import: `const XxxTab = lazy(() => import('./tabs/XxxTab'))`
2. Replace inline JSX with `<Suspense><XxxTab {...props} /></Suspense>`
3. Delete inline code

| Tab | Inline Lines | Status |
|-----|-------------|--------|
| Nexus | ~752 | ✅ COMPLETE (2026-01-05) |
| Dashboard | ~1,689 | ✅ COMPLETE (2026-01-05) |
| Admin | ~24 | ✅ COMPLETE (2026-01-05) |
| Databases | ~12 | ✅ COMPLETE (2026-01-05) |
| Help | ~200 | ✅ COMPLETE (2026-01-05) |
| Model | ~618 | ✅ COMPLETE (2026-01-05) |

#### Phase 2N-11: Duplicate Code Removal + Extractions ✅ COMPLETE

Removed duplicate code from App.tsx that already existed in features/ modules:

**Duplicate Backtest Engine Code (~850 lines)**
- [x] Removed duplicate `metricAtIndex`, `metricAt` - already in `features/backtest/engine/evalContext.ts`
- [x] Removed duplicate `evalCondition`, `evalConditions` - already in `features/backtest/engine/conditions.ts`
- [x] Removed duplicate `evaluateNode` - already in `features/backtest/engine/evaluator.ts`
- [x] Removed duplicate `tracePositionContributions` - already in `features/backtest/engine/traceContributions.ts`
- [x] Removed duplicate `turnoverFraction` - already in `features/backtest/engine/allocation.ts`
- [x] Removed duplicate `createBacktestTraceCollector` - already in `features/backtest/engine/traceCollector.ts`

**Duplicate Input Collection Functions (~200 lines)**
- [x] Removed duplicate `collectBacktestInputs` - already in `features/backtest/utils/inputCollection.ts`
- [x] Removed duplicate `collectPositionTickers` - already in `features/backtest/utils/inputCollection.ts`
- [x] Removed duplicate `isEtfsOnlyBot` - already in `features/backtest/utils/inputCollection.ts`
- [x] Removed duplicate `collectIndicatorTickers` - already in `features/backtest/utils/inputCollection.ts`

**New Extractions**

*Ticker Search Utilities → `features/builder/utils/tickerSearch.ts` (~330 lines)*
- [x] `findTickerInstances` - Find all instances of a ticker in tree
- [x] `collectUsedTickers` - Collect unique tickers for Find/Replace
- [x] `collectEnabledConditions` - Collect enabled conditions for overlay
- [x] `replaceTickerInTree` - Replace all ticker instances in tree

*Backtest Normalization → `features/backtest/utils/normalization.ts` (~55 lines)*
- [x] `normalizeConditions` - Normalize condition array for backtest
- [x] `normalizeNodeForBacktest` - Recursively normalize nodes

*Also removed:*
- [x] `findNode` duplicate (already in `features/builder/utils/treeOperations.ts`)
- [x] Unused imports: `SLOT_ORDER`, `normalizeComparatorChoice`, `ConditionLine`, etc.

**Result: App.tsx 6,358 → 4,580 lines (-1,778 lines, -28%)**

#### Phase 2N-12: Remaining Pure Function Extractions ✅ COMPLETE

Functions in App.tsx that have no React state dependencies - now moved to feature modules:

**OHLC Fetching → `features/data/api/ohlc.ts` (~115 lines)**
- [x] `fetchOhlcSeries` - Fetch OHLC data for single ticker
- [x] `fetchOhlcSeriesBatch` - Batch fetch OHLC data with caching
- [x] `ohlcDataCache` - Module-level Map cache

**Price DB Builder → `features/backtest/utils/priceDb.ts` (~75 lines)**
- [x] `buildPriceDb` - Build PriceDB object from OHLC data

**Watchlist API → `features/bots/api/watchlists.ts` (~80 lines)**
- [x] `loadWatchlistsFromApi` (already extracted in Phase 2N-11, now using import)
- [x] `createWatchlistInApi` (already extracted in Phase 2N-11, now using import)
- [x] `addBotToWatchlistInApi` (already extracted in Phase 2N-11, now using import)
- [x] `removeBotFromWatchlistInApi` (already extracted in Phase 2N-11, now using import)

**Preferences API → `features/auth/api/preferences.ts` (~60 lines)**
- [x] `loadPreferencesFromApi` (already extracted in Phase 2N-11, now using import)
- [x] `savePreferencesToApi` (already extracted in Phase 2N-11, now using import)
- [x] `loadCallChainsFromApi` (already extracted in Phase 2N-11, now using import)

**Result: App.tsx 4,580 → 4,238 lines (-342 lines)**

#### Phase 2N-13: Zustand State Management ✅ COMPLETE

**Decision: Zustand over custom hooks**

Replaces Phase 2N-8/9/10 with a cleaner approach using Zustand stores instead of scattered hooks.

**Why Zustand:**
- Minimal disruption after FRD-030 refactoring
- Existing API patterns (optimistic updates) already work well
- 1:1 mental model mapping from useState
- Eliminates 107 props drilling to ModelTab
- Can add TanStack Query later if caching becomes needed
- DevTools for state debugging

**Current State (Phase 2N-15 COMPLETE):**
| Metric | Before 2N-14 | After 2N-14 | After 2N-15 | Target |
|--------|--------------|-------------|-------------|--------|
| App.tsx lines | 4,229 | 3,920 | **3,505** | ~2,500 |
| App.tsx useState calls | 51 | 18 | **18** | ~10 |
| ModelTab props | 107 | 59 | **~20** | ~15 |
| AnalyzeTab props | 45 | 15 | **15** | ~10 |
| DashboardTab props | 55 | 22 | **22** | ~15 |
| NexusTab props | 46 | 11 | **11** | ~8 |
| HelpTab props | 9 | 5 | **5** | ~5 |
| AdminTab props | 9 | 4 | **4** | ~4 |

**Note:** Phase 2N-15 complete. Tree store with zundo middleware enables automatic undo/redo. ModelTab now uses useTreeStore directly for all tree operations.

**Store Structure:**
```
src/stores/
├── index.ts              # Re-exports all stores
├── useAuthStore.ts       # userId, userRole, displayName, isAdmin (5 states)
├── useUIStore.ts         # tabs, modals, collapse states (15 states)
├── useBotStore.ts        # bots, activeBotId, clipboard, undo/redo (12 states)
├── useBacktestStore.ts   # backtestMode, results, sanityReports (12 states)
├── useDashboardStore.ts  # portfolio, buy/sell forms (27 states)
└── useTreeStore.ts       # tree state with zundo (32+ methods) [NEW in 2N-15]
```

**State → Store Mapping:**

| Store | States From | Line References |
|-------|-------------|-----------------|
| useAuthStore | userId, userRole, userDisplayName + useDisplayNameState hook | App.tsx:574-576 |
| useUIStore | tab, subtabs, collapse states, changelog | App.tsx:983-995 |
| useBotStore | bots, activeBotId, clipboard, savedBots, watchlists | App.tsx:977-985 |
| useBacktestStore | backtestMode, analyzeBacktests, sanityReports, benchmarks | App.tsx:591-628 |
| useDashboardStore | portfolio + useDashboardUIState + useCommunityState hooks | App.tsx:589, hooks |

**Migration Phases:**

| Phase | Risk | Files | Status |
|-------|------|-------|--------|
| 2N-13a: Auth Store | Low | 6 | ✅ COMPLETE |
| 2N-13b: UI Store | Low | 8 | ✅ COMPLETE |
| 2N-13c: Bot Store | Medium | 10 | ✅ COMPLETE |
| 2N-13d: Backtest Store | Medium | 6 | ✅ COMPLETE |
| 2N-13e: Dashboard Store | Medium | 5 | ✅ COMPLETE |

**Stores Created:**
- `src/stores/useAuthStore.ts` - Auth + display name editing
- `src/stores/useUIStore.ts` - Tabs, modals, collapse states, scroll
- `src/stores/useBotStore.ts` - Bot sessions, saved bots, watchlists, find/replace
- `src/stores/useBacktestStore.ts` - ETF/backtest settings, analyze state, indicator overlays
- `src/stores/useDashboardStore.ts` - Dashboard portfolio, UI state, community state

**Hooks Deleted (merged into stores):**
- `useDisplayNameState.ts` → useAuthStore
- `useTickerModal.ts` → useUIStore
- `useSaveMenu.ts` → useUIStore
- `useFindReplace.ts` → useBotStore
- `useIndicatorOverlays.ts` → useBacktestStore
- `useCommunityState.ts` → useDashboardStore
- `useDashboardUIState.ts` → useDashboardStore

**Files to Modify:**

*New Files (6):*
| File | States | Est. Lines |
|------|--------|------------|
| `src/stores/index.ts` | - | ~10 |
| `src/stores/useAuthStore.ts` | 5 | ~50 |
| `src/stores/useUIStore.ts` | 15 | ~80 |
| `src/stores/useBotStore.ts` | 12 + undo/redo | ~200 |
| `src/stores/useBacktestStore.ts` | 12 | ~100 |
| `src/stores/useDashboardStore.ts` | 27 | ~150 |

*Modified Files:*
| File | Changes |
|------|---------|
| `package.json` | Add `zustand` dependency |
| `src/App.tsx` | Remove ~41 useState, use stores, remove ~1,700 lines |
| `src/tabs/ModelTab.tsx` | Remove 82 props, use stores directly |
| `src/tabs/AnalyzeTab.tsx` | Remove ~40 props, use stores |
| `src/tabs/DashboardTab.tsx` | Remove ~30 props, use stores |
| `src/tabs/NexusTab.tsx` | Remove ~15 props, use stores |
| `src/tabs/HelpTab.tsx` | Remove ~20 props, use stores |
| `src/tabs/AdminTab.tsx` | Remove ~10 props, use stores |

*Deleted Files (hooks merged into stores):*
| Hook | Merged Into |
|------|-------------|
| `src/hooks/useDisplayNameState.ts` | useAuthStore |
| `src/hooks/useDashboardUIState.ts` | useDashboardStore |
| `src/hooks/useCommunityState.ts` | useDashboardStore |
| `src/hooks/useTickerModal.ts` | useUIStore |
| `src/hooks/useFindReplace.ts` | useBotStore |
| `src/hooks/useIndicatorOverlays.ts` | useBacktestStore |
| `src/hooks/useSaveMenu.ts` | useUIStore |

**Example Store (useAuthStore):**
```typescript
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AuthState {
  userId: string | null
  userRole: string | null
  userDisplayName: string | null
  isAdmin: boolean
  hasEngineerAccess: boolean
  setUser: (id: string | null, role: string | null, displayName: string | null) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      userId: null,
      userRole: null,
      userDisplayName: null,
      isAdmin: false,
      hasEngineerAccess: false,
      setUser: (userId, userRole, userDisplayName) => set({
        userId,
        userRole,
        userDisplayName,
        isAdmin: ['admin', 'main_admin', 'sub_admin'].includes(userRole || ''),
        hasEngineerAccess: ['engineer', 'sub_admin', 'main_admin', 'admin'].includes(userRole || ''),
      }),
      logout: () => set({
        userId: null,
        userRole: null,
        userDisplayName: null,
        isAdmin: false,
        hasEngineerAccess: false,
      }),
    }),
    { name: 'auth-storage' }
  )
)
```

**Example Usage in Component:**
```typescript
// BEFORE: 107 props drilled through
function ModelTab({ userId, userRole, bots, activeBotId, ... }) {
  // ...
}

// AFTER: Direct store access
function ModelTab() {
  const userId = useAuthStore(s => s.userId)
  const { bots, activeBotId } = useBotStore()
  // Only ~25 props for callbacks that truly need to be passed
}
```

**Success Metrics (Phase 2N-13):**
- [x] ModelTab props: 107 → 59 (Phase 2N-14a complete, target ~25)
- [x] App.tsx lines: 4,229 → 4,096 (-133 lines: -53 store migration, -80 ModelTab props)
- [x] useState calls in App.tsx: 51 → 24 (-27 useState calls)
- [x] All 7 extracted hooks merged into stores
- [ ] No prop drilling for userId, bots, backtest state (pending Phase 2N-14)
- [x] Build passes (`npm run build`)
- [ ] All features work (manual test)

#### Phase 2N-14: Tab Store Integration ✅ COMPLETE

**Goal:** Have tab components use Zustand stores directly instead of receiving props from App.tsx.

**Why This Matters:**
- ModelTab originally received **107 props** - most replaced with store access
- App.tsx has ~1,700 lines of prop passing that can be removed
- Tabs become self-contained and easier to maintain

**Tabs to Update:**

| Tab | Current Props | After Stores | Reduction | Status |
|-----|---------------|--------------|-----------|--------|
| ModelTab | 107 → 59 | ~25 | -48 props | ✅ Done |
| AnalyzeTab | ~45 → 15 | ~10 | -30 props | ✅ Done |
| DashboardTab | ~55 → 22 | ~15 | -33 props | ✅ Done |
| NexusTab | ~46 → 11 | ~8 | -35 props | ✅ Done |
| HelpTab | 9 → 5 | ~5 | -4 props | ✅ Done |
| AdminTab | 9 → 4 | ~4 | -5 props | ✅ Done |

**Migration Order (by impact):**

| Phase | Tab | Risk | Notes |
|-------|-----|------|-------|
| 2N-14a | ModelTab | High | ✅ Complete - 107 → 59 props |
| 2N-14b | AnalyzeTab | Medium | ✅ Complete - 45 → 15 props |
| 2N-14c | DashboardTab | Medium | ✅ Complete - 55 → 22 props |
| 2N-14d | NexusTab | Low | ✅ Complete - 46 → 11 props |
| 2N-14e | HelpTab | Low | ✅ Complete - 9 → 5 props |
| 2N-14f | AdminTab | Low | ✅ Complete - 9 → 4 props |

**Phase 2N-14a Complete (ModelTab):**
- Props reduced: 107 → 59 (-48 props)
- App.tsx lines: 4,176 → 4,096 (-80 lines)
- Now uses: useAuthStore, useUIStore, useBotStore, useBacktestStore
- Imported functions: collectUsedTickers, findTickerInstances, replaceTickerInTree, loadCallChainsFromApi

**Phase 2N-14b Complete (AnalyzeTab):**
- Props reduced: ~45 → 15 (-30 props, ~67% reduction)
- App.tsx lines: 4,096 → 4,034 (-62 lines)
- Added to useUIStore: nexusBuyBotId, nexusBuyAmount, nexusBuyMode + setters
- AnalyzePanel now uses: useAuthStore, useUIStore, useBotStore, useBacktestStore
- Computed values now inside AnalyzePanel: watchlistsByBotId, analyzeVisibleBotIds
- Imported directly: normalizeNodeForBacktest from @/features/backtest
- Migrated nexusBuy* from useState to useUIStore in App.tsx (shared across tabs)
- Removed from App.tsx: watchlistsByBotId, analyzeVisibleBotIds, allWatchlistedBotIds, analyzeSubtab/setAnalyzeSubtab, analyzeTickerSort/setAnalyzeTickerSort

**Phase 2N-14c Complete (DashboardTab):**
- Props reduced: ~55 → 22 (-33 props, ~60% reduction)
- App.tsx lines: 4,034 → 3,969 (-65 lines)
- DashboardPanel now uses: useAuthStore, useUIStore, useBotStore, useBacktestStore, useDashboardStore
- All dashboard form state (buy/sell/buyMore) now via useDashboardStore
- Removed from App.tsx: dashboardTimePeriod, dashboardBotExpanded, dashboardBuyBotDropdownOpen, setDashboardSubtab (UI-only state)
- Kept in App.tsx: dashboardBuy* values needed by handleDashboardBuy callback

**Phase 2N-14d Complete (NexusTab):**
- Props reduced: ~46 → 11 (-35 props, ~76% reduction)
- App.tsx lines: 3,969 → 3,926 (-43 lines)
- NexusPanel now uses all 5 stores: useAuthStore, useUIStore, useBotStore, useBacktestStore, useDashboardStore
- Community sort/search state now via useDashboardStore directly
- Removed from App.tsx: communityTopSort, communitySearchSort, atlasSort, communitySearchFilters + setters, setAddToWatchlistNewName, nexusBuyBotId, setNexusBuyMode
- Remaining props: uiState, setUiState, dashboardCash, dashboardInvestmentsWithPnl, handleNexusBuy, removeBotFromWatchlist, push, runAnalyzeBacktest, handleCopyToNew, getFundSlotForBot

**Phase 2N-14e Complete (HelpTab):**
- Props reduced: 9 → 5 (-4 props, ~44% reduction)
- App.tsx lines: 3,926 → 3,925 (-1 line)
- HelpTab now uses: useAuthStore (userId), useUIStore (helpTab)
- Derived colorTheme/theme from uiState inside component
- Remaining props: uiState, setUiState, savePreferencesToApi, changelogLoading, changelogContent

**Phase 2N-14f Complete (AdminTab):**
- Props reduced: 9 → 4 (-5 props, ~56% reduction)
- App.tsx lines: 3,925 → 3,920 (-5 lines)
- AdminPanel now uses: useAuthStore (userId), useUIStore (adminTab, setAdminTab), useBotStore (savedBots, setSavedBots)
- Removed from App.tsx: adminTab, setAdminTab accessors
- Remaining props: onTickersUpdated, onRefreshNexusBots, onPrewarmComplete, updateBotInApi (all callbacks)

**Pattern for Each Tab:**
```typescript
// BEFORE: Props drilling
function ModelTab({ userId, bots, activeBotId, savedBots, ... }: ModelTabProps) {
  // 107 props destructured
}

// AFTER: Direct store access
function ModelTab({ /* only callbacks that need App.tsx context */ }: ModelTabProps) {
  const userId = useAuthStore(s => s.userId)
  const { bots, activeBotId, savedBots } = useBotStore()
  const { backtestMode, analyzeBacktests } = useBacktestStore()
  // 59 remaining props for App-specific callbacks
}
```

**Phase 2N-14 COMPLETE - Final Results:**
- App.tsx: 4,176 → 3,920 lines (-256 lines, 6% reduction)
- Total props reduced: 155 props removed across all tabs
  - ModelTab: 107 → 59 (-48 props)
  - AnalyzeTab: 45 → 15 (-30 props)
  - DashboardTab: 55 → 22 (-33 props)
  - NexusTab: 46 → 11 (-35 props)
  - HelpTab: 9 → 5 (-4 props)
  - AdminTab: 9 → 4 (-5 props)
- All 6 tabs now use Zustand stores directly for shared state
- Pattern established: stores for shared state, props for callbacks + API-persisted state

**Future: TanStack Query Integration**

Zustand and TanStack Query are complementary:
- **Zustand**: Client state (UI, forms, local preferences)
- **TanStack Query**: Server state (API data, caching, background refetch)

Can add TanStack Query later without changing Zustand stores - they handle different concerns

#### Phase 2N-15: Tree Store Migration (zundo) ✅ COMPLETE

**Goal:** Move tree handlers from App.tsx to a Zustand store with automatic undo/redo via `zundo` middleware.

**Why This Matters:**
- Tree handlers were **~400 lines** in App.tsx
- All handlers follow same pattern: mutate tree → push to history
- `zundo` handles undo/redo automatically, eliminating manual history management
- ModelTab now uses useTreeStore directly (removes all tree callback props)

**Actual Results:**
| Metric | Before | After | Reduction |
|--------|--------|-------|-----------|
| App.tsx lines | 3,920 | 3,505 | -415 |
| Tree handlers in App.tsx | 35+ | 0 | -35 |
| ModelTab tree props | 40+ | 0 | -40 |
| Manual history code | ~100 lines | 0 | -100 |

**Phase 2N-15a: Setup** ✅ COMPLETE
- [x] Install zundo: `npm install zundo`
- [x] Create `src/stores/useTreeStore.ts` with temporal middleware
- [x] Set up basic structure with `root` state and `setRoot` action
- [x] 32+ store methods wrapping pure functions from treeOperations.ts

**Phase 2N-15b: Integration** ✅ COMPLETE
- [x] Create `src/hooks/useTreeSync.ts` - syncs tree store with active bot
- [x] Updated App.tsx to use `useTreeSync()` for `current`
- [x] Updated `push` to use `useTreeStore.getState().setRoot()`
- [x] Updated `undo`/`redo` to use `useTreeUndo()`

**Phase 2N-15c: ModelTab Migration** ✅ COMPLETE
- [x] Updated ModelTab to import and use useTreeStore, useTreeSync, useTreeUndo
- [x] Created 35+ internal handlers that call store methods
- [x] Removed ~40 tree handler props from ModelTabProps interface
- [x] Removed ~35 tree handlers from App.tsx
- [x] Cleaned up unused imports from App.tsx

**Files Created:**
| File | Purpose | Lines |
|------|---------|-------|
| `src/stores/useTreeStore.ts` | Tree state + all mutations with zundo | ~350 |
| `src/hooks/useTreeSync.ts` | Sync tree store with active bot | ~130 |

**Files Modified:**
| File | Changes |
|------|---------|
| `src/stores/index.ts` | Added useTreeStore, useTreeHistory exports |
| `src/hooks/index.ts` | Added useTreeSync, useTreeUndo exports |
| `src/tabs/ModelTab.tsx` | Now uses stores directly (883 → 938 lines) |
| `src/App.tsx` | Removed 35+ handlers (-415 lines) |

**Key Implementation:**
```typescript
// src/stores/useTreeStore.ts
export const useTreeStore = create<TreeState>()(
  temporal(
    (set, get) => ({
      root: createDefaultRoot(),
      setRoot: (root) => set({ root: ensureSlots(root) }),
      addNode: (parentId, slot, index, kind) => set((state) => ({
        root: replaceSlot(state.root, parentId, slot, index, createNode(kind))
      })),
      // ... 30+ more methods
    }),
    { limit: 100, equality: (a, b) => a.root === b.root }
  )
)
export const useTreeHistory = () => useTreeStore.temporal.getState()

// src/hooks/useTreeSync.ts
export function useTreeSync(): FlowNode {
  // Loads tree from active bot into useTreeStore when switching bots
  // Saves tree changes back to useBotStore
  // Clears zundo history on bot switch
}
export function useTreeUndo() {
  // Returns { undo, redo, canUndo, canRedo } using zundo temporal
}
```

#### Phase 2N-16: Backtest Execution Extraction ✅ COMPLETE

**Goal:** Extract `runBacktestForNode` (~400 lines) from App.tsx to a custom hook.

**Result:**
| Metric | Before | After | Reduction |
|--------|--------|-------|-----------|
| App.tsx lines | 3,505 | 3,068 | ~-437 |

**Tasks:**
- [x] Create `src/hooks/useBacktestRunner.ts` (471 lines)
- [x] Move `runBacktestForNode` logic
- [x] Update App.tsx to use extracted hook
- [x] Verify build passes

#### Phase 2N-17: Analyze Handlers Extraction ✅ COMPLETE

**Goal:** Extract analyze/sanity handlers (~530 lines) from App.tsx to a custom hook.

**Result:**
| Metric | Before | After | Reduction |
|--------|--------|-------|-----------|
| App.tsx lines | 3,068 | 2,602 | ~-466 |

**Tasks:**
- [x] Create `src/hooks/useAnalyzeRunner.ts` (565 lines)
  - `runAnalyzeBacktest` (~280 lines)
  - `runSanityReport` (~35 lines)
  - `fetchBenchmarkMetrics` (~20 lines)
  - `runModelRobustness` (~40 lines)
  - `runAnalyzeTickerContribution` (~90 lines)
- [x] Export from `src/hooks/index.ts`
- [x] Update App.tsx to use extracted hook
- [x] Clean up unused imports
- [x] Verify build passes

#### Phase 2N-18: Dashboard Handlers Extraction ✅ COMPLETE

**Goal:** Extract dashboard buy/sell handlers and equity curve computation (~400 lines) from App.tsx to a custom hook.

**Result:**
| Metric | Before | After | Reduction |
|--------|--------|-------|-----------|
| App.tsx lines | 2,602 | 2,182 | ~-420 |

**Tasks:**
- [x] Create `src/hooks/useDashboardHandlers.ts` (~500 lines)
  - `dashboardCash`, `dashboardInvestmentsWithPnl` computed values
  - `dashboardTotalValue`, `dashboardTotalPnl`, `dashboardTotalPnlPct`
  - `dashboardEquityCurve`, `dashboardBotSeries` (equity curve computation)
  - `handleDashboardBuy`, `handleDashboardSell`, `handleDashboardBuyMore`, `handleNexusBuy`
- [x] Export from `src/hooks/index.ts`
- [x] Update App.tsx to use extracted hook
- [x] Clean up unused imports
- [x] Verify build passes

#### Phase 2N-19: Bot Operations Extraction ✅ COMPLETE

**Goal:** Extract bot CRUD callbacks, import handler, and saved bot operations (~400 lines) from App.tsx to a custom hook.

**Result:**
| Metric | Before | After | Reduction |
|--------|--------|-------|-----------|
| App.tsx lines | 2,182 | 1,798 | ~-384 |

**Tasks:**
- [x] Create `src/hooks/useBotOperations.ts` (~400 lines)
  - `push`, `handleCloseBot`, `updateActiveBotBacktest`
  - `handleJumpToBacktestError`, `handleRunBacktest`
  - `handleNewBot`, `handleDuplicateBot`, `handleExport`, `handleExportBot`, `handleOpenBot`
  - `handleCopySaved`, `handleCopyToNew`, `handleDeleteSaved`, `handleOpenSaved`
  - `handleImport` (large import handler)
- [x] Export from `src/hooks/index.ts`
- [x] Update App.tsx to use extracted hook
- [x] Clean up unused imports
- [x] Verify build passes

🎉 **MILESTONE**: App.tsx reduced to 1,678 lines (57% reduction from 3,942)!

#### Phase 2N-20: Watchlist Callbacks Extraction ✅ COMPLETE

**Goal:** Extract watchlist callbacks (~150 lines) from App.tsx to a custom hook.

**Result:**
| Metric | Before | After | Reduction |
|--------|--------|-------|-----------|
| App.tsx lines | 1,798 | 1,678 | ~-120 |

**Tasks:**
- [x] Create `src/hooks/useWatchlistCallbacks.ts` (~240 lines)
  - `ensureDefaultWatchlist` helper (exported for use in App.tsx)
  - `resolveWatchlistId` - resolve watchlist by name or ID
  - `addBotToWatchlist` - add bot to watchlist with API sync
  - `removeBotFromWatchlist` - remove bot from watchlist with API sync
  - `computeEtfsOnlyTag` - auto-tag bots with "ETFs Only"
  - `handleSaveToWatchlist` - save bot to watchlist (create/update)
- [x] Export from `src/hooks/index.ts`
- [x] Update App.tsx to use extracted hook
- [x] Clean up unused imports
- [x] Verify build passes

#### Phase 2N-21: User Data Sync Extraction ✅ COMPLETED

**Goal:** Extract all data loading/sync effects (~180 lines) from App.tsx to a custom hook.

**Result:** 1,678 → ~1,450 lines

**Tasks:**
- [x] Create `src/hooks/useUserDataSync.ts` (~230 lines)
  - Load bots from API (with localStorage migration)
  - Load portfolio from API
  - Load watchlists from API (with localStorage migration)
  - Load/save UI preferences (with debounced save)
  - Refresh Nexus bots
- [x] Export from `src/hooks/index.ts`
- [x] Update App.tsx to use extracted hook
- [x] Verify build passes

#### Phase 2N-22: Ticker Manager Extraction ✅ COMPLETED

**Goal:** Extract ticker management logic (~150 lines) from App.tsx to a custom hook.

**Result:** ~1,450 → ~1,380 lines

**Tasks:**
- [x] Create `src/hooks/useTickerManager.ts` (~155 lines)
  - `loadAvailableTickers` - fetch from API
  - `refreshTickers` - retry on error
  - ETFs-only filtering logic
  - `tickerOptions` memo for datalist
  - Ticker metadata loading
- [x] Export from `src/hooks/index.ts`
- [x] Update App.tsx to use extracted hook
- [x] Verify build passes

#### Phase 2N-23: AppHeader Component Extraction ⬜ PLANNED

**Goal:** Extract header JSX (~150 lines) from App.tsx to a component.

**Target Reduction:** ~1,350 → ~1,200 lines

**Tasks:**
- [ ] Create `src/components/AppHeader.tsx` (~180 lines)
  - Tab navigation buttons
  - QuantNexus logo with theme filters
  - Save-to-watchlist dropdown
  - Logout button with username
- [ ] Export from `src/components/index.ts`
- [ ] Update App.tsx to use component
- [ ] Verify build passes

#### Phase 2N-24: Call Chain Handlers Extraction ✅ COMPLETED

**Goal:** Extract call chain CRUD handlers (~45 lines) from App.tsx to a custom hook.

**Result:** ~1,380 → 1,343 lines

**Tasks:**
- [x] Create `src/hooks/useCallChainHandlers.ts` (~70 lines)
  - `handleAddCallChain`
  - `handleRenameCallChain`
  - `handleToggleCallChainCollapse`
  - `handleDeleteCallChain`
  - `pushCallChain`
- [x] Export from `src/hooks/index.ts`
- [x] Update App.tsx to use extracted hook
- [x] Verify build passes

#### Phase 2N-25: React Hooks and Render Purity Fixes ✅ COMPLETE

**Goal:** Fix React hooks violations and render purity issues causing infinite loops and lint errors.

**Issues Fixed:**
| Issue | File | Fix |
|-------|------|-----|
| Infinite loop (Maximum update depth exceeded) | `App.tsx` | Pass `setWatchlists` directly instead of wrapper function |
| False positive hook warning | `useTreeSync.ts`, `useTreeStore.ts` | Rename `useTreeHistory` → `getTreeTemporalState` |
| Conditional useMemo | `CallReferenceBody.tsx` | Move useMemo before early return |
| Impure Date.now() during render | `OverviewTabContent.tsx`, `DashboardPanel.tsx`, `useDashboardHandlers.ts`, `useDashboardInvestments.ts` | Memoize with `useMemo(() => Date.now(), [])` + eslint-disable |
| setState in effect (cascading renders) | `TickerSearchModal.tsx` | Defer setSearch to setTimeout callback |
| Unauthenticated API calls | `useCorrelation.ts` | Add auth token check before fetch |
| Unused props causing warnings | `BacktesterPanel.tsx`, `AnalyzePanel.tsx` | Remove unused props |

**Result:**
- Lint errors: 47 → 30 problems (-17 errors)
- Eliminated "Maximum update depth exceeded" infinite loop
- All tabs load and function correctly
- Build passes

**Files Modified (15):**
- `src/App.tsx`
- `src/features/analyze/components/AnalyzePanel.tsx`
- `src/features/analyze/components/OverviewTabContent.tsx`
- `src/features/backtest/components/BacktesterPanel.tsx`
- `src/features/builder/components/NodeCard/CallReferenceBody.tsx`
- `src/features/builder/components/NodeCard/NodeCard.tsx`
- `src/features/dashboard/components/DashboardPanel.tsx`
- `src/features/dashboard/hooks/useDashboardInvestments.ts`
- `src/features/nexus/hooks/useCorrelation.ts`
- `src/hooks/useDashboardHandlers.ts`
- `src/hooks/useTreeSync.ts`
- `src/hooks/useUserDataSync.ts`
- `src/shared/components/TickerSearchModal.tsx`
- `src/stores/index.ts`
- `src/stores/useTreeStore.ts`

#### Phase 2N-26: Master Feature Integration 🔄 IN PROGRESS

**Goal:** Merge new features from master branch into the refactored feature branch architecture without losing any functionality.

**Context:**
- Feature branch App.tsx: **1,343 lines** (refactored into hooks/stores)
- Master App.tsx: **23,575 lines** (monolithic with new features)
- Strategy: ADD master features TO feature branch architecture (not merge monolithic files)

---

**✅ COMPLETED (2N-26a-c):**

| Item | Status | Commit |
|------|--------|--------|
| Server files (backtest.mjs, live/, routes/) | ✅ Merged | a9aa120 |
| authFetch utility (`src/lib/authFetch.ts`) | ✅ Created | a9aa120 |
| Server-side backtest (`useBacktestRunner.ts`) | ✅ Updated | a9aa120 |
| @alpacahq dependency | ✅ Added | a9aa120 |

---

**❌ STILL MISSING - Phase 2N-26d: Critical Bug Fixes**

| Bug | File | Problem | Fix |
|-----|------|---------|-----|
| Case-insensitive indicator mapping | `src/importWorker.ts` | QM imports fail ('SMA12Momentum' vs 'sma12momentum') | Normalize keys to lowercase |
| Frontend adjClose fix | `src/features/backtest/engine/metrics.ts` | Current Price uses `close` not `adjClose` in CC mode | Use `ctx.db.adjClose[t] \|\| ctx.db.close[t]` |
| Backtest state closure bug | `src/hooks/useBotOperations.ts` | Results go to wrong bot if user switches during backtest | Capture `activeBotId` at start |
| Database panel auth headers | `src/features/admin/components/DatabasesPanel.tsx` | Admin API calls missing auth | Add `Authorization: Bearer ${token}` |

---

**❌ STILL MISSING - Phase 2N-26e: New Features**

| Feature | File(s) | Description |
|---------|---------|-------------|
| Subspell references | `importWorker.ts`, `TickerSearchModal.tsx` | Support `branch:from`, `branch:to` ticker values |
| Ratio ticker support | `TickerSearchModal.tsx` | Support `SPY/AGG` style ratio tickers |
| Atlas Systems tab | `AtlasSystemsTab.tsx` (new) | Super admin tab for private systems |
| Trading Control tab | `TradingControlTab.tsx` (new) | Alpaca broker UI |
| EnterExit import | `importWorker.ts` | Handle QM 'EnterExit' incantation type |
| Auto-run robustness | `useBotOperations.ts` | Trigger sanity report after backtest |
| Fragility fingerprints | `RobustnessTabContent.tsx` | 2x4 grid with new indicators |

---

**Implementation Order:**

**2N-26d: Critical Bug Fixes** ⬜
1. [ ] Case-insensitive indicator mapping in `importWorker.ts`
2. [ ] Frontend adjClose fix in metrics calculation
3. [ ] Backtest state closure bug in `useBotOperations.ts`
4. [ ] Database panel auth headers

**2N-26e: Core Features** ⬜
5. [ ] Subspell references support (`branch:from`, `branch:to`)
6. [ ] Ratio ticker support in TickerSearchModal
7. [ ] Auto-run robustness after backtest

**2N-26f: Admin Features (super admin only)** ⬜
8. [ ] Create `AtlasSystemsTab.tsx`
9. [ ] Create `TradingControlTab.tsx`
10. [ ] Update `AdminPanel.tsx` with new tabs

**2N-26g: Polish** ⬜
11. [ ] EnterExit import handler
12. [ ] Fragility fingerprints 2x4 grid

---

**Files Summary:**

| File | Changes Needed |
|------|----------------|
| `src/importWorker.ts` | Indicator mapping, subspell refs, EnterExit |
| `src/shared/components/TickerSearchModal.tsx` | Ratio/branch modes |
| `src/hooks/useBotOperations.ts` | Closure fix, auto-robustness |
| `src/features/backtest/engine/metrics.ts` | adjClose fix |
| `src/features/admin/components/DatabasesPanel.tsx` | Auth headers |
| `src/features/admin/components/AdminPanel.tsx` | New tabs |
| `src/features/analyze/components/RobustnessTabContent.tsx` | Fingerprints grid |
| `src/features/admin/components/AtlasSystemsTab.tsx` | **NEW** |
| `src/features/admin/components/TradingControlTab.tsx` | **NEW**

#### Phase 2N Progress Summary

**App.tsx Reduction Progress:**
| Phase | Starting Lines | Ending Lines | Reduction | Status |
|-------|---------------|--------------|-----------|--------|
| 2N-15c | 3,942 | 3,505 | -437 | ✅ |
| 2N-16 | 3,505 | 3,068 | -437 | ✅ |
| 2N-17 | 3,068 | 2,602 | -466 | ✅ |
| 2N-18 | 2,602 | 2,182 | -420 | ✅ |
| 2N-19 | 2,182 | 1,798 | -384 | ✅ |
| 2N-20 | 1,798 | 1,678 | -120 | ✅ |
| 2N-21 | 1,678 | ~1,450 | ~-228 | ✅ |
| 2N-22 | ~1,450 | ~1,380 | ~-70 | ✅ |
| 2N-23 | ~1,380 | ~1,200 | ~-180 | ⬜ |
| 2N-24 | ~1,380 | 1,343 | ~-37 | ✅ |
| 2N-25 | 1,343 | 1,343 | 0 (bug fixes) | ✅ |
| **Total (current)** | **3,942** | **1,343** | **-2,599 (66%)** | |
| **Target** | **3,942** | **~1,150** | **~-2,792 (71%)** | |

**Hooks Created:**
| Hook | Lines | Purpose | Phase |
|------|-------|---------|-------|
| `useTreeSync` | ~150 | Tree state sync with zundo | 2N-15 |
| `useBacktestRunner` | ~200 | Backtest execution | 2N-16 |
| `useAnalyzeRunner` | ~250 | Analyze tab handlers | 2N-17 |
| `useDashboardHandlers` | ~300 | Dashboard logic | 2N-18 |
| `useBotOperations` | ~400 | Bot CRUD + import | 2N-19 |
| `useWatchlistCallbacks` | ~240 | Watchlist operations | 2N-20 |
| `useUserDataSync` | ~230 | Data loading/sync | 2N-21 ✅ |
| `useTickerManager` | ~155 | Ticker management | 2N-22 ✅ |
| `useCallChainHandlers` | ~70 | Call chain CRUD | 2N-24 ✅ |

**Components Created:**
| Component | Lines | Purpose | Phase |
|-----------|-------|---------|-------|
| `AppHeader` | ~180 | Header/navigation | 2N-23 (planned) |

### Phase 3: Redis Integration (Days 8-10)
- [ ] Add Redis to Railway
- [ ] Implement `server/lib/redis.mjs`
- [ ] Update backtest cache to use Redis
- [ ] Update indicator cache to use Redis
- [ ] Create `server/jobs/prewarm-indicators.mjs`
- [ ] Create `server/jobs/prewarm-correlations.mjs`
- [ ] Set up cron schedule in Railway

### Phase 4: Client-Side Caching (Days 11-12)
- [ ] Implement `src/features/data/tickerCache.ts` (IndexedDB)
- [ ] Implement `src/features/data/deltaSync.ts`
- [ ] Add `?since=` parameter to candles endpoint
- [ ] Extend cache TTL from 5min to 24h
- [ ] Test cold start performance

### Phase 5: PostgreSQL Migration (Days 13-14)
- [ ] Add PostgreSQL to Railway
- [ ] Update drizzle.config.ts for PostgreSQL
- [ ] Run migrations
- [ ] Update connection strings
- [ ] Test all database operations

### Phase 6: Security Hardening (Days 15-16)
- [ ] Implement rate limiting middleware
- [ ] Add Zod validation to all endpoints
- [ ] Review auth middleware on all routes
- [ ] Force HTTPS in production
- [ ] Configure CORS for production domain

### Phase 7: Testing & Polish (Days 17-18)
- [ ] End-to-end testing of all features
- [ ] Performance benchmarking
- [ ] Documentation updates
- [ ] CLAUDE.md update for new structure

---

## Files Summary

### New Files (Frontend)

| File | Purpose | Lines (est.) |
|------|---------|--------------|
| `src/features/builder/index.ts` | Barrel export | ~20 |
| `src/features/builder/types.ts` | FlowNode, BlockKind, etc. | ~100 |
| `src/features/builder/components/*.tsx` | 6 components | ~600 |
| `src/features/builder/hooks/*.ts` | useTreeState, useClipboard | ~300 |
| `src/features/builder/utils/*.ts` | Tree operations | ~200 |
| `src/features/backtest/*` | Backtest components/hooks | ~400 |
| `src/features/watchlist/*` | Watchlist components/hooks | ~300 |
| `src/features/nexus/*` | Nexus components/hooks | ~400 |
| `src/features/analyze/*` | Analyze panel + subtabs | ~1,800 |
| `src/features/dashboard/*` | Dashboard panel + hooks | ~1,700 |
| `src/features/data/*` | IndexedDB, delta sync | ~250 |
| `src/features/auth/*` | Auth components/hooks | ~200 |
| `src/shared/*` | Shared components/utils | ~300 |
| `src/hooks/useAuthState.ts` | Auth state hook | ~150 |
| `src/hooks/useBotState.ts` | Bot/watchlist state hook | ~200 |
| `src/hooks/useBacktestState.ts` | Backtest state hook | ~150 |
| `src/hooks/useBotCallbacks.ts` | Bot CRUD callbacks | ~400 |
| `src/hooks/useBacktestCallbacks.ts` | Backtest callbacks | ~300 |
| `src/hooks/useTreeCallbacks.ts` | Tree operation callbacks | ~500 |
| `src/hooks/useDataSync.ts` | Data loading effects | ~200 |
| `src/components/AppShell.tsx` | Main layout/routing | ~300 |

### New Files (Backend)

| File | Purpose | Lines (est.) |
|------|---------|--------------|
| `server/features/bots/*` | Bot CRUD | ~400 |
| `server/features/backtest/*` | Backtest engine | ~800 |
| `server/features/nexus/*` | Nexus/correlation | ~400 |
| `server/features/data/*` | Candles/parquet | ~200 |
| `server/features/watchlist/*` | Watchlist CRUD | ~200 |
| `server/features/auth/*` | Auth endpoints | ~300 |
| `server/jobs/*` | Cron jobs | ~400 |
| `server/lib/*` | Redis, DB, logger | ~150 |
| `server/middleware/*` | Rate limit, validation | ~200 |

### Files to Modify

| File | Change |
|------|--------|
| `src/App.tsx` | Extract everything, reduce to ~100-200 lines |
| `server/index.mjs` | Slim to route wiring only |
| `drizzle.config.ts` | Add PostgreSQL support |
| `package.json` | Add new dependencies |
| `CLAUDE.md` | Update for new structure |

---

## Dependencies to Install

```bash
# Redis
npm install ioredis

# Rate limiting
npm install express-rate-limit

# Validation
npm install zod

# PostgreSQL
npm install pg

# Cron (if not using Railway cron)
npm install node-cron

# State management (client)
npm install @tanstack/react-query
```

---

## Client State Management: TanStack Query

### Why TanStack Query

Current codebase has 20+ fetch calls with manual loading/error states:

```typescript
// BEFORE: Repeated in every component
const [loading, setLoading] = useState(false)
const [error, setError] = useState<string | null>(null)
const [data, setData] = useState(null)

const load = async () => {
  setLoading(true)
  setError(null)
  try {
    const res = await fetch('/api/bots')
    setData(await res.json())
  } catch (err) {
    setError(err.message)
  } finally {
    setLoading(false)
  }
}

// AFTER: TanStack Query
const { data, isLoading, error } = useQuery({
  queryKey: ['bots'],
  queryFn: () => fetch('/api/bots').then(r => r.json())
})
```

### Benefits

| Feature | Before | After |
|---------|--------|-------|
| Loading states | Manual per component | Automatic |
| Error handling | Manual per component | Automatic |
| Caching | None | Built-in |
| Deduplication | None | Automatic (2 components, 1 fetch) |
| Background refetch | Manual | Automatic |
| DevTools | None | Full visibility |

### Implementation

**Setup** (`src/main.tsx`):

```typescript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <App />
    <ReactQueryDevtools initialIsOpen={false} />
  </QueryClientProvider>
)
```

**Custom hooks per feature** (`src/features/bots/hooks/useBots.ts`):

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

export function useUserBots(userId: string) {
  return useQuery({
    queryKey: ['bots', userId],
    queryFn: () => fetch(`/api/bots?userId=${userId}`).then(r => r.json()),
    enabled: !!userId,
  })
}

export function useNexusBots() {
  return useQuery({
    queryKey: ['nexus', 'bots'],
    queryFn: () => fetch('/api/nexus/bots').then(r => r.json()),
    staleTime: 1000 * 60 * 10, // 10 minutes (doesn't change often)
  })
}

export function useSaveBot() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (bot: Bot) => fetch('/api/bots', {
      method: 'POST',
      body: JSON.stringify(bot),
    }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bots'] })
    },
  })
}
```

**Usage in components:**

```typescript
function BotList() {
  const { data: bots, isLoading, error } = useUserBots(userId)

  if (isLoading) return <Spinner />
  if (error) return <Error message={error.message} />

  return <>{bots.map(bot => <BotCard key={bot.id} bot={bot} />)}</>
}
```

### Queries to Create

| Hook | Endpoint | staleTime |
|------|----------|-----------|
| `useUserBots(userId)` | `/api/bots?userId=` | 5 min |
| `useNexusBots()` | `/api/nexus/bots` | 10 min |
| `useWatchlists(userId)` | `/api/watchlists?userId=` | 5 min |
| `useTickerData(ticker)` | `/api/candles/:ticker` | 24 hours (EOD) |
| `useBacktest(botId)` | `/api/bots/:id/run-backtest` | 1 hour |
| `useCorrelation(botIds)` | `/api/correlation/optimize` | 10 min |
| `useNexusLeaderboard(metric)` | `/api/nexus/top/:metric` | 10 min |

### Integration with IndexedDB

TanStack Query can use IndexedDB as persistent cache:

```typescript
import { persistQueryClient } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'

// For ticker data - persist to IndexedDB
const persister = createSyncStoragePersister({
  storage: window.localStorage, // or IndexedDB adapter
})

persistQueryClient({
  queryClient,
  persister,
  maxAge: 1000 * 60 * 60 * 24, // 24 hours
})
```

---

## Error Boundaries

Wrap each feature panel with an error boundary to prevent full-page crashes:

```typescript
// src/shared/components/ErrorBoundary.tsx
import { Component, ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="error-panel">
          <h3>Something went wrong</h3>
          <p>{this.state.error?.message}</p>
          <button onClick={() => this.setState({ hasError: false })}>
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
```

**Usage in App.tsx:**

```typescript
<ErrorBoundary fallback={<BuilderError />}>
  <BuilderPanel />
</ErrorBoundary>

<ErrorBoundary fallback={<BacktestError />}>
  <BacktestPanel />
</ErrorBoundary>

<ErrorBoundary fallback={<NexusError />}>
  <NexusPanel />
</ErrorBoundary>
```

Each feature fails independently - a crash in Nexus won't break the Builder.

---

## Infrastructure

| Service | Provider | Monthly Cost |
|---------|----------|--------------|
| PostgreSQL | Railway | ~$5-10 |
| Redis | Railway | ~$5-10 |
| 2-3 Server Replicas | Railway | ~$10-20 |
| **Total** | | **~$25-40** |

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Cold start data load | ~30 sec | <1 sec |
| Backtest execution | ~500ms | <100ms |
| Correlation matrix load | ~2 sec | <50ms |
| Concurrent users | ~50 | 500+ |
| App.tsx lines | 20,945 | <200 |
| index.mjs lines | 3500+ | <500 |

---

## Agent-Friendly Design Principles

This architecture is optimized for AI agents (Claude, etc.):

1. **Feature isolation** - Agent working on "backtest" only needs `features/backtest/`
2. **README per feature** - Agent reads this first for context
3. **Consistent structure** - Every feature has same file organization
4. **Barrel exports** - `index.ts` shows public API at a glance
5. **Small files** - No 3000-line files to parse
6. **Clear naming** - File names describe purpose
7. **No cross-imports** - Features don't import from each other

---

## Rollback Plan

If restructure causes issues:

1. Keep `master` branch stable (per FRD-028)
2. All work happens on `dev` branch
3. If critical issues: `git checkout master` restores production
4. Individual features can be reverted without affecting others

---

## Additional Optimizations

### PostgreSQL Performance Tuning

```sql
-- Enable query statistics (add to Railway PostgreSQL)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Connection pooling settings (Railway handles this, but good to know)
-- max_connections = 100
-- shared_buffers = 256MB
```

### Redis Optimization

```javascript
// Use pipelining for batch operations
const pipeline = redis.pipeline()
for (const ticker of tickers) {
  pipeline.get(`candles:${ticker}`)
}
const results = await pipeline.exec()

// Use SCAN instead of KEYS for production
// KEYS blocks Redis; SCAN is non-blocking
const stream = redis.scanStream({ match: 'indicator:*' })
```

### IndexedDB Client Optimization

```typescript
// Batch writes for better performance
const tx = db.transaction('tickers', 'readwrite')
for (const ticker of tickers) {
  tx.store.put(data[ticker])
}
await tx.done

// Use cursor for large reads
const cursor = await tx.store.openCursor()
while (cursor) {
  process(cursor.value)
  cursor = await cursor.continue()
}
```

### Backtest Engine Optimization

```javascript
// Pre-allocate arrays (avoid push in hot loops)
const equity = new Float64Array(dates.length)

// Use TypedArrays for indicator calculations
const closes = new Float64Array(bars.map(b => b.adjClose))

// Avoid object creation in loops
// BAD: bars.map(b => ({ date: b.date, value: b.close }))
// GOOD: Reuse objects or use parallel arrays
```

### API Response Compression

```javascript
// Enable gzip compression for large responses
import compression from 'compression'
app.use(compression({
  filter: (req, res) => {
    // Compress JSON responses > 1KB
    return req.headers['accept']?.includes('application/json')
  },
  threshold: 1024
}))
```

### Lazy Loading for Nexus

```javascript
// Don't load all Nexus bots at once
// Paginate with cursor-based pagination
app.get('/api/nexus/bots', async (req, res) => {
  const { cursor, limit = 20 } = req.query
  const bots = await db.select()
    .from(botsTable)
    .where(gt(bots.id, cursor || ''))
    .limit(limit + 1)  // Fetch one extra to detect hasMore

  const hasMore = bots.length > limit
  res.json({
    bots: bots.slice(0, limit),
    nextCursor: hasMore ? bots[limit - 1].id : null
  })
})
```

---

## Open Questions

1. Should we add GraphQL alongside REST, or stay REST-only?
2. Do we need a message queue (BullMQ) for job processing?
3. Should we add Sentry for error tracking?

---

## Acceptance Criteria

- [ ] All endpoints work after restructure
- [ ] Backtest results match before/after
- [ ] Cold start < 1 second
- [ ] Backtest execution < 100ms
- [ ] 500 concurrent users supported
- [ ] All security middleware in place
- [ ] Cron jobs running successfully
- [ ] CLAUDE.md updated
- [ ] No file > 500 lines
- [ ] Error boundaries wrap all feature panels
- [ ] Shared components created (Button, Modal, Card, Tooltip, ErrorBoundary)
