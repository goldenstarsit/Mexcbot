import DuplicateProtectionService from "../src/services/duplicateProtectionService.js";
import TradingCapitalGuard from "../src/services/tradingCapitalGuard.js";
import TradingCapitalReservationService from "../src/services/tradingCapitalReservationService.js";

const reservation = new TradingCapitalReservationService({
  acquisitionTimeoutMs: 25,
});

const intents = new Map();
let nextIntentId = 1;
let exchangeCalls = 0;

const service = new DuplicateProtectionService({
  mexcClient: {
    async getOrder() {
      return null;
    },
  },

  exchangeOrderRepository: {
    findByClientOrderId() {
      return null;
    },
    async create(data) {
      return { id: 1, ...data };
    },
  },

  makerOrderEngine: {
    async placeBuy() {
      exchangeCalls += 1;
      return {
        orderId: "M62-SHOULD-NOT-EXIST",
        status: "NEW",
      };
    },
  },

  orderIntentRepository: {
    create(data) {
      const row = {
        id: nextIntentId++,
        ...data,
        status: "PENDING",
      };

      intents.set(row.id, row);
      return row;
    },

    findByClientOrderId() {
      return null;
    },

    markExchangePlaced(id, exchangeOrderId) {
      const row = intents.get(id);
      row.status = "EXCHANGE_PLACED";
      row.exchange_order_id = exchangeOrderId;
      return row;
    },

    markResolved(id, exchangeOrderId) {
      const row = intents.get(id);
      row.status = "RESOLVED";
      row.exchange_order_id = exchangeOrderId;
      return row;
    },

    markFailed(id, error) {
      const row = intents.get(id);
      row.status = "FAILED";
      row.error =
        error instanceof Error ? error.message : String(error);
      return row;
    },

    markRecoveryRequired(id, error) {
      const row = intents.get(id);
      row.status = "RECOVERY_REQUIRED";
      row.error =
        error instanceof Error ? error.message : String(error);
      return row;
    },
  },

  tradingCapitalGuard: new TradingCapitalGuard(),

  tradingCapitalReservationService: reservation,

  mexcAccountHealthService: {
    async check() {
      return {
        status: "OK",
        authenticated: true,
        canTrade: true,
        usdt: {
          free: "3",
          locked: "0",
        },
      };
    },
  },
});

reservation.reserve(3);

const buy = {
  tradingCycleId: 62,
  symbol: "BTCUSDT",
  quantity: 2,
  price: 1,
  bestAsk: 1.1,
  clientOrderId: "m62-timeout",
  purpose: "INITIAL",
};

let timeoutError = null;

try {
  await service.placeBuy(buy);
} catch (error) {
  timeoutError = error;
}

const intent = [...intents.values()][0];

if (!timeoutError) {
  throw new Error("Expected reservation timeout");
}

if (timeoutError.message !== "Reservation acquisition timed out") {
  throw new Error(
    `Unexpected error: ${timeoutError.message}`,
  );
}

if (!intent || intent.status !== "FAILED") {
  throw new Error(
    `Timeout must mark order intent FAILED, got ${intent?.status}`,
  );
}

if (intent.error !== "Reservation acquisition timed out") {
  throw new Error("Timeout error must be persisted on order intent");
}

if (exchangeCalls !== 0) {
  throw new Error(
    "Exchange BUY must not be placed after reservation timeout",
  );
}

if (reservation.getReservedUsdt() !== 3) {
  throw new Error(
    "Existing reservation must remain untouched by timed-out acquisition",
  );
}

reservation.release(
  [...reservation.activeReservations.keys()][0],
);

if (reservation.getReservedUsdt() !== 0) {
  throw new Error("Existing reservation must release normally");
}

console.log("M62 RESERVATION TIMEOUT INTEGRATION: PASS");
console.log({
  timeout: timeoutError.message,
  intentStatus: intent.status,
  exchangeCalls,
  existingReservationPreserved: true,
  finalReservedUsdt: reservation.getReservedUsdt(),
});
