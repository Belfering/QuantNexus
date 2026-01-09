/**
 * Worker pool for parallel Python backtesting
 * Spawns multiple Python processes and distributes tasks across them
 */

import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import os from 'os'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export class WorkerPool {
  constructor(parquetDir, numWorkers = null) {
    this.parquetDir = parquetDir
    this.numWorkers = numWorkers || Math.max(1, os.cpus().length - 1)
    this.workers = []
    this.taskQueue = []
    this.results = []
    this.errors = []
    this.activeWorkers = 0
    this.totalTasks = 0
    this.completedTasks = 0
    this.passingBranches = 0
    this.failedBranches = 0
    this.onProgress = null
    this.onComplete = null
    this.onError = null
    this.cancelled = false
  }

  /**
   * Start the worker pool
   */
  start() {
    console.log(`[WorkerPool] Starting with ${this.numWorkers} workers`)
    this.cancelled = false
    this.completedTasks = 0
    this.passingBranches = 0
    this.failedBranches = 0

    for (let i = 0; i < this.numWorkers; i++) {
      this.spawnWorker(i)
    }
  }

  /**
   * Spawn a single worker
   */
  spawnWorker(workerId) {
    const worker = {
      id: workerId,
      busy: false,
    }

    this.workers.push(worker)
    this.processNextTask(worker)
  }

  /**
   * Add tasks to the queue
   */
  addTasks(tasks) {
    this.taskQueue.push(...tasks)
    this.totalTasks = this.taskQueue.length + this.completedTasks
  }

  /**
   * Process branches with callbacks
   */
  processBranches(branches, callbacks) {
    this.onProgress = callbacks.onProgress
    this.onComplete = callbacks.onComplete
    this.onError = callbacks.onError

    // Add branches to task queue
    this.addTasks(branches)

    // Start workers
    this.start()
  }

  /**
   * Process next task in queue for a worker
   */
  async processNextTask(worker) {
    if (this.cancelled) {
      return
    }

    if (this.taskQueue.length === 0) {
      // No more tasks
      this.checkCompletion()
      return
    }

    const task = this.taskQueue.shift()
    worker.busy = true
    this.activeWorkers++

    try {
      const result = await this.runPythonBacktest(task)

      if (result.error) {
        // Backtest failed
        this.failedBranches++
        this.errors.push({
          branchId: task.branchId,
          error: result.error
        })
      } else {
        // Backtest succeeded
        const branchResult = {
          branchId: task.branchId,
          combination: task.combination,
          status: 'success',
          isMetrics: result.isMetrics,
          oosMetrics: result.oosMetrics,
          passed: task.passed || false, // Will be evaluated by requirements checker
          metrics: result.metrics
        }

        this.results.push(branchResult)
        this.passingBranches++
      }

      this.completedTasks++

      // Report progress
      if (this.onProgress) {
        await this.onProgress({
          completed: this.completedTasks,
          total: this.totalTasks,
          passing: this.passingBranches,
          failed: this.failedBranches
        })
      }
    } catch (error) {
      console.error(`[WorkerPool] Worker ${worker.id} error:`, error)
      this.failedBranches++
      this.errors.push({
        branchId: task.branchId,
        error: error.message
      })

      if (this.onError) {
        this.onError(error)
      }
    }

    worker.busy = false
    this.activeWorkers--

    // Process next task
    this.processNextTask(worker)
  }

  /**
   * Run Python backtester for a single branch
   */
  runPythonBacktest(task) {
    return new Promise((resolve, reject) => {
      const pythonScript = path.join(__dirname, 'backtester.py')

      // Prepare input for Python script
      const inputJson = JSON.stringify({
        parquetDir: this.parquetDir,
        tree: task.tree,
        options: task.options
      })

      // Spawn Python process
      const python = spawn('python', [pythonScript, inputJson])

      let stdout = ''
      let stderr = ''

      python.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      python.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      python.on('close', (code) => {
        if (code !== 0) {
          resolve({
            error: `Python process exited with code ${code}: ${stderr}`
          })
          return
        }

        try {
          const result = JSON.parse(stdout)
          resolve(result)
        } catch (error) {
          resolve({
            error: `Failed to parse Python output: ${stdout.substring(0, 200)}`
          })
        }
      })

      python.on('error', (error) => {
        resolve({
          error: `Failed to spawn Python process: ${error.message}`
        })
      })
    })
  }

  /**
   * Check if all tasks are complete
   */
  checkCompletion() {
    if (this.completedTasks >= this.totalTasks && this.activeWorkers === 0) {
      console.log(`[WorkerPool] Complete: ${this.passingBranches} passing, ${this.failedBranches} failed out of ${this.totalTasks}`)

      if (this.onComplete) {
        this.onComplete({
          results: this.results,
          errors: this.errors,
          passing: this.passingBranches,
          failed: this.failedBranches,
          total: this.totalTasks
        })
      }
    }
  }

  /**
   * Cancel all pending tasks
   */
  cancel() {
    console.log('[WorkerPool] Cancelling...')
    this.cancelled = true
    this.taskQueue = []
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      total: this.totalTasks,
      completed: this.completedTasks,
      passing: this.passingBranches,
      failed: this.failedBranches,
      pending: this.taskQueue.length,
      active: this.activeWorkers,
      percentage: this.totalTasks > 0 ? (this.completedTasks / this.totalTasks) * 100 : 0,
    }
  }
}
