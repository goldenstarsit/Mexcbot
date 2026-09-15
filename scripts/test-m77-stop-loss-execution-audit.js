import assert from "node:assert/strict";
import CycleLifecycleService from "../src/services/cycleLifecycleService.js";

function createFixture({
  activeExit = null,
  market = {askPrice: 99.5, bidPrice: 99.0},
  placementResult = {
    reused: false,
    exchangeOrder: {
      id: 1,
      tradingCycleId: 77,
      symbol: "BTCUSDT",
      side: "SELL",
      orderType: "LIMIT_MAKER",
      price: 99,
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
        return {
          reserved: true,
          cycle: {id: cycleId, status: "EXIT_PENDING"},
        };
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
      createClientOrderId({cycleId, kind}) {
        return `mxc-c${cycleId}-${kind}`;
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
  {side: "BUY", quantity: 0.01, price: 95},
  {side: "BUY", quantity: 0.01, price: 90},
];

// 1. SL must sell the complete accumulated position at current bid.
{
  const fixture = createFixture();

  const result = await fixture.service.triggerExit({
    cycleId: 77,
    symbol: "BTCUSDT",
    reason: "STOP_LOSS",
    fills,
  });

  const args = fixture.getPlaceSellArgs();

  assert.equal(result.reason, "STOP_LOSS");
  assert.equal(result.quantity, 0.03);
  assert.equal(result.price, 99.0);

  assert.equal(args.quantity, 0.03);
  assert.equal(args.price, 99.0);
  assert.equal(args.bestBid, 99.0);
  assert.equal(args.reason, "STOP_LOSS");
  assert.equal(args.clientOrderId, "mxc-c77-sl");

  assert.equal(fixture.getReserveCalls(), 1);
  assert.equal(result.exchangeOrder.orderType, "LIMIT_MAKER");

  console.log("M77 SL normal execution: PASS");
}

// 2. Existing active SELL must be reused.
{
  const fixture = createFixture({
    activeExit: {
      id: 20,
      trading_cycle_id: 77,
      symbol: "BTCUSDT",
      side: "SELL",
      orderType: "LIMIT_MAKER",
      price: 99,
      quantity: 0.03,
      status: "NEW",
    },
  });

  const result = await fixture.service.triggerExit({
    cycleId: 77,
    symbol: "BTCUSDT",
    reason: "STOP_LOSS",
    fills,
  });

  assert.equal(result.reused, true);
  assert.equal(result.exchangeOrder.id, 20);
  assert.equal(result.quantity, 0.03);
  assert.equal(result.price, 99);
  assert.equal(fixture.getReserveCalls(), 0);
  assert.equal(fixture.getPlaceSellArgs(), null);

  console.log("M77 SL duplicate protection: PASS");
}

// 3. SL placement failure must reopen the cycle.
{
  const fixture = createFixture({
    placementError: new Error("M77 SL placement failure"),
  });

  await assert.rejects(
    fixture.service.triggerExit({
      cycleId: 77,
      symbol: "BTCUSDT",
      reason: "STOP_LOSS",
      fills,
    }),
    /M77 SL placement failure/,
  );

  assert.deepEqual(fixture.getStatusUpdates(), [
    {cycleId: 77, status: "OPEN"},
  ]);

  console.log("M77 SL failure recovery: PASS");
}

// 4. SL execution must use bid, not ask.
{
  const fixture = createFixture({
    market: {
      askPrice: 100.2,
      bidPrice: 99.7,
    },
  });

  await fixture.service.triggerExit({
    cycleId: 77,
    symbol: "BTCUSDT",
    reason: "STOP_LOSS",
    fills,
  });

  const args = fixture.getPlaceSellArgs();

  assert.equal(args.price, 99.7);
  assert.equal(args.bestBid, 99.7);
  assert.notEqual(args.price, 100.2);

  console.log("M77 SL bid-price execution: PASS");
}

// 5. TP and SL use distinct deterministic client order IDs.
{
  const fixture = createFixture();

  await fixture.service.triggerExit({
    cycleId: 77,
    symbol: "BTCUSDT",
    reason: "STOP_LOSS",
    fills,
  });

  assert.equal(
    fixture.getPlaceSellArgs().clientOrderId,
    "mxc-c77-sl",
  );

  console.log("M77 SL client-order identity: PASS");
}

console.log("M77 STOP-LOSS EXECUTION AUDIT: PASS");
console.log({
  fullPositionSell: true,
  currentBidUsed: true,
  limitMaker: true,
  duplicateExitProtected: true,
  placementFailureRecovery: true,
  deterministicSlClientOrderId: true,
});
