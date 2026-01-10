// src/features/optimization/services/branchGenerator.ts
// Branch generation service for parameter optimization

import type { ParameterRange } from '@/features/parameters/types'
import type { BranchCombination } from '@/types/branch'
import type { FlowNode } from '@/types'
import { cloneNode } from '@/features/builder'

/**
 * Generate all combinations of parameter values from enabled parameter ranges
 * @param ranges - Array of parameter ranges (only enabled ranges will be used)
 * @returns Array of branch combinations with unique IDs and human-readable labels
 */
export function generateBranchCombinations(ranges: ParameterRange[]): BranchCombination[] {
  // Filter to only enabled ranges
  const enabledRanges = ranges.filter(r => r.enabled)

  if (enabledRanges.length === 0) {
    return []
  }

  // Separate ticker list ranges from numeric parameter ranges
  const tickerListRanges = enabledRanges.filter(r => r.type === 'ticker_list')
  const numericRanges = enabledRanges.filter(r => r.type !== 'ticker_list')

  // Generate value arrays for numeric ranges
  const valueArrays: Array<{ id: string; label: string; values: number[] }> = numericRanges.map(range => {
    const values: number[] = []
    for (let v = range.min; v <= range.max; v += range.step) {
      values.push(v)
    }
    // Ensure max is included even if step doesn't land exactly on it
    if (values[values.length - 1] !== range.max) {
      values.push(range.max)
    }
    // Generate label from path (e.g., "node-1.conditions.cond-1.window" -> "window")
    const pathParts = range.path.split('.')
    const fieldName = pathParts[pathParts.length - 1]
    return {
      id: range.id,
      label: fieldName,
      values
    }
  })

  // Generate ticker arrays for ticker list ranges
  const tickerArrays: Array<{ id: string; label: string; tickers: string[] }> = tickerListRanges.map(range => {
    return {
      id: range.tickerListId || range.id,
      label: range.tickerListName || 'ticker',
      tickers: range.tickers || []
    }
  })

  // Generate cartesian product of all value arrays (numeric) and ticker arrays
  const combinations: BranchCombination[] = []
  const generateCombos = (
    numericIndex: number,
    tickerIndex: number,
    currentParams: Record<string, number>,
    currentTickers: Record<string, string>,
    labels: string[]
  ) => {
    // First, iterate through all ticker variations
    if (tickerIndex < tickerArrays.length) {
      const { id: tickerListId, label: tickerLabel, tickers } = tickerArrays[tickerIndex]
      for (const ticker of tickers) {
        generateCombos(
          numericIndex,
          tickerIndex + 1,
          currentParams,
          { ...currentTickers, [tickerListId]: ticker },
          [...labels, `${tickerLabel}=${ticker}`]
        )
      }
      return
    }

    // Then iterate through numeric parameters
    if (numericIndex < valueArrays.length) {
      const { id: rangeId, label: rangeLabel, values } = valueArrays[numericIndex]
      for (const value of values) {
        generateCombos(
          numericIndex + 1,
          tickerIndex,
          { ...currentParams, [rangeId]: value },
          currentTickers,
          [...labels, `${rangeLabel}=${value}`]
        )
      }
      return
    }

    // Base case: we've generated all combinations
    const id = `branch-${combinations.length + 1}`
    const label = labels.length > 0 ? labels.join(', ') : 'base'
    combinations.push({
      id,
      parameterValues: { ...currentParams },
      label,
      tickerSubstitutions: Object.keys(currentTickers).length > 0 ? currentTickers : undefined
    })
  }

  generateCombos(0, 0, {}, {}, [])
  return combinations
}

/**
 * Check if tree contains any AUTO mode position nodes
 * Exported as hasAutoModeInTree for use in optimization hooks
 */
export function hasAutoModeInTree(node: FlowNode): boolean {
  if (node.kind === 'position' && node.positionMode === 'match_indicator') {
    return true
  }
  if (node.children) {
    for (const slotKey in node.children) {
      const slot = node.children[slotKey as keyof typeof node.children]
      if (Array.isArray(slot)) {
        for (const child of slot) {
          if (child && hasAutoModeInTree(child)) {
            return true
          }
        }
      }
    }
  }
  return false
}

/**
 * Apply ticker substitutions to a tree
 * @param node - The node to apply substitutions to (will be modified recursively)
 * @param substitutions - Map of ticker list ID to selected ticker
 * @param appliedTickers - Set of tickers that have been applied to conditions (for match_indicator mode)
 * @param extractedTickers - Object to collect the first condition ticker and position ticker found
 */
function applyTickerSubstitutions(
  node: FlowNode,
  substitutions: Record<string, string>,
  appliedTickers: Set<string> = new Set(),
  extractedTickers?: { conditionTicker?: string, positionTicker?: string }
): void {
  // Apply to condition tickers
  if (node.conditions && Array.isArray(node.conditions)) {
    for (const condition of node.conditions) {
      // Replace ticker if it references a ticker list
      if (condition.tickerListId && substitutions[condition.tickerListId]) {
        condition.ticker = substitutions[condition.tickerListId]
        appliedTickers.add(condition.ticker)
        // Track first condition ticker for database
        if (extractedTickers && !extractedTickers.conditionTicker) {
          extractedTickers.conditionTicker = condition.ticker
        }
        console.log(`[BranchGenerator] Substituted ticker ${condition.ticker} for list ${condition.tickerListId}`)
        // Clear the list reference fields so backtest API doesn't get confused
        delete (condition as any).tickerListId
        delete (condition as any).tickerListName
      }
      // FALLBACK: Handle ticker field containing "list:UUID" directly (without tickerListId field)
      else if (condition.ticker && typeof condition.ticker === 'string' && condition.ticker.startsWith('list:')) {
        const listId = condition.ticker.substring(5)
        if (substitutions[listId]) {
          condition.ticker = substitutions[listId]
          appliedTickers.add(condition.ticker)
          // Track first condition ticker for database
          if (extractedTickers && !extractedTickers.conditionTicker) {
            extractedTickers.conditionTicker = condition.ticker
          }
          console.log(`[BranchGenerator] Substituted ticker ${condition.ticker} for inline list ${listId}`)
        }
      }
      // Also track regular (non-list) tickers for AUTO mode matching
      else if (condition.ticker && typeof condition.ticker === 'string') {
        appliedTickers.add(condition.ticker)
        if (extractedTickers && !extractedTickers.conditionTicker) {
          extractedTickers.conditionTicker = condition.ticker
        }
      }
      // Replace right ticker if it references a ticker list
      if (condition.rightTickerListId && substitutions[condition.rightTickerListId]) {
        condition.rightTicker = substitutions[condition.rightTickerListId]
        appliedTickers.add(condition.rightTicker)
        console.log(`[BranchGenerator] Substituted right ticker ${condition.rightTicker} for list ${condition.rightTickerListId}`)
        // Clear the list reference fields
        delete (condition as any).rightTickerListId
        delete (condition as any).rightTickerListName
      }
      // FALLBACK: Handle rightTicker field containing "list:UUID" directly
      else if (condition.rightTicker && typeof condition.rightTicker === 'string' && condition.rightTicker.startsWith('list:')) {
        const listId = condition.rightTicker.substring(5)
        if (substitutions[listId]) {
          condition.rightTicker = substitutions[listId]
          appliedTickers.add(condition.rightTicker)
          console.log(`[BranchGenerator] Substituted right ticker ${condition.rightTicker} for inline list ${listId}`)
        }
      }
      // Also track regular (non-list) right tickers for AUTO mode matching
      else if (condition.rightTicker && typeof condition.rightTicker === 'string') {
        appliedTickers.add(condition.rightTicker)
      }
    }
  }

  // Apply to position node based on mode
  if (node.kind === 'position') {
    if (node.positionMode === 'match_indicator' && appliedTickers.size > 0) {
      // Match Indicator mode: use tickers from conditions above
      const ticker = Array.from(appliedTickers)[0] // Use first applied ticker
      // ALWAYS set positions array to the matched ticker (even if empty initially)
      node.positions = [ticker]
      // Track position ticker for database
      if (extractedTickers && !extractedTickers.positionTicker) {
        extractedTickers.positionTicker = ticker
      }
      console.log(`[BranchGenerator] Match Indicator: Applied ticker ${ticker} to position`)
    } else if (node.positionTickerListId && substitutions[node.positionTickerListId]) {
      // Ticker List mode: use ticker from list
      const ticker = substitutions[node.positionTickerListId]
      if (node.positions && node.positions.length > 0) {
        node.positions = node.positions.map(() => ticker)
        // Track position ticker for database
        if (extractedTickers && !extractedTickers.positionTicker) {
          extractedTickers.positionTicker = ticker
        }
        console.log(`[BranchGenerator] Substituted position ticker ${ticker} for list ${node.positionTickerListId}`)
        // Clear the list reference fields
        delete (node as any).positionTickerListId
        delete (node as any).positionTickerListName
      }
    }
    // FALLBACK: Handle positions array containing "list:UUID" directly (without positionTickerListId field)
    else if (node.positions && node.positions.length > 0) {
      // Check if any position starts with "list:"
      for (let i = 0; i < node.positions.length; i++) {
        const pos = node.positions[i]
        if (pos && typeof pos === 'string' && pos.startsWith('list:')) {
          const listId = pos.substring(5)
          if (substitutions[listId]) {
            // Replace all positions with the ticker from the list
            const ticker = substitutions[listId]
            node.positions = node.positions.map(() => ticker)
            // Track position ticker for database
            if (extractedTickers && !extractedTickers.positionTicker) {
              extractedTickers.positionTicker = ticker
            }
            console.log(`[BranchGenerator] Substituted position ticker ${ticker} for inline list ${listId}`)
            break // Only need to do this once for all positions
          }
        }
      }
    }
  }

  // Apply to entry/exit conditions for altExit nodes
  if (node.entryConditions && Array.isArray(node.entryConditions)) {
    for (const condition of node.entryConditions) {
      if (condition.tickerListId && substitutions[condition.tickerListId]) {
        condition.ticker = substitutions[condition.tickerListId]
        appliedTickers.add(condition.ticker)
        delete (condition as any).tickerListId
        delete (condition as any).tickerListName
      }
      else if (condition.ticker && typeof condition.ticker === 'string' && condition.ticker.startsWith('list:')) {
        const listId = condition.ticker.substring(5)
        if (substitutions[listId]) {
          condition.ticker = substitutions[listId]
          appliedTickers.add(condition.ticker)
        }
      }
      if (condition.rightTickerListId && substitutions[condition.rightTickerListId]) {
        condition.rightTicker = substitutions[condition.rightTickerListId]
        appliedTickers.add(condition.rightTicker)
        delete (condition as any).rightTickerListId
        delete (condition as any).rightTickerListName
      }
      else if (condition.rightTicker && typeof condition.rightTicker === 'string' && condition.rightTicker.startsWith('list:')) {
        const listId = condition.rightTicker.substring(5)
        if (substitutions[listId]) {
          condition.rightTicker = substitutions[listId]
          appliedTickers.add(condition.rightTicker)
        }
      }
    }
  }
  if (node.exitConditions && Array.isArray(node.exitConditions)) {
    for (const condition of node.exitConditions) {
      if (condition.tickerListId && substitutions[condition.tickerListId]) {
        condition.ticker = substitutions[condition.tickerListId]
        appliedTickers.add(condition.ticker)
        delete (condition as any).tickerListId
        delete (condition as any).tickerListName
      }
      else if (condition.ticker && typeof condition.ticker === 'string' && condition.ticker.startsWith('list:')) {
        const listId = condition.ticker.substring(5)
        if (substitutions[listId]) {
          condition.ticker = substitutions[listId]
          appliedTickers.add(condition.ticker)
        }
      }
      if (condition.rightTickerListId && substitutions[condition.rightTickerListId]) {
        condition.rightTicker = substitutions[condition.rightTickerListId]
        appliedTickers.add(condition.rightTicker)
        delete (condition as any).rightTickerListId
        delete (condition as any).rightTickerListName
      }
      else if (condition.rightTicker && typeof condition.rightTicker === 'string' && condition.rightTicker.startsWith('list:')) {
        const listId = condition.rightTicker.substring(5)
        if (substitutions[listId]) {
          condition.rightTicker = substitutions[listId]
          appliedTickers.add(condition.rightTicker)
        }
      }
    }
  }

  // Apply to numbered node items
  if (node.numbered && node.numbered.items) {
    for (const item of node.numbered.items) {
      if (item.conditions && Array.isArray(item.conditions)) {
        for (const condition of item.conditions) {
          if (condition.tickerListId && substitutions[condition.tickerListId]) {
            condition.ticker = substitutions[condition.tickerListId]
            appliedTickers.add(condition.ticker)
            delete (condition as any).tickerListId
            delete (condition as any).tickerListName
          }
          else if (condition.ticker && typeof condition.ticker === 'string' && condition.ticker.startsWith('list:')) {
            const listId = condition.ticker.substring(5)
            if (substitutions[listId]) {
              condition.ticker = substitutions[listId]
              appliedTickers.add(condition.ticker)
            }
          }
          if (condition.rightTickerListId && substitutions[condition.rightTickerListId]) {
            condition.rightTicker = substitutions[condition.rightTickerListId]
            appliedTickers.add(condition.rightTicker)
            delete (condition as any).rightTickerListId
            delete (condition as any).rightTickerListName
          }
          else if (condition.rightTicker && typeof condition.rightTicker === 'string' && condition.rightTicker.startsWith('list:')) {
            const listId = condition.rightTicker.substring(5)
            if (substitutions[listId]) {
              condition.rightTicker = substitutions[listId]
              appliedTickers.add(condition.rightTicker)
            }
          }
        }
      }
    }
  }

  // Recursively apply to children (passing appliedTickers so descendants can use them)
  if (node.children) {
    for (const slotKey in node.children) {
      const slot = node.children[slotKey as keyof typeof node.children]
      if (Array.isArray(slot)) {
        for (const child of slot) {
          if (child) {
            applyTickerSubstitutions(child, substitutions, appliedTickers, extractedTickers)
          }
        }
      }
    }
  }
}

/**
 * Apply a branch combination to a tree by updating parameter values
 * @param tree - The flowchart tree to modify (should be a clone)
 * @param combination - The branch combination with parameter values
 * @param ranges - Array of parameter ranges (for path information)
 * @param hasAutoMode - Whether the tree contains AUTO mode position nodes (cached to avoid repeated checks)
 * @returns Modified tree with parameter values applied
 */
export function applyBranchToTree(
  tree: FlowNode,
  combination: BranchCombination,
  ranges: ParameterRange[],
  hasAutoMode?: boolean
): FlowNode {
  // NOTE: Caller should clone the tree BEFORE calling this function
  // We apply parameters directly to preserve condition IDs for matching

  // Apply ticker substitutions and process AUTO mode positions
  // Only traverse tree if necessary (has ticker substitutions OR has AUTO mode position nodes)
  const extractedTickers: { conditionTicker?: string, positionTicker?: string } = {}
  const substitutions = combination.tickerSubstitutions || {}
  const hasSubstitutions = Object.keys(substitutions).length > 0
  const needsTraversal = hasSubstitutions || hasAutoMode

  if (needsTraversal) {
    applyTickerSubstitutions(tree, substitutions, new Set(), extractedTickers)
    // Add extracted tickers to combination for database storage
    if (extractedTickers.conditionTicker) {
      (combination as any).conditionTicker = extractedTickers.conditionTicker
    }
    if (extractedTickers.positionTicker) {
      (combination as any).positionTicker = extractedTickers.positionTicker
    }
  }

  // Apply each parameter value from the combination
  for (const [parameterId, value] of Object.entries(combination.parameterValues)) {
    // Find the corresponding range to get the path
    const range = ranges.find(r => r.id === parameterId)
    if (!range) {
      console.warn(`[BranchGenerator] Could not find range for parameter ${parameterId}`)
      continue
    }

    // Parse the path to navigate the tree (e.g., "node.conditions.1767985538054.window")
    const pathParts = range.path.split('.')

    // Skip "node" prefix if present (we're already at the node level)
    let startIndex = 0
    if (pathParts[0] === 'node') {
      startIndex = 1
    }

    // Special handling for condition paths: find the condition anywhere in the tree
    if (pathParts[startIndex] === 'conditions' && pathParts.length >= startIndex + 3) {
      const conditionId = pathParts[startIndex + 1]
      const field = pathParts[startIndex + 2]

      // Recursively search for the condition
      const findAndUpdateCondition = (node: any): boolean => {
        if (node.conditions && Array.isArray(node.conditions)) {
          // Match by ID containing the conditionId (handles cloned nodes with new suffixes)
          const condition = node.conditions.find((c: any) =>
            c.id === conditionId || c.id.includes(conditionId) || c.id.startsWith('node-' + conditionId)
          )
          if (condition) {
            condition[field] = value
            return true
          }
        }

        // Recursively search children
        if (node.children) {
          for (const slot in node.children) {
            const children = node.children[slot]
            if (Array.isArray(children)) {
              for (const child of children) {
                if (child && findAndUpdateCondition(child)) {
                  return true
                }
              }
            } else if (children && findAndUpdateCondition(children)) {
              return true
            }
          }
        }

        return false
      }

      if (findAndUpdateCondition(tree)) {
        continue // Successfully updated, move to next parameter
      } else {
        console.warn(`[BranchGenerator] ✗ Could not find condition with ID ${conditionId} in tree`)
        continue
      }
    }

    let current: any = tree

    // Navigate to the parent of the target field
    for (let i = startIndex; i < pathParts.length - 1; i++) {
      const part = pathParts[i]

      // Handle array navigation (e.g., conditions array with ID lookup)
      if (Array.isArray(current)) {
        // Find object in array with matching id property
        const found = current.find((item: any) => item.id === part)
        if (!found) {
          console.warn(`[BranchGenerator] Could not find item with id ${part} in array`)
          break
        }
        current = found
      } else if (current[part] !== undefined) {
        current = current[part]
      } else {
        console.warn(`[BranchGenerator] Invalid path ${range.path} at ${part}`)
        break
      }
    }

    // Update the target field
    const field = pathParts[pathParts.length - 1]

    if (current && (field in current || Array.isArray(current))) {
      if (Array.isArray(current)) {
        // If current is an array, find item by id
        const found = current.find((item: any) => item.id === field)
        if (found && 'value' in found) {
          found.value = value
        } else {
          console.warn(`[BranchGenerator] ✗ Could not find value field in array item ${field}`)
        }
      } else {
        current[field] = value
      }
    } else {
      console.warn(`[BranchGenerator] ✗ Could not find field ${field} in path ${range.path}`)
    }
  }

  return tree
}
