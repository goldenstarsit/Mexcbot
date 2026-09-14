import DuplicateProtectionService from "../src/services/duplicateProtectionService.js";
import TradingCapitalGuard from "../src/services/tradingCapitalGuard.js";
import TradingCapitalReservationService from "../src/services/tradingCapitalReservationService.js";

function createService(freeUsdt) {
  let exchangeCalls = 0;

  const service = new DuplicateProtectionService({
    mexcClient: {
      async getOrder() {
        throw new Error("Order does not exist");
      },
      async createOrder() {
        exchangeCalls += 1;
        return {
          orderId: `M54-${exchangeCalls}`,
          status: "NEW",
        };
      },
    },
    exchangeOrderRepository: {
      findByClientOrderId() {
        return null;
      },
      async create(data) {
        return {
          id: 1,
          ...data,
        };
      },
    },
    makerOrderEngine: {
      async placeBuy() {
        exchangeCalls += 1;
        return {
          orderId: `M54-MAKER-${exchangeCalls}`,
          status: "NEW",
        };
      },
    },
    orderIntentRepository: {
      findByClientOrderId() {
        return null;
      },
      create(data) {
        return {
          id: 1,
          ...data,
        };
      },
      markExchangePlaced() {},
      markResolved() {},
      markFailed() {},
      markRecoveryRequired() {},
    },
    tradingCapitalGuard: new TradingCapitalGuard(),
    tradingCapitalReservationService:
      new TradingCapitalReservationService(),
    mexcAccountHealthService: {
      async check() {
        return {
          status: "OK",
          authenticated: true,
          canTrade: true,
          usdt: {
            free: String(freeUsdt),
            locked: "0",
          },
        };
      },
    },
  });

  return {
    service,
    getExchangeCalls: () => exchangeCalls,
  };
}

const sufficient = createService("2.00");

const placed = await sufficient.service.placeBuy({
  tradingCycleId: 1,
  symbol: "BTCUSDT",
  quantity: 0.00002,
  price: 100000,
  bestAsk: 100001,
  clientOrderId: "mxc-c1-initial",
});

if (placed.source !== "NEW") {
  throw new Error(`Expected NEW placement, got ${placed.source}`);
}

if (sufficient.getExchangeCalls() !== 1) {
  throw new Error("Sufficient balance should reach exchange exactly once");
}

const insufficient = createService("0.99");

let blockedError = null;

try {
  await insufficient.service.placeBuy({
    tradingCycleId: 2,
    symbol: "BTCUSDT",
    quantity: 0.00002,
    price: 100000,
    bestAsk: 100001,
    clientOrderId: "mxc-c2-initial",
  });
} catch (error) {
  blockedError = error;
}

if (!blockedError) {
  throw new Error("Insufficient balance should block BUY");
}

if (!blockedError.message.includes("Insufficient free USDT")) {
  throw new Error(`Unexpected blocking error: ${blockedError.message}`);
}

if (insufficient.getExchangeCalls() !== 0) {
  throw new Error("Insufficient balance must not reach exchange");
}

console.log("M54 BUY CAPITAL FLOW: PASS");
console.log({
  sufficientPlacement: placed.source,
  sufficientExchangeCalls: sufficient.getExchangeCalls(),
  insufficientBlocked: true,
  insufficientExchangeCalls: insufficient.getExchangeCalls(),
  blockedReason: blockedError.message,
});
