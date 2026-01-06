// src/features/builder/components/NodeCard/AltExitBody.tsx
// Body content for alt-exit nodes with entry/exit conditions

import { Button } from '@/components/ui/button'
import { ConditionEditor } from '../ConditionEditor'
import { WeightPicker } from '../WeightPicker'
import { WeightDetailChip } from '../WeightDetailChip'
import type { FlowNode, ConditionLine, WeightMode, PositionChoice, BlockKind } from '../../../../types'
import type { TickerModalMode } from '@/shared/components'

export interface AltExitBodyProps {
  node: FlowNode
  onAddEntryCondition: (nodeId: string, type: 'and' | 'or') => void
  onDeleteEntryCondition: (nodeId: string, condId: string) => void
  onUpdateEntryCondition: (nodeId: string, condId: string, updates: Partial<ConditionLine>) => void
  onAddExitCondition: (nodeId: string, type: 'and' | 'or') => void
  onDeleteExitCondition: (nodeId: string, condId: string) => void
  onUpdateExitCondition: (nodeId: string, condId: string, updates: Partial<ConditionLine>) => void
  onWeightChange: (nodeId: string, mode: WeightMode, branch?: 'then' | 'else') => void
  onUpdateCappedFallback: (nodeId: string, value: PositionChoice, branch?: 'then' | 'else') => void
  onUpdateVolWindow: (nodeId: string, value: number, branch?: 'then' | 'else') => void
  openTickerModal?: (onSelect: (ticker: string) => void, restrictTo?: string[], modes?: TickerModalMode[], nodeKind?: BlockKind, initialValue?: string) => void
  tickerDatalistId?: string
  renderSlot: (slot: 'then' | 'else', depthPx: number) => React.ReactNode
}

export const AltExitBody = ({
  node,
  onAddEntryCondition,
  onDeleteEntryCondition,
  onUpdateEntryCondition,
  onAddExitCondition,
  onDeleteExitCondition,
  onUpdateExitCondition,
  onWeightChange,
  onUpdateCappedFallback,
  onUpdateVolWindow,
  openTickerModal,
  tickerDatalistId,
  renderSlot,
}: AltExitBodyProps) => {
  const weightingThen = node.weightingThen ?? node.weighting
  const weightingElse = node.weightingElse ?? node.weighting
  const thenCappedFallback = node.cappedFallbackThen ?? node.cappedFallback ?? 'Empty'
  const thenVolWindow = node.volWindowThen ?? node.volWindow ?? 20
  const elseCappedFallback = node.cappedFallbackElse ?? node.cappedFallback ?? 'Empty'
  const elseVolWindow = node.volWindowElse ?? node.volWindow ?? 20

  return (
    <>
      {/* ENTER IF conditions */}
      <div className="condition-bubble">
        {node.entryConditions?.map((cond, idx) => (
          <div className="flex items-center gap-2" key={cond.id}>
            <div className="w-3.5 h-full border-l border-border" />
            <ConditionEditor
              condition={cond}
              index={idx}
              total={node.entryConditions?.length ?? 0}
              onUpdate={(updates) => onUpdateEntryCondition(node.id, cond.id, updates)}
              onDelete={() => onDeleteEntryCondition(node.id, cond.id)}
              openTickerModal={openTickerModal}
              nodeKind={node.kind}
            />
          </div>
        ))}
      </div>

      {/* Add entry condition buttons */}
      <div className="flex items-center gap-2">
        <div className="w-3.5 h-full border-l border-border" />
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onAddEntryCondition(node.id, 'and')
            }}
          >
            And If
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onAddEntryCondition(node.id, 'or')
            }}
          >
            Or If
          </Button>
        </div>
      </div>

      {/* Then Enter section */}
      <div className="flex items-center gap-2">
        <div className="w-7 h-full border-l border-border" />
        <div className="text-sm font-extrabold">Then Enter</div>
      </div>
      <div className="flex items-center gap-2">
        <div className="indent with-line" style={{ width: 3 * 14 }} />
        <WeightPicker
          value={weightingThen}
          onChange={(mode) => onWeightChange(node.id, mode, 'then')}
        />
        <WeightDetailChip
          mode={weightingThen}
          cappedFallback={thenCappedFallback}
          volWindow={thenVolWindow}
          tickerDatalistId={tickerDatalistId}
          onUpdateCappedFallback={(v) => onUpdateCappedFallback(node.id, v, 'then')}
          onUpdateVolWindow={(v) => onUpdateVolWindow(node.id, v, 'then')}
        />
      </div>
      {renderSlot('then', 3 * 14)}

      {/* EXIT IF header */}
      <div className="flex items-center gap-2">
        <div className="indent with-line" style={{ width: 14 }} />
        <div className="text-sm font-extrabold text-red-500">Exit If</div>
      </div>

      {/* Exit conditions */}
      <div className="condition-bubble">
        {node.exitConditions?.map((cond, idx) => (
          <div className="flex items-center gap-2" key={cond.id}>
            <div className="w-3.5 h-full border-l border-border" />
            <ConditionEditor
              condition={cond}
              index={idx}
              total={node.exitConditions?.length ?? 0}
              onUpdate={(updates) => onUpdateExitCondition(node.id, cond.id, updates)}
              onDelete={() => onDeleteExitCondition(node.id, cond.id)}
              openTickerModal={openTickerModal}
              nodeKind={node.kind}
            />
          </div>
        ))}
      </div>

      {/* Add exit condition buttons */}
      <div className="flex items-center gap-2">
        <div className="w-3.5 h-full border-l border-border" />
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onAddExitCondition(node.id, 'and')
            }}
          >
            And If
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onAddExitCondition(node.id, 'or')
            }}
          >
            Or If
          </Button>
        </div>
      </div>

      {/* Exit Into section */}
      <div className="flex items-center gap-2">
        <div className="indent with-line" style={{ width: 2 * 14 }} />
        <div className="text-sm font-extrabold">Exit Into</div>
      </div>
      <div className="flex items-center gap-2">
        <div className="indent with-line" style={{ width: 3 * 14 }} />
        <WeightPicker
          value={weightingElse}
          onChange={(mode) => onWeightChange(node.id, mode, 'else')}
        />
        <WeightDetailChip
          mode={weightingElse}
          cappedFallback={elseCappedFallback}
          volWindow={elseVolWindow}
          tickerDatalistId={tickerDatalistId}
          onUpdateCappedFallback={(v) => onUpdateCappedFallback(node.id, v, 'else')}
          onUpdateVolWindow={(v) => onUpdateVolWindow(node.id, v, 'else')}
        />
      </div>
      {renderSlot('else', 3 * 14)}
    </>
  )
}
