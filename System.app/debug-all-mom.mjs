// Check all 5 momentum conditions on 5/15/2013
import Database from 'duckdb'
import path from 'path'
import { fileURLToPath } from 'url'

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

const rolling13612W = (closes) => {
  const out = new Array(closes.length).fill(null)
  const m1 = 21, m3 = 63, m6 = 126, m12 = 252
  for (let i = m12; i < closes.length; i++) {
    const p0 = closes[i]
    const p1 = closes[i - m1]
    const p3 = closes[i - m3]
    const p6 = closes[i - m6]
    const p12 = closes[i - m12]
    if (p1 && p3 && p6 && p12) {
      out[i] = (12*(p0/p1-1) + 4*(p0/p3-1) + 2*(p0/p6-1) + (p0/p12-1)) / 19
    }
  }
  return out
}

const computeRatio = (numBars, denBars) => {
  const numMap = new Map()
  const denMap = new Map()
  for (const b of numBars) numMap.set(b.time, b.close)
  for (const b of denBars) denMap.set(b.time, b.close)
  const allDates = [...numMap.keys()].filter(t => denMap.has(t))
  const sortedDates = allDates.sort((a, b) => a - b)
  const result = []
  for (const t of sortedDates) {
    const n = numMap.get(t)
    const d = denMap.get(t)
    if (n && d && d !== 0) {
      result.push({ time: t, close: n / d })
    }
  }
  return result
}

const main = async () => {
  const spyBars = await fetchOhlcSeries('SPY')
  const xluBars = await fetchOhlcSeries('XLU')
  const xlvBars = await fetchOhlcSeries('XLV')
  const xlpBars = await fetchOhlcSeries('XLP')
  const xlyBars = await fetchOhlcSeries('XLY')
  const vigBars = await fetchOhlcSeries('VIG')

  const ratios = [
    { name: 'SPY/XLU', bars: computeRatio(spyBars, xluBars) },
    { name: 'SPY/XLV', bars: computeRatio(spyBars, xlvBars) },
    { name: 'SPY/XLP', bars: computeRatio(spyBars, xlpBars) },
    { name: 'SPY/XLY', bars: computeRatio(spyBars, xlyBars) },
    { name: 'SPY/VIG', bars: computeRatio(spyBars, vigBars) },
  ]

  console.log('=== Momentum < 0 conditions on 5/15/2013 ===')
  let nTrue = 0
  for (const { name, bars } of ratios) {
    const closes = bars.map(b => b.close)
    const mom = rolling13612W(closes)
    const idx = bars.findIndex(b => new Date(b.time * 1000).toISOString().split('T')[0] === '2013-05-15')
    const val = mom[idx]
    const isTrue = val < 0
    if (isTrue) nTrue++
    console.log(`${name}: ${val?.toFixed(6)} < 0 ? ${isTrue}`)
  }
  console.log(`\nnTrue = ${nTrue} → ladder-${nTrue}`)
  console.log('\nFor 5/16 allocation, need nTrue=1 (ladder-1) or nTrue=3 (ladder-3)')
}

main().catch(console.error)
