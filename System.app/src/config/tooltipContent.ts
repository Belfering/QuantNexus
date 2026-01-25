// Centralized tooltip content configuration
// All tooltips follow the format: What it is (1 sentence) + How it works (1 sentence with example) + Keyboard shortcut (if applicable)

export const TOOLTIP_CONTENT = {
  // ============================================================================
  // MODEL TAB
  // ============================================================================
  model: {
    // Node types
    nodeTypes: {
      basic: "Basic allocation node that distributes capital among child branches. You can choose between equal weighting (splits evenly) or weighted mode (custom percentages). This is the most common node type for building portfolios.",
      function: "Filter and ranking node that selects assets based on conditions. For example, 'Pick bottom 2 by 10d RSI' selects the 2 stocks with the lowest RSI values. Use this to implement ranking strategies.",
      indicator: "Conditional branching node that splits into 'then' and 'else' paths. For example, 'If SPY > 200 MA' routes to one path when true, another when false. Perfect for implementing market timing logic.",
      position: "Leaf position node that holds an actual ticker or stays empty. This is where you specify which assets to trade (SPY, BIL, etc.) or leave positions empty for cash. These are the endpoints of your strategy tree.",
    },

    // Weight modes
    weightModes: {
      equal: "Equal weighting distributes capital evenly across all child branches. For example, if you have 3 children, each receives 33.3% allocation regardless of performance or other factors. This is the default and simplest weighting mode.",
      weighted: "Custom weighting allows manual allocation percentages for each child branch. For example, you could allocate 60% to stocks and 40% to bonds by setting custom weights. The total must sum to 100%.",
      capped: "Capped weighting applies volatility-based position sizing with a maximum cap. For example, with a 25% cap and 20-day vol window, lower volatility assets get larger allocations up to the cap. Useful for risk parity strategies.",
    },

    // Node actions
    actions: {
      delete: "Remove this node and all its children from the tree. This action cannot be undone except with Ctrl+Z. Keyboard: Delete key",
      copy: "Copy this node and its entire subtree to the clipboard. You can then paste it anywhere in the tree to duplicate the logic. Keyboard: Ctrl+C",
      paste: "Paste the copied node as a child of this node. The pasted subtree will get new IDs but preserve all logic and settings. Keyboard: Ctrl+V",
      addBasic: "Add a new basic allocation node as a child. Basic nodes split capital among their children using equal or weighted distribution. Use this to create portfolio branches.",
      addFunction: "Add a new function node as a child. Function nodes filter or rank assets based on technical indicators. Use this to implement selection strategies like 'top 5 by momentum'.",
      addIndicator: "Add a new indicator node as a child. Indicator nodes create conditional branches (if/then/else) based on market conditions. Use this for market timing or regime detection.",
      addPosition: "Add a new position node as a child. Position nodes hold actual tickers (SPY, BIL, etc.) or remain empty for cash positions. These are the leaf nodes where actual assets are specified.",
      collapse: "Collapse this node's children to save screen space. The logic remains unchanged, just hidden from view. Click again to expand. Useful for managing large strategy trees.",
    },

    // Call chains
    callChains: {
      reference: "Reference a saved call chain (function template) by name. Call chains let you reuse complex indicator logic across multiple nodes without duplication. Changes to the call chain automatically update all references.",
      create: "Create a new call chain (function template) that can be referenced in multiple nodes. For example, create a 'momentum filter' call chain and reuse it throughout your strategy. Edit the template once to update everywhere.",
    },

    // Undo/Redo
    undoRedo: {
      undo: "Undo the last change to the strategy tree. This reverts to the previous state in history. Keyboard: Ctrl+Z",
      redo: "Redo the last undone change. This moves forward in the history stack after an undo. Keyboard: Ctrl+Y",
    },
  },

  // ============================================================================
  // BACKTEST PANEL
  // ============================================================================
  backtest: {
    // Backtest modes
    modes: {
      CC: "Close-to-Close mode: Enter positions at today's close, exit at tomorrow's close. This is the most common mode and reflects end-of-day trading. Formula: Return = (Close_t+1 / Close_t) - 1",
      OO: "Open-to-Open mode: Enter positions at today's open, exit at tomorrow's open. Useful for overnight gap strategies. Formula: Return = (Open_t+1 / Open_t) - 1",
      OC: "Open-to-Close mode: Enter positions at today's open, exit at today's close. This captures intraday movement only. Formula: Return = (Close_t / Open_t) - 1",
      CO: "Close-to-Open mode: Enter positions at today's close, exit at tomorrow's open. This isolates overnight returns and gap risk. Formula: Return = (Open_t+1 / Close_t) - 1",
    },

    // Cost and benchmark
    costBps: "Trading costs in basis points (1 bp = 0.01%). For example, 5 bps means 0.05% cost per trade. This cost is applied to turnover (sum of position changes) to reflect commissions and slippage.",
    benchmark: "Benchmark ticker for comparison (e.g., SPY for S&P 500). The backtest will calculate correlation, beta, and excess returns relative to this benchmark. Leave empty to skip benchmark analysis.",

    // Run button
    runBacktest: "Run backtest on the current strategy tree. This executes the strategy day-by-day through historical data, calculating returns, drawdowns, and performance metrics. Results appear in the Performance, In Depth, and Robustness tabs.",

    // Analysis tabs
    tabs: {
      performance: "Performance tab shows equity curve, drawdown chart, and key metrics (Sharpe, Sortino, CAGR, etc.). This is the primary view for evaluating strategy quality. Compare IS and OOS periods to detect overfitting.",
      inDepth: "In Depth tab shows detailed allocations, monthly returns heatmap, and trade-by-trade analysis. Use this to understand what the strategy is actually doing and identify potential issues.",
      robustness: "Robustness tab shows walk-forward analysis and parameter sensitivity. This tests whether the strategy works out-of-sample and across different time periods. Good strategies show consistent performance here.",
      benchmarks: "Benchmarks tab compares your strategy against common market benchmarks (SPY, AGG, etc.). This helps you understand if your strategy adds value versus simple buy-and-hold alternatives.",
    },

    // IS/OOS split
    isOosSplit: {
      enabled: "Enable In-Sample/Out-of-Sample split for walk-forward testing. The backtest will be divided into IS (training) and OOS (validation) periods to detect overfitting. OOS performance is the true test of strategy robustness.",
      splitDate: "The date that divides In-Sample from Out-of-Sample. Data before this date is IS (used to 'train' or optimize), data after is OOS (used to validate). For example, split at 2020-01-01 to use 2020+ as validation.",
      percentage: "Percentage of data to use for In-Sample period. For example, 70% means first 70% is IS (training), last 30% is OOS (validation). Common splits are 60/40, 70/30, or 80/20.",
    },
  },

  // ============================================================================
  // METRICS (Used in multiple places)
  // ============================================================================
  metrics: {
    // Risk-adjusted returns
    sharpe: "Sharpe Ratio measures risk-adjusted returns using total volatility. Formula: (Return - RiskFreeRate) / Volatility. Higher is better (>1 is good, >2 is excellent). Compares return per unit of total risk.",
    sortino: "Sortino Ratio measures risk-adjusted returns using only downside volatility. Formula: (Return - RiskFreeRate) / DownsideVolatility. Similar to Sharpe but only penalizes downside moves. Better for asymmetric strategies.",
    treynor: "Treynor Ratio measures risk-adjusted returns using systematic risk (beta). Formula: (Return - RiskFreeRate) / Beta. Useful for comparing strategies with different market exposures. Higher values indicate better risk-adjusted performance.",
    calmar: "Calmar Ratio measures return relative to maximum drawdown. Formula: CAGR / MaxDrawdown. For example, 2.0 means the strategy earned 2% CAGR per 1% of max drawdown. Higher is better (>1 is good, >3 is excellent).",

    // Basic performance
    cagr: "Compound Annual Growth Rate: Annualized return assuming reinvestment. Formula: (Final / Initial)^(1/Years) - 1. For example, 12% CAGR means the strategy grows at 12% per year on average.",
    totalReturn: "Total return over the entire backtest period. Formula: (Final Equity / Initial Equity) - 1. For example, 150% means initial $1 grew to $2.50. Does not account for time or risk.",

    // Risk metrics
    vol: "Volatility: Annualized standard deviation of daily returns. Measured as a percentage. For example, 15% volatility means daily returns typically vary within ±1.5%. Lower volatility indicates smoother returns.",
    maxDrawdown: "Maximum Drawdown: Largest peak-to-trough decline during the backtest. Measured as a percentage. For example, 20% means the strategy fell 20% from its highest point. Lower is better.",
    beta: "Beta: Correlation with benchmark scaled by volatility ratio. Formula: Covariance(Strategy, Benchmark) / Variance(Benchmark). Beta of 1.0 means moves with market, <1 is defensive, >1 is aggressive.",

    // Win rate and consistency
    winRate: "Win Rate: Percentage of days with positive returns. For example, 55% means 55% of trading days were profitable. Higher is better but not as important as magnitude of wins vs losses.",
    bestDay: "Best Day: Largest single-day gain during the backtest. Measured as a percentage. For example, 8% means the best day returned +8%. Useful for understanding tail risk and extreme moves.",
    worstDay: "Worst Day: Largest single-day loss during the backtest. Measured as a percentage. For example, -6% means the worst day returned -6%. Important for understanding downside tail risk.",

    // Trading activity
    avgTurnover: "Average Turnover: Average daily position change as a percentage. For example, 10% turnover means 10% of the portfolio changes each day on average. Higher turnover means more trading costs and complexity.",
    avgHoldings: "Average Holdings: Average number of positions held each day. For example, 5.2 means the strategy typically holds 5-6 assets. Higher values indicate more diversification.",

    // Composite metrics
    tim: "Total Integrated Metric: Custom composite metric combining risk and return factors. Higher values indicate better overall strategy quality across multiple dimensions.",
    timar: "TIM Adjusted Return: Modified version of TIM that emphasizes return stability. Used for ranking strategies in optimization.",
    timarMaxDDRatio: "TIMAR to Max Drawdown Ratio: TIMAR divided by maximum drawdown. Measures how much return you get per unit of drawdown risk. Higher is better.",
    timarTimarMaxDD: "TIMAR minus Max Drawdown: Difference between TIMAR and maximum drawdown. Used as a composite metric that rewards high TIMAR and penalizes large drawdowns.",
    cagrCalmar: "CAGR to Calmar Ratio: Composite metric combining growth rate and drawdown resistance. Higher values indicate strong returns with controlled risk.",
  },

  // ============================================================================
  // FORGE TAB
  // ============================================================================
  forge: {
    // Sub-tabs
    subTabs: {
      chronological: "Chronological optimization runs a standard IS/OOS backtest with a fixed split date. The strategy is evaluated on the IS period, then validated on the OOS period. Best for testing single strategy configurations.",
      rolling: "Rolling optimization performs walk-forward analysis with multiple IS/OOS windows. The strategy is re-evaluated on each window to test consistency across time. Reveals if the strategy works across different market regimes.",
      shards: "Shards tab combines multiple optimized parameter sets (shards) into a single strategy. Each shard represents a different branch of the strategy tree. Use this to create ensemble strategies that adapt to different conditions.",
    },

    // IS/OOS controls
    isOosSplit: {
      enabled: "Enable In-Sample/Out-of-Sample split for the optimization. Data before the split becomes IS (training), data after becomes OOS (validation). Essential for detecting overfitting.",
      strategy: "Split strategy determines how to divide data. Chronological splits by date (e.g., first 70% vs last 30%). Percentage splits by data count. Walk-forward uses rolling windows for robust testing.",
      splitDate: "The exact date that divides In-Sample from Out-of-Sample for chronological splits. For example, 2020-01-01 means everything before is IS, everything after is OOS.",
      percentage: "Percentage of data to use for In-Sample when using percentage split. For example, 70 means first 70% is IS (training), last 30% is OOS (validation). Common values are 60-80.",
    },

    // Parameter controls
    parameters: {
      grid: "Parameter grid defines the search space for optimization. Each row specifies min, max, and step values for a parameter. For example, period from 5 to 50 in steps of 5 tests [5, 10, 15, ..., 50].",
      min: "Minimum value for this parameter in the optimization grid. For example, min=5 for RSI period means the optimizer will test periods starting from 5.",
      max: "Maximum value for this parameter in the optimization grid. For example, max=50 for RSI period means the optimizer will test periods up to 50.",
      step: "Step size for this parameter in the optimization grid. For example, step=5 means test [5, 10, 15, 20, ...]. Smaller steps = more combinations = longer runtime.",
    },

    // Shard filtering
    shardFilter: {
      modes: "Filter mode determines how to select top shards. 'All' ranks all branches globally by the chosen metric. 'Per Pattern' selects the top X branches from each unique condition pattern, ensuring diversity.",
      topX: "Number of top branches to select when in 'All' mode. For example, topX=10 selects the 10 best branches globally by the chosen metric (Sharpe, CAGR, etc.). Set to 0 to include all branches.",
      topXPerPattern: "Number of top branches to select per pattern when in 'Per Pattern' mode. For example, topX=2 with 5 patterns gives 10 total branches (2 best from each pattern). Ensures pattern diversity.",
      metric: "Metric used for ranking and filtering branches. For example, 'Sharpe' ranks by Sharpe Ratio, 'CAGR' ranks by growth rate. Choose based on what matters most for your strategy.",
      requirements: "Metric requirements filter out branches that don't meet minimum thresholds. For example, 'Sharpe ≥ 1.0 AND MaxDD ≤ 20%' only keeps branches with good risk-adjusted returns and controlled drawdowns.",
      apply: "Apply the current filter settings to update the strategy preview. This recalculates which branches are included based on your Top X and metric requirements. Click after changing filter settings.",
    },

    // Strategy preview
    strategyPreview: {
      eligible: "Eligible branches are those that pass all metric requirements but aren't necessarily in the top X. These branches meet your quality thresholds but may be filtered out by the Top X limit.",
      filtered: "Filtered branches are the final set included in the combined strategy after applying Top X selection. These are the branches that will actually be used when you run the combined backtest.",
    },
  },

  // ============================================================================
  // ANALYZE TAB
  // ============================================================================
  analyze: {
    // Robustness controls
    robustness: {
      walkForward: "Walk-forward analysis tests strategy consistency across multiple time windows. Each window has an IS period (train) and OOS period (test). Consistent OOS performance indicates a robust strategy.",
      periodSize: "Size of each walk-forward window in days. For example, 252 days = 1 year windows. Smaller windows = more tests but less data per test. Typical values are 126 (6mo), 252 (1yr), or 504 (2yr).",
      windowSize: "Number of periods to include in each walk-forward window. For example, 3 periods with 252-day periods = 756 days (3 years) per window. More periods = more data but fewer windows.",
    },

    // Performance charts
    charts: {
      equity: "Equity curve shows portfolio value over time. The line should trend upward with acceptable drawdowns. Compare IS (in-sample) vs OOS (out-of-sample) to check for overfitting.",
      drawdown: "Drawdown chart shows peak-to-trough declines over time. The graph should recover quickly from drawdowns. Maximum drawdown is the deepest valley on this chart.",
      monthly: "Monthly returns heatmap shows each month's performance. Look for consistent positive months with few large negative months. Seasonal patterns may appear here.",
      allocations: "Allocation chart shows position weights over time. Frequent changes indicate high turnover. Concentrated allocations indicate low diversification.",
    },
  },

  // ============================================================================
  // DASHBOARD TAB
  // ============================================================================
  dashboard: {
    cards: {
      activeBots: "Number of bots currently running live or in paper trading. Each bot represents an actively managed strategy. Click to view details and manage positions.",
      savedStrategies: "Total number of saved strategy templates in your library. These are strategy trees you've created, tested, and saved for future use or deployment.",
      performance: "Combined performance metrics across all active bots. Shows aggregate returns, Sharpe ratio, and drawdown. Use this to monitor overall portfolio health.",
    },

    quickActions: {
      newBot: "Create a new bot from scratch. This opens the Model tab with a blank tree where you can build a new strategy. Start here for new strategy ideas.",
      openSaved: "Open a previously saved strategy from your library. This loads the strategy tree into the Model tab for viewing, editing, or backtesting.",
      importStrategy: "Import a strategy from a JSON file. Supports Atlas format (native), QuantMage format, and Composer format. Use this to load strategies from other systems or backups.",
    },
  },

  // ============================================================================
  // ADMIN TAB
  // ============================================================================
  admin: {
    tickerManagement: {
      tickerList: "List of tickers available for backtesting and live trading. Each ticker must have corresponding parquet data files. Add tickers here before using them in strategies.",
      addTicker: "Add a new ticker to the available list. After adding, you must download historical data for the ticker before it can be used in backtests.",
      removeTicker: "Remove a ticker from the available list. This does not delete the historical data files, just removes it from the selectable list.",
      downloadData: "Download historical OHLC data for all tickers in the list. This fetches data from Yahoo Finance and stores it as parquet files. Required before backtesting.",
    },

    dataStatus: {
      lastUpdate: "Date and time when ticker data was last updated. Historical data should be refreshed periodically (daily or weekly) to include recent market activity.",
      coverage: "Date range of available historical data for each ticker. Backtests can only run within this date range. Gaps in data may cause backtest errors.",
    },
  },

  // ============================================================================
  // NEXUS TAB
  // ============================================================================
  nexus: {
    botManagement: {
      createBot: "Deploy a saved strategy as a live or paper trading bot. The bot will execute trades automatically based on the strategy tree. Choose paper trading to test without real money.",
      editBot: "Modify an existing bot's settings without changing the underlying strategy. You can adjust position sizing, risk limits, and trading schedules.",
      deleteBot: "Permanently remove a bot and stop its trading activity. This does not delete the underlying strategy, just the deployed instance.",
    },

    botStatus: {
      running: "Bot is actively monitoring markets and executing trades according to the strategy. Positions are updated at the specified frequency (daily, weekly, etc.).",
      paused: "Bot is temporarily stopped but not deleted. Existing positions are held but no new trades are executed. Resume to reactivate trading.",
      stopped: "Bot has been stopped and all positions closed. The bot instance is preserved but inactive. Restart to deploy again with fresh positions.",
    },

    riskControls: {
      maxPositionSize: "Maximum allocation to any single position as a percentage of total equity. For example, 25% means no position can exceed 25% of the portfolio. Prevents over-concentration.",
      maxDrawdown: "Maximum allowed drawdown before the bot automatically pauses trading. For example, 20% means the bot stops if equity drops 20% from peak. Acts as an emergency brake.",
      rebalanceFrequency: "How often the bot checks positions and rebalances according to the strategy. Daily = check every day, Weekly = check every Monday. More frequent = more trading costs.",
    },
  },

  // ============================================================================
  // GLOBAL KEYBOARD SHORTCUTS
  // ============================================================================
  keyboard: {
    global: {
      undo: "Undo the last change. Keyboard: Ctrl+Z",
      redo: "Redo the last undone change. Keyboard: Ctrl+Y",
      copy: "Copy selected element. Keyboard: Ctrl+C",
      paste: "Paste copied element. Keyboard: Ctrl+V",
      delete: "Delete selected element. Keyboard: Delete",
      save: "Save current strategy. Keyboard: Ctrl+S",
    },
  },
}
