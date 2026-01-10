#!/usr/bin/env python3
"""Benchmark vectorized vs V1 engine"""
import json
import requests
import time
import sys

def run_backtest(strategy_file):
    with open(strategy_file, 'r') as f:
        strategy = json.load(f)

    request = {
        'payload': json.dumps(strategy),
        'cost_bps': 5,
        'mode': 'CC'
    }

    start = time.time()
    resp = requests.post('http://localhost:3030/api/backtest', json=request)
    elapsed = time.time() - start

    if resp.status_code == 200:
        data = resp.json()
        metrics = data.get('metrics', {})
        return {
            'success': True,
            'elapsed_ms': elapsed * 1000,
            'cagr': metrics.get('cagr'),
            'sharpe': metrics.get('sharpe'),
            'days': metrics.get('days'),
        }
    else:
        return {
            'success': False,
            'error': resp.text,
            'elapsed_ms': elapsed * 1000,
        }

if __name__ == '__main__':
    test_files = [
        '/Users/carter/Code/Flowchart/stress_test_100_indicators.json',
    ]

    # Check if 7k file exists
    import os
    if os.path.exists('/Users/carter/Code/Flowchart/stress_test_7k_import.json'):
        test_files.append('/Users/carter/Code/Flowchart/stress_test_7k_import.json')

    for f in test_files:
        print(f"\n=== Testing {f.split('/')[-1]} ===")
        result = run_backtest(f)
        if result['success']:
            print(f"  Time: {result['elapsed_ms']:.2f}ms")
            print(f"  CAGR: {result['cagr']:.2f}%")
            print(f"  Sharpe: {result['sharpe']:.2f}")
            print(f"  Days: {result['days']}")
        else:
            print(f"  ERROR: {result['error'][:200]}")
