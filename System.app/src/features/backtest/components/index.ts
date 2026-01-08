// src/features/backtest/components/index.ts
// Barrel export for backtest components

export {
  BacktestModeDropdown,
  type BacktestModeDropdownProps,
} from './BacktestModeDropdown'

export {
  EquityChart,
  type EquityChartProps,
} from './EquityChart'

export {
  DrawdownChart,
  type DrawdownChartProps,
} from './DrawdownChart'

export {
  RangeNavigator,
  type RangeNavigatorProps,
} from './RangeNavigator'

export {
  AllocationChart,
  type AllocationChartProps,
  type AllocationSeriesData,
} from './AllocationChart'

export {
  MonthlyHeatmap,
  type MonthlyHeatmapProps,
  renderMonthlyHeatmap,
} from './MonthlyHeatmap'

export {
  BacktesterPanel,
} from './BacktesterPanel'
