import db from "../connection.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS trading_cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    cycle_number INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS dca_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trading_cycle_id INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    order_number INTEGER NOT NULL,
    order_type TEXT NOT NULL,
    target_price REAL NOT NULL,
    quantity REAL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    triggered_at TEXT,
    FOREIGN KEY (trading_cycle_id) REFERENCES trading_cycles(id) ON DELETE CASCADE,
    UNIQUE (trading_cycle_id, order_number)
  );

  CREATE TABLE IF NOT EXISTS exchange_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trading_cycle_id INTEGER NOT NULL,
    dca_order_id INTEGER,
    symbol TEXT NOT NULL,
    exchange_order_id TEXT NOT NULL UNIQUE,
    side TEXT NOT NULL,
    order_type TEXT NOT NULL,
    price REAL NOT NULL,
    quantity REAL NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT,
    FOREIGN KEY (trading_cycle_id) REFERENCES trading_cycles(id) ON DELETE CASCADE,
    FOREIGN KEY (dca_order_id) REFERENCES dca_orders(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS fills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exchange_order_id INTEGER NOT NULL,
    exchange_trade_id TEXT UNIQUE,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    price REAL NOT NULL,
    quantity REAL NOT NULL,
    commission REAL DEFAULT 0,
    commission_asset TEXT,
    filled_at TEXT NOT NULL,
    FOREIGN KEY (exchange_order_id) REFERENCES exchange_orders(id) ON DELETE CASCADE
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_trading_cycles_symbol_cycle_number
    ON trading_cycles(symbol, cycle_number);

  CREATE INDEX IF NOT EXISTS idx_trading_cycles_symbol_status
    ON trading_cycles(symbol, status);

  CREATE INDEX IF NOT EXISTS idx_dca_orders_cycle_status
    ON dca_orders(trading_cycle_id, status);

  CREATE INDEX IF NOT EXISTS idx_exchange_orders_cycle
    ON exchange_orders(trading_cycle_id);

  CREATE INDEX IF NOT EXISTS idx_exchange_orders_symbol_status
    ON exchange_orders(symbol, status);

  CREATE INDEX IF NOT EXISTS idx_fills_exchange_order
    ON fills(exchange_order_id);
`);
