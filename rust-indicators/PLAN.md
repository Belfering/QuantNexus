# Rust Indicators Library - Implementation Plan

## Overview

Pure Rust implementation of 50 technical indicators, designed to:
1. Match TA-Lib output exactly (verified via reference testing)
2. Compile to both native and WASM
3. Be fast (SIMD-friendly, minimal allocations)
4. Handle edge cases gracefully

---

## Indicators to Implement (50 total)

### Moving Averages (8)
| Indicator | Function | Status |
|-----------|----------|--------|
| Simple Moving Average | `sma(values, period)` | Pending |
| Exponential Moving Average | `ema(values, period)` | Pending |
| Weighted Moving Average | `wma(values, period)` | Pending |
| Double EMA | `dema(values, period)` | Pending |
| Triple EMA | `tema(values, period)` | Pending |
| Hull Moving Average | `hma(values, period)` | Pending |
| Kaufman Adaptive MA | `kama(values, period, fast, slow)` | Pending |
| Wilder's Smoothing | `wilders_ma(values, period)` | Pending |

### Oscillators (10)
| Indicator | Function | Status |
|-----------|----------|--------|
| RSI (Wilder's) | `rsi(closes, period)` | Pending |
| RSI with SMA smoothing | `rsi_sma(closes, period)` | Pending |
| RSI with EMA smoothing | `rsi_ema(closes, period)` | Pending |
| Stochastic RSI | `stoch_rsi(closes, rsi_period, stoch_period)` | Pending |
| Laguerre RSI | `laguerre_rsi(closes, gamma)` | Pending |
| Stochastic %K | `stoch_k(highs, lows, closes, period)` | Pending |
| Stochastic %D | `stoch_d(highs, lows, closes, k_period, d_period)` | Pending |
| Williams %R | `williams_r(highs, lows, closes, period)` | Pending |
| CCI | `cci(highs, lows, closes, period)` | Pending |
| Money Flow Index | `mfi(highs, lows, closes, volumes, period)` | Pending |

### Momentum (12)
| Indicator | Function | Status |
|-----------|----------|--------|
| MACD | `macd(closes, fast, slow, signal)` | Pending |
| PPO | `ppo(closes, fast, slow, signal)` | Pending |
| Rate of Change | `roc(closes, period)` | Pending |
| Aroon Up | `aroon_up(highs, period)` | Pending |
| Aroon Down | `aroon_down(lows, period)` | Pending |
| Aroon Oscillator | `aroon_osc(highs, lows, period)` | Pending |
| ADX | `adx(highs, lows, closes, period)` | Pending |
| 13612W Momentum | `momentum_13612w(closes)` | Pending |
| 13612U Momentum | `momentum_13612u(closes)` | Pending |
| SMA12 Momentum | `sma12_momentum(closes)` | Pending |
| Linear Regression Slope | `linreg_slope(values, period)` | Pending |
| Linear Regression Value | `linreg_value(values, period)` | Pending |

### Volatility (10)
| Indicator | Function | Status |
|-----------|----------|--------|
| Standard Deviation | `std_dev(values, period)` | Pending |
| Bollinger %B | `bollinger_b(closes, period, std_mult)` | Pending |
| Bollinger Bandwidth | `bollinger_bandwidth(closes, period, std_mult)` | Pending |
| ATR | `atr(highs, lows, closes, period)` | Pending |
| ATR Percent | `atr_percent(highs, lows, closes, period)` | Pending |
| Historical Volatility | `historical_volatility(closes, period)` | Pending |
| Ulcer Index | `ulcer_index(closes, period)` | Pending |
| Max Drawdown | `max_drawdown(closes, period)` | Pending |
| Current Drawdown | `drawdown(closes)` | Pending |
| True Range | `true_range(highs, lows, closes)` | Pending |

### Volume (4)
| Indicator | Function | Status |
|-----------|----------|--------|
| On Balance Volume | `obv(closes, volumes)` | Pending |
| OBV Rate of Change | `obv_roc(closes, volumes, period)` | Pending |
| VWAP | `vwap(highs, lows, closes, volumes)` | Pending |
| VWAP Ratio | `vwap_ratio(closes, volumes, period)` | Pending |

### Trend & Custom (6)
| Indicator | Function | Status |
|-----------|----------|--------|
| Price vs SMA | `price_vs_sma(closes, period)` | Pending |
| SMA of Returns | `sma_of_returns(closes, period)` | Pending |
| Cumulative Return | `cumulative_return(closes)` | Pending |
| Trend Clarity | `trend_clarity(values, period)` | Pending |
| Ultimate Smoother | `ultimate_smoother(values, period)` | Pending |
| Std Dev of Prices | `std_dev_prices(values, period)` | Pending |

---

## Project Structure

```
rust-indicators/
├── Cargo.toml
├── PLAN.md                    # This file
├── src/
│   ├── lib.rs                 # Public API exports
│   ├── common.rs              # Shared utilities (NaN handling, etc.)
│   ├── moving_averages.rs     # SMA, EMA, WMA, DEMA, TEMA, HMA, KAMA, Wilders
│   ├── oscillators.rs         # RSI variants, Stochastic, CCI, Williams%R, MFI
│   ├── momentum.rs            # MACD, PPO, ROC, Aroon, ADX, 13612, LinReg
│   ├── volatility.rs          # ATR, Bollinger, StdDev, Ulcer, Drawdown
│   ├── volume.rs              # OBV, VWAP
│   └── trend.rs               # TrendClarity, UltimateSmoother, custom
│
├── tests/
│   ├── reference_data/
│   │   └── talib_reference.json
│   ├── common.rs              # Test utilities
│   ├── test_moving_averages.rs
│   ├── test_oscillators.rs
│   ├── test_momentum.rs
│   ├── test_volatility.rs
│   ├── test_volume.rs
│   └── test_trend.rs
│
└── benches/
    └── benchmarks.rs
```

---

## Implementation Standards

### 1. Function Signature Pattern
```rust
/// Calculate Simple Moving Average
///
/// # Arguments
/// * `values` - Price or indicator values
/// * `period` - Lookback period
///
/// # Returns
/// Vector of same length as input, with NaN for insufficient data
pub fn sma(values: &[f64], period: usize) -> Vec<f64>
```

### 2. NaN Handling
- Output length always equals input length
- First `period - 1` values are NaN (insufficient lookback)
- NaN in input propagates to output appropriately
- Division by zero returns NaN, not panic

### 3. Edge Cases
- Empty input → empty output
- Period > length → all NaN
- Period = 0 → panic (invalid parameter)
- Single value → NaN (insufficient data)

### 4. Performance Goals
- No unnecessary allocations
- Single pass where possible
- Cache-friendly memory access
- SIMD-friendly loops (no branches in hot path)

---

## Testing Strategy

### Layer 1: Reference Comparison
```rust
#[test]
fn test_rsi_matches_talib() {
    let prices = load_test_prices();
    let expected = load_talib_reference("rsi_14");
    let actual = rsi(&prices, 14);
    assert_arrays_match(&actual, &expected, 1e-10);
}
```

### Layer 2: Hand-Calculated
```rust
#[test]
fn test_sma_simple() {
    let prices = vec![2.0, 4.0, 6.0, 8.0, 10.0];
    let result = sma(&prices, 3);
    assert_eq!(result[2], 4.0);  // (2+4+6)/3
    assert_eq!(result[3], 6.0);  // (4+6+8)/3
    assert_eq!(result[4], 8.0);  // (6+8+10)/3
}
```

### Layer 3: Edge Cases
```rust
#[test]
fn test_empty_input() { ... }
fn test_single_value() { ... }
fn test_period_exceeds_length() { ... }
fn test_nan_propagation() { ... }
fn test_zero_division() { ... }
```

### Layer 4: Property-Based
```rust
proptest! {
    #[test]
    fn rsi_always_between_0_and_100(prices in vec(1.0..1000.0, 20..100)) {
        let result = rsi(&prices, 14);
        for val in result.iter().filter(|x| !x.is_nan()) {
            prop_assert!(*val >= 0.0 && *val <= 100.0);
        }
    }
}
```

---

## Build Targets

### Native (Server)
```bash
cargo build --release
```

### WASM (Browser)
```bash
wasm-pack build --target web
```

---

## Dependencies

```toml
[dependencies]
# None for core library - zero dependencies for max portability

[dev-dependencies]
approx = "0.5"           # Float comparison
proptest = "1.0"         # Property-based testing
criterion = "0.5"        # Benchmarking
serde_json = "1.0"       # Load test data
```

---

## Phases

### Phase 1: Foundation (Current)
- [x] Create project structure
- [x] Write plan document
- [ ] Implement common utilities
- [ ] Implement moving averages (8 indicators)
- [ ] First test suite

### Phase 2: Core Oscillators
- [ ] Implement oscillators (10 indicators)
- [ ] RSI reference validation

### Phase 3: Momentum & Trend
- [ ] Implement momentum (12 indicators)
- [ ] MACD, ADX reference validation

### Phase 4: Volatility & Volume
- [ ] Implement volatility (10 indicators)
- [ ] Implement volume (4 indicators)

### Phase 5: Custom & Polish
- [ ] Implement custom indicators (6)
- [ ] Full test suite
- [ ] Benchmarks
- [ ] Documentation

---

## Success Criteria

1. **Correctness**: All indicators match TA-Lib output within epsilon (1e-10)
2. **Performance**: Faster than pure Python, comparable to TA-Lib C
3. **Robustness**: No panics on any valid input
4. **WASM Ready**: Compiles to WASM without modification
