#!/bin/bash
# Benchmark vectorized engine

echo "=== Testing stress_test_100_indicators.json ==="
python3 -c "
import json
with open('/Users/carter/Code/Flowchart/stress_test_100_indicators.json', 'r') as f:
    strategy = json.load(f)
request = {'payload': json.dumps(strategy), 'cost_bps': 5, 'mode': 'CC'}
print(json.dumps(request))
" > /tmp/req100.json

START=$(python3 -c "import time; print(time.time())")
RESULT=$(curl -s -X POST http://localhost:3030/api/backtest \
  -H "Content-Type: application/json" \
  --data-binary @/tmp/req100.json)
END=$(python3 -c "import time; print(time.time())")

ELAPSED=$(python3 -c "print(f'{($END - $START) * 1000:.2f}')")
CAGR=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"{d.get('metrics',{}).get('cagr',0):.2f}\")" 2>/dev/null || echo "N/A")
SHARPE=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"{d.get('metrics',{}).get('sharpe',0):.2f}\")" 2>/dev/null || echo "N/A")

echo "  Time: ${ELAPSED}ms"
echo "  CAGR: ${CAGR}%"
echo "  Sharpe: ${SHARPE}"

if [ -f "/Users/carter/Code/Flowchart/stress_test_7k_import.json" ]; then
    echo ""
    echo "=== Testing stress_test_7k_import.json ==="
    python3 -c "
import json
with open('/Users/carter/Code/Flowchart/stress_test_7k_import.json', 'r') as f:
    strategy = json.load(f)
request = {'payload': json.dumps(strategy), 'cost_bps': 5, 'mode': 'CC'}
print(json.dumps(request))
" > /tmp/req7k.json

    START=$(python3 -c "import time; print(time.time())")
    RESULT=$(curl -s -X POST http://localhost:3030/api/backtest \
      -H "Content-Type: application/json" \
      --data-binary @/tmp/req7k.json)
    END=$(python3 -c "import time; print(time.time())")

    ELAPSED=$(python3 -c "print(f'{($END - $START) * 1000:.2f}')")
    echo "  Time: ${ELAPSED}ms"

    CAGR=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"{d.get('metrics',{}).get('cagr',0):.2f}\")" 2>/dev/null || echo "N/A")
    echo "  CAGR: ${CAGR}%"
fi
