// server/middleware/errorHandler.mjs
// Global error handling middleware

import { createLogger } from '../lib/logger.mjs'
import { isProduction } from '../lib/config.mjs'

const logger = createLogger('error')

/**
 * Custom API error class with status code
 */
export class ApiError extends Error {
  constructor(message, statusCode = 500, code = null) {
    super(message)
    this.statusCode = statusCode
    this.code = code
    this.name = 'ApiError'
  }

  static badRequest(message, code = 'BAD_REQUEST') {
    return new ApiError(message, 400, code)
  }

  static unauthorized(message = 'Authentication required', code = 'UNAUTHORIZED') {
    return new ApiError(message, 401, code)
  }

  static forbidden(message = 'Access denied', code = 'FORBIDDEN') {
    return new ApiError(message, 403, code)
  }

  static notFound(message = 'Resource not found', code = 'NOT_FOUND') {
    return new ApiError(message, 404, code)
  }

  static conflict(message, code = 'CONFLICT') {
    return new ApiError(message, 409, code)
  }

  static tooManyRequests(message = 'Too many requests', code = 'RATE_LIMITED') {
    return new ApiError(message, 429, code)
  }

  static internal(message = 'Internal server error', code = 'INTERNAL_ERROR') {
    return new ApiError(message, 500, code)
  }
}

/**
 * Async route handler wrapper - catches async errors automatically
 * Usage: app.get('/route', asyncHandler(async (req, res) => { ... }))
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

/**
 * Global error handler middleware
 * Must be registered LAST in the middleware chain
 */
export function errorHandler(err, req, res, _next) {
  // Default to 500 for unknown errors
  const statusCode = err.statusCode || 500
  const code = err.code || 'INTERNAL_ERROR'

  // Log error details
  logger.error('Request failed', {
    method: req.method,
    path: req.path,
    statusCode,
    code,
    message: err.message,
    stack: isProduction ? undefined : err.stack,
    userId: req.user?.id,
  })

  // Don't leak internal error details in production
  const message = statusCode >= 500 && isProduction
    ? 'Internal server error'
    : err.message

  res.status(statusCode).json({
    error: message,
    code,
    ...(isProduction ? {} : { stack: err.stack })
  })
}

/**
 * 404 handler for unknown routes
 */
export function notFoundHandler(req, res) {
  res.status(404).json({
    error: `Route not found: ${req.method} ${req.path}`,
    code: 'NOT_FOUND'
  })
}

export default errorHandler
