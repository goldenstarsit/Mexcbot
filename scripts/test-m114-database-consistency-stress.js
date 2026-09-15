import assert from "node:assert/strict";
import fs from "node:fs";

const dbPath = "./data/test/m114-database-consistency.db";

fs.rmSync(dbPath, { force: true });
fs.rmSync(`${dbPath}-wal`, { force: true });
fs.rmSync(`${dbPath}-shm`, { force: true });

process.env.MEXCBOT_DB_PATH = dbPath;

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
const { default: OrderIntentRepository } =
  await import("../src/database/repositories/OrderIntentRepository.js");
const { default: RuntimeTradingConfigRepository } =
  await import("../src/database/repositories/runtimeTradingConfigRepository.js");

const tradingCycleRepository = new TradingCycleRepository();
const dcaOrderRepository = new DcaOrderRepository();
const exchangeOrderRepository = new ExchangeOrderRepository();
const fillRepository = new FillRepository();
const orderIntentRepository = new OrderIntentRepository();
const runtimeConfigRepository = new RuntimeTradingConfigRepository();

const symbols = [
  "M114BTCUSDT",
  "M114ETHUSDT",
  "M114BNBUSDT",
  "M114SOLUSDT",
  "M114TRXUSDT",
];

const config = {
  takeProfitPercent: 1,
  stopLossPercent: 50,
  dca: {
    levels: [1, 3, 6, 10, 15, 21, 28, 36, 45],
  },
};

const cycles = [];
const dcaOrders = [];
const exchangeOrders = [];
const fills = [];
const intents = [];

for (const [symbolIndex, symbol] of symbols.entries()) {
  const cycle = tradingCycleRepository.create({
    symbol,
    cycleNumber: 1,
    configSnapshot: {
      config: {
        ...config,
        symbol,
        marker: `M114-${symbolIndex}`,
      },
      version: symbolIndex + 1,
    },
  });

  cycles.push(cycle);

  for (let level = 1; level <= 9; level += 1) {
    const dca = dcaOrderRepository.create({
      tradingCycleId: cycle.id,
      symbol,
      orderNumber: level + 1,
      orderType: "LIMIT_MAKER",
      targetPrice: 100 - level,
      quantity: 0.01,
      status: "PENDING",
    });

    dcaOrders.push(dca);

    const exchangeOrder = exchangeOrderRepository.create({
      tradingCycleId: cycle.id,
      dcaOrderId: dca.id,
      symbol,
      exchangeOrderId: `M114-${symbol}-EX-${level}`,
      clientOrderId: `M114-${symbol}-CLIENT-${level}`,
      side: "BUY",
      orderType: "LIMIT_MAKER",
      price: 100 - level,
      quantity: 0.01,
      status: "FILLED",
      placementResponse: {
        symbol,
        orderId: `M114-${symbol}-EX-${level}`,
      },
      finalResponse: {
        symbol,
        orderId: `M114-${symbol}-EX-${level}`,
        status: "FILLED",
        fills: [
          {
            tradeId: `M114-${symbol}-TRADE-${level}`,
            price: 100 - level,
            qty: 0.01,
          },
        ],
      },
    });

    exchangeOrders.push(exchangeOrder);

    const fill = fillRepository.create({
      exchangeOrderId: exchangeOrder.id,
      exchangeTradeId: `M114-${symbol}-TRADE-${level}`,
      symbol,
      side: "BUY",
      price: 100 - level,
      quantity: 0.01,
      commission: 0.001,
      commissionAsset: "USDT",
      filledAt: new Date().toISOString(),
      exchangeResponse: {
        orderId: exchangeOrder.exchange_order_id,
        tradeId: `M114-${symbol}-TRADE-${level}`,
      },
    });

    fills.push(fill);
  }

  const intent = orderIntentRepository.create({
    tradingCycleId: cycle.id,
    symbol,
    side: "BUY",
    orderType: "LIMIT_MAKER",
    price: 99,
    quantity: 0.01,
    clientOrderId: `M114-${symbol}-INTENT`,
    purpose: "INITIAL",
  });

  intents.push(intent);
}

assert.equal(cycles.length, 5);
assert.equal(dcaOrders.length, 45);
assert.equal(exchangeOrders.length, 45);
assert.equal(fills.length, 45);
assert.equal(intents.length, 5);

for (const symbol of symbols) {
  assert.equal(
    tradingCycleRepository.findByStatus("OPEN")
      .filter((cycle) => cycle.symbol === symbol).length,
    1,
  );

  assert.equal(
    dcaOrderRepository.findByCycleId(
      tradingCycleRepository.findOpenBySymbol(symbol).id,
    ).length,
    9,
  );

  assert.equal(
    fillRepository.findBySymbol(symbol).length,
    9,
  );
}

const duplicateTrade = fillRepository.createTradeFill({
  exchangeOrderId: fills[0].exchange_order_id,
  exchangeTradeId: fills[0].exchange_trade_id,
  symbol: fills[0].symbol,
  side: "BUY",
  price: fills[0].price,
  quantity: fills[0].quantity,
  filledAt: fills[0].filled_at,
});

assert.equal(duplicateTrade.created, false);
assert.equal(duplicateTrade.duplicate, true);
assert.equal(duplicateTrade.fill.id, fills[0].id);

assert.throws(
  () =>
    dcaOrderRepository.create({
      tradingCycleId: cycles[0].id,
      symbol: symbols[0],
      orderNumber: 2,
      orderType: "LIMIT_MAKER",
      targetPrice: 98,
      quantity: 0.01,
    }),
  /UNIQUE constraint failed/,
);

assert.throws(
  () =>
    exchangeOrderRepository.create({
      tradingCycleId: cycles[0].id,
      symbol: symbols[0],
      exchangeOrderId: exchangeOrders[0].exchange_order_id,
      clientOrderId: "M114-DUPLICATE-EXCHANGE",
      side: "BUY",
      orderType: "LIMIT_MAKER",
      price: 98,
      quantity: 0.01,
      status: "NEW",
    }),
  /UNIQUE constraint failed/,
);

assert.throws(
  () =>
    orderIntentRepository.create({
      tradingCycleId: cycles[0].id,
      symbol: symbols[0],
      side: "BUY",
      orderType: "LIMIT_MAKER",
      price: 98,
      quantity: 0.01,
      clientOrderId: intents[0].client_order_id,
      purpose: "DCA",
    }),
  /UNIQUE constraint failed/,
);

assert.throws(
  () =>
    fillRepository.create({
      exchangeOrderId: 999999,
      exchangeTradeId: "M114-ORPHAN-FILL",
      symbol: symbols[0],
      side: "BUY",
      price: 99,
      quantity: 0.01,
      filledAt: new Date().toISOString(),
    }),
  /FOREIGN KEY constraint failed/,
);

const config1 = runtimeConfigRepository.save({
  ...config,
  marker: "M114-V1",
});

const config2 = runtimeConfigRepository.save({
  ...config,
  marker: "M114-V2",
});

assert.equal(config1.version, 1);
assert.equal(config2.version, 2);
assert.equal(runtimeConfigRepository.getConfig().version, 2);
assert.equal(runtimeConfigRepository.getConfig().config.marker, "M114-V2");

const cycleToDelete = cycles[0];
const cycleDcaCount = dcaOrderRepository.findByCycleId(cycleToDelete.id).length;
const cycleExchangeCount =
  exchangeOrderRepository.findByCycleId(cycleToDelete.id).length;

assert.equal(cycleDcaCount, 9);
assert.equal(cycleExchangeCount, 9);

db.prepare("DELETE FROM trading_cycles WHERE id = ?")
  .run(cycleToDelete.id);

assert.equal(dcaOrderRepository.findByCycleId(cycleToDelete.id).length, 0);
assert.equal(exchangeOrderRepository.findByCycleId(cycleToDelete.id).length, 0);
assert.equal(
  db.prepare(`
    SELECT COUNT(*) AS count
    FROM fills f
    LEFT JOIN exchange_orders eo
      ON eo.id = f.exchange_order_id
    WHERE eo.id IS NULL
  `).get().count,
  0,
);
assert.equal(
  db.prepare(`
    SELECT COUNT(*) AS count
    FROM order_intents oi
    LEFT JOIN trading_cycles tc
      ON tc.id = oi.trading_cycle_id
    WHERE tc.id IS NULL
  `).get().count,
  0,
);

const foreignKeyViolations = db.pragma("foreign_key_check");
assert.equal(foreignKeyViolations.length, 0);

const integrity = db.prepare("PRAGMA integrity_check").get();
assert.equal(integrity.integrity_check, "ok");

const counts = {
  cycles: db.prepare("SELECT COUNT(*) AS count FROM trading_cycles").get().count,
  dcaOrders: db.prepare("SELECT COUNT(*) AS count FROM dca_orders").get().count,
  exchangeOrders: db.prepare("SELECT COUNT(*) AS count FROM exchange_orders").get().count,
  fills: db.prepare("SELECT COUNT(*) AS count FROM fills").get().count,
  intents: db.prepare("SELECT COUNT(*) AS count FROM order_intents").get().count,
};

assert.equal(counts.cycles, 4);
assert.equal(counts.dcaOrders, 36);
assert.equal(counts.exchangeOrders, 36);
assert.equal(counts.fills, 36);
assert.equal(counts.intents, 4);

console.log("M114 DATABASE CONSISTENCY STRESS TEST: PASS");
console.log({
  symbols: 5,
  initialCycles: 5,
  dcaOrdersCreated: 45,
  exchangeOrdersCreated: 45,
  fillsCreated: 45,
  orderIntentsCreated: 5,
  duplicateFillProtection: true,
  uniqueDcaConstraint: true,
  uniqueExchangeOrderConstraint: true,
  uniqueIntentConstraint: true,
  foreignKeyProtection: true,
  cascadeDeleteIntegrity: true,
  runtimeConfigVersioning: true,
  foreignKeyCheck: true,
  sqliteIntegrityCheck: true,
  finalCounts: counts,
});
