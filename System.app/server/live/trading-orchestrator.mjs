/**
 * Trading Orchestrator - Two-Phase Execution Architecture
 *
 * Coordinates the entire trading execution flow across multiple users and systems.
 *
 * Phase 1 (Warm Up): Collect users, deduplicate systems, extract tickers
 * Phase 2 (Execution): Fetch prices, backtest, execute trades, attribute positions
 *
 * Features:
 * - Cross-user system deduplication (Nexus shared systems)
 * - Single price fetch for all tickers
 * - Net trade optimization (share reallocation)
 * - Random execution order for fairness
 * - Position attribution after execution
 */

import { v4 as uuidv4 } from 'uuid'
import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import { executeWarmup } from './phase1-warmup.mjs'
import { executePhase2 } from './phase2-execution.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'atlas.db')
const sqlite = new Database(DB_PATH)

/**
 * Execute the complete two-phase trading system
 *
 * @param {Object} options - Execution options
 * @param {string} options.mode - 'execute-live', 'execute-paper', or 'simulate'
 * @param {string} [options.userId] - Specific user to execute for (optional, for manual execution)
 * @param {string} [options.credentialType] - 'paper' or 'live' (optional, for manual execution)
 * @returns {Promise<Object>} Execution results
 */
export async function executeTrading(options = {}) {
  const executionId = uuidv4()
  const startTime = Date.now()

  console.log(`\n[ORCHESTRATOR] ════════════════════════════════════════════════════════`)
  console.log(`[ORCHESTRATOR] Starting Two-Phase Trading Execution`)
  console.log(`[ORCHESTRATOR] Execution ID: ${executionId}`)
  console.log(`[ORCHESTRATOR] Mode: ${options.mode}`)
  console.log(`[ORCHESTRATOR] ════════════════════════════════════════════════════════\n`)

  try {
    // Create execution record
    sqlite.prepare(`
      INSERT INTO trade_executions_v2 (execution_id, phase, started_at, status)
      VALUES (?, 'warmup', ?, 'running')
    `).run(executionId, startTime)

    // ============================================
    // PHASE 1: WARM UP (Collection & Deduplication)
    // ============================================
    console.log(`[ORCHESTRATOR] Starting Phase 1: Warm Up`)
    const phase1Start = Date.now()

    const warmupResult = await executeWarmup(executionId, options)

    const phase1Duration = Date.now() - phase1Start
    console.log(`[ORCHESTRATOR] Phase 1 completed in ${(phase1Duration / 1000).toFixed(2)}s`)
    console.log(`[ORCHESTRATOR] - Users: ${warmupResult.stats.totalUsers}`)
    console.log(`[ORCHESTRATOR] - Systems: ${warmupResult.stats.deduplicatedSystems} (deduplicated from ${warmupResult.stats.totalSystems})`)
    console.log(`[ORCHESTRATOR] - Tickers: ${warmupResult.stats.totalTickers}`)

    // Update execution record with Phase 1 stats
    sqlite.prepare(`
      UPDATE trade_executions_v2
      SET total_users = ?, total_systems = ?, total_tickers = ?
      WHERE execution_id = ?
    `).run(
      warmupResult.stats.totalUsers,
      warmupResult.stats.deduplicatedSystems,
      warmupResult.stats.totalTickers,
      executionId
    )

    // ============================================
    // PHASE 2: EXECUTION (Price Fetch → Trade → Attribute)
    // ============================================
    console.log(`\n[ORCHESTRATOR] Starting Phase 2: Execution`)
    const phase2Start = Date.now()

    // Update execution phase
    sqlite.prepare(`
      UPDATE trade_executions_v2 SET phase = 'execution' WHERE execution_id = ?
    `).run(executionId)

    const executionResult = await executePhase2(executionId, warmupResult, options)

    const phase2Duration = Date.now() - phase2Start
    console.log(`[ORCHESTRATOR] Phase 2 completed in ${(phase2Duration / 1000).toFixed(2)}s`)
    console.log(`[ORCHESTRATOR] - Trades executed: ${executionResult.totalTradesExecuted}`)
    console.log(`[ORCHESTRATOR] - Successful users: ${executionResult.successfulUsers}`)
    console.log(`[ORCHESTRATOR] - Failed users: ${executionResult.failedUsers}`)

    // ============================================
    // FINALIZE
    // ============================================
    const totalDuration = Date.now() - startTime

    // Update execution record as completed
    sqlite.prepare(`
      UPDATE trade_executions_v2
      SET status = 'completed', completed_at = ?, errors = ?
      WHERE execution_id = ?
    `).run(
      Date.now(),
      executionResult.errors.length > 0 ? JSON.stringify(executionResult.errors) : null,
      executionId
    )

    console.log(`\n[ORCHESTRATOR] ════════════════════════════════════════════════════════`)
    console.log(`[ORCHESTRATOR] Execution Complete`)
    console.log(`[ORCHESTRATOR] Total duration: ${(totalDuration / 1000).toFixed(2)}s`)
    console.log(`[ORCHESTRATOR] Phase 1 (Warm Up): ${(phase1Duration / 1000).toFixed(2)}s`)
    console.log(`[ORCHESTRATOR] Phase 2 (Execution): ${(phase2Duration / 1000).toFixed(2)}s`)
    console.log(`[ORCHESTRATOR] ════════════════════════════════════════════════════════\n`)

    return {
      success: true,
      executionId,
      phase1: warmupResult,
      phase2: executionResult,
      duration: totalDuration,
      stats: {
        totalUsers: warmupResult.stats.totalUsers,
        totalSystems: warmupResult.stats.deduplicatedSystems,
        totalTickers: warmupResult.stats.totalTickers,
        totalTrades: executionResult.totalTradesExecuted,
        successfulUsers: executionResult.successfulUsers,
        failedUsers: executionResult.failedUsers
      }
    }

  } catch (error) {
    console.error(`[ORCHESTRATOR] Execution failed:`, error)

    // Mark execution as failed
    sqlite.prepare(`
      UPDATE trade_executions_v2
      SET status = 'failed', completed_at = ?, errors = ?
      WHERE execution_id = ?
    `).run(
      Date.now(),
      JSON.stringify([{ message: error.message, stack: error.stack }]),
      executionId
    )

    return {
      success: false,
      executionId,
      error: error.message,
      duration: Date.now() - startTime
    }
  }
}

/**
 * Check if a user has v2 execution enabled
 *
 * @param {string} userId - User ID
 * @returns {boolean} True if v2 execution is enabled
 */
export function isV2ExecutionEnabled(userId) {
  try {
    const settings = sqlite.prepare(`
      SELECT use_v2_execution FROM trading_settings WHERE user_id = ?
    `).get(userId)

    return settings?.use_v2_execution === 1
  } catch (error) {
    console.error(`[ORCHESTRATOR] Error checking v2 flag for user ${userId}:`, error)
    return false
  }
}

/**
 * Enable v2 execution for a user (feature flag)
 *
 * @param {string} userId - User ID
 * @param {boolean} enabled - Enable or disable
 */
export function setV2ExecutionEnabled(userId, enabled) {
  sqlite.prepare(`
    INSERT INTO trading_settings (user_id, use_v2_execution)
    VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET use_v2_execution = excluded.use_v2_execution
  `).run(userId, enabled ? 1 : 0)

  console.log(`[ORCHESTRATOR] V2 execution ${enabled ? 'enabled' : 'disabled'} for user ${userId}`)
}

/**
 * Get execution history
 *
 * @param {number} limit - Maximum number of executions to return
 * @returns {Array} Execution history
 */
export function getExecutionHistory(limit = 10) {
  return sqlite.prepare(`
    SELECT * FROM trade_executions_v2
    ORDER BY started_at DESC
    LIMIT ?
  `).all(limit)
}

/**
 * Get detailed results for a specific execution
 *
 * @param {string} executionId - Execution ID
 * @returns {Object} Detailed execution results
 */
export function getExecutionDetails(executionId) {
  const execution = sqlite.prepare(`
    SELECT * FROM trade_executions_v2 WHERE execution_id = ?
  `).get(executionId)

  if (!execution) {
    throw new Error(`Execution ${executionId} not found`)
  }

  const userResults = sqlite.prepare(`
    SELECT * FROM user_execution_results WHERE execution_id = ? ORDER BY queue_position
  `).all(executionId)

  return {
    ...execution,
    userResults,
    errors: execution.errors ? JSON.parse(execution.errors) : []
  }
}
