// Debug: Check if date alignment is causing wrong ratio calculations
import Database from 'duckdb'
import { fileURLToPath } from 'url'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PARQUET_DIR = path.join(__dirname, 'ticker-data', 'data', 'ticker_data_parquet')

const fetchOhlcSeries = async (ticker, limit = 20000) => {
  const db = new Database.Database(':memory:')
  const parquetPath = path.join(PARQUET_DIR, `${ticker}.parquet`).replace(/\\/g, '/')

  return new Promise((resolve, reject) => {
    db.all(
      `SELECT epoch(Date) as time, Close as close FROM read_parquet('${parquetPath}') WHERE Close IS NOT NULL ORDER BY Date ASC LIMIT ${limit}`,
      (err, rows) => {
        db.close()
        if (err) reject(err)
        else resolve(rows || [])
      }
    )
  })
}

const main = async () => {
  const testDate = '2012-09-14'

  // Load SPY and XLU separately
  const spyBars = await fetchOhlcSeries('SPY')
  const xluBars = await fetchOhlcSeries('XLU')

  // Find the bar for testDate in each
  const spyBar = spyBars.find(b => {
    const d = new Date(b.time * 1000).toISOString().split('T')[0]
    return d === testDate
  })
  const xluBar = xluBars.find(b => {
    const d = new Date(b.time * 1000).toISOString().split('T')[0]
    return d === testDate
  })

  console.log(`=== Direct lookup for ${testDate} ===`)
  console.log(`SPY: time=${spyBar?.time}, close=${spyBar?.close}`)
  console.log(`XLU: time=${xluBar?.time}, close=${xluBar?.close}`)

  if (spyBar && xluBar) {
    console.log(`SPY/XLU ratio = ${spyBar.close} / ${xluBar.close} = ${(spyBar.close / xluBar.close).toFixed(6)}`)
  }

  // Now check what index each has for this date
  const spyIdx = spyBars.findIndex(b => new Date(b.time * 1000).toISOString().split('T')[0] === testDate)
  const xluIdx = xluBars.findIndex(b => new Date(b.time * 1000).toISOString().split('T')[0] === testDate)

  console.log(`\nSPY index for ${testDate}: ${spyIdx}`)
  console.log(`XLU index for ${testDate}: ${xluIdx}`)

  // Check if the indices are different - that would cause wrong ratio!
  if (spyIdx !== xluIdx) {
    console.log(`\n*** MISMATCH! SPY and XLU have different indices for the same date!`)
    console.log(`At SPY index ${spyIdx}: SPY close = ${spyBars[spyIdx]?.close}`)
    console.log(`At SPY index ${spyIdx}: XLU close = ${xluBars[spyIdx]?.close}`)
    console.log(`Wrong ratio = ${spyBars[spyIdx]?.close / xluBars[spyIdx]?.close}`)
  }

  // Check first dates
  console.log(`\n=== First valid dates ===`)
  console.log(`SPY first: ${new Date(spyBars[0].time * 1000).toISOString().split('T')[0]}`)
  console.log(`XLU first: ${new Date(xluBars[0].time * 1000).toISOString().split('T')[0]}`)
}

main().catch(console.error)
