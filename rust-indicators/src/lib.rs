//! # Flowchart Indicators
//!
//! High-performance technical indicators library for financial analysis.
//!
//! ## Features
//! - 50+ technical indicators
//! - Matches TA-Lib output exactly
//! - Compiles to native and WASM
//! - Zero dependencies (core library)
//!
//! ## Example
//! ```
//! use flowchart_indicators::{sma, rsi, macd};
//!
//! let prices = vec![44.0, 44.5, 45.0, 44.5, 45.5, 46.0, 45.5, 46.5];
//!
//! let sma_values = sma(&prices, 3);
//! let rsi_values = rsi(&prices, 14);
//! let (macd_line, signal, histogram) = macd(&prices, 12, 26, 9);
//! ```

pub mod common;
pub mod moving_averages;
pub mod oscillators;
pub mod momentum;
pub mod volatility;
pub mod volume;
pub mod trend;
pub mod backtest;

// Re-export commonly used functions at crate root
pub use moving_averages::{sma, ema, wma, dema, tema, hma, kama, wilders_ma};
pub use oscillators::{rsi, rsi_sma, rsi_ema, stoch_rsi, laguerre_rsi, stoch_k, stoch_d, williams_r, cci, mfi};
pub use momentum::{macd, ppo, ppo_histogram, roc, aroon_up, aroon_down, aroon_osc, adx, momentum_13612w, momentum_13612u, sma12_momentum, linreg_slope, linreg_value, linreg_slope_js};
pub use volatility::{std_dev, bollinger_b, bollinger_bandwidth, atr, atr_percent, historical_volatility, ulcer_index, ulcer_index_js, max_drawdown, max_drawdown_ratio, drawdown, true_range};
pub use volume::{obv, obv_roc, vwap, vwap_ratio, rolling_vwap, volume_roc, relative_volume};
pub use trend::{price_vs_sma, price_vs_sma_js, sma_of_returns, cumulative_return, trend_clarity, ultimate_smoother, super_smoother, trend_strength, choppiness_index, efficiency_ratio, rolling_return, ultimate_smoother_js, trend_r_squared, drawdown_ratio};

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

/// WASM bindings for browser/Node.js use
#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub struct Indicators;

#[cfg(feature = "wasm")]
#[wasm_bindgen]
impl Indicators {
    // Moving Averages
    #[wasm_bindgen]
    pub fn sma(values: &[f64], period: usize) -> Vec<f64> {
        moving_averages::sma(values, period)
    }

    #[wasm_bindgen]
    pub fn ema(values: &[f64], period: usize) -> Vec<f64> {
        moving_averages::ema(values, period)
    }

    #[wasm_bindgen]
    pub fn wma(values: &[f64], period: usize) -> Vec<f64> {
        moving_averages::wma(values, period)
    }

    #[wasm_bindgen]
    pub fn hma(values: &[f64], period: usize) -> Vec<f64> {
        moving_averages::hma(values, period)
    }

    // Oscillators
    #[wasm_bindgen]
    pub fn rsi(closes: &[f64], period: usize) -> Vec<f64> {
        oscillators::rsi(closes, period)
    }

    #[wasm_bindgen]
    pub fn stoch_rsi(closes: &[f64], rsi_period: usize, stoch_period: usize) -> Vec<f64> {
        oscillators::stoch_rsi(closes, rsi_period, stoch_period)
    }

    #[wasm_bindgen]
    pub fn laguerre_rsi(closes: &[f64], gamma: f64) -> Vec<f64> {
        oscillators::laguerre_rsi(closes, gamma)
    }

    #[wasm_bindgen]
    pub fn williams_r(highs: &[f64], lows: &[f64], closes: &[f64], period: usize) -> Vec<f64> {
        oscillators::williams_r(highs, lows, closes, period)
    }

    #[wasm_bindgen]
    pub fn cci(highs: &[f64], lows: &[f64], closes: &[f64], period: usize) -> Vec<f64> {
        oscillators::cci(highs, lows, closes, period)
    }

    // Momentum
    #[wasm_bindgen]
    pub fn macd_line(closes: &[f64], fast: usize, slow: usize, signal: usize) -> Vec<f64> {
        let (macd_line, _, _) = momentum::macd(closes, fast, slow, signal);
        macd_line
    }

    #[wasm_bindgen]
    pub fn ppo(closes: &[f64], fast: usize, slow: usize) -> Vec<f64> {
        momentum::ppo(closes, fast, slow)
    }

    #[wasm_bindgen]
    pub fn roc(closes: &[f64], period: usize) -> Vec<f64> {
        momentum::roc(closes, period)
    }

    #[wasm_bindgen]
    pub fn adx(highs: &[f64], lows: &[f64], closes: &[f64], period: usize) -> Vec<f64> {
        momentum::adx(highs, lows, closes, period)
    }

    #[wasm_bindgen]
    pub fn linreg_slope(values: &[f64], period: usize) -> Vec<f64> {
        momentum::linreg_slope(values, period)
    }

    #[wasm_bindgen]
    pub fn linreg_slope_js(values: &[f64], period: usize) -> Vec<f64> {
        momentum::linreg_slope_js(values, period)
    }

    // Volatility
    #[wasm_bindgen]
    pub fn atr(highs: &[f64], lows: &[f64], closes: &[f64], period: usize) -> Vec<f64> {
        volatility::atr(highs, lows, closes, period)
    }

    #[wasm_bindgen]
    pub fn bollinger_b(closes: &[f64], period: usize, std_mult: f64) -> Vec<f64> {
        volatility::bollinger_b(closes, period, std_mult)
    }

    #[wasm_bindgen]
    pub fn ulcer_index_js(closes: &[f64], period: usize) -> Vec<f64> {
        volatility::ulcer_index_js(closes, period)
    }

    #[wasm_bindgen]
    pub fn drawdown_ratio(closes: &[f64]) -> Vec<f64> {
        trend::drawdown_ratio(closes)
    }

    #[wasm_bindgen]
    pub fn max_drawdown_ratio(closes: &[f64]) -> Vec<f64> {
        volatility::max_drawdown_ratio(closes)
    }

    // Trend
    #[wasm_bindgen]
    pub fn trend_r_squared(closes: &[f64], period: usize) -> Vec<f64> {
        trend::trend_r_squared(closes, period)
    }

    #[wasm_bindgen]
    pub fn ultimate_smoother_js(values: &[f64], period: usize) -> Vec<f64> {
        trend::ultimate_smoother_js(values, period)
    }

    #[wasm_bindgen]
    pub fn price_vs_sma_js(closes: &[f64], period: usize) -> Vec<f64> {
        trend::price_vs_sma_js(closes, period)
    }

    #[wasm_bindgen]
    pub fn rolling_return(closes: &[f64], period: usize) -> Vec<f64> {
        trend::rolling_return(closes, period)
    }
}
