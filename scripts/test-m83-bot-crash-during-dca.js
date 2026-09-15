import assert from "node:assert/strict";
import db from "../src/database/connection.js";
import TradingCycleRepository from "../src/database/repositories/tradingCycleRepository.js";
import OrderIntentRepository from "../src/database/repositories/OrderIntentRepository.js";
import ExchangeOrderRepository from "../src/database/repositories/exchangeOrderRepository.js";
import OrderIntentRecoveryService from "../src/services/orderIntentRecoveryService.js";

const symbol = "M83USDT";
const clientOrderId = "m83-crash-dca-001";
const exchangeOrderId = "M83-EXCHANGE-001";

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
      side: "BUY",
      type: "LIMIT_MAKER",
      price: "99",
      origQty: "0.0101",
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

  // Simulate the durable state reached immediately before a bot crash:
  // DCA BUY intent exists, but the exchange order has not yet been
  // recorded locally.
  const intent = orderIntentRepository.create({
    tradingCycleId: cycle.id,
    dcaOrderId: null,
    symbol,
    side: "BUY",
    orderType: "LIMIT_MAKER",
    price: 99,
    quantity: 0.0101,
    clientOrderId,
    purpose: "dca",
  });

  orderIntentRepository.markRecoveryRequired(
    intent.id,
    new Error("Simulated bot crash after exchange placement"),
  );

  const recoveryService = new OrderIntentRecoveryService({
    orderIntentRepository,
    exchangeOrderRepository,
    mexcClient,
  });

  // Restart recovery.
  const firstRecovery = await recoveryService.recover();

  assert.equal(firstRecovery.checked, 1);
  assert.equal(firstRecovery.recovered, 1);
  assert.equal(firstRecovery.recoveryRequired, 0);

  const recoveredOrder =
    exchangeOrderRepository.findByClientOrderId(clientOrderId);

  assert.ok(recoveredOrder);
  assert.equal(recoveredOrder.exchange_order_id, exchangeOrderId);
  assert.equal(recoveredOrder.symbol, symbol);
  assert.equal(recoveredOrder.side, "BUY");

  const resolvedIntent = orderIntentRepository.findById(intent.id);

  assert.equal(resolvedIntent.status, "RESOLVED");
  assert.equal(resolvedIntent.exchange_order_id, exchangeOrderId);

  // Simulate a second restart: the already recovered DCA order
  // must not be placed/recovered again.
  const secondRecovery = await recoveryService.recover();

  assert.equal(secondRecovery.checked, 0);
  assert.equal(secondRecovery.recovered, 0);

  const sameRecoveredOrder =
    exchangeOrderRepository.findByClientOrderId(clientOrderId);

  assert.equal(sameRecoveredOrder.id, recoveredOrder.id);

  console.log("M83 BOT CRASH DURING DCA: PASS");
  console.log({
    crashStateRecovered: true,
    dcaExchangeOrderRecovered: true,
    intentResolved: true,
    duplicateDcaPrevented: true,
    exchangeOrderId,
    secondRecoveryChecked: secondRecovery.checked,
  });
} finally {
  cleanup();
  db.prepare("DELETE FROM trading_cycles WHERE symbol = ?").run(symbol);
}
