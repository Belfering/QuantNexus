// src/features/builder/components/NodeCard/types.ts
// Type definitions for NodeCard and sub-components

import type {
  FlowNode,
  SlotId,
  BlockKind,
  WeightMode,
  MetricChoice,
  RankChoice,
  ComparatorChoice,
  PositionChoice,
  NumberedQuantifier,
  CallChain,
  TickerInstance,
} from '../../../../types'
import type { TickerModalMode } from '@/shared/components'

/**
 * Line types used by buildLines for rendering node body
 */
export type TextLine = {
  kind: 'text'
  id: string
  depth: number
  text: string
  tone?: 'tag' | 'title' | 'info' | 'label'
}

export type SlotLine = {
  kind: 'slot'
  id: string
  depth: number
  slot: SlotId
}

export type LineView = TextLine | SlotLine

/**
 * Condition update payload
 */
export type ConditionUpdate = Partial<{
  window: number
  metric: MetricChoice
  comparator: ComparatorChoice
  ticker: PositionChoice
  threshold: number
  expanded?: boolean
  rightWindow?: number
  rightMetric?: MetricChoice
  rightTicker?: PositionChoice
  forDays?: number
}>

/**
 * Scaling update payload
 */
export type ScalingUpdate = Partial<{
  scaleMetric: MetricChoice
  scaleWindow: number
  scaleTicker: string
  scaleFrom: number
  scaleTo: number
}>

/**
 * Props for the NodeCard component
 */
export interface CardProps {
  node: FlowNode
  depth: number
  // Parent context for sibling insertion
  parentId: string | null
  parentSlot: SlotId | null
  myIndex: number
  inheritedWeight?: number
  weightMode?: WeightMode
  isSortChild?: boolean
  errorNodeIds?: Set<string>
  focusNodeId?: string | null
  tickerOptions: string[]

  // Tree manipulation
  onAdd: (parentId: string, slot: SlotId, index: number, kind: BlockKind) => void
  onAppend: (parentId: string, slot: SlotId) => void
  onRemoveSlotEntry: (parentId: string, slot: SlotId, index: number) => void
  onDelete: (id: string) => void
  onCopy: (id: string) => void
  onPaste: (parentId: string, slot: SlotId, index: number, child: FlowNode) => void
  onPasteCallRef: (parentId: string, slot: SlotId, index: number, callChainId: string) => void

  // Node updates
  onRename: (id: string, title: string) => void
  onWeightChange: (id: string, weight: WeightMode, branch?: 'then' | 'else') => void
  onUpdateCappedFallback: (id: string, choice: PositionChoice, branch?: 'then' | 'else') => void
  onUpdateVolWindow: (id: string, days: number, branch?: 'then' | 'else') => void
  onColorChange: (id: string, color?: string) => void
  onToggleCollapse: (id: string, collapsed: boolean) => void
  onExpandAllBelow: (id: string, collapsed: boolean) => void

  // Numbered node handlers
  onNumberedQuantifier: (id: string, quantifier: NumberedQuantifier) => void
  onNumberedN: (id: string, n: number) => void
  onAddNumberedItem: (id: string) => void
  onDeleteNumberedItem: (id: string, itemId: string) => void

  // Condition handlers
  onAddCondition: (id: string, type: 'and' | 'or', itemId?: string) => void
  onDeleteCondition: (id: string, condId: string, itemId?: string) => void
  onUpdateCondition: (id: string, condId: string, updates: ConditionUpdate, itemId?: string) => void

  // Function node handlers
  onFunctionWindow: (id: string, value: number) => void
  onFunctionBottom: (id: string, value: number) => void
  onFunctionMetric: (id: string, metric: MetricChoice) => void
  onFunctionRank: (id: string, rank: RankChoice) => void

  // Position handlers
  onAddPosition: (id: string) => void
  onRemovePosition: (id: string, index: number) => void
  onChoosePosition: (id: string, index: number, choice: PositionChoice) => void

  // Clipboard
  clipboard: FlowNode | null
  copiedNodeId: string | null
  copiedCallChainId: string | null

  // Call chains
  callChains: CallChain[]
  onUpdateCallRef: (id: string, callId: string | null) => void

  // Alt Exit handlers
  onAddEntryCondition: (id: string, type: 'and' | 'or') => void
  onAddExitCondition: (id: string, type: 'and' | 'or') => void
  onDeleteEntryCondition: (id: string, condId: string) => void
  onDeleteExitCondition: (id: string, condId: string) => void
  onUpdateEntryCondition: (id: string, condId: string, updates: ConditionUpdate) => void
  onUpdateExitCondition: (id: string, condId: string, updates: ConditionUpdate) => void

  // Scaling handlers
  onUpdateScaling: (id: string, updates: ScalingUpdate) => void

  // Find/Replace highlighting
  highlightedInstance?: TickerInstance | null

  // Indicator overlay toggle
  enabledOverlays?: Set<string>
  onToggleOverlay?: (key: string) => void

  // Ticker search modal
  openTickerModal?: (onSelect: (ticker: string) => void, restrictTo?: string[], modes?: TickerModalMode[], nodeKind?: BlockKind, initialValue?: string) => void
}

/**
 * Props for NodeHeader sub-component
 */
export interface NodeHeaderProps {
  node: FlowNode
  depth: number
  collapsed: boolean
  editing: boolean
  draft: string
  inheritedWeight?: number
  weightMode?: WeightMode
  isSortChild?: boolean
  copiedNodeId: string | null
  palette: string[]
  colorOpen: boolean
  onSetEditing: (editing: boolean) => void
  onSetDraft: (draft: string) => void
  onSetColorOpen: (open: boolean) => void
  onToggleCollapse: (id: string, collapsed: boolean) => void
  onExpandAllBelow: (id: string, collapsed: boolean) => void
  onDelete: (id: string) => void
  onCopy: (id: string) => void
  onRename: (id: string, title: string) => void
  onColorChange: (id: string, color?: string) => void
  onFunctionWindow: (id: string, value: number) => void
}

/**
 * Props for PositionBody sub-component
 */
export interface PositionBodyProps {
  node: FlowNode
  positionDrafts: Record<string, string>
  onSetPositionDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>
  onAddPosition: (id: string) => void
  onRemovePosition: (id: string, index: number) => void
  onChoosePosition: (id: string, index: number, choice: PositionChoice) => void
  openTickerModal?: (onSelect: (ticker: string) => void, restrictTo?: string[], modes?: TickerModalMode[], nodeKind?: BlockKind, initialValue?: string) => void
}

/**
 * Props for CallReferenceBody sub-component
 */
export interface CallReferenceBodyProps {
  node: FlowNode
  callChains: CallChain[]
  onUpdateCallRef: (id: string, callId: string | null) => void
}
