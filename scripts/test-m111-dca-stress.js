import fs from "node:fs";
import assert from "node:assert/strict";

const dbPath = "./data/test/m111-dca-stress.db";
fs.mkdirSync("./data/test", { recursive: true });
for (const suffix of ["", "-wal", "-shm"]) {
  try { fs.unlinkSync(`${dbPath}${suffix}`); } catch {}
}

process.env.MEXCBOT_DB_PATH = dbPath;

const [
  dbModule,
  tradingCycleRepositoryModule,
  dcaOrderRepositoryModule,
  exchangeOrderRepositoryModule,
  fillRepositoryModule,
  tradingCycleExecutionServiceModule,
] = await Promise.all([
  import("../src/database/connection.js"),
  import("../src/database/repositories/tradingCycleRepository.js"),
  import("../src/database/repositories/dcaOrderRepository.js"),
  import("../src/database/repositories/exchangeOrderRepository.js"),
  import("../src/database/repositories/fillRepository.js"),
  import("../src/services/tradingCycleExecutionService.js"),
]);

await import("../src/database/migrations/index.js");

const db = dbModule.default;
const TradingCycleRepository = tradingCycleRepositoryModule.default;
const DcaOrderRepository = dcaOrderRepositoryModule.default;
const ExchangeOrderRepository = exchangeOrderRepositoryModule.default;
const FillRepository = fillRepositoryModule.default;
const TradingCycleExecutionService = tradingCycleExecutionServiceModule.default;

const tradingCycleRepository = new TradingCycleRepository(db);
const dcaOrderRepository = new DcaOrderRepository(db);
const exchangeOrderRepository = new ExchangeOrderRepository(db);
const fillRepository = new FillRepository(db);

const symbols = [
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "SOLUSDT",
  "TRXUSDT",
];

const initialPrices = {
  BTCUSDT: 100000,
  ETHUSDT: 3000,
  BNBUSDT: 600,
  SOLUSDT: 150,
  TRXUSDT: 0.3,
};

const rules = {
  minQty: 0.00001,
  stepSize: 0.00001,
  minNotional: 1,
};

const config = {
  takeProfit: 1,
  stopLoss: 50,
  dca: { levels: 9 },
};

const marketPriceService = {
  async get(symbol) {
    const bidPrice = initialPrices[symbol];
    return {
      symbol,
      price: bidPrice,
      bidPrice,
      askPrice: bidPrice * 1.001,
    };
  },
};

const symbolRulesService = {
  async get() {
    return rules;
  },
};

const quantityCalculator = {
  calculateBuyQuantity(price, exchangeRules) {
    const requiredNotional = Math.max(1, exchangeRules.minNotional);
    const raw = requiredNotional / price;
    const steps = Math.ceil(raw / exchangeRules.stepSize - 1e-12);
    return Number(
      Math.max(exchangeRules.minQty, steps * exchangeRules.stepSize)
        .toFixed(8),
    );
  },
};

const duplicateProtectionService = {
  createClientOrderId({ cycleId, kind }) {
    return `m111-${cycleId}-${kind}`;
  },

  async placeBuy({
    tradingCycleId,
    symbol,
    quantity,
    price,
    bestAsk,
    clientOrderId,
  }) {
    assert.ok(price < bestAsk);

    return {
      exchangeOrder: {
        id: `M111-INITIAL-${tradingCycleId}`,
        orderId: `M111-INITIAL-${tradingCycleId}`,
        symbol,
        side: "BUY",
        type: "LIMIT_MAKER",
        price,
        origQty: quantity,
        clientOrderId,
        status: "NEW",
      },
    };
  },
};

const positionProtectionService = {
  calculateAfterInitialFill({
    initialFill,
    config: cycleConfig,
  }) {
    const initialPrice = Number(initialFill.price);
    const initialQuantity = Number(initialFill.quantity);
    const dcaOrders = [];

    for (let level = 1; level <= cycleConfig.dca.levels; level += 1) {
      const dropPercent = (level * (level + 1)) / 2;
      const targetPrice =
        initialPrice * (1 - dropPercent / 100);

      dcaOrders.push({
        orderNumber: level + 1,
        dcaLevel: level,
        dropPercent,
        targetPrice,
        quantity: quantityCalculator.calculateBuyQuantity(
          targetPrice,
          rules,
        ),
      });
    }

    return {
      position: {
        totalQuantity: initialQuantity,
        totalCost: initialPrice * initialQuantity,
        averagePrice: initialPrice,
      },
      dcaOrders,
      takeProfit: initialPrice * 1.01,
      stopLoss: initialPrice * 0.5,
    };
  },

  calculateAfterDcaFill({
    fills,
    config: cycleConfig,
  }) {
    const buyFills = fills.filter(
      (fill) => String(fill.side).toUpperCase() === "BUY",
    );

    const totalQuantity = buyFills.reduce(
      (sum, fill) => sum + Number(fill.quantity),
      0,
    );

    const totalCost = buyFills.reduce(
      (sum, fill) =>
        sum + Number(fill.quantity) * Number(fill.price),
      0,
    );

    const averagePrice = totalCost / totalQuantity;

    return {
      position: {
        totalQuantity,
        totalCost,
        averagePrice,
      },
      takeProfit: averagePrice * (1 + cycleConfig.takeProfit / 100),
      stopLoss: Number(buyFills[0].price) *
        (1 - cycleConfig.stopLoss / 100),
    };
  },
};

const service = new TradingCycleExecutionService({
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

let totalDcaOrders = 0;
let totalDcaFills = 0;
const symbolResults = [];

for (const symbol of symbols) {
  const initialPrice = initialPrices[symbol];
  const initialQuantity = quantityCalculator.calculateBuyQuantity(
    initialPrice,
    rules,
  );

  const cycle = tradingCycleRepository.create({
    symbol,
    cycleNumber: 1,
    status: "OPEN",
    configSnapshot: { config },
  });

  const initialResult = await service.triggerInitialOrder({
    cycleId: cycle.id,
    symbol,
  });

  assert.equal(initialResult.exchangeOrder.type, "LIMIT_MAKER");
  assert.ok(initialResult.quantity * initialPrice >= 1 - 1e-9);

  const initialFill = {
    id: `M111-INITIAL-FILL-${cycle.id}`,
    exchangeOrderId: initialResult.exchangeOrder.id,
    symbol,
    side: "BUY",
    price: initialPrice,
    quantity: initialQuantity,
  };

  const initialProcessed = await service.processInitialFill({
    cycleId: cycle.id,
    symbol,
    fill: initialFill,
    initialFills: [initialFill],
  });

  assert.equal(initialProcessed.dcaOrders.length, 9);

  const dcaOrders = dcaOrderRepository.findByCycleId(cycle.id);

  assert.equal(dcaOrders.length, 9);

  const expectedDrops = [1, 3, 6, 10, 15, 21, 28, 36, 45];
  const expectedNumbers = [2, 3, 4, 5, 6, 7, 8, 9, 10];

  let previousAverage = initialPrice;
  let previousTakeProfit = initialPrice * 1.01;
  const fills = [initialFill];

  for (let i = 0; i < 9; i += 1) {
    const order = dcaOrders[i];

    assert.equal(order.symbol, symbol);
    assert.equal(order.order_type, "LIMIT_MAKER");
    assert.equal(order.order_number, expectedNumbers[i]);
    assert.equal(order.status, "PENDING");

    const expectedTarget =
      initialPrice * (1 - expectedDrops[i] / 100);

    assert.ok(
      Math.abs(Number(order.target_price) - expectedTarget) < 1e-9,
    );

    const expectedQuantity = quantityCalculator.calculateBuyQuantity(
      expectedTarget,
      rules,
    );

    assert.ok(Number(order.quantity) > 0);
    assert.equal(Number(order.quantity), expectedQuantity);
    assert.ok(expectedQuantity * expectedTarget >= 1 - 1e-9);

    const fillPrice = expectedTarget;
    const fillQuantity = expectedQuantity;

    assert.ok(fillQuantity > 0);
    assert.ok(fillQuantity * fillPrice >= 1 - 1e-9);

    fills.push({
      id: `M111-DCA-FILL-${cycle.id}-${i + 1}`,
      exchangeOrderId: `M111-DCA-EX-${cycle.id}-${i + 1}`,
      symbol,
      side: "BUY",
      price: fillPrice,
      quantity: fillQuantity,
    });

    const result = service.processDcaFill({
      cycleId: cycle.id,
      fills,
    });

    assert.ok(result.position.averagePrice < previousAverage);
    assert.ok(result.takeProfit < previousTakeProfit);

    assert.equal(
      result.stopLoss,
      initialPrice * 0.5,
    );

    previousAverage = result.position.averagePrice;
    previousTakeProfit = result.takeProfit;
    totalDcaFills += 1;
  }

  totalDcaOrders += dcaOrders.length;

  const expectedFinalQuantity = fills.reduce(
    (sum, fill) => sum + Number(fill.quantity),
    0,
  );

  const finalResult = service.processDcaFill({
    cycleId: cycle.id,
    fills,
  });

  assert.ok(
    Math.abs(
      finalResult.position.totalQuantity - expectedFinalQuantity,
    ) < 1e-9,
  );

  assert.ok(finalResult.position.averagePrice < initialPrice);
  assert.ok(finalResult.takeProfit < initialPrice * 1.01);
  assert.equal(finalResult.stopLoss, initialPrice * 0.5);

  symbolResults.push({
    symbol,
    dcaOrders: dcaOrders.length,
    dcaFills: 9,
    finalPositionQuantity: finalResult.position.totalQuantity,
    finalAveragePrice: finalResult.position.averagePrice,
    finalTakeProfit: finalResult.takeProfit,
    stopLossLocked: finalResult.stopLoss === initialPrice * 0.5,
  });
}

assert.equal(totalDcaOrders, 45);
assert.equal(totalDcaFills, 45);
assert.equal(symbolResults.length, 5);

console.log("M111 DCA STRESS TEST: PASS");
console.log({
  symbols: symbols.length,
  dcaLevelsPerSymbol: 9,
  totalDcaOrders,
  totalDcaFills,
  averagePriceRecalculated: true,
  takeProfitRecalculated: true,
  stopLossRemainsLocked: true,
  minimumNotionalRespected: true,
  results: symbolResults,
});

db.close();
