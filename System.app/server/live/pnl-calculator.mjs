/**
 * P&L Calculator
 *
 * Calculates unrealized profit and loss for each system based on
 * current market prices and cost basis from the position ledger.
 */

import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'atlas.db')
const sqlite = new Database(DB_PATH)

/**
 * Calculate unrealized P&L for all systems for a user
 *
 * @param {string} userId - User ID
 * @param {string} credentialType - 'paper' or 'live'
 * @param {Map} priceMap - Map of ticker -> current price
 * @returns {Object} P&L by system { botId: { marketValue, costBasis, unrealizedPnl, unrealizedPnlPct } }
 */
export function calculateUnrealizedPnL(userId, credentialType, priceMap) {
  // Get all positions from ledger for this user
  const positions = sqlite.prepare(`
    SELECT bot_id, symbol, shares, avg_price
    FROM bot_position_ledger
    WHERE user_id = ? AND credential_type = ? AND shares > 0
  `).all(userId, credentialType)

  const pnlBySystem = {}

  for (const position of positions) {
    const { bot_id, symbol, shares, avg_price } = position
    const ticker = symbol  // Alias for consistency
    const currentPrice = priceMap.get(ticker.toUpperCase())

    if (!currentPrice || currentPrice <= 0) {
      console.warn(`[pnl-calc] No price for ${ticker}, skipping P&L calculation`)
      continue
    }

    const costBasis = shares * (avg_price || 0)
    const marketValue = shares * currentPrice
    const unrealizedPnl = marketValue - costBasis
    const unrealizedPnlPct = costBasis > 0 ? (unrealizedPnl / costBasis) * 100 : 0

    if (!pnlBySystem[bot_id]) {
      pnlBySystem[bot_id] = {
        positions: [],
        totalMarketValue: 0,
        totalCostBasis: 0,
        totalUnrealizedPnl: 0,
      }
    }

    pnlBySystem[bot_id].positions.push({
      ticker,
      shares,
      avgPrice: avg_price,
      currentPrice,
      costBasis,
      marketValue,
      unrealizedPnl,
      unrealizedPnlPct,
    })

    pnlBySystem[bot_id].totalMarketValue += marketValue
    pnlBySystem[bot_id].totalCostBasis += costBasis
    pnlBySystem[bot_id].totalUnrealizedPnl += unrealizedPnl
  }

  // Calculate total P&L percentage for each system
  for (const botId in pnlBySystem) {
    const system = pnlBySystem[botId]
    system.totalUnrealizedPnlPct = system.totalCostBasis > 0
      ? (system.totalUnrealizedPnl / system.totalCostBasis) * 100
      : 0
  }

  return pnlBySystem
}

/**
 * Calculate total account P&L
 *
 * @param {string} userId - User ID
 * @param {string} credentialType - 'paper' or 'live'
 * @param {Map} priceMap - Map of ticker -> current price
 * @returns {Object} Total P&L { marketValue, costBasis, unrealizedPnl, unrealizedPnlPct }
 */
export function calculateTotalPnL(userId, credentialType, priceMap) {
  const systemPnL = calculateUnrealizedPnL(userId, credentialType, priceMap)

  let totalMarketValue = 0
  let totalCostBasis = 0
  let totalUnrealizedPnl = 0

  for (const botId in systemPnL) {
    const system = systemPnL[botId]
    totalMarketValue += system.totalMarketValue
    totalCostBasis += system.totalCostBasis
    totalUnrealizedPnl += system.totalUnrealizedPnl
  }

  const totalUnrealizedPnlPct = totalCostBasis > 0
    ? (totalUnrealizedPnl / totalCostBasis) * 100
    : 0

  return {
    marketValue: totalMarketValue,
    costBasis: totalCostBasis,
    unrealizedPnl: totalUnrealizedPnl,
    unrealizedPnlPct: totalUnrealizedPnlPct,
  }
}

/**
 * Get P&L summary for a specific system
 *
 * @param {string} userId - User ID
 * @param {string} credentialType - 'paper' or 'live'
 * @param {string} botId - Bot ID
 * @param {Map} priceMap - Map of ticker -> current price
 * @returns {Object} System P&L or null if not found
 */
export function getSystemPnL(userId, credentialType, botId, priceMap) {
  const allPnL = calculateUnrealizedPnL(userId, credentialType, priceMap)
  return allPnL[botId] || null
}
