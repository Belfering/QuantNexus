/**
 * Correlation Engine for Portfolio Builder
 * Calculates correlations between bot equity curves and optimizes portfolio weights
 */

/**
 * Calculate daily returns from an equity curve
 * @param {Array<{date: string, equity: number}>} equityCurve
 * @returns {Array<{date: string, return: number}>}
 */
export function calculateReturns(equityCurve) {
  if (!equityCurve || equityCurve.length < 2) return []

  const returns = []
  for (let i = 1; i < equityCurve.length; i++) {
    const prevEquity = equityCurve[i - 1].equity
    const currEquity = equityCurve[i].equity
    if (prevEquity > 0) {
      returns.push({
        date: equityCurve[i].date,
        return: (currEquity - prevEquity) / prevEquity
      })
    }
  }
  return returns
}

/**
 * Calculate Pearson correlation coefficient between two return series
 * @param {number[]} returns1
 * @param {number[]} returns2
 * @returns {number} Correlation coefficient (-1 to 1)
 */
export function pearsonCorrelation(returns1, returns2) {
  if (returns1.length !== returns2.length || returns1.length === 0) {
    return 0
  }

  const n = returns1.length
  const mean1 = returns1.reduce((a, b) => a + b, 0) / n
  const mean2 = returns2.reduce((a, b) => a + b, 0) / n

  let numerator = 0
  let denominator1 = 0
  let denominator2 = 0

  for (let i = 0; i < n; i++) {
    const diff1 = returns1[i] - mean1
    const diff2 = returns2[i] - mean2
    numerator += diff1 * diff2
    denominator1 += diff1 * diff1
    denominator2 += diff2 * diff2
  }

  const denominator = Math.sqrt(denominator1 * denominator2)
  if (denominator === 0) return 0

  return numerator / denominator
}

/**
 * Align two return series to overlapping dates
 * @param {Array<{date: string, return: number}>} returns1
 * @param {Array<{date: string, return: number}>} returns2
 * @returns {{aligned1: number[], aligned2: number[], dates: string[]}}
 */
export function alignReturnSeries(returns1, returns2) {
  const map1 = new Map(returns1.map(r => [r.date, r.return]))
  const map2 = new Map(returns2.map(r => [r.date, r.return]))

  const commonDates = [...map1.keys()].filter(date => map2.has(date)).sort()

  const aligned1 = commonDates.map(date => map1.get(date))
  const aligned2 = commonDates.map(date => map2.get(date))

  return { aligned1, aligned2, dates: commonDates }
}

/**
 * Filter returns to a specific time period
 * @param {Array<{date: string, return: number}>} returns
 * @param {'full' | '1y' | '3y' | '5y'} period
 * @returns {Array<{date: string, return: number}>}
 */
export function filterByPeriod(returns, period) {
  if (period === 'full' || !returns.length) return returns

  const now = new Date()
  let cutoffDate

  switch (period) {
    case '1y':
      cutoffDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
      break
    case '3y':
      cutoffDate = new Date(now.getFullYear() - 3, now.getMonth(), now.getDate())
      break
    case '5y':
      cutoffDate = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate())
      break
    default:
      return returns
  }

  const cutoffStr = cutoffDate.toISOString().split('T')[0]
  return returns.filter(r => r.date >= cutoffStr)
}

/**
 * Calculate correlation matrix for multiple bots
 * @param {Map<string, Array<{date: string, return: number}>>} botReturns - Map of botId -> returns
 * @param {string[]} botIds - Ordered list of bot IDs
 * @returns {number[][]} NxN correlation matrix
 */
export function calculateCorrelationMatrix(botReturns, botIds) {
  const n = botIds.length
  const matrix = Array(n).fill(null).map(() => Array(n).fill(0))

  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1.0 // Diagonal is always 1

    for (let j = i + 1; j < n; j++) {
      const returns1 = botReturns.get(botIds[i]) || []
      const returns2 = botReturns.get(botIds[j]) || []

      const { aligned1, aligned2 } = alignReturnSeries(returns1, returns2)
      const corr = pearsonCorrelation(aligned1, aligned2)

      matrix[i][j] = corr
      matrix[j][i] = corr // Symmetric
    }
  }

  return matrix
}

/**
 * Calculate covariance matrix from returns
 * @param {Map<string, Array<{date: string, return: number}>>} botReturns
 * @param {string[]} botIds
 * @returns {{covariance: number[][], means: number[], stds: number[]}}
 */
export function calculateCovarianceMatrix(botReturns, botIds) {
  const n = botIds.length

  // First, find common dates across all bots
  const allDates = new Set()
  for (const botId of botIds) {
    const returns = botReturns.get(botId) || []
    returns.forEach(r => allDates.add(r.date))
  }

  // Get dates that exist in ALL bot return series
  const commonDates = [...allDates].filter(date => {
    return botIds.every(botId => {
      const returns = botReturns.get(botId) || []
      return returns.some(r => r.date === date)
    })
  }).sort()

  if (commonDates.length < 2) {
    // Not enough overlapping data
    return {
      covariance: Array(n).fill(null).map(() => Array(n).fill(0)),
      means: Array(n).fill(0),
      stds: Array(n).fill(0)
    }
  }

  // Build aligned return matrix
  const returnMatrix = botIds.map(botId => {
    const returnMap = new Map((botReturns.get(botId) || []).map(r => [r.date, r.return]))
    return commonDates.map(date => returnMap.get(date) || 0)
  })

  // Calculate means
  const means = returnMatrix.map(returns =>
    returns.reduce((a, b) => a + b, 0) / returns.length
  )

  // Calculate covariance matrix
  const T = commonDates.length
  const covariance = Array(n).fill(null).map(() => Array(n).fill(0))

  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let cov = 0
      for (let t = 0; t < T; t++) {
        cov += (returnMatrix[i][t] - means[i]) * (returnMatrix[j][t] - means[j])
      }
      cov /= (T - 1) // Sample covariance
      covariance[i][j] = cov
      covariance[j][i] = cov
    }
  }

  // Calculate standard deviations
  const stds = covariance.map((row, i) => Math.sqrt(row[i]))

  return { covariance, means, stds }
}

/**
 * Simple portfolio optimization using gradient descent
 * Optimizes for minimum variance subject to constraints
 * @param {number[][]} covariance - Covariance matrix
 * @param {number[]} expectedReturns - Expected returns (CAGRs)
 * @param {'correlation' | 'volatility' | 'beta' | 'sharpe'} metric
 * @param {number} maxWeight - Maximum weight per asset (0-1)
 * @param {number[]} betas - Beta values for each asset (optional, for beta minimization)
 * @returns {{weights: number[], portfolioReturn: number, portfolioVol: number}}
 */
export function optimizePortfolio(covariance, expectedReturns, metric, maxWeight = 0.4, betas = null) {
  const n = expectedReturns.length
  if (n === 0) return { weights: [], portfolioReturn: 0, portfolioVol: 0 }
  if (n === 1) return { weights: [1], portfolioReturn: expectedReturns[0], portfolioVol: Math.sqrt(covariance[0][0]) }

  // Start with equal weights
  let weights = Array(n).fill(1 / n)

  const riskFreeRate = 0.04 / 252 // Daily risk-free rate (~4% annual)

  // Objective function based on metric
  const objective = (w) => {
    // Portfolio variance
    let variance = 0
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        variance += w[i] * w[j] * covariance[i][j]
      }
    }

    // Portfolio return
    const portfolioReturn = w.reduce((sum, wi, i) => sum + wi * expectedReturns[i], 0)

    switch (metric) {
      case 'volatility':
        return variance // Minimize variance
      case 'sharpe':
        const vol = Math.sqrt(variance)
        return vol > 0 ? -(portfolioReturn - riskFreeRate) / vol : 0 // Maximize Sharpe (negative for minimization)
      case 'beta':
        if (betas) {
          const portfolioBeta = w.reduce((sum, wi, i) => sum + wi * (betas[i] || 1), 0)
          return Math.abs(portfolioBeta) // Minimize absolute beta
        }
        return variance
      case 'correlation':
      default:
        // For correlation, we minimize variance (which implicitly reduces correlation impact)
        return variance
    }
  }

  // Simple projected gradient descent
  const learningRate = 0.01
  const iterations = 1000

  for (let iter = 0; iter < iterations; iter++) {
    // Compute numerical gradient
    const gradient = []
    const epsilon = 1e-6
    const currentObj = objective(weights)

    for (let i = 0; i < n; i++) {
      const wPlus = [...weights]
      wPlus[i] += epsilon
      gradient.push((objective(wPlus) - currentObj) / epsilon)
    }

    // Update weights
    for (let i = 0; i < n; i++) {
      weights[i] -= learningRate * gradient[i]
    }

    // Project onto constraints
    // 1. Non-negative
    weights = weights.map(w => Math.max(0, w))

    // 2. Max weight constraint
    weights = weights.map(w => Math.min(maxWeight, w))

    // 3. Sum to 1 (normalize)
    const sum = weights.reduce((a, b) => a + b, 0)
    if (sum > 0) {
      weights = weights.map(w => w / sum)
    } else {
      weights = Array(n).fill(1 / n)
    }
  }

  // Calculate final portfolio metrics
  let portfolioVariance = 0
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      portfolioVariance += weights[i] * weights[j] * covariance[i][j]
    }
  }

  const portfolioReturn = weights.reduce((sum, wi, i) => sum + wi * expectedReturns[i], 0)
  const portfolioVol = Math.sqrt(portfolioVariance)

  return { weights, portfolioReturn, portfolioVol }
}

/**
 * Calculate portfolio metrics given weights and individual bot metrics
 * @param {number[]} weights
 * @param {number[][]} covariance
 * @param {Array<{cagr: number, maxDrawdown: number, sharpe: number, beta?: number}>} botMetrics
 * @returns {{cagr: number, volatility: number, sharpe: number, maxDrawdown: number, beta: number}}
 */
export function calculatePortfolioMetrics(weights, covariance, botMetrics) {
  const n = weights.length

  // Weighted CAGR
  const cagr = weights.reduce((sum, w, i) => sum + w * (botMetrics[i]?.cagr || 0), 0)

  // Portfolio volatility (annualized)
  let variance = 0
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      variance += weights[i] * weights[j] * (covariance[i]?.[j] || 0)
    }
  }
  const dailyVol = Math.sqrt(variance)
  const volatility = dailyVol * Math.sqrt(252) // Annualize

  // Sharpe ratio
  const riskFreeRate = 0.04
  const sharpe = volatility > 0 ? (cagr - riskFreeRate) / volatility : 0

  // Weighted max drawdown (approximate - actual would need combined equity curve)
  const maxDrawdown = weights.reduce((sum, w, i) => sum + w * (botMetrics[i]?.maxDrawdown || 0), 0)

  // Weighted beta
  const beta = weights.reduce((sum, w, i) => sum + w * (botMetrics[i]?.beta || 1), 0)

  return { cagr, volatility, sharpe, maxDrawdown, beta }
}
