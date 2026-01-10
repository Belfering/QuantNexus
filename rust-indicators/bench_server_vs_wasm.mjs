/**
 * Rust Server vs WASM benchmark
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const wasm = require('./pkg/flowchart_indicators.js');

function generateData(size) {
    const data = [];
    let price = 100;
    for (let i = 0; i < size; i++) {
        price += (Math.random() - 0.5) * 2;
        data.push(price);
    }
    return data;
}

async function benchServer(data, iterations) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
        await fetch('http://localhost:3030/rsi', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ values: data, period: 14 })
        });
    }
    return (performance.now() - start) / iterations;
}

function benchWasm(data, iterations) {
    const dataF64 = new Float64Array(data);
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
        wasm.Indicators.rsi(dataF64, 14);
    }
    return (performance.now() - start) / iterations;
}

console.log('='.repeat(60));
console.log('Rust Server (HTTP) vs WASM Performance');
console.log('='.repeat(60));

for (const size of [1000, 5000, 10000, 50000]) {
    console.log(`\n--- ${size.toLocaleString()} data points ---`);

    const data = generateData(size);
    const iterations = size > 10000 ? 20 : 50;

    const wasmTime = benchWasm(data, iterations);
    const serverTime = await benchServer(data, iterations);

    console.log(`WASM:   ${wasmTime.toFixed(3)}ms per call`);
    console.log(`Server: ${serverTime.toFixed(3)}ms per call`);

    if (wasmTime < serverTime) {
        console.log(`Winner: WASM (${(serverTime / wasmTime).toFixed(1)}x faster)`);
    } else {
        console.log(`Winner: Server (${(wasmTime / serverTime).toFixed(1)}x faster)`);
    }
}

console.log('\n' + '='.repeat(60));
console.log('Note: Server has HTTP overhead (~0.5-2ms) but native compute.');
console.log('For batching many tickers, server can parallelize better.');
console.log('='.repeat(60));
