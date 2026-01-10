// src/backtest/types.rs
// Core types for the backtest engine, matching frontend TypeScript types

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ============================================================================
// Node Types
// ============================================================================

/// Block kinds matching frontend BlockKind type
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BlockKind {
    Basic,
    Function,
    Indicator,
    Numbered,
    Position,
    Call,
    AltExit,
    Scaling,
}

/// Weight distribution mode for children
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum WeightMode {
    #[default]
    Equal,
    Defined,
    Inverse,
    Pro,
    Capped,
}

/// Quantifier for numbered nodes
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NumberedQuantifier {
    Any,
    All,
    None,
    Exactly,
    AtLeast,
    AtMost,
    Ladder,
}

/// Condition type (logical operator)
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ConditionType {
    If,
    And,
    Or,
}

/// Comparator for conditions
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Comparator {
    Lt,
    Gt,
    CrossAbove,
    CrossBelow,
}

/// Rank direction for function nodes
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub enum RankChoice {
    Bottom,
    Top,
}

// ============================================================================
// Condition Types
// ============================================================================

/// Date range for date conditions
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DateRange {
    pub month: u32,
    pub day: u32,
}

/// A single condition line
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConditionLine {
    pub id: String,
    #[serde(rename = "type")]
    pub cond_type: ConditionType,
    #[serde(default)]
    pub window: u32,
    #[serde(default)]
    pub metric: String,
    #[serde(default)]
    pub comparator: Comparator,
    #[serde(default)]
    pub ticker: String,
    #[serde(default)]
    pub threshold: f64,
    // Expanded mode (ticker vs ticker comparison)
    #[serde(default)]
    pub expanded: bool,
    pub right_window: Option<u32>,
    pub right_metric: Option<String>,
    pub right_ticker: Option<String>,
    // forDays support (condition must hold for N consecutive days)
    #[serde(default = "default_one")]
    pub for_days: u32,
    // Date-specific fields
    pub date_month: Option<u32>,
    pub date_day: Option<u32>,
    pub date_to: Option<DateRange>,
}

fn default_one() -> u32 {
    1
}

impl Default for Comparator {
    fn default() -> Self {
        Comparator::Gt
    }
}

/// An item in a numbered node
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NumberedItem {
    pub id: String,
    #[serde(default)]
    pub conditions: Vec<ConditionLine>,
    pub group_logic: Option<String>, // "and" | "or"
}

/// Numbered node configuration
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NumberedConfig {
    pub quantifier: NumberedQuantifier,
    #[serde(default)]
    pub n: u32,
    #[serde(default)]
    pub items: Vec<NumberedItem>,
}

// ============================================================================
// FlowNode
// ============================================================================

/// The main flow node type - recursive tree structure
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowNode {
    pub id: String,
    pub kind: BlockKind,
    #[serde(default)]
    pub title: String,

    // Children: Map from slot ("next", "then", "else", "ladder-N") to array of nodes
    #[serde(default)]
    pub children: HashMap<String, Vec<Option<Box<FlowNode>>>>,

    // Position node fields
    pub positions: Option<Vec<String>>,

    // Weighting
    #[serde(default)]
    pub weighting: WeightMode,
    pub weighting_then: Option<WeightMode>,
    pub weighting_else: Option<WeightMode>,
    pub capped_fallback: Option<String>,
    pub capped_fallback_then: Option<String>,
    pub capped_fallback_else: Option<String>,
    pub vol_window: Option<u32>,
    pub vol_window_then: Option<u32>,
    pub vol_window_else: Option<u32>,

    // Display
    pub bg_color: Option<String>,
    #[serde(default)]
    pub collapsed: bool,

    // Indicator node fields
    pub conditions: Option<Vec<ConditionLine>>,

    // Numbered node fields
    pub numbered: Option<NumberedConfig>,

    // Function node fields
    pub metric: Option<String>,
    pub window: Option<u32>,
    pub bottom: Option<u32>,
    pub rank: Option<RankChoice>,

    // Call node fields
    pub call_ref_id: Option<String>,

    // AltExit node fields
    pub entry_conditions: Option<Vec<ConditionLine>>,
    pub exit_conditions: Option<Vec<ConditionLine>>,

    // Scaling node fields
    pub scale_metric: Option<String>,
    pub scale_window: Option<u32>,
    pub scale_ticker: Option<String>,
    pub scale_from: Option<f64>,
    pub scale_to: Option<f64>,
}

impl FlowNode {
    /// Get children for a specific slot
    pub fn get_slot(&self, slot: &str) -> Vec<&FlowNode> {
        self.children
            .get(slot)
            .map(|children| {
                children
                    .iter()
                    .filter_map(|c| c.as_ref().map(|b| b.as_ref()))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Check if this is a branch reference ticker
    pub fn is_branch_ref(ticker: &str) -> bool {
        ticker.starts_with("branch:")
    }

    /// Parse branch reference to get the slot name
    pub fn parse_branch_ref(ticker: &str) -> Option<&str> {
        if ticker.starts_with("branch:") {
            Some(&ticker[7..])
        } else {
            None
        }
    }

    /// Check if this is a ratio ticker (e.g., "SPY/AGG")
    pub fn is_ratio_ticker(ticker: &str) -> bool {
        ticker.contains('/') && !ticker.starts_with("branch:")
    }

    /// Parse ratio ticker into (numerator, denominator)
    pub fn parse_ratio_ticker(ticker: &str) -> Option<(&str, &str)> {
        if Self::is_ratio_ticker(ticker) {
            let parts: Vec<&str> = ticker.split('/').collect();
            if parts.len() == 2 {
                return Some((parts[0], parts[1]));
            }
        }
        None
    }
}

// ============================================================================
// Custom Indicators (FRD-035)
// ============================================================================

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomIndicator {
    pub id: String,
    pub name: String,
    pub formula: String,
    pub created_at: Option<i64>,
}

// ============================================================================
// API Request/Response Types
// ============================================================================

/// Backtest mode (timing of entry/exit)
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, Default)]
pub enum BacktestMode {
    #[default]
    CC, // Close-to-Close
    OO, // Open-to-Open
    OC, // Open-to-Close (same day)
    CO, // Close-to-Open
}

/// Request to run a backtest
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BacktestRequest {
    /// The FlowNode tree as a JSON string (double-encoded)
    pub payload: String,
    #[serde(default)]
    pub mode: BacktestMode,
    #[serde(default)]
    pub cost_bps: f64,
    pub custom_indicators: Option<Vec<CustomIndicator>>,
}

/// A point on the equity curve
#[derive(Debug, Clone, Serialize)]
pub struct EquityPoint {
    pub date: String,
    pub equity: f64,
}

/// A marker on the equity curve
#[derive(Debug, Clone, Serialize)]
pub struct EquityMarker {
    pub time: i64,
    pub text: String,
}

/// Warning from backtest
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BacktestWarning {
    pub time: i64,
    pub date: String,
    pub message: String,
}

/// Allocation entry for a single ticker
#[derive(Debug, Clone, Serialize)]
pub struct AllocationEntry {
    pub ticker: String,
    pub weight: f64,
}

/// Allocation row for a single day
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AllocationRow {
    pub date: String,
    pub entries: Vec<AllocationEntry>,
}

/// Day row with full details
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayRow {
    pub time: i64,
    pub date: String,
    pub equity: f64,
    pub drawdown: f64,
    pub gross_return: f64,
    pub net_return: f64,
    pub turnover: f64,
    pub cost: f64,
    pub holdings: Vec<AllocationEntry>,
}

/// Monthly return
#[derive(Debug, Clone, Serialize)]
pub struct MonthlyReturn {
    pub year: i32,
    pub month: u32,
    pub value: f64,
}

/// Backtest performance metrics
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BacktestMetrics {
    pub start_date: String,
    pub end_date: String,
    pub days: u32,
    pub years: f64,
    pub total_return: f64,
    pub cagr: f64,
    pub vol: f64,
    pub max_drawdown: f64,
    pub calmar: f64,
    pub sharpe: f64,
    pub sortino: f64,
    pub treynor: f64,
    pub beta: f64,
    pub win_rate: f64,
    pub best_day: f64,
    pub worst_day: f64,
    pub avg_turnover: f64,
    pub avg_holdings: f64,
}

/// Full backtest response
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BacktestResponse {
    pub equity_curve: Vec<EquityPoint>,
    pub benchmark_curve: Option<Vec<EquityPoint>>,
    pub drawdown_points: Vec<EquityPoint>,
    pub markers: Vec<EquityMarker>,
    pub metrics: BacktestMetrics,
    pub days: Vec<DayRow>,
    pub allocations: Vec<AllocationRow>,
    pub warnings: Vec<BacktestWarning>,
    pub monthly: Vec<MonthlyReturn>,
}

// ============================================================================
// Allocation Type (internal)
// ============================================================================

/// Allocation result from evaluating a node
/// Maps ticker -> weight (0.0 to 1.0)
pub type Allocation = HashMap<String, f64>;

/// Empty allocation (go to cash)
pub fn empty_allocation() -> Allocation {
    HashMap::new()
}

/// Merge two allocations with given weights
pub fn merge_allocations(a: &Allocation, b: &Allocation, weight_a: f64, weight_b: f64) -> Allocation {
    let mut result = Allocation::new();

    for (ticker, &weight) in a {
        *result.entry(ticker.clone()).or_insert(0.0) += weight * weight_a;
    }

    for (ticker, &weight) in b {
        *result.entry(ticker.clone()).or_insert(0.0) += weight * weight_b;
    }

    result
}

/// Normalize allocation weights to sum to 1.0
pub fn normalize_allocation(alloc: &mut Allocation) {
    let total: f64 = alloc.values().sum();
    if total > 0.0 {
        for weight in alloc.values_mut() {
            *weight /= total;
        }
    }
}
