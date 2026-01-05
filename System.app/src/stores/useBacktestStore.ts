import { create } from 'zustand'
import type {
  BacktestMode,
  IndicatorOverlayData,
  AnalyzeBacktestState,
  TickerContributionState,
} from '@/types'
import type {
  SanityReportState,
  ComparisonMetrics,
} from '@/features/backtest'

// React-style SetStateAction type for useState compatibility
type SetStateAction<T> = T | ((prev: T) => T)

/**
 * Benchmark metrics state
 */
interface BenchmarkMetricsState {
  status: 'idle' | 'loading' | 'done' | 'error'
  data?: Record<string, ComparisonMetrics>
  error?: string
}

/**
 * Analyze ticker sort state
 */
interface AnalyzeTickerSort {
  column: string
  dir: 'asc' | 'desc'
}

interface BacktestState {
  // ETF/Backtest settings
  etfsOnlyMode: boolean
  backtestMode: BacktestMode
  backtestCostBps: number
  backtestBenchmark: string
  backtestShowBenchmark: boolean

  // Analyze tab state
  analyzeBacktests: Record<string, AnalyzeBacktestState>
  analyzeTickerContrib: Record<string, TickerContributionState>
  sanityReports: Record<string, SanityReportState>
  benchmarkMetrics: BenchmarkMetricsState
  modelSanityReport: SanityReportState
  analyzeTickerSort: AnalyzeTickerSort

  // Indicator overlays (from useIndicatorOverlays)
  enabledOverlays: Set<string>
  indicatorOverlayData: IndicatorOverlayData[]

  // ETF/Backtest settings actions
  setEtfsOnlyMode: (mode: boolean) => void
  setBacktestMode: (mode: BacktestMode) => void
  setBacktestCostBps: (bps: number) => void
  setBacktestBenchmark: (ticker: string) => void
  setBacktestShowBenchmark: (show: boolean) => void

  // Analyze tab actions - support both direct values and callbacks for useState compatibility
  setAnalyzeBacktests: (dataOrFn: SetStateAction<Record<string, AnalyzeBacktestState>>) => void
  setAnalyzeTickerContrib: (dataOrFn: SetStateAction<Record<string, TickerContributionState>>) => void
  setSanityReports: (dataOrFn: SetStateAction<Record<string, SanityReportState>>) => void
  setBenchmarkMetrics: (dataOrFn: SetStateAction<BenchmarkMetricsState>) => void
  setModelSanityReport: (dataOrFn: SetStateAction<SanityReportState>) => void
  setAnalyzeTickerSort: (dataOrFn: SetStateAction<AnalyzeTickerSort>) => void

  // Indicator overlay actions
  setEnabledOverlays: (dataOrFn: SetStateAction<Set<string>>) => void
  setIndicatorOverlayData: (dataOrFn: SetStateAction<IndicatorOverlayData[]>) => void
  toggleOverlay: (key: string) => void

  // Reset for logout
  reset: () => void
}

export const useBacktestStore = create<BacktestState>()((set) => ({
  // Initial state - ETF/Backtest settings
  etfsOnlyMode: false,
  backtestMode: 'CC',
  backtestCostBps: 5,
  backtestBenchmark: 'SPY',
  backtestShowBenchmark: true,

  // Initial state - Analyze tab
  analyzeBacktests: {},
  analyzeTickerContrib: {},
  sanityReports: {},
  benchmarkMetrics: { status: 'idle' },
  modelSanityReport: { status: 'idle' },
  analyzeTickerSort: { column: 'ticker', dir: 'asc' },

  // Initial state - Indicator overlays
  enabledOverlays: new Set(),
  indicatorOverlayData: [],

  // ETF/Backtest settings actions
  setEtfsOnlyMode: (etfsOnlyMode) => set({ etfsOnlyMode }),
  setBacktestMode: (backtestMode) => set({ backtestMode }),
  setBacktestCostBps: (backtestCostBps) => set({ backtestCostBps }),
  setBacktestBenchmark: (backtestBenchmark) => set({ backtestBenchmark }),
  setBacktestShowBenchmark: (backtestShowBenchmark) => set({ backtestShowBenchmark }),

  // Analyze tab actions - support both direct values and callbacks
  setAnalyzeBacktests: (dataOrFn) => {
    if (typeof dataOrFn === 'function') {
      set((state) => ({ analyzeBacktests: dataOrFn(state.analyzeBacktests) }))
    } else {
      set({ analyzeBacktests: dataOrFn })
    }
  },
  setAnalyzeTickerContrib: (dataOrFn) => {
    if (typeof dataOrFn === 'function') {
      set((state) => ({ analyzeTickerContrib: dataOrFn(state.analyzeTickerContrib) }))
    } else {
      set({ analyzeTickerContrib: dataOrFn })
    }
  },
  setSanityReports: (dataOrFn) => {
    if (typeof dataOrFn === 'function') {
      set((state) => ({ sanityReports: dataOrFn(state.sanityReports) }))
    } else {
      set({ sanityReports: dataOrFn })
    }
  },
  setBenchmarkMetrics: (dataOrFn) => {
    if (typeof dataOrFn === 'function') {
      set((state) => ({ benchmarkMetrics: dataOrFn(state.benchmarkMetrics) }))
    } else {
      set({ benchmarkMetrics: dataOrFn })
    }
  },
  setModelSanityReport: (dataOrFn) => {
    if (typeof dataOrFn === 'function') {
      set((state) => ({ modelSanityReport: dataOrFn(state.modelSanityReport) }))
    } else {
      set({ modelSanityReport: dataOrFn })
    }
  },
  setAnalyzeTickerSort: (dataOrFn) => {
    if (typeof dataOrFn === 'function') {
      set((state) => ({ analyzeTickerSort: dataOrFn(state.analyzeTickerSort) }))
    } else {
      set({ analyzeTickerSort: dataOrFn })
    }
  },

  // Indicator overlay actions - support both direct values and callbacks
  setEnabledOverlays: (dataOrFn) => {
    if (typeof dataOrFn === 'function') {
      set((state) => ({ enabledOverlays: dataOrFn(state.enabledOverlays) }))
    } else {
      set({ enabledOverlays: dataOrFn })
    }
  },
  setIndicatorOverlayData: (dataOrFn) => {
    if (typeof dataOrFn === 'function') {
      set((state) => ({ indicatorOverlayData: dataOrFn(state.indicatorOverlayData) }))
    } else {
      set({ indicatorOverlayData: dataOrFn })
    }
  },
  toggleOverlay: (key) => {
    set((state) => {
      const next = new Set(state.enabledOverlays)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return { enabledOverlays: next }
    })
  },

  // Reset for logout
  reset: () => {
    set({
      etfsOnlyMode: false,
      backtestMode: 'CC',
      backtestCostBps: 5,
      backtestBenchmark: 'SPY',
      backtestShowBenchmark: true,
      analyzeBacktests: {},
      analyzeTickerContrib: {},
      sanityReports: {},
      benchmarkMetrics: { status: 'idle' },
      modelSanityReport: { status: 'idle' },
      analyzeTickerSort: { column: 'ticker', dir: 'asc' },
      enabledOverlays: new Set(),
      indicatorOverlayData: [],
    })
  },
}))
