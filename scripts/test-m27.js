import ExchangeReconciliationService from "../src/services/exchangeReconciliationService.js";

const savedResponses = [];

const repository = {
  findActive() {
    return [
      {
        id: 1,
        exchange_order_id: "order-consistent",
        symbol: "BTCUSDT",
        status: "NEW",
      },
      {
        id: 2,
        exchange_order_id: "order-filled",
        symbol: "ETHUSDT",
        status: "ORDER_PLACED",
      },
      {
        id: 3,
        exchange_order_id: "order-error",
        symbol: "BNBUSDT",
        status: "NEW",
      },
    ];
  },

  updateFinalResponse(id, response) {
    savedResponses.push({ id, response });
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

const service = new ExchangeReconciliationService({
  mexcClient,
  exchangeOrderRepository: repository,
});

const result = await service.reconcile();

if (result.checked !== 3) {
  throw new Error(`Expected checked=3, got ${result.checked}`);
}

if (result.consistent !== 1) {
  throw new Error(`Expected consistent=1, got ${result.consistent}`);
}

if (result.discrepancies !== 1) {
  throw new Error(
    `Expected discrepancies=1, got ${result.discrepancies}`,
  );
}

if (result.failed !== 1) {
  throw new Error(`Expected failed=1, got ${result.failed}`);
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
  failed: result.failed,
  rawResponseSaved: savedResponses.length === 2,
});
