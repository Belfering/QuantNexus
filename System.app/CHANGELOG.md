# Changelog

All notable changes to Atlas Engine are documented here.

---

## [1.2.0] - 2026-01-01

### Added
- Auto-sync ticker registry before downloads - yFinance and Tiingo buttons now refresh from Tiingo's master list automatically

### Fixed
- Duplicate ticker handling - tickers listed on multiple exchanges (like SPYM) now correctly use the active listing
- Download progress UI now properly updates when all tickers are already synced for the day
- Tickers automatically reactivate when data is successfully downloaded

---

## [1.1.0] - 2025-12-31

### Added
- Tiingo-only download mode - download data exclusively from Tiingo API
- Stop button for downloads - cancel running downloads mid-process
- Ticker search modal - search by ticker symbol or company name with ETF/Stock filters
- Popular tickers (SPY, QQQ, IWM, etc.) shown first when opening ticker search
- Backtest mode tooltips explaining each timing mode (CC, OO, OC, CO)
- Number inputs auto-select on focus for easier editing

### Performance
- API response compression (gzip) - 80% smaller payloads
- Batch candles endpoint - fetch multiple tickers in one request
- Common tickers pre-cached at startup (SPY, QQQ, IWM, etc.)
- Backtest data filters from 1993 onwards (20-40% less data)
- Optimized date intersection algorithm
- Parallelized benchmark metrics computation

### Changed
- Ticker selection uses modal dialog instead of dropdown/datalist
- TradingView charts match app theme (dark/light mode)
- Monthly Returns heatmap respects dark/light theme
- Time period selector respects dark/light theme
- Allocation chart Y-axis shows percentages instead of decimals
- Monthly Returns and Allocations cards are equal-width side by side
- Hidden chart watermarks for cleaner visuals
- Number input spinner arrows hidden

### Fixed
- Save to Watchlist button visual feedback
- Call node copy/paste functionality
- Ticker search modal displays exchange information
- Ticker search works for nested position nodes
- Model tab flowchart container fills available height

---

## Coming Soon

- Position Node (adding Tickers) rework to be less click intensive
- Correlation matrix/portfolio builder tool
- Variable Library (allowing the creation of custom indicators)

---

## [1.0.0] - 2025-12-30

### Features
- Visual flowchart-based trading algorithm builder
- Multiple node types: Basic, Function, Indicator, Position, Call
- Backtesting with equity curves and performance metrics
- Benchmark comparisons (SPY, QQQ, VTI, etc.)
- Robustness analysis with bootstrap simulations
- Watchlists for organizing trading systems
- Dark/Light theme support with multiple color schemes
