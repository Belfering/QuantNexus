# Changelog

All notable changes to Atlas Engine are documented here.

---

## [1.6.0] - 2026-01-07

### Added
- **Date Indicator** - New condition type for seasonal/calendar-based strategies
  - Select specific dates or date ranges (e.g., "Jan 1st to Mar 31st")
  - Handles year-wrapping ranges (e.g., "Nov 1st to Feb 28th" for winter months)
  - Appears in "Date/Calendar" category in indicator dropdown
- **Crosses Above / Crosses Below Comparators** - New condition comparators for detecting threshold crossings
  - Crosses Above: triggers when indicator rises from below to at/above threshold
  - Crosses Below: triggers when indicator falls from above to at/below threshold
  - Works with both static thresholds and dynamic indicator comparisons
- **Custom Indicators** - Create user-defined indicators with formula expressions
  - Define indicators using built-in variables (close, rsi, sma, ema, etc.)
  - Support for rolling functions: sma(var, N), ema(var, N), stdev(var, N), etc.
  - Math functions: abs, sqrt, log, exp, min, max, pow
  - Custom indicators appear in Indicator dropdown alongside built-in indicators
  - Collapsible Custom Indicators panel in Model tab sidebar
- **Variable Library** - Foundation for custom indicator formulas
  - 48 built-in indicators documented with descriptions and formulas
  - Viewable in Admin panel (super admin only) for reference
- **ETFs Only Badge** - Analyze tab bot cards now auto-detect and display "ETFs Only" badge
  - Checks both position tickers AND indicator tickers
  - Badge appears after builder name for qualifying strategies

### Changed
- **Backtest Engine Refactored** - Significant code consolidation
  - Merged duplicate indicator calculation functions
  - Improved warm-up period calculations for consistent lookback handling
  - Better caching for branch equity references
- **Analyze Tab Card Layout** - Improved bot card organization
  - Watchlist tags moved from main line to expanded card content (reduces clutter)
  - Builder display name now shows correctly instead of UUID

### Fixed
- **Dark Mode Correlation Tool** - Fixed text readability issues
  - Correlation matrix cells now use dark text on colored backgrounds
  - Improved contrast for various text elements in dark mode
- **Model Tab Layout** - Improved sidebar and scrollbar behavior
  - Callback Nodes and Custom Indicators sidebar now pins below ETF toolbar
  - Sidebar stops above the horizontal scrollbar area
  - Horizontal scrollbar properly recalculates when sidebar expands/collapses
  - Custom Indicators panel now fills available height when expanded alone

---

## [1.5.2] - 2026-01-04

### Changed
- **All backtests now run on the server** - Removed ~400 lines of local browser-based backtest code
  - Frontend now calls `/api/backtest` endpoint for all strategies (saved and unsaved)
  - Ensures consistent results across all environments
  - Protects IP by keeping evaluation logic server-side only
  - Server handles tree compression, data fetching, evaluation, and metrics calculation

### Fixed
- QM Import: Added `'currentprice'` to indicator mapping for Current Price indicator imports
- QM Import: Debug logging for weighted node imports to trace weighting mode detection

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
- **Current Price now uses adjClose in CC mode** for consistency with indicator calculations
  - Previously Current Price used regular close while indicators (SMA, RSI, etc.) used adjClose
  - This caused "apples to oranges" comparisons (e.g., comparing close price to adjClose-based SMA)
  - Now all CC mode calculations use adjClose for internal consistency

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
