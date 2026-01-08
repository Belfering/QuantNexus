# Phase 1: Backend Restructure ✅ COMPLETE

**Timeline**: Days 2-4
**Status**: ✅ COMPLETE

---

## Tasks

- [x] Create `server/lib/` utilities (config, duckdb, logger, jobs)
- [x] Extract `server/features/auth/` from index.mjs
- [x] Extract `server/features/bots/` from index.mjs
- [x] Extract `server/features/data/` from index.mjs
- [ ] Extract `server/features/backtest/` from backtest.mjs (deferred - already well-organized)
- [x] Extract `server/features/nexus/` from index.mjs + correlation.mjs
- [x] Extract `server/features/watchlist/` from index.mjs
- [x] Slim down index.mjs to just route wiring
- [x] Add middleware (validation, errorHandler)
- [x] Test all endpoints still work

---

## Server Structure Created

```
server/
├── features/
│   ├── auth/
│   │   ├── routes.mjs         # /api/auth/* endpoints
│   │   ├── middleware.mjs     # Auth verification
│   │   └── service.mjs        # Business logic
│   │
│   ├── bots/
│   │   ├── routes.mjs         # /api/bots/* endpoints
│   │   ├── service.mjs        # Bot CRUD
│   │   └── validation.mjs     # Zod schemas
│   │
│   ├── data/
│   │   ├── routes.mjs         # /api/candles/* endpoints
│   │   └── parquet.mjs        # DuckDB/parquet operations
│   │
│   ├── nexus/
│   │   ├── routes.mjs         # /api/nexus/* endpoints
│   │   ├── correlation.mjs    # Correlation engine
│   │   └── service.mjs        # Nexus business logic
│   │
│   └── watchlist/
│       ├── routes.mjs         # /api/watchlists/* endpoints
│       └── service.mjs        # Watchlist CRUD
│
├── lib/
│   ├── config.mjs             # Environment configuration
│   ├── duckdb.mjs             # DuckDB client wrapper
│   ├── logger.mjs             # Structured logging
│   └── jobs.mjs               # Cron job utilities
│
├── middleware/
│   ├── validation.mjs         # Request validation
│   └── errorHandler.mjs       # Global error handler
│
├── db/
│   ├── index.mjs              # Database connection
│   ├── schema.ts              # Drizzle schema
│   └── migrations/            # Database migrations
│
└── index.mjs                  # Express app setup (slim, just route wiring)
```

---

## Key Changes

### index.mjs (Before)
- 3500+ lines with all endpoint handlers inline

### index.mjs (After)
- ~200 lines, just route mounting and middleware setup
- All business logic moved to feature modules

### Route Registration Pattern

```javascript
// server/index.mjs
import authRoutes from './features/auth/routes.mjs'
import botRoutes from './features/bots/routes.mjs'
import dataRoutes from './features/data/routes.mjs'
import nexusRoutes from './features/nexus/routes.mjs'
import watchlistRoutes from './features/watchlist/routes.mjs'

app.use('/api/auth', authRoutes)
app.use('/api/bots', botRoutes)
app.use('/api', dataRoutes)  // candles, tickers, etc.
app.use('/api/nexus', nexusRoutes)
app.use('/api/watchlists', watchlistRoutes)
```

---

## Files Created

| File | Purpose | Lines |
|------|---------|-------|
| `server/features/auth/routes.mjs` | Auth endpoints | ~150 |
| `server/features/auth/middleware.mjs` | JWT verification | ~50 |
| `server/features/bots/routes.mjs` | Bot CRUD endpoints | ~300 |
| `server/features/data/routes.mjs` | Candle/ticker endpoints | ~200 |
| `server/features/nexus/routes.mjs` | Nexus endpoints | ~150 |
| `server/features/watchlist/routes.mjs` | Watchlist endpoints | ~100 |
| `server/lib/config.mjs` | Environment config | ~50 |
| `server/lib/duckdb.mjs` | DuckDB wrapper | ~100 |
| `server/middleware/errorHandler.mjs` | Global error handler | ~30 |
