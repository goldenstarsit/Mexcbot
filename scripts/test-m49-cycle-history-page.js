process.env.MEXCBOT_DB_PATH = "./data/test/m49-cycle-history-page.db";

import fs from "node:fs";
import http from "node:http";

const dbPath = "./data/test/m49-cycle-history-page.db";

for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
  fs.rmSync(file, { force: true });
}

await import("../src/database/migrations/index.js");

const { default: TradingCycleRepository } =
  await import("../src/database/repositories/tradingCycleRepository.js");
const { default: RuntimeTradingConfigRepository } =
  await import("../src/database/repositories/runtimeTradingConfigRepository.js");
const { default: TradingConfigService } =
  await import("../src/services/tradingConfigService.js");
const { default: TradingConfigApi } =
  await import("../src/api/tradingConfigApi.js");
const { default: tradingConfig } =
  await import("../src/config/trading.config.js");

const PORT = 33149;

const tradingCycleRepository = new TradingCycleRepository();
const runtimeTradingConfigRepository =
  new RuntimeTradingConfigRepository();

const tradingConfigService = new TradingConfigService({
  runtimeTradingConfigRepository,
  defaultConfig: tradingConfig,
});

tradingConfigService.initialize();

const cycle = tradingCycleRepository.create({
  symbol: "BTCUSDT",
  cycleNumber: 1,
  configSnapshot: {
    version: 1,
    config: tradingConfig,
  },
});

const api = new TradingConfigApi({
  tradingConfigService,
  tradingCycleRepository,
  host: "127.0.0.1",
  port: PORT,
});

api.start();

const request = (path) =>
  new Promise((resolve, reject) => {
    const req = http.get(
      `http://127.0.0.1:${PORT}${path}`,
      (res) => {
        let body = "";

        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            body,
          });
        });
      },
    );

    req.on("error", reject);
  });

try {
  const cyclesPage = await request("/cycles");
  const historyPage = await request("/history");
  const apiResponse = await request("/api/cycles");
  const detailResponse = await request(`/api/cycles/${cycle.id}`);

  if (cyclesPage.status !== 200) {
    throw new Error(`/cycles expected 200, got ${cyclesPage.status}`);
  }

  if (!cyclesPage.body.includes("Cycle Performance")) {
    throw new Error("Cycle Performance title missing");
  }

  if (!cyclesPage.body.includes("Cycle History")) {
    throw new Error("Cycle History section missing");
  }

  if (historyPage.status !== 200) {
    throw new Error(`/history expected 200, got ${historyPage.status}`);
  }

  if (!historyPage.body.includes("Cycle Performance")) {
    throw new Error("History page content missing");
  }

  if (apiResponse.status !== 200) {
    throw new Error(
      `/api/cycles expected 200, got ${apiResponse.status}`,
    );
  }

  const apiData = JSON.parse(apiResponse.body);

  if (!Array.isArray(apiData.cycles)) {
    throw new Error("API cycles array missing");
  }

  if (apiData.cycles.length !== 1) {
    throw new Error(
      `Expected 1 cycle, got ${apiData.cycles.length}`,
    );
  }

  if (apiData.cycles[0].symbol !== "BTCUSDT") {
    throw new Error("Expected BTCUSDT cycle");
  }

  if (detailResponse.status !== 200) {
    throw new Error(
      `/api/cycles/:id expected 200, got ${detailResponse.status}`,
    );
  }

  const detailData = JSON.parse(detailResponse.body);

  if (detailData.cycle.id !== cycle.id) {
    throw new Error("Cycle detail ID mismatch");
  }

  console.log("M49 CYCLE HISTORY PAGE: PASS");
  console.log({
    cyclesPageStatus: cyclesPage.status,
    historyPageStatus: historyPage.status,
    apiStatus: apiResponse.status,
    detailStatus: detailResponse.status,
    cyclesReturned: apiData.cycles.length,
    symbol: apiData.cycles[0].symbol,
  });
} finally {
  await api.stop();
  fs.rmSync(dbPath, { force: true });
  fs.rmSync(`${dbPath}-wal`, { force: true });
  fs.rmSync(`${dbPath}-shm`, { force: true });
}
