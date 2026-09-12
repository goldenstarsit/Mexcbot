import "dotenv/config";
import db from "./database/connection.js";

console.log("MEXCBOT");
console.log("Environment:", process.env.NODE_ENV);
console.log("MEXC Base URL:", process.env.MEXC_BASE_URL);
console.log("SQLite:", db.prepare("SELECT sqlite_version() AS version").get().version);
console.log("Database: connected");

process.on("SIGINT", () => {
  db.close();
  process.exit(0);
});
