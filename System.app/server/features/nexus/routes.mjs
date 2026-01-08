// server/features/nexus/routes.mjs
// Nexus (community) bot endpoints and correlation optimization

import express from 'express'
import { z } from 'zod'
import * as database from '../../db/index.mjs'
import { asyncHandler } from '../../middleware/errorHandler.mjs'
import { validate } from '../../middleware/validation.mjs'
import { createLogger } from '../../lib/logger.mjs'
import { ensureDbInitialized } from '../bots/routes.mjs'
import { pearsonCorrelation } from '../../correlation.mjs'

const router = express.Router()
const logger = createLogger('nexus')

// ============================================================================
// Nexus Bot Endpoints - PUBLIC, NO PAYLOAD
// ============================================================================

/**
 * GET /api/nexus/bots - List all Nexus bots (without payloads)
 */
router.get('/bots', asyncHandler(async (req, res) => {
  await ensureDbInitialized()
  const bots = await database.getNexusBots()
  res.json({ bots })
}))

const topBotsSchema = {
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(10),
  }).partial(),
}

/**
 * GET /api/nexus/top/cagr - Top Nexus bots by CAGR
 */
router.get('/top/cagr', validate(topBotsSchema), asyncHandler(async (req, res) => {
  await ensureDbInitialized()
  const limit = req.query.limit || 10
  const bots = await database.getTopNexusBotsByCagr(limit)
  res.json({ bots })
}))

/**
 * GET /api/nexus/top/calmar - Top Nexus bots by Calmar ratio
 */
router.get('/top/calmar', validate(topBotsSchema), asyncHandler(async (req, res) => {
  await ensureDbInitialized()
  const limit = req.query.limit || 10
  const bots = await database.getTopNexusBotsByCalmar(limit)
  res.json({ bots })
}))

/**
 * GET /api/nexus/top/sharpe - Top Nexus bots by Sharpe ratio
 */
router.get('/top/sharpe', validate(topBotsSchema), asyncHandler(async (req, res) => {
  await ensureDbInitialized()
  const limit = req.query.limit || 10
  const bots = await database.getTopNexusBotsBySharpe(limit)
  res.json({ bots })
}))

// ============================================================================
// Correlation Helper Functions
// ============================================================================

/**
 * Get daily returns for a bot from cached equity curve
 */
async function getBotDailyReturns(botId, period = 'full') {
  const bot = await database.getBotById(botId, false)
  if (!bot) return null

  // Get cached backtest result if available
  const backtestCache = await import('../../db/cache.mjs')
  const cached = backtestCache.getCachedBacktest(botId)

  let equityCurve = null
  if (cached?.equityCurve) {
    equityCurve = cached.equityCurve
  } else if (bot.equityCurve) {
    // Try parsing from bot record
    try {
      equityCurve = typeof bot.equityCurve === 'string'
        ? JSON.parse(bot.equityCurve)
        : bot.equityCurve
    } catch { /* ignore */ }
  }

  if (!equityCurve || equityCurve.length < 2) return null

  // Calculate daily returns
  const dailyReturns = []
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1]
    const curr = equityCurve[i]
    const prevVal = typeof prev === 'object' ? prev.equity : prev
    const currVal = typeof curr === 'object' ? curr.equity : curr
    if (prevVal > 0) {
      dailyReturns.push((currVal - prevVal) / prevVal)
    }
  }

  // Apply period filter
  if (period !== 'full' && equityCurve.length > 0) {
    const firstDate = typeof equityCurve[0] === 'object' ? equityCurve[0].date : null
    if (firstDate) {
      const now = new Date()
      let cutoffDate
      switch (period) {
        case '1y': cutoffDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()); break
        case '3y': cutoffDate = new Date(now.getFullYear() - 3, now.getMonth(), now.getDate()); break
        case '5y': cutoffDate = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate()); break
        default: cutoffDate = null
      }

      if (cutoffDate) {
        const cutoffStr = cutoffDate.toISOString().slice(0, 10)
        const startIdx = equityCurve.findIndex(e =>
          (typeof e === 'object' ? e.date : '') >= cutoffStr
        )
        if (startIdx > 0 && startIdx < dailyReturns.length) {
          return { dailyReturns: dailyReturns.slice(startIdx), metrics: bot.metrics }
        }
      }
    }
  }

  return { dailyReturns, metrics: bot.metrics }
}

// ============================================================================
// Correlation Endpoints
// ============================================================================

const optimizeSchema = {
  body: z.object({
    botIds: z.array(z.string()).min(2).max(50),
    metric: z.enum(['correlation', 'volatility', 'sharpe', 'beta']).default('correlation'),
    period: z.enum(['full', '1y', '3y', '5y']).default('full'),
    maxWeight: z.number().min(0.1).max(1).default(0.4),
  }),
}

/**
 * POST /api/correlation/optimize - Compute optimal portfolio weights
 */
router.post('/optimize', validate(optimizeSchema), asyncHandler(async (req, res) => {
  await ensureDbInitialized()
  const { botIds, metric, period, maxWeight } = req.body

  // Get daily returns for all bots
  const botReturns = []
  const validBotIds = []
  const botMetrics = []

  for (const botId of botIds) {
    const data = await getBotDailyReturns(botId, period)
    if (data && data.dailyReturns.length >= 50) {
      botReturns.push(data.dailyReturns)
      validBotIds.push(botId)
      botMetrics.push(data.metrics || {})
    }
  }

  if (validBotIds.length < 2) {
    return res.status(400).json({ error: 'Not enough bots with sufficient data' })
  }

  // Align returns by length from end
  const minLen = Math.min(...botReturns.map(r => r.length))
  const alignedReturns = botReturns.map(r => r.slice(r.length - minLen))

  // Compute correlation matrix
  const n = alignedReturns.length
  const correlationMatrix = []
  for (let i = 0; i < n; i++) {
    const row = []
    for (let j = 0; j < n; j++) {
      row.push(pearsonCorrelation(alignedReturns[i], alignedReturns[j]))
    }
    correlationMatrix.push(row)
  }

  // Compute covariance matrix
  const means = alignedReturns.map(r => r.reduce((a, b) => a + b, 0) / r.length)
  const covMatrix = []
  for (let i = 0; i < n; i++) {
    const row = []
    for (let j = 0; j < n; j++) {
      let cov = 0
      for (let k = 0; k < minLen; k++) {
        cov += (alignedReturns[i][k] - means[i]) * (alignedReturns[j][k] - means[j])
      }
      row.push(cov / (minLen - 1))
    }
    covMatrix.push(row)
  }

  // Simple optimization based on metric
  let weights = new Array(n).fill(1 / n)

  if (metric === 'volatility') {
    const variances = covMatrix.map((row, i) => row[i])
    const invVar = variances.map(v => v > 0 ? 1 / v : 0)
    const sumInvVar = invVar.reduce((a, b) => a + b, 0)
    if (sumInvVar > 0) weights = invVar.map(v => v / sumInvVar)
  } else if (metric === 'sharpe') {
    const sharpes = botMetrics.map(m => m?.sharpeRatio ?? m?.sharpe ?? 0)
    const posSharpes = sharpes.map(s => Math.max(0.01, s))
    const sumSharpe = posSharpes.reduce((a, b) => a + b, 0)
    if (sumSharpe > 0) weights = posSharpes.map(s => s / sumSharpe)
  } else if (metric === 'correlation') {
    const avgCorr = correlationMatrix.map((row, i) => {
      const others = row.filter((_, j) => j !== i)
      return others.reduce((a, b) => a + Math.abs(b), 0) / others.length
    })
    const invCorr = avgCorr.map(c => 1 / (0.1 + c))
    const sumInvCorr = invCorr.reduce((a, b) => a + b, 0)
    weights = invCorr.map(c => c / sumInvCorr)
  } else if (metric === 'beta') {
    const betas = botMetrics.map(m => Math.abs(m?.beta ?? 1))
    const invBeta = betas.map(b => 1 / Math.max(0.1, b))
    const sumInvBeta = invBeta.reduce((a, b) => a + b, 0)
    if (sumInvBeta > 0) weights = invBeta.map(b => b / sumInvBeta)
  }

  // Apply max weight constraint
  const cappedMaxWeight = Math.min(1, Math.max(0.1, maxWeight))
  let iterations = 0
  while (iterations < 100) {
    let excess = 0
    let belowCapCount = 0
    for (let i = 0; i < weights.length; i++) {
      if (weights[i] > cappedMaxWeight) {
        excess += weights[i] - cappedMaxWeight
        weights[i] = cappedMaxWeight
      } else {
        belowCapCount++
      }
    }
    if (excess < 0.0001 || belowCapCount === 0) break
    const redistribute = excess / belowCapCount
    for (let i = 0; i < weights.length; i++) {
      if (weights[i] < cappedMaxWeight) weights[i] += redistribute
    }
    iterations++
  }

  // Normalize weights
  const sumWeights = weights.reduce((a, b) => a + b, 0)
  weights = weights.map(w => w / sumWeights)

  // Compute portfolio metrics
  const portfolioReturns = []
  for (let k = 0; k < minLen; k++) {
    let ret = 0
    for (let i = 0; i < n; i++) ret += weights[i] * alignedReturns[i][k]
    portfolioReturns.push(ret)
  }

  const avgReturn = portfolioReturns.reduce((a, b) => a + b, 0) / portfolioReturns.length
  const variance = portfolioReturns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / (portfolioReturns.length - 1)
  const volatility = Math.sqrt(variance) * Math.sqrt(252)
  const cagr = avgReturn * 252
  const sharpe = volatility > 0 ? cagr / volatility : 0

  // Max drawdown
  let peak = 1, maxDd = 0, equity = 1
  for (const r of portfolioReturns) {
    equity *= (1 + r)
    if (equity > peak) peak = equity
    const dd = (peak - equity) / peak
    if (dd > maxDd) maxDd = dd
  }

  logger.info('Portfolio optimization', { validBotIds, metric, period })

  res.json({
    validBotIds,
    weights,
    correlationMatrix,
    portfolioMetrics: {
      cagr,
      volatility,
      sharpe,
      maxDrawdown: maxDd,
    }
  })
}))

const recommendSchema = {
  body: z.object({
    currentBotIds: z.array(z.string()).default([]),
    candidateBotIds: z.array(z.string()).min(1).max(100),
    metric: z.enum(['correlation', 'volatility', 'sharpe']).default('correlation'),
    period: z.enum(['full', '1y', '3y', '5y']).default('full'),
    limit: z.number().int().min(1).max(20).default(3),
  }),
}

/**
 * POST /api/correlation/recommend - Get bot recommendations for portfolio diversification
 */
router.post('/recommend', validate(recommendSchema), asyncHandler(async (req, res) => {
  await ensureDbInitialized()
  const { currentBotIds, candidateBotIds, metric, period, limit } = req.body

  if (candidateBotIds.length === 0) {
    return res.json({ recommendations: [] })
  }

  // Get returns for current portfolio
  const currentReturns = []
  for (const botId of currentBotIds) {
    const data = await getBotDailyReturns(botId, period)
    if (data && data.dailyReturns.length >= 50) {
      currentReturns.push(data.dailyReturns)
    }
  }

  // Score each candidate
  const scores = []
  for (const botId of candidateBotIds) {
    const data = await getBotDailyReturns(botId, period)
    if (!data || data.dailyReturns.length < 50) continue

    let score = 0
    if (currentReturns.length === 0) {
      // No current portfolio - score by Sharpe
      score = data.metrics?.sharpe ?? 0
    } else {
      // Score by average inverse correlation with current bots
      let totalCorr = 0
      for (const currRet of currentReturns) {
        const minLen = Math.min(currRet.length, data.dailyReturns.length)
        const aligned1 = currRet.slice(-minLen)
        const aligned2 = data.dailyReturns.slice(-minLen)
        totalCorr += Math.abs(pearsonCorrelation(aligned1, aligned2))
      }
      const avgCorr = totalCorr / currentReturns.length
      score = 1 - avgCorr // Lower correlation = higher score
    }

    scores.push({ botId, score, metrics: data.metrics })
  }

  // Sort and take top N
  scores.sort((a, b) => b.score - a.score)
  const recommendations = scores.slice(0, limit)

  res.json({ recommendations })
}))

export default router
