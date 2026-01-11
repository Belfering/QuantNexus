// src/features/builder/components/NodeCard/DefaultBody.tsx
// Default body content for basic, function, and other node types

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { RangeConfigPopover } from '@/features/parameters/components/RangeConfigPopover'
import { WeightPicker } from '../WeightPicker'
import { WeightDetailChip } from '../WeightDetailChip'
import { IndicatorDropdown } from '../IndicatorDropdown'
import type { FlowNode, WeightMode, MetricChoice, RankChoice, SlotId, PositionChoice } from '../../../../types'
import type { ParameterRange, VisualParameter } from '@/features/parameters/types'
import { isWindowlessIndicator } from '../../../../constants'

// Line types from buildLines
type TextLine = {
  kind: 'text'
  id: string
  depth: number
  text: string
  tone?: 'tag' | 'title' | 'info' | 'label'
}

type SlotLine = {
  kind: 'slot'
  id: string
  depth: number
  slot: SlotId
}

type BuildLine = TextLine | SlotLine

export interface DefaultBodyProps {
  node: FlowNode
  lines: BuildLine[]
  onWeightChange: (nodeId: string, mode: WeightMode) => void
  onUpdateCappedFallback: (nodeId: string, value: PositionChoice) => void
  onUpdateVolWindow: (nodeId: string, value: number) => void
  onFunctionWindow: (nodeId: string, value: number) => void
  onFunctionMetric: (nodeId: string, metric: MetricChoice) => void
  onFunctionRank: (nodeId: string, rank: RankChoice) => void
  onFunctionBottom: (nodeId: string, value: number) => void
  tickerDatalistId?: string
  renderSlot: (slot: SlotId, depthPx: number) => React.ReactNode
  parameterRanges?: ParameterRange[]
  onUpdateRange?: (paramId: string, enabled: boolean, range?: { min: number; max: number; step: number }) => void
  underRollingNode?: boolean
}

export const DefaultBody = ({
  node,
  lines,
  onWeightChange,
  onUpdateCappedFallback,
  onUpdateVolWindow,
  onFunctionWindow,
  onFunctionMetric,
  onFunctionRank,
  onFunctionBottom,
  tickerDatalistId,
  renderSlot,
  parameterRanges = [],
  onUpdateRange,
  underRollingNode,
}: DefaultBodyProps) => {
  const [showWindowConfig, setShowWindowConfig] = useState(false)
  const [showBottomConfig, setShowBottomConfig] = useState(false)

  const cappedFallback = node.cappedFallback ?? 'Empty'
  const volWindow = node.volWindow ?? 20

  return (
    <>
      {lines.map((line) => {
        if (line.kind === 'text') {
          const isTag = line.tone === 'tag'
          const isFunctionDesc = node.kind === 'function' && line.id.endsWith('-desc')

          return (
            <div className="line" key={line.id}>
              <div className="indent with-line" style={{ width: line.depth * 14 }} />
              {isTag ? (
                <div className="weight-wrap">
                  <WeightPicker
                    value={node.weighting}
                    onChange={(mode) => onWeightChange(node.id, mode)}
                  />
                  <WeightDetailChip
                    mode={node.weighting}
                    cappedFallback={cappedFallback}
                    volWindow={volWindow}
                    tickerDatalistId={tickerDatalistId}
                    onUpdateCappedFallback={(v) => onUpdateCappedFallback(node.id, v)}
                    onUpdateVolWindow={(v) => onUpdateVolWindow(node.id, v)}
                  />
                </div>
              ) : isFunctionDesc ? (
                <Badge variant="default" className="gap-1.5 py-1 px-2.5">
                  Of the{' '}
                  {isWindowlessIndicator(node.metric ?? 'Relative Strength Index') ? null : (
                    <>
                      {(underRollingNode || onUpdateRange) ? (
                        (() => {
                          const paramId = `${node.id}-function-window`
                          const range = parameterRanges?.find(r => r.id === paramId)
                          const isOptimized = range?.enabled || underRollingNode

                          return (
                            <Popover open={showWindowConfig} onOpenChange={setShowWindowConfig}>
                              <PopoverTrigger asChild>
                                <div
                                  className="inline-flex items-center gap-1 cursor-pointer mx-1"
                                  onClick={() => setShowWindowConfig(true)}
                                >
                                  {isOptimized ? (
                                    <span className="h-7 px-2 flex items-center border border-primary rounded bg-primary/10 text-sm font-medium text-primary">
                                      {range?.min ?? ((node.window ?? 10) - 1)}-{range?.max ?? ((node.window ?? 10) + 1)}
                                    </span>
                                  ) : (
                                    <div className="w-14 h-7 px-1.5 inline-flex items-center justify-center border border-input rounded-md bg-background text-sm cursor-pointer hover:bg-accent/10">
                                      {node.window ?? 10}
                                    </div>
                                  )}
                                </div>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0" align="start">
                                <RangeConfigPopover
                                  parameter={{
                                    id: paramId,
                                    field: 'window',
                                    currentValue: node.window ?? 10,
                                    optimizationEnabled: isOptimized,
                                    min: range?.min,
                                    max: range?.max,
                                    step: range?.step,
                                  } as VisualParameter}
                                  onSave={(range) => {
                                    onUpdateRange?.(paramId, true, range)
                                    setShowWindowConfig(false)
                                  }}
                                  onDisable={() => {
                                    onUpdateRange?.(paramId, false)
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
                          className="w-14 h-7 px-1.5 inline-flex mx-1"
                          value={node.window ?? 10}
                          onChange={(e) => onFunctionWindow(node.id, Number(e.target.value))}
                        />
                      )}
                      d{' '}
                    </>
                  )}
                  <IndicatorDropdown
                    value={node.metric ?? 'Relative Strength Index'}
                    onChange={(m) => onFunctionMetric(node.id, m)}
                    className="h-7 mx-1"
                  />
                  {isWindowlessIndicator(node.metric ?? 'Relative Strength Index')
                    ? ' pick the '
                    : 's pick the '}
                  <Select
                    className="h-7 px-2 mx-1 text-xs font-bold"
                    value={node.rank ?? 'Bottom'}
                    onChange={(e) => onFunctionRank(node.id, e.target.value as RankChoice)}
                  >
                    <option value="Bottom">Bottom</option>
                    <option value="Top">Top</option>
                  </Select>{' '}
                  {(underRollingNode || onUpdateRange) ? (
                    (() => {
                      const paramId = `${node.id}-function-bottom`
                      const range = parameterRanges?.find(r => r.id === paramId)
                      const isOptimized = range?.enabled || underRollingNode

                      return (
                        <Popover open={showBottomConfig} onOpenChange={setShowBottomConfig}>
                          <PopoverTrigger asChild>
                            <div
                              className="inline-flex items-center gap-1 cursor-pointer"
                              onClick={() => setShowBottomConfig(true)}
                            >
                              {isOptimized ? (
                                <span className="h-7 px-2 flex items-center border border-primary rounded bg-primary/10 text-sm font-medium text-primary">
                                  {range?.min ?? 1}-{range?.max ?? 1}
                                </span>
                              ) : (
                                <div className="w-14 h-7 px-1.5 inline-flex items-center justify-center border border-input rounded-md bg-background text-sm cursor-pointer hover:bg-accent/10">
                                  {node.bottom ?? 1}
                                </div>
                              )}
                            </div>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <RangeConfigPopover
                              parameter={{
                                id: paramId,
                                field: 'bottom',
                                currentValue: node.bottom ?? 1,
                                optimizationEnabled: isOptimized,
                                min: range?.min,
                                max: range?.max,
                                step: range?.step,
                              } as VisualParameter}
                              onSave={(range) => {
                                onUpdateRange?.(paramId, true, range)
                                setShowBottomConfig(false)
                              }}
                              onDisable={() => {
                                onUpdateRange?.(paramId, false)
                                setShowBottomConfig(false)
                              }}
                            />
                          </PopoverContent>
                        </Popover>
                      )
                    })()
                  ) : (
                    <Input
                      type="number"
                      className="w-14 h-7 px-1.5 inline-flex"
                      value={node.bottom ?? 1}
                      onChange={(e) => onFunctionBottom(node.id, Number(e.target.value))}
                    />
                  )}
                </Badge>
              ) : (
                <div className={`chip ${line.tone ?? ''}`}>{line.text}</div>
              )}
            </div>
          )
        }

        // Slot line
        const depthPx = line.depth * 14
        return renderSlot(line.slot, depthPx)
      })}
    </>
  )
}
