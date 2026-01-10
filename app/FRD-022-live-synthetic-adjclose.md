# FRD-022: Live Trading Synthetic AdjClose

## Overview

For live trading signal evaluation, we need to compute a "synthetic adjClose" value that matches how backtests calculate indicators. This ensures live trading signals are identical to backtest signals.

## Problem Statement

Backtests use `adjClose` (adjusted close) prices for all indicator calculations in CC mode:
- SMA, EMA, RSI, etc. are computed from adjClose series
- Current Price comparisons use adjClose
- This prevents dividends and splits from creating false signals

However, during live trading:
- We only have real-time `close` prices (not adjClose)
- AdjClose is only available after market close when dividend/split data is applied
- Using raw close would produce different signals than backtest

## Solution: Synthetic AdjClose

Compute today's adjClose by applying today's percentage change to yesterday's known adjClose:

```javascript
const yesterdayAdjClose = getYesterdayAdjClose(ticker)  // From database
const yesterdayClose = getYesterdayClose(ticker)        // From database
const todayClose = getRealTimeClose(ticker)             // From Alpaca

const pctChange = (todayClose - yesterdayClose) / yesterdayClose
const syntheticAdjClose = yesterdayAdjClose * (1 + pctChange)
```

### Why This Works

- Yesterday's adjClose already incorporates all historical adjustments
- Today's price move (as a percentage) is the same whether measured in close or adjClose terms
- Applying that percentage to yesterdayAdjClose produces what today's adjClose will be

### Edge Cases

1. **Ex-dividend day**: The synthetic value will be slightly off because the real adjClose would account for the dividend. However, this is acceptable because:
   - The percentage move still reflects actual market action
   - The difference is typically small (1-3% for most dividends)
   - After market close, the database updates with correct adjClose

2. **Stock split day**: Similar to dividends - the real-time calculation may be off, but corrects after market close.

## Implementation

### Files to Modify

1. **server/live/allocation-generator.mjs** - Add synthetic adjClose calculation
2. **server/routes/live.mjs** - Integrate into signal evaluation

### Code Changes

```javascript
// In allocation-generator.mjs

/**
 * Compute synthetic adjClose for live trading
 * @param {string} ticker - Ticker symbol
 * @param {number} todayClose - Real-time close price from broker
 * @param {Object} db - Price database with historical data
 * @returns {number} Synthetic adjClose value
 */
function computeSyntheticAdjClose(ticker, todayClose, db) {
  const adjCloseArr = db.adjClose[ticker]
  const closeArr = db.close[ticker]

  if (!adjCloseArr || !closeArr || adjCloseArr.length < 2) {
    // Fallback to raw close if no historical data
    return todayClose
  }

  const lastIdx = adjCloseArr.length - 1
  const yesterdayAdjClose = adjCloseArr[lastIdx]
  const yesterdayClose = closeArr[lastIdx]

  if (!yesterdayClose || yesterdayClose === 0) {
    return todayClose
  }

  const pctChange = (todayClose - yesterdayClose) / yesterdayClose
  return yesterdayAdjClose * (1 + pctChange)
}

/**
 * Build live price database with synthetic adjClose values
 * @param {Object} historicalDb - Historical price database
 * @param {Object} liveQuotes - Real-time quotes from broker { ticker: closePrice }
 * @returns {Object} Price database extended with today's synthetic values
 */
function buildLivePriceDb(historicalDb, liveQuotes) {
  const liveDb = {
    dates: [...historicalDb.dates, getTodayDateString()],
    open: { ...historicalDb.open },
    high: { ...historicalDb.high },
    low: { ...historicalDb.low },
    close: { ...historicalDb.close },
    adjClose: { ...historicalDb.adjClose },
    volume: { ...historicalDb.volume }
  }

  for (const [ticker, quote] of Object.entries(liveQuotes)) {
    const syntheticAdj = computeSyntheticAdjClose(ticker, quote.close, historicalDb)

    // Append today's values to each array
    if (liveDb.open[ticker]) liveDb.open[ticker] = [...liveDb.open[ticker], quote.open]
    if (liveDb.high[ticker]) liveDb.high[ticker] = [...liveDb.high[ticker], quote.high]
    if (liveDb.low[ticker]) liveDb.low[ticker] = [...liveDb.low[ticker], quote.low]
    if (liveDb.close[ticker]) liveDb.close[ticker] = [...liveDb.close[ticker], quote.close]
    if (liveDb.adjClose[ticker]) liveDb.adjClose[ticker] = [...liveDb.adjClose[ticker], syntheticAdj]
    if (liveDb.volume[ticker]) liveDb.volume[ticker] = [...liveDb.volume[ticker], quote.volume]
  }

  return liveDb
}
```

### Integration with Backtest Engine

The live trading system should:

1. Fetch historical data from parquet files (same as backtest)
2. Get real-time quotes from Alpaca
3. Build `liveDb` using `buildLivePriceDb()`
4. Pass `liveDb` to the same `evaluateNode()` function used in backtests
5. The indicator calculations will automatically use the synthetic adjClose values

## Testing

1. Compare live signal evaluation to most recent backtest day
2. Verify that synthetic adjClose matches actual adjClose after market close
3. Test on ex-dividend days to ensure acceptable behavior

## Related

- Backtest changes: `metricAt()` and `metricAtIndex()` in `server/backtest.mjs` now use adjClose for Current Price in CC mode
- This ensures backtest signals are internally consistent, and live signals will match
