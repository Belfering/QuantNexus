/**
 * Indicator Performance Benchmark
 * Run with: node server/benchmark-indicators.mjs
 *
 * This measures JavaScript indicator performance.
 */

import path from 'path'
import { fileURLToPath } from 'url'
import duckdb from 'duckdb'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PARQUET_DIR = process.env.PARQUET_DIR || path.join(__dirname, '..', 'ticker-data', 'data', 'ticker_data_parquet')

// ============================================
// INDICATOR IMPLEMENTATIONS (copied from backtest.mjs)
// ============================================

const rollingSma = (values, period) => {
  const out = new Array(values.length).fill(null)
  let sum = 0
  let missing = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (Number.isNaN(v)) missing += 1
    else sum += v
    if (i >= period) {
      const prev = values[i - period]
      if (Number.isNaN(prev)) missing -= 1
      else sum -= prev
    }
    if (i >= period - 1 && missing === 0) out[i] = sum / period
  }
  return out
}

const rollingEma = (values, period) => {
  const out = new Array(values.length).fill(null)
  const alpha = 2 / (period + 1)
  let ema = null
  let readyCount = 0
  let seedSum = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (Number.isNaN(v)) {
      ema = null
      readyCount = 0
      seedSum = 0
      continue
    }
    if (ema == null) {
      seedSum += v
      readyCount += 1
      if (readyCount === period) {
        ema = seedSum / period
        out[i] = ema
      }
      continue
    }
    ema = alpha * v + (1 - alpha) * ema
    out[i] = ema
  }
  return out
}

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
      continue
    }
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss
    out[i] = 100 - 100 / (1 + rs)
  }
  return out
}

const rollingStdDev = (values, period) => {
  const out = new Array(values.length).fill(null)
  let sum = 0
  let sumSq = 0
  let missing = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (Number.isNaN(v)) {
      missing += 1
    } else {
      sum += v
      sumSq += v * v
    }
    if (i >= period) {
      const prev = values[i - period]
      if (Number.isNaN(prev)) missing -= 1
      else {
        sum -= prev
        sumSq -= prev * prev
      }
    }
    if (i >= period - 1 && missing === 0) {
      const mean = sum / period
      const variance = Math.max(0, sumSq / period - mean * mean)
      out[i] = Math.sqrt(variance) * 100
    }
  }
  return out
}

const rollingBollingerB = (closes, period, stdMult = 2) => {
  const sma = rollingSma(closes, period)
  const std = rollingStdDev(closes, period)
  const out = new Array(closes.length).fill(null)
  for (let i = 0; i < closes.length; i++) {
    if (sma[i] == null || std[i] == null) continue
    const upper = sma[i] + stdMult * (std[i] / 100)
    const lower = sma[i] - stdMult * (std[i] / 100)
    if (upper === lower) continue
    out[i] = (closes[i] - lower) / (upper - lower)
  }
  return out
}

const rollingAtr = (highs, lows, closes, period) => {
  const out = new Array(closes.length).fill(null)
  const tr = []
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) {
      tr.push(highs[i] - lows[i])
    } else {
      const hl = highs[i] - lows[i]
      const hc = Math.abs(highs[i] - closes[i - 1])
      const lc = Math.abs(lows[i] - closes[i - 1])
      tr.push(Math.max(hl, hc, lc))
    }
  }
  return rollingEma(tr, period)
}

const rollingAdx = (highs, lows, closes, period) => {
  const n = highs.length
  const out = new Array(n).fill(null)
  if (n < period * 2) return out

  const tr = []
  const plusDM = []
  const minusDM = []

  for (let i = 1; i < n; i++) {
    const hl = highs[i] - lows[i]
    const hc = Math.abs(highs[i] - closes[i - 1])
    const lc = Math.abs(lows[i] - closes[i - 1])
    tr.push(Math.max(hl, hc, lc))

    const upMove = highs[i] - highs[i - 1]
    const downMove = lows[i - 1] - lows[i]
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0)
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0)
  }

  const smoothTr = rollingEma([0, ...tr], period)
  const smoothPlusDM = rollingEma([0, ...plusDM], period)
  const smoothMinusDM = rollingEma([0, ...minusDM], period)

  const dx = []
  for (let i = 0; i < n; i++) {
    if (smoothTr[i] == null || smoothTr[i] === 0) {
      dx.push(null)
      continue
    }
    const plusDI = (smoothPlusDM[i] / smoothTr[i]) * 100
    const minusDI = (smoothMinusDM[i] / smoothTr[i]) * 100
    const sum = plusDI + minusDI
    dx.push(sum === 0 ? 0 : Math.abs(plusDI - minusDI) / sum * 100)
  }

  return rollingEma(dx, period)
}

const rollingMACD = (closes) => {
  const ema12 = rollingEma(closes, 12)
  const ema26 = rollingEma(closes, 26)
  const macdLine = ema12.map((v, i) => (v != null && ema26[i] != null) ? v - ema26[i] : null)
  const signal = rollingEma(macdLine.map(v => v ?? NaN), 9)
  return macdLine.map((v, i) => (v != null && signal[i] != null) ? v - signal[i] : null)
}

const rollingLinRegSlope = (values, period) => {
  const out = new Array(values.length).fill(null)
  for (let i = period - 1; i < values.length; i++) {
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0
    let valid = true
    for (let j = 0; j < period; j++) {
      const y = values[i - period + 1 + j]
      if (Number.isNaN(y)) { valid = false; break }
      sumX += j
      sumY += y
      sumXY += j * y
      sumX2 += j * j
    }
    if (!valid) continue
    const denom = period * sumX2 - sumX * sumX
    if (denom === 0) continue
    out[i] = (period * sumXY - sumX * sumY) / denom
  }
  return out
}

// ============================================
// BENCHMARK UTILITIES
// ============================================

function generateSyntheticData(length) {
  const data = {
    closes: new Array(length),
    highs: new Array(length),
    lows: new Array(length),
    volumes: new Array(length)
  }

  let price = 100
  for (let i = 0; i < length; i++) {
    // Random walk with drift
    price *= (1 + (Math.random() - 0.48) * 0.02)
    const volatility = price * 0.01
    data.closes[i] = price
    data.highs[i] = price + Math.random() * volatility
    data.lows[i] = price - Math.random() * volatility
    data.volumes[i] = Math.floor(Math.random() * 1000000) + 100000
  }

  return data
}

async function loadRealTickerData(ticker) {
  return new Promise((resolve, reject) => {
    const db = new duckdb.Database(':memory:')
    const filePath = path.join(PARQUET_DIR, `${ticker}.parquet`).replace(/\\/g, '/')

    const sql = `
      SELECT
        Close AS close,
        High AS high,
        Low AS low,
        Volume AS volume
      FROM read_parquet('${filePath}')
      ORDER BY Date ASC
    `

    db.all(sql, (err, rows) => {
      if (err) {
        reject(err)
        return
      }

      const data = {
        closes: rows.map(r => Number(r.close)),
        highs: rows.map(r => Number(r.high)),
        lows: rows.map(r => Number(r.low)),
        volumes: rows.map(r => Number(r.volume))
      }

      db.close()
      resolve(data)
    })
  })
}

function benchmark(name, fn, iterations = 100) {
  // Warmup
  for (let i = 0; i < 5; i++) fn()

  // Timed runs
  const times = []
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    fn()
    times.push(performance.now() - start)
  }

  times.sort((a, b) => a - b)

  return {
    name,
    iterations,
    mean: times.reduce((a, b) => a + b, 0) / times.length,
    median: times[Math.floor(times.length / 2)],
    min: times[0],
    max: times[times.length - 1],
    p95: times[Math.floor(times.length * 0.95)],
    stdDev: Math.sqrt(times.reduce((sum, t) => sum + Math.pow(t - (times.reduce((a, b) => a + b, 0) / times.length), 2), 0) / times.length)
  }
}

function formatResult(result) {
  return `${result.name.padEnd(30)} | mean: ${result.mean.toFixed(3).padStart(8)}ms | median: ${result.median.toFixed(3).padStart(8)}ms | min: ${result.min.toFixed(3).padStart(7)}ms | max: ${result.max.toFixed(3).padStart(8)}ms | p95: ${result.p95.toFixed(3).padStart(8)}ms`
}

// ============================================
// MAIN BENCHMARK
// ============================================

async function runBenchmarks() {
  console.log('='.repeat(120))
  console.log('INDICATOR PERFORMANCE BENCHMARK')
  console.log('='.repeat(120))
  console.log(`Date: ${new Date().toISOString()}`)
  console.log(`Node.js: ${process.version}`)
  console.log(`Platform: ${process.platform} ${process.arch}`)
  console.log('')

  // Test with different data sizes
  const dataSizes = [1000, 5000, 10000, 20000]
  const iterations = 50

  const allResults = []

  for (const size of dataSizes) {
    console.log(`\n${'─'.repeat(120)}`)
    console.log(`DATA SIZE: ${size.toLocaleString()} bars (${iterations} iterations each)`)
    console.log('─'.repeat(120))

    const data = generateSyntheticData(size)
    const { closes, highs, lows, volumes } = data

    const results = []

    // Core indicators
    results.push(benchmark(`SMA(20)`, () => rollingSma(closes, 20), iterations))
    results.push(benchmark(`EMA(20)`, () => rollingEma(closes, 20), iterations))
    results.push(benchmark(`RSI(14)`, () => rollingWilderRsi(closes, 14), iterations))
    results.push(benchmark(`StdDev(20)`, () => rollingStdDev(closes, 20), iterations))
    results.push(benchmark(`Bollinger %B(20)`, () => rollingBollingerB(closes, 20), iterations))
    results.push(benchmark(`ATR(14)`, () => rollingAtr(highs, lows, closes, 14), iterations))
    results.push(benchmark(`ADX(14)`, () => rollingAdx(highs, lows, closes, 14), iterations))
    results.push(benchmark(`MACD(12,26,9)`, () => rollingMACD(closes), iterations))
    results.push(benchmark(`LinRegSlope(20)`, () => rollingLinRegSlope(closes, 20), iterations))

    // Multiple indicators (simulates complex bot)
    results.push(benchmark(`5 indicators combined`, () => {
      rollingSma(closes, 20)
      rollingEma(closes, 20)
      rollingWilderRsi(closes, 14)
      rollingStdDev(closes, 20)
      rollingMACD(closes)
    }, iterations))

    results.push(benchmark(`10 indicators combined`, () => {
      rollingSma(closes, 10)
      rollingSma(closes, 20)
      rollingSma(closes, 50)
      rollingEma(closes, 20)
      rollingWilderRsi(closes, 14)
      rollingStdDev(closes, 20)
      rollingBollingerB(closes, 20)
      rollingAtr(highs, lows, closes, 14)
      rollingAdx(highs, lows, closes, 14)
      rollingMACD(closes)
    }, iterations))

    for (const r of results) {
      console.log(formatResult(r))
      allResults.push({ ...r, dataSize: size })
    }
  }

  // Try with real data if available
  console.log(`\n${'─'.repeat(120)}`)
  console.log('REAL TICKER DATA (SPY)')
  console.log('─'.repeat(120))

  try {
    const realData = await loadRealTickerData('SPY')
    console.log(`Loaded ${realData.closes.length.toLocaleString()} bars of SPY data`)

    const { closes, highs, lows, volumes } = realData

    const realResults = []
    realResults.push(benchmark(`SMA(20) - Real SPY`, () => rollingSma(closes, 20), iterations))
    realResults.push(benchmark(`RSI(14) - Real SPY`, () => rollingWilderRsi(closes, 14), iterations))
    realResults.push(benchmark(`ADX(14) - Real SPY`, () => rollingAdx(highs, lows, closes, 14), iterations))
    realResults.push(benchmark(`10 indicators - Real SPY`, () => {
      rollingSma(closes, 10)
      rollingSma(closes, 20)
      rollingSma(closes, 50)
      rollingEma(closes, 20)
      rollingWilderRsi(closes, 14)
      rollingStdDev(closes, 20)
      rollingBollingerB(closes, 20)
      rollingAtr(highs, lows, closes, 14)
      rollingAdx(highs, lows, closes, 14)
      rollingMACD(closes)
    }, iterations))

    for (const r of realResults) {
      console.log(formatResult(r))
      allResults.push({ ...r, dataSize: realData.closes.length, realData: true })
    }
  } catch (err) {
    console.log(`Could not load SPY data: ${err.message}`)
  }

  // Summary
  console.log(`\n${'='.repeat(120)}`)
  console.log('SUMMARY')
  console.log('='.repeat(120))

  // Calculate total time for complex scenario
  const complex20k = allResults.find(r => r.name.includes('10 indicators') && r.dataSize === 20000 && !r.realData)
  if (complex20k) {
    console.log(`\nComplex bot scenario (10 indicators × 20k bars):`)
    console.log(`  Mean time: ${complex20k.mean.toFixed(2)}ms`)
    console.log(`  Per 100 backtests: ${(complex20k.mean * 100 / 1000).toFixed(2)}s`)
    console.log(`  Estimated with 5 tickers: ${(complex20k.mean * 5).toFixed(2)}ms`)
  }

  console.log(`\nBenchmark complete.`)

  // Save results to JSON for later comparison
  const outputPath = path.join(__dirname, 'benchmark-results.json')
  const output = {
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    platform: `${process.platform} ${process.arch}`,
    engine: 'javascript',
    results: allResults
  }

  const fs = await import('fs')
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2))
  console.log(`\nResults saved to: ${outputPath}`)
}

runBenchmarks().catch(console.error)
