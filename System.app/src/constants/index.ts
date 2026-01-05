// src/constants/index.ts
// Barrel export for all constants

// Indicator constants
export {
  WINDOWLESS_INDICATORS,
  isWindowlessIndicator,
  getIndicatorLookback,
  INDICATOR_INFO,
  INDICATOR_CATEGORIES,
} from './indicators'

// Theme constants
export { COLOR_THEMES } from './themes'

// Backtest constants
export { BACKTEST_MODE_INFO } from './backtest'

// Config constants
export {
  API_BASE,
  TICKER_DATALIST_ID,
  USED_TICKERS_DATALIST_ID,
  CURRENT_USER_KEY,
  userDataKey,
  OHLC_CACHE_TTL,
  POPULAR_TICKERS,
} from './config'
