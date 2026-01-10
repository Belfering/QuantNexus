// src/backtest/metrics.rs
// Performance metrics calculation

use crate::backtest::types::BacktestMetrics;

/// Calculate all backtest metrics from equity curve and returns
pub fn calculate_metrics(
    equity: &[f64],
    daily_returns: &[f64],
    benchmark_returns: &[f64],
    dates: &[String],
    trading_days_per_year: f64,
) -> BacktestMetrics {
    if equity.is_empty() || daily_returns.is_empty() {
        return BacktestMetrics::default();
    }

    let start_date = dates.first().cloned().unwrap_or_default();
    let end_date = dates.last().cloned().unwrap_or_default();
    let days = daily_returns.len() as u32;
    let years = days as f64 / trading_days_per_year;

    // Total return
    let final_equity = *equity.last().unwrap_or(&1.0);
    let total_return = final_equity - 1.0;

    // CAGR
    let cagr = if years > 0.0 {
        final_equity.powf(1.0 / years) - 1.0
    } else {
        0.0
    };

    // Volatility (annualized)
    let vol = annualized_volatility(daily_returns, trading_days_per_year);

    // Max drawdown
    let max_drawdown = calculate_max_drawdown(equity);

    // Calmar ratio
    let calmar = if max_drawdown != 0.0 {
        cagr / max_drawdown.abs()
    } else {
        0.0
    };

    // Sharpe ratio (assuming risk-free rate of 0)
    let sharpe = if vol > 0.0 { cagr / vol } else { 0.0 };

    // Sortino ratio (using downside deviation)
    let downside_vol = downside_deviation(daily_returns, trading_days_per_year);
    let sortino = if downside_vol > 0.0 {
        cagr / downside_vol
    } else {
        0.0
    };

    // Beta and Treynor (relative to benchmark)
    let (beta, treynor) = if !benchmark_returns.is_empty() {
        let b = calculate_beta(daily_returns, benchmark_returns);
        let t = if b != 0.0 { cagr / b } else { 0.0 };
        (b, t)
    } else {
        (1.0, cagr) // Default beta = 1
    };

    // Win rate
    let win_days = daily_returns.iter().filter(|&&r| r > 0.0).count();
    let win_rate = win_days as f64 / daily_returns.len().max(1) as f64;

    // Best/worst day
    let best_day = daily_returns
        .iter()
        .copied()
        .fold(f64::NEG_INFINITY, f64::max);
    let worst_day = daily_returns
        .iter()
        .copied()
        .fold(f64::INFINITY, f64::min);

    BacktestMetrics {
        start_date,
        end_date,
        days,
        years,
        total_return,
        cagr,
        volatility: vol,
        max_drawdown,
        calmar,
        sharpe,
        sortino,
        treynor,
        beta,
        win_rate,
        best_day: if best_day.is_finite() { best_day } else { 0.0 },
        worst_day: if worst_day.is_finite() { worst_day } else { 0.0 },
        avg_turnover: 0.0, // Set separately
        avg_holdings: 0.0, // Set separately
    }
}

/// Calculate annualized volatility
fn annualized_volatility(returns: &[f64], trading_days: f64) -> f64 {
    if returns.is_empty() {
        return 0.0;
    }

    let mean = returns.iter().sum::<f64>() / returns.len() as f64;
    let variance = returns
        .iter()
        .map(|r| (r - mean).powi(2))
        .sum::<f64>()
        / returns.len().max(1) as f64;

    (variance.sqrt()) * trading_days.sqrt()
}

/// Calculate downside deviation (for Sortino ratio)
fn downside_deviation(returns: &[f64], trading_days: f64) -> f64 {
    let negative_returns: Vec<f64> = returns
        .iter()
        .filter(|&&r| r < 0.0)
        .copied()
        .collect();

    if negative_returns.is_empty() {
        return 0.0;
    }

    let sum_sq: f64 = negative_returns.iter().map(|r| r.powi(2)).sum();
    let downside_var = sum_sq / returns.len() as f64;

    downside_var.sqrt() * trading_days.sqrt()
}

/// Calculate maximum drawdown
fn calculate_max_drawdown(equity: &[f64]) -> f64 {
    if equity.is_empty() {
        return 0.0;
    }

    let mut peak = equity[0];
    let mut max_dd = 0.0;

    for &value in equity {
        if value > peak {
            peak = value;
        }
        let dd = (peak - value) / peak;
        if dd > max_dd {
            max_dd = dd;
        }
    }

    -max_dd // Return as negative
}

/// Calculate beta relative to benchmark
fn calculate_beta(returns: &[f64], benchmark: &[f64]) -> f64 {
    if returns.len() != benchmark.len() || returns.is_empty() {
        return 1.0;
    }

    let n = returns.len() as f64;

    let mean_r = returns.iter().sum::<f64>() / n;
    let mean_b = benchmark.iter().sum::<f64>() / n;

    let mut covariance = 0.0;
    let mut variance_b = 0.0;

    for i in 0..returns.len() {
        let r_diff = returns[i] - mean_r;
        let b_diff = benchmark[i] - mean_b;
        covariance += r_diff * b_diff;
        variance_b += b_diff * b_diff;
    }

    covariance /= n;
    variance_b /= n;

    if variance_b > 0.0 {
        covariance / variance_b
    } else {
        1.0
    }
}

/// Calculate turnover between two allocations
pub fn calculate_turnover(
    prev: &std::collections::HashMap<String, f64>,
    curr: &std::collections::HashMap<String, f64>,
) -> f64 {
    let mut total_change = 0.0;

    // Get all tickers from both allocations
    let mut all_tickers: Vec<&String> = prev.keys().chain(curr.keys()).collect();
    all_tickers.sort();
    all_tickers.dedup();

    for ticker in all_tickers {
        let prev_weight = prev.get(ticker).copied().unwrap_or(0.0);
        let curr_weight = curr.get(ticker).copied().unwrap_or(0.0);
        total_change += (curr_weight - prev_weight).abs();
    }

    // Turnover is half the total change (buying and selling are both counted)
    total_change / 2.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_max_drawdown() {
        let equity = vec![1.0, 1.1, 1.2, 1.0, 0.8, 1.0, 1.1];
        let dd = calculate_max_drawdown(&equity);
        // Max DD is from 1.2 to 0.8 = -33.3%
        assert!((dd - (-0.333)).abs() < 0.01);
    }

    #[test]
    fn test_annualized_vol() {
        let returns = vec![0.01, -0.01, 0.02, -0.02, 0.01];
        let vol = annualized_volatility(&returns, 252.0);
        assert!(vol > 0.0);
    }

    #[test]
    fn test_beta() {
        let returns = vec![0.01, -0.01, 0.02, -0.02, 0.01];
        let benchmark = vec![0.01, -0.01, 0.02, -0.02, 0.01];
        let beta = calculate_beta(&returns, &benchmark);
        assert!((beta - 1.0).abs() < 0.001); // Same returns = beta 1
    }
}
