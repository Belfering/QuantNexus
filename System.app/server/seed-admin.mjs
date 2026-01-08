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
    // First, check if ADMIN_EMAIL already exists (as admin or regular user)
    const existingUser = sqlite.prepare(`
      SELECT id, role FROM users WHERE email = ?
    `).get(adminEmail.toLowerCase())

    if (existingUser) {
      // User with this email exists - ensure they are main_admin with correct password
      const passwordHash = await bcrypt.hash(adminPassword, 12)
      sqlite.prepare(`
        UPDATE users SET
          role = 'main_admin',
          password_hash = ?,
          email_verified = 1,
          status = 'active',
          tier = 'premium',
          updated_at = datetime('now')
        WHERE id = ?
      `).run(passwordHash, existingUser.id)

      if (existingUser.role === 'main_admin' || existingUser.role === 'admin') {
        console.log(`[seed] Main admin user password updated for: ${adminEmail}`)
      } else {
        console.log(`[seed] Upgraded existing user to main_admin: ${adminEmail}`)
      }
      return true
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
      VALUES (?, ?, ?, ?, 1, 'active', 'premium', 'main_admin', datetime('now'), datetime('now'))
    `).run(userId, username, passwordHash, adminEmail.toLowerCase())

    console.log(`[seed] Admin user created: ${adminEmail}`)
    return true
  } catch (err) {
    console.error('[seed] Failed to create admin user:', err.message)
    return false
  }
}