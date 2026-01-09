// src/types/split.ts
// In-Sample/Out-of-Sample split configuration types

export type SplitStrategy = 'even_odd_month' | 'even_odd_year' | 'chronological'

export interface ISOOSSplitConfig {
  enabled: boolean
  strategy: SplitStrategy
  chronologicalDate?: string // Only required for chronological strategy (YYYY-MM-DD format)
}
