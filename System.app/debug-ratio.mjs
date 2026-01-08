// Debug: Compare individual ratio calculations
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
      `SELECT epoch(Date) as time, Close as close FROM read_parquet('${parquetPath}') ORDER BY Date ASC LIMIT ${limit}`,
      (err, rows) => {
        db.close()
        if (err) reject(err)
        else resolve(rows || [])
      }
    )
  })
}

const main = async () => {
  // Load SPY and all denominator tickers
  const tickers = ['SPY', 'XLU', 'XLV', 'XLP', 'XLY', 'VIG']
  const rawData = {}

  for (const t of tickers) {
    rawData[t] = await fetchOhlcSeries(t)
    console.log(`${t}: ${rawData[t].length} bars, first date: ${new Date(rawData[t][0].time * 1000).toISOString().split('T')[0]}`)
  }

  // Check date alignment - do they all have same dates?
  console.log('\n--- Checking date alignment ---')
  const spyDates = new Set(rawData['SPY'].map(r => r.time))

  for (const t of ['XLU', 'XLV', 'XLP', 'XLY', 'VIG']) {
    const tDates = new Set(rawData[t].map(r => r.time))
    const inSpy = [...tDates].filter(d => spyDates.has(d)).length
    const notInSpy = [...tDates].filter(d => !spyDates.has(d)).length
    const spyNotInT = [...spyDates].filter(d => !tDates.has(d)).length
    console.log(`${t}: ${inSpy} common dates, ${notInSpy} extra in ${t}, ${spyNotInT} missing from ${t}`)
  }

  // For a specific test date, show raw values
  const testDate = '2013-01-29' // Decision date for 1/30/2013
  console.log(`\n--- Raw prices for ${testDate} ---`)

  for (const t of tickers) {
    const bar = rawData[t].find(r => {
      const d = new Date(r.time * 1000).toISOString().split('T')[0]
      return d === testDate
    })
    if (bar) {
      console.log(`${t}: close = ${bar.close}`)
    } else {
      console.log(`${t}: NO DATA for ${testDate}`)
    }
  }

  // Calculate ratios manually
  console.log(`\n--- Manual ratio calculations ---`)
  const spyBar = rawData['SPY'].find(r => new Date(r.time * 1000).toISOString().split('T')[0] === testDate)
  if (spyBar) {
    for (const den of ['XLU', 'XLV', 'XLP', 'XLY', 'VIG']) {
      const denBar = rawData[den].find(r => new Date(r.time * 1000).toISOString().split('T')[0] === testDate)
      if (denBar) {
        const ratio = spyBar.close / denBar.close
        console.log(`SPY/${den} = ${spyBar.close} / ${denBar.close} = ${ratio.toFixed(6)}`)
      }
    }
  }
}

main().catch(console.error)
