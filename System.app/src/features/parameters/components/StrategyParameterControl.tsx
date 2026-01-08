// src/features/parameters/components/StrategyParameterControl.tsx
// Dispatcher component that renders appropriate control based on parameter type

import type { StrategyParameter } from '../types'
import { WeightDropdown } from './WeightDropdown'
import { PositionTickerList } from './PositionTickerList'
import { FunctionParameterControl } from './FunctionParameterControl'
import { NumberedConfigControl } from './NumberedConfigControl'
import { ParameterBox } from './ParameterBox'

interface StrategyParameterControlProps {
  parameter: StrategyParameter
  nodeId: string
  onUpdate: (nodeId: string, parameter: StrategyParameter, value: any) => void
  onEnableOptimization: (paramId: string, nodeId: string, parameter: StrategyParameter, enabled: boolean, range?: { min: number; max: number; step: number }) => void
  openTickerModal?: (onSelect: (ticker: string) => void) => void
}

export function StrategyParameterControl({
  parameter,
  nodeId,
  onUpdate,
  onEnableOptimization,
  openTickerModal
}: StrategyParameterControlProps) {
  switch (parameter.type) {
    case 'weight':
      return <WeightDropdown parameter={parameter} nodeId={nodeId} onUpdate={onUpdate} />

    case 'condition':
      // Use existing ParameterBox for condition parameters
      // Convert ConditionParameter to VisualParameter format
      const paramId = parameter.itemId
        ? `${nodeId}-${parameter.itemId}-${parameter.conditionId}-${parameter.field}`
        : `${nodeId}-${parameter.conditionId}-${parameter.field}`

      const visualParam = {
        id: paramId,
        field: parameter.field,
        nodeId,
        nodeTitle: '', // Not needed for ParameterBox
        conditionId: parameter.conditionId,
        currentValue: parameter.currentValue,
        nodeColor: '', // Not needed for ParameterBox
        path: '',
        optimizationEnabled: parameter.optimizationEnabled,
        min: parameter.min,
        max: parameter.max,
        step: parameter.step
      }

      return (
        <ParameterBox
          parameter={visualParam}
          onUpdate={(field, value) => onUpdate(nodeId, parameter, value)}
          onEnableOptimization={(enabled, range) => onEnableOptimization(paramId, nodeId, parameter, enabled, range)}
        />
      )

    case 'position':
      return (
        <PositionTickerList
          parameter={parameter}
          nodeId={nodeId}
          onUpdate={onUpdate}
          openTickerModal={openTickerModal}
        />
      )

    case 'function': {
      // Handle numeric function parameters (window, bottom) with optimization
      if (parameter.field === 'window' || parameter.field === 'bottom') {
        const paramId = `${nodeId}-function-${parameter.field}`

        const visualParam = {
          id: paramId,
          field: parameter.field as any,
          nodeId,
          nodeTitle: '',
          conditionId: '',
          currentValue: parameter.currentValue,
          nodeColor: '',
          path: '',
          optimizationEnabled: parameter.optimizationEnabled,
          min: parameter.min,
          max: parameter.max,
          step: parameter.step
        }

        return (
          <ParameterBox
            parameter={visualParam}
            onUpdate={(field, value) => onUpdate(nodeId, parameter, value)}
            onEnableOptimization={(enabled, range) => onEnableOptimization(paramId, nodeId, parameter, enabled, range)}
          />
        )
      }
      // For metric and rank, use the standard control
      return <FunctionParameterControl parameter={parameter} nodeId={nodeId} onUpdate={onUpdate} />
    }

    case 'numbered':
      return (
        <NumberedConfigControl
          parameter={parameter}
          nodeId={nodeId}
          onUpdate={onUpdate}
          onEnableOptimization={onEnableOptimization}
        />
      )

    case 'scaling': {
      // Handle numeric scaling parameters (window, from, to) with optimization
      if (parameter.field === 'scaleWindow' || parameter.field === 'scaleFrom' || parameter.field === 'scaleTo') {
        const fieldName = parameter.field === 'scaleWindow' ? 'window' : parameter.field === 'scaleFrom' ? 'from' : 'to'
        const paramId = `${nodeId}-scaling-${fieldName}`

        const visualParam = {
          id: paramId,
          field: parameter.field as any,
          nodeId,
          nodeTitle: '',
          conditionId: '',
          currentValue: parameter.currentValue,
          nodeColor: '',
          path: '',
          optimizationEnabled: parameter.optimizationEnabled,
          min: parameter.min,
          max: parameter.max,
          step: parameter.step
        }

        return (
          <ParameterBox
            parameter={visualParam}
            onUpdate={(field, value) => onUpdate(nodeId, parameter, value)}
            onEnableOptimization={(enabled, range) => onEnableOptimization(paramId, nodeId, parameter, enabled, range)}
          />
        )
      }
      // For scaleMetric and scaleTicker, show as read-only for now
      return null
    }

    default:
      return null
  }
}
