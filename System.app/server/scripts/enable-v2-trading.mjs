#!/usr/bin/env node

/**
 * Enable V2 Trading Execution
 *
 * This script enables the v2 two-phase trading system for a user.
 * Usage: node enable-v2-trading.mjs [userId]
 */

import { setV2ExecutionEnabled, isV2ExecutionEnabled } from '../live/trading-orchestrator.mjs'
import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'atlas.db')
const sqlite = new Database(DB_PATH)

// Get userId from command line args or find all users
const providedUserId = process.argv[2]

if (providedUserId) {
  // Enable v2 for specific user
  console.log(`\n🔧 Enabling V2 trading for user: ${providedUserId}`)

  const wasPreviouslyEnabled = isV2ExecutionEnabled(providedUserId)
  setV2ExecutionEnabled(providedUserId, true)
  const isNowEnabled = isV2ExecutionEnabled(providedUserId)

  if (isNowEnabled) {
    console.log(`✅ V2 trading ENABLED for user ${providedUserId}`)
    if (wasPreviouslyEnabled) {
      console.log(`   (was already enabled)`)
    }
  } else {
    console.log(`❌ Failed to enable V2 trading for user ${providedUserId}`)
  }
} else {
  // Show all users and their v2 status
  console.log(`\n📊 V2 Trading Status for All Users:\n`)

  const users = sqlite.prepare(`
    SELECT DISTINCT user_id FROM trading_settings
  `).all()

  if (users.length === 0) {
    console.log('No users found with trading settings.')
    console.log('\nUsage: node enable-v2-trading.mjs <userId>')
  } else {
    console.log('User ID                              | V2 Status')
    console.log('─────────────────────────────────────┼───────────')

    for (const { user_id } of users) {
      const v2Enabled = isV2ExecutionEnabled(user_id)
      const status = v2Enabled ? '✅ ENABLED ' : '❌ DISABLED'
      console.log(`${user_id.padEnd(36)} | ${status}`)
    }

    console.log('\n💡 To enable v2 for a user, run:')
    console.log(`   node enable-v2-trading.mjs <userId>`)
  }
}

console.log()
