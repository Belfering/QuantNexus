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
   * Apply ticker substitutions to a tree (server-side version)
   * Ported from branchGenerator.ts applyTickerSubstitutions
   */
  applyTickerSubstitutions(node, substitutions, appliedTickers, extractedTickers) {
    // Apply to condition tickers
    if (node.conditions && Array.isArray(node.conditions)) {
      for (const condition of node.conditions) {
        // Replace ticker if it references a ticker list
        if (condition.tickerListId && substitutions[condition.tickerListId]) {
          condition.ticker = substitutions[condition.tickerListId]
          appliedTickers.add(condition.ticker)
          if (extractedTickers && !extractedTickers.conditionTicker) {
            extractedTickers.conditionTicker = condition.ticker
          }
          delete condition.tickerListId
          delete condition.tickerListName
        }
        // FALLBACK: Handle ticker field containing "list:UUID"
        else if (condition.ticker && typeof condition.ticker === 'string' && condition.ticker.startsWith('list:')) {
          const listId = condition.ticker.substring(5)
          if (substitutions[listId]) {
            condition.ticker = substitutions[listId]
            appliedTickers.add(condition.ticker)
            if (extractedTickers && !extractedTickers.conditionTicker) {
              extractedTickers.conditionTicker = condition.ticker
            }
          }
        }
        // Track regular tickers for AUTO mode
        else if (condition.ticker && typeof condition.ticker === 'string') {
          appliedTickers.add(condition.ticker)
          if (extractedTickers && !extractedTickers.conditionTicker) {
            extractedTickers.conditionTicker = condition.ticker
          }
        }

        // Replace right ticker if needed
        if (condition.rightTickerListId && substitutions[condition.rightTickerListId]) {
          condition.rightTicker = substitutions[condition.rightTickerListId]
          appliedTickers.add(condition.rightTicker)
          delete condition.rightTickerListId
          delete condition.rightTickerListName
        }
        else if (condition.rightTicker && typeof condition.rightTicker === 'string' && condition.rightTicker.startsWith('list:')) {
          const listId = condition.rightTicker.substring(5)
          if (substitutions[listId]) {
            condition.rightTicker = substitutions[listId]
            appliedTickers.add(condition.rightTicker)
          }
        }
        else if (condition.rightTicker && typeof condition.rightTicker === 'string') {
          appliedTickers.add(condition.rightTicker)
        }
      }
    }

    // Apply to position node based on mode
    if (node.kind === 'position') {
      if (node.positionMode === 'match_indicator' && appliedTickers.size > 0) {
        // Match Indicator mode: use tickers from conditions above
        const ticker = Array.from(appliedTickers)[0]
        node.positions = [ticker]
        if (extractedTickers && !extractedTickers.positionTicker) {
          extractedTickers.positionTicker = ticker
        }
      } else if (node.positionTickerListId && substitutions[node.positionTickerListId]) {
        const ticker = substitutions[node.positionTickerListId]
        if (node.positions && node.positions.length > 0) {
          node.positions = node.positions.map(() => ticker)
          if (extractedTickers && !extractedTickers.positionTicker) {
            extractedTickers.positionTicker = ticker
          }
          delete node.positionTickerListId
          delete node.positionTickerListName
        }
      }
      // FALLBACK: Handle positions array containing "list:UUID"
      else if (node.positions && node.positions.length > 0) {
        for (let i = 0; i < node.positions.length; i++) {
          const pos = node.positions[i]
          if (pos && typeof pos === 'string' && pos.startsWith('list:')) {
            const listId = pos.substring(5)
            if (substitutions[listId]) {
              const ticker = substitutions[listId]
              node.positions = node.positions.map(() => ticker)
              if (extractedTickers && !extractedTickers.positionTicker) {
                extractedTickers.positionTicker = ticker
              }
              break
            }
          }
        }
      }
    }

    // Recursively apply to children
    if (node.children) {
      for (const slotKey in node.children) {
        const slot = node.children[slotKey]
        if (Array.isArray(slot)) {
          for (const child of slot) {
            if (child) {
              this.applyTickerSubstitutions(child, substitutions, appliedTickers, extractedTickers)
            }
          }
        }
      }
    }
  }

  /**
   * Apply branch parameters to tree (server-side version)
   * Ported from branchGenerator.ts applyBranchToTree
   */
  applyBranchToTree(tree, combination, ranges, hasAutoMode) {
    const extractedTickers = {}
    const substitutions = combination.tickerSubstitutions || {}
    const hasSubstitutions = Object.keys(substitutions).length > 0
    const needsTraversal = hasSubstitutions || hasAutoMode

    if (needsTraversal) {
      this.applyTickerSubstitutions(tree, substitutions, new Set(), extractedTickers)
      if (extractedTickers.conditionTicker) {
        combination.conditionTicker = extractedTickers.conditionTicker
      }
      if (extractedTickers.positionTicker) {
        combination.positionTicker = extractedTickers.positionTicker
      }
    }

    // Apply each parameter value from the combination
    for (const [parameterId, value] of Object.entries(combination.parameterValues)) {
      const range = ranges.find(r => r.id === parameterId)
      if (!range) {
        console.warn(`[WorkerPool] Could not find range for parameter ${parameterId}`)
        continue
      }

      const pathParts = range.path.split('.')
      let startIndex = 0
      if (pathParts[0] === 'node') {
        startIndex = 1
      }

      // Special handling for condition paths
      if (pathParts[startIndex] === 'conditions' && pathParts.length >= startIndex + 3) {
        const conditionId = pathParts[startIndex + 1]
        const field = pathParts[startIndex + 2]

        const findAndUpdateCondition = (node) => {
          if (node.conditions && Array.isArray(node.conditions)) {
            const condition = node.conditions.find(c =>
              c.id === conditionId || c.id.includes(conditionId) || c.id.startsWith('node-' + conditionId)
            )
            if (condition) {
              condition[field] = value
              return true
            }
          }

          if (node.children) {
            for (const slot in node.children) {
              const children = node.children[slot]
              if (Array.isArray(children)) {
                for (const child of children) {
                  if (child && findAndUpdateCondition(child)) {
                    return true
                  }
                }
              } else if (children && findAndUpdateCondition(children)) {
                return true
              }
            }
          }
          return false
        }

        if (findAndUpdateCondition(tree)) {
          continue
        } else {
          console.warn(`[WorkerPool] Could not find condition with ID ${conditionId}`)
          continue
        }
      }

      // Navigate to target field
      let current = tree
      for (let i = startIndex; i < pathParts.length - 1; i++) {
        const part = pathParts[i]
        if (Array.isArray(current)) {
          const found = current.find(item => item.id === part)
          if (!found) {
            console.warn(`[WorkerPool] Could not find item with id ${part}`)
            break
          }
          current = found
        } else if (current[part] !== undefined) {
          current = current[part]
        } else {
          console.warn(`[WorkerPool] Invalid path ${range.path} at ${part}`)
          break
        }
      }

      const field = pathParts[pathParts.length - 1]
      if (current && (field in current || Array.isArray(current))) {
        if (Array.isArray(current)) {
          const found = current.find(item => item.id === field)
          if (found && 'value' in found) {
            found.value = value
          }
        } else {
          current[field] = value
        }
      }
    }

    return tree
  }

  /**
   * Process branches with callbacks
   * OPTIMIZED: Clones base tree and applies parameters server-side
   * This eliminates 99% of client-side memory usage
   */
  async processBranches(baseTree, combinations, parameterRanges, hasAutoMode, options, callbacks) {
    this.onProgress = callbacks.onProgress
    this.onComplete = callbacks.onComplete
    this.onError = callbacks.onError

    console.log(`[WorkerPool] Server-side cloning: ${combinations.length} branches from base tree`)

    // Clone and apply parameters for each combination (server-side)
    const branches = combinations.map(combination => {
      // Deep clone tree using JSON (fast and simple)
      const clonedTree = JSON.parse(JSON.stringify(baseTree))

      // Apply parameters and ticker substitutions
      const modifiedTree = this.applyBranchToTree(clonedTree, combination, parameterRanges, hasAutoMode)

      return {
        branchId: combination.id,
        tree: modifiedTree,
        combination,
        options
      }
    })

    // Try vectorized optimization for parameter sweeps
    const vectorizedResults = await this.tryVectorizedOptimization(branches)

    if (vectorizedResults) {
      console.log(`[WorkerPool] ✓ Vectorized ${branches.length} branches`)
      // Return vectorized results directly (include tree in results)
      this.results = vectorizedResults.map((r, idx) => ({
        ...r,
        tree: JSON.stringify(branches[idx].tree)
      }))
      this.completedTasks = branches.length
      this.passingBranches = vectorizedResults.length
      this.checkCompletion()
      return
    }

    // Fall back to standard worker pool
    console.log(`[WorkerPool] Using standard worker pool (${branches.length} branches)`)
    this.addTasks(branches)
    this.start()
  }

  /**
   * Try to vectorize parameter sweeps
   */
  async tryVectorizedOptimization(branches) {
    // DISABLED: Vectorized optimizer not compatible with complex tree structures
    // Master branch's vectorized approach only works for simple indicator strategies
    // Current branch handles complex flowchart trees - use standard worker pool
    return null

    // Only vectorize if we have many branches (>= 50)
    if (branches.length < 50) {
      return null
    }

    try {
      const pythonScript = path.join(__dirname, 'vectorized_optimizer.py')

      return new Promise((resolve, reject) => {
        // Spawn Python process
        const python = spawn('python', [pythonScript])

        let stdoutData = ''
        let stderrData = ''

        python.stdout.on('data', (data) => {
          stdoutData += data.toString()
        })

        python.stderr.on('data', (data) => {
          stderrData += data.toString()
        })

        python.on('close', (code) => {
          if (code !== 0) {
            console.error(`[WorkerPool] Vectorized optimizer failed (code ${code})`)
            console.error('[WorkerPool] stderr:', stderrData)
            console.error('[WorkerPool] stdout:', stdoutData)
            resolve(null) // Fall back to standard processing
            return
          }

          try {
            if (!stdoutData.trim()) {
              console.error('[WorkerPool] Vectorized optimizer returned empty output')
              resolve(null)
              return
            }

            const result = JSON.parse(stdoutData)

            if (result.vectorized === false) {
              // Not suitable for vectorization
              console.log('[WorkerPool] Branches not suitable for vectorization, using standard pool')
              resolve(null)
              return
            }

            // Transform results to expected format
            const transformedResults = result.results.map(r => ({
              branchId: r.branchId,
              combination: r.combination,
              status: 'success',
              isMetrics: r.isMetrics,
              oosMetrics: r.oosMetrics,
              passed: false, // Will be evaluated by requirements checker
              metrics: r.metrics
            }))

            console.log(`[WorkerPool] ✓ Vectorized ${transformedResults.length} branches successfully`)
            resolve(transformedResults)
          } catch (error) {
            console.error('[WorkerPool] Failed to parse vectorized results:', error)
            console.error('[WorkerPool] stdout:', stdoutData)
            console.error('[WorkerPool] stderr:', stderrData)
            resolve(null)
          }
        })

        python.on('error', (error) => {
          console.error('[WorkerPool] Vectorized optimizer spawn error:', error)
          resolve(null)
        })

        // Send input data
        const input = {
          parquetDir: this.parquetDir,
          branches: branches.map(b => ({
            branchId: b.branchId,
            tree: b.tree,
            options: b.options,
            combination: b.combination
          }))
        }

        python.stdin.write(JSON.stringify(input))
        python.stdin.end()
      })
    } catch (error) {
      console.error('[WorkerPool] tryVectorizedOptimization error:', error)
      return null
    }
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
          tree: JSON.stringify(task.tree), // Include serialized tree for frontend
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
