// Debug the backend's evaluation of Medium Term Momentum on Dec 12, 2025
import fs from 'fs';
import duckdb from 'duckdb';

const tree = JSON.parse(fs.readFileSync('C:/Users/Trader/Desktop/JSONs/QuantMage/GLD Atlas.json', 'utf8'));
const parquetDir = 'C:/Users/Trader/Desktop/Flowchart/System.app/ticker-data/data/ticker_data_parquet';

const db = new duckdb.Database(':memory:');

const targetDate = '2025-12-12';

async function loadData(ticker) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT Date as date, "Adj Close" as close
      FROM read_parquet('${parquetDir}/${ticker}.parquet')
      ORDER BY Date
    `, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function calcSMA(closes, endIndex, window) {
  if (endIndex < window - 1) return null;
  let sum = 0;
  for (let j = 0; j < window; j++) {
    sum += closes[endIndex - j];
  }
  return sum / window;
}

async function main() {
  console.log('=== Backend MTM Debug for', targetDate, '===\n');

  const gldData = await loadData('GLD');
  const closes = gldData.map(r => r.close);
  const dates = gldData.map(r => {
    const d = new Date(r.date);
    return d.toISOString().slice(0, 10);
  });

  const targetIdx = dates.indexOf(targetDate);
  if (targetIdx < 0) {
    console.log('Target date not found');
    process.exit(1);
  }

  console.log('Target index:', targetIdx);
  console.log('Close price on', targetDate, ':', closes[targetIdx]);

  // Calculate SMAs
  const sma30 = calcSMA(closes, targetIdx, 30);
  const sma40 = calcSMA(closes, targetIdx, 40);

  console.log('\n--- SMA Calculations ---');
  console.log('GLD 30d SMA:', sma30?.toFixed(6));
  console.log('GLD 40d SMA:', sma40?.toFixed(6));
  console.log('30d > 40d?:', sma30 > sma40);

  // Now check what the backend metricAt function would compute
  // The backend uses indicatorIndex which is typically decisionIndex
  // Let's verify the SMA calculation matches

  console.log('\n--- Condition Details ---');
  console.log('Condition: 30d SMA of GLD > 40d SMA of GLD');
  console.log('Left value:', sma30?.toFixed(6));
  console.log('Right value:', sma40?.toFixed(6));
  console.log('Comparator: gt');
  console.log('Result:', sma30 > sma40 ? 'TRUE → then branch' : 'FALSE → else branch');

  // Show last few days
  console.log('\n--- Last 10 days ---');
  for (let i = targetIdx - 9; i <= targetIdx; i++) {
    const s30 = calcSMA(closes, i, 30);
    const s40 = calcSMA(closes, i, 40);
    console.log(`${dates[i]}: close=${closes[i]?.toFixed(2)}, 30d=${s30?.toFixed(4)}, 40d=${s40?.toFixed(4)}, 30>40=${s30 > s40}`);
  }

  process.exit(0);
}

main().catch(console.error);
