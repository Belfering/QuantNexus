// src/constants/config.ts
// Application configuration constants

// API endpoint base path
export const API_BASE = '/api'

// Datalist element IDs
export const TICKER_DATALIST_ID = 'systemapp-tickers'
export const USED_TICKERS_DATALIST_ID = 'findreplace-used-tickers'

// Local storage keys
export const CURRENT_USER_KEY = 'systemapp.currentUser'
export const userDataKey = (userId: string) => `systemapp.user.${userId}.data.v1`

// Cache TTL (5 minutes in milliseconds)
export const OHLC_CACHE_TTL = 5 * 60 * 1000

// Popular tickers for autocomplete suggestions
export const POPULAR_TICKERS = [
  'SPY', 'QQQ', 'IWM', 'DIA', 'VTI',
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA',
  'TSLA', 'META', 'BRK-B', 'UNH', 'JPM',
  'GLD', 'TLT', 'BND', 'VNQ', 'Empty'
]
