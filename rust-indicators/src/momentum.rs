//! Momentum indicators
//!
//! Indicators that measure the rate of change or strength of price movements.

use crate::common::{nan_vec, has_enough_data, mean, safe_div};
use crate::moving_averages::{ema, sma};

/// MACD - Moving Average Convergence Divergence
///
/// Returns (macd_line, signal_line, histogram)
///
/// Formula:
/// - MACD Line = EMA(fast) - EMA(slow)
/// - Signal Line = EMA(MACD Line, signal_period)
/// - Histogram = MACD Line - Signal Line
///
/// Note: Matches TA-Lib behavior where both EMAs start at the slow period index.
/// The fast EMA is seeded from the most recent `fast` values at that point.
pub fn macd(closes: &[f64], fast: usize, slow: usize, signal: usize) -> (Vec<f64>, Vec<f64>, Vec<f64>) {
    let n = closes.len();
    if fast >= slow || !has_enough_data(n, slow + signal) {
        return (nan_vec(n), nan_vec(n), nan_vec(n));
    }

    let slow_start = slow - 1;
    let fast_k = 2.0 / (fast as f64 + 1.0);
    let slow_k = 2.0 / (slow as f64 + 1.0);

    // Slow EMA: seeded from SMA of first `slow` values
    let slow_seed: f64 = closes[..slow].iter().sum::<f64>() / slow as f64;

    // Fast EMA: seeded from SMA of `fast` values ending at slow_start (TA-Lib behavior)
    let fast_seed: f64 = closes[(slow - fast)..slow].iter().sum::<f64>() / fast as f64;

    let mut fast_ema = nan_vec(n);
    let mut slow_ema = nan_vec(n);

    fast_ema[slow_start] = fast_seed;
    slow_ema[slow_start] = slow_seed;

    for i in slow..n {
        fast_ema[i] = (closes[i] - fast_ema[i - 1]) * fast_k + fast_ema[i - 1];
        slow_ema[i] = (closes[i] - slow_ema[i - 1]) * slow_k + slow_ema[i - 1];
    }

    // MACD Line = Fast EMA - Slow EMA
    let mut macd_line = nan_vec(n);
    for i in slow_start..n {
        macd_line[i] = fast_ema[i] - slow_ema[i];
    }

    // Signal Line = EMA of MACD Line
    let signal_k = 2.0 / (signal as f64 + 1.0);
    let signal_start = slow_start + signal - 1;

    let mut signal_line = nan_vec(n);
    if signal_start < n {
        // Seed signal from SMA of first `signal` MACD values
        let signal_seed: f64 = macd_line[slow_start..=signal_start].iter().sum::<f64>() / signal as f64;
        signal_line[signal_start] = signal_seed;

        for i in (signal_start + 1)..n {
            signal_line[i] = (macd_line[i] - signal_line[i - 1]) * signal_k + signal_line[i - 1];
        }
    }

    // Histogram = MACD Line - Signal Line
    let mut histogram = nan_vec(n);
    for i in 0..n {
        if !macd_line[i].is_nan() && !signal_line[i].is_nan() {
            histogram[i] = macd_line[i] - signal_line[i];
        }
    }

    (macd_line, signal_line, histogram)
}

/// PPO - Percentage Price Oscillator
///
/// Similar to MACD but expressed as percentage.
/// Uses standard EMA functions (each starts at its own period).
///
/// Formula: ((Fast EMA - Slow EMA) / Slow EMA) * 100
pub fn ppo(closes: &[f64], fast: usize, slow: usize) -> Vec<f64> {
    let n = closes.len();
    if fast >= slow || !has_enough_data(n, slow) {
        return nan_vec(n);
    }

    let fast_ema = ema(closes, fast);
    let slow_ema = ema(closes, slow);

    let mut result = nan_vec(n);
    for i in 0..n {
        if !fast_ema[i].is_nan() && !slow_ema[i].is_nan() && slow_ema[i] != 0.0 {
            result[i] = ((fast_ema[i] - slow_ema[i]) / slow_ema[i]) * 100.0;
        }
    }
    result
}

/// PPO with Histogram - Percentage Price Oscillator with signal line
///
/// Returns (ppo_line, signal_line, histogram)
///
/// Similar to MACD but expressed as percentage
pub fn ppo_histogram(closes: &[f64], fast: usize, slow: usize, signal: usize) -> (Vec<f64>, Vec<f64>, Vec<f64>) {
    let n = closes.len();
    if fast >= slow || !has_enough_data(n, slow + signal) {
        return (nan_vec(n), nan_vec(n), nan_vec(n));
    }

    // Calculate PPO line
    let ppo_line = ppo(closes, fast, slow);

    // Signal line = EMA of PPO line
    let signal_line = ema(&ppo_line, signal);

    // Histogram = PPO line - Signal line
    let mut histogram = nan_vec(n);
    for i in 0..n {
        if !ppo_line[i].is_nan() && !signal_line[i].is_nan() {
            histogram[i] = ppo_line[i] - signal_line[i];
        }
    }

    (ppo_line, signal_line, histogram)
}

/// ROC - Rate of Change
///
/// Formula: ((Close - Close[period]) / Close[period]) * 100
pub fn roc(closes: &[f64], period: usize) -> Vec<f64> {
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

/// Aroon Up
///
/// Measures periods since highest high within lookback
///
/// Formula: ((period - periods since highest high) / period) * 100
pub fn aroon_up(highs: &[f64], period: usize) -> Vec<f64> {
    let n = highs.len();
    if !has_enough_data(n, period + 1) {
        return nan_vec(n);
    }

    let mut result = nan_vec(n);
    for i in period..n {
        let window = &highs[(i - period)..=i];
        let max_idx = window
            .iter()
            .enumerate()
            .max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
            .map(|(idx, _)| idx)
            .unwrap_or(0);
        let periods_since = period - max_idx;
        result[i] = ((period - periods_since) as f64 / period as f64) * 100.0;
    }
    result
}

/// Aroon Down
///
/// Measures periods since lowest low within lookback
///
/// Formula: ((period - periods since lowest low) / period) * 100
pub fn aroon_down(lows: &[f64], period: usize) -> Vec<f64> {
    let n = lows.len();
    if !has_enough_data(n, period + 1) {
        return nan_vec(n);
    }

    let mut result = nan_vec(n);
    for i in period..n {
        let window = &lows[(i - period)..=i];
        let min_idx = window
            .iter()
            .enumerate()
            .min_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
            .map(|(idx, _)| idx)
            .unwrap_or(0);
        let periods_since = period - min_idx;
        result[i] = ((period - periods_since) as f64 / period as f64) * 100.0;
    }
    result
}

/// Aroon Oscillator
///
/// Formula: Aroon Up - Aroon Down
pub fn aroon_osc(highs: &[f64], lows: &[f64], period: usize) -> Vec<f64> {
    let up = aroon_up(highs, period);
    let down = aroon_down(lows, period);

    up.iter()
        .zip(down.iter())
        .map(|(u, d)| {
            if u.is_nan() || d.is_nan() {
                f64::NAN
            } else {
                u - d
            }
        })
        .collect()
}

/// ADX - Average Directional Index
///
/// Measures trend strength (not direction)
///
/// Components:
/// - +DM = Current High - Previous High (if positive and > -DM, else 0)
/// - -DM = Previous Low - Current Low (if positive and > +DM, else 0)
/// - TR = True Range
/// - +DI = 100 * Smoothed(+DM) / Smoothed(TR)
/// - -DI = 100 * Smoothed(-DM) / Smoothed(TR)
/// - DX = 100 * |+DI - -DI| / (+DI + -DI)
/// - ADX = Smoothed(DX)
pub fn adx(highs: &[f64], lows: &[f64], closes: &[f64], period: usize) -> Vec<f64> {
    let n = highs.len();
    if n != lows.len() || n != closes.len() || !has_enough_data(n, period * 2) {
        return nan_vec(n);
    }

    // Calculate +DM, -DM, and TR
    let mut plus_dm = vec![0.0; n];
    let mut minus_dm = vec![0.0; n];
    let mut tr = vec![0.0; n];

    for i in 1..n {
        let high_diff = highs[i] - highs[i - 1];
        let low_diff = lows[i - 1] - lows[i];

        if high_diff > 0.0 && high_diff > low_diff {
            plus_dm[i] = high_diff;
        }
        if low_diff > 0.0 && low_diff > high_diff {
            minus_dm[i] = low_diff;
        }

        // True Range
        let h_l = highs[i] - lows[i];
        let h_c = (highs[i] - closes[i - 1]).abs();
        let l_c = (lows[i] - closes[i - 1]).abs();
        tr[i] = h_l.max(h_c).max(l_c);
    }

    // Wilder's smoothing for +DM, -DM, TR
    let mut smoothed_plus_dm = nan_vec(n);
    let mut smoothed_minus_dm = nan_vec(n);
    let mut smoothed_tr = nan_vec(n);

    // Initial sum for period
    // TA-Lib applies one Wilder's smoothing step to the initial sum before output
    // This means: smoothed = sum - (sum / period) = sum * (period-1)/period
    let start = period;
    if start < n {
        let sum_plus: f64 = plus_dm[1..=start].iter().sum();
        let sum_minus: f64 = minus_dm[1..=start].iter().sum();
        let sum_tr: f64 = tr[1..=start].iter().sum();

        smoothed_plus_dm[start] = sum_plus - (sum_plus / period as f64);
        smoothed_minus_dm[start] = sum_minus - (sum_minus / period as f64);
        smoothed_tr[start] = sum_tr - (sum_tr / period as f64);
    }

    // Wilder's smoothing: smooth = prev - (prev / period) + current
    for i in (start + 1)..n {
        smoothed_plus_dm[i] = smoothed_plus_dm[i - 1] - (smoothed_plus_dm[i - 1] / period as f64) + plus_dm[i];
        smoothed_minus_dm[i] = smoothed_minus_dm[i - 1] - (smoothed_minus_dm[i - 1] / period as f64) + minus_dm[i];
        smoothed_tr[i] = smoothed_tr[i - 1] - (smoothed_tr[i - 1] / period as f64) + tr[i];
    }

    // Calculate +DI, -DI, DX
    let mut dx = nan_vec(n);
    for i in start..n {
        let plus_di = safe_div(smoothed_plus_dm[i], smoothed_tr[i]) * 100.0;
        let minus_di = safe_div(smoothed_minus_dm[i], smoothed_tr[i]) * 100.0;
        let di_sum = plus_di + minus_di;
        if di_sum != 0.0 {
            dx[i] = (plus_di - minus_di).abs() / di_sum * 100.0;
        }
    }

    // ADX = Wilder's MA of DX
    let mut result = nan_vec(n);
    let adx_start = start + period;
    if adx_start < n {
        // First ADX is average of first 'period' DX values
        let first_dx: Vec<f64> = dx[start..adx_start].iter().filter(|x| !x.is_nan()).cloned().collect();
        if !first_dx.is_empty() {
            result[adx_start - 1] = mean(&first_dx);
        }

        // Subsequent ADX values use Wilder's smoothing
        for i in adx_start..n {
            if !dx[i].is_nan() && !result[i - 1].is_nan() {
                result[i] = (result[i - 1] * (period - 1) as f64 + dx[i]) / period as f64;
            }
        }
    }

    result
}

/// 13612W Momentum
///
/// Weighted average of returns over different periods (1, 3, 6, 12 months)
/// Weights: 12 months = 25%, others = 25% each
///
/// Formula: (Return_1m * 0.25 + Return_3m * 0.25 + Return_6m * 0.25 + Return_12m * 0.25)
pub fn momentum_13612w(closes: &[f64]) -> Vec<f64> {
    let n = closes.len();
    // Need at least 252 trading days (12 months) of data
    if n < 252 {
        return nan_vec(n);
    }

    // Approximate trading days: 1m=21, 3m=63, 6m=126, 12m=252
    let periods = [21, 63, 126, 252];
    let weights = [0.25, 0.25, 0.25, 0.25];

    let mut result = nan_vec(n);
    for i in 251..n {
        let mut sum = 0.0;
        let mut valid = true;
        for (period, weight) in periods.iter().zip(weights.iter()) {
            if i >= *period {
                let ret = (closes[i] - closes[i - period]) / closes[i - period];
                sum += ret * weight;
            } else {
                valid = false;
                break;
            }
        }
        if valid {
            result[i] = sum * 100.0; // Express as percentage
        }
    }
    result
}

/// 13612U Momentum (Unweighted/Equal)
///
/// Equal-weighted average of returns over different periods
pub fn momentum_13612u(closes: &[f64]) -> Vec<f64> {
    // Same as 13612W but all weights are equal (which they already are)
    momentum_13612w(closes)
}

/// SMA 12-Month Momentum
///
/// Return of 12-month SMA
pub fn sma12_momentum(closes: &[f64], sma_period: usize) -> Vec<f64> {
    let sma_values = sma(closes, sma_period);
    let n = sma_values.len();

    // Calculate 12-month (252 day) return of the SMA
    let lookback = 252;
    let mut result = nan_vec(n);

    for i in lookback..n {
        if !sma_values[i].is_nan() && !sma_values[i - lookback].is_nan() {
            result[i] = safe_div(sma_values[i] - sma_values[i - lookback], sma_values[i - lookback]) * 100.0;
        }
    }
    result
}

/// Linear Regression Slope
///
/// Calculates the slope of linear regression line over the lookback period
pub fn linreg_slope(values: &[f64], period: usize) -> Vec<f64> {
    let n = values.len();
    if !has_enough_data(n, period) {
        return nan_vec(n);
    }

    let mut result = nan_vec(n);
    let period_f = period as f64;

    // Pre-calculate sum of x and sum of x^2 for the period
    // x = 0, 1, 2, ..., period-1
    let sum_x: f64 = (0..period).map(|x| x as f64).sum();
    let sum_x2: f64 = (0..period).map(|x| (x * x) as f64).sum();

    for i in (period - 1)..n {
        let window = &values[(i + 1 - period)..=i];

        // Sum of y values
        let sum_y: f64 = window.iter().sum();

        // Sum of x*y
        let sum_xy: f64 = window.iter().enumerate().map(|(x, y)| x as f64 * y).sum();

        // Slope = (n * sum_xy - sum_x * sum_y) / (n * sum_x2 - sum_x^2)
        let numerator = period_f * sum_xy - sum_x * sum_y;
        let denominator = period_f * sum_x2 - sum_x * sum_x;

        result[i] = safe_div(numerator, denominator);
    }
    result
}

/// Linear Regression Value (End Point)
///
/// Returns the y-value at the end of the linear regression line
pub fn linreg_value(values: &[f64], period: usize) -> Vec<f64> {
    let n = values.len();
    if !has_enough_data(n, period) {
        return nan_vec(n);
    }

    let slope = linreg_slope(values, period);
    let mut result = nan_vec(n);
    let period_f = period as f64;

    // Pre-calculate mean of x
    let mean_x = (period - 1) as f64 / 2.0;

    for i in (period - 1)..n {
        if slope[i].is_nan() {
            continue;
        }

        let window = &values[(i + 1 - period)..=i];
        let mean_y: f64 = window.iter().sum::<f64>() / period_f;

        // Intercept = mean_y - slope * mean_x
        let intercept = mean_y - slope[i] * mean_x;

        // Value at end of line (x = period - 1)
        result[i] = intercept + slope[i] * (period - 1) as f64;
    }
    result
}

// ============================================
// JS-COMPATIBLE VARIANTS
// These match backtest.mjs formulas exactly
// ============================================

/// Linear Regression Slope (JS-compatible)
///
/// Returns the slope normalized as a percentage of the average price.
/// Matches backtest.mjs `rollingLinRegSlope` exactly.
///
/// Formula: (slope / avgPrice) * 100
///
/// This makes the slope comparable across different price levels.
///
/// Note: Standard `linreg_slope` returns the raw absolute slope.
pub fn linreg_slope_js(values: &[f64], period: usize) -> Vec<f64> {
    let n = values.len();
    if !has_enough_data(n, period) {
        return nan_vec(n);
    }

    let slope = linreg_slope(values, period);
    let mut result = nan_vec(n);

    for i in (period - 1)..n {
        if slope[i].is_nan() {
            continue;
        }

        let window = &values[(i + 1 - period)..=i];
        let avg_price: f64 = window.iter().sum::<f64>() / period as f64;

        if avg_price != 0.0 {
            result[i] = (slope[i] / avg_price) * 100.0;
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
    fn test_macd_basic() {
        let prices: Vec<f64> = (1..=50).map(|x| 100.0 + x as f64).collect();
        let (macd_line, signal, histogram) = macd(&prices, 12, 26, 9);

        assert_eq!(macd_line.len(), 50);
        // MACD should be positive when prices are rising
        assert!(macd_line[49] > 0.0);
    }

    #[test]
    fn test_ppo_basic() {
        let prices: Vec<f64> = (1..=50).map(|x| 100.0 + x as f64).collect();
        let result = ppo(&prices, 12, 26);

        assert_eq!(result.len(), 50);
        // PPO should be positive when prices are rising
        assert!(result[49] > 0.0);
    }

    #[test]
    fn test_roc_basic() {
        let prices = vec![100.0, 110.0, 121.0, 133.1, 146.41];
        let result = roc(&prices, 1);

        // 10% gain each period
        assert!(approx_eq(result[1], 10.0, 0.01));
        assert!(approx_eq(result[2], 10.0, 0.01));
    }

    #[test]
    fn test_aroon_uptrend() {
        // Steadily increasing prices
        let highs: Vec<f64> = (1..=30).map(|x| x as f64).collect();
        let lows: Vec<f64> = (1..=30).map(|x| x as f64 - 0.5).collect();

        let up = aroon_up(&highs, 14);
        let down = aroon_down(&lows, 14);

        // In uptrend, Aroon Up should be 100 (highest high is current bar)
        assert!(approx_eq(up[29], 100.0, 0.01));
    }

    #[test]
    fn test_aroon_osc_range() {
        let highs: Vec<f64> = (1..=30).map(|x| 50.0 + (x as f64).sin() * 10.0).collect();
        let lows: Vec<f64> = (1..=30).map(|x| 40.0 + (x as f64).sin() * 10.0).collect();

        let osc = aroon_osc(&highs, &lows, 14);

        // Aroon Oscillator should be between -100 and 100
        for v in osc.iter() {
            if !v.is_nan() {
                assert!(*v >= -100.0 && *v <= 100.0);
            }
        }
    }

    #[test]
    fn test_adx_range() {
        let highs: Vec<f64> = (1..=50).map(|x| 50.0 + (x as f64 * 0.1).sin() * 10.0).collect();
        let lows: Vec<f64> = (1..=50).map(|x| 40.0 + (x as f64 * 0.1).sin() * 10.0).collect();
        let closes: Vec<f64> = (1..=50).map(|x| 45.0 + (x as f64 * 0.1).sin() * 10.0).collect();

        let result = adx(&highs, &lows, &closes, 14);

        // ADX should be between 0 and 100
        for v in result.iter() {
            if !v.is_nan() {
                assert!(*v >= 0.0 && *v <= 100.0, "ADX value {} out of range", v);
            }
        }
    }

    #[test]
    fn test_linreg_slope_positive() {
        // Linear upward trend: y = x
        let values: Vec<f64> = (0..20).map(|x| x as f64).collect();
        let result = linreg_slope(&values, 5);

        // Slope should be 1.0 for y = x
        assert!(approx_eq(result[19], 1.0, 0.001));
    }

    #[test]
    fn test_linreg_slope_negative() {
        // Linear downward trend: y = -x
        let values: Vec<f64> = (0..20).map(|x| -(x as f64)).collect();
        let result = linreg_slope(&values, 5);

        // Slope should be -1.0
        assert!(approx_eq(result[19], -1.0, 0.001));
    }

    #[test]
    fn test_linreg_value() {
        // Linear upward trend: y = x + 10
        let values: Vec<f64> = (0..20).map(|x| x as f64 + 10.0).collect();
        let result = linreg_value(&values, 5);

        // Value at end should match actual value for perfect linear data
        assert!(approx_eq(result[19], 29.0, 0.001));
    }

    // JS-compatible variant tests

    #[test]
    fn test_linreg_slope_js() {
        // Linear upward trend: values from 100 to 104 (slope = 1)
        // Average price = 102, so JS slope = (1 / 102) * 100 ≈ 0.98%
        let values: Vec<f64> = (0..5).map(|x| 100.0 + x as f64).collect();
        let result = linreg_slope_js(&values, 5);

        // Slope is 1.0, avg price is 102, so JS slope = 1/102 * 100 ≈ 0.98
        assert!(approx_eq(result[4], 0.98039, 0.001));
    }

    #[test]
    fn test_linreg_slope_js_vs_standard() {
        // Verify JS version is normalized by price
        let values: Vec<f64> = (0..10).map(|x| 100.0 + x as f64).collect();

        let raw_slope = linreg_slope(&values, 5);
        let js_slope = linreg_slope_js(&values, 5);

        // Raw slope should be 1.0
        assert!(approx_eq(raw_slope[9], 1.0, 0.001));

        // JS slope should be slope/avg * 100
        // Last window: [105, 106, 107, 108, 109], avg = 107, slope = 1
        // JS slope = (1 / 107) * 100 ≈ 0.935
        assert!(approx_eq(js_slope[9], 0.9346, 0.001));
    }
}
