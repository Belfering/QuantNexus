// src/backtest/mod.rs
// Full backtest engine module

pub mod types;
pub mod context;
pub mod conditions;
pub mod nodes;
pub mod weighting;
pub mod branch;
pub mod metrics;
pub mod runner;
pub mod indicators;
pub mod vectorized_engine;

// Re-export main types and functions
pub use types::*;
pub use context::*;
pub use runner::run_backtest;
pub use vectorized_engine::{can_vectorize, run_backtest_vectorized};
