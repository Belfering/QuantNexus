# CLAUDE.md

**IMPORTANT: Always ask before pushing to GitHub.**

**CRITICAL: Never merge `dev` to `master` or push to `master` without explicit user approval. Always confirm before any operation that affects the production branch. The `dev` branch is for testing - only `master` triggers Railway deployment.**

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a flowchart-based trading algorithm builder called "System Block Chain". The application allows users to visually construct trading strategies using a hierarchical tree structure with different node types (basic, function, indicator, position). Note: The original README.md describes a money flow allocation system, but the actual implementation is a trading algorithm flowchart builder with different features.

## Project Structure

- **Root `/App.tsx`**: Initial draft/prototype (outdated - DO NOT modify)
- **`/System.app/`**: Main application directory
  - **`src/App.tsx`**: Primary application logic (832 lines) - the actual implementation
  - **`src/main.tsx`**: React entry point
  - **`server/index.mjs`**: Express API server for ticker data management
  - **`ticker-data/`**: Directory for market data storage
    - `download.py`: Python script to download ticker data
    - `tickers.txt`: List of stock tickers
    - `data/ticker_data_parquet/`: Parquet files for each ticker

## Architecture

### Frontend (React + TypeScript + Vite)

The app uses an immutable tree structure with recursive node manipulation:

**Node Types:**
- `basic`: Simple weighted allocation node
- `function`: Filter/ranking functions (e.g., "Pick bottom 2 by 10d RSI")
- `indicator`: Conditional branching with then/else paths
- `position`: Leaf nodes holding actual ticker positions (BIL, SPY, Empty)

**Core Data Model:**
```typescript
type FlowNode = {
  id: string
  kind: BlockKind
  title: string
  children: Partial<Record<SlotId, Array<FlowNode | null>>>
  positions?: PositionChoice[]
  weighting: WeightMode
  conditions?: { id: string; text: string }[]
}
```

**State Management:**
- History-based undo/redo using an array of tree snapshots
- All tree mutations create new immutable copies
- Clipboard for copy/paste of node subtrees

**Key Operations (all in `App.tsx`):**
- `replaceSlot()`: Replace a child in a specific slot
- `deleteNode()`: Recursively remove a node
- `cloneNode()`: Deep copy with new IDs
- `updateTitle()`, `updateWeight()`: Update node properties
- `addConditionLine()`: Add and/or conditions to indicators
- `choosePosition()`: Set ticker for position nodes

### Backend (Express + DuckDB)

API server on port 8787 (configurable via `PORT` env var):

**Endpoints:**
- `GET /api/status`: Check ticker data paths and existence
- `GET /api/tickers`: Get parsed list of tickers
- `GET /api/tickers/raw`: Get raw tickers.txt content
- `PUT /api/tickers`: Update tickers list
- `GET /api/parquet-tickers`: List available parquet files
- `GET /api/candles/:ticker?limit=N`: Fetch OHLC candlestick data
- `POST /api/download`: Start Python download job for ticker data

**Data Pipeline:**
1. Tickers are stored in `ticker-data/tickers.txt`
2. Python script downloads data from Yahoo Finance
3. Data stored as Parquet files in `ticker-data/data/ticker_data_parquet/`
4. DuckDB queries Parquet files for candle data

## Development Commands

### Frontend Development
```bash
cd System.app
npm install          # Install dependencies
npm run dev          # Start Vite dev server (default: http://localhost:5173)
npm run build        # TypeScript check + production build to dist/
npm run preview      # Preview production build
npm run lint         # ESLint check
```

### Backend Development
```bash
cd System.app
npm run api          # Start Express API server on port 8787
```

**Note:** Run both `npm run dev` and `npm run api` concurrently for full stack development. The Vite dev server proxies `/api/*` requests to `http://localhost:8787`.

### Python Data Download
```bash
cd System.app/ticker-data
python download.py --tickers-file tickers.txt --out-dir data/ticker_data_parquet
```

Or trigger via API: `POST /api/download`

## Environment Variables

**Server (server/index.mjs):**
- `SYSTEM_TICKER_DATA_ROOT` or `TICKER_DATA_MINI_ROOT`: Override default ticker-data path
- `TICKERS_PATH`: Override tickers.txt location
- `PARQUET_DIR`: Override parquet data directory
- `PYTHON`: Python executable (default: `python`)
- `PORT`: API server port (default: 8787)

## Key Implementation Details

1. **Tree Rendering**: The `NodeCard` component recursively renders the entire tree using depth-based indentation (`depth * 18px` for cards, `depth * 14px` for internal lines).

2. **Slots**: Each node kind has specific slots:
   - `basic`, `function`: `['next']`
   - `indicator`: `['then', 'else', 'next']` (currently only then/else are used)
   - `position`: `[]` (leaf nodes)

3. **Node IDs**: Auto-incremented counter creates IDs like `node-1`, `node-2`. Cloning generates new IDs.

4. **Validation**: Currently NO validation enforced (the README.md spec mentions 100% allocation rules, but this is not implemented).

5. **Parquet Integration**: The server uses DuckDB's `read_parquet()` function to query `.parquet` files without loading into memory.

## Common Patterns

**Adding a new node type:**
1. Add to `BlockKind` type
2. Define slot order in `SLOT_ORDER`
3. Update `createNode()` for initialization
4. Update `buildLines()` for custom rendering
5. Add button in the add-node menu

**Modifying tree state:**
- Always use the provided helper functions (`replaceSlot`, `deleteNode`, etc.)
- Never mutate nodes directly - create new objects
- Call `push(next)` to add to history after mutations
- Use `ensureSlots()` to normalize node structure

**API Integration:**
- Proxy is configured in `vite.config.ts` to forward `/api` to `localhost:8787`
- No authentication/CORS restrictions (intended for local development)
