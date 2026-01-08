// server/routes/admin-invites.mjs
// Admin routes for managing invite codes and waitlist

import express from 'express'
import crypto from 'crypto'
import { sqlite } from '../db/index.mjs'
import { authenticate, requireAdmin } from '../middleware/auth.mjs'

const router = express.Router()

// All routes require admin authentication
router.use(authenticate, requireAdmin)

/**
 * GET /api/admin/invites/stats
 * Get invite and waitlist statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const pending = sqlite.prepare(`
      SELECT COUNT(*) as count FROM waitlist_entries WHERE status = 'pending'
    `).get()

    const invited = sqlite.prepare(`
      SELECT COUNT(*) as count FROM waitlist_entries WHERE status = 'invited'
    `).get()

    const registered = sqlite.prepare(`
      SELECT COUNT(*) as count FROM waitlist_entries WHERE status = 'registered'
    `).get()

    const activeInvites = sqlite.prepare(`
      SELECT COUNT(*) as count FROM invite_codes
      WHERE use_count < max_uses AND (expires_at IS NULL OR expires_at > datetime('now'))
    `).get()

    const totalUsers = sqlite.prepare(`
      SELECT COUNT(*) as count FROM users WHERE status = 'active'
    `).get()

    res.json({
      waitlist: {
        pending: pending.count,
        invited: invited.count,
        registered: registered.count,
        total: pending.count + invited.count + registered.count
      },
      invites: {
        active: activeInvites.count
      },
      users: {
        active: totalUsers.count
      }
    })
  } catch (err) {
    console.error('Stats error:', err)
    res.status(500).json({ error: 'Failed to get stats' })
  }
})

/**
 * POST /api/admin/invites/send-batch
 * Send invite codes to next N waitlist users
 */
router.post('/send-batch', async (req, res) => {
  const { count = 10 } = req.body

  if (count < 1 || count > 100) {
    return res.status(400).json({ error: 'Count must be between 1 and 100' })
  }

  try {
    // Get pending waitlist entries in order
    const pending = sqlite.prepare(`
      SELECT * FROM waitlist_entries
      WHERE status = 'pending'
      ORDER BY position ASC
      LIMIT ?
    `).all(count)

    if (pending.length === 0) {
      return res.json({
        success: true,
        message: 'No pending waitlist entries',
        invitesSent: 0,
        invites: []
      })
    }

    const results = []

    for (const entry of pending) {
      // Generate unique invite code
      const code = crypto.randomBytes(16).toString('hex')
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

      // Create invite code
      sqlite.prepare(`
        INSERT INTO invite_codes (code, waitlist_id, created_by, max_uses, use_count, expires_at, created_at)
        VALUES (?, ?, ?, 1, 0, ?, datetime('now'))
      `).run(code, entry.id, req.user.id, expiresAt.toISOString())

      // Update waitlist status
      sqlite.prepare(`
        UPDATE waitlist_entries SET status = 'invited', invited_at = datetime('now') WHERE id = ?
      `).run(entry.id)

      // TODO: Send email via Resend when configured
      // For now, just return the codes

      results.push({
        email: entry.email,
        code,
        position: entry.position,
        registerUrl: `https://quantnexus.io/register?code=${code}`
      })
    }

    res.json({
      success: true,
      invitesSent: results.length,
      invites: results
    })
  } catch (err) {
    console.error('Send batch error:', err)
    res.status(500).json({ error: 'Failed to send invites' })
  }
})

/**
 * POST /api/admin/invites/create
 * Create a standalone invite code (not linked to waitlist)
 */
router.post('/create', async (req, res) => {
  const { maxUses = 1, expiresInDays = 7, note } = req.body

  try {
    const code = crypto.randomBytes(16).toString('hex')
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
      : null

    sqlite.prepare(`
      INSERT INTO invite_codes (code, waitlist_id, created_by, max_uses, use_count, expires_at, created_at)
      VALUES (?, NULL, ?, ?, 0, ?, datetime('now'))
    `).run(code, req.user.id, maxUses, expiresAt)

    res.json({
      success: true,
      code,
      maxUses,
      expiresAt,
      registerUrl: `https://quantnexus.io/register?code=${code}`,
      note
    })
  } catch (err) {
    console.error('Create invite error:', err)
    res.status(500).json({ error: 'Failed to create invite' })
  }
})

/**
 * GET /api/admin/invites/list
 * List all invite codes with pagination
 */
router.get('/list', async (req, res) => {
  const { page = 1, limit = 50, status = 'all' } = req.query

  try {
    const offset = (page - 1) * limit

    let whereClause = ''
    if (status === 'active') {
      whereClause = 'WHERE ic.use_count < ic.max_uses AND (ic.expires_at IS NULL OR ic.expires_at > datetime("now"))'
    } else if (status === 'used') {
      whereClause = 'WHERE ic.use_count >= ic.max_uses'
    } else if (status === 'expired') {
      whereClause = 'WHERE ic.expires_at IS NOT NULL AND ic.expires_at <= datetime("now")'
    }

    const invites = sqlite.prepare(`
      SELECT
        ic.*,
        we.email as waitlist_email,
        we.position as waitlist_position,
        u.username as created_by_username
      FROM invite_codes ic
      LEFT JOIN waitlist_entries we ON ic.waitlist_id = we.id
      LEFT JOIN users u ON ic.created_by = u.id
      ${whereClause}
      ORDER BY ic.created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset)

    const total = sqlite.prepare(`
      SELECT COUNT(*) as count FROM invite_codes ic ${whereClause}
    `).get()

    res.json({
      invites,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: total.count,
        pages: Math.ceil(total.count / limit)
      }
    })
  } catch (err) {
    console.error('List invites error:', err)
    res.status(500).json({ error: 'Failed to list invites' })
  }
})

/**
 * DELETE /api/admin/invites/:code
 * Delete/revoke an invite code
 */
router.delete('/:code', async (req, res) => {
  const { code } = req.params

  try {
    const invite = sqlite.prepare(`SELECT * FROM invite_codes WHERE code = ?`).get(code)

    if (!invite) {
      return res.status(404).json({ error: 'Invite code not found' })
    }

    if (invite.use_count > 0) {
      return res.status(400).json({ error: 'Cannot delete an invite code that has been used' })
    }

    // Revert waitlist status if linked
    if (invite.waitlist_id) {
      sqlite.prepare(`
        UPDATE waitlist_entries SET status = 'pending', invited_at = NULL WHERE id = ?
      `).run(invite.waitlist_id)
    }

    sqlite.prepare(`DELETE FROM invite_codes WHERE code = ?`).run(code)

    res.json({ success: true })
  } catch (err) {
    console.error('Delete invite error:', err)
    res.status(500).json({ error: 'Failed to delete invite' })
  }
})

/**
 * GET /api/admin/waitlist
 * Get waitlist entries with pagination
 */
router.get('/waitlist', async (req, res) => {
  const { page = 1, limit = 50, status = 'all' } = req.query

  try {
    const offset = (page - 1) * limit

    let whereClause = ''
    if (status !== 'all') {
      whereClause = `WHERE status = '${status}'`
    }

    const entries = sqlite.prepare(`
      SELECT * FROM waitlist_entries
      ${whereClause}
      ORDER BY position ASC
      LIMIT ? OFFSET ?
    `).all(limit, offset)

    const total = sqlite.prepare(`
      SELECT COUNT(*) as count FROM waitlist_entries ${whereClause}
    `).get()

    res.json({
      entries,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: total.count,
        pages: Math.ceil(total.count / limit)
      }
    })
  } catch (err) {
    console.error('List waitlist error:', err)
    res.status(500).json({ error: 'Failed to list waitlist' })
  }
})

export default router
