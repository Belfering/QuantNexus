// src/features/builder/components/NodeCard/PositionBody.tsx
// Body content for position nodes with ticker selection

import { Button } from '@/components/ui/button'
import type { PositionBodyProps } from './types'

export const PositionBody = ({
  node,
  positionDrafts,
  onAddPosition,
  onRemovePosition,
  onChoosePosition,
  openTickerModal,
  tickerLists,
  isForgeMode,
}: PositionBodyProps) => {
  if (node.kind !== 'position' || !node.positions) return null

  return (
    <div className="positions">
      {node.positions.map((p, idx) => {
        const key = `${node.id}-pos-${idx}`
        const draftValue = Object.prototype.hasOwnProperty.call(positionDrafts, key)
          ? positionDrafts[key]
          : undefined
        const shown = draftValue ?? p

        const commit = (raw: string) => {
          const normalized = String(raw || '').trim().toUpperCase()
          const next = !normalized ? 'Empty' : normalized === 'EMPTY' ? 'Empty' : normalized
          onChoosePosition(node.id, idx, next)
        }

        return (
          <div className="position-row" key={key}>
            <div className="indent w-3.5" />
            <div className="pill-select">
              <button
                className="w-[120px] px-2 py-1 border border-border rounded bg-card text-sm font-mono hover:bg-muted/50 text-left truncate"
                onClick={() => {
                  // In Forge mode, allow both tickers and lists. In Model mode, only tickers.
                  const allowedModes = isForgeMode ? ['tickers', 'lists'] : ['tickers']
                  openTickerModal?.((ticker) => commit(ticker), undefined, allowedModes, 'position', shown !== 'Empty' ? shown : undefined)
                }}
              >
                {shown || 'Ticker'}
              </button>
            </div>
            {idx > 0 && (
              <Button
                variant="destructive"
                size="icon"
                className="h-7 w-7"
                onClick={() => onRemovePosition(node.id, idx)}
              >
                X
              </Button>
            )}
          </div>
        )
      })}
      <div className="flex items-center gap-2">
        <div className="w-3.5" />
        <Button variant="outline" size="sm" onClick={() => onAddPosition(node.id)}>
          +
        </Button>
      </div>
    </div>
  )
}
