// src/features/optimization/services/requirementsEvaluator.ts
// Requirements evaluation service for branch optimization

import type { BacktestMetrics } from '@/types/backtest'
import type { EligibilityRequirement } from '@/types/admin'

interface RequirementEvaluationResult {
  passed: boolean
  failedRequirements: string[]
}

/**
 * Evaluate IS metrics against eligibility requirements
 * @param isMetrics - In-sample metrics from backtest
 * @param requirements - Array of eligibility requirements
 * @returns Pass/fail status and list of failed requirements
 */
export function evaluateRequirements(
  isMetrics: BacktestMetrics | null | undefined,
  requirements: EligibilityRequirement[]
): RequirementEvaluationResult {
  if (!isMetrics) {
    // If no IS metrics, fail all requirements
    return {
      passed: false,
      failedRequirements: ['No IS metrics available']
    }
  }

  const failedRequirements: string[] = []

  for (const req of requirements) {
    if (req.type === 'metric') {
      // Metric requirement: Compare IS metric against threshold
      const metric = req.metric!
      const comparison = req.comparison!
      const threshold = req.value

      // Helper to compute TIMAR/MaxDD
      const computeTIMARMaxDD = (): number | undefined => {
        const timar = (isMetrics as any).timar
        const maxDD = isMetrics.maxDrawdown
        if (timar != null && maxDD != null && maxDD !== 0) {
          return timar / Math.abs(maxDD)
        }
        return undefined
      }

      // Helper to compute TIMAR × (TIMAR/MaxDD)
      const computeTIMARTIMARMaxDD = (): number | undefined => {
        const timar = (isMetrics as any).timar
        const maxDD = isMetrics.maxDrawdown
        if (timar != null && maxDD != null && maxDD !== 0) {
          const ratio = timar / Math.abs(maxDD)
          return (timar * 100) * ratio  // Convert TIMAR to percentage for readability
        }
        return undefined
      }

      // Helper to compute CAGR × CALMAR
      const computeCAGRCALMAR = (): number | undefined => {
        const cagr = isMetrics.cagr
        const calmar = isMetrics.calmar
        if (cagr != null && calmar != null) {
          return (cagr * 100) * calmar  // Convert CAGR to percentage for readability
        }
        return undefined
      }

      // Map requirement metric names to BacktestMetrics fields
      const metricValueMap: Record<string, number | undefined> = {
        cagr: isMetrics.cagr * 100, // Convert to percentage
        maxDrawdown: isMetrics.maxDrawdown * 100, // Convert to percentage (negative value)
        sharpe: isMetrics.sharpe,
        calmar: isMetrics.calmar,
        sortino: isMetrics.sortino,
        treynor: isMetrics.treynor,
        beta: isMetrics.beta,
        vol: isMetrics.vol * 100, // Convert to percentage (FIXED: was 'volatility')
        winRate: isMetrics.winRate * 100, // Convert to percentage
        avgTurnover: isMetrics.avgTurnover * 100, // Convert to percentage
        avgHoldings: isMetrics.avgHoldings,
        tim: (isMetrics as any).tim != null ? (isMetrics as any).tim * 100 : undefined, // Time in Market (percentage)
        timar: (isMetrics as any).timar != null ? (isMetrics as any).timar * 100 : undefined, // TIM Adjusted Returns (percentage)
        timarMaxDDRatio: computeTIMARMaxDD(),
        timarTimarMaxDD: computeTIMARTIMARMaxDD(),
        cagrCalmar: computeCAGRCALMAR()
      }

      const metricValue = metricValueMap[metric]

      // Debug logging for maxDrawdown
      if (metric === 'maxDrawdown') {
        console.log('[RequirementsEvaluator] MaxDrawdown Debug:', {
          rawMaxDD: isMetrics.maxDrawdown,
          metricValue,
          threshold,
          comparison,
          willPass: comparison === 'at_least' ? (metricValue >= threshold) : (metricValue <= threshold)
        })
      }

      if (metricValue === undefined) {
        failedRequirements.push(`Metric ${metric} not found`)
        continue
      }

      // Evaluate based on comparison operator
      let passed = false
      if (comparison === 'at_least') {
        passed = metricValue >= threshold
      } else if (comparison === 'at_most') {
        passed = metricValue <= threshold
      }

      if (!passed) {
        const metricName = metric.replace(/([A-Z])/g, ' $1').trim() // Convert camelCase to readable
        const operator = comparison === 'at_least' ? '≥' : '≤'
        failedRequirements.push(`${metricName} (${metricValue.toFixed(2)}) ${operator} ${threshold}`)
      }
    } else if (req.type === 'live_months') {
      // Live months requirement: Check if data duration meets threshold
      const monthsLive = (isMetrics.days / 30.44) // Average days per month
      if (monthsLive < req.value) {
        failedRequirements.push(`Live months (${monthsLive.toFixed(1)}) < ${req.value}`)
      }
    } else if (req.type === 'etfs_only') {
      // ETFs only requirement: Not evaluated in backend (requires ticker validation)
      // This would need to be checked during tree validation
      // For now, skip this requirement
      console.warn('[RequirementsEvaluator] ETFs only requirement not implemented')
    }
  }

  return {
    passed: failedRequirements.length === 0,
    failedRequirements
  }
}
