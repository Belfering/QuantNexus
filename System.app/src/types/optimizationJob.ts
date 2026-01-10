// Types for persisted optimization jobs and results

export interface OptimizationJob {
  id: number
  botId: string
  botName: string
  name?: string // Optional custom name for the job
  status: 'running' | 'completed' | 'error' | 'cancelled'
  totalBranches: number
  completedBranches: number
  passingBranches: number
  startTime: number // Unix timestamp in ms
  endTime?: number
  errorMessage?: string
  createdAt: number // Unix timestamp in ms
}

export interface OptimizationResultMetrics {
  startDate?: string // Start date of the period (IS or OOS)
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
  tim?: number // Time in Market (0-1)
  timar?: number // Time in Market Adjusted Return (CAGR/TIM)
}

export interface OptimizationResult {
  id: number
  jobId: number
  branchId: string
  parameterLabel: string // Human-readable label (e.g., "window=14, threshold=70")
  parameterValues: Record<string, number> // Map of parameter ID to value
  isMetrics: OptimizationResultMetrics // In-sample metrics
  oosMetrics: OptimizationResultMetrics // Out-of-sample metrics
  passed: boolean
  failedRequirements: string[]
  createdAt: number // Unix timestamp in ms
}
