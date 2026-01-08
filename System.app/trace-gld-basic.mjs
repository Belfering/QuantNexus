import fs from 'fs';

const data = JSON.parse(fs.readFileSync('C:/Users/Trader/Desktop/JSONs/QuantMage/GLD Atlas.json', 'utf8'));

function findFirst(node, title) {
  if (!node) return null;
  if (node.title === title) return node;
  if (node.children) {
    for (const slot of Object.keys(node.children)) {
      for (const child of node.children[slot] || []) {
        const found = findFirst(child, title);
        if (found) return found;
      }
    }
  }
  return null;
}

function printTree(node, indent = '') {
  if (!node) {
    console.log(indent + 'null');
    return;
  }
  console.log(indent + `[${node.kind}] "${node.title}" (${node.id.slice(-10)})`);
  if (node.conditions?.length) {
    node.conditions.forEach(c => {
      const cond = c.expanded
        ? `${c.window}d ${c.metric} of ${c.ticker} ${c.comparator} ${c.rightWindow}d ${c.rightMetric || c.metric} of ${c.rightTicker}`
        : `${c.window}d ${c.metric} of ${c.ticker} ${c.comparator} ${c.threshold}`;
      console.log(indent + `  condition: ${cond}`);
    });
  }
  if (node.numbered) {
    console.log(indent + `  quantifier: ${node.numbered.quantifier}, items: ${node.numbered.items?.length}`);
    node.numbered.items?.forEach((item, i) => {
      console.log(indent + `  item[${i}]: ${item.conditions?.length} conditions`);
      item.conditions?.forEach((c, j) => {
        const cond = c.expanded
          ? `${c.window}d ${c.metric} of ${c.ticker} ${c.comparator} ${c.rightWindow}d of ${c.rightTicker}`
          : `${c.window}d ${c.metric} of ${c.ticker} ${c.comparator} ${c.threshold}`;
        console.log(indent + `    [${j}] ${c.type}: ${cond}`);
      });
    });
  }
  if (node.children) {
    for (const slot of Object.keys(node.children)) {
      const children = node.children[slot] || [];
      if (children.length > 0) {
        console.log(indent + `  ${slot}:`);
        children.forEach(child => printTree(child, indent + '    '));
      }
    }
  }
}

// Find the "GLD " basic node and trace its tree
console.log('=== Looking for "GLD " basic node ===\n');
const gldBasic = findFirst(data, 'GLD ');
if (gldBasic) {
  printTree(gldBasic);
} else {
  console.log('Not found');
}

console.log('\n\n=== Looking for the root and first few levels ===\n');
printTree(data);
