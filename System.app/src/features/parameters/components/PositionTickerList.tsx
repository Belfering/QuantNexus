// src/features/parameters/components/PositionTickerList.tsx
// Editable ticker array for position nodes

import { Button } from '@/components/ui/button'
import type { PositionParameter, StrategyParameter } from '../types'

interface PositionTickerListProps {
  parameter: PositionParameter
  nodeId: string
  onUpdate: (nodeId: string, parameter: StrategyParameter, value: any) => void
  openTickerModal?: (onSelect: (ticker: string) => void) => void
}

export function PositionTickerList({ parameter, nodeId, onUpdate, openTickerModal }: PositionTickerListProps) {
  const tickers = parameter.currentValue

  const handleAdd = () => {
    onUpdate(nodeId, parameter, [...tickers, 'Empty'])
  }

  const handleRemove = (index: number) => {
    const next = tickers.filter((_, i) => i !== index)
    // Always keep at least one position
    onUpdate(nodeId, parameter, next.length ? next : ['Empty'])
  }

  const handleChange = (index: number, newTicker: string) => {
    const next = tickers.slice()
    next[index] = newTicker
    onUpdate(nodeId, parameter, next)
  }

  return (
    <div className="inline-flex flex-col gap-1 px-3 py-2 rounded-lg min-w-[120px] bg-muted/20">
      <label className="text-[10px] font-semibold uppercase opacity-80">
        Positions
      </label>
      <div className="flex flex-col gap-1">
        {tickers.map((ticker, idx) => (
          <div key={idx} className="flex items-center gap-1">
            <button
              className="text-xs font-mono px-2 py-1 bg-white/90 rounded hover:bg-muted border border-border"
              onClick={() => {
                if (openTickerModal) {
                  openTickerModal((newTicker) => handleChange(idx, newTicker))
                }
              }}
            >
              {ticker}
            </button>
            {tickers.length > 1 && (
              <button
                className="text-xs text-destructive hover:text-destructive/80 px-1"
                onClick={() => handleRemove(idx)}
                title="Remove ticker"
              >
                ×
              </button>
            )}
          </div>
        ))}
        <Button
          size="sm"
          variant="outline"
          className="text-xs h-6"
          onClick={handleAdd}
        >
          + Add
        </Button>
      </div>
    </div>
  )
}
