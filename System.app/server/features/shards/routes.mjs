// server/features/shards/routes.mjs
// Saved Shards CRUD routes

import express from 'express'
import { z } from 'zod'
import * as database from '../../db/index.mjs'
import { asyncHandler } from '../../middleware/errorHandler.mjs'
import { validate } from '../../middleware/validation.mjs'
import { createLogger } from '../../lib/logger.mjs'

const router = express.Router()
const logger = createLogger('shards')

// ============================================================================
// Shard CRUD Operations
// ============================================================================

const listShardsSchema = {
  query: z.object({
    userId: z.string().min(1),
  }),
}

/**
 * GET /api/shards - List saved shards for a user
 */
router.get('/', validate(listShardsSchema), asyncHandler(async (req, res) => {
  const shards = await database.getShardsByUser(req.query.userId)
  res.json({ shards })
}))

const listAllShardsSchema = {
  query: z.object({
    adminKey: z.string().optional(), // Simple admin check for now
  }),
}

/**
 * GET /api/shards/admin/all - List all shards (admin only)
 */
router.get('/admin/all', validate(listAllShardsSchema), asyncHandler(async (req, res) => {
  // In production, verify admin role via auth middleware
  // For now, this endpoint exists for admin dashboard access
  const shards = await database.getAllShards()
  res.json({ shards })
}))

const getShardSchema = {
  params: z.object({
    id: z.string().min(1),
  }),
  query: z.object({
    userId: z.string().min(1),
  }),
}

/**
 * GET /api/shards/:id - Get a single shard with full branch data
 */
router.get('/:id', validate(getShardSchema), asyncHandler(async (req, res) => {
  const shard = await database.getShardById(req.params.id, req.query.userId)

  if (!shard) {
    return res.status(404).json({ error: 'Shard not found' })
  }

  res.json({ shard })
}))

const createShardSchema = {
  body: z.object({
    ownerId: z.string().min(1),
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    sourceJobIds: z.array(z.number()),
    loadedJobType: z.enum(['chronological', 'rolling']),
    branches: z.array(z.object({}).passthrough()), // Full branch objects
    filterSummary: z.string().max(200).optional(),
  }),
}

/**
 * POST /api/shards - Create a new saved shard
 */
router.post('/', validate(createShardSchema), asyncHandler(async (req, res) => {
  const { ownerId, name, description, sourceJobIds, loadedJobType, branches, filterSummary } = req.body

  try {
    const id = await database.createShard({
      ownerId,
      name,
      description,
      sourceJobIds,
      loadedJobType,
      branches,
      branchCount: branches.length,
      filterSummary,
    })

    logger.info('Shard created', { id, ownerId, name, branchCount: branches.length })
    res.json({ id })
  } catch (err) {
    // Handle foreign key constraint errors (user doesn't exist)
    if (err.message && err.message.includes('FOREIGN KEY constraint failed')) {
      logger.error('Foreign key constraint failed when creating shard', { ownerId, name })
      return res.status(400).json({
        error: 'User account not found. Please log in again.',
        code: 'USER_NOT_FOUND'
      })
    }
    // Re-throw other errors to be handled by global error handler
    throw err
  }
}))

const updateShardSchema = {
  params: z.object({
    id: z.string().min(1),
  }),
  body: z.object({
    ownerId: z.string().min(1),
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
  }),
}

/**
 * PUT /api/shards/:id - Update a shard (name/description only)
 */
router.put('/:id', validate(updateShardSchema), asyncHandler(async (req, res) => {
  const { ownerId, name, description } = req.body

  const result = await database.updateShard(req.params.id, ownerId, {
    name,
    description,
  })

  if (!result) {
    return res.status(404).json({ error: 'Shard not found or not owned by user' })
  }

  logger.info('Shard updated', { id: req.params.id, ownerId })
  res.json({ success: true })
}))

const deleteShardSchema = {
  params: z.object({
    id: z.string().min(1),
  }),
  query: z.object({
    ownerId: z.string().min(1),
  }),
}

/**
 * DELETE /api/shards/:id - Delete a shard (soft delete)
 */
router.delete('/:id', validate(deleteShardSchema), asyncHandler(async (req, res) => {
  const result = await database.deleteShard(req.params.id, req.query.ownerId)

  if (!result) {
    return res.status(404).json({ error: 'Shard not found or not owned by user' })
  }

  logger.info('Shard deleted', { id: req.params.id, ownerId: req.query.ownerId })
  res.json({ success: true })
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
 * GET /api/shards/trash - Get deleted shards for trash view
 */
router.get('/trash', validate(trashQuerySchema), asyncHandler(async (req, res) => {
  const deletedShards = await database.getDeletedShardsByUser(req.query.userId)
  res.json({ shards: deletedShards })
}))

const restoreShardSchema = {
  params: z.object({
    id: z.string().min(1),
  }),
  query: z.object({
    ownerId: z.string().min(1),
  }),
}

/**
 * POST /api/shards/:id/restore - Restore a deleted shard
 */
router.post('/:id/restore', validate(restoreShardSchema), asyncHandler(async (req, res) => {
  const result = await database.restoreShard(req.params.id, req.query.ownerId)

  if (!result) {
    return res.status(404).json({ error: 'Shard not found in trash or not owned by user' })
  }

  logger.info('Shard restored from trash', { id: req.params.id, ownerId: req.query.ownerId })
  res.json({ success: true })
}))

const permanentDeleteShardSchema = {
  params: z.object({
    id: z.string().min(1),
  }),
  query: z.object({
    ownerId: z.string().min(1),
  }),
}

/**
 * DELETE /api/shards/:id/permanent - Permanently delete a shard from trash
 */
router.delete('/:id/permanent', validate(permanentDeleteShardSchema), asyncHandler(async (req, res) => {
  const result = await database.permanentlyDeleteShard(req.params.id, req.query.ownerId)

  if (!result) {
    return res.status(404).json({ error: 'Shard not found in trash or not owned by user' })
  }

  logger.info('Shard permanently deleted', { id: req.params.id, ownerId: req.query.ownerId })
  res.json({ success: true })
}))

export default router
