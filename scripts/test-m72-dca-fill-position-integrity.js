import assert from "node:assert/strict";
import PositionProtectionService from "../src/services/positionProtectionService.js";
import TradingCycleExecutionService from "../src/services/tradingCycleExecutionService.js";

const config = {
  takeProfit: 1,
  stopLoss: 50,
  dca: { enabled: true, formula: "triangular", levels: 9 },
};

const positionCalculator = {
  calculate(fills) {
    let totalQuantity = 0;
    let totalCost = 0;

    for (const fill of fills) {
      if (fill.side !== "BUY") continue;

      totalQuantity += Number(fill.quantity);
      totalCost += Number(fill.quantity) * Number(fill.price);
    }

    return {
      totalQuantity,
      totalCost,
      averagePrice:
        totalQuantity > 0 ? totalCost / totalQuantity : 0,
    };
  },
};

const positionProtectionService = new PositionProtectionService({
  positionCalculator,
  dcaCalculator: {
    calculateLevels(price) {
      return [
        {
          orderNumber: 1,
          dcaLevel: 1,
          dropPercent: 1,
          targetPrice: price * 0.99,
        },
      ];
    },
  },
  quantityCalculator: {
    calculateBuyQuantity() {
      return 0.01;
    },
  },
  symbolRulesService: {
    async get() {
      return {};
    },
  },
  tradingConfig: config,
});

const cycle = {
  id: 1,
  config_snapshot_json: JSON.stringify({ config }),
};

let summaryUpdates = 0;

const executionService = new TradingCycleExecutionService({
  tradingCycleRepository: {
    findById() {
      return cycle;
    },
    updatePerformanceSummary() {
      summaryUpdates += 1;
      return cycle;
    },
  },
  dcaOrderRepository: {
    async create(data) {
      return { id: 1, ...data };
    },
  },
  exchangeOrderRepository: {},
  fillRepository: {},
  marketPriceService: {},
  symbolRulesService: {},
  quantityCalculator: {},
  makerOrderEngine: {},
  duplicateProtectionService: {},
  positionProtectionService,
});

const initialFill = {
  side: "BUY",
  quantity: 0.01,
  price: 100,
};

const dcaFills = [
  initialFill,
  {
    side: "BUY",
    quantity: 0.01,
    price: 99,
  },
  {
    side: "BUY",
    quantity: 0.01,
    price: 96,
  },
  {
    side: "BUY",
    quantity: 0.02,
    price: 94,
  },
];

const result = executionService.processDcaFill({
  cycleId: 1,
  fills: dcaFills,
});

const expectedQuantity = 0.05;
const expectedCost = 100 * 0.01 + 99 * 0.01 + 96 * 0.01 + 94 * 0.02;
const expectedAverage = expectedCost / expectedQuantity;
const expectedTakeProfit = expectedAverage * 1.01;

assert.equal(result.position.totalQuantity, expectedQuantity);
assert.equal(result.position.totalCost, expectedCost);
assert.ok(
  Math.abs(result.position.averagePrice - expectedAverage) < 1e-12,
);
assert.equal(result.takeProfit.quantity, expectedQuantity);
assert.ok(
  Math.abs(result.takeProfit.price - expectedTakeProfit) < 1e-12,
);
assert.equal(summaryUpdates, 1);

console.log("M72 DCA FILL → POSITION INTEGRITY:");
console.log({
  fillCount: dcaFills.length,
  totalQuantity: result.position.totalQuantity,
  totalCost: result.position.totalCost,
  averagePrice: result.position.averagePrice,
  takeProfitPrice: result.takeProfit.price,
  takeProfitQuantity: result.takeProfit.quantity,
  stopLossRecalculated: false,
  summaryUpdates,
});

console.log("M72 DCA FILL → POSITION INTEGRITY: PASS");
console.log("M72 TEST: PASS");
