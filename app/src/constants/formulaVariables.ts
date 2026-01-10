// src/constants/formulaVariables.ts
// Known variables for formula validation (FRD-035 Custom Indicators)
// These match the variables seeded in server/db/index.mjs seedVariableLibrary()

// All known variables from the Variable Library
export const KNOWN_VARIABLES = new Set([
  // Price
  'close',
  'open',
  'high',
  'low',
  'volume',

  // Moving Averages
  'sma',
  'ema',
  'hma',
  'wma',
  'wilderma',
  'dema',
  'tema',
  'kama',

  // RSI & Variants
  'rsi',
  'rsi_sma',
  'rsi_ema',
  'stochrsi',
  'laguerrersi',

  // Momentum
  'momentum_w',
  'momentum_u',
  'momentum_sma12',
  'roc',
  'willr',
  'cci',
  'stochk',
  'stochd',
  'adx',

  // Volatility
  'stdev',
  'stdev_price',
  'maxdd',
  'drawdown',
  'bbpctb',
  'bbwidth',
  'atr',
  'atr_pct',
  'hvol',
  'ulcer',

  // Trend
  'cumret',
  'sma_ret',
  'r2',
  'ultsmooth',
  'linreg_slope',
  'linreg_value',
  'price_vs_sma',

  // Aroon
  'aroon_up',
  'aroon_down',
  'aroon_osc',

  // MACD/PPO
  'macd_hist',
  'ppo_hist',

  // Volume-based
  'mfi',
  'obv_roc',
  'vwap_ratio',
])

// Categories with variable names for UI display
export const VARIABLE_CATEGORIES = {
  'Price': ['close', 'open', 'high', 'low', 'volume'],
  'Moving Averages': ['sma', 'ema', 'hma', 'wma', 'wilderma', 'dema', 'tema', 'kama'],
  'RSI & Variants': ['rsi', 'rsi_sma', 'rsi_ema', 'stochrsi', 'laguerrersi'],
  'Momentum': ['momentum_w', 'momentum_u', 'momentum_sma12', 'roc', 'willr', 'cci', 'stochk', 'stochd', 'adx'],
  'Volatility': ['stdev', 'stdev_price', 'maxdd', 'drawdown', 'bbpctb', 'bbwidth', 'atr', 'atr_pct', 'hvol', 'ulcer'],
  'Trend': ['cumret', 'sma_ret', 'r2', 'ultsmooth', 'linreg_slope', 'linreg_value', 'price_vs_sma'],
  'Aroon': ['aroon_up', 'aroon_down', 'aroon_osc'],
  'MACD/PPO': ['macd_hist', 'ppo_hist'],
  'Volume': ['mfi', 'obv_roc', 'vwap_ratio'],
} as const
