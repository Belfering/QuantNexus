/**
 * Worker pool for managing Python subprocess backtesting
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class WorkerPool {
  constructor(numWorkers = null) {
    this.numWorkers = numWorkers || Math.max(1, os.cpus().length - 1);
    this.workers = [];
    this.taskQueue = [];
    this.results = [];
    this.activeWorkers = 0;
    this.totalTasks = 0;
    this.completedTasks = 0;
    this.passingBranches = 0;
    this.onProgress = null;
    this.onComplete = null;
    this.onError = null;
    this.cancelled = false;
  }

  /**
   * Start the worker pool
   */
  start() {
    console.log(`Starting worker pool with ${this.numWorkers} workers`);
    this.cancelled = false;

    for (let i = 0; i < this.numWorkers; i++) {
      this.spawnWorker(i);
    }
  }

  /**
   * Spawn a single worker process
   */
  spawnWorker(workerId) {
    const pythonScript = path.join(__dirname, '../../python/backtester.py');

    const worker = {
      id: workerId,
      process: null,
      busy: false,
      buffer: '',
    };

    this.workers.push(worker);
    this.processNextTask(worker);
  }

  /**
   * Add tasks to the queue
   */
  addTasks(tasks, config) {
    for (const task of tasks) {
      this.taskQueue.push({
        ...task,
        config,
      });
    }
    this.totalTasks = this.taskQueue.length;
  }

  /**
   * Process next task in queue for a worker
   */
  async processNextTask(worker) {
    if (this.cancelled) {
      return;
    }

    if (this.taskQueue.length === 0) {
      // No more tasks
      this.checkCompletion();
      return;
    }

    const task = this.taskQueue.shift();
    worker.busy = true;
    this.activeWorkers++;

    try {
      const result = await this.runPythonBacktest(task);

      if (result && result.passing) {
        this.results.push(result);
        this.passingBranches++;
      }

      this.completedTasks++;

      // Report progress
      if (this.onProgress) {
        this.onProgress({
          total: this.totalTasks,
          completed: this.completedTasks,
          passing: this.passingBranches,
          percentage: (this.completedTasks / this.totalTasks) * 100,
        });
      }
    } catch (error) {
      console.error(`Worker ${worker.id} error:`, error);
      if (this.onError) {
        this.onError(error);
      }
    }

    worker.busy = false;
    this.activeWorkers--;

    // Process next task
    this.processNextTask(worker);
  }

  /**
   * Run Python backtester for a single branch
   */
  runPythonBacktest(task) {
    return new Promise((resolve, reject) => {
      const pythonScript = path.join(__dirname, '../../python/backtester.py');
      const dataPath = path.join(__dirname, `../../data/parquet/${task.signalTicker}.parquet`);

      const branchParams = {
        data_path: dataPath,
        signal_ticker: task.signalTicker,
        invest_ticker: task.investTicker,
        indicator: task.indicator,
        period: task.period,
        comparator: task.comparator,
        threshold: task.threshold,
        split_strategy: task.config.splitStrategy || 'even_odd_month',
        oos_start_date: task.config.oosStartDate,
        config: {
          minTIM: task.config.minTIM,
          minTIMAR: task.config.minTIMAR,
          maxDD: task.config.maxDD,
          minTrades: task.config.minTrades,
          minTIMARDD: task.config.minTIMARDD,
        },
      };

      const inputJson = JSON.stringify({ branch: branchParams });

      const python = spawn('python', [pythonScript, inputJson]);

      let stdout = '';
      let stderr = '';

      python.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      python.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      python.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Python process exited with code ${code}: ${stderr}`));
          return;
        }

        try {
          const result = JSON.parse(stdout);
          resolve(result);
        } catch (error) {
          reject(new Error(`Failed to parse Python output: ${stdout}`));
        }
      });

      python.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Check if all tasks are complete
   */
  checkCompletion() {
    if (this.completedTasks >= this.totalTasks && this.activeWorkers === 0) {
      console.log(`Worker pool complete: ${this.passingBranches} passing branches out of ${this.totalTasks}`);

      if (this.onComplete) {
        this.onComplete({
          total: this.totalTasks,
          passing: this.passingBranches,
          results: this.results,
        });
      }
    }
  }

  /**
   * Cancel all pending tasks
   */
  cancel() {
    console.log('Cancelling worker pool...');
    this.cancelled = true;
    this.taskQueue = [];
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      total: this.totalTasks,
      completed: this.completedTasks,
      passing: this.passingBranches,
      pending: this.taskQueue.length,
      active: this.activeWorkers,
      percentage: this.totalTasks > 0 ? (this.completedTasks / this.totalTasks) * 100 : 0,
    };
  }
}
