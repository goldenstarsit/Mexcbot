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
    placementResponse = null,
    finalResponse = null,
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
          status,
          placement_response_json,
          final_response_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        placementResponse === null
          ? null
          : JSON.stringify(placementResponse),
        finalResponse === null
          ? null
          : JSON.stringify(finalResponse),
      );

    return this.findById(result.lastInsertRowid);
  }

  updatePlacementResponse(id, response) {
    db.prepare(`
      UPDATE exchange_orders
      SET placement_response_json = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      response === null ? null : JSON.stringify(response),
      id,
    );

    return this.findById(id);
  }

  updateFinalResponse(id, response) {
    db.prepare(`
      UPDATE exchange_orders
      SET final_response_json = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      response === null ? null : JSON.stringify(response),
      id,
    );

    return this.findById(id);
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

  findLatestByCycleIdAndSide(tradingCycleId, side) {
    return db
      .prepare(`
        SELECT *
        FROM exchange_orders
        WHERE trading_cycle_id = ?
          AND side = ?
        ORDER BY id DESC
        LIMIT 1
      `)
      .get(tradingCycleId, side);
  }

  findLatestByDcaOrderId(dcaOrderId) {
    return db
      .prepare(`
        SELECT *
        FROM exchange_orders
        WHERE dca_order_id = ?
        ORDER BY id DESC
        LIMIT 1
      `)
      .get(dcaOrderId);
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

  findRecoverableTerminalOrders() {
    return db
      .prepare(`
        SELECT *
        FROM exchange_orders
        WHERE status IN (
          'CANCELED',
          'CANCELLED',
          'REJECTED',
          'EXPIRED'
        )
        AND recovery_status IN ('PENDING', 'FAILED')
        ORDER BY id ASC
      `)
      .all();
  }

  markRecoveryProcessing(id) {
    db.prepare(`
      UPDATE exchange_orders
      SET
        recovery_status = 'PROCESSING',
        recovery_attempts = recovery_attempts + 1,
        recovery_error = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(id);

    return this.findById(id);
  }

  markRecoveryExhausted(id, error) {
    db.prepare(`
      UPDATE exchange_orders
      SET
        recovery_status = 'EXHAUSTED',
        recovery_error = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      String(error?.message ?? error ?? "Recovery attempts exhausted"),
      id,
    );

    return this.findById(id);
  }

  markRecoveryProcessed(id) {
    db.prepare(`
      UPDATE exchange_orders
      SET
        recovery_status = 'PROCESSED',
        recovery_error = NULL,
        recovered_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(id);

    return this.findById(id);
  }

  markRecoveryFailed(id, error) {
    db.prepare(`
      UPDATE exchange_orders
      SET
        recovery_status = 'FAILED',
        recovery_error = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      String(error?.message ?? error ?? "Unknown recovery error"),
      id,
    );

    return this.findById(id);
  }

  findTerminalOrders() {
    return db
      .prepare(`
        SELECT *
        FROM exchange_orders
        WHERE status IN (
          'CANCELED',
          'CANCELLED',
          'REJECTED',
          'EXPIRED'
        )
        ORDER BY id ASC
      `)
      .all();
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

  markFillProcessingExhausted(id, error) {
    db.prepare(`
      UPDATE exchange_orders
      SET
        fill_processing_status = 'EXHAUSTED',
        fill_processing_error = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      String(
        error?.message ??
        error ??
        "Fill processing attempts exhausted",
      ),
      id,
    );

    return this.findById(id);
  }

  recoverFillProcessing(id) {
    db.prepare(`
      UPDATE exchange_orders
      SET
        fill_processing_status = 'FAILED',
        fill_processing_attempts = 0,
        fill_processing_error = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND fill_processing_status = 'EXHAUSTED'
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
