// src/backtest/vectorized_engine.rs
// High-performance vectorized backtest engine using native Rust
//
// This engine pre-computes all indicators and conditions as vectors,
// then evaluates allocations in a single pass - no per-day tree walking.

use std::collections::HashMap;
use std::path::Path;

use crate::backtest::types::{
    BacktestMetrics, BacktestRequest, BacktestResponse,
    Comparator, ConditionLine, ConditionType, FlowNode, BlockKind,
    EquityPoint, AllocationRow, AllocationEntry, DayRow, MonthlyReturn,
    NumberedQuantifier,
};
use crate::backtest::context::{PriceDb, IndicatorCache};
use crate::backtest::indicators::compute_indicator;
use crate::backtest::runner::{build_price_db_with_date_filter, collect_position_tickers, collect_indicator_tickers, find_first_valid_pos_index};

// ============================================================================
// STRATEGY ANALYSIS
// ============================================================================

/// Check if a strategy can be fully vectorized
/// Returns false for strategies with AltExit nodes or branch references
pub fn can_vectorize(node: &FlowNode) -> bool {
    // AltExit nodes are stateful - can't vectorize
    if matches!(node.kind, BlockKind::AltExit) {
        return false;
    }

    // Call nodes reference external strategies - can't vectorize
    if matches!(node.kind, BlockKind::Call) {
        return false;
    }

    // Check for branch references in conditions
    if let Some(conditions) = &node.conditions {
        for cond in conditions {
            if cond.ticker.starts_with("branch:") {
                return false;
            }
            if let Some(ref right_ticker) = cond.right_ticker {
                if right_ticker.starts_with("branch:") {
                    return false;
                }
            }
        }
    }

    // Check entry/exit conditions for branch refs
    if let Some(conditions) = &node.entry_conditions {
        for cond in conditions {
            if cond.ticker.starts_with("branch:") {
                return false;
            }
        }
    }
    if let Some(conditions) = &node.exit_conditions {
        for cond in conditions {
            if cond.ticker.starts_with("branch:") {
                return false;
            }
        }
    }

    // Check scaling for branch refs
    if let Some(ticker) = &node.scale_ticker {
        if ticker.starts_with("branch:") {
            return false;
        }
    }

    // Recursively check children
    for children in node.children.values() {
        for child in children.iter().flatten() {
            if !can_vectorize(child) {
                return false;
            }
        }
    }

    true
}

// ============================================================================
// SIGNAL COMPILATION
// ============================================================================

/// A compiled signal - pre-computed boolean array for each day
#[derive(Clone)]
struct Signal {
    values: Vec<bool>,
}

/// Compiled position with its activation signal
#[derive(Clone)]
struct CompiledPosition {
    ticker: String,
    signal_idx: usize,
    weight: f64,
}

/// Compile a single condition to a boolean vector
fn compile_condition(
    cond: &ConditionLine,
    cache: &mut IndicatorCache,
    db: &PriceDb,
    num_days: usize,
) -> Vec<bool> {
    let mut result = vec![false; num_days];

    // Handle date conditions
    if cond.metric == "Date" {
        for (i, date) in db.date_strings.iter().enumerate() {
            result[i] = check_date_condition(cond, date);
        }
        return result;
    }

    // Get indicator values
    let values = match compute_indicator(cache, db, &cond.ticker, &cond.metric, cond.window) {
        Some(v) => v,
        None => return result,
    };

    // Handle expanded mode (ticker vs ticker comparison)
    if cond.expanded {
        if let (Some(ref right_metric), Some(ref right_ticker)) = (&cond.right_metric, &cond.right_ticker) {
            let right_window = cond.right_window.unwrap_or(cond.window);
            if let Some(right_values) = compute_indicator(cache, db, right_ticker, right_metric, right_window) {
                for i in 0..num_days.min(values.len()).min(right_values.len()) {
                    let left = values[i];
                    let right = right_values[i];
                    if left.is_nan() || right.is_nan() {
                        continue;
                    }
                    result[i] = match cond.comparator {
                        Comparator::Gt => left > right,
                        Comparator::Lt => left < right,
                        Comparator::CrossAbove => {
                            if i == 0 { false }
                            else {
                                let prev_left = values[i - 1];
                                let prev_right = right_values[i - 1];
                                !prev_left.is_nan() && !prev_right.is_nan() &&
                                left > right && prev_left <= prev_right
                            }
                        }
                        Comparator::CrossBelow => {
                            if i == 0 { false }
                            else {
                                let prev_left = values[i - 1];
                                let prev_right = right_values[i - 1];
                                !prev_left.is_nan() && !prev_right.is_nan() &&
                                left < right && prev_left >= prev_right
                            }
                        }
                    };
                }
            }
            return apply_for_days(&result, cond.for_days);
        }
    }

    // Standard condition: indicator vs threshold
    let threshold = cond.threshold;
    for i in 0..num_days.min(values.len()) {
        let val = values[i];
        if val.is_nan() {
            continue;
        }
        result[i] = match cond.comparator {
            Comparator::Gt => val > threshold,
            Comparator::Lt => val < threshold,
            Comparator::CrossAbove => {
                if i == 0 { false }
                else {
                    let prev = values[i - 1];
                    !prev.is_nan() && val > threshold && prev <= threshold
                }
            }
            Comparator::CrossBelow => {
                if i == 0 { false }
                else {
                    let prev = values[i - 1];
                    !prev.is_nan() && val < threshold && prev >= threshold
                }
            }
        };
    }

    apply_for_days(&result, cond.for_days)
}

/// Apply forDays requirement - condition must be true for N consecutive days
fn apply_for_days(signal: &[bool], for_days: u32) -> Vec<bool> {
    if for_days <= 1 {
        return signal.to_vec();
    }

    let n = signal.len();
    let mut result = vec![false; n];
    let window = for_days as usize;

    for i in (window - 1)..n {
        let all_true = (0..window).all(|j| signal[i - j]);
        result[i] = all_true;
    }

    result
}

/// Check date condition against a date string (YYYY-MM-DD format)
fn check_date_condition(cond: &ConditionLine, date: &str) -> bool {
    let parts: Vec<&str> = date.split('-').collect();
    if parts.len() < 3 {
        return false;
    }

    let month: u32 = parts[1].parse().unwrap_or(0);
    let day: u32 = parts[2].parse().unwrap_or(0);

    if let (Some(cond_month), Some(cond_day)) = (cond.date_month, cond.date_day) {
        if let Some(ref to) = cond.date_to {
            let start = (cond_month, cond_day);
            let end = (to.month, to.day);
            let current = (month, day);

            if end < start {
                current >= start || current <= end
            } else {
                current >= start && current <= end
            }
        } else {
            month == cond_month && day == cond_day
        }
    } else {
        true
    }
}

/// Compile conditions for a node (combining with AND/OR logic)
fn compile_node_conditions(
    conditions: &[ConditionLine],
    cache: &mut IndicatorCache,
    db: &PriceDb,
    num_days: usize,
) -> Vec<bool> {
    if conditions.is_empty() {
        return vec![true; num_days];
    }

    let mut result: Option<Vec<bool>> = None;

    for cond in conditions {
        let cond_signal = compile_condition(cond, cache, db, num_days);

        result = Some(match &result {
            None => cond_signal,
            Some(prev) => {
                let mut combined = vec![false; num_days];
                for i in 0..num_days {
                    combined[i] = match cond.cond_type {
                        ConditionType::If => cond_signal[i],
                        ConditionType::And => prev[i] && cond_signal[i],
                        ConditionType::Or => prev[i] || cond_signal[i],
                    };
                }
                combined
            }
        });
    }

    result.unwrap_or_else(|| vec![true; num_days])
}

/// Compile numbered node signal
fn compile_numbered_signal(
    numbered: &crate::backtest::types::NumberedConfig,
    cache: &mut IndicatorCache,
    db: &PriceDb,
    num_days: usize,
    parent_signal: Option<&Vec<bool>>,
) -> Vec<bool> {
    if numbered.items.is_empty() {
        return parent_signal.cloned().unwrap_or_else(|| vec![true; num_days]);
    }

    let item_signals: Vec<Vec<bool>> = numbered.items.iter()
        .map(|item| compile_node_conditions(&item.conditions, cache, db, num_days))
        .collect();

    let mut combined = vec![false; num_days];

    for i in 0..num_days {
        let count: usize = item_signals.iter().filter(|s| s[i]).count();

        combined[i] = match numbered.quantifier {
            NumberedQuantifier::Any => count > 0,
            NumberedQuantifier::All => count == item_signals.len(),
            NumberedQuantifier::None => count == 0,
            NumberedQuantifier::Exactly => count == numbered.n as usize,
            NumberedQuantifier::AtLeast => count >= numbered.n as usize,
            NumberedQuantifier::AtMost => count <= numbered.n as usize,
            NumberedQuantifier::Ladder => count > 0,
        };
    }

    if let Some(parent) = parent_signal {
        for i in 0..num_days {
            combined[i] = combined[i] && parent[i];
        }
    }

    combined
}

// ============================================================================
// TREE COMPILATION
// ============================================================================

/// Compile the strategy tree to position signals
fn compile_strategy(
    node: &FlowNode,
    cache: &mut IndicatorCache,
    db: &PriceDb,
    num_days: usize,
    parent_signal: Option<&Vec<bool>>,
    positions: &mut Vec<CompiledPosition>,
    signals: &mut Vec<Signal>,
) {
    let signal_idx = signals.len();

    // Build this node's signal
    let node_signal = match node.kind {
        BlockKind::Indicator => {
            let cond_signal = if let Some(ref conditions) = node.conditions {
                compile_node_conditions(conditions, cache, db, num_days)
            } else {
                vec![true; num_days]
            };

            if let Some(parent) = parent_signal {
                let mut combined = vec![false; num_days];
                for i in 0..num_days {
                    combined[i] = parent[i] && cond_signal[i];
                }
                combined
            } else {
                cond_signal
            }
        }
        BlockKind::Numbered => {
            if let Some(ref numbered) = node.numbered {
                compile_numbered_signal(numbered, cache, db, num_days, parent_signal)
            } else {
                parent_signal.cloned().unwrap_or_else(|| vec![true; num_days])
            }
        }
        _ => {
            parent_signal.cloned().unwrap_or_else(|| vec![true; num_days])
        }
    };

    signals.push(Signal { values: node_signal.clone() });

    // Process children based on node type
    match node.kind {
        BlockKind::Indicator => {
            let then_signal: Vec<bool> = node_signal.clone();
            let else_signal: Vec<bool> = node_signal.iter().map(|&b| !b).collect();

            if let Some(then_children) = node.children.get("then") {
                for child in then_children.iter().flatten() {
                    compile_strategy(child, cache, db, num_days, Some(&then_signal), positions, signals);
                }
            }

            if let Some(else_children) = node.children.get("else") {
                for child in else_children.iter().flatten() {
                    compile_strategy(child, cache, db, num_days, Some(&else_signal), positions, signals);
                }
            }
        }
        BlockKind::Position => {
            if let Some(ref pos_list) = node.positions {
                let weight = 1.0 / pos_list.len().max(1) as f64;
                for ticker in pos_list {
                    if !ticker.is_empty() && ticker != "Empty" {
                        positions.push(CompiledPosition {
                            ticker: ticker.clone(),
                            signal_idx,
                            weight,
                        });
                    }
                }
            }
        }
        _ => {
            if let Some(next_children) = node.children.get("next") {
                for child in next_children.iter().flatten() {
                    compile_strategy(child, cache, db, num_days, Some(&node_signal), positions, signals);
                }
            }
        }
    }
}

// ============================================================================
// TICKER COLLECTION
// ============================================================================

/// Collect all tickers from a strategy recursively
fn collect_tickers_recursive(node: &FlowNode, tickers: &mut Vec<String>) {
    // Position tickers
    if let Some(positions) = &node.positions {
        for pos in positions {
            if pos != "Empty" && !pos.is_empty() && !pos.starts_with("branch:") {
                if pos.contains('/') {
                    let parts: Vec<&str> = pos.split('/').collect();
                    if parts.len() == 2 {
                        tickers.push(parts[0].to_string());
                        tickers.push(parts[1].to_string());
                    }
                } else {
                    tickers.push(pos.clone());
                }
            }
        }
    }

    // Condition tickers
    if let Some(conditions) = &node.conditions {
        for cond in conditions {
            add_ticker(&cond.ticker, tickers);
            if let Some(ref rt) = cond.right_ticker {
                add_ticker(rt, tickers);
            }
        }
    }

    // Numbered items
    if let Some(numbered) = &node.numbered {
        for item in &numbered.items {
            for cond in &item.conditions {
                add_ticker(&cond.ticker, tickers);
            }
        }
    }

    // Scaling ticker
    if let Some(ticker) = &node.scale_ticker {
        add_ticker(ticker, tickers);
    }

    // Recurse into children
    for children in node.children.values() {
        for child in children.iter().flatten() {
            collect_tickers_recursive(child, tickers);
        }
    }
}

fn add_ticker(ticker: &str, tickers: &mut Vec<String>) {
    if ticker.is_empty() || ticker == "Empty" || ticker.starts_with("branch:") {
        return;
    }
    if ticker.contains('/') {
        let parts: Vec<&str> = ticker.split('/').collect();
        if parts.len() == 2 {
            tickers.push(parts[0].to_string());
            tickers.push(parts[1].to_string());
        }
    } else {
        tickers.push(ticker.to_string());
    }
}

// ============================================================================
// MAIN BACKTEST FUNCTION
// ============================================================================

/// Run backtest using vectorized engine
pub fn run_backtest_vectorized(
    parquet_dir: &Path,
    request: &BacktestRequest,
) -> Result<BacktestResponse, String> {
    let start_time = std::time::Instant::now();

    // Parse strategy - use custom deserializer for deeply nested strategies
    let mut deserializer = serde_json::Deserializer::from_str(&request.payload);
    deserializer.disable_recursion_limit();
    let node: FlowNode = serde::de::Deserialize::deserialize(&mut deserializer)
        .map_err(|e| format!("Failed to parse strategy: {}", e))?;

    // Check if we can vectorize this strategy
    if !can_vectorize(&node) {
        return Err("Strategy contains AltExit or branch references - use standard engine".into());
    }

    // Collect indicator tickers (for date intersection) and all tickers
    let indicator_tickers = collect_indicator_tickers(&node);
    let position_tickers = collect_position_tickers(&node);

    // Build combined list of all tickers
    let mut all_tickers = Vec::new();
    collect_tickers_recursive(&node, &mut all_tickers);
    all_tickers.sort();
    all_tickers.dedup();

    // Always include SPY for benchmark
    if !all_tickers.contains(&"SPY".to_string()) {
        all_tickers.push("SPY".to_string());
    }

    if all_tickers.is_empty() {
        return Err("No tickers found in strategy".into());
    }

    eprintln!("[Vectorized] Loading price data: {} indicator tickers, {} position tickers, {} total",
              indicator_tickers.len(), position_tickers.len(), all_tickers.len());
    eprintln!("[Vectorized] Indicator tickers (for date filter): {:?}", indicator_tickers);
    let load_start = std::time::Instant::now();

    // Load price database using indicator tickers for date intersection
    // This matches Node.js behavior: indicator tickers determine the date range
    let db = build_price_db_with_date_filter(parquet_dir, &indicator_tickers, &all_tickers)?;
    let num_days = db.len();

    if num_days < 252 {
        return Err(format!("Not enough data: {} days (need at least 252)", num_days));
    }

    eprintln!("[Vectorized] Data loaded in {:?}, {} days", load_start.elapsed(), num_days);

    // Find first valid position index - when ALL position tickers have data
    // This matches Node.js behavior to start backtesting only when all tickers are available
    let first_valid_pos_index = find_first_valid_pos_index(&db, &position_tickers);

    // Calculate start index: max of lookback period and first valid position index
    // Use at least 50 days lookback for indicator warmup, similar to Node.js
    let lookback = 50.max(252.min(num_days / 10));
    let start_idx = first_valid_pos_index.max(lookback);

    eprintln!("[Vectorized] Position tickers: {}, first_valid_pos_index: {}, lookback: {}, start_idx: {}",
              position_tickers.len(), first_valid_pos_index, lookback, start_idx);

    // Create indicator cache
    let mut cache = IndicatorCache::new();

    // Compile strategy to signals
    let compile_start = std::time::Instant::now();
    let mut positions = Vec::new();
    let mut signals = Vec::new();

    compile_strategy(&node, &mut cache, &db, num_days, None, &mut positions, &mut signals);

    eprintln!("[Vectorized] Compiled {} signals, {} positions in {:?}",
              signals.len(), positions.len(), compile_start.elapsed());

    // Build allocations and equity curve
    let alloc_start = std::time::Instant::now();
    let (equity_curve, benchmark_curve, drawdown_points, days, allocation_rows, monthly, metrics) =
        build_results(&db, &positions, &signals, request.cost_bps, num_days, start_idx)?;

    eprintln!("[Vectorized] Results built in {:?}", alloc_start.elapsed());
    eprintln!("[Vectorized] Total time: {:?}", start_time.elapsed());

    Ok(BacktestResponse {
        equity_curve,
        benchmark_curve: Some(benchmark_curve),
        drawdown_points,
        markers: vec![],
        metrics,
        days,
        allocations: allocation_rows,
        warnings: vec![],
        monthly,
    })
}

/// Build results from compiled signals
fn build_results(
    db: &PriceDb,
    positions: &[CompiledPosition],
    signals: &[Signal],
    cost_bps: f64,
    num_days: usize,
    start_idx: usize,
) -> Result<(Vec<EquityPoint>, Vec<EquityPoint>, Vec<EquityPoint>, Vec<DayRow>, Vec<AllocationRow>, Vec<MonthlyReturn>, BacktestMetrics), String> {


    let mut equity_curve = Vec::new();
    let mut benchmark_curve = Vec::new();
    let mut drawdown_points = Vec::new();
    let mut days = Vec::new();
    let mut allocation_rows = Vec::new();
    let mut daily_returns = Vec::new();

    let mut current_equity = 1.0;
    let mut spy_equity = 1.0;
    let mut peak = 1.0;
    let mut prev_alloc: HashMap<String, f64> = HashMap::new();
    let mut total_turnover = 0.0;
    let mut total_holdings = 0.0;

    let cost_rate = cost_bps / 10000.0;

    let spy_closes = db.get_close_series("SPY");

    for i in start_idx..num_days {
        let date_str = db.date_strings.get(i).map(|s| s.as_str()).unwrap_or("");

        // Calculate allocation based on signals (use previous day's signal)
        let signal_day = i.saturating_sub(1);
        let mut alloc: HashMap<String, f64> = HashMap::new();

        for pos in positions {
            let signal_active = signals.get(pos.signal_idx)
                .map(|s| s.values.get(signal_day).copied().unwrap_or(false))
                .unwrap_or(false);

            if signal_active && pos.ticker != "Empty" && !pos.ticker.is_empty() {
                *alloc.entry(pos.ticker.clone()).or_insert(0.0) += pos.weight;
            }
        }

        // Normalize allocations
        let total: f64 = alloc.values().sum();
        if total > 0.0 {
            for weight in alloc.values_mut() {
                *weight /= total;
            }
        }

        // Calculate return
        let mut daily_ret = 0.0;
        for (ticker, &weight) in &alloc {
            if weight <= 0.0 {
                continue;
            }

            if let Some(closes) = db.get_close_series(ticker) {
                let today = closes.get(i).copied();
                let yesterday = closes.get(i.saturating_sub(1)).copied();

                if let (Some(t), Some(y)) = (today, yesterday) {
                    if y > 0.0 && !y.is_nan() && !t.is_nan() {
                        daily_ret += weight * ((t - y) / y);
                    }
                }
            }
        }

        // Calculate turnover
        let mut turnover = 0.0;
        for (ticker, &weight) in &alloc {
            let prev_weight = prev_alloc.get(ticker).copied().unwrap_or(0.0);
            turnover += (weight - prev_weight).abs();
        }
        for (ticker, &prev_weight) in &prev_alloc {
            if !alloc.contains_key(ticker) {
                turnover += prev_weight;
            }
        }
        turnover /= 2.0;

        let cost = turnover * cost_rate;
        let net_ret = daily_ret - cost;

        current_equity *= 1.0 + net_ret;
        daily_returns.push(net_ret);

        if current_equity > peak {
            peak = current_equity;
        }
        let drawdown = (current_equity - peak) / peak;

        // SPY benchmark
        let spy_ret = if let Some(spy) = spy_closes {
            let today = spy.get(i).copied();
            let yesterday = spy.get(i.saturating_sub(1)).copied();
            if let (Some(t), Some(y)) = (today, yesterday) {
                if y > 0.0 && !y.is_nan() && !t.is_nan() { (t - y) / y } else { 0.0 }
            } else {
                0.0
            }
        } else {
            0.0
        };
        spy_equity *= 1.0 + spy_ret;

        total_turnover += turnover;
        total_holdings += alloc.len() as f64;

        equity_curve.push(EquityPoint {
            date: date_str.to_string(),
            equity: current_equity,
        });
        benchmark_curve.push(EquityPoint {
            date: date_str.to_string(),
            equity: spy_equity,
        });
        drawdown_points.push(EquityPoint {
            date: date_str.to_string(),
            equity: drawdown,
        });

        let holdings: Vec<AllocationEntry> = alloc.iter()
            .map(|(t, &w)| AllocationEntry { ticker: t.clone(), weight: w })
            .collect();

        days.push(DayRow {
            time: 0,
            date: date_str.to_string(),
            equity: current_equity,
            drawdown,
            gross_return: daily_ret,
            net_return: net_ret,
            turnover,
            cost,
            holdings: holdings.clone(),
        });

        allocation_rows.push(AllocationRow {
            date: date_str.to_string(),
            entries: holdings,
        });

        prev_alloc = alloc;
    }

    // Calculate metrics
    let num_days_calc = daily_returns.len();
    let years = num_days_calc as f64 / 252.0;

    // All metrics as decimals to match V1 engine and frontend expectations
    let total_return = current_equity - 1.0;  // Decimal (e.g., 2.456 for 245.6%)
    let cagr = if years > 0.0 {
        current_equity.powf(1.0 / years) - 1.0  // Decimal (e.g., 0.10 for 10%)
    } else {
        0.0
    };

    let mean_ret = daily_returns.iter().sum::<f64>() / num_days_calc as f64;
    let vol = if num_days_calc > 1 {
        let var: f64 = daily_returns.iter().map(|r| (r - mean_ret).powi(2)).sum::<f64>() / (num_days_calc - 1) as f64;
        var.sqrt() * (252.0_f64).sqrt()  // Decimal (annualized std dev)
    } else {
        0.0
    };

    // Max drawdown as negative decimal (e.g., -0.33 for -33%)
    let max_dd = drawdown_points.iter()
        .map(|p| p.equity)  // Already negative from (current - peak) / peak
        .fold(0.0_f64, f64::min);  // Get most negative value

    let sharpe = if vol > 0.0 { cagr / vol } else { 0.0 };
    let calmar = if max_dd != 0.0 { cagr / max_dd.abs() } else { 0.0 };

    let downside_returns: Vec<f64> = daily_returns.iter().filter(|&&r| r < 0.0).copied().collect();
    let downside_vol = if downside_returns.len() > 1 {
        let mean_down = downside_returns.iter().sum::<f64>() / downside_returns.len() as f64;
        let var: f64 = downside_returns.iter().map(|r| (r - mean_down).powi(2)).sum::<f64>() / (downside_returns.len() - 1) as f64;
        var.sqrt() * (252.0_f64).sqrt()  // Decimal
    } else {
        vol
    };
    let sortino = if downside_vol > 0.0 { cagr / downside_vol } else { sharpe };

    let winning_days = daily_returns.iter().filter(|&&r| r > 0.0).count();
    let win_rate = winning_days as f64 / num_days_calc as f64;  // Decimal (e.g., 0.55 for 55%)

    let best_day = daily_returns.iter().fold(f64::NEG_INFINITY, |a, &b| a.max(b));  // Decimal
    let worst_day = daily_returns.iter().fold(f64::INFINITY, |a, &b| a.min(b));  // Decimal

    let avg_turnover = if num_days_calc > 1 { total_turnover / (num_days_calc - 1) as f64 } else { 0.0 };
    let avg_holdings = if num_days_calc > 0 { total_holdings / num_days_calc as f64 } else { 0.0 };

    let monthly = calculate_monthly(&equity_curve);

    let start_date = equity_curve.first().map(|e| e.date.clone()).unwrap_or_default();
    let end_date = equity_curve.last().map(|e| e.date.clone()).unwrap_or_default();

    let metrics = BacktestMetrics {
        start_date,
        end_date,
        days: num_days_calc as u32,
        years,
        total_return,  // Decimal
        cagr,
        vol,
        max_drawdown: max_dd,
        calmar,
        sharpe,
        sortino,
        treynor: 0.0,
        beta: 0.0,
        win_rate,
        best_day,
        worst_day,
        avg_turnover,  // Decimal
        avg_holdings,
    };

    Ok((equity_curve, benchmark_curve, drawdown_points, days, allocation_rows, monthly, metrics))
}

fn calculate_monthly(equity_curve: &[EquityPoint]) -> Vec<MonthlyReturn> {
    if equity_curve.is_empty() {
        return vec![];
    }

    let mut monthly = Vec::new();
    let mut prev_equity = 1.0;
    let mut current_year = 0i32;
    let mut current_month = 0u32;

    for point in equity_curve {
        let parts: Vec<&str> = point.date.split('-').collect();
        if parts.len() >= 2 {
            let year: i32 = parts[0].parse().unwrap_or(0);
            let month: u32 = parts[1].parse().unwrap_or(0);

            if year != current_year || month != current_month {
                if current_year > 0 {
                    let month_return = (point.equity / prev_equity) - 1.0;
                    monthly.push(MonthlyReturn {
                        year: current_year,
                        month: current_month,
                        value: month_return,
                    });
                }
                current_year = year;
                current_month = month;
                prev_equity = point.equity;
            }
        }
    }

    if current_year > 0 && !equity_curve.is_empty() {
        let final_equity = equity_curve.last().unwrap().equity;
        let month_return = (final_equity / prev_equity) - 1.0;
        monthly.push(MonthlyReturn {
            year: current_year,
            month: current_month,
            value: month_return,
        });
    }

    monthly
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_apply_for_days() {
        let signal = vec![true, true, true, false, true, true, true, true];
        assert_eq!(apply_for_days(&signal, 1), signal);

        let result = apply_for_days(&signal, 3);
        assert_eq!(result, vec![false, false, true, false, false, false, true, true]);
    }
}
