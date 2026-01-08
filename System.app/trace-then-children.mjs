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

// Path to Long Term Momentum (next[0]) and Medium Term Momentum (next[1])
const ltm = getNodeAt(data, "next[0]/then[0]/then[0]/next[0]".split("/"));
const mtm = getNodeAt(data, "next[0]/then[0]/then[0]/next[1]".split("/"));

console.log("=== Long Term Momentum THEN children ===");
const ltmThen = ltm?.children?.then || [];
ltmThen.forEach((child, i) => {
  console.log(`[${i}] [${child?.kind}] ${child?.title}`);
});

console.log("\n=== Medium Term Momentum THEN children ===");
const mtmThen = mtm?.children?.then || [];
mtmThen.forEach((child, i) => {
  console.log(`[${i}] [${child?.kind}] ${child?.title}`);
});

// Now trace deeper - what's in Numbered's THEN
console.log("\n=== LTM -> then[0] (Numbered) -> THEN children ===");
const ltmNum = ltmThen[0];
console.log("Numbered node:", ltmNum?.title);
console.log("quantifier:", ltmNum?.numbered?.quantifier);
console.log("n:", ltmNum?.numbered?.n);
console.log("items:", ltmNum?.numbered?.items?.length);
const ltmNumThen = ltmNum?.children?.then || [];
ltmNumThen.forEach((child, i) => {
  console.log(`  then[${i}]: [${child?.kind}] ${child?.title}`);
});
const ltmNumElse = ltmNum?.children?.else || [];
ltmNumElse.forEach((child, i) => {
  console.log(`  else[${i}]: [${child?.kind}] ${child?.title}`);
});

console.log("\n=== MTM -> then[0] (Numbered) -> THEN children ===");
const mtmNum = mtmThen[0];
console.log("Numbered node:", mtmNum?.title);
console.log("quantifier:", mtmNum?.numbered?.quantifier);
console.log("n:", mtmNum?.numbered?.n);
console.log("items:", mtmNum?.numbered?.items?.length);
const mtmNumThen = mtmNum?.children?.then || [];
mtmNumThen.forEach((child, i) => {
  console.log(`  then[${i}]: [${child?.kind}] ${child?.title}`);
});
const mtmNumElse = mtmNum?.children?.else || [];
mtmNumElse.forEach((child, i) => {
  console.log(`  else[${i}]: [${child?.kind}] ${child?.title}`);
});
