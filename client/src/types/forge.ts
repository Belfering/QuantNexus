/**
 * TypeScript types for Forge-related functionality
 */

import type { FlowNode, ParameterRange } from './flowchart';

export interface ForgeConfig {
  // Flowchart (QuantNexus visual redesign - flowchart is the only mode)
  flowchart: FlowNode;
  parameterRanges: ParameterRange[];
  tickers: string[];

  // Shared fields
  minTIM: number;
  minTIMAR: number;
  maxDD: number;
  minTrades: number;
  minTIMARDD: number;
  useL2: boolean;
  splitStrategy: 'even_odd_month' | 'even_odd_year' | 'chronological';
  oosStartDate?: string;
  numWorkers: number | null;
}

export interface EstimateResult {
  totalBranches: number;
  estimatedSeconds: number;
  estimatedMinutes: number;
}

export interface JobStatus {
  jobId: number;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  totalBranches: number;
  completedBranches: number;
  passingBranches: number;
  lastResult?: BranchResult | null;
  error?: string;
}

export interface BranchResult {
  signalTicker: string;
  investTicker: string;
  indicator: string;
  period: number;
  comparator: string;
  threshold: number;
  passing: boolean;
  isTim: number | null;
  isTimar: number | null;
  isMaxdd: number | null;
  isCagr: number | null;
  isTrades: number;
  isAvgHold: number | null;
  isSharpe: number | null;
  isDd3: number | null;
  isDd50: number | null;
  isDd95: number | null;
  isTimardd: number | null;
  oosTim: number | null;
  oosTimar: number | null;
  oosMaxdd: number | null;
  oosCagr: number | null;
  oosTrades: number;
  oosAvgHold: number | null;
  oosSharpe: number | null;
  oosDd3: number | null;
  oosDd50: number | null;
  oosDd95: number | null;
  oosTimardd: number | null;
}

export interface ActiveJob {
  jobId: number;
  startTime: number;
}
