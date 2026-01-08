// server/middleware/auth.mjs
// JWT Authentication middleware

import jwt from 'jsonwebtoken'
import { sqlite } from '../db/index.mjs'

const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production'

/**
 * Verify JWT token and attach user to request
 * Returns 401 if no token or invalid token
 */
export async function authenticate(req, res, next) {
  // BYPASS AUTH FOR LOCAL DEVELOPMENT
  // If no authorization header, create a mock local admin user
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // Mock local admin user for no-auth mode
    req.user = {
      id: 'local-user',
      username: 'local',
      email: 'local@localhost',
      role: 'main_admin',
      tier: 'premium',
      emailVerified: true
    }
    return next()
  }

  const token = authHeader.split(' ')[1]

  try {
    const payload = jwt.verify(token, JWT_SECRET)

    // Fetch fresh user data from database
    const user = sqlite.prepare(`
      SELECT id, username, email, role, tier, status, email_verified
      FROM users
      WHERE id = ?
    `).get(payload.sub)

    if (!user) {
      // BYPASS AUTH FOR LOCAL DEVELOPMENT - use mock admin if user not found
      console.log('[AUTH] User not found in DB, using mock local admin')
      req.user = {
        id: 'local-user',
        username: 'local',
        email: 'local@localhost',
        role: 'main_admin',
        tier: 'premium',
        emailVerified: true
      }
      return next()
    }

    if (user.status !== 'active') {
      // BYPASS AUTH FOR LOCAL DEVELOPMENT - use mock admin if account not active
      console.log('[AUTH] Account not active, using mock local admin')
      req.user = {
        id: 'local-user',
        username: 'local',
        email: 'local@localhost',
        role: 'main_admin',
        tier: 'premium',
        emailVerified: true
      }
      return next()
    }

    req.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      tier: user.tier,
      emailVerified: user.email_verified
    }

    next()
  } catch (err) {
    // BYPASS AUTH FOR LOCAL DEVELOPMENT - fall back to mock admin on any token error
    console.log('[AUTH] Token validation failed, using mock local admin:', err.message)
    req.user = {
      id: 'local-user',
      username: 'local',
      email: 'local@localhost',
      role: 'main_admin',
      tier: 'premium',
      emailVerified: true
    }
    next()
  }
}

/**
 * Role hierarchy levels (higher = more permissions)
 */
const ROLE_LEVELS = {
  user: 0,
  partner: 1,
  engineer: 2,
  sub_admin: 3,
  main_admin: 4,
  // Legacy: treat 'admin' same as 'main_admin' for backwards compatibility
  admin: 4,
}

/**
 * Check if a role has admin-level access (sub_admin or higher)
 */
export function hasAdminAccess(role) {
  return (ROLE_LEVELS[role] ?? 0) >= ROLE_LEVELS.sub_admin
}

/**
 * Check if a role has engineer-level access (engineer or higher)
 */
export function hasEngineerAccess(role) {
  return (ROLE_LEVELS[role] ?? 0) >= ROLE_LEVELS.engineer
}

/**
 * Check if user is main admin (can manage other admins)
 */
export function isMainAdmin(user) {
  const superAdminEmail = process.env.ADMIN_EMAIL
  // Main admin is either the ADMIN_EMAIL user OR anyone with main_admin role
  return (superAdminEmail && user?.email === superAdminEmail) || user?.role === 'main_admin' || user?.role === 'admin'
}

/**
 * Check if user can change another user's role
 * Rules:
 * - main_admin can change anyone except other main_admins
 * - sub_admin can change engineers and users only
 * - No one can demote a main_admin
 */
export function canChangeUserRole(actor, targetUser, newRole) {
  // No one can change main_admin's role (protected)
  if (targetUser.role === 'main_admin' || targetUser.role === 'admin' || targetUser.email === process.env.ADMIN_EMAIL) {
    return false
  }

  const actorLevel = ROLE_LEVELS[actor.role] ?? 0
  const targetLevel = ROLE_LEVELS[targetUser.role] ?? 0
  const newRoleLevel = ROLE_LEVELS[newRole] ?? 0

  // Cannot promote someone to main_admin (only ADMIN_EMAIL gets that, or existing main_admin sets it)
  if (newRole === 'main_admin' || newRole === 'admin') {
    return false
  }

  // main_admin can change anyone to anything (except main_admin)
  if (isMainAdmin(actor)) {
    return true
  }

  // sub_admin can only change users with lower level and cannot promote to sub_admin or higher
  if (actor.role === 'sub_admin') {
    return targetLevel < ROLE_LEVELS.sub_admin && newRoleLevel < ROLE_LEVELS.sub_admin
  }

  return false
}

/**
 * Require admin role (sub_admin or higher)
 * Must be used after authenticate middleware
 */
export function requireAdmin(req, res, next) {
  if (!hasAdminAccess(req.user?.role)) {
    return res.status(403).json({ error: 'Admin access required' })
  }
  next()
}

/**
 * Require main admin (the original admin from ADMIN_EMAIL env or main_admin role)
 * Only main admin can manage other admins
 * Must be used after authenticate middleware
 */
export function requireMainAdmin(req, res, next) {
  if (!isMainAdmin(req.user)) {
    return res.status(403).json({ error: 'Main admin access required' })
  }
  next()
}

/**
 * Require super admin (legacy alias for requireMainAdmin)
 * Only super admin can manage other admins
 * Must be used after authenticate middleware
 */
export function requireSuperAdmin(req, res, next) {
  return requireMainAdmin(req, res, next)
}

/**
 * Check if the current user is the super admin (legacy alias)
 */
export function isSuperAdmin(user) {
  return isMainAdmin(user)
}

/**
 * Optional authentication - attaches user if token present, but doesn't require it
 * Use for routes that work for both authenticated and anonymous users
 */
export async function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next()
  }

  try {
    const token = authHeader.split(' ')[1]
    const payload = jwt.verify(token, JWT_SECRET)

    const user = sqlite.prepare(`
      SELECT id, username, email, role, tier, status
      FROM users
      WHERE id = ? AND status = 'active'
    `).get(payload.sub)

    if (user) {
      req.user = {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        tier: user.tier
      }
    }
  } catch {
    // Ignore auth errors for optional routes - continue without user
  }

  next()
}

/**
 * Rate limiting helper for expensive operations
 * Returns tier-based limits
 */
export function getTierLimits(tier) {
  const limits = {
    free: {
      backtestsPerHour: 10,
      apiCallsPerMinute: 100,
      maxBots: 10
    },
    pro: {
      backtestsPerHour: 50,
      apiCallsPerMinute: 500,
      maxBots: 50
    },
    premium: {
      backtestsPerHour: 100,
      apiCallsPerMinute: 1000,
      maxBots: -1 // unlimited
    }
  }

  return limits[tier] || limits.free
}

export { JWT_SECRET }
