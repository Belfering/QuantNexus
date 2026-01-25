/**
 * Batch backtest routes - Parallel processing using Python worker pool
 */

import { Router } from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { WorkerPool } from '../python/WorkerPool.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const router = Router()

// Active batch jobs (keyed by jobId)
const activeBatchJobs = new Map()

/**
 * POST /api/batch-backtest/start
 * Start a batch backtest job with parallel processing
 *
 * OPTIMIZED: Accepts base tree + combinations instead of pre-cloned branches
 * This reduces memory usage by 99% and eliminates client-side crashes
 *
 * Request body:
 * {
 *   jobId: string,
 *   baseTree: FlowNode,
 *   combinations: BranchCombination[],
 *   parameterRanges: ParameterRange[],
 *   hasAutoMode: boolean,
 *   options: { mode, costBps, splitConfig, benchmarkTicker },
 *   parquetDir?: string
 * }
 */
router.post('/start', async (req, res) => {
  try {
    const { jobId, baseTree, combinations, parameterRanges, hasAutoMode, options, parquetDir } = req.body

    if (!jobId || !baseTree || !combinations || !Array.isArray(combinations)) {
      return res.status(400).json({ error: 'Invalid request: jobId, baseTree, and combinations required' })
    }

    const effectiveParquetDir = parquetDir || path.join(__dirname, '../../ticker-data/data/ticker_data_parquet')

    console.log(`[BatchBacktest] Starting job ${jobId} with ${combinations.length} branches using ${process.env.NUM_WORKERS || 'auto'} workers`)

    // Create worker pool
    const numWorkers = process.env.NUM_WORKERS ? parseInt(process.env.NUM_WORKERS) : null
    const workerPool = new WorkerPool(effectiveParquetDir, numWorkers)

    // Store job info
    const job = {
      jobId,
      workerPool,
      startTime: Date.now(),
      totalBranches: combinations.length,
      results: [],
      errors: [],
      status: 'running'
    }

    activeBatchJobs.set(jobId, job)

    // Process branches with callbacks (server will clone and apply parameters)
    workerPool.processBranches(baseTree, combinations, parameterRanges, hasAutoMode, options, {
      onProgress: async (progress) => {
        // Update job progress
        job.progress = progress
      },
      onComplete: (result) => {
        // Job completed
        job.status = 'completed'
        job.endTime = Date.now()
        job.results = result.results
        job.errors = result.errors

        console.log(`[BatchBacktest] Job ${jobId} completed in ${((job.endTime - job.startTime) / 1000).toFixed(2)}s`)
        console.log(`[BatchBacktest] Results: ${result.passing} passing, ${result.failed} failed`)
      },
      onError: (error) => {
        console.error(`[BatchBacktest] Job ${jobId} error:`, error)
      }
    })

    // Return job started response
    res.json({
      success: true,
      jobId,
      message: `Batch backtest started with ${combinations.length} branches`
    })

  } catch (error) {
    console.error('[BatchBacktest] Error starting batch:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/batch-backtest/status/:jobId
 * Get status of a batch backtest job
 */
router.get('/status/:jobId', (req, res) => {
  try {
    const { jobId } = req.params
    const job = activeBatchJobs.get(jobId)

    if (!job) {
      return res.status(404).json({ error: 'Job not found' })
    }

    const status = job.workerPool.getStatus()

    res.json({
      jobId,
      status: job.status,
      startTime: job.startTime,
      endTime: job.endTime,
      ...status
    })

  } catch (error) {
    console.error('[BatchBacktest] Error getting status:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/batch-backtest/results/:jobId
 * Get results of a completed batch backtest job
 */
router.get('/results/:jobId', (req, res) => {
  try {
    const { jobId } = req.params
    const job = activeBatchJobs.get(jobId)

    if (!job) {
      return res.status(404).json({ error: 'Job not found' })
    }

    if (job.status !== 'completed') {
      return res.status(400).json({ error: 'Job not yet completed' })
    }

    res.json({
      jobId,
      results: job.results,
      errors: job.errors,
      totalBranches: job.totalBranches,
      passing: job.results.length,
      failed: job.errors.length,
      duration: job.endTime - job.startTime
    })

  } catch (error) {
    console.error('[BatchBacktest] Error getting results:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/batch-backtest/cancel/:jobId
 * Cancel a running batch backtest job
 */
router.post('/cancel/:jobId', (req, res) => {
  try {
    const { jobId } = req.params
    const job = activeBatchJobs.get(jobId)

    if (!job) {
      return res.status(404).json({ error: 'Job not found' })
    }

    if (job.status !== 'running') {
      return res.status(400).json({ error: 'Job not running' })
    }

    job.workerPool.cancel()
    job.status = 'cancelled'
    job.endTime = Date.now()

    console.log(`[BatchBacktest] Job ${jobId} cancelled`)

    res.json({
      success: true,
      message: 'Job cancelled'
    })

  } catch (error) {
    console.error('[BatchBacktest] Error cancelling job:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * DELETE /api/batch-backtest/:jobId
 * Delete a batch backtest job from memory
 */
router.delete('/:jobId', (req, res) => {
  try {
    const { jobId } = req.params

    if (!activeBatchJobs.has(jobId)) {
      return res.status(404).json({ error: 'Job not found' })
    }

    activeBatchJobs.delete(jobId)

    res.json({
      success: true,
      message: 'Job deleted'
    })

  } catch (error) {
    console.error('[BatchBacktest] Error deleting job:', error)
    res.status(500).json({ error: error.message })
  }
})

export default router
