/**
 * Scheduler Module
 *
 * Handles scheduled tasks like daily ticker data updates.
 * Default: 6:00 PM Eastern Time daily
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

// Schedule configuration (stored in adminConfig table)
const DEFAULT_SCHEDULE = {
  enabled: true,
  updateTime: '18:00',  // 6:00 PM in 24h format
  timezone: 'America/New_York',
  batchSize: 100,
  sleepSeconds: 2.0,
}

let schedulerInterval = null
let lastRunDate = null
let isRunning = false
let currentJob = null
let currentChildProcess = null

/**
 * Get current schedule config from database or use defaults
 */
export async function getScheduleConfig(database) {
  try {
    const { adminConfig } = await import('./db/schema.mjs')
    const { eq } = await import('drizzle-orm')

    const [row] = await database.db.select()
      .from(adminConfig)
      .where(eq(adminConfig.key, 'ticker_sync_schedule'))
      .limit(1)

    if (row?.value) {
      return { ...DEFAULT_SCHEDULE, ...JSON.parse(row.value) }
    }
  } catch (e) {
    console.log('[scheduler] Using default config:', e.message)
  }
  return { ...DEFAULT_SCHEDULE }
}

/**
 * Save schedule config to database
 */
export async function saveScheduleConfig(database, config) {
  try {
    const { adminConfig } = await import('./db/schema.mjs')

    await database.db.insert(adminConfig)
      .values({
        key: 'ticker_sync_schedule',
        value: JSON.stringify(config),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: adminConfig.key,
        set: {
          value: JSON.stringify(config),
          updatedAt: new Date(),
        },
      })

    return true
  } catch (e) {
    console.error('[scheduler] Error saving config:', e)
    return false
  }
}

/**
 * Get last sync info
 */
export async function getLastSyncInfo(database) {
  try {
    const { adminConfig } = await import('./db/schema.mjs')
    const { eq } = await import('drizzle-orm')

    const [row] = await database.db.select()
      .from(adminConfig)
      .where(eq(adminConfig.key, 'ticker_sync_last_run'))
      .limit(1)

    if (row?.value) {
      return JSON.parse(row.value)
    }
  } catch (e) {
    // Ignore errors
  }
  return null
}

/**
 * Save last sync info
 */
async function saveLastSyncInfo(database, info) {
  try {
    const { adminConfig } = await import('./db/schema.mjs')

    await database.db.insert(adminConfig)
      .values({
        key: 'ticker_sync_last_run',
        value: JSON.stringify(info),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: adminConfig.key,
        set: {
          value: JSON.stringify(info),
          updatedAt: new Date(),
        },
      })
  } catch (e) {
    console.error('[scheduler] Error saving last sync info:', e)
  }
}

/**
 * Check if today is a weekday (Mon-Fri)
 */
function isWeekday(timezone) {
  const now = new Date()
  const dayFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'America/New_York',
    weekday: 'short',
  })
  const dayOfWeek = dayFormatter.format(now)
  // Returns Mon, Tue, Wed, Thu, Fri, Sat, Sun
  return !['Sat', 'Sun'].includes(dayOfWeek)
}

/**
 * Check if it's time to run the scheduled sync
 */
function isTimeToRun(config) {
  if (!config.enabled) return false

  const timezone = config.timezone || 'America/New_York'

  // Only run on weekdays (Mon-Fri) - markets are closed on weekends
  if (!isWeekday(timezone)) {
    return false
  }

  // Get current time in the configured timezone
  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const currentTime = formatter.format(now)

  // Get current date in timezone
  const dateFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const currentDate = dateFormatter.format(now)

  // Check if current time matches scheduled time (within 1 minute window)
  const [schedHour, schedMinute] = config.updateTime.split(':').map(Number)
  const [curHour, curMinute] = currentTime.split(':').map(Number)

  const isRightTime = curHour === schedHour && curMinute === schedMinute
  const alreadyRanToday = lastRunDate === currentDate

  return isRightTime && !alreadyRanToday && !isRunning
}

/**
 * Run the ticker sync job
 * @param {Object} config - Schedule config
 * @param {string} tickerDataRoot - Path to ticker data root
 * @param {string} parquetDir - Path to parquet directory
 * @param {string} pythonCmd - Python command
 * @param {Object} database - Database instance
 * @param {Object} tickerRegistry - Ticker registry instance
 * @param {string} source - 'tiingo' or 'yfinance' (default: 'tiingo')
 */
async function runTickerSync(config, tickerDataRoot, parquetDir, pythonCmd, database, tickerRegistry, source = 'tiingo') {
  if (isRunning) {
    console.log('[scheduler] Sync already running, skipping')
    return
  }

  isRunning = true
  const startedAt = Date.now()
  const today = new Date().toISOString().slice(0, 10)

  // Set preliminary currentJob immediately so UI shows progress
  currentJob = {
    pid: null,
    startedAt,
    tickerCount: 0, // Will be updated once we know the count
    syncedCount: 0,
    stderrBuffer: '',
    phase: 'preparing', // Show user we're preparing
    source,
  }

  console.log('[scheduler] Starting scheduled ticker sync...')

  try {
    // Ensure ticker registry table exists
    await tickerRegistry.ensureTickerRegistryTable()

    // Get tickers needing sync
    const tickers = await tickerRegistry.getTickersNeedingSync(today)

    if (tickers.length === 0) {
      console.log('[scheduler] All tickers already synced for today')
      lastRunDate = new Intl.DateTimeFormat('en-US', {
        timeZone: config.timezone || 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date())

      await saveLastSyncInfo(database, {
        date: today,
        status: 'skipped',
        message: 'All tickers already synced',
        timestamp: new Date().toISOString(),
      })

      isRunning = false
      return
    }

    console.log(`[scheduler] Syncing ${tickers.length} tickers...`)

    // Write tickers to temp file
    const tempTickersPath = path.join(tickerDataRoot, '_pending_tickers.json')
    await fs.writeFile(tempTickersPath, JSON.stringify(tickers), 'utf-8')

    // Get tickers with existing metadata
    const tickersWithMetadata = await tickerRegistry.getTickersWithMetadata()
    const skipMetadataPath = path.join(tickerDataRoot, '_skip_metadata.json')
    await fs.writeFile(skipMetadataPath, JSON.stringify(tickersWithMetadata), 'utf-8')

    // Build script args based on source
    const scriptName = source === 'tiingo' ? 'tiingo_download.py' : 'download.py'
    const scriptPath = path.join(tickerDataRoot, scriptName)
    const args = [
      '-u',
      scriptPath,
      '--tickers-json',
      tempTickersPath,
      '--out-dir',
      parquetDir,
      '--batch-size',
      String(config.batchSize || 100),
      '--sleep-seconds',
      String(config.sleepSeconds || 2.0),
      '--max-retries',
      '3',
      '--skip-metadata-json',
      skipMetadataPath,
    ]

    // Add Tiingo API key from environment (only for tiingo source)
    if (source === 'tiingo') {
      const tiingoApiKey = process.env.TIINGO_API_KEY
      if (tiingoApiKey) {
        args.push('--api-key', tiingoApiKey)
      }
    }

    // Log the command being run for debugging
    console.log(`[scheduler] Running: ${pythonCmd} ${args.join(' ')}`)

    // Spawn the download process
    const child = spawn(pythonCmd, args, { windowsHide: true })
    currentChildProcess = child
    // Update currentJob with actual values now that we have them
    currentJob = {
      pid: child.pid,
      startedAt,
      tickerCount: tickers.length,
      syncedCount: 0,
      stderrBuffer: '',
      phase: 'downloading',
      source,
    }

    child.stdout.on('data', (buf) => {
      const output = String(buf)
      for (const line of output.split(/\r?\n/)) {
        const s = line.trimEnd()
        if (!s) continue
        console.log('[scheduler] stdout:', s)
        try {
          const ev = JSON.parse(s)
          if (ev?.type === 'ticker_saved' && ev.ticker) {
            currentJob.syncedCount++
            // Mark as synced
            tickerRegistry.markTickerSynced(ev.ticker, today).catch(() => {})
            // Update metadata
            if (ev.name || ev.description) {
              tickerRegistry.updateTickerMetadata(ev.ticker, {
                name: ev.name,
                description: ev.description,
              }).catch(() => {})
            }
          }
          if (ev?.type === 'done') {
            console.log(`[scheduler] Sync completed: ${ev.saved || 0} tickers saved`)
          }
        } catch {
          // Non-JSON output - already logged above
        }
      }
    })

    child.stderr.on('data', (buf) => {
      const output = String(buf).trim()
      console.log('[scheduler] stderr:', output)
      currentJob.stderrBuffer += output + '\n'
    })

    child.on('close', async (code) => {
      const finishedAt = Date.now()
      const duration = Math.round((finishedAt - startedAt) / 1000)

      if (code === 0) {
        console.log(`[scheduler] Sync completed successfully in ${duration}s`)
        await saveLastSyncInfo(database, {
          date: today,
          status: 'success',
          tickerCount: tickers.length,
          syncedCount: currentJob?.syncedCount || 0,
          durationSeconds: duration,
          timestamp: new Date().toISOString(),
        })
      } else {
        const stderrOutput = currentJob?.stderrBuffer || ''
        console.error(`[scheduler] Sync failed with code ${code}`)
        console.error(`[scheduler] stderr output:\n${stderrOutput}`)
        await saveLastSyncInfo(database, {
          date: today,
          status: 'error',
          error: `Process exited with code ${code}. stderr: ${stderrOutput.slice(0, 500)}`,
          tickerCount: tickers.length,
          syncedCount: currentJob?.syncedCount || 0,
          durationSeconds: duration,
          timestamp: new Date().toISOString(),
        })
      }

      // Update last run date
      lastRunDate = new Intl.DateTimeFormat('en-US', {
        timeZone: config.timezone || 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date())

      isRunning = false
      currentJob = null
      currentChildProcess = null
    })

    child.on('error', async (err) => {
      console.error('[scheduler] Process error:', err)
      await saveLastSyncInfo(database, {
        date: today,
        status: 'error',
        error: String(err?.message || err),
        timestamp: new Date().toISOString(),
      })
      isRunning = false
      currentJob = null
      currentChildProcess = null
    })

  } catch (e) {
    console.error('[scheduler] Error starting sync:', e)
    await saveLastSyncInfo(database, {
      date: today,
      status: 'error',
      error: String(e?.message || e),
      timestamp: new Date().toISOString(),
    })
    isRunning = false
    currentJob = null
    currentChildProcess = null
  }
}

/**
 * Start the scheduler
 */
export function startScheduler(options) {
  const { database, tickerRegistry, tickerDataRoot, parquetDir, pythonCmd } = options

  console.log('[scheduler] Starting scheduler...')

  // Check every minute
  schedulerInterval = setInterval(async () => {
    try {
      const config = await getScheduleConfig(database)

      if (isTimeToRun(config)) {
        console.log('[scheduler] Scheduled time reached, starting sync...')
        await runTickerSync(config, tickerDataRoot, parquetDir, pythonCmd, database, tickerRegistry)
      }
    } catch (e) {
      console.error('[scheduler] Error in scheduler loop:', e)
    }
  }, 60 * 1000)  // Check every minute

  // Also run once at startup to check if we missed today's run
  setTimeout(async () => {
    try {
      const config = await getScheduleConfig(database)
      const timezone = config.timezone || 'America/New_York'

      // Skip weekends - no need for catchup sync on Sat/Sun
      if (!isWeekday(timezone)) {
        console.log('[scheduler] Weekend - skipping startup catchup check')
        return
      }

      const lastSync = await getLastSyncInfo(database)
      const today = new Date().toISOString().slice(0, 10)

      // If enabled and we haven't run today, and it's past the scheduled time
      if (config.enabled && lastSync?.date !== today) {
        const now = new Date()
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
        const currentTime = formatter.format(now)
        const [schedHour, schedMinute] = config.updateTime.split(':').map(Number)
        const [curHour, curMinute] = currentTime.split(':').map(Number)

        // If past scheduled time, run now
        const isPastTime = curHour > schedHour || (curHour === schedHour && curMinute > schedMinute)
        if (isPastTime) {
          console.log('[scheduler] Missed scheduled time, running catchup sync...')
          await runTickerSync(config, tickerDataRoot, parquetDir, pythonCmd, database, tickerRegistry)
        }
      }
    } catch (e) {
      console.error('[scheduler] Error in startup check:', e)
    }
  }, 5000)  // Check 5 seconds after startup

  console.log('[scheduler] Scheduler started')
}

/**
 * Stop the scheduler
 */
export function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval)
    schedulerInterval = null
    console.log('[scheduler] Scheduler stopped')
  }
}

/**
 * Get scheduler status
 */
export function getSchedulerStatus() {
  return {
    isRunning,
    currentJob,
    lastRunDate,
    schedulerActive: schedulerInterval !== null,
  }
}

/**
 * Trigger a manual sync (bypasses schedule)
 * @param {Object} options - Options including database, tickerRegistry, etc.
 * @param {string} options.source - 'tiingo' or 'yfinance' (default: 'tiingo')
 */
export async function triggerManualSync(options) {
  const { database, tickerRegistry, tickerDataRoot, parquetDir, pythonCmd, source = 'tiingo' } = options
  const config = await getScheduleConfig(database)

  if (isRunning) {
    return { success: false, error: 'Sync already in progress' }
  }

  // Reset lastRunDate to allow running
  lastRunDate = null

  // Run sync with the specified source
  await runTickerSync(config, tickerDataRoot, parquetDir, pythonCmd, database, tickerRegistry, source)

  return { success: true, message: `${source === 'tiingo' ? 'Tiingo' : 'yFinance'} sync started` }
}

/**
 * Kill the currently running sync job
 */
export function killCurrentJob() {
  if (!isRunning || !currentChildProcess) {
    return { success: false, error: 'No job currently running' }
  }

  try {
    const pid = currentChildProcess.pid
    console.log(`[scheduler] Killing job with PID ${pid}`)

    // Kill the process tree (works on Windows too)
    currentChildProcess.kill('SIGTERM')

    // Force cleanup
    isRunning = false
    currentJob = null
    currentChildProcess = null

    return { success: true, message: `Job killed (PID: ${pid})` }
  } catch (e) {
    console.error('[scheduler] Error killing job:', e)
    return { success: false, error: String(e?.message || e) }
  }
}
