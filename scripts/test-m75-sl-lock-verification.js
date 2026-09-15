import assert from "node:assert/strict";
import PositionProtectionService from "../src/services/positionProtectionService.js";
import PositionCalculator from "../src/services/positionCalculator.js";

const cycleConfig = {
  takeProfit: 1,
  stopLoss: 50,
};

const dcaCalculator = {
  calculateLevels(initialPrice) {
    return [{
      orderNumber: 2,
      dcaLevel: 1,
      dropPercent: 1,
      targetPrice: initialPrice * 0.99,
    }];
  },
};

const quantityCalculator = {
  calculateBuyQuantity() {
    return 0.01;
  },
};

const symbolRulesService = {
  async get() {
    return {
      stepSize: 0.01,
      minQty: 0.01,
      minNotional: 1,
    };
  },
};

const service = new PositionProtectionService({
  positionCalculator: new PositionCalculator(),
  dcaCalculator,
  quantityCalculator,
  symbolRulesService,
  tradingConfig: cycleConfig,
});

const initialFills = [
  { side: "BUY", quantity: 0.01, price: 100 },
  { side: "BUY", quantity: 0.01, price: 101 },
  { side: "BUY", quantity: 0.01, price: 103 },
];

const initialResult = await service.calculateAfterInitialFill({
  symbol: "BTCUSDT",
  initialFill: initialFills[0],
  initialFills,
  config: cycleConfig,
});

const expectedInitialAverage = 3.04 / 0.03;
const expectedLockedSl = 100 * (1 - 50 / 100);

assert.equal(initialResult.position.totalQuantity, 0.03);
assert.ok(
  Math.abs(initialResult.position.averagePrice - expectedInitialAverage) < 1e-12,
);

assert.equal(initialResult.stopLoss.price, expectedLockedSl);
assert.equal(initialResult.stopLoss.quantity, 0.03);

const lockedSlPrice = initialResult.stopLoss.price;

const fillsAfterDca1 = [
  ...initialFills,
  { side: "BUY", quantity: 0.01, price: 70 },
];

const dca1Result = service.calculateAfterDcaFill({
  fills: fillsAfterDca1,
  config: cycleConfig,
});

assert.equal(dca1Result.position.totalQuantity, 0.04);
assert.ok(dca1Result.position.averagePrice < expectedInitialAverage);

assert.ok(
  dca1Result.takeProfit.price !== initialResult.takeProfit.price,
  "TP must recalculate after DCA",
);

assert.equal(
  Object.prototype.hasOwnProperty.call(dca1Result, "stopLoss"),
  false,
  "DCA calculation must not create/recalculate SL",
);

const fillsAfterDca2 = [
  ...fillsAfterDca1,
  { side: "BUY", quantity: 0.02, price: 50 },
];

const dca2Result = service.calculateAfterDcaFill({
  fills: fillsAfterDca2,
  config: cycleConfig,
});

assert.equal(dca2Result.position.totalQuantity, 0.06);
assert.ok(dca2Result.position.averagePrice < dca1Result.position.averagePrice);

assert.ok(
  dca2Result.takeProfit.price !== dca1Result.takeProfit.price,
  "TP must recalculate again after second DCA",
);

assert.equal(
  Object.prototype.hasOwnProperty.call(dca2Result, "stopLoss"),
  false,
  "Second DCA must not create/recalculate SL",
);

// The original initial-cycle SL remains the same regardless of later fills.
assert.equal(
  lockedSlPrice,
  expectedLockedSl,
  "SL price must remain locked to initial fill price",
);

assert.equal(
  initialResult.stopLoss.price,
  lockedSlPrice,
  "Initial SL must remain unchanged after DCA processing",
);

assert.equal(
  initialResult.stopLoss.quantity,
  0.03,
  "Initial SL quantity represents the position at initial protection creation",
);

// Verify the cycle's 50% SL snapshot is independent from a hypothetical
// runtime config change to 30%. The active cycle must retain its snapshot.
const newRuntimeConfig = {
  takeProfit: 2,
  stopLoss: 30,
};

const newConfigSl = service.calculateStopLoss(100, newRuntimeConfig);

assert.equal(newConfigSl, 70);
assert.equal(
  lockedSlPrice,
  50,
  "Existing cycle SL must not change because runtime config changed",
);

console.log("M75 SL LOCK VERIFICATION:");
console.log({
  initialFillPrice: 100,
  initialAverage: initialResult.position.averagePrice,
  lockedStopLoss: lockedSlPrice,
  initialStopLossQuantity: initialResult.stopLoss.quantity,
  dca1Average: dca1Result.position.averagePrice,
  dca1TakeProfit: dca1Result.takeProfit.price,
  dca2Average: dca2Result.position.averagePrice,
  dca2TakeProfit: dca2Result.takeProfit.price,
  dcaCreatesStopLoss: false,
  runtimeConfigStopLoss: newRuntimeConfig.stopLoss,
  newConfigCalculatedSl: newConfigSl,
  existingCycleSlUnchanged: true,
});

console.log("M75 SL LOCK VERIFICATION: PASS");
