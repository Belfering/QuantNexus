//! Volume indicators
//!
//! Indicators that incorporate trading volume to analyze price movements.

use crate::common::{nan_vec, has_enough_data, safe_div};

/// OBV - On Balance Volume
///
/// Cumulative volume indicator that adds volume on up days and subtracts on down days
///
/// Formula:
/// - If Close > Close[1]: OBV = OBV[1] + Volume
/// - If Close < Close[1]: OBV = OBV[1] - Volume
/// - If Close = Close[1]: OBV = OBV[1]
pub fn obv(closes: &[f64], volumes: &[f64]) -> Vec<f64> {
    let n = closes.len();
    if n != volumes.len() || n == 0 {
        return nan_vec(n.max(1));
    }

    let mut result = vec![0.0; n];
    result[0] = volumes[0]; // Start with first volume

    for i in 1..n {
        if closes[i] > closes[i - 1] {
            result[i] = result[i - 1] + volumes[i];
        } else if closes[i] < closes[i - 1] {
            result[i] = result[i - 1] - volumes[i];
        } else {
            result[i] = result[i - 1];
        }
    }
    result
}

/// OBV Rate of Change
///
/// Percentage change in OBV over specified period
///
/// Formula: ((OBV - OBV[period]) / |OBV[period]|) * 100
pub fn obv_roc(closes: &[f64], volumes: &[f64], period: usize) -> Vec<f64> {
    let obv_values = obv(closes, volumes);
    let n = obv_values.len();

    if !has_enough_data(n, period + 1) {
        return nan_vec(n);
    }

    let mut result = nan_vec(n);
    for i in period..n {
        let prev = obv_values[i - period];
        if prev != 0.0 {
            result[i] = ((obv_values[i] - prev) / prev.abs()) * 100.0;
        }
    }
    result
}

/// VWAP - Volume Weighted Average Price
///
/// Calculates the average price weighted by volume
///
/// Formula: Cumulative(Typical Price * Volume) / Cumulative(Volume)
/// where Typical Price = (High + Low + Close) / 3
///
/// Note: This is a cumulative VWAP from the start of the series.
/// For intraday VWAP that resets each day, you would need to segment by date.
pub fn vwap(highs: &[f64], lows: &[f64], closes: &[f64], volumes: &[f64]) -> Vec<f64> {
    let n = highs.len();
    if n != lows.len() || n != closes.len() || n != volumes.len() || n == 0 {
        return nan_vec(n.max(1));
    }

    let mut result = nan_vec(n);
    let mut cumulative_tpv = 0.0; // Typical Price * Volume
    let mut cumulative_vol = 0.0;

    for i in 0..n {
        let typical_price = (highs[i] + lows[i] + closes[i]) / 3.0;
        cumulative_tpv += typical_price * volumes[i];
        cumulative_vol += volumes[i];

        if cumulative_vol > 0.0 {
            result[i] = cumulative_tpv / cumulative_vol;
        }
    }
    result
}

/// VWAP Ratio
///
/// Current price relative to VWAP
///
/// Formula: Close / VWAP
///
/// Values:
/// - > 1: Price above VWAP (bullish)
/// - < 1: Price below VWAP (bearish)
/// - = 1: Price at VWAP
pub fn vwap_ratio(highs: &[f64], lows: &[f64], closes: &[f64], volumes: &[f64]) -> Vec<f64> {
    let vwap_values = vwap(highs, lows, closes, volumes);
    let n = closes.len();

    let mut result = nan_vec(n);
    for i in 0..n {
        if !vwap_values[i].is_nan() && vwap_values[i] != 0.0 {
            result[i] = closes[i] / vwap_values[i];
        }
    }
    result
}

/// Rolling VWAP
///
/// VWAP calculated over a rolling window instead of cumulative
///
/// Formula: Sum(Typical Price * Volume, period) / Sum(Volume, period)
pub fn rolling_vwap(highs: &[f64], lows: &[f64], closes: &[f64], volumes: &[f64], period: usize) -> Vec<f64> {
    let n = highs.len();
    if n != lows.len() || n != closes.len() || n != volumes.len() || !has_enough_data(n, period) {
        return nan_vec(n.max(1));
    }

    let mut result = nan_vec(n);

    for i in (period - 1)..n {
        let start = i + 1 - period;
        let mut sum_tpv = 0.0;
        let mut sum_vol = 0.0;

        for j in start..=i {
            let typical_price = (highs[j] + lows[j] + closes[j]) / 3.0;
            sum_tpv += typical_price * volumes[j];
            sum_vol += volumes[j];
        }

        if sum_vol > 0.0 {
            result[i] = sum_tpv / sum_vol;
        }
    }
    result
}

/// Volume Rate of Change
///
/// Percentage change in volume over specified period
pub fn volume_roc(volumes: &[f64], period: usize) -> Vec<f64> {
    let n = volumes.len();
    if !has_enough_data(n, period + 1) {
        return nan_vec(n);
    }

    let mut result = nan_vec(n);
    for i in period..n {
        result[i] = safe_div(volumes[i] - volumes[i - period], volumes[i - period]) * 100.0;
    }
    result
}

/// Relative Volume
///
/// Current volume relative to average volume over period
///
/// Formula: Volume / SMA(Volume, period)
pub fn relative_volume(volumes: &[f64], period: usize) -> Vec<f64> {
    let n = volumes.len();
    if !has_enough_data(n, period) {
        return nan_vec(n);
    }

    let sma_vol = crate::moving_averages::sma(volumes, period);

    let mut result = nan_vec(n);
    for i in 0..n {
        if !sma_vol[i].is_nan() && sma_vol[i] != 0.0 {
            result[i] = volumes[i] / sma_vol[i];
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
    fn test_obv_uptrend() {
        let closes = vec![10.0, 11.0, 12.0, 13.0, 14.0];
        let volumes = vec![100.0, 100.0, 100.0, 100.0, 100.0];

        let result = obv(&closes, &volumes);

        // Each bar adds volume (price going up)
        assert!(approx_eq(result[0], 100.0, 0.001));
        assert!(approx_eq(result[1], 200.0, 0.001));
        assert!(approx_eq(result[2], 300.0, 0.001));
        assert!(approx_eq(result[3], 400.0, 0.001));
        assert!(approx_eq(result[4], 500.0, 0.001));
    }

    #[test]
    fn test_obv_downtrend() {
        let closes = vec![14.0, 13.0, 12.0, 11.0, 10.0];
        let volumes = vec![100.0, 100.0, 100.0, 100.0, 100.0];

        let result = obv(&closes, &volumes);

        // Each bar subtracts volume (price going down)
        assert!(approx_eq(result[0], 100.0, 0.001));
        assert!(approx_eq(result[1], 0.0, 0.001));
        assert!(approx_eq(result[2], -100.0, 0.001));
        assert!(approx_eq(result[3], -200.0, 0.001));
        assert!(approx_eq(result[4], -300.0, 0.001));
    }

    #[test]
    fn test_obv_flat() {
        let closes = vec![10.0, 10.0, 10.0];
        let volumes = vec![100.0, 200.0, 300.0];

        let result = obv(&closes, &volumes);

        // No change when price is flat
        assert!(approx_eq(result[0], 100.0, 0.001));
        assert!(approx_eq(result[1], 100.0, 0.001));
        assert!(approx_eq(result[2], 100.0, 0.001));
    }

    #[test]
    fn test_vwap_basic() {
        let highs = vec![12.0, 13.0, 14.0];
        let lows = vec![10.0, 11.0, 12.0];
        let closes = vec![11.0, 12.0, 13.0];
        let volumes = vec![100.0, 100.0, 100.0];

        let result = vwap(&highs, &lows, &closes, &volumes);

        // Typical prices: 11, 12, 13
        // VWAP[0] = 11 * 100 / 100 = 11
        assert!(approx_eq(result[0], 11.0, 0.001));
        // VWAP[1] = (11*100 + 12*100) / 200 = 11.5
        assert!(approx_eq(result[1], 11.5, 0.001));
        // VWAP[2] = (11*100 + 12*100 + 13*100) / 300 = 12
        assert!(approx_eq(result[2], 12.0, 0.001));
    }

    #[test]
    fn test_vwap_ratio() {
        let highs = vec![12.0, 13.0, 14.0];
        let lows = vec![10.0, 11.0, 12.0];
        let closes = vec![11.0, 12.0, 14.0]; // Last close above typical
        let volumes = vec![100.0, 100.0, 100.0];

        let result = vwap_ratio(&highs, &lows, &closes, &volumes);

        // First bar: close = VWAP = 11, ratio = 1
        assert!(approx_eq(result[0], 1.0, 0.001));
        // Last bar: close = 14, VWAP = 12, ratio > 1
        assert!(result[2] > 1.0);
    }

    #[test]
    fn test_obv_roc() {
        let closes = vec![10.0, 11.0, 12.0, 13.0, 14.0, 15.0];
        let volumes = vec![100.0, 100.0, 100.0, 100.0, 100.0, 100.0];

        let result = obv_roc(&closes, &volumes, 3);

        // OBV: 100, 200, 300, 400, 500, 600
        // At index 3: (400 - 100) / 100 * 100 = 300%
        assert!(approx_eq(result[3], 300.0, 0.01));
    }

    #[test]
    fn test_rolling_vwap() {
        let highs = vec![12.0, 13.0, 14.0, 15.0, 16.0];
        let lows = vec![10.0, 11.0, 12.0, 13.0, 14.0];
        let closes = vec![11.0, 12.0, 13.0, 14.0, 15.0];
        let volumes = vec![100.0, 100.0, 100.0, 100.0, 100.0];

        let result = rolling_vwap(&highs, &lows, &closes, &volumes, 3);

        // Typical prices: 11, 12, 13, 14, 15
        // At index 2: (11+12+13) * 100 / 300 = 12
        assert!(approx_eq(result[2], 12.0, 0.001));
        // At index 4: (13+14+15) * 100 / 300 = 14
        assert!(approx_eq(result[4], 14.0, 0.001));
    }

    #[test]
    fn test_relative_volume() {
        let volumes = vec![100.0, 100.0, 100.0, 200.0, 50.0];
        let result = relative_volume(&volumes, 3);

        // At index 2: vol=100, sma=100, ratio=1
        assert!(approx_eq(result[2], 1.0, 0.001));
        // At index 3: vol=200, sma=(100+100+200)/3=133.33, ratio=1.5
        assert!(approx_eq(result[3], 1.5, 0.001));
    }
}
