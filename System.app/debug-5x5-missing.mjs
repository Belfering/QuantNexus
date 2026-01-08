// Calculate all 5 momentum values for 5 MISSING dates (decision dates)
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
  const numMap = new Map(), denMap = new Map()
  for (const b of numBars) numMap.set(b.time, b.close)
  for (const b of denBars) denMap.set(b.time, b.close)
  const allDates = [...numMap.keys()].filter(t => denMap.has(t)).sort((a, b) => a - b)
  return allDates.map(t => ({ time: t, close: numMap.get(t) / denMap.get(t) }))
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

  // Precompute momentum for all ratios
  const momArrays = ratios.map(r => rolling13612W(r.bars.map(b => b.close)))

  // 5 decision dates for MISSING holding dates (all missing from Atlas)
  // holding -> decision (day before)
  const dates = [
    '2013-05-15',  // holding 2013-05-16, nTrue=2
    '2017-02-28',  // holding 2017-03-01, nTrue=2
    '2018-01-29',  // holding 2018-01-30, nTrue=2
    '2020-01-16',  // holding 2020-01-17, nTrue=0
    '2020-01-17',  // holding 2020-01-21, nTrue=0
  ]

  console.log('Atlas 13612W Momentum values for MISSING dates (decision dates):')
  console.log('=' .repeat(85))
  console.log()

  // Header
  console.log('Decision    | SPY/XLU   | SPY/XLV   | SPY/XLP   | SPY/XLY   | SPY/VIG   | nTrue')
  console.log('-'.repeat(85))

  for (const date of dates) {
    const vals = []
    let nTrue = 0
    for (let i = 0; i < ratios.length; i++) {
      const idx = ratios[i].bars.findIndex(b => new Date(b.time * 1000).toISOString().split('T')[0] === date)
      const val = idx >= 0 ? momArrays[i][idx] : null
      vals.push(val)
      if (val !== null && val < 0) nTrue++
    }
    const formatted = vals.map(v => v !== null ? (v >= 0 ? ' ' : '') + v.toFixed(6) : '   N/A   ').join(' | ')
    console.log(`${date} | ${formatted} | ${nTrue}`)
  }

  console.log()
  console.log('Please compare with QM values for the same decision dates.')
  console.log('If QM has different nTrue, one of the values near 0 must differ in sign.')
}

main().catch(console.error)
