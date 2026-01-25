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
    isDraft: z.boolean().optional(), // Support draft bots for auto-save
  }),
}

/**
 * POST /api/bots - Create a new bot
 */
router.post('/', validate(createBotSchema), asyncHandler(async (req, res) => {
  await ensureDbInitialized()
  const { ownerId, name, payload, visibility, tags, fundSlot, id: clientId, isDraft } = req.body

  const id = await database.createBot({
    id: clientId,
    ownerId,
    name,
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    visibility,
    tags,
    fundSlot,
    isDraft, // Include draft flag for auto-save
  })

  logger.info('Bot created', { id, ownerId, name, isDraft: isDraft || false })
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
    isDraft: z.boolean().optional(), // Support draft bots for auto-save
  }),
}

/**
 * PUT /api/bots/:id - Update a bot
 */
router.put('/:id', validate(updateBotSchema), asyncHandler(async (req, res) => {
  await ensureDbInitialized()
  const { ownerId, name, payload, visibility, tags, fundSlot, isDraft } = req.body

  const result = await database.updateBot(req.params.id, ownerId, {
    name,
    isDraft, // Include draft flag
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
    hardDelete: z.enum(['true', 'false']).optional(),
  }),
}

/**
 * DELETE /api/bots/:id - Delete a bot (soft or hard depending on hardDelete param)
 */
router.delete('/:id', validate(deleteBotSchema), asyncHandler(async (req, res) => {
  await ensureDbInitialized()

  const { id } = req.params
  const { ownerId, hardDelete } = req.query

  let result
  try {
    if (hardDelete === 'true') {
      // Hard delete (for Nexus/Atlas bots)
      result = await database.hardDeleteBot(id, ownerId)
    } else {
      // Soft delete (for user-created bots)
      result = await database.deleteBot(id, ownerId)
    }
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }

  if (!result) {
    return res.status(404).json({ error: 'Bot not found or not owned by user' })
  }

  logger.info('Bot deleted', {
    id,
    ownerId,
    type: hardDelete === 'true' ? 'hard' : 'soft'
  })
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

// ============================================
// TRASH OPERATIONS
// ============================================

const trashQuerySchema = {
  query: z.object({
    userId: z.string().min(1),
  }),
}

/**
 * GET /api/bots/trash - Get deleted bots for trash view
 */
router.get('/trash', validate(trashQuerySchema), asyncHandler(async (req, res) => {
  await ensureDbInitialized()
  const deletedBots = await database.getDeletedBotsByOwner(req.query.userId)
  res.json({ bots: deletedBots })
}))

const restoreBotSchema = {
  params: z.object({
    id: z.string().min(1),
  }),
  query: z.object({
    ownerId: z.string().min(1),
  }),
}

/**
 * POST /api/bots/:id/restore - Restore a deleted bot
 */
router.post('/:id/restore', validate(restoreBotSchema), asyncHandler(async (req, res) => {
  await ensureDbInitialized()
  const result = await database.restoreBot(req.params.id, req.query.ownerId)

  if (!result) {
    return res.status(404).json({ error: 'Bot not found in trash or not owned by user' })
  }

  logger.info('Bot restored from trash', { id: req.params.id, ownerId: req.query.ownerId })
  res.json({ success: true })
}))

const permanentDeleteBotSchema = {
  params: z.object({
    id: z.string().min(1),
  }),
  query: z.object({
    ownerId: z.string().min(1),
  }),
}

/**
 * DELETE /api/bots/:id/permanent - Permanently delete a bot from trash
 */
router.delete('/:id/permanent', validate(permanentDeleteBotSchema), asyncHandler(async (req, res) => {
  await ensureDbInitialized()
  const result = await database.permanentlyDeleteBot(req.params.id, req.query.ownerId)

  if (!result) {
    return res.status(404).json({ error: 'Bot not found in trash or not owned by user' })
  }

  logger.info('Bot permanently deleted', { id: req.params.id, ownerId: req.query.ownerId })
  res.json({ success: true })
}))

// Re-export ensureDbInitialized for use by other features
export { ensureDbInitialized }
export default router
