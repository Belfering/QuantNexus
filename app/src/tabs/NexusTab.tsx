// src/tabs/NexusTab.tsx
// Nexus tab component - lazy loadable wrapper for NexusPanel

import { NexusPanel, type NexusPanelProps } from '@/features/nexus'

export type NexusTabProps = NexusPanelProps

export function NexusTab(props: NexusTabProps) {
  return <NexusPanel {...props} />
}

export default NexusTab
