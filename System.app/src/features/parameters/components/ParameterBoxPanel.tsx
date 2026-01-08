// src/features/parameters/components/ParameterBoxPanel.tsx
// Main container for colored parameter boxes

import { Card } from '@/components/ui/card'
import type { FlowNode } from '@/types/flowNode'
import type { ParameterField, ParameterRange, StrategyParameter } from '../types'
import { useVisualParameters } from '../hooks/useVisualParameters'
import { useHierarchicalParameters } from '../hooks/useHierarchicalParameters'
import { NodeParameterGroup } from './NodeParameterGroup'
import { HierarchicalParameterTree } from './HierarchicalParameterTree'

interface ParameterBoxPanelProps {
  root: FlowNode | null
  onUpdate?: (paramId: string, field: ParameterField, value: any) => void
  onHierarchicalUpdate?: (nodeId: string, parameter: StrategyParameter, value: any) => void
  parameterRanges?: ParameterRange[]
  onUpdateRanges?: (ranges: ParameterRange[]) => void
  openTickerModal?: (onSelect: (ticker: string) => void) => void
}

export function ParameterBoxPanel({
  root,
  onUpdate,
  onHierarchicalUpdate,
  parameterRanges = [],
  onUpdateRanges,
  openTickerModal
}: ParameterBoxPanelProps) {
  // Extract all parameters grouped by node (legacy flat view)
  const parametersByNode = useVisualParameters(root)

  // Extract hierarchical tree structure
  const hierarchicalTree = useHierarchicalParameters(root)

  // Handle enabling/disabling optimization for a parameter
  const handleEnableOptimization = (
    paramId: string,
    nodeId: string,
    parameter: StrategyParameter,
    enabled: boolean,
    range?: { min: number; max: number; step: number }
  ) => {
    if (!onUpdateRanges) return

    const updatedRanges = [...parameterRanges]

    if (enabled && range) {
      // Find or create parameter range
      const existingIndex = updatedRanges.findIndex((r) => r.id === paramId)

      // Determine field, path, and type based on parameter type
      let field: string
      let path: string
      let type: 'period' | 'threshold'
      let condId = ''

      if (parameter.type === 'condition') {
        field = parameter.field
        path = `${nodeId}.conditions.${parameter.conditionId}.${field}`
        type = field === 'window' || field === 'rightWindow' ? 'period' : 'threshold'
        condId = parameter.conditionId
      } else if (parameter.type === 'numbered') {
        field = parameter.field
        path = `${nodeId}.numbered.${field}`
        type = field === 'n' ? 'threshold' : 'period'
      } else if (parameter.type === 'function') {
        field = parameter.field
        path = `${nodeId}.${field}`
        type = field === 'window' ? 'period' : 'threshold'
      } else if (parameter.type === 'scaling') {
        field = parameter.field
        path = `${nodeId}.${field}`
        type = field === 'scaleWindow' ? 'period' : 'threshold'
      } else {
        // Fallback for other types
        const parts = paramId.split('-')
        field = parts[parts.length - 1]
        path = `${nodeId}.${field}`
        type = field === 'window' || field === 'rightWindow' ? 'period' : 'threshold'
      }

      const parameterRange: ParameterRange = {
        id: paramId,
        type,
        nodeId,
        conditionId: condId,
        path,
        currentValue: range.min,
        enabled: true,
        min: range.min,
        max: range.max,
        step: range.step,
      }

      if (existingIndex !== -1) {
        // Update existing
        updatedRanges[existingIndex] = parameterRange
      } else {
        // Add new
        updatedRanges.push(parameterRange)
      }

      // Save ranges FIRST before updating tree (to ensure enrichment has the latest data)
      onUpdateRanges(updatedRanges)

      // Then update the actual value in the tree to the min value
      if (onHierarchicalUpdate) {
        onHierarchicalUpdate(nodeId, parameter, range.min)
      }

      // Early return to avoid calling onUpdateRanges again at the end
      return
    } else {
      // Disable optimization
      const existingIndex = updatedRanges.findIndex((r) => r.id === paramId)
      if (existingIndex !== -1) {
        updatedRanges[existingIndex] = {
          ...updatedRanges[existingIndex],
          enabled: false,
        }
      }
    }

    onUpdateRanges(updatedRanges)
  }

  // Sync optimization config back to visual parameters
  const getEnrichedParameters = () => {
    const enriched = new Map<string, any[]>()
    parametersByNode.forEach((params, nodeId) => {
      const enrichedParams = params.map((param) => {
        // Find matching ParameterRange
        const range = parameterRanges?.find((r) => r.id === param.id)
        if (range) {
          return {
            ...param,
            optimizationEnabled: range.enabled,
            min: range.min,
            max: range.max,
            step: range.step,
          }
        }
        return param
      })
      enriched.set(nodeId, enrichedParams)
    })
    return enriched
  }

  const enrichedParameters = getEnrichedParameters()

  // Calculate total branches from optimization ranges
  const calculateTotalBranches = () => {
    const enabledRanges = parameterRanges.filter((r) => r.enabled)
    if (enabledRanges.length === 0) return 1

    let total = 1
    enabledRanges.forEach((range) => {
      const branchCount = Math.floor((range.max - range.min) / range.step) + 1
      total *= branchCount
    })
    return total
  }

  const totalBranches = calculateTotalBranches()
  const estimatedMinutes = Math.ceil(totalBranches / 100) // Rough estimate: 100 branches per minute

  if (!hierarchicalTree) {
    return (
      <div className="text-sm text-muted text-center py-8">
        Add nodes to your flowchart to see parameters here.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Hierarchical Parameter Tree */}
      {onHierarchicalUpdate && (
        <HierarchicalParameterTree
          node={hierarchicalTree}
          onUpdate={onHierarchicalUpdate}
          onEnableOptimization={handleEnableOptimization}
          openTickerModal={openTickerModal}
          parameterRanges={parameterRanges}
        />
      )}

      {/* Branch Estimate */}
      {totalBranches > 1 && (
        <div className="mt-4 pt-4 border-t">
          <div className="text-sm font-medium">
            Estimate:{' '}
            <span className="text-lg font-bold">{totalBranches.toLocaleString()}</span>{' '}
            branches ≈ {estimatedMinutes} min
          </div>
          {totalBranches > 10000 && (
            <div className="text-xs text-destructive mt-1">
              ⚠️ Warning: {totalBranches.toLocaleString()} branches may take a long time
            </div>
          )}
        </div>
      )}
    </div>
  )
}
