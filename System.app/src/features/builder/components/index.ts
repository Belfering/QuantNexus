// src/features/builder/components/index.ts
// Barrel export for builder components

export { InsertMenu } from './InsertMenu'
export type { InsertMenuProps } from './InsertMenu'

// Shared primitives
export { WeightPicker, weightLabel } from './WeightPicker'
export type { WeightPickerProps } from './WeightPicker'

export { WeightDetailChip } from './WeightDetailChip'
export type { WeightDetailChipProps } from './WeightDetailChip'

export { IndicatorDropdown } from './IndicatorDropdown'
export type { IndicatorDropdownProps } from './IndicatorDropdown'

export { ConditionEditor } from './ConditionEditor'
export type { ConditionEditorProps } from './ConditionEditor'

export { ColorPicker } from './ColorPicker'
export type { ColorPickerProps } from './ColorPicker'

// NodeCard components
export {
  NodeCard,
  NodeHeader,
  PositionBody,
  CallReferenceBody,
  IndicatorBody,
  NumberedBody,
  AltExitBody,
  ScalingBody,
  DefaultBody,
  buildLines,
} from './NodeCard'
export type {
  CardProps,
  NodeHeaderProps,
  PositionBodyProps,
  CallReferenceBodyProps,
  IndicatorBodyProps,
  NumberedBodyProps,
  AltExitBodyProps,
  ScalingBodyProps,
  DefaultBodyProps,
  LineView,
  TextLine,
  SlotLine,
  ConditionUpdate,
  ScalingUpdate,
} from './NodeCard'
