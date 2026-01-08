// server/features/watchlist/routes.mjs
// Watchlist management routes

import express from 'express'
import { z } from 'zod'
import * as database from '../../db/index.mjs'
import { asyncHandler } from '../../middleware/errorHandler.mjs'
import { validate } from '../../middleware/validation.mjs'
import { createLogger } from '../../lib/logger.mjs'
import { ensureDbInitialized } from '../bots/routes.mjs'

const router = express.Router()
const logger = createLogger('watchlist')

// ============================================================================
// Watchlist CRUD Operations
// ============================================================================

const listWatchlistsSchema = {
  query: z.object({
    userId: z.string().min(1),
  }),
}

/**
 * GET /api/watchlists - List watchlists for a user
 */
router.get('/', validate(listWatchlistsSchema), asyncHandler(async (req, res) => {
  await ensureDbInitialized()
  const watchlists = await database.getWatchlistsByOwner(req.query.userId)
  res.json({ watchlists })
}))

const createWatchlistSchema = {
  body: z.object({
    userId: z.string().min(1),
    name: z.string().min(1).max(100),
  }),
}

/**
 * POST /api/watchlists - Create a new watchlist
 */
router.post('/', validate(createWatchlistSchema), asyncHandler(async (req, res) => {
  await ensureDbInitialized()
  const { userId, name } = req.body
  const watchlist = await database.createWatchlist(userId, name)
  logger.info('Watchlist created', { id: watchlist.id, userId, name })
  res.json({ watchlist })
}))

const updateWatchlistSchema = {
  params: z.object({
    id: z.string().min(1),
  }),
  body: z.object({
    name: z.string().min(1).max(100),
  }),
}

/**
 * PUT /api/watchlists/:id - Update a watchlist
 */
router.put('/:id', validate(updateWatchlistSchema), asyncHandler(async (req, res) => {
  await ensureDbInitialized()
  await database.updateWatchlist(req.params.id, { name: req.body.name })
  res.json({ success: true })
}))

const deleteWatchlistSchema = {
  params: z.object({
    id: z.string().min(1),
  }),
}

/**
 * DELETE /api/watchlists/:id - Delete a watchlist
 */
router.delete('/:id', validate(deleteWatchlistSchema), asyncHandler(async (req, res) => {
  await ensureDbInitialized()
  await database.deleteWatchlist(req.params.id)
  logger.info('Watchlist deleted', { id: req.params.id })
  res.json({ success: true })
}))

// ============================================================================
// Watchlist Bot Management
// ============================================================================

const addBotSchema = {
  params: z.object({
    id: z.string().min(1),
  }),
  body: z.object({
    botId: z.string().min(1),
  }),
}

/**
 * POST /api/watchlists/:id/bots - Add a bot to a watchlist
 */
router.post('/:id/bots', validate(addBotSchema), asyncHandler(async (req, res) => {
  await ensureDbInitialized()
  const success = await database.addBotToWatchlist(req.params.id, req.body.botId)
  logger.info('Bot added to watchlist', { watchlistId: req.params.id, botId: req.body.botId })
  res.json({ success })
}))

const removeBotSchema = {
  params: z.object({
    id: z.string().min(1),
    botId: z.string().min(1),
  }),
}

/**
 * DELETE /api/watchlists/:id/bots/:botId - Remove a bot from a watchlist
 */
router.delete('/:id/bots/:botId', validate(removeBotSchema), asyncHandler(async (req, res) => {
  await ensureDbInitialized()
  const success = await database.removeBotFromWatchlist(req.params.id, req.params.botId)
  logger.info('Bot removed from watchlist', { watchlistId: req.params.id, botId: req.params.botId })
  res.json({ success })
}))

export default router
