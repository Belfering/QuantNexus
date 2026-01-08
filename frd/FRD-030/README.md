# FRD-030: Scalable Architecture Overhaul

## Metadata
- **ID**: FRD-030
- **Title**: Scalable Architecture Overhaul
- **Status**: IN PROGRESS
- **Priority**: Critical (Infrastructure)
- **Owner**: System
- **Created**: 2025-01-03
- **Last Updated**: 2026-01-06 (Phase 2N-26 COMPLETED - All master features integrated)
- **Depends On**: FRD-028 (Development Workflow)

---

## Phase Index

| Phase | File | Status |
|-------|------|--------|
| 0 | [phase-0-setup.md](./phase-0-setup.md) | ✅ COMPLETE |
| 1 | [phase-1-backend.md](./phase-1-backend.md) | ✅ COMPLETE |
| 2 | [phase-2-frontend.md](./phase-2-frontend.md) | ✅ COMPLETE |
| 3 | [phase-3-redis.md](./phase-3-redis.md) | ⬜ PENDING |
| 4 | [phase-4-client-caching.md](./phase-4-client-caching.md) | ⬜ PENDING |
| 5 | [phase-5-postgresql.md](./phase-5-postgresql.md) | ⬜ PENDING |
| 6 | [phase-6-security.md](./phase-6-security.md) | ⬜ PENDING |
| 7 | [phase-7-testing.md](./phase-7-testing.md) | ⬜ PENDING |

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
│   │   ├── builder/                  # System tree builder
│   │   ├── backtest/                 # Backtest & charts
│   │   ├── watchlist/                # Saved systems
│   │   ├── nexus/                    # Community/sharing
│   │   ├── data/                     # Ticker data management
│   │   └── auth/                     # Authentication
│   │
│   ├── shared/                       # Cross-feature shared code
│   ├── stores/                       # Zustand state stores
│   ├── hooks/                        # Shared hooks
│   ├── App.tsx                       # Just wiring (~1,300 lines)
│   └── main.tsx                      # Entry point
│
├── server/                           # BACKEND
│   ├── features/                     # Feature modules
│   │   ├── bots/                     # Bot CRUD
│   │   ├── backtest/                 # Backtest engine
│   │   ├── nexus/                    # Community features
│   │   ├── data/                     # Ticker data
│   │   ├── watchlist/                # Watchlist management
│   │   └── auth/                     # Authentication
│   │
│   ├── jobs/                         # Cron jobs
│   ├── lib/                          # Shared utilities
│   ├── middleware/                   # Express middleware
│   └── index.mjs                     # Express app setup (slim)
│
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

## Redis Cache Schema

| Key Pattern | Value | TTL | Purpose |
|-------------|-------|-----|---------|
| `candles:{ticker}` | JSON array of OHLC | 24h | Pre-warmed ticker data |
| `indicator:{ticker}:{type}:{period}` | JSON array of values | 24h | Pre-warmed indicators |
| `backtest:{botId}:{hash}` | JSON backtest result | 24h | Cached backtest results |
| `session:{userId}` | JSON session data | 1h | User sessions |
