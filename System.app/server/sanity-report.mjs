/**
 * Sanity & Risk Report Module
 *
 * Provides statistical analysis for backtest results without pretending to validate overfitting.
 * Two categories of analysis:
 * 1. Path Risk - "If the edge were real, how dangerous is the ride?"
 * 2. Fragility Fingerprints - "Does this curve look suspiciously lucky?"
 *
 * Adapted from Python implementation: C:\Users\Trader\Desktop\New\src\rsi_engine\eval\mckf.py
 */

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Seeded random number generator (mulberry32) for reproducibility
 */
function mulberry32(seed) {
  return function() {
    let t = seed += 0x6D2B79F5
    t = Math.imul(t ^ t >>> 15, t | 1)
    t ^= t + Math.imul(t ^ t >>> 7, t | 61)
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

/**
 * Compute max drawdown from equity curve array
 * Returns negative value (e.g., -0.25 for 25% drawdown)
 */
function computeMaxDrawdown(equity) {
  let peak = -Infinity
  let maxDd = 0
  for (const v of equity) {
    if (v > peak) peak = v
    if (peak > 0) {
      const dd = v / peak - 1
      if (dd < maxDd) maxDd = dd
    }
  }
  return maxDd
}

/**
 * Compute CAGR from equity array
 */
function computeCagr(equity, days) {
  if (days <= 0 || equity.length < 2) return 0
  const final = equity[equity.length - 1]
  const initial = equity[0]
  if (initial <= 0 || final <= 0) return 0
  return Math.pow(final / initial, 252 / days) - 1
}

/**
 * Build equity curve from daily returns
 */
function buildEquityCurve(returns) {
  const equity = [1]
  for (const r of returns) {
    equity.push(equity[equity.length - 1] * (1 + r))
  }
  return equity
}

/**
 * Compute percentile from sorted array
 */
function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0
  const idx = Math.max(0, Math.min(sortedArr.length - 1, Math.floor(p * sortedArr.length)))
  return sortedArr[idx]
}

/**
 * Create histogram buckets from sorted array
 * Returns array of { min, max, count } for display in bar chart
 */
function createHistogram(sortedArr, numBuckets = 20) {
  if (sortedArr.length === 0) return []
  const min = sortedArr[0]
  const max = sortedArr[sortedArr.length - 1]
  const range = max - min
  if (range === 0) {
    return [{ min, max, count: sortedArr.length, midpoint: min }]
  }
  const bucketSize = range / numBuckets
  const buckets = []
  for (let i = 0; i < numBuckets; i++) {
    const bucketMin = min + i * bucketSize
    const bucketMax = min + (i + 1) * bucketSize
    const count = sortedArr.filter(v => v >= bucketMin && (i === numBuckets - 1 ? v <= bucketMax : v < bucketMax)).length
    buckets.push({
      min: bucketMin,
      max: bucketMax,
      midpoint: (bucketMin + bucketMax) / 2,
      count
    })
  }
  return buckets
}

/**
 * Fisher-Yates shuffle (in place)
 */
function shuffleArray(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/**
 * Split daily returns into IS and OOS periods based on date
 * @param {Array<{date: string, return: number}>} dailyReturns - Array of {date, return} objects
 * @param {string} oosStartDate - ISO date string (YYYY-MM-DD) marking OOS start
 * @returns {{is: number[], oos: number[], isDates: string[], oosDates: string[]}}
 */
function splitDailyReturns(dailyReturns, oosStartDate) {
  if (!oosStartDate || !dailyReturns || dailyReturns.length === 0) {
    const returns = dailyReturns.map(d => d.return)
    const dates = dailyReturns.map(d => d.date)
    return { is: returns, oos: [], isDates: dates, oosDates: [] }
  }

  const isDays = []
  const oosDays = []
  const isDates = []
  const oosDates = []

  for (const day of dailyReturns) {
    if (day.date < oosStartDate) {
      isDays.push(day.return)
      isDates.push(day.date)
    } else {
      oosDays.push(day.return)
      oosDates.push(day.date)
    }
  }

  return { is: isDays, oos: oosDays, isDates, oosDates }
}

/**
 * Compute annualized volatility from daily returns
 */
function computeVolatility(returns) {
  if (returns.length < 2) return 0
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1)
  const dailyVol = Math.sqrt(variance)
  return dailyVol * Math.sqrt(252) // Annualized
}

/**
 * Compute win rate (% of positive return days)
 */
function computeWinRate(returns) {
  if (returns.length === 0) return 0
  const winners = returns.filter(r => r > 0).length
  return winners / returns.length
}

/**
 * Compute Sharpe ratio (assumes risk-free rate of 0)
 */
function computeSharpe(returns) {
  if (returns.length < 2) return 0
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1)
  const dailyVol = Math.sqrt(variance)
  if (dailyVol === 0) return 0
  // Annualized Sharpe
  return (mean / dailyVol) * Math.sqrt(252)
}

/**
 * Compute Sortino ratio (downside deviation only)
 */
function computeSortino(returns) {
  if (returns.length < 2) return 0
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const downside = returns.filter(r => r < 0)
  if (downside.length === 0) return mean > 0 ? Infinity : 0

  const downsideVariance = downside.reduce((sum, r) => sum + Math.pow(r, 2), 0) / downside.length
  const downsideVol = Math.sqrt(downsideVariance)
  if (downsideVol === 0) return 0
  // Annualized Sortino
  return (mean / downsideVol) * Math.sqrt(252)
}

/**
 * Compute just beta vs a benchmark (simpler version for multi-benchmark comparison)
 * @param {number[]} strategyReturns - Strategy daily returns
 * @param {number[]} benchmarkReturns - Benchmark daily returns
 */
export function computeBeta(strategyReturns, benchmarkReturns) {
  if (strategyReturns.length < 2 || benchmarkReturns.length < 2) {
    return 0
  }

  const len = Math.min(strategyReturns.length, benchmarkReturns.length)
  const r = strategyReturns.slice(0, len)
  const b = benchmarkReturns.slice(0, len)

  const meanR = r.reduce((a, v) => a + v, 0) / len
  const meanB = b.reduce((a, v) => a + v, 0) / len

  let covariance = 0
  let varB = 0
  for (let i = 0; i < len; i++) {
    covariance += (r[i] - meanR) * (b[i] - meanB)
    varB += Math.pow(b[i] - meanB, 2)
  }
  covariance /= (len - 1)
  varB /= (len - 1)

  return varB > 0 ? covariance / varB : 0
}

/**
 * Compute Beta and Treynor ratio vs benchmark returns
 * @param {number[]} returns - Strategy returns
 * @param {number[]} benchmarkReturns - Benchmark (SPY) returns, same length
 */
function computeBetaTreynor(returns, benchmarkReturns) {
  console.log(`[computeBetaTreynor] Input lengths: returns=${returns.length}, benchmark=${benchmarkReturns.length}`)

  // Check for NaN values
  const returnsNaN = returns.filter(r => !isFinite(r)).length
  const benchmarkNaN = benchmarkReturns.filter(r => !isFinite(r)).length
  console.log(`[computeBetaTreynor] NaN/Infinite values: returns=${returnsNaN}, benchmark=${benchmarkNaN}`)

  // Check for sample values
  console.log(`[computeBetaTreynor] Returns sample (first 10):`, returns.slice(0, 10))
  console.log(`[computeBetaTreynor] Benchmark sample (first 10):`, benchmarkReturns.slice(0, 10))

  if (returns.length < 2 || benchmarkReturns.length < 2) {
    console.log(`[computeBetaTreynor] Insufficient data, returning beta=0`)
    return { beta: 0, treynor: 0 }
  }

  // Align lengths
  const len = Math.min(returns.length, benchmarkReturns.length)
  console.log(`[computeBetaTreynor] Aligned length: ${len}`)
  const r = returns.slice(0, len)
  const b = benchmarkReturns.slice(0, len)

  // Compute means
  const meanR = r.reduce((a, v) => a + v, 0) / len
  const meanB = b.reduce((a, v) => a + v, 0) / len

  // Compute covariance and variance of benchmark
  let covariance = 0
  let varB = 0
  for (let i = 0; i < len; i++) {
    covariance += (r[i] - meanR) * (b[i] - meanB)
    varB += Math.pow(b[i] - meanB, 2)
  }
  covariance /= (len - 1)
  varB /= (len - 1)

  const beta = varB > 0 ? covariance / varB : 0
  console.log(`[computeBetaTreynor] Covariance=${covariance.toFixed(6)}, VarB=${varB.toFixed(6)}, Beta=${beta.toFixed(4)}`)

  // Treynor = (Return - Rf) / Beta, using annualized CAGR
  // Simplified: mean daily return * 252 / beta
  const annualizedReturn = meanR * 252
  const treynor = beta !== 0 ? annualizedReturn / beta : 0

  return { beta, treynor }
}

// ============================================
// BLOCK-BASED MONTE CARLO (from mckf.py)
// ============================================

/**
 * Create overlapping blocks from returns array
 * @param {number[]} returns - Daily returns
 * @param {number} blockSize - Size of each block (default 7, must divide 252)
 */
function makeBlocks(returns, blockSize) {
  const n = returns.length
  if (n < blockSize) return []
  const blocks = []
  for (let i = 0; i <= n - blockSize; i++) {
    blocks.push(returns.slice(i, i + blockSize))
  }
  return blocks
}

/**
 * Build a Monte Carlo path by sampling blocks
 * @param {number[]} returns - Original daily returns
 * @param {number} years - Number of years to simulate
 * @param {number} blockSize - Block size (must divide 252)
 * @param {function} rng - Random number generator
 */
function buildMcPath(returns, years, blockSize, rng) {
  const blocks = makeBlocks(returns, blockSize)
  if (blocks.length === 0) {
    throw new Error(`Not enough data for block size ${blockSize}`)
  }

  const blocksPerYear = Math.floor(252 / blockSize)
  const totalBlocks = years * blocksPerYear

  const sampledReturns = []
  for (let i = 0; i < totalBlocks; i++) {
    const idx = Math.floor(rng() * blocks.length)
    sampledReturns.push(...blocks[idx])
  }

  return sampledReturns
}

/**
 * Run Monte Carlo simulations
 * @param {number[]} returns - Strategy daily returns
 * @param {Object} options - Configuration options
 * @param {number[]} [spyReturns] - SPY returns for beta/treynor calculation
 */
function runMonteCarlo(returns, options = {}, spyReturns = null) {
  const {
    simulations = 50,
    years = 5,
    blockSize = 7,
    seed = 42
  } = options

  const rng = mulberry32(seed)
  const results = []

  for (let i = 0; i < simulations; i++) {
    try {
      const mcReturns = buildMcPath(returns, years, blockSize, rng)
      const equity = buildEquityCurve(mcReturns)
      const maxDd = computeMaxDrawdown(equity)
      const cagr = computeCagr(equity, mcReturns.length)
      const sharpe = computeSharpe(mcReturns)
      const sortino = computeSortino(mcReturns)
      const volatility = computeVolatility(mcReturns)
      const winRate = computeWinRate(mcReturns)

      // Compute beta/treynor if SPY returns provided
      let beta = 0, treynor = 0
      if (spyReturns && spyReturns.length > 0) {
        // Log every 50th simulation to avoid console spam
        if (i % 50 === 0) {
          console.log(`[MC Beta] Simulation ${i}: mcReturns.length=${mcReturns.length}, building SPY path...`)
        }
        // Build corresponding SPY path using same seed/block selection
        const spyRng = mulberry32(seed + i) // Use same randomness pattern
        const spyMcReturns = buildMcPath(spyReturns, years, blockSize, spyRng)
        if (i % 50 === 0) {
          console.log(`[MC Beta] Simulation ${i}: spyMcReturns.length=${spyMcReturns.length}`)
        }
        const bt = computeBetaTreynor(mcReturns, spyMcReturns)
        beta = bt.beta
        treynor = bt.treynor
        if (i % 50 === 0) {
          console.log(`[MC Beta] Simulation ${i}: beta=${beta}, treynor=${treynor}`)
        }
      }

      results.push({ maxDd, cagr, sharpe, sortino, volatility, winRate, beta, treynor })
    } catch (e) {
      // Skip if not enough data
    }
  }

  return results
}

// ============================================
// K-FOLD DROP-1 (from mckf.py)
// ============================================

/**
 * Split array into N shards
 */
function makeShards(returns, numShards, rng) {
  const n = returns.length
  if (n === 0) return []

  const shards = Math.max(1, Math.min(numShards, n))

  // Random starting rotation
  const startIdx = Math.floor(rng() * n)
  const rotated = [...returns.slice(startIdx), ...returns.slice(0, startIdx)]

  const base = Math.floor(n / shards)
  const rem = n % shards

  const result = []
  let cur = 0
  for (let i = 0; i < shards; i++) {
    const size = base + (i < rem ? 1 : 0)
    result.push(rotated.slice(cur, cur + size))
    cur += size
  }

  return result
}

/**
 * Build K-Fold drop-1 sample
 * Returns the concatenated returns with one shard dropped
 */
function buildKfoldDrop1(returns, numShards, rng, shuffleRemaining = true) {
  const shards = makeShards(returns, numShards, rng)
  if (shards.length === 0) return returns.slice()

  const dropIdx = Math.floor(rng() * shards.length)
  const keep = shards.filter((_, i) => i !== dropIdx)

  if (shuffleRemaining && keep.length > 1) {
    shuffleArray(keep, rng)
  }

  return keep.flat()
}

/**
 * Run K-Fold validation
 * @param {number[]} returns - Strategy daily returns
 * @param {Object} options - Configuration options
 * @param {number[]} [spyReturns] - SPY returns for beta/treynor calculation
 */
function runKfold(returns, options = {}, spyReturns = null) {
  const {
    folds = 50,
    shards = 10,
    seed = 42
  } = options

  const rng = mulberry32(seed + 1000) // Different seed from MC
  const results = []

  for (let i = 0; i < folds; i++) {
    const kfReturns = buildKfoldDrop1(returns, shards, rng, true)
    const equity = buildEquityCurve(kfReturns)
    const maxDd = computeMaxDrawdown(equity)
    const cagr = computeCagr(equity, kfReturns.length)
    const sharpe = computeSharpe(kfReturns)
    const sortino = computeSortino(kfReturns)
    const volatility = computeVolatility(kfReturns)
    const winRate = computeWinRate(kfReturns)

    // Compute beta/treynor if SPY returns provided
    let beta = 0, treynor = 0
    if (spyReturns && spyReturns.length > 0) {
      // Build corresponding SPY K-Fold path using same pattern
      const spyRng = mulberry32(seed + 1000 + i)
      const spyKfReturns = buildKfoldDrop1(spyReturns, shards, spyRng, true)
      const bt = computeBetaTreynor(kfReturns, spyKfReturns)
      beta = bt.beta
      treynor = bt.treynor
    }

    results.push({ maxDd, cagr, sharpe, sortino, volatility, winRate, beta, treynor })
  }

  return results
}

// ============================================
// PATH RISK ANALYSIS
// ============================================

/**
 * Helper to compute mean of an array
 */
function mean(arr) {
  if (arr.length === 0) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

/**
 * Compute path risk metrics using Monte Carlo and K-Fold
 * @param {number[]} returns - Strategy daily returns
 * @param {Object} options - Configuration options
 * @param {number[]} [spyReturns] - SPY returns for beta/treynor calculation
 */
export function computePathRisk(returns, options = {}, spyReturns = null) {
  const {
    mcSimulations = 400,
    kfFolds = 200,
    years = 5,
    blockSize = 7,
    shards = 10,
    seed = 42
  } = options

  // Monte Carlo results
  const mcResults = runMonteCarlo(returns, {
    simulations: mcSimulations,
    years,
    blockSize,
    seed
  }, spyReturns)
  const mcDrawdowns = mcResults.map(r => r.maxDd).sort((a, b) => a - b)
  const mcCagrs = mcResults.map(r => r.cagr).sort((a, b) => a - b)

  // K-Fold results
  const kfResults = runKfold(returns, { folds: kfFolds, shards, seed }, spyReturns)
  const kfDrawdowns = kfResults.map(r => r.maxDd).sort((a, b) => a - b)
  const kfCagrs = kfResults.map(r => r.cagr).sort((a, b) => a - b)

  // Sort sharpe and volatility for percentile distributions
  const mcSharpes = mcResults.map(r => r.sharpe).sort((a, b) => a - b)
  const mcVolatilities = mcResults.map(r => r.volatility).sort((a, b) => a - b)
  const kfSharpes = kfResults.map(r => r.sharpe).sort((a, b) => a - b)
  const kfVolatilities = kfResults.map(r => r.volatility).sort((a, b) => a - b)

  // Aggregate additional metrics for comparison table
  const mcComparisonMetrics = {
    cagr50: percentile(mcCagrs, 0.50),
    maxdd50: percentile(mcDrawdowns, 0.50),
    maxdd95: percentile(mcDrawdowns, 0.05), // p5 is worst (most negative)
    calmar50: Math.abs(percentile(mcDrawdowns, 0.50)) > 0
      ? percentile(mcCagrs, 0.50) / Math.abs(percentile(mcDrawdowns, 0.50)) : 0,
    calmar95: Math.abs(percentile(mcDrawdowns, 0.05)) > 0
      ? percentile(mcCagrs, 0.50) / Math.abs(percentile(mcDrawdowns, 0.05)) : 0,
    sharpe: mean(mcResults.map(r => r.sharpe)),
    sortino: mean(mcResults.map(r => r.sortino)),
    volatility: mean(mcResults.map(r => r.volatility)),
    winRate: mean(mcResults.map(r => r.winRate)),
    beta: mean(mcResults.map(r => r.beta)),
    treynor: mean(mcResults.map(r => r.treynor))
  }

  const kfComparisonMetrics = {
    cagr50: percentile(kfCagrs, 0.50),
    maxdd50: percentile(kfDrawdowns, 0.50),
    maxdd95: percentile(kfDrawdowns, 0.05), // p5 is worst (most negative)
    calmar50: Math.abs(percentile(kfDrawdowns, 0.50)) > 0
      ? percentile(kfCagrs, 0.50) / Math.abs(percentile(kfDrawdowns, 0.50)) : 0,
    calmar95: Math.abs(percentile(kfDrawdowns, 0.05)) > 0
      ? percentile(kfCagrs, 0.50) / Math.abs(percentile(kfDrawdowns, 0.05)) : 0,
    sharpe: mean(kfResults.map(r => r.sharpe)),
    sortino: mean(kfResults.map(r => r.sortino)),
    volatility: mean(kfResults.map(r => r.volatility)),
    winRate: mean(kfResults.map(r => r.winRate)),
    beta: mean(kfResults.map(r => r.beta)),
    treynor: mean(kfResults.map(r => r.treynor))
  }

  return {
    monteCarlo: {
      drawdowns: {
        p5: percentile(mcDrawdowns, 0.05),
        p25: percentile(mcDrawdowns, 0.25),
        p50: percentile(mcDrawdowns, 0.50),
        p75: percentile(mcDrawdowns, 0.75),
        p95: percentile(mcDrawdowns, 0.95),
        histogram: createHistogram(mcDrawdowns, 20)
      },
      cagrs: {
        p5: percentile(mcCagrs, 0.05),
        p25: percentile(mcCagrs, 0.25),
        p50: percentile(mcCagrs, 0.50),
        p75: percentile(mcCagrs, 0.75),
        p95: percentile(mcCagrs, 0.95),
        histogram: createHistogram(mcCagrs, 20)
      },
      sharpes: {
        p5: percentile(mcSharpes, 0.05),
        p25: percentile(mcSharpes, 0.25),
        p50: percentile(mcSharpes, 0.50),
        p75: percentile(mcSharpes, 0.75),
        p95: percentile(mcSharpes, 0.95)
      },
      volatilities: {
        p5: percentile(mcVolatilities, 0.05),
        p25: percentile(mcVolatilities, 0.25),
        p50: percentile(mcVolatilities, 0.50),
        p75: percentile(mcVolatilities, 0.75),
        p95: percentile(mcVolatilities, 0.95)
      }
    },
    kfold: {
      drawdowns: {
        p5: percentile(kfDrawdowns, 0.05),
        p25: percentile(kfDrawdowns, 0.25),
        p50: percentile(kfDrawdowns, 0.50),
        p75: percentile(kfDrawdowns, 0.75),
        p95: percentile(kfDrawdowns, 0.95)
      },
      cagrs: {
        p5: percentile(kfCagrs, 0.05),
        p25: percentile(kfCagrs, 0.25),
        p50: percentile(kfCagrs, 0.50),
        p75: percentile(kfCagrs, 0.75),
        p95: percentile(kfCagrs, 0.95)
      },
      sharpes: {
        p5: percentile(kfSharpes, 0.05),
        p25: percentile(kfSharpes, 0.25),
        p50: percentile(kfSharpes, 0.50),
        p75: percentile(kfSharpes, 0.75),
        p95: percentile(kfSharpes, 0.95)
      },
      volatilities: {
        p5: percentile(kfVolatilities, 0.05),
        p25: percentile(kfVolatilities, 0.25),
        p50: percentile(kfVolatilities, 0.50),
        p75: percentile(kfVolatilities, 0.75),
        p95: percentile(kfVolatilities, 0.95)
      }
    },
    drawdownProbabilities: {
      gt20: mcDrawdowns.filter(d => d < -0.20).length / mcDrawdowns.length,
      gt30: mcDrawdowns.filter(d => d < -0.30).length / mcDrawdowns.length,
      gt40: mcDrawdowns.filter(d => d < -0.40).length / mcDrawdowns.length,
      gt50: mcDrawdowns.filter(d => d < -0.50).length / mcDrawdowns.length
    },
    comparisonMetrics: {
      monteCarlo: mcComparisonMetrics,
      kfold: kfComparisonMetrics
    }
  }
}

// ============================================
// FRAGILITY / OVERFIT FINGERPRINTS
// ============================================

/**
 * Sub-period stability: split history into N blocks and check concentration
 */
function computeSubPeriodStability(returns, numBlocks = 4) {
  const n = returns.length
  const blockSize = Math.floor(n / numBlocks)

  if (blockSize < 20) {
    return {
      level: 'Insufficient Data',
      detail: 'Need more trading days for sub-period analysis',
      concentrationPct: 0,
      blockReturns: []
    }
  }

  const blockReturns = []
  for (let i = 0; i < numBlocks; i++) {
    const start = i * blockSize
    const end = i === numBlocks - 1 ? n : (i + 1) * blockSize
    const blockRets = returns.slice(start, end)

    // Total return for this block
    let equity = 1
    for (const r of blockRets) {
      equity *= (1 + r)
    }
    blockReturns.push(equity - 1)
  }

  // Check concentration
  const totalReturn = blockReturns.reduce((a, b) => a + b, 0)
  const maxBlockReturn = Math.max(...blockReturns)
  const maxBlockIdx = blockReturns.indexOf(maxBlockReturn)

  let concentrationPct = totalReturn > 0 ? maxBlockReturn / totalReturn : 0
  if (concentrationPct < 0 || !isFinite(concentrationPct)) concentrationPct = 0

  let level = 'Low'
  if (concentrationPct > 0.7) level = 'High'
  else if (concentrationPct > 0.5) level = 'Medium'

  return {
    level,
    concentrationPct,
    maxBlockIndex: maxBlockIdx,
    detail: concentrationPct > 0.4
      ? `${(concentrationPct * 100).toFixed(0)}% of returns from period ${maxBlockIdx + 1}/${numBlocks}`
      : 'Returns distributed across periods',
    blockReturns
  }
}

/**
 * Profit concentration: what % of total P&L comes from top N days?
 */
function computeProfitConcentration(returns) {
  const n = returns.length
  if (n < 20) {
    return {
      level: 'Insufficient Data',
      top5DaysPct: 0,
      top10DaysPct: 0,
      detail: 'Need more trading days'
    }
  }

  const totalPnL = returns.reduce((a, b) => a + b, 0)
  if (totalPnL <= 0) {
    return {
      level: 'N/A',
      top5DaysPct: 0,
      top10DaysPct: 0,
      detail: 'Strategy has zero or negative total returns'
    }
  }

  // Sort descending (best days first)
  const sorted = [...returns].sort((a, b) => b - a)

  const top5Sum = sorted.slice(0, 5).reduce((a, b) => a + b, 0)
  const top10Sum = sorted.slice(0, 10).reduce((a, b) => a + b, 0)

  const top5Pct = top5Sum / totalPnL
  const top10Pct = top10Sum / totalPnL

  let level = 'Low'
  if (top5Pct > 0.7) level = 'High'
  else if (top5Pct > 0.4) level = 'Medium'

  return {
    level,
    top5DaysPct: top5Pct,
    top10DaysPct: top10Pct,
    detail: top5Pct > 0.4
      ? `Top 5 days account for ${(top5Pct * 100).toFixed(0)}% of total returns`
      : 'Profits reasonably distributed'
  }
}

/**
 * Smoothness score: compare actual MaxDD vs shuffled returns distribution
 */
function computeSmoothnessScore(returns, iterations = 100, seed = 42) {
  const rng = mulberry32(seed + 2000)
  const n = returns.length

  if (n < 50) {
    return {
      level: 'Insufficient Data',
      actualMaxDD: 0,
      shuffledP50: 0,
      ratio: 1,
      detail: 'Need more trading days'
    }
  }

  // Actual max drawdown
  const actualEquity = buildEquityCurve(returns)
  const actualMaxDD = computeMaxDrawdown(actualEquity)

  // Shuffled returns max drawdowns
  const shuffledDrawdowns = []
  for (let i = 0; i < iterations; i++) {
    const shuffled = [...returns]
    shuffleArray(shuffled, rng)
    const equity = buildEquityCurve(shuffled)
    shuffledDrawdowns.push(computeMaxDrawdown(equity))
  }

  shuffledDrawdowns.sort((a, b) => a - b)
  const shuffledP50 = percentile(shuffledDrawdowns, 0.50)
  const shuffledP25 = percentile(shuffledDrawdowns, 0.25)

  // If actual is much smaller (closer to 0) than shuffled, that's suspicious
  // Both are negative, so we compare absolute values
  const ratio = Math.abs(actualMaxDD) / Math.abs(shuffledP50)

  let level = 'Normal'
  if (ratio < 0.5) {
    level = 'Suspicious'
  } else if (ratio < 0.7) {
    level = 'Slightly Suspicious'
  }

  return {
    level,
    actualMaxDD,
    shuffledP25,
    shuffledP50,
    shuffledP75: percentile(shuffledDrawdowns, 0.75),
    ratio,
    detail: level !== 'Normal'
      ? `Actual MaxDD (${(actualMaxDD * 100).toFixed(1)}%) much better than shuffled median (${(shuffledP50 * 100).toFixed(1)}%)`
      : 'Drawdown profile consistent with return distribution'
  }
}

/**
 * Thinning fragility: use K-Fold drop-1 to measure CAGR sensitivity
 */
function computeThinningFragility(returns, options = {}) {
  const { folds = 50, shards = 10, seed = 42 } = options
  const n = returns.length

  if (n < 100) {
    return {
      level: 'Insufficient Data',
      originalCagr: 0,
      medianThinnedCagr: 0,
      cagrDrop: 0,
      detail: 'Need more trading days'
    }
  }

  // Original CAGR
  const originalEquity = buildEquityCurve(returns)
  const originalCagr = computeCagr(originalEquity, n)

  // K-Fold CAGRs (dropping 10% each time)
  const kfResults = runKfold(returns, { folds, shards, seed })
  const kfCagrs = kfResults.map(r => r.cagr).sort((a, b) => a - b)
  const medianThinnedCagr = percentile(kfCagrs, 0.50)

  // How much does CAGR drop?
  const cagrDrop = originalCagr > 0
    ? (originalCagr - medianThinnedCagr) / originalCagr
    : 0

  let level = 'Robust'
  if (cagrDrop > 0.5) level = 'Fragile'
  else if (cagrDrop > 0.25) level = 'Moderate'

  return {
    level,
    originalCagr,
    medianThinnedCagr,
    cagrDrop,
    detail: cagrDrop > 0.2
      ? `Dropping 10% of days reduces CAGR by ${(cagrDrop * 100).toFixed(0)}%`
      : 'Strategy robust to data removal'
  }
}

/**
 * Compute backtest length fingerprint
 * Red: <5 years, Yellow: 5-15 years, Green: >15 years
 * @param {number} tradingDays - Number of trading days in backtest
 */
function computeBacktestLength(tradingDays) {
  const years = tradingDays / 252 // Approximate trading days per year

  let level = 'Good'
  if (years < 5) {
    level = 'High Risk'
  } else if (years < 15) {
    level = 'Caution'
  }

  return {
    level,
    years: Math.round(years * 10) / 10,
    tradingDays,
    detail: years < 5
      ? `Only ${years.toFixed(1)} years of data - high risk of overfitting`
      : years < 15
      ? `${years.toFixed(1)} years of data - moderate confidence`
      : `${years.toFixed(1)} years of data - good historical coverage`
  }
}

/**
 * Compute turnover risk fingerprint
 * Red: >50% daily, Yellow: 20-50% daily, Green: <20% daily
 * @param {number} avgTurnover - Average daily turnover (0-1)
 */
function computeTurnoverRisk(avgTurnover) {
  const turnoverPct = avgTurnover * 100

  let level = 'Good'
  if (turnoverPct > 50) {
    level = 'High Risk'
  } else if (turnoverPct > 20) {
    level = 'Caution'
  }

  return {
    level,
    avgTurnover: Math.round(turnoverPct * 10) / 10,
    detail: turnoverPct > 50
      ? `${turnoverPct.toFixed(0)}% daily turnover - excessive trading costs`
      : turnoverPct > 20
      ? `${turnoverPct.toFixed(0)}% daily turnover - moderate trading costs`
      : `${turnoverPct.toFixed(0)}% daily turnover - reasonable`
  }
}

/**
 * Compute position concentration risk fingerprint
 * Red: <3 avg holdings, Yellow: 3-5 avg holdings, Green: >5 avg holdings
 * @param {number} avgHoldings - Average number of positions held
 */
function computeConcentrationRisk(avgHoldings) {
  let level = 'Good'
  if (avgHoldings < 3) {
    level = 'High Risk'
  } else if (avgHoldings < 5) {
    level = 'Caution'
  }

  return {
    level,
    avgHoldings: Math.round(avgHoldings * 10) / 10,
    detail: avgHoldings < 3
      ? `Only ${avgHoldings.toFixed(1)} avg positions - high concentration risk`
      : avgHoldings < 5
      ? `${avgHoldings.toFixed(1)} avg positions - moderate diversification`
      : `${avgHoldings.toFixed(1)} avg positions - well diversified`
  }
}

/**
 * Compute drawdown recovery time fingerprint
 * Finds the LONGEST underwater period (peak to new high) across entire history
 * Red: >2 years underwater, Yellow: 1-2 years, Green: <1 year
 * @param {number[]} equity - Equity curve array
 */
function computeDrawdownRecovery(equity) {
  if (!equity || equity.length < 50) {
    return {
      level: 'Insufficient Data',
      recoveryDays: 0,
      recoveryYears: 0,
      maxDd: 0,
      detail: 'Need more trading days for analysis'
    }
  }

  // Find all drawdown periods and track the longest one (peak to recovery)
  let peak = equity[0]
  let peakIdx = 0
  let maxDd = 0  // Track deepest drawdown for display
  let longestUnderwaterDays = 0
  let currentUnderwaterStart = null

  for (let i = 0; i < equity.length; i++) {
    if (equity[i] >= peak) {
      // New high - end of any current drawdown period
      if (currentUnderwaterStart !== null) {
        const underwaterDays = i - currentUnderwaterStart
        if (underwaterDays > longestUnderwaterDays) {
          longestUnderwaterDays = underwaterDays
        }
      }
      peak = equity[i]
      peakIdx = i
      currentUnderwaterStart = null
    } else {
      // In drawdown
      if (currentUnderwaterStart === null) {
        currentUnderwaterStart = peakIdx  // Start from the peak
      }
      const dd = (equity[i] - peak) / peak
      if (dd < maxDd) {
        maxDd = dd
      }
    }
  }

  // Check if we're still in a drawdown at the end
  let stillInDrawdown = false
  if (currentUnderwaterStart !== null) {
    const underwaterDays = equity.length - currentUnderwaterStart
    if (underwaterDays > longestUnderwaterDays) {
      longestUnderwaterDays = underwaterDays
    }
    stillInDrawdown = true
  }

  const recoveryYears = longestUnderwaterDays / 252

  // Debug log for F12 console
  console.log(`[DrawdownRecovery] equityLen=${equity.length}, longestUnderwaterDays=${longestUnderwaterDays}, recoveryYears=${recoveryYears.toFixed(2)}, maxDd=${(maxDd * 100).toFixed(1)}%, stillInDD=${stillInDrawdown}`)

  // Thresholds: >2 years underwater = High Risk, >1 year = Caution
  let level = 'Good'
  if (recoveryYears > 2) {
    level = 'High Risk'
  } else if (recoveryYears > 1) {
    level = 'Caution'
  }

  const maxDdPct = Math.abs(maxDd * 100).toFixed(1)
  const recoveryMonths = Math.round(longestUnderwaterDays / 21)

  return {
    level,
    recoveryDays: longestUnderwaterDays,
    recoveryYears: Math.round(recoveryYears * 10) / 10,
    maxDd: Math.round(maxDd * 1000) / 10,
    detail: stillInDrawdown
      ? `Longest underwater: ${recoveryYears.toFixed(1)}y (ongoing), Max DD: ${maxDdPct}%`
      : recoveryMonths <= 12
      ? `Longest underwater: ${recoveryMonths}mo, Max DD: ${maxDdPct}%`
      : `Longest underwater: ${recoveryYears.toFixed(1)}y, Max DD: ${maxDdPct}%`
  }
}

/**
 * Compute all fragility metrics
 * @param {number[]} returns - Daily returns array
 * @param {Object} options - Configuration options
 * @param {number} options.seed - Random seed for reproducibility
 * @param {number} options.tradingDays - Number of trading days (for backtest length)
 * @param {number} options.avgTurnover - Average daily turnover (for turnover risk)
 * @param {number} options.avgHoldings - Average positions held (for concentration risk)
 * @param {number[]} options.equity - Equity curve (for drawdown recovery)
 */
export function computeFragility(returns, options = {}) {
  const { seed = 42, tradingDays, avgTurnover, avgHoldings, equity } = options

  const result = {
    subPeriodStability: computeSubPeriodStability(returns, 4),
    profitConcentration: computeProfitConcentration(returns),
    smoothnessScore: computeSmoothnessScore(returns, 100, seed),
    thinningFragility: computeThinningFragility(returns, { folds: 50, shards: 10, seed })
  }

  // Add new fingerprints if data is available
  if (tradingDays != null) {
    result.backtestLength = computeBacktestLength(tradingDays)
  }
  if (avgTurnover != null) {
    result.turnoverRisk = computeTurnoverRisk(avgTurnover)
  }
  if (avgHoldings != null) {
    result.concentrationRisk = computeConcentrationRisk(avgHoldings)
  }
  if (equity != null && equity.length > 0) {
    result.drawdownRecovery = computeDrawdownRecovery(equity)
  }

  return result
}

// ============================================
// SUMMARY GENERATION
// ============================================

/**
 * Generate human-readable summary of findings
 */
export function generateSummary(pathRisk, fragility) {
  const warnings = []

  // Path Risk warnings
  if (pathRisk.drawdownProbabilities.gt40 > 0.25) {
    warnings.push(`${(pathRisk.drawdownProbabilities.gt40 * 100).toFixed(0)}% probability of >40% drawdown in Monte Carlo.`)
  }
  if (pathRisk.monteCarlo.drawdowns.p50 < -0.30) {
    warnings.push(`Median simulated max drawdown is ${(pathRisk.monteCarlo.drawdowns.p50 * 100).toFixed(1)}%.`)
  }

  // K-Fold vs original comparison
  if (pathRisk.kfold.cagrs.p50 < pathRisk.monteCarlo.cagrs.p50 * 0.7) {
    warnings.push('K-Fold CAGR significantly lower than Monte Carlo - possible overfitting.')
  }

  // Fragility warnings
  if (fragility.subPeriodStability.level === 'High') {
    warnings.push(fragility.subPeriodStability.detail)
  }

  if (fragility.profitConcentration.level === 'High') {
    warnings.push(`Top 5 trading days account for ${(fragility.profitConcentration.top5DaysPct * 100).toFixed(0)}% of total returns.`)
  }

  if (fragility.smoothnessScore.level === 'Suspicious') {
    warnings.push('Equity curve is suspiciously smoother than random shuffles would suggest.')
  }

  if (fragility.thinningFragility.level === 'Fragile') {
    warnings.push(`Strategy is fragile: dropping 10% of days reduces CAGR by ${(fragility.thinningFragility.cagrDrop * 100).toFixed(0)}%.`)
  }

  if (warnings.length === 0) {
    warnings.push('No major red flags detected. Strategy appears reasonably robust to statistical tests.')
  }

  return warnings
}

// ============================================
// MAIN EXPORT
// ============================================

/**
 * Generate complete sanity & risk report
 * @param {number[] | Array<{date: string, return: number}>} returns - Array of daily returns or {date, return} objects
 * @param {Object} options - Configuration options
 * @param {string} [options.oosStartDate] - ISO date string (YYYY-MM-DD) for IS/OOS split
 * @param {number[]} [spyReturns] - SPY returns for beta/treynor calculation (or {date, return} objects)
 */
export function generateSanityReport(returns, options = {}, spyReturns = null) {
  const {
    mcSimulations = 400,
    kfFolds = 200,
    years = 5,
    blockSize = 7,
    shards = 10,
    seed = 42,
    avgTurnover,
    avgHoldings,
    equityCurve,
    oosStartDate
  } = options

  // Convert returns to proper format if needed (support both array of numbers and array of objects)
  const returnsArray = Array.isArray(returns) && returns.length > 0 && typeof returns[0] === 'object'
    ? returns.map(r => r.return)
    : returns

  // Convert spyReturns to array if needed
  const spyReturnsArray = spyReturns && Array.isArray(spyReturns) && spyReturns.length > 0 && typeof spyReturns[0] === 'object'
    ? spyReturns.map(r => r.return)
    : spyReturns

  // Compute original metrics for reference (full period)
  const originalEquity = buildEquityCurve(returnsArray)
  const originalCagr = computeCagr(originalEquity, returnsArray.length)
  const originalMaxDD = computeMaxDrawdown(originalEquity)

  // Compute full-period path risk
  const pathRisk = computePathRisk(returnsArray, {
    mcSimulations,
    kfFolds,
    years,
    blockSize,
    shards,
    seed
  }, spyReturnsArray)

  // If oosStartDate is provided, compute IS/OOS specific path risks
  let isPathRisk = null
  let oosPathRisk = null

  if (oosStartDate && Array.isArray(returns) && returns.length > 0 && typeof returns[0] === 'object') {
    console.log(`[IS/OOS Split] oosStartDate=${oosStartDate}, total days=${returns.length}`)

    // Split returns into IS and OOS periods
    const { is: isReturns, oos: oosReturns } = splitDailyReturns(returns, oosStartDate)

    console.log(`[IS/OOS Split] IS period: ${isReturns.length} days, OOS period: ${oosReturns.length} days`)

    // Split SPY returns if available
    let isSpyReturns = null
    let oosSpyReturns = null
    if (spyReturns && Array.isArray(spyReturns) && spyReturns.length > 0 && typeof spyReturns[0] === 'object') {
      const spySplit = splitDailyReturns(spyReturns, oosStartDate)
      isSpyReturns = spySplit.is
      oosSpyReturns = spySplit.oos
      console.log(`[IS/OOS Split] SPY IS: ${isSpyReturns.length} days, SPY OOS: ${oosSpyReturns.length} days`)
    }

    // Compute IS path risk (only if we have enough data)
    if (isReturns.length >= 50) {
      console.log(`[IS MC/KF] Running Monte Carlo (${mcSimulations} sims) and K-Fold (${kfFolds} folds) on ${isReturns.length} IS days...`)
      const startIS = Date.now()
      isPathRisk = computePathRisk(isReturns, {
        mcSimulations,
        kfFolds,
        years,
        blockSize,
        shards,
        seed: seed + 1000 // Different seed for IS
      }, isSpyReturns)
      console.log(`[IS MC/KF] Completed in ${Date.now() - startIS}ms`)
    } else {
      console.log(`[IS MC/KF] Skipped - insufficient data (${isReturns.length} days, need 50+)`)
    }

    // Compute OOS path risk (only if we have enough data)
    if (oosReturns.length >= 50) {
      console.log(`[OOS MC/KF] Running Monte Carlo (${mcSimulations} sims) and K-Fold (${kfFolds} folds) on ${oosReturns.length} OOS days...`)
      const startOOS = Date.now()
      oosPathRisk = computePathRisk(oosReturns, {
        mcSimulations,
        kfFolds,
        years,
        blockSize,
        shards,
        seed: seed + 2000 // Different seed for OOS
      }, oosSpyReturns)
      console.log(`[OOS MC/KF] Completed in ${Date.now() - startOOS}ms`)
    } else {
      console.log(`[OOS MC/KF] Skipped - insufficient data (${oosReturns.length} days, need 50+)`)
    }
  }

  // Add IS/OOS path risks to main pathRisk object
  if (isPathRisk) {
    pathRisk.isPathRisk = isPathRisk
  }
  if (oosPathRisk) {
    pathRisk.oosPathRisk = oosPathRisk
  }

  // Use provided equity curve or the computed one for fragility
  // Handle both {value} and {equity} formats from backtest result
  const equityForFragility = equityCurve?.map(p => p.equity ?? p.value) || originalEquity

  const fragility = computeFragility(returnsArray, {
    seed,
    tradingDays: returnsArray.length,
    avgTurnover,
    avgHoldings,
    equity: equityForFragility
  })

  const summary = generateSummary(pathRisk, fragility)

  return {
    original: {
      cagr: originalCagr,
      maxDD: originalMaxDD,
      tradingDays: returnsArray.length
    },
    pathRisk,
    fragility,
    summary,
    oosStartDate: oosStartDate || null,
    meta: {
      mcSimulations,
      kfFolds,
      years,
      blockSize,
      shards,
      seed,
      generatedAt: new Date().toISOString()
    }
  }
}

// ============================================
// BENCHMARK METRICS COMPUTATION
// ============================================

/**
 * Compute metrics for a single ticker's returns (for benchmark comparison)
 * @param {number[]} returns - Daily returns array
 * @param {number[]} [spyReturns] - SPY returns for beta/treynor (null if computing SPY itself)
 */
export function computeBenchmarkMetrics(returns, spyReturns = null) {
  console.log(`[computeBenchmarkMetrics] returns.length=${returns?.length}, spyReturns.length=${spyReturns?.length}`)

  if (!returns || returns.length < 50) {
    console.log(`[computeBenchmarkMetrics] Insufficient returns data (${returns?.length}), returning null`)
    return null
  }

  const equity = buildEquityCurve(returns)
  const cagr = computeCagr(equity, returns.length)
  const maxDd = computeMaxDrawdown(equity)
  const sharpe = computeSharpe(returns)
  const sortino = computeSortino(returns)
  const volatility = computeVolatility(returns)
  const winRate = computeWinRate(returns)

  let beta = 0, treynor = 0
  if (spyReturns && spyReturns.length > 0) {
    console.log(`[computeBenchmarkMetrics] Computing beta with ${spyReturns.length} SPY returns`)
    const bt = computeBetaTreynor(returns, spyReturns)
    beta = bt.beta
    treynor = bt.treynor
    console.log(`[computeBenchmarkMetrics] Result: beta=${beta}, treynor=${treynor}`)
  } else {
    console.log(`[computeBenchmarkMetrics] No SPY returns provided, beta remains 0`)
  }

  return {
    cagr50: cagr,  // For benchmarks, single value = the "p50"
    maxdd50: maxDd,
    maxdd95: maxDd, // Same as maxdd50 for single series
    calmar50: Math.abs(maxDd) > 0 ? cagr / Math.abs(maxDd) : 0,
    calmar95: Math.abs(maxDd) > 0 ? cagr / Math.abs(maxDd) : 0,
    sharpe,
    sortino,
    volatility,
    winRate,
    beta,
    treynor,
    tradingDays: returns.length
  }
}
