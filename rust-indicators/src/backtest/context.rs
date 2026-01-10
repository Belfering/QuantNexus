// src/backtest/context.rs
// Evaluation context, price database, and indicator caching

use std::collections::HashMap;
use crate::backtest::types::{Allocation, BacktestMode, CustomIndicator, FlowNode};

// ============================================================================
// Price Database
// ============================================================================

/// Price database with all OHLCV data aligned by date
#[derive(Debug, Clone)]
pub struct PriceDb {
    /// Unix timestamps for each date
    pub dates: Vec<i64>,
    /// Date strings (YYYY-MM-DD format)
    pub date_strings: Vec<String>,
    /// Open prices: ticker -> values
    pub open: HashMap<String, Vec<f64>>,
    /// High prices: ticker -> values
    pub high: HashMap<String, Vec<f64>>,
    /// Low prices: ticker -> values
    pub low: HashMap<String, Vec<f64>>,
    /// Close prices: ticker -> values
    pub close: HashMap<String, Vec<f64>>,
    /// Adjusted close prices: ticker -> values
    pub adj_close: HashMap<String, Vec<f64>>,
    /// Volume: ticker -> values
    pub volume: HashMap<String, Vec<f64>>,
}

impl PriceDb {
    pub fn new() -> Self {
        PriceDb {
            dates: Vec::new(),
            date_strings: Vec::new(),
            open: HashMap::new(),
            high: HashMap::new(),
            low: HashMap::new(),
            close: HashMap::new(),
            adj_close: HashMap::new(),
            volume: HashMap::new(),
        }
    }

    /// Get close price for a ticker at an index
    pub fn get_close(&self, ticker: &str, index: usize) -> Option<f64> {
        self.close.get(ticker).and_then(|v| v.get(index).copied())
    }

    /// Get open price for a ticker at an index
    pub fn get_open(&self, ticker: &str, index: usize) -> Option<f64> {
        self.open.get(ticker).and_then(|v| v.get(index).copied())
    }

    /// Get adjusted close for a ticker at an index (fallback to close)
    pub fn get_adj_close(&self, ticker: &str, index: usize) -> Option<f64> {
        self.adj_close
            .get(ticker)
            .and_then(|v| v.get(index).copied())
            .or_else(|| self.get_close(ticker, index))
    }

    /// Get high price for a ticker at an index
    pub fn get_high(&self, ticker: &str, index: usize) -> Option<f64> {
        self.high.get(ticker).and_then(|v| v.get(index).copied())
    }

    /// Get low price for a ticker at an index
    pub fn get_low(&self, ticker: &str, index: usize) -> Option<f64> {
        self.low.get(ticker).and_then(|v| v.get(index).copied())
    }

    /// Get volume for a ticker at an index
    pub fn get_volume(&self, ticker: &str, index: usize) -> Option<f64> {
        self.volume.get(ticker).and_then(|v| v.get(index).copied())
    }

    /// Get the number of dates
    pub fn len(&self) -> usize {
        self.dates.len()
    }

    /// Check if empty
    pub fn is_empty(&self) -> bool {
        self.dates.is_empty()
    }

    /// Check if a ticker exists
    pub fn has_ticker(&self, ticker: &str) -> bool {
        self.close.contains_key(ticker)
    }

    /// Get all close prices for a ticker
    pub fn get_close_series(&self, ticker: &str) -> Option<&Vec<f64>> {
        self.close.get(ticker)
    }

    /// Get all high prices for a ticker
    pub fn get_high_series(&self, ticker: &str) -> Option<&Vec<f64>> {
        self.high.get(ticker)
    }

    /// Get all low prices for a ticker
    pub fn get_low_series(&self, ticker: &str) -> Option<&Vec<f64>> {
        self.low.get(ticker)
    }

    /// Get all volume for a ticker
    pub fn get_volume_series(&self, ticker: &str) -> Option<&Vec<f64>> {
        self.volume.get(ticker)
    }
}

impl Default for PriceDb {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Branch Equity (cached equity curves for branch references)
// ============================================================================

/// Cached equity curve for a branch reference
#[derive(Debug, Clone)]
pub struct BranchEquity {
    /// Equity values (starting at 1.0)
    pub equity: Vec<f64>,
    /// Daily returns
    pub returns: Vec<f64>,
}

// ============================================================================
// Indicator Cache
// ============================================================================

/// Cache for computed indicators to avoid recomputation
#[derive(Debug, Default)]
pub struct IndicatorCache {
    /// Main indicator cache: (indicator_name, ticker, period) -> values
    pub indicators: HashMap<(String, String, u32), Vec<f64>>,

    /// Pre-computed close arrays (handles ratio tickers like "SPY/AGG")
    pub close_arrays: HashMap<String, Vec<f64>>,

    /// Pre-computed returns arrays
    pub returns_arrays: HashMap<String, Vec<f64>>,

    /// Pre-computed high arrays (for ratio tickers)
    pub high_arrays: HashMap<String, Vec<f64>>,

    /// Pre-computed low arrays (for ratio tickers)
    pub low_arrays: HashMap<String, Vec<f64>>,

    /// Pre-computed volume arrays
    pub volume_arrays: HashMap<String, Vec<f64>>,

    /// Cached branch equity curves: node_id -> BranchEquity
    pub branch_equity: HashMap<String, BranchEquity>,
}

impl IndicatorCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// Get cached indicator values
    pub fn get(&self, indicator: &str, ticker: &str, period: u32) -> Option<&Vec<f64>> {
        self.indicators.get(&(indicator.to_string(), ticker.to_string(), period))
    }

    /// Store indicator values in cache
    pub fn set(&mut self, indicator: &str, ticker: &str, period: u32, values: Vec<f64>) {
        self.indicators.insert(
            (indicator.to_string(), ticker.to_string(), period),
            values,
        );
    }

    /// Get or compute close array for a ticker (handles ratio tickers)
    pub fn get_or_compute_close(&mut self, ticker: &str, db: &PriceDb) -> Option<Vec<f64>> {
        if let Some(cached) = self.close_arrays.get(ticker) {
            return Some(cached.clone());
        }

        let values = if FlowNode::is_ratio_ticker(ticker) {
            // Ratio ticker: compute numerator / denominator
            if let Some((num, den)) = FlowNode::parse_ratio_ticker(ticker) {
                let num_prices = db.get_close_series(num)?;
                let den_prices = db.get_close_series(den)?;

                num_prices
                    .iter()
                    .zip(den_prices.iter())
                    .map(|(n, d)| if *d != 0.0 { n / d } else { f64::NAN })
                    .collect()
            } else {
                return None;
            }
        } else {
            // Regular ticker
            db.get_close_series(ticker)?.clone()
        };

        self.close_arrays.insert(ticker.to_string(), values.clone());
        Some(values)
    }

    /// Get or compute returns array for a ticker
    pub fn get_or_compute_returns(&mut self, ticker: &str, db: &PriceDb) -> Option<Vec<f64>> {
        if let Some(cached) = self.returns_arrays.get(ticker) {
            return Some(cached.clone());
        }

        let closes = self.get_or_compute_close(ticker, db)?;
        let mut returns = vec![f64::NAN; closes.len()];

        for i in 1..closes.len() {
            if closes[i - 1] != 0.0 && !closes[i - 1].is_nan() && !closes[i].is_nan() {
                returns[i] = (closes[i] - closes[i - 1]) / closes[i - 1];
            }
        }

        self.returns_arrays.insert(ticker.to_string(), returns.clone());
        Some(returns)
    }

    /// Get or compute high array for a ticker (for ratio tickers)
    pub fn get_or_compute_high(&mut self, ticker: &str, db: &PriceDb) -> Option<Vec<f64>> {
        if let Some(cached) = self.high_arrays.get(ticker) {
            return Some(cached.clone());
        }

        let values = if FlowNode::is_ratio_ticker(ticker) {
            // For ratio tickers, use the ratio of closes (highs don't make sense for ratios)
            self.get_or_compute_close(ticker, db)?
        } else {
            db.get_high_series(ticker)?.clone()
        };

        self.high_arrays.insert(ticker.to_string(), values.clone());
        Some(values)
    }

    /// Get or compute low array for a ticker (for ratio tickers)
    pub fn get_or_compute_low(&mut self, ticker: &str, db: &PriceDb) -> Option<Vec<f64>> {
        if let Some(cached) = self.low_arrays.get(ticker) {
            return Some(cached.clone());
        }

        let values = if FlowNode::is_ratio_ticker(ticker) {
            // For ratio tickers, use the ratio of closes (lows don't make sense for ratios)
            self.get_or_compute_close(ticker, db)?
        } else {
            db.get_low_series(ticker)?.clone()
        };

        self.low_arrays.insert(ticker.to_string(), values.clone());
        Some(values)
    }

    /// Get cached branch equity
    pub fn get_branch_equity(&self, node_id: &str) -> Option<&BranchEquity> {
        self.branch_equity.get(node_id)
    }

    /// Store branch equity
    pub fn set_branch_equity(&mut self, node_id: &str, equity: BranchEquity) {
        self.branch_equity.insert(node_id.to_string(), equity);
    }
}

// ============================================================================
// Evaluation Context
// ============================================================================

/// Decision price mode
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum DecisionPrice {
    Open,
    #[default]
    Close,
}

impl From<&BacktestMode> for DecisionPrice {
    fn from(mode: &BacktestMode) -> Self {
        match mode {
            BacktestMode::OO | BacktestMode::OC => DecisionPrice::Open,
            BacktestMode::CC | BacktestMode::CO => DecisionPrice::Close,
        }
    }
}

/// Context passed during node evaluation
pub struct EvalContext<'a> {
    /// Price database
    pub db: &'a PriceDb,

    /// Indicator cache (mutable for lazy computation)
    pub cache: &'a mut IndicatorCache,

    /// Current day index for allocation decision
    pub decision_index: usize,

    /// Index to use for indicator values (may differ from decision_index)
    pub indicator_index: usize,

    /// Price mode (open or close)
    pub decision_price: DecisionPrice,

    /// Backtest mode
    pub backtest_mode: BacktestMode,

    /// Persistent state for altExit nodes: node_id -> is_entered
    pub alt_exit_state: &'a mut HashMap<String, bool>,

    /// Warnings collected during evaluation
    pub warnings: Vec<String>,

    /// Custom indicators (FRD-035)
    pub custom_indicators: &'a [CustomIndicator],

    /// Current branch parent node (for resolving branch references)
    pub branch_parent_node: Option<&'a FlowNode>,

    /// Track if any scaling node used a fallback due to null data
    pub used_scaling_fallback: bool,

    /// Depth counter to prevent infinite recursion in branch references
    pub branch_depth: u32,
}

impl<'a> EvalContext<'a> {
    /// Maximum branch reference depth to prevent infinite recursion
    pub const MAX_BRANCH_DEPTH: u32 = 10;

    /// Create a new evaluation context
    pub fn new(
        db: &'a PriceDb,
        cache: &'a mut IndicatorCache,
        backtest_mode: BacktestMode,
        alt_exit_state: &'a mut HashMap<String, bool>,
        custom_indicators: &'a [CustomIndicator],
    ) -> Self {
        let decision_price = DecisionPrice::from(&backtest_mode);

        EvalContext {
            db,
            cache,
            decision_index: 0,
            indicator_index: 0,
            decision_price,
            backtest_mode,
            alt_exit_state,
            warnings: Vec::new(),
            custom_indicators,
            branch_parent_node: None,
            used_scaling_fallback: false,
            branch_depth: 0,
        }
    }

    /// Set the current day indices
    pub fn set_day(&mut self, decision_index: usize) {
        self.decision_index = decision_index;
        // For open-based decisions, use previous day's indicators
        self.indicator_index = match self.decision_price {
            DecisionPrice::Open => decision_index.saturating_sub(1),
            DecisionPrice::Close => decision_index,
        };
    }

    /// Get the current date string
    pub fn current_date(&self) -> &str {
        self.db
            .date_strings
            .get(self.decision_index)
            .map(|s| s.as_str())
            .unwrap_or("")
    }

    /// Add a warning
    pub fn warn(&mut self, message: String) {
        self.warnings.push(message);
    }

    /// Check if we can go deeper in branch references
    pub fn can_recurse_branch(&self) -> bool {
        self.branch_depth < Self::MAX_BRANCH_DEPTH
    }

    /// Create a sub-context for branch evaluation (with incremented depth)
    pub fn branch_subcontext(&mut self) -> EvalContext<'_> {
        EvalContext {
            db: self.db,
            cache: self.cache,
            decision_index: self.decision_index,
            indicator_index: self.indicator_index,
            decision_price: self.decision_price,
            backtest_mode: self.backtest_mode.clone(),
            alt_exit_state: self.alt_exit_state,
            warnings: Vec::new(),
            custom_indicators: self.custom_indicators,
            branch_parent_node: None,
            used_scaling_fallback: false,
            branch_depth: self.branch_depth + 1,
        }
    }
}

// ============================================================================
// Ticker Location Tracking (for O(1) lookups)
// ============================================================================

/// Pre-computed ticker locations in the tree
#[derive(Debug, Default)]
pub struct TickerLocations {
    /// node_id -> set of tickers used in that node
    pub by_node: HashMap<String, Vec<String>>,
}

impl TickerLocations {
    pub fn new() -> Self {
        Self::default()
    }

    /// Collect all tickers from a tree
    pub fn collect(node: &FlowNode) -> Self {
        let mut locations = Self::new();
        Self::collect_recursive(node, &mut locations);
        locations
    }

    fn collect_recursive(node: &FlowNode, locations: &mut TickerLocations) {
        let mut tickers = Vec::new();

        // Collect from positions
        if let Some(positions) = &node.positions {
            for pos in positions {
                if pos != "Empty" && !pos.is_empty() {
                    tickers.push(pos.clone());
                }
            }
        }

        // Collect from conditions
        if let Some(conditions) = &node.conditions {
            for cond in conditions {
                if !cond.ticker.is_empty() && cond.ticker != "Empty" {
                    tickers.push(cond.ticker.clone());
                }
                if let Some(right) = &cond.right_ticker {
                    if !right.is_empty() && right != "Empty" {
                        tickers.push(right.clone());
                    }
                }
            }
        }

        // Collect from scaling
        if let Some(ticker) = &node.scale_ticker {
            if !ticker.is_empty() && ticker != "Empty" {
                tickers.push(ticker.clone());
            }
        }

        // Collect from function metric (the ticker for ranking)
        if let Some(metric) = &node.metric {
            if !metric.is_empty() {
                // Function nodes use children's tickers, not a specific one
            }
        }

        // Store
        if !tickers.is_empty() {
            locations.by_node.insert(node.id.clone(), tickers);
        }

        // Recurse into children
        for children in node.children.values() {
            for child in children.iter().flatten() {
                Self::collect_recursive(child, locations);
            }
        }

        // Entry/exit conditions
        if let Some(conditions) = &node.entry_conditions {
            for cond in conditions {
                if !cond.ticker.is_empty() && cond.ticker != "Empty" {
                    locations
                        .by_node
                        .entry(node.id.clone())
                        .or_default()
                        .push(cond.ticker.clone());
                }
            }
        }
        if let Some(conditions) = &node.exit_conditions {
            for cond in conditions {
                if !cond.ticker.is_empty() && cond.ticker != "Empty" {
                    locations
                        .by_node
                        .entry(node.id.clone())
                        .or_default()
                        .push(cond.ticker.clone());
                }
            }
        }

        // Numbered items
        if let Some(numbered) = &node.numbered {
            for item in &numbered.items {
                for cond in &item.conditions {
                    if !cond.ticker.is_empty() && cond.ticker != "Empty" {
                        locations
                            .by_node
                            .entry(node.id.clone())
                            .or_default()
                            .push(cond.ticker.clone());
                    }
                }
            }
        }
    }

    /// Get all unique tickers across all nodes
    pub fn all_tickers(&self) -> Vec<String> {
        let mut all: Vec<String> = self
            .by_node
            .values()
            .flatten()
            .cloned()
            .collect();
        all.sort();
        all.dedup();
        all
    }
}
