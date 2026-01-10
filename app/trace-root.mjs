import fs from "fs";

const data = JSON.parse(fs.readFileSync("C:/Users/Trader/Desktop/JSONs/QuantMage/GLD Atlas.json", "utf8"));

function printPath(node, depth = 0, maxDepth = 6, path = "") {
  if (!node || depth > maxDepth) return;
  const indent = "  ".repeat(depth);
  console.log(indent + "[" + node.kind + "] \"" + node.title + "\" path=" + path);

  if (node.children) {
    for (const slot of Object.keys(node.children)) {
      const children = node.children[slot] || [];
      children.forEach((child, i) => {
        printPath(child, depth + 1, maxDepth, path + "/" + slot + "[" + i + "]");
      });
    }
  }
}

console.log("=== Tree from root to depth 6 ===\n");
printPath(data);
