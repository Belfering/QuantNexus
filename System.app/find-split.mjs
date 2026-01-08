import fs from "fs";

const data = JSON.parse(fs.readFileSync("C:/Users/Trader/Desktop/JSONs/QuantMage/GLD Atlas.json", "utf8"));

function findSplitNode(node, path = "") {
  if (node === null || node === undefined) return;

  // Check if this node has multiple next children
  const nextChildren = node.children?.next || [];
  if (nextChildren.length > 1) {
    const idParts = node.id?.split("-") || [];
    const counter = idParts.length >= 3 ? idParts[idParts.length - 2] : "?";
    console.log("=== SPLIT NODE #" + counter + " ===");
    console.log("Kind:", node.kind);
    console.log("Title:", node.title);
    console.log("Path:", path);
    console.log("Next children count:", nextChildren.length);
    nextChildren.forEach((child, i) => {
      if (child) {
        console.log("  next[" + i + "]: [" + child.kind + "] " + child.title);
      }
    });
    console.log("Conditions:", JSON.stringify(node.conditions, null, 2));
    console.log();
  }

  if (node.children) {
    for (const slot of Object.keys(node.children)) {
      const children = node.children[slot] || [];
      children.forEach((child, i) => {
        findSplitNode(child, path + "/" + slot + "[" + i + "]");
      });
    }
  }
}

findSplitNode(data);
