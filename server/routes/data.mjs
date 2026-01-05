import express from 'express';
import { atlasDb } from '../db/index.mjs';
import { downloadJobs, tickerLists } from '../db/schema.mjs';
import { eq } from 'drizzle-orm';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// POST /api/data/download - Queue ticker download
router.post('/download', async (req, res) => {
  try {
    const { ticker, startDate, endDate } = req.body;

    // Insert download job
    const result = await atlasDb.insert(downloadJobs).values({
      ticker,
      startDate,
      endDate,
      status: 'pending',
    }).returning();

    const jobId = result[0].id;

    // Trigger Python download script in background
    const pythonScript = path.join(__dirname, '../../python/download_data.py');
    const params = JSON.stringify({ ticker, start_date: startDate, end_date: endDate });

    const python = spawn('python', [pythonScript, params]);

    python.stdout.on('data', async (data) => {
      try {
        const downloadResult = JSON.parse(data.toString());

        if (downloadResult.success) {
          await atlasDb.update(downloadJobs)
            .set({
              status: 'completed',
              filePath: downloadResult.file_path,
              completedAt: new Date().toISOString(),
            })
            .where(eq(downloadJobs.id, jobId));
        } else {
          await atlasDb.update(downloadJobs)
            .set({
              status: 'failed',
              error: downloadResult.error,
              completedAt: new Date().toISOString(),
            })
            .where(eq(downloadJobs.id, jobId));
        }
      } catch (error) {
        console.error('Error parsing download result:', error);
      }
    });

    python.on('error', async (error) => {
      await atlasDb.update(downloadJobs)
        .set({
          status: 'failed',
          error: error.message,
          completedAt: new Date().toISOString(),
        })
        .where(eq(downloadJobs.id, jobId));
    });

    res.json({ success: true, job: result[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/data/downloads - List download jobs
router.get('/downloads', async (req, res) => {
  try {
    const jobs = await atlasDb.select().from(downloadJobs).orderBy(downloadJobs.createdAt);
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/data/downloads/:id - Cancel download
router.delete('/downloads/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await atlasDb.update(downloadJobs)
      .set({ status: 'cancelled' })
      .where(eq(downloadJobs.id, parseInt(id)));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/data/tickers - List available parquet files
router.get('/tickers', async (req, res) => {
  try {
    const parquetDir = path.join(__dirname, '../../data/parquet');
    const files = await fs.readdir(parquetDir);
    const parquetFiles = files
      .filter(f => f.endsWith('.parquet'))
      .map(f => f.replace('.parquet', ''));
    res.json({ tickers: parquetFiles });
  } catch (error) {
    res.json({ tickers: [] });
  }
});

// POST /api/data/ticker-lists - Create/update ticker list
router.post('/ticker-lists', async (req, res) => {
  try {
    const { name, type, tickers } = req.body;
    const result = await atlasDb.insert(tickerLists).values({
      name,
      type,
      tickers: JSON.stringify(tickers),
    }).returning();
    res.json({ success: true, list: result[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/data/ticker-lists - Get all lists
router.get('/ticker-lists', async (req, res) => {
  try {
    const lists = await atlasDb.select().from(tickerLists);
    const parsed = lists.map(list => ({
      ...list,
      tickers: JSON.parse(list.tickers),
    }));
    res.json(parsed);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
