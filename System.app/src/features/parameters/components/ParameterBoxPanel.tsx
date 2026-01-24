// src/features/parameters/components/ParameterBoxPanel.tsx
// Main container for colored parameter boxes

import { useMemo } from 'react'
import { Card } from '@/components/ui/card'
import type { FlowNode } from '@/types/flowNode'
import type { ParameterField, ParameterRange, StrategyParameter } from '../types'
import { useVisualParameters } from '../hooks/useVisualParameters'
import { useHierarchicalParameters } from '../hooks/useHierarchicalParameters'
import { NodeParameterGroup } from './NodeParameterGroup'
import { HierarchicalParameterTree } from './HierarchicalParameterTree'

/**
 * Detect if a parameter range path is broken (contains only timestamps instead of full IDs)
 * Broken: "node.conditions.1769272928876.window"
 * Correct: "node-1769272928876-25-s5lide2a.conditions.node-1769272928876-26-s5lide2a.window"
 */
export function isBrokenPath(path: string): boolean {
  const parts = path.split('.')
  // Check if path has "conditions" segment
  const conditionsIdx = parts.findIndex(p => p === 'conditions')
  if (conditionsIdx === -1) return false

  // Check if the segment after "conditions" is just a timestamp (all digits)
  const conditionId = parts[conditionsIdx + 1]
  return conditionId && /^\d+$/.test(conditionId)
}

/**
 * Parse parameterId to extract correct full IDs and rebuild path
 * Automatically fixes broken paths from old parameter ranges
 */
export function migrateParameterRange(range: ParameterRange): ParameterRange {
  if (!isBrokenPath(range.path)) return range

  // Parse parameterId: "node-{ts}-{counter}-{rand}-node-{ts}-{counter}-{rand}-{field}"
  // OR: "node-{ts}-{counter}-{rand}-{field}" for non-condition parameters
  const parts = range.id.split('-')

  // Find second occurrence of 'node' (indicates condition parameter)
  const secondNodeIdx = parts.findIndex((part, idx) => idx > 0 && part === 'node')

  if (secondNodeIdx === -1) {
    // Not a condition parameter, path is probably fine
    return range
  }

  // Extract node ID and condition ID from parameterId
  const nodeId = parts.slice(0, secondNodeIdx).join('-')
  const conditionId = parts.slice(secondNodeIdx, parts.length - 1).join('-')
  const field = parts[parts.length - 1]

  // Rebuild path with correct full IDs
  const newPath = `${nodeId}.conditions.${conditionId}.${field}`

  console.log('[ParameterBoxPanel] Migrated parameter range:', {
    oldPath: range.path,
    newPath,
    parameterId: range.id
  })

  return {
    ...range,
    path: newPath,
    nodeId, // Also update nodeId to use full ID
    conditionId // Also update conditionId to use full ID
  }
}

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
  // Automatically migrate broken parameter range paths on load
  const migratedRanges = useMemo(() => {
    const migrated = parameterRanges.map(migrateParameterRange)

    // Check if any migrations occurred by comparing paths
    const needsSave = migrated.some((r, i) => r.path !== parameterRanges[i].path)

    // Save migrated ranges back to store if changed
    if (needsSave && onUpdateRanges) {
      console.log('[ParameterBoxPanel] Saving migrated parameter ranges')
      // Schedule the save for next tick to avoid updating during render
      setTimeout(() => {
        onUpdateRanges(migrated)
      }, 0)
    }

    return migrated
  }, [parameterRanges, onUpdateRanges])

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

    const updatedRanges = [...migratedRanges]

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

        // Parse paramId to extract correct nodeId and conditionId
        // paramId format: node-{ts}-{counter}-{rand}-node-{ts}-{counter}-{rand}-{field}
        // Example: node-1769273284518-25-2mi1c4ws-node-1769273284518-26-2mi1c4ws-window
        const parts = paramId.split('-')

        // Find the indices of 'node' occurrences
        const firstNodeIndex = 0
        const secondNodeIndex = parts.findIndex((part, idx) => idx > 0 && part === 'node')

        if (secondNodeIndex > 0 && parts.length > secondNodeIndex + 4) {
          // Extract full nodeId (from first 'node' to before second 'node')
          const extractedNodeId = parts.slice(firstNodeIndex, secondNodeIndex).join('-')

          // Extract full conditionId (from second 'node' to before field)
          const extractedConditionId = parts.slice(secondNodeIndex, parts.length - 1).join('-')

          path = `${extractedNodeId}.conditions.${extractedConditionId}.${field}`
          condId = extractedConditionId
        } else {
          // Fallback to old logic if parsing fails
          path = `${nodeId}.conditions.${parameter.conditionId}.${field}`
          condId = parameter.conditionId
        }

        type = field === 'window' || field === 'rightWindow' ? 'period' : 'threshold'
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

      // Extract correct nodeId from paramId for storage
      let correctNodeId = nodeId
      if (parameter.type === 'condition') {
        const parts = paramId.split('-')
        const secondNodeIndex = parts.findIndex((part, idx) => idx > 0 && part === 'node')
        if (secondNodeIndex > 0) {
          correctNodeId = parts.slice(0, secondNodeIndex).join('-')
        }
      }

      const parameterRange: ParameterRange = {
        id: paramId,
        type,
        nodeId: correctNodeId,
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
        const range = migratedRanges?.find((r) => r.id === param.id)
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
    const enabledRanges = migratedRanges.filter((r) => r.enabled)
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
          migratedRanges={migratedRanges}
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
