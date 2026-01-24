/**
 * Scheduler Module
 *
 * Handles scheduled tasks like daily ticker data updates.
 * Default: 6:00 PM Eastern Time daily
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Schedule configuration (stored in adminConfig table)
const DEFAULT_SCHEDULE = {
  enabled: true,
  tiingo5d: {
    enabled: true,
    updateTime: '18:00',  // Daily at 6:00 PM
    timezone: 'America/New_York',
  },
  tiingoFull: {
    enabled: true,
    dayOfMonth: 1,  // 1st day of each month
    updateTime: '18:00',  // At 6:00 PM
    timezone: 'America/New_York',
  },
  batchSize: 100,
  sleepSeconds: 2.0,       // yFinance pause between batches
  tiingoSleepSeconds: 0.2, // Tiingo pause between API calls (faster rate limit)
}

let schedulerInterval = null
let lastRunDate = null
let isRunning = false
let currentJob = null
let currentChildProcess = null

/**
 * Sync the ticker registry from Tiingo's master list
 * This ensures we have the latest active tickers before downloading
 * @param {string} tickerDataRoot - Path to ticker data root
 * @param {string} pythonCmd - Python command
 * @param {Object} tickerRegistry - Ticker registry instance
 * @returns {Promise<{success: boolean, count?: number, error?: string}>}
 */
async function syncRegistryFromTiingo(tickerDataRoot, pythonCmd, tickerRegistry) {
  console.log('[scheduler] Syncing registry from Tiingo master list...')

  return new Promise((resolve) => {
    const syncScriptPath = path.join(tickerDataRoot, 'sync_tickers.py')
    const outputPath = path.join(tickerDataRoot, '_tiingo_master.json')

    const args = ['-u', syncScriptPath, '--output', outputPath]
    const child = spawn(pythonCmd, args, { windowsHide: true })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (buf) => {
      stdout += String(buf)
    })

    child.stderr.on('data', (buf) => {
      stderr += String(buf)
    })

    child.on('close', async (code) => {
      if (code !== 0) {
        console.error('[scheduler] Registry sync failed:', stderr)
        resolve({ success: false, error: `sync_tickers.py exited with code ${code}` })
        return
      }

      try {
        // Read the downloaded ticker list
        const data = await fs.readFile(outputPath, 'utf-8')
        const tickers = JSON.parse(data)

        console.log(`[scheduler] Downloaded ${tickers.length} tickers from Tiingo`)

        // Import into registry (deduplication happens in importTickers)
        await tickerRegistry.ensureTickerRegistryTable()
        const result = await tickerRegistry.importTickers(tickers, { usOnly: true })

        console.log(`[scheduler] Imported ${result.imported} tickers into registry`)
        resolve({ success: true, count: result.imported })
      } catch (e) {
        console.error('[scheduler] Error importing tickers:', e)
        resolve({ success: false, error: String(e?.message || e) })
      }
    })

    child.on('error', (err) => {
      console.error('[scheduler] Error running sync_tickers.py:', err)
      resolve({ success: false, error: String(err?.message || err) })
    })
  })
}

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
      const storedConfig = JSON.parse(row.value)
      // Deep merge: preserve nested objects from DEFAULT_SCHEDULE
      const mergedConfig = {
        ...DEFAULT_SCHEDULE,
        ...storedConfig,
        tiingo5d: {
          ...DEFAULT_SCHEDULE.tiingo5d,
          ...(storedConfig.tiingo5d || {})
        },
        tiingoFull: {
          ...DEFAULT_SCHEDULE.tiingoFull,
          ...(storedConfig.tiingoFull || {})
        }
      }
      console.log('[scheduler] Loaded config with tiingo5d:', mergedConfig.tiingo5d?.updateTime, 'tiingoFull:', mergedConfig.tiingoFull?.updateTime)
      return mergedConfig
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
 * Get last sync info for a specific source or all sources
 * @param {object} database - Database connection
 * @param {string|null} source - 'yfinance', 'tiingo', 'tiingo_5d', 'tiingo_full', or null for all
 */
export async function getLastSyncInfo(database, source = null) {
  try {
    const { adminConfig } = await import('./db/schema.mjs')
    const { eq, like } = await import('drizzle-orm')

    if (source) {
      // Get specific source
      const key = `ticker_sync_last_run_${source}`
      const [row] = await database.db.select()
        .from(adminConfig)
        .where(eq(adminConfig.key, key))
        .limit(1)

      if (row?.value) {
        return JSON.parse(row.value)
      }
      return null
    }

    // Get all sources
    const rows = await database.db.select()
      .from(adminConfig)
      .where(like(adminConfig.key, 'ticker_sync_last_run_%'))

    const result = {
      yfinance: null,
      tiingo: null,
      tiingo_5d: null,
      tiingo_full: null
    }
    for (const row of rows) {
      if (row.key === 'ticker_sync_last_run_yfinance' && row.value) {
        result.yfinance = JSON.parse(row.value)
      } else if (row.key === 'ticker_sync_last_run_tiingo' && row.value) {
        result.tiingo = JSON.parse(row.value)
      } else if (row.key === 'ticker_sync_last_run_tiingo_5d' && row.value) {
        result.tiingo_5d = JSON.parse(row.value)
      } else if (row.key === 'ticker_sync_last_run_tiingo_full' && row.value) {
        result.tiingo_full = JSON.parse(row.value)
      }
    }

    // Migration: check for legacy single key and migrate if needed
    const [legacyRow] = await database.db.select()
      .from(adminConfig)
      .where(eq(adminConfig.key, 'ticker_sync_last_run'))
      .limit(1)

    if (legacyRow?.value) {
      const legacyInfo = JSON.parse(legacyRow.value)
      // Assign legacy to appropriate source based on what was tracked
      const legacySource = legacyInfo.source || 'yfinance'
      if (!result[legacySource]) {
        result[legacySource] = legacyInfo
      }
    }

    return result
  } catch (e) {
    console.error('[scheduler] Error getting last sync info:', e)
  }
  return {
    yfinance: null,
    tiingo: null,
    tiingo_5d: null,
    tiingo_full: null
  }
}

/**
 * Save last sync info for a specific source
 * @param {object} database - Database connection
 * @param {object} info - Sync info object (must include 'trackingKey' field)
 */
async function saveLastSyncInfo(database, info) {
  try {
    const { adminConfig } = await import('./db/schema.mjs')
    const trackingKey = info.trackingKey || info.source || 'yfinance'
    const key = `ticker_sync_last_run_${trackingKey}`

    await database.db.insert(adminConfig)
      .values({
        key,
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
 * Check if it's time to run a scheduled sync
 * Returns { shouldRun: boolean, scheduleType: 'tiingo_5d' | 'tiingo_full' | null }
 */
function isTimeToRun(config, lastSyncInfo) {
  if (!config.enabled) return { shouldRun: false, scheduleType: null }

  if (isRunning) return { shouldRun: false, scheduleType: null }

  const now = new Date()

  // Check Tiingo 5d (daily schedule)
  if (config.tiingo5d?.enabled) {
    const timezone = config.tiingo5d.timezone || 'America/New_York'

    // Only run on weekdays
    if (isWeekday(timezone)) {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
      const currentTime = formatter.format(now)

      const dateFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
      const currentDate = dateFormatter.format(now)

      const [schedHour, schedMinute] = config.tiingo5d.updateTime.split(':').map(Number)
      const [curHour, curMinute] = currentTime.split(':').map(Number)

      const isRightTime = curHour === schedHour && curMinute === schedMinute
      const lastRun5d = lastSyncInfo?.tiingo_5d
      const alreadyRanToday = lastRun5d?.date === now.toISOString().slice(0, 10)

      if (isRightTime && !alreadyRanToday) {
        return { shouldRun: true, scheduleType: 'tiingo_5d' }
      }
    }
  }

  // Check Tiingo Full (monthly on specific day)
  if (config.tiingoFull?.enabled) {
    const timezone = config.tiingoFull.timezone || 'America/New_York'

    const dateFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      day: 'numeric',
    })
    const dayOfMonth = parseInt(dateFormatter.format(now))

    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    const currentTime = formatter.format(now)

    const [schedHour, schedMinute] = config.tiingoFull.updateTime.split(':').map(Number)
    const [curHour, curMinute] = currentTime.split(':').map(Number)

    const isRightDay = dayOfMonth === config.tiingoFull.dayOfMonth
    const isRightTime = curHour === schedHour && curMinute === schedMinute
    const lastRunFull = lastSyncInfo?.tiingo_full
    const alreadyRanThisMonth = lastRunFull?.date?.slice(0, 7) === now.toISOString().slice(0, 7)

    if (isRightDay && isRightTime && !alreadyRanThisMonth) {
      return { shouldRun: true, scheduleType: 'tiingo_full' }
    }
  }

  return { shouldRun: false, scheduleType: null }
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
 * @param {string} mode - 'full', 'recent', '5d' (for Tiingo 5d daily sync) - default: 'recent'
 */
async function runTickerSync(config, tickerDataRoot, parquetDir, pythonCmd, database, tickerRegistry, source = 'tiingo', mode = 'recent') {
  if (isRunning) {
    console.log('[scheduler] Sync already running, skipping')
    return
  }

  isRunning = true
  const startedAt = Date.now()
  const today = new Date().toISOString().slice(0, 10)

  // Determine the tracking key based on source and mode
  const trackingKey = source === 'tiingo' && (mode === '5d' || mode === 'full')
    ? `tiingo_${mode}`
    : source

  // Set preliminary currentJob immediately so UI shows progress
  currentJob = {
    pid: null,
    startedAt,
    tickerCount: 0, // Will be updated once we know the count
    syncedCount: 0,
    stderrBuffer: '',
    phase: 'preparing', // Show user we're preparing
    source,
    mode,
    trackingKey,
  }

  console.log('[scheduler] Starting scheduled ticker sync...')

  try {
    // STEP 1: Sync registry from Tiingo master list first
    // This ensures we have the latest active tickers before downloading
    currentJob.phase = 'syncing_registry'
    console.log('[scheduler] Step 1: Syncing ticker registry from Tiingo...')

    const registryResult = await syncRegistryFromTiingo(tickerDataRoot, pythonCmd, tickerRegistry)
    if (!registryResult.success) {
      console.warn('[scheduler] Registry sync failed, continuing with existing registry:', registryResult.error)
    } else {
      console.log(`[scheduler] Registry synced: ${registryResult.count} tickers`)
    }

    // STEP 2: Get tickers needing sync (now with updated registry)
    currentJob.phase = 'preparing'
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
        trackingKey,
        source,
        mode,
        date: today,
        status: 'skipped',
        message: 'All tickers already synced',
        timestamp: new Date().toISOString(),
      })

      // Update job status to show completion in UI
      if (currentJob) {
        currentJob.phase = 'done'
        currentJob.message = 'All tickers already synced for today'
      }

      isRunning = false
      currentJob = null
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
    // Use tiingoSleepSeconds for tiingo source, sleepSeconds for yfinance
    const sleepSecs = source === 'tiingo'
      ? (config.tiingoSleepSeconds ?? 0.2)
      : (config.sleepSeconds ?? 2.0)

    // Determine download mode and recent days
    let downloadMode = mode === 'full' ? 'full' : 'recent'
    let recentDays = mode === '5d' ? 5 : 10  // Default to 10 days for 'recent' mode

    const args = [
      '-u',
      scriptPath,
      '--mode',
      downloadMode,
      '--tickers-json',
      tempTickersPath,
      '--out-dir',
      parquetDir,
      '--batch-size',
      String(config.batchSize || 100),
      '--sleep-seconds',
      String(sleepSecs),
      '--max-retries',
      '3',
      '--skip-metadata-json',
      skipMetadataPath,
    ]

    // Add recent-days for non-full mode
    if (downloadMode === 'recent') {
      args.push('--recent-days', String(recentDays))
    }

    // Add Tiingo API key from environment (only for tiingo source)
    if (source === 'tiingo') {
      const tiingoApiKey = process.env.TIINGO_API_KEY
      if (tiingoApiKey) {
        args.push('--api-key', tiingoApiKey)
      }
      // Use Tiingo-only mode: download ALL tickers directly from Tiingo (slower but thorough)
      args.push('--tiingo-only')
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

    // Buffer to accumulate partial lines across data events (fixes progress stuck at 0%)
    let stdoutBuffer = ''

    child.stdout.on('data', (buf) => {
      stdoutBuffer += String(buf)
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() || '' // Keep last (possibly incomplete) line

      for (const line of lines) {
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
          // Handle skipped tickers (no data = likely delisted/inactive)
          if (ev?.type === 'ticker_skipped' && ev.ticker) {
            currentJob.skippedCount = (currentJob.skippedCount || 0) + 1
            // Mark ticker as inactive so we don't try to download it again
            tickerRegistry.markTickerInactive(ev.ticker).catch(() => {})
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
      // Process any remaining data in stdoutBuffer
      if (stdoutBuffer.trim()) {
        console.log('[scheduler] stdout (final):', stdoutBuffer.trim())
        try {
          const ev = JSON.parse(stdoutBuffer.trim())
          if (ev?.type === 'ticker_saved' && ev.ticker && currentJob) {
            currentJob.syncedCount++
            tickerRegistry.markTickerSynced(ev.ticker, today).catch(() => {})
          }
        } catch {
          // Non-JSON remaining output
        }
      }

      const finishedAt = Date.now()
      const duration = Math.round((finishedAt - startedAt) / 1000)

      if (code === 0) {
        console.log(`[scheduler] Sync completed successfully in ${duration}s`)
        await saveLastSyncInfo(database, {
          trackingKey,
          source,
          mode,
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
          trackingKey,
          source,
          mode,
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
        trackingKey,
        source,
        mode,
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
      trackingKey,
      source,
      mode,
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
      const lastSyncInfo = await getLastSyncInfo(database)

      const { shouldRun, scheduleType } = isTimeToRun(config, lastSyncInfo)

      if (shouldRun && scheduleType) {
        console.log(`[scheduler] Scheduled time reached for ${scheduleType}, starting sync...`)
        const mode = scheduleType === 'tiingo_5d' ? '5d' : scheduleType === 'tiingo_full' ? 'full' : 'recent'
        await runTickerSync(config, tickerDataRoot, parquetDir, pythonCmd, database, tickerRegistry, 'tiingo', mode)
      }
    } catch (e) {
      console.error('[scheduler] Error in scheduler loop:', e)
    }
  }, 60 * 1000)  // Check every minute

  // Also run once at startup to check if we missed today's run
  setTimeout(async () => {
    try {
      const config = await getScheduleConfig(database)
      const lastSyncInfo = await getLastSyncInfo(database)
      const today = new Date().toISOString().slice(0, 10)
      const now = new Date()

      // Check Tiingo 5d (daily) catchup
      if (config.tiingo5d?.enabled) {
        const timezone = config.tiingo5d.timezone || 'America/New_York'

        // Skip weekends for daily sync
        if (!isWeekday(timezone)) {
          console.log('[scheduler] Weekend - skipping Tiingo 5d catchup check')
        } else {
          const lastRun5d = lastSyncInfo?.tiingo_5d
          const needsRun = !lastRun5d || lastRun5d.date !== today

          if (needsRun) {
            const formatter = new Intl.DateTimeFormat('en-US', {
              timeZone: timezone,
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            })
            const currentTime = formatter.format(now)
            const [schedHour, schedMinute] = config.tiingo5d.updateTime.split(':').map(Number)
            const [curHour, curMinute] = currentTime.split(':').map(Number)

            const isPastTime = curHour > schedHour || (curHour === schedHour && curMinute > schedMinute)
            if (isPastTime) {
              console.log('[scheduler] Missed Tiingo 5d scheduled time, running catchup sync...')
              await runTickerSync(config, tickerDataRoot, parquetDir, pythonCmd, database, tickerRegistry, 'tiingo', '5d')
            }
          }
        }
      }

      // Check Tiingo Full (monthly) catchup
      if (config.tiingoFull?.enabled) {
        const timezone = config.tiingoFull.timezone || 'America/New_York'
        const dateFormatter = new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          day: 'numeric',
        })
        const dayOfMonth = parseInt(dateFormatter.format(now))

        const lastRunFull = lastSyncInfo?.tiingo_full
        const currentMonth = now.toISOString().slice(0, 7)
        const needsRun = dayOfMonth === config.tiingoFull.dayOfMonth &&
                        (!lastRunFull || lastRunFull.date?.slice(0, 7) !== currentMonth)

        if (needsRun) {
          const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          })
          const currentTime = formatter.format(now)
          const [schedHour, schedMinute] = config.tiingoFull.updateTime.split(':').map(Number)
          const [curHour, curMinute] = currentTime.split(':').map(Number)

          const isPastTime = curHour > schedHour || (curHour === schedHour && curMinute > schedMinute)
          if (isPastTime) {
            console.log('[scheduler] Missed Tiingo Full scheduled time, running catchup sync...')
            await runTickerSync(config, tickerDataRoot, parquetDir, pythonCmd, database, tickerRegistry, 'tiingo', 'full')
          }
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
