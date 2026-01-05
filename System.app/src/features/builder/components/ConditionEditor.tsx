// src/features/builder/components/ConditionEditor.tsx
// Single condition row editor with all inputs

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import type { ConditionLine, MetricChoice, ComparatorChoice, PositionChoice } from '../../../types'
import { isWindowlessIndicator } from '../../../constants'
import { IndicatorDropdown } from './IndicatorDropdown'

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
  openTickerModal?: (onSelect: (ticker: string) => void) => void
}

export const ConditionEditor = ({
  condition: cond,
  index,
  total,
  allowDeleteFirst = false,
  onUpdate,
  onDelete,
  openTickerModal,
}: ConditionEditorProps) => {
  const prefix = cond.type === 'and' ? 'And if the ' : cond.type === 'or' ? 'Or if the ' : 'If the '
  const isSingleLineItem = total === 1
  const canDelete = (total > 1 && (index > 0 || allowDeleteFirst)) || (allowDeleteFirst && isSingleLineItem)

  return (
    <div className="flex items-center gap-2">
      <Badge variant="default" className="gap-1 py-1 px-2.5">
        {prefix}
        {/* Window input (hidden for windowless indicators) */}
        {isWindowlessIndicator(cond.metric) ? null : (
          <>
            <Input
              className="w-14 h-8 px-1.5 mx-1 inline-flex"
              type="number"
              value={cond.window}
              onChange={(e) => onUpdate({ window: Number(e.target.value) })}
            />
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
          onClick={() => openTickerModal?.((ticker) => onUpdate({ ticker: ticker as PositionChoice }))}
        >
          {cond.ticker}
        </button>

        {/* Comparator */}
        {' is '}
        <Select
          className="h-8 px-1.5 mx-1"
          value={cond.comparator}
          onChange={(e) => onUpdate({ comparator: e.target.value as ComparatorChoice })}
        >
          <option value="lt">Less Than</option>
          <option value="gt">Greater Than</option>
        </Select>

        {/* Threshold (hidden when expanded) */}
        {cond.expanded ? null : (
          <Input
            className="w-14 h-8 px-1.5 mx-1 inline-flex"
            type="number"
            value={cond.threshold}
            onChange={(e) => onUpdate({ threshold: Number(e.target.value) })}
          />
        )}

        {/* Expanded: compare to another indicator */}
        {cond.expanded && (
          <>
            {' '}
            the{' '}
            {isWindowlessIndicator(cond.rightMetric ?? 'Relative Strength Index') ? null : (
              <>
                <Input
                  className="w-14 h-8 px-1.5 mx-1 inline-flex"
                  type="number"
                  value={cond.rightWindow ?? 14}
                  onChange={(e) => onUpdate({ rightWindow: Number(e.target.value) })}
                />
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
              onClick={() => openTickerModal?.((ticker) => onUpdate({ rightTicker: ticker as PositionChoice }))}
            >
              {cond.rightTicker ?? 'SPY'}
            </button>
          </>
        )}

        {/* For X consecutive days */}
        {' '}for{' '}
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
        {' '}day{(cond.forDays ?? 1) !== 1 ? 's' : ''}

        {/* Expand/collapse toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 p-0"
          onClick={(e) => {
            e.stopPropagation()
            onUpdate({ expanded: !cond.expanded })
          }}
          title="Compare to another indicator"
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
