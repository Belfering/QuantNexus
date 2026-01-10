# Data Feature

Manages ticker data, candle fetching, and download jobs.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status` | System status and paths |
| GET | `/api/changelog` | Serve changelog file |
| GET | `/api/tickers` | Get list of tickers |
| GET | `/api/tickers/raw` | Get raw tickers.txt content |
| PUT | `/api/tickers` | Update tickers list |
| GET | `/api/parquet-tickers` | List available parquet files |
| GET | `/api/candles/:ticker` | Get OHLC candle data |
| POST | `/api/candles/batch` | Fetch multiple tickers efficiently |
| POST | `/api/download` | Start a download job |
| GET | `/api/download/:jobId` | Get download job status |

## Files

- `routes.mjs` - Express router with all endpoints
- `service.mjs` - Business logic and data access functions

## Dependencies

- `lib/config.mjs` - Environment configuration
- `lib/duckdb.mjs` - DuckDB connection pool
- `lib/jobs.mjs` - Background job tracking
- `lib/logger.mjs` - Structured logging

## Key Functions (service.mjs)

- `normalizeTicker(ticker)` - Normalize ticker symbol
- `readTickersFile()` - Read tickers from tickers.txt
- `writeTickersFile(input)` - Write tickers to file
- `listParquetTickers()` - List available parquet files
- `queryCandles(ticker, limit)` - Query candle data from parquet
- `queryCandlesPooled(ticker, limit, poolIndex)` - Parallel query with pooled connection

## Caching

Server-side caching is implemented for ticker data:
- TTL: 30 minutes
- Cached per ticker with limit tracking
- Batch requests use cache first, then fetch missing
