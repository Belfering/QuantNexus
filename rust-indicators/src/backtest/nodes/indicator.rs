// src/backtest/nodes/indicator.rs
// Indicator node - conditional branching (if/then/else)

use crate::backtest::conditions::{evaluate_conditions, ConditionResult};
use crate::backtest::context::EvalContext;
use crate::backtest::nodes::{evaluate_children, get_active_children};
use crate::backtest::types::{Allocation, FlowNode, WeightMode, empty_allocation};
use crate::backtest::weighting::combine_allocations;

/// Evaluate an indicator node
/// Evaluates conditions and branches to 'then' or 'else'
pub fn evaluate<'a>(ctx: &mut EvalContext<'a>, node: &'a FlowNode) -> Allocation {
    // Get conditions
    let conditions = match &node.conditions {
        Some(c) if !c.is_empty() => c,
        _ => {
            // No conditions = always true, go to 'then'
            return evaluate_branch(ctx, node, "then");
        }
    };

    // Evaluate conditions
    let result = evaluate_conditions(
        ctx.cache,
        ctx.db,
        conditions,
        None, // Use built-in AND/OR logic
        ctx.indicator_index,
        ctx.branch_parent_node,
        None, // TODO: branch metric function for branch references
    );

    // Branch based on result
    match result {
        ConditionResult::True => evaluate_branch(ctx, node, "then"),
        ConditionResult::False => evaluate_branch(ctx, node, "else"),
        ConditionResult::Null => {
            // Null = insufficient data, default to 'else' branch (safer)
            // Some strategies may want different behavior here
            evaluate_branch(ctx, node, "else")
        }
    }
}

/// Evaluate a branch (then or else) and combine children
fn evaluate_branch<'a>(ctx: &mut EvalContext<'a>, node: &'a FlowNode, slot: &str) -> Allocation {
    let children = evaluate_children(ctx, node, slot);
    let active = get_active_children(children);

    if active.is_empty() {
        return empty_allocation();
    }

    // Get weighting mode for this branch
    let (weighting, vol_window) = match slot {
        "then" => (
            node.weighting_then.clone().unwrap_or(node.weighting.clone()),
            node.vol_window_then.or(node.vol_window),
        ),
        "else" => (
            node.weighting_else.clone().unwrap_or(node.weighting.clone()),
            node.vol_window_else.or(node.vol_window),
        ),
        _ => (node.weighting.clone(), node.vol_window),
    };

    combine_allocations(ctx, node, &active, &weighting, vol_window)
}
