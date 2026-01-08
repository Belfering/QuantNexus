import fs from 'fs';

const data = JSON.parse(fs.readFileSync('C:/Users/Trader/Desktop/JSONs/QuantMage/GLD Atlas.json', 'utf8'));

function findNumbered(node) {
  if (node === null || node === undefined) return;
  if (node.kind === 'numbered' && node.numbered?.items) {
    const idParts = node.id?.split('-') || [];
    const counter = idParts.length >= 3 ? idParts[idParts.length - 2] : '?';
    console.log('Numbered #' + counter + ': ' + node.title);
    console.log('  quantifier:', node.numbered.quantifier);
    console.log('  items:', node.numbered.items.length);
    node.numbered.items.forEach((item, i) => {
      console.log('  item[' + i + '] conditions:', item.conditions?.length || 0);
      if (item.conditions) {
        item.conditions.forEach((c, j) => {
          const right = c.expanded ? c.rightWindow + 'd of ' + c.rightTicker : c.threshold;
          console.log('    [' + j + '] ' + c.window + 'd ' + c.metric + ' of ' + c.ticker + ' ' + c.comparator + ' ' + right);
        });
      }
    });
    console.log();
  }
  if (node.children) {
    for (const slot of Object.keys(node.children)) {
      (node.children[slot] || []).forEach((child) => {
        findNumbered(child);
      });
    }
  }
}

findNumbered(data);
