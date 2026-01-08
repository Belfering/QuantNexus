import fs from 'fs';

const data = JSON.parse(fs.readFileSync('C:/Users/Trader/Desktop/JSONs/QuantMage/GLD Atlas.json', 'utf8'));

function printTree(node, indent = '', maxDepth = 5, currentDepth = 0) {
  if (!node || currentDepth > maxDepth) {
    if (node && currentDepth > maxDepth) console.log(indent + '...');
    return;
  }
  console.log(indent + `[${node.kind}] "${node.title}"`);
  if (node.conditions?.length) {
    node.conditions.forEach(c => {
      const cond = c.expanded
        ? `${c.window}d ${c.metric} of ${c.ticker} ${c.comparator} ${c.rightWindow}d ${c.rightMetric || c.metric} of ${c.rightTicker}`
        : `${c.window}d ${c.metric} of ${c.ticker} ${c.comparator} ${c.threshold}`;
      console.log(indent + `  cond: ${cond}`);
    });
  }
  if (node.children) {
    for (const slot of Object.keys(node.children)) {
      const children = node.children[slot] || [];
      if (children.length > 0) {
        console.log(indent + `  [${slot}]:`);
        children.forEach(child => printTree(child, indent + '    ', maxDepth, currentDepth + 1));
      }
    }
  }
}

console.log('=== GLD Atlas Tree (first 5 levels) ===\n');
printTree(data, '', 5);
