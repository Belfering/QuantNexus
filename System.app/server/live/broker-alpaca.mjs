/**
 * Alpaca Broker Integration
 *
 * Handles connection to Alpaca Trade API for:
 * - Account information (equity, cash, buying power)
 * - Current positions
 * - Real-time quotes
 * - Order submission (for live trading)
 */

import Alpaca from '@alpacahq/alpaca-trade-api'

/**
 * Create an Alpaca API client from credentials
 * @param {Object} credentials - { apiKey, apiSecret, baseUrl, isPaper }
 * @returns {Alpaca} Alpaca API client instance
 */
export function createAlpacaClient(credentials) {
  const { apiKey, apiSecret, baseUrl, isPaper } = credentials

  return new Alpaca({
    keyId: apiKey,
    secretKey: apiSecret,
    paper: isPaper !== false, // Default to paper trading
    baseUrl: baseUrl || (isPaper !== false
      ? 'https://paper-api.alpaca.markets'
      : 'https://api.alpaca.markets'),
  })
}

/**
 * Test connection to Alpaca and return account info
 * @param {Alpaca} client - Alpaca client instance
 * @returns {Promise<Object>} Account information
 */
export async function testConnection(client) {
  try {
    const account = await client.getAccount()
    return {
      success: true,
      account: {
        id: account.id,
        status: account.status,
        equity: parseFloat(account.equity),
        cash: parseFloat(account.cash),
        buyingPower: parseFloat(account.buying_power),
        portfolioValue: parseFloat(account.portfolio_value),
        currency: account.currency,
        tradingBlocked: account.trading_blocked,
        transfersBlocked: account.transfers_blocked,
        accountBlocked: account.account_blocked,
        patternDayTrader: account.pattern_day_trader,
        daytradingBuyingPower: parseFloat(account.daytrading_buying_power),
      }
    }
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Failed to connect to Alpaca',
    }
  }
}

/**
 * Get current account status
 * @param {Alpaca} client - Alpaca client instance
 * @returns {Promise<Object>} Account details
 */
export async function getAccountInfo(client) {
  const account = await client.getAccount()
  return {
    equity: parseFloat(account.equity),
    cash: parseFloat(account.cash),
    buyingPower: parseFloat(account.buying_power),
    portfolioValue: parseFloat(account.portfolio_value),
    status: account.status,
  }
}

/**
 * Get all current positions
 * @param {Alpaca} client - Alpaca client instance
 * @returns {Promise<Array>} Array of positions
 */
export async function getPositions(client) {
  const positions = await client.getPositions()
  return positions.map(pos => ({
    symbol: pos.symbol,
    qty: parseFloat(pos.qty),
    avgEntryPrice: parseFloat(pos.avg_entry_price),
    marketValue: parseFloat(pos.market_value),
    costBasis: parseFloat(pos.cost_basis),
    unrealizedPl: parseFloat(pos.unrealized_pl),
    unrealizedPlPc: parseFloat(pos.unrealized_plpc),
    currentPrice: parseFloat(pos.current_price),
    side: pos.side,
  }))
}

/**
 * Get latest trade price for a ticker
 * @param {Alpaca} client - Alpaca client instance
 * @param {string} symbol - Ticker symbol
 * @returns {Promise<number>} Latest trade price
 */
export async function getLatestPrice(client, symbol) {
  try {
    const trade = await client.getLatestTrade(symbol)
    return trade.Price
  } catch (error) {
    // Fallback to daily bar
    try {
      const bars = await client.getBarsV2(symbol, {
        timeframe: '1Day',
        limit: 1,
      })
      for await (const bar of bars) {
        return bar.ClosePrice
      }
    } catch (barError) {
      throw new Error(`Unable to get price for ${symbol}: ${error.message}`)
    }
  }
  return null
}

/**
 * Get latest prices for multiple tickers
 * @param {Alpaca} client - Alpaca client instance
 * @param {string[]} symbols - Array of ticker symbols
 * @returns {Promise<Object>} Map of symbol -> price
 */
export async function getLatestPrices(client, symbols) {
  const prices = {}

  // Alpaca batch quote endpoint
  try {
    const trades = await client.getLatestTrades(symbols)
    for (const [symbol, trade] of Object.entries(trades)) {
      prices[symbol] = trade.Price
    }
  } catch (error) {
    // Fallback to individual requests
    for (const symbol of symbols) {
      try {
        prices[symbol] = await getLatestPrice(client, symbol)
      } catch (e) {
        console.warn(`[alpaca] Failed to get price for ${symbol}:`, e.message)
        prices[symbol] = null
      }
    }
  }

  return prices
}

/**
 * Get today's orders
 * @param {Alpaca} client - Alpaca client instance
 * @returns {Promise<Array>} Array of orders
 */
export async function getTodaysOrders(client) {
  const orders = await client.getOrders({
    status: 'all',
    limit: 500,
    after: new Date().toISOString().split('T')[0],
  })

  return orders.map(order => ({
    id: order.id,
    symbol: order.symbol,
    side: order.side,
    type: order.type,
    qty: parseFloat(order.qty),
    filledQty: parseFloat(order.filled_qty),
    filledAvgPrice: order.filled_avg_price ? parseFloat(order.filled_avg_price) : null,
    status: order.status,
    limitPrice: order.limit_price ? parseFloat(order.limit_price) : null,
    submittedAt: order.submitted_at,
    filledAt: order.filled_at,
  }))
}

/**
 * Cancel all open orders
 * @param {Alpaca} client - Alpaca client instance
 * @returns {Promise<number>} Number of orders cancelled
 */
export async function cancelAllOrders(client) {
  const openOrders = await client.getOrders({ status: 'open' })
  for (const order of openOrders) {
    await client.cancelOrder(order.id)
  }
  return openOrders.length
}

/**
 * Submit a market sell order
 * @param {Alpaca} client - Alpaca client instance
 * @param {string} symbol - Ticker symbol
 * @param {number} qty - Number of shares
 * @returns {Promise<Object>} Order result
 */
export async function submitMarketSell(client, symbol, qty) {
  const order = await client.createOrder({
    symbol,
    qty,
    side: 'sell',
    type: 'market',
    time_in_force: 'day',
  })
  return {
    id: order.id,
    symbol: order.symbol,
    side: 'sell',
    qty: parseInt(qty),
    type: 'market',
    status: order.status,
  }
}

/**
 * Submit a limit buy order
 * @param {Alpaca} client - Alpaca client instance
 * @param {string} symbol - Ticker symbol
 * @param {number} qty - Number of shares
 * @param {number} limitPrice - Limit price
 * @returns {Promise<Object>} Order result
 */
export async function submitLimitBuy(client, symbol, qty, limitPrice) {
  const order = await client.createOrder({
    symbol,
    qty,
    side: 'buy',
    type: 'limit',
    limit_price: limitPrice,
    time_in_force: 'day',
  })
  return {
    id: order.id,
    symbol: order.symbol,
    side: 'buy',
    qty: parseInt(qty),
    type: 'limit',
    limitPrice,
    status: order.status,
  }
}

/**
 * Get portfolio value history for equity chart
 * @param {Alpaca} client - Alpaca client instance
 * @param {string} period - Time period: '1D', '1W', '1M', '3M', '6M', '1Y', 'ALL'
 * @returns {Promise<Array>} Array of { timestamp, equity, profitLoss, profitLossPct }
 */
export async function getPortfolioHistory(client, period = '1M') {
  // Map period to Alpaca parameters
  const periodMap = {
    '1D': { period: '1D', timeframe: '5Min' },
    '1W': { period: '1W', timeframe: '15Min' },
    '1M': { period: '1M', timeframe: '1D' },
    '3M': { period: '3M', timeframe: '1D' },
    '6M': { period: '6M', timeframe: '1D' },
    'YTD': { period: '1A', timeframe: '1D' },
    '1Y': { period: '1A', timeframe: '1D' },
    'ALL': { period: 'all', timeframe: '1D' },
  }

  const params = periodMap[period] || periodMap['1M']

  try {
    const history = await client.getPortfolioHistory({
      period: params.period,
      timeframe: params.timeframe,
      extended_hours: false,
    })

    // History returns { timestamp[], equity[], profit_loss[], profit_loss_pct[] }
    const result = []
    const timestamps = history.timestamp || []
    const equities = history.equity || []
    const profitLoss = history.profit_loss || []
    const profitLossPct = history.profit_loss_pct || []

    for (let i = 0; i < timestamps.length; i++) {
      // Skip null values (weekend gaps)
      if (equities[i] != null) {
        result.push({
          timestamp: timestamps[i] * 1000, // Convert to milliseconds
          equity: equities[i],
          profitLoss: profitLoss[i] || 0,
          profitLossPct: profitLossPct[i] || 0,
        })
      }
    }

    return result
  } catch (error) {
    console.error('[alpaca] Failed to get portfolio history:', error.message)
    return []
  }
}
