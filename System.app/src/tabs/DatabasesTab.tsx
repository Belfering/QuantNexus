// src/tabs/DatabasesTab.tsx
// Databases tab component - lazy loadable wrapper for DatabasesPanel

import { Card, CardContent } from '@/components/ui/card'
import { DatabasesPanel, type DatabasesPanelProps } from '@/features/admin'

export type DatabasesTabProps = DatabasesPanelProps

export function DatabasesTab(props: DatabasesTabProps) {
  return (
    <Card className="h-full flex flex-col overflow-hidden m-4">
      <CardContent className="p-6 flex flex-col h-full overflow-auto">
        <DatabasesPanel {...props} />
      </CardContent>
    </Card>
  )
}

export default DatabasesTab
