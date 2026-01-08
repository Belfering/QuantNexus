import duckdb from 'duckdb';

const db = new duckdb.Database(':memory:');
const parquetDir = 'C:/Users/Trader/Desktop/Flowchart/System.app/ticker-data/data/ticker_data_parquet';

// Load GLD data
db.all(`
  SELECT Date as date, "Adj Close" as close
  FROM read_parquet('${parquetDir}/GLD.parquet')
  ORDER BY Date
`, (err, rows) => {
  if (err) { console.error(err); return; }

  const closes = rows.map(r => r.close);
  const dates = rows.map(r => r.date);

  // Compute rolling SMA like the frontend does
  function rollingSma(arr, window) {
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      if (i < window - 1) {
        out.push(null);
      } else {
        let sum = 0;
        for (let j = 0; j < window; j++) {
          sum += arr[i - j];
        }
        out.push(sum / window);
      }
    }
    return out;
  }

  const sma30 = rollingSma(closes, 30);
  const sma40 = rollingSma(closes, 40);

  // Find Dec 12, 2025 index
  const targetDate = '2025-12-12';
  let targetIdx = -1;
  for (let i = 0; i < dates.length; i++) {
    const d = new Date(dates[i]);
    const iso = d.toISOString().slice(0, 10);
    if (iso === targetDate) {
      targetIdx = i;
      break;
    }
  }

  if (targetIdx < 0) {
    console.log('Date not found:', targetDate);
    return;
  }

  console.log('=== SMA Debug for', targetDate, '===\n');
  console.log('Index:', targetIdx);
  console.log('Close price:', closes[targetIdx]?.toFixed(2));
  console.log('');
  console.log('30d SMA:', sma30[targetIdx]?.toFixed(4));
  console.log('40d SMA:', sma40[targetIdx]?.toFixed(4));
  console.log('');
  console.log('30d > 40d?:', sma30[targetIdx] > sma40[targetIdx]);

  // Also check the last few days
  console.log('\n=== Last 5 days ===');
  for (let i = targetIdx - 4; i <= targetIdx; i++) {
    const d = new Date(dates[i]);
    const iso = d.toISOString().slice(0, 10);
    console.log(`${iso}: close=${closes[i]?.toFixed(2)}, 30dSMA=${sma30[i]?.toFixed(4)}, 40dSMA=${sma40[i]?.toFixed(4)}, 30>40=${sma30[i] > sma40[i]}`);
  }

  process.exit(0);
});
