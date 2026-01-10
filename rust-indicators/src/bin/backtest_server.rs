//! Rust Backtest Server - replaces Node.js server entirely
//!
//! Reads parquet files directly, computes indicators natively.
//! No Node.js, no WASM overhead - pure native speed.
//!
//! Run: PARQUET_DIR=../System.app/ticker-data/data/ticker_data_parquet cargo run --release --bin backtest_server

use axum::{routing::{get, post}, Router, Json, extract::{Path, State, Query, DefaultBodyLimit}};
use axum::http::StatusCode;
use arrow::array::{Float64Array, StringArray, Array};
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

// Import backtest module
use flowchart_indicators::backtest::{
    BacktestRequest as FullBacktestRequest,
    BacktestResponse as FullBacktestResponse,
    run_backtest,
    can_vectorize,
    run_backtest_vectorized,
    FlowNode,
};

// ============================================================================
// State & Config
// ============================================================================

struct AppState {
    parquet_dir: PathBuf,
}

// ============================================================================
// Parquet Reading
// ============================================================================

struct OhlcData {
    dates: Vec<String>,
    opens: Vec<f64>,
    highs: Vec<f64>,
    lows: Vec<f64>,
    closes: Vec<f64>,
    volumes: Vec<f64>,
}

fn read_parquet_file(path: &PathBuf) -> Option<OhlcData> {
    let file = File::open(path).ok()?;
    let builder = ParquetRecordBatchReaderBuilder::try_new(file).ok()?;
    let reader = builder.build().ok()?;

    let mut dates = Vec::new();
    let mut opens = Vec::new();
    let mut highs = Vec::new();
    let mut lows = Vec::new();
    let mut closes = Vec::new();
    let mut volumes = Vec::new();

    for batch in reader {
        let batch = batch.ok()?;

        // Try to get date column
        if let Some(col) = batch.column_by_name("Date") {
            if let Some(arr) = col.as_any().downcast_ref::<StringArray>() {
                for i in 0..arr.len() {
                    dates.push(arr.value(i).to_string());
                }
            }
        }

        // Get numeric columns
        fn extract_f64(batch: &arrow::record_batch::RecordBatch, name: &str, out: &mut Vec<f64>) {
            if let Some(col) = batch.column_by_name(name) {
                if let Some(arr) = col.as_any().downcast_ref::<Float64Array>() {
                    for i in 0..arr.len() {
                        out.push(if arr.is_null(i) { f64::NAN } else { arr.value(i) });
                    }
                }
            }
        }

        extract_f64(&batch, "Open", &mut opens);
        extract_f64(&batch, "High", &mut highs);
        extract_f64(&batch, "Low", &mut lows);
        extract_f64(&batch, "Close", &mut closes);
        extract_f64(&batch, "Volume", &mut volumes);
    }

    Some(OhlcData { dates, opens, highs, lows, closes, volumes })
}

// ============================================================================
// Request/Response Types
// ============================================================================

#[derive(Serialize)]
struct TickerCandle {
    date: String,
    open: f64,
    high: f64,
    low: f64,
    close: f64,
    volume: f64,
}

#[derive(Serialize)]
struct CandlesResponse {
    ticker: String,
    candles: Vec<TickerCandle>,
}

#[derive(Serialize)]
struct TickerIndicators {
    ticker: String,
    bars: usize,
    compute_ms: f64,
    close: Vec<f64>,
    sma_20: Vec<f64>,
    sma_50: Vec<f64>,
    ema_12: Vec<f64>,
    ema_26: Vec<f64>,
    rsi_14: Vec<f64>,
    roc_10: Vec<f64>,
    price_vs_sma_50: Vec<f64>,
    ulcer_index_14: Vec<f64>,
    max_drawdown: Vec<f64>,
    atr_14: Vec<f64>,
}

#[derive(Deserialize)]
struct IndicatorsQuery {
    limit: Option<usize>,
}

#[derive(Serialize)]
struct BacktestSummary {
    ticker: String,
    bars: usize,
    last_close: f64,
    rsi_14: Option<f64>,
    price_vs_sma_50: Option<f64>,
    roc_10: Option<f64>,
    ulcer_index: Option<f64>,
    max_drawdown: Option<f64>,
}

#[derive(Serialize)]
struct SimpleBacktestResponse {
    tickers: Vec<BacktestSummary>,
    total_ms: f64,
    per_ticker_ms: f64,
}

#[derive(Serialize)]
struct TickerListResponse {
    tickers: Vec<String>,
    count: usize,
}

// ============================================================================
// Helper Functions
// ============================================================================

fn last_valid(values: &[f64]) -> Option<f64> {
    values.iter().rev().find(|v| !v.is_nan()).copied()
}

// ============================================================================
// Handlers
// ============================================================================

async fn list_tickers(State(state): State<Arc<AppState>>) -> Json<TickerListResponse> {
    let mut tickers: Vec<String> = std::fs::read_dir(&state.parquet_dir)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter_map(|e| {
                    let path = e.path();
                    if path.extension().map_or(false, |ext| ext == "parquet") {
                        path.file_stem()
                            .and_then(|s| s.to_str())
                            .map(|s| s.to_string())
                    } else {
                        None
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    tickers.sort();
    let count = tickers.len();
    Json(TickerListResponse { tickers, count })
}

async fn get_candles(
    State(state): State<Arc<AppState>>,
    Path(ticker): Path<String>,
    Query(query): Query<IndicatorsQuery>,
) -> Json<CandlesResponse> {
    let path = state.parquet_dir.join(format!("{}.parquet", ticker));

    let candles = if let Some(data) = read_parquet_file(&path) {
        let limit = query.limit.unwrap_or(usize::MAX);
        let len = data.closes.len();
        let start = len.saturating_sub(limit);

        (start..len).map(|i| TickerCandle {
            date: data.dates.get(i).cloned().unwrap_or_default(),
            open: data.opens.get(i).copied().unwrap_or(f64::NAN),
            high: data.highs.get(i).copied().unwrap_or(f64::NAN),
            low: data.lows.get(i).copied().unwrap_or(f64::NAN),
            close: data.closes.get(i).copied().unwrap_or(f64::NAN),
            volume: data.volumes.get(i).copied().unwrap_or(0.0),
        }).collect()
    } else {
        vec![]
    };

    Json(CandlesResponse { ticker, candles })
}

async fn get_indicators(
    State(state): State<Arc<AppState>>,
    Path(ticker): Path<String>,
    Query(query): Query<IndicatorsQuery>,
) -> Json<TickerIndicators> {
    let path = state.parquet_dir.join(format!("{}.parquet", ticker));
    let start = Instant::now();

    let (closes, highs, lows) = if let Some(data) = read_parquet_file(&path) {
        (data.closes, data.highs, data.lows)
    } else {
        (vec![], vec![], vec![])
    };

    let bars = closes.len();

    // Compute all indicators
    let sma_20 = flowchart_indicators::sma(&closes, 20);
    let sma_50 = flowchart_indicators::sma(&closes, 50);
    let ema_12 = flowchart_indicators::ema(&closes, 12);
    let ema_26 = flowchart_indicators::ema(&closes, 26);
    let rsi_14 = flowchart_indicators::rsi(&closes, 14);
    let roc_10 = flowchart_indicators::roc(&closes, 10);
    let price_vs_sma_50 = flowchart_indicators::price_vs_sma_js(&closes, 50);
    let ulcer_index_14 = flowchart_indicators::ulcer_index_js(&closes, 14);
    let max_drawdown = flowchart_indicators::max_drawdown_ratio(&closes);
    let atr_14 = flowchart_indicators::atr(&highs, &lows, &closes, 14);

    let compute_ms = start.elapsed().as_secs_f64() * 1000.0;

    let limit = query.limit.unwrap_or(usize::MAX);
    let take_last = |v: Vec<f64>| -> Vec<f64> {
        let start = v.len().saturating_sub(limit);
        v[start..].to_vec()
    };

    Json(TickerIndicators {
        ticker,
        bars,
        compute_ms,
        close: take_last(closes),
        sma_20: take_last(sma_20),
        sma_50: take_last(sma_50),
        ema_12: take_last(ema_12),
        ema_26: take_last(ema_26),
        rsi_14: take_last(rsi_14),
        roc_10: take_last(roc_10),
        price_vs_sma_50: take_last(price_vs_sma_50),
        ulcer_index_14: take_last(ulcer_index_14),
        max_drawdown: take_last(max_drawdown),
        atr_14: take_last(atr_14),
    })
}

// ============================================================================
// Compute Indicators Endpoint - For Node.js Integration
// ============================================================================

#[derive(Deserialize)]
struct ComputeRequest {
    tickers: Vec<String>,
    indicators: Vec<IndicatorSpec>,
}

#[derive(Deserialize, Clone)]
struct IndicatorSpec {
    name: String,
    period: Option<usize>,
}

#[derive(Serialize)]
struct ComputeResponse {
    data: std::collections::HashMap<String, std::collections::HashMap<String, Vec<f64>>>,
    compute_ms: f64,
}

/// Compute a single indicator for given OHLCV data
fn compute_indicator(
    name: &str,
    period: usize,
    closes: &[f64],
    highs: &[f64],
    lows: &[f64],
    volumes: &[f64],
) -> Option<Vec<f64>> {
    use flowchart_indicators::*;

    match name {
        // Moving Averages
        "sma" => Some(sma(closes, period)),
        "ema" => Some(ema(closes, period)),
        "wma" => Some(wma(closes, period)),
        "dema" => Some(dema(closes, period)),
        "tema" => Some(tema(closes, period)),
        "hma" => Some(hma(closes, period)),
        "kama" => Some(kama(closes, period, 2, 30)), // period=ER period, fast=2, slow=30
        "wilders_ma" | "wildersMa" => Some(wilders_ma(closes, period)),

        // Oscillators
        "rsi" => Some(rsi(closes, period)),
        "rsi_sma" | "rsiSma" => Some(rsi_sma(closes, period)),
        "rsi_ema" | "rsiEma" => Some(rsi_ema(closes, period)),
        "stoch_rsi" | "stochRsi" => Some(stoch_rsi(closes, period, period)),
        "laguerre_rsi" | "laguerreRsi" => Some(laguerre_rsi(closes, 0.8)), // gamma = 0.8 default
        "stoch_k" | "stochK" => Some(stoch_k(highs, lows, closes, period)),
        "stoch_d" | "stochD" => Some(stoch_d(highs, lows, closes, period, 3)), // k_period=period, d_period=3
        "williams_r" | "williamsR" => Some(williams_r(highs, lows, closes, period)),
        "cci" => Some(cci(highs, lows, closes, period)),
        "mfi" => Some(mfi(highs, lows, closes, volumes, period)),

        // Momentum
        "macd_line" | "macdLine" => {
            let (line, _, _) = macd(closes, 12, 26, 9);
            Some(line)
        }
        "macd_signal" | "macdSignal" => {
            let (_, signal, _) = macd(closes, 12, 26, 9);
            Some(signal)
        }
        "macd_histogram" | "macdHistogram" => {
            let (_, _, hist) = macd(closes, 12, 26, 9);
            Some(hist)
        }
        "ppo" => Some(ppo(closes, 12, 26)),
        "ppo_histogram" | "ppoHistogram" => {
            let (_, _, hist) = ppo_histogram(closes, 12, 26, 9);
            Some(hist)
        }
        "roc" => Some(roc(closes, period)),
        "aroon_up" | "aroonUp" => Some(aroon_up(highs, period)),
        "aroon_down" | "aroonDown" => Some(aroon_down(lows, period)),
        "aroon_osc" | "aroonOsc" => Some(aroon_osc(highs, lows, period)),
        "adx" => Some(adx(highs, lows, closes, period)),
        "momentum_13612w" | "13612w" | "mom13612w" => Some(momentum_13612w(closes)),
        "momentum_13612u" | "13612u" | "mom13612u" => Some(momentum_13612u(closes)),
        "sma12_momentum" | "sma12Momentum" | "momsma12" => Some(sma12_momentum(closes, 12)),
        "linreg_slope" | "linRegSlope" => Some(linreg_slope_js(closes, period)), // Use JS-compatible version
        "linreg_value" | "linRegValue" => Some(linreg_value(closes, period)),

        // Volatility
        "std_dev" | "stdDev" => Some(std_dev(closes, period)),
        "bollinger_b" | "bollingerB" => Some(bollinger_b(closes, period, 2.0)),
        "bollinger_bandwidth" | "bollingerBandwidth" => Some(bollinger_bandwidth(closes, period, 2.0)),
        "atr" => Some(atr(highs, lows, closes, period)),
        "atr_percent" | "atrPercent" => Some(atr_percent(highs, lows, closes, period)),
        "historical_volatility" | "historicalVolatility" | "histVol" => Some(historical_volatility(closes, period)),
        "ulcer_index" | "ulcerIndex" => Some(ulcer_index_js(closes, period)), // Use JS-compatible version
        "max_drawdown" | "maxDrawdown" => Some(max_drawdown_ratio(closes)), // Use ratio version (0-1)
        "drawdown" => Some(drawdown_ratio(closes)), // Use ratio version (0-1)
        "true_range" | "trueRange" => Some(true_range(highs, lows, closes)),

        // Volume
        "obv" => Some(obv(closes, volumes)),
        "obv_roc" | "obvRoc" => Some(obv_roc(closes, volumes, period)),
        "vwap_ratio" | "vwapRatio" => Some(vwap_ratio(highs, lows, closes, volumes)),

        // Trend
        "price_vs_sma" | "priceVsSma" => Some(price_vs_sma_js(closes, period)), // Use JS-compatible version
        "sma_of_returns" | "smaOfReturns" | "smaRet" => Some(sma_of_returns(closes, period)),
        "cumulative_return" | "cumulativeReturn" | "cumRet" => Some(cumulative_return(closes)),
        "rolling_return" | "rollingReturn" => Some(rolling_return(closes, period)),
        "trend_clarity" | "trendClarity" => Some(trend_r_squared(closes, period)), // Use R² version for JS compatibility
        "ultimate_smoother" | "ultimateSmoother" | "ultSmooth" => Some(ultimate_smoother_js(closes, period)), // JS-compatible
        "efficiency_ratio" | "efficiencyRatio" => Some(efficiency_ratio(closes, period)),

        _ => None,
    }
}

async fn compute_indicators(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ComputeRequest>,
) -> Json<ComputeResponse> {
    let start = Instant::now();
    let mut data: std::collections::HashMap<String, std::collections::HashMap<String, Vec<f64>>> =
        std::collections::HashMap::new();

    for ticker in &req.tickers {
        let path = state.parquet_dir.join(format!("{}.parquet", ticker));

        if let Some(ohlc) = read_parquet_file(&path) {
            let mut ticker_data: std::collections::HashMap<String, Vec<f64>> =
                std::collections::HashMap::new();

            // Always include closes for reference
            ticker_data.insert("close".to_string(), ohlc.closes.clone());

            for spec in &req.indicators {
                let period = spec.period.unwrap_or(14); // Default period
                let key = if spec.period.is_some() {
                    format!("{}_{}", spec.name, period)
                } else {
                    spec.name.clone()
                };

                if let Some(values) = compute_indicator(
                    &spec.name,
                    period,
                    &ohlc.closes,
                    &ohlc.highs,
                    &ohlc.lows,
                    &ohlc.volumes,
                ) {
                    ticker_data.insert(key, values);
                }
            }

            data.insert(ticker.clone(), ticker_data);
        }
    }

    let compute_ms = start.elapsed().as_secs_f64() * 1000.0;

    Json(ComputeResponse { data, compute_ms })
}

// ============================================================================
// Original Simple Backtest Endpoint
// ============================================================================

#[derive(Deserialize)]
struct SimpleBacktestRequest {
    tickers: Option<Vec<String>>,
}

async fn run_backtest_simple(
    State(state): State<Arc<AppState>>,
    Json(req): Json<SimpleBacktestRequest>,
) -> Json<SimpleBacktestResponse> {
    let start = Instant::now();

    let tickers: Vec<String> = if let Some(t) = req.tickers {
        t
    } else {
        std::fs::read_dir(&state.parquet_dir)
            .map(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .filter_map(|e| {
                        let path = e.path();
                        if path.extension().map_or(false, |ext| ext == "parquet") {
                            path.file_stem()
                                .and_then(|s| s.to_str())
                                .map(|s| s.to_string())
                        } else {
                            None
                        }
                    })
                    .collect()
            })
            .unwrap_or_default()
    };

    let mut results: Vec<BacktestSummary> = Vec::new();

    for ticker in &tickers {
        let path = state.parquet_dir.join(format!("{}.parquet", ticker));

        if let Some(data) = read_parquet_file(&path) {
            let closes = &data.closes;
            let bars = closes.len();

            if bars == 0 {
                continue;
            }

            let rsi = flowchart_indicators::rsi(closes, 14);
            let price_vs_sma = flowchart_indicators::price_vs_sma_js(closes, 50);
            let roc = flowchart_indicators::roc(closes, 10);
            let ulcer = flowchart_indicators::ulcer_index_js(closes, 14);
            let max_dd = flowchart_indicators::max_drawdown_ratio(closes);

            results.push(BacktestSummary {
                ticker: ticker.clone(),
                bars,
                last_close: closes.last().copied().unwrap_or(f64::NAN),
                rsi_14: last_valid(&rsi),
                price_vs_sma_50: last_valid(&price_vs_sma),
                roc_10: last_valid(&roc),
                ulcer_index: last_valid(&ulcer),
                max_drawdown: last_valid(&max_dd),
            });
        }
    }

    let total_ms = start.elapsed().as_secs_f64() * 1000.0;
    let per_ticker_ms = if results.is_empty() { 0.0 } else { total_ms / results.len() as f64 };

    Json(SimpleBacktestResponse {
        tickers: results,
        total_ms,
        per_ticker_ms,
    })
}

// ============================================================================
// Full Backtest Endpoint - matches Node.js API exactly
// ============================================================================

/// Check if strategy can use vectorized engine
fn should_use_vectorized(req: &FullBacktestRequest) -> bool {
    // Parse strategy to check
    if let Ok(node) = serde_json::from_str::<FlowNode>(&req.payload) {
        can_vectorize(&node)
    } else {
        false
    }
}

async fn run_full_backtest(
    State(state): State<Arc<AppState>>,
    Json(req): Json<FullBacktestRequest>,
) -> Result<Json<FullBacktestResponse>, (StatusCode, String)> {
    let start = Instant::now();

    // Try vectorized engine for compatible strategies
    let use_vectorized = should_use_vectorized(&req);
    eprintln!("Strategy vectorizable: {} -> using {} engine",
              use_vectorized,
              if use_vectorized { "Vectorized" } else { "V1" });

    let result = if use_vectorized {
        // Try vectorized engine first
        match run_backtest_vectorized(&state.parquet_dir, &req) {
            Ok(response) => {
                let elapsed = start.elapsed().as_secs_f64() * 1000.0;
                eprintln!("[Vectorized] Backtest completed in {:.2}ms", elapsed);
                Ok(response)
            }
            Err(e) => {
                eprintln!("[Vectorized] Error: {}, falling back to V1", e);
                run_backtest(&state.parquet_dir, &req)
            }
        }
    } else {
        // Use V1 engine
        run_backtest(&state.parquet_dir, &req)
    };

    match result {
        Ok(response) => {
            let elapsed = start.elapsed().as_secs_f64() * 1000.0;
            eprintln!("Backtest completed in {:.2}ms", elapsed);
            Ok(Json(response))
        }
        Err(e) => {
            eprintln!("Backtest error: {}", e);
            Err((StatusCode::BAD_REQUEST, e))
        }
    }
}

#[tokio::main]
async fn main() {
    let parquet_dir = std::env::var("PARQUET_DIR")
        .unwrap_or_else(|_| "../app/ticker-data/data/ticker_data_parquet".to_string());

    let state = Arc::new(AppState {
        parquet_dir: PathBuf::from(&parquet_dir),
    });

    eprintln!("Parquet dir: {}", parquet_dir);

    let app = Router::new()
        .route("/tickers", get(list_tickers))
        .route("/candles/{ticker}", get(get_candles))
        .route("/indicators/{ticker}", get(get_indicators))
        .route("/backtest", post(run_backtest_simple))
        .route("/api/backtest", post(run_full_backtest))
        .route("/compute-indicators", post(compute_indicators))
        .layer(DefaultBodyLimit::max(50 * 1024 * 1024)) // 50MB limit for large strategies
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], 3030));
    println!("Rust backtest server on http://{}", addr);
    println!("  GET  /tickers              - list tickers");
    println!("  GET  /candles/:ticker      - OHLCV data");
    println!("  GET  /indicators/:ticker   - all indicators");
    println!("  POST /backtest             - simple backtest on all tickers");
    println!("  POST /api/backtest         - full strategy backtest (replaces Node.js)");
    println!("  POST /compute-indicators   - compute specific indicators for tickers");

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
