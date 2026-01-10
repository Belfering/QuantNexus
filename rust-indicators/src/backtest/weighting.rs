// src/backtest/weighting.rs
// Weighting modes for combining child allocations

use crate::backtest::context::EvalContext;
use crate::backtest::indicators::compute_indicator;
use crate::backtest::types::{Allocation, FlowNode, WeightMode, empty_allocation, normalize_allocation};

/// Combine multiple child allocations using the specified weighting mode
pub fn combine_allocations(
    ctx: &mut EvalContext,
    _node: &FlowNode,
    children: &[(Allocation, &FlowNode)],
    weighting: &WeightMode,
    vol_window: Option<u32>,
) -> Allocation {
    if children.is_empty() {
        return empty_allocation();
    }

    if children.len() == 1 {
        return children[0].0.clone();
    }

    // Calculate weights based on mode
    let weights = match weighting {
        WeightMode::Equal => equal_weights(children.len()),
        WeightMode::Defined => defined_weights(children),
        WeightMode::Inverse => inverse_volatility_weights(ctx, children, vol_window.unwrap_or(20)),
        WeightMode::Pro => pro_volatility_weights(ctx, children, vol_window.unwrap_or(20)),
        WeightMode::Capped => {
            // Capped mode falls back to equal for now
            // TODO: implement capped weighting with fallback ticker
            equal_weights(children.len())
        }
    };

    // Combine allocations with calculated weights
    let mut result = Allocation::new();

    for ((alloc, _), weight) in children.iter().zip(weights.iter()) {
        for (ticker, &ticker_weight) in alloc {
            *result.entry(ticker.clone()).or_insert(0.0) += ticker_weight * weight;
        }
    }

    normalize_allocation(&mut result);
    result
}

/// Equal weights for all children
fn equal_weights(n: usize) -> Vec<f64> {
    vec![1.0 / n as f64; n]
}

/// Defined weights based on child.window field
fn defined_weights(children: &[(Allocation, &FlowNode)]) -> Vec<f64> {
    let weights: Vec<f64> = children
        .iter()
        .map(|(_, child)| child.window.unwrap_or(1) as f64)
        .collect();

    let total: f64 = weights.iter().sum();

    if total <= 0.0 {
        // Fallback to equal
        return equal_weights(children.len());
    }

    weights.iter().map(|w| w / total).collect()
}

/// Inverse volatility weighting (lower vol = higher weight)
fn inverse_volatility_weights(
    ctx: &mut EvalContext,
    children: &[(Allocation, &FlowNode)],
    window: u32,
) -> Vec<f64> {
    let vols = calculate_child_volatilities(ctx, children, window);

    // Check if we have valid volatilities
    if vols.iter().any(|v| v.is_none() || *v == Some(0.0)) {
        return equal_weights(children.len());
    }

    let vols: Vec<f64> = vols.into_iter().map(|v| v.unwrap()).collect();

    // Calculate inverse volatility weights
    let inverse_vols: Vec<f64> = vols.iter().map(|v| 1.0 / v).collect();
    let total: f64 = inverse_vols.iter().sum();

    if total <= 0.0 || !total.is_finite() {
        return equal_weights(children.len());
    }

    inverse_vols.iter().map(|iv| iv / total).collect()
}

/// Pro volatility weighting (higher vol = higher weight)
fn pro_volatility_weights(
    ctx: &mut EvalContext,
    children: &[(Allocation, &FlowNode)],
    window: u32,
) -> Vec<f64> {
    let vols = calculate_child_volatilities(ctx, children, window);

    // Check if we have valid volatilities
    if vols.iter().any(|v| v.is_none()) {
        return equal_weights(children.len());
    }

    let vols: Vec<f64> = vols.into_iter().map(|v| v.unwrap()).collect();
    let total: f64 = vols.iter().sum();

    if total <= 0.0 || !total.is_finite() {
        return equal_weights(children.len());
    }

    vols.iter().map(|v| v / total).collect()
}

/// Calculate volatility for each child's allocation
fn calculate_child_volatilities(
    ctx: &mut EvalContext,
    children: &[(Allocation, &FlowNode)],
    window: u32,
) -> Vec<Option<f64>> {
    children
        .iter()
        .map(|(alloc, _)| calculate_allocation_volatility(ctx, alloc, window))
        .collect()
}

/// Calculate weighted average volatility for an allocation
fn calculate_allocation_volatility(
    ctx: &mut EvalContext,
    alloc: &Allocation,
    window: u32,
) -> Option<f64> {
    if alloc.is_empty() {
        return None;
    }

    let mut total_vol = 0.0;
    let mut total_weight = 0.0;

    for (ticker, &weight) in alloc {
        // Get standard deviation of returns for this ticker
        let vol_series = compute_indicator(
            ctx.cache,
            ctx.db,
            ticker,
            "Standard Deviation",
            window,
        );

        if let Some(vol_values) = vol_series {
            if let Some(&vol) = vol_values.get(ctx.indicator_index) {
                if !vol.is_nan() && vol > 0.0 {
                    total_vol += vol * weight;
                    total_weight += weight;
                }
            }
        }
    }

    if total_weight > 0.0 {
        Some(total_vol / total_weight)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_equal_weights() {
        let w = equal_weights(4);
        assert_eq!(w.len(), 4);
        assert!((w[0] - 0.25).abs() < 0.001);
        assert!((w.iter().sum::<f64>() - 1.0).abs() < 0.001);
    }
}
