// src/backtest/indicators.rs
// Bridge to the flowchart_indicators library for metric computation

use crate::backtest::context::{EvalContext, IndicatorCache, PriceDb};
use crate::backtest::types::FlowNode;

// Import all indicators from the main library
use crate::{
    sma, ema, wma, hma, dema, tema, kama, wilders_ma,
    rsi, rsi_sma, rsi_ema, stoch_rsi, laguerre_rsi,
    roc, williams_r, cci, stoch_k, stoch_d, adx,
    std_dev, bollinger_b, bollinger_bandwidth, atr, atr_percent,
    historical_volatility, ulcer_index_js, max_drawdown_ratio, drawdown,
    cumulative_return, sma_of_returns,
    trend_clarity, linreg_slope_js, linreg_value,
    price_vs_sma_js,
    aroon_up, aroon_down, aroon_osc,
    ppo_histogram, macd,
    mfi, obv_roc, vwap_ratio,
    momentum_13612w, momentum_13612u, sma12_momentum,
};

/// Get the lookback period needed for a metric
pub fn get_indicator_lookback(metric: &str, window: u32) -> usize {
    match metric {
        "Current Price" | "Date" => 0,
        "Momentum (Weighted)" | "Momentum (Unweighted)" | "13612W" | "13612U" => 252,
        "Momentum (12-Month SMA)" | "SMA12" => 252,
        "MACD Histogram" | "PPO Histogram" => 35, // 26 + 9
        "Laguerre RSI" => 10,
        "DEMA" => (window * 2) as usize,
        "TEMA" => (window * 3) as usize,
        "KAMA" => (window + 30) as usize,
        "Drawdown" => 0, // Uses all history
        _ => window.max(1) as usize,
    }
}

/// Compute a metric value at a specific index
/// Returns None if data is insufficient or ticker not found
pub fn metric_at_index(
    cache: &mut IndicatorCache,
    db: &PriceDb,
    ticker: &str,
    metric: &str,
    window: u32,
    index: usize,
) -> Option<f64> {
    // Handle special tickers
    if ticker == "Empty" || ticker.is_empty() {
        return None;
    }

    // Get the indicator values (compute if not cached)
    let values = compute_indicator(cache, db, ticker, metric, window)?;

    // Get value at index
    values.get(index).copied().filter(|v| !v.is_nan())
}

/// Compute a full indicator series for a ticker
/// Returns cached values if available, otherwise computes and caches
pub fn compute_indicator(
    cache: &mut IndicatorCache,
    db: &PriceDb,
    ticker: &str,
    metric: &str,
    window: u32,
) -> Option<Vec<f64>> {
    // Check cache first
    let cache_key = format!("{}_{}", normalize_metric_name(metric), window);
    if let Some(cached) = cache.get(&cache_key, ticker, window) {
        return Some(cached.clone());
    }

    // Get price data
    let closes = cache.get_or_compute_close(ticker, db)?;

    // Compute based on metric type
    let period = window.max(1) as usize;
    let values = match metric {
        // Current Price
        "Current Price" => closes.clone(),

        // Moving Averages
        "Simple Moving Average" | "SMA" => sma(&closes, period),
        "Exponential Moving Average" | "EMA" => ema(&closes, period),
        "Hull Moving Average" | "HMA" => hma(&closes, period),
        "Weighted Moving Average" | "WMA" => wma(&closes, period),
        "Wilder Moving Average" | "Wilders MA" => wilders_ma(&closes, period),
        "DEMA" => dema(&closes, period),
        "TEMA" => tema(&closes, period),
        "KAMA" => kama(&closes, period, 2, 30),

        // RSI variants
        "Relative Strength Index" | "RSI" => rsi(&closes, period),
        "RSI (SMA)" => rsi_sma(&closes, period),
        "RSI (EMA)" => rsi_ema(&closes, period),
        "Stochastic RSI" => stoch_rsi(&closes, period, period),
        "Laguerre RSI" => laguerre_rsi(&closes, 0.8),

        // Momentum
        "Momentum (Weighted)" | "13612W" => momentum_13612w(&closes),
        "Momentum (Unweighted)" | "13612U" => momentum_13612u(&closes),
        "Momentum (12-Month SMA)" | "SMA12" => sma12_momentum(&closes, 12),
        "Rate of Change" | "ROC" => roc(&closes, period),

        // Volatility
        "Standard Deviation" => {
            // Standard deviation of returns, not prices
            let returns = cache.get_or_compute_returns(ticker, db)?;
            std_dev(&returns, period)
        }
        "Standard Deviation of Price" => std_dev(&closes, period),
        "Max Drawdown" => max_drawdown_ratio(&closes),
        "Drawdown" => drawdown(&closes),
        "Bollinger %B" => bollinger_b(&closes, period, 2.0),
        "Bollinger Bandwidth" => bollinger_bandwidth(&closes, period, 2.0),
        "Historical Volatility" => historical_volatility(&closes, period),
        "Ulcer Index" => ulcer_index_js(&closes, period),

        // Trend
        "Cumulative Return" => cumulative_return(&closes),
        "SMA of Returns" => {
            let returns = cache.get_or_compute_returns(ticker, db)?;
            sma_of_returns(&returns, period)
        }
        "Trend Clarity" => trend_clarity(&closes, period),
        "Linear Reg Slope" => linreg_slope_js(&closes, period),
        "Linear Reg Value" => linreg_value(&closes, period),
        "Price vs SMA" => price_vs_sma_js(&closes, period),
        "Ultimate Smoother" => {
            // Ultimate smoother - use existing or fallback to EMA
            ema(&closes, period) // TODO: implement ultimate_smoother if needed
        }

        // MACD/PPO (fixed parameters)
        "MACD Histogram" => {
            let (_, _, hist) = macd(closes.as_slice(), 12, 26, 9);
            hist
        }
        "PPO Histogram" => {
            let (_, _, hist) = ppo_histogram(&closes, 12, 26, 9);
            hist
        }

        // Aroon
        "Aroon Up" => {
            let highs = cache.get_or_compute_high(ticker, db)?;
            aroon_up(&highs, period)
        }
        "Aroon Down" => {
            let lows = cache.get_or_compute_low(ticker, db)?;
            aroon_down(&lows, period)
        }
        "Aroon Oscillator" => {
            let highs = cache.get_or_compute_high(ticker, db)?;
            let lows = cache.get_or_compute_low(ticker, db)?;
            aroon_osc(&highs, &lows, period)
        }

        // OHLC-based indicators
        "ATR" => {
            let highs = db.get_high_series(ticker)?;
            let lows = db.get_low_series(ticker)?;
            atr(highs, lows, &closes, period)
        }
        "ATR %" => {
            let highs = db.get_high_series(ticker)?;
            let lows = db.get_low_series(ticker)?;
            atr_percent(highs, lows, &closes, period)
        }
        "Williams %R" => {
            let highs = db.get_high_series(ticker)?;
            let lows = db.get_low_series(ticker)?;
            williams_r(highs, lows, &closes, period)
        }
        "CCI" => {
            let highs = db.get_high_series(ticker)?;
            let lows = db.get_low_series(ticker)?;
            cci(highs, lows, &closes, period)
        }
        "Stochastic %K" => {
            let highs = db.get_high_series(ticker)?;
            let lows = db.get_low_series(ticker)?;
            stoch_k(highs, lows, &closes, period)
        }
        "Stochastic %D" => {
            let highs = db.get_high_series(ticker)?;
            let lows = db.get_low_series(ticker)?;
            stoch_d(highs, lows, &closes, period, 3)
        }
        "ADX" => {
            let highs = db.get_high_series(ticker)?;
            let lows = db.get_low_series(ticker)?;
            adx(highs, lows, &closes, period)
        }

        // Volume-based
        "Money Flow Index" | "MFI" => {
            let highs = db.get_high_series(ticker)?;
            let lows = db.get_low_series(ticker)?;
            let volumes = db.get_volume_series(ticker)?;
            mfi(highs, lows, &closes, volumes, period)
        }
        "OBV Rate of Change" => {
            let volumes = db.get_volume_series(ticker)?;
            obv_roc(&closes, volumes, period)
        }
        "VWAP Ratio" => {
            let highs = db.get_high_series(ticker)?;
            let lows = db.get_low_series(ticker)?;
            let volumes = db.get_volume_series(ticker)?;
            vwap_ratio(highs, lows, &closes, volumes)
        }

        // Date-based (handled separately in conditions)
        "Date" => vec![f64::NAN; closes.len()],

        // Unknown metric - silently return None (logging was causing massive slowdown)
        _ => return None,
    };

    // Cache the result
    cache.set(&cache_key, ticker, window, values.clone());

    Some(values)
}

/// Normalize metric name for cache key
fn normalize_metric_name(metric: &str) -> &str {
    match metric {
        "Simple Moving Average" => "sma",
        "Exponential Moving Average" => "ema",
        "Hull Moving Average" => "hma",
        "Weighted Moving Average" => "wma",
        "Wilder Moving Average" => "wilders",
        "Relative Strength Index" => "rsi",
        "RSI (SMA)" => "rsi_sma",
        "RSI (EMA)" => "rsi_ema",
        "Stochastic RSI" => "stoch_rsi",
        "Laguerre RSI" => "laguerre_rsi",
        "Momentum (Weighted)" => "mom_13612w",
        "Momentum (Unweighted)" => "mom_13612u",
        "Momentum (12-Month SMA)" => "mom_sma12",
        "Rate of Change" => "roc",
        "Standard Deviation" => "std",
        "Standard Deviation of Price" => "std_price",
        "Max Drawdown" => "max_dd",
        "Bollinger %B" => "boll_b",
        "Bollinger Bandwidth" => "boll_bw",
        "Historical Volatility" => "hist_vol",
        "Ulcer Index" => "ulcer",
        "Cumulative Return" => "cum_ret",
        "SMA of Returns" => "sma_ret",
        "Trend Clarity" => "trend_clarity",
        "Linear Reg Slope" => "linreg_slope",
        "Linear Reg Value" => "linreg_value",
        "Price vs SMA" => "price_vs_sma",
        "Ultimate Smoother" => "ult_smooth",
        "MACD Histogram" => "macd_hist",
        "PPO Histogram" => "ppo_hist",
        "Aroon Up" => "aroon_up",
        "Aroon Down" => "aroon_down",
        "Aroon Oscillator" => "aroon_osc",
        "Williams %R" => "williams_r",
        "Stochastic %K" => "stoch_k",
        "Stochastic %D" => "stoch_d",
        "Money Flow Index" => "mfi",
        "OBV Rate of Change" => "obv_roc",
        "VWAP Ratio" => "vwap_ratio",
        "Current Price" => "price",
        "Drawdown" => "drawdown",
        _ => metric,
    }
}

/// Compute metric on a branch equity curve
pub fn branch_metric_at_index(
    equity: &[f64],
    returns: &[f64],
    metric: &str,
    window: u32,
    index: usize,
) -> Option<f64> {
    let period = window.max(1) as usize;

    // Compute indicator on equity curve
    let values = match metric {
        "Current Price" => equity.to_vec(),
        "Simple Moving Average" | "SMA" => sma(equity, period),
        "Exponential Moving Average" | "EMA" => ema(equity, period),
        "Relative Strength Index" | "RSI" => rsi(equity, period),
        "Rate of Change" | "ROC" => roc(equity, period),
        "Standard Deviation" => std_dev(returns, period),
        "Max Drawdown" => max_drawdown_ratio(equity),
        "Drawdown" => drawdown(equity),
        "Cumulative Return" => cumulative_return(equity),
        "Trend Clarity" => trend_clarity(equity, period),
        "Linear Reg Slope" => linreg_slope_js(equity, period),
        "Price vs SMA" => price_vs_sma_js(equity, period),
        "Momentum (Weighted)" | "13612W" => momentum_13612w(equity),
        "Momentum (Unweighted)" | "13612U" => momentum_13612u(equity),
        _ => {
            // For other metrics, try using SMA as fallback
            sma(equity, period)
        }
    };

    values.get(index).copied().filter(|v| !v.is_nan())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_metric_name() {
        assert_eq!(normalize_metric_name("Simple Moving Average"), "sma");
        assert_eq!(normalize_metric_name("Relative Strength Index"), "rsi");
        assert_eq!(normalize_metric_name("unknown"), "unknown");
    }

    #[test]
    fn test_get_indicator_lookback() {
        assert_eq!(get_indicator_lookback("Current Price", 14), 0);
        assert_eq!(get_indicator_lookback("Momentum (Weighted)", 0), 252);
        assert_eq!(get_indicator_lookback("Simple Moving Average", 20), 20);
        assert_eq!(get_indicator_lookback("DEMA", 10), 20);
    }
}
