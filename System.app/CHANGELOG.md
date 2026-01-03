# Changelog

All notable changes to Atlas Engine are documented here.

---

## [1.5.1] - 2026-01-03

### Fixed
- Frontend evaluation now includes high/low price data for all indicators
  - Previously only fetched open/close/adjClose - now includes high/low from API
  - Fixes indicators requiring high/low: Aroon, Williams %R, Stochastic, ATR, etc.
- Suppressed duplicate warnings for altExit conditions in `tracePositionContributions`
- Drawdown Recovery fingerprint now correctly measures time to recover from MAX drawdown
  - Previously measured longest time in any drawdown, now tracks recovery from the deepest drawdown
  - Shows max DD percentage and actual recovery time
- Fixed missing `ultSmooth` cache key causing "Cannot read properties of undefined" error
- Fixed Drawdown Recovery using wrong equity curve property (`p.value` instead of `p.equity`)

### Changed
- Robustness analysis now auto-runs after every backtest (no separate button click needed)

---

## [1.5.0] - 2026-01-03

### Added
- OAuth Login - Sign in with Google, Discord, or GitHub (no invite code required for OAuth users)
- Branch Equity References (Subspells) - Scaling nodes can now reference child branch equity curves as indicator sources
  - Enables strategies like "Scale from 1x to 6x based on 60d Volatility of the From branch"
  - Imported from QuantMage as `Subspell "From"` / `Subspell "To"` references
  - Full backtest engine support with branch equity simulation and caching
- 4 new Fragility Fingerprints in Robustness tab:
  - Backtest Length: flags strategies with <5 years of data
  - Turnover Risk: flags high-frequency trading (>50% daily turnover)
  - Position Concentration: flags under-diversified strategies (<3 holdings)
  - Drawdown Recovery: flags slow recovery from max drawdown (>2 years)
- Fragility Fingerprints now displayed in 2x4 grid layout (8 total indicators)
- Background data preloading on login - all tickers cached automatically

---

## [1.4.0] - 2026-01-02

### Added
- Find/Replace instance count - shows number of ticker instances found, updates with filter checkboxes
- Replace button now shows count: "Replace (5)" when instances are found

### Performance
- Tree Compression Engine - optimizes strategy trees before backtest evaluation
  - Gate chain merging: nested if/else with same outcome merged into OR conditions
  - Empty branch pruning: removes branches leading only to Empty positions
  - Single-child collapse: removes unnecessary wrapper nodes
  - Pre-computed ticker locations: O(1) lookup instead of tree traversal per bar

### Fixed
- Tiingo download progress bar now updates correctly (was stuck at 0%)
  - Added stdout line buffering to handle JSON fragmentation across buffer chunks

---

## [1.3.0] - 2026-01-01

### Added
- Portfolio Builder - new Correlation Tool in Analyze tab for building diversified portfolios
  - Three-panel layout: Your Systems | Nexus Systems | Portfolio Builder
  - Mean-variance optimization calculates optimal weights for selected bots
  - Interactive correlation matrix with color-coded cells (green = low, red = high)
  - Optimization metrics: Min Correlation, Min Volatility, Min Beta, Max Sharpe
  - Time period selection: Full History, 1 Year, 3 Years, 5 Years
  - Dynamic recommendations show which bots would best diversify your portfolio
  - Performance filters: Min CAGR, Max Drawdown, Min Sharpe
  - Configurable max weight per bot (10-100%)
  - Search boxes to filter Your Systems and Nexus Systems by name, tags, or builder
  - Save portfolio as watchlist / Load watchlist into portfolio
- Display Nickname field on registration - new users can set their display name during sign up

### Performance
- Backtest engine optimizations - merged duplicate indicator calculation functions
- Improved caching for volatility-weighted allocations

---

## [1.2.0] - 2026-01-01

### Added
- Auto-sync ticker registry before downloads - yFinance and Tiingo buttons now refresh from Tiingo's master list automatically
- Scaling node chart indicator button - toggle indicator overlay on backtest chart (same as Indicator node)
- Dynamic changelog - Help/Support tab now fetches CHANGELOG.md from server instead of hardcoded content

### Changed
- Default theme is now light mode with slate color (users can change in Settings)
- Scaling node UI redesigned - single line with nested badges for cleaner layout
- Scaling node text updated: "From below [X] (100% Then) to above [Y] (100% Else)"
- Sort node indicator dropdown now uses IndicatorDropdown component (consistent styling)
- Sort node Top/Bottom selector text is now bold for better visibility

### Fixed
- Duplicate ticker handling - tickers listed on multiple exchanges (like SPYM) now correctly use the active listing
- Download progress UI now properly updates when all tickers are already synced for the day
- Tickers automatically reactivate when data is successfully downloaded
- Analyze tab now shows display name instead of user ID
- Call chains no longer create infinite duplicates on login (139,000+ duplicates cleaned up)
- Scaling node ticker selector now uses ticker search modal (was broken Select dropdown)
- Scaling node and Sort node indicator dropdowns properly sized (no text cutoff)

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
- Variable Library (allowing the creation of custom indicators)
- Paper trading integration

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
