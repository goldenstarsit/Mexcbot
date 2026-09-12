import db from "../connection.js";

export default class TradingCycleRepository {
  create({ symbol, status = "OPEN" }) {
    const result = db
      .prepare(`
        INSERT INTO trading_cycles (symbol, status)
        VALUES (?, ?)
      `)
      .run(symbol, status);

    return this.findById(result.lastInsertRowid);
  }

  findById(id) {
    return db
      .prepare("SELECT * FROM trading_cycles WHERE id = ?")
      .get(id);
  }

  findOpenBySymbol(symbol) {
    return db
      .prepare(`
        SELECT *
        FROM trading_cycles
        WHERE symbol = ? AND status = 'OPEN'
        ORDER BY id DESC
        LIMIT 1
      `)
      .get(symbol);
  }

  updateStatus(id, status) {
    db.prepare(`
      UPDATE trading_cycles
      SET status = ?,
          closed_at = CASE
            WHEN ? = 'CLOSED' THEN CURRENT_TIMESTAMP
            ELSE closed_at
          END
      WHERE id = ?
    `).run(status, status, id);

    return this.findById(id);
  }

  listBySymbol(symbol) {
    return db
      .prepare(`
        SELECT *
        FROM trading_cycles
        WHERE symbol = ?
        ORDER BY id DESC
      `)
      .all(symbol);
  }
}
