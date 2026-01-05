/**
 * Shared validation utilities.
 */

/**
 * Check if a value is a valid number (finite and not NaN).
 */
export const isValidNumber = (v: unknown): v is number => {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * Check if a string is a valid ticker symbol.
 */
export const isValidTicker = (ticker: string): boolean => {
  if (!ticker || typeof ticker !== 'string') return false
  // Ticker should be 1-10 uppercase letters, optionally with numbers
  return /^[A-Z][A-Z0-9]{0,9}$/.test(ticker.toUpperCase())
}

/**
 * Check if a string is a valid email address.
 */
export const isValidEmail = (email: string): boolean => {
  if (!email || typeof email !== 'string') return false
  // Basic email validation
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

/**
 * Check if a value is a non-empty string.
 */
export const isNonEmptyString = (v: unknown): v is string => {
  return typeof v === 'string' && v.trim().length > 0
}

/**
 * Clamp a number between min and max values.
 */
export const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max)
}

/**
 * Parse a percentage string to a decimal (e.g., "12.34%" → 0.1234).
 */
export const parsePercentage = (str: string): number | null => {
  const match = str.match(/^(-?\d+(?:\.\d+)?)\s*%?$/)
  if (!match) return null
  return parseFloat(match[1]) / 100
}

/**
 * Parse a currency string to a number (e.g., "$1,234.56" → 1234.56).
 */
export const parseCurrency = (str: string): number | null => {
  const cleaned = str.replace(/[$,]/g, '')
  const num = parseFloat(cleaned)
  return Number.isFinite(num) ? num : null
}

/**
 * Validation error type for structured error handling.
 */
export interface ValidationError extends Error {
  type: 'validation'
  errors: string[]
}

/**
 * Create a validation error with multiple error messages.
 */
export const createValidationError = (errors: string[]): ValidationError =>
  Object.assign(new Error('validation'), { type: 'validation' as const, errors })

/**
 * Check if an error is a validation error.
 */
export const isValidationError = (e: unknown): e is ValidationError =>
  typeof e === 'object' &&
  e !== null &&
  (e as { type?: unknown }).type === 'validation' &&
  Array.isArray((e as { errors?: unknown }).errors)
