import ExchangeReconciliationService from "../src/services/exchangeReconciliationService.js";

const savedResponses = [];
let fillRecoveryCalls = 0;

const repository = {
  findActive() {
    return [
      {
        id: 1,
        trading_cycle_id: 1,
        dca_order_id: 101,
        exchange_order_id: "order-consistent",
        symbol: "BTCUSDT",
        status: "NEW",
      },
      {
        id: 2,
        trading_cycle_id: 2,
        dca_order_id: null,
        exchange_order_id: "order-filled",
        symbol: "ETHUSDT",
        status: "ORDER_PLACED",
      },
      {
        id: 3,
        trading_cycle_id: 3,
        dca_order_id: null,
        exchange_order_id: "order-error",
        symbol: "BNBUSDT",
        status: "NEW",
      },
    ];
  },

  updateFinalResponse(id, response) {
    savedResponses.push({ id, response });
  },

  findById(id) {
    if (id === 2) {
      return {
        id: 2,
        exchange_order_id: "order-filled",
        symbol: "ETHUSDT",
        status: "FILLED",
        fill_processing_status: "PROCESSED",
      };
    }

    return null;
  },
};

const mexcClient = {
  async getOrder({ symbol, orderId }) {
    if (orderId === "order-error") {
      throw new Error("temporary MEXC API failure");
    }

    if (orderId === "order-consistent") {
      return {
        status: "NEW",
        orderId,
        symbol,
        customField: "preserved",
      };
    }

    return {
      status: "FILLED",
      orderId,
      symbol,
      executedQty: "0.01",
    };
  },
};

const exchangeOrderFillMonitorService = {
  async processOrder({ exchangeOrder, symbol }) {
    if (
      exchangeOrder.id !== 2 ||
      symbol !== "ETHUSDT"
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
  exchangeOrderRepository: repository,
  exchangeOrderFillMonitorService,

  tradingCycleRepository: {
    findById(id) {
      const cycles = {
        1: {
          id: 1,
          symbol: "BTCUSDT",
        },
        2: {
          id: 2,
          symbol: "ETHUSDT",
        },
        3: {
          id: 3,
          symbol: "BNBUSDT",
        },
      };

      return cycles[id] ?? null;
    },
  },

  dcaOrderRepository: {
    findById(id) {
      if (id === null || id === undefined) {
        return null;
      }

      if (id === 101) {
        return {
          id: 101,
          trading_cycle_id: 1,
          symbol: "BTCUSDT",
        };
      }

      return null;
    },
  },

  fillRepository: {
    findByExchangeOrderId(id) {
      if (id === 2) {
        return [
          {
            id: 201,
            exchange_order_id: 2,
          },
        ];
      }

      return [];
    },
  },
});

const result = await service.reconcile();

if (result.checked !== 3) {
  throw new Error(`Expected checked=3, got ${result.checked}`);
}

if (result.consistent !== 1) {
  throw new Error(`Expected consistent=1, got ${result.consistent}`);
}

if (result.discrepancies !== 0) {
  throw new Error(
    `Expected discrepancies=0 after fill recovery, got ${result.discrepancies}`,
  );
}

if (result.recoveredFills !== 1) {
  throw new Error(
    `Expected recoveredFills=1, got ${result.recoveredFills}`,
  );
}

if (result.failed !== 1) {
  throw new Error(`Expected failed=1, got ${result.failed}`);
}

if (fillRecoveryCalls !== 1) {
  throw new Error(
    `Expected fillRecoveryCalls=1, got ${fillRecoveryCalls}`,
  );
}

if (savedResponses.length !== 2) {
  throw new Error(
    `Expected 2 raw responses saved, got ${savedResponses.length}`,
  );
}

if (savedResponses[0].response.customField !== "preserved") {
  throw new Error("Complete exchange response was not preserved");
}

console.log("M27 EXCHANGE RECONCILIATION: PASS");
console.log({
  checked: result.checked,
  consistent: result.consistent,
  discrepancies: result.discrepancies,
  recoveredFills: result.recoveredFills,
  fillRecoveryCalls,
  failed: result.failed,
  rawResponseSaved: savedResponses.length === 2,
});
