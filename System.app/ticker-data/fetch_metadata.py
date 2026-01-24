"""
Fetch ticker metadata (company names, descriptions) from Tiingo API

This script fetches only metadata without downloading OHLCV data.
Much faster than full data download for backfilling missing company names.

Usage:
    python fetch_metadata.py --tickers-json tickers.json --api-key YOUR_KEY --max-workers 100
"""

from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Optional

import requests


def _fetch_ticker_metadata(ticker: str, api_key: str) -> dict | None:
    """Fetch ticker metadata (name, description) from Tiingo."""
    url = f"https://api.tiingo.com/tiingo/daily/{ticker}"
    headers = {"Content-Type": "application/json"}
    params = {"token": api_key}

    try:
        resp = requests.get(url, headers=headers, params=params, timeout=30)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        data = resp.json()
        return {
            "name": data.get("name"),
            "description": data.get("description"),
            "exchangeCode": data.get("exchangeCode"),
        }
    except Exception:
        return None


def fetch_metadata_batch(
    tickers: list[str],
    api_key: str,
    max_workers: int = 100,
    progress_cb: Optional[callable] = None
) -> int:
    """Fetch metadata for tickers concurrently"""
    successful = 0
    failed = 0

    if progress_cb:
        progress_cb({"type": "start", "total": len(tickers), "mode": "metadata"})

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(_fetch_ticker_metadata, ticker, api_key): ticker
            for ticker in tickers
        }

        for future in as_completed(futures):
            ticker = futures[future]
            try:
                metadata = future.result()
                if metadata and (metadata.get("name") or metadata.get("description")):
                    successful += 1
                    if progress_cb:
                        progress_cb({
                            "type": "metadata_fetched",
                            "ticker": ticker,
                            "name": metadata.get("name"),
                            "description": metadata.get("description"),
                            "fetched": successful,
                            "total": len(tickers),
                        })
                else:
                    failed += 1
                    if progress_cb:
                        progress_cb({
                            "type": "metadata_not_found",
                            "ticker": ticker,
                            "fetched": successful,
                            "failed": failed,
                            "total": len(tickers),
                        })
            except Exception as e:
                failed += 1
                if progress_cb:
                    progress_cb({
                        "type": "error",
                        "ticker": ticker,
                        "error": str(e)[:200],
                        "fetched": successful,
                        "failed": failed,
                        "total": len(tickers),
                    })

    if progress_cb:
        progress_cb({
            "type": "complete",
            "successful": successful,
            "failed": failed,
            "total": len(tickers)
        })

    return successful


def main():
    parser = argparse.ArgumentParser(description="Fetch ticker metadata from Tiingo")
    parser.add_argument('--tickers-json', required=True, help='Path to JSON file with ticker list')
    parser.add_argument('--api-key', required=True, help='Tiingo API key')
    parser.add_argument('--max-workers', type=int, default=100, help='Concurrent workers (default: 100)')
    args = parser.parse_args()

    # Load tickers from JSON file
    tickers_path = Path(args.tickers_json)
    if not tickers_path.exists():
        print(json.dumps({"type": "error", "message": f"Tickers file not found: {args.tickers_json}"}), flush=True)
        return 1

    with open(tickers_path, 'r', encoding='utf-8') as f:
        tickers = json.load(f)

    if not isinstance(tickers, list):
        print(json.dumps({"type": "error", "message": "Tickers JSON must be an array"}), flush=True)
        return 1

    # Normalize tickers
    tickers = [t.upper().strip() for t in tickers if str(t).strip()]

    if not tickers:
        print(json.dumps({"type": "error", "message": "No tickers provided"}), flush=True)
        return 1

    # Progress callback that prints JSON events
    def progress_cb(event: dict):
        print(json.dumps(event), flush=True)

    # Fetch metadata
    successful = fetch_metadata_batch(
        tickers,
        args.api_key,
        max_workers=args.max_workers,
        progress_cb=progress_cb
    )

    return 0 if successful > 0 else 1


if __name__ == '__main__':
    sys.exit(main())
