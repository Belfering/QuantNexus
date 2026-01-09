// src/components/SettingsPanel.tsx
// Settings and Pass/Fail Criteria panel for Forge tab

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { METRIC_LABELS, type EligibilityMetric, type EligibilityRequirement } from '@/types/admin'
import { ISOOSSplitCard } from '@/components/Forge/ISOOSSplitCard'
import type { ISOOSSplitConfig } from '@/types/split'

interface SettingsPanelProps {
  splitConfig?: ISOOSSplitConfig
  onSplitConfigChange: (config: ISOOSSplitConfig) => void
}

export function SettingsPanel({ splitConfig, onSplitConfigChange }: SettingsPanelProps) {
  // State with API integration
  const [requirements, setRequirements] = useState<EligibilityRequirement[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [liveMonthsValue, setLiveMonthsValue] = useState(0)
  const [newMetric, setNewMetric] = useState<EligibilityMetric>('cagr')
  const [newComparison, setNewComparison] = useState<'at_least' | 'at_most'>('at_least')
  const [newMetricValue, setNewMetricValue] = useState(0)

  // Load requirements from API on mount
  useEffect(() => {
    async function loadRequirements() {
      try {
        const response = await fetch('/api/admin/eligibility')
        if (response.ok) {
          const data = await response.json()
          setRequirements(data.eligibilityRequirements || [])
        }
      } catch (error) {
        console.error('Failed to load eligibility requirements:', error)
      } finally {
        setIsLoading(false)
      }
    }
    loadRequirements()
  }, [])

  // Save requirements to API
  const saveRequirements = async (newRequirements: EligibilityRequirement[]) => {
    try {
      const response = await fetch('/api/admin/eligibility', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eligibilityRequirements: newRequirements })
      })
      if (response.ok) {
        setRequirements(newRequirements)
      } else {
        console.error('Failed to save eligibility requirements')
      }
    } catch (error) {
      console.error('Failed to save eligibility requirements:', error)
    }
  }

  // Handler functions with API integration
  const handleSaveLiveMonths = async () => {
    const filtered = requirements.filter(r => r.type !== 'live_months')
    const newReq: EligibilityRequirement = {
      id: 'live_months',
      type: 'live_months',
      value: liveMonthsValue
    }
    await saveRequirements([...filtered, newReq])
  }

  const handleAddMetricRequirement = async () => {
    const newReq: EligibilityRequirement = {
      id: `metric-${Date.now()}`,
      type: 'metric',
      metric: newMetric,
      comparison: newComparison,
      value: newMetricValue
    }
    await saveRequirements([...requirements, newReq])
  }

  const handleRemoveRequirement = async (id: string) => {
    await saveRequirements(requirements.filter(r => r.id !== id))
  }

  const handleToggleETFsOnly = async (checked: boolean) => {
    if (checked) {
      const newReq: EligibilityRequirement = {
        id: `etfs-only-${Date.now()}`,
        type: 'etfs_only',
        value: 1
      }
      await saveRequirements([...requirements, newReq])
    } else {
      await saveRequirements(requirements.filter(r => r.type !== 'etfs_only'))
    }
  }

  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="text-sm text-muted">Loading requirements...</div>
      </Card>
    )
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

        {/* Right Section - IS/OOS Split Configuration */}
        <div className="p-4 bg-muted/30 rounded-lg">
          <div className="text-sm font-medium mb-3">IS/OOS Split</div>
          <ISOOSSplitCard
            splitConfig={splitConfig}
            onSplitConfigChange={onSplitConfigChange}
          />
        </div>
      </div>
    </Card>
  )
}
