// src/features/parameters/components/HierarchicalParameterTree.tsx
// Recursive component that renders hierarchical parameter tree

import type { HierarchicalParameter, StrategyParameter, ParameterRange } from '../types'
import { StrategyParameterControl } from './StrategyParameterControl'

interface HierarchicalParameterTreeProps {
  node: HierarchicalParameter
  onUpdate: (nodeId: string, parameter: StrategyParameter, value: any) => void
  onEnableOptimization: (paramId: string, nodeId: string, parameter: StrategyParameter, enabled: boolean, range?: { min: number; max: number; step: number }) => void
  openTickerModal?: (onSelect: (ticker: string) => void) => void
  parameterRanges?: ParameterRange[]
}

export function HierarchicalParameterTree({
  node,
  onUpdate,
  onEnableOptimization,
  openTickerModal,
  parameterRanges = []
}: HierarchicalParameterTreeProps) {
  const hasChildren =
    (node.children.then && node.children.then.length > 0) ||
    (node.children.else && node.children.else.length > 0) ||
    (node.children.next && node.children.next.length > 0)

  // Enrich parameters with optimization data from parameterRanges
  const enrichedParameters = node.parameters.map(param => {
    if (param.type === 'condition') {
      // Build paramId for condition parameters
      const paramId = param.itemId
        ? `${node.nodeId}-${param.itemId}-${param.conditionId}-${param.field}`
        : `${node.nodeId}-${param.conditionId}-${param.field}`

      // Find matching range
      const range = parameterRanges.find(r => r.id === paramId)

      if (range) {
        return {
          ...param,
          optimizationEnabled: range.enabled,
          min: range.min,
          max: range.max,
          step: range.step
        }
      }
    } else if (param.type === 'numbered' && param.field === 'n') {
      // Build paramId for numbered n parameter
      const paramId = `${node.nodeId}-numbered-n`

      // Find matching range
      const range = parameterRanges.find(r => r.id === paramId)

      if (range) {
        return {
          ...param,
          optimizationEnabled: range.enabled,
          min: range.min,
          max: range.max,
          step: range.step
        }
      }
    } else if (param.type === 'function' && (param.field === 'window' || param.field === 'bottom')) {
      // Build paramId for function parameters
      const paramId = `${node.nodeId}-function-${param.field}`

      // Find matching range
      const range = parameterRanges.find(r => r.id === paramId)

      if (range) {
        return {
          ...param,
          optimizationEnabled: range.enabled,
          min: range.min,
          max: range.max,
          step: range.step
        }
      }
    } else if (param.type === 'scaling' && (param.field === 'scaleWindow' || param.field === 'scaleFrom' || param.field === 'scaleTo')) {
      // Build paramId for scaling parameters
      const fieldName = param.field === 'scaleWindow' ? 'window' : param.field === 'scaleFrom' ? 'from' : 'to'
      const paramId = `${node.nodeId}-scaling-${fieldName}`

      // Find matching range
      const range = parameterRanges.find(r => r.id === paramId)

      if (range) {
        return {
          ...param,
          optimizationEnabled: range.enabled,
          min: range.min,
          max: range.max,
          step: range.step
        }
      }
    }
    return param
  })

  return (
    <div style={{ marginLeft: `${node.depth * 24}px` }} className="mb-2">
      {/* Node Parameter Section */}
      <div
        className="flex items-center gap-2 p-3 rounded-lg border-2"
        style={{ borderColor: node.nodeColor || '#3b82f6' }}
      >
        {/* Node Label */}
        <div
          className="text-xs font-semibold px-2 py-1 rounded-md whitespace-nowrap min-w-[100px]"
          style={{ backgroundColor: node.nodeColor || '#3b82f6' }}
        >
          {node.nodeTitle}
        </div>

        {/* Parameters inline */}
        <div className="flex gap-2 flex-wrap">
          {enrichedParameters.map((param, idx) => (
            <StrategyParameterControl
              key={`${node.nodeId}-${param.type}-${idx}`}
              parameter={param}
              nodeId={node.nodeId}
              onUpdate={onUpdate}
              onEnableOptimization={onEnableOptimization}
              openTickerModal={openTickerModal}
            />
          ))}
        </div>
      </div>

      {/* Children with branch indicators */}
      {hasChildren && (
        <div className="mt-2">
          {/* Then branch (green border) */}
          {node.children.then && node.children.then.length > 0 && (
            <div className="border-l-2 border-green-500 pl-2">
              <div className="text-xs font-semibold text-green-600 mb-1">Then:</div>
              {node.children.then.map(child => (
                <HierarchicalParameterTree
                  key={child.nodeId}
                  node={child}
                  onUpdate={onUpdate}
                  onEnableOptimization={onEnableOptimization}
                  openTickerModal={openTickerModal}
                  parameterRanges={parameterRanges}
                />
              ))}
            </div>
          )}

          {/* Else branch (red border) */}
          {node.children.else && node.children.else.length > 0 && (
            <div className="border-l-2 border-red-500 pl-2 mt-2">
              <div className="text-xs font-semibold text-red-600 mb-1">Else:</div>
              {node.children.else.map(child => (
                <HierarchicalParameterTree
                  key={child.nodeId}
                  node={child}
                  onUpdate={onUpdate}
                  onEnableOptimization={onEnableOptimization}
                  openTickerModal={openTickerModal}
                  parameterRanges={parameterRanges}
                />
              ))}
            </div>
          )}

          {/* Next branch (no special indicator) */}
          {node.children.next && node.children.next.length > 0 && (
            <div className="mt-2">
              {node.children.next.map(child => (
                <HierarchicalParameterTree
                  key={child.nodeId}
                  node={child}
                  onUpdate={onUpdate}
                  onEnableOptimization={onEnableOptimization}
                  openTickerModal={openTickerModal}
                  parameterRanges={parameterRanges}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
