import db from "../connection.js";

export default class TradingCycleRepository {
  create({ symbol, status = "OPEN", cycleNumber = null }) {
    if (!symbol) {
      throw new Error("Symbol is required");
    }

    const nextCycleNumber =
      cycleNumber ??
      (
        db
          .prepare(`
            SELECT COALESCE(MAX(cycle_number), 0) + 1 AS next_cycle_number
            FROM trading_cycles
            WHERE symbol = ?
          `)
          .get(symbol)?.next_cycle_number ?? 1
      );

    const result = db
      .prepare(`
        INSERT INTO trading_cycles (
          symbol,
          cycle_number,
          status
        )
        VALUES (?, ?, ?)
      `)
      .run(symbol, nextCycleNumber, status);

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
        ORDER BY cycle_number DESC
        LIMIT 1
      `)
      .get(symbol);
  }

  findLatestBySymbol(symbol) {
    return db
      .prepare(`
        SELECT *
        FROM trading_cycles
        WHERE symbol = ?
        ORDER BY cycle_number DESC
        LIMIT 1
      `)
      .get(symbol);
  }

  getNextCycleNumber(symbol) {
    return (
      db
        .prepare(`
          SELECT COALESCE(MAX(cycle_number), 0) + 1 AS next_cycle_number
          FROM trading_cycles
          WHERE symbol = ?
        `)
        .get(symbol)?.next_cycle_number ?? 1
    );
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

  reserveExit(id) {
    const result = db
      .prepare(`
        UPDATE trading_cycles
        SET status = 'EXIT_PENDING'
        WHERE id = ?
          AND status = 'OPEN'
      `)
      .run(id);

    return {
      reserved: result.changes === 1,
      cycle: this.findById(id),
    };
  }

  listBySymbol(symbol) {
    return db
      .prepare(`
        SELECT *
        FROM trading_cycles
        WHERE symbol = ?
        ORDER BY cycle_number DESC
      `)
      .all(symbol);
  }
}
