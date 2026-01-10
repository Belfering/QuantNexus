import fs from "fs";

const data = JSON.parse(fs.readFileSync("C:/Users/Trader/Desktop/JSONs/QuantMage/GLD QM.json", "utf8"));

// Navigate to the parent Weighted node
const parent = data.incantation?.incantations?.[0]?.from_incantation?.from_incantation;

if (parent && parent.incantation_type === "Weighted") {
  console.log("=== Parent Weighted Node ===");
  console.log("Type:", parent.incantation_type);
  console.log("Number of children:", parent.incantations?.length);
  
  parent.incantations?.forEach((child, i) => {
    const type = child.incantation_type;
    if (type === "IfElse" && child.condition) {
      const c = child.condition;
      console.log("\n[" + i + "] IfElse: " + c.lh_indicator?.window + "d MA > " + c.rh_indicator?.window + "d MA of " + c.lh_ticker_symbol);
    } else {
      console.log("\n[" + i + "] " + type);
    }
  });
}
