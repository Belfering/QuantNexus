// src/types/split.ts
// In-Sample/Out-of-Sample split configuration types

export type SplitStrategy =
  | 'chronological'        // Split by date with configurable percentage
  | 'rolling'              // Rolling window split

export interface ISOOSSplitConfig {
  enabled: boolean
  strategy: SplitStrategy
  chronologicalPercent?: number // Percentage for IS (50, 60, or 70), rest is OOS
  rollingWindowMonths?: number  // Only for rolling strategy
}
