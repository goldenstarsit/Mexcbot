import db from "../connection.js";

const columns = db
  .prepare("PRAGMA table_info(trading_cycles)")
  .all();

const hasConfigSnapshot =
  columns.some(
    (column) =>
      column.name === "config_snapshot_json",
  );

if (!hasConfigSnapshot) {
  db.exec(`
    ALTER TABLE trading_cycles
    ADD COLUMN config_snapshot_json TEXT;
  `);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS runtime_trading_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    config_json TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);
