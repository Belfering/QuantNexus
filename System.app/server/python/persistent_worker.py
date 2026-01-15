#!/usr/bin/env python3
"""
Persistent Python worker for batch backtesting
Stays alive and processes multiple branches to maximize cache reuse
Pre-loads tickers and pre-computes indicators on startup for massive speedup
"""

import sys
import json
from backtester import Backtester
from optimized_dataloader import get_global_cache
from indicator_cache import SharedIndicatorCache
from shared_memory_manager import SharedPriceDataReader

def main():
    """
    Persistent worker that processes multiple branches via stdin/stdout
    Protocol: One JSON object per line (newline-delimited JSON)
    """
    # Read parquet directory from first line
    try:
        first_line = sys.stdin.readline()
        if not first_line:
            sys.exit(0)

        config = json.loads(first_line)
        parquet_dir = config.get('parquetDir')
        preload_tickers = config.get('preloadTickers', [])
        preload_indicators = config.get('preloadIndicators', {})
        shared_memory_metadata = config.get('sharedMemoryMetadata')

        if not parquet_dir:
            print(json.dumps({'error': 'Missing parquetDir'}), flush=True)
            sys.exit(1)

        # Initialize backtester ONCE (caches persist across branches)
        backtester = Backtester(parquet_dir)

        # OPTIMIZATION: Attach to shared memory if available (2-3x speedup)
        shared_memory_reader = None
        if shared_memory_metadata:
            try:
                print(f"[Worker] Attaching to shared memory for {len(shared_memory_metadata)} tickers...", file=sys.stderr, flush=True)
                shared_memory_reader = SharedPriceDataReader(shared_memory_metadata)
                # Pre-load all tickers from shared memory
                for ticker in shared_memory_metadata.keys():
                    shared_memory_reader.load_ticker(ticker)
                print(f"[Worker] ✓ Attached to shared memory", file=sys.stderr, flush=True)
            except Exception as e:
                print(f"[Worker] Warning: Failed to attach to shared memory: {e}", file=sys.stderr, flush=True)
                shared_memory_reader = None

        # Pass shared memory reader to backtester if available
        if shared_memory_reader:
            backtester.shared_memory_reader = shared_memory_reader

        # OPTIMIZATION: Pre-load tickers and pre-compute indicators for massive speedup
        if preload_tickers or preload_indicators:
            print(f"[Worker] Pre-loading {len(preload_tickers)} tickers...", file=sys.stderr, flush=True)

            # Get global cache instance
            cache = get_global_cache(parquet_dir)

            # Pre-load all tickers into cache
            for ticker in preload_tickers:
                try:
                    cache.get_ticker_data(ticker, limit=20000)
                except Exception as e:
                    print(f"[Worker] Warning: Failed to load {ticker}: {e}", file=sys.stderr, flush=True)

            cache_stats = cache.get_cache_info()
            print(f"[Worker] ✓ Pre-loaded tickers. Cache: {cache_stats}", file=sys.stderr, flush=True)

            # Pre-compute indicators if specified
            if preload_indicators:
                print(f"[Worker] Pre-computing indicators...", file=sys.stderr, flush=True)

                # Create shared indicator cache
                indicator_cache = SharedIndicatorCache()

                # Build price data dict
                price_data = {}
                for ticker in preload_tickers:
                    try:
                        df = cache.get_ticker_data(ticker, limit=20000)
                        if len(df) > 0 and 'Close' in df.columns:
                            price_data[ticker] = df['Close'].values
                    except Exception as e:
                        print(f"[Worker] Warning: Failed to get prices for {ticker}: {e}", file=sys.stderr, flush=True)

                # Pre-compute all indicators
                indicator_cache.precompute_all(price_data, preload_indicators)

                stats = indicator_cache.get_stats()
                print(f"[Worker] ✓ Pre-computed indicators. Stats: {stats}", file=sys.stderr, flush=True)

        # Signal ready
        print(json.dumps({'status': 'ready'}), flush=True)

        # Process branches in a loop
        while True:
            line = sys.stdin.readline()
            if not line:
                break  # EOF - shutdown

            try:
                task = json.loads(line)

                # Handle shutdown command
                if task.get('command') == 'shutdown':
                    # Print cache stats before shutdown
                    try:
                        from result_cache import get_global_result_cache
                        result_cache = get_global_result_cache()
                        stats = result_cache.get_stats()
                        print(f"[Worker] Result cache stats: {stats}", file=sys.stderr, flush=True)
                    except:
                        pass

                    # Cleanup shared memory connections
                    if shared_memory_reader:
                        try:
                            shared_memory_reader.close()
                            print(f"[Worker] ✓ Closed shared memory connections", file=sys.stderr, flush=True)
                        except:
                            pass

                    break

                # Run backtest
                tree = task.get('tree')
                options = task.get('options', {})
                branch_id = task.get('branchId', 'unknown')

                if not tree:
                    result = {'error': 'Missing tree', 'branchId': branch_id}
                else:
                    result = backtester.run_backtest(tree, options)
                    result['branchId'] = branch_id

                # Output result
                print(json.dumps(result), flush=True)

            except Exception as e:
                error_result = {
                    'error': str(e),
                    'type': type(e).__name__,
                    'branchId': task.get('branchId', 'unknown') if 'task' in locals() else 'unknown'
                }
                print(json.dumps(error_result), flush=True)

    except Exception as e:
        print(json.dumps({'error': f'Worker initialization failed: {str(e)}'}), flush=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
