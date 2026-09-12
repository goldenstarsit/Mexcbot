import db from "../connection.js";

export default class ExchangeOrderRepository {
  create({
    tradingCycleId,
    dcaOrderId = null,
    symbol,
    exchangeOrderId,
    clientOrderId = null,
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
          client_order_id,
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
        clientOrderId,
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
      .prepare(`
        SELECT *
        FROM exchange_orders
        WHERE exchange_order_id = ?
      `)
      .get(exchangeOrderId);
  }

  findByClientOrderId(clientOrderId) {
    return db
      .prepare(`
        SELECT *
        FROM exchange_orders
        WHERE client_order_id = ?
      `)
      .get(clientOrderId);
  }

  findActiveSellByCycleId(tradingCycleId) {
    return db
      .prepare(`
        SELECT *
        FROM exchange_orders
        WHERE trading_cycle_id = ?
          AND side = 'SELL'
          AND status IN ('NEW', 'ORDER_PLACED', 'PARTIALLY_FILLED')
        ORDER BY id ASC
        LIMIT 1
      `)
      .get(tradingCycleId);
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

  findActive() {
    return db
      .prepare(`
        SELECT *
        FROM exchange_orders
        WHERE status IN ('NEW', 'ORDER_PLACED', 'PARTIALLY_FILLED')
           OR (
             status = 'FILLED'
             AND fill_processing_status IN ('PENDING', 'FAILED', 'PROCESSING')
           )
        ORDER BY id ASC
      `)
      .all();
  }

  markFillProcessing(id) {
    db.prepare(`
      UPDATE exchange_orders
      SET
        fill_processing_status = 'PROCESSING',
        fill_processing_attempts = fill_processing_attempts + 1,
        fill_processing_error = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(id);

    return this.findById(id);
  }

  markFillProcessed(id) {
    db.prepare(`
      UPDATE exchange_orders
      SET
        fill_processing_status = 'PROCESSED',
        fill_processing_error = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(id);

    return this.findById(id);
  }

  markFillProcessingFailed(id, error) {
    db.prepare(`
      UPDATE exchange_orders
      SET
        fill_processing_status = 'FAILED',
        fill_processing_error = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      String(error?.message ?? error ?? "Unknown fill processing error"),
      id,
    );

    return this.findById(id);
  }
}
