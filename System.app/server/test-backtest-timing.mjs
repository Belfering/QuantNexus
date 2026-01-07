/**
 * Test script to measure backtest timing breakdown
 * Run with: node server/test-backtest-timing.mjs
 */

import { runBacktest } from './backtest.mjs'

// Sample complex bot payload with multiple indicators
const complexBotPayload = {
  id: 'test-bot',
  kind: 'indicator',
  title: 'Multi-Indicator Test',
  conditions: [
    { id: 'c1', ticker: 'SPY', metric: 'RSI', window: 14, comparison: '<', value: 30 }
  ],
  children: {
    then: [{
      id: 'then-node',
      kind: 'indicator',
      title: 'Nested Indicator',
      conditions: [
        { id: 'c2', ticker: 'SPY', metric: 'SMA', window: 50, comparison: '>', rightTicker: 'SPY', rightMetric: 'SMA', rightWindow: 200 }
      ],
      children: {
        then: [{
          id: 'pos1',
          kind: 'position',
          title: 'Long SPY',
          positions: [{ ticker: 'SPY', allocation: 100 }],
          children: {}
        }],
        else: [{
          id: 'pos2',
          kind: 'position',
          title: 'Cash',
          positions: [{ ticker: 'BIL', allocation: 100 }],
          children: {}
        }]
      }
    }],
    else: [{
      id: 'else-node',
      kind: 'indicator',
      title: 'Check Volatility',
      conditions: [
        { id: 'c3', ticker: 'SPY', metric: 'Volatility', window: 20, comparison: '<', value: 20 }
      ],
      children: {
        then: [{
          id: 'pos3',
          kind: 'position',
          title: 'Bonds',
          positions: [{ ticker: 'TLT', allocation: 100 }],
          children: {}
        }],
        else: [{
          id: 'pos4',
          kind: 'position',
          title: 'Gold',
          positions: [{ ticker: 'GLD', allocation: 100 }],
          children: {}
        }]
      }
    }]
  }
}

// More complex bot with many indicators (stress test)
const stressBotPayload = {
  id: 'stress-test-bot',
  kind: 'indicator',
  title: 'Stress Test - Many Indicators',
  conditions: [
    { id: 'c1', ticker: 'SPY', metric: 'RSI', window: 14, comparison: '<', value: 30 },
    { id: 'c2', ticker: 'SPY', metric: 'RSI', window: 7, comparison: '<', value: 25 },
  ],
  children: {
    then: [{
      id: 'branch1',
      kind: 'indicator',
      title: 'Check MACD',
      conditions: [
        { id: 'c3', ticker: 'SPY', metric: 'MACD Histogram', window: 0, comparison: '>', value: 0 },
        { id: 'c4', ticker: 'QQQ', metric: 'MACD Histogram', window: 0, comparison: '>', value: 0 },
      ],
      children: {
        then: [{
          id: 'branch2',
          kind: 'indicator',
          title: 'Check Bollinger',
          conditions: [
            { id: 'c5', ticker: 'SPY', metric: 'Bollinger %B', window: 20, comparison: '<', value: 0.2 },
            { id: 'c6', ticker: 'QQQ', metric: 'Bollinger %B', window: 20, comparison: '<', value: 0.2 },
          ],
          children: {
            then: [{
              id: 'branch3',
              kind: 'indicator',
              title: 'Check ADX',
              conditions: [
                { id: 'c7', ticker: 'SPY', metric: 'ADX', window: 14, comparison: '>', value: 25 },
                { id: 'c8', ticker: 'IWM', metric: 'ADX', window: 14, comparison: '>', value: 25 },
              ],
              children: {
                then: [{
                  id: 'pos1',
                  kind: 'position',
                  title: 'Aggressive',
                  positions: [
                    { ticker: 'TQQQ', allocation: 50 },
                    { ticker: 'UPRO', allocation: 50 }
                  ],
                  children: {}
                }],
                else: [{
                  id: 'branch4',
                  kind: 'indicator',
                  title: 'Check Williams',
                  conditions: [
                    { id: 'c9', ticker: 'SPY', metric: 'Williams %R', window: 14, comparison: '<', value: -80 },
                  ],
                  children: {
                    then: [{
                      id: 'pos2',
                      kind: 'position',
                      title: 'Moderate',
                      positions: [{ ticker: 'SPY', allocation: 100 }],
                      children: {}
                    }],
                    else: [{
                      id: 'pos3',
                      kind: 'position',
                      title: 'Balanced',
                      positions: [
                        { ticker: 'SPY', allocation: 60 },
                        { ticker: 'TLT', allocation: 40 }
                      ],
                      children: {}
                    }]
                  }
                }]
              }
            }],
            else: [{
              id: 'branch5',
              kind: 'indicator',
              title: 'Check ATR',
              conditions: [
                { id: 'c10', ticker: 'SPY', metric: 'ATR %', window: 14, comparison: '<', value: 2 },
              ],
              children: {
                then: [{
                  id: 'pos4',
                  kind: 'position',
                  title: 'Low Vol',
                  positions: [{ ticker: 'QQQ', allocation: 100 }],
                  children: {}
                }],
                else: [{
                  id: 'pos5',
                  kind: 'position',
                  title: 'High Vol',
                  positions: [{ ticker: 'GLD', allocation: 100 }],
                  children: {}
                }]
              }
            }]
          }
        }],
        else: [{
          id: 'pos6',
          kind: 'position',
          title: 'Defensive',
          positions: [{ ticker: 'TLT', allocation: 100 }],
          children: {}
        }]
      }
    }],
    else: [{
      id: 'branch6',
      kind: 'indicator',
      title: 'Check CCI',
      conditions: [
        { id: 'c11', ticker: 'SPY', metric: 'CCI', window: 20, comparison: '>', value: 100 },
        { id: 'c12', ticker: 'QQQ', metric: 'CCI', window: 20, comparison: '>', value: 100 },
      ],
      children: {
        then: [{
          id: 'branch7',
          kind: 'indicator',
          title: 'Check Stochastic',
          conditions: [
            { id: 'c13', ticker: 'SPY', metric: 'Stochastic %K', window: 14, comparison: '>', value: 80 },
            { id: 'c14', ticker: 'SPY', metric: 'Stochastic %D', window: 14, comparison: '>', value: 80 },
          ],
          children: {
            then: [{
              id: 'pos7',
              kind: 'position',
              title: 'Overbought',
              positions: [{ ticker: 'BIL', allocation: 100 }],
              children: {}
            }],
            else: [{
              id: 'branch8',
              kind: 'indicator',
              title: 'Check Aroon',
              conditions: [
                { id: 'c15', ticker: 'SPY', metric: 'Aroon Oscillator', window: 25, comparison: '>', value: 50 },
              ],
              children: {
                then: [{
                  id: 'pos8',
                  kind: 'position',
                  title: 'Trending Up',
                  positions: [{ ticker: 'SPY', allocation: 100 }],
                  children: {}
                }],
                else: [{
                  id: 'pos9',
                  kind: 'position',
                  title: 'Mixed',
                  positions: [
                    { ticker: 'SPY', allocation: 50 },
                    { ticker: 'BIL', allocation: 50 }
                  ],
                  children: {}
                }]
              }
            }]
          }
        }],
        else: [{
          id: 'pos10',
          kind: 'position',
          title: 'Safe Haven',
          positions: [{ ticker: 'BIL', allocation: 100 }],
          children: {}
        }]
      }
    }]
  }
}

async function runTimingTest() {
  console.log('='.repeat(80))
  console.log('BACKTEST TIMING ANALYSIS')
  console.log('='.repeat(80))
  console.log(`Date: ${new Date().toISOString()}`)
  console.log(`Node.js: ${process.version}`)
  console.log('')

  // Test 1: Simple bot
  console.log('\n' + '-'.repeat(80))
  console.log('TEST 1: Simple Bot (4 tickers, 4 indicators)')
  console.log('-'.repeat(80))

  const start1 = performance.now()
  try {
    const result1 = await runBacktest(complexBotPayload, { mode: 'OC' })
    const time1 = performance.now() - start1
    console.log(`\nTotal time: ${time1.toFixed(0)}ms`)
    console.log(`Data points: ${result1.equity?.length || 0}`)
    console.log(`Tickers: SPY, TLT, GLD, BIL`)
  } catch (err) {
    console.error('Error:', err.message)
  }

  // Test 2: Complex bot (stress test)
  console.log('\n' + '-'.repeat(80))
  console.log('TEST 2: Complex Bot (8 tickers, 15+ indicators)')
  console.log('-'.repeat(80))

  const start2 = performance.now()
  try {
    const result2 = await runBacktest(stressBotPayload, { mode: 'OC' })
    const time2 = performance.now() - start2
    console.log(`\nTotal time: ${time2.toFixed(0)}ms`)
    console.log(`Data points: ${result2.equity?.length || 0}`)
    console.log(`Unique indicators tested: RSI(7,14), MACD, Bollinger, ADX, Williams, ATR, CCI, Stochastic, Aroon`)
  } catch (err) {
    console.error('Error:', err.message)
  }

  // Test 3: Run simple bot multiple times to measure consistency
  console.log('\n' + '-'.repeat(80))
  console.log('TEST 3: Repeated Runs (5x simple bot)')
  console.log('-'.repeat(80))

  const times = []
  for (let i = 0; i < 5; i++) {
    const start = performance.now()
    await runBacktest(complexBotPayload, { mode: 'OC' })
    times.push(performance.now() - start)
  }

  console.log(`\nRun times: ${times.map(t => t.toFixed(0) + 'ms').join(', ')}`)
  console.log(`Average: ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(0)}ms`)
  console.log(`First run: ${times[0].toFixed(0)}ms (cold cache)`)
  console.log(`Subsequent avg: ${(times.slice(1).reduce((a, b) => a + b, 0) / (times.length - 1)).toFixed(0)}ms (warm cache)`)

  console.log('\n' + '='.repeat(80))
  console.log('ANALYSIS COMPLETE')
  console.log('='.repeat(80))
}

runTimingTest().catch(console.error)
