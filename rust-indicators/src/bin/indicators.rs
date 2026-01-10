//! CLI tool for computing indicators
//! Usage: indicators <function> <period> < input.json > output.json

use std::io::{self, Read, Write};

fn main() {
    let args: Vec<String> = std::env::args().collect();

    if args.len() < 3 {
        eprintln!("Usage: indicators <function> <period> [extra_args...]");
        eprintln!("Functions: sma, ema, rsi, atr, macd, bollinger_b, etc.");
        eprintln!("Input: JSON array of numbers on stdin");
        eprintln!("Output: JSON array of results on stdout");
        std::process::exit(1);
    }

    let func = &args[1];
    let period: usize = args[2].parse().unwrap_or(14);

    // Read JSON input from stdin
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).expect("Failed to read stdin");

    // Parse as JSON array of f64
    let values: Vec<f64> = serde_json::from_str(&input).expect("Invalid JSON array");

    let result = match func.as_str() {
        "sma" => flowchart_indicators::sma(&values, period),
        "ema" => flowchart_indicators::ema(&values, period),
        "wma" => flowchart_indicators::wma(&values, period),
        "hma" => flowchart_indicators::hma(&values, period),
        "rsi" => flowchart_indicators::rsi(&values, period),
        "roc" => flowchart_indicators::roc(&values, period),
        "bollinger_b" => {
            let std_mult: f64 = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(2.0);
            flowchart_indicators::bollinger_b(&values, period, std_mult)
        }
        "ulcer_index" => flowchart_indicators::ulcer_index_js(&values, period),
        "linreg_slope" => flowchart_indicators::linreg_slope_js(&values, period),
        "price_vs_sma" => flowchart_indicators::price_vs_sma_js(&values, period),
        "rolling_return" => flowchart_indicators::rolling_return(&values, period),
        "trend_r_squared" => flowchart_indicators::trend_r_squared(&values, period),
        "max_drawdown" => flowchart_indicators::max_drawdown_ratio(&values),
        "drawdown" => flowchart_indicators::drawdown_ratio(&values),
        _ => {
            eprintln!("Unknown function: {}", func);
            std::process::exit(1);
        }
    };

    // Output as JSON
    let output = serde_json::to_string(&result).expect("Failed to serialize");
    io::stdout().write_all(output.as_bytes()).expect("Failed to write stdout");
}
