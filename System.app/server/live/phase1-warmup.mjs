/**
 * Phase 1: Warm Up - Collection & Deduplication
 *
 * Collects all users, systems, and tickers needed for execution.
 * Deduplicates systems across users (critical for Nexus shared bots).
 * Randomizes user execution order for fairness.
 *
 * Output:
 * - uniqueSystems: Deduplicated list of systems to backtest
 * - allTickers: Deduplicated list of all tickers needed
 * - executionQueue: Randomized order of users to execute
 * - stats: Summary statistics
 */

import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import { decompressPayload } from '../db/index.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'atlas.db')
const sqlite = new Database(DB_PATH)

/**
 * Execute Phase 1 Warm Up
 *
 * @param {string} executionId - UUID for this execution run
 * @param {Object} options - Execution options
 * @param {string} options.mode - 'execute-live', 'execute-paper', or 'simulate'
 * @param {string} [options.userId] - Specific user to execute for (optional)
 * @param {string} [options.credentialType] - 'paper' or 'live' (optional)
 * @returns {Promise<Object>} Warm up results
 */
export async function executeWarmup(executionId, options = {}) {
  console.log(`[WARMUP] Starting Phase 1: Collection & Deduplication`)

  // ============================================
  // STEP 1: Collect All User Accounts
  // ============================================
  console.log(`[WARMUP] Step 1: Collecting user accounts...`)

  const userAccounts = collectUserAccounts(options)
  console.log(`[WARMUP] - Found ${userAccounts.length} user accounts`)

  if (userAccounts.length === 0) {
    console.log(`[WARMUP] No users to execute for - exiting warm up`)
    return {
      uniqueSystems: [],
      allTickers: [],
      executionQueue: [],
      stats: {
        totalUsers: 0,
        totalSystems: 0,
        totalTickers: 0,
        deduplicatedSystems: 0
      }
    }
  }

  // ============================================
  // STEP 2: Collect All Systems Per User
  // ============================================
  console.log(`[WARMUP] Step 2: Collecting systems per user...`)

  const userSystemsMap = new Map() // userId-credType -> [system1, system2, ...]
  let totalSystemCount = 0

  for (const { userId, credentialType } of userAccounts) {
    const systems = await collectUserSystems(userId, credentialType)
    const key = `${userId}-${credentialType}`
    userSystemsMap.set(key, systems)
    totalSystemCount += systems.length
    console.log(`[WARMUP]   - User ${userId} (${credentialType}): ${systems.length} systems`)
  }

  console.log(`[WARMUP] - Total systems across all users: ${totalSystemCount}`)

  // ============================================
  // STEP 3: Deduplicate Systems Across Users
  // ============================================
  console.log(`[WARMUP] Step 3: Deduplicating systems...`)

  const systemDeduplicationMap = new Map() // systemId -> { userIds: [], payload: {} }

  for (const [userKey, systems] of userSystemsMap.entries()) {
    const [userId, credentialType] = userKey.split('-')

    for (const system of systems) {
      const systemId = system.botId || `unallocated-${userId}-${credentialType}`

      if (!systemDeduplicationMap.has(systemId)) {
        systemDeduplicationMap.set(systemId, {
          systemId,
          userAccounts: [],
          payload: system.payload,
          isUnallocated: system.isUnallocated || false
        })
      }

      systemDeduplicationMap.get(systemId).userAccounts.push({
        userId,
        credentialType,
        investment: system.investment
      })
    }
  }

  const uniqueSystems = Array.from(systemDeduplicationMap.values())
  console.log(`[WARMUP] - Deduplicated to ${uniqueSystems.length} unique systems`)
  console.log(`[WARMUP] - Deduplication saved ${totalSystemCount - uniqueSystems.length} backtest runs`)

  // Update system_deduplication table
  updateSystemDeduplicationTable(uniqueSystems)

  // ============================================
  // STEP 4: Extract All Tickers
  // ============================================
  console.log(`[WARMUP] Step 4: Extracting tickers from systems...`)

  const tickerSet = new Set()

  for (const system of uniqueSystems) {
    if (system.isUnallocated) {
      // Unallocated doesn't have a payload - skip ticker extraction
      continue
    }

    try {
      const tickers = extractTickersFromPayload(system.payload)
      tickers.forEach(ticker => tickerSet.add(ticker))
    } catch (error) {
      console.error(`[WARMUP] Error extracting tickers from system ${system.systemId}:`, error.message)
    }
  }

  const allTickers = Array.from(tickerSet).sort()
  console.log(`[WARMUP] - Extracted ${allTickers.length} unique tickers`)
  if (allTickers.length > 0) {
    console.log(`[WARMUP] - Sample tickers: ${allTickers.slice(0, 10).join(', ')}${allTickers.length > 10 ? '...' : ''}`)
  }

  // ============================================
  // STEP 5: Randomize User Execution Order
  // ============================================
  console.log(`[WARMUP] Step 5: Randomizing execution order...`)

  const executionQueue = fisherYatesShuffle([...userAccounts])

  // Store execution queue in database
  const insertQueue = sqlite.prepare(`
    INSERT INTO execution_queue (execution_id, user_id, credential_type, queue_position, status)
    VALUES (?, ?, ?, ?, 'pending')
  `)

  executionQueue.forEach((account, index) => {
    insertQueue.run(executionId, account.userId, account.credentialType, index + 1)
  })

  console.log(`[WARMUP] - Execution queue created with ${executionQueue.length} users`)
  console.log(`[WARMUP] - First 5 users: ${executionQueue.slice(0, 5).map(a => a.userId).join(', ')}`)

  // ============================================
  // FINALIZE
  // ============================================
  const stats = {
    totalUsers: userAccounts.length,
    totalSystems: totalSystemCount,
    totalTickers: allTickers.length,
    deduplicatedSystems: uniqueSystems.length
  }

  console.log(`[WARMUP] Phase 1 complete:`)
  console.log(`[WARMUP] - Users: ${stats.totalUsers}`)
  console.log(`[WARMUP] - Systems: ${stats.deduplicatedSystems} (deduplicated from ${stats.totalSystems})`)
  console.log(`[WARMUP] - Tickers: ${stats.totalTickers}`)

  return {
    uniqueSystems,
    allTickers,
    executionQueue,
    stats
  }
}

/**
 * Collect all user accounts that should be executed
 *
 * @param {Object} options - Execution options
 * @returns {Array<{userId: string, credentialType: string}>}
 */
function collectUserAccounts(options) {
  // If specific user provided (manual execution), return only that user
  if (options.userId && options.credentialType) {
    console.log(`[WARMUP] Manual execution for specific user: ${options.userId} (${options.credentialType})`)
    return [{ userId: options.userId, credentialType: options.credentialType }]
  }

  // Otherwise, collect all enabled users
  const enabledUsers = sqlite.prepare(`
    SELECT user_id FROM trading_settings WHERE enabled = 1
  `).all()

  const userAccounts = []

  for (const { user_id } of enabledUsers) {
    // Check if user has paper credentials with positions
    const hasPaperPositions = sqlite.prepare(`
      SELECT COUNT(*) as count
      FROM bot_position_ledger
      WHERE user_id = ? AND credential_type = 'paper' AND shares > 0
    `).get(user_id)

    // Check if user has live credentials with positions
    const hasLivePositions = sqlite.prepare(`
      SELECT COUNT(*) as count
      FROM bot_position_ledger
      WHERE user_id = ? AND credential_type = 'live' AND shares > 0
    `).get(user_id)

    // Check if user has any bot investments
    const hasInvestments = sqlite.prepare(`
      SELECT COUNT(*) as count
      FROM user_bot_investments
      WHERE user_id = ? AND (paper_investment > 0 OR live_investment > 0)
    `).get(user_id)

    // Add paper account if has positions or investments
    if (hasPaperPositions.count > 0 || hasInvestments.count > 0) {
      userAccounts.push({ userId: user_id, credentialType: 'paper' })
    }

    // Add live account if has positions or investments
    if (hasLivePositions.count > 0 || hasInvestments.count > 0) {
      userAccounts.push({ userId: user_id, credentialType: 'live' })
    }
  }

  return userAccounts
}

/**
 * Collect all systems for a user account
 *
 * @param {string} userId - User ID
 * @param {string} credentialType - 'paper' or 'live'
 * @returns {Promise<Array<{botId: string, investment: number, payload: object, isUnallocated: boolean}>>}
 */
async function collectUserSystems(userId, credentialType) {
  const systems = []

  // Get all bot investments for this user
  const investments = sqlite.prepare(`
    SELECT bot_id, investment_amount as investment, weight_mode as mode
    FROM user_bot_investments
    WHERE user_id = ? AND credential_type = ? AND investment_amount > 0
  `).all(userId, credentialType)

  // For each investment, get the bot payload
  for (const { bot_id, investment, mode } of investments) {
    const bot = sqlite.prepare(`
      SELECT payload FROM bots WHERE id = ?
    `).get(bot_id)

    if (bot && bot.payload) {
      try {
        // Decompress payload if gzipped
        const decompressed = await decompressPayload(bot.payload)
        const payload = typeof decompressed === 'string' ? JSON.parse(decompressed) : decompressed

        systems.push({
          botId: bot_id,
          investment,
          mode,
          payload,
          isUnallocated: false
        })
      } catch (error) {
        console.error(`[WARMUP] Error parsing payload for bot ${bot_id}:`, error.message)
      }
    }
  }

  // Check if user has unallocated positions
  const unallocatedPositions = sqlite.prepare(`
    SELECT COUNT(*) as count
    FROM bot_position_ledger
    WHERE user_id = ? AND credential_type = ? AND bot_id = 'unallocated' AND shares > 0
  `).get(userId, credentialType)

  if (unallocatedPositions.count > 0) {
    // Add unallocated as a pseudo-system
    systems.push({
      botId: null,
      investment: 0, // Unallocated doesn't have investment amount
      payload: null,
      isUnallocated: true
    })
  }

  return systems
}

/**
 * Extract all tickers from a bot payload
 *
 * @param {Object} payload - Bot flowchart payload
 * @returns {string[]} Array of ticker symbols
 */
function extractTickersFromPayload(payload) {
  const tickers = new Set()

  function walkNode(node) {
    if (!node) return

    // Check if node has positions (leaf nodes)
    if (node.positions && Array.isArray(node.positions)) {
      for (const position of node.positions) {
        // positions is an array of ticker strings, not objects
        if (position && position !== 'Empty') {
          tickers.add(position)  // position IS the ticker string
        }
      }
    }

    // Recursively walk children
    if (node.children) {
      for (const slotId in node.children) {
        const children = node.children[slotId]
        if (Array.isArray(children)) {
          children.forEach(child => {
            if (child) walkNode(child)
          })
        }
      }
    }
  }

  walkNode(payload)
  return Array.from(tickers)
}

/**
 * Fisher-Yates shuffle for randomizing execution order
 *
 * @param {Array} array - Array to shuffle
 * @returns {Array} Shuffled array
 */
function fisherYatesShuffle(array) {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

/**
 * Update system_deduplication table with current data
 *
 * @param {Array} uniqueSystems - Deduplicated systems
 */
function updateSystemDeduplicationTable(uniqueSystems) {
  const upsert = sqlite.prepare(`
    INSERT INTO system_deduplication (system_id, user_count, last_allocation, last_updated)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(system_id) DO UPDATE SET
      user_count = excluded.user_count,
      last_updated = excluded.last_updated
  `)

  for (const system of uniqueSystems) {
    upsert.run(
      system.systemId,
      system.userAccounts.length,
      null, // last_allocation will be set during Phase 2
      Date.now()
    )
  }
}
