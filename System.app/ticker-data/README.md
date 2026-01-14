# Ticker Data Pipeline

This directory contains the data pipeline for downloading and managing historical market data (OHLCV) for the trading algorithm builder.

## Overview

The system downloads daily candlestick data from multiple sources and stores it as Parquet files for efficient querying via DuckDB.

## Data Sources

1. **Yahoo Finance (yfinance)** - Primary source for batch downloads (100+ tickers at once)
2. **Tiingo API** - Fallback for failed yfinance downloads + incremental daily updates

## Directory Structure

```
ticker-data/
├── tickers.txt                    # List of ticker symbols (one per line)
├── tiingo_download.py             # Main download script
├── download.py                    # Legacy download script
├── data/
│   └── ticker_data_parquet/       # Parquet files (one per ticker)
│       ├── SPY.parquet
│       ├── QQQ.parquet
│       └── ...
└── README.md                      # This file
```

## Parquet Schema

Each parquet file contains:

| Column    | Type     | Description                    |
|-----------|----------|--------------------------------|
| Date      | datetime | Trading date                   |
| ticker    | string   | Ticker symbol (uppercase)      |
| Open      | float    | Opening price                  |
| High      | float    | High price                     |
| Low       | float    | Low price                      |
| Close     | float    | Closing price                  |
| Adj Close | float    | Adjusted closing price         |
| Volume    | int      | Trading volume                 |

## Download Modes

### 1. Default Mode (yfinance + Tiingo fallback)

Batch downloads using yfinance for speed, with Tiingo API fallback for any tickers that fail.

```bash
python tiingo_download.py \
  --tickers-file tickers.txt \
  --out-dir data/ticker_data_parquet
```

### 2. Tiingo-Only Mode

Downloads all tickers directly from Tiingo API. Slower but more thorough.

```bash
python tiingo_download.py \
  --tickers-file tickers.txt \
  --out-dir data/ticker_data_parquet \
  --tiingo-only
```

### 3. Incremental Mode (Daily Updates)

Only fetches new data since the last date in each existing parquet file. Ideal for daily cron jobs.

```bash
python tiingo_download.py \
  --tickers-file tickers.txt \
  --out-dir data/ticker_data_parquet \
  --incremental
```

**How incremental mode works:**
1. For each ticker, reads the existing parquet file to find the last date
2. If file exists: fetches data from `last_date + 1` to today
3. If file doesn't exist: does a full download from `start_date`
4. Merges new data with existing, deduplicates by date
5. Skips tickers already up-to-date (last_date >= today)

## Environment Variables

| Variable         | Description                                      |
|------------------|--------------------------------------------------|
| `TIINGO_API_KEY` | Required for Tiingo API access                   |

## CLI Options

```
--tickers-file       Path to tickers.txt (line-separated ticker symbols)
--tickers-json       Path to tickers.json (alternative format)
--out-dir            Output directory for parquet files (required)
--batch-size         Tickers per yfinance batch (default: 100)
--sleep-seconds      Delay between API calls (default: 2.0)
--max-retries        Retry attempts for failed downloads (default: 3)
--start-date         Start date for full downloads (default: 1990-01-01)
--offset             Skip first N tickers (for resuming)
--limit              Only process N tickers (0 = no limit)
--no-metadata        Skip metadata fetches (faster)
--tiingo-only        Use Tiingo API for all downloads
--incremental        Only fetch new days since last date
--api-key            Tiingo API key (or use TIINGO_API_KEY env var)
```

## Production Setup (Hetzner Server)

**Server:** 178.156.221.28 (quantnexus-prod-new)
**SSH:** `ssh quantnexus` (configured in ~/.ssh/config)

### Ticker Lists

| File | Description |
|------|-------------|
| `tiingo_tickers.json` | Full Tiingo master list (~22k tickers) |
| `active_tickers.txt` | Active tickers only (~12k, traded in 2026) |
| `tickers.txt` | Custom subset for specific strategies |

### Initial Full Download (Yahoo Finance)

Uses yfinance batch downloads for speed. Run once to populate historical data:

```bash
cd /home/deploy/quantnexus/System.app/ticker-data
source /home/deploy/quantnexus/System.app/.env
python3 tiingo_download.py \
  --tickers-file active_tickers.txt \
  --out-dir data/ticker_data_parquet \
  --no-metadata
```

### Daily Incremental Updates (Cron)

Cron job runs at 11 PM UTC (6 PM EST) Mon-Fri after market close:

```bash
# Crontab entry (already configured)
0 23 * * 1-5 /home/deploy/quantnexus/System.app/ticker-data/daily-update.sh
```

**Script:** `/home/deploy/quantnexus/System.app/ticker-data/daily-update.sh`
**Logs:** `/home/deploy/quantnexus/logs/tiingo-update.log`
**Duration:** ~40 minutes (0.2s sleep, ~12k tickers)
**API Usage:** ~12k requests/day (8% of 150k daily limit)

### Monitoring

```bash
# Check if download is running
ssh quantnexus 'ps aux | grep tiingo_download'

# View recent logs
ssh quantnexus 'tail -50 /home/deploy/quantnexus/logs/tiingo-update.log'

# Check parquet file count
ssh quantnexus 'ls /home/deploy/quantnexus/System.app/ticker-data/data/ticker_data_parquet/*.parquet | wc -l'
```

## Output Format

The script outputs JSON lines for progress tracking:

```json
{"type": "start", "tickers": 500, "mode": "incremental"}
{"type": "ticker_saved", "ticker": "SPY", "mode": "incremental", "new_rows": 1, "total_rows": 8296}
{"type": "ticker_skipped", "ticker": "QQQ", "reason": "up_to_date", "last_date": "2026-01-13"}
{"type": "done", "saved": 50, "total": 500, "updated": 50, "skipped_up_to_date": 450}
```

## API Integration

The Express server (`server/index.mjs`) can trigger downloads via:

```
POST /api/download
```

This spawns the Python script as a child process and streams progress back to the client.

## Infrastructure

### Hetzner Cloud

- **Server:** quantnexus-prod-new (178.156.221.28)
- **Region:** Ashburn, VA (ash-dc1)
- **Specs:** CCX23 (4 cores, 16GB RAM, 160GB disk)
- **Firewall:** firewall-1 (ports 22, 80, 443, 3030, 8787)

### SSH Access

```bash
# SSH config (~/.ssh/config)
Host quantnexus
    HostName 178.156.221.28
    User deploy
    IdentityFile ~/.ssh/hetzner_quantnexus
```

### Hetzner CLI

```bash
# Context configured as 'quantnexus'
hcloud server list
hcloud server describe quantnexus-prod-new
```
