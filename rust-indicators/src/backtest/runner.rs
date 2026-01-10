// src/backtest/runner.rs
// Main backtest runner - orchestrates the entire backtest

use std::collections::HashMap;
use std::path::Path;

use chrono::Datelike;
use crate::backtest::context::{DecisionPrice, EvalContext, IndicatorCache, PriceDb};
use crate::backtest::indicators::get_indicator_lookback;
use crate::backtest::metrics::{calculate_metrics, calculate_turnover};
use crate::backtest::nodes::evaluate_node;
use crate::backtest::types::*;

/// Read OHLCV data from a parquet file using Arrow
/// Parquet schema: Date (timestamp), ticker (string), Open, High, Low, Close, Adj Close, Volume
fn read_parquet_file(path: &Path) -> Option<(Vec<String>, Vec<f64>, Vec<f64>, Vec<f64>, Vec<f64>, Vec<f64>)> {
    use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
    use arrow::array::{Array, Float64Array, Int64Array, TimestampNanosecondArray};
    use std::fs::File;

    let file = File::open(path).ok()?;
    let builder = ParquetRecordBatchReaderBuilder::try_new(file).ok()?;
    let reader = builder.build().ok()?;

    let mut dates = Vec::new();
    let mut opens = Vec::new();
    let mut highs = Vec::new();
    let mut lows = Vec::new();
    let mut closes = Vec::new();
    let mut volumes = Vec::new();

    for batch_result in reader {
        let batch = batch_result.ok()?;

        // Column 0: Date (timestamp[ns, tz=UTC])
        let date_col = batch.column(0);
        let date_array = date_col.as_any().downcast_ref::<TimestampNanosecondArray>()?;

        // Column 2: Open, 3: High, 4: Low, 5: Close, 6: Adj Close, 7: Volume
        let open_col = batch.column(2).as_any().downcast_ref::<Float64Array>()?;
        let high_col = batch.column(3).as_any().downcast_ref::<Float64Array>()?;
        let low_col = batch.column(4).as_any().downcast_ref::<Float64Array>()?;
        let adj_close_col = batch.column(6).as_any().downcast_ref::<Float64Array>()?;
        let volume_col = batch.column(7).as_any().downcast_ref::<Int64Array>()?;

        for i in 0..batch.num_rows() {
            // Convert timestamp nanoseconds to YYYY-MM-DD
            let ts_nanos = date_array.value(i);
            let ts_secs = ts_nanos / 1_000_000_000;
            let date = chrono::DateTime::from_timestamp(ts_secs, 0)
                .map(|dt| dt.format("%Y-%m-%d").to_string())
                .unwrap_or_default();

            dates.push(date);
            opens.push(if open_col.is_null(i) { f64::NAN } else { open_col.value(i) });
            highs.push(if high_col.is_null(i) { f64::NAN } else { high_col.value(i) });
            lows.push(if low_col.is_null(i) { f64::NAN } else { low_col.value(i) });
            closes.push(if adj_close_col.is_null(i) { f64::NAN } else { adj_close_col.value(i) });
            volumes.push(if volume_col.is_null(i) { 0.0 } else { volume_col.value(i) as f64 });
        }
    }

    Some((dates, opens, highs, lows, closes, volumes))
}

/// Load price data for all tickers and build the price database
/// Aligns all tickers to a common date array (union of all dates)
pub fn build_price_db(
    parquet_dir: &Path,
    tickers: &[String],
) -> Result<PriceDb, String> {
    use std::collections::BTreeSet;

    // First pass: collect all unique dates from all tickers
    let mut all_dates_set: BTreeSet<String> = BTreeSet::new();
    let mut ticker_data: HashMap<String, HashMap<String, (f64, f64, f64, f64, f64)>> = HashMap::new();

    for ticker in tickers {
        let path = parquet_dir.join(format!("{}.parquet", ticker));
        if !path.exists() {
            continue;
        }

        if let Some((dates, opens, highs, lows, closes, volumes)) = read_parquet_file(&path) {
            let mut date_map: HashMap<String, (f64, f64, f64, f64, f64)> = HashMap::new();
            for (i, date) in dates.iter().enumerate() {
                all_dates_set.insert(date.clone());
                date_map.insert(date.clone(), (
                    opens.get(i).copied().unwrap_or(f64::NAN),
                    highs.get(i).copied().unwrap_or(f64::NAN),
                    lows.get(i).copied().unwrap_or(f64::NAN),
                    closes.get(i).copied().unwrap_or(f64::NAN),
                    volumes.get(i).copied().unwrap_or(0.0),
                ));
            }
            ticker_data.insert(ticker.clone(), date_map);
        }
    }

    if all_dates_set.is_empty() {
        return Err("No price data found".to_string());
    }

    // Convert to sorted vector (BTreeSet is already sorted)
    let all_dates: Vec<String> = all_dates_set.into_iter().collect();
    let num_dates = all_dates.len();

    eprintln!("[DB] Aligned {} tickers to {} common dates", ticker_data.len(), num_dates);
    if num_dates > 0 {
        eprintln!("[DB] Date range: {} to {}", all_dates.first().unwrap(), all_dates.last().unwrap());
    }

    // Second pass: align each ticker's data to the common date array
    let mut db = PriceDb::new();
    db.date_strings = all_dates.clone();

    // Parse dates to timestamps
    for date_str in &db.date_strings {
        let ts = chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
            .map(|d| d.and_hms_opt(0, 0, 0).unwrap().and_utc().timestamp())
            .unwrap_or(0);
        db.dates.push(ts);
    }

    // Build aligned arrays for each ticker
    for ticker in tickers {
        if let Some(date_map) = ticker_data.get(ticker) {
            let mut opens = vec![f64::NAN; num_dates];
            let mut highs = vec![f64::NAN; num_dates];
            let mut lows = vec![f64::NAN; num_dates];
            let mut closes = vec![f64::NAN; num_dates];
            let mut volumes = vec![0.0; num_dates];

            for (i, date) in all_dates.iter().enumerate() {
                if let Some(&(o, h, l, c, v)) = date_map.get(date) {
                    opens[i] = o;
                    highs[i] = h;
                    lows[i] = l;
                    closes[i] = c;
                    volumes[i] = v;
                }
            }

            db.open.insert(ticker.clone(), opens);
            db.high.insert(ticker.clone(), highs);
            db.low.insert(ticker.clone(), lows);
            db.close.insert(ticker.clone(), closes.clone());
            db.adj_close.insert(ticker.clone(), closes);
            db.volume.insert(ticker.clone(), volumes);
        }
    }

    Ok(db)
}

/// Collect all tickers used in a tree
fn collect_all_tickers(node: &FlowNode) -> Vec<String> {
    let mut tickers = Vec::new();
    collect_tickers_recursive(node, &mut tickers);
    tickers.sort();
    tickers.dedup();
    tickers
}

fn collect_tickers_recursive(node: &FlowNode, tickers: &mut Vec<String>) {
    // Positions
    if let Some(positions) = &node.positions {
        for pos in positions {
            if !pos.is_empty() && pos != "Empty" && !pos.starts_with("branch:") {
                // Handle ratio tickers
                if let Some((num, den)) = FlowNode::parse_ratio_ticker(pos) {
                    tickers.push(num.to_string());
                    tickers.push(den.to_string());
                } else {
                    tickers.push(pos.clone());
                }
            }
        }
    }

    // Conditions
    if let Some(conditions) = &node.conditions {
        for cond in conditions {
            add_ticker(&cond.ticker, tickers);
            if let Some(rt) = &cond.right_ticker {
                add_ticker(rt, tickers);
            }
        }
    }

    // Scaling
    if let Some(ticker) = &node.scale_ticker {
        add_ticker(ticker, tickers);
    }

    // Entry/exit conditions
    if let Some(conditions) = &node.entry_conditions {
        for cond in conditions {
            add_ticker(&cond.ticker, tickers);
        }
    }
    if let Some(conditions) = &node.exit_conditions {
        for cond in conditions {
            add_ticker(&cond.ticker, tickers);
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
    if let Some((num, den)) = FlowNode::parse_ratio_ticker(ticker) {
        tickers.push(num.to_string());
        tickers.push(den.to_string());
    } else {
        tickers.push(ticker.to_string());
    }
}

/// Calculate the lookback period needed for the strategy
fn calculate_lookback(node: &FlowNode) -> usize {
    let mut max_lookback = 50; // Minimum

    calculate_lookback_recursive(node, &mut max_lookback);

    max_lookback
}

/// Collect only position tickers (tickers that will be allocated to)
fn collect_position_tickers(node: &FlowNode) -> Vec<String> {
    let mut tickers = Vec::new();
    collect_position_tickers_recursive(node, &mut tickers);
    tickers.sort();
    tickers.dedup();
    tickers
}

fn collect_position_tickers_recursive(node: &FlowNode, tickers: &mut Vec<String>) {
    // Only collect from position nodes
    if node.kind == BlockKind::Position {
        if let Some(positions) = &node.positions {
            for pos in positions {
                if !pos.is_empty() && pos != "Empty" && !pos.starts_with("branch:") {
                    if let Some((num, den)) = FlowNode::parse_ratio_ticker(pos) {
                        tickers.push(num.to_string());
                        tickers.push(den.to_string());
                    } else {
                        tickers.push(pos.clone());
                    }
                }
            }
        }
    }

    // Recurse into children
    for children in node.children.values() {
        for child in children.iter().flatten() {
            collect_position_tickers_recursive(child, tickers);
        }
    }
}

/// Find first index where ALL position tickers have valid price data
fn find_first_valid_pos_index(db: &PriceDb, position_tickers: &[String]) -> usize {
    if position_tickers.is_empty() {
        return 0;
    }

    for i in 0..db.len() {
        let mut all_valid = true;
        for ticker in position_tickers {
            if ticker == "Empty" || ticker.is_empty() {
                continue;
            }
            let close_val = db.get_close(ticker, i);
            if close_val.is_none() || close_val.unwrap().is_nan() {
                all_valid = false;
                break;
            }
        }
        if all_valid {
            return i;
        }
    }

    0
}

/// Calculate extra lookback needed for branch references (branch:from, branch:to)
fn calculate_branch_lookback(node: &FlowNode) -> usize {
    let mut max_branch_lookback = 0;
    calculate_branch_lookback_recursive(node, &mut max_branch_lookback);
    max_branch_lookback
}

fn calculate_branch_lookback_recursive(node: &FlowNode, max_lookback: &mut usize) {
    // Check conditions for branch references
    if let Some(conditions) = &node.conditions {
        for cond in conditions {
            if cond.ticker.starts_with("branch:") {
                // Branch references need extra warmup - the branch equity must be calculated first
                let lb = get_indicator_lookback(&cond.metric, cond.window);
                *max_lookback = (*max_lookback).max(lb + 50); // Extra buffer for branch equity
            }
        }
    }

    // Check scaling for branch references
    if let Some(ticker) = &node.scale_ticker {
        if ticker.starts_with("branch:") {
            let lb = get_indicator_lookback(
                node.scale_metric.as_deref().unwrap_or(""),
                node.scale_window.unwrap_or(14),
            );
            *max_lookback = (*max_lookback).max(lb + 50);
        }
    }

    // Recurse
    for children in node.children.values() {
        for child in children.iter().flatten() {
            calculate_branch_lookback_recursive(child, max_lookback);
        }
    }
}

/// Calculate lookbacks for ratio tickers (e.g., SPY/AGG)
/// Returns Vec of (first_valid_index, lookback) for each ratio
fn calculate_ratio_lookbacks(node: &FlowNode, db: &PriceDb) -> Vec<(usize, usize)> {
    let mut ratios = Vec::new();
    collect_ratio_tickers_recursive(node, &mut ratios);
    ratios.sort();
    ratios.dedup();

    let mut results = Vec::new();
    for (num, den, lookback) in ratios {
        // Find first index where both tickers have valid data
        let mut first_valid = 0;
        for i in 0..db.len() {
            let num_val = db.get_close(&num, i);
            let den_val = db.get_close(&den, i);
            if num_val.is_some() && den_val.is_some()
                && !num_val.unwrap().is_nan() && !den_val.unwrap().is_nan() {
                first_valid = i;
                break;
            }
        }
        results.push((first_valid, lookback));
    }

    results
}

fn collect_ratio_tickers_recursive(node: &FlowNode, ratios: &mut Vec<(String, String, usize)>) {
    // Check conditions
    if let Some(conditions) = &node.conditions {
        for cond in conditions {
            if let Some((num, den)) = FlowNode::parse_ratio_ticker(&cond.ticker) {
                let lb = get_indicator_lookback(&cond.metric, cond.window);
                ratios.push((num.to_string(), den.to_string(), lb));
            }
        }
    }

    // Check positions
    if let Some(positions) = &node.positions {
        for pos in positions {
            if let Some((num, den)) = FlowNode::parse_ratio_ticker(pos) {
                ratios.push((num.to_string(), den.to_string(), 0));
            }
        }
    }

    // Recurse
    for children in node.children.values() {
        for child in children.iter().flatten() {
            collect_ratio_tickers_recursive(child, ratios);
        }
    }
}

fn calculate_lookback_recursive(node: &FlowNode, max_lookback: &mut usize) {
    // Check conditions
    if let Some(conditions) = &node.conditions {
        for cond in conditions {
            let lb = get_indicator_lookback(&cond.metric, cond.window);
            *max_lookback = (*max_lookback).max(lb);
        }
    }

    // Check function metric
    if let Some(metric) = &node.metric {
        let lb = get_indicator_lookback(metric, node.window.unwrap_or(14));
        *max_lookback = (*max_lookback).max(lb);
    }

    // Check scaling
    if let Some(metric) = &node.scale_metric {
        let lb = get_indicator_lookback(metric, node.scale_window.unwrap_or(14));
        *max_lookback = (*max_lookback).max(lb);
    }

    // Recurse
    for children in node.children.values() {
        for child in children.iter().flatten() {
            calculate_lookback_recursive(child, max_lookback);
        }
    }
}

/// Main backtest function
pub fn run_backtest(
    parquet_dir: &Path,
    request: &BacktestRequest,
) -> Result<BacktestResponse, String> {
    // Parse the FlowNode tree from payload
    let node: FlowNode = serde_json::from_str(&request.payload)
        .map_err(|e| format!("Failed to parse strategy: {}", e))?;

    // Collect all tickers
    let tickers = collect_all_tickers(&node);
    if tickers.is_empty() {
        return Err("No tickers found in strategy".to_string());
    }

    // Build price database
    let db = build_price_db(parquet_dir, &tickers)?;
    if db.len() < 3 {
        return Err("Not enough price data".to_string());
    }

    // Initialize
    let mut cache = IndicatorCache::new();
    let mut alt_exit_state = HashMap::new();
    let custom_indicators = request.custom_indicators.as_deref().unwrap_or(&[]);

    // Calculate lookback periods
    let regular_lookback = calculate_lookback(&node);
    let branch_lookback = calculate_branch_lookback(&node);
    let ratio_lookbacks = calculate_ratio_lookbacks(&node, &db);

    // Find first index where all position tickers have valid data
    let position_tickers = collect_position_tickers(&node);
    let first_valid_pos_index = find_first_valid_pos_index(&db, &position_tickers);

    let decision_price = DecisionPrice::from(&request.mode);

    // Calculate effective start index considering all constraints:
    // 1. Regular lookback (for normal indicators)
    // 2. firstValidPosIndex + branchLookback (branch refs need extra warmup AFTER position data is available)
    // 3. Each ratio's firstValidIndex + lookback
    let mut start_index = match decision_price {
        DecisionPrice::Open => if regular_lookback > 0 { regular_lookback + 1 } else { 0 },
        DecisionPrice::Close => regular_lookback,
    };

    // Branch references need extra warmup AFTER position tickers have data
    start_index = start_index.max(first_valid_pos_index + branch_lookback);

    // Also check ratio constraints - each ratio has its own first valid index + lookback
    for (first_valid_index, lookback) in &ratio_lookbacks {
        let ratio_start = match decision_price {
            DecisionPrice::Open => first_valid_index + lookback + 1,
            DecisionPrice::Close => first_valid_index + lookback,
        };
        start_index = start_index.max(ratio_start);
    }

    eprintln!(
        "[WARMUP] regularLookback={}, branchLookback={}, firstValidPosIndex={}, ratioCount={}, startEvalIndex={}",
        regular_lookback, branch_lookback, first_valid_pos_index, ratio_lookbacks.len(), start_index
    );

    // Run backtest
    let mut allocations: Vec<Allocation> = vec![HashMap::new(); db.len()];

    for i in start_index..db.len() {
        let mut ctx = EvalContext::new(
            &db,
            &mut cache,
            request.mode.clone(),
            &mut alt_exit_state,
            custom_indicators,
        );
        ctx.set_day(i);

        allocations[i] = evaluate_node(&mut ctx, &node);
    }

    // Calculate equity curve
    let cost_bps = request.cost_bps / 10000.0;
    let (equity, daily_returns, benchmark_returns, points, benchmark_points, drawdown_points, days, allocation_rows, total_turnover, total_holdings) =
        calculate_equity_curve(&db, &allocations, start_index, cost_bps, &request.mode);

    // Calculate metrics
    let mut metrics = calculate_metrics(
        &equity,
        &daily_returns,
        &benchmark_returns,
        &db.date_strings[start_index..],
        252.0,
    );

    // Set turnover and holdings
    if days.len() > 1 {
        metrics.avg_turnover = total_turnover / (days.len() - 1) as f64;
    }
    if !days.is_empty() {
        metrics.avg_holdings = total_holdings / days.len() as f64;
    }

    // Calculate monthly returns
    let monthly = calculate_monthly_returns(&db.date_strings, &daily_returns, start_index);

    Ok(BacktestResponse {
        equity_curve: points,
        benchmark_curve: Some(benchmark_points),
        drawdown_points,
        markers: Vec::new(),
        metrics,
        days,
        allocations: allocation_rows,
        warnings: Vec::new(),
        monthly,
    })
}

/// Calculate equity curve from allocations
fn calculate_equity_curve(
    db: &PriceDb,
    allocations: &[Allocation],
    start_index: usize,
    cost_bps: f64,
    mode: &BacktestMode,
) -> (Vec<f64>, Vec<f64>, Vec<f64>, Vec<EquityPoint>, Vec<EquityPoint>, Vec<EquityPoint>, Vec<DayRow>, Vec<AllocationRow>, f64, f64) {
    let mut equity = vec![1.0];
    let mut daily_returns = Vec::new();
    let mut benchmark_returns = Vec::new();
    let mut points = Vec::new();
    let mut benchmark_points = Vec::new();
    let mut drawdown_points = Vec::new();
    let mut days = Vec::new();
    let mut allocation_rows = Vec::new();

    let mut current_equity = 1.0;
    let mut peak = 1.0;
    let mut spy_equity = 1.0;
    let mut total_turnover = 0.0;
    let mut total_holdings = 0.0;
    let mut prev_alloc = HashMap::new();

    // Add starting point
    if start_index < db.len() {
        points.push(EquityPoint {
            date: db.date_strings[start_index].clone(),
            equity: 1.0,
        });
        benchmark_points.push(EquityPoint {
            date: db.date_strings[start_index].clone(),
            equity: 1.0,
        });
        drawdown_points.push(EquityPoint {
            date: db.date_strings[start_index].clone(),
            equity: 0.0,
        });
    }

    let start = start_index + 1;

    for i in start..db.len() {
        let alloc = &allocations[i - 1]; // Use previous day's allocation

        // Calculate daily return
        let mut daily_ret = 0.0;
        for (ticker, &weight) in alloc {
            let today = db.get_adj_close(ticker, i);
            let yesterday = db.get_adj_close(ticker, i - 1);

            if let (Some(t), Some(y)) = (today, yesterday) {
                if y != 0.0 && !y.is_nan() && !t.is_nan() {
                    daily_ret += weight * ((t - y) / y);
                }
            }
        }

        // Calculate turnover and cost
        let turnover = calculate_turnover(&prev_alloc, alloc);
        let cost = turnover * cost_bps;
        let net_ret = daily_ret - cost;

        total_turnover += turnover;
        total_holdings += alloc.len() as f64;

        // Update equity
        current_equity *= 1.0 + net_ret;
        equity.push(current_equity);
        daily_returns.push(net_ret);

        // Update peak and drawdown
        if current_equity > peak {
            peak = current_equity;
        }
        let drawdown = (current_equity - peak) / peak;

        // SPY benchmark
        let spy_today = db.get_adj_close("SPY", i);
        let spy_yesterday = db.get_adj_close("SPY", i - 1);
        let spy_ret = if let (Some(t), Some(y)) = (spy_today, spy_yesterday) {
            if y != 0.0 { (t - y) / y } else { 0.0 }
        } else {
            0.0
        };
        spy_equity *= 1.0 + spy_ret;
        benchmark_returns.push(spy_ret);

        // Add points
        let time = db.dates[i];
        let date = db.date_strings[i].clone();

        points.push(EquityPoint {
            date: date.clone(),
            equity: current_equity,
        });
        benchmark_points.push(EquityPoint {
            date: date.clone(),
            equity: spy_equity,
        });
        drawdown_points.push(EquityPoint {
            date: date.clone(),
            equity: drawdown,
        });

        // Day row
        let holdings: Vec<AllocationEntry> = alloc
            .iter()
            .map(|(t, &w)| AllocationEntry {
                ticker: t.clone(),
                weight: w,
            })
            .collect();

        days.push(DayRow {
            time,
            date: date.clone(),
            equity: current_equity,
            drawdown,
            gross_return: daily_ret,
            net_return: net_ret,
            turnover,
            cost,
            holdings: holdings.clone(),
        });

        allocation_rows.push(AllocationRow {
            date,
            entries: holdings,
        });

        prev_alloc = alloc.clone();
    }

    (equity, daily_returns, benchmark_returns, points, benchmark_points, drawdown_points, days, allocation_rows, total_turnover, total_holdings)
}

/// Calculate monthly returns
fn calculate_monthly_returns(
    dates: &[String],
    returns: &[f64],
    start_index: usize,
) -> Vec<MonthlyReturn> {
    let mut monthly = Vec::new();
    let mut current_year = 0i32;
    let mut current_month = 0u32;
    let mut month_return = 1.0;

    for (i, ret) in returns.iter().enumerate() {
        let date_str = &dates[start_index + 1 + i];
        if let Ok(date) = chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
            let year = date.year();
            let month = date.month();

            if year != current_year || month != current_month {
                if current_year != 0 {
                    monthly.push(MonthlyReturn {
                        year: current_year,
                        month: current_month,
                        value: month_return - 1.0,
                    });
                }
                current_year = year;
                current_month = month;
                month_return = 1.0;
            }

            month_return *= 1.0 + ret;
        }
    }

    // Don't forget last month
    if current_year != 0 {
        monthly.push(MonthlyReturn {
            year: current_year,
            month: current_month,
            value: month_return - 1.0,
        });
    }

    monthly
}
