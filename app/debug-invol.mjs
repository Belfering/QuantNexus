import fs from 'fs'

const data = JSON.parse(fs.readFileSync('C:/Users/Trader/Desktop/JSONs/QuantMage/InVol FTLTs Hedged.json', 'utf8'))

// Check for any unusual values that could cause date issues
const checkNode = (n, path = 'root') => {
  if (!n || typeof n !== 'object') return

  // Check all numeric values
  for (const [key, val] of Object.entries(n)) {
    if (typeof val === 'number' && !Number.isFinite(val)) {
      console.log('NON-FINITE:', path + '.' + key, '=', val)
    }
  }

  // Recurse
  if (n.then_incantation) checkNode(n.then_incantation, path + '.then')
  if (n.else_incantation) checkNode(n.else_incantation, path + '.else')
  if (n.from_incantation) checkNode(n.from_incantation, path + '.from')
  if (n.to_incantation) checkNode(n.to_incantation, path + '.to')
  if (n.incantations) n.incantations.forEach((c, i) => checkNode(c, path + '.inc[' + i + ']'))
  if (n.condition) checkNode(n.condition, path + '.cond')
  if (n.conditions) n.conditions.forEach((c, i) => checkNode(c, path + '.conds[' + i + ']'))
}

checkNode(data.incantation)
console.log('Done checking. If no output above, values look OK.')
console.log('\nStrategy name:', data.name)
console.log('Benchmark:', data.benchmark_ticker)

// Extract all tickers to check if any are missing
const tickers = new Set()
const findTickers = (n) => {
  if (!n) return
  if (n.symbol) tickers.add(n.symbol)
  if (n.lh_ticker_symbol) tickers.add(n.lh_ticker_symbol)
  if (n.rh_ticker_symbol) tickers.add(n.rh_ticker_symbol)
  if (n.ticker_symbol) tickers.add(n.ticker_symbol)
  if (n.then_incantation) findTickers(n.then_incantation)
  if (n.else_incantation) findTickers(n.else_incantation)
  if (n.from_incantation) findTickers(n.from_incantation)
  if (n.to_incantation) findTickers(n.to_incantation)
  if (n.incantations) n.incantations.forEach(findTickers)
  if (n.condition) findTickers(n.condition)
  if (n.conditions) n.conditions.forEach(findTickers)
}
findTickers(data.incantation)

// Check against available parquets
const parquetDir = 'C:/Users/Trader/Desktop/Flowchart/System.app/ticker-data/data/ticker_data_parquet'
const available = new Set(fs.readdirSync(parquetDir).filter(f => f.endsWith('.parquet')).map(f => f.replace('.parquet', '')))

const missing = [...tickers].filter(t => t && !available.has(t))
console.log('\nTickers used:', tickers.size)
console.log('Missing tickers:', missing.length)
if (missing.length > 0) {
  console.log(missing)
}
