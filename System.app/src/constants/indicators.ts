// src/constants/indicators.ts
// Indicator configuration and metadata

import type { MetricChoice } from '../types'

// Indicators that don't require a window parameter
export const WINDOWLESS_INDICATORS: MetricChoice[] = [
  'Current Price',
  'Date',                     // Calendar-based, no lookback needed
  'Momentum (Weighted)',      // Fixed 1/3/6/12 month
  'Momentum (Unweighted)',    // Fixed 1/3/6/12 month
  'Momentum (12-Month SMA)',  // Fixed 12 month
  'Drawdown',                 // Uses all history from ATH
  'MACD Histogram',           // Fixed 12/26/9
  'PPO Histogram',            // Fixed 12/26/9
  'Laguerre RSI',             // Uses gamma instead of window
]

export const isWindowlessIndicator = (metric: MetricChoice): boolean =>
  WINDOWLESS_INDICATORS.includes(metric)

// Get the actual lookback period needed for an indicator (for warm-up calculations)
export const getIndicatorLookback = (metric: MetricChoice, window: number): number => {
  switch (metric) {
    case 'Current Price':
    case 'Date':
      return 0
    case 'Momentum (Weighted)':
    case 'Momentum (Unweighted)':
      return 252 // 12 months of trading days
    case 'Momentum (12-Month SMA)':
      return 252 // 12 months
    case 'Drawdown':
      return 0 // Uses all history, no fixed lookback needed for warm-up
    case 'MACD Histogram':
    case 'PPO Histogram':
      return 35 // 26 + 9 for signal line
    case 'Laguerre RSI':
      return 10 // Minimal lookback, uses recursive filter
    case 'DEMA':
      return Math.max(1, Math.floor(window || 0)) * 2
    case 'TEMA':
      return Math.max(1, Math.floor(window || 0)) * 3
    case 'KAMA':
      return Math.max(1, Math.floor(window || 0)) + 30 // window + slow period
    case 'ADX':
      return Math.max(1, Math.floor(window || 0)) * 2 // Extra for smoothing
    default:
      return Math.max(1, Math.floor(window || 0))
  }
}

// Indicator metadata with descriptions and formulas
export const INDICATOR_INFO: Record<MetricChoice, { desc: string; formula: string }> = {
  // Price
  'Current Price': { desc: 'The current closing price of the asset', formula: 'Price = Close' },

  // Date-based
  'Date': { desc: 'Check if current date falls within a range (for seasonal strategies)', formula: 'True if dateFrom <= currentDate <= dateTo' },

  // Moving Averages
  'Simple Moving Average': { desc: 'Average price over N periods, equal weight to all', formula: 'SMA = Σ(Close) / N' },
  'Exponential Moving Average': { desc: 'Weighted average giving more weight to recent prices', formula: 'EMA = α×Close + (1-α)×EMA_prev, α=2/(N+1)' },
  'Hull Moving Average': { desc: 'Reduced lag MA using weighted MAs', formula: 'HMA = WMA(2×WMA(N/2) - WMA(N), √N)' },
  'Weighted Moving Average': { desc: 'Linear weighted average, recent prices weighted more', formula: 'WMA = Σ(i×Close_i) / Σ(i), i=1..N' },
  'Wilder Moving Average': { desc: 'Smoothed MA used in RSI, slower response', formula: 'WilderMA = (Prev×(N-1) + Close) / N' },
  'DEMA': { desc: 'Double EMA reduces lag vs single EMA', formula: 'DEMA = 2×EMA - EMA(EMA)' },
  'TEMA': { desc: 'Triple EMA for even less lag', formula: 'TEMA = 3×EMA - 3×EMA² + EMA³' },
  'KAMA': { desc: 'Adapts smoothing based on market noise', formula: 'KAMA = KAMA_prev + SC²×(Close - KAMA_prev)' },

  // RSI & Variants
  'Relative Strength Index': { desc: "Wilder's RSI, momentum oscillator 0-100", formula: 'RSI = 100 - 100/(1 + AvgGain/AvgLoss)' },
  'RSI (SMA)': { desc: 'RSI using simple moving average smoothing', formula: 'RSI_SMA = 100 - 100/(1 + SMA(Gains)/SMA(Losses))' },
  'RSI (EMA)': { desc: 'RSI using exponential moving average smoothing', formula: 'RSI_EMA = 100 - 100/(1 + EMA(Gains)/EMA(Losses))' },
  'Stochastic RSI': { desc: 'Stochastic applied to RSI values, more sensitive', formula: 'StochRSI = (RSI - RSI_Low) / (RSI_High - RSI_Low)' },
  'Laguerre RSI': { desc: "Ehlers' Laguerre filter RSI, smoother", formula: 'Uses 4-element Laguerre filter with gamma' },

  // Momentum
  'Momentum (Weighted)': { desc: '13612W weighted momentum score', formula: '12×M1 + 4×M3 + 2×M6 + M12 (1/3/6/12 month returns)' },
  'Momentum (Unweighted)': { desc: '13612U unweighted momentum score', formula: 'M1 + M3 + M6 + M12 (equal weight)' },
  'Momentum (12-Month SMA)': { desc: 'SMA of 12-month returns', formula: 'SMA(12-month return, N)' },
  'Rate of Change': { desc: 'Percent change over N periods', formula: 'ROC = (Close - Close_N) / Close_N × 100' },
  'Williams %R': { desc: 'Momentum indicator, inverse of Fast Stochastic', formula: '%R = (High_N - Close) / (High_N - Low_N) × -100' },
  'CCI': { desc: 'Measures price deviation from average', formula: 'CCI = (TP - SMA(TP)) / (0.015 × MeanDev)' },
  'Stochastic %K': { desc: 'Fast Stochastic, price position in range', formula: '%K = (Close - Low_N) / (High_N - Low_N) × 100' },
  'Stochastic %D': { desc: 'Slow Stochastic, SMA of %K', formula: '%D = SMA(%K, 3)' },
  'ADX': { desc: 'Trend strength indicator 0-100', formula: 'ADX = SMA(|+DI - -DI| / (+DI + -DI) × 100)' },

  // Volatility
  'Standard Deviation': { desc: 'Volatility of returns over N periods', formula: 'StdDev = √(Σ(r - r̄)² / N)' },
  'Standard Deviation of Price': { desc: 'Volatility of price levels (absolute $)', formula: 'StdDev = √(Σ(P - P̄)² / N)' },
  'Max Drawdown': { desc: 'Largest peak-to-trough decline over N periods', formula: 'MaxDD = max((Peak - Trough) / Peak)' },
  'Drawdown': { desc: 'Current decline from recent peak', formula: 'DD = (Peak - Current) / Peak' },
  'Bollinger %B': { desc: 'Position within Bollinger Bands (0-1)', formula: '%B = (Close - LowerBand) / (UpperBand - LowerBand)' },
  'Bollinger Bandwidth': { desc: 'Width of Bollinger Bands as % of middle', formula: 'BW = (Upper - Lower) / Middle × 100' },
  'ATR': { desc: 'Average True Range, volatility measure', formula: 'ATR = SMA(max(H-L, |H-C_prev|, |L-C_prev|))' },
  'ATR %': { desc: 'ATR as percentage of price', formula: 'ATR% = ATR / Close × 100' },
  'Historical Volatility': { desc: 'Annualized standard deviation of returns', formula: 'HV = StdDev(returns) × √252' },
  'Ulcer Index': { desc: 'Measures downside volatility/drawdown pain', formula: 'UI = √(Σ(DD²) / N)' },

  // Trend
  'Cumulative Return': { desc: 'Total return over N periods', formula: 'CumRet = (Close / Close_N) - 1' },
  'SMA of Returns': { desc: 'Smoothed average of daily returns', formula: 'SMA(daily returns, N)' },
  'Trend Clarity': { desc: 'R² of price regression, trend strength', formula: 'R² = 1 - (SS_res / SS_tot)' },
  'Ultimate Smoother': { desc: "Ehlers' low-lag smoother", formula: '3-pole Butterworth filter' },
  'Linear Reg Slope': { desc: 'Slope of best-fit line through prices', formula: 'Slope = Σ((x-x̄)(y-ȳ)) / Σ(x-x̄)²' },
  'Linear Reg Value': { desc: 'Current value on regression line', formula: 'Value = Intercept + Slope × N' },
  'Price vs SMA': { desc: 'Ratio of price to its moving average', formula: 'Ratio = Close / SMA(Close, N)' },

  // Aroon
  'Aroon Up': { desc: 'Days since highest high (0-100)', formula: 'AroonUp = ((N - DaysSinceHigh) / N) × 100' },
  'Aroon Down': { desc: 'Days since lowest low (0-100)', formula: 'AroonDown = ((N - DaysSinceLow) / N) × 100' },
  'Aroon Oscillator': { desc: 'Difference between Aroon Up and Down', formula: 'AroonOsc = AroonUp - AroonDown' },

  // MACD/PPO
  'MACD Histogram': { desc: 'MACD minus signal line', formula: 'Hist = (EMA12 - EMA26) - EMA9(EMA12 - EMA26)' },
  'PPO Histogram': { desc: 'Percentage Price Oscillator histogram', formula: 'PPO = ((EMA12 - EMA26) / EMA26) × 100' },

  // Volume-based
  'Money Flow Index': { desc: 'Volume-weighted RSI, measures buying/selling pressure', formula: 'MFI = 100 - 100/(1 + PosMF/NegMF)' },
  'OBV Rate of Change': { desc: 'Momentum of cumulative On-Balance Volume', formula: 'OBV ROC = (OBV - OBV_N) / |OBV_N| × 100' },
  'VWAP Ratio': { desc: 'Price vs Volume-Weighted Avg Price (100 = at VWAP)', formula: 'Ratio = Close / VWAP × 100' },
}

// Indicator categories for submenu dropdown
export const INDICATOR_CATEGORIES: Record<string, MetricChoice[]> = {
  'Price': ['Current Price'],
  'Date/Calendar': ['Date'],
  'Moving Averages': [
    'Simple Moving Average',
    'Exponential Moving Average',
    'Hull Moving Average',
    'Weighted Moving Average',
    'Wilder Moving Average',
    'DEMA',
    'TEMA',
    'KAMA',
  ],
  'RSI & Variants': [
    'Relative Strength Index',
    'RSI (SMA)',
    'RSI (EMA)',
    'Stochastic RSI',
    'Laguerre RSI',
  ],
  'Momentum': [
    'Momentum (Weighted)',
    'Momentum (Unweighted)',
    'Momentum (12-Month SMA)',
    'Rate of Change',
    'Williams %R',
    'CCI',
    'Stochastic %K',
    'Stochastic %D',
    'ADX',
  ],
  'Volatility': [
    'Standard Deviation',
    'Standard Deviation of Price',
    'Max Drawdown',
    'Drawdown',
    'Bollinger %B',
    'Bollinger Bandwidth',
    'ATR',
    'ATR %',
    'Historical Volatility',
    'Ulcer Index',
  ],
  'Trend': [
    'Cumulative Return',
    'SMA of Returns',
    'Trend Clarity',
    'Ultimate Smoother',
    'Linear Reg Slope',
    'Linear Reg Value',
    'Price vs SMA',
  ],
  'Aroon': [
    'Aroon Up',
    'Aroon Down',
    'Aroon Oscillator',
  ],
  'MACD/PPO': [
    'MACD Histogram',
    'PPO Histogram',
  ],
  'Volume': [
    'Money Flow Index',
    'OBV Rate of Change',
    'VWAP Ratio',
  ],
}
