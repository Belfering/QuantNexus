import fs from "fs";

const data = JSON.parse(fs.readFileSync("C:/Users/Trader/Desktop/JSONs/QuantMage/GLD Atlas.json", "utf8"));

function findAllByTitle(node, searchTerm, path = "", results = []) {
  if (!node) return results;
  
  if (node.title && node.title.includes(searchTerm)) {
    const idParts = node.id?.split("-") || [];
    const counter = idParts.length >= 3 ? idParts[idParts.length - 2] : "?";
    results.push({ counter, title: node.title, path, kind: node.kind });
  }
  
  if (node.children) {
    for (const slot of Object.keys(node.children)) {
      const children = node.children[slot] || [];
      children.forEach((child, i) => {
        findAllByTitle(child, searchTerm, path + "/" + slot + "[" + i + "]", results);
      });
    }
  }
  return results;
}

const mtmNodes = findAllByTitle(data, "Medium Term Momentum");
console.log("=== All Medium Term Momentum nodes ===\n");
mtmNodes.forEach(n => {
  console.log("#" + n.counter + " [" + n.kind + "] " + n.title);
  console.log("  Path: " + n.path);
  console.log();
});
