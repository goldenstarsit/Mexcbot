import db from "../connection.js";
import "./001_initial_schema.js";

console.log(
  "Database schema ready:",
  db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").get().count,
  "tables"
);
import "./002_fill_processing.js";
