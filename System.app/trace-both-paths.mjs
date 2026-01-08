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

// Path to Long Term Momentum (next[0])
const ltmPath = "next[0]/then[0]/then[0]/next[0]".split("/");
// Path to Medium Term Momentum (next[1])  
const mtmPath = "next[0]/then[0]/then[0]/next[1]".split("/");

const ltm = getNodeAt(data, ltmPath);
const mtm = getNodeAt(data, mtmPath);

console.log("=== Long Term Momentum (next[0]) #99 ===");
console.log("Title:", ltm?.title);
console.log("Kind:", ltm?.kind);
console.log("Conditions:", JSON.stringify(ltm?.conditions, null, 2));
console.log("\nThen children:", ltm?.children?.then?.map(c => "[" + c?.kind + "] " + c?.title).join(", "));
console.log("Else children:", ltm?.children?.else?.map(c => "[" + c?.kind + "] " + c?.title).join(", "));

console.log("\n\n=== Medium Term Momentum (next[1]) #198 ===");
console.log("Title:", mtm?.title);
console.log("Kind:", mtm?.kind);
console.log("Conditions:", JSON.stringify(mtm?.conditions, null, 2));
console.log("\nThen children:", mtm?.children?.then?.map(c => "[" + c?.kind + "] " + c?.title).join(", "));
console.log("Else children:", mtm?.children?.else?.map(c => "[" + c?.kind + "] " + c?.title).join(", "));

// Now trace what's in Medium Term Momentum's THEN branch
console.log("\n\n=== MTM Then Branch Structure ===");
const mtmThen = mtm?.children?.then?.[0];
if (mtmThen) {
  console.log("MTM -> then[0]:", "[" + mtmThen.kind + "]", mtmThen.title);
  const mtmThenThen = mtmThen?.children?.then?.[0];
  if (mtmThenThen) {
    console.log("  -> then[0]:", "[" + mtmThenThen.kind + "]", mtmThenThen.title);
  }
  const mtmThenElse = mtmThen?.children?.else?.[0];
  if (mtmThenElse) {
    console.log("  -> else[0]:", "[" + mtmThenElse.kind + "]", mtmThenElse.title);
  }
}

// And MTM ELSE branch
console.log("\n=== MTM Else Branch Structure ===");
const mtmElse = mtm?.children?.else?.[0];
if (mtmElse) {
  console.log("MTM -> else[0]:", "[" + mtmElse.kind + "]", mtmElse.title);
}
