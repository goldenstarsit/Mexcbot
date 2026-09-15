import assert from "node:assert/strict";
import db from "../src/database/connection.js";
import TradingCycleRepository from "../src/database/repositories/tradingCycleRepository.js";
import OrderIntentRepository from "../src/database/repositories/OrderIntentRepository.js";
import ExchangeOrderRepository from "../src/database/repositories/exchangeOrderRepository.js";
import OrderIntentRecoveryService from "../src/services/orderIntentRecoveryService.js";

const symbol = "M85USDT";
const clientOrderId = "m85-crash-sl-001";
const exchangeOrderId = "M85-SL-EXCHANGE-001";

const tradingCycleRepository = new TradingCycleRepository();
const orderIntentRepository = new OrderIntentRepository();
const exchangeOrderRepository = new ExchangeOrderRepository();

const mexcClient = {
  async getOrder({ symbol: requestedSymbol, origClientOrderId }) {
    assert.equal(requestedSymbol, symbol);
    assert.equal(origClientOrderId, clientOrderId);

    return {
      orderId: exchangeOrderId,
      clientOrderId,
      symbol,
      side: "SELL",
      type: "LIMIT_MAKER",
      price: "50",
      origQty: "0.03",
      executedQty: "0",
      status: "NEW",
      time: Date.now(),
    };
  },
};

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
    status: "EXIT_PENDING",
    configSnapshot: {
      config: {
        version: 1,
        symbols: [symbol],
        takeProfit: 1,
        stopLoss: 50,
      },
    },
  });

  // Simulate SL SELL placement immediately before the bot crashes,
  // before the local exchange order is recorded.
  const intent = orderIntentRepository.create({
    tradingCycleId: cycle.id,
    dcaOrderId: null,
    symbol,
    side: "SELL",
    orderType: "LIMIT_MAKER",
    price: 50,
    quantity: 0.03,
    clientOrderId,
    purpose: "stop_loss",
  });

  orderIntentRepository.markRecoveryRequired(
    intent.id,
    new Error("Simulated bot crash after SL placement"),
  );

  const recoveryService = new OrderIntentRecoveryService({
    orderIntentRepository,
    exchangeOrderRepository,
    mexcClient,
  });

  const firstRecovery = await recoveryService.recover();

  assert.equal(firstRecovery.checked, 1);
  assert.equal(firstRecovery.recovered, 1);
  assert.equal(firstRecovery.recoveryRequired, 0);

  const recoveredOrder =
    exchangeOrderRepository.findByClientOrderId(clientOrderId);

  assert.ok(recoveredOrder);
  assert.equal(recoveredOrder.exchange_order_id, exchangeOrderId);
  assert.equal(recoveredOrder.symbol, symbol);
  assert.equal(recoveredOrder.side, "SELL");
  assert.equal(recoveredOrder.order_type, "LIMIT_MAKER");
  assert.equal(Number(recoveredOrder.quantity), 0.03);
  assert.equal(Number(recoveredOrder.price), 50);

  const resolvedIntent = orderIntentRepository.findById(intent.id);

  assert.equal(resolvedIntent.status, "RESOLVED");
  assert.equal(resolvedIntent.exchange_order_id, exchangeOrderId);

  // A second restart must not create/recover a duplicate SL order.
  const secondRecovery = await recoveryService.recover();

  assert.equal(secondRecovery.checked, 0);
  assert.equal(secondRecovery.recovered, 0);

  const sameRecoveredOrder =
    exchangeOrderRepository.findByClientOrderId(clientOrderId);

  assert.equal(sameRecoveredOrder.id, recoveredOrder.id);

  console.log("M85 BOT CRASH DURING SL: PASS");
  console.log({
    crashStateRecovered: true,
    slExchangeOrderRecovered: true,
    intentResolved: true,
    duplicateSlPrevented: true,
    exchangeOrderId,
    secondRecoveryChecked: secondRecovery.checked,
  });
} finally {
  cleanup();
  db.prepare("DELETE FROM trading_cycles WHERE symbol = ?").run(symbol);
}
