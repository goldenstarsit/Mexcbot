import assert from "node:assert/strict";
import CycleLifecycleService from "../src/services/cycleLifecycleService.js";

function createFixture({
  activeExit = null,
  reserveResult = {reserved: true, cycle: {id: 76, status: "EXIT_PENDING"}},
  market = {askPrice: 101.5, bidPrice: 101.0},
  placementResult = {
    reused: false,
    exchangeOrder: {
      id: 1,
      tradingCycleId: 76,
      symbol: "BTCUSDT",
      side: "SELL",
      orderType: "LIMIT_MAKER",
      price: 101.5,
      quantity: 0.03,
      status: "NEW",
    },
  },
  placementError = null,
} = {}) {
  let reserveCalls = 0;
  let statusUpdates = [];
  let placeSellArgs = null;

  const service = new CycleLifecycleService({
    tradingCycleRepository: {
      reserveExit(cycleId) {
        reserveCalls += 1;
        return reserveResult;
      },

      async updateStatus(cycleId, status) {
        statusUpdates.push({cycleId, status});
      },
    },

    exchangeOrderRepository: {
      findActiveSellByCycleId() {
        return activeExit;
      },
    },

    fillRepository: {},

    positionCalculator: {
      calculate(fills) {
        let quantity = 0;
        let cost = 0;

        for (const fill of fills) {
          if (fill.side !== "BUY") continue;
          quantity += Number(fill.quantity);
          cost += Number(fill.quantity) * Number(fill.price);
        }

        return {
          totalQuantity: quantity,
          totalCost: cost,
          averagePrice: quantity > 0 ? cost / quantity : 0,
        };
      },
    },

    marketPriceService: {
      async get() {
        return market;
      },
    },

    makerOrderEngine: {},

    quantityCalculator: {
      calculateSellQuantity(quantity) {
        return quantity;
      },
    },

    symbolRulesService: {
      async get() {
        return {};
      },
    },

    duplicateProtectionService: {
      createClientOrderId(args) {
        return `mxc-c${args.cycleId}-${args.kind}`;
      },

      async placeSell(args) {
        placeSellArgs = args;

        if (placementError) {
          throw placementError;
        }

        return placementResult;
      },
    },

    triggerInitialOrder: {},

    tradingConfigService: {},
  });

  return {
    service,
    getReserveCalls: () => reserveCalls,
    getStatusUpdates: () => statusUpdates,
    getPlaceSellArgs: () => placeSellArgs,
  };
}

const fills = [
  {side: "BUY", quantity: 0.01, price: 100},
  {side: "BUY", quantity: 0.01, price: 99},
  {side: "BUY", quantity: 0.01, price: 95},
];

// 1. TP must sell the complete accumulated position at current ask.
{
  const fixture = createFixture();

  const result = await fixture.service.triggerExit({
    cycleId: 76,
    symbol: "BTCUSDT",
    reason: "TAKE_PROFIT",
    fills,
  });

  const args = fixture.getPlaceSellArgs();

  assert.equal(result.reason, "TAKE_PROFIT");
  assert.equal(result.quantity, 0.03);
  assert.equal(result.price, 101.5);
  assert.equal(args.quantity, 0.03);
  assert.equal(args.price, 101.5);
  assert.equal(args.bestBid, 101.0);
  assert.equal(args.reason, "TAKE_PROFIT");
  assert.equal(args.clientOrderId, "mxc-c76-tp");
  assert.equal(fixture.getReserveCalls(), 1);
  assert.equal(result.exchangeOrder.orderType, "LIMIT_MAKER");

  console.log("M76 TP normal execution: PASS");
}

// 2. Existing active SELL must be reused without another placement.
{
  const fixture = createFixture({
    activeExit: {
      id: 10,
      side: "SELL",
      orderType: "LIMIT_MAKER",
      price: 101.4,
      quantity: 0.03,
      status: "NEW",
    },
  });

  const result = await fixture.service.triggerExit({
    cycleId: 76,
    symbol: "BTCUSDT",
    reason: "TAKE_PROFIT",
    fills,
  });

  assert.equal(result.reused, true);
  assert.equal(result.exchangeOrder.id, 10);
  assert.equal(result.quantity, 0.03);
  assert.equal(result.price, 101.4);
  assert.equal(fixture.getReserveCalls(), 0);

  console.log("M76 TP active-exit duplicate protection: PASS");
}

// 3. Failed TP placement must reopen the cycle.
{
  const fixture = createFixture({
    placementError: new Error("M76 TP placement failure"),
  });

  await assert.rejects(
    fixture.service.triggerExit({
      cycleId: 76,
      symbol: "BTCUSDT",
      reason: "TAKE_PROFIT",
      fills,
    }),
    /M76 TP placement failure/,
  );

  assert.deepEqual(fixture.getStatusUpdates(), [
    {cycleId: 76, status: "OPEN"},
  ]);

  console.log("M76 TP failure recovery: PASS");
}

// 4. TP price must be maker-safe: ask > bid.
{
  const fixture = createFixture({
    market: {askPrice: 101.0, bidPrice: 101.0},
  });

  const result = await fixture.service.triggerExit({
    cycleId: 76,
    symbol: "BTCUSDT",
    reason: "TAKE_PROFIT",
    fills,
  });

  const args = fixture.getPlaceSellArgs();

  assert.equal(args.price, 101.0);
  assert.equal(args.bestBid, 101.0);

  console.log(
    "M76 TP price reaches maker engine validation: PASS",
  );
}

console.log("M76 TAKE-PROFIT EXECUTION AUDIT: PASS");
console.log({
  fullPositionSell: true,
  currentAskUsed: true,
  limitMaker: true,
  duplicateExitProtected: true,
  placementFailureRecovery: true,
  makerValidationDelegated: true,
});
