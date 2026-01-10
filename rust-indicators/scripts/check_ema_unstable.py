#!/usr/bin/env python3
"""Check if TA-Lib uses unstable period for EMA"""

import numpy as np
import talib

# Same test data
np.random.seed(42)
closes = 100 + np.cumsum(np.random.randn(100) * 0.5)
closes = closes.astype(np.float64)

# Get standalone EMA
ema12 = talib.EMA(closes, 12)
ema26 = talib.EMA(closes, 26)

# Get MACD
macd, signal, hist = talib.MACD(closes, 12, 26, 9)

print("Comparing standalone EMA vs MACD internal EMA:")
print(f"\nAt index 33 (first valid MACD):")
print(f"  Standalone EMA12: {ema12[33]:.10f}")
print(f"  Standalone EMA26: {ema26[33]:.10f}")
print(f"  Standalone diff:  {ema12[33] - ema26[33]:.10f}")
print(f"  TA-Lib MACD:      {macd[33]:.10f}")
print(f"  Difference:       {(ema12[33] - ema26[33]) - macd[33]:.10f}")

# Check if TA-Lib has unstable period setting
print("\n\nTA-Lib function info:")
info = talib.abstract.MACD.info
print(f"MACD info: {info}")

# Try setting unstable period
print("\n\nTrying with unstable period = 0:")
talib.set_unstable_period('EMA', 0)
ema12_stable = talib.EMA(closes, 12)
ema26_stable = talib.EMA(closes, 26)
print(f"  EMA12[33]: {ema12_stable[33]:.10f}")
print(f"  EMA26[33]: {ema26_stable[33]:.10f}")

# Check default unstable period
print(f"\nDefault unstable periods:")
print(f"  EMA: {talib.get_unstable_period('EMA')}")

# What if we use different seeding?
print("\n\nManual EMA calculation with SMA seed:")
k12 = 2.0 / 13.0
k26 = 2.0 / 27.0

# SMA seed
sma12 = np.mean(closes[:12])
sma26 = np.mean(closes[:26])

# Run EMA from seed
manual_ema12 = np.full(100, np.nan)
manual_ema26 = np.full(100, np.nan)

manual_ema12[11] = sma12
for i in range(12, 100):
    manual_ema12[i] = (closes[i] - manual_ema12[i-1]) * k12 + manual_ema12[i-1]

manual_ema26[25] = sma26
for i in range(26, 100):
    manual_ema26[i] = (closes[i] - manual_ema26[i-1]) * k26 + manual_ema26[i-1]

print(f"  Manual EMA12[33]: {manual_ema12[33]:.10f}")
print(f"  Manual EMA26[33]: {manual_ema26[33]:.10f}")
print(f"  Manual MACD[33]:  {manual_ema12[33] - manual_ema26[33]:.10f}")
print(f"  TA-Lib MACD[33]:  {macd[33]:.10f}")
