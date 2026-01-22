// src/features/dashboard/components/SellPositionModal.tsx
// Modal component for selling unallocated positions with three modes: $, %, All

import { useState, useMemo } from 'react'
import type { UnallocatedPosition } from '@/types'
import { Modal, ModalFooter } from '@/shared/components/Modal'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface SellOrder {
  symbol: string
  qty: number
  dollarValue: number
}

interface SellPositionModalProps {
  isOpen: boolean
  onClose: () => void
  mode: 'individual' | 'bulk'
  position?: UnallocatedPosition
  positions?: UnallocatedPosition[]
  credentialType: 'live' | 'paper'
  onConfirm: (sellOrders: SellOrder[]) => Promise<void>
  isLoading?: boolean
}

type SellType = 'dollar' | 'percent' | 'all'

const formatUsd = (value: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function calculateIndividualSell(
  position: UnallocatedPosition,
  type: SellType,
  inputValue: number
): SellOrder {
  let qty: number

  if (type === 'all') {
    qty = position.unallocatedQty
  } else if (type === 'percent') {
    qty = Math.floor(position.unallocatedQty * (inputValue / 100))
  } else {
    // dollar
    qty = Math.floor(inputValue / position.currentPrice)
  }

  const finalQty = Math.max(1, qty)
  return {
    symbol: position.symbol,
    qty: finalQty,
    dollarValue: finalQty * position.currentPrice,
  }
}

function calculateBulkSell(
  positions: UnallocatedPosition[],
  type: SellType,
  inputValue: number
): SellOrder[] {
  if (type === 'all') {
    return positions.map((pos) => ({
      symbol: pos.symbol,
      qty: pos.unallocatedQty,
      dollarValue: pos.unallocatedQty * pos.currentPrice,
    }))
  } else if (type === 'percent') {
    return positions
      .map((pos) => {
        const qty = Math.floor(pos.unallocatedQty * (inputValue / 100))
        return {
          symbol: pos.symbol,
          qty: Math.max(1, qty),
          dollarValue: qty * pos.currentPrice,
        }
      })
      .filter((order) => order.qty > 0)
  } else {
    // dollar
    const totalValue = positions.reduce(
      (sum, pos) => sum + pos.unallocatedQty * pos.currentPrice,
      0
    )
    return positions
      .map((pos) => {
        const positionValue = pos.unallocatedQty * pos.currentPrice
        const percentMakeup = totalValue > 0 ? positionValue / totalValue : 0
        const dollarAllocation = inputValue * percentMakeup
        const qty = Math.floor(dollarAllocation / pos.currentPrice)

        return {
          symbol: pos.symbol,
          qty: Math.max(1, qty),
          dollarValue: qty * pos.currentPrice,
        }
      })
      .filter((order) => order.qty > 0)
  }
}

export function SellPositionModal({
  isOpen,
  onClose,
  mode,
  position,
  positions,
  credentialType,
  onConfirm,
  isLoading = false,
}: SellPositionModalProps) {
  const [sellType, setSellType] = useState<SellType>('all')
  const [inputValue, setInputValue] = useState<string>('')

  // Calculate orders based on current selections
  const calculatedOrders = useMemo(() => {
    const value = parseFloat(inputValue) || 0

    if (mode === 'individual' && position) {
      return [calculateIndividualSell(position, sellType, value)]
    } else if (mode === 'bulk' && positions) {
      return calculateBulkSell(positions, sellType, value)
    }

    return []
  }, [mode, position, positions, sellType, inputValue])

  // Validation
  const maxValue = useMemo(() => {
    if (mode === 'individual' && position) {
      if (sellType === 'dollar') {
        return position.unallocatedQty * position.currentPrice
      } else if (sellType === 'percent') {
        return 100
      }
    } else if (mode === 'bulk' && positions) {
      if (sellType === 'dollar') {
        return positions.reduce(
          (sum, pos) => sum + pos.unallocatedQty * pos.currentPrice,
          0
        )
      } else if (sellType === 'percent') {
        return 100
      }
    }
    return null
  }, [mode, position, positions, sellType])

  const inputValueNum = parseFloat(inputValue) || 0
  const isValid =
    sellType === 'all' ||
    (inputValueNum > 0 &&
      (maxValue === null || inputValueNum <= maxValue) &&
      calculatedOrders.every((order) => order.qty >= 1))

  const hasZeroQtyOrders =
    sellType !== 'all' &&
    calculatedOrders.some((order) => order.qty === 1 && inputValueNum > 0)

  const totalDollarValue = calculatedOrders.reduce(
    (sum, order) => sum + order.dollarValue,
    0
  )

  const handleConfirm = async () => {
    if (!isValid || isLoading) return

    await onConfirm(calculatedOrders)
  }

  const handleClose = () => {
    if (isLoading) return
    onClose()
    // Reset state after a brief delay to avoid visual glitch
    setTimeout(() => {
      setSellType('all')
      setInputValue('')
    }, 200)
  }

  const title =
    mode === 'individual'
      ? `Sell ${position?.symbol || 'Position'}`
      : `Sell Multiple Positions`

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={title}
      size="lg"
      closeOnOverlayClick={!isLoading}
      closeOnEscape={!isLoading}
    >
      <div className="flex flex-col gap-4">
        {/* Mode Info */}
        <div className="text-sm text-muted">
          {mode === 'individual' && position && (
            <div>
              <div className="font-bold text-text mb-1">Current Position:</div>
              <div className="flex gap-4">
                <span>
                  Quantity: <span className="font-mono">{position.unallocatedQty}</span>
                </span>
                <span>
                  Price: <span className="font-mono">{formatUsd(position.currentPrice)}</span>
                </span>
                <span>
                  Value:{' '}
                  <span className="font-mono">
                    {formatUsd(position.unallocatedQty * position.currentPrice)}
                  </span>
                </span>
              </div>
            </div>
          )}
          {mode === 'bulk' && positions && (
            <div>
              <div className="font-bold text-text mb-1">
                Selling from {positions.length} position{positions.length !== 1 ? 's' : ''}
              </div>
              <div>
                Total Value:{' '}
                <span className="font-mono">
                  {formatUsd(
                    positions.reduce(
                      (sum, pos) => sum + pos.unallocatedQty * pos.currentPrice,
                      0
                    )
                  )}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Sell Type Tabs */}
        <Tabs value={sellType} onValueChange={(v) => setSellType(v as SellType)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="percent">Percentage %</TabsTrigger>
            <TabsTrigger value="dollar">Dollar Amount $</TabsTrigger>
          </TabsList>

          <TabsContent value="all">
            <div className="text-sm text-muted py-2">
              {mode === 'individual'
                ? 'Sell the entire position.'
                : 'Sell all shares from all positions.'}
            </div>
          </TabsContent>

          <TabsContent value="percent">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-bold">Percentage to sell (0-100):</label>
              <Input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Enter percentage (e.g., 50)"
                disabled={isLoading}
              />
              <div className="text-xs text-muted">
                {mode === 'individual'
                  ? 'Sell the specified percentage of this position.'
                  : 'Sell the same percentage from each position (e.g., 5% of each).'}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="dollar">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-bold">Dollar amount to sell:</label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Enter dollar amount"
                disabled={isLoading}
              />
              <div className="text-xs text-muted">
                {mode === 'individual'
                  ? 'Sell shares worth approximately this dollar amount.'
                  : 'Split this dollar amount proportionally across all positions based on their % weight.'}
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* Validation Messages */}
        {sellType !== 'all' && inputValueNum > 0 && maxValue !== null && inputValueNum > maxValue && (
          <div className="text-sm text-danger font-bold">
            Value cannot exceed {sellType === 'dollar' ? formatUsd(maxValue) : `${maxValue}%`}
          </div>
        )}

        {hasZeroQtyOrders && (
          <div className="text-sm text-yellow-600 dark:text-yellow-400 font-bold">
            Warning: Some positions will sell minimum 1 share due to rounding.
          </div>
        )}

        {/* Preview Section */}
        {calculatedOrders.length > 0 && isValid && (
          <div className="border border-border rounded-lg p-3">
            <div className="font-bold text-sm mb-2">Preview Orders:</div>
            <div className="max-h-64 overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="px-2 py-1 text-left font-semibold border-b">Symbol</th>
                    <th className="px-2 py-1 text-right font-semibold border-b">Shares</th>
                    <th className="px-2 py-1 text-right font-semibold border-b">Est. Value</th>
                  </tr>
                </thead>
                <tbody>
                  {calculatedOrders.map((order) => (
                    <tr key={order.symbol} className="border-b border-border/50">
                      <td className="px-2 py-1 font-bold">{order.symbol}</td>
                      <td className="px-2 py-1 text-right font-mono">{order.qty}</td>
                      <td className="px-2 py-1 text-right font-mono">
                        {formatUsd(order.dollarValue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 pt-2 border-t border-border flex justify-between items-center">
              <span className="text-sm font-bold">Total:</span>
              <span className="font-mono font-bold">{formatUsd(totalDollarValue)}</span>
            </div>
            <div className="mt-1 text-xs text-muted">
              {calculatedOrders.length} order{calculatedOrders.length !== 1 ? 's' : ''} will be
              submitted as market sell{calculatedOrders.length !== 1 ? 's' : ''} on {credentialType}{' '}
              account.
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <ModalFooter>
          <Button variant="ghost" onClick={handleClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!isValid || isLoading}
          >
            {isLoading ? 'Submitting...' : 'Confirm Sell'}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  )
}
