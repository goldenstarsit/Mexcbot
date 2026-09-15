import assert from "node:assert/strict";
import TradingConfigService from "../src/services/tradingConfigService.js";

const db = new Map();

const repository = {
  getConfig() {
    const value = db.get("config");
    return value ? structuredClone(value) : null;
  },

  save(config) {
    const current = db.get("config");
    const version = current ? current.version + 1 : 1;

    db.set("config", {
      config: structuredClone(config),
      version,
      updatedAt: new Date().toISOString(),
    });
  },
};

const defaultConfig = {
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

service.initialize();

// Cycle 1 captures configuration version 1.
const cycle1 = service.createCycleSnapshot();

assert.equal(cycle1.version, 1);
assert.equal(cycle1.config.takeProfit, 1);
assert.equal(cycle1.config.stopLoss, 50);
assert.equal(cycle1.config.dca.levels, 9);
assert.equal(cycle1.config.order.type, "LIMIT_MAKER");

// Runtime configuration changes while Cycle 1 remains active.
service.update({
  ...structuredClone(defaultConfig),
  takeProfit: 2,
  stopLoss: 30,
  dca: {
    enabled: true,
    formula: "triangular",
    levels: 9,
  },
});

// Cycle 1 must remain completely unchanged.
assert.equal(cycle1.version, 1);
assert.equal(cycle1.config.takeProfit, 1);
assert.equal(cycle1.config.stopLoss, 50);
assert.equal(cycle1.config.dca.levels, 9);
assert.equal(cycle1.config.order.type, "LIMIT_MAKER");

// Cycle 2 must use the new runtime configuration.
const cycle2 = service.createCycleSnapshot();

assert.equal(cycle2.version, 2);
assert.equal(cycle2.config.takeProfit, 2);
assert.equal(cycle2.config.stopLoss, 30);
assert.equal(cycle2.config.dca.levels, 9);

// Deep isolation: mutate Cycle 2 and verify Cycle 1/runtime are unaffected.
cycle2.config.takeProfit = 99;
cycle2.config.dca.levels = 1;
cycle2.config.order.type = "MUTATED";

assert.equal(cycle1.config.takeProfit, 1);
assert.equal(cycle1.config.dca.levels, 9);
assert.equal(cycle1.config.order.type, "LIMIT_MAKER");

const runtimeAfterCycle2Mutation = service.getCurrent();

assert.equal(runtimeAfterCycle2Mutation.version, 2);
assert.equal(runtimeAfterCycle2Mutation.config.takeProfit, 2);
assert.equal(runtimeAfterCycle2Mutation.config.dca.levels, 9);
assert.equal(runtimeAfterCycle2Mutation.config.order.type, "LIMIT_MAKER");

// Returned runtime config must also be isolated.
runtimeAfterCycle2Mutation.config.stopLoss = 5;

const runtimeFinal = service.getCurrent();

assert.equal(runtimeFinal.config.stopLoss, 30);

console.log("M94 CYCLE SNAPSHOT ISOLATION FINAL AUDIT: PASS");
console.log({
  cycle1VersionPreserved: cycle1.version === 1,
  cycle1TakeProfitPreserved: cycle1.config.takeProfit === 1,
  cycle1StopLossPreserved: cycle1.config.stopLoss === 50,
  cycle2UsesNewConfig: cycle2.version === 2,
  cycle2TakeProfit: 2,
  cycle2StopLoss: 30,
  dcaSnapshotIsolationVerified: true,
  orderSnapshotIsolationVerified: true,
  runtimeConfigIsolationVerified: true,
  crossCycleIsolationVerified: true,
});
