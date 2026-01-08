import fs from "fs";

const raw = fs.readFileSync("C:/Users/Trader/Desktop/JSONs/QuantMage/GLD QM.json", "utf8");
const data = JSON.parse(raw);

// Find all IfElse nodes with MA 50/200 or MA 30/40 conditions
function findIfElse(node, path = "") {
  if (!node) return;
  
  if (node.incantation_type === "IfElse" && node.condition) {
    const c = node.condition;
    const lhWin = c.lh_indicator?.window;
    const rhWin = c.rh_indicator?.window;
    
    // Check for 50/200 or 30/40 MA comparisons
    if ((lhWin === 50 && rhWin === 200) || (lhWin === 30 && rhWin === 40)) {
      console.log("=== IfElse at " + path + " ===");
      console.log("Condition: " + lhWin + "d MA of " + c.lh_ticker_symbol + " > " + rhWin + "d MA of " + c.rh_ticker_symbol);
      console.log("Then type:", node.then_incantation?.incantation_type);
      console.log("Else type:", node.else_incantation?.incantation_type);
      
      // Show what's in then branch
      if (node.then_incantation) {
        const then = node.then_incantation;
        if (then.incantation_type === "IfElse") {
          const tc = then.condition;
          console.log("  Then has nested IfElse:", tc.lh_indicator?.window + "d > " + tc.rh_indicator?.window + "d of " + tc.lh_ticker_symbol);
        } else if (then.incantation_type === "Weighted") {
          console.log("  Then is Weighted with", then.incantations?.length, "children");
        }
      }
      console.log();
    }
  }
  
  // Recurse
  if (node.incantation) findIfElse(node.incantation, path + "/incantation");
  if (node.from_incantation) findIfElse(node.from_incantation, path + "/from");
  if (node.incantations) {
    node.incantations.forEach((child, i) => findIfElse(child, path + "/incantations[" + i + "]"));
  }
  if (node.then_incantation) findIfElse(node.then_incantation, path + "/then");
  if (node.else_incantation) findIfElse(node.else_incantation, path + "/else");
}

findIfElse(data);
