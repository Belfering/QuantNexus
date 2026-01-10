import fs from "fs";

const data = JSON.parse(fs.readFileSync("C:/Users/Trader/Desktop/JSONs/QuantMage/GLD Atlas.json", "utf8"));

function getNodeAt(node, pathParts) {
  if (pathParts.length === 0) return node;
  const part = pathParts[0];
  const match = part.match(/(\w+)\[(\d+)\]/);
  if (!match) return null;
  const [, slot, idx] = match;
  const child = node.children?.[slot]?.[parseInt(idx)];
  return getNodeAt(child, pathParts.slice(1));
}

// LTM path to Hedged GLD: next[0]/then[0]/then[0]/next[0]/then[0]/then[0]
const hedgedGLD_LTM = getNodeAt(data, "next[0]/then[0]/then[0]/next[0]/then[0]/then[0]".split("/"));

console.log("=== Hedged GLD (via LTM path) ===");
console.log("Title:", hedgedGLD_LTM?.title);
console.log("Kind:", hedgedGLD_LTM?.kind);
console.log("Weighting:", hedgedGLD_LTM?.weighting);
(hedgedGLD_LTM?.children?.next || []).forEach((child, i) => {
  console.log("  next[" + i + "]: [" + child?.kind + "] " + child?.title);
  console.log("    positions:", JSON.stringify(child?.positions));
  console.log("    window (weight):", child?.window);
});
