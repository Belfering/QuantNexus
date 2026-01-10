/**
 * Performance Benchmark: JavaScript vs Rust/WASM vs Native CLI Indicators
 *
 * Run: node benchmark.mjs
 */

import { createRequire } from 'module';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

// Load the WASM module
const wasm = require('./pkg/flowchart_indicators.js');

// Native CLI path
const CLI_PATH = join(__dirname, 'target/release/indicators');

// Native CLI wrapper
function native_sma(values, period) {
    const input = JSON.stringify(values);
    const output = execSync(`echo '${input}' | ${CLI_PATH} sma ${period}`, { encoding: 'utf8' });
    return JSON.parse(output);
}

function native_rsi(values, period) {
    const input = JSON.stringify(values);
    const output = execSync(`echo '${input}' | ${CLI_PATH} rsi ${period}`, { encoding: 'utf8' });
    return JSON.parse(output);
}

// ============================================================================
// JavaScript Implementations (copied from backtest.mjs patterns)
// ============================================================================

function js_sma(values, period) {
    const result = new Array(values.length).fill(NaN);
    for (let i = period - 1; i < values.length; i++) {
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) {
            sum += values[j];
        }
        result[i] = sum / period;
    }
    return result;
}

function js_ema(values, period) {
    const result = new Array(values.length).fill(NaN);
    const k = 2 / (period + 1);

    // Seed with SMA
    let sum = 0;
    for (let i = 0; i < period; i++) {
        sum += values[i];
    }
    result[period - 1] = sum / period;

    for (let i = period; i < values.length; i++) {
        result[i] = values[i] * k + result[i - 1] * (1 - k);
    }
    return result;
}

function js_rsi(closes, period) {
    const result = new Array(closes.length).fill(NaN);
    const gains = [];
    const losses = [];

    for (let i = 1; i < closes.length; i++) {
        const change = closes[i] - closes[i - 1];
        gains.push(change > 0 ? change : 0);
        losses.push(change < 0 ? -change : 0);
    }

    // Wilder's smoothing
    let avgGain = 0, avgLoss = 0;
    for (let i = 0; i < period; i++) {
        avgGain += gains[i];
        avgLoss += losses[i];
    }
    avgGain /= period;
    avgLoss /= period;

    if (avgLoss === 0) {
        result[period] = 100;
    } else {
        result[period] = 100 - (100 / (1 + avgGain / avgLoss));
    }

    for (let i = period; i < gains.length; i++) {
        avgGain = (avgGain * (period - 1) + gains[i]) / period;
        avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
        if (avgLoss === 0) {
            result[i + 1] = 100;
        } else {
            result[i + 1] = 100 - (100 / (1 + avgGain / avgLoss));
        }
    }
    return result;
}

function js_atr(highs, lows, closes, period) {
    const result = new Array(closes.length).fill(NaN);
    const tr = [];

    tr.push(highs[0] - lows[0]);
    for (let i = 1; i < closes.length; i++) {
        const hl = highs[i] - lows[i];
        const hc = Math.abs(highs[i] - closes[i - 1]);
        const lc = Math.abs(lows[i] - closes[i - 1]);
        tr.push(Math.max(hl, hc, lc));
    }

    // Wilder's smoothing
    let atr = 0;
    for (let i = 0; i < period; i++) {
        atr += tr[i];
    }
    atr /= period;
    result[period - 1] = atr;

    for (let i = period; i < tr.length; i++) {
        atr = (atr * (period - 1) + tr[i]) / period;
        result[i] = atr;
    }
    return result;
}

function js_macd(closes, fast, slow, signal) {
    const emaFast = js_ema(closes, fast);
    const emaSlow = js_ema(closes, slow);
    const macdLine = new Array(closes.length).fill(NaN);

    for (let i = 0; i < closes.length; i++) {
        if (!isNaN(emaFast[i]) && !isNaN(emaSlow[i])) {
            macdLine[i] = emaFast[i] - emaSlow[i];
        }
    }
    return macdLine;
}

// ============================================================================
// Benchmark Utilities
// ============================================================================

function generateTestData(size) {
    const closes = [];
    const highs = [];
    const lows = [];

    let price = 100;
    for (let i = 0; i < size; i++) {
        const change = (Math.random() - 0.5) * 4;
        price = Math.max(1, price + change);
        const high = price + Math.random() * 2;
        const low = price - Math.random() * 2;
        closes.push(price);
        highs.push(high);
        lows.push(Math.max(0.1, low));
    }

    return { closes, highs, lows };
}

function benchmark(name, fn, iterations = 100) {
    // Warmup
    for (let i = 0; i < 5; i++) fn();

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
        fn();
    }
    const end = performance.now();

    return {
        name,
        totalMs: end - start,
        avgMs: (end - start) / iterations,
        iterations
    };
}

function formatResult(result) {
    return `${result.name}: ${result.avgMs.toFixed(3)}ms avg (${result.iterations} iterations)`;
}

// ============================================================================
// Run Benchmarks
// ============================================================================

console.log('='.repeat(70));
console.log('Performance Benchmark: JavaScript vs Rust/WASM Indicators');
console.log('='.repeat(70));

const SIZES = [1000, 5000, 10000, 50000];
const ITERATIONS = 50;

for (const size of SIZES) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`Data Size: ${size.toLocaleString()} bars`);
    console.log('─'.repeat(70));

    const { closes, highs, lows } = generateTestData(size);
    const closesF64 = new Float64Array(closes);
    const highsF64 = new Float64Array(highs);
    const lowsF64 = new Float64Array(lows);

    // SMA
    const jsSma = benchmark('JS  SMA(20)', () => js_sma(closes, 20), ITERATIONS);
    const rustSma = benchmark('WASM SMA(20)', () => wasm.Indicators.sma(closesF64, 20), ITERATIONS);
    console.log(`\nSMA(20):`);
    console.log(`  ${formatResult(jsSma)}`);
    console.log(`  ${formatResult(rustSma)}`);
    console.log(`  Speedup: ${(jsSma.avgMs / rustSma.avgMs).toFixed(2)}x`);

    // EMA
    const jsEma = benchmark('JS  EMA(20)', () => js_ema(closes, 20), ITERATIONS);
    const rustEma = benchmark('WASM EMA(20)', () => wasm.Indicators.ema(closesF64, 20), ITERATIONS);
    console.log(`\nEMA(20):`);
    console.log(`  ${formatResult(jsEma)}`);
    console.log(`  ${formatResult(rustEma)}`);
    console.log(`  Speedup: ${(jsEma.avgMs / rustEma.avgMs).toFixed(2)}x`);

    // RSI
    const jsRsi = benchmark('JS  RSI(14)', () => js_rsi(closes, 14), ITERATIONS);
    const rustRsi = benchmark('WASM RSI(14)', () => wasm.Indicators.rsi(closesF64, 14), ITERATIONS);
    console.log(`\nRSI(14):`);
    console.log(`  ${formatResult(jsRsi)}`);
    console.log(`  ${formatResult(rustRsi)}`);
    console.log(`  Speedup: ${(jsRsi.avgMs / rustRsi.avgMs).toFixed(2)}x`);

    // ATR
    const jsAtr = benchmark('JS  ATR(14)', () => js_atr(highs, lows, closes, 14), ITERATIONS);
    const rustAtr = benchmark('WASM ATR(14)', () => wasm.Indicators.atr(highsF64, lowsF64, closesF64, 14), ITERATIONS);
    console.log(`\nATR(14):`);
    console.log(`  ${formatResult(jsAtr)}`);
    console.log(`  ${formatResult(rustAtr)}`);
    console.log(`  Speedup: ${(jsAtr.avgMs / rustAtr.avgMs).toFixed(2)}x`);

    // MACD
    const jsMacd = benchmark('JS  MACD', () => js_macd(closes, 12, 26, 9), ITERATIONS);
    const rustMacd = benchmark('WASM MACD', () => wasm.Indicators.macd_line(closesF64, 12, 26, 9), ITERATIONS);
    console.log(`\nMACD(12,26,9):`);
    console.log(`  ${formatResult(jsMacd)}`);
    console.log(`  ${formatResult(rustMacd)}`);
    console.log(`  Speedup: ${(jsMacd.avgMs / rustMacd.avgMs).toFixed(2)}x`);
}

console.log(`\n${'='.repeat(70)}`);
console.log('Benchmark Complete');
console.log('='.repeat(70));
