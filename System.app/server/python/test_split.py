#!/usr/bin/env python3
"""Test script to verify IS/OOS split is working"""

import json
from backtester import Backtester

# Minimal tree structure matching the user's strategy
tree = {
    "kind": "indicator",
    "conditions": [
        {
            "id": "1768060150907",
            "ticker": "SPY",
            "metric": "Relative Strength Index",
            "window": 9,
            "comparison": "Less Than",
            "threshold": 30
        }
    ],
    "children": {
        "then": [{
            "kind": "position",
            "positions": ["SPY"]
        }],
        "else": [{
            "kind": "position",
            "positions": []
        }]
    }
}

# Split config matching UI: Chronological, 50/50, min 5 years
options = {
    "mode": "CC",
    "costBps": 5,
    "splitConfig": {
        "enabled": True,
        "strategy": "chronological",
        "chronologicalPercent": 50,
        "minYears": 5
    }
}

# Initialize backtester
import os
parquet_dir = r"C:\Users\Trader\Desktop\atlas-forge\System.app\ticker-data\data\ticker_data_parquet"
backtester = Backtester(parquet_dir)

print("Running backtest with split config:")
print(json.dumps(options["splitConfig"], indent=2))
print()

# Run backtest
result = backtester.run_backtest(tree, options)

print("Results:")
print(f"isMetrics: {result['isMetrics'] is not None}")
print(f"oosMetrics: {result['oosMetrics'] is not None}")

if result['isMetrics']:
    is_m = result['isMetrics']
    print(f"\nIS Metrics:")
    print(f"  Start Date: {is_m.get('startDate', 'N/A')}")
    print(f"  Years: {is_m.get('years', 0):.2f}")
    print(f"  CAGR: {is_m['cagr']:.4f} ({is_m['cagr']*100:.2f}%)")
    print(f"  Sharpe: {is_m['sharpe']:.4f}")
    print(f"  Beta: {is_m.get('beta', 0):.4f}")
    print(f"  Treynor: {is_m.get('treynor', 0):.4f}")
    print(f"  TIM: {is_m.get('tim', 0):.4f} ({is_m.get('tim', 0)*100:.2f}%)")
    print(f"  TIMAR: {is_m.get('timar', 0):.4f} ({is_m.get('timar', 0)*100:.2f}%)")
    print(f"  Win Rate: {is_m.get('winRate', 0):.4f} ({is_m.get('winRate', 0)*100:.2f}%)")

if result['oosMetrics']:
    oos_m = result['oosMetrics']
    print(f"\nOOS Metrics:")
    print(f"  Start Date: {oos_m.get('startDate', 'N/A')}")
    print(f"  Years: {oos_m.get('years', 0):.2f}")
    print(f"  CAGR: {oos_m['cagr']:.4f} ({oos_m['cagr']*100:.2f}%)")
    print(f"  Sharpe: {oos_m['sharpe']:.4f}")
    print(f"  Beta: {oos_m.get('beta', 0):.4f}")
    print(f"  Treynor: {oos_m.get('treynor', 0):.4f}")
    print(f"  TIM: {oos_m.get('tim', 0):.4f} ({oos_m.get('tim', 0)*100:.2f}%)")
    print(f"  TIMAR: {oos_m.get('timar', 0):.4f} ({oos_m.get('timar', 0)*100:.2f}%)")
    print(f"  Win Rate: {oos_m.get('winRate', 0):.4f} ({oos_m.get('winRate', 0)*100:.2f}%)")
else:
    print("\nERROR: OOS Metrics are None!")
