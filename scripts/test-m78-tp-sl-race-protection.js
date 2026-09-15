import assert from "node:assert/strict";
import db from "../src/database/connection.js";
import "../src/database/migrations/index.js";
import TradingCycleRepository from "../src/database/repositories/tradingCycleRepository.js";
import CycleLifecycleService from "../src/services/cycleLifecycleService.js";

const tradingCycleRepository = new TradingCycleRepository();

function createCycle(symbol = "M78USDT") {
  const existing = tradingCycleRepository.listBySymbol(symbol);
  const cycleNumber =
    existing.length > 0
      ? Math.max(...existing.map((cycle) => Number(cycle.cycle_number))) + 1
      : 1;

  const cycle = tradingCycleRepository.create({
    symbol,
    cycleNumber,
    status: "OPEN",
    configSnapshot: {
      config: {
        symbols: [symbol],
        takeProfit: 1,
        stopLoss: 50,
        initialOrder: {enabled: true},
        dca: {enabled: true, formula: "triangular", levels: 9},
        order: {type: "LIMIT_MAKER", makerOnly: true},
      },
    },
  });

  return cycle.id;
}

function createService() {
  let placeCount = 0;
  let activeExit = null;
  const placeCalls = [];

  const service = new CycleLifecycleService({
    tradingCycleRepository,

    exchangeOrderRepository: {
      findActiveSellByCycleId() {
        return activeExit;
      },
    },

    positionCalculator: {
      calculate(fills) {
        const buys = fills.filter((fill) => fill.side === "BUY");
        const totalQuantity = buys.reduce(
          (sum, fill) => sum + Number(fill.quantity),
          0,
        );

        return {
          totalQuantity,
          totalCost: totalQuantity * 100,
          averagePrice: 100,
        };
      },
    },

    marketPriceService: {
      async get() {
        return {
          askPrice: 101,
          bidPrice: 99,
        };
      },
    },

    symbolRulesService: {
      async get() {
        return {};
      },
    },

    quantityCalculator: {
      calculateSellQuantity(quantity) {
        return quantity;
      },
    },

    duplicateProtectionService: {
      createClientOrderId({cycleId, kind}) {
        return `mxc-c${cycleId}-${kind}`;
      },

      async placeSell(args) {
        placeCount += 1;
        placeCalls.push(args);

        activeExit = {
          id: placeCount,
          trading_cycle_id: args.tradingCycleId,
          symbol: args.symbol,
          side: "SELL",
          orderType: "LIMIT_MAKER",
          price: args.price,
          quantity: args.quantity,
          status: "NEW",
          client_order_id: args.clientOrderId,
        };

        return {
          reused: false,
          source: "NEW",
          exchangeOrder: activeExit,
        };
      },
    },
  });

  return {
    service,
    getPlaceCount: () => placeCount,
    getPlaceCalls: () => placeCalls,
    getActiveExit: () => activeExit,
  };
}

const fills = [
  {side: "BUY", quantity: 0.01, price: 100},
  {side: "BUY", quantity: 0.01, price: 98},
  {side: "BUY", quantity: 0.01, price: 96},
];

// ============================================================
// 1. Direct atomic repository race
// ============================================================
{
  const cycleId = createCycle();

  const first = tradingCycleRepository.reserveExit(cycleId);
  const second = tradingCycleRepository.reserveExit(cycleId);

  assert.equal(first.reserved, true);
  assert.equal(second.reserved, false);
  assert.equal(second.cycle.status, "EXIT_PENDING");

  console.log("M78 atomic reserve race: PASS");
}

// ============================================================
// 2. TP wins, later SL reuses existing exit
// ============================================================
{
  const cycleId = createCycle();
  const fixture = createService();

  const tp = await fixture.service.triggerExit({
    cycleId,
    symbol: "M78USDT",
    reason: "TAKE_PROFIT",
    fills,
  });

  const sl = await fixture.service.triggerExit({
    cycleId,
    symbol: "M78USDT",
    reason: "STOP_LOSS",
    fills,
  });

  assert.equal(tp.reused, false);
  assert.equal(sl.reused, true);
  assert.equal(fixture.getPlaceCount(), 1);
  assert.equal(tp.exchangeOrder.id, sl.exchangeOrder.id);
  assert.equal(
    fixture.getPlaceCalls()[0].clientOrderId,
    `mxc-c${cycleId}-tp`,
  );

  console.log("M78 TP wins: PASS");
}

// ============================================================
// 3. SL wins, later TP reuses existing exit
// ============================================================
{
  const cycleId = createCycle();
  const fixture = createService();

  const sl = await fixture.service.triggerExit({
    cycleId,
    symbol: "M78USDT",
    reason: "STOP_LOSS",
    fills,
  });

  const tp = await fixture.service.triggerExit({
    cycleId,
    symbol: "M78USDT",
    reason: "TAKE_PROFIT",
    fills,
  });

  assert.equal(sl.reused, false);
  assert.equal(tp.reused, true);
  assert.equal(fixture.getPlaceCount(), 1);
  assert.equal(sl.exchangeOrder.id, tp.exchangeOrder.id);
  assert.equal(
    fixture.getPlaceCalls()[0].clientOrderId,
    `mxc-c${cycleId}-sl`,
  );

  console.log("M78 SL wins: PASS");
}

// ============================================================
// 4. Concurrent TP/SL calls
//
// SQLite's atomic UPDATE guarantees only one caller reserves
// the cycle. The other caller either sees the active exit and
// reuses it, or safely receives EXIT_PENDING.
// ============================================================
{
  const cycleId = createCycle();
  const fixture = createService();

  const results = await Promise.allSettled([
    fixture.service.triggerExit({
      cycleId,
      symbol: "M78USDT",
      reason: "TAKE_PROFIT",
      fills,
    }),
    fixture.service.triggerExit({
      cycleId,
      symbol: "M78USDT",
      reason: "STOP_LOSS",
      fills,
    }),
  ]);

  const fulfilled = results.filter(
    (result) => result.status === "fulfilled",
  );

  const rejected = results.filter(
    (result) => result.status === "rejected",
  );

  assert.equal(fixture.getPlaceCount(), 1);
  assert.equal(fulfilled.length + rejected.length, 2);

  const cycle = tradingCycleRepository.findById(cycleId);
  assert.equal(cycle.status, "EXIT_PENDING");

  const successfulExitCount = fulfilled.filter(
    (result) => result.value?.exchangeOrder,
  ).length;

  assert.equal(successfulExitCount, 1);

  console.log("M78 concurrent TP/SL race: PASS");
}

// ============================================================
// Cleanup
// ============================================================
db.prepare(`
  DELETE FROM trading_cycles
  WHERE symbol = 'M78USDT'
`).run();

console.log("M78 TP/SL RACE PROTECTION: PASS");
console.log({
  atomicReservation: true,
  singleExitPlacement: true,
  tpWinsProtected: true,
  slWinsProtected: true,
  concurrentRaceProtected: true,
});
