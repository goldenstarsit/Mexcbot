import fs from "node:fs";
import assert from "node:assert/strict";

const dbPath = "./data/test/m110-concurrent-buy-stress.db";
fs.mkdirSync("./data/test", { recursive: true });
try { fs.unlinkSync(dbPath); } catch {}
try { fs.unlinkSync(`${dbPath}-wal`); } catch {}
try { fs.unlinkSync(`${dbPath}-shm`); } catch {}

process.env.MEXCBOT_DB_PATH = dbPath;

const [
  dbModule,
  tradingCycleRepositoryModule,
  exchangeOrderRepositoryModule,
  dcaOrderRepositoryModule,
  fillRepositoryModule,
  tradingCycleExecutionServiceModule,
] = await Promise.all([
  import("../src/database/connection.js"),
  import("../src/database/repositories/tradingCycleRepository.js"),
  import("../src/database/repositories/exchangeOrderRepository.js"),
  import("../src/database/repositories/dcaOrderRepository.js"),
  import("../src/database/repositories/fillRepository.js"),
  import("../src/services/tradingCycleExecutionService.js"),
]);

const db = dbModule.default;
const TradingCycleRepository = tradingCycleRepositoryModule.default;
const ExchangeOrderRepository = exchangeOrderRepositoryModule.default;
const DcaOrderRepository = dcaOrderRepositoryModule.default;
const FillRepository = fillRepositoryModule.default;
const TradingCycleExecutionService = tradingCycleExecutionServiceModule.default;

await import("../src/database/migrations/index.js");

const tradingCycleRepository = new TradingCycleRepository(db);
const exchangeOrderRepository = new ExchangeOrderRepository(db);
const dcaOrderRepository = new DcaOrderRepository(db);
const fillRepository = new FillRepository(db);

const symbols = [
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "SOLUSDT",
  "TRXUSDT",
];

const prices = {
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

const marketPriceService = {
  async get(symbol) {
    const bidPrice = prices[symbol];
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

let placementCalls = 0;
const placements = [];

const duplicateProtectionService = {
  createClientOrderId({ cycleId, kind }) {
    return `m110-${cycleId}-${kind}`;
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
    placementCalls += 1;

    const exchangeOrder = {
      id: `M110-EX-${placementCalls}`,
      orderId: `M110-EX-${placementCalls}`,
      symbol,
      side: "BUY",
      type: "LIMIT_MAKER",
      price,
      origQty: quantity,
      clientOrderId,
      status: "NEW",
    };

    placements.push({
      tradingCycleId,
      symbol,
      quantity,
      price,
      clientOrderId,
      exchangeOrder,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    return { exchangeOrder };
  },
};

const quantityCalculator = {
  calculateBuyQuantity(price, exchangeRules) {
    const requiredNotional = Math.max(1, exchangeRules.minNotional);
    const raw = requiredNotional / price;
    const steps = Math.ceil(raw / exchangeRules.stepSize - 1e-12);
    const quantity = Math.max(
      exchangeRules.minQty,
      steps * exchangeRules.stepSize,
    );

    return Number(quantity.toFixed(8));
  },
};

const makerOrderEngine = {
  validateBuy({ price, bestAsk }) {
    if (!(price < bestAsk)) {
      throw new Error("BUY would cross best ask");
    }
    return true;
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
  makerOrderEngine,
  duplicateProtectionService,
  positionProtectionService: {
    calculateAfterInitialFill() {
      return {
        position: {},
        dcaOrders: [],
        takeProfit: 0,
        stopLoss: 0,
      };
    },
  },
});

const cycleIds = [];

for (const symbol of symbols) {
  const cycle = tradingCycleRepository.create({
    symbol,
    cycleNumber: 1,
    status: "OPEN",
    configSnapshot: {
      config: {
        takeProfit: 1,
        stopLoss: 50,
        dca: { levels: 9 },
      },
    },
  });

  cycleIds.push({
    symbol,
    cycleId: cycle.id,
  });
}

const results = await Promise.all(
  cycleIds.map(({ symbol, cycleId }) =>
    service.triggerInitialOrder({
      cycleId,
      symbol,
    }),
  ),
);

assert.equal(results.length, 5);
assert.equal(placementCalls, 5);

const uniqueCycleIds = new Set(
  placements.map((placement) => placement.tradingCycleId),
);
assert.equal(uniqueCycleIds.size, 5);

const uniqueClientOrderIds = new Set(
  placements.map((placement) => placement.clientOrderId),
);
assert.equal(uniqueClientOrderIds.size, 5);

for (const result of results) {
  assert.ok(result.exchangeOrder);
  assert.equal(result.exchangeOrder.side, "BUY");
  assert.equal(result.exchangeOrder.type, "LIMIT_MAKER");
  assert.ok(result.quantity > 0);
  assert.ok(result.quantity * result.price >= 1 - 1e-9);
}

const liveOrders = exchangeOrderRepository.findLiveOrders({
  limit: 100,
  offset: 0,
});

assert.equal(liveOrders.length, 0);

const cycleStates = cycleIds.map(({ cycleId }) =>
  tradingCycleRepository.findById(cycleId),
);

assert.equal(cycleStates.length, 5);
for (const cycle of cycleStates) {
  assert.equal(cycle.cycle_number, 1);
  assert.equal(cycle.status, "OPEN");
}

console.log("M110 CONCURRENT BUY STRESS TEST: PASS");
console.log({
  symbols: symbols.length,
  concurrentInitialBuys: results.length,
  makerOnlyOrders: results.every(
    (result) => result.exchangeOrder.type === "LIMIT_MAKER",
  ),
  uniqueCycleIds: uniqueCycleIds.size,
  uniqueClientOrderIds: uniqueClientOrderIds.size,
  noDuplicateBuys: placementCalls === 5,
  minimumNotionalRespected: results.every(
    (result) => result.quantity * result.price >= 1 - 1e-9,
  ),
  cycleNumbersPreserved: cycleStates.every(
    (cycle) => cycle.cycle_number === 1,
  ),
});

db.close();
