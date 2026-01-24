// src/features/dashboard/components/BotPositionsTable.tsx
// Table component to display bot positions from ledger (read-only, no sell buttons)

import { formatUsd, formatSignedUsd } from '@/shared/utils'
import { cn } from '@/lib/utils'
import type { BotPosition } from '../hooks'

interface BotPositionsTableProps {
  positions: BotPosition[]
  totalValue: number
}

export function BotPositionsTable({ positions, totalValue }: BotPositionsTableProps) {
  if (!positions || positions.length === 0) {
    return (
      <div className="text-center py-8 text-muted">
        No positions yet. Positions will appear here after bot execution.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="px-3 py-2 text-left font-semibold border-b whitespace-nowrap">Symbol</th>
            <th className="px-3 py-2 text-right font-semibold border-b whitespace-nowrap">% Makeup</th>
            <th className="px-3 py-2 text-right font-semibold border-b whitespace-nowrap">Qty</th>
            <th className="px-3 py-2 text-right font-semibold border-b whitespace-nowrap">Entry Price</th>
            <th className="px-3 py-2 text-right font-semibold border-b whitespace-nowrap">Current Price</th>
            <th className="px-3 py-2 text-right font-semibold border-b whitespace-nowrap">Market Value</th>
            <th className="px-3 py-2 text-right font-semibold border-b whitespace-nowrap">Unrealized P&L</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((pos) => {
            const percentMakeup = totalValue > 0 ? (pos.marketValue / totalValue) * 100 : 0

            return (
              <tr key={pos.symbol} className="hover:bg-muted/50 border-b border-border/50">
                <td className="px-3 py-2 font-bold">{pos.symbol}</td>
                <td className="px-3 py-2 text-right font-mono text-muted">{percentMakeup.toFixed(2)}%</td>
                <td className="px-3 py-2 text-right font-mono">{pos.shares.toFixed(4)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatUsd(pos.avgPrice)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatUsd(pos.currentPrice)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatUsd(pos.marketValue)}</td>
                <td className={cn(
                  "px-3 py-2 text-right font-mono font-bold",
                  pos.unrealizedPl >= 0 ? 'text-success' : 'text-danger'
                )}>
                  {formatSignedUsd(pos.unrealizedPl)}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border font-semibold">
            <td className="px-3 py-2">Total</td>
            <td className="px-3 py-2 text-right font-mono">100.00%</td>
            <td className="px-3 py-2"></td>
            <td className="px-3 py-2"></td>
            <td className="px-3 py-2"></td>
            <td className="px-3 py-2 text-right font-mono">{formatUsd(totalValue)}</td>
            <td className={cn(
              "px-3 py-2 text-right font-mono font-bold",
              positions.reduce((sum, p) => sum + p.unrealizedPl, 0) >= 0 ? 'text-success' : 'text-danger'
            )}>
              {formatSignedUsd(positions.reduce((sum, p) => sum + p.unrealizedPl, 0))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
