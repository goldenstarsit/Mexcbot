import assert from "node:assert/strict";
import { validateTradingConfig } from "../src/config/validateTradingConfig.js";
import TradingConfigService from "../src/services/tradingConfigService.js";

const baseConfig = {
  symbols: [
    "BTCUSDT",
    "ETHUSDT",
    "BNBUSDT",
    "SOLUSDT",
    "TRXUSDT",
  ],
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

const clone = () => structuredClone(baseConfig);

const expectInvalid = (config, pattern) => {
  assert.throws(
    () => validateTradingConfig(config),
    pattern,
  );
};

// 1. Valid configuration.
assert.equal(validateTradingConfig(clone()), true);

// 2. Empty symbols.
{
  const config = clone();
  config.symbols = [];
  expectInvalid(config, /non-empty array/i);
}

// 3. Unsupported symbol.
{
  const config = clone();
  config.symbols = ["BADUSDT"];
  expectInvalid(config, /unsupported symbol/i);
}

// 4. Duplicate symbol.
{
  const config = clone();
  config.symbols = ["BTCUSDT", "BTCUSDT"];
  expectInvalid(config, /duplicate symbol/i);
}

// 5. Invalid take profit.
for (const value of [0, -1, NaN, Infinity, -Infinity]) {
  const config = clone();
  config.takeProfit = value;
  expectInvalid(config, /takeProfit/i);
}

// 6. Invalid stop loss.
for (const value of [0, -1, 100, 101, NaN, Infinity]) {
  const config = clone();
  config.stopLoss = value;
  expectInvalid(config, /stopLoss/i);
}

// 7. Initial order must remain enabled.
{
  const config = clone();
  config.initialOrder.enabled = false;
  expectInvalid(config, /initialOrder/i);
}

// 8. DCA must remain enabled.
{
  const config = clone();
  config.dca.enabled = false;
  expectInvalid(config, /dca must be enabled/i);
}

// 9. Only triangular DCA is supported.
{
  const config = clone();
  config.dca.formula = "linear";
  expectInvalid(config, /unsupported DCA formula/i);
}

// 10. Exactly 9 DCA levels.
for (const value of [0, 8, 10, NaN]) {
  const config = clone();
  config.dca.levels = value;
  expectInvalid(config, /DCA levels must be 9/i);
}

// 11. Maker-only protection.
{
  const config = clone();
  config.order.type = "LIMIT";
  expectInvalid(config, /LIMIT_MAKER/i);
}

{
  const config = clone();
  config.order.makerOnly = false;
  expectInvalid(config, /makerOnly/i);
}

// 12. Recovery attempt limits.
for (const value of [0, -1, 1.5, NaN, Infinity]) {
  const config = clone();
  config.terminalRecovery.maxAttempts = value;
  expectInvalid(config, /terminalRecovery.maxAttempts/i);
}

for (const value of [0, -1, 1.5, NaN, Infinity]) {
  const config = clone();
  config.fillProcessing.maxAttempts = value;
  expectInvalid(config, /fillProcessing.maxAttempts/i);
}

// 13. Runtime service must validate before persistence.
{
  let savedConfig = null;
  let saveCalls = 0;

  const repository = {
    getConfig() {
      return savedConfig;
    },

    save(config) {
      saveCalls += 1;
      savedConfig = {
        version: 1,
        config,
      };
    },
  };

  const service = new TradingConfigService({
    runtimeTradingConfigRepository: repository,
    defaultConfig: clone(),
  });

  service.initialize();

  const originalSaved = structuredClone(savedConfig);

  const invalid = clone();
  invalid.stopLoss = 100;

  assert.throws(
    () => service.update(invalid),
    /stopLoss/i,
  );

  assert.equal(
    saveCalls,
    1,
    "Invalid runtime config must not be persisted",
  );

  assert.deepEqual(
    savedConfig,
    originalSaved,
    "Invalid runtime config must not alter persisted config",
  );

  const valid = clone();
  valid.takeProfit = 2;
  valid.stopLoss = 30;

  const updated = service.update(valid);

  assert.equal(updated.config.takeProfit, 2);
  assert.equal(updated.config.stopLoss, 30);
  assert.equal(saveCalls, 2);
}

// 14. Config isolation.
{
  const config = clone();
  const service = new TradingConfigService({
    runtimeTradingConfigRepository: {
      getConfig: () => ({
        version: 1,
        config,
      }),
      save: () => {},
    },
    defaultConfig: config,
  });

  const current = service.getCurrent();
  current.config.symbols.push("BTCUSDT");

  assert.equal(
    config.symbols.length,
    5,
    "Returned runtime config must be isolated",
  );
}

console.log("M90 RUNTIME CONFIG VALIDATION AUDIT: PASS");
console.log({
  validConfigAccepted: true,
  invalidSymbolsRejected: true,
  duplicateSymbolsRejected: true,
  invalidTakeProfitRejected: true,
  invalidStopLossRejected: true,
  invalidInitialOrderRejected: true,
  invalidDcaConfigRejected: true,
  invalidDcaLevelsRejected: true,
  nonMakerOrderRejected: true,
  invalidRecoveryLimitsRejected: true,
  invalidRuntimeUpdateNotPersisted: true,
  validRuntimeUpdatePersisted: true,
  configIsolationVerified: true,
});
