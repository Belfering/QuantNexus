#!/usr/bin/env node
/**
 * Compare Node.js vs Rust backtest engines
 * Usage: node compare_engines.mjs [strategy.json]
 *
 * This script runs the same strategy on both engines and compares results.
 * No code is modified - it just calls both APIs and shows differences.
 */

import fs from 'fs'

const NODE_SERVER = 'http://localhost:8787'
const RUST_SERVER = 'http://localhost:3030'

// Simple test strategy: 100% SPY
const DEFAULT_STRATEGY = {
  id: 'test-root',
  kind: 'basic',
  title: 'Test Strategy',
  weighting: 'equal',
  children: {
    next: [{
      id: 'test-pos',
      kind: 'position',
      title: 'SPY Position',
      positions: [{ ticker: 'SPY', weight: 1 }],
      weighting: 'equal',
      children: { next: [null] }
    }]
  }
}

async function runNodeBacktest(strategy) {
  console.log('\n[Node.js] Running backtest...')
  const start = performance.now()

  try {
    const res = await fetch(`${NODE_SERVER}/api/backtest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payload: JSON.stringify(strategy),
        mode: 'CC',
        costBps: 5,
        customIndicators: []
      })
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`HTTP ${res.status}: ${err}`)
    }

    const data = await res.json()
    const elapsed = performance.now() - start
    console.log(`[Node.js] Completed in ${elapsed.toFixed(0)}ms`)
    return { data, elapsed, engine: 'Node.js' }
  } catch (e) {
    console.log(`[Node.js] Error: ${e.message}`)
    return null
  }
}

async function runRustBacktest(strategy) {
  console.log('\n[Rust] Running backtest...')
  const start = performance.now()

  try {
    // Rust expects: { payload: JSON.stringify(strategy), mode: "CC", cost_bps: 5 }
    const res = await fetch(`${RUST_SERVER}/api/backtest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payload: JSON.stringify(strategy),
        mode: 'CC',
        cost_bps: 5
      })
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`HTTP ${res.status}: ${err}`)
    }

    const data = await res.json()
    const elapsed = performance.now() - start
    console.log(`[Rust] Completed in ${elapsed.toFixed(0)}ms`)
    return { data, elapsed, engine: 'Rust' }
  } catch (e) {
    console.log(`[Rust] Error: ${e.message}`)
    return null
  }
}

function extractMetrics(result, engine) {
  if (!result?.data) return null

  const m = result.data.metrics || {}

  // Handle different field naming conventions
  return {
    engine,
    elapsed: result.elapsed,
    cagr: m.cagr ?? 0,
    maxDrawdown: m.maxDrawdown ?? m.max_drawdown ?? 0,
    sharpe: m.sharpe ?? m.sharpeRatio ?? 0,
    sortino: m.sortino ?? m.sortinoRatio ?? 0,
    calmar: m.calmar ?? m.calmarRatio ?? 0,
    vol: m.vol ?? m.volatility ?? 0,
    winRate: m.winRate ?? m.win_rate ?? 0,
    days: m.days ?? m.tradingDays ?? 0,
    equityPoints: result.data.equityCurve?.length ?? 0
  }
}

function compareMetrics(nodeMetrics, rustMetrics) {
  if (!nodeMetrics || !rustMetrics) {
    console.log('\n Cannot compare - one or both engines failed')
    return
  }

  console.log('\n' + '='.repeat(70))
  console.log('COMPARISON RESULTS')
  console.log('='.repeat(70))

  const fmt = (v, pct = false) => {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—'
    return pct ? `${(v * 100).toFixed(4)}%` : v.toFixed(4)
  }

  const diff = (a, b) => {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return '—'
    const d = Math.abs(a - b)
    if (d < 0.0001) return '✓ Match'
    return `Δ ${d.toFixed(6)}`
  }

  const metrics = [
    { name: 'Time (ms)', node: nodeMetrics.elapsed.toFixed(0), rust: rustMetrics.elapsed.toFixed(0), diff: `${(nodeMetrics.elapsed / rustMetrics.elapsed).toFixed(1)}x` },
    { name: 'CAGR', node: fmt(nodeMetrics.cagr, true), rust: fmt(rustMetrics.cagr, true), diff: diff(nodeMetrics.cagr, rustMetrics.cagr) },
    { name: 'Max DD', node: fmt(nodeMetrics.maxDrawdown, true), rust: fmt(rustMetrics.maxDrawdown, true), diff: diff(nodeMetrics.maxDrawdown, rustMetrics.maxDrawdown) },
    { name: 'Sharpe', node: fmt(nodeMetrics.sharpe), rust: fmt(rustMetrics.sharpe), diff: diff(nodeMetrics.sharpe, rustMetrics.sharpe) },
    { name: 'Sortino', node: fmt(nodeMetrics.sortino), rust: fmt(rustMetrics.sortino), diff: diff(nodeMetrics.sortino, rustMetrics.sortino) },
    { name: 'Calmar', node: fmt(nodeMetrics.calmar), rust: fmt(rustMetrics.calmar), diff: diff(nodeMetrics.calmar, rustMetrics.calmar) },
    { name: 'Volatility', node: fmt(nodeMetrics.vol, true), rust: fmt(rustMetrics.vol, true), diff: diff(nodeMetrics.vol, rustMetrics.vol) },
    { name: 'Win Rate', node: fmt(nodeMetrics.winRate, true), rust: fmt(rustMetrics.winRate, true), diff: diff(nodeMetrics.winRate, rustMetrics.winRate) },
    { name: 'Days', node: nodeMetrics.days, rust: rustMetrics.days, diff: nodeMetrics.days === rustMetrics.days ? '✓ Match' : `Δ ${Math.abs(nodeMetrics.days - rustMetrics.days)}` },
    { name: 'Equity Pts', node: nodeMetrics.equityPoints, rust: rustMetrics.equityPoints, diff: nodeMetrics.equityPoints === rustMetrics.equityPoints ? '✓ Match' : `Δ ${Math.abs(nodeMetrics.equityPoints - rustMetrics.equityPoints)}` },
  ]

  console.log(`\n${'Metric'.padEnd(14)} ${'Node.js'.padEnd(16)} ${'Rust'.padEnd(16)} ${'Difference'}`)
  console.log('-'.repeat(70))

  for (const m of metrics) {
    console.log(`${m.name.padEnd(14)} ${String(m.node).padEnd(16)} ${String(m.rust).padEnd(16)} ${m.diff}`)
  }

  console.log('\n' + '='.repeat(70))
}

async function main() {
  const strategyFile = process.argv[2]
  let strategy = DEFAULT_STRATEGY

  if (strategyFile) {
    console.log(`Loading strategy from: ${strategyFile}`)
    const content = fs.readFileSync(strategyFile, 'utf-8')
    strategy = JSON.parse(content)
  } else {
    console.log('Using default 100% SPY strategy')
  }

  console.log('\nMake sure both servers are running:')
  console.log(`  - Node.js: ${NODE_SERVER} (cd app && npm run api)`)
  console.log(`  - Rust:    ${RUST_SERVER} (cd rust-indicators && cargo run --release --bin backtest_server)`)

  // Run both backtests
  const nodeResult = await runNodeBacktest(strategy)
  const rustResult = await runRustBacktest(strategy)

  // Extract and compare metrics
  const nodeMetrics = extractMetrics(nodeResult, 'Node.js')
  const rustMetrics = extractMetrics(rustResult, 'Rust')

  compareMetrics(nodeMetrics, rustMetrics)
}

main().catch(console.error)
