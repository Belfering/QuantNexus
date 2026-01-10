// server/lib/redis.mjs
// Redis client wrapper with graceful fallback

import { REDIS_URL } from './config.mjs'

let redis = null
let isConnected = false

/**
 * Get the Redis client instance
 * Lazily initializes the connection on first call
 * @returns {import('ioredis').Redis | null}
 */
export async function getRedisClient() {
  if (!REDIS_URL) return null

  if (!redis) {
    // Dynamic import to avoid issues when ioredis isn't installed
    const { default: Redis } = await import('ioredis')

    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        // Exponential backoff with max 30 seconds
        const delay = Math.min(times * 100, 30000)
        return delay
      },
      lazyConnect: true,
    })

    redis.on('connect', () => {
      isConnected = true
      console.log('[redis] Connected')
    })

    redis.on('ready', () => {
      isConnected = true
      console.log('[redis] Ready')
    })

    redis.on('error', (err) => {
      isConnected = false
      console.error('[redis] Connection error:', err.message)
    })

    redis.on('close', () => {
      isConnected = false
      console.log('[redis] Connection closed')
    })

    // Attempt initial connection
    try {
      await redis.connect()
    } catch (err) {
      console.error('[redis] Initial connection failed:', err.message)
      isConnected = false
    }
  }

  return redis
}

/**
 * Check if Redis is currently available
 */
export function isRedisAvailable() {
  return isConnected && redis !== null
}

/**
 * Initialize Redis connection (call at server startup)
 */
export async function initRedis() {
  if (!REDIS_URL) {
    console.log('[redis] No REDIS_URL configured, using SQLite cache only')
    return false
  }

  await getRedisClient()
  return isRedisAvailable()
}

/**
 * Get value from Redis with graceful fallback
 * @param {string} key - Cache key
 * @returns {Promise<any>} Parsed JSON value or null
 */
export async function redisGet(key) {
  if (!isConnected || !redis) return null

  try {
    const data = await redis.get(key)
    return data ? JSON.parse(data) : null
  } catch (e) {
    console.error('[redis] GET error:', e.message)
    return null
  }
}

/**
 * Set value in Redis with TTL
 * @param {string} key - Cache key
 * @param {any} value - Value to store (will be JSON stringified)
 * @param {number} ttlSeconds - Time to live in seconds (default: 24h)
 * @returns {Promise<boolean>} Success status
 */
export async function redisSet(key, value, ttlSeconds = 86400) {
  if (!isConnected || !redis) return false

  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds)
    return true
  } catch (e) {
    console.error('[redis] SET error:', e.message)
    return false
  }
}

/**
 * Delete keys matching a pattern
 * @param {string} pattern - Key pattern (e.g., 'candles:*')
 * @returns {Promise<number>} Number of deleted keys
 */
export async function redisDelete(pattern) {
  if (!isConnected || !redis) return 0

  try {
    const keys = await redis.keys(pattern)
    if (keys.length > 0) {
      return await redis.del(...keys)
    }
    return 0
  } catch (e) {
    console.error('[redis] DELETE error:', e.message)
    return 0
  }
}

/**
 * Get multiple values from Redis
 * @param {string[]} keys - Array of keys
 * @returns {Promise<Map<string, any>>} Map of key -> value
 */
export async function redisGetMulti(keys) {
  if (!isConnected || !redis || keys.length === 0) return new Map()

  try {
    const values = await redis.mget(...keys)
    const result = new Map()

    keys.forEach((key, i) => {
      if (values[i]) {
        try {
          result.set(key, JSON.parse(values[i]))
        } catch {
          // Skip unparseable values
        }
      }
    })

    return result
  } catch (e) {
    console.error('[redis] MGET error:', e.message)
    return new Map()
  }
}

/**
 * Set multiple values in Redis
 * @param {Array<{key: string, value: any, ttl?: number}>} items - Items to set
 * @returns {Promise<number>} Number of successfully set items
 */
export async function redisSetMulti(items) {
  if (!isConnected || !redis || items.length === 0) return 0

  let count = 0
  try {
    const pipeline = redis.pipeline()

    for (const { key, value, ttl = 86400 } of items) {
      pipeline.set(key, JSON.stringify(value), 'EX', ttl)
    }

    const results = await pipeline.exec()
    count = results.filter(([err]) => !err).length
  } catch (e) {
    console.error('[redis] MSET error:', e.message)
  }

  return count
}

/**
 * Check if a key exists in Redis
 * @param {string} key - Cache key
 * @returns {Promise<boolean>}
 */
export async function redisExists(key) {
  if (!isConnected || !redis) return false

  try {
    return (await redis.exists(key)) === 1
  } catch (e) {
    console.error('[redis] EXISTS error:', e.message)
    return false
  }
}

/**
 * Get Redis cache statistics
 */
export async function getRedisStats() {
  if (!isConnected || !redis) {
    return {
      connected: false,
      url: REDIS_URL ? '(configured but not connected)' : '(not configured)',
    }
  }

  try {
    const info = await redis.info('memory')
    const keyCount = await redis.dbsize()

    // Parse memory info
    const usedMemoryMatch = info.match(/used_memory_human:(\S+)/)
    const peakMemoryMatch = info.match(/used_memory_peak_human:(\S+)/)

    return {
      connected: true,
      keyCount,
      usedMemory: usedMemoryMatch ? usedMemoryMatch[1] : 'unknown',
      peakMemory: peakMemoryMatch ? peakMemoryMatch[1] : 'unknown',
    }
  } catch (e) {
    console.error('[redis] Stats error:', e.message)
    return {
      connected: isConnected,
      error: e.message,
    }
  }
}

/**
 * Close Redis connection
 */
export async function closeRedis() {
  if (redis) {
    await redis.quit()
    redis = null
    isConnected = false
    console.log('[redis] Connection closed')
  }
}
