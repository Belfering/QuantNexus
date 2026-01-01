from __future__ import annotations

import json
import os
import random
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, Optional

# Import tracking for diagnostics
_import_errors = []

try:
    import pandas as pd
except ImportError as e:
    _import_errors.append(f"pandas: {e}")
    pd = None

try:
    import requests
except ImportError as e:
    _import_errors.append(f"requests: {e}")
    requests = None

# yfinance for batch downloads
try:
    import yfinance as yf
    YFINANCE_AVAILABLE = True
except ImportError as e:
    YFINANCE_AVAILABLE = False
    _import_errors.append(f"yfinance: {e}")

# Print import status on startup
if _import_errors:
    print(json.dumps({"type": "import_errors", "errors": _import_errors}), flush=True)
else:
    print(json.dumps({"type": "imports_ok", "yfinance": YFINANCE_AVAILABLE, "python": sys.version}), flush=True)


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


def _sanitize_ticker_for_filename(ticker: str) -> str:
    """Sanitize ticker symbol for use as filename.
    Replaces / with _, removes other problematic chars.
    """
    # Replace / with _ (e.g., BC/PC -> BC_PC)
    safe = ticker.replace("/", "_")
    # Remove other problematic characters for Windows filenames
    for c in '<>:"|?*\\':
        safe = safe.replace(c, "_")
    return safe


def _chunked(seq: list[str], size: int) -> list[list[str]]:
    return [seq[i : i + size] for i in range(0, len(seq), size)]


@dataclass(frozen=True)
class DownloadConfig:
    batch_size: int = 100  # yfinance supports batch downloads
    sleep_seconds: float = 2.0  # Sleep between batches
    max_retries: int = 3
    start_date: str = "1990-01-01"
    period: str = "max"


def _get_api_key(cli_key: str | None = None) -> str:
    """Get Tiingo API key from CLI arg or environment."""
    key = cli_key or os.environ.get("TIINGO_API_KEY", "")
    if not key:
        raise ValueError(
            "TIINGO_API_KEY not set. Either pass --api-key or set TIINGO_API_KEY environment variable."
        )
    return key


def _normalize_single_ticker_df(df: pd.DataFrame) -> pd.DataFrame:
    """Normalize a single-ticker DataFrame from yfinance."""
    if df.empty:
        return df
    out = df.copy()
    out = out.rename_axis("Date").reset_index()
    cols = [c for c in ["Date", "Open", "High", "Low", "Close", "Adj Close", "Volume"] if c in out.columns]
    return out[cols]


def _extract_one_from_multi(df_multi: pd.DataFrame, ticker: str) -> pd.DataFrame:
    """Extract one ticker's data from a multi-ticker yfinance download."""
    if df_multi.empty:
        return df_multi
    if isinstance(df_multi.columns, pd.MultiIndex):
        if ticker in df_multi.columns.get_level_values(-1):
            sub = df_multi.xs(ticker, axis=1, level=-1, drop_level=True)
        else:
            try:
                sub = df_multi[ticker]
            except KeyError:
                return pd.DataFrame()
        return _normalize_single_ticker_df(sub)
    return _normalize_single_ticker_df(df_multi)


def build_ticker_base_frame(ticker: str, df_price: pd.DataFrame) -> pd.DataFrame:
    """Build standardized DataFrame with ticker column."""
    cols_out = ["Date", "ticker", "Open", "High", "Low", "Close", "Adj Close", "Volume"]
    if df_price.empty:
        return pd.DataFrame(columns=cols_out)

    work = df_price.copy()
    if "Date" in work.columns:
        work["Date"] = pd.to_datetime(work["Date"])
    else:
        work = work.rename_axis("Date").reset_index()
        work["Date"] = pd.to_datetime(work["Date"])

    out = pd.DataFrame(
        {
            "Date": work["Date"],
            "ticker": ticker.upper(),
            "Open": work.get("Open"),
            "High": work.get("High"),
            "Low": work.get("Low"),
            "Close": work.get("Close"),
            "Adj Close": work.get("Adj Close"),
            "Volume": work.get("Volume"),
        }
    )
    return out[cols_out]


def _download_batch_yfinance(batch: list[str], cfg: DownloadConfig) -> pd.DataFrame:
    """Download a batch of tickers using yfinance (supports 100+ at once)."""
    if not YFINANCE_AVAILABLE:
        return pd.DataFrame()

    last_exc: Exception | None = None
    for attempt in range(1, cfg.max_retries + 1):
        try:
            return yf.download(
                batch if len(batch) > 1 else batch[0],
                period=cfg.period,
                auto_adjust=False,
                progress=False,
                group_by="ticker",
                threads=True,
                timeout=60,
            )
        except Exception as e:
            last_exc = e
            if attempt >= cfg.max_retries:
                break
            backoff = (cfg.sleep_seconds * (2 ** (attempt - 1))) + random.uniform(0.0, 0.5)
            time.sleep(backoff)
    if last_exc is not None:
        raise last_exc
    return pd.DataFrame()


def _download_ticker_tiingo(ticker: str, api_key: str, cfg: DownloadConfig) -> pd.DataFrame:
    """Fallback: Download historical data for a single ticker from Tiingo."""
    url = f"https://api.tiingo.com/tiingo/daily/{ticker}/prices"
    headers = {"Content-Type": "application/json"}
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
            backoff = (0.5 * (2 ** (attempt - 1))) + random.uniform(0.0, 0.3)
            time.sleep(backoff)

    if last_exc is not None:
        raise last_exc
    return pd.DataFrame()


def _normalize_tiingo_df(df: pd.DataFrame, ticker: str) -> pd.DataFrame:
    """Convert Tiingo response to match existing Parquet schema."""
    if df.empty:
        return pd.DataFrame(columns=["Date", "ticker", "Open", "High", "Low", "Close", "Adj Close", "Volume"])

    work = df.copy()
    work["Date"] = pd.to_datetime(work["date"])

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


def download_to_parquet_tiingo_only(
    tickers: Iterable[str],
    *,
    out_dir: str | Path,
    cfg: DownloadConfig,
    api_key: str,
    progress_cb: Optional[Callable[[dict], None]] = None,
    skip_metadata: Optional[set[str]] = None,
    no_metadata: bool = False,
) -> list[Path]:
    """Download ALL ticker data directly from Tiingo API (no yfinance). Slower but more thorough."""
    out_root = ensure_dir(out_dir)
    tickers_list = [t.upper().strip() for t in tickers if str(t).strip()]
    out_paths: list[Path] = []
    skip_set = skip_metadata or set()

    if progress_cb:
        progress_cb({"type": "start", "tickers": len(tickers_list), "mode": "tiingo_only"})

    for i, t in enumerate(tickers_list, start=1):
        try:
            # Download price data from Tiingo
            df = _download_ticker_tiingo(t, api_key, cfg)
            if df is None or df.empty:
                if progress_cb:
                    progress_cb({"type": "ticker_skipped", "ticker": t, "reason": "no_data"})
                continue

            base = _normalize_tiingo_df(df, t)
            if base.empty:
                if progress_cb:
                    progress_cb({"type": "ticker_skipped", "ticker": t, "reason": "empty_frame"})
                continue

            safe_ticker = _sanitize_ticker_for_filename(t)
            out_path = out_root / f"{safe_ticker}.parquet"
            try:
                base.to_parquet(out_path, index=False)
                out_paths.append(out_path)

                # Fetch metadata from Tiingo
                metadata = None
                if not no_metadata and t not in skip_set:
                    metadata = _fetch_ticker_metadata(t, api_key)

                save_event = {
                    "type": "ticker_saved",
                    "ticker": t,
                    "path": str(out_path),
                    "saved": len(out_paths),
                    "total": len(tickers_list),
                    "source": "tiingo",
                }
                if metadata:
                    save_event["name"] = metadata.get("name")
                    save_event["description"] = metadata.get("description")

                if progress_cb:
                    progress_cb(save_event)
            except OSError as e:
                if progress_cb:
                    progress_cb({"type": "ticker_skipped", "ticker": t, "reason": f"file_error: {str(e)[:100]}"})

        except Exception as e:
            if progress_cb:
                progress_cb({"type": "ticker_skipped", "ticker": t, "reason": str(e)[:200]})

        # Sleep between API calls (respecting rate limits)
        if i < len(tickers_list):
            time.sleep(cfg.sleep_seconds + random.uniform(0.0, 0.1))

    if progress_cb:
        progress_cb({"type": "done", "saved": len(out_paths), "total": len(tickers_list)})

    return out_paths


def download_to_parquet(
    tickers: Iterable[str],
    *,
    out_dir: str | Path,
    cfg: DownloadConfig,
    api_key: str | None = None,
    progress_cb: Optional[Callable[[dict], None]] = None,
    skip_metadata: Optional[set[str]] = None,
    no_metadata: bool = False,
) -> list[Path]:
    """Download ticker data using yfinance batch downloads, with Tiingo fallback for missing data."""
    out_root = ensure_dir(out_dir)
    tickers_list = [t.upper().strip() for t in tickers if str(t).strip()]
    out_paths: list[Path] = []
    skip_set = skip_metadata or set()

    # Get Tiingo API key for metadata and fallback
    tiingo_key = None
    try:
        tiingo_key = _get_api_key(api_key)
    except ValueError:
        if progress_cb:
            progress_cb({"type": "warning", "message": "No Tiingo API key - metadata fetch disabled"})

    batches = _chunked(tickers_list, cfg.batch_size)
    if progress_cb:
        progress_cb({"type": "start", "tickers": len(tickers_list), "batches": len(batches), "batch_size": cfg.batch_size})

    for i, batch in enumerate(batches, start=1):
        if progress_cb:
            progress_cb({"type": "batch_start", "batch_index": i, "batches_total": len(batches), "batch_size": len(batch)})

        # Download batch using yfinance
        failed_tickers = []
        try:
            df_batch = _download_batch_yfinance(batch, cfg)
        except Exception as e:
            if progress_cb:
                progress_cb({"type": "batch_error", "batch_index": i, "error": str(e)})
            df_batch = pd.DataFrame()
            failed_tickers = batch[:]  # All failed, try Tiingo individually

        # Process each ticker from the batch
        for t in batch:
            if t in failed_tickers:
                continue  # Will be handled by Tiingo fallback below

            df_t = _normalize_single_ticker_df(df_batch) if len(batch) == 1 else _extract_one_from_multi(df_batch, t)
            if df_t is None or df_t.empty:
                failed_tickers.append(t)
                continue

            base = build_ticker_base_frame(t, df_t)
            if base.empty:
                failed_tickers.append(t)
                continue

            safe_ticker = _sanitize_ticker_for_filename(t)
            out_path = out_root / f"{safe_ticker}.parquet"
            try:
                base.to_parquet(out_path, index=False)
                out_paths.append(out_path)

                # Fetch metadata from Tiingo if we have a key, not in fast mode, and don't already have it
                metadata = None
                if tiingo_key and not no_metadata and t not in skip_set:
                    metadata = _fetch_ticker_metadata(t, tiingo_key)

                save_event = {
                    "type": "ticker_saved",
                    "ticker": t,
                    "path": str(out_path),
                    "saved": len(out_paths),
                    "source": "yfinance",
                }
                if metadata:
                    save_event["name"] = metadata.get("name")
                    save_event["description"] = metadata.get("description")

                if progress_cb:
                    progress_cb(save_event)
            except OSError as e:
                if progress_cb:
                    progress_cb({"type": "ticker_skipped", "ticker": t, "reason": f"file_error: {str(e)[:100]}"})

        # Tiingo fallback for tickers that failed in yfinance
        if failed_tickers and tiingo_key:
            if progress_cb:
                progress_cb({"type": "tiingo_fallback", "tickers": len(failed_tickers)})

            for t in failed_tickers:
                try:
                    df = _download_ticker_tiingo(t, tiingo_key, cfg)
                    if df is not None and not df.empty:
                        base = _normalize_tiingo_df(df, t)
                        if not base.empty:
                            safe_ticker = _sanitize_ticker_for_filename(t)
                            out_path = out_root / f"{safe_ticker}.parquet"
                            try:
                                base.to_parquet(out_path, index=False)
                                out_paths.append(out_path)

                                metadata = None
                                if not no_metadata and t not in skip_set:
                                    metadata = _fetch_ticker_metadata(t, tiingo_key)

                                save_event = {
                                    "type": "ticker_saved",
                                    "ticker": t,
                                    "path": str(out_path),
                                    "saved": len(out_paths),
                                    "source": "tiingo",
                                }
                                if metadata:
                                    save_event["name"] = metadata.get("name")
                                    save_event["description"] = metadata.get("description")

                                if progress_cb:
                                    progress_cb(save_event)
                            except OSError as e:
                                if progress_cb:
                                    progress_cb({"type": "ticker_skipped", "ticker": t, "reason": f"file_error: {str(e)[:100]}"})
                    else:
                        # No data from Tiingo either
                        if progress_cb:
                            progress_cb({"type": "ticker_skipped", "ticker": t, "reason": "no_data"})
                except Exception as e:
                    if progress_cb:
                        progress_cb({"type": "ticker_skipped", "ticker": t, "reason": str(e)[:200]})

        # Sleep between batches
        if i < len(batches):
            time.sleep(cfg.sleep_seconds + random.uniform(0.0, 0.5))

    if progress_cb:
        progress_cb({"type": "done", "saved": len(out_paths), "total": len(tickers_list)})

    return out_paths


def _cli() -> int:
    import argparse

    ap = argparse.ArgumentParser(description="Download OHLCV via yfinance (batch) with Tiingo fallback to per-ticker Parquet files.")
    ap.add_argument("--tickers-file", help="Path to tickers.txt (line-separated)")
    ap.add_argument("--tickers-json", help="Path to tickers.json (from sync_tickers.py)")
    ap.add_argument("--out-dir", required=True, help="Output directory for <TICKER>.parquet files")
    ap.add_argument("--batch-size", type=int, default=100, help="Number of tickers per batch (yfinance supports 100+)")
    ap.add_argument("--sleep-seconds", type=float, default=2.0, help="Sleep between batches")
    ap.add_argument("--max-retries", type=int, default=3)
    ap.add_argument("--threads", type=int, default=1, help="Ignored (kept for compatibility)")
    ap.add_argument("--limit", type=int, default=0, help="0 = no limit")
    ap.add_argument("--offset", type=int, default=0, help="Skip first N tickers (for resuming)")
    ap.add_argument("--start-date", type=str, default="1990-01-01", help="Start date for Tiingo fallback")
    ap.add_argument("--api-key", type=str, default=None, help="Tiingo API key (or set TIINGO_API_KEY env var)")
    ap.add_argument("--skip-metadata-json", type=str, default=None, help="JSON file with tickers to skip metadata fetch for")
    ap.add_argument("--no-metadata", action="store_true", help="Skip ALL metadata fetches (fast bulk mode)")
    ap.add_argument("--tiingo-only", action="store_true", help="Download ALL tickers directly from Tiingo API (no yfinance batch)")
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
    )

    def cb(ev: dict) -> None:
        print(json.dumps(ev), flush=True)

    try:
        if args.tiingo_only:
            # Tiingo-only mode: download ALL tickers directly from Tiingo API (slower but thorough)
            out = download_to_parquet_tiingo_only(
                tickers,
                out_dir=args.out_dir,
                cfg=cfg,
                api_key=args.api_key,
                progress_cb=cb,
                skip_metadata=skip_metadata_set,
                no_metadata=args.no_metadata,
            )
        else:
            # Default mode: yFinance batch + Tiingo fallback for failed tickers
            out = download_to_parquet(tickers, out_dir=args.out_dir, cfg=cfg, api_key=args.api_key, progress_cb=cb, skip_metadata=skip_metadata_set, no_metadata=args.no_metadata)
        print(json.dumps({"type": "complete", "saved": len(out)}), flush=True)
        return 0
    except Exception as e:
        import traceback
        print(json.dumps({"type": "fatal_error", "error": str(e), "traceback": traceback.format_exc()}), flush=True)
        return 1


if __name__ == "__main__":
    try:
        raise SystemExit(_cli())
    except Exception as e:
        import traceback
        print(json.dumps({"type": "startup_error", "error": str(e), "traceback": traceback.format_exc()}), flush=True)
        raise SystemExit(1)
