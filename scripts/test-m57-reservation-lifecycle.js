import DuplicateProtectionService from "../src/services/duplicateProtectionService.js";
import TradingCapitalGuard from "../src/services/tradingCapitalGuard.js";
import TradingCapitalReservationService from "../src/services/tradingCapitalReservationService.js";

function createService({ placeBuy }) {
  const reservation = new TradingCapitalReservationService();
  const intents = new Map();
  let nextIntentId = 1;

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
      placeBuy,
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
        row.error = error instanceof Error ? error.message : String(error);
        return row;
      },
      markRecoveryRequired(id, error) {
        const row = intents.get(id);
        row.status = "RECOVERY_REQUIRED";
        row.error = error instanceof Error ? error.message : String(error);
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
            free: "5",
            locked: "0",
          },
        };
      },
    },
  });

  return { service, reservation, intents };
}

const baseBuy = {
  tradingCycleId: 1,
  symbol: "BTCUSDT",
  quantity: 1,
  price: 1,
  bestAsk: 1.1,
  clientOrderId: "m57-test",
  purpose: "INITIAL",
};

const success = createService({
  async placeBuy() {
    return {
      orderId: "M57-SUCCESS",
      status: "NEW",
    };
  },
});

await success.service.placeBuy(baseBuy);

if (success.reservation.getReservedUsdt() !== 0) {
  throw new Error("Successful placement must release reservation");
}

if ([...success.intents.values()][0].status !== "RESOLVED") {
  throw new Error("Successful placement must resolve order intent");
}

const placementFailure = createService({
  async placeBuy() {
    throw new Error("M57 simulated placement failure");
  },
});

await placementFailure.service
  .placeBuy({
    ...baseBuy,
    clientOrderId: "m57-failure",
  })
  .then(() => {
    throw new Error("Expected placement failure");
  })
  .catch((error) => {
    if (error.message !== "M57 simulated placement failure") {
      throw error;
    }
  });

if (placementFailure.reservation.getReservedUsdt() !== 0) {
  throw new Error("Placement failure must release reservation");
}

if ([...placementFailure.intents.values()][0].status !== "RECOVERY_REQUIRED") {
  throw new Error("Placement failure must require recovery");
}

const missingOrderId = createService({
  async placeBuy() {
    return {
      status: "NEW",
    };
  },
});

await missingOrderId.service
  .placeBuy({
    ...baseBuy,
    clientOrderId: "m57-missing-id",
  })
  .then(() => {
    throw new Error("Expected missing order ID failure");
  })
  .catch((error) => {
    if (error.message !== "MEXC exchange order ID is missing") {
      throw error;
    }
  });

if (missingOrderId.reservation.getReservedUsdt() !== 0) {
  throw new Error("Missing order ID must leave reservation released");
}

if ([...missingOrderId.intents.values()][0].status !== "RECOVERY_REQUIRED") {
  throw new Error("Missing order ID must require recovery");
}

console.log("M57 RESERVATION LIFECYCLE: PASS");
console.log({
  successfulPlacementReleased: success.reservation.getReservedUsdt() === 0,
  placementFailureReleased: placementFailure.reservation.getReservedUsdt() === 0,
  placementFailureIntent: [...placementFailure.intents.values()][0].status,
  missingOrderIdReleased: missingOrderId.reservation.getReservedUsdt() === 0,
  missingOrderIdIntent: [...missingOrderId.intents.values()][0].status,
});
