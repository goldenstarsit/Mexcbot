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

  transition(id, nextStatus) {
    const intent = this.findById(id);

    if (!intent) {
      throw new Error(`Order intent ${id} was not found`);
    }

    const currentStatus = String(intent.status ?? "").toUpperCase();
    const allowedTransitions = {
      PENDING: new Set([
        "EXCHANGE_PLACED",
        "RECOVERY_REQUIRED",
        "FAILED",
        "RESOLVED",
      ]),
      RECOVERY_REQUIRED: new Set([
        "RESOLVED",
        "RECOVERY_REQUIRED",
      ]),
      EXCHANGE_PLACED: new Set([
        "RESOLVED",
        "RECOVERY_REQUIRED",
      ]),
      RESOLVED: new Set(),
      FAILED: new Set(),
    };

    const allowed = allowedTransitions[currentStatus] ?? new Set();

    if (!allowed.has(nextStatus)) {
      throw new Error(
        `Invalid order intent transition: ${currentStatus} -> ${nextStatus}`,
      );
    }

    return intent;
  }

  markExchangePlaced(id, exchangeOrderId) {
    this.transition(id, "EXCHANGE_PLACED");

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
    this.transition(id, "RECOVERY_REQUIRED");

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
    this.transition(id, "RESOLVED");

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
    this.transition(id, "FAILED");

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
