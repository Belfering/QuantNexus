// src/features/shards/utils/oosCalculator.ts
// Helper to calculate OOS start date for combined strategies

import type { OptimizationResult } from '@/types/optimizationJob'
import type { RollingOptimizationResult } from '@/types/bot'

/**
 * Calculate the latest OOS start date from multiple branches.
 * For combined strategies, use MAX OOS date (when all branches are OOS).
 *
 * @param branches - Array of optimization result branches
 * @param jobType - Type of optimization job ('chronological' or 'rolling')
 * @returns Latest OOS start date in YYYY-MM-DD format, or null if not available
 */
export function calculateMaxOosDate(
  branches: (OptimizationResult | RollingOptimizationResult['branches'][number])[],
  jobType: 'chronological' | 'rolling'
): string | null {
  const oosDates: string[] = []

  for (const branch of branches) {
    if (jobType === 'rolling') {
      // Rolling branches have isStartYear
      // OOS starts at Jan 1 of (isStartYear + 1)
      const rollingBranch = branch as RollingOptimizationResult['branches'][number]
      if (rollingBranch.isStartYear) {
        const oosYear = rollingBranch.isStartYear + 1
        oosDates.push(`${oosYear}-01-01`)
      }
    } else {
      // Chronological branches have oosMetrics.startDate
      const chronoBranch = branch as OptimizationResult
      if (chronoBranch.oosMetrics?.startDate) {
        oosDates.push(chronoBranch.oosMetrics.startDate)
      }
    }
  }

  if (oosDates.length === 0) return null

  // Return the LATEST date (max)
  oosDates.sort()
  return oosDates[oosDates.length - 1]
}
