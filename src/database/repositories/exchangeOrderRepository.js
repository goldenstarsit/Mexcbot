import db from "../connection.js";

export default class ExchangeOrderRepository {
  create({
    tradingCycleId,
    dcaOrderId = null,
    symbol,
    exchangeOrderId,
    side,
    orderType,
    price,
    quantity,
    status,
  }) {
    const result = db
      .prepare(`
        INSERT INTO exchange_orders (
          trading_cycle_id,
          dca_order_id,
          symbol,
          exchange_order_id,
          side,
          order_type,
          price,
          quantity,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        tradingCycleId,
        dcaOrderId,
        symbol,
        exchangeOrderId,
        side,
        orderType,
        price,
        quantity,
        status,
      );

    return this.findById(result.lastInsertRowid);
  }

  findById(id) {
    return db
      .prepare("SELECT * FROM exchange_orders WHERE id = ?")
      .get(id);
  }

  findByExchangeOrderId(exchangeOrderId) {
    return db
      .prepare("SELECT * FROM exchange_orders WHERE exchange_order_id = ?")
      .get(exchangeOrderId);
  }

  findByCycleId(tradingCycleId) {
    return db
      .prepare(`
        SELECT *
        FROM exchange_orders
        WHERE trading_cycle_id = ?
        ORDER BY id ASC
      `)
      .all(tradingCycleId);
  }

  updateStatus(id, status) {
    db.prepare(`
      UPDATE exchange_orders
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, id);

    return this.findById(id);
  }
}
