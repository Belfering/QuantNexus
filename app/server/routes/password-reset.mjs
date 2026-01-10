// server/routes/password-reset.mjs
// Password reset routes

import express from 'express'
import bcrypt from 'bcrypt'
import crypto from 'crypto'
import { sqlite } from '../db/index.mjs'
import { sendPasswordResetEmail } from '../services/email.mjs'

const router = express.Router()

/**
 * POST /api/auth/forgot-password
 * Request password reset email
 */
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body

  if (!email) {
    return res.status(400).json({ error: 'Email is required' })
  }

  try {
    const user = sqlite.prepare(`
      SELECT id, email FROM users WHERE email = ?
    `).get(email.toLowerCase())

    // Always return success to prevent email enumeration
    if (!user) {
      return res.json({ success: true, message: 'If an account exists, a reset link will be sent.' })
    }

    // Create password reset token
    const resetToken = crypto.randomBytes(32).toString('hex')
    const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex')

    // Store reset token (expires in 1 hour)
    sqlite.prepare(`
      INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at)
      VALUES (?, ?, datetime('now', '+1 hour'), datetime('now'))
    `).run(user.id, resetTokenHash)

    // Send password reset email
    await sendPasswordResetEmail(email.toLowerCase(), resetToken)

    res.json({ success: true, message: 'If an account exists, a reset link will be sent.' })
  } catch (err) {
    console.error('Forgot password error:', err)
    res.status(500).json({ error: 'Failed to process request' })
  }
})

/**
 * POST /api/auth/reset-password
 * Reset password using token from email
 */
router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body

  if (!token || !newPassword) {
    return res.status(400).json({ error: 'Token and new password are required' })
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' })
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

    const resetRecord = sqlite.prepare(`
      SELECT * FROM password_reset_tokens
      WHERE token_hash = ? AND expires_at > datetime('now') AND used_at IS NULL
    `).get(tokenHash)

    if (!resetRecord) {
      return res.status(400).json({ error: 'Invalid or expired reset token' })
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 12)

    // Update user's password
    sqlite.prepare(`
      UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?
    `).run(passwordHash, resetRecord.user_id)

    // Mark token as used
    sqlite.prepare(`
      UPDATE password_reset_tokens SET used_at = datetime('now') WHERE id = ?
    `).run(resetRecord.id)

    // Invalidate all existing sessions for security
    sqlite.prepare(`
      DELETE FROM user_sessions WHERE user_id = ?
    `).run(resetRecord.user_id)

    res.json({ success: true, message: 'Password has been reset successfully.' })
  } catch (err) {
    console.error('Reset password error:', err)
    res.status(500).json({ error: 'Failed to reset password' })
  }
})

export default router
