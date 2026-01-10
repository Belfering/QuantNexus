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
  onUpdatePositionMode,
  openTickerModal,
  tickerLists,
  isForgeMode,
}: PositionBodyProps) => {
  if (node.kind !== 'position' || !node.positions) return null

  const positionMode = node.positionMode || 'manual'
  const isMatchIndicator = positionMode === 'match_indicator'

  return (
    <div className="positions">
      {node.positions.map((p, idx) => {
        const key = `${node.id}-pos-${idx}`
        const draftValue = Object.prototype.hasOwnProperty.call(positionDrafts, key)
          ? positionDrafts[key]
          : undefined
        const shown = draftValue ?? p

        const commit = (raw: string) => {
          // Check for special mode selections
          if (raw === 'mode:match_indicator') {
            onUpdatePositionMode?.(node.id, 'match_indicator')
            return
          }

          // Handle ticker list selections (already sets mode via handleChoosePos)
          if (raw.startsWith('list:')) {
            onChoosePosition(node.id, idx, raw)
            return
          }

          // Regular ticker selection - ensure we're in manual mode
          if (positionMode !== 'manual') {
            onUpdatePositionMode?.(node.id, 'manual')
          }

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
                {isMatchIndicator ? '(Auto)' : (shown || 'Ticker')}
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
