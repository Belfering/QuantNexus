/**
 * OAuth Routes: Google, Discord, GitHub authentication
 */
import { Router } from 'express'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const router = Router()

// Database connection
const dbPath = process.env.ATLAS_DB_PATH
  ? path.join(path.dirname(process.env.ATLAS_DB_PATH), 'atlas.db')
  : path.join(__dirname, '../data/atlas.db')
const sqlite = new Database(dbPath)

// JWT secret
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-change-in-production'

// OAuth State storage (in-memory, should be Redis in production for multiple servers)
const stateStorage = new Map()
const STATE_TTL = 10 * 60 * 1000 // 10 minutes

// Clean up old states periodically
setInterval(() => {
  const now = Date.now()
  for (const [state, data] of stateStorage) {
    if (now - data.createdAt > STATE_TTL) {
      stateStorage.delete(state)
    }
  }
}, 60 * 1000)

// OAuth Provider Configuration
const PROVIDERS = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    scopes: ['openid', 'email', 'profile'],
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  },
  discord: {
    authUrl: 'https://discord.com/api/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    userInfoUrl: 'https://discord.com/api/users/@me',
    scopes: ['identify', 'email'],
    clientId: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
  },
  github: {
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scopes: ['user:email'],
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
  },
}

const REDIRECT_BASE = process.env.OAUTH_REDIRECT_BASE || 'http://localhost:8787'

/**
 * GET /api/oauth/providers
 * Get list of configured OAuth providers
 * IMPORTANT: This must be defined BEFORE /:provider to avoid being caught by it
 */
router.get('/providers', (req, res) => {
  const providers = []

  for (const [name, config] of Object.entries(PROVIDERS)) {
    if (config.clientId && config.clientSecret) {
      providers.push(name)
    }
  }

  res.json({ providers })
})

/**
 * GET /api/oauth/:provider
 * Redirect to OAuth provider for authorization
 */
router.get('/:provider', (req, res) => {
  const { provider } = req.params
  const config = PROVIDERS[provider]

  if (!config) {
    return res.status(400).json({ error: `Unknown provider: ${provider}` })
  }

  if (!config.clientId || !config.clientSecret) {
    return res.status(503).json({ error: `${provider} OAuth is not configured` })
  }

  // Generate CSRF state token
  const state = crypto.randomBytes(32).toString('hex')
  stateStorage.set(state, {
    provider,
    createdAt: Date.now(),
    linkUserId: req.query.link_user_id || null, // For linking to existing account
  })

  // Build authorization URL
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: `${REDIRECT_BASE}/api/oauth/${provider}/callback`,
    response_type: 'code',
    scope: config.scopes.join(' '),
    state,
  })

  // Provider-specific params
  if (provider === 'google') {
    params.append('access_type', 'offline')
    params.append('prompt', 'consent')
  }
  if (provider === 'discord') {
    params.append('prompt', 'consent')
  }

  res.redirect(`${config.authUrl}?${params.toString()}`)
})

/**
 * GET /api/oauth/:provider/callback
 * Handle OAuth callback
 */
router.get('/:provider/callback', async (req, res) => {
  const { provider } = req.params
  const { code, state, error, error_description } = req.query
  const config = PROVIDERS[provider]

  // Handle OAuth errors
  if (error) {
    return res.redirect(`/?oauth_error=${encodeURIComponent(error_description || error)}`)
  }

  if (!config) {
    return res.redirect('/?oauth_error=Unknown+provider')
  }

  // Validate state
  const storedState = stateStorage.get(state)
  if (!storedState || storedState.provider !== provider) {
    return res.redirect('/?oauth_error=Invalid+state')
  }
  stateStorage.delete(state)

  try {
    // Exchange code for tokens
    const tokenResponse = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${REDIRECT_BASE}/api/oauth/${provider}/callback`,
      }),
    })

    const tokens = await tokenResponse.json()
    if (tokens.error) {
      throw new Error(tokens.error_description || tokens.error)
    }

    // Fetch user info
    const userResponse = await fetch(config.userInfoUrl, {
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
        'Accept': 'application/json',
        'User-Agent': 'LeverUp/1.0', // Required for GitHub
      },
    })

    const userInfo = await userResponse.json()
    if (!userResponse.ok) {
      throw new Error('Failed to fetch user info')
    }

    // Extract user profile based on provider
    const profile = extractProfile(provider, userInfo)

    // Handle login/registration
    const result = await handleOAuthLogin(provider, profile, storedState.linkUserId)

    // Redirect with tokens to frontend
    // In production: OAUTH_REDIRECT_BASE is the same as frontend (e.g., https://www.quantnexus.io)
    // In development: Use OAUTH_FRONTEND_URL or transform localhost:8787 to localhost:5173
    const frontendBase = process.env.OAUTH_FRONTEND_URL ||
      (REDIRECT_BASE.includes('localhost:8787') ? REDIRECT_BASE.replace(':8787', ':5173') : REDIRECT_BASE)
    const redirectUrl = new URL('/', frontendBase)
    redirectUrl.searchParams.set('oauth_access_token', result.accessToken)
    redirectUrl.searchParams.set('oauth_refresh_token', result.refreshToken)
    redirectUrl.searchParams.set('oauth_user_id', result.user.id)

    res.redirect(redirectUrl.toString())
  } catch (err) {
    console.error(`[OAuth ${provider}] Error:`, err.message)
    res.redirect(`/?oauth_error=${encodeURIComponent(err.message)}`)
  }
})

/**
 * Extract normalized profile from provider-specific response
 */
function extractProfile(provider, userInfo) {
  switch (provider) {
    case 'google':
      return {
        providerAccountId: userInfo.id,
        email: userInfo.email,
        displayName: userInfo.name,
        avatarUrl: userInfo.picture,
      }
    case 'discord':
      return {
        providerAccountId: userInfo.id,
        email: userInfo.email,
        displayName: userInfo.global_name || userInfo.username,
        avatarUrl: userInfo.avatar
          ? `https://cdn.discordapp.com/avatars/${userInfo.id}/${userInfo.avatar}.png`
          : null,
      }
    case 'github':
      return {
        providerAccountId: String(userInfo.id),
        email: userInfo.email,
        displayName: userInfo.name || userInfo.login,
        avatarUrl: userInfo.avatar_url,
      }
    default:
      throw new Error(`Unknown provider: ${provider}`)
  }
}

/**
 * Handle OAuth login/registration
 */
async function handleOAuthLogin(provider, profile, linkUserId = null) {
  const { providerAccountId, email, displayName, avatarUrl } = profile

  // Check if OAuth account exists
  const existingOAuth = sqlite.prepare(`
    SELECT oa.*, u.id as user_id, u.email as user_email, u.role, u.tier, u.status, u.display_name, u.username
    FROM oauth_accounts oa
    JOIN users u ON oa.user_id = u.id
    WHERE oa.provider = ? AND oa.provider_account_id = ?
  `).get(provider, providerAccountId)

  let user

  if (existingOAuth) {
    // Login existing user
    user = {
      id: existingOAuth.user_id,
      email: existingOAuth.user_email,
      username: existingOAuth.username,
      displayName: existingOAuth.display_name,
      role: existingOAuth.role,
      tier: existingOAuth.tier,
    }
  } else if (linkUserId) {
    // Link to existing account
    sqlite.prepare(`
      INSERT INTO oauth_accounts (user_id, provider, provider_account_id, email, display_name, avatar_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
    `).run(linkUserId, provider, providerAccountId, email, displayName, avatarUrl)

    const linkedUser = sqlite.prepare('SELECT * FROM users WHERE id = ?').get(linkUserId)
    user = {
      id: linkedUser.id,
      email: linkedUser.email,
      username: linkedUser.username,
      displayName: linkedUser.display_name,
      role: linkedUser.role,
      tier: linkedUser.tier,
    }
  } else if (email) {
    // Check if user with this email exists
    const existingUser = sqlite.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase())

    if (existingUser) {
      // Link OAuth to existing user and verify email
      sqlite.prepare(`
        INSERT INTO oauth_accounts (user_id, provider, provider_account_id, email, display_name, avatar_url, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
      `).run(existingUser.id, provider, providerAccountId, email, displayName, avatarUrl)

      // Mark email as verified since OAuth provider verified it
      sqlite.prepare(`
        UPDATE users SET email_verified = 1, status = 'active', updated_at = unixepoch() WHERE id = ?
      `).run(existingUser.id)

      user = {
        id: existingUser.id,
        email: existingUser.email,
        username: existingUser.username,
        displayName: existingUser.display_name,
        role: existingUser.role,
        tier: existingUser.tier,
      }
    } else {
      // Create new user (no invite code required for OAuth)
      const userId = crypto.randomBytes(12).toString('hex')
      const username = generateUsername(displayName || email.split('@')[0])

      sqlite.prepare(`
        INSERT INTO users (id, username, email, password_hash, display_name, email_verified, status, tier, role, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, 'active', 'free', 'user', unixepoch(), unixepoch())
      `).run(userId, username, email.toLowerCase(), 'oauth-no-password', displayName, 1)

      // Create OAuth account link
      sqlite.prepare(`
        INSERT INTO oauth_accounts (user_id, provider, provider_account_id, email, display_name, avatar_url, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
      `).run(userId, provider, providerAccountId, email, displayName, avatarUrl)

      user = {
        id: userId,
        email: email.toLowerCase(),
        username,
        displayName,
        role: 'user',
        tier: 'free',
      }
    }
  } else {
    throw new Error(`No email provided by ${provider}. Please use a different login method.`)
  }

  // Generate tokens
  const accessToken = jwt.sign(
    { sub: user.id, email: user.email, tier: user.tier, role: user.role },
    JWT_SECRET,
    { expiresIn: '15m' }
  )

  const refreshToken = crypto.randomBytes(64).toString('hex')
  const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex')

  // Store refresh token
  sqlite.prepare(`
    INSERT INTO user_sessions (user_id, refresh_token_hash, device_info, expires_at, created_at, last_used_at)
    VALUES (?, ?, ?, unixepoch() + 604800, unixepoch(), unixepoch())
  `).run(user.id, refreshTokenHash, 'OAuth Login')

  // Update last login
  sqlite.prepare(`UPDATE users SET last_login_at = unixepoch(), updated_at = unixepoch() WHERE id = ?`).run(user.id)

  // Trigger cache preload
  const apiPort = process.env.PORT || 8787
  fetch(`http://localhost:${apiPort}/api/internal/preload-cache`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }).catch(() => {})

  return {
    accessToken,
    refreshToken,
    user,
  }
}

/**
 * Generate a unique username from display name
 */
function generateUsername(baseName) {
  const clean = baseName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 15)

  // Check if username exists and add suffix if needed
  let username = clean
  let suffix = 0

  while (sqlite.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    suffix++
    username = `${clean}${suffix}`
  }

  return username
}

export default router
