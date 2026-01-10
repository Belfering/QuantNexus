#!/usr/bin/env python3
"""Test if aligning EMA start points fixes MACD"""

import numpy as np
import talib

np.random.seed(42)
closes = 100 + np.cumsum(np.random.randn(100) * 0.5)
closes = closes.astype(np.float64)

k12 = 2.0 / 13.0
k26 = 2.0 / 27.0

# Standard approach: EMA12 starts at 11, EMA26 starts at 25
sma12 = np.mean(closes[:12])
sma26 = np.mean(closes[:26])

ema12_standard = np.full(100, np.nan)
ema26_standard = np.full(100, np.nan)

ema12_standard[11] = sma12
for i in range(12, 100):
    ema12_standard[i] = (closes[i] - ema12_standard[i-1]) * k12 + ema12_standard[i-1]

ema26_standard[25] = sma26
for i in range(26, 100):
    ema26_standard[i] = (closes[i] - ema26_standard[i-1]) * k26 + ema26_standard[i-1]

# Aligned approach: Both start at index 25 (slow period - 1)
# EMA12 needs to "catch up" from index 11 to 25 before we use it
ema12_aligned = np.full(100, np.nan)
ema26_aligned = np.full(100, np.nan)

# EMA26 starts normally at 25
ema26_aligned[25] = sma26
for i in range(26, 100):
    ema26_aligned[i] = (closes[i] - ema26_aligned[i-1]) * k26 + ema26_aligned[i-1]

# EMA12 - start at 11, but run through to 25 before considering it "ready"
ema12_temp = np.full(100, np.nan)
ema12_temp[11] = sma12
for i in range(12, 100):
    ema12_temp[i] = (closes[i] - ema12_temp[i-1]) * k12 + ema12_temp[i-1]

# Copy values starting from index 25
ema12_aligned[25:] = ema12_temp[25:]

# Calculate MACD both ways
macd_standard = ema12_standard - ema26_standard
macd_aligned = ema12_aligned - ema26_aligned

# TA-Lib MACD
ta_macd, _, _ = talib.MACD(closes, 12, 26, 9)

print("Comparison at index 33 (first valid TA-Lib MACD):")
print(f"  Standard MACD: {macd_standard[33]:.10f}")
print(f"  Aligned MACD:  {macd_aligned[33]:.10f}")
print(f"  TA-Lib MACD:   {ta_macd[33]:.10f}")

print(f"\nDifferences:")
print(f"  Standard vs TA-Lib: {macd_standard[33] - ta_macd[33]:.10f}")
print(f"  Aligned vs TA-Lib:  {macd_aligned[33] - ta_macd[33]:.10f}")

# Also check TA-Lib standalone EMA
ta_ema12 = talib.EMA(closes, 12)
ta_ema26 = talib.EMA(closes, 26)
print(f"\nTA-Lib standalone EMAs at 33:")
print(f"  EMA12: {ta_ema12[33]:.10f}")
print(f"  EMA26: {ta_ema26[33]:.10f}")
print(f"  Diff:  {ta_ema12[33] - ta_ema26[33]:.10f}")

print(f"\nOur aligned EMAs at 33:")
print(f"  EMA12: {ema12_aligned[33]:.10f}")
print(f"  EMA26: {ema26_aligned[33]:.10f}")
