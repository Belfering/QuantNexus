// src/tabs/DashboardTab.tsx
// Dashboard tab component - lazy loadable wrapper for DashboardPanel

import { DashboardPanel, type DashboardPanelProps } from '@/features/dashboard'

export type DashboardTabProps = DashboardPanelProps

export function DashboardTab(props: DashboardTabProps) {
  return <DashboardPanel {...props} />
}

export default DashboardTab
