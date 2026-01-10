#!/usr/bin/env python3
"""Debug where our implementation diverges from TA-Lib"""

import numpy as np
import talib

# Simple test data
np.random.seed(42)
closes = 100 + np.cumsum(np.random.randn(100) * 0.5)
closes = closes.astype(np.float64)

print("=== EMA Debug ===")
ta_ema = talib.EMA(closes, 12)
print(f"TA-Lib EMA first valid index: {np.where(~np.isnan(ta_ema))[0][0]}")
print(f"TA-Lib EMA[11] (period-1): {ta_ema[11]}")
print(f"TA-Lib EMA[12]: {ta_ema[12]}")

# What SMA of first 12 values is:
sma_12 = np.mean(closes[:12])
print(f"SMA of first 12: {sma_12}")

# Apply one step of EMA
k = 2.0 / 13.0
ema_12 = (closes[12] - sma_12) * k + sma_12
print(f"Manual EMA[12]: {ema_12}")

print("\n=== MACD Debug ===")
macd, signal, hist = talib.MACD(closes, 12, 26, 9)
print(f"TA-Lib MACD first valid: index {np.where(~np.isnan(macd))[0][0]}, value {macd[np.where(~np.isnan(macd))[0][0]]}")
print(f"TA-Lib Signal first valid: index {np.where(~np.isnan(signal))[0][0]}")

print("\n=== ADX Debug ===")
# Generate OHLC
highs = closes + np.abs(np.random.randn(100)) * 0.5
lows = closes - np.abs(np.random.randn(100)) * 0.5
highs = np.maximum(highs, closes)
lows = np.minimum(lows, closes)

ta_adx = talib.ADX(highs, lows, closes, 14)
print(f"TA-Lib ADX first valid: index {np.where(~np.isnan(ta_adx))[0][0]}")
first_valid = np.where(~np.isnan(ta_adx))[0][0]
print(f"TA-Lib ADX[{first_valid}]: {ta_adx[first_valid]}")
print(f"TA-Lib ADX[{first_valid+1}]: {ta_adx[first_valid+1]}")

# Also check intermediate values
plus_di = talib.PLUS_DI(highs, lows, closes, 14)
minus_di = talib.MINUS_DI(highs, lows, closes, 14)
print(f"\nTA-Lib +DI[27]: {plus_di[27]}")
print(f"TA-Lib -DI[27]: {minus_di[27]}")

# DX calculation
dx = talib.DX(highs, lows, closes, 14)
print(f"TA-Lib DX first valid: index {np.where(~np.isnan(dx))[0][0]}")
print(f"TA-Lib DX[13]: {dx[13] if not np.isnan(dx[13]) else 'NaN'}")
print(f"TA-Lib DX[14]: {dx[14]}")
