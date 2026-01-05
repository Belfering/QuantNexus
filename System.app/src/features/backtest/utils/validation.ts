// src/features/backtest/utils/validation.ts
// Validation error helpers for backtest

import type { BacktestError } from '@/types'

/**
 * Custom error type for backtest validation errors that contains structured BacktestError data.
 * This is different from the shared ValidationError which uses string[] errors.
 */
export type BacktestValidationError = Error & { type: 'validation'; errors: BacktestError[] }

/**
 * Create a backtest validation error with structured error data
 */
export const makeBacktestValidationError = (errors: BacktestError[]): BacktestValidationError =>
  Object.assign(new Error('validation'), { type: 'validation' as const, errors })

/**
 * Type guard to check if an error is a BacktestValidationError
 */
export const isBacktestValidationError = (e: unknown): e is BacktestValidationError =>
  typeof e === 'object' && e !== null && (e as { type?: unknown }).type === 'validation' && Array.isArray((e as { errors?: unknown }).errors)
