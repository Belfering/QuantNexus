/**
 * Batch endpoint vs multiple WASM calls
 * This shows where the Rust server wins
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const wasm = require('./pkg/flowchart_indicators.js');

function generateData(size) {
    const closes = [], highs = [], lows = [];
    let price = 100;
    for (let i = 0; i < size; i++) {
        price += (Math.random() - 0.5) * 2;
        const high = price + Math.random() * 2;
        const low = price - Math.random() * 2;
        closes.push(price);
        highs.push(high);
        lows.push(Math.max(0.1, low));
    }
    return { closes, highs, lows };
}

// WASM: 10 separate indicator calls
function wasmAllIndicators(closes, highs, lows) {
    const c = new Float64Array(closes);
    const h = new Float64Array(highs);
    const l = new Float64Array(lows);

    return {
        sma_20: wasm.Indicators.sma(c, 20),
        sma_50: wasm.Indicators.sma(c, 50),
        ema_12: wasm.Indicators.ema(c, 12),
        ema_26: wasm.Indicators.ema(c, 26),
        rsi_14: wasm.Indicators.rsi(c, 14),
        roc_10: wasm.Indicators.roc(c, 10),
        price_vs_sma_50: wasm.Indicators.price_vs_sma_js(c, 50),
        rolling_return_20: wasm.Indicators.rolling_return(c, 20),
        ulcer_index_14: wasm.Indicators.ulcer_index_js(c, 14),
        max_drawdown: wasm.Indicators.max_drawdown_ratio(c),
        atr_14: wasm.Indicators.atr(h, l, c, 14),
    };
}

// Server: 1 batch call
async function serverBatch(closes, highs, lows) {
    const res = await fetch('http://localhost:3030/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ closes, highs, lows })
    });
    return res.json();
}

console.log('='.repeat(60));
console.log('Batch: 11 indicators per ticker');
console.log('='.repeat(60));

for (const size of [1000, 5000, 10000]) {
    console.log(`\n--- ${size.toLocaleString()} bars per ticker ---`);

    const { closes, highs, lows } = generateData(size);
    const iterations = 50;

    // WASM benchmark
    const wasmStart = performance.now();
    for (let i = 0; i < iterations; i++) {
        wasmAllIndicators(closes, highs, lows);
    }
    const wasmTime = (performance.now() - wasmStart) / iterations;

    // Server benchmark
    const serverStart = performance.now();
    for (let i = 0; i < iterations; i++) {
        await serverBatch(closes, highs, lows);
    }
    const serverTime = (performance.now() - serverStart) / iterations;

    console.log(`WASM (11 calls):    ${wasmTime.toFixed(3)}ms`);
    console.log(`Server (1 batch):   ${serverTime.toFixed(3)}ms`);
    console.log(`Winner: ${wasmTime < serverTime ? 'WASM' : 'Server'} (${(Math.max(wasmTime, serverTime) / Math.min(wasmTime, serverTime)).toFixed(1)}x)`);
}

// Now test multiple tickers
console.log('\n' + '='.repeat(60));
console.log('Processing 50 tickers (simulating backtest)');
console.log('='.repeat(60));

const TICKERS = 50;
const BARS = 2000;

const tickerData = Array.from({ length: TICKERS }, () => generateData(BARS));

// WASM: process all tickers sequentially
const wasmStart = performance.now();
for (const { closes, highs, lows } of tickerData) {
    wasmAllIndicators(closes, highs, lows);
}
const wasmTotal = performance.now() - wasmStart;

// Server: process all tickers (could be parallelized)
const serverStart = performance.now();
await Promise.all(tickerData.map(({ closes, highs, lows }) =>
    serverBatch(closes, highs, lows)
));
const serverTotal = performance.now() - serverStart;

console.log(`\nWASM (sequential):     ${wasmTotal.toFixed(1)}ms`);
console.log(`Server (parallel):     ${serverTotal.toFixed(1)}ms`);
console.log(`Winner: ${wasmTotal < serverTotal ? 'WASM' : 'Server'} (${(Math.max(wasmTotal, serverTotal) / Math.min(wasmTotal, serverTotal)).toFixed(1)}x)`);

console.log('\n' + '='.repeat(60));
