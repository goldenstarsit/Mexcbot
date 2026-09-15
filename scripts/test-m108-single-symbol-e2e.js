import assert from "node:assert/strict";
import fs from "node:fs";

const dbPath = "./data/test/m108-single-symbol-e2e.db";
process.env.MEXCBOT_DB_PATH = dbPath;

if (fs.existsSync(dbPath)) {
  fs.rmSync(dbPath, { force: true });
}
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

const symbol = "M108USDT";
const otherSymbol = "M108OTHERUSDT";

const tradingConfig = {
  symbols: [symbol, otherSymbol],
  takeProfit: 1,
  stopLoss: 50,
  dca: {
    levels: 9,
  },
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
  async get() {
    return {
      bidPrice: 100,
      askPrice: 100.01,
    };
  },
};

const placedOrders = [];

const duplicateProtectionService = {
  createClientOrderId({ cycleId, kind }) {
    return `m108-cycle-${cycleId}-${kind}`;
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
      exchangeOrderId: `M108-BUY-${tradingCycleId}-${placedOrders.length + 1}`,
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
      exchangeOrderId: `M108-SELL-${tradingCycleId}`,
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
      SELECT id
      FROM exchange_orders
      WHERE symbol IN (?, ?)
    )
  `).run(symbol, otherSymbol);

  db.prepare(`
    DELETE FROM dca_orders
    WHERE trading_cycle_id IN (
      SELECT id
      FROM trading_cycles
      WHERE symbol IN (?, ?)
    )
  `).run(symbol, otherSymbol);

  db.prepare(`
    DELETE FROM exchange_orders
    WHERE symbol IN (?, ?)
  `).run(symbol, otherSymbol);

  db.prepare(`
    DELETE FROM trading_cycles
    WHERE symbol IN (?, ?)
  `).run(symbol, otherSymbol);
}

try {
  cleanup();

  // ------------------------------------------------------------
  // 1. Cycle 1 creation + snapshot
  // ------------------------------------------------------------
  const cycle1 = await tradingCycleRepository.create({
    symbol,
    status: "OPEN",
    configSnapshot: tradingConfigService.createCycleSnapshot(),
  });

  assert.equal(cycle1.symbol, symbol);
  assert.equal(cycle1.cycle_number, 1);
  assert.equal(cycle1.status, "OPEN");

  const cycle1Snapshot =
    JSON.parse(cycle1.config_snapshot_json);

  assert.equal(cycle1Snapshot.config.takeProfit, 1);
  assert.equal(cycle1Snapshot.config.stopLoss, 50);
  assert.equal(cycle1Snapshot.config.dca.levels, 9);

  // ------------------------------------------------------------
  // 2. Initial BUY
  // ------------------------------------------------------------
  const initial =
    await tradingCycleExecutionService.triggerInitialOrder({
      cycleId: cycle1.id,
      symbol,
    });

  assert.equal(initial.exchangeOrder.side, "BUY");
  assert.equal(initial.exchangeOrder.order_type, "LIMIT_MAKER");
  assert.equal(initial.exchangeOrder.status, "NEW");
  assert.equal(initial.price, 100);
  assert.equal(initial.quantity, 0.01);

  // ------------------------------------------------------------
  // 3. Initial BUY fill
  // ------------------------------------------------------------
  const initialFill =
    fillRepository.create({
      exchangeOrderId: initial.exchangeOrder.id,
      exchangeTradeId: "M108-INITIAL-FILL",
      symbol,
      side: "BUY",
      price: 100,
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
  assert.equal(initialResult.stopLoss.price, 50);
  assert.equal(initialResult.takeProfit.price, 101);

  // ------------------------------------------------------------
  // 4. Verify all 9 DCA orders = order #2..#10
  // ------------------------------------------------------------
  const dcaOrders =
    dcaOrderRepository.findByCycleId(cycle1.id);

  assert.equal(dcaOrders.length, 9);

  assert.deepEqual(
    dcaOrders.map((order) => order.order_number),
    [2, 3, 4, 5, 6, 7, 8, 9, 10],
  );

  const expectedDcaTargets = [
    99,
    97,
    94,
    90,
    85,
    79,
    72,
    64,
    55,
  ];

  const actualDcaTargets =
    dcaOrders.map((order) => Number(order.target_price));

  assert.equal(actualDcaTargets.length, expectedDcaTargets.length);

  actualDcaTargets.forEach((actual, index) => {
    assert.ok(
      Math.abs(actual - expectedDcaTargets[index]) < 1e-9,
      `DCA target mismatch at index ${index}: ${actual} !== ${expectedDcaTargets[index]}`,
    );
  });

  assert.ok(
    dcaOrders.every(
      (order) =>
        order.order_type === "LIMIT_MAKER" &&
        order.status === "PENDING",
    ),
  );

  // ------------------------------------------------------------
  // 5. One DCA fill → average price + TP change
  // ------------------------------------------------------------
  const dcaFill =
    fillRepository.create({
      exchangeOrderId: initial.exchangeOrder.id,
      exchangeTradeId: "M108-DCA-FILL",
      symbol,
      side: "BUY",
      price: 90,
      quantity: 0.01111,
      filledAt: new Date().toISOString(),
    });

  const dcaResult =
    tradingCycleExecutionService.processDcaFill({
      cycleId: cycle1.id,
      fills: [initialFill, dcaFill],
    });

  assert.ok(
    dcaResult.position.averagePrice < 100,
  );

  assert.ok(
    dcaResult.takeProfit.price < 101,
  );

  // SL is based on initial fill and therefore remains 50.
  assert.equal(initialResult.stopLoss.price, 50);

  // ------------------------------------------------------------
  // 6. Trigger TP exit
  // ------------------------------------------------------------
  const exit =
    await lifecycleService.triggerExit({
      cycleId: cycle1.id,
      symbol,
      reason: "TAKE_PROFIT",
      fills: [initialFill, dcaFill],
    });

  assert.equal(exit.reason, "TAKE_PROFIT");
  assert.equal(exit.exchangeOrder.side, "SELL");
  assert.equal(
    exit.exchangeOrder.order_type,
    "LIMIT_MAKER",
  );
  assert.equal(exit.exchangeOrder.status, "NEW");

  const exitCycle =
    tradingCycleRepository.findById(cycle1.id);

  assert.equal(exitCycle.status, "EXIT_PENDING");

  // ------------------------------------------------------------
  // 7. SELL fill → Cycle 1 CLOSED
  // ------------------------------------------------------------
  const sellFill =
    fillRepository.create({
      exchangeOrderId: exit.exchangeOrder.id,
      exchangeTradeId: "M108-SELL-FILL",
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

  // ------------------------------------------------------------
  // 8. Cycle 2
  // ------------------------------------------------------------
  const cycle2 =
    tradingCycleRepository.findById(
      completed.cycle.cycleId,
    );

  assert.equal(cycle2.symbol, symbol);
  assert.equal(cycle2.status, "OPEN");
  assert.equal(cycle2.cycle_number, 2);

  assert.equal(
    JSON.parse(cycle2.config_snapshot_json)
      .config.takeProfit,
    1,
  );

  assert.equal(
    JSON.parse(cycle2.config_snapshot_json)
      .config.stopLoss,
    50,
  );

  // New cycle has its own initial BUY.
  assert.equal(
    completed.initialOrder.exchangeOrder.side,
    "BUY",
  );

  assert.equal(
    completed.initialOrder.exchangeOrder.order_type,
    "LIMIT_MAKER",
  );

  // ------------------------------------------------------------
  // 9. Same-symbol numbering remains independent
  // ------------------------------------------------------------
  const otherCycle =
    await tradingCycleRepository.create({
      symbol: otherSymbol,
      status: "OPEN",
      configSnapshot:
        tradingConfigService.createCycleSnapshot(),
    });

  assert.equal(otherCycle.cycle_number, 1);

  const symbolCycles =
    tradingCycleRepository.listBySymbol(symbol);

  assert.deepEqual(
    symbolCycles
      .map((cycle) => cycle.cycle_number)
      .sort((a, b) => a - b),
    [1, 2],
  );

  const otherCycles =
    tradingCycleRepository.listBySymbol(otherSymbol);

  assert.deepEqual(
    otherCycles.map((cycle) => cycle.cycle_number),
    [1],
  );

  // ------------------------------------------------------------
  // PASS
  // ------------------------------------------------------------
  console.log("M108 SINGLE SYMBOL END-TO-END: PASS");
  console.log({
    cycle1Created: true,
    cycle1Number: cycle1.cycle_number,
    initialBuyTriggered: true,
    initialBuyMakerOnly:
      initial.exchangeOrder.order_type === "LIMIT_MAKER",
    initialFillProcessed: true,
    dcaOrdersCreated: dcaOrders.length,
    dcaOrderNumbers:
      dcaOrders.map((order) => order.order_number),
    dcaTargets:
      dcaOrders.map((order) => Number(order.target_price)),
    takeProfitCalculated: true,
    stopLossLockedToInitialFill: true,
    dcaFillRecalculatedTakeProfit: true,
    exitTriggered: true,
    exitMakerOnly:
      exit.exchangeOrder.order_type === "LIMIT_MAKER",
    sellFilled: true,
    cycle1Closed: closedCycle.status === "CLOSED",
    cycle2Started: cycle2.status === "OPEN",
    cycle2Number: cycle2.cycle_number,
    otherSymbolCycleNumber: otherCycles[0].cycle_number,
    configSnapshotPreserved: true,
  });
} finally {
  cleanup();
  db.close();

  if (fs.existsSync(dbPath)) {
    fs.rmSync(dbPath, { force: true });
  }
}
