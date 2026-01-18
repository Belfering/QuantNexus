# FRD-042: Live Trading System - Tiingo Market Data + Alpaca Execution

**Status**: Draft
**Created**: 2026-01-16
**Author**: System Architecture Team
**Priority**: High

---

## Executive Summary

Implement a production-ready live trading system that executes algorithm-generated strategies in real brokerage accounts. The system will use **Tiingo IEX API** for real-time market data and **Alpaca Trade API** for order execution, minimizing platform costs while providing institutional-grade execution.

**Key Architecture Decisions**:
- Users connect their own free Alpaca brokerage accounts (paper or live trading)
- Platform uses existing Tiingo subscription for batch market data
- Execution occurs daily at 3:55 PM EST using 3:50 PM pricing snapshot
- Zero cost to platform (no broker-dealer registration, no Alpaca data subscription needed)
- Maximum security via AES-256-GCM encrypted credential storage

---

## 1. Business Requirements

### 1.1 Core Objectives

1. **Enable Live Trading**: Allow users to execute System Block Chain strategies in real brokerage accounts
2. **Minimize Platform Costs**: Use existing Tiingo subscription, avoid $99/month Alpaca market data fees
3. **User-Owned Accounts**: Each user connects their own Alpaca account (free tier available)
4. **End-of-Day Execution**: Single daily execution at market close (3:55 PM EST)
5. **Security First**: Encrypt all API credentials, audit all trades, protect user assets

### 1.2 Success Metrics

- **Execution Reliability**: 99.9% successful trade execution rate
- **Pricing Accuracy**: ≤0.1% deviation between Tiingo price and actual fill
- **Latency**: Complete batch pricing fetch in ≤3 seconds for 500 tickers
- **Security**: Zero credential breaches, all keys encrypted at rest
- **User Adoption**: 50+ users with connected Alpaca accounts within 3 months

---

## 2. Architecture Overview

### 2.1 System Components

```
┌─────────────────────────────────────────────────────────────┐
│                     Atlas Forge Frontend                     │
│  - Strategy Builder (Forge tab)                              │
│  - Broker Connection UI (Settings → Live Trading)            │
│  - Trade History Dashboard                                   │
└────────────────┬────────────────────────────────────────────┘
                 │
                 │ HTTPS (Encrypted)
                 ▼
┌─────────────────────────────────────────────────────────────┐
│                   Express API Server                         │
│  - Authentication Middleware                                 │
│  - Credential Encryption/Decryption (AES-256-GCM)           │
│  - Live Trading Routes (/api/live/*)                        │
│  - Scheduled Jobs (node-cron)                               │
└──────────┬─────────────────────────┬────────────────────────┘
           │                         │
           │ Tiingo API              │ Alpaca API
           ▼                         ▼
┌──────────────────────┐   ┌──────────────────────────┐
│   Tiingo IEX API     │   │   Alpaca Trade API       │
│  - Batch Pricing     │   │  - Account Info          │
│  - 500 tickers/call  │   │  - Submit Orders         │
│  - 1-2s latency      │   │  - Position Management   │
│  - $79/mo (existing) │   │  - Trade History         │
└──────────────────────┘   └──────────────────────────┘
```

### 2.2 Data Flow: Daily Execution

```
3:50 PM EST: Fetch Batch Pricing
  │
  ├─> GET https://api.tiingo.com/iex/?tickers=SPY,AAPL,MSFT,...&token=KEY
  │
  ├─> Response: { "SPY": { "last": 450.32, ... }, "AAPL": { ... } }
  │
  └─> Store in memory cache (5-minute TTL)

3:55 PM EST: Execute All User Strategies
  │
  ├─> For each user with active strategy:
  │     │
  │     ├─> Decrypt Alpaca credentials from database
  │     │
  │     ├─> Load user's strategy tree from bots table
  │     │
  │     ├─> Run backtest engine with TODAY's data + cached prices
  │     │
  │     ├─> Calculate target allocations (e.g., 60% SPY, 40% BIL)
  │     │
  │     ├─> Get current positions from Alpaca
  │     │
  │     ├─> Calculate rebalancing trades (sell excess, buy new)
  │     │
  │     └─> Submit orders to Alpaca:
  │           - Market sell orders (liquidate old positions)
  │           - Limit buy orders (enter new positions at cached price)
  │
  └─> Log all trades to database (audit trail)

4:00 PM EST: Market Close
  │
  └─> Generate execution report for each user
```

---

## 3. Detailed Component Specifications

### 3.1 Tiingo Batch Pricing Integration

#### 3.1.1 API Endpoint

**Base URL**: `https://api.tiingo.com`
**Endpoint**: `GET /iex/?tickers={symbols}&token={api_key}`
**Documentation**: https://api.tiingo.com/documentation/iex

#### 3.1.2 Request Format

```javascript
// Example: Fetch prices for 100 tickers
const tickers = ['SPY', 'AAPL', 'MSFT', ..., 'BIL'] // Up to 500 per request
const url = `https://api.tiingo.com/iex/?tickers=${tickers.join(',')}&token=${TIINGO_API_KEY}`

const response = await fetch(url)
const data = await response.json()
```

#### 3.1.3 Response Format

```json
[
  {
    "ticker": "SPY",
    "timestamp": "2026-01-16T15:50:00.000Z",
    "last": 450.32,
    "lastSize": 100,
    "lastSaleTimestamp": "2026-01-16T15:49:58.123Z",
    "bidPrice": 450.30,
    "bidSize": 200,
    "askPrice": 450.33,
    "askSize": 150,
    "volume": 45678900,
    "prevClose": 448.75
  },
  {
    "ticker": "AAPL",
    "timestamp": "2026-01-16T15:50:00.000Z",
    "last": 178.42,
    ...
  }
]
```

#### 3.1.4 Batch Pricing Implementation

**File**: `System.app/server/live/pricing-tiingo.mjs`

```javascript
import fetch from 'node-fetch'

const TIINGO_API_KEY = process.env.TIINGO_API_KEY
const TIINGO_BASE_URL = 'https://api.tiingo.com'
const MAX_TICKERS_PER_REQUEST = 500

/**
 * Fetch current prices for multiple tickers from Tiingo IEX
 * @param {string[]} tickers - Array of ticker symbols
 * @returns {Promise<Record<string, number>>} Map of symbol -> last price
 */
export async function fetchBatchPrices(tickers) {
  if (!TIINGO_API_KEY) {
    throw new Error('TIINGO_API_KEY environment variable not set')
  }

  // Split into batches if > 500 tickers
  const batches = []
  for (let i = 0; i < tickers.length; i += MAX_TICKERS_PER_REQUEST) {
    batches.push(tickers.slice(i, i + MAX_TICKERS_PER_REQUEST))
  }

  // Fetch all batches in parallel
  const results = await Promise.all(
    batches.map(batch => fetchBatch(batch))
  )

  // Merge results into single price map
  const prices = {}
  for (const batchResult of results) {
    Object.assign(prices, batchResult)
  }

  return prices
}

/**
 * Fetch a single batch from Tiingo
 */
async function fetchBatch(tickers) {
  const url = `${TIINGO_BASE_URL}/iex/?tickers=${tickers.join(',')}&token=${TIINGO_API_KEY}`

  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Tiingo API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()

    // Convert array response to price map
    const prices = {}
    for (const quote of data) {
      prices[quote.ticker] = quote.last
    }

    return prices
  } catch (error) {
    console.error('[Tiingo] Batch pricing failed:', error.message)
    throw error
  }
}

/**
 * Get unique tickers from all active user strategies
 * @param {Object[]} strategies - Array of user strategy trees
 * @returns {string[]} Unique ticker symbols
 */
export function extractTickersFromStrategies(strategies) {
  const tickers = new Set()

  for (const strategy of strategies) {
    // Parse tree and extract all position node tickers
    extractTickersRecursive(strategy.tree, tickers)
  }

  return Array.from(tickers)
}

/**
 * Recursively extract tickers from strategy tree
 */
function extractTickersRecursive(node, tickers) {
  if (!node) return

  // Position nodes contain tickers
  if (node.kind === 'position' && node.positions) {
    for (const pos of node.positions) {
      if (pos.ticker && pos.ticker !== 'Empty') {
        tickers.add(pos.ticker)
      }
    }
  }

  // Recurse through children
  if (node.children) {
    for (const children of Object.values(node.children)) {
      if (Array.isArray(children)) {
        for (const child of children) {
          if (child) {
            extractTickersRecursive(child, tickers)
          }
        }
      }
    }
  }
}
```

#### 3.1.5 Price Caching

**File**: `System.app/server/live/price-cache.mjs`

```javascript
/**
 * In-memory price cache with TTL
 */
class PriceCache {
  constructor(ttlMs = 5 * 60 * 1000) { // 5 minutes default
    this.cache = new Map()
    this.ttl = ttlMs
  }

  /**
   * Set prices with timestamp
   */
  set(prices) {
    this.cache.set('prices', {
      data: prices,
      timestamp: Date.now()
    })
  }

  /**
   * Get prices if not expired
   */
  get() {
    const entry = this.cache.get('prices')
    if (!entry) return null

    const age = Date.now() - entry.timestamp
    if (age > this.ttl) {
      this.cache.delete('prices')
      return null
    }

    return entry.data
  }

  /**
   * Check if cache is fresh
   */
  isFresh() {
    return this.get() !== null
  }

  /**
   * Clear cache
   */
  clear() {
    this.cache.clear()
  }
}

export const priceCache = new PriceCache()
```

---

### 3.2 Alpaca Trade Execution Integration

#### 3.2.1 Existing Implementation

**File**: `System.app/server/live/broker-alpaca.mjs` (Already exists - see system reminders)

**Key Functions**:
- `createAlpacaClient(credentials)` - Initialize API client
- `testConnection(client)` - Verify credentials
- `getAccountInfo(client)` - Get equity, cash, buying power
- `getPositions(client)` - Fetch current holdings
- `submitMarketSell(client, symbol, qty)` - Liquidate position
- `submitLimitBuy(client, symbol, qty, limitPrice)` - Enter position

#### 3.2.2 New Functions Needed

**Add to**: `System.app/server/live/broker-alpaca.mjs`

```javascript
/**
 * Calculate required rebalancing trades
 * @param {Object} account - Account info from getAccountInfo()
 * @param {Object[]} currentPositions - Current positions from getPositions()
 * @param {Object} targetAllocations - { "SPY": 0.60, "BIL": 0.40 }
 * @param {Object} prices - { "SPY": 450.32, "BIL": 91.50 }
 * @returns {Object} { sells: [...], buys: [...] }
 */
export function calculateRebalancingTrades(account, currentPositions, targetAllocations, prices) {
  const portfolioValue = account.portfolioValue
  const targetPositions = {}

  // Calculate target dollar amounts and share quantities
  for (const [symbol, allocation] of Object.entries(targetAllocations)) {
    const targetDollars = portfolioValue * allocation
    const price = prices[symbol]
    if (!price) {
      throw new Error(`No price available for ${symbol}`)
    }
    const targetQty = Math.floor(targetDollars / price)
    targetPositions[symbol] = { targetQty, price }
  }

  // Build current position map
  const currentMap = {}
  for (const pos of currentPositions) {
    currentMap[pos.symbol] = pos.qty
  }

  // Calculate sells (positions to exit or reduce)
  const sells = []
  for (const pos of currentPositions) {
    const currentQty = pos.qty
    const targetQty = targetPositions[pos.symbol]?.targetQty || 0

    if (currentQty > targetQty) {
      sells.push({
        symbol: pos.symbol,
        qty: currentQty - targetQty,
        reason: targetQty === 0 ? 'exit' : 'reduce'
      })
    }
  }

  // Calculate buys (positions to enter or increase)
  const buys = []
  for (const [symbol, { targetQty, price }] of Object.entries(targetPositions)) {
    const currentQty = currentMap[symbol] || 0

    if (targetQty > currentQty) {
      buys.push({
        symbol,
        qty: targetQty - currentQty,
        limitPrice: price,
        reason: currentQty === 0 ? 'enter' : 'increase'
      })
    }
  }

  return { sells, buys }
}

/**
 * Execute rebalancing trades
 * @param {Alpaca} client - Alpaca client instance
 * @param {Object} trades - Result from calculateRebalancingTrades()
 * @returns {Promise<Object>} Execution results
 */
export async function executeRebalancing(client, trades) {
  const results = {
    sells: [],
    buys: [],
    errors: []
  }

  // Step 1: Execute all sells first (free up cash)
  for (const sell of trades.sells) {
    try {
      const order = await submitMarketSell(client, sell.symbol, sell.qty)
      results.sells.push({ ...sell, orderId: order.id, status: order.status })
    } catch (error) {
      results.errors.push({
        trade: sell,
        error: error.message
      })
    }
  }

  // Step 2: Wait 2 seconds for sell orders to process
  await new Promise(resolve => setTimeout(resolve, 2000))

  // Step 3: Execute all buys
  for (const buy of trades.buys) {
    try {
      const order = await submitLimitBuy(client, buy.symbol, buy.qty, buy.limitPrice)
      results.buys.push({ ...buy, orderId: order.id, status: order.status })
    } catch (error) {
      results.errors.push({
        trade: buy,
        error: error.message
      })
    }
  }

  return results
}
```

---

### 3.3 Strategy Execution Engine

#### 3.3.1 Integration with Existing Backtest

**File**: `System.app/server/live/strategy-executor.mjs` (New file)

```javascript
import { runBacktest } from '../backtest/runner.mjs' // Existing backtest engine
import { fetchBatchPrices } from './pricing-tiingo.mjs'
import { priceCache } from './price-cache.mjs'
import {
  createAlpacaClient,
  getAccountInfo,
  getPositions,
  calculateRebalancingTrades,
  executeRebalancing
} from './broker-alpaca.mjs'

/**
 * Execute live strategy for a user
 * @param {Object} user - User record with credentials
 * @param {Object} strategy - Bot/strategy record with tree
 * @param {Object} prices - Cached price map
 * @returns {Promise<Object>} Execution results
 */
export async function executeLiveStrategy(user, strategy, prices) {
  console.log(`[Executor] Running strategy "${strategy.name}" for user ${user.id}`)

  try {
    // 1. Create Alpaca client with user's encrypted credentials
    const credentials = decryptCredentials(user.alpacaCredentials)
    const alpacaClient = createAlpacaClient(credentials)

    // 2. Get current account state
    const account = await getAccountInfo(alpacaClient)
    const positions = await getPositions(alpacaClient)

    console.log(`[Executor] Account value: $${account.portfolioValue}`)
    console.log(`[Executor] Current positions: ${positions.length}`)

    // 3. Run backtest engine to determine target allocations
    // Use TODAY as the evaluation date with cached prices
    const today = new Date().toISOString().split('T')[0]
    const backtestResult = await runBacktest({
      tree: strategy.tree,
      startDate: today,
      endDate: today,
      livePrices: prices // Override with cached Tiingo prices
    })

    // Extract final allocation from backtest result
    const targetAllocations = backtestResult.finalAllocations // { "SPY": 0.60, "BIL": 0.40 }

    console.log(`[Executor] Target allocations:`, targetAllocations)

    // 4. Calculate required trades
    const trades = calculateRebalancingTrades(
      account,
      positions,
      targetAllocations,
      prices
    )

    console.log(`[Executor] Rebalancing trades: ${trades.sells.length} sells, ${trades.buys.length} buys`)

    // 5. Execute trades
    const execution = await executeRebalancing(alpacaClient, trades)

    // 6. Log to database
    await logExecution(user.id, strategy.id, {
      timestamp: new Date(),
      accountValue: account.portfolioValue,
      targetAllocations,
      trades,
      execution,
      prices
    })

    return {
      success: true,
      execution,
      errors: execution.errors
    }

  } catch (error) {
    console.error(`[Executor] Strategy execution failed for user ${user.id}:`, error)

    // Log error to database
    await logExecutionError(user.id, strategy.id, error)

    return {
      success: false,
      error: error.message
    }
  }
}

/**
 * Execute all active strategies at 3:55 PM daily
 */
export async function executeDailyStrategies() {
  console.log('[Executor] Starting daily strategy execution')

  // 1. Get all users with active live strategies
  const users = await getActiveUsers()

  if (users.length === 0) {
    console.log('[Executor] No active users found')
    return
  }

  // 2. Collect all unique tickers from all strategies
  const allStrategies = users.flatMap(u => u.strategies)
  const tickers = extractTickersFromStrategies(allStrategies)

  console.log(`[Executor] Fetching prices for ${tickers.length} tickers`)

  // 3. Fetch batch prices from Tiingo
  let prices = priceCache.get()
  if (!prices) {
    prices = await fetchBatchPrices(tickers)
    priceCache.set(prices)
  }

  console.log(`[Executor] Prices cached: ${Object.keys(prices).length} tickers`)

  // 4. Execute each user's strategy
  const results = []
  for (const user of users) {
    for (const strategy of user.strategies) {
      const result = await executeLiveStrategy(user, strategy, prices)
      results.push({
        userId: user.id,
        strategyId: strategy.id,
        ...result
      })
    }
  }

  console.log(`[Executor] Daily execution complete: ${results.length} strategies processed`)

  return results
}
```

---

### 3.4 Scheduled Job Configuration

#### 3.4.1 Daily Execution Schedule

**File**: `System.app/server/jobs/daily-execution.mjs` (New file)

```javascript
import cron from 'node-cron'
import { fetchBatchPrices } from '../live/pricing-tiingo.mjs'
import { priceCache } from '../live/price-cache.mjs'
import { executeDailyStrategies } from '../live/strategy-executor.mjs'
import { extractTickersFromStrategies } from '../live/pricing-tiingo.mjs'
import { getActiveUsers } from '../db/users.mjs'

/**
 * Schedule daily trading jobs
 */
export function scheduleDailyJobs() {
  // Job 1: Fetch prices at 3:50 PM EST (5 minutes before execution)
  // Cron: "50 15 * * 1-5" (3:50 PM Mon-Fri, EST timezone)
  cron.schedule('50 15 * * 1-5', async () => {
    console.log('[Cron] Fetching batch prices at 3:50 PM EST')

    try {
      // Get all active users and their strategies
      const users = await getActiveUsers()
      const allStrategies = users.flatMap(u => u.strategies)

      // Extract unique tickers
      const tickers = extractTickersFromStrategies(allStrategies)

      console.log(`[Cron] Fetching prices for ${tickers.length} tickers`)

      // Fetch and cache prices
      const prices = await fetchBatchPrices(tickers)
      priceCache.set(prices)

      console.log(`[Cron] Prices cached: ${Object.keys(prices).length} tickers`)

    } catch (error) {
      console.error('[Cron] Price fetch failed:', error)
      // Don't throw - execution job will retry if needed
    }
  }, {
    timezone: 'America/New_York'
  })

  // Job 2: Execute all strategies at 3:55 PM EST
  // Cron: "55 15 * * 1-5" (3:55 PM Mon-Fri, EST timezone)
  cron.schedule('55 15 * * 1-5', async () => {
    console.log('[Cron] Executing all strategies at 3:55 PM EST')

    try {
      const results = await executeDailyStrategies()
      console.log(`[Cron] Execution complete: ${results.length} strategies processed`)

      // Send summary notifications to users
      await sendExecutionSummaries(results)

    } catch (error) {
      console.error('[Cron] Strategy execution failed:', error)
      // Log critical error and alert admin
      await alertAdmin('Daily execution failed', error)
    }
  }, {
    timezone: 'America/New_York'
  })

  console.log('[Cron] Daily jobs scheduled: 3:50 PM (pricing), 3:55 PM (execution)')
}
```

#### 3.4.2 Server Integration

**File**: `System.app/server/index.mjs` (Modify existing)

```javascript
// Add at top of file
import { scheduleDailyJobs } from './jobs/daily-execution.mjs'

// Add after Express app setup, before app.listen()
if (process.env.NODE_ENV === 'production') {
  scheduleDailyJobs()
  console.log('[Server] Daily trading jobs scheduled')
} else {
  console.log('[Server] Daily trading jobs DISABLED (development mode)')
}
```

---

### 3.5 Database Schema

#### 3.5.1 Live Trading Tables

**File**: `System.app/server/db/schema.sql` (Add to existing)

```sql
-- User Alpaca credentials (encrypted)
CREATE TABLE IF NOT EXISTS alpaca_credentials (
  user_id INTEGER PRIMARY KEY,
  api_key_encrypted TEXT NOT NULL,
  api_secret_encrypted TEXT NOT NULL,
  is_paper BOOLEAN DEFAULT 1,
  base_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Live strategy assignments
CREATE TABLE IF NOT EXISTS live_strategies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  bot_id INTEGER NOT NULL,
  is_active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  deactivated_at DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE,
  UNIQUE(user_id, bot_id)
);

-- Execution history (audit trail)
CREATE TABLE IF NOT EXISTS execution_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  strategy_id INTEGER NOT NULL,
  executed_at DATETIME NOT NULL,
  account_value REAL,
  target_allocations TEXT, -- JSON: { "SPY": 0.60, ... }
  trades_json TEXT, -- JSON: { sells: [...], buys: [...] }
  execution_json TEXT, -- JSON: { sells: [...], buys: [...], errors: [...] }
  prices_json TEXT, -- JSON: { "SPY": 450.32, ... }
  success BOOLEAN,
  error_message TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (strategy_id) REFERENCES live_strategies(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_execution_history_user ON execution_history(user_id);
CREATE INDEX IF NOT EXISTS idx_execution_history_date ON execution_history(executed_at);
```

---

### 3.6 API Routes

#### 3.6.1 Credential Management

**File**: `System.app/server/routes/live.mjs` (Already exists - extend)

**Add new endpoints**:

```javascript
// POST /api/live/credentials - Save or update Alpaca credentials
router.post('/credentials', requireAuth, async (req, res) => {
  const { apiKey, apiSecret, isPaper, baseUrl } = req.body
  const userId = req.user.id

  // Validate inputs
  if (!apiKey || !apiSecret) {
    return res.status(400).json({ error: 'API key and secret required' })
  }

  // Test connection before saving
  const testClient = createAlpacaClient({ apiKey, apiSecret, isPaper, baseUrl })
  const testResult = await testConnection(testClient)

  if (!testResult.success) {
    return res.status(400).json({ error: testResult.error })
  }

  // Encrypt and save
  const encrypted = encryptCredentials({ apiKey, apiSecret, isPaper, baseUrl })

  await db.run(`
    INSERT INTO alpaca_credentials (user_id, api_key_encrypted, api_secret_encrypted, is_paper, base_url)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      api_key_encrypted = excluded.api_key_encrypted,
      api_secret_encrypted = excluded.api_secret_encrypted,
      is_paper = excluded.is_paper,
      base_url = excluded.base_url,
      updated_at = CURRENT_TIMESTAMP
  `, [userId, encrypted.apiKey, encrypted.apiSecret, isPaper ? 1 : 0, baseUrl])

  res.json({
    success: true,
    account: testResult.account
  })
})

// GET /api/live/credentials/status - Check if credentials exist
router.get('/credentials/status', requireAuth, async (req, res) => {
  const row = await db.get(
    'SELECT is_paper, created_at FROM alpaca_credentials WHERE user_id = ?',
    [req.user.id]
  )

  res.json({
    hasCredentials: !!row,
    isPaper: row?.is_paper === 1,
    createdAt: row?.created_at
  })
})

// DELETE /api/live/credentials - Remove credentials
router.delete('/credentials', requireAuth, async (req, res) => {
  await db.run('DELETE FROM alpaca_credentials WHERE user_id = ?', [req.user.id])
  res.json({ success: true })
})
```

#### 3.6.2 Strategy Activation

**Add to**: `System.app/server/routes/live.mjs`

```javascript
// POST /api/live/activate - Activate a bot for live trading
router.post('/activate', requireAuth, async (req, res) => {
  const { botId } = req.body
  const userId = req.user.id

  // Verify user has credentials
  const creds = await db.get(
    'SELECT id FROM alpaca_credentials WHERE user_id = ?',
    [userId]
  )

  if (!creds) {
    return res.status(400).json({ error: 'Connect Alpaca account first' })
  }

  // Verify bot exists and belongs to user
  const bot = await db.get(
    'SELECT id FROM bots WHERE id = ? AND user_id = ?',
    [botId, userId]
  )

  if (!bot) {
    return res.status(404).json({ error: 'Bot not found' })
  }

  // Activate strategy
  await db.run(`
    INSERT INTO live_strategies (user_id, bot_id, is_active)
    VALUES (?, ?, 1)
    ON CONFLICT(user_id, bot_id) DO UPDATE SET
      is_active = 1,
      deactivated_at = NULL
  `, [userId, botId])

  res.json({ success: true })
})

// POST /api/live/deactivate - Deactivate a live strategy
router.post('/deactivate', requireAuth, async (req, res) => {
  const { botId } = req.body
  const userId = req.user.id

  await db.run(`
    UPDATE live_strategies
    SET is_active = 0, deactivated_at = CURRENT_TIMESTAMP
    WHERE user_id = ? AND bot_id = ?
  `, [userId, botId])

  res.json({ success: true })
})

// GET /api/live/active - Get all active strategies for user
router.get('/active', requireAuth, async (req, res) => {
  const strategies = await db.all(`
    SELECT ls.id, ls.bot_id, b.name, b.tree, ls.created_at
    FROM live_strategies ls
    JOIN bots b ON ls.bot_id = b.id
    WHERE ls.user_id = ? AND ls.is_active = 1
  `, [req.user.id])

  res.json({ strategies })
})
```

#### 3.6.3 Execution History

**Add to**: `System.app/server/routes/live.mjs`

```javascript
// GET /api/live/history - Get execution history for user
router.get('/history', requireAuth, async (req, res) => {
  const { limit = 50, offset = 0 } = req.query

  const history = await db.all(`
    SELECT
      eh.id,
      eh.executed_at,
      eh.account_value,
      eh.target_allocations,
      eh.trades_json,
      eh.execution_json,
      eh.success,
      eh.error_message,
      b.name as strategy_name
    FROM execution_history eh
    JOIN live_strategies ls ON eh.strategy_id = ls.id
    JOIN bots b ON ls.bot_id = b.id
    WHERE eh.user_id = ?
    ORDER BY eh.executed_at DESC
    LIMIT ? OFFSET ?
  `, [req.user.id, limit, offset])

  res.json({ history })
})

// GET /api/live/history/:id - Get detailed execution record
router.get('/history/:id', requireAuth, async (req, res) => {
  const record = await db.get(`
    SELECT * FROM execution_history
    WHERE id = ? AND user_id = ?
  `, [req.params.id, req.user.id])

  if (!record) {
    return res.status(404).json({ error: 'Record not found' })
  }

  res.json({ record })
})
```

---

## 4. Frontend Implementation

### 4.1 Broker Connection UI

**File**: `System.app/src/components/Live/BrokerConnection.tsx` (New file)

```typescript
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Check, X, AlertTriangle } from 'lucide-react'

export function BrokerConnection() {
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [isPaper, setIsPaper] = useState(true)
  const [status, setStatus] = useState<'connected' | 'disconnected' | 'testing'>('disconnected')
  const [accountInfo, setAccountInfo] = useState<any>(null)
  const [error, setError] = useState('')

  // Check connection status on mount
  useEffect(() => {
    fetch('/api/live/credentials/status')
      .then(res => res.json())
      .then(data => {
        if (data.hasCredentials) {
          setStatus('connected')
          setIsPaper(data.isPaper)
        }
      })
  }, [])

  const handleConnect = async () => {
    setStatus('testing')
    setError('')

    try {
      const res = await fetch('/api/live/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, apiSecret, isPaper })
      })

      const data = await res.json()

      if (data.success) {
        setStatus('connected')
        setAccountInfo(data.account)
        setApiKey('') // Clear for security
        setApiSecret('')
      } else {
        setStatus('disconnected')
        setError(data.error || 'Connection failed')
      }
    } catch (err) {
      setStatus('disconnected')
      setError('Network error')
    }
  }

  const handleDisconnect = async () => {
    await fetch('/api/live/credentials', { method: 'DELETE' })
    setStatus('disconnected')
    setAccountInfo(null)
  }

  return (
    <div className="p-4 border rounded-lg">
      <h3 className="text-lg font-semibold mb-4">Alpaca Broker Connection</h3>

      {status === 'connected' ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-green-600">
            <Check className="h-5 w-5" />
            <span>Connected to Alpaca ({isPaper ? 'Paper' : 'Live'} Trading)</span>
          </div>

          {accountInfo && (
            <div className="p-3 bg-muted rounded">
              <div className="text-sm space-y-1">
                <div>Account: {accountInfo.id}</div>
                <div>Equity: ${accountInfo.equity.toLocaleString()}</div>
                <div>Buying Power: ${accountInfo.buyingPower.toLocaleString()}</div>
                <div>Status: {accountInfo.status}</div>
              </div>
            </div>
          )}

          <Button onClick={handleDisconnect} variant="destructive" size="sm">
            Disconnect
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isPaper}
              onChange={(e) => setIsPaper(e.target.checked)}
              id="paper-trading"
            />
            <label htmlFor="paper-trading" className="text-sm">
              Paper Trading (Recommended for testing)
            </label>
          </div>

          <Input
            type="text"
            placeholder="API Key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />

          <Input
            type="password"
            placeholder="API Secret"
            value={apiSecret}
            onChange={(e) => setApiSecret(e.target.value)}
          />

          {error && (
            <div className="flex items-center gap-2 text-red-500 text-sm">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </div>
          )}

          <Button
            onClick={handleConnect}
            disabled={!apiKey || !apiSecret || status === 'testing'}
          >
            {status === 'testing' ? 'Testing Connection...' : 'Connect'}
          </Button>

          <div className="text-sm text-muted-foreground">
            <a
              href="https://app.alpaca.markets/paper/dashboard/overview"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Get free Alpaca paper trading account →
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
```

### 4.2 Strategy Activation UI

**File**: `System.app/src/components/Live/StrategyActivation.tsx` (New file)

```typescript
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { useBotStore } from '@/stores/useBotStore'
import { Play, Square, AlertCircle } from 'lucide-react'

export function StrategyActivation() {
  const bots = useBotStore(state => state.bots)
  const [activeStrategies, setActiveStrategies] = useState<Set<number>>(new Set())
  const [hasCredentials, setHasCredentials] = useState(false)

  useEffect(() => {
    // Check credentials
    fetch('/api/live/credentials/status')
      .then(res => res.json())
      .then(data => setHasCredentials(data.hasCredentials))

    // Load active strategies
    fetch('/api/live/active')
      .then(res => res.json())
      .then(data => {
        const activeIds = new Set(data.strategies.map(s => s.bot_id))
        setActiveStrategies(activeIds)
      })
  }, [])

  const handleActivate = async (botId: number) => {
    await fetch('/api/live/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botId })
    })

    setActiveStrategies(prev => new Set(prev).add(botId))
  }

  const handleDeactivate = async (botId: number) => {
    await fetch('/api/live/deactivate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botId })
    })

    setActiveStrategies(prev => {
      const next = new Set(prev)
      next.delete(botId)
      return next
    })
  }

  if (!hasCredentials) {
    return (
      <div className="p-4 border rounded-lg">
        <div className="flex items-center gap-2 text-amber-600 mb-2">
          <AlertCircle className="h-5 w-5" />
          <span className="font-semibold">Connect Alpaca Account First</span>
        </div>
        <p className="text-sm text-muted-foreground">
          You must connect your Alpaca brokerage account before activating live trading.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 border rounded-lg">
      <h3 className="text-lg font-semibold mb-4">Live Trading Strategies</h3>

      <div className="space-y-2">
        {bots.length === 0 ? (
          <p className="text-sm text-muted-foreground">No strategies found. Create a bot in the Forge tab first.</p>
        ) : (
          bots.map(bot => {
            const isActive = activeStrategies.has(bot.id)

            return (
              <div key={bot.id} className="flex items-center justify-between p-3 border rounded">
                <div>
                  <div className="font-medium">{bot.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {isActive ? '🟢 Active - Executes daily at 3:55 PM EST' : '⚪ Inactive'}
                  </div>
                </div>

                <Button
                  onClick={() => isActive ? handleDeactivate(bot.id) : handleActivate(bot.id)}
                  variant={isActive ? 'destructive' : 'default'}
                  size="sm"
                >
                  {isActive ? (
                    <>
                      <Square className="h-4 w-4 mr-2" />
                      Deactivate
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Activate
                    </>
                  )}
                </Button>
              </div>
            )
          })
        )}
      </div>

      {activeStrategies.size > 0 && (
        <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded">
          <div className="text-sm text-blue-600 dark:text-blue-400">
            ℹ️ Active strategies execute daily at 3:55 PM EST (5 minutes before market close)
          </div>
        </div>
      )}
    </div>
  )
}
```

### 4.3 Execution History UI

**File**: `System.app/src/components/Live/ExecutionHistory.tsx` (New file)

```typescript
import { useState, useEffect } from 'react'
import { formatDistance } from 'date-fns'
import { Check, X } from 'lucide-react'

export function ExecutionHistory() {
  const [history, setHistory] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/live/history?limit=20')
      .then(res => res.json())
      .then(data => {
        setHistory(data.history)
        setLoading(false)
      })
  }, [])

  if (loading) {
    return <div className="p-4">Loading history...</div>
  }

  if (history.length === 0) {
    return (
      <div className="p-4 border rounded-lg">
        <p className="text-sm text-muted-foreground">No execution history yet. Activate a strategy to begin.</p>
      </div>
    )
  }

  return (
    <div className="p-4 border rounded-lg">
      <h3 className="text-lg font-semibold mb-4">Execution History</h3>

      <div className="space-y-2">
        {history.map(record => {
          const trades = JSON.parse(record.trades_json || '{}')
          const execution = JSON.parse(record.execution_json || '{}')

          return (
            <div key={record.id} className="p-3 border rounded">
              <div className="flex items-center justify-between mb-2">
                <div className="font-medium">{record.strategy_name}</div>
                <div className="flex items-center gap-2">
                  {record.success ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <X className="h-4 w-4 text-red-600" />
                  )}
                  <span className="text-sm text-muted-foreground">
                    {formatDistance(new Date(record.executed_at), new Date(), { addSuffix: true })}
                  </span>
                </div>
              </div>

              <div className="text-sm space-y-1">
                <div>Account Value: ${record.account_value?.toLocaleString()}</div>
                <div>Trades: {trades.sells?.length || 0} sells, {trades.buys?.length || 0} buys</div>
                {execution.errors?.length > 0 && (
                  <div className="text-red-500">Errors: {execution.errors.length}</div>
                )}
                {record.error_message && (
                  <div className="text-red-500">{record.error_message}</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

### 4.4 Live Trading Tab Integration

**File**: `System.app/src/App.tsx` (Modify existing)

Add new main tab "Live Trading" with three sections:

```typescript
import { BrokerConnection } from '@/components/Live/BrokerConnection'
import { StrategyActivation } from '@/components/Live/StrategyActivation'
import { ExecutionHistory } from '@/components/Live/ExecutionHistory'

// In main tab navigation (around line 1100)
<Button
  onClick={() => setActiveTab('Live Trading')}
  variant={activeTab === 'Live Trading' ? 'accent' : 'secondary'}
>
  Live Trading
</Button>

// In tab content rendering (around line 1300)
{activeTab === 'Live Trading' && (
  <div className="flex flex-col gap-4 p-4">
    <BrokerConnection />
    <StrategyActivation />
    <ExecutionHistory />
  </div>
)}
```

---

## 5. Security Considerations

### 5.1 Credential Encryption

**Implementation**: Already exists in `System.app/server/routes/live.mjs`

**Algorithm**: AES-256-GCM
**Key Derivation**: PBKDF2 with 100,000 iterations
**Salt**: Unique 32-byte random salt per credential
**IV**: Unique 16-byte random IV per encryption

**Storage**: Encrypted credentials stored in `alpaca_credentials` table as Base64 text

### 5.2 Authentication

**Middleware**: `requireAuth` middleware (already exists)

**All live trading routes require**:
- Valid session token
- User ID extracted from session
- User must own the resources they're accessing

### 5.3 Authorization

**Bot Ownership**: Queries always filter by `user_id` to prevent cross-user access

**Example**:
```sql
SELECT * FROM bots WHERE id = ? AND user_id = ?
```

### 5.4 API Key Storage

**Environment Variables**:
```bash
TIINGO_API_KEY=your_tiingo_key_here
ENCRYPTION_KEY=your_32_byte_hex_key_here
```

**Never commit** these to Git - use `.env` file (already in `.gitignore`)

### 5.5 Trade Logging

**Audit Trail**: Every execution logged to `execution_history` table

**Logged Data**:
- Timestamp
- Account value
- Target allocations
- All trades (sells and buys)
- Execution results
- Errors
- Success/failure status

**Retention**: Keep forever for compliance

---

## 6. Cost Analysis

### 6.1 Platform Costs (Atlas Forge)

| Service | Cost | Usage |
|---------|------|-------|
| **Tiingo IEX API** | $79/month (existing) | Unlimited batch pricing calls |
| **Server Resources** | $0 additional | 2 cron jobs daily (minimal CPU) |
| **Database** | $0 additional | SQLite (existing) |
| **Total** | **$79/month** | **Same as current costs** |

### 6.2 User Costs

| Service | Cost | Notes |
|---------|------|-------|
| **Alpaca Account** | **FREE** | Paper trading always free |
| **Alpaca Live Trading** | **FREE** | No commissions, no account minimums |
| **Alpaca Market Data** | $0 (using Tiingo) | Would be $99/month if used directly |
| **Total per user** | **$0** | **Zero cost to trade live** |

### 6.3 Cost Comparison: Options

| Option | Platform Cost | User Cost | Notes |
|--------|--------------|-----------|-------|
| **1. Tiingo + User Alpaca** ✓ | $79/mo | $0 | Recommended |
| 2. Alpaca Data + User Alpaca | $99/mo | $0 | More expensive |
| 3. Platform Alpaca Account | $99/mo + $0.0004/trade | $0 | Regulatory risk |

**Recommendation**: Option 1 (Tiingo + User Alpaca)

---

## 7. Implementation Phases

### Phase 1: Backend Infrastructure (Week 1-2)

**Tasks**:
- [x] Alpaca integration (already exists)
- [ ] Create `pricing-tiingo.mjs` with batch pricing
- [ ] Create `price-cache.mjs` for in-memory caching
- [ ] Create `strategy-executor.mjs` for backtest integration
- [ ] Add database schema for live trading tables
- [ ] Extend `/api/live/*` routes for strategy activation
- [ ] Set up cron jobs for daily execution

**Deliverables**:
- Batch pricing from Tiingo working
- Strategy execution engine complete
- Database schema deployed
- API routes tested

### Phase 2: Frontend UI (Week 3)

**Tasks**:
- [ ] Create `BrokerConnection.tsx` component
- [ ] Create `StrategyActivation.tsx` component
- [ ] Create `ExecutionHistory.tsx` component
- [ ] Add "Live Trading" tab to main navigation
- [ ] Integrate components into tab layout

**Deliverables**:
- Users can connect Alpaca accounts
- Users can activate/deactivate strategies
- Users can view execution history

### Phase 3: Testing (Week 4)

**Tasks**:
- [ ] Test with paper trading accounts (5+ test users)
- [ ] Verify pricing accuracy (Tiingo vs actual fills)
- [ ] Test error handling (bad credentials, network failures)
- [ ] Load testing (100+ concurrent users)
- [ ] Security audit (credential encryption, authorization)

**Deliverables**:
- 99.9% execution success rate
- <3s pricing latency for 500 tickers
- Zero credential leaks
- Performance benchmarks documented

### Phase 4: Production Rollout (Week 5-6)

**Tasks**:
- [ ] Deploy to production environment
- [ ] Enable cron jobs in production
- [ ] Create user documentation (how to connect Alpaca, activate strategies)
- [ ] Set up monitoring (execution logs, error alerts)
- [ ] Beta test with 10-20 volunteer users

**Deliverables**:
- Live trading available to all users
- Documentation published
- Monitoring dashboard active

---

## 8. Risk Mitigation

### 8.1 Execution Failures

**Risk**: Cron job fails to execute strategies

**Mitigation**:
- Retry logic with exponential backoff
- Alert admin on 3 consecutive failures
- Manual execution endpoint for recovery: `POST /api/live/execute-now` (admin only)

### 8.2 Pricing Data Unavailable

**Risk**: Tiingo API down or rate limited

**Mitigation**:
- Fallback to Alpaca pricing (`getLatestPrices()`)
- Cache previous day's prices as last resort
- Alert users if pricing is stale (>10 minutes)

### 8.3 Alpaca API Errors

**Risk**: Order submission fails (insufficient buying power, market closed, etc.)

**Mitigation**:
- Log all errors to `execution_history` table
- Send email notification to user
- Don't retry failed trades (wait for next day)
- Display errors prominently in UI

### 8.4 Security Breach

**Risk**: Credentials leaked or stolen

**Mitigation**:
- All credentials encrypted at rest (AES-256-GCM)
- Never log decrypted credentials
- Use HTTPS only (no HTTP)
- Implement rate limiting on `/api/live/*` routes
- Require re-authentication for credential updates

### 8.5 Regulatory Compliance

**Risk**: Violating broker-dealer regulations

**Mitigation**:
- Users connect their own accounts (Atlas Forge never holds funds)
- Atlas Forge provides software only (not investment advice)
- Include legal disclaimer on Live Trading tab
- No revenue sharing or commissions

---

## 9. Monitoring and Alerts

### 9.1 Key Metrics

**Track daily**:
- Number of active strategies
- Number of successful executions
- Number of failed executions
- Average pricing latency
- Average execution latency
- Error rate by error type

### 9.2 Alert Conditions

**Critical Alerts** (page admin immediately):
- Cron job failed to run
- Tiingo API down for >5 minutes
- >10% execution failure rate
- Credential decryption errors

**Warning Alerts** (email admin):
- Pricing latency >5 seconds
- Individual user execution failed
- Database write errors

### 9.3 Logging

**Console Logs**:
```
[Cron] Fetching batch prices at 3:50 PM EST
[Cron] Prices cached: 347 tickers
[Cron] Executing all strategies at 3:55 PM EST
[Executor] Running strategy "SPY/BIL Momentum" for user 42
[Executor] Account value: $12,345.67
[Executor] Rebalancing trades: 1 sells, 2 buys
[Executor] Execution complete: 15 strategies processed
```

**Database Logs**: All executions in `execution_history` table

---

## 10. Future Enhancements

### 10.1 Multiple Daily Executions

**Description**: Allow intraday rebalancing (e.g., every hour, every 30 minutes)

**Implementation**:
- Add `execution_frequency` field to `live_strategies` table
- Expand cron schedules: `0 9-16 * * 1-5` (every hour from 9 AM - 4 PM)
- Higher Tiingo API usage (may need upgrade)

### 10.2 Real-Time Streaming Prices

**Description**: Use Alpaca WebSocket API for tick-by-tick data

**Implementation**:
- Connect to `wss://data.alpaca.markets/stream`
- Subscribe to tickers in active strategies
- Update price cache in real-time
- Enable sub-minute execution

### 10.3 Partial Fills Handling

**Description**: Track partial order fills and adjust next-day rebalancing

**Implementation**:
- Query `client.getOrder(orderId)` after submission
- Store `filledQty` vs `qty` in execution log
- Adjust next day's trades to account for unfilled orders

### 10.4 Multi-Broker Support

**Description**: Support other brokers (Interactive Brokers, TD Ameritrade, etc.)

**Implementation**:
- Abstract broker interface: `IBroker` with `submitOrder()`, `getPositions()`, etc.
- Implement adapters: `AlpacaBroker`, `IBKRBroker`, `TDABroker`
- Add broker selection to credential UI

### 10.5 Notifications

**Description**: Email/SMS notifications for execution results

**Implementation**:
- Integrate SendGrid or Twilio
- Send summary email after daily execution
- Alert on errors or large losses

---

## 11. Testing Plan

### 11.1 Unit Tests

**Coverage**:
- `fetchBatchPrices()` - verify request format, response parsing
- `calculateRebalancingTrades()` - verify trade calculations
- `executeRebalancing()` - verify order submission logic
- `encryptCredentials()` / `decryptCredentials()` - verify encryption

### 11.2 Integration Tests

**Scenarios**:
1. **Happy Path**: Connect account → Activate strategy → Wait for cron → Verify execution
2. **No Rebalancing Needed**: Already at target allocations → No trades submitted
3. **Partial Sell**: Sell 50% of position → Verify correct qty
4. **Full Exit**: Sell 100% of position → Verify all shares sold
5. **New Entry**: Buy new position → Verify limit order price matches Tiingo
6. **Multiple Strategies**: User has 3 active strategies → All execute independently

### 11.3 Load Tests

**Simulate**:
- 100 concurrent users
- 500 unique tickers
- 1,000 strategy executions
- 10,000 orders submitted

**Measure**:
- Pricing latency (target: <3s for 500 tickers)
- Execution latency (target: <30s for 100 users)
- Database query time (target: <100ms per query)
- Memory usage (target: <500MB peak)

### 11.4 Security Tests

**Validate**:
- Encrypted credentials cannot be decrypted without key
- User A cannot access User B's strategies
- SQL injection attempts blocked
- CSRF protection working
- Rate limiting prevents brute force

---

## 12. Documentation

### 12.1 User Documentation

**Create**:
- "Getting Started with Live Trading" guide
- "How to Connect Your Alpaca Account" tutorial
- "Understanding Daily Execution" explainer
- "Troubleshooting Common Errors" FAQ

**Publish** to: Help center / in-app documentation

### 12.2 Developer Documentation

**Create**:
- Architecture diagram (system components)
- Data flow diagram (3:50 PM pricing → 3:55 PM execution)
- Database schema documentation
- API endpoint reference
- Deployment guide

**Publish** to: Internal wiki / README.md

---

## 13. Success Criteria

### 13.1 Launch Criteria (Must have before production)

- [ ] Batch pricing works with <3s latency for 500 tickers
- [ ] Credential encryption passes security audit
- [ ] Cron jobs execute reliably in staging for 7 consecutive days
- [ ] All API routes covered by integration tests
- [ ] User documentation published
- [ ] Monitoring and alerting configured

### 13.2 Post-Launch Metrics (Track for 30 days)

**Target**:
- 99.9% execution success rate (≤1 failure per 1,000 executions)
- <0.1% pricing deviation (Tiingo vs actual fill price)
- <5s average end-to-end latency (pricing + execution)
- Zero security incidents
- 50+ users with active strategies

---

## 14. Open Questions

1. **Legal Disclaimer**: Do we need a lawyer to draft the disclaimer for the Live Trading tab?
   - Recommendation: Yes, consult lawyer for "not investment advice" language

2. **Market Hours**: Should we support after-hours trading or only regular hours?
   - Recommendation: Regular hours only (9:30 AM - 4:00 PM EST) for MVP

3. **Fractional Shares**: Alpaca supports fractional shares - should we use them?
   - Recommendation: Yes, enable fractional shares for more precise allocations

4. **Order Types**: Should we support stop-loss or take-profit orders?
   - Recommendation: No for MVP, add in future enhancement

5. **Multi-Day Strategies**: What if user's strategy requires more than 1 day of data?
   - Recommendation: Backtest engine already handles historical data, no issue

---

## 15. Appendix

### 15.1 Tiingo IEX API Reference

**Docs**: https://api.tiingo.com/documentation/iex
**Rate Limits**: 5,000 requests/hour, 50,000 requests/day
**Pricing**: $79/month for IEX Real-Time plan (already subscribed)

### 15.2 Alpaca API Reference

**Docs**: https://alpaca.markets/docs/api-references/trading-api/
**Paper Trading**: https://paper-api.alpaca.markets
**Live Trading**: https://api.alpaca.markets
**Rate Limits**: 200 requests/minute

### 15.3 Example Execution Log

```json
{
  "id": 1,
  "user_id": 42,
  "strategy_id": 7,
  "executed_at": "2026-01-16T15:55:00.000Z",
  "account_value": 12345.67,
  "target_allocations": {
    "SPY": 0.60,
    "BIL": 0.40
  },
  "trades_json": {
    "sells": [
      { "symbol": "QQQ", "qty": 10, "reason": "exit" }
    ],
    "buys": [
      { "symbol": "SPY", "qty": 16, "limitPrice": 450.32, "reason": "increase" },
      { "symbol": "BIL", "qty": 54, "limitPrice": 91.50, "reason": "enter" }
    ]
  },
  "execution_json": {
    "sells": [
      { "symbol": "QQQ", "qty": 10, "orderId": "abc123", "status": "filled" }
    ],
    "buys": [
      { "symbol": "SPY", "qty": 16, "orderId": "def456", "status": "accepted" },
      { "symbol": "BIL", "qty": 54, "orderId": "ghi789", "status": "accepted" }
    ],
    "errors": []
  },
  "prices_json": {
    "SPY": 450.32,
    "BIL": 91.50,
    "QQQ": 378.90
  },
  "success": true,
  "error_message": null
}
```

---

## 16. Conclusion

This FRD defines a complete live trading system using **Tiingo IEX API** for market data and **Alpaca Trade API** for order execution. The architecture minimizes platform costs (zero additional cost beyond existing Tiingo subscription) while providing users with free, commission-free live trading.

**Key Benefits**:
- **Zero cost to users**: Free Alpaca accounts, no commissions
- **Zero additional cost to platform**: Use existing Tiingo subscription
- **Simple architecture**: Daily execution at 3:55 PM EST
- **Maximum security**: AES-256-GCM encryption, audit trails
- **Regulatory simplicity**: Users own their accounts, no broker-dealer registration needed

**Next Steps**:
1. Review and approve this FRD
2. Begin Phase 1 implementation (backend infrastructure)
3. Deploy to staging for testing
4. Beta test with volunteer users
5. Launch to production

---

**Document Status**: Draft for Review
**Estimated Implementation**: 5-6 weeks
**Dependencies**: Tiingo API subscription (active), Alpaca API (free)
**Approval Required**: Product Owner, Legal (for disclaimer), Engineering Lead
