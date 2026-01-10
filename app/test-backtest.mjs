// Test backtest with Atlas Vix strategy
import { runBacktest } from './server/backtest.mjs'
import fs from 'fs'

const strategy = JSON.parse(fs.readFileSync('C:/Users/Trader/Desktop/Atlas Vix.json', 'utf-8'))

console.log('Running backtest...')
const result = await runBacktest(strategy, { mode: 'CC' })

const metrics = result.metrics || {}
console.log('\n=== Equity Curve Start ===')
if (result.equityCurve && result.equityCurve.length > 0) {
  console.log('First point:', result.equityCurve[0])
  console.log('Second point:', result.equityCurve[1])
}
console.log('\n=== Backtest Summary ===')
console.log(`CAGR: ${metrics.cagr != null ? (metrics.cagr * 100).toFixed(2) : 'N/A'}%`)
console.log(`Max Drawdown: ${metrics.maxDrawdown != null ? (metrics.maxDrawdown * 100).toFixed(2) : 'N/A'}%`)
console.log(`Sharpe: ${metrics.sharpe != null ? metrics.sharpe.toFixed(2) : 'N/A'}`)

const allocs = result.allocations || []
console.log(`\n=== Allocations (${allocs.length} total) ===`)
console.log('First 20:')
const nonEmpty = allocs.filter(a => Object.keys(a.alloc || {}).length > 0).slice(0, 20)
for (const a of nonEmpty) {
  const weights = Object.entries(a.alloc || {})
    .filter(([_, w]) => w > 0)
    .map(([t, w]) => `${t}:${(w*100).toFixed(0)}%`)
    .join(', ')
  console.log(`${a.date}: ${weights}`)
}

console.log('\n=== Check for 9/14/2012 ===')
const sept14 = allocs.find(a => a.date && a.date.includes('2012-09-14'))
if (sept14 && Object.keys(sept14.alloc || {}).length > 0) {
  console.log('FOUND 9/14/2012:', sept14)
} else {
  console.log('9/14/2012 NOT in allocations (correct!)')
}

console.log('\n=== Check for 1/30/2013 (should be 100% UVXY) ===')
const jan30 = allocs.find(a => a.date && a.date.includes('2013-01-30'))
if (jan30 && Object.keys(jan30.alloc || {}).length > 0) {
  console.log('FOUND 1/30/2013:', jan30)
} else {
  console.log('1/30/2013 NOT in allocations')
}
