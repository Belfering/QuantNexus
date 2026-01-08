import duckdb from 'duckdb';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PARQUET_DIR = path.join(__dirname, 'ticker-data', 'data', 'ticker_data_parquet');
const db = new duckdb.Database(':memory:');

const filePath = PARQUET_DIR.replace(/\\/g, '/') + '/SPY.parquet';
const sql = `
  SELECT Date, Close
  FROM read_parquet('${filePath}')
  WHERE Date >= '2025-01-01'
  ORDER BY Date ASC
`;

db.all(sql, (err, rows) => {
  if (err) { console.error(err); return; }

  const closes = rows.map(r => ({ date: r.Date, close: Number(r.Close) }));
  console.log('Total days in 2025:', closes.length);

  // Calculate 9-day max drawdown for each day
  let triggerCount = 0;
  const triggers = [];

  for (let i = 8; i < closes.length; i++) {
    const windowStart = i - 8; // 9 days including today
    let peak = -Infinity;
    let maxDd = 0;

    for (let j = windowStart; j <= i; j++) {
      const v = closes[j].close;
      if (v > peak) peak = v;
      if (peak > 0) {
        const dd = v / peak - 1;
        if (dd < maxDd) maxDd = dd;
      }
    }

    const ddPositive = Math.abs(maxDd);
    const triggered = ddPositive < 0.01; // less than 1%

    if (triggered) {
      triggerCount++;
      triggers.push({ date: closes[i].date, dd: (ddPositive * 100).toFixed(3) + '%' });
    }
  }

  console.log('Days where 9d Max DD < 1%:', triggerCount, 'out of', closes.length - 8);
  console.log('\nTriggers:');
  triggers.forEach(t => console.log('  ', t.date, '-', t.dd));

  db.close();
});
