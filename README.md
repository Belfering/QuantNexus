# System Block Chain

A visual flowchart-based trading algorithm builder that allows users to construct trading strategies using a hierarchical tree structure with different node types.

## Overview

System Block Chain enables users to visually design trading strategies by connecting different types of nodes in a flowchart. Each node represents a step in the trading logic, from filtering and ranking stocks to making position allocation decisions.

## Features

- **Visual Flowchart Builder**: Drag-and-drop interface for building trading algorithms
- **Multiple Node Types**:
  - **Basic**: Simple weighted allocation nodes
  - **Function**: Filter/ranking functions (e.g., "Pick bottom 2 by 10d RSI")
  - **Indicator**: Conditional branching with then/else paths for decision logic
  - **Position**: Leaf nodes holding actual ticker positions (BIL, SPY, or Empty)
- **Market Data Integration**: Download and query historical ticker data from Yahoo Finance
- **Undo/Redo**: Full history-based state management
- **Copy/Paste**: Clone node subtrees with a single click
- **Live Data Visualization**: View candlestick charts for tickers using DuckDB-powered queries

## Tech Stack

### Frontend
- **React** with TypeScript
- **Vite** for fast development and building
- **Tailwind CSS** for styling

### Backend
- **Express.js** API server
- **DuckDB** for efficient Parquet file querying
- **Python** for data download (Yahoo Finance)

## Project Structure

```
Flowchart/
├── System.app/              # Main application directory
│   ├── src/
│   │   ├── App.tsx         # Primary application logic (832 lines)
│   │   └── main.tsx        # React entry point
│   ├── server/
│   │   └── index.mjs       # Express API server
│   ├── ticker-data/
│   │   ├── download.py     # Python script to download ticker data
│   │   ├── tickers.txt     # List of stock tickers
│   │   └── data/ticker_data_parquet/  # Parquet files for each ticker
│   └── package.json
├── App.tsx                 # Initial prototype (outdated)
└── README.md
```

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
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

**Terminal 1 - Frontend Development Server:**
```bash
npm run dev
```
This starts the Vite dev server at `http://localhost:5173`

**Terminal 2 - Backend API Server:**
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

**Option 2: Via API endpoint**
```bash
POST http://localhost:8787/api/download
```

## API Endpoints

The backend provides the following REST API endpoints:

- `GET /api/status` - Check ticker data paths and existence
- `GET /api/tickers` - Get parsed list of tickers
- `GET /api/tickers/raw` - Get raw tickers.txt content
- `PUT /api/tickers` - Update tickers list
- `GET /api/parquet-tickers` - List available parquet files
- `GET /api/candles/:ticker?limit=N` - Fetch OHLC candlestick data
- `POST /api/download` - Start Python download job for ticker data

## Building for Production

```bash
npm run build
```

This runs TypeScript checks and builds the production bundle to `dist/`

Preview the production build:
```bash
npm run preview
```

### Authentication (simulated)
- On launch, an admin login prompt is shown. Valid accounts: user `1` with password `1`, and user `9` with password `9` (per-user data is isolated).
- Show the current user in the UI (e.g., header badge) and provide a `Logout` button to return to the login prompt.

## Data Flow

1. Tickers are managed in `ticker-data/tickers.txt`
2. Python script downloads historical data from Yahoo Finance
3. Data is stored as Parquet files in `ticker-data/data/ticker_data_parquet/`
4. DuckDB queries Parquet files on-demand for candle data
5. Frontend displays data and allows users to build trading logic

## Development

### Code Style

```bash
npm run lint
```

### Environment Variables

The backend supports these environment variables:

- `SYSTEM_TICKER_DATA_ROOT` or `TICKER_DATA_MINI_ROOT` - Override default ticker-data path
- `TICKERS_PATH` - Override tickers.txt location
- `PARQUET_DIR` - Override parquet data directory
- `PYTHON` - Python executable (default: `python`)
- `PORT` - API server port (default: 8787)

## PRDs

Product Requirements Documents live in `prd/`.

- Name PRDs with a sortable prefix when order matters (example: `prd/001-some-feature.md`).
- Include `Status` + `Depends on` in the PRD header so ordering isn’t only implied by filenames.

## Contributing

For detailed development guidelines and architecture information, see [CLAUDE.md](./CLAUDE.md).

## License

This project is open source and available under the MIT License.
