import db from "../connection.js";

const columns = db
  .prepare("PRAGMA table_info(exchange_orders)")
  .all()
  .map((column) => column.name);

if (!columns.includes("client_order_id")) {
  db.exec(`
    ALTER TABLE exchange_orders
    ADD COLUMN client_order_id TEXT
  `);
}

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_exchange_orders_client_order_id
    ON exchange_orders(client_order_id)
    WHERE client_order_id IS NOT NULL;
`);
