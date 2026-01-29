#!/usr/bin/env node

import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'atlas.db')
const sqlite = new Database(DB_PATH)

// List all tables
const tables = sqlite.prepare(`
  SELECT name FROM sqlite_master
  WHERE type='table'
  ORDER BY name
`).all()

console.log('Available tables:')
for (const table of tables) {
  console.log(`  - ${table.name}`)
}
