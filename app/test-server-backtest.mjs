// Test server backtest with GLD Atlas strategy
import fs from 'fs';
import { runBacktest } from './server/backtest.mjs';

const tree = JSON.parse(fs.readFileSync('C:/Users/Trader/Desktop/JSONs/QuantMage/GLD Atlas.json', 'utf8'));

console.log('Running server backtest directly...');
console.log('Tree title:', tree.title);

try {
  // Pass the tree directly as the payload, runBacktest expects the node tree
  const result = await runBacktest(tree, { mode: 'CC', costBps: 0 });

  console.log('\nCAGR:', (result.metrics?.cagr * 100).toFixed(2) + '%');
  console.log('MaxDD:', (result.metrics?.maxDD * 100).toFixed(2) + '%');

  // Show last few allocations (allocations are daily)
  const allocations = result.allocations || [];
  console.log(`\nTotal allocations: ${allocations.length}`);
  if (allocations.length > 0) {
    console.log('Sample allocation entry:', JSON.stringify(allocations[allocations.length - 1]));
  }
  console.log('\nLast 5 allocations:');
  allocations.slice(-5).forEach((a, i) => {
    if (a) {
      console.log(`  [${i}] time=${a.time}, allocation=${JSON.stringify(a.allocation)}`);
    } else {
      console.log(`  [${i}] undefined entry`);
    }
  });
} catch (err) {
  console.error('Error:', err);
}
