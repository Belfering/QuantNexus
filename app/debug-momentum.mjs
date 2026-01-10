// Debug script to verify 13612W Momentum calculations for ratio tickers
import Database from 'duckdb'
import { fileURLToPath } from 'url'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PARQUET_DIR = path.join(__dirname, 'ticker-data', 'data', 'ticker_data_parquet')

// Fetch OHLC data for a ticker
const fetchOhlcSeries = async (ticker, limit = 20000) => {
  const db = new Database.Database(':memory:')
  const parquetPath = path.join(PARQUET_DIR, `${ticker}.parquet`).replace(/\\/g, '/')

  return new Promise((resolve, reject) => {
    db.all(
      `SELECT epoch(Date) as time, Open as open, High as high, Low as low, Close as close FROM read_parquet('${parquetPath}') ORDER BY Date ASC LIMIT ${limit}`,
      (err, rows) => {
        db.close()
        if (err) reject(err)
        else resolve(rows || [])
      }
    )
  })
}

// Calculate 13612W momentum for a single date
const calc13612W = (closes, idx) => {
  const m1 = 21, m3 = 63, m6 = 126, m12 = 252
  if (idx < m12) return null

  const p0 = closes[idx]
  const p1 = closes[idx - m1]
  const p3 = closes[idx - m3]
  const p6 = closes[idx - m6]
  const p12 = closes[idx - m12]

  if (!p0 || !p1 || !p3 || !p6 || !p12) return null

  const mom = (12*(p0/p1-1) + 4*(p0/p3-1) + 2*(p0/p6-1) + (p0/p12-1)) / 19
  return mom
}

// Find date index
const findDateIndex = (dates, targetDate) => {
  const targetTs = new Date(targetDate).getTime() / 1000
  for (let i = 0; i < dates.length; i++) {
    if (dates[i] >= targetTs) return i
  }
  return -1
}

const main = async () => {
  // Load data for ratio ticker components
  const tickers = ['SPY', 'XLU', 'XLV', 'XLP', 'XLY', 'VIG']
  const data = {}

  for (const t of tickers) {
    const bars = await fetchOhlcSeries(t)
    data[t] = bars
    console.log(`Loaded ${t}: ${bars.length} bars`)
  }

  // Find common dates
  const allDates = new Set()
  for (const t of tickers) {
    for (const bar of data[t]) {
      allDates.add(bar.time)
    }
  }
  const sortedDates = Array.from(allDates).sort((a, b) => a - b)
  console.log(`Total dates: ${sortedDates.length}`)

  // Build aligned close arrays
  const dateToIdx = new Map()
  sortedDates.forEach((d, i) => dateToIdx.set(d, i))

  const closeArrays = {}
  for (const t of tickers) {
    closeArrays[t] = new Array(sortedDates.length).fill(null)
    for (const bar of data[t]) {
      const idx = dateToIdx.get(bar.time)
      if (idx !== undefined) closeArrays[t][idx] = bar.close
    }
  }

  // Calculate ratio close arrays
  const ratioTickers = ['SPY/XLU', 'SPY/XLV', 'SPY/XLP', 'SPY/XLY', 'SPY/VIG']
  for (const ratio of ratioTickers) {
    const [num, den] = ratio.split('/')
    closeArrays[ratio] = sortedDates.map((_, i) => {
      const n = closeArrays[num][i]
      const d = closeArrays[den][i]
      if (n != null && d != null && d !== 0) return n / d
      return null
    })
  }

  // Test dates (QM shows allocations on these dates)
  const testDates = ['2013-01-30', '2017-02-27', '2017-02-28', '2018-01-26']

  for (const testDate of testDates) {
    const idx = findDateIndex(sortedDates, testDate)
    if (idx < 0) {
      console.log(`\n${testDate}: Date not found`)
      continue
    }

    // QM shows holding date, so we need to check the PREVIOUS trading day for decision
    const decisionIdx = idx - 1
    const decisionDate = new Date(sortedDates[decisionIdx] * 1000).toISOString().split('T')[0]

    console.log(`\n${testDate} (holding date, decision on ${decisionDate}):`)
    console.log(`  SPY RSI check... (need > 74)`)

    // Calculate momentum for each ratio ticker
    let trueCount = 0
    for (const ratio of ratioTickers) {
      const closes = closeArrays[ratio]
      const mom = calc13612W(closes, decisionIdx)
      const isTrue = mom !== null && mom < 0
      if (isTrue) trueCount++
      console.log(`  ${ratio} 13612W: ${mom?.toFixed(6) ?? 'null'} < 0 ? ${isTrue}`)
    }
    console.log(`  TRUE count: ${trueCount}/5`)

    // Also check day before (in case of off-by-one)
    const prevIdx = decisionIdx - 1
    if (prevIdx >= 252) {
      console.log(`  \n  Checking day before decision (${new Date(sortedDates[prevIdx] * 1000).toISOString().split('T')[0]}):`)
      let prevTrueCount = 0
      for (const ratio of ratioTickers) {
        const closes = closeArrays[ratio]
        const mom = calc13612W(closes, prevIdx)
        const isTrue = mom !== null && mom < 0
        if (isTrue) prevTrueCount++
        console.log(`    ${ratio} 13612W: ${mom?.toFixed(6) ?? 'null'} < 0 ? ${isTrue}`)
      }
      console.log(`    TRUE count: ${prevTrueCount}/5`)
    }
  }
}

main().catch(console.error)
