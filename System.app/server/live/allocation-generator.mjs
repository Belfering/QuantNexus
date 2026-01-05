/**
 * Allocation Generator
 *
 * Converts Atlas Engine bot flowcharts into ticker allocations.
 * This runs the backtest logic for a single day to get current allocations.
 */

/**
 * Generate allocation percentages from a bot's flowchart strategy
 * This is a placeholder - actual implementation will use the backtest engine
 *
 * @param {Object} db - Database instance
 * @param {string} botId - Bot ID to generate allocations for
 * @param {Date} date - Date to generate allocations for (default: today)
 * @returns {Promise<Object>} - { SPY: 40, QQQ: 30, BIL: 30 }
 */
export async function generateAllocation(db, botId, date = new Date()) {
  // TODO: Implement actual flowchart evaluation
  // For now, this is a stub that would:
  // 1. Load bot payload (flowchart tree) from database
  // 2. Load ticker data for the specified date
  // 3. Evaluate the flowchart tree to get final positions
  // 4. Return allocation percentages

  // Placeholder implementation
  console.log(`[allocation-generator] Generating allocations for bot ${botId} on ${date.toISOString().split('T')[0]}`)

  // This would be replaced with actual backtest evaluation
  return {
    // Example allocations
    SPY: 50,
    BIL: 50,
  }
}

/**
 * Generate allocations for multiple bots and merge them
 * @param {Object} db - Database instance
 * @param {Array<{botId: string, weight: number}>} bots - Bots with weights
 * @param {Date} date - Date to generate allocations for
 * @returns {Promise<Object>} - Merged and normalized allocations
 */
export async function generateMergedAllocations(db, bots, date = new Date()) {
  const mergedAllocations = {}
  let totalWeight = 0

  for (const { botId, weight } of bots) {
    const botAlloc = await generateAllocation(db, botId, date)
    totalWeight += weight

    for (const [ticker, pct] of Object.entries(botAlloc)) {
      const weightedPct = pct * weight
      mergedAllocations[ticker] = (mergedAllocations[ticker] || 0) + weightedPct
    }
  }

  // Normalize to 100%
  if (totalWeight > 0) {
    const total = Object.values(mergedAllocations).reduce((a, b) => a + b, 0)
    if (total > 0) {
      for (const ticker of Object.keys(mergedAllocations)) {
        mergedAllocations[ticker] = (mergedAllocations[ticker] / total) * 100
      }
    }
  }

  return mergedAllocations
}

/**
 * Format allocations as CSV in master.py format
 * Format: "2026-01-01,SPY 40.00%,QQQ 30.00%,BIL 30.00%"
 *
 * @param {string} date - Date string (YYYY-MM-DD)
 * @param {Object} allocations - { ticker: percent }
 * @returns {string} CSV formatted line
 */
export function formatAllocationCSV(date, allocations) {
  const entries = Object.entries(allocations)
    .filter(([, pct]) => pct > 0)
    .sort((a, b) => b[1] - a[1]) // Sort by percentage descending
    .map(([ticker, pct]) => `${ticker} ${pct.toFixed(2)}%`)

  return [date, ...entries].join(',')
}

/**
 * Parse allocation CSV line back to object
 * @param {string} csvLine - CSV formatted allocation line
 * @returns {{ date: string, allocations: Object }}
 */
export function parseAllocationCSV(csvLine) {
  const parts = csvLine.split(',')
  const date = parts[0]
  const allocations = {}

  for (let i = 1; i < parts.length; i++) {
    const match = parts[i].trim().match(/^([A-Z]+)\s+(\d+(?:\.\d+)?)%?$/)
    if (match) {
      allocations[match[1]] = parseFloat(match[2])
    }
  }

  return { date, allocations }
}
