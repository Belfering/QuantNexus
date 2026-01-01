// server/routes/auth.mjs
// Authentication routes: register, login, logout, token refresh

import express from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { db, sqlite } from '../db/index.mjs'
import { JWT_SECRET } from '../middleware/auth.mjs'
import { sendVerificationEmail } from '../services/email.mjs'

const router = express.Router()

const REFRESH_SECRET = process.env.REFRESH_SECRET || 'dev-refresh-secret-change-in-production'

/**
 * POST /api/auth/register
 * Register with invite code (required during alpha/beta phases)
 */
router.post('/register', async (req, res) => {
  const { email, password, inviteCode, username } = req.body

  // Validate required fields
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' })
  }

  if (!inviteCode) {
    return res.status(400).json({ error: 'Invite code is required during beta' })
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' })
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' })
  }

  try {
    // Verify invite code exists and is valid
    const code = sqlite.prepare(`
      SELECT * FROM invite_codes
      WHERE code = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
    `).get(inviteCode)

    if (!code) {
      return res.status(400).json({ error: 'Invalid or expired invite code' })
    }

    if (code.use_count >= code.max_uses) {
      return res.status(400).json({ error: 'Invite code has already been used' })
    }

    // Check if invite code is linked to a waitlist entry
    if (code.waitlist_id) {
      const waitlistEntry = sqlite.prepare(`
        SELECT email FROM waitlist_entries WHERE id = ?
      `).get(code.waitlist_id)

      if (waitlistEntry && waitlistEntry.email.toLowerCase() !== email.toLowerCase()) {
        return res.status(400).json({ error: 'Email does not match the invite' })
      }
    }

    // Check if email is already registered
    const existingUser = sqlite.prepare(`
      SELECT id FROM users WHERE email = ?
    `).get(email.toLowerCase())

    if (existingUser) {
      return res.status(409).json({ error: 'Email is already registered' })
    }

    // Check if username is taken (if provided)
    const finalUsername = username || email.split('@')[0] + '_' + crypto.randomBytes(2).toString('hex')
    const existingUsername = sqlite.prepare(`
      SELECT id FROM users WHERE username = ?
    `).get(finalUsername)

    if (existingUsername) {
      return res.status(409).json({ error: 'Username is already taken' })
    }

    // Create user
    const userId = crypto.randomUUID()
    const passwordHash = await bcrypt.hash(password, 12)

    sqlite.prepare(`
      INSERT INTO users (id, username, password_hash, email, email_verified, status, tier, role, invite_code_used, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, 'pending_verification', 'free', 'user', ?, datetime('now'), datetime('now'))
    `).run(userId, finalUsername, passwordHash, email.toLowerCase(), inviteCode)

    // Mark invite code as used
    sqlite.prepare(`
      UPDATE invite_codes SET use_count = use_count + 1 WHERE id = ?
    `).run(code.id)

    // Update waitlist status if linked
    if (code.waitlist_id) {
      sqlite.prepare(`
        UPDATE waitlist_entries SET status = 'registered', registered_at = datetime('now') WHERE id = ?
      `).run(code.waitlist_id)
    }

    // Create email verification token
    const verifyToken = crypto.randomBytes(32).toString('hex')
    sqlite.prepare(`
      INSERT INTO email_verification_tokens (user_id, token, expires_at, created_at)
      VALUES (?, ?, datetime('now', '+24 hours'), datetime('now'))
    `).run(userId, verifyToken)

    // Send verification email
    const emailSent = await sendVerificationEmail(email.toLowerCase(), verifyToken)

    // Auto-verify in development if email not configured
    if (!emailSent && process.env.NODE_ENV !== 'production') {
      sqlite.prepare(`
        UPDATE users SET email_verified = 1, status = 'active' WHERE id = ?
      `).run(userId)
    }

    res.json({
      success: true,
      message: emailSent
        ? 'Account created! Please check your email to verify.'
        : 'Account created and verified (dev mode).',
      userId
    })
  } catch (err) {
    console.error('Registration error:', err)
    res.status(500).json({ error: 'Registration failed' })
  }
})

/**
 * POST /api/auth/login
 * Login with email/password, returns JWT tokens
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' })
  }

  try {
    const user = sqlite.prepare(`
      SELECT id, username, email, password_hash, role, tier, status, email_verified, display_name
      FROM users
      WHERE email = ?
    `).get(email.toLowerCase())

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const validPassword = await bcrypt.compare(password, user.password_hash)
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    // Check email verification (skip in dev mode)
    if (process.env.NODE_ENV === 'production' && !user.email_verified) {
      return res.status(403).json({ error: 'Please verify your email first' })
    }

    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Account is not active' })
    }

    // Generate access token (short-lived)
    const accessToken = jwt.sign(
      { sub: user.id, email: user.email, tier: user.tier, role: user.role },
      JWT_SECRET,
      { expiresIn: '15m' }
    )

    // Generate refresh token (long-lived)
    const refreshToken = crypto.randomBytes(64).toString('hex')
    const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex')

    // Store refresh token in database
    sqlite.prepare(`
      INSERT INTO user_sessions (user_id, refresh_token_hash, device_info, ip_address, expires_at, created_at, last_used_at)
      VALUES (?, ?, ?, ?, datetime('now', '+7 days'), datetime('now'), datetime('now'))
    `).run(user.id, refreshTokenHash, req.headers['user-agent'] || null, req.ip || null)

    // Update last login
    sqlite.prepare(`
      UPDATE users SET last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?
    `).run(user.id)

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.display_name,
        tier: user.tier,
        role: user.role
      }
    })
  } catch (err) {
    console.error('Login error:', err)
    res.status(500).json({ error: 'Login failed' })
  }
})

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 */
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body

  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token required' })
  }

  try {
    const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex')

    const session = sqlite.prepare(`
      SELECT * FROM user_sessions
      WHERE refresh_token_hash = ? AND expires_at > datetime('now')
    `).get(refreshTokenHash)

    if (!session) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' })
    }

    const user = sqlite.prepare(`
      SELECT id, email, tier, role, status FROM users WHERE id = ?
    `).get(session.user_id)

    if (!user || user.status !== 'active') {
      return res.status(401).json({ error: 'User not found or inactive' })
    }

    // Generate new access token
    const accessToken = jwt.sign(
      { sub: user.id, email: user.email, tier: user.tier, role: user.role },
      JWT_SECRET,
      { expiresIn: '15m' }
    )

    // Update session last used
    sqlite.prepare(`
      UPDATE user_sessions SET last_used_at = datetime('now') WHERE id = ?
    `).run(session.id)

    res.json({ accessToken })
  } catch (err) {
    console.error('Token refresh error:', err)
    res.status(500).json({ error: 'Token refresh failed' })
  }
})

/**
 * POST /api/auth/logout
 * Invalidate refresh token
 */
router.post('/logout', async (req, res) => {
  const { refreshToken } = req.body

  if (refreshToken) {
    try {
      const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex')
      sqlite.prepare(`DELETE FROM user_sessions WHERE refresh_token_hash = ?`).run(refreshTokenHash)
    } catch (err) {
      console.error('Logout error:', err)
    }
  }

  res.json({ success: true })
})

/**
 * POST /api/auth/verify-email
 * Verify email with token from email link
 */
router.post('/verify-email', async (req, res) => {
  const { token } = req.body

  if (!token) {
    return res.status(400).json({ error: 'Verification token required' })
  }

  try {
    const verification = sqlite.prepare(`
      SELECT * FROM email_verification_tokens
      WHERE token = ? AND expires_at > datetime('now')
    `).get(token)

    if (!verification) {
      return res.status(400).json({ error: 'Invalid or expired verification token' })
    }

    // Mark email as verified and activate user
    sqlite.prepare(`
      UPDATE users SET email_verified = 1, status = 'active', updated_at = datetime('now')
      WHERE id = ?
    `).run(verification.user_id)

    // Delete used token
    sqlite.prepare(`DELETE FROM email_verification_tokens WHERE id = ?`).run(verification.id)

    res.json({ success: true, message: 'Email verified successfully!' })
  } catch (err) {
    console.error('Email verification error:', err)
    res.status(500).json({ error: 'Verification failed' })
  }
})

/**
 * POST /api/auth/resend-verification
 * Resend email verification link
 */
router.post('/resend-verification', async (req, res) => {
  const { email } = req.body

  if (!email) {
    return res.status(400).json({ error: 'Email is required' })
  }

  try {
    const user = sqlite.prepare(`
      SELECT id, email, email_verified, status FROM users WHERE email = ?
    `).get(email.toLowerCase())

    // Always return success to prevent email enumeration
    if (!user) {
      return res.json({ success: true, message: 'If an unverified account exists, a new verification link will be sent.' })
    }

    // Already verified
    if (user.email_verified) {
      return res.json({ success: true, message: 'If an unverified account exists, a new verification link will be sent.' })
    }

    // Delete any existing verification tokens for this user
    sqlite.prepare(`DELETE FROM email_verification_tokens WHERE user_id = ?`).run(user.id)

    // Create new verification token
    const verifyToken = crypto.randomBytes(32).toString('hex')
    sqlite.prepare(`
      INSERT INTO email_verification_tokens (user_id, token, expires_at, created_at)
      VALUES (?, ?, datetime('now', '+24 hours'), datetime('now'))
    `).run(user.id, verifyToken)

    // Send verification email
    await sendVerificationEmail(email.toLowerCase(), verifyToken)

    res.json({ success: true, message: 'If an unverified account exists, a new verification link will be sent.' })
  } catch (err) {
    console.error('Resend verification error:', err)
    res.status(500).json({ error: 'Failed to resend verification email' })
  }
})

/**
 * GET /api/auth/me
 * Get current user info (requires authentication)
 */
router.get('/me', async (req, res) => {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  try {
    const token = authHeader.split(' ')[1]
    const payload = jwt.verify(token, JWT_SECRET)

    const user = sqlite.prepare(`
      SELECT id, username, email, display_name, role, tier, status, created_at
      FROM users WHERE id = ?
    `).get(payload.sub)

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      tier: user.tier,
      status: user.status,
      createdAt: user.created_at
    })
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' })
    }
    return res.status(401).json({ error: 'Invalid token' })
  }
})

export default router
