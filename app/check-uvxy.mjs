import Database from 'duckdb'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PARQUET_DIR = path.join(__dirname, 'ticker-data', 'data', 'ticker_data_parquet')

const db = new Database.Database(':memory:')
const parquetPath = path.join(PARQUET_DIR, 'UVXY.parquet').replace(/\\/g, '/')
db.all(`SELECT MIN(Date) as first, MAX(Date) as last, COUNT(*) as cnt FROM read_parquet('${parquetPath}') WHERE Close IS NOT NULL`, (err, rows) => {
  if (err) console.error(err)
  else console.log('UVXY:', rows[0])
  db.close()
})
