// src/features/builder/components/ConditionEditor.tsx
// Single condition row editor with all inputs

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { RangeConfigPopover } from '@/features/parameters/components/RangeConfigPopover'
import type { ConditionLine, MetricChoice, ComparatorChoice, PositionChoice, BlockKind } from '../../../types'
import type { TickerModalMode } from '@/shared/components'
import type { ParameterRange, VisualParameter } from '@/features/parameters/types'
import { isWindowlessIndicator } from '../../../constants'
import { IndicatorDropdown } from './IndicatorDropdown'
import { getIndicatorConfig } from '@/constants/indicatorDefaults'

// Month names for date picker
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

// Get max days for a given month (using non-leap year as default)
const getDaysInMonth = (month: number): number => {
  const daysPerMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return daysPerMonth[(month - 1) % 12] || 31
}

// Date picker component for month/day selection (defined outside to prevent recreation)
const DatePicker = ({ month, day, onChange }: { month: number; day: number; onChange: (m: number, d: number) => void }) => (
  <span className="inline-flex items-center gap-1">
    <Select
      className="h-8 px-1.5 mx-0.5"
      value={month}
      onChange={(e) => {
        const newMonth = Number(e.target.value)
        const maxDay = getDaysInMonth(newMonth)
        onChange(newMonth, Math.min(day, maxDay))
      }}
    >
      {MONTHS.map((name, i) => (
        <option key={i} value={i + 1}>{name}</option>
      ))}
    </Select>
    <Select
      className="h-8 w-14 px-1.5 mx-0.5"
      value={day}
      onChange={(e) => onChange(month, Number(e.target.value))}
    >
      {Array.from({ length: getDaysInMonth(month) }, (_, i) => i + 1).map(d => (
        <option key={d} value={d}>{d}</option>
      ))}
    </Select>
  </span>
)

export interface ConditionEditorProps {
  condition: ConditionLine
  /** Index of this condition in the list */
  index: number
  /** Total number of conditions */
  total: number
  /** Whether delete is allowed for the first condition */
  allowDeleteFirst?: boolean
  /** Called when any field is updated */
  onUpdate: (updates: Partial<ConditionLine>) => void
  /** Called to delete this condition */
  onDelete: () => void
  /** Optional function to open ticker search modal */
  openTickerModal?: (onSelect: (ticker: string) => void, restrictTo?: string[], modes?: TickerModalMode[], nodeKind?: BlockKind, initialValue?: string, nodeId?: string) => void
  /** Node kind for the ticker modal context */
  nodeKind?: BlockKind
  /** Parameter ranges for optimization */
  parameterRanges?: ParameterRange[]
  /** Node ID for building parameter IDs */
  nodeId?: string
  /** Callback for updating parameter ranges */
  onUpdateRange?: (paramId: string, enabled: boolean, range?: { min: number; max: number; step: number }) => void
  /** Whether we're in Forge tab (enables ticker list features) */
  isForgeMode?: boolean
  /** Whether this node is under a Rolling node */
  underRollingNode?: boolean
}

export const ConditionEditor = ({
  condition: cond,
  index,
  total,
  allowDeleteFirst = false,
  onUpdate,
  onDelete,
  openTickerModal,
  nodeKind,
  parameterRanges = [],
  nodeId,
  onUpdateRange,
  isForgeMode,
  underRollingNode,
}: ConditionEditorProps) => {
  // State for range config popovers
  const [showWindowConfig, setShowWindowConfig] = useState(false)
  const [showThresholdConfig, setShowThresholdConfig] = useState(false)
  const [showRightWindowConfig, setShowRightWindowConfig] = useState(false)
  const [showForDaysConfig, setShowForDaysConfig] = useState(false)
  const prefix = cond.type === 'and' ? 'And if the ' : cond.type === 'or' ? 'Or if the ' : 'If the '
  const isSingleLineItem = total === 1
  const canDelete = (total > 1 && (index > 0 || allowDeleteFirst)) || (allowDeleteFirst && isSingleLineItem)

  // Check if this is a Date-based condition
  const isDateCondition = cond.metric === 'Date'

  // Helper to format ticker display (show "List: Name" for ticker lists)
  const formatTickerDisplay = (ticker: string, listName?: string): string => {
    if (ticker.startsWith('list:')) {
      return listName ? `List: ${listName}` : 'List'
    }
    return ticker
  }

  // Helper to determine if ticker is in Auto mode
  const isAutoMode = (mode?: 'manual' | 'match_indicator'): boolean => {
    return mode === 'match_indicator'
  }

  const isLeftAuto = isAutoMode(cond.conditionMode)
  const isRightAuto = cond.expanded && isAutoMode(cond.rightConditionMode)

  return (
    <div className="flex items-center gap-2">
      <Badge variant="default" className="gap-1 py-1 px-2.5">
        {prefix}

        {/* Date-specific UI */}
        {isDateCondition ? (
          <>
            <IndicatorDropdown
              value={cond.metric}
              onChange={(m) => onUpdate({ metric: m })}
              className="h-8 px-1.5 mx-1"
            />
            {' is '}
            <DatePicker
              month={cond.dateMonth ?? 1}
              day={cond.dateDay ?? 1}
              onChange={(m, d) => onUpdate({ dateMonth: m, dateDay: d })}
            />
            {/* Expanded: date range (from - to) */}
            {cond.expanded && (
              <>
                {' to '}
                <DatePicker
                  month={cond.dateTo?.month ?? cond.dateMonth ?? 1}
                  day={cond.dateTo?.day ?? 31}
                  onChange={(m, d) => onUpdate({ dateTo: { month: m, day: d } })}
                />
              </>
            )}
          </>
        ) : (
          <>
            {/* Window input (hidden for windowless indicators) */}
            {isWindowlessIndicator(cond.metric) ? null : (
              <>
                {(underRollingNode || onUpdateRange) && nodeId ? (
                  (() => {
                    const paramId = `${nodeId}-${cond.id}-window`
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
                              <span className="h-8 px-2 flex items-center border border-primary rounded bg-primary/10 text-sm font-medium text-primary">
                                {range?.min ?? (cond.window - 1)}-{range?.max ?? (cond.window + 1)}
                              </span>
                            ) : (
                              <div className="w-14 h-8 px-1.5 inline-flex items-center justify-center border border-input rounded-md bg-background text-sm cursor-pointer hover:bg-accent/10">
                                {cond.window}
                              </div>
                            )}
                          </div>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <RangeConfigPopover
                            parameter={{
                              id: paramId,
                              field: 'window',
                              currentValue: cond.window,
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
                    className="w-14 h-8 px-1.5 mx-1 inline-flex"
                    type="number"
                    value={cond.window}
                    onChange={(e) => onUpdate({ window: Number(e.target.value) })}
                  />
                )}
                d{' '}
              </>
            )}

            {/* Indicator dropdown */}
            <IndicatorDropdown
              value={cond.metric}
              onChange={(m) => onUpdate({ metric: m })}
              className="h-8 px-1.5 mx-1"
            />

            {/* Ticker selector */}
            {' of '}
            <button
              className="h-8 px-2 mx-1 border border-border rounded bg-card text-sm font-mono hover:bg-muted/50"
              onClick={() => {
                // In Forge mode, allow tickers, ratios, branches, and lists. In Model mode, exclude lists.
                const allowedModes = isForgeMode ? ['tickers', 'ratios', 'branches', 'lists'] : ['tickers', 'ratios', 'branches']
                openTickerModal?.((ticker) => {
                  // Handle Auto mode selection
                  if (ticker === 'mode:match_indicator') {
                    onUpdate({
                      conditionMode: 'match_indicator',
                      ticker: 'AUTO' as PositionChoice  // Placeholder
                    })
                    return
                  }

                  // When changing ticker, clear ticker list fields if selecting a non-list ticker
                  if (ticker.startsWith('list:')) {
                    onUpdate({
                      ticker: ticker as PositionChoice,
                      conditionMode: 'manual'
                    })
                  } else {
                    // Clear ticker list metadata when selecting a regular ticker
                    onUpdate({
                      ticker: ticker as PositionChoice,
                      tickerListId: undefined,
                      tickerListName: undefined,
                      conditionMode: 'manual'
                    })
                  }
                }, undefined, allowedModes, nodeKind, cond.ticker, nodeId)
              }}
            >
              {isLeftAuto ? '(Auto)' : formatTickerDisplay(cond.ticker, cond.tickerListName)}
            </button>

            {/* Comparator */}
            {' '}
            <Select
              className="h-8 px-1.5 mx-1"
              value={cond.comparator}
              onChange={(e) => onUpdate({ comparator: e.target.value as ComparatorChoice })}
            >
              <option value="lt">is Less Than</option>
              <option value="gt">is Greater Than</option>
              <option value="crossAbove">Crosses Above</option>
              <option value="crossBelow">Crosses Below</option>
            </Select>

            {/* Threshold (hidden when expanded) */}
            {cond.expanded ? null : (
              (underRollingNode || onUpdateRange) && nodeId ? (
                (() => {
                  const paramId = `${nodeId}-${cond.id}-threshold`
                  const range = parameterRanges?.find(r => r.id === paramId)
                  const isOptimized = range?.enabled || underRollingNode
                  const indicatorConfig = getIndicatorConfig(cond.metric)

                  return (
                    <Popover open={showThresholdConfig} onOpenChange={setShowThresholdConfig}>
                      <PopoverTrigger asChild>
                        <div
                          className="inline-flex items-center gap-1 cursor-pointer mx-1"
                          onClick={() => setShowThresholdConfig(true)}
                        >
                          {isOptimized ? (
                            <span className="h-8 px-2 flex items-center border border-primary rounded bg-primary/10 text-sm font-medium text-primary">
                              {range?.min ?? (cond.threshold - 1)}-{range?.max ?? (cond.threshold + 1)}
                            </span>
                          ) : (
                            <div className="w-14 h-8 px-1.5 inline-flex items-center justify-center border border-input rounded-md bg-background text-sm cursor-pointer hover:bg-accent/10">
                              {cond.threshold}
                            </div>
                          )}
                        </div>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <RangeConfigPopover
                          parameter={{
                            id: paramId,
                            field: 'threshold',
                            currentValue: cond.threshold,
                            optimizationEnabled: isOptimized,
                            min: range?.min,
                            max: range?.max,
                            step: range?.step,
                          } as VisualParameter}
                          onSave={(range) => {
                            onUpdateRange?.(paramId, true, range)
                            setShowThresholdConfig(false)
                          }}
                          onDisable={() => {
                            onUpdateRange?.(paramId, false)
                            setShowThresholdConfig(false)
                          }}
                          indicatorConfig={indicatorConfig}
                        />
                      </PopoverContent>
                    </Popover>
                  )
                })()
              ) : (
                <Input
                  className="w-14 h-8 px-1.5 mx-1 inline-flex"
                  type="number"
                  value={cond.threshold}
                  onChange={(e) => onUpdate({ threshold: Number(e.target.value) })}
                />
              )
            )}

            {/* Expanded: compare to another indicator */}
            {cond.expanded && (
              <>
                {' '}
                the{' '}
                {isWindowlessIndicator(cond.rightMetric ?? 'Relative Strength Index') ? null : (
                  <>
                    {(underRollingNode || onUpdateRange) && nodeId ? (
                      (() => {
                        const paramId = `${nodeId}-${cond.id}-rightWindow`
                        const range = parameterRanges?.find(r => r.id === paramId)
                        const isOptimized = range?.enabled || underRollingNode

                        return (
                          <Popover open={showRightWindowConfig} onOpenChange={setShowRightWindowConfig}>
                            <PopoverTrigger asChild>
                              <div
                                className="inline-flex items-center gap-1 cursor-pointer mx-1"
                                onClick={() => setShowRightWindowConfig(true)}
                              >
                                {isOptimized ? (
                                  <span className="h-8 px-2 flex items-center border border-primary rounded bg-primary/10 text-sm font-medium text-primary">
                                    {range?.min ?? ((cond.rightWindow ?? 14) - 1)}-{range?.max ?? ((cond.rightWindow ?? 14) + 1)}
                                  </span>
                                ) : (
                                  <div className="w-14 h-8 px-1.5 inline-flex items-center justify-center border border-input rounded-md bg-background text-sm cursor-pointer hover:bg-accent/10">
                                    {cond.rightWindow ?? 14}
                                  </div>
                                )}
                              </div>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <RangeConfigPopover
                                parameter={{
                                  id: paramId,
                                  field: 'rightWindow',
                                  currentValue: cond.rightWindow ?? 14,
                                  optimizationEnabled: isOptimized,
                                  min: range?.min,
                                  max: range?.max,
                                  step: range?.step,
                                } as VisualParameter}
                                onSave={(range) => {
                                  onUpdateRange?.(paramId, true, range)
                                  setShowRightWindowConfig(false)
                                }}
                                onDisable={() => {
                                  onUpdateRange?.(paramId, false)
                                  setShowRightWindowConfig(false)
                                }}
                              />
                            </PopoverContent>
                          </Popover>
                        )
                      })()
                    ) : (
                      <Input
                        className="w-14 h-8 px-1.5 mx-1 inline-flex"
                        type="number"
                        value={cond.rightWindow ?? 14}
                        onChange={(e) => onUpdate({ rightWindow: Number(e.target.value) })}
                      />
                    )}
                    d{' '}
                  </>
                )}
                <IndicatorDropdown
                  value={cond.rightMetric ?? 'Relative Strength Index'}
                  onChange={(m: MetricChoice) => onUpdate({ rightMetric: m })}
                  className="h-8 px-1.5 mx-1"
                />{' '}
                of{' '}
                <button
                  className="h-8 px-2 mx-1 border border-border rounded bg-card text-sm font-mono hover:bg-muted/50"
                  onClick={() => {
                    // In Forge mode, allow tickers, ratios, branches, and lists. In Model mode, exclude lists.
                    const allowedModes = isForgeMode ? ['tickers', 'ratios', 'branches', 'lists'] : ['tickers', 'ratios', 'branches']
                    openTickerModal?.((ticker) => {
                      // Handle Auto mode selection for right ticker
                      if (ticker === 'mode:match_indicator') {
                        onUpdate({
                          rightConditionMode: 'match_indicator',
                          rightTicker: 'AUTO' as PositionChoice  // Placeholder
                        })
                        return
                      }

                      // When changing ticker, clear ticker list fields if selecting a non-list ticker
                      if (ticker.startsWith('list:')) {
                        onUpdate({
                          rightTicker: ticker as PositionChoice,
                          rightConditionMode: 'manual'
                        })
                      } else {
                        // Clear ticker list metadata when selecting a regular ticker
                        onUpdate({
                          rightTicker: ticker as PositionChoice,
                          rightTickerListId: undefined,
                          rightTickerListName: undefined,
                          rightConditionMode: 'manual'
                        })
                      }
                    }, undefined, allowedModes, nodeKind, cond.rightTicker ?? 'SPY', nodeId)
                  }}
                >
                  {isRightAuto ? '(Auto)' : formatTickerDisplay(cond.rightTicker ?? 'SPY', cond.rightTickerListName)}
                </button>
              </>
            )}

            {/* For X consecutive days */}
            {' '}for{' '}
            {(underRollingNode || onUpdateRange) && nodeId ? (
              (() => {
                const paramId = `${nodeId}-${cond.id}-forDays`
                const range = parameterRanges?.find(r => r.id === paramId)
                const isOptimized = range?.enabled || underRollingNode

                return (
                  <Popover open={showForDaysConfig} onOpenChange={setShowForDaysConfig}>
                    <PopoverTrigger asChild>
                      <div
                        className="inline-flex items-center gap-1 cursor-pointer mx-1"
                        onClick={() => setShowForDaysConfig(true)}
                      >
                        {isOptimized ? (
                          <span className="h-7 px-2 flex items-center border border-primary rounded bg-primary/10 text-sm font-medium text-primary">
                            {range?.min ?? 1}-{range?.max ?? 1}
                          </span>
                        ) : (
                          <div className="w-12 h-7 px-1.5 inline-flex items-center justify-center border border-input rounded-md bg-background text-sm cursor-pointer hover:bg-accent/10">
                            {cond.forDays ?? 1}
                          </div>
                        )}
                      </div>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <RangeConfigPopover
                        parameter={{
                          id: paramId,
                          field: 'forDays',
                          currentValue: cond.forDays ?? 1,
                          optimizationEnabled: isOptimized,
                          min: range?.min,
                          max: range?.max,
                          step: range?.step,
                        } as VisualParameter}
                        onSave={(range) => {
                          onUpdateRange?.(paramId, true, range)
                          setShowForDaysConfig(false)
                        }}
                        onDisable={() => {
                          onUpdateRange?.(paramId, false)
                          setShowForDaysConfig(false)
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                )
              })()
            ) : (
              <Input
                className="w-12 h-7 px-1.5 mx-1 inline-flex text-center"
                type="number"
                min={1}
                value={cond.forDays ?? 1}
                onChange={(e) => {
                  const val = Math.max(1, Number(e.target.value) || 1)
                  onUpdate({ forDays: val > 1 ? val : undefined })
                }}
              />
            )}
            {' '}day{(cond.forDays ?? 1) !== 1 ? 's' : ''}
          </>
        )}

        {/* Expand/collapse toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 p-0"
          onClick={(e) => {
            e.stopPropagation()
            const newExpanded = !cond.expanded

            if (newExpanded) {
              // When expanding, initialize expanded fields with default values
              if (isDateCondition && !cond.dateTo) {
                // Date condition: initialize dateTo
                onUpdate({
                  expanded: newExpanded,
                  dateTo: { month: cond.dateMonth ?? 1, day: 31 }
                })
              } else if (!isDateCondition) {
                // Regular indicator condition: initialize right side fields
                onUpdate({
                  expanded: newExpanded,
                  rightWindow: cond.rightWindow ?? cond.window,
                  rightMetric: cond.rightMetric ?? cond.metric,
                  rightTicker: cond.rightTicker ?? cond.ticker,
                  forDays: cond.forDays ?? 1
                })
              } else {
                onUpdate({ expanded: newExpanded })
              }
            } else {
              // Collapsing - just update expanded flag
              onUpdate({ expanded: newExpanded })
            }
          }}
          title={isDateCondition ? 'Toggle date range' : 'Compare to another indicator'}
        >
          ↔
        </Button>
      </Badge>

      {/* Delete button */}
      {canDelete && (
        <Button
          variant="destructive"
          size="icon"
          className="h-7 w-7 p-0"
          onClick={onDelete}
        >
          X
        </Button>
      )}
    </div>
  )
}
