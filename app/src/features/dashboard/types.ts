// src/features/dashboard/types.ts
// Dashboard feature types

import type { EquityCurvePoint, ThemeMode } from '@/types'
import type { UTCTimestamp } from 'lightweight-charts'

/**
 * Bot return series data for dashboard charts
 */
export type BotReturnSeries = {
  id: string
  name: string
  color: string
  data: EquityCurvePoint[]
}

/**
 * Props for DashboardEquityChart component
 */
export interface DashboardEquityChartProps {
  portfolioData: EquityCurvePoint[]
  botSeries: BotReturnSeries[]
  theme: ThemeMode
}

/**
 * Props for PartnerTBillChart component
 */
export interface PartnerTBillChartProps {
  data: { time: UTCTimestamp; value: number }[]
  theme: ThemeMode
}
