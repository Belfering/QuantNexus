# FRD-030: Scalable Architecture Overhaul

## Metadata
- **ID**: FRD-030
- **Title**: Scalable Architecture Overhaul
- **Status**: IN PROGRESS
- **Priority**: Critical (Infrastructure)
- **Owner**: System
- **Created**: 2025-01-03
- **Last Updated**: 2026-01-03
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
│   ├── App.tsx                       # Just routing & layout (slim)
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

**Current App.tsx: 11,205 lines (down from ~21,000)**

#### Phase 2J: Backtest Engine Extraction (⬜ PENDING - ~1000 lines)

The backtest engine is tightly coupled and needs careful extraction in stages:

**2J-1: EvalCtx and Metric Functions** (~250 lines)
- [ ] `backtest/engine/types.ts` - EvalCtx type definition
- [ ] `backtest/engine/metrics.ts` - metricAtIndex, metricAt functions

**2J-2: Condition Evaluation** (~200 lines)
- [ ] `backtest/engine/conditions.ts` - conditionExpr, evalConditionAtIndex, evalCondition, evalConditions

**2J-3: Trace Collector** (~80 lines)
- [ ] `backtest/engine/trace.ts` - createBacktestTraceCollector

**2J-4: Allocation Functions** (~100 lines)
- [ ] `backtest/engine/allocation.ts` - volForAlloc, weightChildren, turnoverFraction

**2J-5: Node Evaluation** (~400 lines)
- [ ] `backtest/engine/evaluator.ts` - evaluateNode, tracePositionContributions

**2J-6: Engine Barrel Export**
- [ ] `backtest/engine/index.ts` - Export all engine functions

#### Phase 2K: Nexus Feature (⬜ PENDING)

**2K-1: Nexus API**
- [ ] `nexus/api/index.ts` - fetchNexusBots, correlation endpoints

**2K-2: Nexus Hooks**
- [ ] `nexus/hooks/useNexusBots.ts` - Load/cache Nexus bots
- [ ] `nexus/hooks/useCorrelation.ts` - Correlation matrix data
- [ ] `nexus/hooks/useLeaderboard.ts` - Leaderboard queries

**2K-3: Nexus Components**
- [ ] `nexus/components/NexusBrowser.tsx` - Browse community bots
- [ ] `nexus/components/CorrelationMatrix.tsx` - Visual correlation display
- [ ] `nexus/components/PortfolioBuilder.tsx` - Multi-bot portfolio
- [ ] `nexus/components/LeaderboardTable.tsx` - Ranked bot list

#### Phase 2L: Auth Feature (⬜ PENDING)

**2L-1: Auth API**
- [ ] `auth/api/index.ts` - Login, register, token refresh endpoints

**2L-2: Auth Hooks**
- [ ] `auth/hooks/useAuth.ts` - Auth state, login/logout
- [ ] `auth/hooks/useUser.ts` - Current user info

**2L-3: Auth Components**
- [ ] `auth/components/LoginForm.tsx` - Email/password login
- [ ] `auth/components/RegisterForm.tsx` - New user registration
- [ ] `auth/components/AuthGuard.tsx` - Protected route wrapper

#### Phase 2M: Data/Import Feature (⬜ PENDING)

**2M-1: Client-Side Caching (new)**
- [ ] `data/tickerCache.ts` - IndexedDB operations
- [ ] `data/deltaSync.ts` - Fetch only new data since last sync

**2M-2: Data Hooks**
- [ ] `data/hooks/useTickerData.ts` - Load/cache ticker data

#### Phase 2N: Final Cleanup
- [ ] Slim down App.tsx to routing/layout only (<500 lines target)
- [ ] Remove all extracted code from App.tsx
- [ ] Update all imports to use feature modules
- [ ] Verify all imports work
- [ ] Run full test suite
- [ ] Update CLAUDE.md for new structure
- [ ] Update vite.config.ts path aliases if needed

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
| `src/features/data/*` | IndexedDB, delta sync | ~250 |
| `src/features/auth/*` | Auth components/hooks | ~200 |
| `src/shared/*` | Shared components/utils | ~300 |

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
| `src/App.tsx` | Slim to routing/layout only |
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
| App.tsx lines | 20,945 | <500 |
| index.mjs lines | 3500+ | <200 |

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
