/**
 * Price Authority Module
 *
 * Fetches current prices with three-tier fallback system:
 * - Primary: Tiingo real-time IEX prices
 * - Fallback: Alpaca SIP prices (with degraded data flag)
 * - Emergency: No price available (position skipped)
 *
 * Philosophy: "A bad trade is better than no trade" - prioritizing continuity over precision.
 */

import { fetchTiingoCurrentPrices } from './tiingo-prices.mjs'
import { getLatestPrices } from './broker-alpaca.mjs'

/**
 * Fetch current prices with automatic fallback
 *
 * @param {string[]} tickers - Array of ticker symbols
 * @param {Object} options - Configuration options
 * @param {Object} [options.alpacaClient] - Alpaca client for fallback (required if enableAlpacaFallback is true)
 * @param {boolean} [options.enableAlpacaFallback=true] - Enable Alpaca fallback when Tiingo fails
 * @param {number} [options.tiingoMaxConcurrent=5] - Max concurrent Tiingo requests
 * @param {number} [options.tiingoBatchDelay=100] - Delay between Tiingo batches (ms)
 * @param {boolean} [options.logDegradedMode=true] - Log warnings when using fallback
 *
 * @returns {Promise<{prices: Map<string, number>, metadata: Map<string, Object>}>}
 */
export async function fetchCurrentPrices(tickers, options = {}) {
  const {
    alpacaClient,
    enableAlpacaFallback = true,
    tiingoMaxConcurrent = 5,
    tiingoBatchDelay = 100,
    logDegradedMode = true,
  } = options

  const prices = new Map()
  const metadata = new Map()
  const failedTickers = []

  console.log(`[price-authority] Fetching prices for ${tickers.length} tickers`)

  // STEP 1: Try Tiingo for all tickers (primary source)
  try {
    const tiingoPrices = await fetchTiingoCurrentPrices(tickers, {
      maxConcurrent: tiingoMaxConcurrent,
      batchDelay: tiingoBatchDelay,
    })

    for (const ticker of tickers) {
      const price = tiingoPrices.get(ticker)
      if (price != null) {
        prices.set(ticker, price)
        metadata.set(ticker, {
          price,
          source: 'tiingo-iex', // Note: Could enhance to distinguish IEX vs EOD
          confidence: 'primary',
          timestamp: new Date(),
        })
      } else {
        failedTickers.push(ticker)
      }
    }
  } catch (error) {
    console.error(`[price-authority] Tiingo batch fetch failed: ${error.message}`)
    // All tickers failed - add them all to failedTickers
    failedTickers.push(...tickers.filter(t => !prices.has(t)))
  }

  // STEP 2: Fallback to Alpaca for failed tickers
  if (failedTickers.length > 0) {
    if (enableAlpacaFallback && alpacaClient) {
      if (logDegradedMode) {
        console.warn(`[price-authority] Tiingo failed for ${failedTickers.length} ticker(s), falling back to Alpaca`)
        console.warn(`[price-authority] Failed tickers: ${failedTickers.join(', ')}`)
      }

      try {
        const alpacaPrices = await getLatestPrices(alpacaClient, failedTickers)

        for (const ticker of failedTickers) {
          const price = alpacaPrices[ticker]
          if (price != null) {
            prices.set(ticker, price)
            metadata.set(ticker, {
              price,
              source: 'alpaca-realtime', // Note: Could distinguish realtime vs daily
              confidence: 'fallback',
              timestamp: new Date(),
            })
          } else {
            // Emergency mode: no price available from either source
            metadata.set(ticker, {
              price: null,
              source: 'none',
              confidence: 'emergency',
              timestamp: new Date(),
              error: 'Both Tiingo and Alpaca failed',
            })
          }
        }
      } catch (error) {
        console.error(`[price-authority] Alpaca fallback failed: ${error.message}`)
        // Mark all failed tickers as emergency
        for (const ticker of failedTickers) {
          if (!metadata.has(ticker)) {
            metadata.set(ticker, {
              price: null,
              source: 'none',
              confidence: 'emergency',
              timestamp: new Date(),
              error: `Alpaca fallback error: ${error.message}`,
            })
          }
        }
      }
    } else {
      // Alpaca fallback disabled or no client provided
      const reason = !enableAlpacaFallback
        ? 'Alpaca fallback disabled'
        : 'No Alpaca client provided'

      for (const ticker of failedTickers) {
        metadata.set(ticker, {
          price: null,
          source: 'none',
          confidence: 'emergency',
          timestamp: new Date(),
          error: `Tiingo failed, ${reason}`,
        })
      }
    }
  }

  // STEP 3: Log summary statistics
  const primaryCount = Array.from(metadata.values()).filter(m => m.confidence === 'primary').length
  const fallbackCount = Array.from(metadata.values()).filter(m => m.confidence === 'fallback').length
  const emergencyCount = Array.from(metadata.values()).filter(m => m.confidence === 'emergency').length

  console.log(`[price-authority] Price sources: ${primaryCount} Tiingo, ${fallbackCount} Alpaca, ${emergencyCount} unavailable`)

  if (fallbackCount > 0 && logDegradedMode) {
    console.warn(`[price-authority] ⚠️  DEGRADED MODE: ${fallbackCount} prices from Alpaca fallback`)
  }

  if (emergencyCount > 0) {
    console.error(`[price-authority] 🚨 EMERGENCY: ${emergencyCount} ticker(s) have no price data - positions will be skipped`)
  }

  return { prices, metadata }
}

/**
 * Get metadata summary for API responses
 *
 * @param {Map<string, Object>} metadata - Metadata map from fetchCurrentPrices
 * @returns {Object} Summary object for frontend display
 */
export function getMetadataSummary(metadata) {
  const values = Array.from(metadata.values())

  return {
    primaryCount: values.filter(m => m.confidence === 'primary').length,
    fallbackCount: values.filter(m => m.confidence === 'fallback').length,
    emergencyCount: values.filter(m => m.confidence === 'emergency').length,
    degradedMode: values.some(m => m.confidence === 'fallback'),
    totalTickers: metadata.size,
  }
}
