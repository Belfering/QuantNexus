// src/types/branch.ts
// Branch generation and optimization types

import type { FlowNode } from './flowNode'

// Represents a single combination of parameter values
export interface BranchCombination {
  id: string
  parameterValues: Record<string, number> // Map of parameter ID to value (e.g., {"node-1-cond-1-window": 14})
  label: string // Human-readable label (e.g., "RSI(10) > 70, EMA(20)")
  tickerSubstitutions?: Record<string, string> // Map of ticker list ID to selected ticker (Phase 3: Custom Ticker Lists)
}

// Status of a single branch execution
export type BranchStatus = 'pending' | 'running' | 'success' | 'error'

// Result of backtesting a single branch
export interface BranchResult {
  branchId: string
  combination: BranchCombination
  tree?: FlowNode // Tree structure for this branch (for database storage)
  status: BranchStatus
  // Metrics only available if status === 'success'
  isMetrics?: {
    cagr: number
    sharpe: number
    calmar: number
    maxDrawdown: number
    sortino: number
    treynor: number
    beta: number
    volatility: number
    winRate: number
    avgTurnover: number
    avgHoldings: number
  }
  oosMetrics?: {
    cagr: number
    sharpe: number
    calmar: number
    maxDrawdown: number
    sortino: number
    treynor: number
    beta: number
    volatility: number
    winRate: number
    avgTurnover: number
    avgHoldings: number
  }
  passed: boolean // True if all requirements passed (IS metrics only)
  failedRequirements: string[] // List of failed requirement descriptions
  errorMessage?: string // Only present if status === 'error'
}

// Status of the entire branch generation job
export type BranchGenerationStatus = 'idle' | 'running' | 'complete' | 'error' | 'cancelled'

// Tracks the overall branch generation job
export interface BranchGenerationJob {
  id: string
  status: BranchGenerationStatus
  startTime: number // Timestamp when job started
  endTime?: number // Timestamp when job completed/error/cancelled
  progress: {
    completed: number
    total: number
  }
  results: BranchResult[]
  errorMessage?: string // Overall job error (not individual branch errors)
}
