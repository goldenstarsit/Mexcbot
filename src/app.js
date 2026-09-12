import "dotenv/config";
import tradingConfig from "./config/trading.config.js";
import { validateTradingConfig } from "./config/validateTradingConfig.js";
import db from "./database/connection.js";

validateTradingConfig(tradingConfig);

console.log("MEXCBOT");
console.log("Environment:", process.env.NODE_ENV);
console.log("MEXC Base URL:", process.env.MEXC_BASE_URL);
console.log("SQLite:", db.prepare("SELECT sqlite_version() AS version").get().version);
console.log("Trading config: VALID");
console.log("Symbols:", tradingConfig.symbols.join(", "));
console.log("Total orders per symbol:", 1 + tradingConfig.dca.levels);
console.log("Database: connected");

process.on("SIGINT", () => {
  db.close();
  process.exit(0);
});
