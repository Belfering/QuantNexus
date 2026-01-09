# Rust Backtest Engine Performance Analysis

## Executive Summary

The Rust backtest engine processes **~750,000 condition evaluations per second** (single-threaded). For strategies with many indicators, this becomes the bottleneck:

| Strategy Complexity | Conditions | Time |
|---------------------|------------|------|
| Simple (1-10 indicators) | ~50K evals | 25-75ms |
| Medium (100 indicators) | ~500K evals | 500ms |
| Complex (1000 indicators × 10 conditions) | ~47M evals | 65 seconds |

---

## Root Cause Analysis

### Current Architecture

The engine evaluates the tree **per-day, per-node**:

```
for each day (4,700 iterations):
    for each node (N iterations):
        for each condition (M iterations):
            1. Look up indicator value from cache
            2. Compare value to threshold
            3. Apply AND/OR logic
        Determine then/else branch
    Combine all node allocations into final allocation
```

**Total operations**: `days × nodes × conditions` = O(D × N × M)

For 1000 indicators with 10 conditions over 4,700 days:
- 4,700 × 1,000 × 10 = **47 million evaluations**
- At 1.4µs per evaluation = **65 seconds**

### Why It's Slow

1. **Per-evaluation overhead**: Each condition evaluation involves:
   - HashMap lookup for cached indicator (~50ns)
   - Array index access (~5ns)
   - Floating point comparison (~2ns)
   - Branch for AND/OR logic (~5ns)
   - Total: ~100-200ns of pure work, but **~1.4µs observed** due to:

2. **Memory allocation**: Each node creates a new `HashMap<String, f64>` for its allocation

3. **Cache inefficiency**: Random access patterns when jumping between nodes

4. **No vectorization**: Conditions evaluated one at a time, not using SIMD

---

## Optimization Options

### Option 1: Rayon (Parallel Node Evaluation)

**Effort**: Low (1-2 hours)
**Expected Speedup**: 4-8x (limited by CPU cores)
**Best Case**: 65s → 8-15s

```rust
// Before
let results: Vec<_> = children.iter()
    .map(|child| evaluate_node(ctx, child))
    .collect();

// After
use rayon::prelude::*;
let results: Vec<_> = children.par_iter()
    .map(|child| evaluate_node(ctx, child))
    .collect();
```

**Limitations**:
- Synchronization overhead when combining allocations
- Cache contention between threads
- Cannot parallelize across days (sequential dependency)

---

### Option 2: SIMD Vectorization

**Effort**: Medium (1-2 days)
**Expected Speedup**: 4-8x per operation
**Best Case**: Combined with Rayon → 65s → 2-4s

```rust
// Before: Scalar comparison
for i in 0..len {
    results[i] = values[i] > threshold;
}

// After: SIMD (processes 8 f64s at once)
use std::simd::*;
let threshold_vec = f64x8::splat(threshold);
for chunk in values.chunks(8) {
    let values_vec = f64x8::from_slice(chunk);
    let mask = values_vec.simd_gt(threshold_vec);
    // Store results...
}
```

**Limitations**:
- Requires nightly Rust for `std::simd` (or use `wide` crate)
- Code complexity increases
- Only helps with bulk comparisons, not tree traversal

---

### Option 3: Algorithm Restructure (Columnar/Vectorized)

**Effort**: High (1-2 weeks)
**Expected Speedup**: 50-100x
**Best Case**: 65s → 0.5-1s

**Key Insight**: Instead of evaluating per-day, pre-compute ALL condition results as arrays:

```rust
// Current: Evaluate each condition at each day
for day in 0..4700 {
    let result = rsi[day] > 30 && sma[day] > ema[day];
}

// Better: Pre-compute condition arrays, then combine
let cond1: Vec<bool> = rsi.iter().map(|&v| v > 30.0).collect();     // Vectorizable!
let cond2: Vec<bool> = sma.iter().zip(&ema).map(|(s,e)| s > e).collect();

// Combine with bitwise AND (SIMD-friendly!)
let results: Vec<bool> = cond1.iter().zip(&cond2).map(|(a,b)| *a && *b).collect();
```

**Implementation approach**:
1. Parse tree to extract all unique conditions
2. Pre-compute each condition as `Vec<bool>` (one value per day)
3. Combine condition arrays per node using AND/OR
4. Build allocation timeline from combined results

**Libraries to consider**:
- **Polars**: DataFrame operations with built-in parallelism and SIMD
- **Arrow Compute**: Vectorized predicates on columnar data
- **ndarray**: N-dimensional arrays with parallel operations

---

### Option 4: GPU Acceleration

**Effort**: Very High (weeks)
**Expected Speedup**: 100-1000x for massive strategies
**Best Case**: 65s → <100ms

Using `wgpu` or CUDA for massively parallel evaluation. Only worthwhile for:
- 10,000+ indicator nodes
- Real-time optimization/parameter sweeps
- Monte Carlo simulations

---

## Recommended Path

### Short-term (This Week)
1. Add **Rayon** for parallel node evaluation
2. Expected improvement: **65s → 10-15s**

### Medium-term (Next Sprint)
1. Implement **columnar pre-computation** for conditions
2. Use **SIMD** for bulk comparisons
3. Expected improvement: **10s → 1-2s**

### Long-term (Future)
1. Consider **Polars** integration for complex strategies
2. Evaluate **GPU acceleration** if demand exists

---

## Benchmarks

### Current Performance (v1.0 - Single-threaded)

```
Indicators | Conditions | Days  | Evaluations | Time
-----------|------------|-------|-------------|--------
1          | 1          | 4,683 | 4,683       | 25ms
10         | 10         | 4,683 | 46,830      | 75ms
100        | 100        | 4,683 | 468,300     | 552ms
500        | 500        | 4,683 | 2.3M        | 3.1s
1,000      | 1,000      | 4,683 | 4.7M        | 6.2s
1,000      | 10,000     | 4,683 | 47M         | 65s
```

**Throughput**: ~750,000 condition evaluations/second

### Expected After Rayon (v1.1)

```
1,000 indicators × 10 conditions: 65s → ~10-15s (5x speedup)
```

### Expected After Full Optimization (v2.0)

```
1,000 indicators × 10 conditions: 65s → ~1-2s (50x speedup)
```

---

## Technical Debt & Limitations

1. **Indicator cache is not thread-safe**: Need to wrap in `RwLock` or use thread-local caches for Rayon

2. **Allocation merging is O(n)**: Combining 1000 allocations creates memory pressure

3. **No warmup caching**: Indicator values are recomputed from scratch each backtest (could cache across runs)

4. **String-based ticker keys**: Using `String` in HashMaps instead of interned symbols adds overhead

5. **No expression optimization**: Conditions like `RSI > 30 AND RSI > 40` could be simplified to `RSI > 40`

---

## Appendix: Profiling Data

### Time Breakdown (estimated)

| Operation | % of Time |
|-----------|-----------|
| Indicator cache lookup | 30% |
| HashMap allocation/insert | 25% |
| Tree traversal overhead | 20% |
| Condition comparison | 15% |
| Allocation merging | 10% |

### Memory Usage

- Per indicator cache entry: ~40KB (4700 days × 8 bytes)
- Per node allocation: ~200 bytes (avg 5 tickers × 40 bytes)
- Total for 1000-node backtest: ~50MB indicator cache + ~1GB allocation history
