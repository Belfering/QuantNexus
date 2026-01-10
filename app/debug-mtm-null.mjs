import fs from "fs";
import { runBacktest } from "./server/backtest.mjs";

const tree = JSON.parse(fs.readFileSync("C:/Users/Trader/Desktop/JSONs/QuantMage/GLD Atlas.json", "utf8"));

// Add extensive logging for null checks
console.log("Running backtest with null debug...");

try {
  const result = await runBacktest(tree, { mode: "CC", costBps: 0 });
  console.log("\nDone. Check logs above for Medium Term Momentum evaluation.");
} catch (err) {
  console.error("Error:", err);
}
