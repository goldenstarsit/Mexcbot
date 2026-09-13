import db from "../connection.js";

export default class DcaOrderRepository {
  create({
    tradingCycleId,
    symbol,
    orderNumber,
    orderType,
    targetPrice,
    quantity = null,
    status = "PENDING",
  }) {
    const result = db
      .prepare(`
        INSERT INTO dca_orders (
          trading_cycle_id,
          symbol,
          order_number,
          order_type,
          target_price,
          quantity,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        tradingCycleId,
        symbol,
        orderNumber,
        orderType,
        targetPrice,
        quantity,
        status,
      );

    return this.findById(result.lastInsertRowid);
  }

  findById(id) {
    return db
      .prepare("SELECT * FROM dca_orders WHERE id = ?")
      .get(id);
  }

  findByCycleId(tradingCycleId) {
    return db
      .prepare(`
        SELECT *
        FROM dca_orders
        WHERE trading_cycle_id = ?
        ORDER BY order_number ASC
      `)
      .all(tradingCycleId);
  }

  findByExchangeOrderId(exchangeOrderId) {
    return db
      .prepare(`
        SELECT *
        FROM dca_orders
        WHERE id IN (
          SELECT dca_order_id
          FROM exchange_orders
          WHERE exchange_order_id = ?
            AND dca_order_id IS NOT NULL
        )
        LIMIT 1
      `)
      .get(exchangeOrderId);
  }

  findPendingByCycleId(tradingCycleId) {
    return db
      .prepare(`
        SELECT *
        FROM dca_orders
        WHERE trading_cycle_id = ? AND status = 'PENDING'
        ORDER BY order_number ASC
      `)
      .all(tradingCycleId);
  }

  updateStatus(id, status) {
    db.prepare(`
      UPDATE dca_orders
      SET status = ?,
          triggered_at = CASE
            WHEN ? = 'TRIGGERED' THEN CURRENT_TIMESTAMP
            ELSE triggered_at
          END
      WHERE id = ?
    `).run(status, status, id);

    return this.findById(id);
  }

  updateQuantity(id, quantity) {
    db.prepare(`
      UPDATE dca_orders
      SET quantity = ?
      WHERE id = ?
    `).run(quantity, id);

    return this.findById(id);
  }
}
