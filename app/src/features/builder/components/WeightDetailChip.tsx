// src/features/builder/components/WeightDetailChip.tsx
// Shows additional weight configuration: capped fallback or volatility window

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import type { WeightMode, PositionChoice } from '../../../types'

export interface WeightDetailChipProps {
  mode: WeightMode
  /** For capped mode: the fallback ticker */
  cappedFallback?: PositionChoice
  /** For inverse/pro mode: the volatility window in days */
  volWindow?: number
  /** Datalist ID for ticker autocomplete */
  tickerDatalistId?: string
  onUpdateCappedFallback: (value: PositionChoice) => void
  onUpdateVolWindow: (value: number) => void
}

export const WeightDetailChip = ({
  mode,
  cappedFallback = 'Empty',
  volWindow = 20,
  tickerDatalistId,
  onUpdateCappedFallback,
  onUpdateVolWindow,
}: WeightDetailChipProps) => {
  const [draft, setDraft] = useState<string | undefined>(undefined)

  // Only show for relevant modes
  if (mode !== 'capped' && mode !== 'inverse' && mode !== 'pro') {
    return null
  }

  if (mode === 'capped') {
    const shown = draft ?? cappedFallback

    const commit = (raw: string) => {
      const normalized = String(raw || '').trim().toUpperCase()
      const next = !normalized ? 'Empty' : normalized === 'EMPTY' ? 'Empty' : normalized
      onUpdateCappedFallback(next)
    }

    return (
      <Badge variant="default" className="gap-1.5 py-1 px-2.5">
        <span>Fallback</span>
        <Input
          list={tickerDatalistId}
          value={shown}
          onClick={(e) => e.stopPropagation()}
          onFocus={(e) => {
            e.stopPropagation()
            e.currentTarget.select()
            if ((draft ?? cappedFallback) === 'Empty') {
              setDraft('')
            }
          }}
          onChange={(e) => {
            e.stopPropagation()
            setDraft(e.target.value)
          }}
          onBlur={(e) => {
            e.stopPropagation()
            commit(e.target.value)
            setDraft(undefined)
          }}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
            if (e.key === 'Escape') setDraft(undefined)
          }}
          placeholder="Ticker"
          spellCheck={false}
          className="w-[120px] h-7 px-1.5 inline-flex"
        />
      </Badge>
    )
  }

  // inverse or pro volatility
  return (
    <Badge variant="default" className="gap-1.5 py-1 px-2.5">
      <span>of the last</span>
      <Input
        type="number"
        value={volWindow}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onUpdateVolWindow(Number(e.target.value))}
        className="w-[70px] h-7 px-1.5 inline-flex"
        min={1}
      />
      <span>days</span>
    </Badge>
  )
}
