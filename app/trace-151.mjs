import fs from "fs";

const data = JSON.parse(fs.readFileSync("C:/Users/Trader/Desktop/JSONs/QuantMage/GLD Atlas.json", "utf8"));

// Path to #151 was: /next[0]/then[0]/then[0]/next[1]/else[0]/next[0]/then[0]/...
// So MTM else branch leads to #151

function traceFromMTM(node, path = "", depth = 0) {
  if (!node || depth > 15) return;
  
  const idParts = node.id?.split("-") || [];
  const counter = idParts.length >= 3 ? idParts[idParts.length - 2] : "?";
  
  console.log("  ".repeat(depth) + "[" + node.kind + "] #" + counter + " " + node.title);
  
  if (counter === "151") {
    console.log("  ".repeat(depth) + "^^^ FOUND #151 ^^^");
    return;
  }
  
  // Only follow else branch to find where #151 is
  if (node.children?.else?.[0]) {
    traceFromMTM(node.children.else[0], path + "/else[0]", depth + 1);
  }
  if (node.children?.next?.[0]) {
    traceFromMTM(node.children.next[0], path + "/next[0]", depth + 1);
  }
}

// Get Medium Term Momentum
function getNodeAt(node, pathParts) {
  if (pathParts.length === 0) return node;
  const part = pathParts[0];
  const match = part.match(/(\w+)\[(\d+)\]/);
  if (!match) return null;
  const [, slot, idx] = match;
  const child = node.children?.[slot]?.[parseInt(idx)];
  return getNodeAt(child, pathParts.slice(1));
}

const mtmPath = "next[0]/then[0]/then[0]/next[1]".split("/");
const mtm = getNodeAt(data, mtmPath);

console.log("=== Tracing from Medium Term Momentum's ELSE branch ===\n");
traceFromMTM(mtm?.children?.else?.[0], "", 0);
