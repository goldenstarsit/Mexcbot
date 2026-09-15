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

const serviceBeforeRestart = new TradingConfigService({
  runtimeTradingConfigRepository: repository,
  defaultConfig,
});

serviceBeforeRestart.initialize();

const persistedConfig = {
  ...structuredClone(defaultConfig),
  takeProfit: 2,
  stopLoss: 25,
};

const updated = serviceBeforeRestart.update(persistedConfig);

assert.equal(updated.version, 2);
assert.equal(updated.config.takeProfit, 2);
assert.equal(updated.config.stopLoss, 25);

// Simulate application restart with a new service instance.
const serviceAfterRestart = new TradingConfigService({
  runtimeTradingConfigRepository: repository,
  defaultConfig,
});

const restored = serviceAfterRestart.getCurrent();

assert.equal(restored.version, 2);
assert.equal(restored.config.takeProfit, 2);
assert.equal(restored.config.stopLoss, 25);

assert.deepEqual(restored.config.symbols, ["BTCUSDT", "ETHUSDT"]);
assert.equal(restored.config.order.type, "LIMIT_MAKER");
assert.equal(restored.config.order.makerOnly, true);

// Verify persisted config is isolated from the service's returned object.
restored.config.takeProfit = 99;

const restoredAgain = serviceAfterRestart.getCurrent();

assert.equal(restoredAgain.config.takeProfit, 2);
assert.equal(restoredAgain.config.stopLoss, 25);

// Verify restart does not fall back to defaults.
assert.notEqual(restoredAgain.config.takeProfit, defaultConfig.takeProfit);
assert.notEqual(restoredAgain.config.stopLoss, defaultConfig.stopLoss);

console.log("M93 CONFIG PERSISTENCE AFTER RESTART: PASS");
console.log({
  configPersisted: true,
  restoredVersion: restoredAgain.version,
  restoredTakeProfit: restoredAgain.config.takeProfit,
  restoredStopLoss: restoredAgain.config.stopLoss,
  defaultsNotRestoredOverPersistedConfig: true,
  persistedConfigIsolationVerified: true,
});
