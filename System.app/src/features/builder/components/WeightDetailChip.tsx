// src/features/builder/components/WeightDetailChip.tsx
// Shows additional weight configuration: min/max caps, capped fallback, or volatility window

import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import type { WeightMode, PositionChoice, BlockKind } from '../../../types'
import type { TickerModalMode } from '@/shared/components'

export interface WeightDetailChipProps {
  mode: WeightMode
  /** For capped mode: the fallback ticker */
  cappedFallback?: PositionChoice
  /** For inverse/pro mode: the volatility window in days */
  volWindow?: number
  /** Min cap percentage (0-100) */
  minCap?: number
  /** Max cap percentage (0-100) */
  maxCap?: number
  onUpdateCappedFallback?: (value: PositionChoice) => void
  onUpdateVolWindow?: (value: number) => void
  onUpdateMinCap?: (value: number) => void
  onUpdateMaxCap?: (value: number) => void
  /** Ticker modal opener */
  openTickerModal?: (onSelect: (ticker: string) => void, restrictTo?: string[], modes?: TickerModalMode[], nodeKind?: BlockKind, initialValue?: string) => void
}

export const WeightDetailChip = ({
  mode,
  cappedFallback = 'Empty',
  volWindow = 20,
  minCap = 0,
  maxCap = 100,
  onUpdateCappedFallback,
  onUpdateVolWindow,
  onUpdateMinCap,
  onUpdateMaxCap,
  openTickerModal,
}: WeightDetailChipProps) => {

  // Only show for relevant modes
  if (mode !== 'capped' && mode !== 'inverse' && mode !== 'pro') {
    return null
  }

  if (mode === 'capped') {
    return (
      <>
        {/* Min Cap Badge */}
        <Badge
          variant="default"
          className="gap-1.5 py-1 px-2.5"
          title="Minimum allocation percentage per child. If total exceeds 100%, all allocations are scaled down proportionally."
        >
          <span>Min</span>
          <Input
            type="number"
            min={0}
            max={100}
            value={minCap}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onUpdateMinCap?.(Number(e.target.value))}
            className="w-[60px] h-7 px-1.5 inline-flex"
          />
          <span>%</span>
        </Badge>

        {/* Max Cap Badge */}
        <Badge
          variant="default"
          className="gap-1.5 py-1 px-2.5"
          title="Maximum allocation percentage per child. Excess allocation goes to the Fallback ticker."
        >
          <span>Max</span>
          <Input
            type="number"
            min={0}
            max={100}
            value={maxCap}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onUpdateMaxCap?.(Number(e.target.value))}
            className="w-[60px] h-7 px-1.5 inline-flex"
          />
          <span>%</span>
        </Badge>

        {/* Fallback Badge */}
        <Badge
          variant="default"
          className="gap-1.5 py-1 px-2.5"
          title="Ticker that receives excess allocation when children are capped at max%. Enter 'Empty' for cash."
        >
          <span>Fallback</span>
          <button
            className="h-7 px-2 mx-1 border border-border rounded bg-card text-sm font-mono hover:bg-muted/50"
            onClick={(e) => {
              e.stopPropagation()
              openTickerModal?.(
                (ticker) => {
                  const normalized = String(ticker || '').trim().toUpperCase()
                  const next = !normalized ? 'Empty' : normalized === 'EMPTY' ? 'Empty' : normalized
                  onUpdateCappedFallback?.(next)
                },
                undefined,
                ['tickers'],
                'basic',
                cappedFallback
              )
            }}
          >
            {cappedFallback}
          </button>
        </Badge>
      </>
    )
  }

  // inverse or pro volatility
  return (
    <>
      {/* Volatility Window Badge */}
      <Badge
        variant="default"
        className="gap-1.5 py-1 px-2.5"
        title={`Calculate ${mode === 'inverse' ? 'inverse' : 'pro'} volatility weights using this lookback period in days`}
      >
        <span>of the last</span>
        <Input
          type="number"
          value={volWindow}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onUpdateVolWindow?.(Number(e.target.value))}
          className="w-[70px] h-7 px-1.5 inline-flex"
          min={1}
        />
        <span>days</span>
      </Badge>

      {/* Min Cap Badge */}
      <Badge
        variant="default"
        className="gap-1.5 py-1 px-2.5"
        title="Minimum allocation percentage per child. If total exceeds 100%, all allocations are scaled down proportionally."
      >
        <span>Min</span>
        <Input
          type="number"
          min={0}
          max={100}
          value={minCap}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onUpdateMinCap?.(Number(e.target.value))}
          className="w-[60px] h-7 px-1.5 inline-flex"
        />
        <span>%</span>
      </Badge>

      {/* Max Cap Badge */}
      <Badge
        variant="default"
        className="gap-1.5 py-1 px-2.5"
        title="Maximum allocation percentage per child. Excess allocation is redistributed to uncapped positions."
      >
        <span>Max</span>
        <Input
          type="number"
          min={0}
          max={100}
          value={maxCap}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onUpdateMaxCap?.(Number(e.target.value))}
          className="w-[60px] h-7 px-1.5 inline-flex"
        />
        <span>%</span>
      </Badge>
    </>
  )
}
