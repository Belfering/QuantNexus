#!/usr/bin/env python3
"""Test the vectorized optimizer"""

import json
import sys
import os

# Add current directory to path
sys.path.insert(0, os.path.dirname(__file__))

from vectorized_optimizer import VectorizedOptimizer

# Test data
parquet_dir = r"C:\Users\Trader\Desktop\atlas-forge\System.app\ticker-data\data\ticker_data_parquet"

# Simple RSI threshold sweep
branches = []
for threshold in range(30, 45):  # 15 branches for testing
    branches.append({
        'branchId': f'test-{threshold}',
        'tree': {
            'kind': 'indicator',
            'conditions': [{
                'id': '1',
                'ticker': 'SPY',
                'metric': 'Relative Strength Index',
                'window': 10,
                'comparison': 'Less Than',
                'threshold': threshold
            }],
            'children': {
                'then': [{'kind': 'position', 'positions': ['SPY']}],
                'else': [{'kind': 'position', 'positions': []}]
            }
        },
        'options': {
            'mode': 'CC',
            'costBps': 5,
            'splitStrategy': 'chronological',
            'splitPercentIS': 50
        },
        'combination': {'threshold': threshold}
    })

print(f"Testing with {len(branches)} branches...")

optimizer = VectorizedOptimizer(parquet_dir)

# Check if can vectorize
can_vec = optimizer.can_vectorize(branches)
print(f"Can vectorize: {can_vec}")

# Try to optimize
results = optimizer.optimize(branches)

if results is None:
    print("Failed to vectorize")
    sys.exit(1)

print(f"Success! Got {len(results)} results")
print(f"Sample result: {json.dumps(results[0], indent=2)}")
