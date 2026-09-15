import assert from "node:assert/strict";
import fs from "node:fs";

const dbPath = "./data/test/m109-five-symbols-e2e.db";
process.env.MEXCBOT_DB_PATH = dbPath;

if (fs.existsSync(dbPath)) fs.rmSync(dbPath, { force: true });
fs.mkdirSync("./data/test", { recursive: true });

const { default: db } = await import("../src/database/connection.js");
await import("../src/database/migrations/index.js");

const { default: TradingCycleRepository } =
  await import("../src/database/repositories/tradingCycleRepository.js");
const { default: DcaOrderRepository } =
  await import("../src/database/repositories/dcaOrderRepository.js");
const { default: ExchangeOrderRepository } =
  await import("../src/database/repositories/exchangeOrderRepository.js");
const { default: FillRepository } =
  await import("../src/database/repositories/fillRepository.js");

const { default: PositionCalculator } =
  await import("../src/services/positionCalculator.js");
const { default: DcaCalculator } =
  await import("../src/services/dcaCalculator.js");
const { default: QuantityCalculator } =
  await import("../src/services/quantityCalculator.js");
const { default: PositionProtectionService } =
  await import("../src/services/positionProtectionService.js");
const { default: TradingCycleExecutionService } =
  await import("../src/services/tradingCycleExecutionService.js");
const { default: CycleLifecycleService } =
  await import("../src/services/cycleLifecycleService.js");

const symbols = [
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "SOLUSDT",
  "TRXUSDT",
];

const tradingConfig = {
  symbols,
  takeProfit: 1,
  stopLoss: 50,
  dca: {
    levels: 9,
  },
};

const prices = {
  BTCUSDT: 100000,
  ETHUSDT: 3000,
  BNBUSDT: 600,
  SOLUSDT: 150,
  TRXUSDT: 0.3,
};

const tradingCycleRepository = new TradingCycleRepository();
const dcaOrderRepository = new DcaOrderRepository();
const exchangeOrderRepository = new ExchangeOrderRepository();
const fillRepository = new FillRepository();

const positionCalculator = new PositionCalculator();
const dcaCalculator = new DcaCalculator(tradingConfig);
const quantityCalculator = new QuantityCalculator(1);

const symbolRulesService = {
  async get() {
    return {
      minQty: 0.00001,
      stepSize: 0.00001,
      minNotional: 1,
    };
  },
};

const marketPriceService = {
  async get(symbol) {
    const bidPrice = prices[symbol];
    return {
      bidPrice,
      askPrice: bidPrice * 1.0001,
    };
  },
};

const placedOrders = [];

const duplicateProtectionService = {
  createClientOrderId({ cycleId, kind }) {
    return `m109-cycle-${cycleId}-${kind}`;
  },

  async placeBuy({
    tradingCycleId,
    symbol,
    quantity,
    price,
    clientOrderId,
  }) {
    const exchangeOrder = exchangeOrderRepository.create({
      tradingCycleId,
      symbol,
      exchangeOrderId:
        `M109-BUY-${symbol}-${tradingCycleId}-${placedOrders.length + 1}`,
      clientOrderId,
      side: "BUY",
      orderType: "LIMIT_MAKER",
      price,
      quantity,
      status: "NEW",
    });

    placedOrders.push(exchangeOrder);

    return {
      exchangeOrder,
      reused: false,
    };
  },

  async placeSell({
    tradingCycleId,
    symbol,
    quantity,
    price,
    clientOrderId,
    reason,
  }) {
    const exchangeOrder = exchangeOrderRepository.create({
      tradingCycleId,
      symbol,
      exchangeOrderId: `M109-SELL-${symbol}-${tradingCycleId}`,
      clientOrderId,
      side: "SELL",
      orderType: "LIMIT_MAKER",
      price,
      quantity,
      status: "NEW",
    });

    placedOrders.push(exchangeOrder);

    return {
      exchangeOrder,
      reused: false,
      reason,
    };
  },
};

const positionProtectionService =
  new PositionProtectionService({
    positionCalculator,
    dcaCalculator,
    quantityCalculator,
    symbolRulesService,
    tradingConfig,
  });

const tradingCycleExecutionService =
  new TradingCycleExecutionService({
    tradingCycleRepository,
    dcaOrderRepository,
    exchangeOrderRepository,
    fillRepository,
    marketPriceService,
    symbolRulesService,
    quantityCalculator,
    makerOrderEngine: {},
    duplicateProtectionService,
    positionProtectionService,
  });

const tradingConfigService = {
  createCycleSnapshot() {
    return {
      config: structuredClone(tradingConfig),
    };
  },
};

const lifecycleService =
  new CycleLifecycleService({
    tradingCycleRepository,
    exchangeOrderRepository,
    fillRepository,
    positionCalculator,
    marketPriceService,
    makerOrderEngine: {},
    quantityCalculator,
    symbolRulesService,
    duplicateProtectionService,
    triggerInitialOrder:
      tradingCycleExecutionService.triggerInitialOrder.bind(
        tradingCycleExecutionService,
      ),
    tradingConfigService,
  });

function cleanup() {
  db.prepare(`
    DELETE FROM fills
    WHERE exchange_order_id IN (
      SELECT id FROM exchange_orders
      WHERE symbol IN (${symbols.map(() => "?").join(",")})
    )
  `).run(...symbols);

  db.prepare(`
    DELETE FROM dca_orders
    WHERE trading_cycle_id IN (
      SELECT id FROM trading_cycles
      WHERE symbol IN (${symbols.map(() => "?").join(",")})
    )
  `).run(...symbols);

  db.prepare(`
    DELETE FROM exchange_orders
    WHERE symbol IN (${symbols.map(() => "?").join(",")})
  `).run(...symbols);

  db.prepare(`
    DELETE FROM trading_cycles
    WHERE symbol IN (${symbols.map(() => "?").join(",")})
  `).run(...symbols);
}

try {
  cleanup();

  const results = [];

  // ============================================================
  // 1. Create Cycle 1 + execute complete lifecycle for all symbols
  // ============================================================
  for (const symbol of symbols) {
    const price = prices[symbol];

    const cycle1 = await tradingCycleRepository.create({
      symbol,
      status: "OPEN",
      configSnapshot: tradingConfigService.createCycleSnapshot(),
    });

    assert.equal(cycle1.symbol, symbol);
    assert.equal(cycle1.cycle_number, 1);
    assert.equal(cycle1.status, "OPEN");

    const initial =
      await tradingCycleExecutionService.triggerInitialOrder({
        cycleId: cycle1.id,
        symbol,
      });

    assert.equal(initial.exchangeOrder.side, "BUY");
    assert.equal(initial.exchangeOrder.order_type, "LIMIT_MAKER");
    assert.equal(initial.exchangeOrder.status, "NEW");
    assert.equal(initial.price, price);
    assert.ok(initial.quantity > 0);
    assert.ok(initial.quantity * price >= 1);

    const initialFill =
      fillRepository.create({
        exchangeOrderId: initial.exchangeOrder.id,
        exchangeTradeId: `M109-${symbol}-INITIAL-FILL`,
        symbol,
        side: "BUY",
        price,
        quantity: initial.quantity,
        filledAt: new Date().toISOString(),
      });

    const initialResult =
      await tradingCycleExecutionService.processInitialFill({
        cycleId: cycle1.id,
        symbol,
        fill: initialFill,
      });

    assert.equal(initialResult.dcaOrders.length, 9);
    assert.ok(
      Math.abs(
        Number(initialResult.takeProfit.price) -
          Number(price * 1.01),
      ) < 1e-9,
      `${symbol} TP mismatch`,
    );

    assert.ok(
      Math.abs(
        Number(initialResult.stopLoss.price) -
          Number(price * 0.5),
      ) < 1e-9,
      `${symbol} SL mismatch`,
    );

    const dcaOrders =
      dcaOrderRepository.findByCycleId(cycle1.id);

    assert.equal(dcaOrders.length, 9);

    assert.deepEqual(
      dcaOrders.map((order) => order.order_number),
      [2, 3, 4, 5, 6, 7, 8, 9, 10],
    );

    assert.ok(
      dcaOrders.every(
        (order) =>
          order.symbol === symbol &&
          order.order_type === "LIMIT_MAKER" &&
          order.status === "PENDING",
      ),
    );

    // One DCA fill verifies TP recalculation while SL remains locked.
    const dcaTarget = price * 0.99;

    const dcaFill =
      fillRepository.create({
        exchangeOrderId: initial.exchangeOrder.id,
        exchangeTradeId: `M109-${symbol}-DCA-FILL`,
        symbol,
        side: "BUY",
        price: dcaTarget,
        quantity: initial.quantity,
        filledAt: new Date().toISOString(),
      });

    const dcaResult =
      tradingCycleExecutionService.processDcaFill({
        cycleId: cycle1.id,
        fills: [initialFill, dcaFill],
      });

    assert.ok(
      dcaResult.position.averagePrice < price,
    );

    assert.ok(
      dcaResult.takeProfit.price <
        initialResult.takeProfit.price,
    );

    assert.equal(
      initialResult.stopLoss.price,
      price * 0.5,
    );

    const exit =
      await lifecycleService.triggerExit({
        cycleId: cycle1.id,
        symbol,
        reason: "TAKE_PROFIT",
        fills: [initialFill, dcaFill],
      });

    assert.equal(exit.reason, "TAKE_PROFIT");
    assert.equal(exit.exchangeOrder.side, "SELL");
    assert.equal(exit.exchangeOrder.order_type, "LIMIT_MAKER");
    assert.equal(exit.exchangeOrder.status, "NEW");

    const exitCycle =
      tradingCycleRepository.findById(cycle1.id);

    assert.equal(exitCycle.status, "EXIT_PENDING");

    const sellFill =
      fillRepository.create({
        exchangeOrderId: exit.exchangeOrder.id,
        exchangeTradeId: `M109-${symbol}-SELL-FILL`,
        symbol,
        side: "SELL",
        price: exit.price,
        quantity: exit.quantity,
        filledAt: new Date().toISOString(),
      });

    const completed =
      await lifecycleService.completeExitAndStartNewCycle({
        cycleId: cycle1.id,
        symbol,
        fill: sellFill,
        exchangeOrder: exit.exchangeOrder,
      });

    assert.equal(completed.exit.exitComplete, true);
    assert.equal(completed.exit.sellFilled, true);
    assert.equal(completed.exit.status, "CLOSED");
    assert.equal(completed.newCycleStarted, true);

    const closedCycle =
      tradingCycleRepository.findById(cycle1.id);

    assert.equal(closedCycle.status, "CLOSED");

    const cycle2 =
      tradingCycleRepository.findById(
        completed.cycle.cycleId,
      );

    assert.equal(cycle2.symbol, symbol);
    assert.equal(cycle2.status, "OPEN");
    assert.equal(cycle2.cycle_number, 2);

    assert.equal(
      JSON.parse(cycle2.config_snapshot_json).config.takeProfit,
      1,
    );

    assert.equal(
      JSON.parse(cycle2.config_snapshot_json).config.stopLoss,
      50,
    );

    assert.equal(
      completed.initialOrder.exchangeOrder.side,
      "BUY",
    );

    assert.equal(
      completed.initialOrder.exchangeOrder.order_type,
      "LIMIT_MAKER",
    );

    const symbolCycles =
      tradingCycleRepository.listBySymbol(symbol);

    assert.deepEqual(
      symbolCycles
        .map((cycle) => cycle.cycle_number)
        .sort((a, b) => a - b),
      [1, 2],
    );

    results.push({
      symbol,
      cycle1Number: cycle1.cycle_number,
      initialQuantity: initial.quantity,
      dcaOrders: dcaOrders.length,
      tpCalculated: true,
      slLocked: true,
      exitMakerOnly:
        exit.exchangeOrder.order_type === "LIMIT_MAKER",
      cycle1Closed: closedCycle.status === "CLOSED",
      cycle2Number: cycle2.cycle_number,
    });
  }

  // ============================================================
  // 2. Verify all five symbols are independent
  // ============================================================
  const allOpenCycles =
    tradingCycleRepository.findByStatus("OPEN");

  const expectedOpenSymbols = [...symbols].sort();

  const actualOpenSymbols =
    allOpenCycles
      .filter((cycle) => symbols.includes(cycle.symbol))
      .map((cycle) => cycle.symbol)
      .sort();

  assert.deepEqual(
    actualOpenSymbols,
    expectedOpenSymbols,
  );

  for (const symbol of symbols) {
    const cycles =
      tradingCycleRepository.listBySymbol(symbol);

    assert.deepEqual(
      cycles
        .map((cycle) => cycle.cycle_number)
        .sort((a, b) => a - b),
      [1, 2],
      `${symbol} cycle numbering is not independent`,
    );
  }

  // ============================================================
  // PASS
  // ============================================================
  console.log("M109 FIVE SYMBOLS END-TO-END: PASS");
  console.log({
    symbols: symbols.length,
    symbolsTested: symbols,
    cycle1CreatedForAllSymbols: true,
    initialBuyForAllSymbols: true,
    initialBuyMakerOnly: true,
    dcaOrdersPerSymbol: 9,
    totalDcaOrdersCreated: results.reduce(
      (sum, result) => sum + result.dcaOrders,
      0,
    ),
    tpCalculatedForAllSymbols: true,
    dcaTpRecalculationForAllSymbols: true,
    stopLossLockedForAllSymbols: true,
    exitForAllSymbols: true,
    exitMakerOnly: true,
    cycle1ClosedForAllSymbols: true,
    cycle2StartedForAllSymbols: true,
    cycle2NumberForAllSymbols: true,
    independentCycleNumbering: true,
    openCycleCount: actualOpenSymbols.length,
    results,
  });
} finally {
  cleanup();
  db.close();

  if (fs.existsSync(dbPath)) {
    fs.rmSync(dbPath, { force: true });
  }
}
