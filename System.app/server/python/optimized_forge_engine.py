"""
Optimized Forge Engine with Parallel Processing

This is the main entry point for high-performance branch generation.
Uses multiprocessing to parallelize across all CPU cores.

Performance target: 100-500 branches/second per core (800-4000 branches/sec on 8 cores)
"""

import sys
import json
import time
import multiprocessing as mp
from multiprocessing import Pool, Queue, Manager
from typing import List, Dict
import numpy as np
from pathlib import Path

from vectorized_backtester import batch_backtest_branches
from optimized_dataloader import get_global_cache
from database_writer import AtlasDatabase

# Get absolute paths
SCRIPT_DIR = Path(__file__).parent.absolute()
PROJECT_ROOT = SCRIPT_DIR.parent
DATA_DIR = PROJECT_ROOT / 'data' / 'parquet'
DB_PATH = PROJECT_ROOT / 'data' / 'json' / 'db.json'


def worker_process_ticker(args):
    """
    Worker function to process all branches for a single ticker.

    This runs in a separate process and returns passing branches.

    Args:
        args: Tuple of (ticker, config, worker_id)

    Returns:
        List of passing branch results
    """
    ticker, config, worker_id = args

    try:
        # Extract config
        indicator = config['indicator']
        period_min = config['periodMin']
        period_max = config['periodMax']
        comparators = []
        if config['comparator'] in ['LT', 'BOTH']:
            comparators.append('LT')
        if config['comparator'] in ['GT', 'BOTH']:
            comparators.append('GT')

        threshold_min = config['thresholdMin']
        threshold_max = config['thresholdMax']
        threshold_step = config['thresholdStep']

        min_tim = config['minTIM']
        min_timar = config['minTIMAR']
        max_dd = config['maxDD']
        min_trades = config['minTrades']

        # Generate ranges
        period_range = list(range(period_min, period_max + 1))
        threshold_range = list(range(threshold_min, threshold_max + 1, threshold_step))

        print(f"[Worker {worker_id}] Processing {ticker}: {len(period_range)} periods × {len(comparators)} comparators × {len(threshold_range)} thresholds = {len(period_range) * len(comparators) * len(threshold_range)} branches", file=sys.stderr)

        # Run batch backtest (optimized!)
        results = batch_backtest_branches(
            ticker=ticker,
            indicator_name=indicator,
            period_range=period_range,
            comparator_list=comparators,
            threshold_range=threshold_range,
            data_dir=str(DATA_DIR),
            min_tim=min_tim,
            min_timar=min_timar,
            max_dd=max_dd,
            min_trades=min_trades,
        )

        print(f"[Worker {worker_id}] {ticker} completed: {len(results)} passing branches", file=sys.stderr)

        return results

    except Exception as e:
        print(f"[Worker {worker_id}] Error processing {ticker}: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return []


def run_forge_optimized(config: Dict, progress_callback=None):
    """
    Run optimized forge with parallel processing.

    Args:
        config: Forge configuration dictionary
        progress_callback: Optional callback function(completed, total, passing)

    Returns:
        Dictionary with results and statistics
    """
    start_time = time.perf_counter()

    # Extract config
    tickers = config['tickers']
    num_workers = config.get('numWorkers') or mp.cpu_count()

    print(f"Starting optimized forge with {num_workers} workers...", file=sys.stderr)
    print(f"Tickers: {len(tickers)}", file=sys.stderr)

    # Calculate total branches
    period_range = range(config['periodMin'], config['periodMax'] + 1)
    comparator_count = 2 if config['comparator'] == 'BOTH' else 1
    threshold_range = range(config['thresholdMin'], config['thresholdMax'] + 1, config['thresholdStep'])

    branches_per_ticker = len(period_range) * comparator_count * len(threshold_range)
    total_branches = branches_per_ticker * len(tickers)

    print(f"Total branches to test: {total_branches:,}", file=sys.stderr)
    print(f"Branches per ticker: {branches_per_ticker:,}", file=sys.stderr)

    # Prepare worker arguments
    worker_args = [(ticker, config, i % num_workers) for i, ticker in enumerate(tickers)]

    # Run parallel processing
    all_results = []
    completed_tickers = 0

    with Pool(processes=num_workers) as pool:
        # Use imap_unordered for progress tracking
        for ticker_results in pool.imap_unordered(worker_process_ticker, worker_args):
            all_results.extend(ticker_results)
            completed_tickers += 1

            # Progress callback
            if progress_callback:
                completed_branches = completed_tickers * branches_per_ticker
                progress_callback(completed_branches, total_branches, len(all_results))

            # Print progress
            if completed_tickers % 10 == 0:
                elapsed = time.perf_counter() - start_time
                rate = completed_tickers / elapsed if elapsed > 0 else 0
                eta = (len(tickers) - completed_tickers) / rate if rate > 0 else 0
                print(f"Progress: {completed_tickers}/{len(tickers)} tickers ({completed_tickers/len(tickers)*100:.1f}%), {len(all_results)} passing, Rate: {rate:.1f} tickers/sec, ETA: {eta:.0f}s", file=sys.stderr)

    elapsed_time = time.perf_counter() - start_time

    # Statistics
    stats = {
        'totalBranches': total_branches,
        'completedBranches': total_branches,
        'passingBranches': len(all_results),
        'elapsedSeconds': elapsed_time,
        'branchesPerSecond': total_branches / elapsed_time if elapsed_time > 0 else 0,
        'tickersProcessed': len(tickers),
        'workers': num_workers,
    }

    print(f"\n=== FORGE COMPLETED ===", file=sys.stderr)
    print(f"Total branches: {total_branches:,}", file=sys.stderr)
    print(f"Passing branches: {len(all_results):,} ({len(all_results)/total_branches*100:.2f}%)", file=sys.stderr)
    print(f"Elapsed time: {elapsed_time:.2f} seconds", file=sys.stderr)
    print(f"Branches per second: {stats['branchesPerSecond']:.1f}", file=sys.stderr)
    print(f"Workers used: {num_workers}", file=sys.stderr)

    return {
        'success': True,
        'results': all_results,
        'stats': stats,
    }


if __name__ == '__main__':
    # Parse command line arguments
    if len(sys.argv) < 3:
        print(json.dumps({'success': False, 'error': 'Usage: optimized_forge_engine.py <config_json> <job_id>'}))
        sys.exit(1)

    try:
        # Parse config from JSON argument
        config = json.loads(sys.argv[1])
        job_id = int(sys.argv[2])

        print(f"[FORGE] Starting job {job_id}...", file=sys.stderr)

        # Run forge
        result = run_forge_optimized(config)

        # Output results as JSON (for Node.js to parse and save)
        # Node.js will handle database writes to avoid race conditions
        print(json.dumps({
            'success': result['success'],
            'stats': result['stats'],
            'passingCount': len(result['results']),
            'results': result['results'],  # Include results for Node.js to save
        }))

    except Exception as e:
        import traceback
        print(json.dumps({
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc(),
        }))
        sys.exit(1)
