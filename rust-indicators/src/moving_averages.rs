//! Moving Average Indicators
//!
//! This module provides various moving average calculations:
//! - SMA: Simple Moving Average
//! - EMA: Exponential Moving Average
//! - WMA: Weighted Moving Average
//! - DEMA: Double Exponential Moving Average
//! - TEMA: Triple Exponential Moving Average
//! - HMA: Hull Moving Average
//! - KAMA: Kaufman Adaptive Moving Average
//! - Wilder's MA: Wilder's Smoothing (used in RSI, ATR)

use crate::common::{has_enough_data, nan_vec};

/// Simple Moving Average (SMA)
///
/// The arithmetic mean of the last `period` values.
///
/// # Formula
/// SMA = (P1 + P2 + ... + Pn) / n
///
/// # Arguments
/// * `values` - Price or indicator values
/// * `period` - Number of periods to average
///
/// # Returns
/// Vector of same length as input, with NaN for first `period - 1` values
///
/// # Example
/// ```
/// use flowchart_indicators::sma;
/// let prices = vec![2.0, 4.0, 6.0, 8.0, 10.0];
/// let result = sma(&prices, 3);
/// assert_eq!(result[2], 4.0);  // (2+4+6)/3
/// assert_eq!(result[4], 8.0);  // (6+8+10)/3
/// ```
pub fn sma(values: &[f64], period: usize) -> Vec<f64> {
    let n = values.len();
    if !has_enough_data(n, period) {
        return nan_vec(n);
    }

    let mut result = nan_vec(n);

    // Calculate first SMA
    let mut sum: f64 = values[..period].iter().sum();
    result[period - 1] = sum / period as f64;

    // Rolling calculation - add new, subtract old
    for i in period..n {
        sum = sum + values[i] - values[i - period];
        result[i] = sum / period as f64;
    }

    result
}

/// Exponential Moving Average (EMA)
///
/// Gives more weight to recent prices using exponential decay.
///
/// # Formula
/// Multiplier = 2 / (period + 1)
/// EMA = (Price - Previous EMA) × Multiplier + Previous EMA
///
/// # Arguments
/// * `values` - Price or indicator values
/// * `period` - Number of periods (determines smoothing factor)
///
/// # Returns
/// Vector of same length as input, with NaN for first `period - 1` values
pub fn ema(values: &[f64], period: usize) -> Vec<f64> {
    let n = values.len();
    if !has_enough_data(n, period) {
        return nan_vec(n);
    }

    let mut result = nan_vec(n);
    let multiplier = 2.0 / (period as f64 + 1.0);

    // Find the first valid (non-NaN) starting point
    let mut first_valid = 0;
    while first_valid < n && values[first_valid].is_nan() {
        first_valid += 1;
    }

    // Check if we have enough valid data
    if first_valid + period > n {
        return result;
    }

    // First EMA is SMA of first `period` valid values
    let first_sma: f64 = values[first_valid..(first_valid + period)].iter().sum::<f64>() / period as f64;
    let start_idx = first_valid + period - 1;
    result[start_idx] = first_sma;

    // Calculate subsequent EMAs
    for i in (start_idx + 1)..n {
        if values[i].is_nan() {
            continue; // Skip NaN input values
        }
        if result[i - 1].is_nan() {
            result[i] = values[i]; // Re-seed if previous result was NaN
        } else {
            result[i] = (values[i] - result[i - 1]) * multiplier + result[i - 1];
        }
    }

    result
}

/// Weighted Moving Average (WMA)
///
/// Linear weighted average giving more weight to recent prices.
///
/// # Formula
/// WMA = (P1×1 + P2×2 + ... + Pn×n) / (1 + 2 + ... + n)
///
/// # Arguments
/// * `values` - Price or indicator values
/// * `period` - Number of periods
pub fn wma(values: &[f64], period: usize) -> Vec<f64> {
    let n = values.len();
    if !has_enough_data(n, period) {
        return nan_vec(n);
    }

    let mut result = nan_vec(n);
    let weight_sum: f64 = (1..=period).map(|x| x as f64).sum();

    for i in (period - 1)..n {
        let weighted_sum: f64 = values[(i + 1 - period)..=i]
            .iter()
            .enumerate()
            .map(|(j, &v)| v * (j + 1) as f64)
            .sum();
        result[i] = weighted_sum / weight_sum;
    }

    result
}

/// Double Exponential Moving Average (DEMA)
///
/// Reduces lag by applying EMA twice and compensating.
///
/// # Formula
/// DEMA = 2 × EMA(price) - EMA(EMA(price))
///
/// # Arguments
/// * `values` - Price or indicator values
/// * `period` - Number of periods
pub fn dema(values: &[f64], period: usize) -> Vec<f64> {
    let ema1 = ema(values, period);
    let ema2 = ema(&ema1, period);

    ema1.iter()
        .zip(ema2.iter())
        .map(|(&e1, &e2)| {
            if e1.is_nan() || e2.is_nan() {
                f64::NAN
            } else {
                2.0 * e1 - e2
            }
        })
        .collect()
}

/// Triple Exponential Moving Average (TEMA)
///
/// Further reduces lag by applying EMA three times.
///
/// # Formula
/// TEMA = 3 × EMA1 - 3 × EMA2 + EMA3
/// where EMA1 = EMA(price), EMA2 = EMA(EMA1), EMA3 = EMA(EMA2)
///
/// # Arguments
/// * `values` - Price or indicator values
/// * `period` - Number of periods
pub fn tema(values: &[f64], period: usize) -> Vec<f64> {
    let ema1 = ema(values, period);
    let ema2 = ema(&ema1, period);
    let ema3 = ema(&ema2, period);

    ema1.iter()
        .zip(ema2.iter())
        .zip(ema3.iter())
        .map(|((&e1, &e2), &e3)| {
            if e1.is_nan() || e2.is_nan() || e3.is_nan() {
                f64::NAN
            } else {
                3.0 * e1 - 3.0 * e2 + e3
            }
        })
        .collect()
}

/// Hull Moving Average (HMA)
///
/// A fast, smooth moving average that reduces lag.
///
/// # Formula
/// HMA = WMA(2 × WMA(n/2) - WMA(n), sqrt(n))
///
/// # Arguments
/// * `values` - Price or indicator values
/// * `period` - Number of periods
pub fn hma(values: &[f64], period: usize) -> Vec<f64> {
    let n = values.len();
    if period < 2 || n < period {
        return nan_vec(n);
    }

    let half_period = period / 2;
    let sqrt_period = (period as f64).sqrt() as usize;

    let wma_half = wma(values, half_period.max(1));
    let wma_full = wma(values, period);

    // 2 × WMA(n/2) - WMA(n)
    let diff: Vec<f64> = wma_half
        .iter()
        .zip(wma_full.iter())
        .map(|(&h, &f)| {
            if h.is_nan() || f.is_nan() {
                f64::NAN
            } else {
                2.0 * h - f
            }
        })
        .collect();

    wma(&diff, sqrt_period.max(1))
}

/// Kaufman Adaptive Moving Average (KAMA)
///
/// Adapts smoothing based on market volatility/efficiency.
///
/// # Formula
/// ER = Change / Volatility (Efficiency Ratio)
/// SC = [ER × (fast_sc - slow_sc) + slow_sc]²
/// KAMA = Previous KAMA + SC × (Price - Previous KAMA)
///
/// # Arguments
/// * `values` - Price or indicator values
/// * `period` - Efficiency ratio period
/// * `fast` - Fast EMA period (default: 2)
/// * `slow` - Slow EMA period (default: 30)
pub fn kama(values: &[f64], period: usize, fast: usize, slow: usize) -> Vec<f64> {
    let n = values.len();
    if !has_enough_data(n, period) {
        return nan_vec(n);
    }

    let mut result = nan_vec(n);
    let fast_sc = 2.0 / (fast as f64 + 1.0);
    let slow_sc = 2.0 / (slow as f64 + 1.0);

    // First KAMA is just the price
    result[period - 1] = values[period - 1];

    for i in period..n {
        // Efficiency Ratio: absolute change vs sum of absolute changes
        let change = (values[i] - values[i - period]).abs();
        let volatility: f64 = (1..=period)
            .map(|j| (values[i - j + 1] - values[i - j]).abs())
            .sum();

        let er = if volatility != 0.0 {
            change / volatility
        } else {
            0.0
        };

        // Smoothing constant
        let sc = (er * (fast_sc - slow_sc) + slow_sc).powi(2);

        // KAMA calculation
        result[i] = result[i - 1] + sc * (values[i] - result[i - 1]);
    }

    result
}

/// Wilder's Smoothing Moving Average
///
/// Used internally by RSI, ATR, and other Wilder indicators.
/// Equivalent to EMA with period = 2n - 1.
///
/// # Formula
/// Wilder MA = Previous MA + (Price - Previous MA) / period
///
/// # Arguments
/// * `values` - Price or indicator values
/// * `period` - Number of periods
pub fn wilders_ma(values: &[f64], period: usize) -> Vec<f64> {
    let n = values.len();
    if !has_enough_data(n, period) {
        return nan_vec(n);
    }

    let mut result = nan_vec(n);

    // Find first valid (non-NaN) starting point
    let mut first_valid = 0;
    while first_valid < n && values[first_valid].is_nan() {
        first_valid += 1;
    }

    // Check if we have enough valid data
    if first_valid + period > n {
        return result;
    }

    // First value is SMA of first `period` valid values
    let first_sma: f64 = values[first_valid..(first_valid + period)].iter().sum::<f64>() / period as f64;
    let start_idx = first_valid + period - 1;
    result[start_idx] = first_sma;

    // Wilder's smoothing
    let alpha = 1.0 / period as f64;
    for i in (start_idx + 1)..n {
        if values[i].is_nan() {
            continue;
        }
        if result[i - 1].is_nan() {
            result[i] = values[i];
        } else {
            result[i] = result[i - 1] + alpha * (values[i] - result[i - 1]);
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    const EPSILON: f64 = 1e-10;

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

    // ===== SMA Tests =====

    #[test]
    fn test_sma_basic() {
        let prices = vec![2.0, 4.0, 6.0, 8.0, 10.0];
        let result = sma(&prices, 3);

        assert!(result[0].is_nan());
        assert!(result[1].is_nan());
        assert_approx_eq(result[2], 4.0); // (2+4+6)/3
        assert_approx_eq(result[3], 6.0); // (4+6+8)/3
        assert_approx_eq(result[4], 8.0); // (6+8+10)/3
    }

    #[test]
    fn test_sma_empty() {
        let result = sma(&[], 3);
        assert!(result.is_empty());
    }

    #[test]
    fn test_sma_period_exceeds_length() {
        let prices = vec![1.0, 2.0, 3.0];
        let result = sma(&prices, 10);
        assert!(result.iter().all(|x| x.is_nan()));
    }

    #[test]
    fn test_sma_period_one() {
        let prices = vec![1.0, 2.0, 3.0];
        let result = sma(&prices, 1);
        assert_approx_eq(result[0], 1.0);
        assert_approx_eq(result[1], 2.0);
        assert_approx_eq(result[2], 3.0);
    }

    // ===== EMA Tests =====

    #[test]
    fn test_ema_basic() {
        let prices = vec![22.27, 22.19, 22.08, 22.17, 22.18, 22.13, 22.23, 22.43, 22.24, 22.29];
        let result = ema(&prices, 10);

        // First 9 should be NaN
        for i in 0..9 {
            assert!(result[i].is_nan());
        }
        // 10th value should be SMA of first 10
        let expected_first: f64 = prices[..10].iter().sum::<f64>() / 10.0;
        assert_approx_eq(result[9], expected_first);
    }

    #[test]
    fn test_ema_multiplier() {
        // EMA with period 3: multiplier = 2/(3+1) = 0.5
        let prices = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let result = ema(&prices, 3);

        // First EMA = SMA of [1,2,3] = 2.0
        assert_approx_eq(result[2], 2.0);
        // Next EMA = (4 - 2) * 0.5 + 2 = 3.0
        assert_approx_eq(result[3], 3.0);
        // Next EMA = (5 - 3) * 0.5 + 3 = 4.0
        assert_approx_eq(result[4], 4.0);
    }

    // ===== WMA Tests =====

    #[test]
    fn test_wma_basic() {
        let prices = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let result = wma(&prices, 3);

        // WMA(3) at index 2: (1*1 + 2*2 + 3*3) / (1+2+3) = 14/6 = 2.333...
        assert_approx_eq(result[2], 14.0 / 6.0);
        // WMA(3) at index 3: (2*1 + 3*2 + 4*3) / 6 = 20/6 = 3.333...
        assert_approx_eq(result[3], 20.0 / 6.0);
    }

    // ===== DEMA Tests =====

    #[test]
    fn test_dema_basic() {
        let prices = vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0];
        let result = dema(&prices, 3);

        // DEMA should have more NaN at start due to double EMA
        assert!(result[0].is_nan());
        // Eventually should have valid values
        assert!(!result[9].is_nan());
    }

    // ===== TEMA Tests =====

    #[test]
    fn test_tema_basic() {
        let prices: Vec<f64> = (1..=15).map(|x| x as f64).collect();
        let result = tema(&prices, 3);

        // TEMA should have more NaN at start due to triple EMA
        assert!(result[0].is_nan());
        // Eventually should have valid values
        assert!(!result[14].is_nan());
    }

    // ===== HMA Tests =====

    #[test]
    fn test_hma_basic() {
        let prices: Vec<f64> = (1..=20).map(|x| x as f64).collect();
        let result = hma(&prices, 9);

        assert_eq!(result.len(), prices.len());
        // Should have some valid values at the end
        assert!(!result[19].is_nan());
    }

    #[test]
    fn test_hma_small_period() {
        let prices = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let result = hma(&prices, 4);
        assert_eq!(result.len(), 5);
    }

    // ===== KAMA Tests =====

    #[test]
    fn test_kama_basic() {
        let prices: Vec<f64> = (1..=20).map(|x| x as f64).collect();
        let result = kama(&prices, 10, 2, 30);

        assert!(result[8].is_nan());
        assert!(!result[9].is_nan());
        assert!(!result[19].is_nan());
    }

    #[test]
    fn test_kama_flat_prices() {
        // Flat prices = zero efficiency ratio = slow smoothing
        let prices = vec![100.0; 20];
        let result = kama(&prices, 10, 2, 30);

        // With flat prices, KAMA should stay at price level
        assert_approx_eq(result[19], 100.0);
    }

    // ===== Wilder's MA Tests =====

    #[test]
    fn test_wilders_ma_basic() {
        let prices = vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0];
        let result = wilders_ma(&prices, 5);

        // First value should be SMA of first 5
        assert_approx_eq(result[4], 3.0); // (1+2+3+4+5)/5

        // Subsequent values use Wilder's smoothing
        assert!(!result[9].is_nan());
    }

    // ===== Edge Cases =====

    #[test]
    fn test_all_mas_same_length() {
        let prices: Vec<f64> = (1..=100).map(|x| x as f64).collect();

        assert_eq!(sma(&prices, 14).len(), 100);
        assert_eq!(ema(&prices, 14).len(), 100);
        assert_eq!(wma(&prices, 14).len(), 100);
        assert_eq!(dema(&prices, 14).len(), 100);
        assert_eq!(tema(&prices, 14).len(), 100);
        assert_eq!(hma(&prices, 14).len(), 100);
        assert_eq!(kama(&prices, 14, 2, 30).len(), 100);
        assert_eq!(wilders_ma(&prices, 14).len(), 100);
    }

    #[test]
    fn test_all_mas_empty_input() {
        let empty: Vec<f64> = vec![];

        assert!(sma(&empty, 14).is_empty());
        assert!(ema(&empty, 14).is_empty());
        assert!(wma(&empty, 14).is_empty());
        assert!(dema(&empty, 14).is_empty());
        assert!(tema(&empty, 14).is_empty());
        assert!(hma(&empty, 14).is_empty());
        assert!(kama(&empty, 14, 2, 30).is_empty());
        assert!(wilders_ma(&empty, 14).is_empty());
    }
}
