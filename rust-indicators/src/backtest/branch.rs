// src/backtest/branch.rs
// Branch equity simulation for branch references

use crate::backtest::context::{BranchEquity, EvalContext, PriceDb};
use crate::backtest::indicators::branch_metric_at_index;
use crate::backtest::nodes::evaluate_node;
use crate::backtest::types::{Allocation, FlowNode};

/// Simulate a branch's equity curve
/// Used for branch references like "branch:from", "branch:to"
pub fn simulate_branch_equity(
    ctx: &mut EvalContext,
    branch_node: &FlowNode,
    start_index: usize,
    end_index: usize,
) -> Option<BranchEquity> {
    // Check cache first
    if let Some(cached) = ctx.cache.get_branch_equity(&branch_node.id) {
        return Some(cached.clone());
    }

    // Check recursion depth
    if !ctx.can_recurse_branch() {
        return None;
    }

    let len = ctx.db.len();
    if end_index >= len || start_index >= end_index {
        return None;
    }

    // Create equity and returns arrays
    let mut equity = vec![1.0; len];
    let mut returns = vec![0.0; len];

    // Simulate from start to end
    let mut current_equity = 1.0;

    for i in start_index..=end_index {
        // Create sub-context for this simulation
        // Note: shares alt_exit_state with parent context (branch simulations don't need isolation)
        let mut sub_ctx = ctx.branch_subcontext();
        sub_ctx.decision_index = i;
        sub_ctx.indicator_index = match sub_ctx.decision_price {
            crate::backtest::context::DecisionPrice::Open => i.saturating_sub(1),
            crate::backtest::context::DecisionPrice::Close => i,
        };

        // Evaluate the branch node
        let alloc = evaluate_node(&mut sub_ctx, branch_node);

        // Calculate daily return from allocation
        let daily_return = calculate_daily_return(ctx.db, &alloc, i);

        returns[i] = daily_return;
        current_equity *= 1.0 + daily_return;
        equity[i] = current_equity;
    }

    let result = BranchEquity { equity, returns };

    // Cache the result
    ctx.cache.set_branch_equity(&branch_node.id, result.clone());

    Some(result)
}

/// Calculate daily return from an allocation
fn calculate_daily_return(db: &PriceDb, alloc: &Allocation, index: usize) -> f64 {
    if alloc.is_empty() || index == 0 {
        return 0.0;
    }

    let mut total_return = 0.0;

    for (ticker, &weight) in alloc {
        let today = db.get_adj_close(ticker, index);
        let yesterday = db.get_adj_close(ticker, index - 1);

        if let (Some(t), Some(y)) = (today, yesterday) {
            if y != 0.0 && !y.is_nan() && !t.is_nan() {
                total_return += weight * ((t - y) / y);
            }
        }
    }

    total_return
}

/// Get a metric value from a branch equity curve
pub fn get_branch_metric(
    ctx: &mut EvalContext,
    parent_node: &FlowNode,
    branch_ref: &str,
    metric: &str,
    window: u32,
    index: usize,
) -> Option<f64> {
    // Parse branch reference
    let slot_name = FlowNode::parse_branch_ref(branch_ref)?;

    // Map branch name to slot
    let slot = match slot_name {
        "from" | "then" | "enter" => "then",
        "to" | "else" | "exit" => "else",
        _ => return None,
    };

    // Get the branch node
    let branch_children = parent_node.get_slot(slot);
    if branch_children.is_empty() {
        return None;
    }

    // Use first child as the branch (typically there's only one)
    let branch_node = branch_children[0];

    // Get or simulate branch equity
    let branch_equity = simulate_branch_equity(ctx, branch_node, 0, index)?;

    // Calculate metric on the equity curve
    branch_metric_at_index(
        &branch_equity.equity,
        &branch_equity.returns,
        metric,
        window,
        index,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_branch_ref_parsing() {
        assert_eq!(FlowNode::parse_branch_ref("branch:from"), Some("from"));
        assert_eq!(FlowNode::parse_branch_ref("branch:to"), Some("to"));
        assert_eq!(FlowNode::parse_branch_ref("SPY"), None);
    }
}
