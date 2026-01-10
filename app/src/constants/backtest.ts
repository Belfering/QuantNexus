// src/constants/backtest.ts
// Backtest mode configuration

import type { BacktestMode } from '../types'

// Backtest mode descriptions for tooltips
export const BACKTEST_MODE_INFO: Record<BacktestMode, { label: string; desc: string; formula: string }> = {
  'CC': {
    label: 'Close→Close',
    desc: 'Buy at close, sell at close. Holds position for full trading days.',
    formula: 'Buy at Close[t] → Sell at Close[t+n]'
  },
  'OO': {
    label: 'Open→Open',
    desc: 'Buy at open, sell at open. Holds position including overnight gaps.',
    formula: 'Buy at Open[t] → Sell at Open[t+n]'
  },
  'OC': {
    label: 'Open→Close',
    desc: 'Buy at open, sell at close. Intraday only - no overnight exposure.',
    formula: 'Buy at Open[t] → Sell at Close[t]'
  },
  'CO': {
    label: 'Close→Open',
    desc: 'Buy at close, sell at next open. Overnight only - no intraday exposure.',
    formula: 'Buy at Close[t] → Sell at Open[t+1]'
  },
}
