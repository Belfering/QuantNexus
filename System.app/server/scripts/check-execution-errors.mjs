#!/usr/bin/env node

import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'atlas.db')
const sqlite = new Database(DB_PATH)

// Get latest execution log
const latestExecution = sqlite.prepare(`
  SELECT execution_id, status, errors
  FROM trade_executions_v2
  ORDER BY started_at DESC
  LIMIT 1
`).get()

if (latestExecution) {
  console.log('Latest Execution:')
  console.log(`  ID: ${latestExecution.execution_id}`)
  console.log(`  Status: ${latestExecution.status}`)

  if (latestExecution.errors) {
    const errors = JSON.parse(latestExecution.errors)
    console.log(`  Errors (${errors.length}):`)
    for (const err of errors) {
      console.log(`    - ${err.message || err.error || JSON.stringify(err)}`)
    }
  } else {
    console.log('  No errors recorded')
  }
} else {
  console.log('No execution logs found')
}
