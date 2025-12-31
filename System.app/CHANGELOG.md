# Changelog

All notable changes to System Block Chain are documented here.

## [Unreleased]

### Added
- Dashboard as default landing page for logged-in users
- Changelog visible in Help/Support tab
- Contact information for support
- QuantNexus logo in header with theme-reactive styling
- Logo container spans multiple rows when Model tab is active

### Changed
- "Run" buttons renamed to "Re-run" in Benchmarks for consistency
- Header layout uses CSS grid for better organization
- TradingView charts now match app theme (dark/light mode)
- Indicator dropdowns now use consistent expanded format across all node types
- Monthly Returns heatmap now respects dark/light theme
- Time period selector (RangeNavigator) now respects dark/light theme
- Allocation over time chart Y-axis now shows proper percentages (10%, 20%) instead of decimals
- Monthly Returns and Allocations (recent) are now equal-width cards side by side
- Hidden TradingView/lightweight-charts watermark from all charts

### Fixed
- Save to Watchlist button now shows visual feedback
- Call node copy/paste functionality restored
- Partner Program page now displays correct fee percentages
- Orphaned systems can now be deleted from Admin panel

---

## [1.0.0] - 2025-12-30

### Features
- Visual flowchart-based trading algorithm builder
- Multiple node types: Basic, Function, Indicator, Position, Call
- Backtesting with equity curves and performance metrics
- Benchmark comparisons (SPY, QQQ, VTI, etc.)
- Robustness analysis with bootstrap simulations
- User authentication and preferences
- Watchlists for organizing trading systems
- Admin panel for ticker data management
- Dark/Light theme support with multiple color schemes
