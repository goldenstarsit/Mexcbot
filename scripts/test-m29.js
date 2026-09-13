import ExchangeReconciliationService from "../src/services/exchangeReconciliationService.js";

const localOrder = {
  id: 501,
  exchange_order_id: "M29-ORDER-501",
  symbol: "BTCUSDT",
  status: "ORDER_PLACED",
  trading_cycle_id: 91,
  dca_order_id: null,
  side: "BUY",
};

let finalResponseSaved = false;
let fillRecoveryCalls = 0;

const exchangeOrderRepository = {
  findActive() {
    return [localOrder];
  },

  updateFinalResponse(id, response) {
    if (id !== 501 || response.status !== "FILLED") {
      throw new Error("Final response persistence failed");
    }

    finalResponseSaved = true;
  },

  findById(id) {
    if (id !== 501) {
      throw new Error("Unexpected order ID");
    }

    return {
      ...localOrder,
      status: "FILLED",
      fill_processing_status: "PROCESSED",
    };
  },
};

const mexcClient = {
  async getOrder({ symbol, orderId }) {
    if (
      symbol !== "BTCUSDT" ||
      orderId !== "M29-ORDER-501"
    ) {
      throw new Error("Unexpected exchange lookup");
    }

    return {
      status: "FILLED",
      orderId,
      executedQty: "0.001",
      avgPrice: "100000",
    };
  },
};

const exchangeOrderFillMonitorService = {
  async processOrder({ exchangeOrder, symbol }) {
    if (
      exchangeOrder.id !== 501 ||
      symbol !== "BTCUSDT"
    ) {
      throw new Error("Unexpected fill recovery input");
    }

    fillRecoveryCalls += 1;

    return {
      processed: true,
      action: "INITIAL_FILL_PROCESSED",
    };
  },
};

const service = new ExchangeReconciliationService({
  mexcClient,
  exchangeOrderRepository,
  exchangeOrderFillMonitorService,
  tradingCycleRepository: {
    findById(id) {
      if (id !== 91) {
        throw new Error("Unexpected trading cycle ID");
      }

      return {
        id: 91,
        symbol: "BTCUSDT",
      };
    },
  },
  dcaOrderRepository: {
    findById() {
      return null;
    },
  },
  fillRepository: {
    findByExchangeOrderId() {
      return [
        {
          id: 1,
          exchange_order_id: 501,
        },
      ];
    },
  },
});

const result = await service.reconcile();

if (result.checked !== 1) {
  throw new Error("Expected one checked order");
}

if (result.recoveredFills !== 1) {
  throw new Error("Expected one recovered fill");
}

if (result.discrepancies !== 0) {
  throw new Error("Recovered fill must not remain an unresolved discrepancy");
}

if (result.failed !== 0) {
  throw new Error("Unexpected reconciliation failure");
}

if (!finalResponseSaved) {
  throw new Error("Exchange response was not persisted");
}

if (fillRecoveryCalls !== 1) {
  throw new Error("Fill recovery was not called exactly once");
}

const recoveryResult = result.results[0];

if (recoveryResult.status !== "FILL_RECOVERED") {
  throw new Error("Expected FILL_RECOVERED status");
}

if (recoveryResult.localStatusAfterRecovery !== "FILLED") {
  throw new Error("Local order was not recovered to FILLED");
}

if (
  recoveryResult.fillProcessingStatus !== "PROCESSED"
) {
  throw new Error("Fill processing was not completed");
}

console.log("M29 RECONCILIATION-DRIVEN FILL RECOVERY: PASS");
console.log({
  checked: result.checked,
  recoveredFills: result.recoveredFills,
  fillRecoveryCalls,
  finalResponseSaved,
  localStatusAfterRecovery:
    recoveryResult.localStatusAfterRecovery,
  fillProcessingStatus:
    recoveryResult.fillProcessingStatus,
});
