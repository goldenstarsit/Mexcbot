import assert from "node:assert/strict";
import db from "../src/database/connection.js";
import RuntimeTradingConfigRepository from "../src/database/repositories/runtimeTradingConfigRepository.js";
import TradingConfigService from "../src/services/tradingConfigService.js";
import TradingCycleRepository from "../src/database/repositories/tradingCycleRepository.js";
import tradingConfig from "../src/config/trading.config.js";
import "../src/database/migrations/index.js";

const runtimeRepository =
  new RuntimeTradingConfigRepository();

const configService =
  new TradingConfigService({
    runtimeTradingConfigRepository: runtimeRepository,
    defaultConfig: tradingConfig,
  });

const initial = configService.initialize();

assert.equal(initial.version, 1);
assert.equal(initial.config.takeProfit, 1);
assert.equal(initial.config.stopLoss, 50);

const cycleRepository =
  new TradingCycleRepository();

const snapshot = configService.createCycleSnapshot();

const cycle = cycleRepository.create({
  symbol: "M41TESTUSDT",
  status: "OPEN",
  configSnapshot: snapshot,
});

assert.equal(cycle.config_snapshot_json !== null, true);

const savedSnapshot =
  cycleRepository.getConfigSnapshot(cycle.id);

assert.equal(savedSnapshot.version, 1);
assert.equal(savedSnapshot.config.takeProfit, 1);
assert.equal(savedSnapshot.config.stopLoss, 50);

const updated = configService.update({
  ...initial.config,
  takeProfit: 2,
  stopLoss: 30,
});

assert.equal(updated.version, 2);
assert.equal(updated.config.takeProfit, 2);
assert.equal(updated.config.stopLoss, 30);

const current = configService.getCurrent();

assert.equal(current.version, 2);
assert.equal(current.config.takeProfit, 2);
assert.equal(current.config.stopLoss, 30);

const oldCycleSnapshot =
  cycleRepository.getConfigSnapshot(cycle.id);

assert.equal(oldCycleSnapshot.version, 1);
assert.equal(oldCycleSnapshot.config.takeProfit, 1);
assert.equal(oldCycleSnapshot.config.stopLoss, 50);

const newSnapshot =
  configService.createCycleSnapshot();

assert.equal(newSnapshot.version, 2);
assert.equal(newSnapshot.config.takeProfit, 2);
assert.equal(newSnapshot.config.stopLoss, 30);

db.prepare(
  "DELETE FROM trading_cycles WHERE id = ?",
).run(cycle.id);

db.prepare(
  "DELETE FROM runtime_trading_config WHERE id = 1",
).run();

console.log("M41 CONFIG SNAPSHOT: PASS");
console.log({
  oldCycleVersion: oldCycleSnapshot.version,
  oldCycleTakeProfit: oldCycleSnapshot.config.takeProfit,
  oldCycleStopLoss: oldCycleSnapshot.config.stopLoss,
  newCycleVersion: newSnapshot.version,
  newCycleTakeProfit: newSnapshot.config.takeProfit,
  newCycleStopLoss: newSnapshot.config.stopLoss,
});
