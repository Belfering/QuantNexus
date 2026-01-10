/**
 * Native CLI vs WASM comparison
 */
import { createRequire } from 'module';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

const wasm = require('./pkg/flowchart_indicators.js');
const CLI = join(__dirname, 'target/release/indicators');

function generateData(size) {
    const data = [];
    let price = 100;
    for (let i = 0; i < size; i++) {
        price += (Math.random() - 0.5) * 2;
        data.push(price);
    }
    return data;
}

console.log('='.repeat(60));
console.log('Native CLI vs WASM Performance');
console.log('='.repeat(60));

for (const size of [100, 1000, 5000, 10000]) {
    console.log(`\n--- ${size.toLocaleString()} data points ---`);

    const data = generateData(size);
    const dataF64 = new Float64Array(data);
    const jsonData = JSON.stringify(data);

    // WASM benchmark
    const wasmIterations = 100;
    const wasmStart = performance.now();
    for (let i = 0; i < wasmIterations; i++) {
        wasm.Indicators.rsi(dataF64, 14);
    }
    const wasmTime = (performance.now() - wasmStart) / wasmIterations;

    // CLI benchmark (fewer iterations due to spawn overhead)
    const cliIterations = 5;
    const cliStart = performance.now();
    for (let i = 0; i < cliIterations; i++) {
        execSync(`echo '${jsonData}' | ${CLI} rsi 14`, { encoding: 'utf8' });
    }
    const cliTime = (performance.now() - cliStart) / cliIterations;

    console.log(`WASM:   ${wasmTime.toFixed(3)}ms per call`);
    console.log(`CLI:    ${cliTime.toFixed(3)}ms per call`);
    console.log(`Winner: ${wasmTime < cliTime ? 'WASM' : 'CLI'} (${(Math.max(wasmTime, cliTime) / Math.min(wasmTime, cliTime)).toFixed(1)}x faster)`);
}

console.log('\n' + '='.repeat(60));
console.log('Conclusion: CLI has ~5-15ms process spawn overhead per call.');
console.log('WASM wins for per-ticker calculations.');
console.log('CLI only wins if you batch ALL tickers in one call.');
console.log('='.repeat(60));
