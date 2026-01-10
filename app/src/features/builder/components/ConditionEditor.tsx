// src/features/builder/components/ConditionEditor.tsx
// Single condition row editor with all inputs

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import type { ConditionLine, MetricChoice, ComparatorChoice, PositionChoice, BlockKind } from '../../../types'
import type { TickerModalMode } from '@/shared/components'
import { isWindowlessIndicator } from '../../../constants'
import { IndicatorDropdown } from './IndicatorDropdown'

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
  openTickerModal?: (onSelect: (ticker: string) => void, restrictTo?: string[], modes?: TickerModalMode[], nodeKind?: BlockKind, initialValue?: string) => void
  /** Node kind for the ticker modal context */
  nodeKind?: BlockKind
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
}: ConditionEditorProps) => {
  const prefix = cond.type === 'and' ? 'And if the ' : cond.type === 'or' ? 'Or if the ' : 'If the '
  const isSingleLineItem = total === 1
  const canDelete = (total > 1 && (index > 0 || allowDeleteFirst)) || (allowDeleteFirst && isSingleLineItem)

  // Check if this is a Date-based condition
  const isDateCondition = cond.metric === 'Date'

  return (
    <div className="flex items-center gap-2">
      <Badge variant="default" className="gap-1 py-1 px-2.5">
        {prefix}

        {/* Indicator dropdown */}
        <IndicatorDropdown
          value={cond.metric}
          onChange={(m) => onUpdate({ metric: m })}
          className="h-8 px-1.5 mx-1"
        />

        {/* Date-specific UI */}
        {isDateCondition ? (
          <>
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
                <Input
                  className="w-14 h-8 px-1.5 mx-1 inline-flex"
                  type="number"
                  value={cond.window}
                  onChange={(e) => onUpdate({ window: Number(e.target.value) })}
                />
                d{' '}
              </>
            )}

            {/* Ticker selector */}
            {' of '}
            <button
              className="h-8 px-2 mx-1 border border-border rounded bg-card text-sm font-mono hover:bg-muted/50"
              onClick={() => openTickerModal?.((ticker) => onUpdate({ ticker: ticker as PositionChoice }), undefined, ['tickers', 'ratios', 'branches'], nodeKind, cond.ticker)}
            >
              {cond.ticker}
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
                  onClick={() => openTickerModal?.((ticker) => onUpdate({ rightTicker: ticker as PositionChoice }), undefined, ['tickers', 'ratios', 'branches'], nodeKind, cond.rightTicker ?? 'SPY')}
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
            // For Date conditions, initialize dateTo when expanding
            if (isDateCondition && newExpanded && !cond.dateTo) {
              onUpdate({
                expanded: newExpanded,
                dateTo: { month: cond.dateMonth ?? 1, day: 31 }
              })
            } else {
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
