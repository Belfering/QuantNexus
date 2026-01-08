import fs from "fs";

const data = JSON.parse(fs.readFileSync("C:/Users/Trader/Desktop/JSONs/QuantMage/GLD Atlas.json", "utf8"));

// #151 path was: /next[0]/then[0]/then[0]/next[1]/else[0]/next[0]/then[0]/then[0]/then[0]/then[0]/then[0]/then[0]/next[0]/then[0]/then[0]/then[0]/then[0]/then[0]/next[0]/then[0]/then[0]/then[0]/then[0]/next[0]/then[0]/then[0]/then[0]/then[0]/then[0]/then[0]

function getNodeAt(node, pathParts) {
  if (!node) return null;
  if (pathParts.length === 0) return node;
  const part = pathParts[0];
  const match = part.match(/(\w+)\[(\d+)\]/);
  if (!match) return null;
  const [, slot, idx] = match;
  const child = node.children?.[slot]?.[parseInt(idx)];
  return getNodeAt(child, pathParts.slice(1));
}

// Verify path to node #151
const pathTo151 = "next[0]/then[0]/then[0]/next[1]/else[0]/next[0]/then[0]/then[0]/then[0]/then[0]/then[0]/then[0]/next[0]/then[0]/then[0]/then[0]/then[0]/then[0]/next[0]/then[0]/then[0]/then[0]/then[0]/next[0]/then[0]/then[0]/then[0]/then[0]/then[0]/then[0]".split("/");

// Trace step by step
let current = data;
console.log("=== Tracing path to #151 ===\n");

for (let i = 0; i < Math.min(pathTo151.length, 10); i++) {
  const part = pathTo151[i];
  const match = part.match(/(\w+)\[(\d+)\]/);
  if (!match) break;
  const [, slot, idx] = match;
  current = current?.children?.[slot]?.[parseInt(idx)];
  if (!current) {
    console.log("STOPPED at step", i, ":", part);
    break;
  }
  const idParts = current.id?.split("-") || [];
  const counter = idParts.length >= 3 ? idParts[idParts.length - 2] : "?";
  console.log(part + " → [" + current.kind + "] #" + counter + " " + current.title);
}

// Key question: what's at next[1]/else[0]?
console.log("\n=== What's at next[1]/else[0]? ===");
const atNext1Else0 = getNodeAt(data, "next[0]/then[0]/then[0]/next[1]/else[0]".split("/"));
if (atNext1Else0) {
  const idParts = atNext1Else0.id?.split("-") || [];
  const counter = idParts.length >= 3 ? idParts[idParts.length - 2] : "?";
  console.log("[" + atNext1Else0.kind + "] #" + counter + " " + atNext1Else0.title);
}
