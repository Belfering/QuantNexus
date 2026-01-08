// Check momentum conditions for missing QM dates
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

const rollingWilderRsi = (closes, period) => {
  const out = new Array(closes.length).fill(null)
  let avgGain = null, avgLoss = null, seedG = 0, seedL = 0, seedCount = 0
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1], cur = closes[i]
    if (Number.isNaN(prev) || Number.isNaN(cur)) { avgGain = avgLoss = null; seedG = seedL = seedCount = 0; continue }
    const change = cur - prev, gain = change > 0 ? change : 0, loss = change < 0 ? -change : 0
    if (avgGain == null) {
      seedG += gain; seedL += loss; seedCount++
      if (seedCount === period) {
        avgGain = seedG / period; avgLoss = seedL / period
        out[i] = 100 - 100 / (1 + (avgLoss === 0 ? Infinity : avgGain / avgLoss))
      }
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period
      avgLoss = (avgLoss * (period - 1) + loss) / period
      out[i] = 100 - 100 / (1 + (avgLoss === 0 ? Infinity : avgGain / avgLoss))
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

  const spyCloses = spyBars.map(b => b.close)
  const spyRsi = rollingWilderRsi(spyCloses, 14)

  const ratios = [
    { name: 'SPY/XLU', bars: computeRatio(spyBars, xluBars) },
    { name: 'SPY/XLV', bars: computeRatio(spyBars, xlvBars) },
    { name: 'SPY/XLP', bars: computeRatio(spyBars, xlpBars) },
    { name: 'SPY/XLY', bars: computeRatio(spyBars, xlyBars) },
    { name: 'SPY/VIG', bars: computeRatio(spyBars, vigBars) },
  ]

  // Precompute momentum for all ratios
  const momArrays = ratios.map(r => rolling13612W(r.bars.map(b => b.close)))

  // Missing dates from QM (sample from the comparison)
  // These are HOLDING dates, so we check decision date = day before
  const missingHoldingDates = [
    '2013-05-16', '2017-02-27', '2017-02-28', '2017-03-01',
    '2018-01-26', '2018-01-29', '2018-01-30', '2018-01-31',
    '2019-04-29', '2019-04-30', '2020-01-17', '2020-01-21',
    '2021-01-08', '2021-04-16', '2021-08-16', '2024-03-28'
  ]

  console.log('Checking missing dates (showing decision date values):')
  console.log('Need: RSI > 74 AND nTrue = 1, 3 (not 2, 4, 5, 0)')
  console.log()

  for (const holdingDate of missingHoldingDates) {
    // Find decision date index (day before holding date in SPY)
    const holdingIdx = spyBars.findIndex(b => new Date(b.time * 1000).toISOString().split('T')[0] === holdingDate)
    if (holdingIdx < 1) continue
    const decisionIdx = holdingIdx - 1
    const decisionDate = new Date(spyBars[decisionIdx].time * 1000).toISOString().split('T')[0]

    const rsi = spyRsi[decisionIdx]
    const rsiPass = rsi > 74

    // Count momentum conditions
    let nTrue = 0
    const details = []
    for (let i = 0; i < ratios.length; i++) {
      const ratioIdx = ratios[i].bars.findIndex(b => new Date(b.time * 1000).toISOString().split('T')[0] === decisionDate)
      if (ratioIdx >= 0) {
        const val = momArrays[i][ratioIdx]
        const isTrue = val < 0
        if (isTrue) nTrue++
        details.push(`${ratios[i].name.split('/')[1]}:${isTrue ? 'T' : 'F'}`)
      }
    }

    const slot = `ladder-${nTrue}`
    const hasAlloc = nTrue === 1 || nTrue === 3
    const status = rsiPass && hasAlloc ? '✓' : (rsiPass ? `✗ (${slot} empty)` : '✗ RSI fail')

    console.log(`${holdingDate} (dec=${decisionDate}): RSI=${rsi?.toFixed(1)} ${rsiPass?'>74':'≤74'}, nTrue=${nTrue} [${details.join(',')}] → ${status}`)
  }
}

main().catch(console.error)
