import fs from 'fs';

const data = JSON.parse(fs.readFileSync('C:/Users/Trader/Desktop/JSONs/QuantMage/GLD Atlas.json', 'utf8'));

function countNodes(node, title, count = 0) {
  if (!node) return count;
  if (node.title === title) count++;
  if (node.children) {
    for (const slot of Object.keys(node.children)) {
      for (const child of node.children[slot] || []) {
        count = countNodes(child, title, count);
      }
    }
  }
  return count;
}

function findAllWithTitle(node, title, results = []) {
  if (!node) return results;
  if (node.title === title) results.push(node);
  if (node.children) {
    for (const slot of Object.keys(node.children)) {
      for (const child of node.children[slot] || []) {
        findAllWithTitle(child, title, results);
      }
    }
  }
  return results;
}

console.log('=== Node Counts in GLD Atlas ===');
console.log('Medium Term Momentum nodes:', countNodes(data, 'Medium Term Momentum'));
console.log('Long Term Momentum nodes:', countNodes(data, 'Long Term Momentum'));
console.log('Hedged GLD nodes:', countNodes(data, 'Hedged GLD'));
console.log('Pure GOLD nodes:', countNodes(data, 'Pure GOLD'));

// Show all Medium Term Momentum nodes with their parent context
console.log('\n=== Medium Term Momentum Details ===');
const mtmNodes = findAllWithTitle(data, 'Medium Term Momentum');
mtmNodes.forEach((n, i) => {
  console.log(`\nMTM #${i+1}:`);
  console.log('  ID:', n.id);
  console.log('  Kind:', n.kind);
  console.log('  Conditions:', JSON.stringify(n.conditions?.map(c => ({
    metric: c.metric,
    window: c.window,
    ticker: c.ticker,
    comparator: c.comparator,
    rightTicker: c.rightTicker,
    rightWindow: c.rightWindow
  }))));
  console.log('  Then children:', (n.children?.then || []).map(c => c?.title || 'null').join(', '));
  console.log('  Else children:', (n.children?.else || []).map(c => c?.title || 'null').join(', '));
  console.log('  conditionLogic:', n.conditionLogic);
  console.log('  conditions raw:', JSON.stringify(n.conditions, null, 2));
});
