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

// Use backtest's exact RSI implementation
const rollingWilderRsi = (closes, period) => {
  const out = new Array(closes.length).fill(null)
  let avgGain = null
  let avgLoss = null
  let seedG = 0
  let seedL = 0
  let seedCount = 0
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1]
    const cur = closes[i]
    if (Number.isNaN(prev) || Number.isNaN(cur)) {
      avgGain = null
      avgLoss = null
      seedG = 0
      seedL = 0
      seedCount = 0
      continue
    }
    const change = cur - prev
    const gain = change > 0 ? change : 0
    const loss = change < 0 ? -change : 0
    if (avgGain == null || avgLoss == null) {
      seedG += gain
      seedL += loss
      seedCount += 1
      if (seedCount === period) {
        avgGain = seedG / period
        avgLoss = seedL / period
        const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss
        out[i] = 100 - 100 / (1 + rs)
      }
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period
      avgLoss = (avgLoss * (period - 1) + loss) / period
      const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss
      out[i] = 100 - 100 / (1 + rs)
    }
  }
  return out
}

const main = async () => {
  const spyBars = await fetchOhlcSeries('SPY')
  console.log('SPY bars:', spyBars.length)

  // Find 5/16/2013
  const testDate = '2013-05-16'
  let dateIdx = -1
  for (let i = 0; i < spyBars.length; i++) {
    const d = new Date(spyBars[i].time * 1000).toISOString().split('T')[0]
    if (d === testDate) {
      dateIdx = i
      break
    }
  }

  console.log('Date index for', testDate, ':', dateIdx)

  // Calculate RSI using backtest's exact function
  const closes = spyBars.map(b => b.close)
  const rsiSeries = rollingWilderRsi(closes, 14)

  console.log('RSI at index', dateIdx, ':', rsiSeries[dateIdx])
  console.log('RSI > 74 ?', rsiSeries[dateIdx] > 74)

  // Also show nearby dates
  console.log('\nRSI around', testDate, ':')
  for (let i = dateIdx - 3; i <= dateIdx + 3; i++) {
    const d = new Date(spyBars[i].time * 1000).toISOString().split('T')[0]
    console.log(d, 'RSI:', rsiSeries[i]?.toFixed(2), '> 74?', rsiSeries[i] > 74)
  }
}

main().catch(console.error)
