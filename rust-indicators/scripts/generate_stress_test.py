#!/usr/bin/env python3
"""Generate comprehensive stress test with all indicator combinations"""
import json
import random

# All supported indicators from indicators.rs
INDICATORS = [
    # Moving Averages
    {"metric": "SMA", "windows": [5, 10, 20, 50, 100, 200]},
    {"metric": "EMA", "windows": [5, 10, 20, 50, 100, 200]},
    {"metric": "HMA", "windows": [5, 10, 20, 50]},
    {"metric": "WMA", "windows": [5, 10, 20, 50]},
    {"metric": "Wilders MA", "windows": [10, 14, 20]},
    {"metric": "DEMA", "windows": [10, 20, 50]},
    {"metric": "TEMA", "windows": [10, 20, 50]},
    {"metric": "KAMA", "windows": [10, 20]},

    # RSI Variants
    {"metric": "RSI", "windows": [7, 14, 21], "thresholds": [30, 50, 70]},
    {"metric": "RSI (SMA)", "windows": [7, 14, 21], "thresholds": [30, 50, 70]},
    {"metric": "RSI (EMA)", "windows": [7, 14, 21], "thresholds": [30, 50, 70]},
    {"metric": "Stochastic RSI", "windows": [14, 21], "thresholds": [20, 50, 80]},
    {"metric": "Laguerre RSI", "windows": [1], "thresholds": [20, 50, 80]},

    # Momentum
    {"metric": "Momentum (Weighted)", "windows": [1], "thresholds": [-0.1, 0, 0.1]},
    {"metric": "Momentum (Unweighted)", "windows": [1], "thresholds": [-0.1, 0, 0.1]},
    {"metric": "Momentum (12-Month SMA)", "windows": [1], "thresholds": [-0.05, 0, 0.05]},
    {"metric": "ROC", "windows": [5, 10, 20, 63, 126, 252], "thresholds": [-5, 0, 5, 10]},

    # Volatility
    {"metric": "Standard Deviation", "windows": [10, 20, 50], "thresholds": [0.01, 0.02, 0.03]},
    {"metric": "Max Drawdown", "windows": [1], "thresholds": [-0.3, -0.2, -0.1, -0.05]},
    {"metric": "Drawdown", "windows": [1], "thresholds": [-0.2, -0.1, -0.05, 0]},
    {"metric": "Bollinger %B", "windows": [20], "thresholds": [0, 0.5, 1]},
    {"metric": "Bollinger Bandwidth", "windows": [20], "thresholds": [0.05, 0.1, 0.2]},
    {"metric": "Historical Volatility", "windows": [20, 50], "thresholds": [0.1, 0.2, 0.3]},
    {"metric": "Ulcer Index", "windows": [14, 20], "thresholds": [5, 10, 15]},

    # Trend
    {"metric": "Cumulative Return", "windows": [1], "thresholds": [0, 0.1, 0.2]},
    {"metric": "SMA of Returns", "windows": [10, 20], "thresholds": [-0.001, 0, 0.001]},
    {"metric": "Trend Clarity", "windows": [10, 20, 50], "thresholds": [0.3, 0.5, 0.7]},
    {"metric": "Linear Reg Slope", "windows": [10, 20, 50], "thresholds": [-0.5, 0, 0.5]},
    {"metric": "Price vs SMA", "windows": [20, 50, 200], "thresholds": [-0.05, 0, 0.05]},

    # MACD/PPO (fixed params)
    {"metric": "MACD Histogram", "windows": [1], "thresholds": [-1, 0, 1]},
    {"metric": "PPO Histogram", "windows": [1], "thresholds": [-1, 0, 1]},

    # Aroon
    {"metric": "Aroon Up", "windows": [14, 25], "thresholds": [30, 50, 70]},
    {"metric": "Aroon Down", "windows": [14, 25], "thresholds": [30, 50, 70]},
    {"metric": "Aroon Oscillator", "windows": [14, 25], "thresholds": [-50, 0, 50]},

    # OHLC-based
    {"metric": "ATR", "windows": [10, 14, 20], "thresholds": [1, 2, 3]},
    {"metric": "ATR %", "windows": [10, 14, 20], "thresholds": [0.01, 0.02, 0.03]},
    {"metric": "Williams %R", "windows": [14], "thresholds": [-80, -50, -20]},
    {"metric": "CCI", "windows": [14, 20], "thresholds": [-100, 0, 100]},
    {"metric": "Stochastic %K", "windows": [14], "thresholds": [20, 50, 80]},
    {"metric": "Stochastic %D", "windows": [14], "thresholds": [20, 50, 80]},
    {"metric": "ADX", "windows": [14, 20], "thresholds": [20, 25, 30, 40]},

    # Volume-based
    {"metric": "MFI", "windows": [14], "thresholds": [20, 50, 80]},
    {"metric": "OBV Rate of Change", "windows": [10, 20], "thresholds": [-5, 0, 5]},
    {"metric": "VWAP Ratio", "windows": [1], "thresholds": [0.98, 1.0, 1.02]},

    # Price
    {"metric": "Current Price", "windows": [1], "thresholds": [100, 200, 300, 400]},
]

# Tickers to use
TICKERS = ["SPY", "QQQ", "IWM", "TLT", "GLD", "EFA", "EEM", "VNQ", "DBC", "BIL", "SHY"]

# Comparators (only these 4 are supported by the Rust engine)
COMPARATORS = ["gt", "lt", "crossAbove", "crossBelow"]

def create_condition(cond_id, cond_type, indicator, ticker, comparator, threshold, window, for_days=1):
    cond = {
        "id": cond_id,
        "type": cond_type,
        "metric": indicator["metric"],
        "window": window,
        "ticker": ticker,
        "comparator": comparator,
        "threshold": threshold,
        "expanded": False,
    }
    if for_days > 1:
        cond["forDays"] = for_days
    return cond

def create_indicator_node(node_id, title, conditions, then_ticker, else_ticker):
    return {
        "id": node_id,
        "kind": "indicator",
        "title": title,
        "collapsed": False,
        "weighting": "equal",
        "weightingThen": "equal",
        "weightingElse": "equal",
        "conditions": conditions,
        "children": {
            "then": [{
                "id": f"{node_id}-then",
                "kind": "position",
                "title": "Long",
                "collapsed": False,
                "weighting": "equal",
                "positions": [then_ticker],
                "children": {}
            }],
            "else": [{
                "id": f"{node_id}-else",
                "kind": "position",
                "title": "Cash",
                "collapsed": False,
                "weighting": "equal",
                "positions": [else_ticker],
                "children": {}
            }],
            "next": [None]
        }
    }

def generate_stress_test(target_conditions=7000):
    """Generate a stress test with approximately target_conditions conditions"""

    nodes = []
    total_conditions = 0
    node_idx = 0

    # First pass: create nodes with every indicator at least once
    print("Pass 1: Ensuring coverage of all indicators...")
    for indicator in INDICATORS:
        for window in indicator["windows"]:
            thresholds = indicator.get("thresholds", [50])
            for threshold in thresholds:
                for comparator in COMPARATORS[:2]:  # Just gt and lt for coverage
                    ticker = random.choice(TICKERS[:5])  # Main tickers

                    conditions = [
                        create_condition(
                            f"cond-{node_idx}-0", "if",
                            indicator, ticker, comparator, threshold, window
                        )
                    ]

                    node = create_indicator_node(
                        f"ind-{node_idx}",
                        f"{indicator['metric']} {window}d {comparator} {threshold}",
                        conditions,
                        random.choice(["SPY", "QQQ", "IWM"]),
                        "BIL"
                    )
                    nodes.append(node)
                    total_conditions += 1
                    node_idx += 1

    print(f"  Created {total_conditions} conditions for indicator coverage")

    # Second pass: add complex multi-condition nodes
    print("Pass 2: Adding multi-condition nodes...")
    while total_conditions < target_conditions:
        # Create a node with 3-5 conditions (and/or logic)
        num_conditions = random.randint(3, 5)
        conditions = []

        for i in range(num_conditions):
            indicator = random.choice(INDICATORS)
            window = random.choice(indicator["windows"])
            thresholds = indicator.get("thresholds", [50])
            threshold = random.choice(thresholds)
            ticker = random.choice(TICKERS)
            comparator = random.choice(COMPARATORS)
            for_days = random.choice([1, 1, 1, 2, 3, 5])  # Mostly 1, sometimes more

            cond_type = "if" if i == 0 else random.choice(["and", "or"])

            conditions.append(create_condition(
                f"cond-{node_idx}-{i}", cond_type,
                indicator, ticker, comparator, threshold, window, for_days
            ))

        node = create_indicator_node(
            f"ind-{node_idx}",
            f"Signal {node_idx}",
            conditions,
            random.choice(TICKERS[:5]),
            random.choice(["BIL", "SHY"])
        )
        nodes.append(node)
        total_conditions += num_conditions
        node_idx += 1

        if node_idx % 500 == 0:
            print(f"  {total_conditions} conditions...")

    print(f"Final: {total_conditions} conditions across {len(nodes)} nodes")

    # Build the tree structure
    root = {
        "id": "root",
        "kind": "basic",
        "title": f"Stress Test - {total_conditions} Conditions, All Indicators",
        "collapsed": False,
        "weighting": "equal",
        "children": {
            "next": nodes
        }
    }

    return root, total_conditions

if __name__ == "__main__":
    import sys
    target = int(sys.argv[1]) if len(sys.argv) > 1 else 7000
    print(f"Generating stress test with ~{target} conditions...")
    tree, num_conditions = generate_stress_test(target)

    output_path = "/Users/carter/Code/Flowchart/stress_test_all_indicators.json"
    with open(output_path, "w") as f:
        json.dump(tree, f, indent=2)

    print(f"\nWrote {output_path}")
    print(f"Total conditions: {num_conditions}")
    print(f"Total nodes: {len(tree['children']['next'])}")

    # Count unique indicator types used
    metrics_used = set()
    for node in tree['children']['next']:
        for cond in node.get('conditions', []):
            metrics_used.add(cond['metric'])
    print(f"Unique indicators: {len(metrics_used)}")
    print(f"Indicators: {sorted(metrics_used)}")
