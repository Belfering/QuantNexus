import Database from 'duckdb'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PARQUET_DIR = path.join(__dirname, 'ticker-data', 'data', 'ticker_data_parquet')

const fetchOhlcSeries = async (ticker, limit = 20000) => {
  const db = new Database.Database(':memory:')
  const parquetPath = path.join(PARQUET_DIR, `${ticker}.parquet`).replace(/\/g, '/')
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

const getSeriesKey = (ticker) => String(ticker).toUpperCase().trim()

const buildPriceDb = (series) => {
  const barMaps = series.map((s) => {
    const t = getSeriesKey(s.ticker)
    const byTime = new Map()
    for (const b of s.bars) {
      if (b.close != null && Number.isFinite(b.close)) {
        byTime.set(Number(b.time), b)
      }
    }
    return { ticker: t, byTime }
  })

  const datesByTicker = barMaps.map((m) => new Set(m.byTime.keys()))
  let common = datesByTicker[0]
  for (let i = 1; i < datesByTicker.length; i++) {
    common = new Set([...common].filter((d) => datesByTicker[i].has(d)))
  }
  const dates = [...common].sort((a, b) => a - b)

  const close = {}
  for (const { ticker, byTime } of barMaps) {
    close[ticker] = dates.map((d) => byTime.get(d)?.close ?? null)
  }

  return { dates, close }
}

const main = async () => {
  const tickers = ['SPY', 'XLU', 'XLV', 'XLP', 'XLY', 'VIG']
  const loaded = []

  for (const t of tickers) {
    const bars = await fetchOhlcSeries(t)
    loaded.push({ ticker: t, bars })
  }

  const db = buildPriceDb(loaded)
  const testDate = '2013-05-16'

  let dateIdx = -1
  for (let i = 0; i < db.dates.length; i++) {
    const d = new Date(db.dates[i] * 1000).toISOString().split('T')[0]
    if (d === testDate) {
      dateIdx = i
      break
    }
  }

  if (dateIdx < 0) {
    console.log('Date not found:', testDate)
    return
  }

  console.log('=== Date', testDate, 'at index', dateIdx, '===')
  console.log('')

  // Check SPY RSI(14) using proper Wilder smoothing from start
  console.log('--- SPY RSI(14) Check ---')
  const spyCloses = db.close['SPY']
  const rsiPeriod = 14

  // Wilder RSI needs to be calculated from the beginning
  let avgGain = 0, avgLoss = 0
  // First period: simple average
  for (let i = 1; i <= rsiPeriod; i++) {
    const change = spyCloses[i] - spyCloses[i - 1]
    if (change > 0) avgGain += change
    else avgLoss += Math.abs(change)
  }
  avgGain /= rsiPeriod
  avgLoss /= rsiPeriod

  // Then apply Wilder smoothing for all subsequent periods up to dateIdx
  for (let i = rsiPeriod + 1; i <= dateIdx; i++) {
    const change = spyCloses[i] - spyCloses[i - 1]
    if (change > 0) {
      avgGain = (avgGain * (rsiPeriod - 1) + change) / rsiPeriod
      avgLoss = (avgLoss * (rsiPeriod - 1)) / rsiPeriod
    } else {
      avgGain = (avgGain * (rsiPeriod - 1)) / rsiPeriod
      avgLoss = (avgLoss * (rsiPeriod - 1) + Math.abs(change)) / rsiPeriod
    }
  }

  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
  const rsi = 100 - (100 / (1 + rs))
  console.log('SPY RSI(14) =', rsi.toFixed(4))
  console.log('RSI > 74 ?', rsi > 74)
  console.log('')

  // 13612W Momentum for each ratio
  console.log('--- 13612W Momentum ---')
  const m1 = 21, m3 = 63, m6 = 126, m12 = 252

  for (const den of ['XLU', 'XLV', 'XLP', 'XLY', 'VIG']) {
    const numClose = db.close['SPY']
    const denClose = db.close[den]

    // Build ratio array
    const ratioArr = numClose.map((v, i) => {
      const d = denClose[i]
      return (v != null && d != null && d !== 0) ? v / d : NaN
    })

    if (dateIdx < m12) {
      console.log('SPY/' + den + ': index too low for momentum')
      continue
    }

    const p0 = ratioArr[dateIdx]
    const p1 = ratioArr[dateIdx - m1]
    const p3 = ratioArr[dateIdx - m3]
    const p6 = ratioArr[dateIdx - m6]
    const p12 = ratioArr[dateIdx - m12]

    if (p0 && p1 && p3 && p6 && p12 && !isNaN(p0) && !isNaN(p1) && !isNaN(p3) && !isNaN(p6) && !isNaN(p12)) {
      const mom = (12*(p0/p1-1) + 4*(p0/p3-1) + 2*(p0/p6-1) + (p0/p12-1)) / 19
      console.log('SPY/' + den + ': 13612W =', mom.toFixed(6), '< 0 ?', mom < 0)
    } else {
      console.log('SPY/' + den + ': 13612W = null (missing data)')
    }
  }

  // Count how many are negative
  console.log('')
  console.log('--- Ladder Evaluation ---')
  let negCount = 0
  for (const den of ['XLU', 'XLV', 'XLP', 'XLY', 'VIG']) {
    const numClose = db.close['SPY']
    const denClose = db.close[den]
    const ratioArr = numClose.map((v, i) => {
      const d = denClose[i]
      return (v != null && d != null && d !== 0) ? v / d : NaN
    })
    const p0 = ratioArr[dateIdx]
    const p1 = ratioArr[dateIdx - m1]
    const p3 = ratioArr[dateIdx - m3]
    const p6 = ratioArr[dateIdx - m6]
    const p12 = ratioArr[dateIdx - m12]
    if (p0 && p1 && p3 && p6 && p12) {
      const mom = (12*(p0/p1-1) + 4*(p0/p3-1) + 2*(p0/p6-1) + (p0/p12-1)) / 19
      if (mom < 0) negCount++
    }
  }
  console.log('Number of ratios with momentum < 0:', negCount)
  console.log('Ladder slot would be: ladder-' + negCount)
  if (negCount === 0) console.log('-> No allocation (ladder-0 is empty)')
  else if (negCount === 1) console.log('-> ladder-1: 50% UVXY, 50% BIL')
  else if (negCount === 2) console.log('-> ladder-2: empty')
  else if (negCount >= 3) console.log('-> ladder-3+: 100% UVXY')
}

main().catch(console.error)
