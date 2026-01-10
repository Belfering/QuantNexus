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
        // Get the metric value for this child using position tickers from subtree
        // This matches Node.js behavior
        let score = get_child_score(ctx, child, metric, window);

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

/// Get a score for a child based on its position tickers in the subtree
/// This matches Node.js behavior: collect ALL position tickers from child subtree,
/// then average their metric values (unweighted)
fn get_child_score(
    ctx: &mut EvalContext,
    child: &FlowNode,
    metric: &str,
    window: u32,
) -> Option<f64> {
    // Collect all position tickers from the child subtree (matches Node.js)
    let tickers = collect_position_tickers_from_subtree(child);

    if tickers.is_empty() {
        return None;
    }

    // Average metric value across all position tickers (unweighted, like Node.js)
    let mut sum = 0.0;
    let mut count = 0;

    for ticker in &tickers {
        if let Some(value) = metric_at_index(
            ctx.cache,
            ctx.db,
            ticker,
            metric,
            window,
            ctx.indicator_index,
        ) {
            if !value.is_nan() {
                sum += value;
                count += 1;
            }
        }
    }

    if count > 0 {
        Some(sum / count as f64)
    } else {
        None
    }
}

/// Collect all position tickers from a node's subtree
fn collect_position_tickers_from_subtree(node: &FlowNode) -> Vec<String> {
    let mut tickers = Vec::new();
    collect_position_tickers_recursive(node, &mut tickers);
    tickers.sort();
    tickers.dedup();
    tickers
}

fn collect_position_tickers_recursive(node: &FlowNode, tickers: &mut Vec<String>) {
    // Collect from positions
    if let Some(positions) = &node.positions {
        for p in positions {
            if !p.is_empty() && p != "Empty" {
                tickers.push(p.clone());
            }
        }
    }

    // Recurse into children
    for children in node.children.values() {
        for child in children.iter().flatten() {
            collect_position_tickers_recursive(child, tickers);
        }
    }
}
