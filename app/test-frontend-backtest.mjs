import fs from 'fs';

// Load GLD candles and compute 10d RSI
async function fetchCandles(ticker) {
  const res = await fetch(`http://localhost:8787/api/candles/${ticker}?limit=20000`);
  if (!res.ok) {
    console.error(`Failed to fetch ${ticker}:`, res.status);
    return null;
  }
  const data = await res.json();
  return data.candles;  // Extract candles array from response
}

// Wilder RSI calculation
function calculateWilderRsi(closes, period) {
  const results = new Array(closes.length).fill(null);

  // Calculate gains and losses
  const gains = [];
  const losses = [];
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);
  }

  // Initial average using SMA
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
  }
  avgGain /= period;
  avgLoss /= period;

  // First RSI value
  if (avgLoss === 0) {
    results[period] = 100;
  } else {
    const rs = avgGain / avgLoss;
    results[period] = 100 - (100 / (1 + rs));
  }

  // Subsequent values using Wilder smoothing
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;

    if (avgLoss === 0) {
      results[i + 1] = 100;
    } else {
      const rs = avgGain / avgLoss;
      results[i + 1] = 100 - (100 / (1 + rs));
    }
  }

  return results;
}

// SMA calculation
function calculateSma(values, period) {
  const results = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += values[j];
    }
    results[i] = sum / period;
  }
  return results;
}

function buildPriceDbSimple(series) {
  const byTicker = new Map();
  let overlapStart = 0;
  let overlapEnd = Number.POSITIVE_INFINITY;

  for (const s of series) {
    const t = s.ticker;
    const map = new Map();
    for (const b of s.bars) map.set(Number(b.time), { adjClose: Number(b.adjClose) });
    byTicker.set(t, map);

    const times = s.bars.map(b => Number(b.time)).sort((a, b) => a - b);
    if (times.length === 0) continue;

    if (times[0] > overlapStart) overlapStart = times[0];
    overlapEnd = Math.min(overlapEnd, times[times.length - 1]);
  }

  let intersection = null;
  for (const [ticker, map] of byTicker) {
    const set = new Set();
    for (const time of map.keys()) {
      if (time >= overlapStart && time <= overlapEnd) set.add(time);
    }
    if (intersection == null) {
      intersection = set;
    } else {
      const next = new Set();
      for (const t of intersection) if (set.has(t)) next.add(t);
      intersection = next;
    }
  }

  const dates = Array.from(intersection || new Set()).sort((a, b) => a - b);
  const adjClose = {};
  for (const [ticker, map] of byTicker) {
    adjClose[ticker] = dates.map(d => (map.get(Number(d))?.adjClose ?? null));
  }

  return { dates, adjClose };
}

async function main() {
  // Fetch data for GLD and GDX
  const gldData = await fetchCandles('GLD');
  const gdxData = await fetchCandles('GDX');

  if (!gldData || !gdxData) {
    console.log('Failed to fetch data');
    return;
  }

  console.log('GLD bars:', gldData.length);
  console.log('GDX bars:', gdxData.length);

  // Test 1: Raw data (no intersection)
  console.log('\n=== TEST 1: Raw data (no intersection) ===');

  // Find Dec 11 and Dec 12 indices
  const findIndex = (data, targetDate) => {
    for (let i = 0; i < data.length; i++) {
      const date = new Date(data[i].time * 1000).toISOString().slice(0, 10);
      if (date === targetDate) return i;
    }
    return -1;
  };

  // Build adjClose arrays
  const gldCloses = gldData.map(b => b.adjClose);
  const gdxCloses = gdxData.map(b => b.adjClose);

  // Calculate RSI
  const gldRsi = calculateWilderRsi(gldCloses, 10);
  const gdxRsi = calculateWilderRsi(gdxCloses, 10);

  // Calculate SMA
  const gldSma30 = calculateSma(gldCloses, 30);
  const gldSma40 = calculateSma(gldCloses, 40);
  const gldSma50 = calculateSma(gldCloses, 50);
  const gldSma200 = calculateSma(gldCloses, 200);

  // Check Dec 11 and Dec 12 for both
  for (const targetDate of ['2025-12-11', '2025-12-12']) {
    console.log(`\n=== ${targetDate} ===`);

    const gldIdx = findIndex(gldData, targetDate);
    const gdxIdx = findIndex(gdxData, targetDate);

    if (gldIdx >= 0) {
      console.log(`GLD index: ${gldIdx}`);
      console.log(`  10d RSI: ${gldRsi[gldIdx]?.toFixed(2)}`);
      console.log(`  10d RSI > 70: ${gldRsi[gldIdx] > 70}`);
      console.log(`  30d SMA: ${gldSma30[gldIdx]?.toFixed(4)}`);
      console.log(`  40d SMA: ${gldSma40[gldIdx]?.toFixed(4)}`);
      console.log(`  50d SMA: ${gldSma50[gldIdx]?.toFixed(4)}`);
      console.log(`  200d SMA: ${gldSma200[gldIdx]?.toFixed(4)}`);
      console.log(`  30d SMA > 40d SMA (MTM): ${gldSma30[gldIdx] > gldSma40[gldIdx]}`);
      console.log(`  50d SMA > 200d SMA (LTM): ${gldSma50[gldIdx] > gldSma200[gldIdx]}`);
    } else {
      console.log(`GLD: date not found`);
    }

    if (gdxIdx >= 0) {
      console.log(`GDX index: ${gdxIdx}`);
      console.log(`  10d RSI: ${gdxRsi[gdxIdx]?.toFixed(2)}`);
      console.log(`  10d RSI > 70: ${gdxRsi[gdxIdx] > 70}`);
    } else {
      console.log(`GDX: date not found`);
    }

    // Numbered node evaluation
    // Quantifier: "any" of (GLD RSI > 70, GDX RSI > 70)
    if (gldIdx >= 0 && gdxIdx >= 0) {
      const gldCondition = gldRsi[gldIdx] > 70;
      const gdxCondition = gdxRsi[gdxIdx] > 70;
      const numberedAny = gldCondition || gdxCondition;
      console.log(`  Numbered "any" (GLD>70 OR GDX>70): ${numberedAny}`);
    }
  }

  // Test 2: With date intersection (simulating what frontend does)
  console.log('\n\n=== TEST 2: With date intersection ===');
  const db = buildPriceDbSimple([
    { ticker: 'GLD', bars: gldData },
    { ticker: 'GDX', bars: gdxData }
  ]);

  console.log('Intersection dates:', db.dates.length);

  const gldClosesInt = db.adjClose['GLD'];
  const gdxClosesInt = db.adjClose['GDX'];

  const gldRsiInt = calculateWilderRsi(gldClosesInt, 10);
  const gdxRsiInt = calculateWilderRsi(gdxClosesInt, 10);
  const gldSma30Int = calculateSma(gldClosesInt, 30);
  const gldSma40Int = calculateSma(gldClosesInt, 40);
  const gldSma50Int = calculateSma(gldClosesInt, 50);
  const gldSma200Int = calculateSma(gldClosesInt, 200);

  // Find Dec 12 in intersection
  const dec12Time = db.dates.find(t => new Date(t * 1000).toISOString().slice(0, 10) === '2025-12-12');
  const dec12IntIdx = db.dates.indexOf(dec12Time);
  const dec11Time = db.dates.find(t => new Date(t * 1000).toISOString().slice(0, 10) === '2025-12-11');
  const dec11IntIdx = db.dates.indexOf(dec11Time);

  for (const [targetDate, idx] of [['2025-12-11', dec11IntIdx], ['2025-12-12', dec12IntIdx]]) {
    console.log(`\n=== ${targetDate} (intersection index ${idx}) ===`);
    if (idx >= 0) {
      console.log('GLD:');
      console.log(`  10d RSI: ${gldRsiInt[idx]?.toFixed(2)}`);
      console.log(`  30d SMA: ${gldSma30Int[idx]?.toFixed(4)}`);
      console.log(`  40d SMA: ${gldSma40Int[idx]?.toFixed(4)}`);
      console.log(`  50d SMA: ${gldSma50Int[idx]?.toFixed(4)}`);
      console.log(`  200d SMA: ${gldSma200Int[idx]?.toFixed(4)}`);
      console.log(`  LTM (50d > 200d): ${gldSma50Int[idx] > gldSma200Int[idx]}`);
      console.log(`  MTM (30d > 40d): ${gldSma30Int[idx] > gldSma40Int[idx]}`);

      console.log('GDX:');
      console.log(`  10d RSI: ${gdxRsiInt[idx]?.toFixed(2)}`);

      console.log('Numbered any (GLD RSI>70 OR GDX RSI>70):', gldRsiInt[idx] > 70 || gdxRsiInt[idx] > 70);
    } else {
      console.log('Date not found in intersection');
    }
  }
}

main();
