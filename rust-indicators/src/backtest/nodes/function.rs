// src/backtest/nodes/function.rs
// Function node - rank children and pick top/bottom N

use crate::backtest::context::EvalContext;
use crate::backtest::indicators::metric_at_index;
use crate::backtest::nodes::{evaluate_children, get_active_children};
use crate::backtest::types::{Allocation, FlowNode, RankChoice, WeightMode, empty_allocation};
use crate::backtest::weighting::combine_allocations;

/// Evaluate a function node
/// Ranks children by a metric and picks top/bottom N
pub fn evaluate<'a>(ctx: &mut EvalContext<'a>, node: &'a FlowNode) -> Allocation {
    // Get children from 'next' slot
    let children = evaluate_children(ctx, node, "next");
    let active = get_active_children(children);

    if active.is_empty() {
        return empty_allocation();
    }

    // Get function parameters
    let metric = node.metric.as_deref().unwrap_or("Relative Strength Index");
    let window = node.window.unwrap_or(14);
    let bottom = node.bottom.unwrap_or(1) as usize;
    let rank_dir = node.rank.clone().unwrap_or(RankChoice::Bottom);

    // For each child, compute the metric value of its tickers
    // and get an aggregate value (average or representative ticker)
    let mut scored: Vec<(f64, Allocation, &FlowNode)> = Vec::new();

    for (alloc, child) in active {
        // Get the metric value for this child
        // Use the first non-empty ticker as representative
        let score = get_child_score(ctx, &alloc, metric, window);

        if let Some(s) = score {
            scored.push((s, alloc, child));
        }
        // Children with no valid score are filtered out
    }

    if scored.is_empty() {
        return empty_allocation();
    }

    // Sort by score
    match rank_dir {
        RankChoice::Bottom => {
            // Bottom = lowest values first
            scored.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        }
        RankChoice::Top => {
            // Top = highest values first
            scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        }
    }

    // Take top N
    let selected: Vec<(Allocation, &FlowNode)> = scored
        .into_iter()
        .take(bottom)
        .map(|(_, alloc, node)| (alloc, node))
        .collect();

    if selected.is_empty() {
        return empty_allocation();
    }

    // Combine selected children
    combine_allocations(ctx, node, &selected, &node.weighting, node.vol_window)
}

/// Get a score for a child based on its tickers
fn get_child_score(
    ctx: &mut EvalContext,
    alloc: &Allocation,
    metric: &str,
    window: u32,
) -> Option<f64> {
    if alloc.is_empty() {
        return None;
    }

    // Compute metric for each ticker and take weighted average
    let mut total_score = 0.0;
    let mut total_weight = 0.0;

    for (ticker, &weight) in alloc {
        if let Some(value) = metric_at_index(
            ctx.cache,
            ctx.db,
            ticker,
            metric,
            window,
            ctx.indicator_index,
        ) {
            total_score += value * weight;
            total_weight += weight;
        }
    }

    if total_weight > 0.0 {
        Some(total_score / total_weight)
    } else {
        None
    }
}
