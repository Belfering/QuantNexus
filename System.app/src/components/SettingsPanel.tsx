// src/components/SettingsPanel.tsx
// Settings and Pass/Fail Criteria panel for Forge tab

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { METRIC_LABELS, type EligibilityMetric, type EligibilityRequirement } from '@/types/admin'

export function SettingsPanel() {
  // Local state (no API calls)
  const [requirements, setRequirements] = useState<EligibilityRequirement[]>([])
  const [liveMonthsValue, setLiveMonthsValue] = useState(0)
  const [newMetric, setNewMetric] = useState<EligibilityMetric>('cagr')
  const [newComparison, setNewComparison] = useState<'at_least' | 'at_most'>('at_least')
  const [newMetricValue, setNewMetricValue] = useState(0)

  // Handler functions (local state only, no API)
  const handleSaveLiveMonths = () => {
    const filtered = requirements.filter(r => r.type !== 'live_months')
    const newReq: EligibilityRequirement = {
      id: 'live_months',
      type: 'live_months',
      value: liveMonthsValue
    }
    setRequirements([...filtered, newReq])
  }

  const handleAddMetricRequirement = () => {
    const newReq: EligibilityRequirement = {
      id: `metric-${Date.now()}`,
      type: 'metric',
      metric: newMetric,
      comparison: newComparison,
      value: newMetricValue
    }
    setRequirements([...requirements, newReq])
  }

  const handleRemoveRequirement = (id: string) => {
    setRequirements(requirements.filter(r => r.id !== id))
  }

  const handleToggleETFsOnly = (checked: boolean) => {
    if (checked) {
      const newReq: EligibilityRequirement = {
        id: `etfs-only-${Date.now()}`,
        type: 'etfs_only',
        value: 1
      }
      setRequirements([...requirements, newReq])
    } else {
      setRequirements(requirements.filter(r => r.type !== 'etfs_only'))
    }
  }

  return (
    <Card className="p-6">
      <div className="font-bold mb-4">Setting and Pass/Fail Criteria</div>
      <div className="grid grid-cols-3 gap-4">
        {/* Left Section - Add Metric Requirement */}
        <div className="p-4 bg-muted/30 rounded-lg">
          <div className="text-sm font-medium mb-3">Add Metric Requirement</div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm whitespace-nowrap">Must have</span>
              <select
                value={newMetric}
                onChange={(e) => setNewMetric(e.target.value as EligibilityMetric)}
                className="flex-1 px-2 py-1 rounded border border-border bg-background text-sm"
              >
                {(Object.keys(METRIC_LABELS) as EligibilityMetric[]).map(m => (
                  <option key={m} value={m}>{METRIC_LABELS[m]}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm whitespace-nowrap">of</span>
              <select
                value={newComparison}
                onChange={(e) => setNewComparison(e.target.value as 'at_least' | 'at_most')}
                className="flex-1 px-2 py-1 rounded border border-border bg-background text-sm"
              >
                <option value="at_least">at least</option>
                <option value="at_most">at most</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.01"
                value={newMetricValue}
                onChange={(e) => setNewMetricValue(parseFloat(e.target.value) || 0)}
                className="flex-1 px-2 py-1 rounded border border-border bg-background text-sm"
              />
              <Button
                size="sm"
                onClick={handleAddMetricRequirement}
              >
                Add
              </Button>
            </div>
          </div>
        </div>

        {/* Middle Section - Current Requirements */}
        <div className="p-4 bg-muted/30 rounded-lg">
          <div className="text-sm font-medium mb-3">Current Requirements</div>
          {requirements.length === 0 ? (
            <div className="text-sm text-muted">No requirements set</div>
          ) : (
            <ol className="list-decimal list-inside space-y-2 text-sm">
              {requirements.map((req) => (
                <li key={req.id} className="flex items-center justify-between">
                  <span className="text-xs">
                    {req.type === 'live_months' ? (
                      <>Live {req.value}mo</>
                    ) : req.type === 'etfs_only' ? (
                      <>ETFs only</>
                    ) : (
                      <>{METRIC_LABELS[req.metric!]} {req.comparison === 'at_least' ? '≥' : '≤'} {req.value}</>
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
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* Right Section - Time Period Analysis */}
        <div className="p-4 bg-muted/30 rounded-lg">
          <div className="text-sm font-medium mb-3">Time Period Analysis</div>
          <div className="space-y-2">
            <div className="text-xs text-muted">
              Coming soon: Historical period breakdown and performance analysis across different market conditions.
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
}
