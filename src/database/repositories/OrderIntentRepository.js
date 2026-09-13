import db from "../connection.js";

export default class OrderIntentRepository {
  create({
    tradingCycleId,
    dcaOrderId = null,
    symbol,
    side,
    orderType,
    price,
    quantity,
    clientOrderId,
    purpose,
  }) {
    const result = db
      .prepare(`
        INSERT INTO order_intents (
          trading_cycle_id,
          dca_order_id,
          symbol,
          side,
          order_type,
          price,
          quantity,
          client_order_id,
          purpose,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
      `)
      .run(
        tradingCycleId,
        dcaOrderId,
        symbol,
        side,
        orderType,
        price,
        quantity,
        clientOrderId,
        purpose,
      );

    return this.findById(result.lastInsertRowid);
  }

  findById(id) {
    return db
      .prepare(`
        SELECT *
        FROM order_intents
        WHERE id = ?
      `)
      .get(id);
  }

  findByClientOrderId(clientOrderId) {
    return db
      .prepare(`
        SELECT *
        FROM order_intents
        WHERE client_order_id = ?
      `)
      .get(clientOrderId);
  }

  findPending() {
    return db
      .prepare(`
        SELECT *
        FROM order_intents
        WHERE status IN ('PENDING', 'RECOVERY_REQUIRED')
        ORDER BY id ASC
      `)
      .all();
  }

  markExchangePlaced(id, exchangeOrderId) {
    db.prepare(`
      UPDATE order_intents
      SET
        status = 'EXCHANGE_PLACED',
        exchange_order_id = ?,
        error = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(exchangeOrderId, id);

    return this.findById(id);
  }

  markRecoveryRequired(id, error = null) {
    db.prepare(`
      UPDATE order_intents
      SET
        status = 'RECOVERY_REQUIRED',
        error = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      error === null
        ? null
        : String(error?.message ?? error),
      id,
    );

    return this.findById(id);
  }

  markResolved(id, exchangeOrderId = null) {
    db.prepare(`
      UPDATE order_intents
      SET
        status = 'RESOLVED',
        exchange_order_id = COALESCE(?, exchange_order_id),
        error = NULL,
        updated_at = CURRENT_TIMESTAMP,
        resolved_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(exchangeOrderId, id);

    return this.findById(id);
  }

  markFailed(id, error = null) {
    db.prepare(`
      UPDATE order_intents
      SET
        status = 'FAILED',
        error = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      error === null
        ? null
        : String(error?.message ?? error),
      id,
    );

    return this.findById(id);
  }
}
