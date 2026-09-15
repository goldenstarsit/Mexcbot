import db from "../connection.js";

export default class FillRepository {
  create({
    exchangeOrderId,
    exchangeTradeId = null,
    symbol,
    side,
    price,
    quantity,
    commission = 0,
    commissionAsset = null,
    filledAt,
    exchangeResponse = null,
  }) {
    const result = db
      .prepare(`
        INSERT INTO fills (
          exchange_order_id,
          exchange_trade_id,
          symbol,
          side,
          price,
          quantity,
          commission,
          commission_asset,
          filled_at,
          exchange_response_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        exchangeOrderId,
        exchangeTradeId,
        symbol,
        side,
        price,
        quantity,
        commission,
        commissionAsset,
        filledAt,
        exchangeResponse === null
          ? null
          : JSON.stringify(exchangeResponse),
      );

    return this.findById(result.lastInsertRowid);
  }

  findById(id) {
    return db
      .prepare("SELECT * FROM fills WHERE id = ?")
      .get(id);
  }

  findByExchangeOrderId(exchangeOrderId) {
    return db
      .prepare(`
        SELECT *
        FROM fills
        WHERE exchange_order_id = ?
        ORDER BY id ASC
      `)
      .all(exchangeOrderId);
  }

  findByExchangeTradeId(exchangeTradeId) {
    if (!exchangeTradeId) {
      return null;
    }

    return db
      .prepare(`
        SELECT *
        FROM fills
        WHERE exchange_trade_id = ?
      `)
      .get(exchangeTradeId);
  }

  createTradeFill({
    exchangeOrderId,
    exchangeTradeId,
    symbol,
    side,
    price,
    quantity,
    commission = 0,
    commissionAsset = null,
    filledAt,
    exchangeResponse = null,
  }) {
    if (!exchangeTradeId) {
      throw new Error("Exchange trade ID is required");
    }

    const existing = this.findByExchangeTradeId(exchangeTradeId);

    if (existing) {
      return {
        created: false,
        duplicate: true,
        fill: existing,
      };
    }

    const fill = this.create({
      exchangeOrderId,
      exchangeTradeId,
      symbol,
      side,
      price,
      quantity,
      commission,
      commissionAsset,
      filledAt,
      exchangeResponse,
    });

    return {
      created: true,
      duplicate: false,
      fill,
    };
  }

  findBySymbol(symbol) {
    return db
      .prepare(`
        SELECT *
        FROM fills
        WHERE symbol = ?
        ORDER BY filled_at DESC, id DESC
      `)
      .all(symbol);
  }

  findByCycleId(tradingCycleId) {
    return db
      .prepare(`
        SELECT f.*
        FROM fills f
        INNER JOIN exchange_orders eo
          ON eo.id = f.exchange_order_id
        WHERE eo.trading_cycle_id = ?
        ORDER BY f.id ASC
      `)
      .all(tradingCycleId);
  }
}
