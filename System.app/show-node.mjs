import fs from "fs";

const data = JSON.parse(fs.readFileSync("C:/Users/Trader/Desktop/JSONs/QuantMage/GLD Atlas.json", "utf8"));

function findNode(node, counter, path = "") {
  if (node === null || node === undefined) return null;

  const idParts = node.id?.split("-") || [];
  let nodeCounter = null;
  if (idParts.length >= 3) {
    nodeCounter = idParts[idParts.length - 2];
  }

  if (nodeCounter === counter) {
    return { node, path };
  }

  if (node.children) {
    for (const slot of Object.keys(node.children)) {
      const children = node.children[slot] || [];
      for (let i = 0; i < children.length; i++) {
        const found = findNode(children[i], counter, path + "/" + slot + "[" + i + "]");
        if (found) return found;
      }
    }
  }
  return null;
}

// Show details of node #151 (Utility Momentum)
const result = findNode(data, "151");
if (result) {
  console.log("=== Node #151: Utility Momentum ===");
  console.log(JSON.stringify(result.node, null, 2).slice(0, 2000));
}
