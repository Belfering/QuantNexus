//! Native Rust backtest CLI
//!
//! Usage: backtest <parquet_dir> [ticker1,ticker2,...]

use arrow::array::{Float64Array, Array};
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
use serde::Serialize;
use std::fs::File;
use std::path::PathBuf;
use std::time::Instant;

#[derive(Serialize)]
struct TickerIndicators {
    ticker: String,
    bars: usize,
    rsi_14: Option<f64>,
    sma_20: Option<f64>,
    sma_50: Option<f64>,
    price_vs_sma_50: Option<f64>,
    roc_10: Option<f64>,
    ulcer_index: Option<f64>,
    max_drawdown: Option<f64>,
    atr_14: Option<f64>,
}

fn last_valid(values: &[f64]) -> Option<f64> {
    values.iter().rev().find(|v| !v.is_nan()).copied()
}

fn read_column(path: &PathBuf, name: &str) -> Vec<f64> {
    let file = match File::open(path) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("  Failed to open {}: {}", path.display(), e);
            return vec![];
        }
    };

    let builder = match ParquetRecordBatchReaderBuilder::try_new(file) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("  Failed to create builder for {}: {}", path.display(), e);
            return vec![];
        }
    };

    // Print schema for debugging
    if name == "Close" {
        let schema = builder.schema();
        eprintln!("  Schema for {}: {:?}", path.file_name().unwrap_or_default().to_str().unwrap_or("?"),
            schema.fields().iter().map(|f| f.name().as_str()).collect::<Vec<_>>());
    }

    let reader = match builder.build() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("  Failed to build reader for {}: {}", path.display(), e);
            return vec![];
        }
    };

    let mut result = Vec::new();
    for batch in reader.flatten() {
        if let Some(col) = batch.column_by_name(name) {
            if let Some(arr) = col.as_any().downcast_ref::<Float64Array>() {
                for i in 0..arr.len() {
                    result.push(if arr.is_null(i) { f64::NAN } else { arr.value(i) });
                }
            }
        }
    }
    result
}

fn process_ticker(path: &PathBuf) -> Option<TickerIndicators> {
    let ticker = path.file_stem()?.to_str()?.to_string();

    // Column names are capitalized in these parquet files
    let closes = read_column(path, "Close");
    let highs = read_column(path, "High");
    let lows = read_column(path, "Low");

    if closes.is_empty() {
        return None;
    }

    let bars = closes.len();
    let rsi = flowchart_indicators::rsi(&closes, 14);
    let sma_20 = flowchart_indicators::sma(&closes, 20);
    let sma_50 = flowchart_indicators::sma(&closes, 50);
    let price_vs_sma = flowchart_indicators::price_vs_sma_js(&closes, 50);
    let roc = flowchart_indicators::roc(&closes, 10);
    let ulcer = flowchart_indicators::ulcer_index_js(&closes, 14);
    let max_dd = flowchart_indicators::max_drawdown_ratio(&closes);
    let atr = flowchart_indicators::atr(&highs, &lows, &closes, 14);

    Some(TickerIndicators {
        ticker,
        bars,
        rsi_14: last_valid(&rsi),
        sma_20: last_valid(&sma_20),
        sma_50: last_valid(&sma_50),
        price_vs_sma_50: last_valid(&price_vs_sma),
        roc_10: last_valid(&roc),
        ulcer_index: last_valid(&ulcer),
        max_drawdown: last_valid(&max_dd),
        atr_14: last_valid(&atr),
    })
}

fn main() {
    let args: Vec<String> = std::env::args().collect();

    if args.len() < 2 {
        eprintln!("Usage: backtest <parquet_dir> [ticker1,ticker2,...]");
        std::process::exit(1);
    }

    let parquet_dir = PathBuf::from(&args[1]);
    let tickers: Option<Vec<&str>> = args.get(2).map(|s| s.split(',').collect());

    let start = Instant::now();

    let mut files: Vec<PathBuf> = std::fs::read_dir(&parquet_dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().map_or(false, |e| e == "parquet"))
        .filter(|p| {
            if let Some(ref t) = tickers {
                let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("");
                t.contains(&stem)
            } else {
                true
            }
        })
        .collect();

    files.sort();
    eprintln!("Processing {} tickers...", files.len());

    let results: Vec<TickerIndicators> = files.iter().filter_map(process_ticker).collect();
    let elapsed = start.elapsed();

    println!("{}", serde_json::to_string_pretty(&results).unwrap());

    eprintln!("\n───────────────────────────────");
    eprintln!("Processed: {} tickers", results.len());
    eprintln!("Time:      {:.2}ms", elapsed.as_secs_f64() * 1000.0);
    eprintln!("Per ticker: {:.3}ms", elapsed.as_secs_f64() * 1000.0 / results.len().max(1) as f64);
    eprintln!("───────────────────────────────");
}
