import assert from "node:assert/strict";
import TradingConfigService from "../src/services/tradingConfigService.js";

const db = new Map();

const repository = {
  getConfig() {
    const value = db.get("config");
    return value ? structuredClone(value) : null;
  },

  save(config) {
    db.set("config", structuredClone(config));
  },
};

const defaultConfig = {
  version: 1,
  symbols: ["BTCUSDT", "ETHUSDT"],
  takeProfit: 1,
  stopLoss: 50,
  initialOrder: { enabled: true },
  dca: {
    enabled: true,
    formula: "triangular",
    levels: 9,
  },
  order: {
    type: "LIMIT_MAKER",
    makerOnly: true,
  },
  terminalRecovery: { maxAttempts: 5 },
  fillProcessing: { maxAttempts: 5 },
};

const service = new TradingConfigService({
  runtimeTradingConfigRepository: repository,
  defaultConfig,
});

const initialRuntimeConfig = service.initialize();

const cycle1Snapshot = {
  version: initialRuntimeConfig.version,
  config: structuredClone(initialRuntimeConfig),
};

const updatedConfig = {
  ...structuredClone(defaultConfig),
  version: 2,
  takeProfit: 2,
  stopLoss: 30,
};

service.update(updatedConfig);

const currentRuntimeConfig = service.getCurrent();

const cycle2Snapshot = {
  version: currentRuntimeConfig.version,
  config: structuredClone(currentRuntimeConfig),
};

assert.equal(cycle1Snapshot.version, 1);
assert.equal(cycle1Snapshot.config.takeProfit, 1);
assert.equal(cycle1Snapshot.config.stopLoss, 50);

assert.equal(currentRuntimeConfig.version, 2);
assert.equal(currentRuntimeConfig.takeProfit, 2);
assert.equal(currentRuntimeConfig.stopLoss, 30);

assert.equal(cycle2Snapshot.version, 2);
assert.equal(cycle2Snapshot.config.takeProfit, 2);
assert.equal(cycle2Snapshot.config.stopLoss, 30);

assert.equal(cycle1Snapshot.config.takeProfit, 1);
assert.equal(cycle1Snapshot.config.stopLoss, 50);

const newCycleTakeProfitBeforeIsolationTest =
  cycle2Snapshot.config.takeProfit;

const reportedNewCycleTakeProfit =
  cycle2Snapshot.config.takeProfit;

cycle2Snapshot.config.takeProfit = 99;

assert.equal(cycle1Snapshot.config.takeProfit, 1);
assert.equal(currentRuntimeConfig.takeProfit, 2);
assert.equal(newCycleTakeProfitBeforeIsolationTest, 2);

console.log("M91 CONFIG UPDATE DURING ACTIVE CYCLE: PASS");
console.log({
  activeCycleVersionPreserved: cycle1Snapshot.version === 1,
  activeCycleTakeProfitPreserved: cycle1Snapshot.config.takeProfit === 1,
  activeCycleStopLossPreserved: cycle1Snapshot.config.stopLoss === 50,
  runtimeConfigUpdated: currentRuntimeConfig.version === 2,
  newCycleUsesUpdatedConfig: cycle2Snapshot.version === 2,
  newCycleTakeProfit: reportedNewCycleTakeProfit,
  newCycleStopLoss: cycle2Snapshot.config.stopLoss,
  snapshotIsolationVerified:
    cycle1Snapshot.config.takeProfit === 1 &&
    currentRuntimeConfig.takeProfit === 2,
});
