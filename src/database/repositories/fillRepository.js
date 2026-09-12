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
          filled_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
}
