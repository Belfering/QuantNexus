// server/middleware/validation.mjs
// Request validation using Zod

import { z } from 'zod'
import { ApiError } from './errorHandler.mjs'

/**
 * Create a validation middleware from a Zod schema
 *
 * @param {object} schemas - Schemas for body, query, and/or params
 * @param {z.ZodSchema} schemas.body - Schema for request body
 * @param {z.ZodSchema} schemas.query - Schema for query parameters
 * @param {z.ZodSchema} schemas.params - Schema for URL parameters
 * @returns {function} Express middleware
 *
 * @example
 * const createBotSchema = {
 *   body: z.object({
 *     name: z.string().min(1).max(100),
 *     payload: z.object({}).passthrough()
 *   })
 * }
 * router.post('/bots', validate(createBotSchema), asyncHandler(createBot))
 */
export function validate(schemas) {
  return (req, _res, next) => {
    try {
      // Validate body
      if (schemas.body) {
        const result = schemas.body.safeParse(req.body)
        if (!result.success) {
          throw ApiError.badRequest(formatZodErrors(result.error), 'VALIDATION_ERROR')
        }
        req.body = result.data
      }

      // Validate query
      if (schemas.query) {
        const result = schemas.query.safeParse(req.query)
        if (!result.success) {
          throw ApiError.badRequest(formatZodErrors(result.error), 'VALIDATION_ERROR')
        }
        req.query = result.data
      }

      // Validate params
      if (schemas.params) {
        const result = schemas.params.safeParse(req.params)
        if (!result.success) {
          throw ApiError.badRequest(formatZodErrors(result.error), 'VALIDATION_ERROR')
        }
        req.params = result.data
      }

      next()
    } catch (err) {
      next(err)
    }
  }
}

/**
 * Format Zod errors into a readable message
 */
function formatZodErrors(error) {
  const messages = error.errors.map(err => {
    const path = err.path.join('.')
    return path ? `${path}: ${err.message}` : err.message
  })
  return messages.join(', ')
}

// Common schema building blocks
export const schemas = {
  // Common ID formats
  uuid: z.string().uuid(),
  id: z.string().min(1).max(100),

  // Pagination
  pagination: z.object({
    limit: z.coerce.number().int().positive().max(100).default(20),
    offset: z.coerce.number().int().nonnegative().default(0),
  }),

  // Common fields
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(50).optional(),
  ticker: z.string().min(1).max(10).toUpperCase(),
}

// Re-export Zod for convenience
export { z }
