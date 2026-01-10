// server/jobs/prewarm-correlations.mjs
// Pre-compute correlations between Nexus bots for fast portfolio building

import { eq } from 'drizzle-orm'
import { storeCorrelationInCache, invalidateCorrelationCache } from '../features/cache/redis-cache.mjs'
import { isRedisAvailable } from '../lib/redis.mjs'
import { calculateReturns, alignReturnSeries, pearsonCorrelation } from '../correlation.mjs'

/**
 * Pre-compute correlations between all Nexus bots
 * This job:
 * 1. Fetches all bots with visibility='nexus'
 * 2. Gets their equity curves
 * 3. Computes pairwise correlations
 * 4. Stores in Redis for fast access and DB for persistence
 *
 * @param {object} options
 * @param {import('drizzle-orm/better-sqlite3').BetterSQLite3Database} options.database - Database instance
 * @param {boolean} [options.clearFirst] - Clear existing correlation cache first (default: true)
 * @returns {Promise<{computed: number, stored: number, duration: number}>}
 */
export async function prewarmCorrelations(options = {}) {
  const { database, clearFirst = true } = options

  if (!database) {
    console.error('[prewarm-correlations] Database not provided')
    return { computed: 0, stored: 0, duration: 0, error: 'Database not provided' }
  }

  console.log('[prewarm-correlations] Starting...')
  const startTime = Date.now()

  // Clear old correlation cache if Redis is available and clearFirst is true
  if (clearFirst && isRedisAvailable()) {
    const deleted = await invalidateCorrelationCache()
    console.log(`[prewarm-correlations] Cleared ${deleted} existing cache entries`)
  }

  try {
    // 1. Import schema
    const { bots, botEquityCurves, nexusCorrelations } = await import('../db/schema.mjs')

    // 2. Get all Nexus bots
    const nexusBots = await database.db
      .select({ id: bots.id, name: bots.name })
      .from(bots)
      .where(eq(bots.visibility, 'nexus'))

    console.log(`[prewarm-correlations] Found ${nexusBots.length} Nexus bots`)

    if (nexusBots.length < 2) {
      console.log('[prewarm-correlations] Not enough Nexus bots for correlation (need at least 2)')
      return { computed: 0, stored: 0, duration: 0, message: 'Not enough bots' }
    }

    // 3. Get equity curves for each bot
    const botEquityMap = new Map()

    for (const bot of nexusBots) {
      const curves = await database.db
        .select({ date: botEquityCurves.date, equity: botEquityCurves.equity })
        .from(botEquityCurves)
        .where(eq(botEquityCurves.botId, bot.id))

      if (curves.length > 0) {
        botEquityMap.set(bot.id, curves)
      }
    }

    console.log(`[prewarm-correlations] Got equity curves for ${botEquityMap.size} bots`)

    const botsWithCurves = nexusBots.filter((b) => botEquityMap.has(b.id))

    if (botsWithCurves.length < 2) {
      console.log('[prewarm-correlations] Not enough bots with equity curves')
      return { computed: 0, stored: 0, duration: 0, message: 'Not enough equity curves' }
    }

    // 4. Compute pairwise correlations
    let computed = 0
    let stored = 0
    const correlations = []

    const totalPairs = (botsWithCurves.length * (botsWithCurves.length - 1)) / 2
    console.log(`[prewarm-correlations] Computing ${totalPairs} pairwise correlations...`)

    for (let i = 0; i < botsWithCurves.length; i++) {
      for (let j = i + 1; j < botsWithCurves.length; j++) {
        const bot1 = botsWithCurves[i]
        const bot2 = botsWithCurves[j]

        try {
          // Get equity curves
          const curve1 = botEquityMap.get(bot1.id)
          const curve2 = botEquityMap.get(bot2.id)

          // Calculate returns
          const returns1 = calculateReturns(curve1)
          const returns2 = calculateReturns(curve2)

          // Align and compute correlation
          const { aligned1, aligned2 } = alignReturnSeries(returns1, returns2)

          if (aligned1.length >= 20) {
            // Need at least 20 overlapping days
            const corr = pearsonCorrelation(aligned1, aligned2)

            // Store in Redis
            if (isRedisAvailable()) {
              await storeCorrelationInCache(bot1.id, bot2.id, corr)
            }

            // Accumulate for DB insert
            correlations.push({
              bot1Id: bot1.id < bot2.id ? bot1.id : bot2.id,
              bot2Id: bot1.id < bot2.id ? bot2.id : bot1.id,
              correlation: corr,
              computedAt: new Date(),
            })

            computed++
          }

          // Progress log
          if ((computed + 1) % 100 === 0) {
            console.log(`[prewarm-correlations] Progress: ${computed}/${totalPairs}`)
          }
        } catch (e) {
          // Skip failed pairs
          if (computed < 5) {
            console.warn(`[prewarm-correlations] Error ${bot1.id}/${bot2.id}:`, e.message)
          }
        }
      }
    }

    // 5. Store in database (if nexusCorrelations table exists)
    if (correlations.length > 0 && nexusCorrelations) {
      try {
        // Clear old correlations
        await database.db.delete(nexusCorrelations)

        // Insert new ones in batches
        const batchSize = 500
        for (let i = 0; i < correlations.length; i += batchSize) {
          const batch = correlations.slice(i, i + batchSize)
          await database.db.insert(nexusCorrelations).values(batch)
          stored += batch.length
        }

        console.log(`[prewarm-correlations] Stored ${stored} correlations in database`)
      } catch (e) {
        // Table might not exist yet - that's OK, we still have Redis
        console.warn('[prewarm-correlations] Could not store in DB:', e.message)
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000)
    console.log(`[prewarm-correlations] Done: ${computed} computed, ${stored} stored in ${duration}s`)

    return { computed, stored, duration }
  } catch (e) {
    console.error('[prewarm-correlations] Error:', e)
    return { computed: 0, stored: 0, duration: 0, error: e.message }
  }
}

export default prewarmCorrelations
