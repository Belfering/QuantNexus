#!/usr/bin/env node

/**
 * Enable V2 Trading for All Users
 *
 * This script finds all users and enables v2 trading for them.
 */

import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import { setV2ExecutionEnabled, isV2ExecutionEnabled } from '../live/trading-orchestrator.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'atlas.db')
const sqlite = new Database(DB_PATH)

console.log(`\n🔍 Finding all users in the system...\n`)

// Get all users from the users table
const allUsers = sqlite.prepare(`
  SELECT id, email, username, display_name FROM users
`).all()

if (allUsers.length === 0) {
  console.log('❌ No users found in the system!')
  process.exit(1)
}

console.log(`Found ${allUsers.length} user(s):\n`)
console.log('User ID                              | Email                        | Username    | V2 Status')
console.log('─────────────────────────────────────┼──────────────────────────────┼─────────────┼───────────')

for (const user of allUsers) {
  const v2Enabled = isV2ExecutionEnabled(user.id)
  const status = v2Enabled ? '✅ ENABLED ' : '❌ DISABLED'
  const email = (user.email || '').padEnd(28).substring(0, 28)
  const username = (user.username || user.display_name || '').padEnd(11).substring(0, 11)
  console.log(`${user.id.padEnd(36)} | ${email} | ${username} | ${status}`)
}

console.log('\n🚀 Enabling V2 for ALL users...\n')

let enabledCount = 0
for (const user of allUsers) {
  try {
    setV2ExecutionEnabled(user.id, true)
    const isEnabled = isV2ExecutionEnabled(user.id)
    if (isEnabled) {
      console.log(`✅ Enabled v2 for: ${user.email || user.username || user.id}`)
      enabledCount++
    } else {
      console.log(`❌ Failed to enable v2 for: ${user.email || user.username || user.id}`)
    }
  } catch (error) {
    console.log(`❌ Error enabling v2 for ${user.email || user.username || user.id}: ${error.message}`)
  }
}

console.log(`\n✨ Successfully enabled v2 for ${enabledCount}/${allUsers.length} users!`)
console.log('\n🎯 V2 trading system is now active!')
console.log('   When you click execute in Trading Control, it will use the new two-phase system.\n')
