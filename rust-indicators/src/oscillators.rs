//! Oscillator Indicators
//!
//! This module provides oscillator calculations:
//! - RSI: Relative Strength Index (multiple variants)
//! - Stochastic: %K and %D
//! - CCI: Commodity Channel Index
//! - Williams %R
//! - MFI: Money Flow Index

use crate::common::{has_enough_data, nan_vec, diff, gains_losses, mean, max, min};
use crate::moving_averages::{sma, ema};

/// Relative Strength Index (Wilder's RSI)
///
/// Measures momentum by comparing magnitude of recent gains vs losses.
///
/// # Formula
/// RS = Average Gain / Average Loss (using Wilder's smoothing)
/// RSI = 100 - (100 / (1 + RS))
///
/// # Arguments
/// * `closes` - Closing prices
/// * `period` - Lookback period (typically 14)
///
/// # Returns
/// RSI values between 0 and 100
pub fn rsi(closes: &[f64], period: usize) -> Vec<f64> {
    let n = closes.len();
    if n < period + 1 {
        return nan_vec(n);
    }

    let mut result = nan_vec(n);

    // Calculate price changes
    let changes = diff(closes);
    let (gains, losses) = gains_losses(&changes);

    // First average using SMA
    let first_avg_gain: f64 = gains[..period].iter().sum::<f64>() / period as f64;
    let first_avg_loss: f64 = losses[..period].iter().sum::<f64>() / period as f64;

    let mut avg_gain = first_avg_gain;
    let mut avg_loss = first_avg_loss;

    // First RSI
    if avg_loss != 0.0 {
        result[period] = 100.0 - (100.0 / (1.0 + avg_gain / avg_loss));
    } else if avg_gain != 0.0 {
        result[period] = 100.0;
    } else {
        result[period] = 50.0; // No movement
    }

    // Subsequent RSI using Wilder's smoothing
    for i in period..changes.len() {
        avg_gain = (avg_gain * (period - 1) as f64 + gains[i]) / period as f64;
        avg_loss = (avg_loss * (period - 1) as f64 + losses[i]) / period as f64;

        if avg_loss != 0.0 {
            result[i + 1] = 100.0 - (100.0 / (1.0 + avg_gain / avg_loss));
        } else if avg_gain != 0.0 {
            result[i + 1] = 100.0;
        } else {
            result[i + 1] = 50.0;
        }
    }

    result
}

/// RSI with SMA smoothing instead of Wilder's
pub fn rsi_sma(closes: &[f64], period: usize) -> Vec<f64> {
    let n = closes.len();
    if n < period + 1 {
        return nan_vec(n);
    }

    let changes = diff(closes);
    let (gains, losses) = gains_losses(&changes);

    let avg_gains = sma(&gains, period);
    let avg_losses = sma(&losses, period);

    let mut result = nan_vec(n);
    for i in period..n {
        let ag = avg_gains[i - 1];
        let al = avg_losses[i - 1];
        if al != 0.0 && !ag.is_nan() && !al.is_nan() {
            result[i] = 100.0 - (100.0 / (1.0 + ag / al));
        } else if ag > 0.0 {
            result[i] = 100.0;
        } else {
            result[i] = 50.0;
        }
    }

    result
}

/// RSI with EMA smoothing
pub fn rsi_ema(closes: &[f64], period: usize) -> Vec<f64> {
    let n = closes.len();
    if n < period + 1 {
        return nan_vec(n);
    }

    let changes = diff(closes);
    let (gains, losses) = gains_losses(&changes);

    let avg_gains = ema(&gains, period);
    let avg_losses = ema(&losses, period);

    let mut result = nan_vec(n);
    for i in period..n {
        let ag = avg_gains[i - 1];
        let al = avg_losses[i - 1];
        if al != 0.0 && !ag.is_nan() && !al.is_nan() {
            result[i] = 100.0 - (100.0 / (1.0 + ag / al));
        } else if ag > 0.0 {
            result[i] = 100.0;
        } else {
            result[i] = 50.0;
        }
    }

    result
}

/// Stochastic RSI
///
/// Applies stochastic formula to RSI values.
///
/// # Formula
/// StochRSI = (RSI - Lowest RSI) / (Highest RSI - Lowest RSI)
pub fn stoch_rsi(closes: &[f64], rsi_period: usize, stoch_period: usize) -> Vec<f64> {
    let n = closes.len();
    let rsi_values = rsi(closes, rsi_period);

    let mut result = nan_vec(n);
    let start = rsi_period + stoch_period;

    if n < start {
        return result;
    }

    for i in start..n {
        let window = &rsi_values[(i + 1 - stoch_period)..=i];

        // Skip if any NaN in window
        if window.iter().any(|x| x.is_nan()) {
            continue;
        }

        let min_rsi = min(window);
        let max_rsi = max(window);

        if max_rsi != min_rsi {
            result[i] = (rsi_values[i] - min_rsi) / (max_rsi - min_rsi) * 100.0;
        } else {
            result[i] = 50.0;
        }
    }

    result
}

/// Laguerre RSI
///
/// John Ehlers' Laguerre filter applied to RSI calculation.
/// Produces smoother RSI with less lag.
///
/// # Arguments
/// * `closes` - Closing prices
/// * `gamma` - Damping factor (0-1, typically 0.8)
pub fn laguerre_rsi(closes: &[f64], gamma: f64) -> Vec<f64> {
    let n = closes.len();
    let mut result = vec![f64::NAN; n];

    if n == 0 {
        return result;
    }

    let mut l0 = 0.0;
    let mut l1 = 0.0;
    let mut l2 = 0.0;
    let mut l3 = 0.0;

    for i in 0..n {
        let l0_prev = l0;
        let l1_prev = l1;
        let l2_prev = l2;

        l0 = (1.0 - gamma) * closes[i] + gamma * l0_prev;
        l1 = -gamma * l0 + l0_prev + gamma * l1_prev;
        l2 = -gamma * l1 + l1_prev + gamma * l2_prev;
        l3 = -gamma * l2 + l2_prev + gamma * l3;

        let cu = (l0 - l1).max(0.0) + (l1 - l2).max(0.0) + (l2 - l3).max(0.0);
        let cd = (l1 - l0).max(0.0) + (l2 - l1).max(0.0) + (l3 - l2).max(0.0);

        if cu + cd != 0.0 {
            result[i] = 100.0 * cu / (cu + cd);
        } else {
            result[i] = 50.0;
        }
    }

    result
}

/// Stochastic %K
///
/// Shows where price closed relative to high-low range.
///
/// # Formula
/// %K = (Close - Lowest Low) / (Highest High - Lowest Low) × 100
pub fn stoch_k(highs: &[f64], lows: &[f64], closes: &[f64], period: usize) -> Vec<f64> {
    let n = closes.len();
    if !has_enough_data(n, period) || highs.len() != n || lows.len() != n {
        return nan_vec(n);
    }

    let mut result = nan_vec(n);

    for i in (period - 1)..n {
        let high_window = &highs[(i + 1 - period)..=i];
        let low_window = &lows[(i + 1 - period)..=i];

        let highest = max(high_window);
        let lowest = min(low_window);

        if highest != lowest {
            result[i] = (closes[i] - lowest) / (highest - lowest) * 100.0;
        } else {
            result[i] = 50.0;
        }
    }

    result
}

/// Stochastic %D
///
/// Simple moving average of %K.
///
/// # Arguments
/// * `k_period` - Period for %K calculation
/// * `d_period` - Smoothing period for %D (typically 3)
pub fn stoch_d(highs: &[f64], lows: &[f64], closes: &[f64], k_period: usize, d_period: usize) -> Vec<f64> {
    let k = stoch_k(highs, lows, closes, k_period);
    sma(&k, d_period)
}

/// Williams %R
///
/// Similar to Stochastic but inverted (0 to -100 range).
///
/// # Formula
/// %R = (Highest High - Close) / (Highest High - Lowest Low) × -100
pub fn williams_r(highs: &[f64], lows: &[f64], closes: &[f64], period: usize) -> Vec<f64> {
    let n = closes.len();
    if !has_enough_data(n, period) || highs.len() != n || lows.len() != n {
        return nan_vec(n);
    }

    let mut result = nan_vec(n);

    for i in (period - 1)..n {
        let high_window = &highs[(i + 1 - period)..=i];
        let low_window = &lows[(i + 1 - period)..=i];

        let highest = max(high_window);
        let lowest = min(low_window);

        if highest != lowest {
            result[i] = (highest - closes[i]) / (highest - lowest) * -100.0;
        } else {
            result[i] = -50.0;
        }
    }

    result
}

/// Commodity Channel Index (CCI)
///
/// Measures price deviation from average.
///
/// # Formula
/// TP = (High + Low + Close) / 3
/// CCI = (TP - SMA(TP)) / (0.015 × Mean Deviation)
pub fn cci(highs: &[f64], lows: &[f64], closes: &[f64], period: usize) -> Vec<f64> {
    let n = closes.len();
    if !has_enough_data(n, period) || highs.len() != n || lows.len() != n {
        return nan_vec(n);
    }

    // Calculate typical price
    let tp: Vec<f64> = (0..n)
        .map(|i| (highs[i] + lows[i] + closes[i]) / 3.0)
        .collect();

    let mut result = nan_vec(n);

    for i in (period - 1)..n {
        let window = &tp[(i + 1 - period)..=i];
        let tp_mean = mean(window);

        // Mean deviation
        let mean_dev = window.iter().map(|&x| (x - tp_mean).abs()).sum::<f64>() / period as f64;

        if mean_dev != 0.0 {
            result[i] = (tp[i] - tp_mean) / (0.015 * mean_dev);
        } else {
            result[i] = 0.0;
        }
    }

    result
}

/// Money Flow Index (MFI)
///
/// Volume-weighted RSI.
///
/// # Formula
/// Typical Price = (High + Low + Close) / 3
/// Raw Money Flow = Typical Price × Volume
/// MFI = 100 - (100 / (1 + Money Flow Ratio))
pub fn mfi(highs: &[f64], lows: &[f64], closes: &[f64], volumes: &[f64], period: usize) -> Vec<f64> {
    let n = closes.len();
    if n < period + 1 || highs.len() != n || lows.len() != n || volumes.len() != n {
        return nan_vec(n);
    }

    // Calculate typical price
    let tp: Vec<f64> = (0..n)
        .map(|i| (highs[i] + lows[i] + closes[i]) / 3.0)
        .collect();

    // Calculate raw money flow
    let rmf: Vec<f64> = (0..n).map(|i| tp[i] * volumes[i]).collect();

    let mut result = nan_vec(n);

    for i in period..n {
        let mut pos_flow = 0.0;
        let mut neg_flow = 0.0;

        for j in (i + 1 - period)..=i {
            if j > 0 {
                if tp[j] > tp[j - 1] {
                    pos_flow += rmf[j];
                } else if tp[j] < tp[j - 1] {
                    neg_flow += rmf[j];
                }
            }
        }

        if neg_flow != 0.0 {
            let mf_ratio = pos_flow / neg_flow;
            result[i] = 100.0 - (100.0 / (1.0 + mf_ratio));
        } else if pos_flow > 0.0 {
            result[i] = 100.0;
        } else {
            result[i] = 50.0;
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    const EPSILON: f64 = 0.01;

    fn assert_approx_eq(a: f64, b: f64) {
        if a.is_nan() && b.is_nan() {
            return;
        }
        assert!(
            (a - b).abs() < EPSILON,
            "Values differ: {} vs {}",
            a,
            b
        );
    }

    #[test]
    fn test_rsi_basic() {
        let closes = vec![
            44.0, 44.34, 44.09, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08,
            45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64,
        ];
        let result = rsi(&closes, 14);

        // First 14 values should be NaN
        for i in 0..14 {
            assert!(result[i].is_nan());
        }

        // RSI should be between 0 and 100
        for i in 14..result.len() {
            assert!(result[i] >= 0.0 && result[i] <= 100.0);
        }
    }

    #[test]
    fn test_rsi_all_gains() {
        let closes: Vec<f64> = (1..=20).map(|x| x as f64).collect();
        let result = rsi(&closes, 14);
        // All gains should give RSI near 100
        assert!(result[19] > 95.0);
    }

    #[test]
    fn test_rsi_all_losses() {
        let closes: Vec<f64> = (1..=20).rev().map(|x| x as f64).collect();
        let result = rsi(&closes, 14);
        // All losses should give RSI near 0
        assert!(result[19] < 5.0);
    }

    #[test]
    fn test_laguerre_rsi_range() {
        let closes: Vec<f64> = (1..=100).map(|x| (x as f64).sin() * 10.0 + 50.0).collect();
        let result = laguerre_rsi(&closes, 0.8);

        for val in result.iter() {
            if !val.is_nan() {
                assert!(*val >= 0.0 && *val <= 100.0);
            }
        }
    }

    #[test]
    fn test_stoch_k_range() {
        let highs = vec![10.0, 11.0, 12.0, 11.5, 13.0, 12.5, 14.0, 13.5, 15.0, 14.5];
        let lows = vec![8.0, 9.0, 10.0, 9.5, 11.0, 10.5, 12.0, 11.5, 13.0, 12.5];
        let closes = vec![9.0, 10.0, 11.0, 10.5, 12.0, 11.5, 13.0, 12.5, 14.0, 13.5];

        let result = stoch_k(&highs, &lows, &closes, 5);

        for val in result.iter().skip(4) {
            assert!(*val >= 0.0 && *val <= 100.0);
        }
    }

    #[test]
    fn test_williams_r_range() {
        let highs = vec![10.0, 11.0, 12.0, 11.5, 13.0, 12.5, 14.0, 13.5, 15.0, 14.5];
        let lows = vec![8.0, 9.0, 10.0, 9.5, 11.0, 10.5, 12.0, 11.5, 13.0, 12.5];
        let closes = vec![9.0, 10.0, 11.0, 10.5, 12.0, 11.5, 13.0, 12.5, 14.0, 13.5];

        let result = williams_r(&highs, &lows, &closes, 5);

        for val in result.iter().skip(4) {
            assert!(*val >= -100.0 && *val <= 0.0);
        }
    }

    #[test]
    fn test_cci_basic() {
        let highs = vec![25.0, 26.0, 27.0, 26.5, 28.0, 27.5, 29.0, 28.5, 30.0, 29.5];
        let lows = vec![23.0, 24.0, 25.0, 24.5, 26.0, 25.5, 27.0, 26.5, 28.0, 27.5];
        let closes = vec![24.0, 25.0, 26.0, 25.5, 27.0, 26.5, 28.0, 27.5, 29.0, 28.5];

        let result = cci(&highs, &lows, &closes, 5);

        // CCI should have values after period
        assert!(result[4].is_finite());
    }

    #[test]
    fn test_mfi_range() {
        let highs = vec![25.0, 26.0, 27.0, 26.5, 28.0, 27.5, 29.0, 28.5, 30.0, 29.5];
        let lows = vec![23.0, 24.0, 25.0, 24.5, 26.0, 25.5, 27.0, 26.5, 28.0, 27.5];
        let closes = vec![24.0, 25.0, 26.0, 25.5, 27.0, 26.5, 28.0, 27.5, 29.0, 28.5];
        let volumes = vec![1000.0; 10];

        let result = mfi(&highs, &lows, &closes, &volumes, 5);

        for val in result.iter().skip(5) {
            if !val.is_nan() {
                assert!(*val >= 0.0 && *val <= 100.0);
            }
        }
    }
}
