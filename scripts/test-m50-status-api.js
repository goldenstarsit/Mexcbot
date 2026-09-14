import fs from "node:fs";

const dbPath = "./data/test/m50-status-api.db";

if (fs.existsSync(dbPath)) {
  fs.rmSync(dbPath);
}

process.env.MEXCBOT_DB_PATH = dbPath;
process.env.MEXC_API_KEY = "";
process.env.MEXC_API_SECRET = "";
process.env.NODE_ENV = "test";

await import("../src/database/migrations/index.js");

const db = (await import("../src/database/connection.js")).default;
const TradingCycleRepository =
  (await import("../src/database/repositories/tradingCycleRepository.js")).default;
const RuntimeTradingConfigRepository =
  (await import("../src/database/repositories/runtimeTradingConfigRepository.js")).default;
const TradingConfigService =
  (await import("../src/services/tradingConfigService.js")).default;
const BotStatusService =
  (await import("../src/services/botStatusService.js")).default;
const TradingConfigApi =
  (await import("../src/api/tradingConfigApi.js")).default;

const defaultConfig = {
  symbols: ["BTCUSDT", "ETHUSDT"],
  takeProfit: 1,
  stopLoss: 50,
  initialOrder: {
    enabled: true,
  },
  dca: {
    enabled: true,
    formula: "triangular",
    levels: 9,
  },
  order: {
    type: "LIMIT_MAKER",
    makerOnly: true,
  },
  terminalRecovery: {
    maxAttempts: 5,
  },
  fillProcessing: {
    maxAttempts: 5,
  },
};

const runtimeTradingConfigRepository =
  new RuntimeTradingConfigRepository();

const tradingConfigService =
  new TradingConfigService({
    runtimeTradingConfigRepository,
    defaultConfig,
  });

tradingConfigService.initialize();

const tradingCycleRepository =
  new TradingCycleRepository();

const runners = {
  orderPolling: {
    isRunning: () => true,
  },
  reconciliation: {
    isRunning: () => true,
  },
  terminalRecovery: {
    isRunning: () => false,
  },
  orderIntentRecovery: {
    isRunning: () => true,
  },
  orphanRecovery: {
    isRunning: () => false,
  },
};

const botStatusService =
  new BotStatusService({
    tradingConfigService,
    tradingCycleRepository,
    db,
    runners,
  });

const api =
  new TradingConfigApi({
    tradingConfigService,
    tradingCycleRepository,
    botStatusService,
    host: "127.0.0.1",
    port: 33150,
  });

api.start();

try {
  const response =
    await fetch("http://127.0.0.1:33150/api/status");

  const payload = await response.json();

  if (response.status !== 200) {
    throw new Error(
      `Expected HTTP 200, received ${response.status}`,
    );
  }

  if (payload.status !== "OK") {
    throw new Error("Status is not OK");
  }

  if (payload.database.connected !== true) {
    throw new Error("Database is not connected");
  }

  if (payload.database.sqliteVersion === undefined) {
    throw new Error("SQLite version is missing");
  }

  if (payload.runtimeConfig.version !== 1) {
    throw new Error("Unexpected runtime config version");
  }

  if (
    JSON.stringify(payload.runtimeConfig.symbols) !==
    JSON.stringify(["BTCUSDT", "ETHUSDT"])
  ) {
    throw new Error("Runtime symbols mismatch");
  }

  if (payload.liveTrading !== false) {
    throw new Error("Live trading should be disabled in test");
  }

  if (payload.runners.orderPolling !== true) {
    throw new Error("Order polling runner status mismatch");
  }

  if (payload.runners.reconciliation !== true) {
    throw new Error("Reconciliation runner status mismatch");
  }

  if (payload.runners.terminalRecovery !== false) {
    throw new Error("Terminal recovery runner status mismatch");
  }

  console.log("M50 STATUS API: PASS");
  console.log({
    status: response.status,
    botStatus: payload.status,
    liveTrading: payload.liveTrading,
    databaseConnected: payload.database.connected,
    sqliteVersion: payload.database.sqliteVersion,
    runtimeVersion: payload.runtimeConfig.version,
    symbols: payload.runtimeConfig.symbols,
    openCycles: payload.cycles.open,
    orderPolling: payload.runners.orderPolling,
    reconciliation: payload.runners.reconciliation,
    terminalRecovery: payload.runners.terminalRecovery,
  });
} finally {
  await api.stop();

  if (db.open) {
    db.close();
  }
}
