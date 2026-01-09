// src/features/optimization/hooks/useBatchBacktest.ts
// Batch backtest hook for branch optimization

import { useState, useRef } from 'react'
import type { FlowNode } from '@/types'
import type { ParameterRange } from '@/features/parameters/types'
import type { ISOOSSplitConfig } from '@/types/split'
import type { BranchGenerationJob, BranchResult, BranchStatus } from '@/types/branch'
import type { EligibilityRequirement } from '@/types/admin'
import { generateBranchCombinations, applyBranchToTree } from '../services/branchGenerator'
import { evaluateRequirements } from '../services/requirementsEvaluator'

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
  const [job, setJob] = useState<BranchGenerationJob | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

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
    // Generate all combinations
    const combinations = generateBranchCombinations(parameterRanges)

    if (combinations.length === 0) {
      console.warn('[BatchBacktest] No combinations generated (no enabled ranges)')
      return
    }

    // Initialize job
    const jobId = `job-${Date.now()}`
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

    setJob(newJob)

    // Create abort controller for cancellation
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    try {
      // Try to use parallel batch API for better performance
      const useParallelApi = true // Can be controlled by environment/config

      if (useParallelApi) {
        // Prepare branches for parallel processing
        const branches = combinations.map(combination => {
          const modifiedTree = applyBranchToTree(tree, combination, parameterRanges)
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
            setJob(prev => prev ? {
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
            setJob(prev => prev ? {
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

                  if (!result.isMetrics || !result.oosMetrics) {
                    return {
                      branchId: result.branchId,
                      combination: combination!,
                      status: 'error' as const,
                      passed: false,
                      failedRequirements: [],
                      errorMessage: 'IS/OOS metrics not available'
                    }
                  }

                  // Evaluate requirements (IS metrics only)
                  const evaluation = evaluateRequirements(result.isMetrics, requirements)

                  return {
                    branchId: result.branchId,
                    combination: combination!,
                    status: 'success' as const,
                    passed: evaluation.passed,
                    failedRequirements: evaluation.failedRequirements,
                    isMetrics: {
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
                      avgHoldings: result.isMetrics.avgHoldings
                    },
                    oosMetrics: {
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
                      avgHoldings: result.oosMetrics.avgHoldings
                    }
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
                newJob.results = [...processedResults, ...errorResults]
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
            setJob(prev => prev ? {
              ...prev,
              status: 'cancelled',
              endTime: Date.now()
            } : null)
            return
          }

          const combination = combinations[i]
          const modifiedTree = applyBranchToTree(tree, combination, parameterRanges)

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
                  avgHoldings: data.isMetrics.avgHoldings
                }
                branchResult.oosMetrics = {
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
                  avgHoldings: data.oosMetrics.avgHoldings
                }

                const evaluation = evaluateRequirements(data.isMetrics, requirements)
                branchResult.passed = evaluation.passed
                branchResult.failedRequirements = evaluation.failedRequirements
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

          setJob(prev => prev ? {
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
      setJob(prev => prev ? {
        ...prev,
        status: 'complete',
        endTime
      } : null)

      // Persist job to database
      try {
        const passingResults = newJob.results.filter(r => r.passed)

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
            results: passingResults.map(r => ({
              branchId: r.branchId,
              parameterLabel: r.combination.label,
              parameterValues: r.combination.parameterValues,
              isMetrics: r.isMetrics,
              oosMetrics: r.oosMetrics,
              passed: r.passed,
              failedRequirements: r.failedRequirements
            }))
          })
        })

        console.log('[BatchBacktest] Job saved to database')
      } catch (saveError: any) {
        console.error('[BatchBacktest] Failed to save job to database:', saveError)
        // Don't fail the job if persistence fails
      }

    } catch (error: any) {
      // Overall job error
      setJob(prev => prev ? {
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
