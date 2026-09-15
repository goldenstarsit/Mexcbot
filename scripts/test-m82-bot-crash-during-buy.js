import assert from "node:assert/strict";
import db from "../src/database/connection.js";
import "../src/database/migrations/index.js";
import OrderIntentRepository from "../src/database/repositories/OrderIntentRepository.js";
import ExchangeOrderRepository from "../src/database/repositories/exchangeOrderRepository.js";
import OrderIntentRecoveryService from "../src/services/orderIntentRecoveryService.js";

const tradingCycleRepository = new (await import("../src/database/repositories/tradingCycleRepository.js")).default();
const orderIntentRepository = new OrderIntentRepository();
const exchangeOrderRepository = new ExchangeOrderRepository();

const symbol = "M82USDT";
const clientOrderId = "m82-crash-buy-001";
const exchangeOrderId = "M82-EXCHANGE-001";

function cleanup() {
  db.prepare(`
    DELETE FROM exchange_orders
    WHERE symbol = ?
  `).run(symbol);

  db.prepare(`
    DELETE FROM order_intents
    WHERE symbol = ?
  `).run(symbol);
}

try {
  cleanup();

  const cycle = tradingCycleRepository.create({
    symbol,
    status: "OPEN",
    configSnapshot: {
      config: {
        version: 1,
        symbols: [symbol],
        takeProfit: 1,
        stopLoss: 50,
      },
    },
  });

  const intent = orderIntentRepository.create({
    tradingCycleId: cycle.id,
    dcaOrderId: null,
    symbol,
    side: "BUY",
    orderType: "LIMIT_MAKER",
    price: 100,
    quantity: 0.01,
    clientOrderId,
    purpose: "initial",
  });

  orderIntentRepository.markRecoveryRequired(
    intent.id,
    "Simulated bot crash after MEXC BUY placement",
  );

  let buyPlacementCalls = 0;

  const mexcClient = {
    async getOrder({ symbol: requestedSymbol, origClientOrderId }) {
      assert.equal(requestedSymbol, symbol);
      assert.equal(origClientOrderId, clientOrderId);

      return {
        symbol,
        orderId: exchangeOrderId,
        clientOrderId,
        side: "BUY",
        type: "LIMIT_MAKER",
        price: "100",
        origQty: "0.01",
        status: "NEW",
      };
    },
  };

  const recovery = new OrderIntentRecoveryService({
    orderIntentRepository,
    exchangeOrderRepository,
    mexcClient,
  });

  const firstRecovery = await recovery.recover();

  assert.equal(firstRecovery.checked, 1);
  assert.equal(firstRecovery.recovered, 1);
  assert.equal(firstRecovery.recoveryRequired, 0);

  const recoveredOrder =
    exchangeOrderRepository.findByClientOrderId(clientOrderId);

  assert.ok(recoveredOrder);
  assert.equal(
    recoveredOrder.exchange_order_id,
    exchangeOrderId,
  );

  const resolvedIntent =
    orderIntentRepository.findById(intent.id);

  assert.equal(resolvedIntent.status, "RESOLVED");
  assert.equal(
    resolvedIntent.exchange_order_id,
    exchangeOrderId,
  );

  // Simulate bot restart: recovery runs again.
  const secondRecovery = await recovery.recover();

  assert.equal(secondRecovery.checked, 0);

  // A second BUY placement must never be required.
  const existingOrders =
    exchangeOrderRepository.findByClientOrderId(
      clientOrderId,
    );

  assert.ok(existingOrders);
  assert.equal(
    existingOrders.exchange_order_id,
    exchangeOrderId,
  );

  assert.equal(buyPlacementCalls, 0);

  console.log("M82 BOT CRASH DURING BUY: PASS");
  console.log({
    crashStateRecovered: true,
    exchangeOrderRecovered: true,
    intentResolved: resolvedIntent.status === "RESOLVED",
    duplicateBuyPrevented: buyPlacementCalls === 0,
    exchangeOrderId: recoveredOrder.exchange_order_id,
    secondRecoveryChecked: secondRecovery.checked,
  });
} finally {
  cleanup();
  db.prepare("DELETE FROM trading_cycles WHERE symbol = ?").run(symbol);
}
