// server/features/bots/routes.mjs
// Bot CRUD routes

import express from 'express'
import { z } from 'zod'
import * as database from '../../db/index.mjs'
import { asyncHandler } from '../../middleware/errorHandler.mjs'
import { validate } from '../../middleware/validation.mjs'
import { createLogger } from '../../lib/logger.mjs'

const router = express.Router()
const logger = createLogger('bots')

// Database initialization state
let dbInitialized = false

async function ensureDbInitialized() {
  if (!dbInitialized) {
    database.initializeDatabase()
    await database.migratePasswordsToBcrypt()
    dbInitialized = true
  }
}

// ============================================================================
// Bot CRUD Operations
// ============================================================================

const listBotsSchema = {
  query: z.object({
    userId: z.string().min(1),
  }),
}

/**
 * GET /api/bots - List bots for a user
 */
router.get('/', validate(listBotsSchema), asyncHandler(async (req, res) => {
  await ensureDbInitialized()
  const bots = await database.getBotsByOwner(req.query.userId)
  res.json({ bots })
}))

const getBotSchema = {
  params: z.object({
    id: z.string().min(1),
  }),
  query: z.object({
    userId: z.string().optional(),
  }),
}

/**
 * GET /api/bots/:id - Get a single bot
 */
router.get('/:id', validate(getBotSchema), asyncHandler(async (req, res) => {
  await ensureDbInitialized()
  const userId = req.query.userId
  const bot = await database.getBotById(req.params.id, true)

  if (!bot) {
    return res.status(404).json({ error: 'Bot not found' })
  }

  // Only return payload if user owns the bot
  if (bot.ownerId !== userId && bot.visibility === 'nexus') {
    const { payload, ...publicBot } = bot
    return res.json({ bot: publicBot })
  }

  res.json({ bot })
}))

const createBotSchema = {
  body: z.object({
    ownerId: z.string().min(1),
    name: z.string().min(1).max(100),
    payload: z.union([z.string(), z.object({}).passthrough()]),
    visibility: z.enum(['private', 'nexus']).optional(),
    tags: z.array(z.string()).optional(),
    fundSlot: z.string().optional(),
    id: z.string().optional(), // Client-provided ID
  }),
}

/**
 * POST /api/bots - Create a new bot
 */
router.post('/', validate(createBotSchema), asyncHandler(async (req, res) => {
  await ensureDbInitialized()
  const { ownerId, name, payload, visibility, tags, fundSlot, id: clientId } = req.body

  const id = await database.createBot({
    id: clientId,
    ownerId,
    name,
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    visibility,
    tags,
    fundSlot,
  })

  logger.info('Bot created', { id, ownerId, name })
  res.json({ id })
}))

const updateBotSchema = {
  params: z.object({
    id: z.string().min(1),
  }),
  body: z.object({
    ownerId: z.string().min(1),
    name: z.string().min(1).max(100).optional(),
    payload: z.union([z.string(), z.object({}).passthrough()]).optional(),
    visibility: z.enum(['private', 'nexus']).optional(),
    tags: z.array(z.string()).optional(),
    fundSlot: z.string().optional(),
  }),
}

/**
 * PUT /api/bots/:id - Update a bot
 */
router.put('/:id', validate(updateBotSchema), asyncHandler(async (req, res) => {
  await ensureDbInitialized()
  const { ownerId, name, payload, visibility, tags, fundSlot } = req.body

  const result = await database.updateBot(req.params.id, ownerId, {
    name,
    payload: payload ? (typeof payload === 'string' ? payload : JSON.stringify(payload)) : undefined,
    visibility,
    tags,
    fundSlot,
  })

  if (!result) {
    return res.status(404).json({ error: 'Bot not found or not owned by user' })
  }

  logger.info('Bot updated', { id: req.params.id, ownerId })
  res.json({ success: true })
}))

const deleteBotSchema = {
  params: z.object({
    id: z.string().min(1),
  }),
  query: z.object({
    ownerId: z.string().min(1),
  }),
}

/**
 * DELETE /api/bots/:id - Delete a bot (soft delete)
 */
router.delete('/:id', validate(deleteBotSchema), asyncHandler(async (req, res) => {
  await ensureDbInitialized()
  const result = await database.deleteBot(req.params.id, req.query.ownerId)

  if (!result) {
    return res.status(404).json({ error: 'Bot not found or not owned by user' })
  }

  logger.info('Bot deleted', { id: req.params.id, ownerId: req.query.ownerId })
  res.json({ success: true })
}))

const updateMetricsSchema = {
  params: z.object({
    id: z.string().min(1),
  }),
  body: z.object({
    cagr: z.number().optional(),
    maxDrawdown: z.number().optional(),
    sharpe: z.number().optional(),
    calmar: z.number().optional(),
    volatility: z.number().optional(),
    winRate: z.number().optional(),
    sortinoRatio: z.number().optional(),
  }).passthrough(),
}

/**
 * PUT /api/bots/:id/metrics - Update bot metrics after backtest
 */
router.put('/:id/metrics', validate(updateMetricsSchema), asyncHandler(async (req, res) => {
  await ensureDbInitialized()
  await database.updateBotMetrics(req.params.id, req.body)
  res.json({ success: true })
}))

/**
 * GET /api/bots/:id/metrics - Get bot metrics
 */
router.get('/:id/metrics', asyncHandler(async (req, res) => {
  await ensureDbInitialized()
  const bot = await database.getBotById(req.params.id, false)

  if (!bot) {
    return res.status(404).json({ error: 'Bot not found' })
  }

  res.json({
    botId: bot.id,
    name: bot.name,
    metrics: {
      cagr: bot.cagr,
      maxDrawdown: bot.maxDrawdown,
      sharpe: bot.sharpe,
      calmar: bot.calmar,
      volatility: bot.volatility,
      winRate: bot.winRate,
      sortinoRatio: bot.sortinoRatio,
    }
  })
}))

// Re-export ensureDbInitialized for use by other features
export { ensureDbInitialized }
export default router
