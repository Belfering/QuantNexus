/**
 * Tiingo Current Prices Fetcher
 *
 * Fetches real-time IEX prices from Tiingo API for live trading signals.
 * Used to append current prices as "today's close" to historical data before backtests.
 */

import { decrypt } from '../utils/crypto.mjs'
import { ensureDbInitialized } from '../features/bots/routes.mjs'
import * as database from '../db/index.mjs'

/**
 * Get Tiingo API key from database or environment
 */
async function getTiingoApiKey() {
  try {
    await ensureDbInitialized()
    const config = await database.getAdminConfig()
    if (config.tiingo_api_key) {
      const decrypted = decrypt(config.tiingo_api_key)
      if (decrypted) return decrypted
    }
  } catch {
    // Ignore errors, fall through to env var
  }
  return process.env.TIINGO_API_KEY || ''
}

/**
 * Fetch current IEX price for a single ticker from Tiingo
 * Falls back to EOD endpoint if IEX is unavailable
 *
 * @param {string} ticker - Ticker symbol
 * @param {string} apiKey - Tiingo API key
 * @returns {Promise<number|null>} Current price or null if unavailable
 */
async function fetchSinglePrice(ticker, apiKey) {
  try {
    // Try IEX endpoint for real-time price (works during market hours)
    const iexUrl = `https://api.tiingo.com/iex/${ticker}`
    const iexResponse = await fetch(iexUrl, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Token ${apiKey}`
      },
      signal: AbortSignal.timeout(10000) // 10 second timeout
    })

    if (iexResponse.ok) {
      const iexData = await iexResponse.json()
      if (iexData && Array.isArray(iexData) && iexData.length > 0) {
        const lastPrice = iexData[0]?.last
        if (lastPrice != null && lastPrice > 0) {
          return lastPrice
        }
      }
    }
  } catch (err) {
    console.log(`[tiingo-prices] [DEBUG] IEX failed for ${ticker}, falling back to EOD: ${err.message}`)
  }

  try {
    // Fall back to EOD endpoint for closing price
    const eodUrl = `https://api.tiingo.com/tiingo/daily/${ticker}/prices?startDate=2020-01-01`
    const eodResponse = await fetch(eodUrl, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Token ${apiKey}`
      },
      signal: AbortSignal.timeout(10000)
    })

    if (eodResponse.ok) {
      const eodData = await eodResponse.json()
      if (eodData && Array.isArray(eodData) && eodData.length > 0) {
        // Get most recent closing price
        const latest = eodData[eodData.length - 1]
        const closePrice = latest?.adjClose || latest?.close
        if (closePrice != null && closePrice > 0) {
          return closePrice
        }
      }
    }
  } catch (err) {
    console.warn(`[tiingo-prices] [DEBUG] EOD also failed for ${ticker}: ${err.message}`)
  }

  return null
}

/**
 * Fetch current prices for multiple tickers in batches
 *
 * @param {string[]} tickers - Array of ticker symbols
 * @param {Object} options - Options
 * @param {number} [options.maxConcurrent=5] - Max concurrent requests
 * @param {number} [options.batchDelay=100] - Delay between batches (ms)
 * @returns {Promise<Map<string, number>>} Map of ticker -> price
 */
export async function fetchTiingoCurrentPrices(tickers, options = {}) {
  const { maxConcurrent = 5, batchDelay = 100 } = options

  const perfStart = Date.now()
  console.log(`[tiingo-prices] [PERF] ===== STARTING TIINGO CURRENT PRICE FETCH =====`)
  console.log(`[tiingo-prices] [DEBUG] Fetching current prices for ${tickers.length} unique tickers`)
  console.log(`[tiingo-prices] [DEBUG] Tickers to fetch: ${tickers.join(', ')}`)

  const apiKey = await getTiingoApiKey()
  if (!apiKey) {
    console.warn('[tiingo-prices] [DEBUG] ❌ No Tiingo API key available, cannot fetch current prices')
    console.log('[tiingo-prices] [DEBUG] Checked: database config and TIINGO_API_KEY env var')
    return new Map()
  }

  console.log(`[tiingo-prices] [DEBUG] ✓ API key found (length: ${apiKey.length})`)

  const priceMap = new Map()
  const uniqueTickers = [...new Set(tickers.map(t => t.toUpperCase()))]

  console.log(`[tiingo-prices] [DEBUG] Processing ${uniqueTickers.length} unique tickers in batches of ${maxConcurrent}`)

  // Process in batches to avoid rate limiting
  for (let i = 0; i < uniqueTickers.length; i += maxConcurrent) {
    const batch = uniqueTickers.slice(i, i + maxConcurrent)
    const batchNum = Math.floor(i / maxConcurrent) + 1
    const totalBatches = Math.ceil(uniqueTickers.length / maxConcurrent)
    const batchStart = Date.now()

    console.log(`[tiingo-prices] [DEBUG] ===== Batch ${batchNum}/${totalBatches} =====`)
    console.log(`[tiingo-prices] [DEBUG] Tickers in batch: ${batch.join(', ')}`)

    const promises = batch.map(async (ticker) => {
      const tickerStart = Date.now()
      const price = await fetchSinglePrice(ticker, apiKey)
      const tickerElapsed = Date.now() - tickerStart

      if (price != null) {
        priceMap.set(ticker, price)
        console.log(`[tiingo-prices] [DEBUG]   ✓ ${ticker}: $${price.toFixed(2)} (${tickerElapsed}ms)`)
      } else {
        console.warn(`[tiingo-prices] [DEBUG]   ✗ ${ticker}: No price available (${tickerElapsed}ms)`)
      }
    })

    await Promise.all(promises)

    const batchElapsed = Date.now() - batchStart
    console.log(`[tiingo-prices] [PERF] Batch ${batchNum}/${totalBatches} completed in ${batchElapsed}ms (avg ${(batchElapsed / batch.length).toFixed(0)}ms per ticker)`)

    // Add delay between batches to avoid rate limiting (except for last batch)
    if (i + maxConcurrent < uniqueTickers.length && batchDelay > 0) {
      console.log(`[tiingo-prices] [DEBUG] Waiting ${batchDelay}ms before next batch...`)
      await new Promise(resolve => setTimeout(resolve, batchDelay))
    }
  }

  const perfTotal = Date.now() - perfStart
  const successRate = ((priceMap.size / uniqueTickers.length) * 100).toFixed(1)
  console.log(`[tiingo-prices] [PERF] ===== PRICE FETCH COMPLETE =====`)
  console.log(`[tiingo-prices] [PERF] Fetched ${priceMap.size}/${uniqueTickers.length} prices (${successRate}% success)`)
  console.log(`[tiingo-prices] [PERF] Total time: ${perfTotal}ms`)
  console.log(`[tiingo-prices] [PERF] Average time per ticker: ${(perfTotal / uniqueTickers.length).toFixed(0)}ms`)

  // Log all successfully fetched prices
  if (priceMap.size > 0) {
    console.log(`[tiingo-prices] [DEBUG] ===== SUCCESSFULLY FETCHED PRICES =====`)
    for (const [ticker, price] of priceMap.entries()) {
      console.log(`[tiingo-prices] [DEBUG] ${ticker}: $${price.toFixed(2)}`)
    }
  }

  return priceMap
}

/**
 * Append current prices to ticker data as "today's close"
 * Modifies the tickerData object in-place by adding current price row to each ticker
 *
 * @param {Object} tickerData - Ticker data object from backtest loader
 * @param {Map<string, number>} currentPrices - Map of ticker -> current price
 * @returns {Object} Modified tickerData with current prices appended
 */
export function appendCurrentPrices(tickerData, currentPrices) {
  if (!currentPrices || currentPrices.size === 0) {
    console.log('[tiingo-prices] [DEBUG] No current prices to append')
    return tickerData
  }

  const nowTimestamp = Math.floor(Date.now() / 1000) // Unix timestamp in seconds
  let appendedCount = 0

  for (const [ticker, price] of currentPrices.entries()) {
    const tickerUpper = ticker.toUpperCase()

    // Check if ticker exists in tickerData
    if (!tickerData.time || !tickerData.time[tickerUpper]) {
      console.warn(`[tiingo-prices] [DEBUG] Ticker ${tickerUpper} not in tickerData, skipping`)
      continue
    }

    // Append current price as new row (today's close)
    tickerData.time[tickerUpper].push(nowTimestamp)
    tickerData.open[tickerUpper].push(price)
    tickerData.high[tickerUpper].push(price)
    tickerData.low[tickerUpper].push(price)
    tickerData.close[tickerUpper].push(price)
    tickerData.adjClose[tickerUpper].push(price)

    appendedCount++
    console.log(`[tiingo-prices] [DEBUG] Appended current price for ${tickerUpper}: $${price.toFixed(2)}`)
  }

  console.log(`[tiingo-prices] [DEBUG] Appended current prices for ${appendedCount} tickers`)
  return tickerData
}
