#!/usr/bin/env python3
"""Compare exact values between TA-Lib and our implementation"""

import json
import numpy as np
import talib

# Load test data
with open('../test_data/momentum.json', 'r') as f:
    data = json.load(f)

# Use combined dataset
dataset = data['combined']
closes = np.array([x if x is not None else np.nan for x in dataset['closes']], dtype=np.float64)
highs = np.array([x if x is not None else np.nan for x in dataset['highs']], dtype=np.float64)
lows = np.array([x if x is not None else np.nan for x in dataset['lows']], dtype=np.float64)

print("=== MACD Detailed Comparison ===")
macd, signal, hist = talib.MACD(closes, 12, 26, 9)

# Find first valid indices
macd_first = np.where(~np.isnan(macd))[0][0]
print(f"TA-Lib MACD line first valid at index: {macd_first}")

# Check EMA values
ema12 = talib.EMA(closes, 12)
ema26 = talib.EMA(closes, 26)
print(f"EMA12 first valid: {np.where(~np.isnan(ema12))[0][0]}")
print(f"EMA26 first valid: {np.where(~np.isnan(ema26))[0][0]}")

# Manual MACD line at index 33
manual_macd_33 = ema12[33] - ema26[33]
print(f"\nAt index 33:")
print(f"  EMA12: {ema12[33]}")
print(f"  EMA26: {ema26[33]}")
print(f"  Manual MACD (EMA12-EMA26): {manual_macd_33}")
print(f"  TA-Lib MACD: {macd[33]}")

# Show values around index 33-40
print(f"\nMACD values 33-40:")
for i in range(33, 41):
    print(f"  [{i}] TA-Lib: {macd[i]:.10f}")

print("\n=== ADX Detailed Comparison ===")
adx = talib.ADX(highs, lows, closes, 14)
plus_di = talib.PLUS_DI(highs, lows, closes, 14)
minus_di = talib.MINUS_DI(highs, lows, closes, 14)
dx = talib.DX(highs, lows, closes, 14)

adx_first = np.where(~np.isnan(adx))[0][0]
dx_first = np.where(~np.isnan(dx))[0][0]
print(f"DX first valid: {dx_first}")
print(f"ADX first valid: {adx_first}")

print(f"\nDX values {dx_first} to {dx_first+5}:")
for i in range(dx_first, min(dx_first+6, len(dx))):
    print(f"  [{i}] DX: {dx[i]:.10f}")

print(f"\nADX values {adx_first} to {adx_first+5}:")
for i in range(adx_first, min(adx_first+6, len(adx))):
    print(f"  [{i}] ADX: {adx[i]:.10f}, +DI: {plus_di[i]:.6f}, -DI: {minus_di[i]:.6f}")

# Calculate what first ADX should be (average of first 14 DX values)
first_14_dx = dx[dx_first:dx_first+14]
avg_dx = np.mean(first_14_dx)
print(f"\nAverage of DX[{dx_first}:{dx_first+14}]: {avg_dx:.10f}")
print(f"TA-Lib ADX[{adx_first}]: {adx[adx_first]:.10f}")
