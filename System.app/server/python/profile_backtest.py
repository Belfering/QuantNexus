#!/usr/bin/env python3
"""Profile the backtester to identify bottlenecks"""

import cProfile
import pstats
import io
from backtester import Backtester

# Simple RSI strategy
tree = {
    'kind': 'indicator',
    'conditions': [{
        'id': '1',
        'ticker': 'SPY',
        'metric': 'Relative Strength Index',
        'window': 10,
        'comparison': 'Less Than',
        'threshold': 30
    }],
    'children': {
        'then': [{'kind': 'position', 'positions': ['SPY']}],
        'else': [{'kind': 'position', 'positions': []}]
    }
}

options = {
    'mode': 'CC',
    'costBps': 5,
    'splitConfig': {
        'enabled': True,
        'strategy': 'chronological',
        'chronologicalPercent': 50,
        'minYears': 5
    }
}

# Initialize backtester
parquet_dir = r'C:\Users\Trader\Desktop\atlas-forge\System.app\ticker-data\data\ticker_data_parquet'
backtester = Backtester(parquet_dir)

# Profile 10 backtests
profiler = cProfile.Profile()
profiler.enable()

for i in range(10):
    result = backtester.run_backtest(tree, options)

profiler.disable()

# Print results
s = io.StringIO()
ps = pstats.Stats(profiler, stream=s).sort_stats('cumulative')
ps.print_stats(30)  # Top 30 functions

print(s.getvalue())

# Also print total time
print("\n" + "="*80)
print(f"Total time for 10 backtests: {ps.total_tt:.2f} seconds")
print(f"Average per backtest: {ps.total_tt/10:.3f} seconds")
print(f"Theoretical max throughput: {10/ps.total_tt:.1f} backtests/sec (single-threaded)")
