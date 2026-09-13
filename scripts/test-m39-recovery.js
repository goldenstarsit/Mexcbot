import db from "../src/database/connection.js";
import OrderIntentRepository from "../src/database/repositories/OrderIntentRepository.js";
import OrderIntentRecoveryService from "../src/services/orderIntentRecoveryService.js";

const unique = Date.now();

const tradingCycleId = db
  .prepare(`
    INSERT INTO trading_cycles (
      symbol,
      status,
      cycle_number
    )
    VALUES (?, 'OPEN', ?)
  `)
  .run("M39RUSDT", unique)
  .lastInsertRowid;

const orderIntentRepository =
  new OrderIntentRepository();

const exchangeOrders = new Map();

const exchangeOrderRepository = {
  findByClientOrderId(clientOrderId) {
    return exchangeOrders.get(clientOrderId) ?? null;
  },

  create(data) {
    const order = {
      id: exchangeOrders.size + 1,
      ...data,
    };

    exchangeOrders.set(
      data.clientOrderId,
      order,
    );

    return order;
  },
};

const recoveryClientOrderId =
  `mxc-c${tradingCycleId}-initial-recovery`;

const recoveryIntent =
  orderIntentRepository.create({
    tradingCycleId,
    symbol: "M39RUSDT",
    side: "BUY",
    orderType: "LIMIT_MAKER",
    price: 100,
    quantity: 0.01,
    clientOrderId: recoveryClientOrderId,
    purpose: "initial",
  });

const mexcClient = {
  async getOrder({
    symbol,
    origClientOrderId,
  }) {
    if (
      symbol !== "M39RUSDT" ||
      origClientOrderId !== recoveryClientOrderId
    ) {
      throw new Error("Unexpected recovery request");
    }

    return {
      orderId: "M39-RECOVERED-1",
      symbol,
      clientOrderId: origClientOrderId,
      status: "NEW",
      price: "100",
      origQty: "0.01",
    };
  },
};

const service =
  new OrderIntentRecoveryService({
    orderIntentRepository,
    exchangeOrderRepository,
    mexcClient,
  });

const result =
  await service.recover();

const resolvedIntent =
  orderIntentRepository.findByClientOrderId(
    recoveryClientOrderId,
  );

const recoveredOrder =
  exchangeOrderRepository.findByClientOrderId(
    recoveryClientOrderId,
  );

if (
  result.checked !== 1 ||
  result.recovered !== 1 ||
  resolvedIntent?.status !== "RESOLVED" ||
  resolvedIntent?.exchange_order_id !==
    "M39-RECOVERED-1" ||
  recoveredOrder?.exchangeOrderId !==
    "M39-RECOVERED-1"
) {
  throw new Error(
    `M39 recovery failed: ${JSON.stringify({
      result,
      resolvedIntent,
      recoveredOrder,
    })}`,
  );
}

console.log(
  "M39 ORDER INTENT RECOVERY: PASS",
);

console.log({
  checked: result.checked,
  recovered: result.recovered,
  intentStatus: resolvedIntent.status,
  recoveredExchangeOrderId:
    recoveredOrder.exchangeOrderId,
});

db.prepare(
  "DELETE FROM order_intents WHERE trading_cycle_id = ?",
).run(tradingCycleId);

db.prepare(
  "DELETE FROM trading_cycles WHERE id = ?",
).run(tradingCycleId);
