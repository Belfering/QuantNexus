/**
 * FRD-003: Conditional Logic Validation Tests
 *
 * Tests for AND/IF and OR/IF boolean logic used in condition evaluation.
 *
 * The condition evaluation logic follows standard boolean precedence:
 * - AND binds tighter than OR
 * - Example: `A OR B AND C` evaluates as `A OR (B AND C)`
 *
 * Condition types:
 * - 'if': Starts a new condition chain
 * - 'and': Logical AND with previous condition
 * - 'or': Logical OR with previous AND-chain, starts new AND-chain
 */

import { describe, test, expect } from 'vitest'

/**
 * Pure function that evaluates condition results using the same logic as backtest.mjs
 * This is extracted from the evaluateConditions function for testing purposes.
 *
 * @param conditionResults - Array of {value: boolean | null, type: 'if' | 'and' | 'or'}
 * @returns boolean | null (null if any condition is null)
 */
function evaluateConditionResults(conditionResults: Array<{ value: boolean | null; type: 'if' | 'and' | 'or' }>): boolean | null {
  if (!conditionResults || conditionResults.length === 0) return false

  const normalizeConditionType = (t: string, fallback = 'and') => {
    if (t === 'if' || t === 'and' || t === 'or') return t
    return fallback
  }

  // Standard boolean precedence: AND binds tighter than OR.
  // Example: `A or B and C` => `A || (B && C)`.
  let currentAnd: boolean | null = null
  const orTerms: boolean[] = []

  for (const c of conditionResults) {
    const v = c.value
    if (v == null) return null // null propagates
    const t = normalizeConditionType(c.type, 'and')

    if (t === 'if') {
      if (currentAnd !== null) orTerms.push(currentAnd)
      currentAnd = v
      continue
    }

    if (currentAnd === null) {
      currentAnd = v
      continue
    }

    if (t === 'and') {
      currentAnd = currentAnd && v
      continue
    }

    if (t === 'or') {
      orTerms.push(currentAnd)
      currentAnd = v
      continue
    }

    currentAnd = v
  }

  if (currentAnd !== null) orTerms.push(currentAnd)
  return orTerms.some(Boolean)
}

describe('Condition Logic - Basic AND/OR', () => {
  test('single true condition returns true', () => {
    expect(evaluateConditionResults([
      { value: true, type: 'if' }
    ])).toBe(true)
  })

  test('single false condition returns false', () => {
    expect(evaluateConditionResults([
      { value: false, type: 'if' }
    ])).toBe(false)
  })

  test('empty conditions returns false', () => {
    expect(evaluateConditionResults([])).toBe(false)
  })

  test('null condition propagates null', () => {
    expect(evaluateConditionResults([
      { value: null, type: 'if' }
    ])).toBe(null)
  })
})

describe('Condition Logic - AND operations', () => {
  test('true AND true = true', () => {
    expect(evaluateConditionResults([
      { value: true, type: 'if' },
      { value: true, type: 'and' }
    ])).toBe(true)
  })

  test('true AND false = false', () => {
    expect(evaluateConditionResults([
      { value: true, type: 'if' },
      { value: false, type: 'and' }
    ])).toBe(false)
  })

  test('false AND true = false', () => {
    expect(evaluateConditionResults([
      { value: false, type: 'if' },
      { value: true, type: 'and' }
    ])).toBe(false)
  })

  test('false AND false = false', () => {
    expect(evaluateConditionResults([
      { value: false, type: 'if' },
      { value: false, type: 'and' }
    ])).toBe(false)
  })

  test('true AND true AND true = true', () => {
    expect(evaluateConditionResults([
      { value: true, type: 'if' },
      { value: true, type: 'and' },
      { value: true, type: 'and' }
    ])).toBe(true)
  })

  test('true AND true AND false = false', () => {
    expect(evaluateConditionResults([
      { value: true, type: 'if' },
      { value: true, type: 'and' },
      { value: false, type: 'and' }
    ])).toBe(false)
  })

  test('null in AND chain propagates null', () => {
    expect(evaluateConditionResults([
      { value: true, type: 'if' },
      { value: null, type: 'and' }
    ])).toBe(null)
  })
})

describe('Condition Logic - OR operations', () => {
  test('true OR true = true', () => {
    expect(evaluateConditionResults([
      { value: true, type: 'if' },
      { value: true, type: 'or' }
    ])).toBe(true)
  })

  test('true OR false = true', () => {
    expect(evaluateConditionResults([
      { value: true, type: 'if' },
      { value: false, type: 'or' }
    ])).toBe(true)
  })

  test('false OR true = true', () => {
    expect(evaluateConditionResults([
      { value: false, type: 'if' },
      { value: true, type: 'or' }
    ])).toBe(true)
  })

  test('false OR false = false', () => {
    expect(evaluateConditionResults([
      { value: false, type: 'if' },
      { value: false, type: 'or' }
    ])).toBe(false)
  })

  test('false OR false OR true = true', () => {
    expect(evaluateConditionResults([
      { value: false, type: 'if' },
      { value: false, type: 'or' },
      { value: true, type: 'or' }
    ])).toBe(true)
  })

  test('null in OR chain propagates null', () => {
    expect(evaluateConditionResults([
      { value: true, type: 'if' },
      { value: null, type: 'or' }
    ])).toBe(null)
  })
})

describe('Condition Logic - Mixed AND/OR with Precedence', () => {
  // Standard boolean precedence: AND binds tighter than OR
  // A OR B AND C = A OR (B AND C)

  test('true OR true AND true = true (A || (B && C))', () => {
    // A=true, B=true, C=true => true || (true && true) = true || true = true
    expect(evaluateConditionResults([
      { value: true, type: 'if' },   // A
      { value: true, type: 'or' },   // B (starts new AND chain after OR)
      { value: true, type: 'and' }   // C
    ])).toBe(true)
  })

  test('false OR true AND true = true (A || (B && C))', () => {
    // A=false, B=true, C=true => false || (true && true) = false || true = true
    expect(evaluateConditionResults([
      { value: false, type: 'if' },  // A
      { value: true, type: 'or' },   // B
      { value: true, type: 'and' }   // C
    ])).toBe(true)
  })

  test('false OR true AND false = false (A || (B && C))', () => {
    // A=false, B=true, C=false => false || (true && false) = false || false = false
    expect(evaluateConditionResults([
      { value: false, type: 'if' },  // A
      { value: true, type: 'or' },   // B
      { value: false, type: 'and' }  // C
    ])).toBe(false)
  })

  test('true OR false AND false = true (A || (B && C))', () => {
    // A=true, B=false, C=false => true || (false && false) = true || false = true
    expect(evaluateConditionResults([
      { value: true, type: 'if' },   // A
      { value: false, type: 'or' },  // B
      { value: false, type: 'and' }  // C
    ])).toBe(true)
  })

  test('false OR false AND true = false (A || (B && C))', () => {
    // A=false, B=false, C=true => false || (false && true) = false || false = false
    expect(evaluateConditionResults([
      { value: false, type: 'if' },  // A
      { value: false, type: 'or' },  // B
      { value: true, type: 'and' }   // C
    ])).toBe(false)
  })

  test('true AND false OR true = true ((A && B) || C)', () => {
    // A=true, B=false, C=true => (true && false) || true = false || true = true
    expect(evaluateConditionResults([
      { value: true, type: 'if' },   // A
      { value: false, type: 'and' }, // B
      { value: true, type: 'or' }    // C (starts new term)
    ])).toBe(true)
  })

  test('true AND false OR false = false ((A && B) || C)', () => {
    // A=true, B=false, C=false => (true && false) || false = false || false = false
    expect(evaluateConditionResults([
      { value: true, type: 'if' },   // A
      { value: false, type: 'and' }, // B
      { value: false, type: 'or' }   // C
    ])).toBe(false)
  })

  test('false AND true OR true = true ((A && B) || C)', () => {
    // A=false, B=true, C=true => (false && true) || true = false || true = true
    expect(evaluateConditionResults([
      { value: false, type: 'if' },  // A
      { value: true, type: 'and' },  // B
      { value: true, type: 'or' }    // C
    ])).toBe(true)
  })
})

describe('Condition Logic - Complex nested expressions', () => {
  test('A AND B OR C AND D (simple case all true)', () => {
    // (A && B) || (C && D) where all true
    expect(evaluateConditionResults([
      { value: true, type: 'if' },   // A
      { value: true, type: 'and' },  // B
      { value: true, type: 'or' },   // C
      { value: true, type: 'and' }   // D
    ])).toBe(true)
  })

  test('A AND B OR C AND D where first AND-chain false, second true', () => {
    // (false && true) || (true && true) = false || true = true
    expect(evaluateConditionResults([
      { value: false, type: 'if' },  // A
      { value: true, type: 'and' },  // B
      { value: true, type: 'or' },   // C
      { value: true, type: 'and' }   // D
    ])).toBe(true)
  })

  test('A AND B OR C AND D where both AND-chains false', () => {
    // (true && false) || (true && false) = false || false = false
    expect(evaluateConditionResults([
      { value: true, type: 'if' },   // A
      { value: false, type: 'and' }, // B
      { value: true, type: 'or' },   // C
      { value: false, type: 'and' }  // D
    ])).toBe(false)
  })

  test('A OR B OR C (three OR terms)', () => {
    // false || false || true = true
    expect(evaluateConditionResults([
      { value: false, type: 'if' },
      { value: false, type: 'or' },
      { value: true, type: 'or' }
    ])).toBe(true)
  })

  test('A AND B AND C OR D (long AND chain followed by OR)', () => {
    // (true && true && false) || true = false || true = true
    expect(evaluateConditionResults([
      { value: true, type: 'if' },   // A
      { value: true, type: 'and' },  // B
      { value: false, type: 'and' }, // C
      { value: true, type: 'or' }    // D
    ])).toBe(true)
  })

  test('A OR B AND C AND D (OR followed by long AND chain)', () => {
    // false || (true && true && true) = false || true = true
    expect(evaluateConditionResults([
      { value: false, type: 'if' },  // A
      { value: true, type: 'or' },   // B (starts AND chain)
      { value: true, type: 'and' },  // C
      { value: true, type: 'and' }   // D
    ])).toBe(true)
  })

  test('A OR B AND C AND D where AND chain is false', () => {
    // false || (true && false && true) = false || false = false
    expect(evaluateConditionResults([
      { value: false, type: 'if' },  // A
      { value: true, type: 'or' },   // B
      { value: false, type: 'and' }, // C (breaks the chain)
      { value: true, type: 'and' }   // D
    ])).toBe(false)
  })
})

describe('Condition Logic - IF type handling', () => {
  // 'if' type starts a new condition, similar to first condition in chain

  test('IF starts a new chain after existing chain', () => {
    // if A, if B => each 'if' starts fresh, result should be B
    // But our logic pushes previous AND chain to orTerms on 'if'
    // So: if true, if false => orTerms=[true], currentAnd=false => true || false = true
    expect(evaluateConditionResults([
      { value: true, type: 'if' },
      { value: false, type: 'if' }
    ])).toBe(true)
  })

  test('IF after AND chain pushes chain to OR terms', () => {
    // if true AND false, if true => (true && false) pushed, then true
    // orTerms=[false], currentAnd=true => false || true = true
    expect(evaluateConditionResults([
      { value: true, type: 'if' },
      { value: false, type: 'and' },
      { value: true, type: 'if' }
    ])).toBe(true)
  })
})
