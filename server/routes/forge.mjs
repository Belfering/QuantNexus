import express from 'express';
import { atlasDb, resultsDb } from '../db/index.mjs';
import { forgeJobs, forgeConfigs, branches } from '../db/schema.mjs';
import { eq } from 'drizzle-orm';
import { generateBranches, estimateBranchCount } from '../engine/branch-generator.mjs';
import { WorkerPool } from '../engine/worker-pool.mjs';

const router = express.Router();

// Store active worker pools
const activeJobs = new Map();

// POST /api/forge/start - Start branch generation
router.post('/start', async (req, res) => {
  try {
    const { config } = req.body;

    // Save config
    const configResult = await atlasDb.insert(forgeConfigs).values({
      name: `Run ${new Date().toISOString()}`,
      configJson: JSON.stringify(config),
    }).returning();

    // Generate branches
    const branchList = generateBranches(config);
    const totalBranches = branchList.length;

    // Create job
    const jobResult = await atlasDb.insert(forgeJobs).values({
      configId: configResult[0].id,
      status: 'running',
      totalBranches,
      completedBranches: 0,
      passingBranches: 0,
      startedAt: new Date().toISOString(),
    }).returning();

    const jobId = jobResult[0].id;

    // Start worker pool
    const pool = new WorkerPool(config.numWorkers);
    activeJobs.set(jobId, pool);

    // Progress callback
    pool.onProgress = async (progress) => {
      await atlasDb.update(forgeJobs)
        .set({
          completedBranches: progress.completed,
          passingBranches: progress.passing,
        })
        .where(eq(forgeJobs.id, jobId));
    };

    // Completion callback
    pool.onComplete = async (summary) => {
      console.log(`Job ${jobId} complete:`, summary);

      // Save passing branches to results.db
      for (const result of summary.results) {
        await resultsDb.insert(branches).values({
          jobId,
          signalTicker: result.signal_ticker,
          investTicker: result.invest_ticker,
          indicator: result.indicator,
          period: result.period,
          comparator: result.comparator,
          threshold: result.threshold,
          l2Indicator: result.l2_indicator || null,
          l2Period: result.l2_period || null,
          l2Comparator: result.l2_comparator || null,
          l2Threshold: result.l2_threshold || null,
          // IS metrics
          isTim: result.is_metrics.TIM,
          isTimar: result.is_metrics.TIMAR,
          isMaxdd: result.is_metrics.MaxDD,
          isCagr: result.is_metrics.CAGR,
          isTrades: result.is_metrics.Trades,
          isAvgHold: result.is_metrics.AvgHold,
          isDd3: result.is_metrics.DD3,
          isTimar3: result.is_metrics.TIMAR3,
          isDd50: result.is_metrics.DD50,
          isDd95: result.is_metrics.DD95,
          // OOS metrics
          oosTim: result.oos_metrics.TIM,
          oosTimar: result.oos_metrics.TIMAR,
          oosMaxdd: result.oos_metrics.MaxDD,
          oosCagr: result.oos_metrics.CAGR,
          oosTrades: result.oos_metrics.Trades,
          oosAvgHold: result.oos_metrics.AvgHold,
          oosDd3: result.oos_metrics.DD3,
          oosTimar3: result.oos_metrics.TIMAR3,
          oosDd50: result.oos_metrics.DD50,
          oosDd95: result.oos_metrics.DD95,
        });
      }

      await atlasDb.update(forgeJobs)
        .set({
          status: 'completed',
          completedAt: new Date().toISOString(),
        })
        .where(eq(forgeJobs.id, jobId));

      activeJobs.delete(jobId);
    };

    // Error callback
    pool.onError = async (error) => {
      console.error(`Job ${jobId} error:`, error);
      await atlasDb.update(forgeJobs)
        .set({
          status: 'failed',
          error: error.message,
          completedAt: new Date().toISOString(),
        })
        .where(eq(forgeJobs.id, jobId));
    };

    // Add tasks and start
    pool.addTasks(branchList, config);
    pool.start();

    res.json({ success: true, jobId, totalBranches });
  } catch (error) {
    console.error('Error starting forge job:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/forge/cancel/:jobId - Cancel job
router.post('/cancel/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const jobIdInt = parseInt(jobId);

    // Cancel worker pool if active
    const pool = activeJobs.get(jobIdInt);
    if (pool) {
      pool.cancel();
      activeJobs.delete(jobIdInt);
    }

    await atlasDb.update(forgeJobs)
      .set({
        status: 'cancelled',
        completedAt: new Date().toISOString(),
      })
      .where(eq(forgeJobs.id, jobIdInt));

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/forge/status/:jobId - Get job status (polling endpoint)
router.get('/status/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await atlasDb.select()
      .from(forgeJobs)
      .where(eq(forgeJobs.id, parseInt(jobId)))
      .limit(1);

    if (job.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Add real-time info from worker pool if active
    const pool = activeJobs.get(parseInt(jobId));
    const status = job[0];

    if (pool) {
      const poolStatus = pool.getStatus();
      status.realtime = poolStatus;
    }

    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/forge/stream/:jobId - SSE stream for real-time progress
router.get('/stream/:jobId', async (req, res) => {
  const { jobId } = req.params;
  const jobIdInt = parseInt(jobId);

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Send initial status
  const job = await atlasDb.select()
    .from(forgeJobs)
    .where(eq(forgeJobs.id, jobIdInt))
    .limit(1);

  if (job.length === 0) {
    res.write(`data: ${JSON.stringify({ error: 'Job not found' })}\n\n`);
    res.end();
    return;
  }

  // Stream updates
  const interval = setInterval(async () => {
    try {
      const currentJob = await atlasDb.select()
        .from(forgeJobs)
        .where(eq(forgeJobs.id, jobIdInt))
        .limit(1);

      if (currentJob.length === 0) {
        clearInterval(interval);
        res.end();
        return;
      }

      const status = currentJob[0];

      // Add real-time info from worker pool
      const pool = activeJobs.get(jobIdInt);
      if (pool) {
        const poolStatus = pool.getStatus();
        status.realtime = poolStatus;
      }

      res.write(`data: ${JSON.stringify(status)}\n\n`);

      // End stream if job is done
      if (['completed', 'failed', 'cancelled'].includes(status.status)) {
        clearInterval(interval);
        res.end();
      }
    } catch (error) {
      console.error('SSE error:', error);
      clearInterval(interval);
      res.end();
    }
  }, 1000); // Update every second

  // Clean up on client disconnect
  req.on('close', () => {
    clearInterval(interval);
  });
});

// POST /api/forge/estimate - Estimate branch count & ETA
router.post('/estimate', async (req, res) => {
  try {
    const { config } = req.body;
    const totalBranches = estimateBranchCount(config);

    // Estimate speed: 10-50 branches/sec
    const avgSpeed = 20; // branches/sec
    const estimatedSeconds = Math.ceil(totalBranches / avgSpeed);
    const estimatedMinutes = Math.ceil(estimatedSeconds / 60);

    res.json({
      totalBranches,
      estimatedSeconds,
      estimatedMinutes,
      branchesPerSecond: avgSpeed,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/forge/configs - Save config preset
router.post('/configs', async (req, res) => {
  try {
    const { name, config } = req.body;
    const result = await atlasDb.insert(forgeConfigs).values({
      name,
      configJson: JSON.stringify(config),
    }).returning();
    res.json({ success: true, config: result[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/forge/configs - List saved presets
router.get('/configs', async (req, res) => {
  try {
    const configs = await atlasDb.select().from(forgeConfigs);
    const parsed = configs.map(c => ({
      ...c,
      config: JSON.parse(c.configJson),
    }));
    res.json(parsed);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
