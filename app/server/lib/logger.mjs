// server/lib/logger.mjs
// Structured logging utility

import { isProduction } from './config.mjs'

/**
 * Log levels with numeric priority
 */
const LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

// Default log level (debug in dev, info in prod)
const minLevel = LEVELS[process.env.LOG_LEVEL] ?? (isProduction ? LEVELS.info : LEVELS.debug)

/**
 * Format log message with timestamp and context
 */
function formatLog(level, context, message, data) {
  const timestamp = new Date().toISOString()
  const prefix = context ? `[${context}]` : ''

  if (isProduction) {
    // JSON format for production (easier to parse in log aggregators)
    return JSON.stringify({
      timestamp,
      level,
      context,
      message,
      ...data
    })
  }

  // Human-readable format for development
  const dataStr = data && Object.keys(data).length > 0
    ? ` ${JSON.stringify(data)}`
    : ''
  return `${timestamp} ${level.toUpperCase().padEnd(5)} ${prefix} ${message}${dataStr}`
}

/**
 * Create a logger instance with optional context
 */
export function createLogger(context = '') {
  return {
    debug(message, data = {}) {
      if (LEVELS.debug >= minLevel) {
        console.debug(formatLog('debug', context, message, data))
      }
    },

    info(message, data = {}) {
      if (LEVELS.info >= minLevel) {
        console.info(formatLog('info', context, message, data))
      }
    },

    warn(message, data = {}) {
      if (LEVELS.warn >= minLevel) {
        console.warn(formatLog('warn', context, message, data))
      }
    },

    error(message, data = {}) {
      if (LEVELS.error >= minLevel) {
        // Include stack trace if error object is provided
        if (data.error instanceof Error) {
          data.stack = data.error.stack
          data.errorMessage = data.error.message
        }
        console.error(formatLog('error', context, message, data))
      }
    },

    /**
     * Create a child logger with additional context
     */
    child(childContext) {
      return createLogger(`${context}:${childContext}`)
    }
  }
}

// Default logger
export const logger = createLogger('api')

export default logger
