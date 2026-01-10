// src/features/optimization/hooks/useBatchBacktest.ts
// Batch backtest hook for branch optimization
// Updated: 2026-01-08 - Added TIM/TIMAR/startDate extraction
// Updated: 2026-01-09 - Moved job state to store for persistence across tab changes

import { useRef } from 'react'
import { useBotStore } from '@/stores'
import type { FlowNode } from '@/types'
import type { ParameterRange } from '@/features/parameters/types'
import type { ISOOSSplitConfig } from '@/types/split'
import type { BranchGenerationJob, BranchResult, BranchStatus } from '@/types/branch'
import type { EligibilityRequirement } from '@/types/admin'
import { generateBranchCombinations, applyBranchToTree } from '../services/branchGenerator'
import { evaluateRequirements } from '../services/requirementsEvaluator'
import { deepCloneForCompression } from '@/features/builder'

interface UseBatchBacktestResult {
  job: BranchGenerationJob | null
  runBatchBacktest: (
    tree: FlowNode,
    parameterRanges: ParameterRange[],
    splitConfig: ISOOSSplitConfig | undefined,
    requirements: EligibilityRequirement[],
    botId: string,
    botName: string,
    mode?: string,
    costBps?: number
  ) => Promise<void>
  cancelJob: () => void
}

export function useBatchBacktest(): UseBatchBacktestResult {
  const activeForgeBotId = useBotStore((state) => state.activeForgeBotId)
  const bots = useBotStore((state) => state.bots)
  const setBranchGenerationJob = useBotStore((state) => state.setBranchGenerationJob)

  // Get job from active forge bot
  const activeBot = bots.find(b => b.id === activeForgeBotId)
  const job = activeBot?.branchGenerationJob || null

  const abortControllerRef = useRef<AbortController | null>(null)
  const resultsRef = useRef<BranchResult[]>([]) // Track results for database persistence

  const runBatchBacktest = async (
    tree: FlowNode,
    parameterRanges: ParameterRange[],
    splitConfig: ISOOSSplitConfig | undefined,
    requirements: EligibilityRequirement[],
    botId: string,
    botName: string,
    mode: string = 'CC',
    costBps: number = 5
  ) => {
    // Helper to update job in store
    const updateJob = (updater: (prev: BranchGenerationJob | undefined) => BranchGenerationJob | undefined) => {
      const currentBot = useBotStore.getState().bots.find(b => b.id === botId)
      const updated = updater(currentBot?.branchGenerationJob)
      setBranchGenerationJob(botId, updated)
    }

    // Generate all combinations
    const combinations = generateBranchCombinations(parameterRanges)

    if (combinations.length === 0) {
      console.warn('[BatchBacktest] No combinations generated (no enabled ranges)')
      return
    }

    // Initialize job
    const jobId = `job-${Date.now()}`
    resultsRef.current = [] // Reset results ref
    const newJob: BranchGenerationJob = {
      id: jobId,
      status: 'running',
      startTime: Date.now(),
      progress: {
        completed: 0,
        total: combinations.length
      },
      results: []
    }

    setBranchGenerationJob(botId, newJob)

    // Create abort controller for cancellation
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    try {
      // Use parallel Python backtester with Numba JIT for 50-100x speedup
      const useParallelApi = true // Set to false to fallback to Node.js backtester

      if (useParallelApi) {
        // Prepare branches for parallel processing
        const branches = combinations.map(combination => {
          // Clone tree preserving IDs, then apply parameters (preserves condition IDs for matching)
          const clonedTree = deepCloneForCompression(tree)!
          const modifiedTree = applyBranchToTree(clonedTree, combination, parameterRanges)
          return {
            branchId: combination.id,
            tree: modifiedTree,
            combination,
            options: {
              mode,
              costBps,
              splitConfig
            }
          }
        })

        // Start batch backtest job
        const startResponse = await fetch('/api/batch-backtest/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobId,
            branches
          }),
          signal: abortController.signal
        })

        if (!startResponse.ok) {
          throw new Error('Failed to start batch backtest')
        }

        // Poll for status updates
        const pollInterval = 500 // ms
        while (true) {
          if (abortController.signal.aborted) {
            // Cancel the job
            await fetch(`/api/batch-backtest/cancel/${jobId}`, {
              method: 'POST'
            })
            updateJob(prev => prev ? {
              ...prev,
              status: 'cancelled',
              endTime: Date.now()
            } : null)
            return
          }

          // Get status
          const statusResponse = await fetch(`/api/batch-backtest/status/${jobId}`)
          if (statusResponse.ok) {
            const status = await statusResponse.json()

            // Update job progress
            updateJob(prev => prev ? {
              ...prev,
              progress: {
                completed: status.completed,
                total: status.total
              }
            } : null)

            // Check if complete
            if (status.status === 'completed') {
              // Get results
              const resultsResponse = await fetch(`/api/batch-backtest/results/${jobId}`)
              if (resultsResponse.ok) {
                const resultsData = await resultsResponse.json()

                // Process results and evaluate requirements
                const processedResults: BranchResult[] = resultsData.results.map((result: any) => {
                  const combination = branches.find(b => b.branchId === result.branchId)?.combination

                  if (!result.isMetrics) {
                    return {
                      branchId: result.branchId,
                      combination: combination!,
                      status: 'error' as const,
                      passed: false,
                      failedRequirements: [],
                      errorMessage: 'IS metrics not available'
                    }
                  }

                  // Evaluate requirements (IS metrics only)
                  const evaluation = evaluateRequirements(result.isMetrics, requirements)

                  // Debug: Log requirements evaluation for first result
                  if (resultsData.results.indexOf(result) === 0) {
                    console.log('[useBatchBacktest] REQUIREMENTS EVALUATION:', {
                      requirements,
                      isMetrics: {
                        tim: result.isMetrics.tim,
                        timar: result.isMetrics.timar
                      },
                      evaluation
                    })
                  }

                  // Data quality validation - check minimum years requirement
                  const failedRequirements: string[] = []

                  if (splitConfig?.strategy === 'chronological' && splitConfig.minYears) {
                    const isYears = result.isMetrics.years || 0
                    const oosYears = result.oosMetrics.years || 0
                    const totalYears = isYears + oosYears

                    if (totalYears < splitConfig.minYears) {
                      failedRequirements.push(
                        `Insufficient data: ${totalYears.toFixed(1)} years < ${splitConfig.minYears} minimum`
                      )
                    }
                  }

                  console.log('[useBatchBacktest] RAW BACKTEST RESULT:', {
                    isMetrics: result.isMetrics,
                    oosMetrics: result.oosMetrics
                  })

                  return {
                    branchId: result.branchId,
                    combination: combination!,
                    status: 'success' as const,
                    passed: failedRequirements.length === 0 && evaluation.passed,
                    failedRequirements: [...failedRequirements, ...evaluation.failedRequirements],
                    isMetrics: {
                      startDate: result.isMetrics.startDate,
                      cagr: result.isMetrics.cagr,
                      sharpe: result.isMetrics.sharpe,
                      calmar: result.isMetrics.calmar,
                      maxDrawdown: result.isMetrics.maxDrawdown,
                      sortino: result.isMetrics.sortino,
                      treynor: result.isMetrics.treynor,
                      beta: result.isMetrics.beta,
                      volatility: result.isMetrics.vol,
                      winRate: result.isMetrics.winRate,
                      avgTurnover: result.isMetrics.avgTurnover,
                      avgHoldings: result.isMetrics.avgHoldings,
                      tim: result.isMetrics.tim,
                      timar: result.isMetrics.timar
                    },
                    oosMetrics: result.oosMetrics ? {
                      startDate: result.oosMetrics.startDate,
                      cagr: result.oosMetrics.cagr,
                      sharpe: result.oosMetrics.sharpe,
                      calmar: result.oosMetrics.calmar,
                      maxDrawdown: result.oosMetrics.maxDrawdown,
                      sortino: result.oosMetrics.sortino,
                      treynor: result.oosMetrics.treynor,
                      beta: result.oosMetrics.beta,
                      volatility: result.oosMetrics.vol,
                      winRate: result.oosMetrics.winRate,
                      avgTurnover: result.oosMetrics.avgTurnover,
                      avgHoldings: result.oosMetrics.avgHoldings,
                      tim: result.oosMetrics.tim,
                      timar: result.oosMetrics.timar
                    } : null
                  }
                })

                // Add error results
                const errorResults: BranchResult[] = resultsData.errors.map((error: any) => {
                  const combination = branches.find(b => b.branchId === error.branchId)?.combination
                  return {
                    branchId: error.branchId,
                    combination: combination!,
                    status: 'error' as const,
                    passed: false,
                    failedRequirements: [],
                    errorMessage: error.error
                  }
                })

                // Update job with all results
                const allResults = [...processedResults, ...errorResults]
                newJob.results = allResults
                resultsRef.current = allResults // Store in ref for database persistence
                break
              }
            }
          }

          // Wait before next poll
          await new Promise(resolve => setTimeout(resolve, pollInterval))
        }

        // Clean up job from server
        await fetch(`/api/batch-backtest/${jobId}`, {
          method: 'DELETE'
        })
      } else {
        // Fallback: Sequential processing (original implementation)
        for (let i = 0; i < combinations.length; i++) {
          if (abortController.signal.aborted) {
            updateJob(prev => prev ? {
              ...prev,
              status: 'cancelled',
              endTime: Date.now()
            } : null)
            return
          }

          const combination = combinations[i]

          // Clone tree preserving IDs, then apply parameters (preserves condition IDs for matching)
          const clonedTree = deepCloneForCompression(tree)!
          const modifiedTree = applyBranchToTree(clonedTree, combination, parameterRanges)

          // DEBUG: Log branch parameters being applied
          console.log(`[BatchBacktest] Branch ${combination.id}: ${combination.label}`)
          console.log(`[BatchBacktest] Parameters:`, combination.parameterValues)

          let branchResult: BranchResult = {
            branchId: combination.id,
            combination,
            status: 'running',
            passed: false,
            failedRequirements: []
          }

          try {
            const response = await fetch('/api/backtest', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                payload: modifiedTree,
                mode,
                costBps,
                splitConfig
              }),
              signal: abortController.signal
            })

            if (response.ok) {
              const data = await response.json()

              if (data.isMetrics && data.oosMetrics) {
                branchResult.status = 'success'
                branchResult.isMetrics = {
                  startDate: data.isMetrics.startDate,
                  cagr: data.isMetrics.cagr,
                  sharpe: data.isMetrics.sharpe,
                  calmar: data.isMetrics.calmar,
                  maxDrawdown: data.isMetrics.maxDrawdown,
                  sortino: data.isMetrics.sortino,
                  treynor: data.isMetrics.treynor,
                  beta: data.isMetrics.beta,
                  volatility: data.isMetrics.vol,
                  winRate: data.isMetrics.winRate,
                  avgTurnover: data.isMetrics.avgTurnover,
                  avgHoldings: data.isMetrics.avgHoldings,
                  tim: data.isMetrics.tim,
                  timar: data.isMetrics.timar
                }
                branchResult.oosMetrics = {
                  startDate: data.oosMetrics.startDate,
                  cagr: data.oosMetrics.cagr,
                  sharpe: data.oosMetrics.sharpe,
                  calmar: data.oosMetrics.calmar,
                  maxDrawdown: data.oosMetrics.maxDrawdown,
                  sortino: data.oosMetrics.sortino,
                  treynor: data.oosMetrics.treynor,
                  beta: data.oosMetrics.beta,
                  volatility: data.oosMetrics.vol,
                  winRate: data.oosMetrics.winRate,
                  avgTurnover: data.oosMetrics.avgTurnover,
                  avgHoldings: data.oosMetrics.avgHoldings,
                  tim: data.oosMetrics.tim,
                  timar: data.oosMetrics.timar
                }

                // Data quality validation - check minimum years requirement
                const failedRequirements: string[] = []

                // Check minYears from splitConfig (chronological strategy only)
                if (splitConfig?.strategy === 'chronological' && splitConfig.minYears) {
                  const isYears = data.isMetrics.years || 0
                  const oosYears = data.oosMetrics.years || 0
                  const totalYears = isYears + oosYears

                  if (totalYears < splitConfig.minYears) {
                    failedRequirements.push(
                      `Insufficient data: ${totalYears.toFixed(1)} years < ${splitConfig.minYears} minimum`
                    )
                  }
                }

                // Evaluate user-defined performance requirements (IS metrics only)
                const evaluation = evaluateRequirements(data.isMetrics, requirements)

                // Combine data quality failures with performance requirement failures
                branchResult.passed = failedRequirements.length === 0 && evaluation.passed
                branchResult.failedRequirements = [...failedRequirements, ...evaluation.failedRequirements]
              } else {
                branchResult.status = 'error'
                branchResult.errorMessage = 'IS/OOS split not enabled in backtest response'
              }
            } else {
              const error = await response.json().catch(() => ({ error: 'Unknown error' }))
              branchResult.status = 'error'
              branchResult.errorMessage = error.error || 'Backtest API error'
            }
          } catch (error: any) {
            if (error.name === 'AbortError') {
              return
            }
            branchResult.status = 'error'
            branchResult.errorMessage = error.message || 'Network error'
          }

          // Add to results ref for database persistence
          resultsRef.current.push(branchResult)

          updateJob(prev => prev ? {
            ...prev,
            progress: {
              completed: i + 1,
              total: combinations.length
            },
            results: [...prev.results, branchResult]
          } : null)
        }
      }

      // Mark job as complete
      const endTime = Date.now()
      updateJob(prev => prev ? {
        ...prev,
        status: 'complete',
        endTime
      } : null)

      // Persist job to database using results from ref
      try {
        const finalResults = resultsRef.current
        const passingResults = finalResults.filter(r => r.passed)

        console.log(`[BatchBacktest] Total results: ${finalResults.length}, Passing: ${passingResults.length}`)
        console.log('[BatchBacktest] FIRST RESULT METRICS TO SAVE:', {
          isMetrics: finalResults[0]?.isMetrics,
          oosMetrics: finalResults[0]?.oosMetrics
        })

        // Save ALL results, not just passing ones - user can filter by passed column
        await fetch('/api/optimization/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            botId,
            botName,
            status: 'completed',
            totalBranches: combinations.length,
            completedBranches: combinations.length,
            passingBranches: passingResults.length,
            startTime: newJob.startTime,
            endTime,
            results: finalResults.map(r => ({
              branchId: r.branchId,
              parameterLabel: r.combination.label,
              parameterValues: r.combination.parameterValues,
              tickerSubstitutions: r.combination.tickerSubstitutions,
              isMetrics: r.isMetrics,
              oosMetrics: r.oosMetrics,
              passed: r.passed,
              failedRequirements: r.failedRequirements
            }))
          })
        })

        console.log('[BatchBacktest] Job saved to database successfully')
      } catch (saveError: any) {
        console.error('[BatchBacktest] Failed to save job to database:', saveError)
        // Don't fail the job if persistence fails
      }

    } catch (error: any) {
      // Overall job error
      updateJob(prev => prev ? {
        ...prev,
        status: 'error',
        endTime: Date.now(),
        errorMessage: error.message || 'Unknown error'
      } : null)
    } finally {
      abortControllerRef.current = null
    }
  }

  const cancelJob = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
  }

  return {
    job,
    runBatchBacktest,
    cancelJob
  }
}
