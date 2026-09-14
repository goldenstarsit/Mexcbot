import http from "node:http";
import TradingConfigApi from "../src/api/tradingConfigApi.js";
import TradingConfigService from "../src/services/tradingConfigService.js";
import tradingConfig from "../src/config/trading.config.js";
import RuntimeTradingConfigRepository from "../src/database/repositories/runtimeTradingConfigRepository.js";
import db from "../src/database/connection.js";
import "../src/database/migrations/index.js";

const repository = new RuntimeTradingConfigRepository(db);
const tradingConfigService = new TradingConfigService({ runtimeTradingConfigRepository: repository, defaultConfig: tradingConfig });

tradingConfigService.initialize();
const original = tradingConfigService.getCurrent();

const port = 30143;
const api = new TradingConfigApi({
  tradingConfigService,
  host: "127.0.0.1",
  port,
});

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: options.method ?? "GET",
        headers: options.headers ?? {},
      },
      (response) => {
        let body = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body,
          });
        });
      },
    );

    request.on("error", reject);

    if (options.body) {
      request.write(options.body);
    }

    request.end();
  });
}

try {
  api.start();

  await new Promise((resolve) => setTimeout(resolve, 100));

  const root = await request("/");
  if (root.status !== 200) {
    throw new Error(`Root page expected 200, got ${root.status}`);
  }

  if (!root.body.includes("MEXCBOT Configuration")) {
    throw new Error("Configuration page title not found");
  }

  if (!root.body.includes("/api/config")) {
    throw new Error("Configuration API reference not found");
  }

  const configPage = await request("/config");
  if (configPage.status !== 200) {
    throw new Error(`/config expected 200, got ${configPage.status}`);
  }

  const config = await request("/api/config");
  if (config.status !== 200) {
    throw new Error(`/api/config expected 200, got ${config.status}`);
  }

  const parsed = JSON.parse(config.body);

  const updated = {
    ...parsed.config,
    symbols: ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "TRXUSDT"],
    takeProfit: 2,
    stopLoss: 30,
  };

  const put = await request("/api/config", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(JSON.stringify(updated)),
    },
    body: JSON.stringify(updated),
  });

  if (put.status !== 200) {
    throw new Error(`PUT /api/config expected 200, got ${put.status}`);
  }

  const saved = JSON.parse(put.body);

  if (saved.config.takeProfit !== 2) {
    throw new Error("Updated takeProfit was not persisted");
  }

  if (saved.config.stopLoss !== 30) {
    throw new Error("Updated stopLoss was not persisted");
  }

  console.log("M43 CONFIGURATION PAGE: PASS");
  console.log({
    root: root.status,
    configPage: configPage.status,
    apiGet: config.status,
    apiPut: put.status,
    takeProfit: saved.config.takeProfit,
    stopLoss: saved.config.stopLoss,
    versionIncremented: saved.version > parsed.version,
  });
} finally {
  tradingConfigService.update(original.config);
  await api.stop();
  db.close();
}
