// src/features/builder/components/NodeCard/ScalingBody.tsx
// Body content for scaling nodes with indicator-based allocation

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { IndicatorDropdown } from '../IndicatorDropdown'
import { WeightPicker } from '../WeightPicker'
import { WeightDetailChip } from '../WeightDetailChip'
import type { FlowNode, MetricChoice, WeightMode, PositionChoice } from '../../../../types'
import { isWindowlessIndicator } from '../../../../constants'

export interface ScalingBodyProps {
  node: FlowNode
  enabledOverlays?: Set<string>
  onToggleOverlay?: (key: string) => void
  onUpdateScaling: (
    nodeId: string,
    updates: {
      scaleMetric?: MetricChoice
      scaleWindow?: number
      scaleTicker?: string
      scaleFrom?: number
      scaleTo?: number
    }
  ) => void
  onWeightChange: (nodeId: string, mode: WeightMode, branch?: 'then' | 'else') => void
  onUpdateCappedFallback: (nodeId: string, value: PositionChoice, branch?: 'then' | 'else') => void
  onUpdateVolWindow: (nodeId: string, value: number, branch?: 'then' | 'else') => void
  openTickerModal?: (onSelect: (ticker: string) => void) => void
  tickerDatalistId?: string
  renderSlot: (slot: 'then' | 'else', depthPx: number) => React.ReactNode
}

export const ScalingBody = ({
  node,
  enabledOverlays,
  onToggleOverlay,
  onUpdateScaling,
  onWeightChange,
  onUpdateCappedFallback,
  onUpdateVolWindow,
  openTickerModal,
  tickerDatalistId,
  renderSlot,
}: ScalingBodyProps) => {
  const scaleMetric = node.scaleMetric ?? 'Relative Strength Index'
  const overlayKey = `${node.id}:scale`
  const isOverlayActive = enabledOverlays?.has(overlayKey)

  const weightingThen = node.weightingThen ?? node.weighting
  const weightingElse = node.weightingElse ?? node.weighting
  const thenCappedFallback = node.cappedFallbackThen ?? node.cappedFallback ?? 'Empty'
  const thenVolWindow = node.volWindowThen ?? node.volWindow ?? 20
  const elseCappedFallback = node.cappedFallbackElse ?? node.cappedFallback ?? 'Empty'
  const elseVolWindow = node.volWindowElse ?? node.volWindow ?? 20

  return (
    <>
      {/* Scale by indicator + From/To range */}
      <div className="flex items-center gap-2">
        <div className="indent with-line" style={{ width: 14 }} />
        <Badge variant="default" className="gap-1.5 py-1 px-2.5">
          {/* Nested Scale by badge */}
          <Badge variant="default" className="gap-1 py-1 px-2">
            {/* Indicator overlay toggle button */}
            {onToggleOverlay && (
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
            Scale by{' '}
            {isWindowlessIndicator(scaleMetric) ? null : (
              <>
                <Input
                  type="number"
                  className="w-14 h-7 px-1.5 mx-1 inline-flex"
                  value={node.scaleWindow ?? 14}
                  onChange={(e) => onUpdateScaling(node.id, { scaleWindow: Number(e.target.value) })}
                />
                d{' '}
              </>
            )}
            <IndicatorDropdown
              value={scaleMetric}
              onChange={(m) => onUpdateScaling(node.id, { scaleMetric: m })}
              className="h-7 px-1.5 mx-1"
            />
            {' of '}
            <button
              className="h-7 px-2 mx-1 border border-border rounded bg-card text-sm font-mono hover:bg-muted/50"
              onClick={() =>
                openTickerModal?.((ticker) => onUpdateScaling(node.id, { scaleTicker: ticker }))
              }
            >
              {node.scaleTicker ?? 'SPY'}
            </button>
          </Badge>
          {' '}From below{' '}
          <Input
            type="number"
            className="w-16 h-8 px-1.5 mx-1 inline-flex"
            value={node.scaleFrom ?? 30}
            onChange={(e) => onUpdateScaling(node.id, { scaleFrom: Number(e.target.value) })}
          />
          {' (100% Then) to above '}
          <Input
            type="number"
            className="w-16 h-8 px-1.5 mx-1 inline-flex"
            value={node.scaleTo ?? 70}
            onChange={(e) => onUpdateScaling(node.id, { scaleTo: Number(e.target.value) })}
          />
          {' (100% Else)'}
        </Badge>
      </div>

      {/* Then (Low) section */}
      <div className="flex items-center gap-2">
        <div className="w-7 h-full border-l border-border" />
        <div className="text-sm font-extrabold">Then (Low)</div>
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

      {/* Else (High) section */}
      <div className="flex items-center gap-2">
        <div className="indent with-line" style={{ width: 2 * 14 }} />
        <div className="text-sm font-extrabold">Else (High)</div>
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
