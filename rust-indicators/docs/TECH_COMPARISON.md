# Technology Comparison: Backtest Engine Options

## Quick Recommendation

**Use Polars** - Best balance of performance, compatibility, and development effort.

---

## Comparison Matrix

| Criteria | Rayon | Polars | DuckDB | DataFusion | GPU (CUDA) |
|----------|-------|--------|--------|------------|------------|
| **Expected Speedup** | 4-8x | 50-130x | 30-50x | 30-50x | 100-500x |
| **Implementation Time** | 1-2 days | 2-3 weeks | 2-3 weeks | 3-4 weeks | 2-3 months |
| **Code Changes** | Minimal | Moderate | Major | Major | Complete rewrite |
| **Rust Integration** | Native | Native | FFI/SQL | Native | CUDA kernels |
| **Indicator Library** | Use existing | RusTaLib exists | Custom UDFs | Custom UDFs | Write from scratch |
| **Memory Efficiency** | Same | Better (columnar) | Better | Better | GPU memory limits |
| **Maintainability** | Easy | Medium | Medium | Hard | Hard |
| **Production Ready** | Yes | Yes | Yes | Yes | Experimental |

---

## Option Details

### 1. Rayon (Quick Win)

```rust
// Just add .par_iter() to parallelize node evaluation
children.par_iter().map(|c| evaluate_node(ctx, c)).collect()
```

**Pros:**
- 2 hours to implement
- No architecture changes
- Guaranteed to work

**Cons:**
- Limited to CPU cores (4-8x max)
- Doesn't solve fundamental inefficiency

**Best For:** Immediate improvement while planning V2

---

### 2. Polars (Recommended)

```rust
// Compile strategy to vectorized operations
let lf = LazyFrame::scan_parquet("prices/*.parquet")?
    .with_column(rsi(col("close"), 14).alias("rsi_14"))
    .with_column((col("rsi_14").gt(30)).alias("signal"))
    .collect()?;
```

**Pros:**
- 50-130x speedup proven in benchmarks
- Native Rust, easy integration
- Lazy evaluation optimizes automatically
- SIMD vectorization built-in
- RusTaLib provides indicators

**Cons:**
- Requires strategy "compilation" step
- Some node types need special handling (AltExit)

**Best For:** Production V2 engine

---

### 3. DuckDB

```sql
SELECT date,
       CASE WHEN rsi_14 > 30 THEN 'SPY' ELSE 'BIL' END as allocation
FROM (
    SELECT *, AVG(close) OVER (ROWS 14 PRECEDING) as sma_14
    FROM prices
)
```

**Pros:**
- SQL is familiar
- Excellent query optimizer
- Handles larger-than-RAM data

**Cons:**
- SQL less flexible for complex logic
- Requires compiling tree to SQL strings
- FFI overhead from Rust

**Best For:** Simpler, SQL-friendly strategies

---

### 4. DataFusion

```rust
let ctx = SessionContext::new();
ctx.register_udf(create_rsi_udf());
let df = ctx.sql("SELECT * FROM prices WHERE rsi(close,14) > 30").await?;
```

**Pros:**
- Most customizable
- True streaming support
- Apache Arrow native

**Cons:**
- More complex API
- Less mature than Polars
- Overkill for this use case

**Best For:** Building a custom query engine

---

### 5. GPU (CUDA/wgpu)

```rust
// Requires writing CUDA kernels or compute shaders
let gpu_data = upload_to_gpu(&prices);
let results = execute_kernel("rsi_kernel", gpu_data, params);
```

**Pros:**
- Massive parallelism (1000+ cores)
- Best for parameter sweeps/optimization

**Cons:**
- GPU memory limits (~8-24GB)
- Data transfer overhead
- Completely different programming model
- 2-3 months to implement properly

**Best For:** Monte Carlo, hyperparameter optimization

---

## Performance Projections

### Current V1 (Single-threaded Tree Evaluation)
```
10 indicators:    75ms
100 indicators:   550ms
1000 × 10 cond:   65,000ms (65 seconds)
```

### With Rayon (Parallel Tree Evaluation)
```
10 indicators:    25ms   (3x)
100 indicators:   100ms  (5x)
1000 × 10 cond:   10,000ms (6x)
```

### With Polars (Vectorized Columnar)
```
10 indicators:    10ms   (7x)
100 indicators:   30ms   (18x)
1000 × 10 cond:   500ms  (130x)
```

### With GPU (Theoretical Maximum)
```
10 indicators:    5ms    (15x)
100 indicators:   8ms    (70x)
1000 × 10 cond:   50ms   (1300x)
```

---

## Recommended Path

### Immediate (This Week)
1. Add **Rayon** for 4-8x improvement
2. Time: 1-2 days
3. Risk: Zero

### Short-term (Next 2-3 Weeks)
1. Implement **Polars-based V2 engine**
2. Start with flat strategies (basic → indicators)
3. Validate results match V1
4. Time: 2-3 weeks
5. Risk: Low-Medium

### Long-term (If Needed)
1. GPU acceleration for optimization workloads
2. Only if users need parameter sweeps at scale
3. Time: 2-3 months
4. Risk: High

---

## Decision Criteria

Choose **Rayon only** if:
- Need improvement TODAY
- 4-8x speedup is sufficient
- No time for larger refactor

Choose **Polars** if:
- Need 50-100x+ speedup
- Want production-quality solution
- Have 2-3 weeks for implementation

Choose **DuckDB** if:
- Team prefers SQL
- Strategies are relatively simple
- Need out-of-core processing

Choose **GPU** if:
- Running millions of backtests (parameter optimization)
- Have GPU infrastructure
- Willing to invest 2-3 months
