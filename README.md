# Atlas Engine

A visual flowchart-based trading algorithm builder that allows users to construct trading strategies using a hierarchical tree structure with different node types. Features a scalable database architecture for cross-user bot sharing via the Nexus marketplace.

## Overview

Atlas Engine enables users to visually design trading strategies by connecting different types of nodes in a flowchart. Each node represents a step in the trading logic, from filtering and ranking stocks to making position allocation decisions. Users can share their strategies on the Nexus marketplace while maintaining IP protection.

## Features

- **Visual Flowchart Builder**: Drag-and-drop interface for building trading algorithms
- **Multiple Node Types**:
  - **Basic**: Simple weighted allocation nodes
  - **Function**: Filter/ranking functions (e.g., "Pick bottom 2 by 10d RSI")
  - **Indicator**: Conditional branching with then/else paths for decision logic
  - **Numbered**: Signal ladder with quantifiers (Any, All, None, Exactly, At Least, At Most, Ladder)
  - **Alt Exit**: Entry/exit condition pairs with scaling options
  - **Position**: Leaf nodes holding actual ticker positions (BIL, SPY, or Empty)
- **Strategy Import**: Import strategies from QuantMage and Composer JSON files
- **Market Data Integration**: Download and query historical ticker data from Yahoo Finance
- **Backtesting**: Run backtests with comprehensive metrics (CAGR, Sharpe, Sortino, Treynor, Calmar, Max Drawdown, Beta, etc.)
- **Advanced Analytics** (Analyze Tab):
  - **Monte Carlo Simulation**: 200 block-resampled paths (5 years × 7-day blocks) to estimate CAGR/MaxDD distributions
  - **K-Fold Cross-Validation**: 200 drop-1 shuffled folds for robustness testing
  - **Comparison Table**: Side-by-side metrics vs 10 benchmark tickers (VTI, SPY, QQQ, DIA, DBC, DBO, GLD, BND, TLT, GBTC)
  - **Alpha Indicators**: Color-coded performance difference vs benchmarks
  - **Fragility Analysis**: Sub-period stability, top concentration, thinning sensitivity
  - **Cache Pre-warming**: Admin can pre-compute all analytics for instant loading
- **Adjusted Close Pricing**: Uses Adj Close for all indicator calculations (accurate historical signals accounting for dividends/splits), with mode-appropriate execution prices:
  - CC mode: Adj Close for both signals and execution (dividend-adjusted returns)
  - OO/CO/OC modes: Adj Close for signals, actual Open/Close for execution
- **Rich Indicator Library**: RSI, SMA, EMA, ROC, Volatility, Drawdown, Cumulative Return, 13612W Momentum, and more
- **Ticker Search Modal**: Search tickers by symbol or company name with ETF/Stock filtering
- **Undo/Redo**: Full history-based state management
- **Copy/Paste**: Clone node subtrees with a single click
- **Live Data Visualization**: View candlestick charts for tickers using DuckDB-powered queries
- **Dashboard**: Investment portfolio with live P&L tracking, equity charts, and pie chart allocation
- **Community Nexus**: Cross-user bot marketplace with IP protection
  - Browse top-performing bots by CAGR, Calmar, Sharpe
  - Invest in other users' strategies without accessing their code
  - Automatic eligibility tagging for partner program
- **Partner Program**: Add eligible bots to Fund Zones for Nexus visibility
- **Admin Panel** (admin-only):
  - **Atlas Overview**: Cross-account aggregation (Total Dollars in Accounts, Total Invested), configurable fee percentages, treasury bill holdings tracking
  - **Nexus Maintenance**: Eligibility requirements configuration, top 500 systems tracking
  - **Ticker Data**: Manage ticker lists and download market data

## Tech Stack

### Frontend
- **React 19** with TypeScript
- **Vite 7** for fast development and building
- **Tailwind CSS v4** for styling
- **shadcn/ui** components
- **Lightweight Charts** for financial charting

### Backend
- **Express.js** API server
- **SQLite** with **Drizzle ORM** for user and bot data persistence
- **DuckDB** for efficient Parquet file querying
- **Python** for data download (Yahoo Finance)

### Database Architecture
- **Database-first design**: SQLite database is the sole source of truth for all bot data
- Scalable schema for users, bots, portfolios, watchlists, metrics
- Cross-user Nexus bot visibility via database queries
- IP protection: bot payloads never sent to non-owners
- Automatic localStorage-to-database migration on first login
- Ready for PostgreSQL migration for production scaling

## Project Structure

```
Flowchart/
├── System.app/              # Main application directory
│   ├── src/
│   │   ├── App.tsx          # Primary application logic
│   │   ├── main.tsx         # React entry point
│   │   ├── components/ui/   # shadcn/ui components
│   │   └── lib/             # Utility functions
│   ├── server/
│   │   ├── index.mjs        # Express API server
│   │   ├── db/
│   │   │   ├── schema.mjs   # Drizzle ORM schema
│   │   │   └── index.mjs    # Database operations
│   │   └── data/            # SQLite database (atlas.db)
│   ├── ticker-data/
│   │   ├── download.py      # Python script to download ticker data
│   │   ├── tickers.txt      # List of stock tickers
│   │   └── data/ticker_data_parquet/  # Parquet files for each ticker
│   └── package.json
├── frd/                     # Feature Requirements Documents
├── CLAUDE.md                # Development guidelines
└── README.md
```

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- Python 3.x
- Git

### Installation

1. Clone the repository:
```bash
git clone https://github.com/Belfering/Flowchart.git
cd Flowchart/System.app
```

2. Install dependencies:
```bash
npm install
```

### Running the Application

You need to run both the frontend and backend servers concurrently:

**Option 1 - Single command (recommended):**
```bash
npm run dev:full
```
This starts both the Vite dev server and Express API server concurrently.

**Option 2 - Separate terminals:**

Terminal 1 - Frontend Development Server:
```bash
npm run dev
```
This starts the Vite dev server at `http://localhost:5173`

Terminal 2 - Backend API Server:
```bash
npm run api
```
This starts the Express API server on port 8787

The Vite dev server automatically proxies `/api/*` requests to the backend server.

### Downloading Ticker Data

**Option 1: Via Python script directly**
```bash
cd ticker-data
python download.py --tickers-file tickers.txt --out-dir data/ticker_data_parquet
```

**Option 2: Via Admin Panel**
Navigate to Admin > Ticker Data tab and click "Download".

## API Endpoints

The backend provides the following REST API endpoints:

### Authentication
- `POST /api/auth/register` - Register new user (requires invite code)
- `POST /api/auth/login` - Login and receive JWT tokens
- `POST /api/auth/logout` - Invalidate refresh token
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/verify-email` - Verify email with token
- `POST /api/auth/forgot-password` - Request password reset email
- `POST /api/auth/reset-password` - Reset password with token
- `GET /api/auth/me` - Get current user info (requires auth)

### Bots (User's Own)
- `GET /api/bots?userId=X` - Get user's bots
- `GET /api/bots/:id` - Get single bot (payload only for owner)
- `POST /api/bots` - Create new bot
- `PUT /api/bots/:id` - Update bot
- `DELETE /api/bots/:id` - Soft delete bot
- `PUT /api/bots/:id/metrics` - Update backtest metrics

### Nexus (Cross-User Marketplace)
- `GET /api/nexus/bots` - Get all Nexus bots (no payload - IP protection)
- `GET /api/nexus/top/cagr?limit=10` - Top bots by CAGR
- `GET /api/nexus/top/calmar?limit=10` - Top bots by Calmar ratio
- `GET /api/nexus/top/sharpe?limit=10` - Top bots by Sharpe ratio

### Watchlists
- `GET /api/watchlists?userId=X` - Get user's watchlists
- `POST /api/watchlists` - Create new watchlist
- `PUT /api/watchlists/:id` - Update watchlist
- `DELETE /api/watchlists/:id` - Delete watchlist
- `POST /api/watchlists/:id/bots` - Add bot to watchlist
- `DELETE /api/watchlists/:id/bots/:botId` - Remove bot from watchlist

### Call Chains
- `GET /api/call-chains?userId=X` - Get user's call chains
- `POST /api/call-chains` - Create new call chain
- `PUT /api/call-chains/:id` - Update call chain
- `DELETE /api/call-chains/:id` - Delete call chain

### Portfolio
- `GET /api/portfolio?userId=X` - Get user's portfolio with positions
- `POST /api/portfolio/buy` - Buy shares of a bot
- `POST /api/portfolio/sell` - Sell shares of a bot

### User Preferences
- `GET /api/preferences?userId=X` - Get user preferences
- `PUT /api/preferences` - Update preferences (theme, color scheme)

### Ticker Data
- `GET /api/status` - Check ticker data paths and existence
- `GET /api/tickers` - Get parsed list of tickers
- `GET /api/candles/:ticker?limit=N` - Fetch OHLC candlestick data
- `POST /api/download` - Start Python download job for ticker data

### Sanity Reports & Benchmarks
- `POST /api/bots/:id/sanity-report` - Run Monte Carlo & K-Fold analysis (cached)
- `GET /api/benchmarks/metrics` - Get metrics for benchmark tickers (cached)

### Admin
- `GET /api/admin/config` - Get fee configuration
- `PUT /api/admin/config` - Update fee configuration
- `GET /api/admin/aggregated-stats` - Get totals across all accounts
- `GET /api/admin/eligibility` - Get partner eligibility requirements
- `PUT /api/admin/eligibility` - Update eligibility requirements
- `GET /api/db/admin/stats` - Get database-backed aggregated stats

### Cache Management (Admin)
- `GET /api/admin/cache/stats` - Get cache statistics
- `POST /api/admin/cache/invalidate` - Invalidate all cache entries
- `POST /api/admin/cache/refresh` - Force daily cache refresh
- `POST /api/admin/cache/prewarm` - Pre-compute backtests & sanity reports for all systems

## Building for Production

```bash
npm run build
```

This runs TypeScript checks and builds the production bundle to `dist/`

Preview the production build:
```bash
npm run preview
```

### Authentication
- On launch, a login screen is shown with options to sign in, register, or reset password
- **Registration**: Requires a valid invite code during beta period
- **Admin User**: Created via environment variables (`ADMIN_EMAIL`, `ADMIN_PASSWORD`)
- JWT-based authentication with access tokens (15min) and refresh tokens (7 days)
- "Remember me" option persists sessions across browser restarts
- Admin tab is only visible when logged in as admin

### User Roles
- **Regular Users**: Can create bots, manage portfolios and watchlists
- **Partner Users**: Can participate in Partner Program, add bots to Nexus
- **Admin**: Full access to Atlas Overview, Nexus Maintenance, fee configuration

## Data Flow

1. Tickers are managed in `ticker-data/tickers.txt`
2. Python script downloads historical data from Yahoo Finance
3. Data is stored as Parquet files in `ticker-data/data/ticker_data_parquet/`
4. DuckDB queries Parquet files on-demand for candle data
5. Frontend displays data and allows users to build trading logic
6. **All user data is stored in the SQLite database** (database is the sole source of truth)
7. Portfolio investments, watchlists, preferences, and call chains are all in SQLite
8. localStorage is only used for legacy migration (data migrates to database on login)

### Storage Architecture

| Data Type | Storage Location | Notes |
|-----------|------------------|-------|
| **Bots** | SQLite database | Full payload, metrics, visibility |
| **Portfolios** | SQLite database | Cash balance, positions |
| **Bot Metrics** | SQLite database | CAGR, Sharpe, drawdown, etc. |
| **Watchlists** | SQLite database | Per-user watchlists with bot associations |
| **User Preferences** | SQLite database | Theme, color scheme, UI state |
| **Call Chains** | SQLite database | User-defined reusable function chains |

All user data is now stored in the SQLite database, enabling multi-device access and cross-user features. On first login, any legacy localStorage data is automatically migrated to the database.

## Development

### Code Style

```bash
npm run lint
```

### Environment Variables

The backend supports these environment variables:

**Required for Production:**
- `JWT_SECRET` - Secret key for signing JWT access tokens
- `REFRESH_SECRET` - Secret key for refresh tokens
- `ADMIN_EMAIL` - Email for the initial admin user
- `ADMIN_PASSWORD` - Password for the initial admin user (min 8 characters)

**Optional:**
- `DATABASE_PATH` - Override default database location (default: `server/data/atlas.db`)
- `SYSTEM_TICKER_DATA_ROOT` or `TICKER_DATA_MINI_ROOT` - Override default ticker-data path
- `TICKERS_PATH` - Override tickers.txt location
- `PARQUET_DIR` - Override parquet data directory
- `PYTHON` - Python executable (default: `python`)
- `PORT` - API server port (default: 8787)
- `NODE_ENV` - Set to `production` for production mode

## FRDs

Feature Requirements Documents live in `frd/`.

- Name FRDs with a sortable prefix when order matters (example: `frd/001-some-feature.md`).
- Include `Status` + `Depends on` in the FRD header so ordering isn't only implied by filenames.

### Completed FRDs (22 total)
- FRD-001: Analyze Tab with collapsible bot cards
- FRD-002: Community Nexus tab with top bots tables
- FRD-003: Conditional logic testing (34 Vitest tests for AND/OR/IF)
- FRD-004: Theming toggle with per-profile persistence
- FRD-005: Atlas Engine branding
- FRD-006: Tailwind CSS + shadcn/ui refactor
- FRD-007: Full database migration (portfolios, bots, watchlists, preferences, call chains)
- FRD-008: Password hashing with bcrypt + auto-migration
- FRD-012: Fund Lock (no edit for published systems)
- FRD-013: Rename "Bots" to "Systems" in UI
- FRD-014: Backtest caching with daily refresh
- FRD-016: Beta metric (vs SPY)
- FRD-017: Payload compression (gzip for >1MB payloads)
- FRD-018: Alt Exit & Scaling node types
- FRD-019: Auto-detect import (Atlas/Composer/QuantMage)
- FRD-021: Model Tab UI improvements (60px insert button, accent-tinted nodes)
- FRD-022: Extended indicators (40+ indicators - Hull MA, Bollinger, Stochastic, ADX, ATR, etc.)
- FRD-023: Atlas UI improvements (sort dropdowns, Export JSON, Open Model, collapsed stats)
- FRD-024: Nexus label rename (Community Nexus -> Nexus)
- FRD-025: Atlas zone improvements (expandable cards, watchlist buttons, IP protection)
- FRD-026: Advanced Analytics Suite (Monte Carlo 200 sims, K-Fold 200 folds, comparison table, benchmark metrics, cache pre-warming)

### Pending (0 total)
All pending FRDs have been completed!

### Deferred/Future (2 total)
- FRD-011: Atlas Sponsored Systems (blocked - needs investigation)
- FRD-027: Tiingo API Integration (replace Yahoo Finance)

## Coming Soon

- Position Node (adding Tickers) rework to be less click intensive
- API/Backtest Speed up
- Correlation matrix/portfolio builder tool
- Variable Library (allowing the creation of custom indicators)


## Contributing

For detailed development guidelines and architecture information, see [CLAUDE.md](./CLAUDE.md).

## License

This project is open source and available under the MIT License.
