// Check if Atlas has specific dates
import { runBacktest } from './server/backtest.mjs'
import fs from 'fs'

const strategy = JSON.parse(fs.readFileSync('C:/Users/Trader/Desktop/Atlas Vix.json', 'utf-8'))
const result = await runBacktest(strategy, { mode: 'CC' })
const allocs = result.allocations || []

const checkDates = ['2017-02-27', '2017-02-28', '2018-01-26', '2013-05-16', '2017-03-01']
console.log('Checking specific dates in Atlas:')
for (const d of checkDates) {
  const a = allocs.find(x => x.date === d)
  if (a && Object.keys(a.alloc).some(k => a.alloc[k] > 0)) {
    const w = Object.entries(a.alloc).filter(([_,v]) => v > 0).map(([t,v]) => `${t}:${(v*100).toFixed(0)}%`).join(', ')
    console.log(`${d}: ${w}`)
  } else {
    console.log(`${d}: (empty)`)
  }
}

console.log(`\nTotal non-empty allocations: ${allocs.filter(a => Object.keys(a.alloc).some(k => a.alloc[k] > 0)).length}`)
