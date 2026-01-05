// src/features/builder/components/NodeCard/NumberedBody.tsx
// Body content for numbered nodes with quantifier logic and conditions

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { ConditionEditor } from '../ConditionEditor'
import { WeightPicker } from '../WeightPicker'
import { WeightDetailChip } from '../WeightDetailChip'
import type {
  FlowNode,
  ConditionLine,
  WeightMode,
  NumberedQuantifier,
  PositionChoice,
  SlotId,
} from '../../../../types'

// Generate ladder slot labels for N conditions: "All (N)", "N-1 of N", ..., "None"
const getLadderSlotLabel = (matchCount: number, totalConditions: number): string => {
  if (matchCount === totalConditions) return `All (${totalConditions})`
  if (matchCount === 0) return 'None'
  return `${matchCount} of ${totalConditions}`
}

export interface NumberedBodyProps {
  node: FlowNode
  onNumberedQuantifier: (nodeId: string, quantifier: NumberedQuantifier) => void
  onNumberedN: (nodeId: string, n: number) => void
  onAddNumberedItem: (nodeId: string) => void
  onDeleteNumberedItem: (nodeId: string, itemId: string) => void
  onAddCondition: (nodeId: string, type: 'and' | 'or', itemId?: string) => void
  onDeleteCondition: (nodeId: string, condId: string, itemId?: string) => void
  onUpdateCondition: (
    nodeId: string,
    condId: string,
    updates: Partial<ConditionLine>,
    itemId?: string
  ) => void
  onWeightChange: (nodeId: string, mode: WeightMode, branch?: 'then' | 'else') => void
  onUpdateCappedFallback: (nodeId: string, value: PositionChoice, branch?: 'then' | 'else') => void
  onUpdateVolWindow: (nodeId: string, value: number, branch?: 'then' | 'else') => void
  openTickerModal?: (onSelect: (ticker: string) => void) => void
  tickerDatalistId?: string
  renderSlot: (slot: SlotId, depthPx: number) => React.ReactNode
}

export const NumberedBody = ({
  node,
  onNumberedQuantifier,
  onNumberedN,
  onAddNumberedItem,
  onDeleteNumberedItem,
  onAddCondition,
  onDeleteCondition,
  onUpdateCondition,
  onWeightChange,
  onUpdateCappedFallback,
  onUpdateVolWindow,
  openTickerModal,
  tickerDatalistId,
  renderSlot,
}: NumberedBodyProps) => {
  const [expandedLadderRows, setExpandedLadderRows] = useState<Set<string>>(() => new Set())

  const quantifier = node.numbered?.quantifier ?? 'all'
  const isLadderMode = quantifier === 'ladder'
  const showNInput =
    quantifier === 'exactly' || quantifier === 'atLeast' || quantifier === 'atMost'

  const weightingThen = node.weightingThen ?? node.weighting
  const weightingElse = node.weightingElse ?? node.weighting
  const thenCappedFallback = node.cappedFallbackThen ?? node.cappedFallback ?? 'Empty'
  const thenVolWindow = node.volWindowThen ?? node.volWindow ?? 20
  const elseCappedFallback = node.cappedFallbackElse ?? node.cappedFallback ?? 'Empty'
  const elseVolWindow = node.volWindowElse ?? node.volWindow ?? 20

  // Render condition row using ConditionEditor
  const renderConditionRow = (
    itemId: string,
    cond: ConditionLine,
    idx: number,
    total: number,
    itemIndex: number
  ) => (
    <ConditionEditor
      key={cond.id}
      condition={cond}
      index={idx}
      total={total}
      allowDeleteFirst={itemIndex > 0}
      onUpdate={(updates) => onUpdateCondition(node.id, cond.id, updates, itemId)}
      onDelete={() => {
        // If it's the only condition in a non-first item, delete the whole item
        if (itemIndex > 0 && total === 1) {
          onDeleteNumberedItem(node.id, itemId)
        } else {
          onDeleteCondition(node.id, cond.id, itemId)
        }
      }}
      openTickerModal={openTickerModal}
    />
  )

  // Render indicator item with its conditions
  const renderIndicatorItem = (
    item: { id: string; conditions: ConditionLine[]; groupLogic?: 'and' | 'or' },
    itemIndex: number
  ) => (
    <div key={item.id}>
      <div className="flex items-center gap-2">
        <div className="indent with-line" style={{ width: 14 }} />
        <div className="text-sm font-extrabold">Indicator</div>
        {item.groupLogic === 'or' && item.conditions.length > 1 && (
          <span className="text-xs text-muted-foreground italic">(any)</span>
        )}
        {item.groupLogic === 'and' && item.conditions.length > 1 && (
          <span className="text-xs text-muted-foreground italic">(all)</span>
        )}
      </div>
      <div className="line condition-block">
        <div className="indent with-line" style={{ width: 2 * 14 }} />
        <div className="condition-bubble">
          {item.conditions.map((cond, condIdx) =>
            renderConditionRow(item.id, cond, condIdx, item.conditions.length, itemIndex)
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="indent with-line" style={{ width: 2 * 14 }} />
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onAddCondition(node.id, 'and', item.id)
            }}
          >
            And If
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onAddCondition(node.id, 'or', item.id)
            }}
          >
            Or If
          </Button>
        </div>
      </div>
    </div>
  )

  return (
    <>
      {/* Quantifier selector */}
      <div className="flex items-center gap-2">
        <div className="indent with-line" style={{ width: 14 }} />
        <Badge variant="default" className="gap-1.5 py-1 px-2.5">
          If{' '}
          <Select
            className="h-7 px-1.5 mx-1 inline-flex"
            value={quantifier}
            onChange={(e) => onNumberedQuantifier(node.id, e.target.value as NumberedQuantifier)}
          >
            <option value="any">Any</option>
            <option value="all">All</option>
            <option value="none">None</option>
            <option value="exactly">Exactly</option>
            <option value="atLeast">At Least</option>
            <option value="atMost">At Most</option>
            <option value="ladder">Ladder</option>
          </Select>{' '}
          {showNInput && (
            <>
              <Input
                type="number"
                className="w-14 h-7 px-1.5 inline-flex"
                value={node.numbered?.n ?? 1}
                onChange={(e) => onNumberedN(node.id, Number(e.target.value))}
              />{' '}
            </>
          )}
          of the following conditions are true
        </Badge>
      </div>

      {isLadderMode ? (
        <>
          {/* Ladder mode: condition editing */}
          {(node.numbered?.items ?? []).map((item, idx) =>
            renderIndicatorItem(item, idx)
          )}

          {/* Add Indicator button */}
          <div className="flex items-center gap-2">
            <div className="indent with-line" style={{ width: 14 }} />
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  onAddNumberedItem(node.id)
                }}
              >
                Add Indicator
              </Button>
            </div>
          </div>

          {/* Ladder rows: All (N), N-1, ..., None */}
          {(() => {
            const totalConds = (node.numbered?.items ?? []).length
            const rows = []
            for (let i = totalConds; i >= 0; i--) {
              const slotKey = `ladder-${i}` as SlotId
              const label = getLadderSlotLabel(i, totalConds)
              const isExpanded = expandedLadderRows.has(slotKey)
              rows.push(
                <div key={slotKey}>
                  <div
                    className="flex items-center gap-2 cursor-pointer hover:bg-accent/50 rounded px-1 py-0.5"
                    onClick={(e) => {
                      e.stopPropagation()
                      setExpandedLadderRows((prev) => {
                        const next = new Set(prev)
                        if (next.has(slotKey)) {
                          next.delete(slotKey)
                        } else {
                          next.add(slotKey)
                        }
                        return next
                      })
                    }}
                  >
                    <div className="indent with-line" style={{ width: 14 }} />
                    <span className="text-sm font-extrabold">
                      {isExpanded ? '▼' : '▶'} {label}
                    </span>
                  </div>
                  {isExpanded && renderSlot(slotKey, 2 * 14)}
                </div>
              )
            }
            return rows
          })()}
        </>
      ) : (
        <>
          {/* Regular mode: conditions + Then/Else */}
          {(node.numbered?.items ?? []).map((item, idx) =>
            renderIndicatorItem(item, idx)
          )}

          {/* Add Indicator button */}
          <div className="flex items-center gap-2">
            <div className="indent with-line" style={{ width: 14 }} />
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  onAddNumberedItem(node.id)
                }}
              >
                Add Indicator
              </Button>
            </div>
          </div>

          {/* Then section */}
          <div className="flex items-center gap-2">
            <div className="indent with-line" style={{ width: 2 * 14 }} />
            <div className="text-sm font-extrabold">Then</div>
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

          {/* Else section */}
          <div className="flex items-center gap-2">
            <div className="indent with-line" style={{ width: 2 * 14 }} />
            <div className="text-sm font-extrabold">Else</div>
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
      )}
    </>
  )
}
