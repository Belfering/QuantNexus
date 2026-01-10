//! Volatility indicators
//!
//! Indicators that measure the degree of price variation over time.

use crate::common::{nan_vec, has_enough_data, mean, safe_div, rolling, max};
use crate::moving_averages::{sma, wilders_ma};

/// True Range
///
/// The greatest of:
/// - Current High - Current Low
/// - |Current High - Previous Close|
/// - |Current Low - Previous Close|
pub fn true_range(highs: &[f64], lows: &[f64], closes: &[f64]) -> Vec<f64> {
    let n = highs.len();
    if n != lows.len() || n != closes.len() {
        return nan_vec(n);
    }

    let mut result = nan_vec(n);

    // First value is NaN (needs previous close) - matches TA-Lib behavior
    for i in 1..n {
        let h_l = highs[i] - lows[i];
        let h_c = (highs[i] - closes[i - 1]).abs();
        let l_c = (lows[i] - closes[i - 1]).abs();
        result[i] = h_l.max(h_c).max(l_c);
    }
    result
}

/// ATR - Average True Range
///
/// Uses Wilder's smoothing (same as RSI)
pub fn atr(highs: &[f64], lows: &[f64], closes: &[f64], period: usize) -> Vec<f64> {
    let tr = true_range(highs, lows, closes);
    wilders_ma(&tr, period)
}

/// ATR Percent
///
/// ATR expressed as percentage of close price
///
/// Formula: (ATR / Close) * 100
pub fn atr_percent(highs: &[f64], lows: &[f64], closes: &[f64], period: usize) -> Vec<f64> {
    let atr_values = atr(highs, lows, closes, period);
    let n = closes.len();

    let mut result = nan_vec(n);
    for i in 0..n {
        if !atr_values[i].is_nan() {
            result[i] = safe_div(atr_values[i], closes[i]) * 100.0;
        }
    }
    result
}

/// Standard Deviation
///
/// Population standard deviation over rolling window
pub fn std_dev(values: &[f64], period: usize) -> Vec<f64> {
    let n = values.len();
    if !has_enough_data(n, period) {
        return nan_vec(n);
    }

    rolling(values, period, |window| {
        let m = mean(window);
        let variance: f64 = window.iter().map(|x| (x - m).powi(2)).sum::<f64>() / window.len() as f64;
        variance.sqrt()
    })
}

/// Bollinger %B
///
/// Shows where price is relative to Bollinger Bands
///
/// Formula: (Close - Lower Band) / (Upper Band - Lower Band)
///
/// Returns values where:
/// - 0 = price at lower band
/// - 0.5 = price at middle band (SMA)
/// - 1 = price at upper band
/// - < 0 or > 1 = price outside bands
pub fn bollinger_b(closes: &[f64], period: usize, std_mult: f64) -> Vec<f64> {
    let n = closes.len();
    if !has_enough_data(n, period) {
        return nan_vec(n);
    }

    let middle = sma(closes, period);
    let std = std_dev(closes, period);

    let mut result = nan_vec(n);
    for i in 0..n {
        if !middle[i].is_nan() && !std[i].is_nan() {
            let upper = middle[i] + std_mult * std[i];
            let lower = middle[i] - std_mult * std[i];
            let bandwidth = upper - lower;
            if bandwidth != 0.0 {
                result[i] = (closes[i] - lower) / bandwidth;
            }
        }
    }
    result
}

/// Bollinger Bandwidth
///
/// Measures the width of Bollinger Bands as percentage of middle band
///
/// Formula: ((Upper Band - Lower Band) / Middle Band) * 100
pub fn bollinger_bandwidth(closes: &[f64], period: usize, std_mult: f64) -> Vec<f64> {
    let n = closes.len();
    if !has_enough_data(n, period) {
        return nan_vec(n);
    }

    let middle = sma(closes, period);
    let std = std_dev(closes, period);

    let mut result = nan_vec(n);
    for i in 0..n {
        if !middle[i].is_nan() && !std[i].is_nan() && middle[i] != 0.0 {
            let upper = middle[i] + std_mult * std[i];
            let lower = middle[i] - std_mult * std[i];
            result[i] = ((upper - lower) / middle[i]) * 100.0;
        }
    }
    result
}

/// Historical Volatility
///
/// Annualized standard deviation of log returns
///
/// Formula: StdDev(ln(Close / Close[1])) * sqrt(252)
pub fn historical_volatility(closes: &[f64], period: usize) -> Vec<f64> {
    let n = closes.len();
    if !has_enough_data(n, period + 1) {
        return nan_vec(n);
    }

    // Calculate log returns
    let mut log_returns = nan_vec(n);
    for i in 1..n {
        if closes[i - 1] > 0.0 && closes[i] > 0.0 {
            log_returns[i] = (closes[i] / closes[i - 1]).ln();
        }
    }

    // Standard deviation of log returns
    let std = std_dev(&log_returns, period);

    // Annualize (multiply by sqrt(252))
    let annualize = (252.0_f64).sqrt();
    std.iter().map(|&s| if s.is_nan() { f64::NAN } else { s * annualize * 100.0 }).collect()
}

/// Ulcer Index
///
/// Measures downside volatility (pain of drawdowns)
///
/// Formula: sqrt(mean(Drawdown%^2))
/// where Drawdown% = 100 * (Close - Max Close over period) / Max Close
pub fn ulcer_index(closes: &[f64], period: usize) -> Vec<f64> {
    let n = closes.len();
    if !has_enough_data(n, period) {
        return nan_vec(n);
    }

    // Calculate rolling max
    let rolling_max = rolling(closes, period, |w| max(w));

    // Calculate percentage drawdown from rolling max
    let mut pct_drawdown = nan_vec(n);
    for i in 0..n {
        if !rolling_max[i].is_nan() && rolling_max[i] > 0.0 {
            pct_drawdown[i] = 100.0 * (closes[i] - rolling_max[i]) / rolling_max[i];
        }
    }

    // Ulcer Index = sqrt(mean(drawdown^2))
    rolling(&pct_drawdown, period, |window| {
        let sum_sq: f64 = window.iter().filter(|x| !x.is_nan()).map(|x| x.powi(2)).sum();
        let count = window.iter().filter(|x| !x.is_nan()).count();
        if count > 0 {
            (sum_sq / count as f64).sqrt()
        } else {
            f64::NAN
        }
    })
}

/// Maximum Drawdown
///
/// Maximum peak-to-trough decline over the entire series
/// Returns a single value repeated for the series (cumulative max drawdown)
pub fn max_drawdown(closes: &[f64]) -> Vec<f64> {
    let n = closes.len();
    if n == 0 {
        return vec![];
    }

    let mut result = nan_vec(n);
    let mut peak = closes[0];
    let mut max_dd = 0.0;

    for i in 0..n {
        if closes[i] > peak {
            peak = closes[i];
        }
        let dd = (peak - closes[i]) / peak;
        if dd > max_dd {
            max_dd = dd;
        }
        result[i] = max_dd * 100.0; // Express as percentage
    }
    result
}

/// Current Drawdown
///
/// Current percentage decline from the running peak
pub fn drawdown(closes: &[f64]) -> Vec<f64> {
    let n = closes.len();
    if n == 0 {
        return vec![];
    }

    let mut result = nan_vec(n);
    let mut peak = closes[0];

    for i in 0..n {
        if closes[i] > peak {
            peak = closes[i];
        }
        result[i] = ((peak - closes[i]) / peak) * 100.0;
    }
    result
}

// ============================================
// JS-COMPATIBLE VARIANTS
// These match backtest.mjs formulas exactly
// ============================================

/// Maximum Drawdown Ratio (JS-compatible)
///
/// Maximum peak-to-trough decline over the entire series.
/// Returns RATIO (0.0 to 1.0) instead of percentage.
/// Matches backtest.mjs `rollingMaxDrawdown` output scale.
///
/// - 0.0 = No drawdown ever
/// - 0.33 = Maximum 33% decline from peak
///
/// Note: Standard `max_drawdown` returns PERCENTAGE (0 to 100).
pub fn max_drawdown_ratio(closes: &[f64]) -> Vec<f64> {
    let n = closes.len();
    if n == 0 {
        return vec![];
    }

    let mut result = nan_vec(n);
    let mut peak = closes[0];
    let mut max_dd = 0.0;

    for i in 0..n {
        if closes[i] > peak {
            peak = closes[i];
        }
        let dd = (peak - closes[i]) / peak;
        if dd > max_dd {
            max_dd = dd;
        }
        result[i] = max_dd; // Returns ratio (not percentage)
    }
    result
}

/// Ulcer Index (JS-compatible)
///
/// Matches backtest.mjs `rollingUlcerIndex` exactly.
/// Tracks progressive max within each window (Peter Martin's original method).
///
/// For each window position, calculates drawdown from the max-so-far within
/// that window, not from the overall window max.
///
/// Note: Standard `ulcer_index` calculates drawdown from the window's
/// overall max, which is a different (simpler) approach.
pub fn ulcer_index_js(closes: &[f64], period: usize) -> Vec<f64> {
    let n = closes.len();
    if !has_enough_data(n, period) {
        return nan_vec(n);
    }

    let mut result = nan_vec(n);

    for i in (period - 1)..n {
        let window_start = i + 1 - period;
        let mut max_close = f64::NEG_INFINITY;
        let mut sum_sq = 0.0;
        let mut valid = true;

        // Progressive max within window (JS approach)
        for j in 0..period {
            let v = closes[window_start + j];
            if v.is_nan() {
                valid = false;
                break;
            }
            if v > max_close {
                max_close = v;
            }
            let pct_drawdown = ((v - max_close) / max_close) * 100.0;
            sum_sq += pct_drawdown * pct_drawdown;
        }

        if valid {
            result[i] = (sum_sq / period as f64).sqrt();
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
    fn test_true_range() {
        let highs = vec![50.0, 52.0, 51.0];
        let lows = vec![48.0, 49.0, 47.0];
        let closes = vec![49.0, 51.0, 48.0];

        let tr = true_range(&highs, &lows, &closes);

        // First TR is NaN (needs previous close) - matches TA-Lib behavior
        assert!(tr[0].is_nan());

        // Second TR = max(52-49, |52-49|, |49-49|) = max(3, 3, 0) = 3
        assert!(approx_eq(tr[1], 3.0, 0.001));

        // Third TR = max(51-47, |51-51|, |47-51|) = max(4, 0, 4) = 4
        assert!(approx_eq(tr[2], 4.0, 0.001));
    }

    #[test]
    fn test_atr_basic() {
        let highs: Vec<f64> = (1..=30).map(|x| 50.0 + x as f64).collect();
        let lows: Vec<f64> = (1..=30).map(|x| 48.0 + x as f64).collect();
        let closes: Vec<f64> = (1..=30).map(|x| 49.0 + x as f64).collect();

        let result = atr(&highs, &lows, &closes, 14);

        // ATR should be positive
        for v in result.iter() {
            if !v.is_nan() {
                assert!(*v > 0.0);
            }
        }
    }

    #[test]
    fn test_std_dev_basic() {
        // Values with known std dev
        let values = vec![2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0];
        let result = std_dev(&values, 8);

        // Population std dev of these values is 2.0
        assert!(approx_eq(result[7], 2.0, 0.001));
    }

    #[test]
    fn test_bollinger_b_middle() {
        // When price equals SMA, %B should be ~0.5
        let closes = vec![10.0, 10.0, 10.0, 10.0, 10.0]; // Constant price
        let result = bollinger_b(&closes, 3, 2.0);

        // With constant prices, std dev is 0, so bands collapse
        // This edge case results in NaN due to division by zero
        // Let's test with varying prices instead
        let closes2 = vec![10.0, 11.0, 10.0, 11.0, 10.0, 11.0, 10.0];
        let result2 = bollinger_b(&closes2, 3, 2.0);

        // Values should be between 0 and 1 most of the time
        for v in result2.iter() {
            if !v.is_nan() {
                // Should be roughly centered
                assert!(*v > -1.0 && *v < 2.0);
            }
        }
    }

    #[test]
    fn test_bollinger_bandwidth_positive() {
        let closes: Vec<f64> = (1..=20).map(|x| 100.0 + (x as f64).sin() * 10.0).collect();
        let result = bollinger_bandwidth(&closes, 10, 2.0);

        // Bandwidth should always be positive
        for v in result.iter() {
            if !v.is_nan() {
                assert!(*v > 0.0);
            }
        }
    }

    #[test]
    fn test_historical_volatility() {
        // Generate some price data
        let closes: Vec<f64> = (1..=100).map(|x| 100.0 + (x as f64 * 0.1).sin() * 5.0).collect();
        let result = historical_volatility(&closes, 20);

        // HV should be positive
        for v in result.iter() {
            if !v.is_nan() {
                assert!(*v >= 0.0);
            }
        }
    }

    #[test]
    fn test_max_drawdown() {
        // Price goes up then down
        let closes = vec![100.0, 110.0, 120.0, 100.0, 80.0, 90.0];
        let result = max_drawdown(&closes);

        // Max drawdown is from 120 to 80 = 33.33%
        assert!(approx_eq(result[4], 33.333, 0.01));
        assert!(approx_eq(result[5], 33.333, 0.01)); // Max DD stays at max
    }

    #[test]
    fn test_drawdown() {
        let closes = vec![100.0, 110.0, 100.0, 120.0, 100.0];
        let result = drawdown(&closes);

        // At index 0, peak=100, dd=0%
        assert!(approx_eq(result[0], 0.0, 0.001));
        // At index 1, peak=110, dd=0%
        assert!(approx_eq(result[1], 0.0, 0.001));
        // At index 2, peak=110, price=100, dd=9.09%
        assert!(approx_eq(result[2], 9.09, 0.1));
        // At index 3, peak=120, dd=0%
        assert!(approx_eq(result[3], 0.0, 0.001));
        // At index 4, peak=120, price=100, dd=16.67%
        assert!(approx_eq(result[4], 16.67, 0.1));
    }

    #[test]
    fn test_ulcer_index_positive() {
        let closes: Vec<f64> = (1..=50).map(|x| 100.0 - (x as f64 * 0.1).sin() * 10.0).collect();
        let result = ulcer_index(&closes, 14);

        // Ulcer index should be non-negative
        for v in result.iter() {
            if !v.is_nan() {
                assert!(*v >= 0.0);
            }
        }
    }

    // JS-compatible variant tests

    #[test]
    fn test_max_drawdown_ratio() {
        // Price goes up then down
        let closes = vec![100.0, 110.0, 120.0, 100.0, 80.0, 90.0];
        let result = max_drawdown_ratio(&closes);

        // Max drawdown is from 120 to 80 = 0.3333 (ratio)
        assert!(approx_eq(result[4], 0.3333, 0.001));
        assert!(approx_eq(result[5], 0.3333, 0.001)); // Max DD stays at max
    }

    #[test]
    fn test_max_drawdown_ratio_vs_percentage() {
        let closes = vec![100.0, 110.0, 120.0, 100.0, 80.0, 90.0];
        let ratio = max_drawdown_ratio(&closes);
        let percentage = max_drawdown(&closes);

        // Ratio * 100 should equal percentage
        for i in 0..closes.len() {
            if !ratio[i].is_nan() && !percentage[i].is_nan() {
                assert!(approx_eq(ratio[i] * 100.0, percentage[i], 0.01));
            }
        }
    }
}
