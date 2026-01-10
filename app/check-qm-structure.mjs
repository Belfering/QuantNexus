import fs from "fs";

// Read the ORIGINAL QuantMage JSON (before import)
const qmPath = "C:/Users/Trader/Desktop/JSONs/QuantMage/GLD Atlas.json";
const data = JSON.parse(fs.readFileSync(qmPath, "utf8"));

// Check if this is already an Atlas format or original QM format
console.log("=== Top-level keys ===");
console.log(Object.keys(data));

// If it has incantation_type, it's QM format
if (data.incantation_type) {
  console.log("\nThis is QuantMage format");
  console.log("Type:", data.incantation_type);
  console.log("Title:", data.title);
  
  // Find the GLD section
  function findByTitle(node, title, path = "") {
    if (!node) return null;
    if (node.title && node.title.includes(title)) {
      return { node, path };
    }
    // Check incantations array
    if (node.incantations) {
      for (let i = 0; i < node.incantations.length; i++) {
        const found = findByTitle(node.incantations[i], title, path + "/incantations[" + i + "]");
        if (found) return found;
      }
    }
    // Check condition branches
    if (node.then_incantation) {
      const found = findByTitle(node.then_incantation, title, path + "/then");
      if (found) return found;
    }
    if (node.else_incantation) {
      const found = findByTitle(node.else_incantation, title, path + "/else");
      if (found) return found;
    }
    return null;
  }
  
  const gld = findByTitle(data, "GLD");
  if (gld) {
    console.log("\nFound GLD at:", gld.path);
    console.log("GLD node type:", gld.node.incantation_type);
  }
} else if (data.kind) {
  console.log("\nThis is ALREADY Atlas format (imported)");
  console.log("Kind:", data.kind);
  console.log("Title:", data.title);
}
