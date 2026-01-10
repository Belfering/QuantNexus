// Debug: Verify ratio calculation in backtest context
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
      `SELECT epoch(Date) as time, Open as open, High as high, Low as low, Close as close FROM read_parquet('${parquetPath}') ORDER BY Date ASC LIMIT ${limit}`,
      (err, rows) => {
        db.close()
        if (err) reject(err)
        else resolve(rows || [])
      }
    )
  })
}

const getSeriesKey = (ticker) => String(ticker).toUpperCase().trim()

// Same buildPriceDb as backtest.mjs
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
  console.log(`[buildPriceDb] First common: ${new Date(dates[0] * 1000).toISOString().split('T')[0]}`)
  console.log(`[buildPriceDb] Last common: ${new Date(dates[dates.length - 1] * 1000).toISOString().split('T')[0]}`)

  const open = {}
  const close = {}
  for (const { ticker, byTime } of barMaps) {
    open[ticker] = dates.map((d) => byTime.get(d)?.open ?? null)
    close[ticker] = dates.map((d) => byTime.get(d)?.close ?? null)
  }

  return { dates, open, close }
}

const main = async () => {
  // Load ONLY indicator tickers (not position tickers UVXY/BIL)
  // This tests whether momentum works correctly with longer date range
  const tickers = ['SPY', 'XLU', 'XLV', 'XLP', 'XLY', 'VIG']
  const loaded = []

  for (const t of tickers) {
    try {
      const bars = await fetchOhlcSeries(t)
      loaded.push({ ticker: t, bars })
    } catch (err) {
      console.log(`Failed to load ${t}: ${err.message}`)
    }
  }

  const db = buildPriceDb(loaded.filter(l => l.bars.length > 0))
  console.log(`\ndb.close keys: ${Object.keys(db.close).join(', ')}`)

  // Check a specific date
  const testDate = '2013-05-16'

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
    // Check if date is before first common date
    const firstCommon = new Date(db.dates[0] * 1000).toISOString().split('T')[0]
    console.log(`First common date is ${firstCommon}`)
    return
  }

  console.log(`\n--- Date ${testDate} at index ${dateIdx} ---`)

  // Show close values for all tickers at this index
  for (const t of ['SPY', 'XLU', 'XLV', 'XLP', 'XLY', 'VIG']) {
    const close = db.close[t]?.[dateIdx]
    console.log(`${t}: close[${dateIdx}] = ${close}`)
  }

  // Calculate ratios correctly (same logic as getCachedCloseArray)
  console.log(`\n--- Ratio calculations ---`)
  for (const den of ['XLU', 'XLV', 'XLP', 'XLY', 'VIG']) {
    const numClose = db.close['SPY']
    const denClose = db.close[den]
    const ratio = numClose[dateIdx] / denClose[dateIdx]
    console.log(`SPY/${den}[${dateIdx}] = ${numClose[dateIdx]} / ${denClose[dateIdx]} = ${ratio.toFixed(6)}`)
  }

  // Now verify momentum calculation with these correct ratios
  console.log(`\n--- 13612W Momentum at index ${dateIdx} (${testDate}) ---`)
  const m1 = 21, m3 = 63, m6 = 126, m12 = 252

  for (const den of ['XLU', 'XLV', 'XLP', 'XLY', 'VIG']) {
    const numClose = db.close['SPY']
    const denClose = db.close[den]

    // Build ratio array like getCachedCloseArray does
    const ratioArr = numClose.map((v, i) => {
      const d = denClose[i]
      return (v != null && d != null && d !== 0) ? v / d : NaN
    })

    if (dateIdx < m12) {
      console.log(`SPY/${den}: index too low for momentum`)
      continue
    }

    const p0 = ratioArr[dateIdx]
    const p1 = ratioArr[dateIdx - m1]
    const p3 = ratioArr[dateIdx - m3]
    const p6 = ratioArr[dateIdx - m6]
    const p12 = ratioArr[dateIdx - m12]

    console.log(`SPY/${den}: p0=${p0?.toFixed(4)}, p1=${p1?.toFixed(4)}, p3=${p3?.toFixed(4)}, p6=${p6?.toFixed(4)}, p12=${p12?.toFixed(4)}`)

    if (p0 && p1 && p3 && p6 && p12 && !isNaN(p0) && !isNaN(p1) && !isNaN(p3) && !isNaN(p6) && !isNaN(p12)) {
      const mom = (12*(p0/p1-1) + 4*(p0/p3-1) + 2*(p0/p6-1) + (p0/p12-1)) / 19
      console.log(`  13612W = ${mom.toFixed(6)} < 0 ? ${mom < 0}`)
    } else {
      console.log(`  13612W = null (missing data)`)
    }
  }

  // Check SPY RSI(14) using Wilder method
  console.log(`\n--- SPY RSI(14) Check ---`)
  const spyCloses = db.close['SPY']
  const rsiPeriod = 14

  // Calculate RSI at dateIdx using Wilder's smoothing
  // Need to first get avg gain/loss over first period, then apply smoothing
  if (dateIdx >= rsiPeriod) {
    // Initial avg gain/loss
    let avgGain = 0, avgLoss = 0
    for (let i = dateIdx - rsiPeriod + 1; i <= dateIdx - rsiPeriod + rsiPeriod; i++) {
      const change = spyCloses[i] - spyCloses[i - 1]
      if (change > 0) avgGain += change
      else avgLoss += Math.abs(change)
    }
    avgGain /= rsiPeriod
    avgLoss /= rsiPeriod

    // Apply Wilder smoothing for remaining periods
    for (let i = dateIdx - rsiPeriod + rsiPeriod + 1; i <= dateIdx; i++) {
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
    console.log(`SPY RSI(14) at index ${dateIdx} = ${rsi.toFixed(4)}`)
    console.log(`RSI > 74 ? ${rsi > 74}`)
  }
}

main().catch(console.error)
