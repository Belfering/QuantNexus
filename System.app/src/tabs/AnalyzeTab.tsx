// src/tabs/AnalyzeTab.tsx
// Analyze tab component - lazy loadable wrapper for AnalyzePanel

import { AnalyzePanel, type AnalyzePanelProps } from '@/features/analyze'

export type AnalyzeTabProps = AnalyzePanelProps

export function AnalyzeTab(props: AnalyzeTabProps) {
  return <AnalyzePanel {...props} />
}

export default AnalyzeTab
