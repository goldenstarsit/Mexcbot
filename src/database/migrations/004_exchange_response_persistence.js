import db from "../connection.js";

const exchangeOrderColumns = db
  .prepare("PRAGMA table_info(exchange_orders)")
  .all()
  .map((column) => column.name);

if (!exchangeOrderColumns.includes("placement_response_json")) {
  db.exec(`
    ALTER TABLE exchange_orders
    ADD COLUMN placement_response_json TEXT
  `);
}

if (!exchangeOrderColumns.includes("final_response_json")) {
  db.exec(`
    ALTER TABLE exchange_orders
    ADD COLUMN final_response_json TEXT
  `);
}

const fillColumns = db
  .prepare("PRAGMA table_info(fills)")
  .all()
  .map((column) => column.name);

if (!fillColumns.includes("exchange_response_json")) {
  db.exec(`
    ALTER TABLE fills
    ADD COLUMN exchange_response_json TEXT
  `);
}
