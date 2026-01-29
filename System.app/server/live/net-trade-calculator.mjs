/**
 * Net Trade Calculator
 *
 * Calculates net position changes across all systems for a user.
 * Handles share reallocation between systems without actual trades.
 *
 * Key Concept:
 * - Bot A sells 100 SPY, Bot B buys 80 SPY → Net: Sell 20 SPY
 * - The 80 shares are internally reallocated in the ledger (no trade)
 * - Only the net 20 shares require an actual trade
 */

import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import { getPositions } from './broker-alpaca.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'atlas.db')
const sqlite = new Database(DB_PATH)

/**
 * Calculate current portfolio composition
 *
 * Queries Alpaca for current positions and compares with bot_position_ledger
 * to determine unallocated shares.
 *
 * @param {Object} alpacaClient - Alpaca API client
 * @param {string} userId - User ID
 * @param {string} credentialType - 'paper' or 'live'
 * @returns {Promise<Object>} Current portfolio { ticker: { totalShares, allocatedShares, unallocatedShares } }
 */
export async function getCurrentPortfolio(alpacaClient, userId, credentialType) {
  // Get positions from Alpaca API
  const alpacaPositions = await getPositions(alpacaClient)

  const currentPortfolio = {}

  // Add Alpaca positions
  for (const position of alpacaPositions) {
    const ticker = position.symbol.toUpperCase()
    const shares = position.qty

    currentPortfolio[ticker] = {
      totalShares: shares,
      allocatedShares: 0,
      unallocatedShares: shares,
      currentPrice: position.currentPrice,  // Store price for later use
    }
  }

  // Query bot_position_ledger to see how many shares are allocated to bots
  const ledgerEntries = sqlite.prepare(`
    SELECT symbol, bot_id, shares
    FROM bot_position_ledger
    WHERE user_id = ? AND credential_type = ? AND shares > 0
  `).all(userId, credentialType)

  const phantomPositions = [] // Track positions in ledger but not in Alpaca

  for (const entry of ledgerEntries) {
    const ticker = entry.symbol.toUpperCase()

    if (!currentPortfolio[ticker]) {
      // Ledger has shares but Alpaca doesn't - this is a data inconsistency
      console.warn(`[net-trade-calc] PHANTOM: Ledger has ${entry.shares} ${ticker} (bot: ${entry.bot_id}) but Alpaca has 0 shares`)
      phantomPositions.push({ bot_id: entry.bot_id, symbol: ticker, shares: entry.shares })

      currentPortfolio[ticker] = {
        totalShares: 0,
        allocatedShares: 0,
        unallocatedShares: 0,
      }
    }

    currentPortfolio[ticker].allocatedShares += entry.shares

    if (entry.bot_id === 'unallocated') {
      // Don't subtract unallocated from unallocated (it's already tracked separately)
    } else {
      currentPortfolio[ticker].unallocatedShares -= entry.shares
    }
  }

  // CLEANUP: Remove phantom system positions from ledger
  if (phantomPositions.length > 0) {
    console.warn(`[net-trade-calc] Cleaning up ${phantomPositions.length} phantom positions from ledger...`)
    const deletePhantom = sqlite.prepare(`
      DELETE FROM bot_position_ledger
      WHERE user_id = ? AND credential_type = ? AND bot_id = ? AND symbol = ?
    `)

    for (const phantom of phantomPositions) {
      if (phantom.bot_id !== 'unallocated') {
        // Only delete system positions, not unallocated (we'll reconcile those separately)
        deletePhantom.run(userId, credentialType, phantom.bot_id, phantom.symbol)
        console.warn(`[net-trade-calc]   Removed phantom: ${phantom.symbol} from ${phantom.bot_id} (${phantom.shares} shares)`)
      }
    }
  }

  // Ensure unallocated shares are never negative (data cleanup)
  for (const ticker in currentPortfolio) {
    if (currentPortfolio[ticker].unallocatedShares < 0) {
      console.warn(`[net-trade-calc] Negative unallocated shares for ${ticker}: ${currentPortfolio[ticker].unallocatedShares} (fixing to 0)`)
      currentPortfolio[ticker].unallocatedShares = 0
    }
  }

  // ============================================
  // AUTO-RECONCILIATION: Update unallocated positions in ledger
  // ============================================
  // Write back unallocated shares to the ledger so it always matches reality
  console.log(`[net-trade-calc] Reconciling unallocated positions in ledger...`)

  const upsertUnallocated = sqlite.prepare(`
    INSERT INTO bot_position_ledger (user_id, credential_type, bot_id, symbol, shares, avg_price)
    VALUES (?, ?, 'unallocated', ?, ?, ?)
    ON CONFLICT(user_id, credential_type, bot_id, symbol) DO UPDATE SET
      shares = excluded.shares,
      avg_price = excluded.avg_price
  `)

  const deleteUnallocated = sqlite.prepare(`
    DELETE FROM bot_position_ledger
    WHERE user_id = ? AND credential_type = ? AND bot_id = 'unallocated' AND symbol = ?
  `)

  for (const [ticker, portfolio] of Object.entries(currentPortfolio)) {
    const unallocatedShares = portfolio.unallocatedShares

    if (unallocatedShares > 0.0001) {
      // Have unallocated shares - write to ledger
      const price = portfolio.currentPrice || 0  // Use actual current price from Alpaca

      upsertUnallocated.run(userId, credentialType, ticker, unallocatedShares, price)
      console.log(`[net-trade-calc]   Set unallocated ${ticker}: ${unallocatedShares.toFixed(4)} shares`)
    } else {
      // No unallocated shares - remove from ledger if exists
      deleteUnallocated.run(userId, credentialType, ticker)
    }
  }

  // Also remove any unallocated ledger entries for tickers we no longer have
  const existingUnallocated = sqlite.prepare(`
    SELECT symbol FROM bot_position_ledger
    WHERE user_id = ? AND credential_type = ? AND bot_id = 'unallocated'
  `).all(userId, credentialType)

  for (const entry of existingUnallocated) {
    const ticker = entry.symbol.toUpperCase()
    if (!currentPortfolio[ticker]) {
      // Ticker no longer in Alpaca - remove from unallocated
      deleteUnallocated.run(userId, credentialType, ticker)
      console.log(`[net-trade-calc]   Removed stale unallocated ${ticker}`)
    }
  }

  console.log(`[net-trade-calc] Unallocated reconciliation complete`)

  return currentPortfolio
}

/**
 * Calculate final portfolio composition based on bot allocations and investments
 *
 * Merges allocations from all systems weighted by investment amount.
 * Supports P&L rollover (using current market value instead of original investment).
 *
 * @param {string} userId - User ID
 * @param {string} credentialType - 'paper' or 'live'
 * @param {Map} systemAllocations - Map of systemId -> { ticker: percent }
 * @param {Map} priceMap - Map of ticker -> current price
 * @param {Object} options - Calculation options
 * @param {boolean} [options.usePnlRollover=true] - Use current market value for investment weights
 * @returns {Object} Final portfolio { ticker: targetShares }
 */
export function calculateFinalPortfolio(userId, credentialType, systemAllocations, priceMap, options = {}) {
  const { usePnlRollover = true, totalEquity } = options

  // Get user's bot investments
  const investments = sqlite.prepare(`
    SELECT
      bot_id,
      investment_amount as investment,
      weight_mode as mode
    FROM user_bot_investments
    WHERE user_id = ? AND credential_type = ? AND investment_amount > 0
  `).all(userId, credentialType)

  if (!totalEquity || totalEquity <= 0) {
    console.error('[net-trade-calc] No totalEquity provided to calculateFinalPortfolio')
    return {}
  }

  // Calculate dollar amount for each investment
  let totalInvestmentDollars = 0
  const investmentWeights = []

  for (const inv of investments) {
    let dollarAmount
    if (inv.mode === 'percent') {
      dollarAmount = totalEquity * (inv.investment / 100)
    } else {
      dollarAmount = inv.investment
    }

    if (usePnlRollover) {
      // TODO: Calculate current market value of bot's positions instead of using original investment
      // This requires querying bot_position_ledger and multiplying by current prices
      // For now, use original investment as placeholder
    }

    totalInvestmentDollars += dollarAmount
    investmentWeights.push({
      botId: inv.bot_id,
      dollarAmount,
      weight: 0, // Will be calculated after totals are known
    })
  }

  // Calculate weights
  for (const inv of investmentWeights) {
    inv.weight = totalInvestmentDollars > 0 ? inv.dollarAmount / totalInvestmentDollars : 0
  }

  // Merge allocations weighted by investment
  const mergedAllocations = {} // ticker -> percent

  for (const inv of investmentWeights) {
    const systemId = inv.botId
    const allocations = systemAllocations.get(systemId) || {}

    for (const [ticker, percent] of Object.entries(allocations)) {
      const weightedPercent = percent * inv.weight
      mergedAllocations[ticker] = (mergedAllocations[ticker] || 0) + weightedPercent
    }
  }

  // Convert percentages to target share counts
  const finalPortfolio = {} // ticker -> targetShares

  for (const [ticker, percent] of Object.entries(mergedAllocations)) {
    const price = priceMap.get(ticker)
    if (!price || price <= 0) {
      console.warn(`[net-trade-calc] No price for ${ticker}, skipping`)
      continue
    }

    const dollarAmount = totalEquity * (percent / 100)
    const shares = dollarAmount / price

    finalPortfolio[ticker] = shares
  }

  return finalPortfolio
}

/**
 * Calculate net position changes
 *
 * Compares current portfolio to final portfolio to determine which trades to execute.
 *
 * @param {Object} currentPortfolio - Current positions { ticker: { totalShares, ... } }
 * @param {Object} finalPortfolio - Target positions { ticker: targetShares }
 * @returns {Object} Net trades { ticker: netChange }
 */
export function calculateNetTrades(currentPortfolio, finalPortfolio) {
  const netTrades = {}

  // Get all tickers from both portfolios
  const allTickers = new Set([
    ...Object.keys(currentPortfolio),
    ...Object.keys(finalPortfolio),
  ])

  for (const ticker of allTickers) {
    const currentShares = currentPortfolio[ticker]?.totalShares || 0
    const targetShares = finalPortfolio[ticker] || 0

    const netChange = targetShares - currentShares

    if (Math.abs(netChange) > 0.0001) {
      // Only include if change is significant (avoid floating point noise)
      netTrades[ticker] = netChange
    }
  }

  return netTrades
}

/**
 * Calculate share attribution for a user's positions
 *
 * After trades execute, determines which shares belong to which bot based on
 * target allocations and investment weights.
 *
 * Example:
 * - Bot A wants 60% SPY, invested $6k (60% of total)
 * - Bot B wants 40% SPY, invested $4k (40% of total)
 * - Total SPY position: 100 shares
 * - Attribution: Bot A gets 60 shares, Bot B gets 40 shares
 *
 * @param {string} userId - User ID
 * @param {string} credentialType - 'paper' or 'live'
 * @param {Object} executedPositions - Actual positions after trade execution { ticker: shares }
 * @param {Map} systemAllocations - Map of systemId -> { ticker: percent }
 * @returns {Object} Attribution { botId: { ticker: shares } }
 */
export function calculateShareAttribution(userId, credentialType, executedPositions, systemAllocations) {
  // Get user's bot investments
  const investments = sqlite.prepare(`
    SELECT
      bot_id,
      investment_amount as investment,
      weight_mode as mode
    FROM user_bot_investments
    WHERE user_id = ? AND credential_type = ? AND investment_amount > 0
  `).all(userId, credentialType)

  // TODO: Get total equity from Alpaca
  const totalEquity = 100000 // Placeholder

  // Calculate investment weights
  let totalInvestmentDollars = 0
  const investmentWeights = []

  for (const inv of investments) {
    let dollarAmount
    if (inv.mode === 'percent') {
      dollarAmount = totalEquity * (inv.investment / 100)
    } else {
      dollarAmount = inv.investment
    }
    totalInvestmentDollars += dollarAmount
    investmentWeights.push({ botId: inv.bot_id, dollarAmount })
  }

  // Calculate attribution for each ticker
  const attribution = {} // botId -> { ticker: shares }

  for (const [ticker, totalShares] of Object.entries(executedPositions)) {
    // Determine which bots want this ticker and their relative weights
    const botWeights = []
    let totalTickerWeight = 0

    for (const inv of investmentWeights) {
      const allocations = systemAllocations.get(inv.botId) || {}
      const tickerPercent = allocations[ticker] || 0

      if (tickerPercent > 0) {
        const investmentWeight = inv.dollarAmount / totalInvestmentDollars
        const tickerWeight = tickerPercent * investmentWeight
        totalTickerWeight += tickerWeight
        botWeights.push({ botId: inv.botId, tickerWeight })
      }
    }

    // Attribute shares proportionally
    for (const { botId, tickerWeight } of botWeights) {
      const attributedShares = totalTickerWeight > 0
        ? (tickerWeight / totalTickerWeight) * totalShares
        : 0

      if (!attribution[botId]) {
        attribution[botId] = {}
      }

      attribution[botId][ticker] = attributedShares
    }
  }

  return attribution
}
