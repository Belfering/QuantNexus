// src/constants/indicatorDefaults.ts
// Intelligent defaults and ranges for indicator threshold optimization

import type { MetricChoice } from '@/types'

/**
 * Configuration for an indicator's threshold optimization
 */
export interface IndicatorConfig {
  /** Default threshold value when creating new condition */
  defaultThreshold: number
  /** Minimum value for optimization range */
  min: number
  /** Maximum value for optimization range */
  max: number
  /** Step increment for optimization */
  step: number
  /** Tooltip description of valid range and typical usage */
  rangeDescription: string
  /** Whether range is price-relative (needs current value for dynamic calculation) */
  isPriceRelative?: boolean
}

/**
 * Comprehensive indicator defaults for all 47 built-in indicators
 * Organized by category for maintainability
 */
export const INDICATOR_DEFAULTS: Record<MetricChoice, IndicatorConfig> = {
  // ============================================================================
  // PRICE-BASED INDICATORS
  // ============================================================================
  'Current Price': {
    defaultThreshold: 100,
    min: -20,
    max: 20,
    step: 1,
    rangeDescription: '±20% of current price in 1% increments',
    isPriceRelative: true,
  },

  // ============================================================================
  // DATE/CALENDAR
  // ============================================================================
  'Date': {
    defaultThreshold: 1,
    min: 1,
    max: 365,
    step: 1,
    rangeDescription: 'Day of year (1-365)',
  },

  // ============================================================================
  // MOVING AVERAGES (Price-Relative)
  // ============================================================================
  'Simple Moving Average': {
    defaultThreshold: 100,
    min: -20,
    max: 20,
    step: 1,
    rangeDescription: '±20% of current value in 1% increments',
    isPriceRelative: true,
  },
  'Exponential Moving Average': {
    defaultThreshold: 100,
    min: -20,
    max: 20,
    step: 1,
    rangeDescription: '±20% of current value in 1% increments',
    isPriceRelative: true,
  },
  'Hull Moving Average': {
    defaultThreshold: 100,
    min: -20,
    max: 20,
    step: 1,
    rangeDescription: '±20% of current value in 1% increments',
    isPriceRelative: true,
  },
  'Weighted Moving Average': {
    defaultThreshold: 100,
    min: -20,
    max: 20,
    step: 1,
    rangeDescription: '±20% of current value in 1% increments',
    isPriceRelative: true,
  },
  'Wilder Moving Average': {
    defaultThreshold: 100,
    min: -20,
    max: 20,
    step: 1,
    rangeDescription: '±20% of current value in 1% increments',
    isPriceRelative: true,
  },
  'DEMA': {
    defaultThreshold: 100,
    min: -20,
    max: 20,
    step: 1,
    rangeDescription: '±20% of current value in 1% increments',
    isPriceRelative: true,
  },
  'TEMA': {
    defaultThreshold: 100,
    min: -20,
    max: 20,
    step: 1,
    rangeDescription: '±20% of current value in 1% increments',
    isPriceRelative: true,
  },
  'KAMA': {
    defaultThreshold: 100,
    min: -20,
    max: 20,
    step: 1,
    rangeDescription: '±20% of current value in 1% increments',
    isPriceRelative: true,
  },

  // ============================================================================
  // RSI & VARIANTS (0-100 Oscillators)
  // ============================================================================
  'Relative Strength Index': {
    defaultThreshold: 30,
    min: 0,
    max: 100,
    step: 1,
    rangeDescription: '0-100 in increments of 1 (typical oversold: 30, overbought: 70)',
  },
  'RSI (SMA)': {
    defaultThreshold: 30,
    min: 0,
    max: 100,
    step: 1,
    rangeDescription: '0-100 in increments of 1 (typical oversold: 30, overbought: 70)',
  },
  'RSI (EMA)': {
    defaultThreshold: 30,
    min: 0,
    max: 100,
    step: 1,
    rangeDescription: '0-100 in increments of 1 (typical oversold: 30, overbought: 70)',
  },
  'Stochastic RSI': {
    defaultThreshold: 20,
    min: 0,
    max: 100,
    step: 1,
    rangeDescription: '0-100 in increments of 1 (more sensitive, use lower thresholds: 20/80)',
  },
  'Laguerre RSI': {
    defaultThreshold: 20,
    min: 0,
    max: 100,
    step: 1,
    rangeDescription: '0-100 in increments of 1 (smoother RSI, use lower thresholds: 20/80)',
  },

  // ============================================================================
  // MOMENTUM INDICATORS
  // ============================================================================
  'Momentum (Weighted)': {
    defaultThreshold: 0,
    min: -50,
    max: 50,
    step: 1,
    rangeDescription: '-50 to 50 in increments of 1 (13612W weighted score)',
  },
  'Momentum (Unweighted)': {
    defaultThreshold: 0,
    min: -50,
    max: 50,
    step: 1,
    rangeDescription: '-50 to 50 in increments of 1 (13612U equal weight score)',
  },
  'Momentum (12-Month SMA)': {
    defaultThreshold: 0,
    min: -20,
    max: 20,
    step: 1,
    rangeDescription: '-20 to 20 in increments of 1 (smoothed annual momentum)',
  },
  'Rate of Change': {
    defaultThreshold: 0,
    min: -50,
    max: 50,
    step: 1,
    rangeDescription: '-50% to 50% in increments of 1% (percent change over period)',
  },
  'Williams %R': {
    defaultThreshold: 20,
    min: 0,
    max: 100,
    step: 1,
    rangeDescription: '0-100 in increments of 1 (oversold when low: 20, overbought: 80)',
  },
  'CCI': {
    defaultThreshold: 0,
    min: -300,
    max: 300,
    step: 10,
    rangeDescription: '-300 to 300 in increments of 10 (±100 for buy/sell signals)',
  },
  'Stochastic %K': {
    defaultThreshold: 20,
    min: 0,
    max: 100,
    step: 1,
    rangeDescription: '0-100 in increments of 1 (fast stochastic, oversold: 20, overbought: 80)',
  },
  'Stochastic %D': {
    defaultThreshold: 20,
    min: 0,
    max: 100,
    step: 1,
    rangeDescription: '0-100 in increments of 1 (slow stochastic, oversold: 20, overbought: 80)',
  },
  'ADX': {
    defaultThreshold: 25,
    min: 0,
    max: 100,
    step: 1,
    rangeDescription: '0-100 in increments of 1 (25+ indicates strong trend)',
  },

  // ============================================================================
  // VOLATILITY INDICATORS
  // ============================================================================
  'Standard Deviation': {
    defaultThreshold: 2,
    min: -5,
    max: 5,
    step: 0.1,
    rangeDescription: '-5 to 5 in increments of 0.1 (2σ is common threshold)',
  },
  'Standard Deviation of Price': {
    defaultThreshold: 10,
    min: -100,
    max: 100,
    step: 1,
    rangeDescription: 'Price-dependent absolute volatility (adjust based on asset price)',
  },
  'Max Drawdown': {
    defaultThreshold: -20,
    min: -100,
    max: 0,
    step: 1,
    rangeDescription: '-100% to 0% in increments of 1% (worst peak-to-trough decline)',
  },
  'Drawdown': {
    defaultThreshold: -10,
    min: -100,
    max: 0,
    step: 1,
    rangeDescription: '-100% to 0% in increments of 1% (current decline from peak)',
  },
  'Bollinger %B': {
    defaultThreshold: 50,
    min: 0,
    max: 100,
    step: 5,
    rangeDescription: '0-100 in increments of 5 (position within Bollinger Bands, 50 = middle)',
  },
  'Bollinger Bandwidth': {
    defaultThreshold: 20,
    min: 0,
    max: 50,
    step: 1,
    rangeDescription: '0-50 in increments of 1 (width as % of middle band)',
  },
  'ATR': {
    defaultThreshold: 10,
    min: -50,
    max: 50,
    step: 5,
    rangeDescription: '±50% of current ATR in 5% increments',
    isPriceRelative: true,
  },
  'ATR %': {
    defaultThreshold: 2,
    min: 0,
    max: 10,
    step: 0.1,
    rangeDescription: '0-10% in increments of 0.1% (ATR as percentage of price)',
  },
  'Historical Volatility': {
    defaultThreshold: 20,
    min: 0,
    max: 100,
    step: 1,
    rangeDescription: '0-100 in increments of 1 (annualized volatility as percentage)',
  },
  'Ulcer Index': {
    defaultThreshold: 10,
    min: 0,
    max: 50,
    step: 1,
    rangeDescription: '0-50 in increments of 1 (downside volatility measure)',
  },

  // ============================================================================
  // TREND INDICATORS
  // ============================================================================
  'Cumulative Return': {
    defaultThreshold: 0,
    min: -100,
    max: 200,
    step: 5,
    rangeDescription: '-100% to 200% in increments of 5% (full loss to 2x gain)',
  },
  'SMA of Returns': {
    defaultThreshold: 0,
    min: -10,
    max: 10,
    step: 0.5,
    rangeDescription: '-10% to 10% in increments of 0.5% (smoothed daily returns)',
  },
  'Trend Clarity': {
    defaultThreshold: 70,
    min: 0,
    max: 100,
    step: 5,
    rangeDescription: '0-100 in increments of 5 (R² threshold, 70+ is strong trend)',
  },
  'Ultimate Smoother': {
    defaultThreshold: 100,
    min: -20,
    max: 20,
    step: 1,
    rangeDescription: '±20% of current value in 1% increments',
    isPriceRelative: true,
  },
  'Linear Reg Slope': {
    defaultThreshold: 0,
    min: -10,
    max: 10,
    step: 0.1,
    rangeDescription: '-10 to 10 in increments of 0.1 (daily slope of regression line)',
  },
  'Linear Reg Value': {
    defaultThreshold: 100,
    min: -20,
    max: 20,
    step: 1,
    rangeDescription: '±20% of current value in 1% increments',
    isPriceRelative: true,
  },
  'Price vs SMA': {
    defaultThreshold: 0,
    min: -50,
    max: 50,
    step: 1,
    rangeDescription: '-50% to 50% in increments of 1% (percentage above/below moving average)',
  },

  // ============================================================================
  // AROON INDICATORS
  // ============================================================================
  'Aroon Up': {
    defaultThreshold: 50,
    min: 0,
    max: 100,
    step: 5,
    rangeDescription: '0-100 in increments of 5 (days since highest high, 50 = midpoint)',
  },
  'Aroon Down': {
    defaultThreshold: 50,
    min: 0,
    max: 100,
    step: 5,
    rangeDescription: '0-100 in increments of 5 (days since lowest low, 50 = midpoint)',
  },
  'Aroon Oscillator': {
    defaultThreshold: 0,
    min: -100,
    max: 100,
    step: 10,
    rangeDescription: '-100 to 100 in increments of 10 (Aroon Up minus Aroon Down)',
  },

  // ============================================================================
  // MACD/PPO INDICATORS
  // ============================================================================
  'MACD Histogram': {
    defaultThreshold: 0,
    min: -5,
    max: 5,
    step: 0.1,
    rangeDescription: '-5 to 5 in increments of 0.1 (typical range for crossovers)',
  },
  'PPO Histogram': {
    defaultThreshold: 0,
    min: -10,
    max: 10,
    step: 0.5,
    rangeDescription: '-10 to 10 in increments of 0.5 (percentage price oscillator)',
  },

  // ============================================================================
  // VOLUME INDICATORS
  // ============================================================================
  'Money Flow Index': {
    defaultThreshold: 20,
    min: 0,
    max: 100,
    step: 1,
    rangeDescription: '0-100 in increments of 1 (volume-weighted RSI, oversold: 20, overbought: 80)',
  },
  'OBV Rate of Change': {
    defaultThreshold: 0,
    min: -100,
    max: 100,
    step: 5,
    rangeDescription: '-100% to 100% in increments of 5% (On-Balance Volume momentum)',
  },
  'VWAP Ratio': {
    defaultThreshold: 100,
    min: 80,
    max: 120,
    step: 1,
    rangeDescription: '80-120 in increments of 1 (100 = at VWAP, <100 below, >100 above)',
  },
}

/**
 * Get indicator configuration for a given metric
 * Falls back to generic defaults for custom indicators
 */
export function getIndicatorConfig(metric: MetricChoice): IndicatorConfig {
  return INDICATOR_DEFAULTS[metric] ?? {
    defaultThreshold: 0,
    min: -20,
    max: 20,
    step: 1,
    rangeDescription: 'Generic range: ±20 in increments of 1',
  }
}

/**
 * Calculate dynamic range for price-relative indicators
 */
export function getPriceRelativeRange(
  config: IndicatorConfig,
  currentValue: number
): { min: number; max: number; step: number } {
  if (!config.isPriceRelative || !currentValue || currentValue === 0) {
    return { min: config.min, max: config.max, step: config.step }
  }

  // Convert percentage ranges to absolute values
  const min = currentValue * (1 + config.min / 100)
  const max = currentValue * (1 + config.max / 100)
  const step = currentValue * (config.step / 100)

  return {
    min: Math.round(min * 100) / 100,
    max: Math.round(max * 100) / 100,
    step: Math.max(0.01, Math.round(step * 100) / 100),
  }
}
