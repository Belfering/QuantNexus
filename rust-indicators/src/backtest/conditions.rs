// src/backtest/conditions.rs
// Condition evaluation logic with AND/OR/null handling

use crate::backtest::context::{EvalContext, PriceDb, IndicatorCache};
use crate::backtest::indicators::metric_at_index;
use crate::backtest::types::{Comparator, ConditionLine, ConditionType, FlowNode};
use chrono::{Datelike, NaiveDate};

/// Ternary logic result for conditions
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ConditionResult {
    True,
    False,
    Null, // Insufficient data
}

impl ConditionResult {
    /// Convert to Option<bool>
    pub fn to_option(self) -> Option<bool> {
        match self {
            ConditionResult::True => Some(true),
            ConditionResult::False => Some(false),
            ConditionResult::Null => None,
        }
    }

    /// AND with another result (null propagates)
    pub fn and(self, other: ConditionResult) -> ConditionResult {
        match (self, other) {
            (ConditionResult::False, _) | (_, ConditionResult::False) => ConditionResult::False,
            (ConditionResult::Null, _) | (_, ConditionResult::Null) => ConditionResult::Null,
            (ConditionResult::True, ConditionResult::True) => ConditionResult::True,
        }
    }

    /// OR with another result
    pub fn or(self, other: ConditionResult) -> ConditionResult {
        match (self, other) {
            (ConditionResult::True, _) | (_, ConditionResult::True) => ConditionResult::True,
            (ConditionResult::Null, _) | (_, ConditionResult::Null) => ConditionResult::Null,
            (ConditionResult::False, ConditionResult::False) => ConditionResult::False,
        }
    }
}

impl From<bool> for ConditionResult {
    fn from(b: bool) -> Self {
        if b {
            ConditionResult::True
        } else {
            ConditionResult::False
        }
    }
}

impl From<Option<bool>> for ConditionResult {
    fn from(opt: Option<bool>) -> Self {
        match opt {
            Some(true) => ConditionResult::True,
            Some(false) => ConditionResult::False,
            None => ConditionResult::Null,
        }
    }
}

/// Evaluate a single condition at a specific index
pub fn evaluate_condition_at_index(
    cache: &mut IndicatorCache,
    db: &PriceDb,
    cond: &ConditionLine,
    index: usize,
    parent_node: Option<&FlowNode>,
    branch_metric_fn: Option<&dyn Fn(&str, &str, u32, usize) -> Option<f64>>,
) -> ConditionResult {
    // Handle date conditions specially
    if cond.metric == "Date" {
        return evaluate_date_condition(db, cond, index);
    }

    // Get left side value
    let left_value = get_condition_value(
        cache, db, &cond.ticker, &cond.metric, cond.window, index,
        parent_node, branch_metric_fn,
    );

    let left = match left_value {
        Some(v) if !v.is_nan() => v,
        _ => return ConditionResult::Null,
    };

    // Get right side value (either threshold or another ticker's metric)
    let right = if cond.expanded {
        // Expanded mode: compare to another ticker's metric
        let right_ticker = cond.right_ticker.as_deref().unwrap_or(&cond.ticker);
        let right_metric = cond.right_metric.as_deref().unwrap_or(&cond.metric);
        let right_window = cond.right_window.unwrap_or(cond.window);

        let right_value = get_condition_value(
            cache, db, right_ticker, right_metric, right_window, index,
            parent_node, branch_metric_fn,
        );

        match right_value {
            Some(v) if !v.is_nan() => v,
            _ => return ConditionResult::Null,
        }
    } else {
        // Simple mode: compare to threshold
        cond.threshold
    };

    // Handle crossing comparators (need yesterday's value)
    match cond.comparator {
        Comparator::CrossAbove | Comparator::CrossBelow => {
            if index == 0 {
                return ConditionResult::Null; // Need yesterday
            }

            let left_yesterday = get_condition_value(
                cache, db, &cond.ticker, &cond.metric, cond.window, index - 1,
                parent_node, branch_metric_fn,
            );

            let left_yesterday = match left_yesterday {
                Some(v) if !v.is_nan() => v,
                _ => return ConditionResult::Null,
            };

            if cond.expanded {
                // Crossing for expanded mode
                let right_ticker = cond.right_ticker.as_deref().unwrap_or(&cond.ticker);
                let right_metric = cond.right_metric.as_deref().unwrap_or(&cond.metric);
                let right_window = cond.right_window.unwrap_or(cond.window);

                let right_yesterday = get_condition_value(
                    cache, db, right_ticker, right_metric, right_window, index - 1,
                    parent_node, branch_metric_fn,
                );

                let right_yesterday = match right_yesterday {
                    Some(v) if !v.is_nan() => v,
                    _ => return ConditionResult::Null,
                };

                let result = match cond.comparator {
                    Comparator::CrossAbove => {
                        left_yesterday < right_yesterday && left >= right
                    }
                    Comparator::CrossBelow => {
                        left_yesterday > right_yesterday && left <= right
                    }
                    _ => unreachable!(),
                };

                return result.into();
            } else {
                // Crossing for threshold
                let result = match cond.comparator {
                    Comparator::CrossAbove => {
                        left_yesterday < right && left >= right
                    }
                    Comparator::CrossBelow => {
                        left_yesterday > right && left <= right
                    }
                    _ => unreachable!(),
                };

                return result.into();
            }
        }
        Comparator::Gt => (left > right).into(),
        Comparator::Lt => (left < right).into(),
    }
}

/// Get a metric value, handling branch references
fn get_condition_value(
    cache: &mut IndicatorCache,
    db: &PriceDb,
    ticker: &str,
    metric: &str,
    window: u32,
    index: usize,
    parent_node: Option<&FlowNode>,
    branch_metric_fn: Option<&dyn Fn(&str, &str, u32, usize) -> Option<f64>>,
) -> Option<f64> {
    // Check for branch reference
    if FlowNode::is_branch_ref(ticker) {
        // Use branch metric function if provided
        if let Some(branch_fn) = branch_metric_fn {
            return branch_fn(ticker, metric, window, index);
        }
        return None;
    }

    // Regular ticker
    metric_at_index(cache, db, ticker, metric, window, index)
}

/// Evaluate a date condition
fn evaluate_date_condition(
    db: &PriceDb,
    cond: &ConditionLine,
    index: usize,
) -> ConditionResult {
    let date_str = match db.date_strings.get(index) {
        Some(d) => d,
        None => return ConditionResult::Null,
    };

    // Parse date string (YYYY-MM-DD)
    let date = match NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
        Ok(d) => d,
        Err(_) => return ConditionResult::Null,
    };

    let current_month = date.month();
    let current_day = date.day();

    // Get from date
    let from_month = cond.date_month.unwrap_or(1);
    let from_day = cond.date_day.unwrap_or(1);

    // Get to date (for range check)
    let (to_month, to_day) = if cond.expanded {
        match &cond.date_to {
            Some(range) => (range.month, range.day),
            None => (from_month, from_day), // Single date
        }
    } else {
        (from_month, from_day) // Single date
    };

    // Check if date is in range
    let in_range = is_date_in_range(
        current_month, current_day,
        from_month, from_day,
        to_month, to_day,
    );

    in_range.into()
}

/// Check if a date is within a range (handles year wrap-around)
fn is_date_in_range(
    month: u32, day: u32,
    from_month: u32, from_day: u32,
    to_month: u32, to_day: u32,
) -> bool {
    let current = (month, day);
    let from = (from_month, from_day);
    let to = (to_month, to_day);

    if from <= to {
        // Normal range (e.g., Jan 1 to Mar 31)
        current >= from && current <= to
    } else {
        // Wrap-around range (e.g., Nov 1 to Feb 28)
        current >= from || current <= to
    }
}

/// Evaluate a condition with forDays support
pub fn evaluate_condition(
    cache: &mut IndicatorCache,
    db: &PriceDb,
    cond: &ConditionLine,
    index: usize,
    parent_node: Option<&FlowNode>,
    branch_metric_fn: Option<&dyn Fn(&str, &str, u32, usize) -> Option<f64>>,
) -> ConditionResult {
    let for_days = cond.for_days.max(1) as usize;

    if for_days == 1 {
        // Simple case: just evaluate at current index
        return evaluate_condition_at_index(cache, db, cond, index, parent_node, branch_metric_fn);
    }

    // forDays > 1: condition must be true for N consecutive days
    if index + 1 < for_days {
        // Not enough history for forDays check
        return ConditionResult::Null;
    }

    // Check all N days
    for offset in 0..for_days {
        let check_index = index - offset;
        let result = evaluate_condition_at_index(
            cache, db, cond, check_index, parent_node, branch_metric_fn,
        );

        match result {
            ConditionResult::False => return ConditionResult::False,
            ConditionResult::Null => return ConditionResult::Null,
            ConditionResult::True => continue,
        }
    }

    ConditionResult::True
}

/// Evaluate multiple conditions with AND/OR logic
///
/// Logic follows standard boolean precedence:
/// - 'if' starts a new AND term (like implicit 'and')
/// - 'and' binds tighter (groups with previous term)
/// - 'or' separates AND groups
///
/// Example: A and B or C = (A AND B) OR C
pub fn evaluate_conditions(
    cache: &mut IndicatorCache,
    db: &PriceDb,
    conditions: &[ConditionLine],
    logic: Option<&str>,
    index: usize,
    parent_node: Option<&FlowNode>,
    branch_metric_fn: Option<&dyn Fn(&str, &str, u32, usize) -> Option<f64>>,
) -> ConditionResult {
    if conditions.is_empty() {
        return ConditionResult::True; // No conditions = always true
    }

    // Special case: single condition
    if conditions.len() == 1 {
        return evaluate_condition(
            cache, db, &conditions[0], index, parent_node, branch_metric_fn,
        );
    }

    // Parse into OR-separated AND groups
    // Each OR term is a group of ANDed conditions
    let mut or_terms: Vec<ConditionResult> = Vec::new();
    let mut current_and_term = ConditionResult::True;

    for cond in conditions {
        let result = evaluate_condition(cache, db, cond, index, parent_node, branch_metric_fn);

        match cond.cond_type {
            ConditionType::If | ConditionType::And => {
                // AND with current term
                current_and_term = current_and_term.and(result);
            }
            ConditionType::Or => {
                // Push current AND term to OR list, start new term
                or_terms.push(current_and_term);
                current_and_term = result;
            }
        }
    }

    // Don't forget the last AND term
    or_terms.push(current_and_term);

    // Combine OR terms
    let mut final_result = ConditionResult::False;
    for term in or_terms {
        final_result = final_result.or(term);
        if final_result == ConditionResult::True {
            break; // Short-circuit
        }
    }

    // Handle optional override logic (e.g., "and" = all must be true)
    if let Some(logic_override) = logic {
        match logic_override {
            "and" => {
                // All conditions must be true (ignore built-in OR)
                let mut result = ConditionResult::True;
                for cond in conditions {
                    let r = evaluate_condition(cache, db, cond, index, parent_node, branch_metric_fn);
                    result = result.and(r);
                    if result == ConditionResult::False {
                        break;
                    }
                }
                return result;
            }
            "or" => {
                // Any condition being true is enough
                let mut result = ConditionResult::False;
                for cond in conditions {
                    let r = evaluate_condition(cache, db, cond, index, parent_node, branch_metric_fn);
                    result = result.or(r);
                    if result == ConditionResult::True {
                        break;
                    }
                }
                return result;
            }
            _ => {}
        }
    }

    final_result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_condition_result_and() {
        assert_eq!(ConditionResult::True.and(ConditionResult::True), ConditionResult::True);
        assert_eq!(ConditionResult::True.and(ConditionResult::False), ConditionResult::False);
        assert_eq!(ConditionResult::True.and(ConditionResult::Null), ConditionResult::Null);
        assert_eq!(ConditionResult::False.and(ConditionResult::Null), ConditionResult::False);
    }

    #[test]
    fn test_condition_result_or() {
        assert_eq!(ConditionResult::True.or(ConditionResult::False), ConditionResult::True);
        assert_eq!(ConditionResult::False.or(ConditionResult::False), ConditionResult::False);
        assert_eq!(ConditionResult::False.or(ConditionResult::Null), ConditionResult::Null);
        assert_eq!(ConditionResult::True.or(ConditionResult::Null), ConditionResult::True);
    }

    #[test]
    fn test_date_in_range() {
        // Normal range
        assert!(is_date_in_range(2, 15, 1, 1, 3, 31));
        assert!(!is_date_in_range(4, 15, 1, 1, 3, 31));

        // Wrap-around range (Nov to Feb)
        assert!(is_date_in_range(12, 15, 11, 1, 2, 28));
        assert!(is_date_in_range(1, 15, 11, 1, 2, 28));
        assert!(!is_date_in_range(6, 15, 11, 1, 2, 28));
    }
}
