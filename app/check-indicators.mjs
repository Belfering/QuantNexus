import fs from 'fs';

const tree = JSON.parse(fs.readFileSync('C:/Users/Trader/Desktop/JSONs/QuantMage/GLD Atlas.json', 'utf8'));

function findNode(node, counter) {
  if (!node) return null;
  const idParts = node.id?.split('-') || [];
  const nodeCounter = idParts.length >= 3 ? idParts[idParts.length - 2] : null;
  if (nodeCounter === counter) return node;
  for (const slot of Object.keys(node.children || {})) {
    const children = node.children[slot] || [];
    for (const child of children) {
      const result = findNode(child, counter);
      if (result) return result;
    }
  }
  return null;
}

// Check indicator #99 (Long Term Momentum)
const ind99 = findNode(tree, '99');
console.log('=== Indicator #99:', ind99?.title, '===');
console.log('Kind:', ind99?.kind);
console.log('Conditions:');
(ind99?.conditions || []).forEach((c, i) => {
  if (c.expanded) {
    console.log(`  [${i}] ${c.window}d ${c.metric} of ${c.ticker} ${c.comparator} ${c.rightWindow}d ${c.rightMetric} of ${c.rightTicker}`);
  } else {
    console.log(`  [${i}] ${c.window}d ${c.metric} of ${c.ticker} ${c.comparator} ${c.threshold}`);
  }
});

// Check indicator #198 (Medium Term Momentum)
const ind198 = findNode(tree, '198');
console.log('\n=== Indicator #198:', ind198?.title, '===');
console.log('Kind:', ind198?.kind);
console.log('Conditions:');
(ind198?.conditions || []).forEach((c, i) => {
  if (c.expanded) {
    console.log(`  [${i}] ${c.window}d ${c.metric} of ${c.ticker} ${c.comparator} ${c.rightWindow}d ${c.rightMetric} of ${c.rightTicker}`);
  } else {
    console.log(`  [${i}] ${c.window}d ${c.metric} of ${c.ticker} ${c.comparator} ${c.threshold}`);
  }
});

// Also check the raw condition objects
console.log('\n=== Raw conditions #99 ===');
console.log(JSON.stringify(ind99?.conditions, null, 2));

console.log('\n=== Raw conditions #198 ===');
console.log(JSON.stringify(ind198?.conditions, null, 2));
