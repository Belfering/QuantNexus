//! Rust indicator server - replaces Node.js for compute-heavy operations
//!
//! Run: cargo run --release --bin server
//! Test: curl -X POST http://localhost:3030/rsi -H "Content-Type: application/json" -d '{"values":[44,44.5,45,44.5,45.5,46,45.5,46.5,47,46,45,44,43,44,45,46],"period":14}'

use axum::{routing::post, Router, Json};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;

#[derive(Deserialize)]
struct SingleSeriesRequest {
    values: Vec<f64>,
    period: usize,
}

#[derive(Deserialize)]
struct OhlcRequest {
    highs: Vec<f64>,
    lows: Vec<f64>,
    closes: Vec<f64>,
    period: usize,
}

#[derive(Deserialize)]
struct BollingerRequest {
    values: Vec<f64>,
    period: usize,
    std_mult: f64,
}

#[derive(Serialize)]
struct Response {
    result: Vec<f64>,
}

// Moving Averages
async fn sma(Json(req): Json<SingleSeriesRequest>) -> Json<Response> {
    Json(Response { result: flowchart_indicators::sma(&req.values, req.period) })
}

async fn ema(Json(req): Json<SingleSeriesRequest>) -> Json<Response> {
    Json(Response { result: flowchart_indicators::ema(&req.values, req.period) })
}

async fn wma(Json(req): Json<SingleSeriesRequest>) -> Json<Response> {
    Json(Response { result: flowchart_indicators::wma(&req.values, req.period) })
}

async fn hma(Json(req): Json<SingleSeriesRequest>) -> Json<Response> {
    Json(Response { result: flowchart_indicators::hma(&req.values, req.period) })
}

// Oscillators
async fn rsi(Json(req): Json<SingleSeriesRequest>) -> Json<Response> {
    Json(Response { result: flowchart_indicators::rsi(&req.values, req.period) })
}

async fn stoch_rsi(Json(req): Json<SingleSeriesRequest>) -> Json<Response> {
    Json(Response { result: flowchart_indicators::stoch_rsi(&req.values, req.period, req.period) })
}

async fn williams_r(Json(req): Json<OhlcRequest>) -> Json<Response> {
    Json(Response { result: flowchart_indicators::williams_r(&req.highs, &req.lows, &req.closes, req.period) })
}

async fn cci(Json(req): Json<OhlcRequest>) -> Json<Response> {
    Json(Response { result: flowchart_indicators::cci(&req.highs, &req.lows, &req.closes, req.period) })
}

// Momentum
async fn roc(Json(req): Json<SingleSeriesRequest>) -> Json<Response> {
    Json(Response { result: flowchart_indicators::roc(&req.values, req.period) })
}

async fn adx(Json(req): Json<OhlcRequest>) -> Json<Response> {
    Json(Response { result: flowchart_indicators::adx(&req.highs, &req.lows, &req.closes, req.period) })
}

async fn linreg_slope(Json(req): Json<SingleSeriesRequest>) -> Json<Response> {
    Json(Response { result: flowchart_indicators::linreg_slope_js(&req.values, req.period) })
}

// Volatility
async fn atr(Json(req): Json<OhlcRequest>) -> Json<Response> {
    Json(Response { result: flowchart_indicators::atr(&req.highs, &req.lows, &req.closes, req.period) })
}

async fn bollinger_b(Json(req): Json<BollingerRequest>) -> Json<Response> {
    Json(Response { result: flowchart_indicators::bollinger_b(&req.values, req.period, req.std_mult) })
}

async fn ulcer_index(Json(req): Json<SingleSeriesRequest>) -> Json<Response> {
    Json(Response { result: flowchart_indicators::ulcer_index_js(&req.values, req.period) })
}

// Trend
async fn price_vs_sma(Json(req): Json<SingleSeriesRequest>) -> Json<Response> {
    Json(Response { result: flowchart_indicators::price_vs_sma_js(&req.values, req.period) })
}

async fn rolling_return(Json(req): Json<SingleSeriesRequest>) -> Json<Response> {
    Json(Response { result: flowchart_indicators::rolling_return(&req.values, req.period) })
}

async fn trend_r_squared(Json(req): Json<SingleSeriesRequest>) -> Json<Response> {
    Json(Response { result: flowchart_indicators::trend_r_squared(&req.values, req.period) })
}

#[derive(Deserialize)]
struct DrawdownRequest {
    values: Vec<f64>,
}

async fn max_drawdown(Json(req): Json<DrawdownRequest>) -> Json<Response> {
    Json(Response { result: flowchart_indicators::max_drawdown_ratio(&req.values) })
}

async fn drawdown(Json(req): Json<DrawdownRequest>) -> Json<Response> {
    Json(Response { result: flowchart_indicators::drawdown_ratio(&req.values) })
}

// Batch endpoint - compute ALL indicators for a ticker in one call
#[derive(Deserialize)]
struct BatchRequest {
    closes: Vec<f64>,
    highs: Option<Vec<f64>>,
    lows: Option<Vec<f64>>,
}

#[derive(Serialize)]
struct BatchResponse {
    sma_20: Vec<f64>,
    sma_50: Vec<f64>,
    ema_12: Vec<f64>,
    ema_26: Vec<f64>,
    rsi_14: Vec<f64>,
    roc_10: Vec<f64>,
    price_vs_sma_50: Vec<f64>,
    rolling_return_20: Vec<f64>,
    ulcer_index_14: Vec<f64>,
    max_drawdown: Vec<f64>,
    atr_14: Option<Vec<f64>>,
}

async fn batch(Json(req): Json<BatchRequest>) -> Json<BatchResponse> {
    let closes = &req.closes;

    // Compute ATR if we have OHLC data
    let atr_14 = if let (Some(highs), Some(lows)) = (&req.highs, &req.lows) {
        Some(flowchart_indicators::atr(highs, lows, closes, 14))
    } else {
        None
    };

    Json(BatchResponse {
        sma_20: flowchart_indicators::sma(closes, 20),
        sma_50: flowchart_indicators::sma(closes, 50),
        ema_12: flowchart_indicators::ema(closes, 12),
        ema_26: flowchart_indicators::ema(closes, 26),
        rsi_14: flowchart_indicators::rsi(closes, 14),
        roc_10: flowchart_indicators::roc(closes, 10),
        price_vs_sma_50: flowchart_indicators::price_vs_sma_js(closes, 50),
        rolling_return_20: flowchart_indicators::rolling_return(closes, 20),
        ulcer_index_14: flowchart_indicators::ulcer_index_js(closes, 14),
        max_drawdown: flowchart_indicators::max_drawdown_ratio(closes),
        atr_14,
    })
}

#[tokio::main]
async fn main() {
    let app = Router::new()
        // Moving averages
        .route("/sma", post(sma))
        .route("/ema", post(ema))
        .route("/wma", post(wma))
        .route("/hma", post(hma))
        // Oscillators
        .route("/rsi", post(rsi))
        .route("/stoch_rsi", post(stoch_rsi))
        .route("/williams_r", post(williams_r))
        .route("/cci", post(cci))
        // Momentum
        .route("/roc", post(roc))
        .route("/adx", post(adx))
        .route("/linreg_slope", post(linreg_slope))
        // Volatility
        .route("/atr", post(atr))
        .route("/bollinger_b", post(bollinger_b))
        .route("/ulcer_index", post(ulcer_index))
        // Trend
        .route("/price_vs_sma", post(price_vs_sma))
        .route("/rolling_return", post(rolling_return))
        .route("/trend_r_squared", post(trend_r_squared))
        .route("/max_drawdown", post(max_drawdown))
        .route("/drawdown", post(drawdown))
        // Batch - all indicators in one call
        .route("/batch", post(batch));

    let addr = SocketAddr::from(([127, 0, 0, 1], 3030));
    println!("Rust indicator server running on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
