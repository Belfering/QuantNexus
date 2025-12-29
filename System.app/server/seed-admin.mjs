// server/seed-admin.mjs
// Creates an initial admin user on first boot if ADMIN_EMAIL and ADMIN_PASSWORD are set

import bcrypt from 'bcrypt'
import crypto from 'crypto'
import { sqlite } from './db/index.mjs'

export async function seedAdminUser() {
  const adminEmail = process.env.ADMIN_EMAIL
  const adminPassword = process.env.ADMIN_PASSWORD

  if (!adminEmail || !adminPassword) {
    console.log('[seed] ADMIN_EMAIL or ADMIN_PASSWORD not set, skipping admin seed')
    return false
  }

  try {
    // Check if any admin users exist
    const existingAdmin = sqlite.prepare(`
      SELECT id FROM users WHERE role = 'admin' LIMIT 1
    `).get()

    if (existingAdmin) {
      console.log('[seed] Admin user already exists, skipping seed')
      return false
    }

    // Check if email is already registered
    const existingEmail = sqlite.prepare(`
      SELECT id FROM users WHERE email = ?
    `).get(adminEmail.toLowerCase())

    if (existingEmail) {
      console.log('[seed] Email already registered, skipping seed')
      return false
    }

    // Validate password
    if (adminPassword.length < 8) {
      console.error('[seed] ADMIN_PASSWORD must be at least 8 characters')
      return false
    }

    // Create admin user
    const userId = crypto.randomUUID()
    const passwordHash = await bcrypt.hash(adminPassword, 12)
    const username = adminEmail.split('@')[0] + '_admin'

    sqlite.prepare(`
      INSERT INTO users (id, username, password_hash, email, email_verified, status, tier, role, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, 'active', 'premium', 'admin', datetime('now'), datetime('now'))
    `).run(userId, username, passwordHash, adminEmail.toLowerCase())

    console.log(`[seed] Admin user created: ${adminEmail}`)
    return true
  } catch (err) {
    console.error('[seed] Failed to create admin user:', err.message)
    return false
  }
}
