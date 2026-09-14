import db from "../connection.js";

const columns = db
  .prepare("PRAGMA table_info(trading_cycles)")
  .all()
  .map((column) => column.name);

const additions = [
  ["duration_seconds", "INTEGER"],
  ["initial_price", "REAL"],
  ["final_price", "REAL"],
  ["orders_triggered", "INTEGER NOT NULL DEFAULT 0"],
  ["total_usdt_invested", "REAL NOT NULL DEFAULT 0"],
  ["total_usdt_returned", "REAL NOT NULL DEFAULT 0"],
  ["total_asset_bought", "REAL NOT NULL DEFAULT 0"],
  ["total_asset_sold", "REAL NOT NULL DEFAULT 0"],
  ["overall_pnl", "REAL NOT NULL DEFAULT 0"],
  ["overall_pnl_percent", "REAL NOT NULL DEFAULT 0"],
];

for (const [name, definition] of additions) {
  if (!columns.includes(name)) {
    db.prepare(
      `ALTER TABLE trading_cycles ADD COLUMN ${name} ${definition}`,
    ).run();
  }
}
