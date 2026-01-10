#!/usr/bin/env python3
"""Debug ADX calculation step by step"""

import numpy as np
import talib

# Load test data
import json
with open('../test_data/momentum.json') as f:
    data = json.load(f)

dataset = data['trend_up']
closes = np.array([x if x is not None else np.nan for x in dataset['closes']], dtype=np.float64)
highs = np.array([x if x is not None else np.nan for x in dataset['highs']], dtype=np.float64)
lows = np.array([x if x is not None else np.nan for x in dataset['lows']], dtype=np.float64)

period = 14
n = len(closes)

# Manual calculation matching our Rust code
plus_dm = np.zeros(n)
minus_dm = np.zeros(n)
tr = np.zeros(n)

for i in range(1, n):
    high_diff = highs[i] - highs[i-1]
    low_diff = lows[i-1] - lows[i]

    if high_diff > 0 and high_diff > low_diff:
        plus_dm[i] = high_diff
    if low_diff > 0 and low_diff > high_diff:
        minus_dm[i] = low_diff

    h_l = highs[i] - lows[i]
    h_c = abs(highs[i] - closes[i-1])
    l_c = abs(lows[i] - closes[i-1])
    tr[i] = max(h_l, h_c, l_c)

# Initial sums (our code uses indices 1..=period which is 1-14)
start = period
smoothed_plus_dm = np.full(n, np.nan)
smoothed_minus_dm = np.full(n, np.nan)
smoothed_tr = np.full(n, np.nan)

smoothed_plus_dm[start] = np.sum(plus_dm[1:start+1])
smoothed_minus_dm[start] = np.sum(minus_dm[1:start+1])
smoothed_tr[start] = np.sum(tr[1:start+1])

print(f"Initial sums at index {start}:")
print(f"  +DM sum: {smoothed_plus_dm[start]:.6f}")
print(f"  -DM sum: {smoothed_minus_dm[start]:.6f}")
print(f"  TR sum:  {smoothed_tr[start]:.6f}")

# Wilder's smoothing
for i in range(start+1, n):
    smoothed_plus_dm[i] = smoothed_plus_dm[i-1] - (smoothed_plus_dm[i-1] / period) + plus_dm[i]
    smoothed_minus_dm[i] = smoothed_minus_dm[i-1] - (smoothed_minus_dm[i-1] / period) + minus_dm[i]
    smoothed_tr[i] = smoothed_tr[i-1] - (smoothed_tr[i-1] / period) + tr[i]

# Calculate DI and DX
plus_di = np.full(n, np.nan)
minus_di = np.full(n, np.nan)
dx = np.full(n, np.nan)

for i in range(start, n):
    if smoothed_tr[i] != 0:
        plus_di[i] = 100 * smoothed_plus_dm[i] / smoothed_tr[i]
        minus_di[i] = 100 * smoothed_minus_dm[i] / smoothed_tr[i]

    di_sum = plus_di[i] + minus_di[i]
    if di_sum != 0:
        dx[i] = 100 * abs(plus_di[i] - minus_di[i]) / di_sum

# Compare with TA-Lib
ta_plus_di = talib.PLUS_DI(highs, lows, closes, period)
ta_minus_di = talib.MINUS_DI(highs, lows, closes, period)
ta_dx = talib.DX(highs, lows, closes, period)

print(f"\nDI comparison at index {start}:")
print(f"  Our +DI:     {plus_di[start]:.6f}")
print(f"  TA-Lib +DI:  {ta_plus_di[start]:.6f}")
print(f"  Our -DI:     {minus_di[start]:.6f}")
print(f"  TA-Lib -DI:  {ta_minus_di[start]:.6f}")

print(f"\nDX comparison at indices 14-17:")
for i in range(14, 18):
    print(f"  [{i}] Our: {dx[i]:.6f}  TA-Lib: {ta_dx[i]:.6f}  Diff: {dx[i] - ta_dx[i]:.6f}")

# ADX calculation
adx_start = start + period  # 28
our_adx = np.full(n, np.nan)

if adx_start <= n:
    # First ADX = mean of first 14 DX values
    first_dx = [d for d in dx[start:adx_start] if not np.isnan(d)]
    if first_dx:
        our_adx[adx_start-1] = np.mean(first_dx)

    for i in range(adx_start, n):
        if not np.isnan(dx[i]) and not np.isnan(our_adx[i-1]):
            our_adx[i] = (our_adx[i-1] * (period-1) + dx[i]) / period

ta_adx = talib.ADX(highs, lows, closes, period)

print(f"\nADX comparison:")
print(f"  Our ADX[27]:    {our_adx[27]:.6f}")
print(f"  TA-Lib ADX[27]: {ta_adx[27]:.6f}")
print(f"  Difference:     {our_adx[27] - ta_adx[27]:.6f}")
