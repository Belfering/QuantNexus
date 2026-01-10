// src/backtest/nodes/scaling.rs
// Scaling node - blend between two branches based on a metric

use crate::backtest::context::EvalContext;
use crate::backtest::indicators::metric_at_index;
use crate::backtest::nodes::{evaluate_children, get_active_children};
use crate::backtest::types::{Allocation, FlowNode, empty_allocation, merge_allocations};
use crate::backtest::weighting::combine_allocations;

/// Evaluate a scaling node
/// Blends 'then' and 'else' branches based on a metric value
pub fn evaluate<'a>(ctx: &mut EvalContext<'a>, node: &'a FlowNode) -> Allocation {
    // Get scale parameters
    let scale_ticker = node.scale_ticker.as_deref().unwrap_or("SPY");
    let scale_metric = node.scale_metric.as_deref().unwrap_or("Relative Strength Index");
    let scale_window = node.scale_window.unwrap_or(14);
    let scale_from = node.scale_from.unwrap_or(30.0);
    let scale_to = node.scale_to.unwrap_or(70.0);

    // Get metric value
    let metric_value = get_scale_value(ctx, node, scale_ticker, scale_metric, scale_window);

    // Calculate blend factor
    let blend = match metric_value {
        Some(value) => calculate_blend(value, scale_from, scale_to),
        None => {
            // No value = default to 100% 'then' (conservative)
            ctx.used_scaling_fallback = true;
            0.0
        }
    };

    // Evaluate both branches
    let then_children = evaluate_children(ctx, node, "then");
    let else_children = evaluate_children(ctx, node, "else");

    let then_active = get_active_children(then_children);
    let else_active = get_active_children(else_children);

    // Combine each branch
    let then_alloc = if then_active.is_empty() {
        empty_allocation()
    } else {
        let weighting = node.weighting_then.clone().unwrap_or(node.weighting.clone());
        let vol_window = node.vol_window_then.or(node.vol_window);
        combine_allocations(ctx, node, &then_active, &weighting, vol_window)
    };

    let else_alloc = if else_active.is_empty() {
        empty_allocation()
    } else {
        let weighting = node.weighting_else.clone().unwrap_or(node.weighting.clone());
        let vol_window = node.vol_window_else.or(node.vol_window);
        combine_allocations(ctx, node, &else_active, &weighting, vol_window)
    };

    // Blend: blend=0 -> 100% then, blend=1 -> 100% else
    let then_weight = 1.0 - blend;
    let else_weight = blend;

    merge_allocations(&then_alloc, &else_alloc, then_weight, else_weight)
}

/// Get the scale value, handling branch references
fn get_scale_value(
    ctx: &mut EvalContext,
    node: &FlowNode,
    ticker: &str,
    metric: &str,
    window: u32,
) -> Option<f64> {
    // Check for branch reference
    if FlowNode::is_branch_ref(ticker) {
        // TODO: Implement branch equity for scaling
        // For now, return None which will use fallback
        return None;
    }

    // Regular ticker
    metric_at_index(ctx.cache, ctx.db, ticker, metric, window, ctx.indicator_index)
}

/// Calculate blend factor from metric value and scale range
fn calculate_blend(value: f64, scale_from: f64, scale_to: f64) -> f64 {
    if (scale_to - scale_from).abs() < f64::EPSILON {
        // Same from/to = always 50%
        return 0.5;
    }

    let blend = if scale_from < scale_to {
        // Normal range: higher value = more 'else'
        (value - scale_from) / (scale_to - scale_from)
    } else {
        // Inverted range: higher value = more 'then'
        (scale_from - value) / (scale_from - scale_to)
    };

    // Clamp to [0, 1]
    blend.max(0.0).min(1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_blend_normal() {
        // From 30 to 70
        assert!((calculate_blend(30.0, 30.0, 70.0) - 0.0).abs() < 0.001);
        assert!((calculate_blend(50.0, 30.0, 70.0) - 0.5).abs() < 0.001);
        assert!((calculate_blend(70.0, 30.0, 70.0) - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_calculate_blend_inverted() {
        // From 70 to 30 (inverted)
        assert!((calculate_blend(70.0, 70.0, 30.0) - 0.0).abs() < 0.001);
        assert!((calculate_blend(50.0, 70.0, 30.0) - 0.5).abs() < 0.001);
        assert!((calculate_blend(30.0, 70.0, 30.0) - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_calculate_blend_clamped() {
        // Values outside range should clamp
        assert!((calculate_blend(0.0, 30.0, 70.0) - 0.0).abs() < 0.001);
        assert!((calculate_blend(100.0, 30.0, 70.0) - 1.0).abs() < 0.001);
    }
}
