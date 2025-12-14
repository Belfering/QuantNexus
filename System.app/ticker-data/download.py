from __future__ import annotations

import random
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, Optional

import pandas as pd
import yfinance as yf


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


def ensure_dir(path: str | Path) -> Path:
    p = Path(path)
    p.mkdir(parents=True, exist_ok=True)
    return p


def _chunked(seq: list[str], size: int) -> list[list[str]]:
    return [seq[i : i + size] for i in range(0, len(seq), size)]


def _normalize_single_ticker_df(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    out = df.copy()
    out = out.rename_axis("Date").reset_index()
    cols = [c for c in ["Date", "Open", "High", "Low", "Close", "Adj Close", "Volume"] if c in out.columns]
    return out[cols]


def _extract_one_from_multi(df_multi: pd.DataFrame, ticker: str) -> pd.DataFrame:
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


@dataclass(frozen=True)
class DownloadConfig:
    batch_size: int = 100
    sleep_seconds: float = 2.0
    max_retries: int = 3
    period: str = "max"
    auto_adjust: bool = False
    threads: bool = True


def _download_batch(batch: list[str], cfg: DownloadConfig) -> pd.DataFrame:
    last_exc: Exception | None = None
    for attempt in range(1, cfg.max_retries + 1):
        try:
            return yf.download(
                batch if len(batch) > 1 else batch[0],
                period=cfg.period,
                auto_adjust=cfg.auto_adjust,
                progress=False,
                group_by="ticker",
                threads=cfg.threads,
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


def download_to_parquet(
    tickers: Iterable[str],
    *,
    out_dir: str | Path,
    cfg: DownloadConfig,
    progress_cb: Optional[Callable[[dict], None]] = None,
) -> list[Path]:
    out_root = ensure_dir(out_dir)
    tickers_list = [t.upper().strip() for t in tickers if str(t).strip()]
    out_paths: list[Path] = []

    batches = _chunked(tickers_list, cfg.batch_size)
    if progress_cb:
        progress_cb({"type": "start", "tickers": len(tickers_list), "batches": len(batches)})

    for i, batch in enumerate(batches, start=1):
        if progress_cb:
            progress_cb({"type": "batch_start", "batch_index": i, "batches_total": len(batches), "batch_size": len(batch)})
        df_batch = _download_batch(batch, cfg)

        for t in batch:
            df_t = _normalize_single_ticker_df(df_batch) if len(batch) == 1 else _extract_one_from_multi(df_batch, t)
            if df_t is None or df_t.empty:
                continue
            base = build_ticker_base_frame(t, df_t)
            if base.empty:
                continue
            out_path = out_root / f"{t}.parquet"
            base.to_parquet(out_path, index=False)
            out_paths.append(out_path)
            if progress_cb:
                progress_cb({"type": "ticker_saved", "ticker": t, "path": str(out_path), "saved": len(out_paths)})

        if i < len(batches):
            time.sleep(cfg.sleep_seconds + random.uniform(0.0, 0.5))

    if progress_cb:
        progress_cb({"type": "done", "saved": len(out_paths)})
    return out_paths


def _cli() -> int:
    import argparse
    import json

    ap = argparse.ArgumentParser(description="Download OHLCV via yfinance to per-ticker Parquet files.")
    ap.add_argument("--tickers-file", required=True, help="Path to tickers.txt")
    ap.add_argument("--out-dir", required=True, help="Output directory for <TICKER>.parquet files")
    ap.add_argument("--batch-size", type=int, default=100)
    ap.add_argument("--sleep-seconds", type=float, default=2.0)
    ap.add_argument("--max-retries", type=int, default=3)
    ap.add_argument("--threads", type=int, default=1, help="1=true, 0=false")
    ap.add_argument("--limit", type=int, default=0, help="0 = no limit")
    args = ap.parse_args()

    tickers = read_tickers_from_txt(args.tickers_file)
    if int(args.limit) > 0:
        tickers = tickers[: int(args.limit)]

    cfg = DownloadConfig(
        batch_size=int(args.batch_size),
        sleep_seconds=float(args.sleep_seconds),
        max_retries=int(args.max_retries),
        threads=bool(int(args.threads)),
    )

    def cb(ev: dict) -> None:
        print(json.dumps(ev), flush=True)

    out = download_to_parquet(tickers, out_dir=args.out_dir, cfg=cfg, progress_cb=cb)
    print(json.dumps({"type": "complete", "saved": len(out)}), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(_cli())
