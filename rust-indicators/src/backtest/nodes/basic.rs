// src/backtest/nodes/basic.rs
// Basic node - passthrough with weighted children

use crate::backtest::context::EvalContext;
use crate::backtest::nodes::{evaluate_children, get_active_children};
use crate::backtest::types::{Allocation, FlowNode, empty_allocation};
use crate::backtest::weighting::combine_allocations;

/// Evaluate a basic node
/// Passes through to children with weighted combination
pub fn evaluate<'a>(ctx: &mut EvalContext<'a>, node: &'a FlowNode) -> Allocation {
    // Get children from 'next' slot
    let children = evaluate_children(ctx, node, "next");

    // Filter out empty allocations
    let active = get_active_children(children);

    if active.is_empty() {
        return empty_allocation();
    }

    // Combine using node's weighting mode
    combine_allocations(ctx, node, &active, &node.weighting, node.vol_window)
}
