// src/features/backtest/engine/formulaEvaluator.ts
// Formula evaluator for custom indicators (FRD-035)
// Evaluates parsed AST nodes to produce numeric values at runtime

import type { ASTNode, FunctionCallNode } from './formulaParser'
import { MATH_FUNCTIONS, BINARY_FUNCTIONS, ROLLING_FUNCTIONS } from './formulaParser'

// ─────────────────────────────────────────────────────────────────────────────
// Evaluation Context Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Context for evaluating custom indicator formulas
 * Provides access to base indicator values and price data
 */
export interface FormulaEvalContext {
  /**
   * Get the value of a base variable at the current index
   * @param variable - Variable name (e.g., 'close', 'rsi', 'sma')
   * @param window - Optional window parameter for windowed indicators
   * @returns The numeric value, or null if unavailable
   */
  getVariable: (variable: string, window?: number) => number | null

  /**
   * Get a series of values for rolling calculations
   * @param variable - Variable name
   * @param window - Window for the base indicator
   * @param length - Number of historical values to retrieve
   * @returns Array of values (most recent last), or null if unavailable
   */
  getSeries: (variable: string, window: number, length: number) => number[] | null

  /**
   * Current evaluation index (for caching)
   */
  index: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Rolling Calculation Helpers
// ─────────────────────────────────────────────────────────────────────────────

function rollingSMA(values: number[], window: number): number | null {
  if (values.length < window) return null
  const slice = values.slice(-window)
  return slice.reduce((a, b) => a + b, 0) / window
}

function rollingEMA(values: number[], window: number): number | null {
  if (values.length < window) return null
  const alpha = 2 / (window + 1)
  let ema = values[0]
  for (let i = 1; i < values.length; i++) {
    ema = alpha * values[i] + (1 - alpha) * ema
  }
  return ema
}

function rollingStdev(values: number[], window: number): number | null {
  if (values.length < window) return null
  const slice = values.slice(-window)
  const mean = slice.reduce((a, b) => a + b, 0) / window
  const variance = slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / window
  return Math.sqrt(variance)
}

function rollingMax(values: number[], window: number): number | null {
  if (values.length < window) return null
  return Math.max(...values.slice(-window))
}

function rollingMin(values: number[], window: number): number | null {
  if (values.length < window) return null
  return Math.min(...values.slice(-window))
}

function rollingROC(values: number[], window: number): number | null {
  if (values.length < window + 1) return null
  const current = values[values.length - 1]
  const previous = values[values.length - 1 - window]
  if (previous === 0) return null
  return ((current - previous) / previous) * 100
}

// ─────────────────────────────────────────────────────────────────────────────
// Math Function Implementations
// ─────────────────────────────────────────────────────────────────────────────

function evalMathFunction(name: string, arg: number): number | null {
  switch (name) {
    case 'abs': return Math.abs(arg)
    case 'sqrt': return arg >= 0 ? Math.sqrt(arg) : null
    case 'log': return arg > 0 ? Math.log(arg) : null
    case 'log10': return arg > 0 ? Math.log10(arg) : null
    case 'exp': return Math.exp(arg)
    case 'sign': return Math.sign(arg)
    case 'floor': return Math.floor(arg)
    case 'ceil': return Math.ceil(arg)
    case 'round': return Math.round(arg)
    default: return null
  }
}

function evalBinaryFunction(name: string, a: number, b: number): number | null {
  switch (name) {
    case 'min': return Math.min(a, b)
    case 'max': return Math.max(a, b)
    case 'pow': return Math.pow(a, b)
    default: return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Evaluator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluate an AST node to produce a numeric result
 * @param node - The AST node to evaluate
 * @param ctx - Evaluation context providing variable access
 * @param defaultWindow - Default window to use for windowed variables
 * @returns The numeric result, or null if evaluation fails
 */
export function evaluateAST(
  node: ASTNode,
  ctx: FormulaEvalContext,
  defaultWindow: number = 20
): number | null {
  switch (node.type) {
    case 'Number':
      return node.value

    case 'Variable':
      return ctx.getVariable(node.name, defaultWindow)

    case 'BinaryOp': {
      const left = evaluateAST(node.left, ctx, defaultWindow)
      const right = evaluateAST(node.right, ctx, defaultWindow)
      if (left === null || right === null) return null

      switch (node.operator) {
        case '+': return left + right
        case '-': return left - right
        case '*': return left * right
        case '/': return right !== 0 ? left / right : null
        case '%': return right !== 0 ? left % right : null
        default: return null
      }
    }

    case 'UnaryOp': {
      const operand = evaluateAST(node.operand, ctx, defaultWindow)
      if (operand === null) return null
      return -operand
    }

    case 'FunctionCall':
      return evaluateFunctionCall(node, ctx, defaultWindow)

    default:
      return null
  }
}

/**
 * Evaluate a function call node
 */
function evaluateFunctionCall(
  node: FunctionCallNode,
  ctx: FormulaEvalContext,
  defaultWindow: number
): number | null {
  const { name, args } = node

  // Math functions (single argument)
  if (MATH_FUNCTIONS.includes(name)) {
    if (args.length !== 1) return null
    const arg = evaluateAST(args[0], ctx, defaultWindow)
    if (arg === null) return null
    return evalMathFunction(name, arg)
  }

  // Binary functions (two arguments)
  if (BINARY_FUNCTIONS.includes(name)) {
    if (args.length !== 2) return null
    const a = evaluateAST(args[0], ctx, defaultWindow)
    const b = evaluateAST(args[1], ctx, defaultWindow)
    if (a === null || b === null) return null
    return evalBinaryFunction(name, a, b)
  }

  // Rolling functions (variable + window)
  if (ROLLING_FUNCTIONS.includes(name)) {
    if (args.length !== 2) return null

    // First arg should be a variable or expression
    // Second arg must be a number (window)
    if (args[1].type !== 'Number') return null
    const window = args[1].value

    // Get the base variable name from first argument
    // For simple case: sma(close, 20) -> variable = 'close'
    // For complex case: sma(rsi, 14) -> need to evaluate rsi series
    const baseArg = args[0]

    if (baseArg.type === 'Variable') {
      // Simple case: get series directly
      const series = ctx.getSeries(baseArg.name, defaultWindow, Math.ceil(window) + 50)
      if (!series || series.length < window) return null

      switch (name) {
        case 'sma': return rollingSMA(series, Math.ceil(window))
        case 'ema': return rollingEMA(series, Math.ceil(window))
        case 'stdev': return rollingStdev(series, Math.ceil(window))
        case 'rmax': return rollingMax(series, Math.ceil(window))
        case 'rmin': return rollingMin(series, Math.ceil(window))
        case 'roc': return rollingROC(series, Math.ceil(window))
        default: return null
      }
    }

    // Complex case: need to evaluate expression for each historical point
    // This is more expensive but supports things like sma(rsi / 100, 20)
    // For now, return null for complex expressions in rolling functions
    // TODO: Implement series evaluation for complex expressions
    return null
  }

  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: Extract required lookback from AST
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate the maximum lookback period required by a formula
 * Used for warm-up period calculations
 */
export function getFormulaLookback(node: ASTNode): number {
  switch (node.type) {
    case 'Number':
    case 'Variable':
      return 0

    case 'BinaryOp':
      return Math.max(getFormulaLookback(node.left), getFormulaLookback(node.right))

    case 'UnaryOp':
      return getFormulaLookback(node.operand)

    case 'FunctionCall': {
      // Check if it's a rolling function with a window argument
      if (ROLLING_FUNCTIONS.includes(node.name) && node.args.length >= 2) {
        const windowArg = node.args[1]
        if (windowArg.type === 'Number') {
          // Rolling functions need their window plus some buffer
          return Math.ceil(windowArg.value) + 10
        }
      }

      // For other functions, recurse into arguments
      return Math.max(0, ...node.args.map(getFormulaLookback))
    }

    default:
      return 0
  }
}
