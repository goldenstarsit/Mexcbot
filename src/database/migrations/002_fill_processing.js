import db from "../connection.js";

const columns = db
  .prepare("PRAGMA table_info(exchange_orders)")
  .all()
  .map((column) => column.name);

if (!columns.includes("fill_processing_status")) {
  db.exec(`
    ALTER TABLE exchange_orders
    ADD COLUMN fill_processing_status TEXT NOT NULL DEFAULT 'PENDING'
  `);
}

if (!columns.includes("fill_processing_attempts")) {
  db.exec(`
    ALTER TABLE exchange_orders
    ADD COLUMN fill_processing_attempts INTEGER NOT NULL DEFAULT 0
  `);
}

if (!columns.includes("fill_processing_error")) {
  db.exec(`
    ALTER TABLE exchange_orders
    ADD COLUMN fill_processing_error TEXT
  `);
}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_exchange_orders_fill_processing
    ON exchange_orders(status, fill_processing_status);
`);
