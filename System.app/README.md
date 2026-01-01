# System.app - Trading Algorithm Builder

A visual flowchart-based trading algorithm builder with integrated backtesting.

## Features

### Build Tab
- Visual flowchart editor for constructing trading strategies
- Node types: Basic (weighted allocation), Function (filters/ranking), Indicator (conditional branching), Position (ticker holdings)
- Callback Nodes zone for defining reusable call chains
- Custom Indicators zone (coming soon)
- Real-time strategy preview

### Backtester
- Integrated equity curve visualization with benchmark comparison
- Time range presets: 1m, 3m, 6m, YTD, 1yr, 5yr, Max
- Log scale toggle
- Y-axis rebase on time range change (starts at 0%)

### Performance Metrics
- **CAGR**: Compound Annual Growth Rate
- **Max DD**: Maximum Drawdown (peak-to-trough)
- **Calmar**: CAGR / |Max Drawdown| ratio
- **Sharpe**: Risk-adjusted return (annualized)
- **Sortino**: Downside risk-adjusted return (uses only negative returns)
- **Vol**: Annualized volatility
- **Win Rate**: Percentage of positive return days
- **Turnover**: Average daily portfolio turnover
- **Holdings**: Average number of positions held

### Other Tabs
- **Analyze**: Bot performance analysis with watchlist management
- **Portfolio**: Portfolio overview and management
- **Community**: Community bots and shared strategies
- **Admin**: Ticker data management and downloads

## Tech Stack

- **Frontend**: React + TypeScript + Vite
- **Styling**: Tailwind CSS v4 + shadcn/ui components
- **Charts**: lightweight-charts (TradingView)
- **Backend**: Express.js API server
- **Data**: DuckDB + Parquet files for ticker data

## Development

### Prerequisites
- Node.js 18+
- Python 3.x (for ticker data downloads)

### Installation
```bash
cd System.app
npm install
```

### Running the App

Start API server (terminal 1):
```bash
npm run api
```

Start Vite dev server (terminal 2):
```bash
npm run dev
```

The app will be available at http://localhost:5173

### Building for Production
```bash
npm run build
npm run preview  # Preview the build
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8787` | API server port |
| `SYSTEM_TICKER_DATA_ROOT` | `./ticker-data` | Root directory for ticker data |
| `TICKERS_PATH` | `<root>/tickers.txt` | Path to tickers list file |
| `PARQUET_DIR` | `<root>/data/ticker_data_parquet` | Path to parquet data files |
| `PYTHON` | `python` | Python executable for downloads |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Check ticker data paths |
| `/api/tickers` | GET | Get parsed ticker list |
| `/api/tickers/raw` | GET | Get raw tickers.txt content |
| `/api/tickers` | PUT | Update tickers list |
| `/api/parquet-tickers` | GET | List available parquet files |
| `/api/candles/:ticker` | GET | Fetch OHLC candlestick data |
| `/api/download` | POST | Start ticker data download job |
| `/api/changelog` | GET | Fetch CHANGELOG.md content |

## Project Structure

```
System.app/
├── src/
│   ├── App.tsx           # Main application component
│   ├── App.css           # Global styles
│   ├── main.tsx          # React entry point
│   ├── components/ui/    # shadcn/ui components
│   └── lib/utils.ts      # Utility functions
├── server/
│   └── index.mjs         # Express API server
├── ticker-data/
│   ├── download.py       # Data download script
│   ├── tickers.txt       # Ticker list
│   └── data/             # Parquet data files
└── public/               # Static assets
```
