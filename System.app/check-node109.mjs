import fs from 'fs';

const tree = JSON.parse(fs.readFileSync('C:/Users/Trader/Desktop/JSONs/QuantMage/GLD Atlas.json', 'utf8'));

// Find the numbered node #109
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

const node109 = findNode(tree, '109');
console.log('Numbered node #109:');
console.log('  Title:', node109?.title);
console.log('  Kind:', node109?.kind);
console.log('  Quantifier:', node109?.numbered?.quantifier);
console.log('  Items:', node109?.numbered?.items?.length);

// Check the then/else children
console.log('\nThen children:');
(node109?.children?.then || []).forEach((child, i) => {
  const idParts = child?.id?.split('-') || [];
  const counter = idParts.length >= 3 ? idParts[idParts.length - 2] : '?';
  console.log('  [' + i + '] #' + counter + ' [' + child?.kind + '] ' + child?.title);
});

console.log('\nElse children:');
(node109?.children?.else || []).forEach((child, i) => {
  const idParts = child?.id?.split('-') || [];
  const counter = idParts.length >= 3 ? idParts[idParts.length - 2] : '?';
  console.log('  [' + i + '] #' + counter + ' [' + child?.kind + '] ' + child?.title);
});
