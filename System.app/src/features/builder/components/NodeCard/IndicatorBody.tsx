// src/features/builder/components/NodeCard/IndicatorBody.tsx
// Body content for indicator nodes with conditions, Then/Else branches

import { Button } from '@/components/ui/button'
import { ConditionEditor } from '../ConditionEditor'
import { WeightPicker } from '../WeightPicker'
import { WeightDetailChip } from '../WeightDetailChip'
import type { FlowNode, ConditionLine, WeightMode, PositionChoice, BlockKind } from '../../../../types'
import type { TickerModalMode } from '@/shared/components'
import type { ParameterRange } from '@/features/parameters/types'

export interface IndicatorBodyProps {
  node: FlowNode
  enabledOverlays?: Set<string>
  onToggleOverlay?: (key: string) => void
  onUpdateCondition: (nodeId: string, condId: string, updates: Partial<ConditionLine>) => void
  onDeleteCondition: (nodeId: string, condId: string) => void
  onAddCondition: (nodeId: string, type: 'and' | 'or') => void
  onWeightChange: (nodeId: string, mode: WeightMode, branch?: 'then' | 'else') => void
  onUpdateCappedFallback: (nodeId: string, value: PositionChoice, branch?: 'then' | 'else') => void
  onUpdateVolWindow: (nodeId: string, value: number, branch?: 'then' | 'else') => void
  openTickerModal?: (onSelect: (ticker: string) => void, restrictTo?: string[], modes?: TickerModalMode[], nodeKind?: BlockKind, initialValue?: string) => void
  tickerDatalistId?: string
  renderSlot: (slot: 'then' | 'else', depthPx: number) => React.ReactNode
  parameterRanges?: ParameterRange[]
  onUpdateRange?: (paramId: string, enabled: boolean, range?: { min: number; max: number; step: number }) => void
  isForgeMode?: boolean // Whether we're in Forge tab (enables ticker list features)
}

export const IndicatorBody = ({
  node,
  enabledOverlays,
  onToggleOverlay,
  onUpdateCondition,
  onDeleteCondition,
  onAddCondition,
  onWeightChange,
  onUpdateCappedFallback,
  onUpdateVolWindow,
  openTickerModal,
  tickerDatalistId,
  renderSlot,
  parameterRanges,
  onUpdateRange,
  isForgeMode,
}: IndicatorBodyProps) => {
  const weightingThen = node.weightingThen ?? node.weighting
  const weightingElse = node.weightingElse ?? node.weighting

  // Calculate detail chip props for Then branch
  const thenCappedFallback = node.cappedFallbackThen ?? node.cappedFallback ?? 'Empty'
  const thenVolWindow = node.volWindowThen ?? node.volWindow ?? 20

  // Calculate detail chip props for Else branch
  const elseCappedFallback = node.cappedFallbackElse ?? node.cappedFallback ?? 'Empty'
  const elseVolWindow = node.volWindowElse ?? node.volWindow ?? 20

  return (
    <>
      {/* Conditions */}
      <div className="condition-bubble">
        {node.conditions?.map((cond, idx) => {
          const overlayKey = `${node.id}:${cond.id}`
          const isOverlayActive = enabledOverlays?.has(overlayKey)
          return (
            <div className="flex items-center gap-2" key={cond.id}>
              <div className="w-3.5 h-full border-l border-border" />
              {/* Indicator overlay toggle button - only on first condition */}
              {onToggleOverlay && idx === 0 && (
                <Button
                  variant={isOverlayActive ? 'accent' : 'ghost'}
                  size="sm"
                  className={`h-6 w-6 p-0 text-xs ${isOverlayActive ? 'ring-2 ring-accent' : ''}`}
                  onClick={() => onToggleOverlay(overlayKey)}
                  title={isOverlayActive ? 'Hide indicator on chart' : 'Show indicator on chart'}
                >
                  📈
                </Button>
              )}
              <ConditionEditor
                condition={cond}
                index={idx}
                total={node.conditions?.length ?? 0}
                onUpdate={(updates) => onUpdateCondition(node.id, cond.id, updates)}
                onDelete={() => onDeleteCondition(node.id, cond.id)}
                openTickerModal={openTickerModal}
                nodeKind={node.kind}
                parameterRanges={parameterRanges}
                nodeId={node.id}
                onUpdateRange={onUpdateRange}
                isForgeMode={isForgeMode}
              />
            </div>
          )
        })}
      </div>

      {/* Add condition buttons */}
      <div className="flex items-center gap-2">
        <div className="w-3.5 h-full border-l border-border" />
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onAddCondition(node.id, 'and')
            }}
          >
            And If
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onAddCondition(node.id, 'or')
            }}
          >
            Or If
          </Button>
        </div>
      </div>

      {/* Then section */}
      <div className="flex items-center gap-2">
        <div className="w-7 h-full border-l border-border" />
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
  )
}
