// src/types/indicators.ts
// Indicator types and related enums

export type MetricChoice =
  // Price
  | 'Current Price'
  // Moving Averages
  | 'Simple Moving Average'
  | 'Exponential Moving Average'
  | 'Hull Moving Average'
  | 'Weighted Moving Average'
  | 'Wilder Moving Average'
  | 'DEMA'
  | 'TEMA'
  | 'KAMA'
  // RSI & Variants
  | 'Relative Strength Index'
  | 'RSI (SMA)'
  | 'RSI (EMA)'
  | 'Stochastic RSI'
  | 'Laguerre RSI'
  // Momentum indicators
  | 'Momentum (Weighted)'      // 13612W: 1/3/6/12 month weighted
  | 'Momentum (Unweighted)'    // 13612U: 1/3/6/12 month unweighted
  | 'Momentum (12-Month SMA)'  // SMA12: 12-month SMA based
  | 'Rate of Change'
  | 'Williams %R'
  | 'CCI'
  | 'Stochastic %K'
  | 'Stochastic %D'
  | 'ADX'
  // Volatility
  | 'Max Drawdown'
  | 'Standard Deviation'
  | 'Standard Deviation of Price'
  | 'Drawdown'                 // Current drawdown from ATH (no window)
  | 'Bollinger %B'
  | 'Bollinger Bandwidth'
  | 'ATR'
  | 'ATR %'
  | 'Historical Volatility'
  | 'Ulcer Index'
  // Trend
  | 'Cumulative Return'
  | 'SMA of Returns'
  | 'Ultimate Smoother'        // Ehlers filter
  | 'Trend Clarity'            // R² of linear regression
  | 'Linear Reg Slope'
  | 'Linear Reg Value'
  | 'Price vs SMA'
  // Aroon
  | 'Aroon Up'                 // Days since high
  | 'Aroon Down'               // Days since low
  | 'Aroon Oscillator'         // Up - Down
  // MACD/PPO
  | 'MACD Histogram'           // Fixed 12/26/9
  | 'PPO Histogram'            // Percentage version of MACD
  // Volume-based indicators
  | 'Money Flow Index'         // Volume-weighted RSI (0-100)
  | 'OBV Rate of Change'       // Momentum of On-Balance Volume
  | 'VWAP Ratio'               // Price vs VWAP (100 = at VWAP)

export type RankChoice = 'Bottom' | 'Top'
export type ComparatorChoice = 'lt' | 'gt'

// Indicator overlay data from server
export type IndicatorOverlayData = {
  conditionId: string
  label: string
  leftSeries: Array<{ date: string; value: number | null }>
  rightSeries?: Array<{ date: string; value: number | null }> | null
  rightLabel?: string | null
  threshold?: number | null
  comparator?: string
  color: string
}
