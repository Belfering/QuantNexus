import fs from "fs";

const data = JSON.parse(fs.readFileSync("C:/Users/Trader/Desktop/JSONs/QuantMage/GLD QM.json", "utf8"));

console.log("=== GLD QM.json Structure ===");
console.log("Type:", data.incantation_type);
console.log("Title:", data.title);

function printTree(node, indent = "", maxDepth = 6, depth = 0) {
  if (!node || depth > maxDepth) return;
  
  const type = node.incantation_type || node.condition_type || "?";
  const title = node.title || node.symbol || "";
  console.log(indent + "[" + type + "] " + title);
  
  // Show condition for IfElse
  if (type === "IfElse" && node.condition) {
    const c = node.condition;
    const lh = c.lh_indicator ? (c.lh_indicator.window + "d " + c.lh_indicator.type) : "?";
    const rh = c.rh_indicator ? (c.rh_indicator.window + "d " + c.rh_indicator.type) : c.rh_value;
    console.log(indent + "  condition: " + lh + " of " + c.lh_ticker_symbol + " > " + rh + " of " + (c.rh_ticker_symbol || ""));
  }
  
  // Recurse into children
  if (node.incantations) {
    node.incantations.forEach((child, i) => {
      printTree(child, indent + "  ", maxDepth, depth + 1);
    });
  }
  if (node.then_incantation) {
    console.log(indent + "  THEN:");
    printTree(node.then_incantation, indent + "    ", maxDepth, depth + 1);
  }
  if (node.else_incantation) {
    console.log(indent + "  ELSE:");
    printTree(node.else_incantation, indent + "    ", maxDepth, depth + 1);
  }
}

printTree(data);
