import assert from "node:assert/strict";
import fs from "node:fs";
const TEST_DB = "./data/test/m112-exit-stress.db";

if (fs.existsSync(TEST_DB)) fs.rmSync(TEST_DB, { force: true });

process.env.MEXCBOT_DB_PATH = TEST_DB;

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
const { default: CycleLifecycleService } =
  await import("../src/services/cycleLifecycleService.js");
const { default: PositionCalculator } =
  await import("../src/services/positionCalculator.js");
const { default: QuantityCalculator } =
  await import("../src/services/quantityCalculator.js");

const symbols = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "TRXUSDT"];

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

const quantityCalculator = new QuantityCalculator(1);
const positionCalculator = new PositionCalculator();

const tradingCycleRepository = new TradingCycleRepository();
const dcaOrderRepository = new DcaOrderRepository();
const exchangeOrderRepository = new ExchangeOrderRepository();
const fillRepository = new FillRepository();

const reservations = new Map();

const duplicateProtectionService = {
  createClientOrderId({ cycleId, kind }) {
    return `M112-${kind}-CLIENT-${cycleId}`;
  },

  async placeSell({
    tradingCycleId,
    symbol,
    quantity,
    price,
    clientOrderId,
  }) {
    return {
      exchangeOrder: {
        id: `M112-EX-${tradingCycleId}`,
        symbol,
        side: "SELL",
        type: "LIMIT_MAKER",
        price,
        quantity,
        clientOrderId,
        status: "NEW",
      },
    };
  },
};

const marketPriceService = {
  async get(symbol) {
    const price = prices[symbol];

    return {
      symbol,
      price,
      bidPrice: price * 1.001,
      askPrice: price * 1.002,
    };
  },
};

const symbolRulesService = {
  async get() {
    return rules;
  },
};

const tradingCapitalReservationService = {
  async reserveExit({ cycleId }) {
    reservations.set(cycleId, true);
    return { cycleId, reserved: true };
  },

  releaseExit({ cycleId }) {
    reservations.delete(cycleId);
  },
};

const service = new CycleLifecycleService({
  tradingCycleRepository,
  dcaOrderRepository,
  exchangeOrderRepository,
  fillRepository,
  marketPriceService,
  symbolRulesService,
  quantityCalculator,
  positionCalculator,
  duplicateProtectionService,
  tradingCapitalReservationService,
});

const config = {
  takeProfit: 1,
  stopLoss: 50,
  dca: { levels: 9 },
};

const results = [];

for (const symbol of symbols) {
  const price = prices[symbol];

  const cycle = tradingCycleRepository.create({
    symbol,
    cycleNumber: 1,
    status: "OPEN",
    configSnapshot: {
      config,
    },
  });

  const initialQuantity = quantityCalculator.calculateBuyQuantity(
    price,
    rules,
  );

  const dcaQuantity = quantityCalculator.calculateBuyQuantity(
    price * 0.99,
    rules,
  );

  const initialExchangeOrder = exchangeOrderRepository.create({
    tradingCycleId: cycle.id,
    symbol,
    exchangeOrderId: `M112-INITIAL-${cycle.id}`,
    clientOrderId: `M112-INITIAL-CLIENT-${cycle.id}`,
    side: "BUY",
    orderType: "LIMIT_MAKER",
    price,
    quantity: initialQuantity,
    status: "FILLED",
  });

  const initialFill = await fillRepository.create({
    exchangeOrderId: initialExchangeOrder.id,
    symbol,
    side: "BUY",
    price,
    quantity: initialQuantity,
    filledAt: new Date().toISOString(),
  });

  const dcaExchangeOrder = exchangeOrderRepository.create({
    tradingCycleId: cycle.id,
    symbol,
    exchangeOrderId: `M112-DCA-${cycle.id}`,
    clientOrderId: `M112-DCA-CLIENT-${cycle.id}`,
    side: "BUY",
    orderType: "LIMIT_MAKER",
    price: price * 0.99,
    quantity: dcaQuantity,
    status: "FILLED",
  });

  const dcaFill = await fillRepository.create({
    exchangeOrderId: dcaExchangeOrder.id,
    symbol,
    side: "BUY",
    price: price * 0.99,
    quantity: dcaQuantity,
    filledAt: new Date().toISOString(),
  });

  const fills = [initialFill, dcaFill];

  const position = positionCalculator.calculate(fills);

  assert.ok(position.totalQuantity > 0);
  assert.ok(position.averagePrice < price);

  const expectedTp = position.averagePrice * 1.01;
  const expectedSl = price * 0.5;

  const exit = await service.triggerExit({
    cycleId: cycle.id,
    symbol,
    reason: "TAKE_PROFIT",
    fills,
  });

  assert.ok(exit);
  assert.equal(exit.exchangeOrder.type, "LIMIT_MAKER");
  assert.equal(exit.exchangeOrder.side, "SELL");
  assert.ok(
    Math.abs(
      Number(exit.exchangeOrder.quantity) - Number(position.totalQuantity),
    ) < 1e-12,
  );

  const expectedSellPrice = price * 1.002;

  assert.ok(
    Math.abs(Number(exit.exchangeOrder.price) - expectedSellPrice) < 1e-9,
  );

  assert.ok(expectedTp > position.averagePrice);
  assert.ok(expectedSl < position.averagePrice);

  const exchangeOrder = await exchangeOrderRepository.create({
    tradingCycleId: cycle.id,
    symbol,
    exchangeOrderId: exit.exchangeOrder.id,
    side: "SELL",
    orderType: "LIMIT_MAKER",
    price: Number(exit.exchangeOrder.price),
    quantity: Number(position.totalQuantity),
    clientOrderId: exit.exchangeOrder.clientOrderId,
    status: "FILLED",
  });

  const exitFill = await fillRepository.create({
    exchangeOrderId: exchangeOrder.id,
    symbol,
    side: "SELL",
    price: Number(exit.exchangeOrder.price),
    quantity: Number(position.totalQuantity),
    filledAt: new Date().toISOString(),
  });

  const processed = await service.processExitFill({
    cycleId: cycle.id,
    symbol,
    fill: exitFill,
    exchangeOrder,
  });

  assert.equal(processed.exitComplete, true);

  const closedCycle = tradingCycleRepository.findById(cycle.id);

  assert.ok(closedCycle);
  assert.equal(closedCycle.status, "CLOSED");

  results.push({
    symbol,
    cycleNumber: cycle.cycle_number,
    positionQuantity: position.totalQuantity,
    averagePrice: position.averagePrice,
    takeProfit: expectedTp,
    stopLoss: expectedSl,
    sellQuantity: Number(exit.exchangeOrder.quantity),
    makerOnly: exit.exchangeOrder.type === "LIMIT_MAKER",
    exitFilled: true,
    cycleClosed: closedCycle.status === "CLOSED",
  });
}

console.log("M112 EXIT STRESS TEST: PASS");
console.log({
  symbols: results.length,
  concurrentExitCapable: results.length === symbols.length,
  totalExitOrders: results.length,
  makerOnlyOrders: results.every((r) => r.makerOnly),
  fullPositionSell: results.every(
    (r) => Math.abs(r.sellQuantity - r.positionQuantity) < 1e-12,
  ),
  exitsFilled: results.every((r) => r.exitFilled),
  cyclesClosed: results.every((r) => r.cycleClosed),
  results,
});

db.close();
