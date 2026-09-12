import db from "../connection.js";
import "./001_initial_schema.js";
import "./002_fill_processing.js";
import "./003_order_idempotency.js";
import "./004_exchange_response_persistence.js";

console.log(
  "Database schema ready:",
  db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").get().count,
  "tables"
);
