import db from "../connection.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS order_intents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trading_cycle_id INTEGER NOT NULL,
    dca_order_id INTEGER,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    order_type TEXT NOT NULL,
    price REAL NOT NULL,
    quantity REAL NOT NULL,
    client_order_id TEXT NOT NULL UNIQUE,
    purpose TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    exchange_order_id TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT,
    resolved_at TEXT,
    FOREIGN KEY (trading_cycle_id)
      REFERENCES trading_cycles(id)
      ON DELETE CASCADE,
    FOREIGN KEY (dca_order_id)
      REFERENCES dca_orders(id)
      ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_order_intents_status
    ON order_intents(status);

  CREATE INDEX IF NOT EXISTS idx_order_intents_cycle
    ON order_intents(trading_cycle_id);

  CREATE INDEX IF NOT EXISTS idx_order_intents_exchange_order
    ON order_intents(exchange_order_id);

  CREATE INDEX IF NOT EXISTS idx_order_intents_symbol_status
    ON order_intents(symbol, status);
`);
