import db from "../connection.js";

export default class TradingCycleRepository {
  create({
    symbol,
    status = "OPEN",
    cycleNumber = null,
    configSnapshot = null,
  }) {
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
          status,
          config_snapshot_json
        )
        VALUES (?, ?, ?, ?)
      `)
      .run(
        symbol,
        nextCycleNumber,
        status,
        configSnapshot
          ? JSON.stringify(configSnapshot)
          : null,
      );

    return this.findById(result.lastInsertRowid);
  }

  findById(id) {
    return db
      .prepare("SELECT * FROM trading_cycles WHERE id = ?")
      .get(id);
  }

  updatePerformanceSummary(cycleId) {
    const cycle = this.findById(cycleId);

    if (!cycle) {
      throw new Error(`Trading cycle ${cycleId} not found`);
    }

    const summary = db
      .prepare(`
        SELECT
          COUNT(DISTINCT CASE
            WHEN UPPER(f.side) = 'BUY' THEN eo.id
          END) AS orders_triggered,

          COALESCE(SUM(
            CASE
              WHEN UPPER(f.side) = 'BUY'
              THEN f.price * f.quantity
              ELSE 0
            END
          ), 0) AS total_usdt_invested,

          COALESCE(SUM(
            CASE
              WHEN UPPER(f.side) = 'SELL'
              THEN f.price * f.quantity
              ELSE 0
            END
          ), 0) AS total_usdt_returned,

          COALESCE(SUM(
            CASE
              WHEN UPPER(f.side) = 'BUY'
              THEN f.quantity
              ELSE 0
            END
          ), 0) AS total_asset_bought,

          COALESCE(SUM(
            CASE
              WHEN UPPER(f.side) = 'SELL'
              THEN f.quantity
              ELSE 0
            END
          ), 0) AS total_asset_sold,

          (
            SELECT f2.price
            FROM fills f2
            INNER JOIN exchange_orders eo2
              ON eo2.id = f2.exchange_order_id
            WHERE eo2.trading_cycle_id = ?
              AND UPPER(f2.side) = 'BUY'
            ORDER BY f2.filled_at ASC, f2.id ASC
            LIMIT 1
          ) AS initial_price,

          (
            SELECT
              SUM(f3.price * f3.quantity) /
              NULLIF(SUM(f3.quantity), 0)
            FROM fills f3
            INNER JOIN exchange_orders eo3
              ON eo3.id = f3.exchange_order_id
            WHERE eo3.trading_cycle_id = ?
              AND UPPER(f3.side) = 'SELL'
          ) AS final_price
        FROM fills f
        INNER JOIN exchange_orders eo
          ON eo.id = f.exchange_order_id
        WHERE eo.trading_cycle_id = ?
      `)
      .get(cycleId, cycleId, cycleId);

    const invested = Number(summary.total_usdt_invested ?? 0);
    const returned = Number(summary.total_usdt_returned ?? 0);
    const pnl = returned - invested;
    const pnlPercent =
      invested > 0
        ? (pnl / invested) * 100
        : 0;

    let durationSeconds = cycle.duration_seconds ?? null;

    if (cycle.status === "CLOSED" && cycle.closed_at) {
      durationSeconds =
        db
          .prepare(`
            SELECT
              CAST(
                (
                  julianday(?) - julianday(?)
                ) * 86400
                AS INTEGER
              ) AS duration_seconds
          `)
          .get(cycle.closed_at, cycle.created_at)
          ?.duration_seconds ?? null;
    }

    db.prepare(`
      UPDATE trading_cycles
      SET
        duration_seconds = ?,
        initial_price = ?,
        final_price = ?,
        orders_triggered = ?,
        total_usdt_invested = ?,
        total_usdt_returned = ?,
        total_asset_bought = ?,
        total_asset_sold = ?,
        overall_pnl = ?,
        overall_pnl_percent = ?
      WHERE id = ?
    `).run(
      durationSeconds,
      summary.initial_price === null
        ? null
        : Number(summary.initial_price),
      summary.final_price === null
        ? null
        : Number(summary.final_price),
      Number(summary.orders_triggered ?? 0),
      invested,
      returned,
      Number(summary.total_asset_bought ?? 0),
      Number(summary.total_asset_sold ?? 0),
      pnl,
      pnlPercent,
      cycleId,
    );

    return this.findById(cycleId);
  }



  getConfigSnapshot(id) {
    const cycle = this.findById(id);

    if (!cycle?.config_snapshot_json) {
      return null;
    }

    return JSON.parse(cycle.config_snapshot_json);
  }

  findByStatus(status) {
    return db
      .prepare(`
        SELECT *
        FROM trading_cycles
        WHERE status = ?
        ORDER BY id ASC
      `)
      .all(status);
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

  listPerformanceHistory({
    symbol = null,
    status = null,
    limit = 50,
    offset = 0,
  } = {}) {
    const conditions = [];
    const params = [];

    if (symbol) {
      conditions.push("symbol = ?");
      params.push(symbol);
    }

    if (status) {
      conditions.push("status = ?");
      params.push(status);
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const safeLimit = Math.min(
      Math.max(Number.parseInt(limit, 10) || 50, 1),
      100,
    );

    const safeOffset = Math.max(
      Number.parseInt(offset, 10) || 0,
      0,
    );

    params.push(safeLimit, safeOffset);

    return db
      .prepare(`
        SELECT
          id,
          symbol,
          cycle_number,
          status,
          created_at,
          closed_at,
          duration_seconds,
          initial_price,
          final_price,
          orders_triggered,
          total_usdt_invested,
          total_usdt_returned,
          total_asset_bought,
          total_asset_sold,
          overall_pnl,
          overall_pnl_percent
        FROM trading_cycles
        ${whereClause}
        ORDER BY id DESC
        LIMIT ? OFFSET ?
      `)
      .all(...params);
  }

  findPerformanceById(id) {
    return db
      .prepare(`
        SELECT
          id,
          symbol,
          cycle_number,
          status,
          created_at,
          closed_at,
          duration_seconds,
          initial_price,
          final_price,
          orders_triggered,
          total_usdt_invested,
          total_usdt_returned,
          total_asset_bought,
          total_asset_sold,
          overall_pnl,
          overall_pnl_percent
        FROM trading_cycles
        WHERE id = ?
      `)
      .get(id);
  }

  listPerformanceHistory({
    symbol = null,
    status = null,
    limit = 50,
    offset = 0,
  } = {}) {
    const conditions = [];
    const params = [];

    if (symbol) {
      conditions.push("symbol = ?");
      params.push(symbol);
    }

    if (status) {
      conditions.push("status = ?");
      params.push(status);
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const safeLimit = Math.min(
      Math.max(Number.parseInt(limit, 10) || 50, 1),
      100,
    );

    const safeOffset = Math.max(
      Number.parseInt(offset, 10) || 0,
      0,
    );

    params.push(safeLimit, safeOffset);

    return db
      .prepare(`
        SELECT
          id,
          symbol,
          cycle_number,
          status,
          created_at,
          closed_at,
          duration_seconds,
          initial_price,
          final_price,
          orders_triggered,
          total_usdt_invested,
          total_usdt_returned,
          total_asset_bought,
          total_asset_sold,
          overall_pnl,
          overall_pnl_percent
        FROM trading_cycles
        ${whereClause}
        ORDER BY id DESC
        LIMIT ? OFFSET ?
      `)
      .all(...params);
  }

  findPerformanceById(id) {
    return db
      .prepare(`
        SELECT
          id,
          symbol,
          cycle_number,
          status,
          created_at,
          closed_at,
          duration_seconds,
          initial_price,
          final_price,
          orders_triggered,
          total_usdt_invested,
          total_usdt_returned,
          total_asset_bought,
          total_asset_sold,
          overall_pnl,
          overall_pnl_percent
        FROM trading_cycles
        WHERE id = ?
      `)
      .get(id);
  }
}
