import db from "../src/database/connection.js";
import OrderIntentRepository from "../src/database/repositories/OrderIntentRepository.js";
import DuplicateProtectionService from "../src/services/duplicateProtectionService.js";
import TradingCapitalGuard from "../src/services/tradingCapitalGuard.js";

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
  .run("M39USDT", unique)
  .lastInsertRowid;

const orderIntentRepository =
  new OrderIntentRepository();

const exchangeOrders = new Map();

let exchangeCallCount = 0;

const exchangeOrderRepository = {
  findByClientOrderId(clientOrderId) {
    return exchangeOrders.get(clientOrderId) ?? null;
  },

  create(data) {
    const exchangeOrder = {
      id: exchangeOrders.size + 1,
      ...data,
    };

    exchangeOrders.set(
      data.clientOrderId,
      exchangeOrder,
    );

    return exchangeOrder;
  },
};

let shouldFailPlacement = false;

const makerOrderEngine = {
  async placeBuy(args) {
    exchangeCallCount += 1;

    if (shouldFailPlacement) {
      throw new Error("M39 simulated network timeout");
    }

    return {
      orderId: `M39-EX-${exchangeCallCount}`,
      status: "NEW",
      price: args.price,
      origQty: args.quantity,
      clientOrderId: args.clientOrderId,
    };
  },

  async placeSell(args) {
    exchangeCallCount += 1;

    if (shouldFailPlacement) {
      throw new Error("M39 simulated network timeout");
    }

    return {
      orderId: `M39-EX-${exchangeCallCount}`,
      status: "NEW",
      price: args.price,
      origQty: args.quantity,
      clientOrderId: args.clientOrderId,
    };
  },
};

const mexcClient = {
  async getOrder() {
    throw new Error("order not found");
  },
};

const service = new DuplicateProtectionService({
  mexcClient,
  exchangeOrderRepository,
  makerOrderEngine,
  orderIntentRepository,
  tradingCapitalGuard: new TradingCapitalGuard(),
  mexcAccountHealthService: {
    async check() {
      return {
        status: "OK",
        authenticated: true,
        canTrade: true,
        usdt: {
          free: "100",
          locked: "0",
        },
      };
    },
  },
});

const successClientOrderId =
  `mxc-c${tradingCycleId}-initial`;

const success = await service.placeBuy({
  tradingCycleId,
  symbol: "M39USDT",
  quantity: 1,
  price: 100,
  bestAsk: 101,
  clientOrderId: successClientOrderId,
});

const successIntent =
  orderIntentRepository.findByClientOrderId(
    successClientOrderId,
  );

if (
  successIntent?.status !== "RESOLVED" ||
  !successIntent.exchange_order_id ||
  success.source !== "NEW"
) {
  throw new Error(
    `M39 success flow failed: ${JSON.stringify(
      successIntent,
    )}`,
  );
}

const failureClientOrderId =
  `mxc-c${tradingCycleId}-initial-failure`;

shouldFailPlacement = true;

let failureCaught = false;

try {
  await service.placeBuy({
    tradingCycleId,
    symbol: "M39USDT",
    quantity: 1,
    price: 99,
    bestAsk: 101,
    clientOrderId: failureClientOrderId,
  });
} catch {
  failureCaught = true;
}

const failedIntent =
  orderIntentRepository.findByClientOrderId(
    failureClientOrderId,
  );

if (
  !failureCaught ||
  failedIntent?.status !== "RECOVERY_REQUIRED"
) {
  throw new Error(
    `M39 recovery flow failed: ${JSON.stringify(
      failedIntent,
    )}`,
  );
}

console.log("M39 ORDER INTENT INTEGRATION: PASS");
console.log({
  successIntent: successIntent.status,
  successExchangeOrderId:
    successIntent.exchange_order_id,
  failureIntent: failedIntent.status,
  failureError: failedIntent.error,
  exchangeCalls: exchangeCallCount,
});

db.prepare(
  "DELETE FROM order_intents WHERE trading_cycle_id = ?",
).run(tradingCycleId);

db.prepare(
  "DELETE FROM trading_cycles WHERE id = ?",
).run(tradingCycleId);
