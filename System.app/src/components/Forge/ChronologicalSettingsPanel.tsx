// src/components/Forge/ChronologicalSettingsPanel.tsx
// Settings panel for Split tab (chronological optimization)

import { Card } from '@/components/ui/card'
import { RequirementsEditor } from './RequirementsEditor'
import { ISOOSSplitCard } from './ISOOSSplitCard'
import type { EligibilityRequirement } from '@/types/admin'
import type { ISOOSSplitConfig } from '@/types/split'

interface ChronologicalSettingsPanelProps {
  requirements: EligibilityRequirement[]
  onRequirementsChange: (requirements: EligibilityRequirement[]) => void
  splitConfig?: ISOOSSplitConfig
  onSplitConfigChange: (config: ISOOSSplitConfig) => void
}

export function ChronologicalSettingsPanel({
  requirements,
  onRequirementsChange,
  splitConfig,
  onSplitConfigChange
}: ChronologicalSettingsPanelProps) {
  return (
    <Card className="p-6">
      <div className="font-bold mb-4">Setting and Pass/Fail Criteria</div>
      <div className="grid grid-cols-3 gap-4">
        {/* Left and Middle - Requirements Editor */}
        <div className="col-span-2">
          <RequirementsEditor
            requirements={requirements}
            onRequirementsChange={onRequirementsChange}
            label="Current Requirements"
          />
        </div>

        {/* Right Section - IS/OOS Split Configuration (Chronological only) */}
        <div className="p-4 bg-muted/30 rounded-lg">
          <div className="text-sm font-medium mb-3">IS/OOS Split</div>
          <ISOOSSplitCard
            splitConfig={splitConfig}
            onSplitConfigChange={onSplitConfigChange}
            lockStrategy="chronological"
          />
        </div>
      </div>
    </Card>
  )
}
