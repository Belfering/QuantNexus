// src/backtest/nodes/mod.rs
// Node evaluation dispatcher

pub mod position;
pub mod basic;
pub mod indicator;
pub mod function;
pub mod scaling;
pub mod numbered;
pub mod alt_exit;

use crate::backtest::context::EvalContext;
use crate::backtest::types::{Allocation, BlockKind, FlowNode, empty_allocation};

/// Evaluate a node and return its allocation
pub fn evaluate_node<'a>(ctx: &mut EvalContext<'a>, node: &'a FlowNode) -> Allocation {
    // Store parent node for branch reference resolution
    let prev_parent = ctx.branch_parent_node.take();
    ctx.branch_parent_node = Some(node);

    let result = match node.kind {
        BlockKind::Position => position::evaluate(ctx, node),
        BlockKind::Basic => basic::evaluate(ctx, node),
        BlockKind::Indicator => indicator::evaluate(ctx, node),
        BlockKind::Function => function::evaluate(ctx, node),
        BlockKind::Scaling => scaling::evaluate(ctx, node),
        BlockKind::Numbered => numbered::evaluate(ctx, node),
        BlockKind::AltExit => alt_exit::evaluate(ctx, node),
        BlockKind::Call => {
            // Call nodes reference external strategies - skip for now
            ctx.warn(format!("Call node {} not supported in Rust backend", node.id));
            empty_allocation()
        }
    };

    // Restore previous parent
    ctx.branch_parent_node = prev_parent;

    result
}

/// Evaluate children of a node in a specific slot
pub fn evaluate_children<'a>(
    ctx: &mut EvalContext<'a>,
    node: &'a FlowNode,
    slot: &str,
) -> Vec<(Allocation, &'a FlowNode)> {
    node.get_slot(slot)
        .iter()
        .map(|child| (evaluate_node(ctx, child), *child))
        .collect()
}

/// Filter out empty allocations and get active children
pub fn get_active_children<'a>(
    children: Vec<(Allocation, &'a FlowNode)>,
) -> Vec<(Allocation, &'a FlowNode)> {
    children
        .into_iter()
        .filter(|(alloc, _)| !alloc.is_empty())
        .collect()
}
