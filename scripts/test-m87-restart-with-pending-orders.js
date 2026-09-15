import assert from "node:assert/strict";
import db from "../src/database/connection.js";
import TradingCycleRepository from "../src/database/repositories/tradingCycleRepository.js";
import OrderIntentRepository from "../src/database/repositories/OrderIntentRepository.js";
import ExchangeOrderRepository from "../src/database/repositories/exchangeOrderRepository.js";
import OrderIntentRecoveryService from "../src/services/orderIntentRecoveryService.js";

const symbol = "M87BTCUSDT";
const clientOrderId = "m87-restart-buy-001";

const tradingCycleRepository = new TradingCycleRepository();
const orderIntentRepository = new OrderIntentRepository();
const exchangeOrderRepository = new ExchangeOrderRepository();

let mexcGetOrderCalls = 0;

const mexcClient = {
  async getOrder({ symbol: requestedSymbol, origClientOrderId }) {
    mexcGetOrderCalls += 1;

    assert.equal(requestedSymbol, symbol);
    assert.equal(origClientOrderId, clientOrderId);

    return {
      symbol,
      orderId: "M87-EXCHANGE-001",
      clientOrderId,
      status: "NEW",
      price: "100",
      origQty: "0.01",
      side: "BUY",
      type: "LIMIT_MAKER",
      timeInForce: "GTC",
      transactTime: 1234567890,
    };
  },
};

function cleanup() {
  db.prepare(`
    DELETE FROM trading_cycles
    WHERE symbol = ?
  `).run(symbol);
}

try {
  cleanup();

  const cycle = tradingCycleRepository.create({
    symbol,
    status: "OPEN",
    configSnapshot: {
      version: 1,
      config: {
        symbols: [symbol],
        takeProfit: 1,
        stopLoss: 50,
      },
    },
  });

  // Simulate a bot crash after the durable BUY intent was created,
  // but before the exchange order was recorded locally.
  const pendingIntent = orderIntentRepository.create({
    tradingCycleId: cycle.id,
    symbol,
    side: "BUY",
    orderType: "LIMIT_MAKER",
    price: 100,
    quantity: 0.01,
    clientOrderId,
    purpose: "INITIAL_BUY",
  });

  assert.equal(pendingIntent.status, "PENDING");
  assert.equal(
    exchangeOrderRepository.findByClientOrderId(clientOrderId),
    undefined,
  );

  // Simulate process restart by constructing a fresh recovery service.
  const recoveryService = new OrderIntentRecoveryService({
    orderIntentRepository,
    exchangeOrderRepository,
    mexcClient,
  });

  const firstRecovery = await recoveryService.recover();

  assert.equal(firstRecovery.checked, 1);
  assert.equal(firstRecovery.recovered, 1);
  assert.equal(firstRecovery.recoveryRequired, 0);
  assert.equal(firstRecovery.results[0].status, "RECOVERED");

  const resolvedIntent = orderIntentRepository.findById(
    pendingIntent.id,
  );

  const recoveredOrder =
    exchangeOrderRepository.findByClientOrderId(clientOrderId);

  assert.equal(resolvedIntent.status, "RESOLVED");
  assert.equal(
    resolvedIntent.exchange_order_id,
    "M87-EXCHANGE-001",
  );

  assert.ok(recoveredOrder);
  assert.equal(
    recoveredOrder.exchange_order_id,
    "M87-EXCHANGE-001",
  );
  assert.equal(recoveredOrder.client_order_id, clientOrderId);
  assert.equal(recoveredOrder.status, "NEW");
  assert.equal(recoveredOrder.side, "BUY");
  assert.equal(recoveredOrder.order_type, "LIMIT_MAKER");
  assert.equal(recoveredOrder.quantity, 0.01);
  assert.equal(recoveredOrder.price, 100);

  // The complete MEXC response must be preserved for reconciliation/audit.
  assert.deepEqual(
    JSON.parse(recoveredOrder.placement_response_json),
    {
      symbol,
      orderId: "M87-EXCHANGE-001",
      clientOrderId,
      status: "NEW",
      price: "100",
      origQty: "0.01",
      side: "BUY",
      type: "LIMIT_MAKER",
      timeInForce: "GTC",
      transactTime: 1234567890,
    },
  );

  // Simulate another restart. The resolved intent must no longer be recovered.
  const secondRecoveryService = new OrderIntentRecoveryService({
    orderIntentRepository,
    exchangeOrderRepository,
    mexcClient,
  });

  const secondRecovery = await secondRecoveryService.recover();

  assert.equal(secondRecovery.checked, 0);
  assert.equal(secondRecovery.recovered, 0);
  assert.equal(secondRecovery.alreadyRecorded, 0);
  assert.equal(secondRecovery.recoveryRequired, 0);

  // No second exchange lookup and no duplicate local exchange order.
  assert.equal(mexcGetOrderCalls, 1);

  const orders = db
    .prepare(`
      SELECT *
      FROM exchange_orders
      WHERE client_order_id = ?
    `)
    .all(clientOrderId);

  assert.equal(orders.length, 1);

  console.log("M87 RESTART WITH PENDING ORDERS: PASS");
  console.log({
    pendingIntentRecovered: true,
    exchangeOrderRecovered: true,
    intentResolved: true,
    exchangeOrderStatusPreserved: true,
    fullExchangeResponsePreserved: true,
    duplicateRecoveryPrevented: true,
    duplicateExchangeOrderPrevented: true,
    mexcRecoveryCalls: mexcGetOrderCalls,
  });
} finally {
  cleanup();
}
