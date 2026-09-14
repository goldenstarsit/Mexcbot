import DuplicateProtectionService from "../src/services/duplicateProtectionService.js";
import TradingCapitalGuard from "../src/services/tradingCapitalGuard.js";
import TradingCapitalReservationService from "../src/services/tradingCapitalReservationService.js";

function createFixture({
  account = {
    status: "OK",
    authenticated: true,
    canTrade: true,
    usdt: { free: "10", locked: "0" },
  },
  makerResult = { orderId: "M64-ORDER", status: "NEW" },
  makerError = null,
  missingOrderId = false,
  repositoryError = null,
} = {}) {
  const reservation = new TradingCapitalReservationService({
    acquisitionTimeoutMs: 1000,
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
        if (repositoryError) {
          throw repositoryError;
        }

        return {
          id: 1,
          ...data,
        };
      },
    },

    makerOrderEngine: {
      async placeBuy() {
        exchangeCalls += 1;

        if (makerError) {
          throw makerError;
        }

        if (missingOrderId) {
          return {
            status: "NEW",
          };
        }

        return makerResult;
      },
    },

    orderIntentRepository: {
      findByClientOrderId() {
        return null;
      },

      create(data) {
        const row = {
          id: nextIntentId++,
          ...data,
          status: "PENDING",
        };

        intents.set(row.id, row);
        return row;
      },

      markExchangePlaced(id, exchangeOrderId) {
        const row = intents.get(id);
        row.status = "EXCHANGE_PLACED";
        row.exchangeOrderId = exchangeOrderId;
        return row;
      },

      markResolved(id, exchangeOrderId) {
        const row = intents.get(id);
        row.status = "RESOLVED";
        row.exchangeOrderId = exchangeOrderId;
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
        return account;
      },
    },
  });

  return {
    service,
    reservation,
    intents,
    getExchangeCalls: () => exchangeCalls,
  };
}

const baseBuy = {
  tradingCycleId: 64,
  symbol: "BTCUSDT",
  quantity: 2,
  price: 1,
  bestAsk: 1.1,
  clientOrderId: "m64-buy",
  purpose: "initial",
};

{
  const { service, reservation, intents, getExchangeCalls } =
    createFixture();

  const result = await service.placeBuy(baseBuy);

  const intent = [...intents.values()][0];

  if (result.source !== "NEW") {
    throw new Error("Successful BUY must be NEW");
  }

  if (intent.status !== "RESOLVED") {
    throw new Error("Successful BUY intent must be RESOLVED");
  }

  if (getExchangeCalls() !== 1) {
    throw new Error("Successful BUY must place exactly one exchange order");
  }

  if (reservation.getReservedUsdt() !== 0) {
    throw new Error("Successful BUY must release reservation");
  }
}

{
  const { service, reservation, intents, getExchangeCalls } =
    createFixture({
      makerError: new Error("M64 maker rejection"),
    });

  let error = null;

  try {
    await service.placeBuy({
      ...baseBuy,
      clientOrderId: "m64-maker-error",
    });
  } catch (caught) {
    error = caught;
  }

  const intent = [...intents.values()][0];

  if (!error || error.message !== "M64 maker rejection") {
    throw new Error("Maker failure must propagate original error");
  }

  if (intent.status !== "RECOVERY_REQUIRED") {
    throw new Error("Maker failure must require recovery");
  }

  if (getExchangeCalls() !== 1) {
    throw new Error("Maker failure must reach exchange exactly once");
  }

  if (reservation.getReservedUsdt() !== 0) {
    throw new Error("Maker failure must release reservation");
  }
}

{
  const { service, reservation, intents, getExchangeCalls } =
    createFixture({
      missingOrderId: true,
    });

  let error = null;

  try {
    await service.placeBuy({
      ...baseBuy,
      clientOrderId: "m64-missing-order-id",
    });
  } catch (caught) {
    error = caught;
  }

  const intent = [...intents.values()][0];

  if (!error || error.message !== "MEXC exchange order ID is missing") {
    throw new Error("Missing exchange order ID must fail");
  }

  if (intent.status !== "RECOVERY_REQUIRED") {
    throw new Error("Missing order ID must require recovery");
  }

  if (getExchangeCalls() !== 1) {
    throw new Error("Missing order ID must have exactly one exchange call");
  }

  if (reservation.getReservedUsdt() !== 0) {
    throw new Error("Missing order ID must leave no reservation");
  }
}

{
  const { service, reservation, intents, getExchangeCalls } =
    createFixture({
      repositoryError: new Error("M64 database failure"),
    });

  let error = null;

  try {
    await service.placeBuy({
      ...baseBuy,
      clientOrderId: "m64-db-error",
    });
  } catch (caught) {
    error = caught;
  }

  const intent = [...intents.values()][0];

  if (!error || error.message !== "M64 database failure") {
    throw new Error("Repository failure must propagate");
  }

  if (intent.status !== "RECOVERY_REQUIRED") {
    throw new Error("Repository failure must require recovery");
  }

  if (getExchangeCalls() !== 1) {
    throw new Error("Repository failure must not duplicate exchange placement");
  }

  if (reservation.getReservedUsdt() !== 0) {
    throw new Error("Repository failure must leave no reservation");
  }
}

{
  const { service, reservation, intents, getExchangeCalls } =
    createFixture({
      account: {
        status: "DISABLED",
        authenticated: false,
        canTrade: false,
        usdt: { free: "0", locked: "0" },
      },
    });

  let error = null;

  try {
    await service.placeBuy({
      ...baseBuy,
      clientOrderId: "m64-account-disabled",
    });
  } catch (caught) {
    error = caught;
  }

  const intent = [...intents.values()][0];

  if (!error) {
    throw new Error("Disabled account must block BUY");
  }

  if (intent.status !== "RECOVERY_REQUIRED") {
    throw new Error("Account failure must require recovery");
  }

  if (getExchangeCalls() !== 0) {
    throw new Error("Disabled account must not reach exchange");
  }

  if (reservation.getReservedUsdt() !== 0) {
    throw new Error("Blocked account must have no reservation");
  }
}

console.log("M64 BUY EXECUTION SAFETY: PASS");
console.log({
  successfulBuyReleased: true,
  makerFailureRecovered: true,
  missingOrderIdRecovered: true,
  repositoryFailureRecovered: true,
  disabledAccountBlocked: true,
  noReservationLeak: true,
});
