# Phase 5: PostgreSQL Migration ⬜ PENDING

**Timeline**: Days 13-14
**Status**: ⬜ PENDING

---

## Tasks

- [ ] Add PostgreSQL to Railway
- [ ] Update drizzle.config.ts for PostgreSQL
- [ ] Run migrations
- [ ] Update connection strings
- [ ] Test all database operations

---

## Why PostgreSQL

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

---

## Schema Changes

### Before (SQLite)

```typescript
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

export const bots = sqliteTable('bots', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id'),
  payload: text('payload'),  // JSON as text
})
```

### After (PostgreSQL)

```typescript
import { pgTable, text, serial, real, jsonb, timestamp } from 'drizzle-orm/pg-core'

export const bots = pgTable('bots', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id'),
  payload: jsonb('payload'),  // Native JSONB - queryable!
})
```

---

## Connection Changes

### Before

```javascript
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
const sqlite = new Database('./data/atlas.db')
export const db = drizzle(sqlite, { schema })
```

### After

```javascript
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
export const db = drizzle(pool, { schema })
```

---

## Environment-Based Selection

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

- **Local dev**: SQLite (no setup needed)
- **Production**: PostgreSQL (Railway provides `DATABASE_URL`)

---

## New PostgreSQL Features

### JSONB Queries

```typescript
// Find bots using specific indicator (PostgreSQL only)
const rsiBots = await db.execute(sql`
  SELECT * FROM bots
  WHERE payload @> '{"conditions": [{"text": "RSI"}]}'
`)
```

### Partial Index for Nexus

```sql
CREATE INDEX idx_nexus_leaderboard ON bots(cagr DESC)
WHERE visibility = 'nexus';
```

### Correlation Materialized View

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

---

## New Tables

### nexus_correlations

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

### admin-data.json Migration

```sql
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

CREATE TABLE user_balances (
  user_id TEXT PRIMARY KEY,
  total_value REAL DEFAULT 0,
  total_invested REAL DEFAULT 0,
  invested_atlas REAL DEFAULT 0,
  invested_nexus REAL DEFAULT 0,
  invested_private REAL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);
```

---

## Data Migration Strategy

Given only a few users, fresh start is cleanest:

| Data | Action | Reason |
|------|--------|--------|
| **Users** | Fresh start | Re-invite few users |
| **Bots/Strategies** | Export to JSON | Users can re-import |
| **Watchlists** | Recreate | Low effort |
| **Equity curves** | Regenerate | Backtests recreate |
| **Backtest cache** | Discard | Redis handles now |
| **admin-data.json config** | Migrate | Keep atlas settings |
| **admin-data.json balances** | Fresh start | Clean balances |

---

## Success Criteria

- [ ] PostgreSQL instance running on Railway
- [ ] All existing queries work unchanged
- [ ] JSONB queries available for bot search
- [ ] Migrations run successfully
- [ ] Local dev still uses SQLite
