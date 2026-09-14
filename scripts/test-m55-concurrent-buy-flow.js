import DuplicateProtectionService from "../src/services/duplicateProtectionService.js";
import TradingCapitalGuard from "../src/services/tradingCapitalGuard.js";
import TradingCapitalReservationService from "../src/services/tradingCapitalReservationService.js";

const reservation = new TradingCapitalReservationService();
const capitalGuard = new TradingCapitalGuard();

let exchangeCalls = 0;
let nextIntentId = 1;
const intents = new Map();
const exchangeOrderCalls = [];

const orderIntentRepository = {
  create(data) {
    const id = nextIntentId++;
    const row = {
      id,
      ...data,
      clientOrderId: data.clientOrderId,
      status: "PENDING",
    };
    intents.set(id, row);
    return row;
  },

  findByClientOrderId(clientOrderId) {
    return (
      [...intents.values()].find(
        (intent) =>
          intent.clientOrderId === clientOrderId ||
          intent.client_order_id === clientOrderId,
      ) ?? null
    );
  },

  markExchangePlaced(id, exchangeOrderId) {
    const intent = intents.get(id);
    intent.status = "EXCHANGE_PLACED";
    intent.exchange_order_id = exchangeOrderId;
    return intent;
  },

  markResolved(id, exchangeOrderId) {
    const intent = intents.get(id);
    intent.status = "RESOLVED";
    intent.exchange_order_id = exchangeOrderId;
    return intent;
  },

  markFailed(id, error) {
    const intent = intents.get(id);
    intent.status = "FAILED";
    intent.error = error.message;
    return intent;
  },

  markRecoveryRequired(id, error) {
    const intent = intents.get(id);
    intent.status = "RECOVERY_REQUIRED";
    intent.error =
      error instanceof Error ? error.message : String(error);
    return intent;
  },
};

const exchangeOrderRepository = {
  findByClientOrderId() {
    return null;
  },

  create(data) {
    return {
      id: exchangeCalls,
      ...data,
    };
  },
};

const mexcClient = {
  async getOrder() {
    return null;
  },
};

const makerOrderEngine = {
  async placeBuy({ clientOrderId, price, quantity }) {
    exchangeCalls += 1;

    const requiredUsdt = Number(price) * Number(quantity);
    exchangeOrderCalls.push({
      clientOrderId,
      requiredUsdt,
    });

    return {
      orderId: `M55-ORDER-${exchangeCalls}`,
      clientOrderId,
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT_MAKER",
      price: String(price),
      origQty: String(quantity),
      status: "NEW",
    };
  },
};

const mexcAccountHealthService = {
  async check() {
    return {
      status: "OK",
      authenticated: true,
      canTrade: true,
      usdt: {
        free: "5",
        locked: "0",
      },
    };
  },
};

const service = new DuplicateProtectionService({
  mexcClient,
  exchangeOrderRepository,
  makerOrderEngine,
  orderIntentRepository,
  tradingCapitalGuard: capitalGuard,
  mexcAccountHealthService,
  tradingCapitalReservationService: reservation,
});

// Concurrent trigger order:
// 3 USDT first, then 1 USDT, then 2 USDT.
// Priority must be: 1 -> 2 -> 3.
const buy3 = service.placeBuy({
  tradingCycleId: 1,
  symbol: "BTCUSDT",
  price: 3,
  quantity: 1,
  clientOrderId: "m55-buy-3",
  purpose: "INITIAL",
});

const buy1 = service.placeBuy({
  tradingCycleId: 1,
  symbol: "ETHUSDT",
  price: 1,
  quantity: 1,
  clientOrderId: "m55-buy-1",
  purpose: "INITIAL",
});

const buy2 = service.placeBuy({
  tradingCycleId: 1,
  symbol: "SOLUSDT",
  price: 2,
  quantity: 1,
  clientOrderId: "m55-buy-2",
  purpose: "INITIAL",
});

const results = await Promise.all([
  buy3,
  buy1,
  buy2,
]);

const priorityOrder =
  exchangeOrderCalls.map((item) => item.requiredUsdt);

const expected = [1, 2, 3];

if (JSON.stringify(priorityOrder) !== JSON.stringify(expected)) {
  throw new Error(
    `Expected BUY priority ${JSON.stringify(expected)}, got ${JSON.stringify(priorityOrder)}`,
  );
}

if (exchangeCalls !== 3) {
  throw new Error(
    `Expected 3 exchange BUY calls, got ${exchangeCalls}`,
  );
}

for (const result of results) {
  if (result?.exchangeOrder?.status !== "NEW") {
    throw new Error(
      `Expected NEW BUY status, got ${result?.exchangeOrder?.status}`,
    );
  }
}

if (reservation.getReservedUsdt() !== 0) {
  throw new Error(
    `Expected final reservation 0, got ${reservation.getReservedUsdt()}`,
  );
}

const statuses = [...intents.values()].map(
  (intent) => intent.status,
);

if (statuses.some((status) => status !== "RESOLVED")) {
  throw new Error(
    `Expected all intents RESOLVED, got ${JSON.stringify(statuses)}`,
  );
}

console.log("M55 CONCURRENT BUY PRIORITY: PASS");
console.log({
  priorityOrder,
  exchangeCalls,
  finalReservedUsdt: reservation.getReservedUsdt(),
  intentStatuses: statuses,
});
