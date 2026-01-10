// src/tabs/AdminTab.tsx
// Admin tab component - lazy loadable wrapper for AdminPanel

import { Card, CardContent } from '@/components/ui/card'
import { AdminPanel, type AdminPanelProps } from '@/features/admin'

export type AdminTabProps = AdminPanelProps

export function AdminTab(props: AdminTabProps) {
  return (
    <Card className="h-full flex flex-col overflow-hidden m-4">
      <CardContent className="p-6 flex flex-col h-full overflow-auto">
        <AdminPanel {...props} />
      </CardContent>
    </Card>
  )
}

export default AdminTab
