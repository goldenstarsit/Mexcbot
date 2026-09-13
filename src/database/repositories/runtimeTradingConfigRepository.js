import db from "../connection.js";

export default class RuntimeTradingConfigRepository {
  find() {
    return db
      .prepare(`
        SELECT *
        FROM runtime_trading_config
        WHERE id = 1
      `)
      .get();
  }

  save(config) {
    if (!config || typeof config !== "object") {
      throw new Error("Trading config is required");
    }

    const current = this.find();
    const version = current ? Number(current.version) + 1 : 1;

    db.prepare(`
      INSERT INTO runtime_trading_config (
        id,
        config_json,
        version,
        updated_at
      )
      VALUES (1, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        config_json = excluded.config_json,
        version = excluded.version,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      JSON.stringify(config),
      version,
    );

    return this.find();
  }

  getConfig() {
    const row = this.find();

    if (!row) {
      return null;
    }

    return {
      config: JSON.parse(row.config_json),
      version: Number(row.version),
      updatedAt: row.updated_at,
    };
  }
}
