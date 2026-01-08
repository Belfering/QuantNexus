// src/features/data/utils/importParsers.ts
// Import parsers for Composer and QuantMage formats

import type {
  FlowNode,
  PositionChoice,
  MetricChoice,
  ComparatorChoice,
  RankChoice,
  WeightMode,
  ConditionLine,
  ImportFormat,
} from '@/types'

// ============================================
// FORMAT DETECTION
// ============================================

/**
 * Detect which format the imported JSON is in
 */
export const detectImportFormat = (data: unknown): ImportFormat => {
  if (!data || typeof data !== 'object') return 'unknown'
  const obj = data as Record<string, unknown>

  // Atlas format: has kind, id, children as object with slots
  if (typeof obj.kind === 'string' && typeof obj.id === 'string' && typeof obj.children === 'object') {
    return 'atlas'
  }

  // Composer format: has step field (root, wt-cash-equal, if, asset, filter, group)
  if (typeof obj.step === 'string') {
    return 'composer'
  }

  // Check if it's a wrapped format (e.g., { payload: FlowNode })
  if (obj.payload && typeof obj.payload === 'object') {
    const payload = obj.payload as Record<string, unknown>
    if (typeof payload.kind === 'string') return 'atlas'
    if (typeof payload.step === 'string') return 'composer'
  }

  // QuantMage format: has incantation field with incantation_type
  if (obj.incantation && typeof obj.incantation === 'object') {
    const inc = obj.incantation as Record<string, unknown>
    if (typeof inc.incantation_type === 'string') return 'quantmage'
  }

  return 'unknown'
}

// ============================================
// COMPOSER IMPORT PARSER
// ============================================

/**
 * Map Composer metric names to Atlas MetricChoice
 */
const mapComposerMetric = (fn: string): MetricChoice => {
  const mapping: Record<string, MetricChoice> = {
    'relative-strength-index': 'Relative Strength Index',
    'simple-moving-average': 'Simple Moving Average',
    'simple-moving-average-price': 'Simple Moving Average',
    'moving-average-price': 'Simple Moving Average',
    'exponential-moving-average': 'Exponential Moving Average',
    'exponential-moving-average-price': 'Exponential Moving Average',
    'cumulative-return': 'Cumulative Return',
    'moving-average-return': 'Cumulative Return', // Map to closest equivalent
    'current-price': 'Current Price',
    'max-drawdown': 'Max Drawdown',
    'standard-deviation-return': 'Standard Deviation',
    'standard-deviation-price': 'Standard Deviation of Price',
    'moving-average-deviation': 'Standard Deviation',
  }
  return mapping[fn] || 'Relative Strength Index'
}

/**
 * Map Composer comparators to Atlas
 */
const mapComposerComparator = (comp: string): ComparatorChoice => {
  if (comp === 'gte') return 'gt'
  if (comp === 'lte') return 'lt'
  return (comp === 'gt' || comp === 'lt') ? comp : 'gt'
}

/**
 * Map Composer rank to Atlas
 */
const mapComposerRank = (selectFn: string): RankChoice => {
  return selectFn === 'bottom' ? 'Bottom' : 'Top'
}

/**
 * ID generator for Composer imports (performance optimized)
 */
const createComposerIdGenerator = () => {
  let nodeCounter = 0
  let condCounter = 0
  const batchTs = Date.now()
  const batchRand = Math.random().toString(36).slice(2, 10)
  return {
    nodeId: () => `node-${batchTs}-${++nodeCounter}-${batchRand}`,
    condId: () => `cond-${++condCounter}`,
  }
}

/**
 * Parse a Composer node recursively
 */
const parseComposerNode = (
  node: Record<string, unknown>,
  idGen: ReturnType<typeof createComposerIdGenerator>
): FlowNode | null => {
  const step = node.step as string

  // Asset -> Position
  if (step === 'asset') {
    const ticker = (node.ticker as string) || 'SPY'
    return {
      id: idGen.nodeId(),
      kind: 'position',
      title: 'Position',
      collapsed: false,
      positions: [ticker as PositionChoice],
      weighting: 'equal',
      children: {},
    }
  }

  // Filter -> Sort (function)
  if (step === 'filter') {
    const sortByFn = (node['sort-by-fn'] as string) || 'cumulative-return'
    const sortByParams = (node['sort-by-fn-params'] as Record<string, unknown>) || {}
    const selectFn = (node['select-fn'] as string) || 'top'
    const selectN = parseInt(String(node['select-n'] || '1'), 10)
    const children = (node.children as unknown[]) || []

    const parsedChildren = children
      .map((c) => parseComposerNode(c as Record<string, unknown>, idGen))
      .filter((c): c is FlowNode => c !== null)

    return {
      id: idGen.nodeId(),
      kind: 'function',
      title: 'Sort',
      collapsed: false,
      weighting: 'equal',
      metric: mapComposerMetric(sortByFn),
      window: (sortByParams.window as number) || 14,
      rank: mapComposerRank(selectFn),
      bottom: selectN,
      children: { next: parsedChildren },
    }
  }

  // If -> Indicator
  if (step === 'if') {
    const ifChildren = (node.children as unknown[]) || []
    let condition: ConditionLine | null = null
    let thenBranch: FlowNode[] = []
    let elseBranch: FlowNode[] = []

    for (const child of ifChildren) {
      const ifChild = child as Record<string, unknown>
      if (ifChild.step !== 'if-child') continue

      const isElse = ifChild['is-else-condition?'] === true
      const childNodes = (ifChild.children as unknown[]) || []

      if (!isElse && !condition) {
        // This is the THEN branch with the condition
        const lhsFn = (ifChild['lhs-fn'] as string) || 'relative-strength-index'
        const lhsParams = (ifChild['lhs-fn-params'] as Record<string, unknown>) || {}
        const lhsVal = (ifChild['lhs-val'] as string) || 'SPY'
        const comparator = (ifChild.comparator as string) || 'gt'
        const rhsFixedValue = ifChild['rhs-fixed-value?'] === true
        const rhsVal = ifChild['rhs-val']
        const rhsFn = ifChild['rhs-fn'] as string | undefined
        const rhsParams = (ifChild['rhs-fn-params'] as Record<string, unknown>) || {}

        condition = {
          id: idGen.condId(),
          type: 'if',
          metric: mapComposerMetric(lhsFn),
          window: (lhsParams.window as number) || 14,
          ticker: lhsVal as PositionChoice,
          comparator: mapComposerComparator(comparator),
          threshold: rhsFixedValue ? parseFloat(String(rhsVal)) : 0,
          expanded: !rhsFixedValue,
          rightMetric: rhsFn ? mapComposerMetric(rhsFn) : undefined,
          rightWindow: rhsFn ? ((rhsParams.window as number) || 14) : undefined,
          rightTicker: !rhsFixedValue ? (rhsVal as PositionChoice) : undefined,
        }

        thenBranch = childNodes
          .map((c) => parseComposerNode(c as Record<string, unknown>, idGen))
          .filter((c): c is FlowNode => c !== null)
      } else if (isElse) {
        elseBranch = childNodes
          .map((c) => parseComposerNode(c as Record<string, unknown>, idGen))
          .filter((c): c is FlowNode => c !== null)
      }
    }

    if (!condition) {
      // Fallback if no condition found
      condition = {
        id: idGen.condId(),
        type: 'if',
        metric: 'Relative Strength Index',
        window: 14,
        ticker: 'SPY',
        comparator: 'gt',
        threshold: 50,
        expanded: false,
      }
    }

    return {
      id: idGen.nodeId(),
      kind: 'indicator',
      title: 'Indicator',
      collapsed: false,
      weighting: 'equal',
      weightingThen: 'equal',
      weightingElse: 'equal',
      conditions: [condition],
      children: {
        then: thenBranch.length > 0 ? thenBranch : [null],
        else: elseBranch.length > 0 ? elseBranch : [null],
        next: [null],
      },
    }
  }

  // Group / wt-cash-equal / wt-cash-specified / wt-inverse-vol / root -> Basic (container)
  if (step === 'group' || step === 'wt-cash-equal' || step === 'wt-cash-specified' || step === 'wt-inverse-vol' || step === 'root') {
    const name = (node.name as string) || 'Basic'
    const children = (node.children as unknown[]) || []

    // Determine weighting mode
    let weighting: WeightMode = 'equal'
    if (step === 'wt-inverse-vol') {
      weighting = 'inverse'
    }

    // Flatten wt-cash-equal wrappers and collect weights for specified mode
    const flattenedChildren: FlowNode[] = []
    for (const child of children) {
      const childNode = child as Record<string, unknown>
      if (childNode.step === 'wt-cash-equal' || childNode.step === 'wt-cash-specified' || childNode.step === 'wt-inverse-vol') {
        // Unwrap and process inner children
        const innerChildren = (childNode.children as unknown[]) || []
        for (const inner of innerChildren) {
          const parsed = parseComposerNode(inner as Record<string, unknown>, idGen)
          if (parsed) flattenedChildren.push(parsed)
        }
      } else {
        const parsed = parseComposerNode(childNode, idGen)
        if (parsed) flattenedChildren.push(parsed)
      }
    }

    const result: FlowNode = {
      id: idGen.nodeId(),
      kind: 'basic',
      title: step === 'root' ? (name || 'Imported System') : (name || 'Basic'),
      collapsed: false,
      weighting,
      children: { next: flattenedChildren.length > 0 ? flattenedChildren : [null] },
    }

    return result
  }

  // Unknown step type
  console.warn(`[ComposerParser] Unknown step type: ${step}`)
  return null
}

/**
 * Main entry point: parse entire Composer Symphony JSON
 */
export const parseComposerSymphony = (data: Record<string, unknown>): FlowNode => {
  const idGen = createComposerIdGenerator()
  const name = (data.name as string) || 'Imported System'

  // Parse starting from root
  const parsed = parseComposerNode(data, idGen)

  if (!parsed) {
    // Return a basic fallback node
    return {
      id: idGen.nodeId(),
      kind: 'basic',
      title: name,
      collapsed: false,
      weighting: 'equal',
      children: { next: [null] },
    }
  }

  // Override title with the symphony name if it's the root
  if (parsed.kind === 'basic' && name) {
    parsed.title = name
  }

  return parsed
}

// ============================================
// QUANTMAGE IMPORT PARSER
// ============================================

/**
 * Map QuantMage indicator types to Atlas MetricChoice
 */
const mapQuantMageIndicator = (type: string): MetricChoice => {
  const mapping: Record<string, MetricChoice> = {
    'CurrentPrice': 'Current Price',
    'MovingAverage': 'Simple Moving Average',
    'ExponentialMovingAverage': 'Exponential Moving Average',
    'RelativeStrengthIndex': 'Relative Strength Index',
    'CumulativeReturn': 'Cumulative Return',
    'Volatility': 'Standard Deviation',
    'MaxDrawdown': 'Max Drawdown',
    // Momentum indicators
    '13612wMomentum': 'Momentum (Weighted)',
    '13612uMomentum': 'Momentum (Unweighted)',
    'SMA12Momentum': 'Momentum (12-Month SMA)',
    // Additional indicators
    'UltimateSmoother': 'Ultimate Smoother',
    'Drawdown': 'Drawdown',
    'AroonUp': 'Aroon Up',
    'AroonDown': 'Aroon Down',
    'Aroon': 'Aroon Oscillator',
    'MACD': 'MACD Histogram',
    'PPO': 'PPO Histogram',
    'TrendClarity': 'Trend Clarity',
    'MovingAverageReturn': 'SMA of Returns',
  }
  return mapping[type] || 'Relative Strength Index'
}

/**
 * ID generator for QuantMage imports (performance optimized)
 */
const createQuantMageIdGenerator = () => {
  let nodeCounter = 0
  let condCounter = 0
  const batchTs = Date.now()
  const batchRand = Math.random().toString(36).slice(2, 10)
  return {
    nodeId: () => `node-${batchTs}-${++nodeCounter}-${batchRand}`,
    condId: () => `cond-${++condCounter}`,
  }
}

/**
 * Parse a QuantMage condition into Atlas ConditionLine(s)
 */
const parseQuantMageCondition = (
  condition: Record<string, unknown>,
  idGen: ReturnType<typeof createQuantMageIdGenerator>
): ConditionLine[] => {
  const condType = condition.condition_type as string

  if (condType === 'SingleCondition') {
    const lhIndicator = condition.lh_indicator as { type: string; window: number } | undefined
    const rhIndicator = condition.rh_indicator as { type: string; window: number } | undefined
    const compType = condition.type as string // 'IndicatorAndNumber' or 'BothIndicators'
    const greaterThan = condition.greater_than as boolean
    const forDays = (condition.for_days as number) || 1

    const cond: ConditionLine = {
      id: idGen.condId(),
      type: 'if',
      metric: lhIndicator ? mapQuantMageIndicator(lhIndicator.type) : 'Relative Strength Index',
      window: lhIndicator?.window || 14,
      ticker: (condition.lh_ticker_symbol as PositionChoice) || 'SPY',
      comparator: greaterThan ? 'gt' : 'lt',
      threshold: 0,
      expanded: false,
      forDays: forDays > 1 ? forDays : undefined, // Only store if > 1
    }

    if (compType === 'IndicatorAndNumber') {
      // Threshold comparison
      cond.threshold = parseFloat(String(condition.rh_value || 0))
      cond.expanded = false
    } else if (compType === 'BothIndicators') {
      // Indicator vs indicator
      cond.expanded = true
      cond.rightMetric = rhIndicator ? mapQuantMageIndicator(rhIndicator.type) : 'Relative Strength Index'
      cond.rightWindow = rhIndicator?.window || 14
      cond.rightTicker = (condition.rh_ticker_symbol as PositionChoice) || 'SPY'
    }

    return [cond]
  }

  if (condType === 'AnyOf' || condType === 'AllOf') {
    const conditions = (condition.conditions as Record<string, unknown>[]) || []
    const result: ConditionLine[] = []

    for (let i = 0; i < conditions.length; i++) {
      const parsed = parseQuantMageCondition(conditions[i], idGen)
      for (const cond of parsed) {
        // Mark as 'and' for AllOf, 'or' for AnyOf (skip first)
        if (i > 0 || result.length > 0) {
          cond.type = condType === 'AllOf' ? 'and' : 'or'
        }
        result.push(cond)
      }
    }
    return result
  }

  // Unknown condition type
  return [{
    id: idGen.condId(),
    type: 'if',
    metric: 'Relative Strength Index',
    window: 14,
    ticker: 'SPY',
    comparator: 'gt',
    threshold: 50,
    expanded: false,
  }]
}

/**
 * Parse a QuantMage incantation node recursively
 */
const parseQuantMageIncantation = (
  node: Record<string, unknown>,
  idGen: ReturnType<typeof createQuantMageIdGenerator>
): FlowNode | null => {
  const incType = node.incantation_type as string

  // Ticker -> Position
  if (incType === 'Ticker') {
    const symbol = (node.symbol as string) || 'SPY'
    return {
      id: idGen.nodeId(),
      kind: 'position',
      title: 'Position',
      collapsed: false,
      positions: [symbol as PositionChoice],
      weighting: 'equal',
      children: {},
    }
  }

  // IfElse -> Indicator
  if (incType === 'IfElse') {
    const condition = node.condition as Record<string, unknown> | undefined
    const thenInc = node.then_incantation as Record<string, unknown> | undefined
    const elseInc = node.else_incantation as Record<string, unknown> | undefined

    const conditions = condition ? parseQuantMageCondition(condition, idGen) : [{
      id: idGen.condId(),
      type: 'if' as const,
      metric: 'Relative Strength Index' as MetricChoice,
      window: 14,
      ticker: 'SPY' as PositionChoice,
      comparator: 'gt' as ComparatorChoice,
      threshold: 50,
      expanded: false,
    }]

    const thenBranch = thenInc ? parseQuantMageIncantation(thenInc, idGen) : null
    const elseBranch = elseInc ? parseQuantMageIncantation(elseInc, idGen) : null

    return {
      id: idGen.nodeId(),
      kind: 'indicator',
      title: (node.name as string) || 'Indicator',
      collapsed: false,
      weighting: 'equal',
      weightingThen: 'equal',
      weightingElse: 'equal',
      conditions,
      children: {
        then: thenBranch ? [thenBranch] : [null],
        else: elseBranch ? [elseBranch] : [null],
        next: [null],
      },
    }
  }

  // Weighted -> Basic
  if (incType === 'Weighted') {
    const weightType = node.type as string // 'Equal', 'InverseVolatility', or 'Custom'
    const incantations = (node.incantations as Record<string, unknown>[]) || []
    const customWeights = (node.weights as number[]) || []

    // Determine weighting mode: Custom -> defined, InverseVolatility -> inverse, else equal
    const weighting: WeightMode = weightType === 'Custom' ? 'defined'
      : weightType === 'InverseVolatility' ? 'inverse'
      : 'equal'

    const children = incantations
      .map((inc, idx) => {
        const child = parseQuantMageIncantation(inc, idGen)
        // For 'defined' weighting, store the weight in the child's window property
        if (child && weighting === 'defined' && customWeights[idx] !== undefined) {
          child.window = customWeights[idx]
        }
        return child
      })
      .filter((c): c is FlowNode => c !== null)

    const result: FlowNode = {
      id: idGen.nodeId(),
      kind: 'basic',
      title: (node.name as string) || 'Basic',
      collapsed: false,
      weighting,
      children: { next: children.length > 0 ? children : [null] },
    }

    return result
  }

  // Filtered -> Sort (function)
  if (incType === 'Filtered') {
    const sortIndicator = node.sort_indicator as { type: string; window: number } | undefined
    const count = (node.count as number) || 1
    const bottom = (node.bottom as boolean) || false
    const incantations = (node.incantations as Record<string, unknown>[]) || []

    const children = incantations
      .map((inc) => parseQuantMageIncantation(inc, idGen))
      .filter((c): c is FlowNode => c !== null)

    return {
      id: idGen.nodeId(),
      kind: 'function',
      title: 'Sort',
      collapsed: false,
      weighting: 'equal',
      metric: sortIndicator ? mapQuantMageIndicator(sortIndicator.type) : 'Relative Strength Index',
      window: sortIndicator?.window || 14,
      rank: bottom ? 'Bottom' : 'Top',
      bottom: count,
      children: { next: children.length > 0 ? children : [null] },
    }
  }

  // Switch -> Nested Indicators (case/when logic)
  if (incType === 'Switch') {
    const conditions = (node.conditions as Record<string, unknown>[]) || []
    const incantations = (node.incantations as Record<string, unknown>[]) || []

    // Convert Switch to nested if/else structure
    const buildNestedIndicator = (idx: number): FlowNode | null => {
      if (idx >= conditions.length) {
        // No more conditions, return the fallback incantation if it exists
        if (idx < incantations.length && incantations[idx]) {
          return parseQuantMageIncantation(incantations[idx], idGen)
        }
        return null
      }

      const cond = conditions[idx]
      const thenInc = incantations[idx]
      const parsedConds = cond ? parseQuantMageCondition(cond, idGen) : [{
        id: idGen.condId(),
        type: 'if' as const,
        metric: 'Relative Strength Index' as MetricChoice,
        window: 14,
        ticker: 'SPY' as PositionChoice,
        comparator: 'gt' as ComparatorChoice,
        threshold: 50,
        expanded: false,
      }]
      const thenBranch = thenInc ? parseQuantMageIncantation(thenInc, idGen) : null
      const elseBranch = buildNestedIndicator(idx + 1)

      return {
        id: idGen.nodeId(),
        kind: 'indicator',
        title: (node.name as string) || 'Switch Case',
        collapsed: false,
        weighting: 'equal',
        weightingThen: 'equal',
        weightingElse: 'equal',
        conditions: parsedConds,
        children: {
          then: thenBranch ? [thenBranch] : [null],
          else: elseBranch ? [elseBranch] : [null],
          next: [null],
        },
      }
    }

    return buildNestedIndicator(0)
  }

  // Mixed -> Scaling
  if (incType === 'Mixed') {
    const indicator = node.indicator as { type: string; window: number } | undefined
    const tickerSymbol = (node.ticker_symbol as string) || 'SPY'
    const fromValue = (node.from_value as number) || 0
    const toValue = (node.to_value as number) || 100
    const fromInc = node.from_incantation as Record<string, unknown> | undefined
    const toInc = node.to_incantation as Record<string, unknown> | undefined

    const thenBranch = fromInc ? parseQuantMageIncantation(fromInc, idGen) : null
    const elseBranch = toInc ? parseQuantMageIncantation(toInc, idGen) : null

    // Create scaling condition
    const condition: ConditionLine = {
      id: idGen.condId(),
      type: 'if',
      metric: indicator ? mapQuantMageIndicator(indicator.type) : 'Relative Strength Index',
      window: indicator?.window || 14,
      ticker: tickerSymbol as PositionChoice,
      comparator: 'gt',
      threshold: 0,
      expanded: false,
    }

    return {
      id: idGen.nodeId(),
      kind: 'scaling',
      title: (node.name as string) || 'Scaling',
      collapsed: false,
      weighting: 'equal',
      weightingThen: 'equal',
      weightingElse: 'equal',
      conditions: [condition],
      // Set scaling-specific fields (used by backtest evaluation)
      scaleMetric: indicator ? mapQuantMageIndicator(indicator.type) : 'Relative Strength Index',
      scaleWindow: indicator?.window || 14,
      scaleTicker: tickerSymbol,
      scaleFrom: fromValue,
      scaleTo: toValue,
      children: {
        then: thenBranch ? [thenBranch] : [null],
        else: elseBranch ? [elseBranch] : [null],
      },
    }
  }

  // Unknown incantation type
  console.warn(`[QuantMageParser] Unknown incantation_type: ${incType}`)
  return null
}

/**
 * Main entry point: parse QuantMage incantation JSON
 */
export const parseQuantMageIncantationRoot = (data: Record<string, unknown>): FlowNode => {
  const idGen = createQuantMageIdGenerator()
  const incantation = data.incantation as Record<string, unknown> | undefined

  if (!incantation) {
    return {
      id: idGen.nodeId(),
      kind: 'basic',
      title: 'Imported System',
      collapsed: false,
      weighting: 'equal',
      children: { next: [null] },
    }
  }

  const parsed = parseQuantMageIncantation(incantation, idGen)

  if (!parsed) {
    return {
      id: idGen.nodeId(),
      kind: 'basic',
      title: 'Imported System',
      collapsed: false,
      weighting: 'equal',
      children: { next: [null] },
    }
  }

  return parsed
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Async helper: yields to main thread to keep UI responsive during heavy processing
 */
export const yieldToMain = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

// cloneAndNormalize is exported from @/features/builder/utils/treeOperations
