/**
 * Ticker Lists Routes
 *
 * Handles creation, management, and CSV import/export of ticker lists
 */

import { Router } from 'express'
import { authenticate } from '../middleware/auth.mjs'
import * as db from '../db/index.mjs'

const router = Router()

// All ticker list routes require authentication
router.use(authenticate)

/**
 * GET /api/ticker-lists
 * Get all ticker lists for the authenticated user
 */
router.get('/', async (req, res) => {
  try {
    const lists = await db.getTickerListsByUser(req.user.id)
    res.json(lists)
  } catch (error) {
    console.error('[TickerLists] Get error:', error)
    res.status(500).json({ error: 'Failed to fetch ticker lists' })
  }
})

/**
 * POST /api/ticker-lists
 * Create a new ticker list
 * Body: { name, description?, tags?, tickers[], metadata? }
 */
router.post('/', async (req, res) => {
  try {
    const { name, description, tags, tickers, metadata } = req.body

    if (!name || !tickers || !Array.isArray(tickers) || tickers.length === 0) {
      return res.status(400).json({ error: 'Name and tickers array required' })
    }

    const id = await db.createTickerList({
      userId: req.user.id,
      name,
      description,
      tags: tags || [],
      tickers,
      metadata: metadata || {}
    })

    const created = await db.getTickerListsByUser(req.user.id)
    const list = created.find(l => l.id === id)

    res.status(201).json(list)
  } catch (error) {
    console.error('[TickerLists] Create error:', error)
    res.status(500).json({ error: 'Failed to create ticker list' })
  }
})

/**
 * PUT /api/ticker-lists/:id
 * Update an existing ticker list
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params
    const updated = await db.updateTickerList(id, req.user.id, req.body)

    if (!updated) {
      return res.status(404).json({ error: 'Ticker list not found' })
    }

    const lists = await db.getTickerListsByUser(req.user.id)
    const list = lists.find(l => l.id === id)

    res.json(list)
  } catch (error) {
    console.error('[TickerLists] Update error:', error)
    res.status(500).json({ error: 'Failed to update ticker list' })
  }
})

/**
 * DELETE /api/ticker-lists/:id
 * Delete a ticker list
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params
    const deleted = await db.deleteTickerList(id, req.user.id)

    if (!deleted) {
      return res.status(404).json({ error: 'Ticker list not found' })
    }

    res.json({ success: true })
  } catch (error) {
    console.error('[TickerLists] Delete error:', error)
    res.status(500).json({ error: 'Failed to delete ticker list' })
  }
})

/**
 * POST /api/ticker-lists/import-csv
 * Import ticker list from CSV
 * Body: { csv: string, name: string }
 * Returns: { tickers: string[], metadata: Record<string, TickerMetadata> }
 */
router.post('/import-csv', async (req, res) => {
  try {
    const { csv } = req.body

    if (!csv) {
      return res.status(400).json({ error: 'CSV content required' })
    }

    // Simple CSV parsing (line-by-line)
    const lines = csv.split('\n').map(line => line.trim()).filter(Boolean)
    const tickers = []
    const metadata = {}
    const tags = new Set()

    // Check if first line is header
    const hasHeader = lines[0].toLowerCase().includes('ticker')
    const startIndex = hasHeader ? 1 : 0

    for (let i = startIndex; i < lines.length; i++) {
      const parts = lines[i].split(',').map(p => p.trim())
      const ticker = parts[0]?.toUpperCase()

      if (!ticker) continue

      tickers.push(ticker)
      metadata[ticker] = {
        name: parts[1] || undefined,
        assetType: undefined,
        exchange: undefined
      }

      // Parse tags if present (column 3)
      if (parts[2]) {
        const recordTags = parts[2].split(';').map(t => t.trim()).filter(Boolean)
        recordTags.forEach(tag => tags.add(tag))
      }
    }

    // Fetch Tiingo metadata for all tickers
    try {
      const metadataRes = await fetch(`http://localhost:${process.env.PORT || 8787}/api/tickers/registry/metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers })
      })

      if (metadataRes.ok) {
        const tiingoMetadata = await metadataRes.json()
        // Merge Tiingo metadata
        for (const [ticker, meta] of Object.entries(tiingoMetadata)) {
          if (metadata[ticker]) {
            metadata[ticker] = { ...metadata[ticker], ...meta }
          }
        }
      }
    } catch (err) {
      console.warn('[TickerLists] Failed to fetch Tiingo metadata:', err)
    }

    res.json({
      tickers,
      metadata,
      tags: Array.from(tags)
    })
  } catch (error) {
    console.error('[TickerLists] Import CSV error:', error)
    res.status(500).json({ error: 'Failed to parse CSV' })
  }
})

/**
 * POST /api/ticker-lists/:id/export-csv
 * Export ticker list as CSV
 */
router.post('/:id/export-csv', async (req, res) => {
  try {
    const { id } = req.params
    const lists = await db.getTickerListsByUser(req.user.id)
    const list = lists.find(l => l.id === id)

    if (!list) {
      return res.status(404).json({ error: 'Ticker list not found' })
    }

    // Generate CSV
    let csv = 'Ticker,Name,Tags\n'
    for (const ticker of list.tickers) {
      const name = list.metadata[ticker]?.name || ''
      const tags = list.tags.join(';')
      csv += `${ticker},"${name}","${tags}"\n`
    }

    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename="${list.name}.csv"`)
    res.send(csv)
  } catch (error) {
    console.error('[TickerLists] Export CSV error:', error)
    res.status(500).json({ error: 'Failed to export CSV' })
  }
})

export default router
