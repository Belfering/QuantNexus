/**
 * Optimization Results Routes
 *
 * Handles persistence and retrieval of branch generation optimization jobs
 */

import { Router } from 'express'
import { sqlite } from '../db/index.mjs'

const router = Router()

/**
 * GET /api/optimization/jobs
 * Get all optimization jobs ordered by creation date (newest first)
 */
router.get('/jobs', (req, res) => {
  try {
    const jobs = sqlite.prepare(`
      SELECT
        id,
        bot_id,
        bot_name,
        name,
        status,
        total_branches,
        completed_branches,
        passing_branches,
        start_time,
        end_time,
        error_message,
        created_at
      FROM optimization_jobs
      ORDER BY created_at DESC
    `).all()

    // Convert timestamps to milliseconds for frontend
    const formatted = jobs.map(job => ({
      id: job.id,
      botId: job.bot_id,
      botName: job.bot_name,
      name: job.name,
      status: job.status,
      totalBranches: job.total_branches,
      completedBranches: job.completed_branches,
      passingBranches: job.passing_branches,
      startTime: job.start_time,
      endTime: job.end_time,
      errorMessage: job.error_message,
      createdAt: job.created_at * 1000, // Convert to ms
    }))

    res.json(formatted)
  } catch (error) {
    console.error('[Optimization] Get jobs error:', error)
    res.status(500).json({ error: 'Failed to fetch jobs' })
  }
})

/**
 * GET /api/optimization/:jobId/results
 * Get results for a specific job with optional sorting
 * Query params: sortBy, order (asc/desc), limit
 */
router.get('/:jobId/results', (req, res) => {
  try {
    const { jobId } = req.params
    const { sortBy = 'is_cagr', order = 'desc', limit = 1000 } = req.query

    console.log(`[Optimization] GET /:jobId/results - jobId=${jobId}, sortBy=${sortBy}, order=${order}`)

    // Validate sortBy to prevent SQL injection
    const validSortFields = [
      'branch_id',
      'is_cagr', 'is_sharpe', 'is_calmar', 'is_max_drawdown', 'is_sortino', 'is_treynor', 'is_beta', 'is_volatility', 'is_win_rate', 'is_avg_turnover', 'is_avg_holdings', 'is_tim', 'is_timar',
      'oos_cagr', 'oos_sharpe', 'oos_calmar', 'oos_max_drawdown', 'oos_sortino', 'oos_treynor', 'oos_beta', 'oos_volatility', 'oos_win_rate', 'oos_avg_turnover', 'oos_avg_holdings', 'oos_tim', 'oos_timar'
    ]
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'is_cagr'
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC'

    const results = sqlite.prepare(`
      SELECT
        id,
        job_id,
        branch_id,
        parameter_label,
        parameter_values,
        ticker_substitutions,
        condition_ticker,
        position_ticker,
        tree_json,
        is_start_date,
        is_cagr,
        is_sharpe,
        is_calmar,
        is_max_drawdown,
        is_sortino,
        is_treynor,
        is_beta,
        is_volatility,
        is_win_rate,
        is_avg_turnover,
        is_avg_holdings,
        is_tim,
        is_timar,
        oos_start_date,
        oos_cagr,
        oos_sharpe,
        oos_calmar,
        oos_max_drawdown,
        oos_sortino,
        oos_treynor,
        oos_beta,
        oos_volatility,
        oos_win_rate,
        oos_avg_turnover,
        oos_avg_holdings,
        oos_tim,
        oos_timar,
        passed,
        failed_requirements,
        created_at
      FROM optimization_results
      WHERE job_id = ?
      ORDER BY ${sortField} ${sortOrder}
      LIMIT ?
    `).all(jobId, Number(limit))

    // Format results for frontend
    const formatted = results.map(result => ({
      id: result.id,
      jobId: result.job_id,
      branchId: result.branch_id,
      parameterLabel: result.parameter_label,
      parameterValues: JSON.parse(result.parameter_values),
      tickerSubstitutions: result.ticker_substitutions ? JSON.parse(result.ticker_substitutions) : undefined,
      conditionTicker: result.condition_ticker,
      positionTicker: result.position_ticker,
      treeJson: result.tree_json,
      isMetrics: {
        startDate: result.is_start_date,
        cagr: result.is_cagr,
        sharpe: result.is_sharpe,
        calmar: result.is_calmar,
        maxDrawdown: result.is_max_drawdown,
        sortino: result.is_sortino,
        treynor: result.is_treynor,
        beta: result.is_beta,
        volatility: result.is_volatility,
        winRate: result.is_win_rate,
        avgTurnover: result.is_avg_turnover,
        avgHoldings: result.is_avg_holdings,
        tim: result.is_tim,
        timar: result.is_timar,
      },
      oosMetrics: {
        startDate: result.oos_start_date,
        cagr: result.oos_cagr,
        sharpe: result.oos_sharpe,
        calmar: result.oos_calmar,
        maxDrawdown: result.oos_max_drawdown,
        sortino: result.oos_sortino,
        treynor: result.oos_treynor,
        beta: result.oos_beta,
        volatility: result.oos_volatility,
        winRate: result.oos_win_rate,
        avgTurnover: result.oos_avg_turnover,
        avgHoldings: result.oos_avg_holdings,
        tim: result.oos_tim,
        timar: result.oos_timar,
      },
      passed: Boolean(result.passed),
      failedRequirements: result.failed_requirements ? JSON.parse(result.failed_requirements) : [],
      createdAt: result.created_at * 1000, // Convert to ms
    }))

    console.log(`[Optimization] Returning ${formatted.length} results for job ${jobId}`)
    res.json(formatted)
  } catch (error) {
    console.error('[Optimization] Get results error:', error)
    res.status(500).json({ error: 'Failed to fetch results' })
  }
})

/**
 * POST /api/optimization/jobs
 * Save a completed optimization job with all passing branch results
 */
router.post('/jobs', (req, res) => {
  try {
    console.log('[Optimization] POST /jobs received body:', JSON.stringify(req.body, null, 2))

    const {
      botId,
      botName,
      status,
      totalBranches,
      completedBranches,
      passingBranches,
      startTime,
      endTime,
      errorMessage,
      results,
    } = req.body

    console.log('[Optimization] Extracted values - botId:', botId, 'botName:', botName, 'status:', status)

    // Insert job
    const insertJob = sqlite.prepare(`
      INSERT INTO optimization_jobs (
        bot_id, bot_name, status, total_branches, completed_branches,
        passing_branches, start_time, end_time, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const jobResult = insertJob.run(
      botId,
      botName,
      status,
      totalBranches,
      completedBranches,
      passingBranches,
      startTime,
      endTime || null,
      errorMessage || null
    )

    const jobId = jobResult.lastInsertRowid

    // Batch insert results if provided
    if (results && results.length > 0) {
      const insertResult = sqlite.prepare(`
        INSERT INTO optimization_results (
          job_id, branch_id, parameter_label, parameter_values, ticker_substitutions,
          condition_ticker, position_ticker, tree_json,
          is_start_date, is_cagr, is_sharpe, is_calmar, is_max_drawdown, is_sortino, is_treynor,
          is_beta, is_volatility, is_win_rate, is_avg_turnover, is_avg_holdings, is_tim, is_timar,
          oos_start_date, oos_cagr, oos_sharpe, oos_calmar, oos_max_drawdown, oos_sortino, oos_treynor,
          oos_beta, oos_volatility, oos_win_rate, oos_avg_turnover, oos_avg_holdings, oos_tim, oos_timar,
          passed, failed_requirements
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      const insertMany = sqlite.transaction((results) => {
        for (const result of results) {
          insertResult.run(
            jobId,
            result.branchId,
            result.parameterLabel,
            JSON.stringify(result.parameterValues),
            result.tickerSubstitutions ? JSON.stringify(result.tickerSubstitutions) : null,
            result.conditionTicker ?? null,
            result.positionTicker ?? null,
            result.tree ?? null,
            result.isMetrics?.startDate ?? null,
            result.isMetrics?.cagr ?? null,
            result.isMetrics?.sharpe ?? null,
            result.isMetrics?.calmar ?? null,
            result.isMetrics?.maxDrawdown ?? null,
            result.isMetrics?.sortino ?? null,
            result.isMetrics?.treynor ?? null,
            result.isMetrics?.beta ?? null,
            result.isMetrics?.volatility ?? null,
            result.isMetrics?.winRate ?? null,
            result.isMetrics?.avgTurnover ?? null,
            result.isMetrics?.avgHoldings ?? null,
            result.isMetrics?.tim ?? null,
            result.isMetrics?.timar ?? null,
            result.oosMetrics?.startDate ?? null,
            result.oosMetrics?.cagr ?? null,
            result.oosMetrics?.sharpe ?? null,
            result.oosMetrics?.calmar ?? null,
            result.oosMetrics?.maxDrawdown ?? null,
            result.oosMetrics?.sortino ?? null,
            result.oosMetrics?.treynor ?? null,
            result.oosMetrics?.beta ?? null,
            result.oosMetrics?.volatility ?? null,
            result.oosMetrics?.winRate ?? null,
            result.oosMetrics?.avgTurnover ?? null,
            result.oosMetrics?.avgHoldings ?? null,
            result.oosMetrics?.tim ?? null,
            result.oosMetrics?.timar ?? null,
            result.passed ? 1 : 0,
            JSON.stringify(result.failedRequirements || [])
          )
        }
      })

      insertMany(results)
    }

    console.log(`[Optimization] Saved job ${jobId} with ${results?.length || 0} results`)
    res.json({ id: jobId, success: true })
  } catch (error) {
    console.error('[Optimization] Save job error:', error)
    res.status(500).json({ error: 'Failed to save job' })
  }
})

/**
 * PATCH /api/optimization/jobs/:jobId
 * Update job name
 */
router.patch('/jobs/:jobId', (req, res) => {
  try {
    const { jobId } = req.params
    const { name } = req.body

    if (name === undefined) {
      return res.status(400).json({ error: 'Name is required' })
    }

    // Update job name
    const result = sqlite.prepare('UPDATE optimization_jobs SET name = ? WHERE id = ?').run(name || null, jobId)

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Job not found' })
    }

    console.log(`[Optimization] Updated job ${jobId} name to: ${name || '(cleared)'}`)
    res.json({ success: true })
  } catch (error) {
    console.error('[Optimization] Update job name error:', error)
    res.status(500).json({ error: 'Failed to update job name' })
  }
})

/**
 * GET /api/optimization/:jobId/csv
 * Export results as CSV file
 */
router.get('/:jobId/csv', (req, res) => {
  try {
    const { jobId } = req.params

    // Get job info
    const job = sqlite.prepare('SELECT bot_name, created_at FROM optimization_jobs WHERE id = ?').get(jobId)
    if (!job) {
      return res.status(404).json({ error: 'Job not found' })
    }

    // Get results
    const results = sqlite.prepare(`
      SELECT * FROM optimization_results WHERE job_id = ? ORDER BY is_cagr DESC
    `).all(jobId)

    // Extract nodes from tree_json for each result
    const SLOT_ORDER = {
      indicator: ['then', 'else', 'next'],
      basic: ['next'],
      function: ['next'],
      position: [],
      numbered: ['next'],
      altExit: ['next'],
      scaling: ['next']
    }

    function extractNodeParameters(tree) {
      const nodes = []

      function traverse(node, isRoot = false) {
        if (isRoot) {
          const slots = SLOT_ORDER[node.kind] || ['next']
          for (const slotKey of slots) {
            const children = node.children?.[slotKey]
            if (Array.isArray(children)) {
              children.forEach(child => child && traverse(child, false))
            }
          }
          return
        }

        const params = { kind: node.kind }

        switch (node.kind) {
          case 'indicator':
            params.conditions = node.conditions
            params.weighting = node.weighting
            break
          case 'position':
            params.positions = node.positions
            params.weighting = node.weighting
            params.positionMode = node.positionMode
            break
          case 'function':
            params.metric = node.metric
            params.window = node.window
            params.bottom = node.bottom
            params.rank = node.rank
            params.weighting = node.weighting
            break
          case 'numbered':
            params.quantifier = node.quantifier
            params.n = node.n
            params.items = node.items
            params.weighting = node.weighting
            break
          case 'basic':
            params.title = node.title
            params.weighting = node.weighting
            break
          case 'altExit':
            params.entryConditions = node.entryConditions
            params.exitConditions = node.exitConditions
            break
          case 'scaling':
            params.scaleMetric = node.scaleMetric
            params.scaleWindow = node.scaleWindow
            params.scaleTicker = node.scaleTicker
            params.scaleFrom = node.scaleFrom
            params.scaleTo = node.scaleTo
            break
        }

        nodes.push(params)

        const slots = SLOT_ORDER[node.kind] || []
        for (const slotKey of slots) {
          const children = node.children?.[slotKey]
          if (Array.isArray(children)) {
            children.forEach(child => child && traverse(child, false))
          }
        }
      }

      traverse(tree, true)
      return nodes
    }

    const allNodes = results.map(r => {
      if (!r.tree_json) return []
      try {
        const tree = JSON.parse(r.tree_json)
        return extractNodeParameters(tree)
      } catch (e) {
        return []
      }
    })

    const maxNodes = Math.max(...allNodes.map(n => n.length), 0)

    // Generate CSV with dynamic node columns
    const nodeHeaders = Array.from({length: maxNodes}, (_, i) => `Node ${i+1}`)
    const headers = [
      'Branch ID',
      ...nodeHeaders,
      'Passed',
      'IS Start Date',
      'IS CAGR %',
      'IS Sharpe',
      'IS Calmar',
      'IS Max DD %',
      'IS Sortino',
      'IS Treynor',
      'IS Beta',
      'IS Vol %',
      'IS TIM %',
      'IS TIMAR %',
      'IS Win Rate %',
      'IS Avg Turnover %',
      'IS Avg Holdings',
      'OOS Start Date',
      'OOS CAGR %',
      'OOS Sharpe',
      'OOS Calmar',
      'OOS Max DD %',
      'OOS Sortino',
      'OOS Treynor',
      'OOS Beta',
      'OOS Vol %',
      'OOS TIM %',
      'OOS TIMAR %',
      'OOS Win Rate %',
      'OOS Avg Turnover %',
      'OOS Avg Holdings',
      'Failed Requirements',
    ]

    const rows = results.map((r, idx) => {
      const nodes = allNodes[idx]
      const nodeColumns = Array.from({length: maxNodes}, (_, i) =>
        nodes[i] ? JSON.stringify(nodes[i]) : ''
      )
      return [
        r.branch_id,
        ...nodeColumns,
        r.passed ? 'Yes' : 'No',
      r.is_start_date || '',
      r.is_cagr ? (r.is_cagr * 100).toFixed(2) : '',
      r.is_sharpe ? r.is_sharpe.toFixed(2) : '',
      r.is_calmar ? r.is_calmar.toFixed(2) : '',
      r.is_max_drawdown ? (r.is_max_drawdown * 100).toFixed(2) : '',
      r.is_sortino ? r.is_sortino.toFixed(2) : '',
      r.is_treynor ? r.is_treynor.toFixed(2) : '',
      r.is_beta ? r.is_beta.toFixed(2) : '',
      r.is_volatility ? (r.is_volatility * 100).toFixed(2) : '',
      r.is_tim ? (r.is_tim * 100).toFixed(2) : '',
      r.is_timar ? (r.is_timar * 100).toFixed(2) : '',
      r.is_win_rate ? (r.is_win_rate * 100).toFixed(2) : '',
      r.is_avg_turnover ? (r.is_avg_turnover * 100).toFixed(2) : '',
      r.is_avg_holdings ? r.is_avg_holdings.toFixed(2) : '',
      r.oos_start_date || '',
      r.oos_cagr ? (r.oos_cagr * 100).toFixed(2) : '',
      r.oos_sharpe ? r.oos_sharpe.toFixed(2) : '',
      r.oos_calmar ? r.oos_calmar.toFixed(2) : '',
      r.oos_max_drawdown ? (r.oos_max_drawdown * 100).toFixed(2) : '',
      r.oos_sortino ? r.oos_sortino.toFixed(2) : '',
      r.oos_treynor ? r.oos_treynor.toFixed(2) : '',
      r.oos_beta ? r.oos_beta.toFixed(2) : '',
      r.oos_volatility ? (r.oos_volatility * 100).toFixed(2) : '',
      r.oos_tim ? (r.oos_tim * 100).toFixed(2) : '',
      r.oos_timar ? (r.oos_timar * 100).toFixed(2) : '',
      r.oos_win_rate ? (r.oos_win_rate * 100).toFixed(2) : '',
      r.oos_avg_turnover ? (r.oos_avg_turnover * 100).toFixed(2) : '',
      r.oos_avg_holdings ? r.oos_avg_holdings.toFixed(2) : '',
      r.failed_requirements || '',
      ]
    })

    // Escape CSV values (RFC 4180)
    const escapeCsv = (val) => {
      const str = String(val ?? '')
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`
      }
      return str
    }

    const csv = [
      headers.map(escapeCsv).join(','),
      ...rows.map(row => row.map(escapeCsv).join(','))
    ].join('\n')

    // Set headers for file download
    const date = new Date(job.created_at * 1000).toISOString().split('T')[0]
    const filename = `optimization_job_${jobId}_${date}.csv`

    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(csv)
  } catch (error) {
    console.error('[Optimization] CSV export error:', error)
    res.status(500).json({ error: 'Failed to export CSV' })
  }
})

/**
 * POST /api/optimization/rolling
 * Run rolling optimization with expanding window walk-forward
 */
router.get('/rolling', async (req, res) => {
  try {
    // Parse query params (EventSource only supports GET)
    const botId = req.query.botId
    const tree = JSON.parse(req.query.tree || '{}')
    const tickers = JSON.parse(req.query.tickers || '[]')
    const splitConfig = JSON.parse(req.query.splitConfig || '{}')
    const parameterRanges = JSON.parse(req.query.parameterRanges || '[]')

    console.log('[Optimization] GET /rolling - Starting rolling optimization')
    console.log('  Bot ID:', botId)
    console.log('  Tickers:', tickers?.length || 0)
    console.log('  Split Config:', JSON.stringify(splitConfig))
    console.log('  Parameter Ranges:', parameterRanges?.length || 0)

    // Validate inputs
    if (!botId || !tree || !tickers || !splitConfig) {
      return res.status(400).json({ error: 'Missing required fields: botId, tree, tickers, splitConfig' })
    }

    if (splitConfig.strategy !== 'rolling') {
      return res.status(400).json({ error: 'Split config strategy must be "rolling"' })
    }

    // Check for Rolling node in tree
    const hasRollingNode = (node) => {
      if (node.kind === 'rolling') return true
      if (node.children) {
        for (const slot in node.children) {
          const children = node.children[slot]
          if (Array.isArray(children)) {
            for (const child of children) {
              if (child && hasRollingNode(child)) return true
            }
          }
        }
      }
      return false
    }

    if (!hasRollingNode(tree)) {
      return res.status(400).json({ error: 'Tree must contain a Rolling node' })
    }

    // Prepare config for Python rolling optimizer
    const config = {
      tickers,
      tree,
      splitConfig,
      parameterRanges: parameterRanges || [],
      dataDir: process.env.PARQUET_DIR || 'ticker-data/data/ticker_data_parquet'
    }

    // Call Python rolling optimizer
    const { spawn } = await import('child_process')
    const { fileURLToPath } = await import('url')
    const { dirname, join } = await import('path')

    const __filename = fileURLToPath(import.meta.url)
    const __dirname = dirname(__filename)
    const pythonScript = join(__dirname, '../python/rolling_optimizer.py')

    console.log('[Optimization] Spawning Python rolling optimizer...')

    // Set headers for Server-Sent Events
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    const python = spawn('python', [pythonScript, JSON.stringify(config)])

    let stdout = ''
    let stderr = ''

    python.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    python.stderr.on('data', (data) => {
      stderr += data.toString()
      const output = data.toString().trim()

      // Log stderr in real-time for progress tracking
      console.error('[Rolling Optimizer]', output)

      // Try to parse as JSON progress update
      try {
        const parsed = JSON.parse(output)
        if (parsed.type === 'progress') {
          // Send progress update to client via SSE
          res.write(`data: ${JSON.stringify(parsed)}\n\n`)
        }
      } catch (e) {
        // Not JSON, ignore (regular log message)
      }
    })

    python.on('close', (code) => {
      if (code !== 0) {
        console.error('[Optimization] Rolling optimizer failed with code:', code)
        console.error('[Optimization] Stderr:', stderr)
        res.write(`data: ${JSON.stringify({
          type: 'error',
          error: 'Rolling optimization failed',
          stderr: stderr.split('\n').slice(-10).join('\n')
        })}\n\n`)
        res.end()
        return
      }

      // Check if stdout is empty
      if (!stdout || stdout.trim() === '') {
        console.error('[Optimization] Rolling optimizer returned empty output')
        console.error('[Optimization] Stderr:', stderr)
        res.write(`data: ${JSON.stringify({
          type: 'error',
          error: 'Rolling optimizer returned no output',
          stderr: stderr.split('\n').slice(-10).join('\n')
        })}\n\n`)
        res.end()
        return
      }

      try {
        console.log('[Optimization] Parsing stdout:', stdout.substring(0, 200) + '...')
        const result = JSON.parse(stdout)

        if (!result.success) {
          console.error('[Optimization] Rolling optimizer returned error:', result.error)
          res.write(`data: ${JSON.stringify({
            type: 'error',
            error: result.error,
            details: result
          })}\n\n`)
          res.end()
          return
        }

        console.log('[Optimization] Rolling optimization complete')
        console.log('  Valid Tickers:', result.validTickers?.length || 0)
        console.log('  OOS Periods:', result.oosPeriodCount || 0)
        console.log('  Selected Branches:', result.selectedBranches?.length || 0)
        console.log('  OOS Equity Points:', result.oosEquityCurve?.length || 0)
        console.log('  Branches per Period:', result.branchCount || 'N/A')

        // Save rolling results to database
        try {
          const stmt = sqlite.prepare(`
            INSERT INTO rolling_optimization_results (
              bot_id, bot_name, split_config, valid_tickers, ticker_start_dates,
              oos_period_count, selected_branches, oos_trades, oos_metrics, elapsed_seconds
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)

          const info = stmt.run(
            botId,
            'Rolling Optimization', // TODO: Get actual bot name
            JSON.stringify(splitConfig),
            JSON.stringify(result.validTickers),
            JSON.stringify(result.tickerStartDates || {}),
            result.oosPeriodCount,
            JSON.stringify(result.selectedBranches),
            JSON.stringify(result.oosEquityCurve || []),  // Store equity curve instead of trades
            JSON.stringify(result.oosMetrics),
            result.elapsedSeconds
          )

          console.log('[Optimization] Saved rolling results to database with ID:', info.lastInsertRowid)
        } catch (dbError) {
          console.error('[Optimization] Failed to save rolling results to database:', dbError)
          // Don't fail the request, just log the error
        }

        // Send final result via SSE
        res.write(`data: ${JSON.stringify({
          type: 'complete',
          success: true,
          results: {
            validTickers: result.validTickers,
            tickerStartDates: result.tickerStartDates,
            oosPeriodCount: result.oosPeriodCount,
            selectedBranches: result.selectedBranches,
            oosEquityCurve: result.oosEquityCurve,
            oosMetrics: result.oosMetrics,
            elapsedSeconds: result.elapsedSeconds,
            branchCount: result.branchCount
          }
        })}\n\n`)
        res.end()
      } catch (parseError) {
        console.error('[Optimization] Failed to parse Python output:', parseError)
        console.error('[Optimization] Stdout:', stdout)
        res.write(`data: ${JSON.stringify({
          type: 'error',
          error: 'Failed to parse optimizer output',
          stdout: stdout.substring(0, 1000)
        })}\n\n`)
        res.end()
      }
    })

    python.on('error', (error) => {
      console.error('[Optimization] Python spawn error:', error)
      res.write(`data: ${JSON.stringify({
        type: 'error',
        error: 'Failed to start optimizer process'
      })}\n\n`)
      res.end()
    })

  } catch (error) {
    console.error('[Optimization] Rolling optimization error:', error)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Rolling optimization failed: ' + error.message })
    } else {
      res.write(`data: ${JSON.stringify({
        type: 'error',
        error: 'Rolling optimization failed: ' + error.message
      })}\n\n`)
      res.end()
    }
  }
})

export default router
