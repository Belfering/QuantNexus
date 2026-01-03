// Web Worker for parsing large JSON imports off the main thread
// This prevents UI freezing when importing files with 1000+ nodes

type PositionChoice = string
type MetricChoice = string
type ComparatorChoice = 'gt' | 'lt' | 'gte' | 'lte'
type WeightMode = 'equal' | 'defined' | 'inverse'
type BlockKind = 'basic' | 'function' | 'indicator' | 'position' | 'numbered' | 'call' | 'altExit' | 'scaling'
type SlotId = 'next' | 'then' | 'else' | `ladder-${number}`

interface ConditionLine {
  id: string
  type: 'if' | 'and' | 'or'
  metric: MetricChoice
  window: number
  ticker: PositionChoice
  comparator: ComparatorChoice
  threshold: number
  expanded?: boolean
  rightTicker?: PositionChoice
  rightMetric?: MetricChoice
  rightWindow?: number
  forDays?: number // Condition must be true for N consecutive days
}

interface NumberedItem {
  id: string
  conditions: ConditionLine[]
}

interface NumberedConfig {
  quantifier: 'any' | 'all' | 'none' | 'exactly' | 'atLeast' | 'atMost' | 'ladder'
  n: number
  items: NumberedItem[]
}

interface FlowNode {
  id: string
  kind: BlockKind
  title: string
  collapsed?: boolean
  children: Partial<Record<SlotId, Array<FlowNode | null>>>
  positions?: PositionChoice[]
  weighting: WeightMode
  weightingThen?: WeightMode
  weightingElse?: WeightMode
  conditions?: ConditionLine[]
  metric?: MetricChoice
  window?: number
  rank?: 'Top' | 'Bottom'
  bottom?: number
  // Scaling node properties
  scaleMetric?: MetricChoice
  scaleWindow?: number
  scaleTicker?: string
  scaleFrom?: number
  scaleTo?: number
  numbered?: NumberedConfig
}

const SLOT_ORDER: Record<BlockKind, SlotId[]> = {
  basic: ['next'],
  function: ['next'],
  indicator: ['then', 'else', 'next'],
  position: [],
  numbered: ['then', 'else'],
  call: [],
  altExit: ['then', 'else'],
  scaling: ['then', 'else'],
}

// ID generator
const createIdGenerator = () => {
  let nodeCounter = 0
  let condCounter = 0
  const batchTs = Date.now()
  const batchRand = Math.random().toString(36).slice(2, 10)
  return {
    nodeId: () => `qm-${batchTs}-${++nodeCounter}-${batchRand}`,
    condId: () => `qmc-${batchTs}-${++condCounter}-${batchRand}`,
  }
}

// FRD-021: Detect and parse QuantMage subspell references
// Subspells appear as ticker_symbol values like 'Subspell "From"', 'Subspell "Enter"', etc.
const isSubspellReference = (tickerSymbol: string | undefined): boolean => {
  return typeof tickerSymbol === 'string' && tickerSymbol.startsWith('Subspell "')
}

// Parse subspell reference into Atlas branch format
// 'Subspell "From"' -> 'branch:from', 'Subspell "Enter"' -> 'branch:enter', etc.
const parseSubspellReference = (tickerSymbol: string): string => {
  const match = tickerSymbol.match(/^Subspell "(\w+)"$/)
  if (match) {
    return `branch:${match[1].toLowerCase()}`
  }
  return tickerSymbol // Return as-is if doesn't match pattern
}

// Map QuantMage indicator types to Atlas metric names
const mapIndicator = (type: string): MetricChoice => {
  const mapping: Record<string, MetricChoice> = {
    'CurrentPrice': 'Current Price',
    'MovingAverage': 'Simple Moving Average',
    'SimpleMovingAverage': 'Simple Moving Average',
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

// Parse QuantMage condition
const parseCondition = (
  cond: Record<string, unknown>,
  idGen: ReturnType<typeof createIdGenerator>
): ConditionLine[] => {
  const condType = cond.condition_type as string

  if (condType === 'SingleCondition') {
    const lhIndicator = cond.lh_indicator as { type: string; window: number } | undefined
    const rhIndicator = cond.rh_indicator as { type: string; window: number } | undefined
    const type = cond.type as string
    const forDays = (cond.for_days as number) || 1

    // FRD-021: Handle subspell references in ticker fields
    const lhTicker = cond.lh_ticker_symbol as string | undefined
    const parsedLhTicker = isSubspellReference(lhTicker)
      ? parseSubspellReference(lhTicker!)
      : (lhTicker || 'SPY')

    const base: ConditionLine = {
      id: idGen.condId(),
      type: 'if',
      metric: lhIndicator ? mapIndicator(lhIndicator.type) : 'Relative Strength Index',
      window: lhIndicator?.window || 14,
      ticker: parsedLhTicker,
      comparator: (cond.greater_than as boolean) ? 'gt' : 'lt',
      threshold: (cond.rh_value as number) ?? 50,
      expanded: false,
      forDays: forDays > 1 ? forDays : undefined, // Only store if > 1
    }

    if ((type === 'IndicatorAndIndicator' || type === 'BothIndicators') && rhIndicator) {
      base.expanded = true
      // FRD-021: Handle subspell references in right ticker field
      const rhTicker = cond.rh_ticker_symbol as string | undefined
      base.rightTicker = isSubspellReference(rhTicker)
        ? parseSubspellReference(rhTicker!)
        : (rhTicker || 'SPY')
      base.rightMetric = mapIndicator(rhIndicator.type)
      base.rightWindow = rhIndicator.window || 14
    }

    return [base]
  }

  if (condType === 'AndCondition' || condType === 'OrCondition') {
    const conditions = (cond.conditions as Record<string, unknown>[]) || []
    const results: ConditionLine[] = []

    conditions.forEach((c, idx) => {
      const parsed = parseCondition(c, idGen)
      parsed.forEach((p, pIdx) => {
        if (idx === 0 && pIdx === 0) {
          results.push(p)
        } else {
          results.push({ ...p, type: condType === 'AndCondition' ? 'and' : 'or' })
        }
      })
    })

    return results
  }

  // Handle AnyOf/AllOf - these are like OrCondition/AndCondition but with different naming
  if (condType === 'AnyOf' || condType === 'AllOf') {
    const conditions = (cond.conditions as Record<string, unknown>[]) || []
    const results: ConditionLine[] = []

    conditions.forEach((c, idx) => {
      const parsed = parseCondition(c, idGen)
      parsed.forEach((p, pIdx) => {
        if (idx === 0 && pIdx === 0) {
          results.push(p)
        } else {
          // AnyOf = OR logic, AllOf = AND logic
          results.push({ ...p, type: condType === 'AnyOf' ? 'or' : 'and' })
        }
      })
    })

    return results
  }

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

// Parse a single QuantMage condition into a numbered item
// This handles SingleCondition, AndCondition, OrCondition, and nested AnyOf/AllOf
const parseConditionForNumberedItem = (
  cond: Record<string, unknown>,
  idGen: ReturnType<typeof createIdGenerator>
): NumberedItem => {
  const condType = cond.condition_type as string

  if (condType === 'SingleCondition') {
    return {
      id: idGen.nodeId(),
      conditions: parseCondition(cond, idGen),
    }
  }

  if (condType === 'AndCondition' || condType === 'OrCondition') {
    return {
      id: idGen.nodeId(),
      conditions: parseCondition(cond, idGen),
    }
  }

  // For nested AllOf within an item, flatten all conditions with 'and' type
  // This makes sense: if AllOf is inside an AnyOf, it means all these conditions must be true together
  if (condType === 'AllOf') {
    const innerConditions = (cond.conditions as Record<string, unknown>[]) || []
    const results: ConditionLine[] = []

    innerConditions.forEach((c, idx) => {
      const parsed = parseCondition(c, idGen)
      parsed.forEach((p, pIdx) => {
        if (idx === 0 && pIdx === 0) {
          results.push(p) // First condition stays 'if'
        } else {
          results.push({ ...p, type: 'and' }) // Rest become 'and'
        }
      })
    })

    return {
      id: idGen.nodeId(),
      conditions: results.length > 0 ? results : [{
        id: idGen.condId(),
        type: 'if',
        metric: 'Relative Strength Index',
        window: 14,
        ticker: 'SPY',
        comparator: 'gt',
        threshold: 50,
        expanded: false,
      }],
    }
  }

  // For nested AnyOf within an item, flatten all conditions with 'or' type
  if (condType === 'AnyOf') {
    const innerConditions = (cond.conditions as Record<string, unknown>[]) || []
    const results: ConditionLine[] = []

    innerConditions.forEach((c, idx) => {
      const parsed = parseCondition(c, idGen)
      parsed.forEach((p, pIdx) => {
        if (idx === 0 && pIdx === 0) {
          results.push(p) // First condition stays 'if'
        } else {
          results.push({ ...p, type: 'or' }) // Rest become 'or'
        }
      })
    })

    return {
      id: idGen.nodeId(),
      conditions: results.length > 0 ? results : [{
        id: idGen.condId(),
        type: 'if',
        metric: 'Relative Strength Index',
        window: 14,
        ticker: 'SPY',
        comparator: 'gt',
        threshold: 50,
        expanded: false,
      }],
    }
  }

  // Default fallback
  return {
    id: idGen.nodeId(),
    conditions: [{
      id: idGen.condId(),
      type: 'if',
      metric: 'Relative Strength Index',
      window: 14,
      ticker: 'SPY',
      comparator: 'gt',
      threshold: 50,
      expanded: false,
    }],
  }
}

// Parse QuantMage incantation recursively
// All nodes are collapsed by default to prevent rendering thousands of nodes at once
const parseIncantation = (
  node: Record<string, unknown>,
  idGen: ReturnType<typeof createIdGenerator>
): FlowNode | null => {
  const incType = node.incantation_type as string

  if (incType === 'Ticker') {
    return {
      id: idGen.nodeId(),
      kind: 'position',
      title: 'Position',
      collapsed: true,
      positions: [(node.symbol as string) || 'SPY'],
      weighting: 'equal',
      children: {},
    }
  }

  if (incType === 'IfElse') {
    const condition = node.condition as Record<string, unknown> | undefined
    const condType = condition?.condition_type as string | undefined
    const thenInc = node.then_incantation as Record<string, unknown> | undefined
    const elseInc = node.else_incantation as Record<string, unknown> | undefined

    // If condition is AnyOf or AllOf, create a numbered node
    if (condType === 'AnyOf' || condType === 'AllOf') {
      const thenBranch = thenInc ? parseIncantation(thenInc, idGen) : null
      const elseBranch = elseInc ? parseIncantation(elseInc, idGen) : null

      // Build numbered items from conditions
      const innerConditions = (condition?.conditions as Record<string, unknown>[]) || []
      const items: NumberedItem[] = innerConditions.map((c) =>
        parseConditionForNumberedItem(c, idGen)
      )

      return {
        id: idGen.nodeId(),
        kind: 'numbered',
        title: (node.name as string) || 'Numbered',
        collapsed: true,
        weighting: 'equal',
        weightingThen: 'equal',
        weightingElse: 'equal',
        numbered: {
          quantifier: condType === 'AnyOf' ? 'any' : 'all',
          n: 1,
          items,
        },
        children: {
          then: thenBranch ? [thenBranch] : [null],
          else: elseBranch ? [elseBranch] : [null],
        },
      }
    }

    // Regular IfElse with SingleCondition, AndCondition, or OrCondition
    const conditions = condition ? parseCondition(condition, idGen) : [{
      id: idGen.condId(),
      type: 'if' as const,
      metric: 'Relative Strength Index' as MetricChoice,
      window: 14,
      ticker: 'SPY' as PositionChoice,
      comparator: 'gt' as ComparatorChoice,
      threshold: 50,
      expanded: false,
    }]

    const thenBranch = thenInc ? parseIncantation(thenInc, idGen) : null
    const elseBranch = elseInc ? parseIncantation(elseInc, idGen) : null

    return {
      id: idGen.nodeId(),
      kind: 'indicator',
      title: (node.name as string) || 'Indicator',
      collapsed: true,
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

  if (incType === 'Weighted') {
    const weightType = node.type as string
    const incantations = (node.incantations as Record<string, unknown>[]) || []
    const customWeights = (node.weights as number[]) || []

    // Determine weighting mode: Custom -> defined, InverseVolatility -> inverse, else equal
    const weighting: WeightMode = weightType === 'Custom' ? 'defined'
      : weightType === 'InverseVolatility' ? 'inverse'
      : 'equal'

    const children = incantations
      .map((inc, idx) => {
        const child = parseIncantation(inc, idGen)
        // For 'defined' weighting, store the weight in the child's window property
        if (child && weighting === 'defined' && customWeights[idx] !== undefined) {
          child.window = customWeights[idx]
        }
        return child
      })
      .filter((c): c is FlowNode => c !== null)

    return {
      id: idGen.nodeId(),
      kind: 'basic',
      title: (node.name as string) || 'Basic',
      collapsed: true,
      weighting,
      children: { next: children.length > 0 ? children : [null] },
    }
  }

  if (incType === 'Filtered') {
    const sortIndicator = node.sort_indicator as { type: string; window: number } | undefined
    const count = (node.count as number) || 1
    const bottom = (node.bottom as boolean) || false
    const incantations = (node.incantations as Record<string, unknown>[]) || []

    const children = incantations
      .map((inc) => parseIncantation(inc, idGen))
      .filter((c): c is FlowNode => c !== null)

    return {
      id: idGen.nodeId(),
      kind: 'function',
      title: 'Sort',
      collapsed: true,
      weighting: 'equal',
      metric: sortIndicator ? mapIndicator(sortIndicator.type) : 'Relative Strength Index',
      window: sortIndicator?.window || 14,
      rank: bottom ? 'Bottom' : 'Top',
      bottom: count,
      children: { next: children.length > 0 ? children : [null] },
    }
  }

  if (incType === 'Switch') {
    const conditions = (node.conditions as Record<string, unknown>[]) || []
    const incantations = (node.incantations as Record<string, unknown>[]) || []

    // Check if this is a "ladder" pattern: N conditions with N+1 incantations (all, N-1, ..., 1, none)
    const isLadderPattern = conditions.length >= 1 && incantations.length === conditions.length + 1

    if (isLadderPattern) {
      // Create a numbered node with ladder quantifier
      // Handle nested AnyOf/AllOf condition groups
      const items: NumberedItem[] = conditions.map((cond) => {
        if (!cond) {
          return {
            id: idGen.condId(),
            conditions: [{
              id: idGen.condId(),
              type: 'if' as const,
              metric: 'Relative Strength Index' as MetricChoice,
              window: 14,
              ticker: 'SPY' as PositionChoice,
              comparator: 'gt' as ComparatorChoice,
              threshold: 50,
              expanded: false,
            }],
          }
        }

        const condType = (cond as Record<string, unknown>).condition_type as string

        // Handle nested AnyOf/AllOf groups - these become single items with multiple conditions
        if (condType === 'AnyOf' || condType === 'AllOf') {
          const innerConditions = ((cond as Record<string, unknown>).conditions as Record<string, unknown>[]) || []
          const parsedConditions: ConditionLine[] = []

          innerConditions.forEach((c, idx) => {
            const parsed = parseCondition(c, idGen)
            parsed.forEach((p, pIdx) => {
              if (idx === 0 && pIdx === 0) {
                parsedConditions.push(p) // First stays 'if'
              } else {
                // For AnyOf: use 'or' to connect conditions
                // For AllOf: use 'and' to connect conditions
                parsedConditions.push({ ...p, type: condType === 'AnyOf' ? 'or' : 'and' })
              }
            })
          })

          return {
            id: idGen.condId(),
            conditions: parsedConditions.length > 0 ? parsedConditions : [{
              id: idGen.condId(),
              type: 'if' as const,
              metric: 'Relative Strength Index' as MetricChoice,
              window: 14,
              ticker: 'SPY' as PositionChoice,
              comparator: 'gt' as ComparatorChoice,
              threshold: 50,
              expanded: false,
            }],
            groupLogic: condType === 'AnyOf' ? 'or' : 'and',
          } as NumberedItem
        }

        // Regular single condition (SingleCondition, AndCondition, etc.)
        return {
          id: idGen.condId(),
          conditions: parseCondition(cond, idGen),
        }
      })

      // Build children for each ladder slot (all N matches down to 0 matches)
      const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
      for (let i = conditions.length; i >= 0; i--) {
        const slotKey = `ladder-${i}` as SlotId
        const incIdx = conditions.length - i // all=0, N-1=1, ..., none=N
        const branch = incantations[incIdx] ? parseIncantation(incantations[incIdx], idGen) : null
        children[slotKey] = branch ? [branch] : [null]
      }

      return {
        id: idGen.nodeId(),
        kind: 'numbered',
        title: (node.name as string) || 'Signal Ladder',
        collapsed: true,
        weighting: 'equal',
        numbered: {
          quantifier: 'ladder',
          n: conditions.length,
          items,
        },
        children,
      }
    }

    // Fall back to nested indicator approach for other Switch patterns
    const buildNested = (idx: number): FlowNode | null => {
      if (idx >= conditions.length) {
        if (idx < incantations.length && incantations[idx]) {
          return parseIncantation(incantations[idx], idGen)
        }
        return null
      }

      const cond = conditions[idx]
      const thenInc = incantations[idx]
      const parsedConds = cond ? parseCondition(cond, idGen) : [{
        id: idGen.condId(),
        type: 'if' as const,
        metric: 'Relative Strength Index' as MetricChoice,
        window: 14,
        ticker: 'SPY' as PositionChoice,
        comparator: 'gt' as ComparatorChoice,
        threshold: 50,
        expanded: false,
      }]
      const thenBranch = thenInc ? parseIncantation(thenInc, idGen) : null
      const elseBranch = buildNested(idx + 1)

      return {
        id: idGen.nodeId(),
        kind: 'indicator',
        title: (node.name as string) || 'Switch Case',
        collapsed: true,
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

    return buildNested(0)
  }

  if (incType === 'Mixed') {
    const indicator = node.indicator as { type: string; window: number } | undefined
    const rawTickerSymbol = (node.ticker_symbol as string) || 'SPY'
    const fromValue = (node.from_value as number) || 0
    const toValue = (node.to_value as number) || 100
    const fromInc = node.from_incantation as Record<string, unknown> | undefined
    const toInc = node.to_incantation as Record<string, unknown> | undefined

    // FRD-021: Handle subspell references (e.g., 'Subspell "From"' -> 'branch:from')
    const tickerSymbol = isSubspellReference(rawTickerSymbol)
      ? parseSubspellReference(rawTickerSymbol)
      : rawTickerSymbol

    const thenBranch = fromInc ? parseIncantation(fromInc, idGen) : null
    const elseBranch = toInc ? parseIncantation(toInc, idGen) : null

    return {
      id: idGen.nodeId(),
      kind: 'scaling',
      title: (node.name as string) || 'Scaling',
      collapsed: true,
      weighting: 'equal',
      weightingThen: 'equal',
      weightingElse: 'equal',
      conditions: [{
        id: idGen.condId(),
        type: 'if',
        metric: indicator ? mapIndicator(indicator.type) : 'Relative Strength Index',
        window: indicator?.window || 14,
        ticker: tickerSymbol,
        comparator: 'gt',
        threshold: 0,
        expanded: false,
      }],
      // Set scaling-specific fields (used by backtest evaluation)
      scaleMetric: indicator ? mapIndicator(indicator.type) : 'Relative Strength Index',
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

  // EnterExit: condition-based entry/exit with separate positions for each state
  // Used in QuantMage for strategies that enter on one condition and exit on another
  if (incType === 'EnterExit') {
    const enterCondition = node.enter_condition as Record<string, unknown> | undefined
    const enterInc = node.enter_incantation as Record<string, unknown> | undefined
    const exitInc = node.exit_incantation as Record<string, unknown> | undefined

    // Parse the enter condition (this triggers buying the enter position)
    const enterConditions = enterCondition ? parseCondition(enterCondition, idGen) : [{
      id: idGen.condId(),
      type: 'if' as const,
      metric: 'Relative Strength Index' as MetricChoice,
      window: 14,
      ticker: 'SPY' as PositionChoice,
      comparator: 'gt' as ComparatorChoice,
      threshold: 50,
      expanded: false,
    }]

    const enterBranch = enterInc ? parseIncantation(enterInc, idGen) : null
    const exitBranch = exitInc ? parseIncantation(exitInc, idGen) : null

    // Model EnterExit as an altExit node (if enter condition -> enter position, else exit position)
    return {
      id: idGen.nodeId(),
      kind: 'altExit',
      title: (node.name as string) || 'Enter/Exit',
      collapsed: true,
      weighting: 'equal',
      weightingThen: 'equal',
      weightingElse: 'equal',
      conditions: enterConditions,
      children: {
        then: enterBranch ? [enterBranch] : [null],
        else: exitBranch ? [exitBranch] : [null],
      },
    }
  }

  console.warn(`[ImportWorker] Unknown incantation_type: ${incType}`)
  return null
}

// Parse entire QuantMage strategy
const parseQuantMageStrategy = (data: Record<string, unknown>): FlowNode => {
  const idGen = createIdGenerator()
  const name = (data.name as string) || 'Imported System'
  const incantation = data.incantation as Record<string, unknown> | undefined

  if (!incantation) {
    return {
      id: idGen.nodeId(),
      kind: 'basic',
      title: name,
      collapsed: false, // Root is expanded
      weighting: 'equal',
      children: { next: [null] },
    }
  }

  const parsed = parseIncantation(incantation, idGen)

  if (!parsed) {
    return {
      id: idGen.nodeId(),
      kind: 'basic',
      title: name,
      collapsed: false, // Root is expanded
      weighting: 'equal',
      children: { next: [null] },
    }
  }

  // If the parsed result is already a 'basic' node, use it as the root
  if (parsed.kind === 'basic') {
    if (name) parsed.title = name
    parsed.collapsed = false
    return parsed
  }

  // Otherwise, wrap the parsed node in a 'basic' root so users can add sibling nodes
  // This handles cases like Switch/ladder returning a 'numbered' node directly
  parsed.collapsed = false // Expand the inner node so user can see it
  return {
    id: idGen.nodeId(),
    kind: 'basic',
    title: name,
    collapsed: false, // Root is expanded
    weighting: 'equal',
    children: { next: [parsed] },
  }
}

// Normalize imported node (ensure slots, regenerate IDs if needed)
const normalizeForImport = (node: FlowNode): FlowNode => {
  const seen = new Set<string>()
  let needsNewIds = false
  const idGen = createIdGenerator()

  // Helper to get all slot keys for a node (including ladder slots)
  const getAllSlots = (n: FlowNode): SlotId[] => {
    const slots = [...SLOT_ORDER[n.kind]]
    if (n.kind === 'numbered' && n.numbered?.quantifier === 'ladder') {
      Object.keys(n.children).forEach((key) => {
        if (key.startsWith('ladder-') && !slots.includes(key as SlotId)) {
          slots.push(key as SlotId)
        }
      })
    }
    return slots
  }

  const detectLegacy = (n: FlowNode) => {
    if (/^node-\d+$/.test(n.id) || seen.has(n.id)) needsNewIds = true
    seen.add(n.id)
    getAllSlots(n).forEach((slot) => {
      n.children[slot]?.forEach((c) => {
        if (c) detectLegacy(c)
      })
    })
  }
  detectLegacy(node)

  const walk = (n: FlowNode): FlowNode => {
    const children: Partial<Record<SlotId, Array<FlowNode | null>>> = {}
    getAllSlots(n).forEach((slot) => {
      const arr = n.children[slot] ?? [null]
      children[slot] = arr.map((c) => (c ? walk(c) : c))
    })
    return {
      ...n,
      id: needsNewIds ? idGen.nodeId() : n.id,
      children,
    }
  }
  return walk(node)
}

// Handle messages from main thread
self.onmessage = (e: MessageEvent) => {
  const { type, data, format, filename } = e.data

  if (type === 'parse') {
    try {
      let root: FlowNode

      if (format === 'quantmage') {
        root = parseQuantMageStrategy(data)
      } else {
        // For other formats, assume it's already a FlowNode
        root = data as FlowNode
      }

      // Apply title from filename if needed
      const inferredTitle = filename?.replace(/\.json$/i, '').replace(/_/g, ' ').trim()
      const hasTitle = Boolean(root.title?.trim())
      const shouldInfer = !hasTitle || (root.title.trim() === 'Algo Name Here' && inferredTitle)
      if (shouldInfer && inferredTitle) {
        root.title = inferredTitle
      }

      // Normalize the tree
      const normalized = normalizeForImport(root)

      self.postMessage({ type: 'success', result: normalized })
    } catch (err) {
      self.postMessage({ type: 'error', error: String(err) })
    }
  }
}

export {}
