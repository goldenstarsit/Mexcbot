import db from "../connection.js";

const columns = db
  .prepare("PRAGMA table_info(exchange_orders)")
  .all()
  .map((column) => column.name);

if (!columns.includes("recovery_status")) {
  db.exec(`
    ALTER TABLE exchange_orders
    ADD COLUMN recovery_status TEXT NOT NULL DEFAULT 'PENDING'
  `);
}

if (!columns.includes("recovery_attempts")) {
  db.exec(`
    ALTER TABLE exchange_orders
    ADD COLUMN recovery_attempts INTEGER NOT NULL DEFAULT 0
  `);
}

if (!columns.includes("recovery_error")) {
  db.exec(`
    ALTER TABLE exchange_orders
    ADD COLUMN recovery_error TEXT
  `);
}

if (!columns.includes("recovered_at")) {
  db.exec(`
    ALTER TABLE exchange_orders
    ADD COLUMN recovered_at TEXT
  `);
}
