import fs from 'fs';

const data = JSON.parse(fs.readFileSync('C:/Users/Trader/Desktop/JSONs/QuantMage/GLD Atlas.json', 'utf8'));

// Trace all paths from root to a target title
function tracePaths(node, targetTitle, currentPath = [], results = []) {
  if (!node) return results;

  const newPath = [...currentPath, { title: node.title, id: node.id, kind: node.kind }];

  if (node.title === targetTitle) {
    results.push(newPath);
    return results;
  }

  if (node.children) {
    for (const slot of Object.keys(node.children)) {
      for (const child of node.children[slot] || []) {
        if (child) {
          const pathWithSlot = [...currentPath, { title: node.title, id: node.id, kind: node.kind, toSlot: slot }];
          tracePaths(child, targetTitle, pathWithSlot, results);
        }
      }
    }
  }

  return results;
}

console.log('=== Paths to "Hedged GLD" nodes ===\n');
const hedgedPaths = tracePaths(data, 'Hedged GLD');
hedgedPaths.forEach((path, i) => {
  console.log(`Path #${i+1}:`);
  path.forEach((step, j) => {
    const indent = '  '.repeat(j);
    const slot = step.toSlot ? ` → [${step.toSlot}]` : '';
    console.log(`${indent}${step.kind}: "${step.title}"${slot}`);
  });
  console.log('');
});

console.log('\n=== Paths to "Pure GOLD" nodes ===\n');
const purePaths = tracePaths(data, 'Pure GOLD');
purePaths.forEach((path, i) => {
  console.log(`Path #${i+1}:`);
  path.forEach((step, j) => {
    const indent = '  '.repeat(j);
    const slot = step.toSlot ? ` → [${step.toSlot}]` : '';
    console.log(`${indent}${step.kind}: "${step.title}"${slot}`);
  });
  console.log('');
});

// Also show the Numbered node structure
console.log('\n=== Numbered node structure ===');
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

const numberedNode = findFirst(data, 'Numbered');
if (numberedNode) {
  console.log('ID:', numberedNode.id);
  console.log('Quantifier:', numberedNode.numbered?.quantifier);
  console.log('N:', numberedNode.numbered?.n);
  console.log('Items:', numberedNode.numbered?.items?.length);
  numberedNode.numbered?.items?.forEach((item, i) => {
    console.log(`  Item ${i+1}: ${item.conditions?.length} conditions`);
    item.conditions?.forEach((c, j) => {
      console.log(`    [${j}] ${c.type}: ${c.ticker} ${c.metric} ${c.window}d ${c.comparator} ${c.threshold}`);
    });
  });
  console.log('Children slots:', Object.keys(numberedNode.children || {}));
  for (const slot of Object.keys(numberedNode.children || {})) {
    const kids = numberedNode.children[slot] || [];
    console.log(`  ${slot}:`, kids.map(k => k?.title || 'null').join(', '));
  }
}
