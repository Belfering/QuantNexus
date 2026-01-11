// src/features/builder/components/NodeCard/RollingBody.tsx
// Rolling node body component with Rolling Window and Rank By dropdowns

import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import type { FlowNode, SlotId } from '@/types'

export interface RollingBodyProps {
  node: FlowNode
  onUpdateRolling: (nodeId: string, updates: { rollingWindow?: string; rankBy?: string }) => void
  renderSlot: (slot: SlotId, depthPx: number) => React.ReactNode
}

export const RollingBody = ({ node, onUpdateRolling, renderSlot }: RollingBodyProps) => {
  return (
    <>
      {/* Rolling configuration line */}
      <div className="flex items-center gap-2">
        <div className="indent with-line" style={{ width: 14 }} />
        <Badge variant="default" className="gap-1.5 py-1 px-2.5">
          Rolling Window:{' '}
          <Select
            className="h-7 px-2 mx-1"
            value={node.rollingWindow ?? 'monthly'}
            onChange={(e) => onUpdateRolling(node.id, { rollingWindow: e.target.value })}
          >
            <option value="daily">Daily</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </Select>
          {' '}Rank By:{' '}
          <Select
            className="h-7 px-2 mx-1"
            value={node.rankBy ?? 'Sharpe Ratio'}
            onChange={(e) => onUpdateRolling(node.id, { rankBy: e.target.value })}
          >
            <option value="CAGR">CAGR</option>
            <option value="Max Drawdown">Max Drawdown</option>
            <option value="Calmar Ratio">Calmar Ratio</option>
            <option value="Sharpe Ratio">Sharpe Ratio</option>
            <option value="Sortino Ratio">Sortino Ratio</option>
            <option value="Treynor Ratio">Treynor Ratio</option>
            <option value="Beta">Beta</option>
            <option value="Volatility">Volatility</option>
            <option value="Win Rate">Win Rate</option>
            <option value="Avg Turnover">Avg Turnover</option>
            <option value="Avg Holdings">Avg Holdings</option>
            <option value="Time in Market">Time in Market</option>
            <option value="TIM Adjusted Returns">TIM Adjusted Returns</option>
          </Select>
        </Badge>
      </div>
      {/* Render next slot for child nodes */}
      {renderSlot('next', 14)}
    </>
  )
}
