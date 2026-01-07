// src/features/backtest/engine/formulaParser.ts
// Formula parser for custom indicators (FRD-035)
// Converts formula strings like "rsi / 100" or "sma(close, 20) / ema(close, 50)" into AST

// ─────────────────────────────────────────────────────────────────────────────
// Token Types
// ─────────────────────────────────────────────────────────────────────────────

export type TokenType =
  | 'NUMBER'
  | 'IDENTIFIER'
  | 'OPERATOR'
  | 'LPAREN'
  | 'RPAREN'
  | 'COMMA'
  | 'EOF'

export interface Token {
  type: TokenType
  value: string
  position: number
}

// ─────────────────────────────────────────────────────────────────────────────
// AST Node Types
// ─────────────────────────────────────────────────────────────────────────────

export type ASTNodeType =
  | 'Number'
  | 'Variable'
  | 'BinaryOp'
  | 'UnaryOp'
  | 'FunctionCall'

export interface NumberNode {
  type: 'Number'
  value: number
}

export interface VariableNode {
  type: 'Variable'
  name: string
}

export interface BinaryOpNode {
  type: 'BinaryOp'
  operator: '+' | '-' | '*' | '/' | '%'
  left: ASTNode
  right: ASTNode
}

export interface UnaryOpNode {
  type: 'UnaryOp'
  operator: '-'
  operand: ASTNode
}

export interface FunctionCallNode {
  type: 'FunctionCall'
  name: string
  args: ASTNode[]
}

export type ASTNode =
  | NumberNode
  | VariableNode
  | BinaryOpNode
  | UnaryOpNode
  | FunctionCallNode

// ─────────────────────────────────────────────────────────────────────────────
// Supported Functions
// ─────────────────────────────────────────────────────────────────────────────

// Math functions (single argument)
export const MATH_FUNCTIONS = ['abs', 'sqrt', 'log', 'log10', 'exp', 'sign', 'floor', 'ceil', 'round']

// Comparison/selection functions (two arguments)
export const BINARY_FUNCTIONS = ['min', 'max', 'pow']

// Rolling functions (variable + window)
export const ROLLING_FUNCTIONS = ['sma', 'ema', 'stdev', 'rmax', 'rmin', 'roc']

export const ALL_FUNCTIONS = [...MATH_FUNCTIONS, ...BINARY_FUNCTIONS, ...ROLLING_FUNCTIONS]

// ─────────────────────────────────────────────────────────────────────────────
// Tokenizer
// ─────────────────────────────────────────────────────────────────────────────

export class Tokenizer {
  private input: string
  private position: number = 0
  private tokens: Token[] = []

  constructor(input: string) {
    this.input = input.trim()
  }

  tokenize(): Token[] {
    while (this.position < this.input.length) {
      this.skipWhitespace()
      if (this.position >= this.input.length) break

      const char = this.input[this.position]

      // Numbers (including decimals)
      if (this.isDigit(char) || (char === '.' && this.isDigit(this.peek(1)))) {
        this.readNumber()
        continue
      }

      // Identifiers (variables and functions)
      if (this.isAlpha(char) || char === '_') {
        this.readIdentifier()
        continue
      }

      // Operators
      if ('+-*/%'.includes(char)) {
        this.tokens.push({ type: 'OPERATOR', value: char, position: this.position })
        this.position++
        continue
      }

      // Parentheses
      if (char === '(') {
        this.tokens.push({ type: 'LPAREN', value: char, position: this.position })
        this.position++
        continue
      }
      if (char === ')') {
        this.tokens.push({ type: 'RPAREN', value: char, position: this.position })
        this.position++
        continue
      }

      // Comma
      if (char === ',') {
        this.tokens.push({ type: 'COMMA', value: char, position: this.position })
        this.position++
        continue
      }

      throw new Error(`Unexpected character '${char}' at position ${this.position}`)
    }

    this.tokens.push({ type: 'EOF', value: '', position: this.position })
    return this.tokens
  }

  private skipWhitespace(): void {
    while (this.position < this.input.length && /\s/.test(this.input[this.position])) {
      this.position++
    }
  }

  private isDigit(char: string): boolean {
    return /[0-9]/.test(char)
  }

  private isAlpha(char: string): boolean {
    return /[a-zA-Z]/.test(char)
  }

  private isAlphaNumeric(char: string): boolean {
    return /[a-zA-Z0-9_]/.test(char)
  }

  private peek(offset: number = 0): string {
    return this.input[this.position + offset] || ''
  }

  private readNumber(): void {
    const start = this.position
    let hasDecimal = false

    while (this.position < this.input.length) {
      const char = this.input[this.position]
      if (this.isDigit(char)) {
        this.position++
      } else if (char === '.' && !hasDecimal) {
        hasDecimal = true
        this.position++
      } else {
        break
      }
    }

    this.tokens.push({
      type: 'NUMBER',
      value: this.input.slice(start, this.position),
      position: start,
    })
  }

  private readIdentifier(): void {
    const start = this.position
    while (this.position < this.input.length && this.isAlphaNumeric(this.input[this.position])) {
      this.position++
    }

    this.tokens.push({
      type: 'IDENTIFIER',
      value: this.input.slice(start, this.position),
      position: start,
    })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser (Recursive Descent)
// ─────────────────────────────────────────────────────────────────────────────

export class Parser {
  private tokens: Token[]
  private position: number = 0

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  parse(): ASTNode {
    const ast = this.parseExpression()
    if (this.current().type !== 'EOF') {
      throw new Error(`Unexpected token '${this.current().value}' at position ${this.current().position}`)
    }
    return ast
  }

  private current(): Token {
    return this.tokens[this.position] || { type: 'EOF', value: '', position: -1 }
  }

  private advance(): Token {
    const token = this.current()
    this.position++
    return token
  }

  private expect(type: TokenType): Token {
    const token = this.current()
    if (token.type !== type) {
      throw new Error(`Expected ${type} but got ${token.type} at position ${token.position}`)
    }
    return this.advance()
  }

  // Expression = Term (('+' | '-') Term)*
  private parseExpression(): ASTNode {
    let left = this.parseTerm()

    while (this.current().type === 'OPERATOR' && (this.current().value === '+' || this.current().value === '-')) {
      const operator = this.advance().value as '+' | '-'
      const right = this.parseTerm()
      left = { type: 'BinaryOp', operator, left, right }
    }

    return left
  }

  // Term = Factor (('*' | '/' | '%') Factor)*
  private parseTerm(): ASTNode {
    let left = this.parseFactor()

    while (this.current().type === 'OPERATOR' && ('*/%'.includes(this.current().value))) {
      const operator = this.advance().value as '*' | '/' | '%'
      const right = this.parseFactor()
      left = { type: 'BinaryOp', operator, left, right }
    }

    return left
  }

  // Factor = UnaryOp | Primary
  private parseFactor(): ASTNode {
    // Unary minus
    if (this.current().type === 'OPERATOR' && this.current().value === '-') {
      this.advance()
      const operand = this.parseFactor()
      return { type: 'UnaryOp', operator: '-', operand }
    }

    return this.parsePrimary()
  }

  // Primary = Number | FunctionCall | Variable | '(' Expression ')'
  private parsePrimary(): ASTNode {
    const token = this.current()

    // Number literal
    if (token.type === 'NUMBER') {
      this.advance()
      return { type: 'Number', value: parseFloat(token.value) }
    }

    // Identifier (variable or function call)
    if (token.type === 'IDENTIFIER') {
      const name = this.advance().value

      // Check if it's a function call
      if (this.current().type === 'LPAREN') {
        this.advance() // consume '('
        const args: ASTNode[] = []

        // Parse arguments
        if (this.current().type !== 'RPAREN') {
          args.push(this.parseExpression())
          while (this.current().type === 'COMMA') {
            this.advance() // consume ','
            args.push(this.parseExpression())
          }
        }

        this.expect('RPAREN')
        return { type: 'FunctionCall', name: name.toLowerCase(), args }
      }

      // It's a variable reference
      return { type: 'Variable', name: name.toLowerCase() }
    }

    // Parenthesized expression
    if (token.type === 'LPAREN') {
      this.advance()
      const expr = this.parseExpression()
      this.expect('RPAREN')
      return expr
    }

    throw new Error(`Unexpected token '${token.value}' at position ${token.position}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Validator
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean
  errors: string[]
  variables: string[] // Variables referenced in the formula
  functions: string[] // Functions used in the formula
}

export function validateAST(ast: ASTNode, knownVariables: Set<string>): ValidationResult {
  const errors: string[] = []
  const variables: string[] = []
  const functions: string[] = []

  function visit(node: ASTNode): void {
    switch (node.type) {
      case 'Number':
        // Numbers are always valid
        break

      case 'Variable':
        variables.push(node.name)
        if (!knownVariables.has(node.name)) {
          errors.push(`Unknown variable: '${node.name}'`)
        }
        break

      case 'BinaryOp':
        visit(node.left)
        visit(node.right)
        break

      case 'UnaryOp':
        visit(node.operand)
        break

      case 'FunctionCall':
        functions.push(node.name)

        // Validate function name
        if (!ALL_FUNCTIONS.includes(node.name)) {
          errors.push(`Unknown function: '${node.name}'`)
        }

        // Validate argument count
        if (MATH_FUNCTIONS.includes(node.name)) {
          if (node.args.length !== 1) {
            errors.push(`Function '${node.name}' expects 1 argument, got ${node.args.length}`)
          }
        } else if (BINARY_FUNCTIONS.includes(node.name)) {
          if (node.args.length !== 2) {
            errors.push(`Function '${node.name}' expects 2 arguments, got ${node.args.length}`)
          }
        } else if (ROLLING_FUNCTIONS.includes(node.name)) {
          if (node.args.length !== 2) {
            errors.push(`Rolling function '${node.name}' expects 2 arguments (variable, window), got ${node.args.length}`)
          }
          // Second argument must be a number for rolling functions
          if (node.args.length >= 2 && node.args[1].type !== 'Number') {
            errors.push(`Rolling function '${node.name}' window must be a number`)
          }
        }

        // Recursively validate arguments
        for (const arg of node.args) {
          visit(arg)
        }
        break
    }
  }

  visit(ast)

  return {
    valid: errors.length === 0,
    errors,
    variables: [...new Set(variables)],
    functions: [...new Set(functions)],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Parse Function
// ─────────────────────────────────────────────────────────────────────────────

export interface ParseResult {
  ast: ASTNode | null
  valid: boolean
  errors: string[]
  variables: string[]
  functions: string[]
}

export function parseFormula(formula: string, knownVariables: Set<string>): ParseResult {
  try {
    const tokenizer = new Tokenizer(formula)
    const tokens = tokenizer.tokenize()
    const parser = new Parser(tokens)
    const ast = parser.parse()
    const validation = validateAST(ast, knownVariables)

    return {
      ast: validation.valid ? ast : null,
      valid: validation.valid,
      errors: validation.errors,
      variables: validation.variables,
      functions: validation.functions,
    }
  } catch (e) {
    return {
      ast: null,
      valid: false,
      errors: [(e as Error).message],
      variables: [],
      functions: [],
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AST to String (for debugging)
// ─────────────────────────────────────────────────────────────────────────────

export function astToString(node: ASTNode): string {
  switch (node.type) {
    case 'Number':
      return String(node.value)
    case 'Variable':
      return node.name
    case 'BinaryOp':
      return `(${astToString(node.left)} ${node.operator} ${astToString(node.right)})`
    case 'UnaryOp':
      return `(-${astToString(node.operand)})`
    case 'FunctionCall':
      return `${node.name}(${node.args.map(astToString).join(', ')})`
  }
}
