// src/features/builder/components/NodeCard/index.ts
// Barrel export for NodeCard components

// Main component
export { NodeCard } from './NodeCard'

// Sub-components
export { NodeHeader } from './NodeHeader'
export { PositionBody } from './PositionBody'
export { CallReferenceBody } from './CallReferenceBody'

// Body components
export { IndicatorBody } from './IndicatorBody'
export type { IndicatorBodyProps } from './IndicatorBody'

export { NumberedBody } from './NumberedBody'
export type { NumberedBodyProps } from './NumberedBody'

export { AltExitBody } from './AltExitBody'
export type { AltExitBodyProps } from './AltExitBody'

export { ScalingBody } from './ScalingBody'
export type { ScalingBodyProps } from './ScalingBody'

export { DefaultBody } from './DefaultBody'
export type { DefaultBodyProps } from './DefaultBody'

// Utilities
export { buildLines } from './buildLines'

// Types
export type {
  CardProps,
  NodeHeaderProps,
  PositionBodyProps,
  CallReferenceBodyProps,
  LineView,
  TextLine,
  SlotLine,
  ConditionUpdate,
  ScalingUpdate,
} from './types'
