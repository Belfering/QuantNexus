// src/features/dashboard/components/UnallocatedPositionsTable.tsx
// Table component for displaying unallocated positions with formatting

import { useState } from 'react'
import type { UnallocatedPosition } from '@/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { SellPositionModal, type SellOrder } from './SellPositionModal'
import { useSellUnallocated } from '../hooks'

interface UnallocatedPositionsTableProps {
  positions: UnallocatedPosition[]
  credentialType: 'live' | 'paper'
  onSellComplete?: () => void
}

const formatUsd = (value: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

const formatSignedUsd = (value: number): string => {
  const formatted = formatUsd(Math.abs(value))
  return value >= 0 ? `+${formatted}` : `-${formatted}`
}

export function UnallocatedPositionsTable({
  positions,
  credentialType,
  onSellComplete,
}: UnallocatedPositionsTableProps) {
  const [selectedPosition, setSelectedPosition] = useState<UnallocatedPosition | null>(null)
  const [isSellModalOpen, setIsSellModalOpen] = useState(false)

  // Use the sell hook
  const { sellPositions, isLoading: isSelling } = useSellUnallocated()

  if (positions.length === 0) {
    return (
      <div className="text-center py-8 text-muted">
        No unallocated positions
      </div>
    )
  }

  // Calculate total portfolio value for % makeup calculation
  const totalValue = positions.reduce((sum, pos) => sum + (pos.unallocatedQty * pos.currentPrice), 0)

  const handleSellConfirm = async (sellOrders: SellOrder[]) => {
    const result = await sellPositions(credentialType, sellOrders)

    if (result?.success) {
      console.log(`Successfully submitted ${result.orders.length} sell order(s)`)

      // Close modal
      setIsSellModalOpen(false)
      setSelectedPosition(null)

      // Trigger refresh if callback provided
      if (onSellComplete) {
        onSellComplete()
      }
    } else if (result?.errors && result.errors.length > 0) {
      console.warn(`Partial failure: ${result.orders.length} orders succeeded, ${result.errors.length} failed`)
      console.error('Failed orders:', result.errors)

      // Still close modal and refresh on partial success
      setIsSellModalOpen(false)
      setSelectedPosition(null)
      if (onSellComplete) {
        onSellComplete()
      }
    } else {
      console.error('Failed to sell position')
      // Keep modal open so user can try again
    }
  }

  return (
    <div className="border rounded-lg overflow-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted sticky top-0">
          <tr>
            <th className="px-3 py-2 text-left font-semibold border-b whitespace-nowrap">Actions</th>
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
            const marketValue = pos.unallocatedQty * pos.currentPrice
            const unrealizedPl = (pos.currentPrice - pos.avgEntryPrice) * pos.unallocatedQty
            const percentMakeup = totalValue > 0 ? (marketValue / totalValue) * 100 : 0

            return (
              <tr key={pos.symbol} className="hover:bg-muted/50 border-b border-border/50">
                <td className="px-3 py-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger hover:text-danger hover:bg-danger/10"
                    onClick={() => {
                      setSelectedPosition(pos)
                      setIsSellModalOpen(true)
                    }}
                  >
                    Sell
                  </Button>
                </td>
                <td className="px-3 py-2 font-bold">{pos.symbol}</td>
                <td className="px-3 py-2 text-right font-mono text-muted">{percentMakeup.toFixed(2)}%</td>
                <td className="px-3 py-2 text-right font-mono">{pos.unallocatedQty}</td>
                <td className="px-3 py-2 text-right font-mono">{formatUsd(pos.avgEntryPrice)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatUsd(pos.currentPrice)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatUsd(marketValue)}</td>
                <td className={cn(
                  "px-3 py-2 text-right font-mono font-bold",
                  unrealizedPl >= 0 ? 'text-success' : 'text-danger'
                )}>
                  {formatSignedUsd(unrealizedPl)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Sell Position Modal */}
      <SellPositionModal
        isOpen={isSellModalOpen}
        onClose={() => {
          setIsSellModalOpen(false)
          setSelectedPosition(null)
        }}
        mode="individual"
        position={selectedPosition || undefined}
        credentialType={credentialType}
        onConfirm={handleSellConfirm}
        isLoading={isSelling}
      />
    </div>
  )
}
