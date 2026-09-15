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

const buyCycleConfig = service.createCycleSnapshot();

let buyStarted = false;
let buyConfig;

const concurrentBuy = (async () => {
  buyStarted = true;

  // Capture the cycle snapshot before the runtime update.
  buyConfig = structuredClone(buyCycleConfig);

  await new Promise((resolve) => setTimeout(resolve, 10));

  return {
    version: buyConfig.version,
    takeProfit: buyConfig.config.takeProfit,
    stopLoss: buyConfig.config.stopLoss,
  };
})();

// Allow BUY to reach its snapshot boundary.
while (!buyStarted) {
  await new Promise((resolve) => setImmediate(resolve));
}

const updatedConfig = {
  ...structuredClone(defaultConfig),
  takeProfit: 3,
  stopLoss: 20,
};

service.update(updatedConfig);

const buyResult = await concurrentBuy;
const currentRuntimeConfig = service.getCurrent();

assert.equal(buyResult.version, 1);
assert.equal(buyResult.takeProfit, 1);
assert.equal(buyResult.stopLoss, 50);

assert.equal(currentRuntimeConfig.version, 2);
assert.equal(currentRuntimeConfig.config.takeProfit, 3);
assert.equal(currentRuntimeConfig.config.stopLoss, 20);

assert.notEqual(buyResult.version, currentRuntimeConfig.version);
assert.notEqual(buyResult.takeProfit, currentRuntimeConfig.config.takeProfit);
assert.notEqual(buyResult.stopLoss, currentRuntimeConfig.config.stopLoss);

console.log("M92 CONFIG UPDATE DURING CONCURRENT BUY: PASS");
console.log({
  buyStartedBeforeConfigUpdate: true,
  buyCycleVersionPreserved: buyResult.version === 1,
  buyTakeProfitPreserved: buyResult.takeProfit === 1,
  buyStopLossPreserved: buyResult.stopLoss === 50,
  runtimeConfigUpdated: currentRuntimeConfig.version === 2,
  runtimeTakeProfit: currentRuntimeConfig.config.takeProfit,
  runtimeStopLoss: currentRuntimeConfig.config.stopLoss,
  concurrentConfigIsolationVerified: true,
});
