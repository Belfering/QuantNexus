//! Common utilities shared across indicator modules

/// Initialize a result vector with NaN values
#[inline]
pub fn nan_vec(len: usize) -> Vec<f64> {
    vec![f64::NAN; len]
}

/// Check if we have enough data for the given period
#[inline]
pub fn has_enough_data(len: usize, period: usize) -> bool {
    len >= period && period > 0
}

/// Calculate the sum of a slice
#[inline]
pub fn sum(values: &[f64]) -> f64 {
    values.iter().sum()
}

/// Calculate the mean of a slice
#[inline]
pub fn mean(values: &[f64]) -> f64 {
    if values.is_empty() {
        return f64::NAN;
    }
    sum(values) / values.len() as f64
}

/// Find the maximum value in a slice
#[inline]
pub fn max(values: &[f64]) -> f64 {
    values.iter().cloned().fold(f64::NEG_INFINITY, f64::max)
}

/// Find the minimum value in a slice
#[inline]
pub fn min(values: &[f64]) -> f64 {
    values.iter().cloned().fold(f64::INFINITY, f64::min)
}

/// Find the index of the maximum value in a slice
#[inline]
pub fn argmax(values: &[f64]) -> usize {
    values
        .iter()
        .enumerate()
        .max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(i, _)| i)
        .unwrap_or(0)
}

/// Find the index of the minimum value in a slice
#[inline]
pub fn argmin(values: &[f64]) -> usize {
    values
        .iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(i, _)| i)
        .unwrap_or(0)
}

/// Safe division that returns NaN on divide by zero
#[inline]
pub fn safe_div(numerator: f64, denominator: f64) -> f64 {
    if denominator == 0.0 {
        f64::NAN
    } else {
        numerator / denominator
    }
}

/// Compute rolling window operation
/// Returns vector of same length with NaN for insufficient lookback
pub fn rolling<F>(values: &[f64], period: usize, f: F) -> Vec<f64>
where
    F: Fn(&[f64]) -> f64,
{
    let n = values.len();
    if !has_enough_data(n, period) {
        return nan_vec(n);
    }

    let mut result = nan_vec(n);
    for i in (period - 1)..n {
        let window = &values[(i + 1 - period)..=i];
        result[i] = f(window);
    }
    result
}

/// Compute pairwise differences (like np.diff)
pub fn diff(values: &[f64]) -> Vec<f64> {
    if values.len() < 2 {
        return vec![];
    }
    values.windows(2).map(|w| w[1] - w[0]).collect()
}

/// Separate gains and losses from price changes
pub fn gains_losses(changes: &[f64]) -> (Vec<f64>, Vec<f64>) {
    let gains: Vec<f64> = changes.iter().map(|&c| if c > 0.0 { c } else { 0.0 }).collect();
    let losses: Vec<f64> = changes.iter().map(|&c| if c < 0.0 { -c } else { 0.0 }).collect();
    (gains, losses)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_nan_vec() {
        let v = nan_vec(5);
        assert_eq!(v.len(), 5);
        assert!(v.iter().all(|x| x.is_nan()));
    }

    #[test]
    fn test_sum() {
        assert_eq!(sum(&[1.0, 2.0, 3.0]), 6.0);
        assert_eq!(sum(&[]), 0.0);
    }

    #[test]
    fn test_mean() {
        assert_eq!(mean(&[2.0, 4.0, 6.0]), 4.0);
        assert!(mean(&[]).is_nan());
    }

    #[test]
    fn test_max_min() {
        let v = vec![3.0, 1.0, 4.0, 1.0, 5.0];
        assert_eq!(max(&v), 5.0);
        assert_eq!(min(&v), 1.0);
    }

    #[test]
    fn test_argmax_argmin() {
        let v = vec![3.0, 1.0, 4.0, 1.0, 5.0];
        assert_eq!(argmax(&v), 4);
        assert_eq!(argmin(&v), 1);
    }

    #[test]
    fn test_safe_div() {
        assert_eq!(safe_div(10.0, 2.0), 5.0);
        assert!(safe_div(10.0, 0.0).is_nan());
    }

    #[test]
    fn test_diff() {
        let v = vec![1.0, 3.0, 6.0, 10.0];
        let d = diff(&v);
        assert_eq!(d, vec![2.0, 3.0, 4.0]);
    }

    #[test]
    fn test_gains_losses() {
        let changes = vec![1.0, -2.0, 3.0, -1.0, 0.0];
        let (gains, losses) = gains_losses(&changes);
        assert_eq!(gains, vec![1.0, 0.0, 3.0, 0.0, 0.0]);
        assert_eq!(losses, vec![0.0, 2.0, 0.0, 1.0, 0.0]);
    }

    #[test]
    fn test_rolling() {
        let v = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let result = rolling(&v, 3, |w| mean(w));
        assert!(result[0].is_nan());
        assert!(result[1].is_nan());
        assert_eq!(result[2], 2.0);
        assert_eq!(result[3], 3.0);
        assert_eq!(result[4], 4.0);
    }
}
