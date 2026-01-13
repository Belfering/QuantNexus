// src/components/Forge/RequirementsEditor.tsx
// Reusable component for editing eligibility requirements

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { METRIC_LABELS, type EligibilityMetric, type EligibilityRequirement } from '@/types/admin'

interface RequirementsEditorProps {
  requirements: EligibilityRequirement[]
  onRequirementsChange: (requirements: EligibilityRequirement[]) => void
  label?: string  // Optional label for the requirements section
}

export function RequirementsEditor({ requirements, onRequirementsChange, label }: RequirementsEditorProps) {
  const [newMetric, setNewMetric] = useState<EligibilityMetric>('cagr')
  const [newComparison, setNewComparison] = useState<'at_least' | 'at_most'>('at_least')
  const [newMetricValue, setNewMetricValue] = useState(0)

  // Helper to determine if a metric should display as percentage
  const isPercentageMetric = (metric: EligibilityMetric): boolean => {
    return ['cagr', 'maxDrawdown', 'tim', 'timar', 'winRate', 'vol'].includes(metric)
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
    <div className="grid grid-cols-2 gap-4">
      {/* Left Section - Add Metric Requirement */}
      <div className="p-4 bg-muted/30 rounded-lg">
        <div className="text-sm font-medium mb-3">Add Metric Requirement</div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm whitespace-nowrap">Must have</span>
          <select
            value={newMetric}
            onChange={(e) => setNewMetric(e.target.value as EligibilityMetric)}
            className="px-2 py-1 rounded border border-border bg-background text-sm min-w-[140px]"
          >
            {(Object.keys(METRIC_LABELS) as EligibilityMetric[]).map(m => (
              <option key={m} value={m}>{METRIC_LABELS[m]}</option>
            ))}
          </select>
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

      {/* Right Section - Current Requirements */}
      <div className="p-4 bg-muted/30 rounded-lg">
        <div className="text-sm font-medium mb-3">{label || 'Current Requirements'}</div>
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
  )
}
