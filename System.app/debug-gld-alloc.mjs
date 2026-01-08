import fs from 'fs';
import duckdb from 'duckdb';

// Load the GLD Atlas tree
const tree = JSON.parse(fs.readFileSync('C:/Users/Trader/Desktop/JSONs/QuantMage/GLD Atlas.json', 'utf8'));

// Target date for debugging
const targetDate = '2025-12-12';

// Load price data
const db = new duckdb.Database(':memory:');
const parquetDir = 'C:/Users/Trader/Desktop/Flowchart/System.app/ticker-data/data/ticker_data_parquet';

async function loadData(ticker) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT Date as date, "Adj Close" as close
      FROM read_parquet('${parquetDir}/${ticker}.parquet')
      WHERE Date <= '${targetDate}'
      ORDER BY Date
    `, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function calcRSI(prices, period) {
  if (prices.length < period + 1) return null;

  // Get last period+1 prices
  const recent = prices.slice(-period - 1);
  const changes = [];
  for (let i = 1; i < recent.length; i++) {
    changes.push(recent[i].close - recent[i-1].close);
  }

  // SMA-based RSI for simplicity
  let gains = 0, losses = 0;
  for (const c of changes) {
    if (c > 0) gains += c;
    else losses += Math.abs(c);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calcSMA(prices, period) {
  if (prices.length < period) return null;
  const recent = prices.slice(-period);
  const sum = recent.reduce((a, b) => a + b.close, 0);
  return sum / period;
}

async function main() {
  console.log(`\n=== GLD Atlas Allocation Debug for ${targetDate} ===\n`);

  // Load required tickers
  const tickers = ['GLD', 'GDX', 'UUP', 'UGL'];
  const data = {};
  for (const t of tickers) {
    try {
      data[t] = await loadData(t);
      console.log(`Loaded ${t}: ${data[t].length} rows`);
    } catch (e) {
      console.log(`Failed to load ${t}: ${e.message}`);
    }
  }

  // Calculate indicators
  const gld10rsi = calcRSI(data.GLD, 10);
  const gld20rsi = calcRSI(data.GLD, 20);
  const gdx10rsi = calcRSI(data.GDX, 10);
  const gld30sma = calcSMA(data.GLD, 30);
  const gld40sma = calcSMA(data.GLD, 40);
  const gld50sma = calcSMA(data.GLD, 50);
  const gld200sma = calcSMA(data.GLD, 200);

  console.log('\n--- Indicator Values ---');
  console.log(`GLD RSI 10: ${gld10rsi?.toFixed(2)}`);
  console.log(`GLD RSI 20: ${gld20rsi?.toFixed(2)}`);
  console.log(`GDX RSI 10: ${gdx10rsi?.toFixed(2)}`);
  console.log(`GLD SMA 30: ${gld30sma?.toFixed(2)}`);
  console.log(`GLD SMA 40: ${gld40sma?.toFixed(2)}`);
  console.log(`GLD SMA 50: ${gld50sma?.toFixed(2)}`);
  console.log(`GLD SMA 200: ${gld200sma?.toFixed(2)}`);

  // Evaluate scaling nodes
  console.log('\n--- Scaling Node 1 (GLD RSI 10, from 20 to 10) ---');
  const s1 = { from: 20, to: 10, val: gld10rsi };
  const s1Inverted = s1.from > s1.to;
  const s1Low = s1Inverted ? s1.to : s1.from;
  const s1High = s1Inverted ? s1.from : s1.to;
  let s1Then, s1Else;
  if (s1.val <= s1Low) {
    s1Then = s1Inverted ? 0 : 1;
  } else if (s1.val >= s1High) {
    s1Then = s1Inverted ? 1 : 0;
  } else {
    const ratio = (s1.val - s1Low) / (s1High - s1Low);
    s1Then = s1Inverted ? ratio : (1 - ratio);
  }
  s1Else = 1 - s1Then;
  console.log(`  Inverted: ${s1Inverted}, Low: ${s1Low}, High: ${s1High}`);
  console.log(`  RSI ${gld10rsi?.toFixed(2)} >= ${s1High} → thenWeight = ${s1Then.toFixed(3)}`);

  console.log('\n--- Scaling Node 2 (GLD RSI 20, from 70 to 90) ---');
  const s2 = { from: 70, to: 90, val: gld20rsi };
  const s2Inverted = s2.from > s2.to;
  const s2Low = s2Inverted ? s2.to : s2.from;
  const s2High = s2Inverted ? s2.from : s2.to;
  let s2Then, s2Else;
  if (s2.val <= s2Low) {
    s2Then = s2Inverted ? 0 : 1;
  } else if (s2.val >= s2High) {
    s2Then = s2Inverted ? 1 : 0;
  } else {
    const ratio = (s2.val - s2Low) / (s2High - s2Low);
    s2Then = s2Inverted ? ratio : (1 - ratio);
  }
  s2Else = 1 - s2Then;
  console.log(`  Inverted: ${s2Inverted}, Low: ${s2Low}, High: ${s2High}`);
  console.log(`  RSI ${gld20rsi?.toFixed(2)} < ${s2Low} → thenWeight = ${s2Then.toFixed(3)}`);

  // Weight reaching GLD basic node
  const gldWeight = s1Then * s2Then;
  console.log(`\n--- Weight reaching "GLD " basic node: ${gldWeight.toFixed(3)} ---`);

  // SMA conditions
  console.log('\n--- Indicator Conditions ---');
  const sma50gt200 = gld50sma > gld200sma;
  const sma30gt40 = gld30sma > gld40sma;
  console.log(`  50d SMA > 200d SMA: ${sma50gt200} (${gld50sma?.toFixed(2)} vs ${gld200sma?.toFixed(2)})`);
  console.log(`  30d SMA > 40d SMA: ${sma30gt40} (${gld30sma?.toFixed(2)} vs ${gld40sma?.toFixed(2)})`);

  // Numbered conditions
  console.log('\n--- Numbered Node Conditions ---');
  const gldRsi10gt70 = gld10rsi > 70;
  const gdxRsi10gt70 = gdx10rsi > 70;
  const anyTrue = gldRsi10gt70 || gdxRsi10gt70;
  console.log(`  GLD RSI 10 > 70: ${gldRsi10gt70} (${gld10rsi?.toFixed(2)})`);
  console.log(`  GDX RSI 10 > 70: ${gdxRsi10gt70} (${gdx10rsi?.toFixed(2)})`);
  console.log(`  Any condition TRUE: ${anyTrue}`);

  // Expected allocation path
  console.log('\n--- Expected Allocation Path ---');
  if (gldWeight >= 1) {
    console.log('1. Scaling nodes: 100% to "GLD " basic node');
  } else {
    console.log(`1. Scaling nodes: ${(gldWeight * 100).toFixed(1)}% to "GLD " basic node`);
  }

  console.log('2. "GLD " basic node: equal weighting (50%/50%)');

  if (sma50gt200 && sma30gt40) {
    console.log('3. Both SMA conditions TRUE → both to Numbered nodes');
    if (anyTrue) {
      console.log('4. Numbered conditions TRUE → both to Hedged GLD (75% GLD, 25% UUP)');
      console.log(`\n=== Expected allocation: 75% GLD, 25% UUP ===`);
    } else {
      console.log('4. Numbered conditions FALSE → both to Pure GOLD');
      console.log(`\n=== Expected allocation: Pure GOLD (GLD/UGL/GDX inverse weighted) ===`);
    }
  } else if (sma50gt200) {
    console.log('3. Only 50d>200d TRUE, 30d>40d FALSE');
    console.log('   Branch 1 (50%): → Numbered');
    console.log('   Branch 2 (50%): → BWC: Mixed');
  } else if (sma30gt40) {
    console.log('3. Only 30d>40d TRUE, 50d>200d FALSE');
    console.log('   Branch 1 (50%): → BWC: Mixed');
    console.log('   Branch 2 (50%): → Numbered');
  } else {
    console.log('3. Both SMA conditions FALSE → both to BWC: Mixed');
  }

  process.exit(0);
}

main().catch(console.error);
