const fs = require('fs');
let content = fs.readFileSync('server/backtest.mjs', 'utf8');
let changesMade = 0;

// 1. Add volume arrays to cache
const oldCache = `  // High/Low arrays cache (for indicators needing OHLC)
  highArrays: new Map(),
  lowArrays: new Map(),
})`;

const newCache = `  // High/Low arrays cache (for indicators needing OHLC)
  highArrays: new Map(),
  lowArrays: new Map(),
  // Volume arrays and volume-based indicators
  volumeArrays: new Map(),
  mfi: new Map(),
  obv: new Map(),
  vwap: new Map(),
})`;

if (content.includes(oldCache)) {
  content = content.replace(oldCache, newCache);
  changesMade++;
  console.log('1. Added volume cache entries');
} else {
  console.log('1. Could not find cache section');
}

// 2. Add volume array getter function (after getCachedReturnsArray)
const afterReturnsArray = `const getCachedReturnsArray = (cache, db, ticker) => {
  const existing = cache.returnsArrays.get(ticker)
  if (existing) return existing
  const closes = getCachedCloseArray(cache, db, ticker)
  const rets = closes.map((c, i) => i === 0 ? 0 : (closes[i - 1] === 0 ? 0 : (c / closes[i - 1]) - 1))
  cache.returnsArrays.set(ticker, rets)
  return rets
}`;

const withVolumeArray = `const getCachedReturnsArray = (cache, db, ticker) => {
  const existing = cache.returnsArrays.get(ticker)
  if (existing) return existing
  const closes = getCachedCloseArray(cache, db, ticker)
  const rets = closes.map((c, i) => i === 0 ? 0 : (closes[i - 1] === 0 ? 0 : (c / closes[i - 1]) - 1))
  cache.returnsArrays.set(ticker, rets)
  return rets
}

const getCachedVolumeArray = (cache, db, ticker) => {
  const existing = cache.volumeArrays.get(ticker)
  if (existing) return existing
  const volArr = db.volume[ticker] || []
  cache.volumeArrays.set(ticker, volArr)
  return volArr
}`;

if (content.includes(afterReturnsArray)) {
  content = content.replace(afterReturnsArray, withVolumeArray);
  changesMade++;
  console.log('2. Added getCachedVolumeArray function');
} else {
  console.log('2. Could not find returns array function');
}

// 3. Add volume indicator calculation functions (after rollingPriceVsSma)
const afterPriceVsSma = `// Price relative to SMA (percent above/below)
const rollingPriceVsSma = (closes, window) => {
  const sma = rollingSma(closes, window)
  return closes.map((c, i) => sma[i] == null ? null : ((c / sma[i]) - 1) * 100)
}`;

const withVolumeIndicators = `// Price relative to SMA (percent above/below)
const rollingPriceVsSma = (closes, window) => {
  const sma = rollingSma(closes, window)
  return closes.map((c, i) => sma[i] == null ? null : ((c / sma[i]) - 1) * 100)
}

// ============================================
// VOLUME-BASED INDICATORS
// ============================================

// Money Flow Index (MFI) - RSI applied to money flow
// Uses typical price (H+L+C)/3 weighted by volume
const rollingMfi = (highs, lows, closes, volumes, window) => {
  const n = closes.length
  const result = new Array(n).fill(null)
  if (n < window + 1) return result

  // Calculate typical price and raw money flow
  const typicalPrices = closes.map((c, i) => (highs[i] + lows[i] + c) / 3)
  const rawMoneyFlow = typicalPrices.map((tp, i) => tp * (volumes[i] || 0))

  for (let i = window; i < n; i++) {
    let positiveFlow = 0
    let negativeFlow = 0

    for (let j = i - window + 1; j <= i; j++) {
      if (typicalPrices[j] > typicalPrices[j - 1]) {
        positiveFlow += rawMoneyFlow[j]
      } else if (typicalPrices[j] < typicalPrices[j - 1]) {
        negativeFlow += rawMoneyFlow[j]
      }
    }

    if (negativeFlow === 0) {
      result[i] = 100
    } else {
      const moneyFlowRatio = positiveFlow / negativeFlow
      result[i] = 100 - (100 / (1 + moneyFlowRatio))
    }
  }
  return result
}

// On Balance Volume (OBV) - Cumulative volume based on price direction
// Returns normalized OBV (percent change from window periods ago)
const rollingObv = (closes, volumes, window) => {
  const n = closes.length
  const result = new Array(n).fill(null)
  if (n < 2) return result

  // Calculate cumulative OBV
  const obv = new Array(n).fill(0)
  obv[0] = volumes[0] || 0

  for (let i = 1; i < n; i++) {
    const vol = volumes[i] || 0
    if (closes[i] > closes[i - 1]) {
      obv[i] = obv[i - 1] + vol
    } else if (closes[i] < closes[i - 1]) {
      obv[i] = obv[i - 1] - vol
    } else {
      obv[i] = obv[i - 1]
    }
  }

  // Return OBV change over window (normalized as percent)
  for (let i = window; i < n; i++) {
    const prevObv = obv[i - window]
    if (prevObv === 0) {
      result[i] = 0
    } else {
      result[i] = ((obv[i] - prevObv) / Math.abs(prevObv)) * 100
    }
  }
  return result
}

// Volume Weighted Average Price ratio (current close vs VWAP)
// Returns percent above/below VWAP over window
const rollingVwapRatio = (closes, volumes, window) => {
  const n = closes.length
  const result = new Array(n).fill(null)
  if (n < window) return result

  for (let i = window - 1; i < n; i++) {
    let sumPV = 0
    let sumV = 0

    for (let j = i - window + 1; j <= i; j++) {
      const vol = volumes[j] || 0
      sumPV += closes[j] * vol
      sumV += vol
    }

    if (sumV === 0) {
      result[i] = 0
    } else {
      const vwap = sumPV / sumV
      result[i] = ((closes[i] / vwap) - 1) * 100
    }
  }
  return result
}`;

if (content.includes(afterPriceVsSma)) {
  content = content.replace(afterPriceVsSma, withVolumeIndicators);
  changesMade++;
  console.log('3. Added volume indicator functions');
} else {
  console.log('3. Could not find price vs sma function');
}

// 4. Add volume indicators to metricAt switch (before the final return null)
const beforeReturnNull = `    case 'Price vs SMA': {
      const series = getCachedSeries(ctx.cache, 'priceVsSma', t, w, () => rollingPriceVsSma(closes, w))
      return series[i] ?? null
    }
  }
  return null
}`;

const withVolumeMetrics = `    case 'Price vs SMA': {
      const series = getCachedSeries(ctx.cache, 'priceVsSma', t, w, () => rollingPriceVsSma(closes, w))
      return series[i] ?? null
    }
    // ============================================
    // VOLUME-BASED INDICATORS
    // ============================================
    case 'Money Flow Index':
    case 'MFI': {
      const highs = getCachedHighArray(ctx.cache, ctx.db, t)
      const lows = getCachedLowArray(ctx.cache, ctx.db, t)
      const volumes = getCachedVolumeArray(ctx.cache, ctx.db, t)
      const series = getCachedSeries(ctx.cache, 'mfi', t, w, () => rollingMfi(highs, lows, closes, volumes, w))
      return series[i] ?? null
    }
    case 'OBV':
    case 'On Balance Volume': {
      const volumes = getCachedVolumeArray(ctx.cache, ctx.db, t)
      const series = getCachedSeries(ctx.cache, 'obv', t, w, () => rollingObv(closes, volumes, w))
      return series[i] ?? null
    }
    case 'VWAP Ratio':
    case 'Price vs VWAP': {
      const volumes = getCachedVolumeArray(ctx.cache, ctx.db, t)
      const series = getCachedSeries(ctx.cache, 'vwap', t, w, () => rollingVwapRatio(closes, volumes, w))
      return series[i] ?? null
    }
  }
  return null
}`;

if (content.includes(beforeReturnNull)) {
  content = content.replace(beforeReturnNull, withVolumeMetrics);
  changesMade++;
  console.log('4. Added volume metrics to metricAt');
} else {
  console.log('4. Could not find metricAt return section');
}

// 5. Also add to metricAtIndex (duplicate switch for index-based access)
const indexBeforeReturn = `    case 'Price vs SMA': {
      const series = getCachedSeries(ctx.cache, 'priceVsSma', t, w, () => rollingPriceVsSma(closes, w))
      return series[index] ?? null
    }
  }
  return null
}

// ============================================
// EVALUATION HELPERS`;

const indexWithVolume = `    case 'Price vs SMA': {
      const series = getCachedSeries(ctx.cache, 'priceVsSma', t, w, () => rollingPriceVsSma(closes, w))
      return series[index] ?? null
    }
    case 'Money Flow Index':
    case 'MFI': {
      const highs = getCachedHighArray(ctx.cache, ctx.db, t)
      const lows = getCachedLowArray(ctx.cache, ctx.db, t)
      const volumes = getCachedVolumeArray(ctx.cache, ctx.db, t)
      const series = getCachedSeries(ctx.cache, 'mfi', t, w, () => rollingMfi(highs, lows, closes, volumes, w))
      return series[index] ?? null
    }
    case 'OBV':
    case 'On Balance Volume': {
      const volumes = getCachedVolumeArray(ctx.cache, ctx.db, t)
      const series = getCachedSeries(ctx.cache, 'obv', t, w, () => rollingObv(closes, volumes, w))
      return series[index] ?? null
    }
    case 'VWAP Ratio':
    case 'Price vs VWAP': {
      const volumes = getCachedVolumeArray(ctx.cache, ctx.db, t)
      const series = getCachedSeries(ctx.cache, 'vwap', t, w, () => rollingVwapRatio(closes, volumes, w))
      return series[index] ?? null
    }
  }
  return null
}

// ============================================
// EVALUATION HELPERS`;

if (content.includes(indexBeforeReturn)) {
  content = content.replace(indexBeforeReturn, indexWithVolume);
  changesMade++;
  console.log('5. Added volume metrics to metricAtIndex');
} else {
  console.log('5. Could not find metricAtIndex return section');
}

fs.writeFileSync('server/backtest.mjs', content);
console.log(`\nDone! Made ${changesMade} change(s).`);
