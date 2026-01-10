"""
Tiingo Ticker Registry Sync Script

Downloads Tiingo's supported_tickers.csv and outputs filtered tickers as JSON
for the server to import into the ticker_registry table.

Usage:
    python sync_tickers.py --output tickers.json --us-only
    python sync_tickers.py --output tickers.json --all
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import zipfile
from pathlib import Path
from typing import Optional

import requests


TIINGO_TICKERS_URL = "https://apimedia.tiingo.com/docs/tiingo/daily/supported_tickers.zip"

# US exchanges to include
US_EXCHANGES = frozenset([
    "NYSE", "NASDAQ", "AMEX", "ARCA", "BATS",
    "NYSE ARCA", "NYSE MKT", "NYSE AMERICAN",
    "NASDAQ GM", "NASDAQ GS", "NASDAQ CM",
])

# Asset types to include (exclude Mutual Funds)
ALLOWED_ASSET_TYPES = frozenset(["Stock", "ETF"])


def download_supported_tickers() -> list[dict]:
    """Download and parse Tiingo's supported_tickers.zip"""
    print(f"Downloading {TIINGO_TICKERS_URL}...")
    resp = requests.get(TIINGO_TICKERS_URL, timeout=120)
    resp.raise_for_status()

    print("Extracting CSV...")
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        # Find the CSV file in the zip
        csv_name = None
        for name in zf.namelist():
            if name.endswith('.csv'):
                csv_name = name
                break

        if not csv_name:
            raise ValueError("No CSV file found in zip")

        with zf.open(csv_name) as f:
            content = f.read().decode('utf-8')

    # Parse CSV
    reader = csv.DictReader(io.StringIO(content))
    tickers = list(reader)
    print(f"Parsed {len(tickers)} tickers from Tiingo")
    return tickers


def filter_us_tickers(tickers: list[dict]) -> list[dict]:
    """Filter to US exchanges with USD currency and allowed asset types (Stock/ETF only)"""
    filtered = []
    for t in tickers:
        exchange = (t.get('exchange') or '').upper()
        currency = (t.get('priceCurrency') or '').upper()
        asset_type = t.get('assetType') or ''

        # Check if exchange matches any US exchange
        is_us = any(us_ex in exchange for us_ex in US_EXCHANGES)

        # Check if asset type is allowed (exclude Mutual Funds)
        is_allowed_type = asset_type in ALLOWED_ASSET_TYPES

        if is_us and currency == 'USD' and is_allowed_type:
            filtered.append(t)

    print(f"Filtered to {len(filtered)} US/USD Stock+ETF tickers (excluded Mutual Funds)")
    return filtered


def filter_active_tickers(tickers: list[dict]) -> list[dict]:
    """Filter to tickers that have data (non-empty start/end dates)"""
    filtered = []
    for t in tickers:
        start = t.get('startDate') or ''
        # Include if has a start date (meaning there's historical data)
        if start:
            filtered.append(t)

    print(f"Filtered to {len(filtered)} tickers with historical data")
    return filtered


def main():
    parser = argparse.ArgumentParser(description="Sync Tiingo ticker list")
    parser.add_argument('--output', '-o', type=str, default='tiingo_tickers.json',
                        help='Output JSON file path')
    parser.add_argument('--us-only', action='store_true', default=True,
                        help='Only include US exchanges (default: True)')
    parser.add_argument('--all', dest='us_only', action='store_false',
                        help='Include all exchanges')
    parser.add_argument('--active-only', action='store_true', default=True,
                        help='Only include tickers with historical data')
    parser.add_argument('--stats', action='store_true',
                        help='Print stats and exit without saving')
    args = parser.parse_args()

    # Download
    tickers = download_supported_tickers()

    # Filter
    if args.us_only:
        tickers = filter_us_tickers(tickers)

    if args.active_only:
        tickers = filter_active_tickers(tickers)

    # Print stats
    if args.stats:
        exchanges = {}
        asset_types = {}
        for t in tickers:
            ex = t.get('exchange', 'Unknown')
            at = t.get('assetType', 'Unknown')
            exchanges[ex] = exchanges.get(ex, 0) + 1
            asset_types[at] = asset_types.get(at, 0) + 1

        print("\n=== Exchange Distribution ===")
        for ex, count in sorted(exchanges.items(), key=lambda x: -x[1])[:20]:
            print(f"  {ex}: {count}")

        print("\n=== Asset Type Distribution ===")
        for at, count in sorted(asset_types.items(), key=lambda x: -x[1]):
            print(f"  {at}: {count}")

        print(f"\nTotal: {len(tickers)} tickers")
        return 0

    # Save
    output_path = Path(args.output)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(tickers, f)

    print(f"Saved {len(tickers)} tickers to {output_path}")

    # Also output summary
    print(json.dumps({
        "type": "complete",
        "count": len(tickers),
        "output": str(output_path)
    }))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
