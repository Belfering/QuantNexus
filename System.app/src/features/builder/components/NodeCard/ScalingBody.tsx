// src/features/builder/components/NodeCard/ScalingBody.tsx
// Body content for scaling nodes with indicator-based allocation

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { RangeConfigPopover } from '@/features/parameters/components/RangeConfigPopover'
import { IndicatorDropdown } from '../IndicatorDropdown'
import { WeightPicker } from '../WeightPicker'
import { WeightDetailChip } from '../WeightDetailChip'
import type { FlowNode, MetricChoice, WeightMode, PositionChoice, BlockKind } from '../../../../types'
import type { TickerModalMode } from '@/shared/components'
import type { ParameterRange, VisualParameter } from '@/features/parameters/types'
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
  onUpdateMinCap: (nodeId: string, value: number, branch?: 'then' | 'else') => void
  onUpdateMaxCap: (nodeId: string, value: number, branch?: 'then' | 'else') => void
  openTickerModal?: (onSelect: (ticker: string) => void, restrictTo?: string[], modes?: TickerModalMode[], nodeKind?: BlockKind, initialValue?: string) => void
  renderSlot: (slot: 'then' | 'else', depthPx: number) => React.ReactNode
  parameterRanges?: ParameterRange[]
  onUpdateRange?: (paramId: string, enabled: boolean, range?: { min: number; max: number; step: number }) => void
  isForgeMode?: boolean // Whether we're in Forge tab (enables ticker list features)
}

export const ScalingBody = ({
  node,
  enabledOverlays,
  onToggleOverlay,
  onUpdateScaling,
  onWeightChange,
  onUpdateCappedFallback,
  onUpdateVolWindow,
  onUpdateMinCap,
  onUpdateMaxCap,
  openTickerModal,
  isForgeMode,
  renderSlot,
  parameterRanges = [],
  onUpdateRange,
}: ScalingBodyProps) => {
  const [showWindowConfig, setShowWindowConfig] = useState(false)
  const [showFromConfig, setShowFromConfig] = useState(false)
  const [showToConfig, setShowToConfig] = useState(false)

  const scaleMetric = node.scaleMetric ?? 'Relative Strength Index'
  const overlayKey = `${node.id}:scale`
  const isOverlayActive = enabledOverlays?.has(overlayKey)

  const weightingThen = node.weightingThen ?? node.weighting
  const weightingElse = node.weightingElse ?? node.weighting
  const thenCappedFallback = node.cappedFallbackThen ?? node.cappedFallback ?? 'Empty'
  const thenVolWindow = node.volWindowThen ?? node.volWindow ?? 20
  const thenMinCap = node.minCapThen ?? node.minCap ?? 0
  const thenMaxCap = node.maxCapThen ?? node.maxCap ?? 100
  const elseCappedFallback = node.cappedFallbackElse ?? node.cappedFallback ?? 'Empty'
  const elseVolWindow = node.volWindowElse ?? node.volWindow ?? 20
  const elseMinCap = node.minCapElse ?? node.minCap ?? 0
  const elseMaxCap = node.maxCapElse ?? node.maxCap ?? 100

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
                {onUpdateRange ? (
                  (() => {
                    const paramId = `${node.id}-scaling-window`
                    const range = parameterRanges?.find(r => r.id === paramId)
                    const isOptimized = range?.enabled

                    return (
                      <Popover open={showWindowConfig} onOpenChange={setShowWindowConfig}>
                        <PopoverTrigger asChild>
                          <div
                            className="inline-flex items-center gap-1 cursor-pointer mx-1"
                            onClick={() => setShowWindowConfig(true)}
                          >
                            {isOptimized ? (
                              <span className="h-7 px-2 flex items-center border border-primary rounded bg-primary/10 text-sm font-medium text-primary">
                                {range.min}-{range.max}
                              </span>
                            ) : (
                              <div className="w-14 h-7 px-1.5 inline-flex items-center justify-center border border-input rounded-md bg-background text-sm cursor-pointer hover:bg-accent/10">
                                {node.scaleWindow ?? 14}
                              </div>
                            )}
                          </div>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <RangeConfigPopover
                            parameter={{
                              id: paramId,
                              field: 'scaleWindow',
                              currentValue: node.scaleWindow ?? 14,
                              optimizationEnabled: isOptimized,
                              min: range?.min,
                              max: range?.max,
                              step: range?.step,
                            } as VisualParameter}
                            onSave={(range) => {
                              onUpdateRange(paramId, true, range)
                              setShowWindowConfig(false)
                            }}
                            onDisable={() => {
                              onUpdateRange(paramId, false)
                              setShowWindowConfig(false)
                            }}
                          />
                        </PopoverContent>
                      </Popover>
                    )
                  })()
                ) : (
                  <Input
                    type="number"
                    className="w-14 h-7 px-1.5 mx-1 inline-flex"
                    value={node.scaleWindow ?? 14}
                    onChange={(e) => onUpdateScaling(node.id, { scaleWindow: Number(e.target.value) })}
                  />
                )}
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
              onClick={() => {
                // In Forge mode, allow tickers, ratios, branches, and lists. In Model mode, exclude lists.
                const allowedModes = isForgeMode ? ['tickers', 'ratios', 'branches', 'lists'] : ['tickers', 'ratios', 'branches']
                openTickerModal?.((ticker) => onUpdateScaling(node.id, { scaleTicker: ticker }), undefined, allowedModes, node.kind, node.scaleTicker ?? 'SPY')
              }}
            >
              {node.scaleTicker ?? 'SPY'}
            </button>
          </Badge>
          {' '}From below{' '}
          {onUpdateRange ? (
            (() => {
              const paramId = `${node.id}-scaling-from`
              const range = parameterRanges?.find(r => r.id === paramId)
              const isOptimized = range?.enabled

              return (
                <Popover open={showFromConfig} onOpenChange={setShowFromConfig}>
                  <PopoverTrigger asChild>
                    <div
                      className="inline-flex items-center gap-1 cursor-pointer mx-1"
                      onClick={() => setShowFromConfig(true)}
                    >
                      {isOptimized ? (
                        <span className="h-8 px-2 flex items-center border border-primary rounded bg-primary/10 text-sm font-medium text-primary">
                          {range.min}-{range.max}
                        </span>
                      ) : (
                        <div className="w-16 h-8 px-1.5 inline-flex items-center justify-center border border-input rounded-md bg-background text-sm cursor-pointer hover:bg-accent/10">
                          {node.scaleFrom ?? 30}
                        </div>
                      )}
                    </div>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <RangeConfigPopover
                      parameter={{
                        id: paramId,
                        field: 'scaleFrom',
                        currentValue: node.scaleFrom ?? 30,
                        optimizationEnabled: isOptimized,
                        min: range?.min,
                        max: range?.max,
                        step: range?.step,
                      } as VisualParameter}
                      onSave={(range) => {
                        onUpdateRange(paramId, true, range)
                        setShowFromConfig(false)
                      }}
                      onDisable={() => {
                        onUpdateRange(paramId, false)
                        setShowFromConfig(false)
                      }}
                    />
                  </PopoverContent>
                </Popover>
              )
            })()
          ) : (
            <Input
              type="number"
              className="w-16 h-8 px-1.5 mx-1 inline-flex"
              value={node.scaleFrom ?? 30}
              onChange={(e) => onUpdateScaling(node.id, { scaleFrom: Number(e.target.value) })}
            />
          )}
          {' (100% Then) to above '}
          {onUpdateRange ? (
            (() => {
              const paramId = `${node.id}-scaling-to`
              const range = parameterRanges?.find(r => r.id === paramId)
              const isOptimized = range?.enabled

              return (
                <Popover open={showToConfig} onOpenChange={setShowToConfig}>
                  <PopoverTrigger asChild>
                    <div
                      className="inline-flex items-center gap-1 cursor-pointer mx-1"
                      onClick={() => setShowToConfig(true)}
                    >
                      {isOptimized ? (
                        <span className="h-8 px-2 flex items-center border border-primary rounded bg-primary/10 text-sm font-medium text-primary">
                          {range.min}-{range.max}
                        </span>
                      ) : (
                        <div className="w-16 h-8 px-1.5 inline-flex items-center justify-center border border-input rounded-md bg-background text-sm cursor-pointer hover:bg-accent/10">
                          {node.scaleTo ?? 70}
                        </div>
                      )}
                    </div>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <RangeConfigPopover
                      parameter={{
                        id: paramId,
                        field: 'scaleTo',
                        currentValue: node.scaleTo ?? 70,
                        optimizationEnabled: isOptimized,
                        min: range?.min,
                        max: range?.max,
                        step: range?.step,
                      } as VisualParameter}
                      onSave={(range) => {
                        onUpdateRange(paramId, true, range)
                        setShowToConfig(false)
                      }}
                      onDisable={() => {
                        onUpdateRange(paramId, false)
                        setShowToConfig(false)
                      }}
                    />
                  </PopoverContent>
                </Popover>
              )
            })()
          ) : (
            <Input
              type="number"
              className="w-16 h-8 px-1.5 mx-1 inline-flex"
              value={node.scaleTo ?? 70}
              onChange={(e) => onUpdateScaling(node.id, { scaleTo: Number(e.target.value) })}
            />
          )}
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
          minCap={thenMinCap}
          maxCap={thenMaxCap}
          onUpdateCappedFallback={(v) => onUpdateCappedFallback(node.id, v, 'then')}
          onUpdateVolWindow={(v) => onUpdateVolWindow(node.id, v, 'then')}
          onUpdateMinCap={(v) => onUpdateMinCap(node.id, v, 'then')}
          onUpdateMaxCap={(v) => onUpdateMaxCap(node.id, v, 'then')}
          openTickerModal={openTickerModal}
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
          minCap={elseMinCap}
          maxCap={elseMaxCap}
          onUpdateCappedFallback={(v) => onUpdateCappedFallback(node.id, v, 'else')}
          onUpdateVolWindow={(v) => onUpdateVolWindow(node.id, v, 'else')}
          onUpdateMinCap={(v) => onUpdateMinCap(node.id, v, 'else')}
          onUpdateMaxCap={(v) => onUpdateMaxCap(node.id, v, 'else')}
          openTickerModal={openTickerModal}
        />
      </div>
      {renderSlot('else', 3 * 14)}
    </>
  )
}
