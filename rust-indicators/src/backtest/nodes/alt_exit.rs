// src/backtest/nodes/alt_exit.rs
// AltExit node - stateful enter/exit (persists across days)

use crate::backtest::conditions::{evaluate_conditions, ConditionResult};
use crate::backtest::context::EvalContext;
use crate::backtest::nodes::{evaluate_children, get_active_children};
use crate::backtest::types::{Allocation, FlowNode, empty_allocation};
use crate::backtest::weighting::combine_allocations;

/// Evaluate an altExit (Enter/Exit) node
/// Maintains state across days: once entered, stays in 'then' until exit conditions met
pub fn evaluate<'a>(ctx: &mut EvalContext<'a>, node: &'a FlowNode) -> Allocation {
    // Get current state (default: not entered)
    let is_entered = *ctx.alt_exit_state.get(&node.id).unwrap_or(&false);

    // Get conditions
    let entry_conditions = node.entry_conditions.as_deref().unwrap_or(&[]);
    let exit_conditions = node.exit_conditions.as_deref().unwrap_or(&[]);

    // Determine new state
    let new_entered = if is_entered {
        // Currently entered: check exit conditions
        if exit_conditions.is_empty() {
            // No exit conditions = stay entered forever
            true
        } else {
            let exit_result = evaluate_conditions(
                ctx.cache,
                ctx.db,
                exit_conditions,
                None,
                ctx.indicator_index,
                ctx.branch_parent_node,
                None,
            );

            match exit_result {
                ConditionResult::True => false, // Exit condition met
                ConditionResult::False => true, // Stay entered
                ConditionResult::Null => true,  // Uncertain = stay entered (conservative)
            }
        }
    } else {
        // Currently not entered: check entry conditions
        if entry_conditions.is_empty() {
            // No entry conditions = never enter
            false
        } else {
            let entry_result = evaluate_conditions(
                ctx.cache,
                ctx.db,
                entry_conditions,
                None,
                ctx.indicator_index,
                ctx.branch_parent_node,
                None,
            );

            match entry_result {
                ConditionResult::True => true,  // Entry condition met
                ConditionResult::False => false, // Stay out
                ConditionResult::Null => false,  // Uncertain = stay out (conservative)
            }
        }
    };

    // Update state
    ctx.alt_exit_state.insert(node.id.clone(), new_entered);

    // Evaluate appropriate branch
    if new_entered {
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
