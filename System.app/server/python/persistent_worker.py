#!/usr/bin/env python3
"""
Persistent Python worker for batch backtesting
Stays alive and processes multiple branches to maximize cache reuse
"""

import sys
import json
from backtester import Backtester

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

        if not parquet_dir:
            print(json.dumps({'error': 'Missing parquetDir'}), flush=True)
            sys.exit(1)

        # Initialize backtester ONCE (caches persist across branches)
        backtester = Backtester(parquet_dir)

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
