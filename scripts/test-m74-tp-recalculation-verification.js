import assert from "node:assert/strict";
import PositionProtectionService from "../src/services/positionProtectionService.js";
import PositionCalculator from "../src/services/positionCalculator.js";

const config = {
  takeProfit: 1,
  stopLoss: 50,
};

const dcaCalculator = {
  calculateLevels(initialPrice) {
    return [
      {
        orderNumber: 2,
        dcaLevel: 1,
        dropPercent: 1,
        targetPrice: initialPrice * 0.99,
      },
    ];
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
  tradingConfig: config,
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
  config,
});

const expectedInitialAverage = 3.04 / 0.03;
const expectedInitialTp = expectedInitialAverage * 1.01;
const expectedLockedSl = 100 * 0.5;

assert.equal(initialResult.position.totalQuantity, 0.03);
assert.ok(
  Math.abs(initialResult.position.averagePrice - expectedInitialAverage) < 1e-12,
);

assert.ok(
  Math.abs(initialResult.takeProfit.price - expectedInitialTp) < 1e-12,
);
assert.equal(initialResult.takeProfit.quantity, 0.03);

assert.equal(initialResult.stopLoss.price, expectedLockedSl);
assert.equal(initialResult.stopLoss.quantity, 0.03);

const fillsAfterDca1 = [
  ...initialFills,
  { side: "BUY", quantity: 0.01, price: 95 },
];

const dca1Result = service.calculateAfterDcaFill({
  fills: fillsAfterDca1,
  config,
});

const expectedDca1Cost = 3.04 + 0.95;
const expectedDca1Quantity = 0.04;
const expectedDca1Average = expectedDca1Cost / expectedDca1Quantity;
const expectedDca1Tp = expectedDca1Average * 1.01;

assert.equal(dca1Result.position.totalQuantity, expectedDca1Quantity);
assert.ok(
  Math.abs(dca1Result.position.averagePrice - expectedDca1Average) < 1e-12,
);
assert.ok(
  Math.abs(dca1Result.takeProfit.price - expectedDca1Tp) < 1e-12,
);
assert.equal(dca1Result.takeProfit.quantity, expectedDca1Quantity);

const fillsAfterDca2 = [
  ...fillsAfterDca1,
  { side: "BUY", quantity: 0.02, price: 90 },
];

const dca2Result = service.calculateAfterDcaFill({
  fills: fillsAfterDca2,
  config,
});

const expectedDca2Cost = expectedDca1Cost + 1.8;
const expectedDca2Quantity = 0.06;
const expectedDca2Average = expectedDca2Cost / expectedDca2Quantity;
const expectedDca2Tp = expectedDca2Average * 1.01;

assert.equal(dca2Result.position.totalQuantity, expectedDca2Quantity);
assert.ok(
  Math.abs(dca2Result.position.averagePrice - expectedDca2Average) < 1e-12,
);
assert.ok(
  Math.abs(dca2Result.takeProfit.price - expectedDca2Tp) < 1e-12,
);
assert.equal(dca2Result.takeProfit.quantity, expectedDca2Quantity);

assert.equal(
  initialResult.stopLoss.price,
  expectedLockedSl,
  "SL must remain locked to the initial fill price",
);

assert.notEqual(
  dca1Result.takeProfit.price,
  initialResult.takeProfit.price,
  "TP must change after DCA",
);

assert.notEqual(
  dca2Result.takeProfit.price,
  dca1Result.takeProfit.price,
  "TP must recalculate after every additional DCA",
);

console.log("M74 TP RECALCULATION VERIFICATION:");
console.log({
  initialAverage: initialResult.position.averagePrice,
  initialTP: initialResult.takeProfit.price,
  initialTPQuantity: initialResult.takeProfit.quantity,
  lockedSL: initialResult.stopLoss.price,
  dca1Average: dca1Result.position.averagePrice,
  dca1TP: dca1Result.takeProfit.price,
  dca1TPQuantity: dca1Result.takeProfit.quantity,
  dca2Average: dca2Result.position.averagePrice,
  dca2TP: dca2Result.takeProfit.price,
  dca2TPQuantity: dca2Result.takeProfit.quantity,
  slLockedAfterDca: true,
});

console.log("M74 TP RECALCULATION VERIFICATION: PASS");
