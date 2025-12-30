from __future__ import annotations

import json
import os
import random
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from typing import Callable, Iterable, Optional

import pandas as pd
import requests

# Try to import yfinance for fallback
try:
    import yfinance as yf
    YFINANCE_AVAILABLE = True
except ImportError:
    YFINANCE_AVAILABLE = False


def read_tickers_from_txt(path: str | Path) -> list[str]:
    p = Path(path)
    if not p.is_file():
        raise FileNotFoundError(f"Tickers file not found: {p}")

    tickers: list[str] = []
    seen: set[str] = set()
    for raw in p.read_text(encoding="utf-8-sig", errors="ignore").splitlines():
        t = raw.replace("\ufeff", "").strip().upper()
        if not t:
            continue
        if t not in seen:
            seen.add(t)
            tickers.append(t)
    if not tickers:
        raise ValueError(f"No tickers found in {p}")
    return tickers


def read_tickers_from_json(path: str | Path) -> list[str]:
    """Read tickers from a JSON file (array of strings or array of objects with 'ticker' key)."""
    p = Path(path)
    if not p.is_file():
        raise FileNotFoundError(f"Tickers JSON file not found: {p}")

    data = json.loads(p.read_text(encoding="utf-8"))
    tickers: list[str] = []
    seen: set[str] = set()

    for item in data:
        if isinstance(item, str):
            t = item.strip().upper()
        elif isinstance(item, dict) and "ticker" in item:
            t = str(item["ticker"]).strip().upper()
        else:
            continue

        if t and t not in seen:
            seen.add(t)
            tickers.append(t)

    return tickers


def ensure_dir(path: str | Path) -> Path:
    p = Path(path)
    p.mkdir(parents=True, exist_ok=True)
    return p


@dataclass(frozen=True)
class DownloadConfig:
    batch_size: int = 50  # Number of concurrent downloads
    sleep_seconds: float = 0.05  # Sleep between batches (reduced for parallel)
    max_retries: int = 3
    start_date: str = "1990-01-01"
    max_workers: int = 20  # Number of parallel download threads


def _get_api_key(cli_key: str | None = None) -> str:
    """Get Tiingo API key from CLI arg or environment."""
    key = cli_key or os.environ.get("TIINGO_API_KEY", "")
    if not key:
        raise ValueError(
            "TIINGO_API_KEY not set. Either pass --api-key or set TIINGO_API_KEY environment variable."
        )
    return key


def _download_ticker(ticker: str, api_key: str, cfg: DownloadConfig) -> pd.DataFrame:
    """Download historical data for a single ticker from Tiingo."""
    url = f"https://api.tiingo.com/tiingo/daily/{ticker}/prices"
    headers = {
        "Content-Type": "application/json",
    }
    params = {
        "token": api_key,
        "startDate": cfg.start_date,
        "format": "json",
    }

    last_exc: Exception | None = None
    for attempt in range(1, cfg.max_retries + 1):
        try:
            resp = requests.get(url, headers=headers, params=params, timeout=60)
            if resp.status_code == 404:
                # Ticker not found
                return pd.DataFrame()
            resp.raise_for_status()
            data = resp.json()
            if not data:
                return pd.DataFrame()
            return pd.DataFrame(data)
        except Exception as e:
            last_exc = e
            if attempt >= cfg.max_retries:
                break
            backoff = (cfg.sleep_seconds * (2 ** (attempt - 1))) + random.uniform(0.0, 0.3)
            time.sleep(backoff)

    if last_exc is not None:
        raise last_exc
    return pd.DataFrame()


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


def _normalize_tiingo_df(df: pd.DataFrame, ticker: str) -> pd.DataFrame:
    """Convert Tiingo response to match existing Parquet schema."""
    if df.empty:
        return pd.DataFrame(columns=["Date", "ticker", "Open", "High", "Low", "Close", "Adj Close", "Volume"])

    # Tiingo columns: date, open, high, low, close, volume, adjOpen, adjHigh, adjLow, adjClose, adjVolume, divCash, splitFactor
    work = df.copy()

    # Parse date
    work["Date"] = pd.to_datetime(work["date"])

    # Build output with expected column names
    out = pd.DataFrame({
        "Date": work["Date"],
        "ticker": ticker.upper(),
        "Open": work.get("open"),
        "High": work.get("high"),
        "Low": work.get("low"),
        "Close": work.get("close"),
        "Adj Close": work.get("adjClose"),
        "Volume": work.get("volume"),
    })

    return out[["Date", "ticker", "Open", "High", "Low", "Close", "Adj Close", "Volume"]]


def _download_ticker_yfinance(ticker: str, cfg: DownloadConfig) -> pd.DataFrame:
    """Fallback: Download historical data for a single ticker from Yahoo Finance."""
    if not YFINANCE_AVAILABLE:
        return pd.DataFrame()

    try:
        df = yf.download(
            ticker,
            period="max",
            auto_adjust=False,
            progress=False,
            timeout=60,
        )
        if df is None or df.empty:
            return pd.DataFrame()

        # Handle MultiIndex columns from yfinance (happens with single ticker)
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)

        # Normalize yfinance output
        df = df.rename_axis("Date").reset_index()
        df["ticker"] = ticker.upper()

        cols = ["Date", "ticker", "Open", "High", "Low", "Close", "Adj Close", "Volume"]
        for c in cols:
            if c not in df.columns:
                df[c] = None

        return df[cols]
    except Exception:
        return pd.DataFrame()


def _process_single_ticker(
    ticker: str,
    api_key: str,
    cfg: DownloadConfig,
    out_root: Path,
    skip_metadata: set[str],
) -> dict:
    """Process a single ticker - download, normalize, save. Returns result dict."""
    result = {"ticker": ticker, "success": False, "path": None, "source": None, "metadata": None, "error": None}

    normalized: pd.DataFrame | None = None
    source_used = "tiingo"

    # Try Tiingo first
    try:
        df = _download_ticker(ticker, api_key, cfg)
        if df is not None and not df.empty:
            normalized = _normalize_tiingo_df(df, ticker)
    except Exception as e:
        result["error"] = f"tiingo: {str(e)}"

    # Fallback to Yahoo Finance if Tiingo failed or returned no data
    if (normalized is None or normalized.empty) and YFINANCE_AVAILABLE:
        try:
            normalized = _download_ticker_yfinance(ticker, cfg)
            if normalized is not None and not normalized.empty:
                source_used = "yfinance"
                result["error"] = None  # Clear error if yfinance succeeded
        except Exception as e2:
            if result["error"]:
                result["error"] += f", yfinance: {str(e2)}"
            else:
                result["error"] = f"yfinance: {str(e2)}"

    # Skip if still no data
    if normalized is None or normalized.empty:
        result["error"] = result["error"] or "no data from tiingo or yfinance"
        return result

    # Save the parquet file
    try:
        out_path = out_root / f"{ticker}.parquet"
        normalized.to_parquet(out_path, index=False)
        result["success"] = True
        result["path"] = str(out_path)
        result["source"] = source_used

        # Fetch metadata (name, description) only if not already saved
        if source_used == "tiingo" and ticker not in skip_metadata:
            metadata = _fetch_ticker_metadata(ticker, api_key)
            if metadata:
                result["metadata"] = metadata
    except Exception as e:
        result["error"] = f"save: {str(e)}"

    return result


def download_to_parquet(
    tickers: Iterable[str],
    *,
    out_dir: str | Path,
    cfg: DownloadConfig,
    api_key: str | None = None,
    progress_cb: Optional[Callable[[dict], None]] = None,
    skip_metadata: Optional[set[str]] = None,
) -> list[Path]:
    """Download ticker data from Tiingo and save as Parquet files using parallel downloads."""
    out_root = ensure_dir(out_dir)
    tickers_list = [t.upper().strip() for t in tickers if str(t).strip()]
    out_paths: list[Path] = []
    skip_set = skip_metadata or set()

    api_key = _get_api_key(api_key)

    total_tickers = len(tickers_list)
    num_batches = (total_tickers + cfg.batch_size - 1) // cfg.batch_size

    if progress_cb:
        progress_cb({"type": "start", "tickers": total_tickers, "batches": num_batches, "workers": cfg.max_workers})

    # Process in batches for better progress reporting
    saved_count = 0
    lock = Lock()

    for batch_idx in range(num_batches):
        batch_start = batch_idx * cfg.batch_size
        batch_end = min(batch_start + cfg.batch_size, total_tickers)
        batch = tickers_list[batch_start:batch_end]

        if progress_cb:
            progress_cb({
                "type": "batch_start",
                "batch_index": batch_idx + 1,
                "batches_total": num_batches,
                "batch_size": len(batch),
                "tickers_in_batch": batch[:5],  # Show first 5 tickers
            })

        # Download batch in parallel
        batch_results = []
        with ThreadPoolExecutor(max_workers=cfg.max_workers) as executor:
            futures = {
                executor.submit(_process_single_ticker, ticker, api_key, cfg, out_root, skip_set): ticker
                for ticker in batch
            }

            for future in as_completed(futures):
                result = future.result()
                batch_results.append(result)

                if result["success"]:
                    with lock:
                        saved_count += 1
                        out_paths.append(Path(result["path"]))

                    save_event = {
                        "type": "ticker_saved",
                        "ticker": result["ticker"],
                        "path": result["path"],
                        "saved": saved_count,
                        "total": total_tickers,
                        "source": result["source"],
                    }
                    if result["metadata"]:
                        save_event["name"] = result["metadata"].get("name")
                        save_event["description"] = result["metadata"].get("description")

                    if progress_cb:
                        progress_cb(save_event)
                else:
                    if progress_cb:
                        progress_cb({
                            "type": "ticker_skipped",
                            "ticker": result["ticker"],
                            "reason": result["error"],
                        })

        # Brief pause between batches to avoid overwhelming the API
        if batch_idx < num_batches - 1:
            time.sleep(cfg.sleep_seconds)

    if progress_cb:
        progress_cb({"type": "done", "saved": len(out_paths), "total": total_tickers})

    return out_paths


def _cli() -> int:
    import argparse

    ap = argparse.ArgumentParser(description="Download OHLCV via Tiingo API to per-ticker Parquet files.")
    ap.add_argument("--tickers-file", help="Path to tickers.txt (line-separated)")
    ap.add_argument("--tickers-json", help="Path to tickers.json (from sync_tickers.py)")
    ap.add_argument("--out-dir", required=True, help="Output directory for <TICKER>.parquet files")
    ap.add_argument("--batch-size", type=int, default=50, help="Number of tickers per batch")
    ap.add_argument("--sleep-seconds", type=float, default=0.05, help="Sleep between batches")
    ap.add_argument("--max-retries", type=int, default=3)
    ap.add_argument("--workers", type=int, default=20, help="Number of parallel download threads")
    ap.add_argument("--limit", type=int, default=0, help="0 = no limit")
    ap.add_argument("--offset", type=int, default=0, help="Skip first N tickers (for resuming)")
    ap.add_argument("--start-date", type=str, default="1990-01-01", help="Start date for historical data")
    ap.add_argument("--api-key", type=str, default=None, help="Tiingo API key (or set TIINGO_API_KEY env var)")
    ap.add_argument("--skip-metadata-json", type=str, default=None, help="JSON file with tickers to skip metadata fetch for")
    args = ap.parse_args()

    # Load tickers from either txt or json
    if args.tickers_json:
        tickers = read_tickers_from_json(args.tickers_json)
    elif args.tickers_file:
        tickers = read_tickers_from_txt(args.tickers_file)
    else:
        print(json.dumps({"type": "error", "message": "Either --tickers-file or --tickers-json is required"}))
        return 1

    # Apply offset (for resuming)
    if int(args.offset) > 0:
        tickers = tickers[int(args.offset):]

    # Apply limit
    if int(args.limit) > 0:
        tickers = tickers[: int(args.limit)]

    if not tickers:
        print(json.dumps({"type": "complete", "saved": 0, "message": "No tickers to process"}))
        return 0

    # Load skip-metadata set (tickers that already have metadata saved)
    skip_metadata_set: set[str] = set()
    if args.skip_metadata_json:
        try:
            skip_tickers = read_tickers_from_json(args.skip_metadata_json)
            skip_metadata_set = set(skip_tickers)
            print(json.dumps({"type": "info", "message": f"Skipping metadata fetch for {len(skip_metadata_set)} tickers that already have it"}), flush=True)
        except Exception as e:
            print(json.dumps({"type": "warning", "message": f"Could not load skip-metadata file: {e}"}), flush=True)

    cfg = DownloadConfig(
        batch_size=int(args.batch_size),
        sleep_seconds=float(args.sleep_seconds),
        max_retries=int(args.max_retries),
        start_date=args.start_date,
        max_workers=int(args.workers),
    )

    def cb(ev: dict) -> None:
        print(json.dumps(ev), flush=True)

    out = download_to_parquet(tickers, out_dir=args.out_dir, cfg=cfg, api_key=args.api_key, progress_cb=cb, skip_metadata=skip_metadata_set)
    print(json.dumps({"type": "complete", "saved": len(out)}), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(_cli())
