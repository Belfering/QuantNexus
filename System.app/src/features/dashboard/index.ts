// src/features/dashboard/index.ts
// Dashboard feature - portfolio equity charts and partner program display

// Types
export type {
  BotReturnSeries,
  DashboardEquityChartProps,
  PartnerTBillChartProps,
} from './types'

// Hooks
export {
  useDashboardInvestments,
  calculateInvestmentPnl,
  type InvestmentWithPnl,
  type UseDashboardInvestmentsParams,
  type UseDashboardInvestmentsResult,
} from './hooks'

// Components
export {
  DashboardEquityChart,
  PartnerTBillChart,
  DashboardPanel,
  type DashboardPanelProps,
} from './components'
