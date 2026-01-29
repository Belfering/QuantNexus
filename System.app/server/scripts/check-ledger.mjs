#!/usr/bin/env node

/**
 * Check Bot Position Ledger
 *
 * Directly queries the ledger to see what positions are stored
 */

import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'atlas.db')
const sqlite = new Database(DB_PATH)

console.log('\n🔍 Querying bot_position_ledger...\n')

// Get all users
const users = sqlite.prepare(`SELECT id FROM users`).all()

for (const user of users) {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`USER: ${user.id}`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)

  for (const credType of ['paper', 'live']) {
    const entries = sqlite.prepare(`
      SELECT bot_id, symbol, shares, avg_price
      FROM bot_position_ledger
      WHERE user_id = ? AND credential_type = ? AND shares > 0
      ORDER BY bot_id, symbol
    `).all(user.id, credType)

    if (entries.length === 0) {
      console.log(`\n  ${credType.toUpperCase()}: No positions`)
      continue
    }

    console.log(`\n  ${credType.toUpperCase()}:`)

    // Group by bot_id
    const byBot = {}
    for (const entry of entries) {
      if (!byBot[entry.bot_id]) {
        byBot[entry.bot_id] = []
      }
      byBot[entry.bot_id].push(entry)
    }

    for (const [botId, positions] of Object.entries(byBot)) {
      const totalValue = positions.reduce((sum, p) => sum + (p.shares * p.avg_price), 0)
      const posCount = positions.length

      console.log(`\n    ${botId === 'unallocated' ? 'UNALLOCATED' : 'SYSTEM ' + botId}:`)
      console.log(`      Total Value: $${totalValue.toFixed(2)}`)
      console.log(`      Positions: ${posCount} tickers`)

      for (const pos of positions) {
        const value = pos.shares * pos.avg_price
        console.log(`        ${pos.symbol}: ${pos.shares.toFixed(4)} shares @ $${pos.avg_price.toFixed(2)} = $${value.toFixed(2)}`)
      }
    }
  }
}

console.log('\n')
