// src/backtest/nodes/numbered.rs
// Numbered node - multi-condition evaluation (any/all/none/exactly N)

use crate::backtest::conditions::{evaluate_conditions, ConditionResult};
use crate::backtest::context::EvalContext;
use crate::backtest::nodes::{evaluate_children, get_active_children};
use crate::backtest::types::{Allocation, FlowNode, NumberedQuantifier, empty_allocation};
use crate::backtest::weighting::combine_allocations;

/// Evaluate a numbered node
/// Evaluates multiple condition items and branches based on quantifier
pub fn evaluate<'a>(ctx: &mut EvalContext<'a>, node: &'a FlowNode) -> Allocation {
    let numbered = match &node.numbered {
        Some(n) => n,
        None => return empty_allocation(),
    };

    if numbered.items.is_empty() {
        return evaluate_branch(ctx, node, "then"); // No items = true
    }

    // Evaluate each item
    let mut true_count = 0;
    let mut null_count = 0;

    for item in &numbered.items {
        let result = evaluate_conditions(
            ctx.cache,
            ctx.db,
            &item.conditions,
            item.group_logic.as_deref(),
            ctx.indicator_index,
            ctx.branch_parent_node,
            None,
        );

        match result {
            ConditionResult::True => true_count += 1,
            ConditionResult::False => {}
            ConditionResult::Null => null_count += 1,
        }
    }

    let total_items = numbered.items.len();
    let n = numbered.n as usize;

    // Determine branch based on quantifier
    let go_then = match numbered.quantifier {
        NumberedQuantifier::Any => true_count >= 1,
        NumberedQuantifier::All => true_count == total_items,
        NumberedQuantifier::None => true_count == 0 && null_count == 0,
        NumberedQuantifier::Exactly => true_count == n,
        NumberedQuantifier::AtLeast => true_count >= n,
        NumberedQuantifier::AtMost => true_count <= n,
        NumberedQuantifier::Ladder => {
            // Ladder mode: use ladder-N slot based on true count
            return evaluate_ladder(ctx, node, true_count);
        }
    };

    // Handle null cases conservatively
    if null_count > 0 {
        // If we have nulls and need certainty, be conservative
        match numbered.quantifier {
            NumberedQuantifier::All => {
                // Can't be "all true" if some are null
                return evaluate_branch(ctx, node, "else");
            }
            NumberedQuantifier::None => {
                // Can't be "none true" if some are null
                return evaluate_branch(ctx, node, "else");
            }
            _ => {}
        }
    }

    if go_then {
        evaluate_branch(ctx, node, "then")
    } else {
        evaluate_branch(ctx, node, "else")
    }
}

/// Evaluate a branch (then or else)
fn evaluate_branch<'a>(ctx: &mut EvalContext<'a>, node: &'a FlowNode, slot: &str) -> Allocation {
    let children = evaluate_children(ctx, node, slot);
    let active = get_active_children(children);

    if active.is_empty() {
        return empty_allocation();
    }

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

/// Evaluate ladder mode - pick slot based on true count
fn evaluate_ladder<'a>(ctx: &mut EvalContext<'a>, node: &'a FlowNode, true_count: usize) -> Allocation {
    // Try ladder-N slot first
    let ladder_slot = format!("ladder-{}", true_count);
    let ladder_children = evaluate_children(ctx, node, &ladder_slot);
    let ladder_active = get_active_children(ladder_children);

    if !ladder_active.is_empty() {
        return combine_allocations(
            ctx, node, &ladder_active,
            &node.weighting, node.vol_window,
        );
    }

    // Fallback: true_count > 0 -> then, else -> else
    if true_count > 0 {
        evaluate_branch(ctx, node, "then")
    } else {
        evaluate_branch(ctx, node, "else")
    }
}
