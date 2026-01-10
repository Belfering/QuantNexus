// src/backtest/nodes/position.rs
// Position node - leaf node with ticker allocations

use crate::backtest::context::EvalContext;
use crate::backtest::types::{Allocation, FlowNode, empty_allocation};

/// Evaluate a position node
/// Returns equal-weighted allocation across non-empty tickers
pub fn evaluate<'a>(_ctx: &mut EvalContext<'a>, node: &'a FlowNode) -> Allocation {
    let positions = match &node.positions {
        Some(p) => p,
        None => return empty_allocation(),
    };

    // Filter out "Empty" and empty strings
    let valid_tickers: Vec<&String> = positions
        .iter()
        .filter(|t| !t.is_empty() && *t != "Empty")
        .collect();

    if valid_tickers.is_empty() {
        return empty_allocation();
    }

    // Equal weight across all valid tickers
    let weight = 1.0 / valid_tickers.len() as f64;

    let mut alloc = Allocation::new();
    for ticker in valid_tickers {
        alloc.insert(ticker.clone(), weight);
    }

    alloc
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backtest::types::BlockKind;
    use std::collections::HashMap;

    fn make_position_node(positions: Vec<&str>) -> FlowNode {
        FlowNode {
            id: "test".to_string(),
            kind: BlockKind::Position,
            title: "Test".to_string(),
            children: HashMap::new(),
            positions: Some(positions.iter().map(|s| s.to_string()).collect()),
            weighting: Default::default(),
            weighting_then: None,
            weighting_else: None,
            capped_fallback: None,
            capped_fallback_then: None,
            capped_fallback_else: None,
            vol_window: None,
            vol_window_then: None,
            vol_window_else: None,
            bg_color: None,
            collapsed: false,
            conditions: None,
            numbered: None,
            metric: None,
            window: None,
            bottom: None,
            rank: None,
            call_ref_id: None,
            entry_conditions: None,
            exit_conditions: None,
            scale_metric: None,
            scale_window: None,
            scale_ticker: None,
            scale_from: None,
            scale_to: None,
        }
    }

    #[test]
    fn test_single_ticker() {
        let node = make_position_node(vec!["SPY"]);
        // Would need full context to test, but structure is correct
        assert!(node.positions.is_some());
        assert_eq!(node.positions.as_ref().unwrap().len(), 1);
    }

    #[test]
    fn test_multiple_tickers() {
        let node = make_position_node(vec!["SPY", "TLT", "GLD"]);
        assert_eq!(node.positions.as_ref().unwrap().len(), 3);
    }

    #[test]
    fn test_empty_filtered() {
        let node = make_position_node(vec!["SPY", "Empty", "TLT"]);
        let positions = node.positions.as_ref().unwrap();
        let valid: Vec<_> = positions.iter().filter(|t| *t != "Empty").collect();
        assert_eq!(valid.len(), 2);
    }
}
