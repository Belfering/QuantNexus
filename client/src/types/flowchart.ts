/**
 * Flowchart Type Definitions for Atlas Forge Phase 1.5
 * Ported from Flowchart app with simplifications for initial implementation
 */

// ============================================================================
// Indicator and Metric Types
// ============================================================================

export type MetricChoice =
  // Price
  | 'Current Price'
  | 'Date'  // Date-based conditions (e.g., Jan 1st - Jan 31st)
  // Moving Averages
  | 'Simple Moving Average'
  | 'Exponential Moving Average'
  | 'Hull Moving Average'
  | 'Weighted Moving Average'
  | 'Wilder Moving Average'
  | 'DEMA'
  | 'TEMA'
  | 'KAMA'
  // RSI & Variants
  | 'Relative Strength Index'
  | 'RSI (SMA)'
  | 'RSI (EMA)'
  | 'Stochastic RSI'
  | 'Laguerre RSI'
  // Momentum indicators
  | 'Momentum (Weighted)'
  | 'Momentum (Unweighted)'
  | 'Momentum (12-Month SMA)'
  | 'Rate of Change'
  | 'Williams %R'
  | 'CCI'
  | 'Stochastic %K'
  | 'Stochastic %D'
  | 'ADX'
  // Volatility
  | 'Max Drawdown'
  | 'Standard Deviation'
  | 'Standard Deviation of Price'
  | 'Drawdown'
  | 'Bollinger %B'
  | 'Bollinger Bandwidth'
  | 'ATR'
  | 'ATR %'
  | 'Historical Volatility'
  | 'Ulcer Index'
  // Trend
  | 'Cumulative Return'
  | 'SMA of Returns'
  | 'Ultimate Smoother'
  | 'Trend Clarity'
  | 'Linear Reg Slope'
  | 'Linear Reg Value'
  | 'Price vs SMA'
  // Aroon
  | 'Aroon Up'
  | 'Aroon Down'
  | 'Aroon Oscillator'
  // MACD/PPO
  | 'MACD Histogram'
  | 'PPO Histogram'
  // Volume-based indicators
  | 'Money Flow Index'
  | 'OBV Rate of Change'
  | 'VWAP Ratio';

export type ComparatorChoice = 'lt' | 'gt' | 'crossAbove' | 'crossBelow';
export type RankChoice = 'Bottom' | 'Top';

// ============================================================================
// Flow Node Types
// ============================================================================

export type BlockKind =
  | 'basic'      // Simple sequential block
  | 'function'   // Function/ranking block
  | 'indicator'  // Conditional indicator block (if/then/else)
  | 'numbered'   // Multi-branch numbered block (any/all/none)
  | 'position'   // Position selection block
  | 'call'       // Call saved strategy (future)
  | 'altExit'    // Alternative exit condition (Phase 5)
  | 'scaling';   // Position scaling logic (Phase 5)

export type SlotId = 'next' | 'then' | 'else' | `ladder-${number}`;

export type PositionChoice = string; // Ticker symbol

export type WeightMode =
  | 'equal'    // Equal weight across positions
  | 'defined'  // Manual weight per position
  | 'inverse'  // Inverse volatility weighting
  | 'pro'      // Pro-rata volatility weighting
  | 'capped';  // Capped equal weighting

export type NumberedQuantifier =
  | 'any'      // Any condition true
  | 'all'      // All conditions true
  | 'none'     // No conditions true
  | 'exactly'  // Exactly N conditions true
  | 'atLeast'  // At least N conditions true
  | 'atMost'   // At most N conditions true
  | 'ladder';  // Ladder logic (treat as branches)

// ============================================================================
// Condition Types
// ============================================================================

export interface ConditionLine {
  id: string;
  type: 'if' | 'and' | 'or';
  window: number;                   // Period/window for indicator
  metric: MetricChoice;             // Indicator name
  comparator: ComparatorChoice;     // Comparison operator
  ticker: PositionChoice;           // Ticker symbol or reference
  threshold: number;                // Threshold value
  expanded?: boolean;               // UI state for expanded editor
  rightWindow?: number;             // For cross-indicator conditions
  rightMetric?: MetricChoice;       // For cross-indicator conditions
  rightTicker?: PositionChoice;     // For cross-ticker conditions
  forDays?: number;                 // Must be true for N consecutive days
  dateMonth?: number;               // For date-based conditions (1-12)
  dateDay?: number;                 // For date-based conditions (1-31)
  dateTo?: { month: number; day: number }; // End of date range
}

export interface NumberedItem {
  id: string;
  conditions: ConditionLine[];
  groupLogic?: 'and' | 'or';        // How conditions within item combine
}

// ============================================================================
// Flow Node Structure
// ============================================================================

export interface FlowNode {
  id: string;
  kind: BlockKind;
  title: string;
  children: Partial<Record<SlotId, Array<FlowNode | null>>>;

  // Position block
  positions?: PositionChoice[];

  // Weighting
  weighting: WeightMode;
  weightingThen?: WeightMode;       // For indicator/numbered blocks
  weightingElse?: WeightMode;       // For indicator/numbered blocks
  cappedFallback?: PositionChoice;
  cappedFallbackThen?: PositionChoice;
  cappedFallbackElse?: PositionChoice;
  volWindow?: number;
  volWindowThen?: number;
  volWindowElse?: number;

  // UI state
  bgColor?: string;
  collapsed?: boolean;

  // Indicator block
  conditions?: ConditionLine[];

  // Numbered block
  numbered?: {
    quantifier: NumberedQuantifier;
    n: number;
    items: NumberedItem[];
  };

  // Function block
  metric?: MetricChoice;
  window?: number;
  bottom?: number;
  rank?: RankChoice;

  // Call block (Phase 5+)
  callRefId?: string;

  // Alt Exit block (Phase 5)
  entryConditions?: ConditionLine[];
  exitConditions?: ConditionLine[];

  // Scaling block (Phase 5)
  scaleMetric?: MetricChoice;
  scaleWindow?: number;
  scaleTicker?: string;
  scaleFrom?: number;
  scaleTo?: number;
}

// ============================================================================
// Parameter Extraction Types
// ============================================================================

export interface ParameterRange {
  id: string;                       // Unique parameter ID
  type: 'period' | 'threshold';     // Parameter type
  nodeId: string;                   // Source node ID
  conditionId?: string;             // Source condition ID (if from condition)
  path: string;                     // Human-readable path (e.g., "Block 1 > Condition 2 > Threshold")
  currentValue: number;             // Original value from flowchart
  enabled: boolean;                 // Include in optimization
  min: number;                      // Range minimum
  max: number;                      // Range maximum
  step: number;                     // Step size
}

// ============================================================================
// Utility Types
// ============================================================================

// Slot order for rendering
export const SLOT_ORDER: Record<BlockKind, SlotId[]> = {
  basic: ['next'],
  function: ['next'],
  indicator: ['then', 'else', 'next'],
  numbered: ['then', 'else', 'next'],
  position: [],
  call: [],
  altExit: ['then', 'else'],
  scaling: ['then', 'else'],
};

// Default node titles by kind
export const DEFAULT_TITLES: Record<BlockKind, string> = {
  basic: 'Basic',
  function: 'Function',
  indicator: 'Indicator',
  numbered: 'Numbered',
  position: 'Position',
  call: 'Call',
  altExit: 'Alt Exit',
  scaling: 'Scaling',
};
