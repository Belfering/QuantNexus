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
- **Adjusted Close Pricing**: Uses Adj Close for all indicator calculations (accurate historical signals accounting for dividends/splits), with mode-appropriate execution prices:
  - CC mode: Adj Close for both signals and execution (dividend-adjusted returns)
  - OO/CO/OC modes: Adj Close for signals, actual Open/Close for execution
- **Rich Indicator Library**: RSI, SMA, EMA, ROC, Volatility, Drawdown, Cumulative Return, 13612W Momentum, and more
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
- `POST /api/auth/login` - Validate credentials and return user

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
- `POST /api/watchlists/:id/bots` - Add bot to watchlist
- `DELETE /api/watchlists/:id/bots/:botId` - Remove bot from watchlist

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

### Admin
- `GET /api/admin/config` - Get fee configuration
- `PUT /api/admin/config` - Update fee configuration
- `GET /api/admin/aggregated-stats` - Get totals across all accounts
- `GET /api/admin/eligibility` - Get partner eligibility requirements
- `PUT /api/admin/eligibility` - Update eligibility requirements
- `GET /api/db/admin/stats` - Get database-backed aggregated stats

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
- On launch, a login prompt is shown
- **Regular Users**: `1/1`, `3/3`, `5/5`, `7/7`, `9/9` (per-user data is isolated)
- **Admin User**: `admin/admin` (has access to the Admin tab)
- Current user displayed in header with Logout button
- Admin tab is only visible when logged in as admin

### User Roles
- **Partner Users** (1, 3, 5, 7, 9): Can create bots, participate in Partner Program, add bots to Nexus
- **Admin**: Full access to Atlas Overview, Nexus Maintenance, fee configuration

## Data Flow

1. Tickers are managed in `ticker-data/tickers.txt`
2. Python script downloads historical data from Yahoo Finance
3. Data is stored as Parquet files in `ticker-data/data/ticker_data_parquet/`
4. DuckDB queries Parquet files on-demand for candle data
5. Frontend displays data and allows users to build trading logic
6. **All bots are stored in the SQLite database** (database is the sole source of truth)
7. Portfolio investments and metrics are stored in SQLite database
8. localStorage stores only UI state, watchlists, and call chains (not bots)

### Storage Architecture

| Data Type | Storage Location | Notes |
|-----------|------------------|-------|
| **Bots** | SQLite database | Full payload, metrics, visibility |
| **Portfolios** | SQLite database | Cash balance, positions |
| **Bot Metrics** | SQLite database | CAGR, Sharpe, drawdown, etc. |
| **Watchlists** | localStorage | Bot ID references only |
| **UI State** | localStorage | Theme, expanded panels, etc. |
| **Call Chains** | localStorage | User-defined function chains |

On first login, any bots stored in localStorage plus seed bots for new users are automatically migrated to the database.

## Development

### Code Style

```bash
npm run lint
```

### Environment Variables

The backend supports these environment variables:

- `DATABASE_PATH` - Override default database location (default: `server/data/atlas.db`)
- `SYSTEM_TICKER_DATA_ROOT` or `TICKER_DATA_MINI_ROOT` - Override default ticker-data path
- `TICKERS_PATH` - Override tickers.txt location
- `PARQUET_DIR` - Override parquet data directory
- `PYTHON` - Python executable (default: `python`)
- `PORT` - API server port (default: 8787)

## FRDs

Feature Requirements Documents live in `frd/`.

- Name FRDs with a sortable prefix when order matters (example: `frd/001-some-feature.md`).
- Include `Status` + `Depends on` in the FRD header so ordering isn't only implied by filenames.

### Completed FRDs
- FRD-001: Analyze Tab with collapsible bot cards
- FRD-002: Community Nexus tab with top bots tables
- FRD-004: Theming toggle with per-profile persistence
- FRD-005: Atlas Engine branding
- FRD-006: Tailwind CSS + shadcn/ui refactor
- FRD-010: Scalable database architecture

### In Progress
- FRD-003: Conditional logic validation (AND/IF, OR/IF testing)
- FRD-007: Database architecture decisions
- Admin Panel & Partner Program enhancements

## Contributing

For detailed development guidelines and architecture information, see [CLAUDE.md](./CLAUDE.md).

## License

This project is open source and available under the MIT License.
