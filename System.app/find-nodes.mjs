import fs from "fs";

const data = JSON.parse(fs.readFileSync("C:/Users/Trader/Desktop/JSONs/QuantMage/GLD Atlas.json", "utf8"));

function findNodeByCounter(node, targetCounters, path = "") {
  if (node === null || node === undefined) return;

  const idParts = node.id?.split("-") || [];
  let counter = null;
  if (idParts.length >= 3) {
    counter = idParts[idParts.length - 2];
  }

  if (targetCounters.includes(counter)) {
    console.log("Counter #" + counter + ": [" + node.kind + "] " + node.title);
    console.log("  Full ID: " + node.id);
    console.log("  Path: " + path);
    console.log();
  }

  if (node.children) {
    for (const slot of Object.keys(node.children)) {
      const children = node.children[slot] || [];
      children.forEach((child, i) => {
        findNodeByCounter(child, targetCounters, path + "/" + slot + "[" + i + "]");
      });
    }
  }
}

findNodeByCounter(data, ["151", "15", "14"]);
