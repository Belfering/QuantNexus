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
    this.startTime = Date.now()

    for (let i = 0; i < this.numWorkers; i++) {
      this.spawnWorker(i)
    }
  }

  /**
   * Spawn a single persistent Python worker
   */
  spawnWorker(workerId) {
    const pythonScript = path.join(__dirname, 'persistent_worker.py')

    // Spawn persistent Python process
    const python = spawn('python', [pythonScript])

    const worker = {
      id: workerId,
      busy: false,
      process: python,
      buffer: '',
      ready: false,
      currentResolve: null,
      currentReject: null
    }

    // Handle stdout (line-buffered JSON responses)
    python.stdout.on('data', (data) => {
      worker.buffer += data.toString()

      // Process complete lines
      let newlineIndex
      while ((newlineIndex = worker.buffer.indexOf('\n')) !== -1) {
        const line = worker.buffer.substring(0, newlineIndex)
        worker.buffer = worker.buffer.substring(newlineIndex + 1)

        try {
          const response = JSON.parse(line)

          // Handle ready signal
          if (response.status === 'ready') {
            worker.ready = true
            console.log(`[WorkerPool] Worker ${workerId} ready`)
            this.processNextTask(worker)
            continue
          }

          // Handle branch result
          if (worker.currentResolve) {
            worker.currentResolve(response)
            worker.currentResolve = null
            worker.currentReject = null
          }
        } catch (error) {
          console.error(`[WorkerPool] Worker ${workerId} JSON parse error:`, error)
          if (worker.currentReject) {
            worker.currentReject(error)
            worker.currentResolve = null
            worker.currentReject = null
          }
        }
      }
    })

    python.stderr.on('data', (data) => {
      // Suppress stderr output (cache loading messages, etc.)
      // Uncomment for debugging:
      // console.error(`[Worker ${workerId}]`, data.toString())
    })

    python.on('close', (code) => {
      console.log(`[WorkerPool] Worker ${workerId} exited with code ${code}`)
      if (worker.currentReject) {
        worker.currentReject(new Error(`Worker exited with code ${code}`))
      }
    })

    python.on('error', (error) => {
      console.error(`[WorkerPool] Worker ${workerId} error:`, error)
      if (worker.currentReject) {
        worker.currentReject(error)
      }
    })

    this.workers.push(worker)

    // Send initialization config
    const config = {
      parquetDir: this.parquetDir
    }
    python.stdin.write(JSON.stringify(config) + '\n')
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

    // Skip if worker not ready yet
    if (!worker.ready) {
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
      const result = await this.runPythonBacktest(task, worker)

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

        // Debug: Log first result
        if (this.results.length === 0) {
          console.log('[WorkerPool] First result:', JSON.stringify(branchResult, null, 2))
        }

        this.results.push(branchResult)
        this.passingBranches++
      }

      this.completedTasks++

      // Log throughput every 100 tasks
      if (this.completedTasks % 100 === 0 || this.completedTasks === this.totalTasks) {
        const elapsed = (Date.now() - this.startTime) / 1000
        const throughput = this.completedTasks / elapsed
        console.log(`[WorkerPool] Progress: ${this.completedTasks}/${this.totalTasks} (${throughput.toFixed(1)} branches/sec, ${this.passingBranches} passing, ${this.failedBranches} failed)`)
      }

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
   * Run Python backtester for a single branch using persistent worker
   */
  runPythonBacktest(task, worker) {
    return new Promise((resolve, reject) => {
      // Set up promise callbacks on worker
      worker.currentResolve = resolve
      worker.currentReject = reject

      // Debug: Log options for first task
      if (this.completedTasks === 0 && this.activeWorkers === 1) {
        console.log('[WorkerPool] First task options:', JSON.stringify(task.options, null, 2))
      }

      // Send task to persistent worker via stdin
      const taskJson = JSON.stringify({
        branchId: task.branchId,
        tree: task.tree,
        options: task.options
      })

      try {
        worker.process.stdin.write(taskJson + '\n')
      } catch (error) {
        resolve({
          error: `Failed to send task to worker: ${error.message}`
        })
      }
    })
  }

  /**
   * Check if all tasks are complete
   */
  checkCompletion() {
    if (this.completedTasks >= this.totalTasks && this.activeWorkers === 0) {
      const elapsed = (Date.now() - this.startTime) / 1000
      const throughput = this.completedTasks / elapsed
      console.log(`[WorkerPool] ✓ COMPLETE: ${this.completedTasks} branches in ${elapsed.toFixed(2)}s (${throughput.toFixed(1)} branches/sec)`)
      console.log(`[WorkerPool] Results: ${this.passingBranches} passing, ${this.failedBranches} failed`)

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
   * Shutdown all workers
   */
  shutdown() {
    console.log('[WorkerPool] Shutting down workers...')
    for (const worker of this.workers) {
      try {
        // Send shutdown command
        worker.process.stdin.write(JSON.stringify({ command: 'shutdown' }) + '\n')
        worker.process.stdin.end()
      } catch (error) {
        // Worker already dead
      }
    }
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
