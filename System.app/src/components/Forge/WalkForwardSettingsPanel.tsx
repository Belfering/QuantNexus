// src/components/Forge/WalkForwardSettingsPanel.tsx
// Settings panel for Walk Forward tab (rolling optimization)

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ISOOSSplitCard } from './ISOOSSplitCard'
import { METRIC_LABELS, type EligibilityMetric, type EligibilityRequirement } from '@/types/admin'
import type { ISOOSSplitConfig } from '@/types/split'
import { MetricDropdown } from './MetricDropdown'

interface WalkForwardSettingsPanelProps {
  requirements: EligibilityRequirement[]
  onRequirementsChange: (requirements: EligibilityRequirement[]) => void
  splitConfig?: ISOOSSplitConfig
  onSplitConfigChange: (config: ISOOSSplitConfig) => void
}

export function WalkForwardSettingsPanel({
  requirements,
  onRequirementsChange,
  splitConfig,
  onSplitConfigChange
}: WalkForwardSettingsPanelProps) {
  const [newMetric, setNewMetric] = useState<EligibilityMetric>('cagr')
  const [newComparison, setNewComparison] = useState<'at_least' | 'at_most'>('at_least')
  const [newMetricValue, setNewMetricValue] = useState(0)

  // Helper to determine if a metric should display as percentage
  const isPercentageMetric = (metric: EligibilityMetric): boolean => {
    return ['cagr', 'maxDrawdown', 'tim', 'timar', 'winRate', 'vol', 'avgTurnover', 'timarTimarMaxDD', 'cagrCalmar'].includes(metric)
  }

  // Format metric value for display
  const formatMetricValue = (metric: EligibilityMetric, value: number): string => {
    if (isPercentageMetric(metric)) {
      return `${value} %`
    }
    return value.toString()
  }

  const handleAddMetricRequirement = () => {
    const newReq: EligibilityRequirement = {
      id: `metric-${Date.now()}`,
      type: 'metric',
      metric: newMetric,
      comparison: newComparison,
      value: newMetricValue
    }
    onRequirementsChange([...requirements, newReq])
  }

  const handleRemoveRequirement = (id: string) => {
    onRequirementsChange(requirements.filter(r => r.id !== id))
  }

  return (
    <Card className="p-6">
      <div className="font-bold mb-4">Setting and Pass/Fail Criteria</div>
      <div className="grid grid-cols-3 gap-4">
        {/* Left Column - IS/OOS Split Configuration */}
        <div className="p-4 bg-muted/30 rounded-lg flex flex-col">
          <div className="text-sm font-medium mb-3">IS/OOS Split</div>
          <ISOOSSplitCard
            splitConfig={splitConfig}
            onSplitConfigChange={onSplitConfigChange}
            lockStrategy="rolling"
          />
        </div>

        {/* Middle Column - Add Metric Requirement */}
        <div className="p-4 bg-muted/30 rounded-lg flex flex-col">
          <div className="text-sm font-medium mb-3">
            Add Metric Requirement
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm whitespace-nowrap">Must have</span>
            <MetricDropdown
              value={newMetric}
              onChange={setNewMetric}
              className="min-w-[140px]"
            />
            <span className="text-sm whitespace-nowrap">of</span>
            <select
              value={newComparison}
              onChange={(e) => setNewComparison(e.target.value as 'at_least' | 'at_most')}
              className="px-2 py-1 rounded border border-border bg-background text-sm"
            >
              <option value="at_least">at least</option>
              <option value="at_most">at most</option>
            </select>
            <input
              type="number"
              step="0.01"
              value={newMetricValue}
              onChange={(e) => setNewMetricValue(parseFloat(e.target.value) || 0)}
              className="w-20 px-2 py-1 rounded border border-border bg-background text-sm"
            />
            <Button
              size="sm"
              onClick={handleAddMetricRequirement}
            >
              Add
            </Button>
          </div>
        </div>

        {/* Right Column - Current Requirements */}
        <div className="p-4 bg-muted/30 rounded-lg flex flex-col">
          <div className="text-sm font-medium mb-3">Current Requirements</div>
          {requirements.length === 0 ? (
            <div className="text-sm text-muted">No requirements set</div>
          ) : (
            <div className="space-y-2">
              {requirements.map((req) => (
                <div key={req.id} className="flex items-center justify-between">
                  <span className="text-sm font-bold">
                    {req.type === 'live_months' ? (
                      <>Live {req.value}mo</>
                    ) : req.type === 'etfs_only' ? (
                      <>ETFs only</>
                    ) : (
                      <>IS {METRIC_LABELS[req.metric!]} {req.comparison === 'at_least' ? '≥' : '≤'} {formatMetricValue(req.metric!, req.value)}</>
                    )}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-red-500 hover:text-red-600"
                    onClick={() => handleRemoveRequirement(req.id)}
                  >
                    ×
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
