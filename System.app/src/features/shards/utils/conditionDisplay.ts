// Shared utility for displaying condition information in Shards tab
// Extracts and formats condition data from tree JSON

import type { FlowNode, ConditionLine } from '@/types/flowNode'

// Comparator display mapping
const COMPARATOR_SYMBOLS: Record<string, string> = {
  lt: '<',
  gt: '>',
  crossAbove: '↗',
  crossBelow: '↘'
}

// Short indicator names for compact display
const SHORT_INDICATOR_NAMES: Record<string, string> = {
  'Relative Strength Index': 'RSI',
  'Simple Moving Average': 'SMA',
  'Exponential Moving Average': 'EMA',
  'Weighted Moving Average': 'WMA',
  'Hull Moving Average': 'Hull',
  'MACD Histogram': 'MACD-H',
  'MACD Line': 'MACD',
  'MACD Signal': 'MACD-S',
  'Bollinger Upper': 'BB-U',
  'Bollinger Mid': 'BB-M',
  'Bollinger Lower': 'BB-L',
  'Average True Range': 'ATR',
  'Average Directional Index': 'ADX',
  'Current Price': 'Price',
  'Stochastic %K': 'Stoch-K',
  'Stochastic %D': 'Stoch-D',
}

// Display info extracted from tree
export interface BranchDisplayInfo {
  conditions: string[]  // e.g., "RSI(14) SPY < 70 for 5 days"
  positions: string[]   // e.g., "SPY", "QQQ"
  weighting: string     // e.g., "equal"
}

/**
 * Build a human-readable display string for a condition
 * Includes "for X days" suffix if forDays > 1
 */
function buildConditionString(c: ConditionLine): string {
  const indicator = SHORT_INDICATOR_NAMES[c.metric] || c.metric
  const comp = COMPARATOR_SYMBOLS[c.comparator] || c.comparator
  const ticker = c.ticker || ''

  // Build base condition string
  const baseCondition = `${indicator}(${c.window}) ${ticker} ${comp} ${c.threshold}`

  // Add "for X days" suffix if forDays > 1
  const forDaysSuffix = c.forDays && c.forDays > 1 ? ` for ${c.forDays} days` : ''

  return `${baseCondition}${forDaysSuffix}`
}

/**
 * Extract meaningful display info from tree JSON
 * Used by Shards tab to show branch summaries
 */
export function extractBranchDisplayInfo(treeJson: string | undefined): BranchDisplayInfo | null {
  if (!treeJson) return null

  try {
    const tree: FlowNode = JSON.parse(treeJson)
    const info: BranchDisplayInfo = {
      conditions: [],
      positions: [],
      weighting: tree.weighting || 'equal'
    }

    // Recursively extract info from tree
    function traverse(node: FlowNode, context?: 'then' | 'else') {
      if (node.kind === 'indicator' && node.conditions) {
        for (const cond of node.conditions) {
          const c = cond as ConditionLine
          const condStr = buildConditionString(c)

          if (context) {
            info.conditions.push(`[${context}] ${condStr}`)
          } else {
            info.conditions.push(condStr)
          }
        }
      }

      if (node.kind === 'position' && node.positions) {
        for (const pos of node.positions) {
          if (pos && pos !== 'Empty' && !info.positions.includes(pos)) {
            info.positions.push(pos)
          }
        }
      }

      // Traverse children
      if (node.children) {
        for (const [slot, children] of Object.entries(node.children)) {
          if (Array.isArray(children)) {
            for (const child of children) {
              if (child) {
                const childContext = slot === 'then' ? 'then' : slot === 'else' ? 'else' : undefined
                traverse(child, childContext)
              }
            }
          }
        }
      }
    }

    traverse(tree)
    return info
  } catch {
    return null
  }
}
