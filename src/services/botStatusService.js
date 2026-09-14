export default class BotStatusService {
  constructor({
    tradingConfigService,
    tradingCycleRepository,
    db,
    runners = {},
  }) {
    if (!tradingConfigService) {
      throw new Error("Trading config service is required");
    }

    if (!tradingCycleRepository) {
      throw new Error("Trading cycle repository is required");
    }

    if (!db) {
      throw new Error("Database connection is required");
    }

    this.tradingConfigService = tradingConfigService;
    this.tradingCycleRepository = tradingCycleRepository;
    this.db = db;
    this.runners = runners;
    this.startedAt = new Date().toISOString();
  }

  getStatus() {
    const runtimeConfig =
      this.tradingConfigService.getCurrent();

    const cycles = this.db
      .prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END) AS open,
          SUM(CASE WHEN status = 'EXIT_PENDING' THEN 1 ELSE 0 END) AS exitPending,
          SUM(CASE WHEN status = 'CLOSED' THEN 1 ELSE 0 END) AS closed
        FROM trading_cycles
      `)
      .get();

    const sqlite =
      this.db
        .prepare("SELECT sqlite_version() AS version")
        .get()
        .version;

    const hasApiCredentials =
      Boolean(process.env.MEXC_API_KEY) &&
      Boolean(process.env.MEXC_API_SECRET);

    const runnerStatus = {};

    for (const [name, runner] of Object.entries(this.runners)) {
      runnerStatus[name] =
        typeof runner?.isRunning === "function"
          ? runner.isRunning()
          : false;
    }

    return {
      status: "OK",
      environment: process.env.NODE_ENV ?? "development",
      liveTrading: hasApiCredentials,
      database: {
        connected: this.db.open,
        sqliteVersion: sqlite,
      },
      runtimeConfig: {
        version: runtimeConfig.version,
        symbols: runtimeConfig.config.symbols,
        takeProfit: runtimeConfig.config.takeProfit,
        stopLoss: runtimeConfig.config.stopLoss,
      },
      cycles: {
        total: Number(cycles.total ?? 0),
        open: Number(cycles.open ?? 0),
        exitPending: Number(cycles.exitPending ?? 0),
        closed: Number(cycles.closed ?? 0),
      },
      runners: runnerStatus,
      startedAt: this.startedAt,
      checkedAt: new Date().toISOString(),
    };
  }
}
