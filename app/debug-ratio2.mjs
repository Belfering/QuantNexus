// Debug: Check if ratio calculation in backtest matches debug-momentum
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
      `SELECT epoch(Date) as time, Open as open, Close as close FROM read_parquet('${parquetPath}') ORDER BY Date ASC LIMIT ${limit}`,
      (err, rows) => {
        db.close()
        if (err) reject(err)
        else resolve(rows || [])
      }
    )
  })
}

const normalizeChoice = (ticker) => {
  if (!ticker || ticker === 'Empty' || ticker === '') return 'Empty'
  return String(ticker).toUpperCase().trim()
}

const getSeriesKey = (ticker) => normalizeChoice(ticker)

const buildPriceDb = (series) => {
  if (!series.length) return { dates: [], open: {}, close: {} }

  const barMaps = series.map((s) => {
    const t = getSeriesKey(s.ticker)
    const byTime = new Map()
    let validCount = 0
    for (const b of s.bars) {
      if (b.close != null && Number.isFinite(b.close)) {
        byTime.set(Number(b.time), b)
        validCount++
      }
    }
    console.log(`[buildPriceDb] ${t}: ${s.bars.length} bars, ${validCount} valid`)
    return { ticker: t, byTime }
  })

  const datesByTicker = barMaps.map((m) => new Set(m.byTime.keys()))
  let common = datesByTicker[0]
  for (let i = 1; i < datesByTicker.length; i++) {
    common = new Set([...common].filter((d) => datesByTicker[i].has(d)))
  }
  const dates = [...common].sort((a, b) => a - b)
  console.log(`[buildPriceDb] Common dates: ${dates.length}`)

  const open = {}
  const close = {}
  for (const { ticker, byTime } of barMaps) {
    open[ticker] = dates.map((d) => byTime.get(d)?.open ?? null)
    close[ticker] = dates.map((d) => byTime.get(d)?.close ?? null)
  }

  return { dates, open, close }
}

const parseRatioTicker = (ticker) => {
  const norm = normalizeChoice(ticker)
  const parts = norm.split('/')
  if (parts.length !== 2) return null
  const [numerator, denominator] = parts.map((p) => p.trim())
  if (!numerator || !denominator) return null
  return { numerator, denominator }
}

// Same logic as backtest.mjs getCachedCloseArray
const getRatioCloses = (db, ticker) => {
  const ratio = parseRatioTicker(ticker)
  if (!ratio) return null

  const numClose = db.close[ratio.numerator] || []
  const denClose = db.close[ratio.denominator] || []
  console.log(`Ratio ${ticker}: num=${ratio.numerator} has ${numClose.length} values, den=${ratio.denominator} has ${denClose.length} values`)

  const len = Math.max(numClose.length, denClose.length)
  const arr = new Array(len).fill(NaN)
  for (let i = 0; i < len; i++) {
    const num = numClose[i]
    const den = denClose[i]
    if (num != null && den != null && den !== 0) {
      arr[i] = num / den
    }
  }
  return arr
}

const main = async () => {
  // Load all tickers needed
  const tickers = ['SPY', 'XLU', 'XLV', 'XLP', 'XLY', 'VIG']
  const loaded = []

  for (const t of tickers) {
    const bars = await fetchOhlcSeries(t)
    loaded.push({ ticker: t, bars })
  }

  const db = buildPriceDb(loaded)
  console.log(`\ndb.close keys: ${Object.keys(db.close).join(', ')}`)

  // Check a specific date
  const testDate = '2012-09-14'
  const testTs = new Date(testDate + 'T00:00:00Z').getTime() / 1000

  // Find the index for this date
  let dateIdx = -1
  for (let i = 0; i < db.dates.length; i++) {
    const d = new Date(db.dates[i] * 1000).toISOString().split('T')[0]
    if (d === testDate) {
      dateIdx = i
      break
    }
  }

  if (dateIdx < 0) {
    console.log(`Date ${testDate} not found in common dates`)
    return
  }

  console.log(`\n--- Date index ${dateIdx} (${testDate}) ---`)

  // Show raw close values at this index
  for (const t of tickers) {
    const close = db.close[t][dateIdx]
    console.log(`${t}: close[${dateIdx}] = ${close}`)
  }

  // Calculate ratios using backtest logic
  console.log(`\n--- Ratio calculations at index ${dateIdx} ---`)
  for (const den of ['XLU', 'XLV', 'XLP', 'XLY', 'VIG']) {
    const ratioTicker = `SPY/${den}`
    const ratioCloses = getRatioCloses(db, ratioTicker)
    if (ratioCloses) {
      console.log(`${ratioTicker}: ratio[${dateIdx}] = ${ratioCloses[dateIdx]}`)
    }
  }

  // Check SPY RSI first (outer condition)
  console.log(`\n--- SPY 14-day RSI at index ${dateIdx} ---`)
  const spyCloses = db.close['SPY']
  // Calculate Wilder RSI
  const rsiPeriod = 14
  let avgGain = 0, avgLoss = 0
  for (let i = dateIdx - rsiPeriod + 1; i <= dateIdx; i++) {
    const change = spyCloses[i] - spyCloses[i - 1]
    if (change > 0) avgGain += change
    else avgLoss += Math.abs(change)
  }
  avgGain /= rsiPeriod
  avgLoss /= rsiPeriod
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
  const rsi = 100 - (100 / (1 + rs))
  console.log(`SPY RSI(14) = ${rsi.toFixed(2)} > 74 ? ${rsi > 74}`)

  // Now calculate 13612W for each ratio at this index
  console.log(`\n--- 13612W Momentum at index ${dateIdx} ---`)
  const m1 = 21, m3 = 63, m6 = 126, m12 = 252

  for (const den of ['XLU', 'XLV', 'XLP', 'XLY', 'VIG']) {
    const ratioTicker = `SPY/${den}`
    const closes = getRatioCloses(db, ratioTicker)

    if (dateIdx < m12) {
      console.log(`${ratioTicker}: index too low for momentum`)
      continue
    }

    const p0 = closes[dateIdx]
    const p1 = closes[dateIdx - m1]
    const p3 = closes[dateIdx - m3]
    const p6 = closes[dateIdx - m6]
    const p12 = closes[dateIdx - m12]

    console.log(`${ratioTicker}: p0=${p0?.toFixed(4)}, p1=${p1?.toFixed(4)}, p3=${p3?.toFixed(4)}, p6=${p6?.toFixed(4)}, p12=${p12?.toFixed(4)}`)

    if (p0 && p1 && p3 && p6 && p12) {
      const mom = (12*(p0/p1-1) + 4*(p0/p3-1) + 2*(p0/p6-1) + (p0/p12-1)) / 19
      console.log(`  13612W = ${mom.toFixed(6)} < 0 ? ${mom < 0}`)
    } else {
      console.log(`  13612W = null (missing price data)`)
    }
  }
}

main().catch(console.error)
