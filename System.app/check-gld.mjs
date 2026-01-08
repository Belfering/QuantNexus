import fs from 'fs';

const data = JSON.parse(fs.readFileSync('C:/Users/Trader/Desktop/JSONs/QuantMage/GLD Atlas.json', 'utf8'));

// Find all nodes with a specific title
function findNodesWithTitle(node, title, results = []) {
  if (!node) return results;
  if (node.title === title) {
    results.push(node);
  }
  if (node.children) {
    for (const slot of Object.keys(node.children)) {
      for (const child of node.children[slot] || []) {
        findNodesWithTitle(child, title, results);
      }
    }
  }
  return results;
}

// Check Hedged GLD nodes
const hedgedNodes = findNodesWithTitle(data, 'Hedged GLD');
console.log('Found', hedgedNodes.length, 'Hedged GLD nodes\n');

hedgedNodes.forEach(function(node, i) {
  console.log('Hedged GLD #' + (i+1) + ':');
  console.log('  weighting:', node.weighting);
  var children = node.children && node.children.next || [];
  children.forEach(function(child, j) {
    console.log('  Child ' + (j+1) + ':', child.positions, 'window=' + child.window);
  });
  console.log('');
});
