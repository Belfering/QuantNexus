// src/components/ui/BacktestModeTag.tsx
// Color-coded badge for backtest execution modes (CC/OO/CO/OC)

import type { BacktestMode } from '@/types'

interface BacktestModeTagProps {
  mode: BacktestMode
  className?: string
}

// Color mapping for each mode
const MODE_COLORS: Record<BacktestMode, string> = {
  'CC': 'bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-500/30',
  'OO': 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  'CO': 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/30',
  'OC': 'bg-purple-500/20 text-purple-700 dark:text-purple-300 border-purple-500/30',
}

export function BacktestModeTag({ mode, className }: BacktestModeTagProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border ${MODE_COLORS[mode]} ${className ?? ''}`}
      title={`Backtest Mode: ${mode}`}
    >
      {mode}
    </span>
  )
}
