//! Trend and custom indicators
//!
//! Custom indicators for trend analysis and signal smoothing.

use crate::common::{nan_vec, has_enough_data, mean, safe_div};
use crate::moving_averages::sma;

/// Price vs SMA
///
/// Returns the ratio of price to its SMA (1.0 = at SMA, >1.0 = above, <1.0 = below)
///
/// Formula: Close / SMA
pub fn price_vs_sma(closes: &[f64], period: usize) -> Vec<f64> {
    let n = closes.len();
    if !has_enough_data(n, period) {
        return nan_vec(n);
    }

    let sma_values = sma(closes, period);

    let mut result = nan_vec(n);
    for i in 0..n {
        if !sma_values[i].is_nan() && sma_values[i] != 0.0 {
            result[i] = closes[i] / sma_values[i];
        }
    }
    result
}

/// SMA of Returns
///
/// Simple moving average of daily returns
///
/// Formula: SMA(Return, period) where Return = (Close - Close[1]) / Close[1]
pub fn sma_of_returns(closes: &[f64], period: usize) -> Vec<f64> {
    let n = closes.len();
    if !has_enough_data(n, period + 1) {
        return nan_vec(n);
    }

    // Calculate returns
    let mut returns = nan_vec(n);
    for i in 1..n {
        if closes[i - 1] != 0.0 {
            returns[i] = (closes[i] - closes[i - 1]) / closes[i - 1];
        }
    }

    // SMA of returns (skip first NaN)
    let mut result = nan_vec(n);
    for i in period..n {
        let window = &returns[(i + 1 - period)..=i];
        let valid: Vec<f64> = window.iter().filter(|x| !x.is_nan()).cloned().collect();
        if !valid.is_empty() {
            result[i] = mean(&valid) * 100.0; // Express as percentage
        }
    }
    result
}

/// Cumulative Return
///
/// Total return from start of series
///
/// Formula: ((Close - Close[0]) / Close[0]) * 100
pub fn cumulative_return(closes: &[f64]) -> Vec<f64> {
    let n = closes.len();
    if n == 0 {
        return vec![];
    }

    let start_price = closes[0];
    if start_price == 0.0 {
        return nan_vec(n);
    }

    closes.iter()
        .map(|&c| ((c - start_price) / start_price) * 100.0)
        .collect()
}

/// Rolling Cumulative Return
///
/// Return over a rolling lookback period
///
/// Formula: ((Close - Close[period]) / Close[period]) * 100
pub fn rolling_return(closes: &[f64], period: usize) -> Vec<f64> {
    let n = closes.len();
    if !has_enough_data(n, period + 1) {
        return nan_vec(n);
    }

    let mut result = nan_vec(n);
    for i in period..n {
        result[i] = safe_div(closes[i] - closes[i - period], closes[i - period]) * 100.0;
    }
    result
}

/// Trend Clarity
///
/// Measures how "clean" or consistent the trend is.
/// Ratio of net price change to total absolute price changes.
///
/// Formula: |Close - Close[period]| / Sum(|Close[i] - Close[i-1]|, period)
///
/// Values:
/// - 1.0 = Perfect trend (price moved in one direction only)
/// - 0.0 = No net movement (equal up and down moves)
pub fn trend_clarity(closes: &[f64], period: usize) -> Vec<f64> {
    let n = closes.len();
    if !has_enough_data(n, period + 1) {
        return nan_vec(n);
    }

    let mut result = nan_vec(n);

    for i in period..n {
        let net_change = (closes[i] - closes[i - period]).abs();

        // Sum of absolute daily changes
        let mut total_movement = 0.0;
        for j in (i - period + 1)..=i {
            total_movement += (closes[j] - closes[j - 1]).abs();
        }

        if total_movement > 0.0 {
            result[i] = net_change / total_movement;
        }
    }
    result
}

/// Ultimate Smoother
///
/// John Ehlers' Ultimate Smoother - a very smooth filter with minimal lag.
/// Uses 3-pole Butterworth filter design.
///
/// This is a custom indicator not found in TA-Lib.
pub fn ultimate_smoother(values: &[f64], period: usize) -> Vec<f64> {
    let n = values.len();
    if n < 4 {
        return nan_vec(n);
    }

    let mut result = nan_vec(n);

    // Calculate filter coefficients based on period
    let pi = std::f64::consts::PI;
    let a1 = (-1.414 * pi / period as f64).exp();
    let b1 = 2.0 * a1 * (1.414 * pi / period as f64).cos();
    let c2 = b1;
    let c3 = -a1 * a1;
    let c1 = 1.0 - c2 - c3;

    // Initialize with first valid values
    result[0] = values[0];
    result[1] = values[1];
    if n > 2 {
        result[2] = values[2];
    }

    // Apply recursive filter
    for i in 3..n {
        result[i] = c1 * (values[i] + 2.0 * values[i - 1] + values[i - 2]) / 4.0
            + c2 * result[i - 1]
            + c3 * result[i - 2];
    }

    result
}

/// Super Smoother
///
/// Another John Ehlers filter - 2-pole Butterworth with less smoothing than Ultimate
pub fn super_smoother(values: &[f64], period: usize) -> Vec<f64> {
    let n = values.len();
    if n < 3 {
        return nan_vec(n);
    }

    let mut result = nan_vec(n);

    let pi = std::f64::consts::PI;
    let a1 = (-1.414 * pi / period as f64).exp();
    let b1 = 2.0 * a1 * (1.414 * pi / period as f64).cos();
    let c2 = b1;
    let c3 = -a1 * a1;
    let c1 = 1.0 - c2 - c3;

    result[0] = values[0];
    result[1] = values[1];

    for i in 2..n {
        result[i] = c1 * (values[i] + values[i - 1]) / 2.0
            + c2 * result[i - 1]
            + c3 * result[i - 2];
    }

    result
}

/// Trend Strength Index
///
/// Measures trend strength based on directional movement consistency
///
/// Formula: (Count of positive changes - Count of negative changes) / period
pub fn trend_strength(closes: &[f64], period: usize) -> Vec<f64> {
    let n = closes.len();
    if !has_enough_data(n, period + 1) {
        return nan_vec(n);
    }

    let mut result = nan_vec(n);

    for i in period..n {
        let mut up_count = 0;
        let mut down_count = 0;

        for j in (i - period + 1)..=i {
            if closes[j] > closes[j - 1] {
                up_count += 1;
            } else if closes[j] < closes[j - 1] {
                down_count += 1;
            }
        }

        result[i] = (up_count as f64 - down_count as f64) / period as f64;
    }
    result
}

/// Choppiness Index
///
/// Measures market consolidation vs trending behavior
///
/// Formula: 100 * log10(Sum(ATR, period) / (Highest High - Lowest Low)) / log10(period)
///
/// Values:
/// - > 61.8: Market is choppy/consolidating
/// - < 38.2: Market is trending
pub fn choppiness_index(highs: &[f64], lows: &[f64], closes: &[f64], period: usize) -> Vec<f64> {
    let n = highs.len();
    if n != lows.len() || n != closes.len() || !has_enough_data(n, period + 1) {
        return nan_vec(n);
    }

    // Calculate True Range
    let mut tr = nan_vec(n);
    tr[0] = highs[0] - lows[0];
    for i in 1..n {
        let h_l = highs[i] - lows[i];
        let h_c = (highs[i] - closes[i - 1]).abs();
        let l_c = (lows[i] - closes[i - 1]).abs();
        tr[i] = h_l.max(h_c).max(l_c);
    }

    let mut result = nan_vec(n);
    let log_period = (period as f64).log10();

    for i in period..n {
        // Sum of TR over period
        let tr_sum: f64 = tr[(i + 1 - period)..=i].iter().sum();

        // Highest high and lowest low over period
        let window_highs = &highs[(i + 1 - period)..=i];
        let window_lows = &lows[(i + 1 - period)..=i];
        let highest = window_highs.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let lowest = window_lows.iter().cloned().fold(f64::INFINITY, f64::min);

        let range = highest - lowest;
        if range > 0.0 && log_period > 0.0 {
            result[i] = 100.0 * (tr_sum / range).log10() / log_period;
        }
    }
    result
}

/// Efficiency Ratio (also known as Kaufman's Efficiency Ratio)
///
/// Measures trend efficiency - how much price moved vs how much it traveled
///
/// Formula: |Close - Close[period]| / Sum(|Close[i] - Close[i-1]|, period)
///
/// Same as Trend Clarity but commonly called Efficiency Ratio
pub fn efficiency_ratio(closes: &[f64], period: usize) -> Vec<f64> {
    trend_clarity(closes, period)
}

// ============================================
// JS-COMPATIBLE VARIANTS
// These match backtest.mjs formulas exactly
// ============================================

/// Ultimate Smoother (JS-compatible)
///
/// Matches backtest.mjs `rollingUltimateSmoother` exactly.
/// Uses simpler formula: c1 * x + c2 * prev1 + c3 * prev2
///
/// Note: This differs from the original Ehlers formula which uses
/// weighted input: c1 * (x + 2*x[1] + x[2]) / 4
pub fn ultimate_smoother_js(values: &[f64], period: usize) -> Vec<f64> {
    let n = values.len();
    if n < 3 {
        return nan_vec(n);
    }

    let mut result = nan_vec(n);

    // 2-pole Butterworth coefficients (same as JS)
    let pi = std::f64::consts::PI;
    let f = 1.414 * pi / period as f64;
    let a1 = (-f).exp();
    let b1 = 2.0 * a1 * f.cos();
    let c2 = b1;
    let c3 = -a1 * a1;
    let c1 = 1.0 - c2 - c3;

    // Initialize with raw values (matching JS)
    for i in 0..n.min(period.max(2)) {
        result[i] = values[i];
    }

    // Apply recursive filter (JS formula: c1 * x + c2 * prev1 + c3 * prev2)
    for i in period.max(2)..n {
        if values[i].is_nan() || values[i - 1].is_nan() || values[i - 2].is_nan() {
            continue;
        }
        let prev1 = if result[i - 1].is_nan() { values[i - 1] } else { result[i - 1] };
        let prev2 = if result[i - 2].is_nan() { values[i - 2] } else { result[i - 2] };
        result[i] = c1 * values[i] + c2 * prev1 + c3 * prev2;
    }

    result
}

/// Trend R-Squared (JS-compatible)
///
/// Matches backtest.mjs `rollingTrendClarity` exactly.
/// Calculates R² (coefficient of determination) as a percentage.
///
/// This measures how well price follows a linear trend.
///
/// Note: This is different from `trend_clarity` which measures
/// net movement / total movement (Efficiency Ratio).
///
/// Values:
/// - 100 = Perfect linear trend
/// - 0 = No linear relationship
pub fn trend_r_squared(closes: &[f64], period: usize) -> Vec<f64> {
    let n = closes.len();
    if !has_enough_data(n, period) {
        return nan_vec(n);
    }

    let mut result = nan_vec(n);

    for i in (period - 1)..n {
        let window_start = i + 1 - period;
        let mut valid = true;
        let mut sum_x = 0.0;
        let mut sum_y = 0.0;
        let mut sum_xy = 0.0;
        let mut sum_x2 = 0.0;
        let mut sum_y2 = 0.0;

        for j in 0..period {
            let y = closes[window_start + j];
            if y.is_nan() {
                valid = false;
                break;
            }
            let x = j as f64;
            sum_x += x;
            sum_y += y;
            sum_xy += x * y;
            sum_x2 += x * x;
            sum_y2 += y * y;
        }

        if valid {
            let n_f = period as f64;
            let num = n_f * sum_xy - sum_x * sum_y;
            let den = ((n_f * sum_x2 - sum_x * sum_x) * (n_f * sum_y2 - sum_y * sum_y)).sqrt();
            let r = if den == 0.0 { 0.0 } else { num / den };
            result[i] = r * r * 100.0; // R² as percentage
        }
    }

    result
}

/// Drawdown Ratio (JS-compatible)
///
/// Current drawdown from all-time high, returns RATIO (0.0 to 1.0).
/// Matches backtest.mjs `rollingDrawdown` exactly.
///
/// - 0.0 = At all-time high
/// - 0.05 = 5% below ATH
/// - 0.10 = 10% below ATH
///
/// Note: Standard `drawdown` returns PERCENTAGE (0 to 100).
pub fn drawdown_ratio(closes: &[f64]) -> Vec<f64> {
    let n = closes.len();
    if n == 0 {
        return vec![];
    }

    let mut result = nan_vec(n);
    let mut peak = f64::NAN;

    for i in 0..n {
        let v = closes[i];
        if v.is_nan() {
            continue;
        }
        if peak.is_nan() || v > peak {
            peak = v;
        }
        if peak > 0.0 {
            result[i] = (peak - v) / peak; // Returns ratio (not percentage)
        }
    }
    result
}

/// Price vs SMA (JS-compatible)
///
/// Returns percentage difference from SMA.
/// Matches backtest.mjs `rollingPriceVsSma` exactly.
///
/// Formula: ((Close / SMA) - 1) * 100
///
/// - 0 = Price equals SMA
/// - 5 = Price is 5% above SMA
/// - -5 = Price is 5% below SMA
///
/// Note: Standard `price_vs_sma` returns RATIO (e.g., 1.05 for 5% above).
pub fn price_vs_sma_js(closes: &[f64], period: usize) -> Vec<f64> {
    let n = closes.len();
    if !has_enough_data(n, period) {
        return nan_vec(n);
    }

    let sma_values = sma(closes, period);

    let mut result = nan_vec(n);
    for i in 0..n {
        if !sma_values[i].is_nan() && sma_values[i] != 0.0 {
            result[i] = ((closes[i] / sma_values[i]) - 1.0) * 100.0;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx_eq(a: f64, b: f64, epsilon: f64) -> bool {
        if a.is_nan() && b.is_nan() {
            return true;
        }
        (a - b).abs() < epsilon
    }

    #[test]
    fn test_price_vs_sma() {
        let closes = vec![10.0, 10.0, 10.0, 12.0, 14.0];
        let result = price_vs_sma(&closes, 3);

        // At index 2: close=10, sma=10, ratio = 1.0
        assert!(approx_eq(result[2], 1.0, 0.001));

        // At index 4: close=14, sma=(10+12+14)/3=12, ratio = 14/12 ≈ 1.1667
        assert!(approx_eq(result[4], 1.1667, 0.001));
    }

    #[test]
    fn test_cumulative_return() {
        let closes = vec![100.0, 110.0, 120.0, 100.0];
        let result = cumulative_return(&closes);

        assert!(approx_eq(result[0], 0.0, 0.001));
        assert!(approx_eq(result[1], 10.0, 0.001));
        assert!(approx_eq(result[2], 20.0, 0.001));
        assert!(approx_eq(result[3], 0.0, 0.001));
    }

    #[test]
    fn test_trend_clarity_perfect_uptrend() {
        // Perfect uptrend: 10, 11, 12, 13, 14
        let closes: Vec<f64> = (10..=14).map(|x| x as f64).collect();
        let result = trend_clarity(&closes, 4);

        // Net change = 4, total movement = 4 * 1 = 4
        // Clarity = 1.0 (perfect trend)
        assert!(approx_eq(result[4], 1.0, 0.001));
    }

    #[test]
    fn test_trend_clarity_choppy() {
        // Choppy: 10, 12, 10, 12, 10
        let closes = vec![10.0, 12.0, 10.0, 12.0, 10.0];
        let result = trend_clarity(&closes, 4);

        // Net change = 0, total movement = 8
        // Clarity = 0.0 (no trend)
        assert!(approx_eq(result[4], 0.0, 0.001));
    }

    #[test]
    fn test_ultimate_smoother() {
        let values: Vec<f64> = (0..50).map(|x| (x as f64 * 0.1).sin() * 10.0 + 100.0).collect();
        let result = ultimate_smoother(&values, 10);

        // Smoother should reduce noise
        assert_eq!(result.len(), 50);
        // Should produce valid output
        assert!(!result[49].is_nan());
    }

    #[test]
    fn test_super_smoother() {
        let values: Vec<f64> = (0..50).map(|x| (x as f64 * 0.1).sin() * 10.0 + 100.0).collect();
        let result = super_smoother(&values, 10);

        assert_eq!(result.len(), 50);
        assert!(!result[49].is_nan());
    }

    #[test]
    fn test_trend_strength_uptrend() {
        // All up days
        let closes: Vec<f64> = (1..=20).map(|x| x as f64).collect();
        let result = trend_strength(&closes, 10);

        // All positive changes, strength = 1.0
        assert!(approx_eq(result[19], 1.0, 0.001));
    }

    #[test]
    fn test_trend_strength_downtrend() {
        // All down days
        let closes: Vec<f64> = (1..=20).rev().map(|x| x as f64).collect();
        let result = trend_strength(&closes, 10);

        // All negative changes, strength = -1.0
        assert!(approx_eq(result[19], -1.0, 0.001));
    }

    #[test]
    fn test_choppiness_index_range() {
        let highs: Vec<f64> = (1..=30).map(|x| 50.0 + (x as f64 * 0.2).sin() * 5.0).collect();
        let lows: Vec<f64> = (1..=30).map(|x| 45.0 + (x as f64 * 0.2).sin() * 5.0).collect();
        let closes: Vec<f64> = (1..=30).map(|x| 47.5 + (x as f64 * 0.2).sin() * 5.0).collect();

        let result = choppiness_index(&highs, &lows, &closes, 14);

        // Choppiness should be between 0 and 100
        for v in result.iter() {
            if !v.is_nan() {
                assert!(*v >= 0.0 && *v <= 100.0, "Value {} out of range", v);
            }
        }
    }

    #[test]
    fn test_rolling_return() {
        let closes = vec![100.0, 110.0, 121.0, 133.1, 146.41];
        let result = rolling_return(&closes, 2);

        // At index 2: (121 - 100) / 100 * 100 = 21%
        assert!(approx_eq(result[2], 21.0, 0.01));
    }

    // JS-compatible variant tests

    #[test]
    fn test_ultimate_smoother_js() {
        let values: Vec<f64> = (0..50).map(|x| (x as f64 * 0.1).sin() * 10.0 + 100.0).collect();
        let result = ultimate_smoother_js(&values, 10);

        assert_eq!(result.len(), 50);
        // First 10 values should be raw input
        assert!(approx_eq(result[0], values[0], 0.001));
        // Later values should be smoothed
        assert!(!result[49].is_nan());
    }

    #[test]
    fn test_trend_r_squared_perfect_linear() {
        // Perfect linear uptrend: 10, 11, 12, 13, 14
        let closes: Vec<f64> = (10..=14).map(|x| x as f64).collect();
        let result = trend_r_squared(&closes, 5);

        // R² should be 100% for perfect linear data
        assert!(approx_eq(result[4], 100.0, 0.001));
    }

    #[test]
    fn test_trend_r_squared_no_trend() {
        // No linear relationship: alternating high/low
        let closes = vec![10.0, 20.0, 10.0, 20.0, 10.0];
        let result = trend_r_squared(&closes, 5);

        // R² should be low for choppy data
        assert!(result[4] < 20.0, "Expected low R² for choppy data, got {}", result[4]);
    }

    #[test]
    fn test_drawdown_ratio() {
        let closes = vec![100.0, 110.0, 100.0, 120.0, 100.0];
        let result = drawdown_ratio(&closes);

        // At ATH, drawdown is 0
        assert!(approx_eq(result[0], 0.0, 0.001));
        assert!(approx_eq(result[1], 0.0, 0.001));
        // At 100 when peak was 110: dd = (110-100)/110 = 0.0909 (ratio)
        assert!(approx_eq(result[2], 0.0909, 0.001));
        // New ATH at 120
        assert!(approx_eq(result[3], 0.0, 0.001));
        // At 100 when peak was 120: dd = (120-100)/120 = 0.1667 (ratio)
        assert!(approx_eq(result[4], 0.1667, 0.001));
    }

    #[test]
    fn test_price_vs_sma_js() {
        let closes = vec![10.0, 10.0, 10.0, 12.0, 14.0];
        let result = price_vs_sma_js(&closes, 3);

        // At index 2: close=10, sma=10, pct = ((10/10) - 1) * 100 = 0%
        assert!(approx_eq(result[2], 0.0, 0.001));

        // At index 4: close=14, sma=(10+12+14)/3=12, pct = ((14/12) - 1) * 100 = 16.67%
        assert!(approx_eq(result[4], 16.667, 0.01));
    }
}
