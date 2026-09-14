import assert from "node:assert/strict";
import http from "node:http";

import db from "../src/database/connection.js";
import "./../src/database/migrations/index.js";

import RuntimeTradingConfigRepository from "../src/database/repositories/runtimeTradingConfigRepository.js";
import TradingConfigService from "../src/services/tradingConfigService.js";
import TradingConfigApi from "../src/api/tradingConfigApi.js";
import tradingConfig from "../src/config/trading.config.js";

const repository = new RuntimeTradingConfigRepository();

const service = new TradingConfigService({
  runtimeTradingConfigRepository: repository,
  defaultConfig: tradingConfig,
});

const original = service.initialize();

const api = new TradingConfigApi({
  tradingConfigService: service,
  port: 3001,
});

api.server = http.createServer((request, response) => {
  void api.handle(request, response);
});

await new Promise((resolve, reject) => {
  api.server.once("error", reject);
  api.server.listen(3001, "127.0.0.1", resolve);
});

const address = api.server.address();
const port = address.port;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const requestBody =
      body === undefined ? null : JSON.stringify(body);

    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers: requestBody
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(requestBody),
            }
          : undefined,
      },
      (response) => {
        const chunks = [];

        response.on("data", (chunk) => {
          chunks.push(chunk);
        });

        response.on("end", () => {
          const text =
            Buffer.concat(chunks).toString("utf8");

          resolve({
            statusCode: response.statusCode,
            body: text ? JSON.parse(text) : null,
          });
        });
      },
    );

    request.on("error", reject);

    if (requestBody) {
      request.write(requestBody);
    }

    request.end();
  });
}

try {
  const initial = await request(
    "GET",
    "/api/config",
  );

  assert.equal(initial.statusCode, 200);
  assert.equal(
    initial.body.version,
    original.version,
  );
  assert.equal(
    initial.body.config.takeProfit,
    original.config.takeProfit,
  );
  assert.equal(
    initial.body.config.stopLoss,
    original.config.stopLoss,
  );

  const updatedConfig =
    structuredClone(initial.body.config);

  updatedConfig.takeProfit = 2;
  updatedConfig.stopLoss = 30;

  const updated = await request(
    "PUT",
    "/api/config",
    updatedConfig,
  );

  assert.equal(updated.statusCode, 200);
  assert.equal(
    updated.body.config.takeProfit,
    2,
  );
  assert.equal(
    updated.body.config.stopLoss,
    30,
  );
  assert.equal(
    updated.body.version,
    initial.body.version + 1,
  );

  const invalidConfig =
    structuredClone(updatedConfig);

  invalidConfig.stopLoss = 100;

  const invalid = await request(
    "PUT",
    "/api/config",
    invalidConfig,
  );

  assert.equal(invalid.statusCode, 400);
  assert.match(
    invalid.body.error,
    /stopLoss/i,
  );

  const notFound = await request(
    "GET",
    "/api/does-not-exist",
  );

  assert.equal(notFound.statusCode, 404);

  console.log("M42 CONFIG API: PASS");
  console.log({
    get: initial.statusCode,
    update: updated.statusCode,
    invalidUpdate: invalid.statusCode,
    notFound: notFound.statusCode,
    versionIncremented:
      updated.body.version ===
      initial.body.version + 1,
  });
} finally {
  service.update(original.config);

  await new Promise((resolve) => {
    api.server.close(resolve);
  });

  db.close();
}
