# Backtest Engine V2: High-Performance Architecture

## Executive Summary

After extensive research and benchmarking, this document outlines the path to achieving **50-100x performance improvement** for the backtest engine. The key insight: **switch from interpreted tree evaluation to compiled columnar computation using Polars**.

### Current State
- **1000 indicators × 10 conditions**: 65 seconds
- **Bottleneck**: Per-day, per-node tree traversal (47M evaluations)

### Target State
- **1000 indicators × 10 conditions**: <1 second
- **Architecture**: Vectorized columnar computation with SIMD

---

## Research Findings

### Industry Benchmarks

| Library | Performance vs Pandas | Best For |
|---------|----------------------|----------|
| **Polars** | 10-3500x faster | In-memory vectorized ops |
| **DuckDB** | 10-100x faster | SQL-based analytics |
| **DataFusion** | 10-50x faster | Custom query engines |

Sources:
- [DuckDB vs Polars vs Pandas Benchmark](https://www.codecentric.de/en/knowledge-hub/blog/duckdb-vs-dataframe-libraries)
- [Polars PDS-H Benchmark (May 2025)](https://pola.rs/posts/benchmarks/)
- [Small Data Showdown 2025](https://milescole.dev/data-engineering/2025/06/30/Spark-v-DuckDb-v-Polars-v-Daft-Revisited.html)

### Production Trading Systems

| System | Technology | Performance |
|--------|------------|-------------|
| [VectorAlpha](https://vectoralpha.dev/) | Rust + CUDA + AVX-512 | 1M+ events/sec, 20x vs VectorBT |
| [NautilusTrader](https://github.com/nautechsystems/nautilus_trader) | Rust core + Python | Production HFT-grade |
| [Barter-rs](https://github.com/barter-rs/barter-rs) | Pure Rust | O(1) lookups, cache-friendly |
| [HFTBacktest](https://github.com/nkaz001/hftbacktest) | Rust | Full tick data simulation |

### Key Technical Insights

1. **Polars achieves 30x+ gains** through parallel execution, SIMD vectorization, and efficient algorithms ([source](https://pola.rs/))

2. **Lazy evaluation optimizes queries** with predicate pushdown and projection pushdown ([Polars Lazy API](https://docs.pola.rs/user-guide/concepts/lazy-api/))

3. **RusTaLib provides 300+ indicators** already built on Polars DataFrames ([RusTaLib](https://github.com/rustic-ml/RusTaLib))

4. **Rust SIMD outperforms C++** by 12-15% throughput, 30-40% lower tail latency ([source](https://digitaloneagency.com.au/building-ultra-high-speed-trading-systems-with-fix-api-and-rust-why-it-has-to-be-done-this-way/))

---

## Recommended Architecture: Polars-based Engine

### Why Polars?

1. **Native Rust** - Integrates with existing codebase
2. **Lazy Evaluation** - Query optimizer eliminates redundant work
3. **Built-in Parallelism** - Automatic multi-threading
4. **SIMD Vectorization** - Uses Apache Arrow under the hood
5. **Proven Performance** - "146ms for complex queries" in benchmarks
6. **Financial Ecosystem** - RusTaLib, ta-rs already exist

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     FRONTEND (React) - UNCHANGED                │
│        POST /api/backtest { payload: "...", mode: "CC" }        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    STRATEGY COMPILER                            │
│                                                                 │
│  1. Parse FlowNode tree from JSON                               │
│  2. Extract unique conditions (deduplicate)                     │
│  3. Build dependency graph                                      │
│  4. Generate Polars LazyFrame expressions                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    POLARS EXECUTION ENGINE                      │
│                                                                 │
│  LazyFrame                                                      │
│    .scan_parquet("*.parquet")           // Lazy read            │
│    .with_columns([                      // Compute indicators   │
│        rsi(col("close"), 14),                                   │
│        sma(col("close"), 20),                                   │
│        ...                                                      │
│    ])                                                           │
│    .with_columns([                      // Evaluate conditions  │
│        (col("rsi_14") > 30).alias("cond_1"),                    │
│        (col("sma_20") > col("ema_20")).alias("cond_2"),         │
│        ...                                                      │
│    ])                                                           │
│    .with_columns([                      // Combine per node     │
│        (col("cond_1") & col("cond_2")).alias("node_1_signal"),  │
│        ...                                                      │
│    ])                                                           │
│    .collect()                           // Execute with SIMD    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  AUTOMATIC OPTIMIZATIONS (handled by Polars)            │    │
│  │  • Predicate pushdown (filter early)                    │    │
│  │  • Projection pushdown (load only needed columns)       │    │
│  │  • Common subexpression elimination                     │    │
│  │  • Parallel column computation                          │    │
│  │  • SIMD vectorization (AVX2/AVX-512)                    │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ALLOCATION BUILDER                           │
│                                                                 │
│  For each day, use pre-computed signals to build allocations    │
│  (Simple iteration over boolean columns - very fast)            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    METRICS CALCULATOR                           │
│                                                                 │
│  Vectorized equity curve, drawdown, Sharpe, etc.                │
│  (All Polars operations - automatic SIMD)                       │
└─────────────────────────────────────────────────────────────────┘
```

### Code Example: Strategy Compilation

```rust
use polars::prelude::*;

/// Compile a FlowNode tree to Polars LazyFrame operations
pub fn compile_strategy(node: &FlowNode, lf: LazyFrame) -> LazyFrame {
    // Step 1: Extract all unique (ticker, indicator, window) combinations
    let indicators = extract_indicators(node);

    // Step 2: Add indicator columns
    let mut lf = lf;
    for (ticker, metric, window) in &indicators {
        let col_name = format!("{}_{}_{}", ticker, metric, window);
        lf = lf.with_column(
            compute_indicator_expr(ticker, metric, *window).alias(&col_name)
        );
    }

    // Step 3: Add condition columns (boolean)
    let conditions = extract_conditions(node);
    for (idx, cond) in conditions.iter().enumerate() {
        let col_name = format!("cond_{}", idx);
        lf = lf.with_column(
            compile_condition(cond).alias(&col_name)
        );
    }

    // Step 4: Add node signal columns (combine conditions with AND/OR)
    let nodes = extract_indicator_nodes(node);
    for (idx, node) in nodes.iter().enumerate() {
        let col_name = format!("node_{}_signal", idx);
        lf = lf.with_column(
            compile_node_signal(node, &conditions).alias(&col_name)
        );
    }

    lf
}

/// Compile a single condition to a Polars expression
fn compile_condition(cond: &Condition) -> Expr {
    let indicator_col = format!("{}_{}_{}", cond.ticker, cond.metric, cond.window);

    match cond.comparator {
        Comparator::Gt => col(&indicator_col).gt(lit(cond.threshold)),
        Comparator::Lt => col(&indicator_col).lt(lit(cond.threshold)),
        Comparator::CrossAbove => {
            // Current > threshold AND previous <= threshold
            col(&indicator_col).gt(lit(cond.threshold))
                .and(col(&indicator_col).shift(1).lt_eq(lit(cond.threshold)))
        }
        Comparator::CrossBelow => {
            col(&indicator_col).lt(lit(cond.threshold))
                .and(col(&indicator_col).shift(1).gt_eq(lit(cond.threshold)))
        }
    }
}

/// Compute indicator as Polars expression
fn compute_indicator_expr(ticker: &str, metric: &str, window: usize) -> Expr {
    let close_col = format!("{}_close", ticker);

    match metric {
        "Relative Strength Index" => {
            // RSI = 100 - (100 / (1 + RS))
            // RS = Average Gain / Average Loss
            let delta = col(&close_col) - col(&close_col).shift(1);
            let gain = when(delta.clone().gt(lit(0.0)))
                .then(delta.clone())
                .otherwise(lit(0.0));
            let loss = when(delta.clone().lt(lit(0.0)))
                .then(delta.abs())
                .otherwise(lit(0.0));
            let avg_gain = gain.rolling_mean(RollingOptionsFixedWindow {
                window_size: window,
                ..Default::default()
            });
            let avg_loss = loss.rolling_mean(RollingOptionsFixedWindow {
                window_size: window,
                ..Default::default()
            });
            let rs = avg_gain / avg_loss;
            lit(100.0) - (lit(100.0) / (lit(1.0) + rs))
        }
        "Simple Moving Average" => {
            col(&close_col).rolling_mean(RollingOptionsFixedWindow {
                window_size: window,
                ..Default::default()
            })
        }
        // ... other indicators
        _ => col(&close_col) // fallback
    }
}
```

---

## Implementation Plan

### Phase 1: Polars Integration (1 week)
- [ ] Add `polars` to Cargo.toml
- [ ] Create `strategy_compiler.rs` module
- [ ] Implement indicator expressions for top 20 indicators
- [ ] Benchmark against current engine

### Phase 2: Condition Compilation (1 week)
- [ ] Implement all comparators (gt, lt, crossAbove, crossBelow)
- [ ] Handle AND/OR logic compilation
- [ ] Support forDays (rolling window on boolean)
- [ ] Handle expanded mode (ticker vs ticker)

### Phase 3: Node Compilation (1 week)
- [ ] Basic node (weighted combination)
- [ ] Indicator node (then/else branching)
- [ ] Function node (ranking)
- [ ] Numbered node (any/all/none)

### Phase 4: Allocation & Metrics (3 days)
- [ ] Build allocations from signal columns
- [ ] Vectorized equity curve calculation
- [ ] Vectorized metrics (CAGR, Sharpe, etc.)

### Phase 5: Edge Cases (3 days)
- [ ] AltExit nodes (stateful - may need hybrid approach)
- [ ] Branch references (recursive dependencies)
- [ ] Ratio tickers (SPY/AGG)

---

## Expected Performance

| Scenario | Current (V1) | Polars (V2) | Speedup |
|----------|--------------|-------------|---------|
| Simple (10 indicators) | 75ms | ~10ms | 7x |
| Medium (100 indicators) | 550ms | ~30ms | 18x |
| Complex (1000 × 10 conditions) | 65s | ~500ms | 130x |
| Stress (10K conditions) | ~10 min | ~2s | 300x |

---

## Alternative Approaches Considered

### 1. Rayon Only (Parallel Tree Evaluation)
- **Pros**: Minimal code changes
- **Cons**: Limited to 4-8x speedup (core count)
- **Verdict**: Good quick win, but doesn't solve fundamental architecture issue

### 2. DuckDB
- **Pros**: SQL interface, excellent for analytics
- **Cons**: Less flexible for custom indicator logic
- **Verdict**: Good for simpler strategies, harder to extend

### 3. DataFusion
- **Pros**: Most customizable, streaming support
- **Cons**: More complex API, less mature ecosystem
- **Verdict**: Overkill for this use case

### 4. GPU (CUDA/wgpu)
- **Pros**: Massive parallelism (1000+ cores)
- **Cons**: Memory transfer overhead, complexity
- **Verdict**: Only worthwhile for parameter optimization at scale

### 5. Custom JIT (Cranelift)
- **Pros**: Maximum performance
- **Cons**: Enormous engineering effort
- **Verdict**: Not justified for current scale

---

## Compatibility Notes

### What Stays the Same
- Frontend React app (unchanged)
- API contract (same request/response JSON)
- FlowNode tree structure
- All existing node types supported

### What Changes
- Internal execution engine (tree walk → columnar)
- Indicator computation (per-value → vectorized)
- Condition evaluation (per-day → pre-computed arrays)

### Migration Path
1. V2 engine runs alongside V1
2. Feature flag to choose engine
3. Validate results match V1
4. Gradual rollout

---

## Dependencies to Add

```toml
[dependencies]
polars = { version = "0.46", features = ["lazy", "parquet", "simd"] }
# Optional: for pre-built indicators
# rustalib = "0.1"  # or implement our own
```

---

## References

- [Polars Documentation](https://docs.pola.rs/)
- [Polars Lazy API Guide](https://docs.pola.rs/user-guide/concepts/lazy-api/)
- [RusTaLib - Technical Indicators on Polars](https://github.com/rustic-ml/RusTaLib)
- [VectorAlpha - GPU Backtesting](https://vectoralpha.dev/)
- [NautilusTrader - Production Trading](https://github.com/nautechsystems/nautilus_trader)
- [10X Faster Trading with Polars](https://quantscience.io/newsletter/b/quant-finance-and-algorithmic-trading-with-polars)
- [Polars Market Data Analysis](https://www.pyquantnews.com/free-python-resources/unleashing-polars-for-market-data-analysis)
