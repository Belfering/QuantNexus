# Rust Backtest Engine Fix Plan

## Summary of Issues Found

Based on deep dive comparison of Node.js vs Rust implementations:

| Issue | Impact | Effort |
|-------|--------|--------|
| Function Node Scoring | HIGH - causes wrong allocations | Medium |
| Avg Holdings 32 vs 21 | HIGH - visible to user | Related to #1 |
| Capped Weighting | LOW - rarely used | Low |
| Branch References | MEDIUM - some strategies need it | High |

## Root Cause of Avg Holdings Difference

**The Function node (pick top/bottom N) uses different scoring logic:**

- **Node.js**: Collects ALL position tickers from child subtree, averages their metric values
- **Rust**: Uses tickers from the ALLOCATION (already evaluated), weighted average

This causes Rust to pick different children, leading to different final allocations.

---

## Phase 1: Fix Function Node Scoring (Priority 1)

### Current Rust Code (nodes/function.rs)
```rust
fn get_child_score(ctx, alloc, metric, window) -> Option<f64> {
    // WRONG: Uses tickers from allocation
    for (ticker, &weight) in alloc {
        if let Some(value) = metric_at_index(...) {
            total_score += value * weight;
        }
    }
}
```

### Required Fix
```rust
fn get_child_score(ctx, child_node, metric, window) -> Option<f64> {
    // CORRECT: Collect position tickers from child subtree
    let tickers = collect_position_tickers(child_node);
    if tickers.is_empty() { return None; }

    let mut sum = 0.0;
    let mut count = 0;
    for ticker in &tickers {
        if let Some(value) = metric_at_index(ctx, ticker, metric, window) {
            sum += value;
            count += 1;
        }
    }
    if count == 0 { return None; }
    Some(sum / count as f64)
}
```

### Files to Modify
1. `src/backtest/nodes/function.rs` - Change scoring logic
2. `src/backtest/runner.rs` - Ensure `collect_position_tickers` is accessible

### Test
- Run BWC Blackworks with Rust
- Avg Holdings should be ~21 (matching Node.js)

---

## Phase 2: Verify Indicator Index Timing (Priority 2)

### Issue
Node.js uses different indicator index based on decision price:
```javascript
const indicatorIndex = decisionPrice === 'open' ? i - 1 : i
```

### Verify in Rust
Check `src/backtest/context.rs` and `runner.rs`:
- `CC` mode (close-to-close): indicator_index = day_index
- `OO` mode (open-to-open): indicator_index = day_index - 1

### Files to Check
1. `src/backtest/context.rs` - EvalContext.set_day()
2. `src/backtest/runner.rs` - How ctx is set up per day

---

## Phase 3: Implement Capped Weighting (Priority 3)

### Current State
```rust
WeightMode::Capped => equal_weights(children.len()), // TODO
```

### Required Implementation
```rust
WeightMode::Capped => {
    // Cap at 20% per position, redistribute excess
    let cap = 0.20;
    let mut weights = equal_weights(children.len());
    loop {
        let excess: f64 = weights.iter().map(|w| (w - cap).max(0.0)).sum();
        if excess < 0.001 { break; }
        let uncapped: Vec<usize> = weights.iter().enumerate()
            .filter(|(_, w)| **w < cap)
            .map(|(i, _)| i)
            .collect();
        if uncapped.is_empty() { break; }
        for i in 0..weights.len() {
            if weights[i] > cap {
                weights[i] = cap;
            }
        }
        let redistribute = excess / uncapped.len() as f64;
        for i in uncapped {
            weights[i] += redistribute;
        }
    }
    weights
}
```

### Files to Modify
1. `src/backtest/weighting.rs`

---

## Phase 4: Branch References (Priority 4 - Future)

This is complex and requires:
1. Pre-computing branch equity curves
2. Passing them to condition evaluation
3. Handling circular dependencies

**Skip for now unless needed.**

---

## Implementation Order

```
Day 1: Phase 1 - Fix Function Node Scoring
  - Modify get_child_score to use collect_position_tickers
  - Build and test locally
  - Deploy and compare Avg Holdings

Day 2: Phase 2 - Verify Indicator Index
  - Add logging to confirm timing matches
  - Fix if needed

Day 3: Phase 3 - Capped Weighting (if needed)
  - Implement cap logic
  - Test with strategy that uses capped weighting
```

---

## Quick Win: Phase 1 Implementation

### Step 1: Add helper function
```rust
// In nodes/function.rs
fn collect_child_position_tickers(node: &FlowNode) -> Vec<String> {
    let mut tickers = Vec::new();
    collect_position_tickers_recursive(node, &mut tickers);
    tickers.sort();
    tickers.dedup();
    tickers
}

fn collect_position_tickers_recursive(node: &FlowNode, tickers: &mut Vec<String>) {
    if let Some(positions) = &node.positions {
        for p in positions {
            if !p.is_empty() && p != "Empty" {
                tickers.push(p.clone());
            }
        }
    }
    for children in node.children.values() {
        for child in children.iter().flatten() {
            collect_position_tickers_recursive(child, tickers);
        }
    }
}
```

### Step 2: Modify scoring
```rust
// Change from:
let score = get_child_score(ctx, &alloc, metric, window);

// To:
let score = get_child_score_from_tickers(ctx, child, metric, window);

fn get_child_score_from_tickers(
    ctx: &EvalContext,
    child: &FlowNode,
    metric: &str,
    window: u32,
) -> Option<f64> {
    let tickers = collect_child_position_tickers(child);
    if tickers.is_empty() { return None; }

    let mut sum = 0.0;
    let mut count = 0;
    for ticker in &tickers {
        if let Some(value) = metric_at_index(ctx.cache, ctx.db, ticker, metric, window, ctx.indicator_index) {
            if !value.is_nan() {
                sum += value;
                count += 1;
            }
        }
    }
    if count == 0 { return None; }
    Some(sum / count as f64)
}
```

---

## Success Criteria

After Phase 1:
- [ ] Avg Holdings matches Node.js (~21 vs ~21)
- [ ] CAGR matches within 1%
- [ ] Max Drawdown matches within 0.5%
- [ ] Win Rate matches within 2%
