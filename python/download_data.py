"""
Download historical data from yfinance and save as parquet files.
"""

import sys
import json
import yfinance as yf
import pandas as pd
from pathlib import Path
from datetime import datetime, timedelta

def download_ticker(ticker: str, start_date: str = None, end_date: str = None, output_dir: str = None):
    """
    Download historical data for a single ticker.

    Args:
        ticker: Stock/ETF symbol
        start_date: Start date (YYYY-MM-DD), defaults to 10 years ago
        end_date: End date (YYYY-MM-DD), defaults to today
        output_dir: Output directory, defaults to ../data/parquet

    Returns:
        dict with status and file_path or error
    """
    try:
        # Default dates
        if end_date is None:
            end_date = datetime.now().strftime('%Y-%m-%d')
        if start_date is None:
            start_date = (datetime.now() - timedelta(days=3650)).strftime('%Y-%m-%d')  # 10 years

        # Default output directory
        if output_dir is None:
            output_dir = Path(__file__).parent.parent / 'data' / 'parquet'
        else:
            output_dir = Path(output_dir)

        output_dir.mkdir(parents=True, exist_ok=True)

        # Download data
        print(f"Downloading {ticker} from {start_date} to {end_date}...", file=sys.stderr)
        data = yf.download(ticker, start=start_date, end=end_date, progress=False)

        if data.empty:
            return {
                'success': False,
                'error': f'No data found for {ticker}'
            }

        # Clean data
        data = data.reset_index()

        # Rename columns to standard format
        data.columns = ['Date', 'Open', 'High', 'Low', 'Close', 'Adj Close', 'Volume']

        # Save as parquet
        output_file = output_dir / f'{ticker}.parquet'
        data.to_parquet(output_file, index=False, engine='fastparquet')

        print(f"Saved {len(data)} rows to {output_file}", file=sys.stderr)

        return {
            'success': True,
            'file_path': str(output_file),
            'rows': len(data),
            'start_date': data['Date'].min().strftime('%Y-%m-%d'),
            'end_date': data['Date'].max().strftime('%Y-%m-%d')
        }

    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }

def download_multiple(tickers: list, start_date: str = None, end_date: str = None, output_dir: str = None):
    """
    Download data for multiple tickers.

    Returns:
        dict with results for each ticker
    """
    results = {}
    for ticker in tickers:
        results[ticker] = download_ticker(ticker, start_date, end_date, output_dir)
    return results

if __name__ == '__main__':
    # CLI interface for Node.js to call
    # Usage: python download_data.py '{"ticker": "SPY", "start_date": "2020-01-01"}'

    if len(sys.argv) > 1:
        # Parse JSON input from command line
        params = json.loads(sys.argv[1])

        if 'tickers' in params:
            # Multiple tickers
            result = download_multiple(
                params['tickers'],
                params.get('start_date'),
                params.get('end_date'),
                params.get('output_dir')
            )
        else:
            # Single ticker
            result = download_ticker(
                params['ticker'],
                params.get('start_date'),
                params.get('end_date'),
                params.get('output_dir')
            )

        # Output JSON result for Node.js to parse
        print(json.dumps(result))
    else:
        # Interactive mode
        print("Usage: python download_data.py '{\"ticker\": \"SPY\"}'")
        print("Or import and use download_ticker() function")
